import asyncio
import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query, Request
from auth import require_roles
from database import User, UserRole

from forecaster import get_http_client
from routes.cities import _city_wards
from simulation import (
    CITIES,
    DEFAULT_CITY,
    get_nearest_live_city,
    get_sources_for_city,
    sim,
    _fetch_real_aqi,
    _fetch_live_weather,
    calculate_indian_aqi,
)
from singletons import (
    attribution_agent,
    predictive_agent,
    enforcement_agent,
    advisory_agent,
)

router = APIRouter()


def _city_sources(city_key: str):
    return get_sources_for_city(city_key)


@router.post("/api/agents/attribution")
async def run_attribution(
    lat: float = Query(...),
    lng: float = Query(...),
    city: str = Query(default=DEFAULT_CITY),
):
    """Run the Source Attribution Agent for a specific coordinate."""
    resolved_city = city
    if city == "all":
        resolved_city = get_nearest_live_city(lat, lng)

    readings = await sim.generate_readings(resolved_city)
    sources = _city_sources(resolved_city)
    return attribution_agent.run(lat, lng, sources, readings)


@router.post("/api/agents/dispatch")
async def run_dispatch(
    city: str = Query(default=DEFAULT_CITY),
    current_user: User = Depends(require_roles(UserRole.INSPECTOR.value, UserRole.AUTHORITY.value, UserRole.ADMIN.value)),
):
    """Run the Enforcement Intelligence Agent."""
    if city == "all":
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
            "timestamp": readings_list[0][0]["timestamp"] if readings_list and readings_list[0] else None,
        }
    readings = await sim.generate_readings(city)
    sources = _city_sources(city)
    wards = _city_wards(city)
    return enforcement_agent.run(readings, sources, wards)


@router.post("/api/agents/advisory")
async def run_advisory(
    ward_id: str = Query(...),
    lang: str = Query(default="en"),
    city: str = Query(default=DEFAULT_CITY),
    profile: str = Query(default="healthy_adult"),
):
    """Run the Citizen Advisory Agent for a specific ward and language."""
    if ward_id.startswith("custom_"):
        try:
            parts = ward_id.split("_")
            lat = float(f"{parts[1]}.{parts[2]}")
            lng = float(f"{parts[3]}.{parts[4]}")
        except Exception:
            lat, lng = CITIES[DEFAULT_CITY]["center"]

        nearest_city = get_nearest_live_city(lat, lng)

        aqi_data = await _fetch_real_aqi(lat, lng)
        if not aqi_data:
            aqi_data = {
                "aqi": 50,
                "pm25": 12.0,
                "pm10": 25.0,
                "no2": 15.0,
                "so2": 4.0,
                "co": 0.3,
                "o3": 25.0,
                "source": "estimation (fallback)",
            }

        avg_aqi = calculate_indian_aqi(
            aqi_data["pm25"],
            aqi_data["pm10"],
            aqi_data["no2"],
            aqi_data["so2"],
            aqi_data["co"],
            aqi_data["o3"],
        )
        avg_pollutants = {
            "pm25": round(aqi_data["pm25"], 1),
            "pm10": round(aqi_data["pm10"], 1),
            "co": aqi_data["co"],
            "so2": aqi_data["so2"],
            "no2": aqi_data["no2"],
            "o3": aqi_data["o3"],
        }

        weather = await _fetch_live_weather(lat, lng)
        if not weather:
            weather = {"temperature_c": None, "wind_speed_kmh": None}

        ward = {
            "id": ward_id,
            "name": f"Custom Location ({lat:.4f}, {lng:.4f})",
            "center": [lat, lng],
            "vulnerable": {"hospitals": 1, "schools": 2, "elderly_pct": 10},
        }
        sources = get_sources_for_city(nearest_city)
        return await advisory_agent.run(
            ward,
            avg_aqi,
            lang,
            pollutants=avg_pollutants,
            weather=weather,
            sources=sources,
            profile=profile,
        )

    resolved_city = city
    resolved_ward_id = ward_id
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

    return await advisory_agent.run(
        ward,
        avg_aqi,
        lang,
        pollutants=avg_pollutants,
        weather=weather,
        sources=sources,
        profile=profile,
    )


@router.post("/api/health-assistant")
async def health_assistant(request: Request):
    try:
        data = await request.json()
        question = data.get("question", "")
        lang = data.get("lang", "en")
        aqi = data.get("aqi", 50.0)
        city_name = data.get("city_name", "Delhi")
        ward_name = data.get("ward_name", "Delhi")

        gemini_api_key = os.environ.get("GEMINI_API_KEY")
        if not gemini_api_key:
            return {"response": "Gemini API key is not configured. Please add GEMINI_API_KEY in the .env file to enable the health assistant."}

        lang_names = {
            "en": "English",
            "hi": "Hindi",
            "kn": "Kannada",
            "ta": "Tamil",
            "te": "Telugu",
            "ml": "Malayalam",
            "mr": "Marathi",
            "gu": "Gujarati",
            "bn": "Bengali",
        }
        lang_name = lang_names.get(lang, "English")

        prompt = f"""You are a professional medical and environmental health assistant.
    Provide general educational information and safety precautions only; do not diagnose, prescribe, or replace a clinician.
The user is asking a question about the health effects of air pollution or the current Air Quality Index (AQI).
Current Context:
- Location: {ward_name}, {city_name}
- Current AQI: {aqi}

User's Question: "{question}"

Please provide your response in the language '{lang_name}' (language code: '{lang}').
Address their specific question directly.

Format your output EXACTLY as a JSON object with these keys:
"response": "<A highly professional, helpful, and easy-to-understand response in {lang_name} addressing their question. Length: 2-3 sentences>"
"precautions": ["<Specific precaution 1 in {lang_name} based on their question>", "<Specific precaution 2 in {lang_name} based on their question>"]

IMPORTANT: Return ONLY the raw JSON object. Do not wrap it in markdown block quotes or include backticks like ```json.
"""

        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_api_key}"
        headers = {"Content-Type": "application/json"}
        payload = {
            "contents": [{
                "parts": [{"text": prompt}]
            }]
        }

        client = get_http_client()
        resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code == 200:
            res_data = resp.json()
            text_response = res_data["candidates"][0]["content"]["parts"][0]["text"].strip()

            if text_response.startswith("```"):
                text_response = text_response.split("```")[1]
                if text_response.startswith("json"):
                    text_response = text_response[4:]
            text_response = text_response.strip()

            try:
                import json
                parsed = json.loads(text_response)
                return {
                    "response": parsed.get("response", ""),
                    "precautions": parsed.get("precautions", []),
                }
            except Exception:
                return {"response": text_response, "precautions": []}
        return {
            "response": f"Gemini API Error: received status code {resp.status_code}",
            "precautions": [],
        }
    except Exception as e:
        return {
            "response": f"Error communicating with Gemini: {str(e)}",
            "precautions": [],
        }
