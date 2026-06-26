"""
FastAPI Backend — AQI Intervention Platform (Multi-City + Real AQI)
====================================================================
All endpoints now accept a `city` query parameter and return REAL
air quality data from the free Open-Meteo Air Quality API.
"""

from __future__ import annotations

import sys
import asyncio

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import os
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from simulation import SimulationEngine, CITIES, DEFAULT_CITY, get_sources_for_city
from agents import (
    AttributionAgent,
    PredictiveAgent,
    EnforcementAgent,
    AdvisoryAgent,
)
from forecaster import AQIForecaster

# ── Application Setup ─────────────────────────────────────────────────────────

app = FastAPI(
    title="AQI Intervention Platform",
    description="AI-powered urban air quality intelligence — multi-city, real-time data",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Singletons ────────────────────────────────────────────────────────────────

sim = SimulationEngine()
attribution_agent = AttributionAgent()
predictive_agent = PredictiveAgent()
enforcement_agent = EnforcementAgent()
advisory_agent = AdvisoryAgent()
forecaster = AQIForecaster()

@app.on_event("startup")
async def startup_event():
    # Pre-train top cities in the background to avoid blocking server start
    TOP_CITIES = ["delhi", "mumbai", "kolkata", "bengaluru", "chennai", "hyderabad", "pune", "ahmedabad", "jaipur", "lucknow"]
    async def train_all():
        for city in TOP_CITIES:
            try:
                await forecaster.train_for_city(city)
            except Exception as e:
                import logging
                logging.getLogger("main").error(f"Error training startup model for {city}: {e}")
    asyncio.create_task(train_all())



# ── Helper ────────────────────────────────────────────────────────────────────

def _city_wards(city_key: str):
    city = CITIES.get(city_key)
    if not city:
        # Check if it's in the dynamic cache or default it
        return [{"id": city_key, "name": city_key.capitalize(), "state": "", "country": "", "center": [0.0, 0.0]}]
    return [{
        "id": city_key,
        "name": city["name"],
        "state": city.get("state", ""),
        "country": city.get("country", ""),
        "center": city["center"],
    }]


def _city_sources(city_key: str):
    return get_sources_for_city(city_key)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/cities")
def get_cities():
    """Return all supported cities."""
    return {"cities": sim.get_available_cities(), "default": DEFAULT_CITY}


@app.get("/api/state")
async def get_state(city: str = Query(default="all")):
    """Return a complete snapshot of the selected city or all cities combined with REAL AQI data."""
    if city == "all":
        readings = await sim.generate_readings("all")
        
        combined_wards = []
        combined_sensors = []
        city_averages = {}
        
        for r in readings:
            city_key = r["ward_id"]
            city_data = CITIES.get(city_key)
            if not city_data:
                continue
            city_name = city_data["name"]
            country = city_data.get("country", "")
            place_label = f"{city_name}, {country}" if country else city_name
            
            combined_wards.append({
                "id": f"{city_key}_{city_key}",
                "city_key": city_key,
                "name": place_label,
                "state": city_data.get("state", ""),
                "country": country,
                "center": city_data["center"],
                "current_aqi": r["aqi"],
                "aqi_in": r.get("aqi_in", r["aqi"]),
                "aqi_us": r.get("aqi_us", r["aqi"]),
                "sensor_count": 1,
                "population": 10000000,
                "vulnerable": {"hospitals": 10, "schools": 50, "elderly_pct": 12}
            })
            
            combined_sensors.append({
                **r,
                "ward_id": f"{city_key}_{city_key}",
                "city_key": city_key,
                "sensor_id": place_label
            })
            
            city_averages[city_key] = {
                "name": city_name,
                "state": city_data.get("state", ""),
                "country": country,
                "center": city_data["center"],
                "aqi": r["aqi"],
                "aqi_in": r.get("aqi_in", r["aqi"]),
                "aqi_us": r.get("aqi_us", r["aqi"]),
                "weather": {"temperature_c": None, "wind_speed_kmh": None, "source": "unavailable"}
            }

        combined_sources = []
        for city_key in CITIES.keys():
            combined_sources.extend(get_sources_for_city(city_key))

        # Fetch representative weather (Delhi) for "all" mode
        weather = {"temperature_c": None, "wind_speed_kmh": None, "source": "all"}
        try:
            city_state = await sim.get_city_state(DEFAULT_CITY)
            if city_state and "weather" in city_state:
                weather = {
                    "temperature_c": city_state["weather"].get("temperature_c"),
                    "wind_speed_kmh": city_state["weather"].get("wind_speed_kmh"),
                    "source": f"Representative ({CITIES[DEFAULT_CITY]['name']})"
                }
        except Exception:
            pass

        return {
            "city": {"name": "National Air Quality Monitor", "state": "India", "center": [22.0, 77.0]},
            "city_key": "all",
            "timestamp": readings[0]["timestamp"] if readings else "",
            "wards": combined_wards,
            "sensors": combined_sensors,
            "sources": combined_sources,
            "traffic_corridors": [],
            "city_averages": city_averages,
            "weather": weather
        }
    return await sim.get_city_state(city)



@app.get("/api/forecast")
async def get_forecast(
    city: str = Query(default=DEFAULT_CITY),
    hours: int = Query(default=24, ge=1, le=72),
):
    """Return ward-level AQI forecast grid using real Open-Meteo forecast data with ML predictions."""
    # 1. Fetch raw forecast grid for all cities
    raw_forecast = await sim.generate_forecast(city, hours)
    
    # 2. Get list of cities to override
    TOP_CITIES = ["delhi", "mumbai", "kolkata", "bengaluru", "chennai", "hyderabad", "pune", "ahmedabad", "jaipur", "lucknow"]
    cities_to_process = [city] if city != "all" else TOP_CITIES
    
    # Filter cities to process that are in CITIES keys
    cities_to_process = [c for c in cities_to_process if c in CITIES]
    
    if not cities_to_process:
        return raw_forecast
        
    # Generate ML forecasts in parallel
    ml_forecasts = {}
    tasks = {c: forecaster.generate_ml_forecast(c, hours) for c in cities_to_process}
    results = await asyncio.gather(*tasks.values(), return_exceptions=True)
    
    for c, res in zip(tasks.keys(), results):
        if isinstance(res, Exception):
            import logging
            logging.getLogger("main").error(f"Error generating ML forecast for {c}: {res}")
            continue
        ml_forecasts[c] = res

    # Fetch current readings to detect if there is any anomaly right now
    try:
        current_readings = await sim.generate_readings("all")
        current_readings_map = {r["ward_id"]: r.get("aqi_in", r["aqi"]) for r in current_readings}
    except Exception as e:
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
    # raw_forecast is a list of hourly entries: [{"timestamp": ..., "hour_offset": ..., "wards": [...]}, ...]
    for entry in raw_forecast:
        h_offset = entry["hour_offset"]
        h_idx = h_offset - 1
        
        for w in entry.get("wards", []):
            w_id = w["ward_id"]
            if w_id in ml_forecasts:
                ml_f = ml_forecasts[w_id]
                grid_len = len(ml_f["grid"])
                if h_idx < grid_len:
                    ml_hour_data = ml_f["grid"][h_idx]
                    
                    # Update ward fields with ML data
                    w["predicted_aqi"] = ml_hour_data["predicted_aqi"]
                    w["confidence"] = ml_hour_data["confidence"]
                    w["confidence_low"] = ml_hour_data["confidence_low"]
                    w["confidence_high"] = ml_hour_data["confidence_high"]
                    w["open_meteo_raw"] = ml_hour_data["open_meteo_raw"]
                    w["persistence_baseline"] = ml_hour_data["persistence_baseline"]
                    
                    # Attach metrics and anomalies (attached to the ward object so it is visible to front-end for that city)
                    w["accuracy"] = ml_f["accuracy"]
                    w["anomalies"] = ml_f["anomalies"]
                    w["model_type"] = ml_f["model_type"]

    return raw_forecast



@app.post("/api/agents/attribution")
async def run_attribution(
    lat: float = Query(...),
    lng: float = Query(...),
    city: str = Query(default=DEFAULT_CITY),
):
    """Run the Source Attribution Agent for a specific coordinate."""
    resolved_city = city
    if city == "all":
        from simulation import get_nearest_live_city
        resolved_city = get_nearest_live_city(lat, lng)
        
    readings = await sim.generate_readings(resolved_city)
    sources = _city_sources(resolved_city)
    return attribution_agent.run(lat, lng, sources, readings)


@app.post("/api/agents/dispatch")
async def run_dispatch(city: str = Query(default=DEFAULT_CITY)):
    """Run the Enforcement Intelligence Agent."""
    if city == "all":
        import asyncio
        keys = [c["key"] for c in sim.get_available_cities()]
        readings_list = await asyncio.gather(*(sim.generate_readings(k) for k in keys))
        
        combined_dispatches = []
        for k, readings in zip(keys, readings_list):
            sources = _city_sources(k)
            wards = _city_wards(k)
            res = enforcement_agent.run(readings, sources, wards)
            for d in res.get("dispatches", []):
                d["ward_name"] = f"{d['ward_name']} ({k.capitalize()})"
                combined_dispatches.append(d)
                
        combined_dispatches.sort(key=lambda x: -x["priority_score"])
        return {
            "dispatches": combined_dispatches,
            "total_hotspots": len(combined_dispatches),
            "timestamp": readings_list[0][0]["timestamp"] if readings_list and readings_list[0] else None
        }
    readings = await sim.generate_readings(city)
    sources = _city_sources(city)
    wards = _city_wards(city)
    return enforcement_agent.run(readings, sources, wards)


@app.post("/api/agents/advisory")
async def run_advisory(
    ward_id: str = Query(...),
    lang: str = Query(default="en"),
    city: str = Query(default=DEFAULT_CITY),
):
    """Run the Citizen Advisory Agent for a specific ward and language."""
    # First, handle custom coordinates in ward_id
    if ward_id.startswith("custom_"):
        try:
            parts = ward_id.split("_")
            lat = float(f"{parts[1]}.{parts[2]}")
            lng = float(f"{parts[3]}.{parts[4]}")
        except Exception:
            lat, lng = CITIES[DEFAULT_CITY]["center"]

        from simulation import _fetch_real_aqi, _fetch_live_weather, calculate_indian_aqi, get_nearest_live_city
        nearest_city = get_nearest_live_city(lat, lng)
        
        aqi_data = await _fetch_real_aqi(lat, lng)
        if not aqi_data:
            aqi_data = {
                "aqi": 50, "pm25": 12.0, "pm10": 25.0, "no2": 15.0, "so2": 4.0, "co": 0.3, "o3": 25.0,
                "source": "estimation (fallback)"
            }
        
        avg_aqi = calculate_indian_aqi(
            aqi_data["pm25"], aqi_data["pm10"], aqi_data["no2"],
            aqi_data["so2"], aqi_data["co"], aqi_data["o3"]
        )
        avg_pollutants = {
            "pm25": round(aqi_data["pm25"], 1),
            "pm10": round(aqi_data["pm10"], 1),
            "co": aqi_data["co"],
            "so2": aqi_data["so2"],
            "no2": aqi_data["no2"],
            "o3": aqi_data["o3"]
        }
        
        weather = await _fetch_live_weather(lat, lng)
        if not weather:
            weather = {"temperature_c": None, "wind_speed_kmh": None}
            
        ward = {
            "id": ward_id,
            "name": f"Custom Location ({lat:.4f}, {lng:.4f})",
            "center": [lat, lng],
            "vulnerable": {"hospitals": 1, "schools": 2, "elderly_pct": 10}
        }
        sources = get_sources_for_city(nearest_city)
        return advisory_agent.run(
            ward, avg_aqi, lang,
            pollutants=avg_pollutants,
            weather=weather,
            sources=sources
        )

    # Standard city ward
    resolved_city = city
    resolved_ward_id = ward_id
    if "_" in ward_id:
        parts = ward_id.split("_")
        if parts[0] in CITIES:
            resolved_city = parts[0]
            resolved_ward_id = parts[0]
            
    if resolved_city == "all":
        resolved_city = DEFAULT_CITY
        resolved_ward_id = DEFAULT_CITY
        
    wards = _city_wards(resolved_city)
    ward = next((w for w in wards if w["id"] == resolved_ward_id), wards[0])
    readings = await sim.generate_readings(resolved_city)
    ward_readings = [r for r in readings if r["ward_id"] == resolved_ward_id]
    
    avg_aqi = round(
        sum(r["aqi"] for r in ward_readings) / max(len(ward_readings), 1), 1
    )
    
    avg_pollutants = {}
    if ward_readings:
        keys = ward_readings[0]["pollutants"].keys()
        for k in keys:
            avg_pollutants[k] = round(sum(r["pollutants"][k] for r in ward_readings) / len(ward_readings), 2)
            
    city_state = await sim.get_city_state(resolved_city)
    weather = city_state.get("weather", {})
    sources = city_state.get("sources", [])
    
    return advisory_agent.run(
        ward, avg_aqi, lang, 
        pollutants=avg_pollutants, 
        weather=weather, 
        sources=sources
    )


@app.get("/api/alerts")
async def get_alerts(city: str = Query(default=DEFAULT_CITY)):
    """Return all active alerts where AQI exceeds the safe threshold."""
    keys = [city]
    if city == "all":
        keys = [c["key"] for c in sim.get_available_cities()]
        
    import asyncio
    readings_list = await asyncio.gather(*(sim.generate_readings(k) for k in keys))
    
    alerts = []
    for k, readings in zip(keys, readings_list):
        wards = _city_wards(k)
        for r in readings:
            if r["aqi"] > 100:
                level = (
                    "severe" if r["aqi"] > 300
                    else "very_poor" if r["aqi"] > 200
                    else "poor" if r["aqi"] > 150
                    else "moderate"
                )
                ward = next((w for w in wards if w["id"] == r["ward_id"]), None)
                alerts.append({
                    "sensor_id": f"{r['sensor_id']} ({k.capitalize()})",
                    "ward": f"{ward['name'] if ward else r['ward_id']} ({k.capitalize()})",
                    "aqi": r["aqi"],
                    "level": level,
                    "timestamp": r["timestamp"],
                })
    alerts.sort(key=lambda x: -x["aqi"])
    return {"alerts": alerts, "count": len(alerts)}


@app.get("/api/wards")
def get_wards(city: str = Query(default=DEFAULT_CITY)):
    """Return the list of wards for a city."""
    return {"wards": _city_wards(city)}


@app.get("/api/aqi-details")
async def get_aqi_details(
    lat: float,
    lng: float,
    name: str,
    country: str = "",
    state: str = ""
):
    """Fetch live AQI and weather details for any latitude and longitude and compute Indian AQI."""
    from simulation import _fetch_real_aqi, _fetch_live_weather, calculate_indian_aqi, calculate_us_aqi, is_in_india
    
    aqi_data = await _fetch_real_aqi(lat, lng)
    if not aqi_data:
        # Fallback estimation
        aqi_data = {
            "aqi": 50,
            "pm25": 12.0,
            "pm10": 25.0,
            "no2": 15.0,
            "so2": 4.0,
            "co": 0.3,
            "o3": 25.0,
            "source": "estimation (fallback)"
        }
    
    pm25 = aqi_data["pm25"]
    pm10 = aqi_data["pm10"]
    # No scaling applied so raw API values are used directly

    # Calculate Indian AQI
    aqi_in = calculate_indian_aqi(
        pm25,
        pm10,
        aqi_data["no2"],
        aqi_data["so2"],
        aqi_data["co"],
        aqi_data["o3"]
    )
    
    # Calculate US AQI
    aqi_us = calculate_us_aqi(
        pm25,
        pm10,
        aqi_data["no2"],
        aqi_data["so2"],
        aqi_data["co"],
        aqi_data["o3"]
    )
    
    weather = await _fetch_live_weather(lat, lng)
    if not weather:
        weather = {"temperature_c": None, "wind_speed_kmh": None}
        
    return {
        "id": f"custom_{lat:.4f}_{lng:.4f}".replace(".", "_"),
        "name": name,
        "state": state,
        "country": country,
        "center": [lat, lng],
        "current_aqi": round(aqi_in, 1),
        "aqi_in": round(aqi_in, 1),
        "aqi_us": round(aqi_us, 1),
        "weather": weather,
        "pollutants": {
            "pm25": round(pm25, 1),
            "pm10": round(pm10, 1),
            "co": aqi_data["co"],
            "so2": aqi_data["so2"],
            "no2": aqi_data["no2"],
            "o3": aqi_data["o3"]
        }
    }

# Serve static React frontend files from the built dist folder
frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/dist"))
if os.path.exists(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

@app.get("/")
def serve_home():
    index_file = os.path.join(frontend_dist, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "AQI Intervention Platform Backend Running. Build frontend to view dashboard."}

@app.get("/{catchall:path}")
def serve_static(catchall: str):
    if catchall.startswith("api/") or catchall.startswith("docs") or catchall.startswith("openapi.json"):
        return None
    index_file = os.path.join(frontend_dist, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "Not Found"}

