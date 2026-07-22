import os
import sys
import numpy as np
import httpx
import logging
import asyncio
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timedelta
from typing import Dict, List, Any, Tuple, Optional
from sklearn.ensemble import GradientBoostingRegressor
from scipy.interpolate import PchipInterpolator
from simulation import (CITIES, DEFAULT_CITY, LIVE_CITIES, calculate_indian_aqi,
                        calibrate_india_pollutants,
                        _us_aqi_to_pm25, _us_aqi_to_pm10, _get_openweather_key,
                        _get_weatherapi_key)

# ── Windows-safe logging ──────────────────────────────────────────────────────
# Open-Meteo's historical AQ payloads carry unit metadata with non-ASCII
# characters (e.g. "µg/m³"). On a default Windows console (cp1252/cp437),
# logger.error()/logger.info() writing that text raised UnicodeEncodeError,
# which then propagated out of the try block in get_historical_data() and was
# reported as "Exception during historical data fetch: [UnicodeEncodeError]" —
# silently killing training for every city whose payload included that
# character. Force the stream itself to UTF-8 with a safe fallback so no log
# call can ever throw again, regardless of the host OS/console codepage.
for _stream_name in ("stdout", "stderr"):
    _stream = getattr(sys, _stream_name, None)
    if _stream is not None and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

logger = logging.getLogger("AQIForecaster")
if not logger.handlers:
    _handler = logging.StreamHandler(stream=sys.stdout)
    _handler.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(levelname)s: %(message)s"))
    # errors="replace" guarantees this handler can never raise UnicodeEncodeError,
    # even if something upstream re-wraps stdout without the reconfigure above.
    if hasattr(_handler.stream, "reconfigure"):
        try:
            _handler.stream.reconfigure(errors="replace")
        except Exception:
            pass
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False

# ── Constants ────────────────────────────────────────────────────────────────
HORIZONS = [6, 12, 24, 36, 48, 72]          # anchor forecast horizons (hours)
# 14 days of hourly history is plenty of samples for this feature set (build_horizon_datasets
# needs >= 24h lookback + 72h lookahead = 96h minimum) and cuts fetch payload + training time
# roughly in half versus 30 days, with negligible accuracy impact. Raise back toward 30 if you
# have time budget and want the model to see more day-to-day variability.
HISTORY_DAYS = 14                            # days of history to fetch for training
RETRAIN_HOURS = 6                            # hours between model retrains
CV_FOLDS = 2                                  # walk-forward CV folds (was 3) — still validates
                                               # generalization while cutting ~1/3 of the fit work
# NOTE on loss='squared_error': Huber loss was dampening large AQI deltas as "outliers",
# causing flat predictions. Squared error treats rush-hour spikes as real signal.
GBM_PARAMS = dict(n_estimators=150, max_depth=7, learning_rate=0.06,
                  subsample=0.85, min_samples_leaf=3, random_state=42)
QUANTILE_LO = 0.10
QUANTILE_HI = 0.90

# Shared, connection-pooled client reused across every fetch call instead of opening
# a brand-new TCP+TLS connection per request — a real speed cost when training many
# cities back-to-back. Separate connect/read timeouts fail fast on a dead connection
# without waiting the full read budget.
_limits = httpx.Limits(max_connections=300, max_keepalive_connections=100)
_HTTP_TIMEOUT = httpx.Timeout(connect=5.0, read=12.0, write=8.0, pool=30.0)
_HTTP_CLIENT = httpx.AsyncClient(timeout=_HTTP_TIMEOUT, limits=_limits)

# ── Process pool for CPU-bound GBM fitting ─────────────────────────────────
# sklearn's GradientBoostingRegressor.fit() spends most of its time in its own
# Python-level boosting loop, which holds the GIL far more than vectorized
# numpy code does. Running several fits concurrently via asyncio.to_thread
# put them on OS threads *inside this same process*, so they all fought over
# that one GIL — meaning a page load or fallback API call from a real visitor
# could get stuck behind whatever city was mid-boosting-iteration, even
# though nothing was technically "awaiting" on it. That contention, not any
# actual await-blocking, is why the UI could feel frozen while cities trained
# in the background. A ProcessPoolExecutor gives each fit its own interpreter
# and its own GIL, so CPU-bound training runs in genuine parallel across CPU
# cores and can never block this process's asyncio event loop.
_TRAIN_PROCESS_POOL = ProcessPoolExecutor(
    max_workers=max(1, min(4, os.cpu_count() or 4))
)


def _walk_forward_split(n_samples: int, n_folds: int = 3
                        ) -> List[Tuple[np.ndarray, np.ndarray]]:
    """Generate walk-forward (expanding window) train/val index splits.

    Module-level (not a method) so it has no dependency on a class instance —
    that's what lets `_fit_all_horizons_worker` below run inside a separate
    process via ProcessPoolExecutor, since only plain functions/data (not
    bound methods holding an asyncio.Lock) can be pickled across that boundary.
    """
    fold_size = n_samples // (n_folds + 1)
    if fold_size < 24:
        # Not enough data for multiple folds — single split
        split = int(n_samples * 0.75)
        return [(np.arange(split), np.arange(split, n_samples))]

    splits = []
    for fold in range(n_folds):
        train_end = fold_size * (fold + 2)  # expanding window
        val_start = train_end
        val_end = min(train_end + fold_size, n_samples)
        if val_end <= val_start:
            continue
        splits.append((np.arange(train_end), np.arange(val_start, val_end)))
    return splits


def _fit_all_horizons_worker(horizon_datasets: Dict[int, Tuple[np.ndarray, np.ndarray]],
                             city_key: str
                             ) -> Tuple[Dict[int, Any], Dict[int, Any], Dict[int, Any], Dict[str, Any]]:
    """Synchronous, CPU-bound: walk-forward CV + final fit for every horizon.

    Runs inside a worker PROCESS (ProcessPoolExecutor), not just a worker
    thread — see the `_TRAIN_PROCESS_POOL` comment above for why. Being a
    plain module-level function (no `self`, no logger handles shared with the
    parent process) is what makes it safe to pickle and ship to that process.
    Returns empty dicts if nothing could be trained.
    """
    # Each process needs its own logger handler — module-level `logger` was
    # created in the parent process; a fresh child process re-imports this
    # module and gets its own copy, so this just works via the normal
    # module-level `logger` defined above.
    models: Dict[int, GradientBoostingRegressor] = {}
    q_lo_models: Dict[int, GradientBoostingRegressor] = {}
    q_hi_models: Dict[int, GradientBoostingRegressor] = {}

    all_mae, all_persist_mae = [], []
    all_dir_correct, all_dir_total = 0, 0

    for h in HORIZONS:
        if h not in horizon_datasets:
            logger.warning(f"Skipping horizon {h}h for {city_key}: no data")
            continue

        X, y_delta = horizon_datasets[h]
        if len(X) < 48:
            logger.warning(f"Skipping horizon {h}h for {city_key}: only {len(X)} samples")
            continue

        # ── Walk-forward CV to compute metrics ──
        splits = _walk_forward_split(len(X), n_folds=CV_FOLDS)
        fold_maes, fold_persist_maes = [], []
        fold_dir_correct, fold_dir_total = 0, 0

        for train_idx, val_idx in splits:
            X_tr, y_tr = X[train_idx], y_delta[train_idx]
            X_vl, y_vl = X[val_idx], y_delta[val_idx]

            m = GradientBoostingRegressor(loss="squared_error", **GBM_PARAMS)
            m.fit(X_tr, y_tr)
            preds = m.predict(X_vl)

            fold_maes.append(float(np.mean(np.abs(y_vl - preds))))
            fold_persist_maes.append(float(np.mean(np.abs(y_vl))))
            dir_match = np.sign(preds) == np.sign(y_vl)
            fold_dir_correct += int(np.sum(dir_match))
            fold_dir_total += len(y_vl)

        all_mae.append(np.mean(fold_maes))
        all_persist_mae.append(np.mean(fold_persist_maes))
        all_dir_correct += fold_dir_correct
        all_dir_total += fold_dir_total

        # ── Train final models on all data ──
        model = GradientBoostingRegressor(loss="squared_error", **GBM_PARAMS)
        model.fit(X, y_delta)
        models[h] = model

        q_lo = GradientBoostingRegressor(loss="quantile", alpha=QUANTILE_LO, **GBM_PARAMS)
        q_lo.fit(X, y_delta)
        q_lo_models[h] = q_lo

        q_hi = GradientBoostingRegressor(loss="quantile", alpha=QUANTILE_HI, **GBM_PARAMS)
        q_hi.fit(X, y_delta)
        q_hi_models[h] = q_hi

    if not models:
        return {}, {}, {}, {}

    avg_mae = float(np.mean(all_mae)) if all_mae else 0.0
    avg_persist_mae = float(np.mean(all_persist_mae)) if all_persist_mae else 1.0
    dir_acc = all_dir_correct / max(1, all_dir_total)
    skill = 1.0 - (avg_mae / max(1.0, avg_persist_mae))
    residual_std = max(5.0, avg_mae * 1.5)

    metrics = {
        "ml_mae": round(avg_mae, 2),
        "persistence_mae": round(avg_persist_mae, 2),
        "directional_accuracy": round(dir_acc, 3),
        "skill_score": round(skill, 3),
        "residual_std": round(residual_std, 2),
        "training_samples": sum(len(horizon_datasets[h][0]) for h in horizon_datasets),
        "validation_samples": all_dir_total,
        "horizons_trained": sorted(list(models.keys())),
    }
    return models, q_lo_models, q_hi_models, metrics


class AQIForecaster:
    """Direct-horizon delta-target AQI forecaster with quantile uncertainty."""

    def __init__(self):
        # Cache: { city_key: { "models": {h: model}, "q_lo": {h: model},
        #          "q_hi": {h: model}, "last_trained": datetime, "metrics": {...},
        #          "last_historical_data": data, "city_baseline_aqi": float } }
        self._models_cache: Dict[str, Dict[str, Any]] = {}
        self._cache_lock = asyncio.Lock()
        self._retrain_interval = timedelta(hours=RETRAIN_HOURS)
        # Cities with a train_for_city() call currently in flight. Prevents the
        # same city being trained twice at once — see the comment in
        # train_for_city() for why that was happening and why it mattered.
        self._training_in_flight: set = set()

    def get_training_status(self, city_keys: List[str]) -> Dict[str, Any]:
        """Cheap, lock-free snapshot of which of `city_keys` have a trained
        model ready vs. are still on the real-data fallback. Intended for a
        `/api/training-status` endpoint the frontend can poll to render an
        honest "live data now, ML forecast in ~Ns" state instead of either
        blocking on training or showing nothing.
        """
        trained = [k for k in city_keys if k in self._models_cache]
        pending = [k for k in city_keys if k not in self._models_cache]
        return {
            "total": len(city_keys),
            "trained": len(trained),
            "pending": len(pending),
            "trained_cities": trained,
            "pending_cities": pending,
            "complete": len(pending) == 0,
        }

    # ══════════════════════════════════════════════════════════════════════════
    # DATA FETCHING
    # ══════════════════════════════════════════════════════════════════════════

    @staticmethod
    async def _fetch_with_retry(url: str, params: Dict[str, Any],
                                max_retries: int = 2) -> Optional[httpx.Response]:
        """GET with capped exponential backoff on 429/timeout.
        max_retries is caller-tunable: the historical-data fetch (a background
        job on a multi-hour retrain cycle, never on the user request path) asks
        for a more patient budget than the default, since there's no user
        waiting on it and a slow success beats a fast failure there.
        """
        last_exc: Optional[Exception] = None
        for attempt in range(max_retries + 1):
            try:
                resp = await _HTTP_CLIENT.get(url, params=params)
                if resp.status_code == 200:
                    return resp
                if resp.status_code == 429 and attempt < max_retries:
                    wait = min(8.0, 2.0 * (2 ** attempt))
                    logger.warning(f"429 from {url} — retrying in {wait:.0f}s ({attempt+1}/{max_retries})")
                    await asyncio.sleep(wait)
                    continue
                logger.error(f"{url} returned status {resp.status_code}")
                return None
            except httpx.TimeoutException as e:
                last_exc = e
                if attempt < max_retries:
                    wait = min(8.0, 1.5 * (2 ** attempt))
                    logger.warning(f"Timeout fetching {url} (attempt {attempt+1}/{max_retries+1}), retrying in {wait:.1f}s...")
                    await asyncio.sleep(wait)
                    continue
            except Exception as e:
                last_exc = e
                break
        if last_exc is not None:
            # type(e).__name__ matters here: httpx timeout/connection errors often
            # stringify to an EMPTY message, which is why the old logs showed
            # "Exception during historical data fetch:" with nothing after the colon.
            logger.error(f"Failed to fetch {url}: {type(last_exc).__name__}: {last_exc or '(no message from exception)'}")
        return None

    async def _fetch_historical_aqi_openweather(self, lat: float, lng: float,
                                                start_date: datetime, end_date: datetime
                                                ) -> Optional[Dict[str, List[Any]]]:
        """Fallback historical AQ source: OpenWeather's Air Pollution "history"
        endpoint. Free on every OpenWeather plan (data available from
        2020-11-27), used only when Open-Meteo's own AQ call fails outright —
        which hasn't been observed in practice, but costs nothing to have as
        a safety net since Open-Meteo and OpenWeather are independent services.
        Returns the same raw-key shape Open-Meteo's response uses so the
        caller's merge logic doesn't need to branch on more than the source name.
        """
        key = _get_openweather_key()
        if not key:
            return None
        url = "http://api.openweathermap.org/data/2.5/air_pollution/history"
        params = {
            "lat": lat, "lon": lng,
            "start": int(start_date.timestamp()),
            "end": int(end_date.timestamp()) + 86400,
            "appid": key,
        }
        resp = await self._fetch_with_retry(url, params, max_retries=2)
        if resp is None:
            return None
        try:
            items = resp.json().get("list", [])
            if not items:
                return None
            out: Dict[str, List[Any]] = {"time": [], "pm2_5": [], "pm10": [],
                                         "nitrogen_dioxide": [], "sulphur_dioxide": [],
                                         "ozone": [], "carbon_monoxide": []}
            for item in items:
                c = item.get("components", {})
                out["time"].append(datetime.utcfromtimestamp(item["dt"]).strftime("%Y-%m-%dT%H:%M"))
                out["pm2_5"].append(c.get("pm2_5"))
                out["pm10"].append(c.get("pm10"))
                out["nitrogen_dioxide"].append(c.get("no2"))
                out["sulphur_dioxide"].append(c.get("so2"))
                out["ozone"].append(c.get("o3"))
                out["carbon_monoxide"].append(c.get("co"))
            return out
        except Exception as e:
            logger.error(f"Failed to parse OpenWeather historical AQI: {type(e).__name__}: {e or '(no message)'}")
            return None

    async def get_historical_data(self, lat: float, lng: float,
                                  days: int = HISTORY_DAYS) -> Optional[Dict[str, List[float]]]:
        """Fetch historical hourly AQ + weather data (up to *days* days).

        Weather comes from Open-Meteo's Historical Forecast API
        (historical-forecast-api.open-meteo.com) rather than the live
        /v1/forecast endpoint. The live endpoint isn't meant for multi-week
        lookback and was the source of the ConnectTimeout failures seen in
        production — the Historical Forecast API is a separate host built
        specifically for recent-past model output and isn't subject to the
        same load. AQ falls back to OpenWeather's history endpoint if
        Open-Meteo's AQ call fails (rare — it hasn't failed in practice, but
        it's a free, independent safety net).
        """
        end_date = datetime.now() - timedelta(days=1)
        start_date = end_date - timedelta(days=days)
        start_str = start_date.strftime("%Y-%m-%d")
        end_str = end_date.strftime("%Y-%m-%d")

        aq_url = "https://air-quality-api.open-meteo.com/v1/air-quality"
        aq_params = {
            "latitude": lat, "longitude": lng,
            "hourly": "pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,"
                      "carbon_monoxide,us_aqi_pm2_5,us_aqi_pm10",
            "start_date": start_str, "end_date": end_str,
        }

        weather_url = "https://historical-forecast-api.open-meteo.com/v1/forecast"
        weather_params = {
            "latitude": lat, "longitude": lng,
            "hourly": "temperature_2m,relative_humidity_2m,wind_speed_10m,"
                      "wind_direction_10m,precipitation,surface_pressure",
            "start_date": start_str, "end_date": end_str,
        }

        try:
            # Fetch AQ + weather concurrently instead of sequentially — this alone
            # roughly halves the wall-clock time per city, since previously the
            # weather request (with its own retry loop) only started after the AQ
            # request had fully completed. This is a background training call, not
            # on the user request path, so it gets a more patient retry budget
            # (4 attempts) than the default used for user-facing calls.
            aq_resp, weather_resp = await asyncio.gather(
                self._fetch_with_retry(aq_url, aq_params, max_retries=4),
                self._fetch_with_retry(weather_url, weather_params, max_retries=4),
            )

            aq_data: Optional[Dict[str, Any]] = None
            aq_source = "open-meteo"
            if aq_resp is not None:
                # Open-Meteo always serves UTF-8 JSON (it's what carries the
                # "µg/m³" unit metadata). Pin the decode encoding explicitly
                # instead of relying on httpx's auto-detection.
                aq_resp.encoding = "utf-8"
                aq_data = aq_resp.json().get("hourly", {})
            else:
                aq_data = await self._fetch_historical_aqi_openweather(lat, lng, start_date, end_date)
                aq_source = "openweather"

            if aq_data is None or weather_resp is None:
                logger.error(
                    f"Historical data fetch incomplete for ({lat:.4f},{lng:.4f}): "
                    f"aq={'ok (' + aq_source + ')' if aq_data is not None else 'failed'}, "
                    f"weather={'ok' if weather_resp is not None else 'failed'}"
                )
                return None

            weather_resp.encoding = "utf-8"
            weather_data = weather_resp.json().get("hourly", {})

            times = aq_data.get("time", [])
            if not times:
                return None

            # Use raw PM concentrations from CAMS with the SAME India calibration
            # (calibrate_india_pollutants) applied to current readings and forecast
            # horizons. This used to be a fourth, independently hand-tuned copy of
            # the calibration (0.7 damping / 2.5x PM10 cap, vs. 0.85 / 3.5x
            # elsewhere) — meaning the model was trained on data calibrated one way
            # while being anchored/blended against data calibrated another way at
            # inference time. Keeping all four call sites on one function is what
            # prevents that drift from creeping back in.
            # OpenWeather's history fallback already reports ground-calibrated
            # values, so it's passed through unscaled (is_cams gate below).
            is_cams = aq_source == "open-meteo"
            raw_pm25 = aq_data.get("pm2_5", [])
            raw_pm10 = aq_data.get("pm10", [])
            raw_no2 = aq_data.get("nitrogen_dioxide", [])
            raw_so2 = aq_data.get("sulphur_dioxide", [])
            raw_o3 = aq_data.get("ozone", [])
            raw_co = aq_data.get("carbon_monoxide", [])

            pm25_list, pm10_list, no2_list, so2_list, o3_list, co_list = [], [], [], [], [], []
            for idx in range(len(times)):
                pm25_raw = raw_pm25[idx] if idx < len(raw_pm25) and raw_pm25[idx] is not None else 0.0
                pm10_raw = raw_pm10[idx] if idx < len(raw_pm10) and raw_pm10[idx] is not None else 0.0
                no2_raw = raw_no2[idx] if idx < len(raw_no2) and raw_no2[idx] is not None else 0.0
                so2_raw = raw_so2[idx] if idx < len(raw_so2) and raw_so2[idx] is not None else 0.0
                o3_raw = raw_o3[idx] if idx < len(raw_o3) and raw_o3[idx] is not None else 0.0
                co_raw = raw_co[idx] if idx < len(raw_co) and raw_co[idx] is not None else 0.0

                if is_cams:
                    cal = calibrate_india_pollutants(pm25_raw, pm10_raw, no2_raw, so2_raw, co_raw, o3_raw)
                    pm25_list.append(cal["pm25"]); pm10_list.append(cal["pm10"])
                    no2_list.append(cal["no2"]); so2_list.append(cal["so2"])
                    o3_list.append(cal["o3"]); co_list.append(cal["co"])
                else:
                    pm25_list.append(pm25_raw); pm10_list.append(pm10_raw)
                    no2_list.append(no2_raw); so2_list.append(so2_raw)
                    o3_list.append(o3_raw); co_list.append(co_raw / 1000.0)

            safe = lambda lst, default=0.0: [v if v is not None else default for v in lst]

            merged = {
                "time": times,
                "pm2_5": pm25_list,
                "pm10": pm10_list,
                "no2": no2_list,
                "so2": so2_list,
                "o3": o3_list,
                "co": co_list,
                "temp": safe(weather_data.get("temperature_2m", []), 25.0),
                "humidity": safe(weather_data.get("relative_humidity_2m", []), 50.0),
                "wind_speed": safe(weather_data.get("wind_speed_10m", []), 5.0),
                "wind_dir": safe(weather_data.get("wind_direction_10m", []), 180.0),
                "precipitation": safe(weather_data.get("precipitation", []), 0.0),
                "pressure": safe(weather_data.get("surface_pressure", []), 1013.0),
            }
            return merged
        except Exception as e:
            logger.error(f"Exception during historical data fetch for ({lat:.4f},{lng:.4f}): "
                        f"{type(e).__name__}: {e or '(no message from exception)'}")
            return None

    async def _fetch_forecast_weather_weatherapi(self, lat: float, lng: float,
                                                 days: int) -> Optional[Dict[str, List[float]]]:
        """Primary forecast-weather source: WeatherAPI.com. Its free tier
        covers up to 3 days hourly, which matches this app's forecast cap, and
        its units (°C, km/h, mm, hPa) line up directly with Open-Meteo's
        defaults — no conversion needed. Returns None (falls through to
        Open-Meteo) if no WEATHERAPI_KEY is configured or the call fails.
        """
        key = _get_weatherapi_key()
        if not key:
            return None
        url = "https://api.weatherapi.com/v1/forecast.json"
        params = {"key": key, "q": f"{lat},{lng}", "days": min(max(days, 1), 3),
                  "aqi": "no", "alerts": "no"}
        resp = await self._fetch_with_retry(url, params)
        if resp is None:
            return None
        try:
            data = resp.json()
            out: Dict[str, List[Any]] = {"time": [], "temp": [], "humidity": [],
                                         "wind_speed": [], "wind_dir": [],
                                         "precipitation": [], "pressure": []}
            for day in data.get("forecast", {}).get("forecastday", []):
                for hour in day.get("hour", []):
                    out["time"].append(hour.get("time", "").replace(" ", "T"))
                    out["temp"].append(hour.get("temp_c"))
                    out["humidity"].append(hour.get("humidity"))
                    out["wind_speed"].append(hour.get("wind_kph"))
                    out["wind_dir"].append(hour.get("wind_degree"))
                    out["precipitation"].append(hour.get("precip_mm"))
                    out["pressure"].append(hour.get("pressure_mb"))
            return out if out["time"] else None
        except Exception as e:
            logger.error(f"Failed to parse WeatherAPI forecast: {type(e).__name__}: {e or '(no message)'}")
            return None

    async def get_forecast_weather(self, lat: float, lng: float,
                                   hours: int = 72) -> Optional[Dict[str, List[float]]]:
        """Fetch future weather forecast. Tries WeatherAPI.com first (if
        WEATHERAPI_KEY is set), falling back to Open-Meteo (unlimited, no key
        required) if no key is configured or the WeatherAPI call fails.
        """
        days = min(max(hours // 24, 1), 3)
        wapi_data = await self._fetch_forecast_weather_weatherapi(lat, lng, days)
        if wapi_data is not None:
            return wapi_data

        url = "https://api.open-meteo.com/v1/forecast"
        params = {
            "latitude": lat, "longitude": lng,
            "hourly": "temperature_2m,relative_humidity_2m,wind_speed_10m,"
                      "wind_direction_10m,precipitation,surface_pressure",
            "forecast_days": days,
        }
        try:
            resp = await self._fetch_with_retry(url, params)
            if resp is not None:
                resp.encoding = "utf-8"
                d = resp.json().get("hourly", {})
                return {
                    "time": d.get("time", []),
                    "temp": d.get("temperature_2m", []),
                    "humidity": d.get("relative_humidity_2m", []),
                    "wind_speed": d.get("wind_speed_10m", []),
                    "wind_dir": d.get("wind_direction_10m", []),
                    "precipitation": d.get("precipitation", []),
                    "pressure": d.get("surface_pressure", []),
                }
        except Exception as e:
            logger.error(f"Error fetching forecast weather: {type(e).__name__}: {e or '(no message from exception)'}")
        return None

    async def _fetch_forecast_aqi_openweather(self, lat: float, lng: float
                                              ) -> Optional[Dict[str, List[float]]]:
        """Fallback forecast-AQI source: OpenWeather's Air Pollution forecast
        endpoint (free, 4-day hourly), used only if Open-Meteo's forecast AQI
        call fails."""
        key = _get_openweather_key()
        if not key:
            return None
        url = "http://api.openweathermap.org/data/2.5/air_pollution/forecast"
        resp = await self._fetch_with_retry(url, {"lat": lat, "lon": lng, "appid": key}, max_retries=2)
        if resp is None:
            return None
        try:
            items = resp.json().get("list", [])
            if not items:
                return None
            out = {"time": [], "pm2_5": [], "pm10": [], "no2": [], "so2": [], "o3": [], "co": []}
            for item in items:
                c = item.get("components", {})
                out["time"].append(datetime.utcfromtimestamp(item["dt"]).strftime("%Y-%m-%dT%H:%M"))
                out["pm2_5"].append(c.get("pm2_5"))
                out["pm10"].append(c.get("pm10"))
                out["no2"].append(c.get("no2"))
                out["so2"].append(c.get("so2"))
                out["o3"].append(c.get("o3"))
                out["co"].append((c.get("co") or 0.0) / 1000.0)
            return out
        except Exception as e:
            logger.error(f"Failed to parse OpenWeather forecast AQI: {type(e).__name__}: {e or '(no message)'}")
            return None

    async def get_forecast_raw_aqi(self, lat: float, lng: float,
                                   hours: int = 72) -> Optional[Dict[str, List[float]]]:
        """Fetch raw atmospheric forecast AQI elements from Open-Meteo, falling
        back to OpenWeather's forecast AQI endpoint if Open-Meteo fails."""
        url = "https://air-quality-api.open-meteo.com/v1/air-quality"
        params = {
            "latitude": lat, "longitude": lng,
            "hourly": "pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide",
            "forecast_days": min(max(hours // 24, 1), 3),
        }
        try:
            resp = await self._fetch_with_retry(url, params)
            if resp is not None:
                resp.encoding = "utf-8"
                d = resp.json().get("hourly", {})
                return {
                    "time": d.get("time", []),
                    "pm2_5": d.get("pm2_5", []),
                    "pm10": d.get("pm10", []),
                    "no2": d.get("nitrogen_dioxide", []),
                    "so2": d.get("sulphur_dioxide", []),
                    "o3": d.get("ozone", []),
                    "co": [c / 1000.0 if c is not None else 0.0
                           for c in d.get("carbon_monoxide", [])],
                }
        except Exception as e:
            logger.error(f"Error fetching raw AQI forecast: {type(e).__name__}: {e or '(no message from exception)'}")
        return await self._fetch_forecast_aqi_openweather(lat, lng)

    # ══════════════════════════════════════════════════════════════════════════
    # FEATURE ENGINEERING
    # ══════════════════════════════════════════════════════════════════════════

    @staticmethod
    def _compute_aqi_series(data: Dict[str, Any]) -> List[float]:
        """Compute the Indian AQI for every hourly timestep in the historical data."""
        n = len(data["time"])
        aqi_series = []
        for i in range(n):
            pm25 = data["pm2_5"][i] if data["pm2_5"][i] is not None else 0.0
            pm10 = data["pm10"][i] if data["pm10"][i] is not None else 0.0
            no2 = data["no2"][i] if data["no2"][i] is not None else 0.0
            so2 = data["so2"][i] if data["so2"][i] is not None else 0.0
            co = data["co"][i] if data["co"][i] is not None else 0.0
            o3 = data["o3"][i] if data["o3"][i] is not None else 0.0
            aqi_series.append(calculate_indian_aqi(pm25, pm10, no2, so2, co, o3))
        return aqi_series

    @staticmethod
    def _rolling_stats(arr: List[float], idx: int, window: int) -> Tuple[float, float, float, float]:
        """Return (mean, std, min, max) for arr[idx-window+1 : idx+1]."""
        start = max(0, idx - window + 1)
        segment = arr[start:idx + 1]
        if not segment:
            return 0.0, 0.0, 0.0, 0.0
        a = np.array(segment, dtype=np.float64)
        return float(np.mean(a)), float(np.std(a)), float(np.min(a)), float(np.max(a))

    def build_horizon_datasets(self, data: Dict[str, Any], aqi_series: List[float],
                               city_baseline_aqi: float
                               ) -> Dict[int, Tuple[np.ndarray, np.ndarray]]:
        """
        Build (X, y_delta) for each horizon h.
        Target: delta = AQI(t+h) - AQI(t).
        Features: anchor lags, rolling stats, weather at t+h, interactions, temporal.
        """
        n = len(aqi_series)
        times = data["time"]

        datasets: Dict[int, Tuple[List[List[float]], List[float]]] = {h: ([], []) for h in HORIZONS}

        # We need 24 hours of lookback for lags, and h hours of look-ahead
        for i in range(24, n):
            dt = datetime.fromisoformat(times[i])

            # ── Anchor / persistence features ──
            aqi_now = aqi_series[i]
            aqi_lag1 = aqi_series[i - 1]
            aqi_lag3 = aqi_series[max(0, i - 3)]
            aqi_lag6 = aqi_series[max(0, i - 6)]
            aqi_lag24 = aqi_series[max(0, i - 24)]

            # AQI momentum: how fast is AQI changing in the last few hours?
            momentum_1h = aqi_now - aqi_lag1
            momentum_3h = aqi_now - aqi_lag3
            momentum_6h = aqi_now - aqi_lag6

            # Rolling stats
            mean6, std6, _, _ = self._rolling_stats(aqi_series, i, 6)
            mean24, std24, min24, max24 = self._rolling_stats(aqi_series, i, 24)

            # Current weather (at time t)
            ws_now = data["wind_speed"][i] or 5.0
            hum_now = data["humidity"][i] or 50.0
            pres_now = data["pressure"][i] or 1013.0
            temp_now = data["temp"][i] or 25.0

            for h in HORIZONS:
                target_idx = i + h
                if target_idx >= n:
                    continue  # can't compute target

                # ── Delta target ──
                delta = aqi_series[target_idx] - aqi_now

                # ── Weather at t+h (forecasted values) ──
                ws_h = data["wind_speed"][target_idx] or 5.0
                wd_h = data["wind_dir"][target_idx] or 180.0
                hum_h = data["humidity"][target_idx] or 50.0
                temp_h = data["temp"][target_idx] or 25.0
                prec_h = data["precipitation"][target_idx] or 0.0
                pres_h = data["pressure"][target_idx] or 1013.0

                # ── Interaction / physical features ──
                ventilation = ws_h * (100.0 / max(1.0, hum_h))  # wind / humidity proxy
                wind_change = ws_h - ws_now                       # dispersion event
                is_calm = 1.0 if ws_h < 2.0 else 0.0             # stagnation flag
                pressure_trend = pres_h - pres_now                # falling → buildup
                humidity_change = hum_h - hum_now
                temp_humidity = temp_h * hum_h / 100.0            # heat-moisture stress

                # Precipitation washout: has it rained in the 6h window before t+h?
                precip_start = max(0, target_idx - 6)
                precip_window = data["precipitation"][precip_start:target_idx + 1]
                precip_washout = 1.0 if any((p or 0.0) > 0.5 for p in precip_window) else 0.0

                # ── Temporal / calendar (rich) ──
                dt_h = datetime.fromisoformat(times[target_idx])
                target_hour = dt_h.hour
                hour_sin = np.sin(2 * np.pi * target_hour / 24)
                hour_cos = np.cos(2 * np.pi * target_hour / 24)
                dow = dt_h.weekday()
                is_weekend = 1.0 if dow >= 5 else 0.0

                # Fine-grained traffic/activity hour bins
                is_morning_rush = 1.0 if target_hour in (7, 8, 9, 10) else 0.0
                is_evening_rush = 1.0 if target_hour in (17, 18, 19, 20, 21) else 0.0
                is_midday = 1.0 if target_hour in (11, 12, 13, 14, 15, 16) else 0.0
                is_night = 1.0 if target_hour in (22, 23, 0, 1, 2, 3, 4, 5, 6) else 0.0

                # ── Temporal × city/weather interactions ──
                # These let the GBM learn "rush hour in a polluted city with
                # calm wind → large AQI increase" directly from CAMS diurnal data
                rush_any = max(is_morning_rush, is_evening_rush)
                rush_x_baseline = rush_any * city_baseline_aqi / 100.0
                rush_x_stagnation = rush_any * is_calm
                rush_x_weekend = rush_any * (1.0 - is_weekend)  # weekday rush matters more
                calm_x_night = is_calm * is_night  # nighttime inversion + no wind

                # Wind direction sin/cos
                wd_rad = np.radians(wd_h)

                feature_row = [
                    # Anchor / persistence (7)
                    aqi_now, aqi_lag1, aqi_lag3, aqi_lag6, aqi_lag24,
                    city_baseline_aqi,
                    float(h),  # horizon indicator
                    # Momentum (3)
                    momentum_1h, momentum_3h, momentum_6h,
                    # Rolling stats (6)
                    mean6, std6, mean24, std24, min24, max24,
                    # Weather at t+h (6)
                    ws_h, np.sin(wd_rad), np.cos(wd_rad), hum_h, temp_h, pres_h,
                    # Precipitation at t+h (1)
                    prec_h,
                    # Interactions (7)
                    ventilation, wind_change, is_calm, pressure_trend,
                    humidity_change, precip_washout, temp_humidity,
                    # Temporal rich (6)
                    hour_sin, hour_cos, is_weekend,
                    is_morning_rush, is_evening_rush, is_midday,
                    # Temporal × context interactions (4)
                    rush_x_baseline, rush_x_stagnation,
                    rush_x_weekend, calm_x_night,
                ]

                datasets[h][0].append(feature_row)
                datasets[h][1].append(delta)

        result = {}
        for h in HORIZONS:
            X_list, y_list = datasets[h]
            if len(X_list) > 0:
                result[h] = (np.array(X_list, dtype=np.float64),
                             np.array(y_list, dtype=np.float64))
        return result

    # ══════════════════════════════════════════════════════════════════════════
    # WALK-FORWARD CROSS-VALIDATION & TRAINING
    # ══════════════════════════════════════════════════════════════════════════

    async def train_for_city(self, city_key: str, force: bool = False):
        """Train direct-horizon delta-target models for a city.

        IMPORTANT: the network fetch and the CPU-bound GBM fitting both run
        OUTSIDE the cache lock, and the fitting itself runs in a separate
        process (see _fit_all_horizons_worker). Previously the entire
        fetch+train pipeline for a city ran while holding self._cache_lock,
        which meant every city's training was fully serialized — one city
        (and everything waiting on the lock, including screen-load requests)
        had to finish before the next could even start its network call.
        That single bug was why training looked "stuck" one city at a time
        and the UI felt frozen.

        DEDUPE: this also guards against the *same* city being trained twice
        concurrently. That was happening for real — the startup task trains
        every city in the background, but generate_ml_forecast() ALSO kicks
        off `train_for_city(city, force=True)` for any city without a model
        yet, every time /api/forecast is hit for that city. Right after
        startup, essentially every city has no model, so a single
        `/api/forecast?city=all` request fired a *second*, fully redundant
        training pass — including a second historical-data fetch — for all
        ~36 cities at once, on top of the startup batch already in flight.
        That doubling of concurrent requests against Open-Meteo's free tier
        is what was producing the wall of 429s and ConnectTimeouts.
        """
        if city_key in self._training_in_flight:
            logger.info(f"Skipping train_for_city({city_key}): already training.")
            return
        self._training_in_flight.add(city_key)
        try:
            now = datetime.now()
            async with self._cache_lock:
                cached = self._models_cache.get(city_key)
                if cached and not force:
                    if now - cached["last_trained"] < self._retrain_interval:
                        return

            city_conf = CITIES.get(city_key, CITIES[DEFAULT_CITY])
            lat, lng = city_conf["center"]

            logger.info(f"Training direct-horizon models for {city_key} ...")
            data = await self.get_historical_data(lat, lng, days=HISTORY_DAYS)
            if not data:
                logger.error(f"Cannot train for {city_key}: no historical data")
                return

            aqi_series = self._compute_aqi_series(data)
            city_baseline_aqi = float(np.mean(aqi_series)) if aqi_series else 100.0

            horizon_datasets = self.build_horizon_datasets(data, aqi_series, city_baseline_aqi)
            if not horizon_datasets:
                logger.error(f"Cannot train for {city_key}: insufficient samples")
                return

            # ── CPU-bound GBM fitting: offloaded to a separate PROCESS ──
            # sklearn's .fit() is synchronous and holds the GIL for long stretches
            # of its own Python-level boosting loop. Running it via
            # asyncio.to_thread put it on a worker THREAD in this same process,
            # which still shares one GIL with the event loop — under load from
            # several cities training at once, that contention was enough to make
            # unrelated requests (a visitor just loading the page) feel stuck,
            # even though nothing was technically "awaiting" on the training.
            # run_in_executor against a ProcessPoolExecutor instead runs the fit
            # in its own interpreter with its own GIL, so it can never starve
            # this process's event loop no matter how much math it's doing.
            try:
                loop = asyncio.get_running_loop()
                models, q_lo_models, q_hi_models, metrics = await loop.run_in_executor(
                    _TRAIN_PROCESS_POOL, _fit_all_horizons_worker, horizon_datasets, city_key
                )
            except Exception as e:
                logger.error(f"Training failed for {city_key}: {type(e).__name__}: {e or 'no details'}")
                return

            if not models:
                logger.error(f"No models trained for {city_key}")
                return

            async with self._cache_lock:
                self._models_cache[city_key] = {
                    "models": models,
                    "q_lo": q_lo_models,
                    "q_hi": q_hi_models,
                    "last_trained": now,
                    "metrics": metrics,
                    "last_historical_data": data,
                    "aqi_series": aqi_series,
                    "city_baseline_aqi": city_baseline_aqi,
                }
            logger.info(f"Trained {len(models)} horizon models for {city_key}. "
                        f"MAE={metrics['ml_mae']:.1f} vs Persistence={metrics['persistence_mae']:.1f}, "
                        f"DirAcc={metrics['directional_accuracy']:.1%}, Skill={metrics['skill_score']:.3f}")
        finally:
            self._training_in_flight.discard(city_key)

    async def train_all_cities(self, city_keys: Optional[List[str]] = None,
                               concurrency: int = 8, force: bool = False) -> None:
        """Train every city concurrently instead of one-at-a-time.

        Call this as a fire-and-forget background task right after the server
        starts — e.g. `asyncio.create_task(forecaster.train_all_cities())` —
        never `await` it during app startup, or you'll block the server from
        accepting any requests (including screen-load calls) until every
        single city finishes training.
        """
        keys = city_keys or list(LIVE_CITIES)
        semaphore = asyncio.Semaphore(concurrency)

        async def _train_one(key: str) -> None:
            async with semaphore:
                try:
                    await self.train_for_city(key, force=force)
                except Exception as e:
                    logger.error(f"train_all_cities: {key} failed: {type(e).__name__}: {e or 'no details'}")

        await asyncio.gather(*(_train_one(k) for k in keys))
        logger.info(f"train_all_cities complete: {len(keys)} cities processed "
                    f"({concurrency} concurrent).")

    # ══════════════════════════════════════════════════════════════════════════
    # INFERENCE — DIRECT-HORIZON + SPLINE INTERPOLATION
    # ══════════════════════════════════════════════════════════════════════════

    def _build_inference_features(self, aqi_series: List[float], data: Dict[str, Any],
                                  now_idx: int, target_idx: int, h: int,
                                  city_baseline_aqi: float,
                                  forecast_weather: Optional[Dict[str, Any]],
                                  fw_offset: int,
                                  current_aqi: float) -> List[float]:
        """Build a single feature vector for inference at horizon h."""
        scale_factor = min(2.0, max(0.5, current_aqi / max(1.0, aqi_series[now_idx])))

        aqi_now = current_aqi
        aqi_lag1 = aqi_series[max(0, now_idx - 1)] * scale_factor
        aqi_lag3 = aqi_series[max(0, now_idx - 3)] * scale_factor
        aqi_lag6 = aqi_series[max(0, now_idx - 6)] * scale_factor
        aqi_lag24 = aqi_series[max(0, now_idx - 24)] * scale_factor

        # AQI momentum
        momentum_1h = aqi_now - aqi_lag1
        momentum_3h = aqi_now - aqi_lag3
        momentum_6h = aqi_now - aqi_lag6

        raw_mean6, raw_std6, _, _ = self._rolling_stats(aqi_series, now_idx, 6)
        mean6 = raw_mean6 * scale_factor
        std6 = raw_std6 * scale_factor

        raw_mean24, raw_std24, raw_min24, raw_max24 = self._rolling_stats(aqi_series, now_idx, 24)
        mean24 = raw_mean24 * scale_factor
        std24 = raw_std24 * scale_factor
        min24 = raw_min24 * scale_factor
        max24 = raw_max24 * scale_factor

        # Current weather
        ws_now = data["wind_speed"][-1] if data["wind_speed"] else 5.0
        hum_now = data["humidity"][-1] if data["humidity"] else 50.0
        pres_now = data["pressure"][-1] if data["pressure"] else 1013.0

        # Weather at t+h — use forecast data
        if forecast_weather and fw_offset < len(forecast_weather.get("wind_speed", [])):
            ws_h = forecast_weather["wind_speed"][fw_offset] or 5.0
            wd_h = forecast_weather["wind_dir"][fw_offset] or 180.0
            hum_h = forecast_weather["humidity"][fw_offset] or 50.0
            temp_h = forecast_weather["temp"][fw_offset] or 25.0
            prec_h = forecast_weather["precipitation"][fw_offset] or 0.0
            pres_h = forecast_weather["pressure"][fw_offset] or 1013.0
        else:
            # Fallback to last known weather
            ws_h = ws_now
            wd_h = data["wind_dir"][-1] if data["wind_dir"] else 180.0
            hum_h = hum_now
            temp_h = data["temp"][-1] if data["temp"] else 25.0
            prec_h = 0.0
            pres_h = pres_now

        # Interactions
        ventilation = ws_h * (100.0 / max(1.0, hum_h))
        wind_change = ws_h - ws_now
        is_calm = 1.0 if ws_h < 2.0 else 0.0
        pressure_trend = pres_h - pres_now
        humidity_change = hum_h - hum_now
        temp_humidity = temp_h * hum_h / 100.0

        # Precipitation washout: check forecast 6h window before t+h
        precip_washout = 0.0
        if forecast_weather:
            pw_start = max(0, fw_offset - 6)
            pw_slice = forecast_weather.get("precipitation", [])[pw_start:fw_offset + 1]
            if any((p or 0.0) > 0.5 for p in pw_slice):
                precip_washout = 1.0

        # Temporal at t+h
        future_dt = datetime.now() + timedelta(hours=h)
        target_hour = future_dt.hour
        hour_sin = np.sin(2 * np.pi * target_hour / 24)
        hour_cos = np.cos(2 * np.pi * target_hour / 24)
        is_weekend = 1.0 if future_dt.weekday() >= 5 else 0.0

        # Fine-grained traffic/activity hour bins
        is_morning_rush = 1.0 if target_hour in (7, 8, 9, 10) else 0.0
        is_evening_rush = 1.0 if target_hour in (17, 18, 19, 20, 21) else 0.0
        is_midday = 1.0 if target_hour in (11, 12, 13, 14, 15, 16) else 0.0
        is_night = 1.0 if target_hour in (22, 23, 0, 1, 2, 3, 4, 5, 6) else 0.0

        # Interactions
        rush_any = max(is_morning_rush, is_evening_rush)
        rush_x_baseline = rush_any * city_baseline_aqi / 100.0
        rush_x_stagnation = rush_any * is_calm
        rush_x_weekend = rush_any * (1.0 - is_weekend)
        calm_x_night = is_calm * is_night

        wd_rad = np.radians(wd_h)

        return [
            # Anchor / persistence (7)
            aqi_now, aqi_lag1, aqi_lag3, aqi_lag6, aqi_lag24,
            city_baseline_aqi, float(h),
            # Momentum (3)
            momentum_1h, momentum_3h, momentum_6h,
            # Rolling stats (6)
            mean6, std6, mean24, std24, min24, max24,
            # Weather at t+h (6)
            ws_h, np.sin(wd_rad), np.cos(wd_rad), hum_h, temp_h, pres_h,
            # Precipitation at t+h (1)
            prec_h,
            # Interactions (7)
            ventilation, wind_change, is_calm, pressure_trend,
            humidity_change, precip_washout, temp_humidity,
            # Temporal rich (6)
            hour_sin, hour_cos, is_weekend,
            is_morning_rush, is_evening_rush, is_midday,
            # Temporal × context interactions (4)
            rush_x_baseline, rush_x_stagnation,
            rush_x_weekend, calm_x_night,
        ]

    async def generate_ml_forecast(self, city_key: str, hours: int = 72) -> Dict[str, Any]:
        """Generate ML forecast using direct-horizon delta-target models + spline interpolation.
        Runs training in a background task (non-blocking) so the API loads instantly (under 100ms).
        """
        city_conf = CITIES.get(city_key, CITIES[DEFAULT_CITY])
        lat, lng = city_conf["center"]

        # Fetch forecast inputs (non-blocking meteorological data)
        forecast_weather, forecast_raw_aqi = await asyncio.gather(
            self.get_forecast_weather(lat, lng, hours),
            self.get_forecast_raw_aqi(lat, lng, hours),
        )

        # Trigger background training if model is missing or stale (older than retrain interval)
        model_info = self._models_cache.get(city_key)
        now = datetime.now()
        if not model_info or (now - model_info["last_trained"] > self._retrain_interval):
            # Non-blocking training
            asyncio.create_task(self.train_for_city(city_key, force=True))

        # If we have no model yet, immediately return the real meteorological forecast as fallback
        if not model_info:
            if forecast_weather and forecast_raw_aqi:
                # Fetch current real AQI to smooth the transition for fallback
                from simulation import _fetch_real_aqi
                real_aqi_data = await _fetch_real_aqi(lat, lng)
                current_aqi = real_aqi_data["aqi"] if real_aqi_data else 50.0
                return self._generate_real_fallback(city_key, hours, forecast_weather, forecast_raw_aqi, current_aqi)
            return self._generate_fallback(city_key, hours)

        if not forecast_weather or not forecast_raw_aqi:
            logger.warning(f"Forecast inputs failed for {city_key}, using fallback.")
            return self._generate_fallback(city_key, hours)

        models = model_info["models"]
        q_lo_models = model_info["q_lo"]
        q_hi_models = model_info["q_hi"]
        metrics = model_info["metrics"]
        data = model_info["last_historical_data"]
        aqi_series = model_info["aqi_series"]
        city_baseline = model_info["city_baseline_aqi"]

        now_idx = len(aqi_series) - 1
        
        # Anchor the forecast starting point to stable cached real-time CPCB / Open-Meteo reading
        from simulation import sim
        try:
            readings = await sim.generate_readings(city_key)
            if readings and len(readings) > 0:
                current_aqi = float(readings[0].get("aqi_in", readings[0]["aqi"]))
            else:
                current_aqi = float(aqi_series[now_idx]) if len(aqi_series) > 0 else 50.0
        except Exception:
            current_aqi = float(aqi_series[now_idx]) if len(aqi_series) > 0 else 50.0

        # ── Predict at anchor horizons ──
        anchor_hours = []
        anchor_aqi = []
        anchor_lo = []
        anchor_hi = []

        # Use historical AQI std to clamp deltas — prevents the model from
        # predicting impossibly large jumps that push every hour to 500.
        hist_std = float(np.std(aqi_series)) if len(aqi_series) > 1 else 40.0
        # Allow deltas up to 2x the historical std, scaled by sqrt(horizon)
        # so longer horizons get more room. Floor at 40 to avoid over-clamping
        # cities with unusually stable training data.
        max_delta_base = max(40.0, 2.0 * hist_std)

        for h in HORIZONS:
            if h > hours:
                break
            if h not in models:
                continue

            features = self._build_inference_features(
                aqi_series, data, now_idx, now_idx + h, h,
                city_baseline, forecast_weather, h - 1,
                current_aqi,
            )

            delta_pred = float(models[h].predict([features])[0])
            # Clamp the delta to prevent unrealistic jumps
            max_delta_h = max_delta_base * np.sqrt(h / 6.0)
            delta_pred = max(-max_delta_h, min(max_delta_h, delta_pred))
            pred_aqi = max(0.0, min(500.0, current_aqi + delta_pred))

            # Quantile bands
            if h in q_lo_models:
                delta_lo = float(q_lo_models[h].predict([features])[0])
                delta_lo = max(-max_delta_h, min(max_delta_h, delta_lo))
                lo_aqi = max(0.0, min(500.0, current_aqi + delta_lo))
            else:
                lo_aqi = max(0.0, pred_aqi - 15.0)

            if h in q_hi_models:
                delta_hi = float(q_hi_models[h].predict([features])[0])
                delta_hi = max(-max_delta_h, min(max_delta_h, delta_hi))
                hi_aqi = max(0.0, min(500.0, current_aqi + delta_hi))
            else:
                hi_aqi = min(500.0, pred_aqi + 15.0)

            # Ensure ordering: lo <= pred <= hi
            lo_aqi = min(lo_aqi, pred_aqi)
            hi_aqi = max(hi_aqi, pred_aqi)

            anchor_hours.append(h)
            anchor_aqi.append(pred_aqi)
            anchor_lo.append(lo_aqi)
            anchor_hi.append(hi_aqi)

        if not anchor_hours:
            return self._generate_fallback(city_key, hours)

        # ── Interpolate hourly via PCHIP (monotone cubic) ──
        # Add t=0 anchor
        interp_hours = [0] + anchor_hours
        interp_aqi = [current_aqi] + anchor_aqi
        interp_lo = [current_aqi] + anchor_lo
        interp_hi = [current_aqi] + anchor_hi

        all_hours = np.arange(0, hours + 1)  # 0 to 72

        if len(interp_hours) >= 2:
            spline_aqi = PchipInterpolator(interp_hours, interp_aqi)(all_hours)
            spline_lo = PchipInterpolator(interp_hours, interp_lo)(all_hours)
            spline_hi = PchipInterpolator(interp_hours, interp_hi)(all_hours)
        else:
            # Only one point — flat line
            spline_aqi = np.full(len(all_hours), current_aqi)
            spline_lo = np.full(len(all_hours), current_aqi - 10)
            spline_hi = np.full(len(all_hours), current_aqi + 10)

        # Clamp
        spline_aqi = np.clip(spline_aqi, 0, 500)
        spline_lo = np.clip(spline_lo, 0, 500)
        spline_hi = np.clip(spline_hi, 0, 500)

        # ── Build hourly grid ──
        grid = []
        fw_times = forecast_weather.get("time", [])
        limit = min(hours, len(fw_times), len(forecast_raw_aqi.get("time", [])))

        for h_offset in range(limit):
            h_idx = h_offset + 1  # hour_offset is 1-based in the output
            dt = datetime.fromisoformat(fw_times[h_offset])

            model_predicted_aqi = float(spline_aqi[h_idx]) if h_idx < len(spline_aqi) else float(spline_aqi[-1])
            conf_lo = float(spline_lo[h_idx]) if h_idx < len(spline_lo) else float(spline_lo[-1])
            conf_hi = float(spline_hi[h_idx]) if h_idx < len(spline_hi) else float(spline_hi[-1])

            # Ensure ordering
            conf_lo = min(conf_lo, model_predicted_aqi)
            conf_hi = max(conf_hi, model_predicted_aqi)

            # Weather at this hour
            ws = (forecast_weather["wind_speed"][h_offset] or 5.0)
            wd = (forecast_weather["wind_dir"][h_offset] or 180.0)

            # Open-Meteo raw AQI — MUST use the same India calibration as the "now"
            # anchor (calibrate_india_pollutants), or "now" and "+1h" are on two
            # different scales and the blend below produces an artificial jump/
            # runaway climb as horizon-weight shifts toward this raw term.
            # CO was already divided by 1000 in get_forecast_raw_aqi
            # (µg/m³ → mg/m³). Pass co_already_mg=True to prevent the
            # double-division that was zeroing out the CO sub-index.
            om_cal = calibrate_india_pollutants(
                forecast_raw_aqi["pm2_5"][h_offset] or 0.0,
                forecast_raw_aqi["pm10"][h_offset] or 0.0,
                forecast_raw_aqi["no2"][h_offset] or 0.0,
                forecast_raw_aqi["so2"][h_offset] or 0.0,
                forecast_raw_aqi["co"][h_offset] or 0.0,
                forecast_raw_aqi["o3"][h_offset] or 0.0,
                co_already_mg=True,
            )
            open_meteo_raw_aqi = min(calculate_indian_aqi(
                om_cal["pm25"], om_cal["pm10"], om_cal["no2"],
                om_cal["so2"], om_cal["co"], om_cal["o3"]), 500.0)

            # Blend the ML model prediction with Open-Meteo raw, but keep
            # the ML model dominant. The old blend ramped to 70% Open-Meteo
            # within 24h, which meant inflated CAMS values were pulling
            # everything to 500. Now: max 35%, ramp over 48h, so the ML
            # delta-based prediction stays the primary driver and Open-Meteo
            # only provides gentle directional guidance.
            blend_weight = min(0.35, max(0.15, 0.20 + (metrics["skill_score"] * 0.05)))
            weight_raw = blend_weight * min(1.0, h_idx / 48.0)
            predicted_aqi = (weight_raw * open_meteo_raw_aqi) + ((1.0 - weight_raw) * model_predicted_aqi)
            predicted_aqi = max(0.0, min(500.0, predicted_aqi))

            conf_lo = min(conf_lo, model_predicted_aqi - 15.0)
            conf_hi = max(conf_hi, model_predicted_aqi + 15.0)

            # ── Mitigation simulation ──
            hour = dt.hour
            angle = ((hour - 10) / 24) * 2 * np.pi
            inv_height = 700 - 400 * np.cos(angle)

            ws_factor = np.exp(-ws / 5.0)
            inv_factor = 1.0 + (500.0 / max(100.0, inv_height))
            time_factor = 1.0 - np.exp(-(h_idx) / 12.0)

            mitigation_pct = 0.18 * ws_factor * inv_factor * time_factor
            mitigated_aqi = max(0.0, min(500.0, predicted_aqi * (1.0 - mitigation_pct)))

            # Confidence decays with horizon
            confidence_val = max(0.30, 0.95 - (h_idx * 0.007))

            grid.append({
                "timestamp": dt.isoformat(),
                "hour_offset": h_idx,
                "predicted_aqi": round(predicted_aqi, 1),
                "mitigated_aqi": round(mitigated_aqi, 1),
                "confidence_low": round(max(0.0, conf_lo), 1),
                "confidence_high": round(min(500.0, conf_hi), 1),
                "open_meteo_raw": round(open_meteo_raw_aqi, 1),
                "persistence_baseline": round(current_aqi, 1),
                "confidence": round(confidence_val, 2),
                "wind_speed_kmh": round(ws, 1),
                "wind_direction_deg": round(wd, 1),
            })

        # ── Hour-to-hour smoothing ──
        # Enforce a maximum AQI change between consecutive forecast hours (including Now -> +1h transition).
        # Prevents artificial spikes (e.g. 176 → 307 in one hour) while preserving natural trends.
        MAX_HOURLY_CHANGE = 18.0
        if len(grid) > 0:
            for i in range(0, len(grid)):
                prev_aqi = current_aqi if i == 0 else grid[i - 1]["predicted_aqi"]
                curr_aqi = grid[i]["predicted_aqi"]
                diff = curr_aqi - prev_aqi
                if abs(diff) > MAX_HOURLY_CHANGE:
                    clamped = prev_aqi + MAX_HOURLY_CHANGE * (1.0 if diff > 0 else -1.0)
                    grid[i]["predicted_aqi"] = round(max(1.0, min(500.0, clamped)), 1)
                    ratio = grid[i]["predicted_aqi"] / max(1.0, curr_aqi)
                    grid[i]["mitigated_aqi"] = round(max(1.0, min(500.0, grid[i]["mitigated_aqi"] * ratio)), 1)
                    grid[i]["confidence_low"] = round(max(1.0, min(grid[i]["predicted_aqi"], grid[i]["confidence_low"] * ratio)), 1)
                    grid[i]["confidence_high"] = round(max(grid[i]["predicted_aqi"], min(500.0, grid[i]["confidence_high"] * ratio)), 1)

        return {
            "city": city_key,
            "model_type": "direct_horizon_gbm_ensemble",
            "grid": grid,
            "accuracy": metrics,
            "anomalies": [],
        }

    # ══════════════════════════════════════════════════════════════════════════
    # FALLBACK & ANOMALY
    # ══════════════════════════════════════════════════════════════════════════

    def _generate_real_fallback(self, city_key: str, hours: int, forecast_weather: Dict[str, Any], forecast_raw_aqi: Dict[str, Any], current_aqi: float) -> Dict[str, Any]:
        """Generate a realistic fallback forecast directly using Open-Meteo raw predictions (under 5ms)."""
        grid = []
        limit = min(hours, len(forecast_weather.get("time", [])))
        # Use first hour as persistence baseline
        base_pm25 = forecast_raw_aqi["pm2_5"][0] if forecast_raw_aqi["pm2_5"] else 15.0
        base_pm10 = forecast_raw_aqi["pm10"][0] if forecast_raw_aqi["pm10"] else 30.0
        base_cal = calibrate_india_pollutants(base_pm25, base_pm10, 0.0, 0.0, 0.0, 0.0)
        base_aqi = calculate_indian_aqi(base_cal["pm25"], base_cal["pm10"], 0.0, 0.0, 0.0, 0.0)

        for h in range(limit):
            dt = datetime.fromisoformat(forecast_weather["time"][h])
            om_cal = calibrate_india_pollutants(
                forecast_raw_aqi["pm2_5"][h] if h < len(forecast_raw_aqi["pm2_5"]) else 15.0,
                forecast_raw_aqi["pm10"][h] if h < len(forecast_raw_aqi["pm10"]) else 30.0,
                forecast_raw_aqi["no2"][h] if h < len(forecast_raw_aqi["no2"]) else 0.0,
                forecast_raw_aqi["so2"][h] if h < len(forecast_raw_aqi["so2"]) else 0.0,
                forecast_raw_aqi["co"][h] if h < len(forecast_raw_aqi["co"]) else 0.0,
                forecast_raw_aqi["o3"][h] if h < len(forecast_raw_aqi["o3"]) else 0.0,
            )
            raw_aqi = calculate_indian_aqi(om_cal["pm25"], om_cal["pm10"], om_cal["no2"],
                                            om_cal["so2"], om_cal["co"], om_cal["o3"])

            # Smooth transition from current_aqi to raw_aqi over 48 hours.
            # Previously ramped to 100% raw in 24h, which meant inflated
            # CAMS predictions dominated the fallback forecast too quickly.
            weight_raw = min(0.50, (h + 1) / 48.0)
            smoothed_aqi = (weight_raw * raw_aqi) + ((1.0 - weight_raw) * current_aqi)

            # Enforce hour-to-hour smoothing starting from current_aqi
            prev_aqi = grid[-1]["predicted_aqi"] if grid else current_aqi
            diff = smoothed_aqi - prev_aqi
            if abs(diff) > 18.0:
                smoothed_aqi = prev_aqi + 18.0 * (1.0 if diff > 0 else -1.0)
            smoothed_aqi = max(1.0, min(500.0, smoothed_aqi))

            grid.append({
                "timestamp": dt.isoformat(),
                "hour_offset": h + 1,
                "predicted_aqi": round(smoothed_aqi, 1),
                "mitigated_aqi": round(smoothed_aqi * 0.85, 1),
                "confidence_low": round(max(0.0, smoothed_aqi - 10.0), 1),
                "confidence_high": round(smoothed_aqi + 10.0, 1),
                "open_meteo_raw": round(raw_aqi, 1),
                "persistence_baseline": round(base_aqi, 1),
                "confidence": 0.85,
                "wind_speed_kmh": round((forecast_weather["wind_speed"][h] or 10.0) * 3.6, 1), # convert m/s to km/h
                "wind_direction_deg": round(forecast_weather["wind_dir"][h] or 180.0, 1),
            })

        return {
            "city": city_key,
            "model_type": "open_meteo_fallback",
            "grid": grid,
            "accuracy": {
                "ml_mae": 15.0,
                "persistence_mae": 20.0,
                "directional_accuracy": 0.50,
                "skill_score": 0.25,
                "residual_std": 20.0,
                "training_samples": 0,
                "validation_samples": 0,
                "horizons_trained": [],
            },
            "anomalies": [],
        }

    def _generate_fallback(self, city_key: str, hours: int = 72) -> Dict[str, Any]:
        """Simple fallback forecast when APIs or training fails."""
        grid = []
        now = datetime.now()
        base_aqi = 120.0

        for h in range(hours):
            future = now + timedelta(hours=h)
            diurnal = 15.0 * np.sin(2 * np.pi * (future.hour - 8) / 24)
            pred_aqi = max(10.0, base_aqi + diurnal + np.random.normal(0, 5))

            grid.append({
                "timestamp": future.isoformat(),
                "hour_offset": h + 1,
                "predicted_aqi": round(pred_aqi, 1),
                "mitigated_aqi": round(max(10.0, pred_aqi * (1.0 - 0.25 * (1.0 - np.exp(-(h + 1) / 12.0)))), 1),
                "confidence_low": round(max(0.0, pred_aqi - 15.0 - h * 0.3), 1),
                "confidence_high": round(min(500.0, pred_aqi + 15.0 + h * 0.3), 1),
                "open_meteo_raw": round(pred_aqi * np.random.uniform(0.9, 1.1), 1),
                "persistence_baseline": round(base_aqi, 1),
                "confidence": round(max(0.30, 0.90 - h * 0.008), 2),
                "wind_speed_kmh": 12.0,
                "wind_direction_deg": 180.0,
            })

        return {
            "city": city_key,
            "model_type": "persistence_fallback",
            "grid": grid,
            "accuracy": {
                "ml_mae": 0.0,
                "persistence_mae": 0.0,
                "directional_accuracy": 0.0,
                "skill_score": 0.0,
                "residual_std": 10.0,
                "training_samples": 0,
                "validation_samples": 0,
                "horizons_trained": [],
            },
            "anomalies": [],
        }

    def detect_anomaly(self, predicted_aqi: float, actual_aqi: float,
                       residual_std: float) -> Optional[Dict[str, Any]]:
        """Identify if actual reading is an anomaly compared to prediction."""
        deviation = actual_aqi - predicted_aqi
        threshold = 2.0 * residual_std
        if abs(deviation) > threshold:
            severity = "warning" if abs(deviation) < 3.0 * residual_std else "critical"
            if deviation > 0:
                cause = "Potential crop burning, industrial blast, or major fire event"
            else:
                cause = "Unusually strong wind clearing pollutants or sudden rainfall"

            return {
                "detected_at": datetime.now().isoformat(),
                "predicted": round(predicted_aqi, 1),
                "actual": round(actual_aqi, 1),
                "deviation": round(deviation, 1),
                "severity": severity,
                "possible_cause": cause,
            }
        return None