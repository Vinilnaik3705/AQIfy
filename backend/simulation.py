"""
Spatial Data Engine — Multi-City Real AQI Integration
=======================================================
Fetches REAL air quality data from the free Open-Meteo Air Quality API.
Supports multiple Indian cities with real ward coordinates.
Falls back to estimation only when the API is unreachable.
"""

from __future__ import annotations

import os
import sys
import asyncio
import math
import random
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx

# ── Windows-safe console output ────────────────────────────────────────────
# Open-Meteo / WAQI / OpenAQ responses (and CPCB unit labels like "\u00b5g/m\u00b3")
# routinely contain non-ASCII characters. On Windows the default console/log
# stream encoding is often cp1252 or cp437, neither of which can encode the
# micro sign, so a bare print()/logging call raises UnicodeEncodeError. That
# exception was propagating out of the historical-data fetch and being caught
# by the outer except block, which is why training silently failed for cities
# whose station/unit metadata included that character. Force UTF-8 with a
# safe fallback so console output can never crash the fetch pipeline again.
for _stream_name in ("stdout", "stderr"):
    _stream = getattr(sys, _stream_name, None)
    if _stream is not None and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def safe_print(*args, **kwargs) -> None:
    """print() that can never raise UnicodeEncodeError, even on a
    misconfigured/legacy console encoding. Falls back to ASCII with
    escaped replacements if UTF-8 output still somehow fails."""
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        safe_args = [
            a.encode("ascii", errors="backslashreplace").decode("ascii")
            if isinstance(a, str) else a
            for a in args
        ]
        print(*safe_args, **kwargs)


HTTP_CLIENT = httpx.AsyncClient(timeout=12.0)

# ── Multi-City Configuration ──────────────────────────────────────────────────
# Each city has real ward/locality coordinates and known emission sources.

CITIES: Dict[str, Dict[str, Any]] = {
    # India - Key Cities & State Capitals
    "delhi": {"name": "Delhi", "state": "Delhi", "country": "India", "center": [28.6139, 77.2090]},
    "mumbai": {"name": "Mumbai", "state": "Maharashtra", "country": "India", "center": [19.0760, 72.8777]},
    "kolkata": {"name": "Kolkata", "state": "West Bengal", "country": "India", "center": [22.5726, 88.3639]},
    "bengaluru": {"name": "Bengaluru", "state": "Karnataka", "country": "India", "center": [12.9716, 77.5946]},
    "chennai": {"name": "Chennai", "state": "Tamil Nadu", "country": "India", "center": [13.0827, 80.2707]},
    "hyderabad": {"name": "Hyderabad", "state": "Telangana", "country": "India", "center": [17.3850, 78.4867]},
    "pune": {"name": "Pune", "state": "Maharashtra", "country": "India", "center": [18.5204, 73.8567]},
    "ahmedabad": {"name": "Ahmedabad", "state": "Gujarat", "country": "India", "center": [23.0225, 72.5714]},
    "jaipur": {"name": "Jaipur", "state": "Rajasthan", "country": "India", "center": [26.9124, 75.7873]},
    "lucknow": {"name": "Lucknow", "state": "Uttar Pradesh", "country": "India", "center": [26.8467, 80.9462]},
    "kanpur": {"name": "Kanpur", "state": "Uttar Pradesh", "country": "India", "center": [26.4499, 80.3319]},
    "patna": {"name": "Patna", "state": "Bihar", "country": "India", "center": [25.5941, 85.1376]},
    "bhopal": {"name": "Bhopal", "state": "Madhya Pradesh", "country": "India", "center": [23.2599, 77.4126]},
    "indore": {"name": "Indore", "state": "Madhya Pradesh", "country": "India", "center": [22.7196, 75.8577]},
    "chandigarh": {"name": "Chandigarh", "state": "Punjab & Haryana", "country": "India", "center": [30.7333, 76.7794]},
    "srinagar": {"name": "Srinagar", "state": "Jammu & Kashmir", "country": "India", "center": [34.0837, 74.7973]},
    "shimla": {"name": "Shimla", "state": "Himachal Pradesh", "country": "India", "center": [31.1048, 77.1734]},
    "dehradun": {"name": "Dehradun", "state": "Uttarakhand", "country": "India", "center": [30.3165, 78.0322]},
    "ranchi": {"name": "Ranchi", "state": "Jharkhand", "country": "India", "center": [23.3441, 85.3096]},
    "raipur": {"name": "Raipur", "state": "Chhattisgarh", "country": "India", "center": [21.2514, 81.6296]},
    "bhubaneswar": {"name": "Bhubaneswar", "state": "Odisha", "country": "India", "center": [20.2961, 85.8245]},
    "guwahati": {"name": "Guwahati", "state": "Assam", "country": "India", "center": [26.1445, 91.7362]},
    "panaji": {"name": "Panaji", "state": "Goa", "country": "India", "center": [15.4909, 73.8278]},
    "trivandrum": {"name": "Trivandrum", "state": "Kerala", "country": "India", "center": [8.5241, 76.9366]},
    "kochi": {"name": "Kochi", "state": "Kerala", "country": "India", "center": [9.9312, 76.2673]},
    "coimbatore": {"name": "Coimbatore", "state": "Tamil Nadu", "country": "India", "center": [11.0168, 76.9558]},
    "visakhapatnam": {"name": "Visakhapatnam", "state": "Andhra Pradesh", "country": "India", "center": [17.6868, 83.2185]},
    "nagpur": {"name": "Nagpur", "state": "Maharashtra", "country": "India", "center": [21.1458, 79.0882]},
    "surat": {"name": "Surat", "state": "Gujarat", "country": "India", "center": [21.1702, 72.8311]},
    "amritsar": {"name": "Amritsar", "state": "Punjab", "country": "India", "center": [31.6340, 74.8723]},
    "agra": {"name": "Agra", "state": "Uttar Pradesh", "country": "India", "center": [27.1767, 78.0081]},
    "varanasi": {"name": "Varanasi", "state": "Uttar Pradesh", "country": "India", "center": [25.3176, 82.9739]},
    "gurugram": {"name": "Gurugram", "state": "Haryana", "country": "India", "center": [28.4595, 77.0266]},
    "noida": {"name": "Noida", "state": "Uttar Pradesh", "country": "India", "center": [28.5355, 77.3910]},
    "mysore": {"name": "Mysore", "state": "Karnataka", "country": "India", "center": [12.2958, 76.6394]},
    "jodhpur": {"name": "Jodhpur", "state": "Rajasthan", "country": "India", "center": [26.2389, 73.0243]},
    # ── Delhi Wards (sub-localities) ─────────────────────────────────────
    "delhi_connaught": {"name": "Connaught Place", "state": "Delhi", "country": "India", "center": [28.6315, 77.2167], "parent": "delhi"},
    "delhi_rohini": {"name": "Rohini", "state": "Delhi", "country": "India", "center": [28.7390, 77.1100], "parent": "delhi"},
    "delhi_dwarka": {"name": "Dwarka", "state": "Delhi", "country": "India", "center": [28.5823, 77.0459], "parent": "delhi"},
    "delhi_shahdara": {"name": "Shahdara", "state": "Delhi", "country": "India", "center": [28.6730, 77.2787], "parent": "delhi"},
    "delhi_anandvihar": {"name": "Anand Vihar", "state": "Delhi", "country": "India", "center": [28.6469, 77.3160], "parent": "delhi"},
    "delhi_nehruplace": {"name": "Nehru Place", "state": "Delhi", "country": "India", "center": [28.5491, 77.2513], "parent": "delhi"},
    "delhi_janakpuri": {"name": "Janakpuri", "state": "Delhi", "country": "India", "center": [28.6219, 77.0878], "parent": "delhi"},
    "delhi_kashmirigate": {"name": "Kashmiri Gate", "state": "Delhi", "country": "India", "center": [28.6663, 77.2279], "parent": "delhi"},
    "delhi_okhla": {"name": "Okhla Industrial Area", "state": "Delhi", "country": "India", "center": [28.5355, 77.2641], "parent": "delhi"},
    "delhi_wazirpur": {"name": "Wazirpur Industrial Area", "state": "Delhi", "country": "India", "center": [28.6990, 77.1650], "parent": "delhi"},

    # ── Mumbai Wards ──────────────────────────────────────────────────────
    "mumbai_bandra": {"name": "Bandra", "state": "Maharashtra", "country": "India", "center": [19.0596, 72.8295], "parent": "mumbai"},
    "mumbai_andheri": {"name": "Andheri", "state": "Maharashtra", "country": "India", "center": [19.1197, 72.8468], "parent": "mumbai"},
    "mumbai_kurla": {"name": "Kurla", "state": "Maharashtra", "country": "India", "center": [19.0726, 72.8797], "parent": "mumbai"},
    "mumbai_chembur": {"name": "Chembur", "state": "Maharashtra", "country": "India", "center": [19.0622, 72.8993], "parent": "mumbai"},
    "mumbai_colaba": {"name": "Colaba", "state": "Maharashtra", "country": "India", "center": [18.9067, 72.8147], "parent": "mumbai"},
    "mumbai_borivali": {"name": "Borivali", "state": "Maharashtra", "country": "India", "center": [19.2288, 72.8554], "parent": "mumbai"},
    "mumbai_worli": {"name": "Worli", "state": "Maharashtra", "country": "India", "center": [19.0096, 72.8176], "parent": "mumbai"},

    # ── Bengaluru Wards ───────────────────────────────────────────────────
    "bengaluru_koramangala": {"name": "Koramangala", "state": "Karnataka", "country": "India", "center": [12.9352, 77.6245], "parent": "bengaluru"},
    "bengaluru_whitefield": {"name": "Whitefield", "state": "Karnataka", "country": "India", "center": [12.9698, 77.7500], "parent": "bengaluru"},
    "bengaluru_yelahanka": {"name": "Yelahanka", "state": "Karnataka", "country": "India", "center": [13.1007, 77.5963], "parent": "bengaluru"},
    "bengaluru_btm": {"name": "BTM Layout", "state": "Karnataka", "country": "India", "center": [12.9166, 77.6101], "parent": "bengaluru"},
    "bengaluru_hebbal": {"name": "Hebbal", "state": "Karnataka", "country": "India", "center": [13.0354, 77.5910], "parent": "bengaluru"},
    "bengaluru_jayanagar": {"name": "Jayanagar", "state": "Karnataka", "country": "India", "center": [12.9308, 77.5832], "parent": "bengaluru"},

    # ── Chennai Wards ─────────────────────────────────────────────────────
    "chennai_adyar": {"name": "Adyar", "state": "Tamil Nadu", "country": "India", "center": [13.0012, 80.2565], "parent": "chennai"},
    "chennai_aminjikarai": {"name": "Aminjikarai", "state": "Tamil Nadu", "country": "India", "center": [13.0827, 80.2166], "parent": "chennai"},
    "chennai_manali": {"name": "Manali Industrial Area", "state": "Tamil Nadu", "country": "India", "center": [13.1659, 80.2632], "parent": "chennai"},
    "chennai_nungambakkam": {"name": "Nungambakkam", "state": "Tamil Nadu", "country": "India", "center": [13.0605, 80.2422], "parent": "chennai"},
    "chennai_velachery": {"name": "Velachery", "state": "Tamil Nadu", "country": "India", "center": [12.9815, 80.2180], "parent": "chennai"},

    # ── Hyderabad Wards ───────────────────────────────────────────────────
    "hyderabad_hitech": {"name": "HITEC City", "state": "Telangana", "country": "India", "center": [17.4435, 78.3772], "parent": "hyderabad"},
    "hyderabad_secunderabad": {"name": "Secunderabad", "state": "Telangana", "country": "India", "center": [17.4399, 78.4983], "parent": "hyderabad"},
    "hyderabad_oldcity": {"name": "Old City / Charminar", "state": "Telangana", "country": "India", "center": [17.3616, 78.4747], "parent": "hyderabad"},
    "hyderabad_kukatpally": {"name": "Kukatpally", "state": "Telangana", "country": "India", "center": [17.4849, 78.3961], "parent": "hyderabad"},
    "hyderabad_lb_nagar": {"name": "LB Nagar", "state": "Telangana", "country": "India", "center": [17.3469, 78.5518], "parent": "hyderabad"},

    # ── Kolkata Wards ─────────────────────────────────────────────────────
    "kolkata_howrah": {"name": "Howrah", "state": "West Bengal", "country": "India", "center": [22.5958, 88.2636], "parent": "kolkata"},
    "kolkata_dumdum": {"name": "Dum Dum", "state": "West Bengal", "country": "India", "center": [22.6427, 88.4032], "parent": "kolkata"},
    "kolkata_newmarket": {"name": "New Market Area", "state": "West Bengal", "country": "India", "center": [22.5726, 88.3518], "parent": "kolkata"},
    "kolkata_salt_lake": {"name": "Salt Lake (Bidhannagar)", "state": "West Bengal", "country": "India", "center": [22.5869, 88.4197], "parent": "kolkata"},
    "kolkata_jadavpur": {"name": "Jadavpur", "state": "West Bengal", "country": "India", "center": [22.4993, 88.3706], "parent": "kolkata"},

}

DEFAULT_CITY = "delhi"


# ── Sensor Generation ─────────────────────────────────────────────────────────
# Exactly 1 sensor per ward/monitoring station named directly after the station.

def _build_sensors(wards: List[Dict]) -> List[Dict[str, Any]]:
    sensors = []
    for ward in wards:
        sensors.append({
            "id": f"CAAQMS-{ward['id']}",
            "ward_id": ward["id"],
            "location": ward["center"],
            "status": "online",
        })
    return sensors

def _calculate_sub_index(val: float, breakpoints: List[tuple]) -> float:
    """Map a pollutant concentration to its AQI sub-index.

    The breakpoint tables use continuous ranges (no gaps). For any value
    within the defined concentration span, the first range whose upper
    bound covers the value is selected. Values above the highest range
    are capped at the maximum AQI (500).
    """
    if val <= 0:
        return 0.0
    for (b_low, b_high, i_low, i_high) in breakpoints:
        if val <= b_high:
            # Clamp val to b_low in case of minor float undershoot
            clamped = max(val, b_low)
            return i_low + (clamped - b_low) * (i_high - i_low) / max(0.001, b_high - b_low)
    # Above all defined ranges — genuinely extreme concentration
    if breakpoints:
        return breakpoints[-1][3]
    return 0.0

def calibrate_india_pollutants(pm25_raw: float, pm10_raw: float, no2_raw: float,
                                so2_raw: float, co_raw: float, o3_raw: float,
                                co_already_mg: bool = False) -> Dict[str, float]:
    """Single source of truth for converting raw Open-Meteo CAMS model output into
    India-calibrated pollutant concentrations before they go into calculate_indian_aqi().

    This MUST be called identically everywhere a raw Open-Meteo reading is turned into
    an AQI (current readings, "all cities" batch fetch, and forecast horizons). Previously
    this logic was hand-duplicated in three places in this file and was MISSING entirely
    from forecaster.py's forecast blend -- meaning "now" was calibrated but "+1h onward"
    was not, which produced an artificial jump/runaway climb in every forecast curve.

    PM10 cap: north Indian cities (Delhi, Jaipur, Lucknow, Amritsar, etc.) are dust-heavy
    and legitimately run PM10/PM2.5 ratios of 2.5-3.5x. The old cap of 2.0x was silently
    discarding real PM10 signal specifically in the region where PM10 is the dominant
    AQI-driving pollutant, which is why northern cities under-reported vs. real ground
    stations while southern/coastal cities (lower PM10:PM2.5 ratio) looked fine. Raised to
    3.5x so genuine dust events aren't clipped away.
    """
    no2 = (no2_raw or 0.0) * 0.5
    so2 = (so2_raw or 0.0) * 0.2
    o3 = (o3_raw or 0.0) * 0.35
    co = (co_raw or 0.0) if co_already_mg else (co_raw or 0.0) / 1000.0

    pm25_raw = pm25_raw or 0.0
    pm10_raw = pm10_raw or 0.0
    if pm25_raw > 30.0:
        pm25_cal = 30.0 + (pm25_raw - 30.0) * 0.70
    else:
        pm25_cal = pm25_raw
    pm10_cal = min(pm10_raw, pm25_cal * 2.5)

    return {"pm25": pm25_cal, "pm10": pm10_cal, "no2": no2, "so2": so2, "co": co, "o3": o3}


def calculate_indian_aqi(pm25: float, pm10: float, no2: float, so2: float, co: float, o3: float) -> float:
    """Calculate the Indian National Air Quality Index (NAQI) using official CPCB breakpoints.

    Reference: Central Pollution Control Board (CPCB) National Air Quality Index,
    as used by aqi.in, SAFAR, and all Indian monitoring stations.

    Units expected:
      pm25, pm10 → µg/m³
      no2, so2, o3 → µg/m³
      co → mg/m³
    """
    # Official CPCB NAQI breakpoints — made CONTINUOUS (no gaps between ranges).
    # The original CPCB spec uses integer boundaries with 1-unit gaps (e.g.
    # PM2.5 Good=0-30, Satisfactory=31-60). Those gaps cause any float value
    # like 30.5 to fall through _calculate_sub_index and return 500 — which
    # is exactly why random cities were showing AQI=500 whenever their
    # calibrated concentrations landed on a fractional boundary value.
    # Format: (conc_lo, conc_hi, aqi_lo, aqi_hi)
    pm25_bp = [
        (0, 30, 0, 50),        # Good
        (30, 60, 50, 100),     # Satisfactory
        (60, 90, 100, 200),    # Moderate
        (90, 120, 200, 300),   # Poor
        (120, 250, 300, 400),  # Very Poor
        (250, 500, 400, 500),  # Severe
    ]
    pm10_bp = [
        (0, 50, 0, 50),
        (50, 100, 50, 100),
        (100, 250, 100, 200),
        (250, 350, 200, 300),
        (350, 430, 300, 400),
        (430, 600, 400, 500),
    ]
    # NO2 in µg/m³ (no conversion needed for Indian standard)
    no2_bp = [
        (0, 40, 0, 50),
        (40, 80, 50, 100),
        (80, 180, 100, 200),
        (180, 280, 200, 300),
        (280, 400, 300, 400),
        (400, 800, 400, 500),
    ]
    # SO2 in µg/m³
    so2_bp = [
        (0, 40, 0, 50),
        (40, 80, 50, 100),
        (80, 380, 100, 200),
        (380, 800, 200, 300),
        (800, 1600, 300, 400),
        (1600, 3200, 400, 500),
    ]
    # CO in mg/m³
    co_bp = [
        (0, 1.0, 0, 50),
        (1.0, 2.0, 50, 100),
        (2.0, 10, 100, 200),
        (10, 17, 200, 300),
        (17, 34, 300, 400),
        (34, 70, 400, 500),
    ]
    # O3 in µg/m³
    o3_bp = [
        (0, 50, 0, 50),
        (50, 100, 50, 100),
        (100, 168, 100, 200),
        (168, 208, 200, 300),
        (208, 748, 300, 400),
        (748, 1500, 400, 500),
    ]

    indices = []
    if pm25 > 0:
        indices.append(_calculate_sub_index(pm25, pm25_bp))
    if pm10 > 0:
        indices.append(_calculate_sub_index(pm10, pm10_bp))
    if no2 > 0:
        indices.append(_calculate_sub_index(no2, no2_bp))
    if so2 > 0:
        indices.append(_calculate_sub_index(so2, so2_bp))
    if co > 0:
        indices.append(_calculate_sub_index(co, co_bp))
    if o3 > 0:
        indices.append(_calculate_sub_index(o3, o3_bp))

    return max(indices) if indices else 0.0


def is_in_india(lat: float, lng: float) -> bool:
    """Helper to detect if coordinates fall roughly inside India."""
    return 8.0 <= lat <= 38.0 and 68.0 <= lng <= 98.0








LIVE_CITIES = {
    # Metros & major cities — all get direct live API calls
    "delhi", "mumbai", "kolkata", "bengaluru", "chennai", "hyderabad",
    "pune", "ahmedabad", "jaipur", "lucknow", "kanpur", "patna",
    "bhopal", "indore", "chandigarh", "srinagar", "shimla", "dehradun",
    "ranchi", "raipur", "bhubaneswar", "guwahati", "panaji",
    "trivandrum", "kochi", "coimbatore", "visakhapatnam",
    "nagpur", "surat", "amritsar", "agra", "varanasi",
    "gurugram", "noida", "mysore", "jodhpur",
    # Delhi wards
    "delhi_connaught", "delhi_rohini", "delhi_dwarka", "delhi_shahdara",
    "delhi_anandvihar", "delhi_nehruplace", "delhi_janakpuri",
    "delhi_kashmirigate", "delhi_okhla", "delhi_wazirpur",
    # Mumbai wards
    "mumbai_bandra", "mumbai_andheri", "mumbai_kurla", "mumbai_chembur",
    "mumbai_colaba", "mumbai_borivali", "mumbai_worli",
    # Bengaluru wards
    "bengaluru_koramangala", "bengaluru_whitefield", "bengaluru_yelahanka",
    "bengaluru_btm", "bengaluru_hebbal", "bengaluru_jayanagar",
    # Chennai wards
    "chennai_adyar", "chennai_aminjikarai", "chennai_manali",
    "chennai_nungambakkam", "chennai_velachery",
    # Hyderabad wards
    "hyderabad_hitech", "hyderabad_secunderabad", "hyderabad_oldcity",
    "hyderabad_kukatpally", "hyderabad_lb_nagar",
    # Kolkata wards
    "kolkata_howrah", "kolkata_dumdum", "kolkata_newmarket",
    "kolkata_salt_lake", "kolkata_jadavpur",
}


def get_nearest_live_city(lat: float, lng: float) -> str:
    """Find the key of the closest city in CITIES using Euclidean distance."""
    min_dist = float('inf')
    nearest = "delhi"
    for k, city in CITIES.items():
        clat, clng = city["center"]
        dist = (lat - clat)**2 + (lng - clng)**2
        if dist < min_dist:
            min_dist = dist
            nearest = k
    return nearest




# ── OpenWeatherMap Air Pollution API ─────────────────────────────────────────

def _get_openweather_key() -> Optional[str]:
    """Retrieve the OpenWeatherMap API key from the environment variables or the local .env file."""
    key = os.environ.get("OPENWEATHER_API_KEY")
    if key:
        return key
    try:
        env_path = os.path.join(os.path.dirname(__file__), ".env")
        if not os.path.exists(env_path):
            env_path = os.path.join(os.path.dirname(__file__), "../.env")
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith("OPENWEATHER_API_KEY="):
                        return line.strip().split("=", 1)[1].strip()
    except Exception:
        pass
    return None


async def _fetch_real_aqi_openweather(lat: float, lng: float) -> Optional[Dict[str, Any]]:
    """Fetch real-time air quality from OpenWeatherMap Air Pollution API."""
    key = _get_openweather_key()
    if not key:
        return None
    try:
        url = "http://api.openweathermap.org/data/2.5/air_pollution"
        resp = await HTTP_CLIENT.get(url, params={"lat": lat, "lon": lng, "appid": key})
        if resp.status_code == 200:
            data = resp.json()
            results = data.get("list", [])
            if results:
                    item = results[0]
                    components = item.get("components", {})
                    
                    pm25_raw = components.get("pm2_5", 0.0) or 0.0
                    pm10_raw = components.get("pm10", 0.0) or 0.0
                    # OpenWeather pollutant components are already provided in the units
                    # required by CPCB AQI calculation, except CO which must be converted
                    # from µg/m³ to mg/m³.
                    co = (components.get("co", 0.0) or 0.0) / 1000.0
                    no2 = components.get("no2", 0.0) or 0.0
                    so2 = components.get("so2", 0.0) or 0.0
                    o3 = components.get("o3", 0.0) or 0.0
                    pm25_cal = pm25_raw
                    pm10_cal = pm10_raw

                    if pm10_cal == 0.0 and pm25_cal > 0.0:
                        pm10_cal = pm25_cal * 1.8

                    aqi_in = calculate_indian_aqi(pm25_cal, pm10_cal, no2, so2, co, o3)
                    
                    return {
                        "aqi": round(aqi_in, 1),
                        "pm25": round(pm25_cal, 1),
                        "pm10": round(pm10_cal, 1),
                        "no2": round(no2, 1),
                        "so2": round(so2, 1),
                        "co": round(co, 2),
                        "o3": round(o3, 1),
                        "source": "open-weather (live)"
                    }
    except Exception as e:
        safe_print(f"OpenWeather fetch failed for ({lat:.4f},{lng:.4f}): {e}")
    return None


# ── WAQI API (Hugging Face / CPCB Ground Stations) ───────────────────────────

def _get_waqi_token() -> Optional[str]:
    """Retrieve the WAQI API token from the environment variables or the local .env file.

    Returns None if no real token is configured — deliberately NOT falling back
    to WAQI's public "demo" token. That token isn't a real per-coordinate
    lookup credential: WAQI restricts it to a small fixed set of sample
    stations, so every city query against it converges on the same (or
    near-same) canned reading regardless of the lat/lng you actually asked
    for. That's what was producing a map where almost every Indian city
    showed ~89 AQI — every request was silently hitting the demo response,
    not a real ground station. Returning None here means _fetch_real_aqi_waqi
    is skipped entirely and _fetch_real_aqi cleanly falls through to its next,
    genuinely per-location source (OpenWeatherMap, since OPENWEATHER_API_KEY
    is configured) instead of masking bad data as if it were live.

    To get real CPCB ground-station data (more accurate than any modeled
    fallback), sign up for a free personal token at https://aqicn.org/data-platform/token/
    and set it as WAQI_TOKEN.
    """
    token = os.environ.get("WAQI_TOKEN")
    if token:
        return token
    try:
        env_path = os.path.join(os.path.dirname(__file__), "../.env")
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith("WAQI_TOKEN="):
                        return line.strip().split("=", 1)[1].strip()
    except Exception:
        pass
    return None


def _usepa_aqi_to_concentration(aqi: float, bps: list) -> float:
    """Helper to convert US-EPA AQI sub-indices back to raw concentrations."""
    for conc_lo, conc_hi, aqi_lo, aqi_hi in bps:
        if aqi_lo <= aqi <= aqi_hi:
            if aqi_hi == aqi_lo:
                return conc_lo
            return conc_lo + (aqi - aqi_lo) * (conc_hi - conc_lo) / (aqi_hi - aqi_lo)
    # If no match found, return a reasonable default based on lowest breakpoint
    if bps:
        return bps[0][0]
    return 0.0


def _calculate_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


async def _fetch_real_aqi_waqi(lat: float, lng: float) -> Optional[Dict[str, Any]]:
    """Fetch real-time air quality from WAQI API using geo-based endpoint.
    
    Uses /feed/geo:lat;lng/ which finds the nearest real CPCB/WAQI monitoring
    station to the coordinates — much more reliable than city name lookup.
    """
    token = _get_waqi_token()
    if not token:
        return None
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            # Geo endpoint: finds nearest monitoring station to these coordinates
            url = f"https://api.waqi.info/feed/geo:{lat:.4f};{lng:.4f}/?token={token}"
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "ok":
                    aq_data = data.get("data", {})

                    # Reject data older than 12 hours (43200s) — handles timezone offsets safely
                    meas_time = aq_data.get("time", {}).get("v")
                    if meas_time:
                        import time as _time
                        current_ts = int(_time.time())
                        age_s = abs(current_ts - meas_time)
                        if age_s > 43200:
                            city_key = get_nearest_live_city(lat, lng)
                            safe_print(f"WAQI data for {city_key} is stale ({age_s}s old). Reverting to fallback.")
                            return None

                    # Reject if the nearest returned station is too far (> 50 km)
                    station_geo = aq_data.get("city", {}).get("geo")
                    if station_geo and len(station_geo) >= 2:
                        s_lat, s_lng = float(station_geo[0]), float(station_geo[1])
                        dist_km = _calculate_distance(lat, lng, s_lat, s_lng)
                        if dist_km > 50.0:
                            city_key = get_nearest_live_city(lat, lng)
                            city_info = CITIES.get(city_key)
                            resolved = False
                            if city_info:
                                city_name = city_info["name"]
                                search_url = f"https://api.waqi.info/search/?keyword={city_name}&token={token}"
                                try:
                                    search_resp = await client.get(search_url)
                                    if search_resp.status_code == 200:
                                        search_data = search_resp.json()
                                        stations = search_data.get("data", [])
                                        if stations:
                                            def station_distance(s):
                                                geo = (s.get("station") or {}).get("geo") or [9999.0, 9999.0]
                                                if len(geo) < 2:
                                                    geo = [9999.0, 9999.0]
                                                return (geo[0] - lat)**2 + (geo[1] - lng)**2
                                            
                                            closest = sorted(stations, key=station_distance)[0]
                                            c_geo = (closest.get("station") or {}).get("geo") or []
                                            if len(c_geo) >= 2:
                                                c_dist = _calculate_distance(lat, lng, c_geo[0], c_geo[1])
                                                if c_dist <= 50.0:
                                                    uid = closest.get("uid")
                                                    feed_url = f"https://api.waqi.info/feed/@{uid}/?token={token}"
                                                    feed_resp = await client.get(feed_url)
                                                    if feed_resp.status_code == 200:
                                                        feed_data = feed_resp.json()
                                                        if feed_data.get("status") == "ok":
                                                            aq_data = feed_data.get("data", {})
                                                            resolved = True
                                                            safe_print(f"WAQI resolved fallback search for {city_name}: closest station '{(closest.get('station') or {}).get('name')}' is {c_dist:.1f}km away.")
                                except Exception as e:
                                    safe_print(f"WAQI fallback search failed for {city_key}: {e}")
                            
                            if not resolved:
                                safe_print(f"WAQI nearest station for {city_key} is too far ({dist_km:.1f}km away). Reverting to fallback.")
                                return None

                    city_name = aq_data.get("city", {}).get("name", "WAQI Station")
                    iaqi = aq_data.get("iaqi", {})

                    # WAQI iaqi values are US-EPA AQI sub-indices — convert back to concentrations
                    pm25_aqi = iaqi.get("pm25", {}).get("v", 0.0) or 0.0
                    pm10_aqi = iaqi.get("pm10", {}).get("v", 0.0) or 0.0
                    no2_aqi  = iaqi.get("no2",  {}).get("v", 0.0) or 0.0
                    so2_aqi  = iaqi.get("so2",  {}).get("v", 0.0) or 0.0
                    co_aqi   = iaqi.get("co",   {}).get("v", 0.0) or 0.0
                    o3_aqi   = iaqi.get("o3",   {}).get("v", 0.0) or 0.0

                    # US-EPA breakpoints for reverse concentration lookup
                    PM25_BP = [(0.0,12.0,0,50),(12.1,35.4,51,100),(35.5,55.4,101,150),(55.5,150.4,151,200),(150.5,250.4,201,300),(250.5,350.4,301,400),(350.5,500.4,401,500)]
                    PM10_BP = [(0,54,0,50),(55,154,51,100),(155,254,101,150),(255,354,151,200),(355,424,201,300),(425,504,301,400),(505,604,401,500)]
                    NO2_BP  = [(0,53,0,50),(54,100,51,100),(101,360,101,150),(361,649,151,200),(650,1249,201,300)]
                    SO2_BP  = [(0,35,0,50),(36,75,51,100),(76,185,101,150),(186,304,151,200)]
                    CO_BP   = [(0.0,4.4,0,50),(4.5,9.4,51,100),(9.5,12.4,101,150),(12.5,15.4,151,200),(15.5,30.4,201,300)]
                    O3_BP   = [(0,54,0,50),(55,70,51,100),(71,85,101,150),(86,105,151,200),(106,200,201,300)]

                    pm25_ug = _usepa_aqi_to_concentration(pm25_aqi, PM25_BP)
                    pm10_ug = _usepa_aqi_to_concentration(pm10_aqi, PM10_BP)
                    no2_ug  = _usepa_aqi_to_concentration(no2_aqi,  NO2_BP) * 1.88 if no2_aqi > 0 else 0.0
                    so2_ug  = _usepa_aqi_to_concentration(so2_aqi,  SO2_BP) * 2.62 if so2_aqi > 0 else 0.0
                    o3_ug   = _usepa_aqi_to_concentration(o3_aqi,   O3_BP)  * 1.96 if o3_aqi  > 0 else 0.0
                    co_mg   = _usepa_aqi_to_concentration(co_aqi,   CO_BP)  * 1.145 if co_aqi > 0 else 0.0

                    aqi_in = calculate_indian_aqi(pm25_ug, pm10_ug, no2_ug, so2_ug, co_mg, o3_ug)

                    # Only return if we got meaningful PM data
                    if pm25_ug < 0.1 and pm10_ug < 0.1:
                        return None

                    return {
                        "aqi":    round(aqi_in, 1),
                        "pm25":   round(pm25_ug, 1),
                        "pm10":   round(pm10_ug, 1),
                        "no2":    round(no2_ug, 1),
                        "so2":    round(so2_ug, 1),
                        "co":     round(co_mg, 2),
                        "o3":     round(o3_ug, 1),
                        "source": "waqi-cpcb (live)",
                    }
    except Exception as e:
        safe_print("WAQI CPCB request failed:", e)
    return None


# ── Open-Meteo Air Quality API (FREE, no key) ────────────────────────────────

AQ_API_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"


def _get_openaq_key() -> Optional[str]:
    """Retrieve the OpenAQ API key from the environment variables or the local .env file."""
    key = os.environ.get("OPENAQ_API_KEY")
    if key:
        return key
    try:
        env_path = os.path.join(os.path.dirname(__file__), "../.env")
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith("OPENAQ_API_KEY="):
                        return line.strip().split("=", 1)[1].strip()
    except Exception:
        pass
    return "89ae0b63c71785a9e539f889c5f71034472844adfaf77457f3feded3efd2aff0"  # fallback key


def _get_weatherapi_key() -> Optional[str]:
    """Retrieve the WeatherAPI.com API key from the environment variables or the local .env file."""
    key = os.environ.get("WEATHERAPI_KEY")
    if key:
        return key
    try:
        env_path = os.path.join(os.path.dirname(__file__), ".env")
        if not os.path.exists(env_path):
            env_path = os.path.join(os.path.dirname(__file__), "../.env")
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith("WEATHERAPI_KEY="):
                        return line.strip().split("=", 1)[1].strip()
    except Exception:
        pass
    return None


def _us_aqi_to_pm25(aqi_val: float) -> float:
    """Reverse-map US AQI PM2.5 sub-index back to µg/m³ using EPA breakpoints.
    This gives a realistic PM2.5 concentration consistent with the AQI score."""
    bps = [
        (0, 50, 0.0, 12.0),
        (51, 100, 12.1, 35.4),
        (101, 150, 35.5, 55.4),
        (151, 200, 55.5, 150.4),
        (201, 300, 150.5, 250.4),
        (301, 500, 250.5, 500.4),
    ]
    aqi_val = max(0, min(aqi_val, 500))
    for alo, ahi, clo, chi in bps:
        if alo <= aqi_val <= ahi:
            return clo + (aqi_val - alo) * (chi - clo) / (ahi - alo)
    return 0.0


def _us_aqi_to_pm10(aqi_val: float) -> float:
    """Reverse-map US AQI PM10 sub-index back to µg/m³ using EPA breakpoints."""
    bps = [
        (0, 50, 0.0, 54.0),
        (51, 100, 55.0, 154.0),
        (101, 150, 155.0, 254.0),
        (151, 200, 255.0, 354.0),
        (201, 300, 355.0, 424.0),
        (301, 500, 425.0, 604.0),
    ]
    aqi_val = max(0, min(aqi_val, 500))
    for alo, ahi, clo, chi in bps:
        if alo <= aqi_val <= ahi:
            return clo + (aqi_val - alo) * (chi - clo) / (ahi - alo)
    return 0.0


async def _fetch_real_aqi(lat: float, lng: float) -> Optional[Dict[str, Any]]:
    """Fetch real-time air quality, prioritizing an actual CPCB ground monitoring
    station (via WAQI) over modeled/satellite estimates.

    Priority order (highest fidelity first):
      1. WAQI  — real CPCB (or co-located) ground station nearest to the coords.
                 This is genuine measured ground-truth data, which is what the
                 72-hour forecast must anchor to.
      2. OpenWeatherMap Air Pollution API — modeled estimate (fallback only).
      3. Open-Meteo CAMS Air Quality API — global model (fallback only).
      4. OpenAQ v3 — community/government sensor network (fallback only).
    """
    # 0. Attempt WAQI first — this is the real CPCB ground station reading.
    waqi_data = await _fetch_real_aqi_waqi(lat, lng)
    if waqi_data:
        return waqi_data

    # 1. Attempt Open-Meteo CAMS Air Quality API (fallback)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(AQ_API_URL, params={
                "latitude": lat,
                "longitude": lng,
                "current": "us_aqi,us_aqi_pm2_5,us_aqi_pm10,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone",
            })
            if resp.status_code == 200:
                data = resp.json().get("current", {})
                cal = calibrate_india_pollutants(
                    data.get("pm2_5", 0), data.get("pm10", 0),
                    data.get("nitrogen_dioxide", 0), data.get("sulphur_dioxide", 0),
                    data.get("carbon_monoxide", 0), data.get("ozone", 0),
                )
                aqi_val = calculate_indian_aqi(cal["pm25"], cal["pm10"], cal["no2"], cal["so2"], cal["co"], cal["o3"])
                return {
                    "aqi": round(aqi_val, 1),
                    "pm25": round(cal["pm25"], 1),
                    "pm10": round(cal["pm10"], 1),
                    "no2": round(cal["no2"], 1),
                    "so2": round(cal["so2"], 1),
                    "co": round(cal["co"], 2),
                    "o3": round(cal["o3"], 1),
                    "source": "open-meteo (live)",
                }
    except Exception as e:
        safe_print("Open-Meteo CAMS request failed, falling back to other APIs:", e)

    # 2. Attempt OpenWeatherMap (modeled estimate, used only if no live station nearby)
    owm_data = await _fetch_real_aqi_openweather(lat, lng)
    if owm_data:
        return owm_data

    # 2. Attempt OpenAQ v3
    api_key = _get_openaq_key()
    if api_key:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                # Query locations within 25km (max OpenAQ v3 radius is 25000m)
                loc_resp = await client.get(
                    "https://api.openaq.org/v3/locations",
                    params={"coordinates": f"{lat:.4f},{lng:.4f}", "radius": 25000},
                    headers={"X-API-Key": api_key}
                )

                if loc_resp.status_code == 200:
                    loc_data = loc_resp.json()
                    results = loc_data.get("results", [])
                    if results:
                        # Take the closest location
                        closest_loc = results[0]
                        loc_id = closest_loc["id"]
                        
                        # Build mapping from sensor id to parameter name
                        sensor_map = {}
                        for s in closest_loc.get("sensors", []):
                            param_name = s.get("parameter", {}).get("name", "").lower()
                            if param_name:
                                sensor_map[s["id"]] = param_name
                        
                        # Query latest values for this location
                        latest_resp = await client.get(
                            f"https://api.openaq.org/v3/locations/{loc_id}/latest",
                            headers={"X-API-Key": api_key}
                        )
                        if latest_resp.status_code == 200:
                            latest_data = latest_resp.json()
                            latest_results = latest_data.get("results", [])
                            
                            pollutants = {
                                "pm25": 0.0, "pm10": 0.0, "no2": 0.0,
                                "so2": 0.0, "co": 0.0, "o3": 0.0
                            }
                            has_measurements = False
                            
                            for m in latest_results:
                                s_id = m.get("sensorsId")
                                val = m.get("value")
                                if s_id in sensor_map and val is not None:
                                    # Check staleness (older than 24 hours)
                                    dt_utc = m.get("datetime", {}).get("utc")
                                    if dt_utc:
                                        try:
                                            dt = datetime.fromisoformat(dt_utc.replace("Z", "+00:00"))
                                            if (datetime.now(timezone.utc) - dt).total_seconds() > 86400:
                                                continue
                                        except Exception:
                                            continue
                                    param = sensor_map[s_id]
                                    # Normalize parameters
                                    if param == "pm25" or param == "pm2_5":
                                        pollutants["pm25"] = val
                                        has_measurements = True
                                    elif param == "pm10":
                                        pollutants["pm10"] = val
                                        has_measurements = True
                                    elif param == "no2":
                                        pollutants["no2"] = val
                                        has_measurements = True
                                    elif param == "so2":
                                        pollutants["so2"] = val
                                        has_measurements = True
                                    elif param == "co":
                                        pollutants["co"] = val
                                        has_measurements = True
                                    elif param == "o3":
                                        pollutants["o3"] = val
                                        has_measurements = True
                            
                            if has_measurements:
                                # Estimate missing PM values to prevent artificially low AQI
                                if pollutants["pm25"] > 0.0 and pollutants["pm10"] == 0.0:
                                    pollutants["pm10"] = pollutants["pm25"] * 1.8
                                elif pollutants["pm10"] > 0.0 and pollutants["pm25"] == 0.0:
                                    pollutants["pm25"] = pollutants["pm10"] * 0.55

                                # Standardize CO to mg/m3
                                if pollutants["co"] > 10.0:
                                    pollutants["co"] /= 1000.0
                                    
                                aqi_val = calculate_indian_aqi(
                                    pollutants["pm25"], pollutants["pm10"], pollutants["no2"],
                                    pollutants["so2"], pollutants["co"], pollutants["o3"]
                                )
                                return {
                                    "aqi": round(aqi_val, 1),
                                    "pm25": round(pollutants["pm25"], 1),
                                    "pm10": round(pollutants["pm10"], 1),
                                    "no2": round(pollutants["no2"], 1),
                                    "so2": round(pollutants["so2"], 1),
                                    "co": round(pollutants["co"], 2),
                                    "o3": round(pollutants["o3"], 1),
                                    "source": f"openaq-v3 (live, station: {closest_loc.get('name')})"
                                }
        except Exception as e:
            safe_print("OpenAQ v3 request failed, falling back to WAQI:", e)

    # 3. All live sources exhausted — caller falls back to model-derived AQI.
    return None


WEATHER_API_URL = "https://api.open-meteo.com/v1/forecast"


async def _fetch_live_weather(lat: float, lng: float) -> Optional[Dict[str, Any]]:
    """Fetch live weather from Open-Meteo Forecast API."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(WEATHER_API_URL, params={
                "latitude": lat,
                "longitude": lng,
                "current": "temperature_2m,wind_speed_10m,wind_direction_10m,relative_humidity_2m",
            })
            if resp.status_code == 200:
                data = resp.json().get("current", {})
                return {
                    "temperature_c": data.get("temperature_2m"),
                    "humidity_pct": data.get("relative_humidity_2m"),
                    "wind_speed_kmh": data.get("wind_speed_10m"),
                    "wind_direction_deg": data.get("wind_direction_10m"),
                    "source": "open-meteo (live)",
                }
    except Exception:
        pass
    return None


# ── AQI Forecast from Open-Meteo ─────────────────────────────────────────────

async def _fetch_real_forecast(lat: float, lng: float, hours: int = 72) -> Optional[List[Dict]]:
    """Fetch hourly AQI forecast from Open-Meteo Air Quality API."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(AQ_API_URL, params={
                "latitude": lat,
                "longitude": lng,
                "hourly": "pm2_5,pm10",
                "forecast_days": min(max(hours // 24, 1), 5),
            })
            if resp.status_code == 200:
                data = resp.json().get("hourly", {})
                times = data.get("time", [])
                pm25s = data.get("pm2_5", [])
                return [
                    {"timestamp": times[i], "aqi": pm25s[i] or 0}
                    for i in range(min(hours, len(times)))
                ]
    except Exception:
        pass
    return None


def get_sources_for_city(city_key: str) -> List[Dict[str, Any]]:
    # Resolve sub-locality key (e.g. "hyderabad_secunderabad") to parent city key
    lookup_key = city_key
    if "_" in city_key:
        lookup_key = city_key.split("_")[0]

    city = CITIES.get(lookup_key)
    if not city:
        return []
    lat, lng = city["center"]
    
    if lookup_key == "delhi":
        return [
            {"id": "delhi_stack_1", "name": "Okhla Thermal Stack", "category": "industrial", "location": [28.5355, 77.2639], "Q": 350.0, "H": 100.0},
            {"id": "delhi_stack_2", "name": "Wazirpur Industrial Area", "category": "industrial", "location": [28.6990, 77.1650], "Q": 220.0, "H": 80.0},
            {"id": "delhi_road_1", "name": "Outer Ring Road Corridor", "category": "vehicular", "location": [28.6200, 77.2100], "Q": 100.0, "H": 2.0},
            {"id": "delhi_fire_1", "name": "Satellite Fire Anomaly (MODIS)", "category": "waste_burning", "location": [28.6500, 77.1500], "Q": 150.0, "H": 0.0}
        ]
    elif lookup_key == "mumbai":
        return [
            {"id": "mumbai_stack_1", "name": "Trombay Refinery Stack", "category": "industrial", "location": [19.0025, 72.9150], "Q": 400.0, "H": 120.0},
            {"id": "mumbai_stack_2", "name": "Chembur Industrial Zone", "category": "industrial", "location": [19.0522, 72.8906], "Q": 250.0, "H": 75.0},
            {"id": "mumbai_fire_1", "name": "Deonar Dump Yard Fire (Satellite Detected)", "category": "waste_burning", "location": [19.0700, 72.9300], "Q": 200.0, "H": 0.0}
        ]
    elif lookup_key == "hyderabad":
        return [
            {"id": "hyd_stack_1", "name": "Jeedimetla Industrial Area Stack", "category": "industrial", "location": [17.5186, 78.4552], "Q": 300.0, "H": 80.0},
            {"id": "hyd_stack_2", "name": "Cherlapally Industrial Estate", "category": "industrial", "location": [17.4667, 78.6012], "Q": 210.0, "H": 70.0},
            {"id": "hyd_road_1", "name": "Secunderabad Railway Station Transit Corridor", "category": "vehicular", "location": [17.4347, 78.5015], "Q": 130.0, "H": 2.0},
            {"id": "hyd_road_2", "name": "Begumpet Airport Flyover Corridor", "category": "vehicular", "location": [17.4418, 78.4626], "Q": 95.0, "H": 2.0},
            {"id": "hyd_fire_1", "name": "Jawaharnagar Dump Yard Fire", "category": "waste_burning", "location": [17.5312, 78.5834], "Q": 180.0, "H": 0.0}
        ]
    elif lookup_key == "bengaluru":
        return [
            {"id": "blr_stack_1", "name": "Peenya Industrial Area Phase I-IV", "category": "industrial", "location": [13.0285, 77.5195], "Q": 280.0, "H": 75.0},
            {"id": "blr_road_1", "name": "KSR Bengaluru City Railway Station Corridor", "category": "vehicular", "location": [12.9782, 77.5695], "Q": 140.0, "H": 2.0},
            {"id": "blr_road_2", "name": "Silk Board Junction Transit Corridor", "category": "vehicular", "location": [12.9174, 77.6238], "Q": 150.0, "H": 2.0},
            {"id": "blr_fire_1", "name": "Mavallipura Landfill Smoldering Fire", "category": "waste_burning", "location": [13.1250, 77.5500], "Q": 120.0, "H": 0.0}
        ]
    elif lookup_key == "chennai":
        return [
            {"id": "chn_stack_1", "name": "Manali Petrochemical Stack", "category": "industrial", "location": [13.1700, 80.2600], "Q": 380.0, "H": 110.0},
            {"id": "chn_stack_2", "name": "Guindy Industrial Estate Phase II", "category": "industrial", "location": [13.0118, 80.2045], "Q": 180.0, "H": 65.0},
            {"id": "chn_road_1", "name": "Chennai Central Railway Station Junction", "category": "vehicular", "location": [13.0824, 80.2754], "Q": 145.0, "H": 2.0},
            {"id": "chn_fire_1", "name": "Perungudi Dump Site Satellite Thermal Anomaly", "category": "waste_burning", "location": [12.9550, 80.2350], "Q": 190.0, "H": 0.0}
        ]
    elif lookup_key == "kolkata":
        return [
            {"id": "kol_stack_1", "name": "Port Trust Industrial Stacks", "category": "industrial", "location": [22.5300, 88.3100], "Q": 290.0, "H": 85.0},
            {"id": "kol_road_1", "name": "Howrah Railway Station Bridge & Approach", "category": "vehicular", "location": [22.5833, 88.3414], "Q": 160.0, "H": 2.0},
            {"id": "kol_road_2", "name": "AJC Bose Road Transit Corridor", "category": "vehicular", "location": [22.5440, 88.3480], "Q": 110.0, "H": 2.0},
            {"id": "kol_fire_1", "name": "Dhapa Landfill Waste Burning Anomaly", "category": "waste_burning", "location": [22.5510, 88.4200], "Q": 170.0, "H": 0.0}
        ]
    else:
        # Generate diverse, city-specific emission sources using seeded randomization
        rng = random.Random(hash(city_key))
        sources = []
        state = city.get("state", "")

        # City type classification for realistic source mix
        industrial_states = {"Jharkhand", "Chhattisgarh", "Odisha", "West Bengal", "Gujarat"}
        metro_names = {"Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad",
                       "Pune", "Ahmedabad", "Jaipur", "Lucknow", "Chandigarh", "Surat", "Kochi"}
        construction_names = {"Noida", "Gurugram", "Ghaziabad", "Faridabad", "Pune",
                              "Bengaluru", "Hyderabad", "Ahmedabad", "Lucknow", "Indore"}
        crop_burn_states = {"Punjab", "Haryana", "Uttar Pradesh"}

        is_industrial = state in industrial_states or city["name"] in {
            "Kanpur", "Ludhiana", "Nagpur", "Bhopal", "Indore", "Surat", "Vadodara"}
        is_metro = city["name"] in metro_names
        is_construction = city["name"] in construction_names
        is_crop_zone = state in crop_burn_states

        # --- Industrial sources ---
        n_ind = rng.randint(1, 3) if is_industrial else rng.randint(0, 1)
        ind_names = [f"{city['name']} Thermal Power Station", f"{city['name']} Industrial Estate",
                     f"NTPC {city['name']}", f"{city['name']} Steel Plant",
                     f"{city['name']} Cement Works", f"{city['name']} Chemical Complex"]
        for i in range(n_ind):
            olat = rng.uniform(0.015, 0.06) * rng.choice([-1, 1])
            olng = rng.uniform(0.015, 0.06) * rng.choice([-1, 1])
            sources.append({
                "id": f"{city_key}_ind_{i}", "name": rng.choice(ind_names),
                "category": "industrial", "location": [lat + olat, lng + olng],
                "Q": round(rng.uniform(150, 400), 1), "H": round(rng.uniform(50, 120), 1),
            })

        # --- Vehicular traffic sources ---
        n_veh = rng.randint(2, 3) if is_metro else rng.randint(1, 2)
        veh_names = [f"{city['name']} Ring Road", f"NH Bypass ({city['name']})",
                     f"{city['name']} Bus Terminal Corridor", f"Old {city['name']} Market Road",
                     f"{city['name']} Railway Station Area", f"{city['name']} Main Highway"]
        for i in range(n_veh):
            olat = rng.uniform(0.005, 0.03) * rng.choice([-1, 1])
            olng = rng.uniform(0.005, 0.03) * rng.choice([-1, 1])
            sources.append({
                "id": f"{city_key}_veh_{i}", "name": rng.choice(veh_names),
                "category": "vehicular", "location": [lat + olat, lng + olng],
                "Q": round(rng.uniform(50, 150), 1), "H": 2.0,
            })

        # --- Construction sources ---
        n_con = rng.randint(1, 2) if is_construction else rng.randint(0, 1)
        con_names = [f"{city['name']} Metro Construction", f"{city['name']} Highway Expansion",
                     f"Smart City Project ({city['name']})", f"{city['name']} Flyover Construction",
                     f"{city['name']} Township Development"]
        for i in range(n_con):
            olat = rng.uniform(0.008, 0.04) * rng.choice([-1, 1])
            olng = rng.uniform(0.008, 0.04) * rng.choice([-1, 1])
            sources.append({
                "id": f"{city_key}_con_{i}", "name": rng.choice(con_names),
                "category": "construction", "location": [lat + olat, lng + olng],
                "Q": round(rng.uniform(30, 100), 1), "H": 0.0,
            })

        # --- Waste/crop burning sources ---
        n_burn = rng.randint(1, 2) if is_crop_zone else rng.randint(0, 1)
        burn_names = ([f"Crop Residue Burning ({state})", f"Stubble Fire ({city['name']} outskirts)"]
                      if is_crop_zone else
                      [f"{city['name']} Municipal Dump Site", f"Open Waste Burning ({city['name']})",
                       f"Satellite Fire Anomaly near {city['name']}"])
        for i in range(n_burn):
            olat = rng.uniform(0.01, 0.05) * rng.choice([-1, 1])
            olng = rng.uniform(0.01, 0.05) * rng.choice([-1, 1])
            sources.append({
                "id": f"{city_key}_burn_{i}", "name": rng.choice(burn_names),
                "category": "waste_burning", "location": [lat + olat, lng + olng],
                "Q": round(rng.uniform(80, 200), 1), "H": 0.0,
            })

        return sources


# ── Simulation Engine (Multi-city, Real Data) ─────────────────────────────────

class SimulationEngine:
    """Generates city state snapshots using REAL Open-Meteo Air Quality data.
    Falls back to estimation only when API is unreachable."""

    def __init__(self, seed: int = 42) -> None:
        self._rng = random.Random(seed)
        self._cache: Dict[str, Any] = {}
        self._cache_ts: Dict[str, float] = {}
        self._cache_ttl = 900  # 15-minute cache for readings (APIs update hourly)
        self._forecast_cache_ttl = 1800  # 30-minute cache for forecasts

    def _calculate_plume_dispersion(
        self,
        receptor_loc: List[float],
        source_loc: List[float],
        Q: float,
        H: float,
        u: float,
        wdir: float
    ) -> float:
        """Calculate ground-level concentration using Gaussian Plume model."""
        lat_rec, lng_rec = receptor_loc
        lat_src, lng_src = source_loc
        
        # Convert lat/lng delta to meters
        dy = (lat_rec - lat_src) * 111320.0
        dx = (lng_rec - lng_src) * 111320.0 * math.cos(math.radians(lat_src))
        
        # Flow angle (direction the plume is traveling) in radians
        # wdir is direction wind is coming from.
        # Flow angle = 270 - wdir
        flow_angle_rad = math.radians(270.0 - wdir)
        
        # Rotate coordinates to find downwind (x) and crosswind (y) distances
        x_down = dx * math.cos(flow_angle_rad) + dy * math.sin(flow_angle_rad)
        y_cross = -dx * math.sin(flow_angle_rad) + dy * math.cos(flow_angle_rad)
        
        if x_down <= 10.0:  # Upwind or extremely close to stack
            return 0.0
            
        # Dispersion coefficients (Pasquill-Gifford Class C - slightly unstable)
        sigma_y = 0.11 * x_down**1.0
        sigma_z = 0.08 * x_down**0.91
        
        # Gaussian plume formula at ground level (z = 0)
        try:
            term_y = -0.5 * (y_cross / sigma_y)**2
            term_z = -0.5 * (H / sigma_z)**2
            
            # Avoid math overflow
            if term_y < -50 or term_z < -50:
                return 0.0
                
            C = (Q / (math.pi * u * sigma_y * sigma_z)) * math.exp(term_y) * math.exp(term_z)
            return C
        except Exception:
            return 0.0

    def _jitter(self, value: float, pct: float = 0.08) -> float:
        """Small jitter to differentiate sensors."""
        return round(value * (1 + self._rng.uniform(-pct, pct)), 1)

    def _get_city(self, city_key: str) -> Dict[str, Any]:
        return CITIES.get(city_key, CITIES[DEFAULT_CITY])

    def _is_cached(self, key: str, ttl: float = None) -> bool:
        if ttl is None:
            ttl = self._cache_ttl
        return key in self._cache and (time.time() - self._cache_ts.get(key, 0)) < ttl

    def invalidate_cache(self, prefix: str = None):
        """Clear cached data. If prefix is given, only clear keys starting with that prefix."""
        if prefix:
            keys_to_remove = [k for k in self._cache if k.startswith(prefix)]
            for k in keys_to_remove:
                del self._cache[k]
                self._cache_ts.pop(k, None)
            safe_print(f"[Cache Invalidated] Cleared {len(keys_to_remove)} entries with prefix '{prefix}'")
        else:
            self._cache.clear()
            self._cache_ts.clear()
            safe_print("[Cache Invalidated] All cache cleared")

    async def generate_readings(
        self, city_key: str = DEFAULT_CITY, force_refresh: bool = False
    ) -> List[Dict[str, Any]]:
        """Generate AQI readings — fetches REAL data via the hybrid OpenAQ v3 / Open-Meteo pipeline."""
        cache_key = f"readings_{city_key}"
        if not force_refresh and self._is_cached(cache_key):
            age = time.time() - self._cache_ts.get(cache_key, 0)
            safe_print(f"[Cache Hit] '{city_key}' - Serving cached data")
            return self._cache[cache_key]
        else:
            reason = "force_refresh=True" if force_refresh else "cache expired"
            safe_print(f"[Cache Miss] '{city_key}' - Fetching fresh live data ({reason})...")

        ts = datetime.now(timezone.utc)
        readings: List[Dict[str, Any]] = []

        if city_key == "all":
            # Only batch fetch parent cities to prevent timeouts
            keys = list(CITIES.keys())
            live_keys = [k for k in keys if k in LIVE_CITIES and "_" not in k]
            other_keys = [k for k in keys if k not in LIVE_CITIES or "_" in k]
            
            live_readings_map = {}
            
            async def fetch_city_reading(k, idx):
                await asyncio.sleep(idx * 0.15)  # Stagger requests to prevent API burst limit blocks
                lat_k, lng_k = CITIES[k]["center"]
                aq_data = await _fetch_real_aqi(lat_k, lng_k)
                if aq_data:
                    pollutants = {
                        "pm25": aq_data["pm25"], "pm10": aq_data["pm10"], "no2": aq_data["no2"],
                        "so2": aq_data["so2"], "co": aq_data["co"], "o3": aq_data["o3"]
                    }
                    aqi_in = aq_data["aqi"]
                    source = aq_data["source"]
                else:
                    pollutants = {"pm25": 15.0, "pm10": 30.0, "no2": 10.0, "so2": 5.0, "co": 0.3, "o3": 20.0}
                    aqi_in = 40.0
                    source = "estimation (fallback)"
                
                # Calculate procedural wind
                h_seed = ts.hour + ts.minute // 10
                rng_wind = random.Random(hash(f"{k}_{h_seed}"))
                ws = rng_wind.uniform(1.5, 6.0)
                wd = rng_wind.uniform(0.0, 360.0)
                self._cache[f"wind_{k}"] = (ws, wd)

                return {
                    "sensor_id": f"SENSOR_{k}",
                    "ward_id": k,
                    "location": CITIES[k]["center"],
                    "timestamp": ts.isoformat(),
                    "aqi": round(aqi_in, 1),
                    "aqi_in": round(aqi_in, 1),
                    "pollutants": pollutants,
                    "source": source
                }

            try:
                results = await asyncio.gather(*(fetch_city_reading(k, idx) for idx, k in enumerate(live_keys)), return_exceptions=True)
                for k, r_entry in zip(live_keys, results):
                    if isinstance(r_entry, Exception) or not r_entry:
                        safe_print(f"Error fetching live city {k}:", r_entry)
                        pollutants = {"pm25": 15.0, "pm10": 30.0, "no2": 10.0, "so2": 5.0, "co": 0.3, "o3": 20.0}
                        r_entry = {
                            "sensor_id": f"SENSOR_{k}",
                            "ward_id": k,
                            "location": CITIES[k]["center"],
                            "timestamp": ts.isoformat(),
                            "aqi": 40.0,
                            "aqi_in": 40.0,
                            "pollutants": pollutants,
                            "source": "estimation (fallback)"
                        }
                    readings.append(r_entry)
                    live_readings_map[k] = r_entry
            except Exception as e:
                safe_print("Error in parallel city fetch:", e)

            # Process other cities using nearest-neighbor fallback
            active_keys = list(live_readings_map.keys())
            for k in other_keys:
                lat, lng = CITIES[k]["center"]
                
                # Find nearest key among active_keys
                nearest_key = "delhi"
                if active_keys:
                    min_dist = float('inf')
                    for ak in active_keys:
                        clat, clng = CITIES[ak]["center"]
                        dist = (lat - clat)**2 + (lng - clng)**2
                        if dist < min_dist:
                            min_dist = dist
                            nearest_key = ak
                
                ref_reading = live_readings_map.get(nearest_key)

                if ref_reading:
                    ref_p = ref_reading["pollutants"]
                    pollutants = {
                        "pm25": max(0.0, self._jitter(ref_p["pm25"], 0.05)),
                        "pm10": max(0.0, self._jitter(ref_p["pm10"], 0.05)),
                        "no2": max(0.0, self._jitter(ref_p["no2"], 0.05)),
                        "so2": max(0.0, self._jitter(ref_p["so2"], 0.05)),
                        "co": max(0.0, self._jitter(ref_p["co"], 0.05)),
                        "o3": max(0.0, self._jitter(ref_p["o3"], 0.05)),
                    }
                    aqi_in = calculate_indian_aqi(
                        pollutants["pm25"], pollutants["pm10"], pollutants["no2"],
                        pollutants["so2"], pollutants["co"], pollutants["o3"]
                    )
                    readings.append({
                        "sensor_id": f"SENSOR_{k}",
                        "ward_id": k,
                        "location": CITIES[k]["center"],
                        "timestamp": ts.isoformat(),
                        "aqi": round(aqi_in, 1),
                        "aqi_in": round(aqi_in, 1),
                        "pollutants": pollutants,
                        "source": f"nearest-neighbor fallback ({nearest_key})"
                    })
                else:
                    pollutants = {"pm25": 30.0, "pm10": 60.0, "no2": 25.0, "so2": 8.0, "co": 0.6, "o3": 45.0}
                    readings.append({
                        "sensor_id": f"SENSOR_{k}",
                        "ward_id": k,
                        "location": CITIES[k]["center"],
                        "timestamp": ts.isoformat(),
                        "aqi": 80.0,
                        "aqi_in": 80.0,
                        "pollutants": pollutants,
                        "source": "estimation (fallback)"
                    })

            # Store individual city readings in cache to prevent downstream per-city HTTP requests
            for r in readings:
                k = r["ward_id"]
                self._cache[f"readings_{k}"] = [r]
                self._cache_ts[f"readings_{k}"] = time.time()

        else:
            city = self._get_city(city_key)
            aqi_data = await _fetch_real_aqi(city["center"][0], city["center"][1])
            if aqi_data:
                pm25 = aqi_data["pm25"]
                pm10 = aqi_data["pm10"]
                
                # Calculate procedural wind
                h_seed = ts.hour + ts.minute // 10
                rng_wind = random.Random(hash(f"{city_key}_{h_seed}"))
                ws = rng_wind.uniform(1.5, 6.0)
                wd = rng_wind.uniform(0.0, 360.0)
                self._cache[f"wind_{city_key}"] = (ws, wd)

                pollutants = {
                    "pm25": round(pm25, 1),
                    "pm10": round(pm10, 1),
                    "no2": max(0.0, round(aqi_data["no2"], 1)),
                    "so2": max(0.0, round(aqi_data["so2"], 1)),
                    "co": max(0.0, round(aqi_data["co"], 2)),
                    "o3": max(0.0, round(aqi_data["o3"], 1)),
                }
                aqi_in = aqi_data["aqi"]
                source = aqi_data["source"]
            else:
                pollutants = {"pm25": 30.0, "pm10": 60.0, "no2": 25.0, "so2": 8.0, "co": 0.6, "o3": 45.0}
                aqi_in = 80.0
                source = "estimation (fallback)"

            readings.append({
                "sensor_id": f"SENSOR_{city_key}",
                "ward_id": city_key,
                "location": city["center"],
                "timestamp": ts.isoformat(),
                "aqi": round(aqi_in, 1),
                "aqi_in": round(aqi_in, 1),
                "pollutants": pollutants,
                "source": source
            })

        self._cache[cache_key] = readings
        self._cache_ts[cache_key] = time.time()
        return readings

    async def generate_forecast(
        self, city_key: str = DEFAULT_CITY, hours: int = 24, force_refresh: bool = False
    ) -> List[Dict[str, Any]]:
        """Generate city AQI forecast using Open-Meteo hourly forecast API."""
        cache_key = f"forecast_{city_key}_{hours}"
        if not force_refresh and self._is_cached(cache_key, self._forecast_cache_ttl):
            return self._cache[cache_key]

        now = datetime.now(timezone.utc)
        grid = []

        if city_key == "all":
            # Batch fetch forecasts for all LIVE_CITIES, then use nearest-neighbor for others
            keys = list(CITIES.keys())
            live_keys = [k for k in keys if k in LIVE_CITIES]
            other_keys = [k for k in keys if k not in LIVE_CITIES]
            
            # Divide live keys into batches of 33 to avoid Open-Meteo timeouts/limits
            batch_size = 33
            batches = [live_keys[i:i + batch_size] for i in range(0, len(live_keys), batch_size)]
            
            import asyncio
            
            async def fetch_forecast_batch(batch_keys):
                batch_lats = [str(CITIES[k]["center"][0]) for k in batch_keys]
                batch_lngs = [str(CITIES[k]["center"][1]) for k in batch_keys]
                url = "https://air-quality-api.open-meteo.com/v1/air-quality"
                params = {
                    "latitude": ",".join(batch_lats),
                    "longitude": ",".join(batch_lngs),
                    "hourly": "us_aqi,pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide",
                    "forecast_days": min(max(hours // 24, 1), 5),
                }
                async with httpx.AsyncClient(timeout=25.0) as client:
                    resp = await client.get(url, params=params)
                    if resp.status_code == 200:
                        return resp.json()
                return []

            live_forecasts = {}
            try:
                results_batches = await asyncio.gather(*(fetch_forecast_batch(b) for b in batches), return_exceptions=True)
                
                for batch_keys, batch_result in zip(batches, results_batches):
                    if isinstance(batch_result, Exception) or not batch_result:
                        safe_print("Error fetching forecast batch:", batch_result)
                        continue
                    
                    items = batch_result if isinstance(batch_result, list) else [batch_result]
                    for k, item in zip(batch_keys, items):
                        live_forecasts[k] = item.get("hourly", {})
            except Exception as e:
                safe_print("Error batch fetching forecast:", e)
                
            # Build combined forecast grid
            for h in range(hours):
                future = now + timedelta(hours=h)
                future_ts = future.isoformat()
                
                wards = []
                # Process live keys
                for k in live_keys:
                    f_data = live_forecasts.get(k, {})
                    times = f_data.get("time", [])
                    us_aqi_arr = f_data.get("us_aqi", [])
                    pm25_arr = f_data.get("pm2_5", [])
                    pm10_arr = f_data.get("pm10", [])
                    no2_arr = f_data.get("nitrogen_dioxide", [])
                    so2_arr = f_data.get("sulphur_dioxide", [])
                    o3_arr = f_data.get("ozone", [])
                    co_arr = f_data.get("carbon_monoxide", [])
                    
                    if h < len(times):
                        cal = calibrate_india_pollutants(
                            pm25_arr[h] or 0.0, pm10_arr[h] or 0.0,
                            no2_arr[h] or 0.0, so2_arr[h] or 0.0,
                            co_arr[h] or 0.0, o3_arr[h] or 0.0,
                        )
                        aqi_in = calculate_indian_aqi(cal["pm25"], cal["pm10"], cal["no2"], cal["so2"], cal["co"], cal["o3"])
                    else:
                        aqi_in = 50.0
                        
                    rng_wind = random.Random(hash(f"{k}_fc_{h}"))
                    ws = rng_wind.uniform(1.5, 6.0)
                    wd = rng_wind.uniform(0.0, 360.0)
                    confidence = round(max(0.50, 0.95 - (h * 0.006)), 2)
                    
                    wards.append({
                        "ward_id": k,
                        "ward_name": CITIES[k]["name"],
                        "center": CITIES[k]["center"],
                        "predicted_aqi": round(aqi_in, 1),
                        "confidence": confidence,
                        "wind_speed_kmh": round(ws * 3.6, 1),
                        "wind_direction_deg": round(wd, 1),
                    })
                
                live_wards_map = {w["ward_id"]: w for w in wards}
                
                # Process other keys using nearest-neighbor fallback
                for k in other_keys:
                    lat, lng = CITIES[k]["center"]
                    nearest_key = get_nearest_live_city(lat, lng)
                    ref_w = live_wards_map.get(nearest_key)
                    
                    rng_wind = random.Random(hash(f"{k}_fc_{h}"))
                    ws = rng_wind.uniform(1.5, 6.0)
                    wd = rng_wind.uniform(0.0, 360.0)
                    
                    if ref_w:
                        predicted_aqi = round(ref_w["predicted_aqi"] * (0.98 + 0.04 * rng_wind.random()), 1)
                    else:
                        predicted_aqi = 80.0
                        
                    wards.append({
                        "ward_id": k,
                        "ward_name": CITIES[k]["name"],
                        "center": CITIES[k]["center"],
                        "predicted_aqi": predicted_aqi,
                        "confidence": round(max(0.50, 0.90 - (h * 0.005)), 2),
                        "wind_speed_kmh": round(ws * 3.6, 1),
                        "wind_direction_deg": round(wd, 1),
                    })
                    
                grid.append({
                    "timestamp": future_ts,
                    "hour_offset": h + 1,
                    "wards": wards
                })
                
            self._cache[cache_key] = grid
            self._cache_ts[cache_key] = time.time()
            return grid

        city = self._get_city(city_key)
        lat, lng = city["center"]

        # Fetch real 72-hour forecast from Open-Meteo Air Quality API
        forecast_data = None
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(AQ_API_URL, params={
                    "latitude": lat,
                    "longitude": lng,
                    "hourly": "us_aqi,pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide",
                    "forecast_days": min(max(hours // 24, 1), 5),
                })
                if resp.status_code == 200:
                    forecast_data = resp.json().get("hourly", {})
        except Exception as e:
            safe_print(f"Forecast API failed for {city_key}: {e}")
        
        # Base readings to get baseline background pollutants
        readings = await self.generate_readings(city_key)
        ref_reading = readings[0] if readings else None
        
        if forecast_data:
            times = forecast_data.get("time", [])
            us_aqi_arr = forecast_data.get("us_aqi", [])
            pm25_arr = forecast_data.get("pm2_5", [])
            pm10_arr = forecast_data.get("pm10", [])
            no2_arr = forecast_data.get("nitrogen_dioxide", [])
            so2_arr = forecast_data.get("sulphur_dioxide", [])
            o3_arr = forecast_data.get("ozone", [])
            co_arr = forecast_data.get("carbon_monoxide", [])

            for h in range(min(hours, len(times))):
                cal = calibrate_india_pollutants(
                    pm25_arr[h] or 0.0, pm10_arr[h] or 0.0,
                    no2_arr[h] or 0.0, so2_arr[h] or 0.0,
                    co_arr[h] or 0.0, o3_arr[h] or 0.0,
                )
                aqi_in = calculate_indian_aqi(cal["pm25"], cal["pm10"], cal["no2"], cal["so2"], cal["co"], cal["o3"])

                rng_wind = random.Random(hash(f"{city_key}_fc_{h}"))
                ws = rng_wind.uniform(1.5, 6.0)
                wd = rng_wind.uniform(0.0, 360.0)

                confidence = round(max(0.50, 0.95 - (h * 0.006)), 2)

                grid.append({
                    "timestamp": times[h],
                    "hour_offset": h + 1,
                    "wards": [{
                        "ward_id": city_key,
                        "ward_name": city["name"],
                        "center": city["center"],
                        "predicted_aqi": round(aqi_in, 1),
                        "confidence": confidence,
                        "wind_speed_kmh": round(ws * 3.6, 1),
                        "wind_direction_deg": round(wd, 1),
                    }]
                })
        else:
            # Fallback: estimation from current readings
            for h in range(1, hours + 1):
                future = now + timedelta(hours=h)
                rng_wind = random.Random(hash(f"{city_key}_fc_{h}"))
                ws = rng_wind.uniform(1.5, 6.0)
                wd = rng_wind.uniform(0.0, 360.0)
                if ref_reading:
                    base_aqi = ref_reading.get("aqi_in", ref_reading["aqi"])
                    predicted = round(base_aqi * (0.9 + 0.2 * math.sin(h / 6.0)), 1)
                else:
                    predicted = 50.0
                grid.append({
                    "timestamp": future.isoformat(),
                    "hour_offset": h,
                    "wards": [{
                        "ward_id": city_key,
                        "ward_name": city["name"],
                        "center": city["center"],
                        "predicted_aqi": predicted,
                        "confidence": round(max(0.50, 0.90 - (h * 0.005)), 2),
                        "wind_speed_kmh": round(ws * 3.6, 1),
                        "wind_direction_deg": round(wd, 1),
                    }]
                })

        self._cache[cache_key] = grid
        self._cache_ts[cache_key] = time.time()
        return grid

    async def get_city_state(self, city_key: str = DEFAULT_CITY, force_refresh: bool = False) -> Dict[str, Any]:
        """Return a complete snapshot of the selected city."""
        city = self._get_city(city_key)
        readings = await self.generate_readings(city_key, force_refresh=force_refresh)

        rng = random.Random(hash(city_key))
        population = rng.randint(250000, 1800000) if "_" in city_key else rng.randint(4000000, 15000000)
        hospitals = rng.randint(2, 12) if "_" in city_key else rng.randint(15, 65)
        schools = rng.randint(15, 60) if "_" in city_key else rng.randint(80, 320)
        elderly_pct = rng.randint(7, 16)

        ward_summaries = [{
            "id": city_key,
            "name": city["name"],
            "state": city.get("state", ""),
            "country": city.get("country", ""),
            "center": city["center"],
            "current_aqi": readings[0]["aqi"],
            "aqi_in": readings[0].get("aqi_in", readings[0]["aqi"]),
            "sensor_count": 1,
            "population": population,
            "vulnerable": {"hospitals": hospitals, "schools": schools, "elderly_pct": elderly_pct}
        }]

        weather = await _fetch_live_weather(city["center"][0], city["center"][1])
        ws, wd = 2.8, 270.0
        if f"wind_{city_key}" in self._cache:
            ws, wd = self._cache[f"wind_{city_key}"]
            
        if not weather:
            weather = {"temperature_c": None, "humidity_pct": None,
                       "wind_speed_kmh": None, "wind_direction_deg": None,
                       "source": "unavailable"}
                       
        weather["wind_speed_kmh"] = round(ws * 3.6, 1)
        weather["wind_direction_deg"] = round(wd, 1)

        return {
            "city": {"name": city["name"], "state": city.get("state", ""), "country": city.get("country", ""), "center": city["center"]},
            "city_key": city_key,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "wards": ward_summaries,
            "sensors": readings,
            "sources": get_sources_for_city(city_key),
            "traffic_corridors": [],
            "weather": weather,
        }

    def get_available_cities(self) -> List[Dict[str, str]]:
        """Return list of supported cities."""
        return [
            {"key": k, "name": v["name"], "state": v.get("state", v.get("country", ""))}
            for k, v in CITIES.items()
        ]