"""Geocoding service boundary."""

from routes.cities import reverse_geocode as implementation


async def reverse_geocode(lat: float, lng: float):
    return await implementation(lat=lat, lng=lng)
