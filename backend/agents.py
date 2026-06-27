"""
Multi-Agent Intelligence Layer
================================
Implements the four core AI agents:
  1. AttributionAgent  — Pollution source identification via inverse-distance weighting
  2. PredictiveAgent   — AQI forecasting (delegates to SimulationEngine)
  3. EnforcementAgent  — Prioritised dispatch generation with evidence packages
  4. AdvisoryAgent     — Multi-lingual citizen health advisory generation
"""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Dict, List, Optional


# ── Utility ───────────────────────────────────────────────────────────────────

def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance (km) between two lat/lng points."""
    R = 6371.0  # Earth radius in kilometres
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ── Source Attribution Agent ──────────────────────────────────────────────────

class AttributionAgent:
    """Identifies probable pollution sources for a queried location using
    inverse-distance-weighted attribution against known emission sources."""

    CATEGORY_LABELS: Dict[str, str] = {
        "industrial": "Industrial Emissions",
        "vehicular": "Vehicular Traffic",
        "construction": "Construction Dust",
        "waste_burning": "Waste Burning",
    }

    def run(
        self,
        lat: float,
        lng: float,
        sources: List[Dict[str, Any]],
        readings: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        # Get pollutants and weather from the nearest reading
        pollutants = None
        weather = None
        nearest_aqi = 0
        city_name = ""
        if readings:
            try:
                nearest_reading = min(readings, key=lambda r: _haversine(lat, lng, r["location"][0], r["location"][1]))
                pollutants = nearest_reading.get("pollutants")
                weather = nearest_reading.get("weather")
                nearest_aqi = nearest_reading.get("aqi_in", nearest_reading.get("aqi", 0))
                city_name = nearest_reading.get("sensor_id", "")
            except Exception:
                pass

        boosts = {"industrial": 1.0, "vehicular": 1.0, "construction": 1.0, "waste_burning": 1.0}
        pollutant_signals: Dict[str, Any] = {}

        if pollutants:
            pm25 = pollutants.get("pm25", 0.0)
            pm10 = pollutants.get("pm10", 0.0)
            no2 = pollutants.get("no2", 0.0)
            so2 = pollutants.get("so2", 0.0)
            co = pollutants.get("co", 0.0)

            # High NO2 or CO → vehicular
            if no2 > 40.0 or co > 1.0:
                boosts["vehicular"] += 1.5 * max(no2 / 40.0, co / 1.0)

            # High SO2 or PM2.5+SO2 combo → industrial
            if so2 > 20.0:
                boosts["industrial"] += 2.0 * (so2 / 20.0)
            elif pm25 > 50.0 and so2 > 10.0:
                boosts["industrial"] += 1.5

            # High PM10/PM2.5 ratio → construction/road dust
            if pm25 > 0:
                ratio = pm10 / pm25
                if ratio > 1.8 and pm10 > 50.0:
                    boosts["construction"] += 1.5 * (ratio - 1.0)

            # High PM2.5/PM10 ratio → waste/crop burning
            if pm10 > 0:
                ratio = pm25 / pm10
                if ratio > 0.6 and pm25 > 60.0:
                    boosts["waste_burning"] += 1.8 * (ratio / 0.6)

            # Build per-pollutant signal descriptions
            if pm25 > 0:
                if pm25 > 120:    level = "Hazardous"
                elif pm25 > 60:   level = "Very High"
                elif pm25 > 30:   level = "Elevated"
                else:             level = "Moderate"
                pollutant_signals["PM2.5"] = {"value": round(pm25, 1), "unit": "µg/m³", "level": level,
                    "note": "Fine particles that penetrate deep into lungs. CPCB safe limit: 60 µg/m³ (24h avg)."}

            if pm10 > 0:
                if pm10 > 350:    level = "Hazardous"
                elif pm10 > 150:  level = "Very High"
                elif pm10 > 50:   level = "Elevated"
                else:             level = "Moderate"
                pollutant_signals["PM10"] = {"value": round(pm10, 1), "unit": "µg/m³", "level": level,
                    "note": "Coarse dust (road dust, construction, soil). CPCB safe limit: 100 µg/m³."}

            if no2 > 10:
                if no2 > 180:     level = "Hazardous"
                elif no2 > 80:    level = "Very High"
                elif no2 > 40:    level = "Elevated"
                else:             level = "Background"
                pollutant_signals["NO₂"] = {"value": round(no2, 1), "unit": "µg/m³", "level": level,
                    "note": "Nitrogen dioxide — mainly from vehicle exhaust and power plants."}

            if so2 > 5:
                if so2 > 380:     level = "Hazardous"
                elif so2 > 80:    level = "Very High"
                elif so2 > 40:    level = "Elevated"
                else:             level = "Background"
                pollutant_signals["SO₂"] = {"value": round(so2, 1), "unit": "µg/m³", "level": level,
                    "note": "Sulphur dioxide — signature of coal combustion and industrial stacks."}

            if co > 0.3:
                co_ppm = co / 1.145  # rough mg/m³ → ppm
                if co > 10:       level = "Hazardous"
                elif co > 2:      level = "Very High"
                elif co > 1:      level = "Elevated"
                else:             level = "Background"
                pollutant_signals["CO"] = {"value": round(co, 2), "unit": "mg/m³", "level": level,
                    "note": "Carbon monoxide — incomplete combustion in traffic and burning."}

        # ── Source attribution (inverse-distance weighting) ──
        contributions: Dict[str, float] = {}
        total_weight = 0.0
        nearby_sources_detail: List[Dict[str, Any]] = []

        for source in sources:
            dist = _haversine(lat, lng, source["location"][0], source["location"][1])
            if dist > 10:
                continue
            base_weight = 1.0 / max(dist, 0.1)
            weight = base_weight * boosts.get(source["category"], 1.0)
            contributions[source["category"]] = contributions.get(source["category"], 0) + weight
            total_weight += weight

            # Collect nearby source detail for the "where it's coming from" section
            nearby_sources_detail.append({
                "id": source.get("id", ""),
                "name": source["name"],
                "category": source["category"],
                "label": self.CATEGORY_LABELS.get(source["category"], source["category"].title()),
                "distance_km": round(dist, 2),
                "emission_rate_Q": source.get("Q", 0),
                "stack_height_m": source.get("H", 0),
                "weight_share": round(weight, 3),
                "location": source["location"],
            })

        # Sort by weight contribution (highest impact first)
        nearby_sources_detail.sort(key=lambda x: -x["weight_share"])

        if total_weight == 0:
            return {
                "sources": [
                    {"category": "background", "label": "Background / Natural",
                     "percentage": 100, "confidence": 0.50}
                ],
                "nearby_sources": [],
                "pollutant_signals": pollutant_signals,
                "conditions": {},
                "narrative": "No significant emission sources detected within 10 km. Air quality is influenced by regional background levels.",
                "location": [lat, lng],
                "aqi": nearest_aqi,
                "timestamp": datetime.now().isoformat(),
            }

        result: List[Dict[str, Any]] = []
        for cat, w in sorted(contributions.items(), key=lambda x: -x[1]):
            pct = round((w / total_weight) * 100, 1)
            conf = round(min(0.95, 0.60 + (w / total_weight) * 0.35), 2)
            result.append({
                "category": cat,
                "label": self.CATEGORY_LABELS.get(cat, cat.title()),
                "percentage": pct,
                "confidence": conf,
            })

        # ── Atmospheric conditions that amplify/suppress pollution ──
        ws_kmh = None
        wd_deg = None
        temp_c = None
        if weather:
            ws_kmh = weather.get("wind_speed_kmh")
            wd_deg = weather.get("wind_direction_deg")
            temp_c = weather.get("temperature_c")

        # Estimate boundary layer / inversion from time of day
        now = datetime.now()
        hour = now.hour
        angle = ((hour - 10) / 24) * 2 * math.pi
        inversion_m = round(700 - 400 * math.cos(angle))
        stagnant = ws_kmh is not None and ws_kmh < 8.0
        low_inversion = inversion_m < 500

        # Cardinal wind direction label
        wd_label = ""
        if wd_deg is not None:
            dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]
            wd_label = dirs[round(wd_deg / 22.5) % 16]

        conditions = {
            "wind_speed_kmh": ws_kmh,
            "wind_direction_deg": wd_deg,
            "wind_direction_label": wd_label,
            "temperature_c": temp_c,
            "inversion_height_m": inversion_m,
            "is_stagnant": stagnant,
            "has_low_inversion": low_inversion,
            "hour_of_day": hour,
        }

        # ── Plain-language narrative ──
        dominant_cat = result[0]["category"] if result else "unknown"
        dominant_pct = result[0]["percentage"] if result else 0
        dominant_label = result[0]["label"] if result else "Unknown"
        top_source = nearby_sources_detail[0] if nearby_sources_detail else None

        narrative_parts = []

        # Opening: what's driving it
        if pollutants:
            pm25 = pollutants.get("pm25", 0)
            pm10 = pollutants.get("pm10", 0)
            no2 = pollutants.get("no2", 0)
            so2 = pollutants.get("so2", 0)

            dominant_pollutant = "PM2.5" if pm25 >= pm10 else "PM10"
            narrative_parts.append(
                f"The dominant pollutant driving the AQI of {round(nearest_aqi)} is {dominant_pollutant} "
                f"at {round(pm25 if dominant_pollutant == 'PM2.5' else pm10, 1)} µg/m³"
                f"{' — well above the CPCB 24h safe limit' if (pm25 > 60 or pm10 > 100) else ''}."
            )

        # Source attribution narrative
        if top_source:
            narrative_parts.append(
                f"{dominant_label} accounts for {dominant_pct}% of local emissions. "
                f"The highest-impact source is '{top_source['name']}' at {top_source['distance_km']} km "
                f"({'directly upwind' if stagnant else 'nearby'})."
            )
            if len(nearby_sources_detail) > 1:
                second = nearby_sources_detail[1]
                narrative_parts.append(
                    f"Secondary contributor: '{second['name']}' ({second['label']}, {second['distance_km']} km away) "
                    f"adding {result[1]['percentage'] if len(result) > 1 else '~' }% to the total load."
                )

        # Atmospheric conditions
        if stagnant and low_inversion:
            narrative_parts.append(
                f"Atmospheric conditions are severely unfavourable: wind speed is only {ws_kmh:.1f} km/h "
                f"and the inversion layer is low at ~{inversion_m}m, trapping pollutants near the surface."
            )
        elif stagnant:
            narrative_parts.append(
                f"Low wind speed ({ws_kmh:.1f} km/h) is reducing dispersion, allowing pollutants to accumulate."
            )
        elif low_inversion:
            narrative_parts.append(
                f"A shallow boundary layer (~{inversion_m}m) is limiting vertical mixing despite adequate wind."
            )
        else:
            if ws_kmh is not None:
                narrative_parts.append(
                    f"Wind at {ws_kmh:.1f} km/h from {wd_label} is providing moderate dispersion, "
                    f"limiting further accumulation."
                )

        # Time-of-day context
        if 6 <= hour <= 9:
            narrative_parts.append("Morning rush hour is likely amplifying vehicular emissions.")
        elif 17 <= hour <= 20:
            narrative_parts.append("Evening traffic peak and dropping temperatures are worsening conditions.")
        elif 22 <= hour or hour <= 5:
            narrative_parts.append("Nighttime boundary layer compression is concentrating overnight emissions.")

        narrative = " ".join(narrative_parts)

        return {
            "sources": result,
            "nearby_sources": nearby_sources_detail[:6],  # top 6 closest sources
            "pollutant_signals": pollutant_signals,
            "conditions": conditions,
            "narrative": narrative,
            "location": [lat, lng],
            "aqi": nearest_aqi,
            "timestamp": datetime.now().isoformat(),
        }


# ── Predictive AQI Agent ─────────────────────────────────────────────────────

class PredictiveAgent:
    """Generates 24-72 hour hyperlocal AQI forecasts by delegating
    to the SimulationEngine's dispersion-aware forecast model."""

    def run(self, sim_engine: Any, hours: int = 24) -> List[Dict[str, Any]]:
        return sim_engine.generate_forecast(hours)


# ── Enforcement Intelligence Agent ───────────────────────────────────────────

class EnforcementAgent:
    """Generates prioritised enforcement dispatch recommendations
    with evidence packages for field inspectors."""

    THRESHOLDS = {"severe": 85, "very_poor": 70, "poor": 50}

    def run(
        self,
        readings: List[Dict[str, Any]],
        sources: List[Dict[str, Any]],
        wards: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        hotspots: List[Dict[str, Any]] = []

        for reading in readings:
            if reading["aqi"] < self.THRESHOLDS["poor"]:
                continue

            severity = (
                "severe"
                if reading["aqi"] >= self.THRESHOLDS["severe"]
                else "very_poor"
                if reading["aqi"] >= self.THRESHOLDS["very_poor"]
                else "poor"
            )

            ward = next(
                (w for w in wards if w["id"] == reading["ward_id"]), None
            )

            # Find nearby emission sources sorted by distance
            nearby: List[Dict[str, Any]] = []
            for src in sources:
                dist = _haversine(
                    reading["location"][0], reading["location"][1],
                    src["location"][0], src["location"][1],
                )
                if dist < 5:
                    nearby.append({**src, "distance_km": round(dist, 2)})
            nearby.sort(key=lambda x: x["distance_km"])

            # Priority scoring with vulnerability multipliers
            priority_score = float(reading["aqi"])
            vuln_flags: List[str] = []
            if ward:
                vuln = ward.get("vulnerable", {})
                if vuln.get("hospitals", 0) >= 3:
                    priority_score *= 1.3
                    vuln_flags.append(f"🏥 {vuln['hospitals']} hospitals at risk")
                if vuln.get("schools", 0) >= 5:
                    priority_score *= 1.15
                    vuln_flags.append(f"🏫 {vuln['schools']} schools nearby")
                if vuln.get("elderly_pct", 0) >= 15:
                    priority_score *= 1.2
                    vuln_flags.append(f"👴 {vuln['elderly_pct']}% elderly population")

            # Dominant pollutant analysis
            pollutants = reading.get("pollutants", {})
            pm25 = pollutants.get("pm25", 0)
            pm10 = pollutants.get("pm10", 0)
            no2  = pollutants.get("no2", 0)
            so2  = pollutants.get("so2", 0)
            co   = pollutants.get("co", 0)

            dominant_pollutant = "PM2.5" if pm25 >= pm10 else "PM10"
            pollutant_exceedances: List[str] = []
            if pm25 > 60:
                pollutant_exceedances.append(f"PM2.5 {pm25:.1f} µg/m³ (safe: 60)")
            if pm10 > 100:
                pollutant_exceedances.append(f"PM10 {pm10:.1f} µg/m³ (safe: 100)")
            if no2 > 40:
                pollutant_exceedances.append(f"NO₂ {no2:.1f} µg/m³ (safe: 40)")
            if so2 > 40:
                pollutant_exceedances.append(f"SO₂ {so2:.1f} µg/m³ (safe: 40)")
            if co > 2:
                pollutant_exceedances.append(f"CO {co:.2f} mg/m³ (safe: 2)")

            # Inferred source categories from pollutant signatures
            inferred_sources: List[str] = []
            if no2 > 40 or co > 1.0:
                inferred_sources.append("Vehicular (elevated NO₂/CO)")
            if so2 > 20 or (pm25 > 50 and so2 > 10):
                inferred_sources.append("Industrial stacks (elevated SO₂)")
            if pm25 > 0 and pm10 > 0 and (pm10 / max(pm25, 0.1)) > 1.8:
                inferred_sources.append("Construction/road dust (PM10:PM2.5 ratio)")
            if pm10 > 0 and pm25 > 0 and (pm25 / max(pm10, 0.1)) > 0.6 and pm25 > 60:
                inferred_sources.append("Waste/crop burning (PM2.5:PM10 ratio)")

            hotspots.append({
                "sensor_id": reading["sensor_id"],
                "ward_id": reading["ward_id"],
                "ward_name": ward["name"] if ward else "Unknown",
                "location": reading["location"],
                "aqi": reading["aqi"],
                "severity": severity,
                "priority_score": round(priority_score, 1),
                "dominant_pollutant": dominant_pollutant,
                "pollutant_exceedances": pollutant_exceedances,
                "inferred_sources": inferred_sources,
                "vulnerability_flags": vuln_flags,
                "nearby_sources": nearby,
                "recommended_actions": self._recommend(severity, nearby),
                "status": "pending",
                "evidence": {
                    "aqi_reading": reading["aqi"],
                    "pollutants": pollutants,
                    "timestamp": reading["timestamp"],
                    "coordinates": reading["location"],
                },
            })

        hotspots.sort(key=lambda x: -x["priority_score"])
        return {
            "dispatches": hotspots,
            "total_hotspots": len(hotspots),
            "severe_count": sum(1 for h in hotspots if h["severity"] == "severe"),
            "very_poor_count": sum(1 for h in hotspots if h["severity"] == "very_poor"),
            "poor_count": sum(1 for h in hotspots if h["severity"] == "poor"),
            "generated_at": datetime.now().isoformat(),
        }

    @staticmethod
    def _recommend(severity: str, nearby: List[Dict[str, Any]]) -> List[str]:
        actions: List[str] = []
        cats = {s["category"] for s in nearby}
        if "industrial" in cats:
            actions.append("Inspect industrial stack emissions compliance & stack height logs")
        if "construction" in cats:
            actions.append("Verify dust suppression (water spraying, covered trucks, site barriers)")
        if "vehicular" in cats:
            actions.append("Deploy traffic management & odd-even/green corridor restrictions")
        if "waste_burning" in cats:
            actions.append("Investigate & immediately halt open waste / crop burning")
        if not actions:
            actions.append("Deploy mobile monitoring unit for on-ground source identification")
        if severity == "severe":
            actions.insert(0, "🚨 URGENT: Issue health advisory & consider school/office closures")
        elif severity == "very_poor":
            actions.insert(0, "⚠️ Issue public advisory for sensitive groups (elderly, children, respiratory patients)")
        return actions


# ── Citizen Advisory Agent ────────────────────────────────────────────────────

class AdvisoryAgent:
    """Generates localised, multi-lingual citizen health advisories."""

    LANGUAGES: Dict[str, str] = {
        "en": "English",
        "hi": "Hindi",
        "kn": "Kannada",
        "ta": "Tamil",
        "te": "Telugu",
    }

    _ADVISORIES: Dict[str, Dict[str, str]] = {
        "good": {
            "en": "Air quality is satisfactory. Enjoy outdoor activities.",
            "hi": "वायु गुणवत्ता संतोषजनक है। बाहरी गतिविधियों का आनंद लें।",
            "kn": "ವಾಯು ಗುಣಮಟ್ಟ ತೃಪ್ತಿಕರವಾಗಿದೆ. ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳನ್ನು ಆನಂದಿಸಿ.",
            "ta": "காற்றின் தரம் திருப்திகரமாக உள்ளது. வெளிப்புற நடவடிக்கைகளை அனுபவியுங்கள்.",
            "te": "వాయు నాణ్యత సంతృప్తికరంగా ఉంది. అవుట్‌డోర్ కార్యకలాపాలను ఆనందించండి.",
        },
        "satisfactory": {
            "en": "Air quality is acceptable. Unusually sensitive people should limit outdoor exertion.",
            "hi": "वायु गुणवत्ता स्वीकार्य है। अत्यधिक संवेदनशील लोगों को बाहरी परिश्रम सीमित करना चाहिए।",
            "kn": "ವಾಯು ಗುಣಮಟ್ಟ ಸ್ವೀಕಾರಾರ್ಹ. ಅತಿ ಸೂಕ್ಷ್ಮ ವ್ಯಕ್ತಿಗಳು ಹೊರಾಂಗಣ ಶ್ರಮ ಮಿತಿಗೊಳಿಸಬೇಕು.",
            "ta": "காற்றின் தரம் ஏற்றுக்கொள்ளத்தக்கது. மிகவும் உணர்திறன் உள்ளவர்கள் வெளிப்புற உழைப்பைக் கட்டுப்படுத்தவும்.",
            "te": "వాయు నాణ్యత ఆమోదయోగ్యంగా ఉంది. సున్నితమైన వ్యక్తులు శారీరక శ్రమను పరిమితం చేయాలి.",
        },
        "moderate": {
            "en": "Air quality is moderate. Sensitive groups should limit prolonged outdoor exertion.",
            "hi": "वायु गुणवत्ता मध्यम है। संवेदनशील समूहों को लंबे समय तक बाहरी परिश्रम सीमित करना चाहिए।",
            "kn": "ವಾಯು ಗುಣಮಟ್ಟ ಮಧ್ಯಮವಾಗಿದೆ. ಸೂಕ್ಷ್ಮ ಗುಂಪುಗಳು ಹೊರಾಂಗಣ ಶ್ರಮವನ್ನು ಮಿತಿಗೊಳಿಸಬೇಕು.",
            "ta": "காற்றின் தரம் மிதமானது. உணர்திறன் குழுக்கள் நீடித்த வெளிப்புற உழைப்பைக் கட்டுப்படுத்த வேண்டும்.",
            "te": "వాయు నాణ్యత సాధారణంగా ఉంది. సున్నితమైన వ్యక్తులు ఎక్కువ సమయం ఆరుబయట గడపడం పరిమితం చేయాలి.",
        },
        "poor": {
            "en": "⚠️ Air quality is poor. Avoid outdoor exercise. Wear masks if outside.",
            "hi": "⚠️ वायु गुणवत्ता खराब है। बाहरी व्यायाम से बचें। बाहर होने पर मास्क पहनें।",
            "kn": "⚠️ ವಾಯು ಗುಣಮಟ್ಟ ಕಳಪೆಯಾಗಿದೆ. ಹೊರಾಂಗಣ ವ್ಯಾಯಾಮ ಬೇಡ. ಮಾಸ್ಕ್ ಧರಿಸಿ.",
            "ta": "⚠️ காற்றின் தரம் மோசமாக உள்ளது. வெளிப்புற உடற்பயிற்சியைத் தவிர்க்கவும். முகக்கவசம் அணியவும்.",
            "te": "⚠️ వాయు నాణ్యత క్షీణించింది. బయట వ్యాయామం నివారించండి. తప్పనిసరిగా మాస్క్ ధరించండి.",
        },
        "very_poor": {
            "en": "🔴 Air quality is very poor. Stay indoors. Close windows. Keep medication ready.",
            "hi": "🔴 वायु गुणवत्ता बहुत खराब है। घर के अंदर रहें। खिड़कियां बंद करें।",
            "kn": "🔴 ವಾಯು ಗುಣಮಟ್ಟ ತುಂಬಾ ಕಳಪೆ. ಒಳಗೆ ಇರಿ. ಕಿಟಕಿ ಮುಚ್ಚಿ.",
            "ta": "🔴 காற்றின் தரம் மிகவும் மோசம். வீட்டிற்குள் இருங்கள். ஜன்னல்களை மூடுங்கள்.",
            "te": "🔴 వాయు నాణ్యత చాలా దారుణంగా ఉంది. ఇంట్లోనే ఉండండి. కిటికీలు మూసి ఉంచండి.",
        },
        "severe": {
            "en": "🚨 SEVERE: Hazardous air quality. Stay indoors. Close all openings. Use air purifiers. Seek medical help if breathing difficulty occurs.",
            "hi": "🚨 गंभीर: खतरनाक वायु गुणवत्ता। घर के अंदर रहें। सभी खिड़कियां बंद करें। एयर प्यूरीफायर का उपयोग करें।",
            "kn": "🚨 ತೀವ್ರ: ಅಪಾಯಕಾರಿ ವಾಯು ಗುಣಮಟ್ಟ. ಒಳಗೆ ಇರಿ. ಎಲ್ಲಾ ಕಿಟಕಿ ಮುಚ್ಚಿ. ಏರ್ ಪ್ಯೂರಿಫೈಯರ್ ಬಳಸಿ.",
            "ta": "🚨 கடுமையான: ஆபத்தான காற்றின் தரம். வீட்டிற்குள் இருங்கள். அனைத்து ஜன்னல்களையும் மூடுங்கள்.",
            "te": "🚨 అత్యంత ప్రమాదకర వాయు నాణ్యత! ఇంట్లోనే ఉండండి. కిటికీలు, తలుపులు పూర్తిగా మూసేసి ఎయిర్ ప్యూరిఫైయర్ వాడండి.",
        },
    }

    def run(
        self,
        ward: Dict[str, Any],
        aqi: float,
        lang: str = "en",
        pollutants: Dict[str, float] = None,
        weather: Dict[str, Any] = None,
        sources: List[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        level = self._aqi_level(aqi)
        advisory_text = self._ADVISORIES[level].get(
            lang, self._ADVISORIES[level]["en"]
        )

        precautions: List[str] = []
        if aqi > 100:
            precautions.extend(
                ["Wear N95 mask outdoors", "Keep windows and doors closed"]
            )
        if aqi > 200:
            precautions.extend(
                [
                    "Avoid all outdoor activities",
                    "Use air purifier if available",
                    "Seek medical attention if breathing difficulty occurs",
                ]
            )
        if aqi > 300:
            precautions.append(
                "EMERGENCY: Consider temporary relocation from affected area"
            )

        # Dynamic Reason / Driver Analysis Explanation
        dominant = "PM2.5"
        if pollutants:
            # Determine dominant pollutant by scaling relative to standard limits
            ratios = {
                "PM2.5": pollutants.get("pm25", 0) / 60.0,
                "PM10": pollutants.get("pm10", 0) / 100.0,
                "NO₂": pollutants.get("no2", 0) / 80.0,
                "SO₂": pollutants.get("so2", 0) / 80.0,
                "CO": pollutants.get("co", 0) / 2.0,
                "O₃": pollutants.get("o3", 0) / 100.0
            }
            dominant = max(ratios, key=ratios.get)

        ws_kmh = weather.get("wind_speed_kmh") if weather else None
        stagnant = ws_kmh is not None and ws_kmh < 8.0

        nearby_sources = []
        if sources and "center" in ward:
            for s in sources:
                dist = _haversine(ward["center"][0], ward["center"][1], s["location"][0], s["location"][1])
                if dist < 6.0:
                    nearby_sources.append(s["name"])

        explanations = {
            "en": {
                "intro": f"The primary driver of the current air pollution is {dominant}.",
                "weather": " Stagnant wind conditions are preventing the dispersion of pollutants.",
                "sources": f" Emissions from nearby sources like {', '.join(nearby_sources[:2])} are contributing significantly.",
                "background": " High regional background levels are keeping the index elevated."
            },
            "hi": {
                "intro": f"वर्तमान वायु प्रदूषण का मुख्य कारक {dominant} है।",
                "weather": " हवा की गति धीमी होने के कारण प्रदूषक बिखर नहीं पा रहे हैं।",
                "sources": f" आस-पास के स्रोतों जैसे {', '.join(nearby_sources[:2])} से उत्सर्जन का महत्वपूर्ण योगदान है।",
                "background": " क्षेत्रीय पृष्ठभूमि के उच्च स्तर भी सूचकांक को बढ़ाए हुए हैं।"
            },
            "kn": {
                "intro": f"ಪ್ರಸ್ತುತ ವಾಯು ಮಾಲಿನ್ಯಕ್ಕೆ ಮುಖ್ಯ ಕಾರಣವೆಂದರೆ {dominant}.",
                "weather": " ಗಾಳಿಯ ವೇಗ ಕಡಿಮೆಯಿರುವುದರಿಂದ ಮಾಲಿನ್ಯಕಾರಕಗಳು ಚದುರಿಹೋಗುತ್ತಿಲ್ಲ.",
                "sources": f" ಹತ್ತಿರದ ಮೂಲಗಳಾದ {', '.join(nearby_sources[:2])} ಇವುಗಳಿಂದ ಬರುವ ಹೊಗೆಯು ಗಮನಾರ್ಹ ಕೊಡುಗೆ ನೀಡುತ್ತಿದೆ.",
                "background": " ಪ್ರಾದೇಶಿಕ ಹಿನ್ನೆಲೆ ಮಟ್ಟವು ಸಹ ಸೂಚ್ಯಂಕವನ್ನು ಹೆಚ್ಚಾಗಿರಿಸಿದೆ."
            },
            "ta": {
                "intro": f"தற்போதைய காற்று மாசுபாட்டிற்கு முக்கிய காரணி {dominant} ஆகும்.",
                "weather": " காற்றின் வேகம் குறைவாக இருப்பதால் மாசுக்கள் பரవ முடியாமல் தேங்கி நிற்கின்றன.",
                "sources": f" அருகிலுள்ள {', '.join(nearby_sources[:2])} போன்ற உமிழ்வு ஆதாரங்கள் கணிசமான பங்களிப்பை அளிக்கின்றன.",
                "background": " பிராந்திய பின்னணி மாசு அளவும் குறியீட்டை உயர்த்திய நிலையில் வைத்துள்ளது."
            },
            "te": {
                "intro": f"ప్రస్తుత వాయు కాలుష్యానికి ప్రధాన కారణం {dominant}.",
                "weather": " గాలి వేగం చాలా తక్కువగా ఉండటం వల్ల కాలుష్య కారకాలు విస్తరించడం లేదు.",
                "sources": f" సమీపంలోని {', '.join(nearby_sources[:2])} వంటి ఉద్గారాల మూలాలు దీనికి ఎక్కువగా దోహదం చేస్తున్నాయి.",
                "background": " ప్రాంతీయ కాలుష్య స్థాయిలు ఎక్కువగా ఉండటమే దీనికి కారణం."
            }
        }

        lang_key = lang if lang in explanations else "en"
        exp = explanations[lang_key]

        reason_text = exp["intro"]
        if stagnant:
            reason_text += exp["weather"]
        if nearby_sources:
            reason_text += exp["sources"]
        else:
            reason_text += exp["background"]

        return {
            "ward_id": ward["id"],
            "ward_name": ward["name"],
            "aqi": aqi,
            "level": level,
            "language": self.LANGUAGES.get(lang, "English"),
            "language_code": lang,
            "advisory": advisory_text,
            "reason": reason_text,
            "precautions": precautions,
            "vulnerable_info": ward.get("vulnerable", {}),
            "generated_at": datetime.now().isoformat(),
        }

    @staticmethod
    def _aqi_level(aqi: float) -> str:
        if aqi <= 50:
            return "good"
        if aqi <= 100:
            return "satisfactory"
        if aqi <= 200:
            return "moderate"
        if aqi <= 300:
            return "poor"
        if aqi <= 400:
            return "very_poor"
        return "severe"
