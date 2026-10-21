import asyncio
import logging
from typing import Any
from fastapi import APIRouter, Query

from redis_client import cache_get_json, cache_set_json
from simulation import sim, CITIES, DEFAULT_CITY, LIVE_CITIES
from singletons import forecaster

router = APIRouter()
_FORECAST_IN_FLIGHT: dict[str, asyncio.Task] = {}


async def _get_cached_forecast(key: str, fresh: bool = False):
    if fresh:
        return None
    cached = await cache_get_json(f"forecast:{key}")
    if cached is not None:
        return cached
    return None


async def _set_cached_forecast(key: str, payload: Any):
    await cache_set_json(f"forecast:{key}", payload, 240)


@router.get("/api/forecast")
async def get_forecast(
    city: str = Query(default=DEFAULT_CITY),
    hours: int = Query(default=24, ge=1, le=72),
    fresh: bool = Query(default=False),
):
    # Redis is optional, so coalesce the whole route locally as well as the
    # simulation provider fetch. This prevents duplicate ML inference and
    # smoothing work when several clients refresh at the same time.
    request_key = f"{city}:{hours}:{'fresh' if fresh else 'cached'}"
    in_flight = _FORECAST_IN_FLIGHT.get(request_key)
    if in_flight is not None:
        return await asyncio.shield(in_flight)
    task = asyncio.create_task(_build_forecast(city, hours, fresh))
    _FORECAST_IN_FLIGHT[request_key] = task
    try:
        return await asyncio.shield(task)
    finally:
        if _FORECAST_IN_FLIGHT.get(request_key) is task:
            _FORECAST_IN_FLIGHT.pop(request_key, None)


async def _build_forecast(city: str, hours: int, fresh: bool):
    """Return ward-level AQI forecast grid using real Open-Meteo forecast data with ML predictions."""
    cache_key = f"{city}:{hours}"
    cached = await _get_cached_forecast(cache_key, fresh)
    if cached is not None:
        return cached

    # 1. Fetch raw forecast grid for all cities
    raw_forecast = await sim.generate_forecast(city, hours, force_refresh=fresh)

    # 2. Build the list of cities to generate ML forecasts for.
    if city == "all":
        cities_to_process = [k for k in LIVE_CITIES if "_" not in k and k in CITIES]
    else:
        cities_to_process = [city] if city in CITIES else []

    if not cities_to_process:
        return raw_forecast

    # Generate ML forecasts in parallel
    ml_forecasts = {}
    tasks = {c: forecaster.generate_ml_forecast(c, hours) for c in cities_to_process}
    results = await asyncio.gather(*tasks.values(), return_exceptions=True)

    for c, res in zip(tasks.keys(), results):
        if isinstance(res, Exception):
            logging.getLogger("main").error(f"Error generating ML forecast for {c}: {res}")
            continue
        ml_forecasts[c] = res

    # Fetch current readings to detect if there is any anomaly right now
    try:
        current_readings = await sim.generate_readings("all")
        current_readings_map = {r["ward_id"]: r.get("aqi_in", r["aqi"]) for r in current_readings}
    except Exception:
        current_readings_map = {}

    # Run anomaly detection for each city
    for w_id, ml_f in ml_forecasts.items():
        actual_now = current_readings_map.get(w_id)
        if actual_now is not None and ml_f["grid"]:
            predicted_now = ml_f["grid"][0]["predicted_aqi"]
            res_std = ml_f["accuracy"]["residual_std"]
            anomaly = forecaster.detect_anomaly(predicted_now, actual_now, res_std)
            if anomaly:
                ml_f["anomalies"].append(anomaly)

    # Merge ML forecasts into the raw forecast structure
    for entry in raw_forecast:
        h_offset = entry["hour_offset"]
        h_idx = h_offset - 1

        for w in entry.get("wards", []):
            w_id = w["ward_id"]

            lookup_key = w_id
            if w_id not in ml_forecasts:
                parent_key = w_id.split("_")[0]
                if parent_key in ml_forecasts:
                    lookup_key = parent_key
                else:
                    continue

            ml_f = ml_forecasts[lookup_key]
            grid_len = len(ml_f["grid"])
            if h_idx < grid_len:
                ml_hour_data = ml_f["grid"][h_idx]

                own_open_meteo_raw = w.get("predicted_aqi", ml_hour_data["open_meteo_raw"])

                if w_id != lookup_key and ml_hour_data.get("open_meteo_raw", 0) > 0:
                    scale = own_open_meteo_raw / ml_hour_data["open_meteo_raw"]
                    scale = max(0.7, min(1.4, scale))
                    scaled_aqi = max(1.0, min(round(ml_hour_data["predicted_aqi"] * scale, 1), 500.0))
                    scaled_mitigated = max(1.0, min(round(ml_hour_data.get("mitigated_aqi", ml_hour_data["predicted_aqi"]) * scale, 1), 500.0))
                    scaled_low = max(1.0, min(round(ml_hour_data["confidence_low"] * scale, 1), 500.0))
                    scaled_high = max(1.0, min(round(ml_hour_data["confidence_high"] * scale, 1), 500.0))
                else:
                    scaled_aqi = max(1.0, min(ml_hour_data["predicted_aqi"], 500.0))
                    scaled_mitigated = max(1.0, min(ml_hour_data.get("mitigated_aqi", ml_hour_data["predicted_aqi"]), 500.0))
                    scaled_low = max(1.0, min(ml_hour_data["confidence_low"], 500.0))
                    scaled_high = max(1.0, min(ml_hour_data["confidence_high"], 500.0))

                w["predicted_aqi"] = scaled_aqi
                w["mitigated_aqi"] = scaled_mitigated
                w["confidence"] = ml_hour_data["confidence"]
                w["confidence_low"] = scaled_low
                w["confidence_high"] = scaled_high
                w["open_meteo_raw"] = round(own_open_meteo_raw, 1)
                w["persistence_baseline"] = ml_hour_data["persistence_baseline"]

                w["accuracy"] = ml_f["accuracy"]
                w["anomalies"] = ml_f["anomalies"]
                w["model_type"] = ml_f["model_type"]

        # Final Smoothing Pass
        try:
            live_readings = await sim.generate_readings(city)
            live_map = {r.get("ward_id"): float(r.get("aqi_in", r.get("aqi", 25.0))) for r in live_readings if isinstance(r, dict)}

            ward_history = {}
            MAX_STEP = 15.0
            for entry in raw_forecast:
                for w in entry.get("wards", []):
                    wid = w.get("ward_id")
                    if not wid:
                        continue
                    live_val = live_map.get(wid, w.get("predicted_aqi", 25.0))
                    prev = ward_history.get(wid, live_val)
                    curr = w.get("predicted_aqi", prev)
                    diff = curr - prev
                    if abs(diff) > MAX_STEP:
                        curr = prev + MAX_STEP * (1.0 if diff > 0 else -1.0)
                    curr = max(1.0, min(500.0, curr))
                    w["predicted_aqi"] = round(curr, 1)
                    ward_history[wid] = curr
        except Exception:
            pass

    await _set_cached_forecast(cache_key, raw_forecast)
    return raw_forecast
