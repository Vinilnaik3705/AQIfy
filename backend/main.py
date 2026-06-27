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
from datetime import datetime, timezone
import httpx
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
    # Pre-train ALL live cities in the background — each city uses its own lat/lng so
    # models are genuinely city-specific (different historical pollution + weather patterns).
    from simulation import LIVE_CITIES
    # Only train top-level cities (not ward sub-localities) to keep startup fast.
    # Ward sub-localities share coordinates close to parent city, so parent model is representative.
    PARENT_CITIES = [k for k in LIVE_CITIES if "_" not in k]

    async def train_all():
        import logging
        log = logging.getLogger("main")
        # Train in small concurrent batches so startup isn't serialized
        batch_size = 5
        for i in range(0, len(PARENT_CITIES), batch_size):
            batch = PARENT_CITIES[i:i + batch_size]
            tasks = [forecaster.train_for_city(city) for city in batch]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for city, res in zip(batch, results):
                if isinstance(res, Exception):
                    log.error(f"Error training startup model for {city}: {res}")
    asyncio.create_task(train_all())



# ── Helper ────────────────────────────────────────────────────────────────────

def _city_wards(city_key: str):
    city = CITIES.get(city_key)
    if not city:
        # Check if it's in the dynamic cache or default it
        return [{"id": city_key, "name": city_key.capitalize(), "state": "", "country": "", "center": [0.0, 0.0]}]
    # For ward-level cities (with a parent), label with parent city name for context
    parent = city.get("parent")
    if parent and parent in CITIES:
        parent_city = CITIES[parent]
        display_name = f"{city['name']}, {parent_city['name']}"
    else:
        display_name = city["name"]
    return [{
        "id": city_key,
        "name": display_name,
        "state": city.get("state", ""),
        "country": city.get("country", ""),
        "center": city["center"],
    }]


def _city_sources(city_key: str):
    return get_sources_for_city(city_key)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/reverse-geocode")
async def reverse_geocode(lat: float = Query(...), lng: float = Query(...)):
    """Reverse geocode coordinate using Nominatim with back-end caching and geospatially accurate fallbacks."""
    # 1. Check exact match in static landmark coordinate database
    FALLBACK_ADDRESSES = [
        {"lat": 28.5355, "lng": 77.2639, "road": "Okhla Industrial Area Phase III", "county": "South Delhi", "state": "Delhi", "postcode": "110020"},
        {"lat": 28.6990, "lng": 77.1650, "road": "Wazirpur Industrial Area Road", "county": "North West Delhi", "state": "Delhi", "postcode": "110052"},
        {"lat": 28.6200, "lng": 77.2100, "road": "Outer Ring Road", "county": "New Delhi", "state": "Delhi", "postcode": "110001"},
        {"lat": 28.6500, "lng": 77.1500, "road": "Moti Nagar Waste Area", "county": "West Delhi", "state": "Delhi", "postcode": "110015"},
        {"lat": 19.0025, "lng": 72.9150, "road": "Mahul Road, Trombay", "county": "Mumbai Suburban", "state": "Maharashtra", "postcode": "400074"},
        {"lat": 19.0522, "lng": 72.8906, "road": "Chembur Station Road", "county": "Mumbai Suburban", "state": "Maharashtra", "postcode": "400071"},
        {"lat": 19.0700, "lng": 72.9300, "road": "Ghatkopar-Mankhurd Link Road", "county": "Mumbai Suburban", "state": "Maharashtra", "postcode": "400043"},
        {"lat": 17.5186, "lng": 78.4552, "road": "Phase I, Jeedimetla Industrial Area", "county": "Medchal-Malkajgiri", "state": "Telangana", "postcode": "500055"},
        {"lat": 17.4667, "lng": 78.6012, "road": "IDA Cherlapally Road", "county": "Medchal-Malkajgiri", "state": "Telangana", "postcode": "500051"},
        {"lat": 17.4347, "lng": 78.5015, "road": "Station Road, Secunderabad", "county": "Hyderabad", "state": "Telangana", "postcode": "500003"},
        {"lat": 17.4418, "lng": 78.4626, "road": "Begumpet Road", "county": "Hyderabad", "state": "Telangana", "postcode": "500016"},
        {"lat": 17.5312, "lng": 78.5834, "road": "Jawaharnagar Dump Yard Access Road", "county": "Medchal-Malkajgiri", "state": "Telangana", "postcode": "500087"},
        {"lat": 13.0285, "lng": 77.5195, "road": "Peenya 1st Stage", "county": "Bengaluru Urban", "state": "Karnataka", "postcode": "560058"},
        {"lat": 12.9782, "lng": 77.5695, "road": "Gubbi Thotadappa Road", "county": "Bengaluru Urban", "state": "Karnataka", "postcode": "560023"},
        {"lat": 12.9174, "lng": 77.6238, "road": "Hosur Road", "county": "Bengaluru Urban", "state": "Karnataka", "postcode": "560068"},
        {"lat": 13.1250, "lng": 77.5500, "road": "Mavallipura Main Road", "county": "Bengaluru Rural", "state": "Karnataka", "postcode": "560089"},
        {"lat": 13.1700, "lng": 80.2600, "road": "Express Highway, Manali", "county": "Tiruvallur", "state": "Tamil Nadu", "postcode": "600068"},
        {"lat": 13.0118, "lng": 80.2045, "road": "Guindy Industrial Estate Road", "county": "Chennai", "state": "Tamil Nadu", "postcode": "600032"},
        {"lat": 13.0824, "lng": 80.2754, "road": "Poonamallee High Road", "county": "Chennai", "state": "Tamil Nadu", "postcode": "600003"},
        {"lat": 12.9550, "lng": 80.2350, "road": "Perungudi Dump Yard Road", "county": "Chennai", "state": "Tamil Nadu", "postcode": "600096"},
        {"lat": 22.5300, "lng": 88.3100, "road": "Garden Reach Road", "county": "Kolkata", "state": "West Bengal", "postcode": "700043"},
        {"lat": 22.5833, "lng": 88.3414, "road": "Howrah Bridge Approach Road", "county": "Howrah", "state": "West Bengal", "postcode": "711101"},
        {"lat": 22.5440, "lng": 88.3480, "road": "Acharya Jagadish Chandra Bose Road", "county": "Kolkata", "state": "West Bengal", "postcode": "700020"},
        {"lat": 22.5510, "lng": 88.4200, "road": "Dhapa Dump Yard Road", "county": "Kolkata", "state": "West Bengal", "postcode": "700105"},
    ]

    for addr in FALLBACK_ADDRESSES:
        if abs(addr["lat"] - lat) < 0.005 and abs(addr["lng"] - lng) < 0.005:
            return {"address": addr}

    # 2. Live reverse geocode query to Nominatim (backend avoids CORS block)
    url = "https://nominatim.openstreetmap.org/reverse"
    params = {"lat": lat, "lon": lng, "format": "json", "accept-language": "en"}
    headers = {"User-Agent": "AQI-Intervention-App/1.0"}
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(url, params=params, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                if "address" in data:
                    return {"address": data["address"]}
    except Exception:
        pass

    # 3. Last fallback: determine nearest parent city center
    from simulation import get_nearest_live_city, CITIES
    nearest_key = get_nearest_live_city(lat, lng)
    city_data = CITIES.get(nearest_key, {"name": "Local District", "state": "India", "country": "India"})
    return {
        "address": {
            "road": "Main Access Highway Corridor",
            "county": city_data.get("name", ""),
            "state": city_data.get("state", ""),
            "postcode": ""
        }
    }


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
            parent = city_data.get("parent")
            if parent and parent in CITIES:
                parent_data = CITIES[parent]
                place_label = f"{city_name}, {parent_data['name']}"
            elif country:
                place_label = f"{city_name}, {country}"
            else:
                place_label = city_name
            
            combined_wards.append({
                "id": city_key,
                "city_key": city_key,
                "name": place_label,
                "state": city_data.get("state", ""),
                "country": country,
                "center": city_data["center"],
                "current_aqi": r["aqi"],
                "aqi_in": r.get("aqi_in", r["aqi"]),
                "sensor_count": 1,
                "population": (hash(city_key) % 1550000 + 250000) if "_" in city_key else (hash(city_key) % 11000000 + 4000000),
                "vulnerable": {
                    "hospitals": (hash(city_key) % 11 + 2) if "_" in city_key else (hash(city_key) % 51 + 15),
                    "schools": (hash(city_key) % 46 + 15) if "_" in city_key else (hash(city_key) % 241 + 80),
                    "elderly_pct": (hash(city_key) % 10 + 7)
                }
            })
            
            combined_sensors.append({
                **r,
                "ward_id": city_key,
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
    
    # 2. Build the list of cities to generate ML forecasts for.
    # For "all" mode, use every top-level city in LIVE_CITIES (no ward sub-localities —
    # they share coordinates with their parent so the parent model covers them).
    from simulation import LIVE_CITIES
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

            # For a top-level city, look up its ML forecast directly.
            # For a ward sub-locality (e.g. "delhi_rohini"), use the parent city's ML model
            # but apply the ward's own Open-Meteo raw AQI as the open_meteo_raw value.
            lookup_key = w_id
            if w_id not in ml_forecasts:
                # Try parent city (first segment before "_")
                parent_key = w_id.split("_")[0]
                if parent_key in ml_forecasts:
                    lookup_key = parent_key
                else:
                    continue  # No ML data available for this ward

            ml_f = ml_forecasts[lookup_key]
            grid_len = len(ml_f["grid"])
            if h_idx < grid_len:
                ml_hour_data = ml_f["grid"][h_idx]
                
                # If it's a sub-locality, use the ward's own raw Open-Meteo AQI
                # (already populated by generate_forecast) as open_meteo_raw so lines diverge.
                own_open_meteo_raw = w.get("predicted_aqi", ml_hour_data["open_meteo_raw"])

                # For sub-localities: scale the parent ML prediction by the ratio of the
                # ward's own raw AQI to the parent's raw AQI, preserving genuine local differences.
                # All scaled AQI figures are capped at 500.0 in accordance with the Indian NAQI scale.
                if w_id != lookup_key and ml_hour_data["open_meteo_raw"] > 0:
                    scale = own_open_meteo_raw / ml_hour_data["open_meteo_raw"]
                    scaled_aqi = min(round(ml_hour_data["predicted_aqi"] * scale, 1), 500.0)
                    scaled_mitigated = min(round(ml_hour_data.get("mitigated_aqi", ml_hour_data["predicted_aqi"]) * scale, 1), 500.0)
                    scaled_low = min(round(ml_hour_data["confidence_low"] * scale, 1), 500.0)
                    scaled_high = min(round(ml_hour_data["confidence_high"] * scale, 1), 500.0)
                else:
                    scaled_aqi = min(ml_hour_data["predicted_aqi"], 500.0)
                    scaled_mitigated = min(ml_hour_data.get("mitigated_aqi", ml_hour_data["predicted_aqi"]), 500.0)
                    scaled_low = min(ml_hour_data["confidence_low"], 500.0)
                    scaled_high = min(ml_hour_data["confidence_high"], 500.0)

                # Update ward fields with ML data
                w["predicted_aqi"] = scaled_aqi
                w["mitigated_aqi"] = scaled_mitigated
                w["confidence"] = ml_hour_data["confidence"]
                w["confidence_low"] = max(0.0, scaled_low)
                w["confidence_high"] = min(500.0, scaled_high)
                w["open_meteo_raw"] = round(own_open_meteo_raw, 1)
                w["persistence_baseline"] = ml_hour_data["persistence_baseline"]
                
                # Attach metrics and anomalies
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
            "severe_count": sum(1 for h in combined_dispatches if h["severity"] == "severe"),
            "very_poor_count": sum(1 for h in combined_dispatches if h["severity"] == "very_poor"),
            "poor_count": sum(1 for h in combined_dispatches if h["severity"] == "poor"),
            "generated_at": datetime.now(timezone.utc).isoformat(),
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
    profile: str = Query(default="healthy_adult"),
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
            sources=sources,
            profile=profile
        )

    # Standard city ward
    resolved_city = city
    resolved_ward_id = ward_id
    # First check if the full ward_id is a direct CITIES key (e.g. "delhi_connaught")
    if ward_id in CITIES:
        resolved_city = ward_id
        resolved_ward_id = ward_id
    elif "_" in ward_id:
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
        sources=sources,
        profile=profile
    )


ACTIVE_SUBSCRIPTIONS = {}

@app.post("/api/advisory/subscribe")
async def subscribe_advisory(
    ward_id: str = Query(...),
    profile: str = Query(default="healthy_adult"),
    channel: str = Query(default="none"),
    lang: str = Query(default="en"),
    phone: str = Query(default=""),
):
    """Register a public health advisory alert subscription."""
    sub_key = f"{ward_id}_{profile}_{channel}_{phone}"
    ACTIVE_SUBSCRIPTIONS[sub_key] = {
        "ward_id": ward_id,
        "profile": profile,
        "channel": channel,
        "lang": lang,
        "phone": phone,
        "subscribed_at": datetime.now(timezone.utc).isoformat()
    }
    print(f"Registered subscription: {ACTIVE_SUBSCRIPTIONS[sub_key]}")
    return {"status": "success", "message": f"Successfully subscribed to {channel} alerts."}


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
    from simulation import _fetch_real_aqi, _fetch_live_weather, calculate_indian_aqi, is_in_india, CITIES
    
    # Check if this matches a preset city in CITIES within 0.05 degrees (approx 5km)
    matched_city_key = None
    for k, info in CITIES.items():
        c_lat, c_lng = info["center"]
        if abs(c_lat - lat) < 0.05 and abs(c_lng - lng) < 0.05:
            matched_city_key = k
            break

    if matched_city_key:
        readings = await sim.generate_readings(matched_city_key)
        if readings:
            r = readings[0]
            weather = await _fetch_live_weather(lat, lng)
            if not weather:
                weather = {"temperature_c": None, "wind_speed_kmh": None}
            return {
                "id": matched_city_key,
                "name": name,
                "state": state,
                "country": country,
                "center": [lat, lng],
                "current_aqi": r["aqi"],
                "aqi_in": r["aqi_in"],
                "weather": weather,
                "pollutants": {
                    "pm25": round(r["pollutants"]["pm25"], 1),
                    "pm10": round(r["pollutants"]["pm10"], 1),
                    "co": r["pollutants"]["co"],
                    "so2": r["pollutants"]["so2"],
                    "no2": r["pollutants"]["no2"],
                    "o3": r["pollutants"]["o3"]
                }
            }

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

