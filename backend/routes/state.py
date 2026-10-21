import hashlib
import asyncio
import time
from typing import Any

from fastapi import APIRouter, Depends, Query

from auth import require_roles
from database import User, UserRole
from redis_client import cache_get_json, cache_set_json

router = APIRouter()
_STATE_IN_FLIGHT: dict[str, asyncio.Task] = {}


def _synthetic_vulnerability_metadata(city_key: str) -> dict[str, Any]:
    seed = int(hashlib.sha256(city_key.encode()).hexdigest()[:8], 16)
    return {
        "population": seed % (1550000 if "_" in city_key else 11000000) + (250000 if "_" in city_key else 4000000),
        "vulnerable": {
            "hospitals": seed % (11 if "_" in city_key else 51) + (2 if "_" in city_key else 15),
            "schools": seed % (46 if "_" in city_key else 241) + (15 if "_" in city_key else 80),
            "elderly_pct": seed % 10 + 7,
            "data_quality": "synthetic_demo",
        },
    }


async def _get_cached_state(city: str, fresh: bool = False):
    if fresh:
        return None
    return await cache_get_json(f"state:{city}")


async def _set_cached_state(city: str, payload: Any):
    await cache_set_json(f"state:{city}", payload, 180)


@router.post("/api/cache/clear")
async def clear_cache(current_user: User = Depends(require_roles(UserRole.ADMIN.value))):
    from simulation import sim
    sim.invalidate_cache()
    return {"status": "ok", "message": "All caches cleared. Next request will fetch fresh live data."}


@router.get("/api/data-freshness")
def get_data_freshness():
    from simulation import sim
    now = time.time()
    entries = {}
    for key in sim._cache_ts:
        age = round(now - sim._cache_ts[key], 1)
        ttl = sim._forecast_cache_ttl if key.startswith("forecast_") else sim._cache_ttl
        entries[key] = {"age_seconds": age, "ttl_seconds": ttl, "is_stale": age >= ttl, "refreshes_in": max(0, round(ttl - age, 1))}
    return {"cache_entries": entries, "readings_ttl": sim._cache_ttl, "forecast_ttl": sim._forecast_cache_ttl, "total_cached": len(entries)}


@router.get("/api/state")
async def get_state(city: str = Query(default="all"), fresh: bool = Query(default=False)):
    request_key = f"{city}:{'fresh' if fresh else 'cached'}"
    in_flight = _STATE_IN_FLIGHT.get(request_key)
    if in_flight is not None:
        return await asyncio.shield(in_flight)

    task = asyncio.create_task(_build_state(city, fresh))
    _STATE_IN_FLIGHT[request_key] = task
    try:
        return await asyncio.shield(task)
    finally:
        if _STATE_IN_FLIGHT.get(request_key) is task:
            _STATE_IN_FLIGHT.pop(request_key, None)


async def _build_state(city: str, fresh: bool):
    from simulation import CITIES, DEFAULT_CITY, get_sources_for_city, sim

    cached = await _get_cached_state(city, fresh)
    if cached is not None:
        return cached
    if city != "all":
        result = await sim.get_city_state(city, force_refresh=fresh)
        await _set_cached_state(city, result)
        return result

    readings = await sim.generate_readings("all", force_refresh=fresh)
    combined_wards, combined_sensors, city_averages = [], [], {}
    for reading in readings:
        city_key = reading["ward_id"]
        city_data = CITIES.get(city_key)
        if not city_data:
            continue
        city_name = city_data["name"]
        country = city_data.get("country", "")
        parent = city_data.get("parent")
        place_label = f"{city_name}, {CITIES[parent]['name']}" if parent and parent in CITIES else f"{city_name}, {country}" if country else city_name
        combined_wards.append({"id": city_key, "city_key": city_key, "name": place_label, "state": city_data.get("state", ""), "country": country, "center": city_data["center"], "current_aqi": reading["aqi"], "aqi_in": reading.get("aqi_in", reading["aqi"]), "sensor_count": 1, **_synthetic_vulnerability_metadata(city_key)})
        combined_sensors.append({**reading, "ward_id": city_key, "city_key": city_key, "sensor_id": place_label})
        city_averages[city_key] = {"name": city_name, "state": city_data.get("state", ""), "country": country, "center": city_data["center"], "aqi": reading["aqi"], "aqi_in": reading.get("aqi_in", reading["aqi"]), "weather": {"temperature_c": None, "wind_speed_kmh": None, "source": "unavailable"}}

    combined_sources, seen_source_keys, seen_parent_cities = [], set(), set()
    for city_key in CITIES:
        parent_city = city_key.split("_")[0] if "_" in city_key else city_key
        if parent_city in seen_parent_cities:
            continue
        seen_parent_cities.add(parent_city)
        for source in get_sources_for_city(parent_city):
            source.setdefault("city", parent_city)
            source.setdefault("city_key", parent_city)
            source_key = f"{source.get('city_key') or parent_city}-{source.get('id') or source.get('name')}"
            if source_key not in seen_source_keys:
                seen_source_keys.add(source_key)
                combined_sources.append(source)

    weather = {"temperature_c": None, "wind_speed_kmh": None, "source": "all"}
    try:
        city_state = await sim.get_city_state(DEFAULT_CITY)
        if city_state and "weather" in city_state:
            weather = {"temperature_c": city_state["weather"].get("temperature_c"), "wind_speed_kmh": city_state["weather"].get("wind_speed_kmh"), "source": f"Representative ({CITIES[DEFAULT_CITY]['name']})"}
    except Exception:
        pass

    result = {"city": {"name": "National Air Quality Monitor", "state": "India", "center": [22.0, 77.0]}, "city_key": "all", "timestamp": readings[0]["timestamp"] if readings else "", "wards": combined_wards, "sensors": combined_sensors, "sources": combined_sources, "traffic_corridors": [], "city_averages": city_averages, "weather": weather}
    await _set_cached_state(city, result)
    return result
