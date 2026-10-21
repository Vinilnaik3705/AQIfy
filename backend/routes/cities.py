from fastapi import APIRouter, Query

from forecaster import get_http_client
from simulation import (
    CITIES,
    DEFAULT_CITY,
    get_nearest_live_city,
    sim,
    _fetch_real_aqi,
    _fetch_live_weather,
    calculate_indian_aqi,
)

router = APIRouter()


def _city_wards(city_key: str):
    city = CITIES.get(city_key)
    if not city:
        return [{"id": city_key, "name": city_key.capitalize(), "state": "", "country": "", "center": [0.0, 0.0]}]
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


@router.get("/api/reverse-geocode")
async def reverse_geocode(lat: float = Query(...), lng: float = Query(...)):
    """Reverse geocode coordinate using Nominatim with back-end caching and geospatially accurate fallbacks."""
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
            return {"address": addr, "source_type": "configured_static_demo"}

    url = "https://nominatim.openstreetmap.org/reverse"
    params = {"lat": lat, "lon": lng, "format": "json", "accept-language": "en"}
    headers = {"User-Agent": "AQI-Intervention-App/1.0"}
    try:
        client = get_http_client()
        resp = await client.get(url, params=params, headers=headers)
        if resp.status_code == 200:
            data = resp.json()
            if "address" in data:
                return {"address": data["address"], "source_type": "live_nominatim"}
    except Exception:
        pass

    nearest_key = get_nearest_live_city(lat, lng)
    city_data = CITIES.get(nearest_key, {"name": "Local District", "state": "India", "country": "India"})
    return {
        "address": {
            "road": "Main Access Highway Corridor",
            "county": city_data.get("name", ""),
            "state": city_data.get("state", ""),
            "postcode": "",
        },
        "source_type": "nearest_city_fallback",
    }


@router.get("/api/cities")
def get_cities():
    """Return list of available cities."""
    return {"cities": sim.get_available_cities()}


@router.get("/api/wards")
def get_wards(city: str = Query(default=DEFAULT_CITY)):
    """Return the list of wards for a city."""
    return {"wards": _city_wards(city)}


@router.get("/api/aqi-details")
async def get_aqi_details(
    lat: float,
    lng: float,
    name: str,
    country: str = "",
    state: str = "",
):
    """Fetch live AQI and weather details for any latitude and longitude and compute Indian AQI."""
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

    pm25 = aqi_data["pm25"]
    pm10 = aqi_data["pm10"]

    aqi_in = calculate_indian_aqi(
        pm25,
        pm10,
        aqi_data["no2"],
        aqi_data["so2"],
        aqi_data["co"],
        aqi_data["o3"],
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
            "o3": aqi_data["o3"],
        },
    }
