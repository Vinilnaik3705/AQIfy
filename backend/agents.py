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
from datetime import datetime, timezone
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
                "timestamp": datetime.now(timezone.utc).isoformat(),
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
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }


# ── Predictive AQI Agent ─────────────────────────────────────────────────────

class PredictiveAgent:
    """Generates 24-72 hour hyperlocal AQI forecasts by delegating
    to the SimulationEngine's dispersion-aware forecast model."""

    def run(self, sim_engine: Any, hours: int = 24) -> List[Dict[str, Any]]:
        return sim_engine.generate_forecast(hours)


def _pm25_sub_index(pm25: float) -> float:
    pm25_bp = [
        (0, 30, 0, 50),
        (31, 60, 51, 100),
        (61, 90, 101, 200),
        (91, 120, 201, 300),
        (121, 250, 301, 400),
        (250, 500, 401, 500),
    ]
    for (b_low, b_high, i_low, i_high) in pm25_bp:
        if b_low <= pm25 <= b_high:
            return i_low + (pm25 - b_low) * (i_high - i_low) / (b_high - b_low)
    return 500.0

def _pm10_sub_index(pm10: float) -> float:
    pm10_bp = [
        (0, 50, 0, 50),
        (51, 100, 51, 100),
        (101, 250, 101, 200),
        (251, 350, 201, 300),
        (351, 430, 301, 400),
        (430, 600, 401, 500),
    ]
    for (b_low, b_high, i_low, i_high) in pm10_bp:
        if b_low <= pm10 <= b_high:
            return i_low + (pm10 - b_low) * (i_high - i_low) / (b_high - b_low)
    return 500.0


# ── Enforcement Intelligence Agent ───────────────────────────────────────────

class EnforcementAgent:
    """Generates prioritised enforcement dispatch recommendations
    with evidence packages for field inspectors."""

    # Updated to start from moderate (>= 101)
    THRESHOLDS = {"severe": 401, "very_poor": 301, "poor": 201, "moderate": 101}

    def run(
        self,
        readings: List[Dict[str, Any]],
        sources: List[Dict[str, Any]],
        wards: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        hotspots: List[Dict[str, Any]] = []

        for reading in readings:
            if reading["aqi"] < self.THRESHOLDS["moderate"]:
                continue

            severity = (
                "severe"
                if reading["aqi"] >= self.THRESHOLDS["severe"]
                else "very_poor"
                if reading["aqi"] >= self.THRESHOLDS["very_poor"]
                else "poor"
                if reading["aqi"] >= self.THRESHOLDS["poor"]
                else "moderate"
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
                    vuln_flags.append(f"{vuln['hospitals']} hospitals at risk")
                if vuln.get("schools", 0) >= 5:
                    priority_score *= 1.15
                    vuln_flags.append(f"{vuln['schools']} schools nearby")
                if vuln.get("elderly_pct", 0) >= 15:
                    priority_score *= 1.2
                    vuln_flags.append(f"{vuln['elderly_pct']}% elderly population")

            # Dominant pollutant analysis
            pollutants = reading.get("pollutants", {})
            pm25 = pollutants.get("pm25", 0)
            pm10 = pollutants.get("pm10", 0)
            no2  = pollutants.get("no2", 0)
            so2  = pollutants.get("so2", 0)
            co   = pollutants.get("co", 0)

            pm25_sub = _pm25_sub_index(pm25)
            pm10_sub = _pm10_sub_index(pm10)
            dominant_pollutant = "PM2.5" if pm25_sub >= pm10_sub else "PM10"
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
                "recommended_actions": self._recommend(severity, nearby, pollutants),
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
            "moderate_count": sum(1 for h in hotspots if h["severity"] == "moderate"),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _recommend(severity: str, nearby: List[Dict[str, Any]], pollutants: Dict[str, float]) -> List[str]:
        actions: List[str] = []
        cats = {s["category"] for s in nearby}
        
        pm25 = pollutants.get("pm25", 0.0)
        pm10 = pollutants.get("pm10", 0.0)
        no2 = pollutants.get("no2", 0.0)
        so2 = pollutants.get("so2", 0.0)
        o3 = pollutants.get("o3", 0.0)
        co = pollutants.get("co", 0.0)

        # 1. Source-specific actions based on nearby registered emission sources
        if "industrial" in cats:
            if severity in ("severe", "very_poor"):
                actions.append("EMERGENCY AUDIT: Halt operations of non-compliant boilers and solid-fuel combustion in nearby industrial units.")
            else:
                actions.append("Routine stack emission inspection and fuel log audit of local industrial units.")
        
        if "construction" in cats:
            if severity in ("severe", "very_poor"):
                actions.append("TOTAL BAN: Order suspension of all open excavation, demolition, and dry construction activities.")
            else:
                actions.append("Enforce construction site dust mitigation measures (water spraying, wind barriers, material covers).")

        if "vehicular" in cats:
            if severity in ("severe", "very_poor"):
                actions.append("TRAFFIC RESTRICTION: Implement commercial diesel vehicle bans and odd-even vehicle rotation in hotspot sectors.")
            else:
                actions.append("Conduct emission compliance drives and target heavy-traffic junctions to minimize vehicle idling.")

        if "waste_burning" in cats:
            if severity in ("severe", "very_poor"):
                actions.append("CRIMINAL ENFORCEMENT: Prosecute illegal open waste burning at dump sites with maximum statutory penalties.")
            else:
                actions.append("Deploy dedicated municipal patrols to identify and suppress localized garbage/leaf burning.")

        # 2. Pollutant-specific actions (essential when there are no nearby registered sources)
        # Handle particulate matter (dust/smoke)
        if pm25 > 60.0 or pm10 > 100.0:
            if severity in ("severe", "very_poor"):
                actions.append("Deploy high-efficiency anti-smog water cannons and intensive mechanical sweepers on major road corridors.")
            else:
                actions.append("Deploy municipal water sprinklers to control dust on high-traffic roads.")

        # Handle combustion/traffic markers (NO2 / CO)
        if no2 > 40.0 or co > 2.0:
            actions.append("Optimize traffic signal synchronization at congested intersections to lower localized exhaust build-up.")

        # Handle coal/refinery marker (SO2)
        if so2 > 40.0:
            actions.append("Inspect fuel oil sulphur content at nearby commercial heating facilities and backup generators.")

        # Handle ground-level ozone (O3)
        if o3 > 100.0:
            actions.append("Monitor VOC and NOx precursor sources (fuel stations, chemical storages) for leak compliance.")
            if severity in ("severe", "very_poor"):
                actions.append("Advise sensitive populations to restrict afternoon outdoor exposure during peak solar radiation.")

        # 3. Defensive fallbacks if list is too short
        if len(actions) < 2:
            actions.append("Routine air quality monitoring and mechanical dust suppression.")
        if len(actions) < 3:
            actions.append("Deploy mobile air sensor vans to identify temporary sources.")

        # 4. Severity-based general public health safety directives
        if severity == "severe":
            actions.insert(0, "URGENT: Issue health advisory advising citizens to remain indoors and restrict outdoor physical activity.")
        elif severity == "very_poor":
            actions.insert(0, "Issue public warning advising N95 mask usage and avoiding strenuous outdoor exercise.")
        elif severity == "poor":
            actions.insert(0, "Issue health advisory advising sensitive individuals to limit prolonged outdoor exposure.")
            
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

    HEALTH_TIPS = {
        "good": {
            "en": "Keep exercising outdoors to maintain your healthy lifestyle.",
            "hi": "अपने स्वस्थ जीवन को बनाए रखने के लिए बाहर व्यायाम जारी रखें।",
            "kn": "ನಿಮ್ಮ ಆರೋಗ್ಯಕರ ಜೀವನಶೈಲಿಯನ್ನು ಕಾಪಾಡಿಕೊಳ್ಳಲು ಹೊರಾಂಗಣದಲ್ಲಿ ವ್ಯಾಯಾಮ ಮಾಡುವುದನ್ನು ಮುಂದುವರಿಸಿ.",
            "ta": "உங்கள் ஆரோக்கியமான வாழ்க்கை முறையை பராமரிக்க தொடர்ந்து வெளியில் உடற்பயிற்சி செய்யுங்கள்.",
            "te": "మీ ఆరోగ్యకరమైన జీవనశైలిని కాపాడుకోవడానికి అవుట్‌డోర్‌లో వ్యాయామం చేస్తూ ఉండండి."
        },
        "satisfactory": {
            "en": "Ideal time for outdoor activities. Unusually sensitive individuals should monitor symptoms.",
            "hi": "बाहरी गतिविधियों के लिए आदर्श समय। अत्यधिक संवेदनशील लोगों को लक्षणों पर नज़र रखनी चाहिए।",
            "kn": "ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳಿಗೆ ಸೂಕ್ತ ಸಮಯ. ಅತಿ ಸೂಕ್ಷ್ಮ ವ್ಯಕ್ತಿಗಳು ರೋಗಲಕ್ಷಣಗಳನ್ನು ಗಮನಿಸಬೇಕು.",
            "ta": "வெளிப்புற நடவடிக்கைகளுக்கு உகந்த நேரம். மிகவும் உணர்திறன் உள்ளவர்கள் அறிகுறிகளைக் கண்காணிக்க வேண்டும்.",
            "te": "అవుట్‌డోర్ కార్యకలాపాలకు అనుకూలమైన సమయం. సున్నితమైన వ్యక్తులు లక్షణాలను గమనించాలి."
        },
        "moderate": {
            "en": "Consider replacing intense outdoor exercises with indoor workouts.",
            "hi": "तीव्र बाहरी अभ्यासों के स्थान पर घर के अंदर व्यायाम करने पर विचार करें।",
            "kn": "ತೀವ್ರವಾದ ಹೊರಾಂಗಣ ವ್ಯಾಯಾಮಗಳ ಬದಲಿಗೆ ಒಳಾಂಗಣ ವ್ಯಾಯಾಮಗಳನ್ನು ಮಾಡಲು ಪರಿಗಣಿಸಿ.",
            "ta": "தீவிரமான வெளிப்புற உடற்பயிற்சிகளுக்கு பதிலாக வீட்டிற்குள் உடற்பயிற்சி செய்வதை பரிசீலிக்கவும்.",
            "te": "తీవ్రమైన అవుట్‌డోర్ వ్యాయామాలకు బదులుగా ఇండోర్ వ్యాయామాలను పరిగణించండి."
        },
        "poor": {
            "en": "Stay hydrated and consider wearing a mask during commute.",
            "hi": "हाइड्रेटेड रहें और यात्रा के दौरान मास्क पहनने पर विचार करें।",
            "kn": "ಸಾಕಷ್ಟು ನೀರು ಕುಡಿಯಿರಿ ಮತ್ತು ಪ್ರಯಾಣದ ಸಮಯದಲ್ಲಿ ಮಾಸ್ಕ್ ಧರಿಸಲು ಪರಿಗಣಿಸಿ.",
            "ta": "நன்கு தண்ணீர் குடிக்கவும் மற்றும் பயணத்தின் போது முகமூடி அணிவதை பரிசீலிக்கவும்.",
            "te": "హైడ్రేటెడ్‌గా ఉండండి మరియు ప్రయాణ సమయంలో మాస్క్ ధరించడం పరిగణించండి."
        },
        "very_poor": {
            "en": "Avoid prolonged outdoor exposure. Run an air purifier indoors if possible.",
            "hi": "लंबे समय तक बाहर रहने से बचें। यदि संभव हो तो घर के अंदर एयर प्यूरीफायर चलाएं।",
            "kn": "ಹೆಚ್ಚು ಸಮಯದವರೆಗೆ ಹೊರಗೆ ಇರುವುದನ್ನು ತಪ್ಪಿಸಿ. ಸಾಧ್ಯವಾದರೆ ಒಳಾಂಗಣದಲ್ಲಿ ಏರ್ ಪ್ಯೂರಿಫೈಯರ್ ಬಳಸಿ.",
            "ta": "நீண்ட நேரம் வெளியில் செல்வதைத் தவிர்க்கவும். முடிந்தால் வீட்டிற்குள் காற்று சுத்திகரிப்பானை இயக்கவும்.",
            "te": "ఎక్కువ సమయం బయట ఉండటం నివారించండి. వీలైతే ఇండోర్‌లో ఎయిర్ ప్యూరిఫైయర్ వాడండి."
        },
        "severe": {
            "en": "Emergency warning: stay indoors, close all ventilation, and seek medical help if breathing is difficult.",
            "hi": "आपातकालीन चेतावनी: घर के अंदर रहें, सभी वेंटिलेशन बंद करें, और सांस लेने में कठिनाई होने पर डॉक्टर से संपर्क करें।",
            "kn": "ತುರ್ತು ಎಚ್ಚరిಕೆ: ಒಳಾಂಗಣದಲ್ಲೇ ಇರಿ, ಎಲ್ಲಾ ಕಿಟಕಿ-ಬಾಗಿಲು ಮುಚ್ಚಿ, ಮತ್ತು ಉಸಿರಾಟದ ತೊಂದರೆಯಾದರೆ ವೈದ್ಯರನ್ನು ಸಂಪರ್ಕಿಸಿ.",
            "ta": "அவசரகால எச்சரிக்கை: வீட்டிற்குள்ளேயே இருங்கள், அனைத்து கதவு ஜன்னல்களையும் மூடவும், மூச்சுத் திணறல் ஏற்பட்டால் மருத்துவ உதவியை நாடவும்.",
            "te": "అత్యవసర హెచ్చరిక: ఇంట్లోనే ఉండండి, కిటికీలు తలుపులు మూసివేయండి, శ్వాస తీసుకోవడం ఇబ్బందిగా ఉంటే వైద్య సహాయం పొందండి."
        }
    }

    PROFILE_ADVISORIES = {
        "en": {
            "good": {
                "healthy_adult": ("Air quality is good. Enjoy outdoor activities.", ["No mask required", "Keep windows open", "Safe for outdoor activities"]),
                "sensitive": ("Great air quality. Children can play outdoors safely.", ["No mask required", "Keep windows open", "Safe for outdoor activities"]),
                "elderly": ("Air quality is excellent. Ideal time for senior citizens to go for outdoor walks.", ["No mask required", "Keep windows open", "Safe for outdoor activities"]),
                "outdoor_worker": ("Safe working environment. No protective gear required.", ["No mask required", "Keep windows open", "Safe for outdoor activities"]),
                "asthma": ("Air quality is clean. Safe for outdoor activities without worry.", ["No mask required", "Keep windows open", "Safe for outdoor activities"]),
            },
            "satisfactory": {
                "healthy_adult": ("Air quality is acceptable. No special action needed.", ["No mask required", "Windows can remain open", "Normal outdoor activities"]),
                "sensitive": ("Air quality is satisfactory. Sensitive children should monitor symptoms.", ["No mask required", "Windows can remain open", "Normal outdoor activities"]),
                "elderly": ("Air quality is satisfactory. Comfortable for outdoor activities.", ["No mask required", "Windows can remain open", "Normal outdoor activities"]),
                "outdoor_worker": ("Air quality is satisfactory. Safe for normal outdoor shifts.", ["No mask required", "Windows can remain open", "Normal outdoor activities"]),
                "asthma": ("Air quality is satisfactory. Respiratory patients should monitor symptoms.", ["Keep inhaler nearby", "Windows can remain open", "Monitor symptoms during outdoor activities"]),
            },
            "moderate": {
                "healthy_adult": ("Air quality is moderate. Keep outdoor exertion moderate.", ["Mask optional", "Close windows if sensitive", "Moderate outdoor activities"]),
                "sensitive": ("Air quality is moderate. Children should limit outdoor playtime.", ["Mask optional", "Close windows if sensitive", "Limit heavy outdoor exertion"]),
                "elderly": ("Air quality is moderate. Elderly should limit outdoor exertion.", ["Mask optional", "Close windows if sensitive", "Limit heavy outdoor exertion"]),
                "outdoor_worker": ("Air quality is moderate. Outdoor workers should wear face masks.", ["Wear mask if sensitive", "Close windows if sensitive", "Take frequent breaks"]),
                "asthma": ("Air quality is moderate. Asthma patients should limit intense outdoor exercise.", ["Keep inhaler nearby", "Close windows if sensitive", "Avoid intense outdoor exercise"]),
            },
            "poor": {
                "healthy_adult": ("Air quality is poor. Sensitive individuals may experience health effects.", ["Wear N95 mask outdoors", "Keep windows closed", "Avoid prolonged outdoor exertion"]),
                "sensitive": ("Air quality is poor. Children should avoid outdoor activities.", ["Wear N95 mask outdoors", "Keep windows closed", "Avoid outdoor activities"]),
                "elderly": ("Air quality is poor. Elderly should remain indoors.", ["Wear N95 mask outdoors", "Keep windows closed", "Avoid outdoor activities"]),
                "outdoor_worker": ("Air quality is poor. Wear N95 masks and limit shift length.", ["Wear N95 mask outdoors", "Keep windows closed", "Limit outdoor work shifts"]),
                "asthma": ("Air quality is poor. Asthma patients should remain indoors and keep inhalers ready.", ["Wear N95 mask outdoors", "Keep windows closed", "Avoid outdoor exposure, keep inhaler ready"]),
            },
            "very_poor": {
                "healthy_adult": ("Air quality is very poor. Everyone should limit outdoor activities.", ["Wear N95 mask outdoors", "Keep windows closed", "Avoid outdoor exertion"]),
                "sensitive": ("Air quality is very poor. Children must remain indoors.", ["Wear N95 mask outdoors", "Keep windows closed", "Avoid outdoor exertion"]),
                "elderly": ("Air quality is very poor. Senior citizens must remain indoors.", ["Wear N95 mask outdoors", "Keep windows closed", "Avoid outdoor exertion"]),
                "outdoor_worker": ("Air quality is very poor. Essential outdoor workers must use N95 masks.", ["Wear N95 mask outdoors", "Keep windows closed", "Avoid outdoor exertion"]),
                "asthma": ("Air quality is very poor. Respiratory patients must stay indoors.", ["Wear N95 mask outdoors", "Keep windows closed", "Avoid outdoor exertion"]),
            },
            "severe": {
                "healthy_adult": ("Air quality is severe. Avoid all outdoor physical activity.", ["Wear N95 mask outdoors", "Keep windows closed", "Avoid all outdoor activity"]),
                "sensitive": ("Air quality is severe. Children must stay indoors and avoid exertion.", ["Wear N95 mask outdoors", "Keep windows closed", "Avoid all outdoor activity"]),
                "elderly": ("Air quality is severe. Elderly must stay indoors.", ["Wear N95 mask outdoors", "Keep windows closed", "Avoid all outdoor activity"]),
                "outdoor_worker": ("Air quality is severe. Outdoor work should be suspended.", ["Wear N95 mask outdoors", "Keep windows closed", "Avoid all outdoor activity"]),
                "asthma": ("Air quality is severe. Risk of severe asthma attack. Stay indoors.", ["Wear N95 mask outdoors", "Keep windows closed", "Avoid all outdoor activity"]),
            }
        },
        "hi": {
            "good": {
                "healthy_adult": ("वायु गुणवत्ता अच्छी है। बाहरी गतिविधियों का आनंद लें।", ["मास्क की आवश्यकता नहीं", "खिड़कियां खुली रखें", "बाहरी गतिविधियां सुरक्षित हैं"]),
                "sensitive": ("हवा की गुणवत्ता बेहतरीन है। बच्चे सुरक्षित रूप से बाहर खेल सकते हैं।", ["मास्क की आवश्यकता नहीं", "खिड़कियां खुली रखें", "बाहरी गतिविधियां सुरक्षित हैं"]),
                "elderly": ("वायु गुणवत्ता उत्कृष्ट है। वरिष्ठ नागरिकों के लिए टहलने का आदर्श समय।", ["मास्क की आवश्यकता नहीं", "खिड़कियां खुली रखें", "बाहरी गतिविधियां सुरक्षित हैं"]),
                "outdoor_worker": ("सुरक्षित कार्य वातावरण। किसी सुरक्षात्मक गियर की आवश्यकता नहीं है।", ["मास्क की आवश्यकता नहीं", "खिड़कियां खुली रखें", "बाहरी गतिविधियां सुरक्षित हैं"]),
                "asthma": ("वायु गुणवत्ता स्वच्छ है। बिना किसी चिंता के बाहरी गतिविधियों के लिए सुरक्षित है।", ["मास्क की आवश्यकता नहीं", "खिड़कियां खुली रखें", "बाहरी गतिविधियां सुरक्षित हैं"]),
            },
            "satisfactory": {
                "healthy_adult": ("वायु गुणवत्ता स्वीकार्य है। किसी विशेष कार्रवाई की आवश्यकता नहीं है।", ["मास्क की आवश्यकता नहीं", "खिड़कियां खुली रख सकते हैं", "सामान्य बाहरी गतिविधियां"]),
                "sensitive": ("वायु गुणवत्ता संतोषजनक है। संवेदनशील बच्चों को लक्षणों की निगरानी करनी चाहिए।", ["मास्क की आवश्यकता नहीं", "खिड़कियां खुली रख सकते हैं", "सामान्य बाहरी गतिविधियां"]),
                "elderly": ("वायु गुणवत्ता संतोषजनक है। बाहरी गतिविधियों के लिए आरामदायक।", ["मास्क की आवश्यकता नहीं", "खिड़कियां खुली रख सकते हैं", "सामान्य बाहरी गतिविधियां"]),
                "outdoor_worker": ("वायु गुणवत्ता संतोषजनक है। सामान्य बाहरी पालियों के लिए सुरक्षित।", ["मास्क की आवश्यकता नहीं", "खिड़कियां खुली रख सकते हैं", "सामान्य बाहरी गतिविधियां"]),
                "asthma": ("वायु गुणवत्ता संतोषजनक है। श्वसन रोगियों को लक्षणों की निगरानी करनी चाहिए।", ["इनहेलर पास रखें", "खिड़कियां खुली रख सकते हैं", "सामान्य बाहरी गतिविधियां"]),
            },
            "moderate": {
                "healthy_adult": ("वायु गुणवत्ता मध्यम है। बाहरी परिश्रम को सीमित रखें।", ["मास्क वैकल्पिक", "संवेदनशील होने पर खिड़कियां बंद करें", "सीमित बाहरी गतिविधियां"]),
                "sensitive": ("वायु गुणवत्ता मध्यम है। बच्चों को बाहर खेलने का समय सीमित करना चाहिए।", ["मास्क वैकल्पिक", "संवेदनशील होने पर खिड़कियां बंद करें", "सीमित बाहरी गतिविधियां"]),
                "elderly": ("वायु गुणवत्ता मध्यम है। बुजुर्गों को बाहरी परिश्रम सीमित करना चाहिए।", ["मास्क वैकल्पिक", "संवेदनशील होने पर खिड़कियां बंद करें", "सीमित बाहरी गतिविधियां"]),
                "outdoor_worker": ("वायु गुणवत्ता मध्यम है। बाहरी कामगारों को फेस मास्क पहनना चाहिए।", ["मास्क वैकल्पिक", "संवेदनशील होने पर खिड़कियां बंद करें", "सीमित बाहरी गतिविधियां"]),
                "asthma": ("वायु गुणवत्ता मध्यम है। अस्थमा के रोगियों को तीव्र व्यायाम से बचना चाहिए।", ["इनहेलर पास रखें", "संवेदनशील होने पर खिड़कियां बंद करें", "तीव्र बाहरी व्यायाम से बचें"]),
            },
            "poor": {
                "healthy_adult": ("वायु गुणवत्ता खराब है। संवेदनशील लोगों को स्वास्थ्य संबंधी समस्याएं हो सकती हैं।", ["बाहर N95 मास्क पहनें", "खिड़कियां बंद रखें", "बाहरी गतिविधियों से बचें"]),
                "sensitive": ("वायु गुणवत्ता खराब है। बच्चों को बाहरी गतिविधियों से बचना चाहिए।", ["बाहर N95 मास्क पहनें", "खिड़कियां बंद रखें", "बाहरी गतिविधियों से बचें"]),
                "elderly": ("वायु गुणवत्ता खराब है। बुजुर्गों को घर के अंदर रहना चाहिए।", ["बाहर N95 मास्क पहनें", "खिड़कियां बंद रखें", "बाहरी गतिविधियों से बचें"]),
                "outdoor_worker": ("वायु गुणवत्ता खराब है। N95 मास्क पहनें और काम की अवधि सीमित करें।", ["बाहर N95 मास्क पहनें", "खिड़कियां बंद रखें", "कार्य अवधि सीमित करें"]),
                "asthma": ("वायु गुणवत्ता खराब है। अस्थमा रोगी घर के अंदर रहें और इनहेलर तैयार रखें।", ["बाहर N95 मास्क पहनें", "खिड़कियां बंद रखें", "बाहरी गतिविधियों से बचें, इनहेलर रखें"]),
            },
            "very_poor": {
                "healthy_adult": ("वायु गुणवत्ता बहुत खराब है। सभी को बाहरी गतिविधियों को सीमित करना चाहिए।", ["बाहर N95 मास्क पहनें", "खिड़कियां बंद रखें", "बाहरी शारीरिक गतिविधि से बचें"]),
                "sensitive": ("वायु गुणवत्ता बहुत खराब है। बच्चों को घर के अंदर रहना चाहिए।", ["बाहर N95 मास्क पहनें", "खिड़कियां बंद रखें", "बाहरी शारीरिक गतिविधि से बचें"]),
                "elderly": ("वायु गुणवत्ता बहुत खराब है। वरिष्ठ नागरिकों को घर के अंदर रहना चाहिए।", ["बाहर N95 मास्क पहनें", "खिड़कियां बंद रखें", "बाहरी शारीरिक गतिविधि से बचें"]),
                "outdoor_worker": ("वायु गुणवत्ता बहुत खराब है। बाहरी कामगारों को अनिवार्य रूप से N95 मास्क का उपयोग करना चाहिए।", ["बाहर N95 मास्क पहनें", "खिड़कियां बंद रखें", "बाहरी शारीरिक गतिविधि से बचें"]),
                "asthma": ("वायु गुणवत्ता बहुत खराब है। श्वसन रोगियों को घर के अंदर रहना चाहिए।", ["बाहर N95 मास्क पहनें", "खिड़कियां बंद रखें", "बाहरी शारीरिक गतिविधि से बचें"]),
            },
            "severe": {
                "healthy_adult": ("वायु गुणवत्ता गंभीर है। सभी बाहरी शारीरिक गतिविधियों से बचें।", ["बाहर N95 मास्क पहनें", "खिड़कियां बंद रखें", "सभी बाहरी गतिविधियों को निलंबित करें"]),
                "sensitive": ("वायु गुणवत्ता गंभीर है। बच्चे घर के अंदर रहें और परिश्रम से बचें।", ["बाहर N95 मास्क पहनें", "खिड़कियां बंद रखें", "सभी बाहरी गतिविधियों को निलंबित करें"]),
                "elderly": ("वायु गुणवत्ता गंभीर है। बुजुर्गों को घर के अंदर रहना चाहिए।", ["बाहर N95 मास्क पहनें", "खिड़कियां बंद रखें", "सभी बाहरी गतिविधियों को निलंबित करें"]),
                "outdoor_worker": ("वायु गुणवत्ता गंभीर है। बाहरी काम निलंबित किया जाना चाहिए।", ["बाहर N95 मास्क पहनें", "खिड़कियां बंद रखें", "सभी बाहरी गतिविधियों को निलंबित करें"]),
                "asthma": ("वायु गुणवत्ता गंभीर है। गंभीर अस्थमा का खतरा। घर के अंदर रहें।", ["बाहर N95 मास्क पहनें", "खिड़कियां बंद रखें", "सभी बाहरी गतिविधियों को निलंबित करें"]),
            }
        },
        "kn": {
            "good": {
                "healthy_adult": ("ವಾಯು ಗುಣಮಟ್ಟವು ಉತ್ತಮವಾಗಿದೆ. ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳನ್ನು ಆನಂದಿಸಿ.", ["ಮಾಸ್ಕ್ ಅಗತ್ಯವಿಲ್ಲ", "ಕಿಟಕಿಗಳನ್ನು ತೆರೆದಿಡಿ", "ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳು ಸುರಕ್ಷಿತ"]),
                "sensitive": ("ಉತ್ತಮ ಗಾಳಿಯ ಗುಣಮಟ್ಟ. ಮಕ್ಕಳು ಸುರಕ್ಷಿತವಾಗಿ ಹೊರಗೆ ಆಟವಾಡಬಹುದು.", ["ಮಾಸ್ಕ್ ಅಗತ್ಯವಿಲ್ಲ", "ಕಿಟಕಿಗಳನ್ನು ತೆರೆದಿಡಿ", "ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳು ಸುರಕ್ಷಿತ"]),
                "elderly": ("ವಾಯು ಗುಣಮಟ್ಟ ಅತ್ಯುತ್ತಮವಾಗಿದೆ. ಹಿರಿಯ ನಾಗರಿಕರು ಹೊರಗೆ ನಡಿಗೆ ಮಾಡಲು ಸೂಕ್ತ ಸಮಯ.", ["ಮಾಸ್ಕ್ ಅಗತ್ಯವಿಲ್ಲ", "ಕಿಟಕಿಗಳನ್ನು ತೆರೆದಿಡಿ", "ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳು ಸುರಕ್ಷಿತ"]),
                "outdoor_worker": ("ಸುರಕ್ಷಿತ ಕೆಲಸದ ವಾತಾವರಣ. ಯಾವುದೇ ರಕ್ಷಣಾತ್ಮಕ ಗೇರ್ ಅಗತ್ಯವಿಲ್ಲ.", ["ಮಾಸ್ಕ್ ಅಗತ್ಯವಿಲ್ಲ", "ಕಿಟಕಿಗಳನ್ನು ತೆರೆದಿಡಿ", "ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳು ಸುರಕ್ಷಿತ"]),
                "asthma": ("ವಾಯು ಗುಣಮಟ್ಟವು ಸ್ವಚ್ಛವಾಗಿದೆ. ಆತಂಕವಿಲ್ಲದೆ ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳಿಗೆ ಸುರಕ್ಷಿತವಾಗಿದೆ.", ["ಮಾಸ್ಕ್ ಅಗತ್ಯವಿಲ್ಲ", "ಕಿಟಕಿಗಳನ್ನು ತೆರೆದಿಡಿ", "ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳು ಸುರಕ್ಷಿತ"]),
            },
            "satisfactory": {
                "healthy_adult": ("ವಾಯು ಗುಣಮಟ್ಟ ಸ್ವೀಕಾರಾರ್ಹ. ಯಾವುದೇ ವಿಶೇಷ ಕ್ರಮ ಅಗತ್ಯವಿಲ್ಲ.", ["ಮಾಸ್ಕ್ ಅಗತ್ಯವಿಲ್ಲ", "ಕಿಟಕಿಗಳನ್ನು ತೆರೆದಿಡಬಹುದು", "ಸಾಮಾನ್ಯ ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳು"]),
                "sensitive": ("ವಾಯು ಗುಣಮಟ್ಟ ತೃಪ್ತಿಕರ. ಸೂಕ್ಷ್ಮ ಮಕ್ಕಳು ರೋಗಲಕ್ಷಣಗಳನ್ನು ಗಮನಿಸಬೇಕು.", ["ಮಾಸ್ಕ್ ಅಗತ್ಯವಿಲ್ಲ", "ಕಿಟಕಿಗಳನ್ನು ತೆರೆದಿಡಬಹುದು", "ಸಾಮಾನ್ಯ ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳು"]),
                "elderly": ("ವಾಯು ಗುಣಮಟ್ಟ ತೃಪ್ತಿಕರವಾಗಿದೆ. ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗೆ ಆರಾಮದಾಯಕವಾಗಿದೆ.", ["ಮಾಸ್ಕ್ ಅಗತ್ಯವಿಲ್ಲ", "ಕಿಟಕಿಗಳನ್ನು ತೆರೆದಿಡಬಹುದು", "ಸಾಮಾನ್ಯ ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳು"]),
                "outdoor_worker": ("ವಾಯು ಗುಣಮಟ್ಟ ತೃಪ್ತಿಕರವಾಗಿದೆ. ಸಾಮಾನ್ಯ ಹೊರಾಂಗಣ ಕೆಲಸದ ಸಮಯಕ್ಕೆ ಸುರಕ್ಷಿತ.", ["ಮಾಸ್ಕ್ ಅಗತ್ಯವಿಲ್ಲ", "ಕಿಟಕಿಗಳನ್ನು ತೆರೆದಿಡಬಹುದು", "ಸಾಮಾನ್ಯ ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳು"]),
                "asthma": ("ವಾಯು ಗುಣಮಟ್ಟ ತೃಪ್ತಿಕರವಾಗಿದೆ. ಉಸಿರಾటದ ರೋಗಿಗಳು ಲಕ್ಷಣಗಳನ್ನು ಗಮನಿಸಬೇಕು.", ["ಇನ್ಹೇಲರ್ ಹತ್ತಿರ ಇಟ್ಟುಕೊಳ್ಳಿ", "ಕಿಟಕಿಗಳನ್ನು ತೆರೆದಿಡಬಹುದು", "ಸಾಮಾನ್ಯ ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳು"]),
            },
            "moderate": {
                "healthy_adult": ("ವಾಯು ಗುಣಮಟ್ಟ ಮಧ್ಯಮವಾಗಿದೆ. ಹೊರಾಂಗಣ ಶ್ರಮವನ್ನು ಸಾಧಾರಣವಾಗಿರಿಸಿ.", ["ಮಾಸ್ಕ್ ಐಚ್ಛಿಕ", "ಸೂಕ್ಷ್ಮವಾಗಿದ್ದರೆ ಕಿಟಕಿ ಮುಚ್ಚಿ", "ಹೊರಾಂಗಣ ಶ್ರಮ ಮಿತಿಗೊಳಿಸಿ"]),
                "sensitive": ("ವಾಯು ಗುಣಮಟ್ಟ ಮಧ್ಯಮ. ಮಕ್ಕಳು ಹೊರಾಂಗಣ ಆಟದ ಸಮಯವನ್ನು ಮಿತಿಗೊಳಿಸಬೇಕು.", ["ಮಾಸ್ಕ್ ಐಚ್ಛಿಕ", "ಸೂಕ್ಷ್ಮವಾಗಿದ್ದರೆ ಕಿಟಕಿ ಮುಚ್ಚಿ", "ಹೊರಾಂಗಣ ಶ್ರಮ ಮಿತಿಗೊಳಿಸಿ"]),
                "elderly": ("ವಾಯು ಗುಣಮಟ್ಟ ಮಧ್ಯಮ. ಹಿರಿಯರು ಹೊರಾಂಗಣ ಶ್ರಮವನ್ನು ಮಿತಿಗೊಳಿಸಬೇಕು.", ["ಮಾಸ್ಕ್ ಐಚ್ಛಿಕ", "ಸೂಕ್ಷ್ಮವಾಗಿದ್ದರೆ ಕಿಟಕಿ ಮುಚ್ಚಿ", "ಹೊರಾಂಗಣ ಶ್ರಮ ಮಿತಿಗೊಳಿಸಿ"]),
                "outdoor_worker": ("ವಾಯು ಗುಣಮಟ್ಟ ಮಧ್ಯಮ. ಹೊರಗೆ ಕೆಲಸ ಮಾಡುವವರು ಮಾಸ್ಕ್ ಧರಿಸಬೇಕು.", ["ಮಾಸ್ಕ್ ಐಚ್ಛಿಕ", "ಸೂಕ್ಷ್ಮವಾಗಿದ್ದರೆ ಕಿಟಕಿ ಮುಚ್ಚಿ", "ಹೊರಾಂಗಣ ಶ್ರಮ ಮಿತಿಗೊಳಿಸಿ"]),
                "asthma": ("ವಾಯು ಗುಣಮಟ್ಟ ಮಧ್ಯಮ. ಅಸ್ತಮಾ ರೋಗಿಗಳು ತೀವ್ರವಾದ ಹೊರಾಂಗಣ ವ್ಯಾಯಾಮ ಮಿತಿಗೊಳಿಸಬೇಕು.", ["ಇನ್ಹೇಲರ್ ಹತ್ತಿರವಿಡಿ", "ಸೂಕ್ಷ್ಮವಾಗಿದ್ದರೆ ಕಿಟಕಿ ಮುಚ್ಚಿ", "ತೀವ್ರ ಹೊರಾಂಗಣ ವ್ಯಾಯಾಮ ತಪ್ಪಿಸಿ"]),
            },
            "poor": {
                "healthy_adult": ("ವಾಯು ಗುಣಮಟ್ಟ ಕಳಪೆಯಾಗಿದೆ. ಸೂಕ್ಷ್ಮ ವ್ಯಕ್ತಿಗಳು ಆರೋಗ್ಯದ ತೊಂದರೆಗಳನ್ನು ಅನುಭವಿಸಬಹುದು.", ["ಹೊರಗೆ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ", "ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿಡಿ", "ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳನ್ನು ತಪ್ಪಿಸಿ"]),
                "sensitive": ("ವಾಯು ಗುಣಮಟ್ಟ ಕಳಪೆಯಾಗಿದೆ. ಮಕ್ಕಳು ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳನ್ನು ತಪ್ಪಿಸಬೇಕು.", ["ಹೊರಗೆ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ", "ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿಡಿ", "ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳನ್ನು ತಪ್ಪಿಸಿ"]),
                "elderly": ("ವಾಯು ಗುಣಮಟ್ಟ ಕಳಪೆಯಾಗಿದೆ. ಹಿರಿಯರು ಮನೆಯೊಳಗೇ ಇರಬೇಕು.", ["ಹೊರಗೆ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ", "ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿಡಿ", "ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳನ್ನು ತಪ್ಪಿಸಿ"]),
                "outdoor_worker": ("ವಾಯು ಗುಣಮಟ್ಟ ಕಳಪೆಯಾಗಿದೆ. N95 ಮಾಸ್ಕ್ ಧರಿಸಿ ಮತ್ತು ಕೆಲಸದ ಸಮಯ ಮಿತಿಗೊಳಿಸಿ.", ["ಹೊರಗೆ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ", "ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿಡಿ", "ಕೆಲಸದ ಸಮಯ ಮಿತಿಗೊಳಿಸಿ"]),
                "asthma": ("ವಾಯು ಗುಣಮಟ್ಟ ಕಳಪೆ. ಅಸ್ತಮಾ ರೋಗಿಗಳು ಮನೆಯಲ್ಲೇ ಇರಬೇಕು ಮತ್ತು ಇನ್ಹೇಲರ್ ಸಿದ್ಧವಾಗಿಟ್ಟುಕೊಳ್ಳಬೇಕು.", ["ಹೊರಗೆ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ", "ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿಡಿ", "ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆ ತಪ್ಪಿಸಿ, ಇನ್ಹೇಲರ್ ಸಿದ್ಧವಿರಲಿ"]),
            },
            "very_poor": {
                "healthy_adult": ("ವಾಯು ಗುಣಮಟ್ಟವು ತುಂಬಾ ಕಳಪೆಯಾಗಿದೆ. ಪ್ರತಿಯೊಬ್ಬರೂ ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆಗಳನ್ನು ಮಿತಿಗೊಳಿಸಬೇಕು.", ["ಹೊರಗೆ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ", "ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿಡಿ", "ಹೊರಾಂಗಣ ಶ್ರಮವನ್ನು ತಪ್ಪಿಸಿ"]),
                "sensitive": ("ವಾಯು ಗುಣಮಟ್ಟವು ತುಂಬಾ ಕಳಪೆಯಾಗಿದೆ. ಮಕ್ಕಳು ಮನೆಯೊಳಗೇ ಇರಬೇಕು.", ["ಹೊರಗೆ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ", "ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿಡಿ", "ಹೊರಾಂಗಣ ಶ್ರಮವನ್ನು ತಪ್ಪಿಸಿ"]),
                "elderly": ("ವಾಯು ಗುಣಮಟ್ಟವು ತುಂಬಾ ಕಳಪೆಯಾಗಿದೆ. ಹಿರಿಯ ನಾಗರಿಕರು ಮನೆಯೊಳಗೇ ಇರಬೇಕು.", ["ಹೊರಗೆ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ", "ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿಡಿ", "ಹೊರಾಂಗಣ ಶ್ರಮವನ್ನು ತಪ್ಪಿಸಿ"]),
                "outdoor_worker": ("ವಾಯು ಗುಣಮಟ್ಟ ತುಂಬಾ ಕಳಪೆ. ಹೊರಗೆ ಕೆಲಸ ಮಾಡುವವರು ಕಡ್ಡాయವಾಗಿ N95 ಮಾಸ್ಕ್ ಬಳಸಬೇಕು.", ["ಹೊರಗೆ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ", "ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿಡಿ", "ಹೊರಾಂಗಣ ಶ್ರಮವನ್ನು ತಪ್ಪಿಸಿ"]),
                "asthma": ("ವಾಯು ಗುಣಮಟ್ಟವು ತುಂಬಾ ಕಳಪೆಯಾಗಿದೆ. ಉಸಿರಾಟದ ರೋಗಿಗಳು ಮನೆಯೊಳಗೇ ಇರಬೇಕು.", ["ಹೊರಗೆ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ", "ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿಡಿ", "ಹೊರಾಂಗಣ ಶ್ರಮವನ್ನು ತಪ್ಪಿಸಿ"]),
            },
            "severe": {
                "healthy_adult": ("ವಾಯು ಗುಣಮಟ್ಟವು ಗಂಭೀರವಾಗಿದೆ. ಎಲ್ಲಾ ಹೊರಾಂಗಣ ದೈಹಿಕ ಚಟುವಟಿಕೆಗಳನ್ನು ತಪ್ಪಿಸಿ.", ["ಹೊರಗೆ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ", "ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿಡಿ", "ಎಲ್ಲಾ ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆ ಸ್ಥಗಿತಗೊಳಿಸಿ"]),
                "sensitive": ("ವಾಯು ಗುಣಮಟ್ಟ ಗಂಭೀರವಾಗಿದೆ. ಮಕ್ಕಳು ಮನೆಯೊಳಗೇ ಇರಬೇಕು ಮತ್ತು ಶ್ರಮವನ್ನು ತಪ್ಪಿಸಬೇಕು.", ["ಹೊರಗೆ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ", "ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿಡಿ", "ಎಲ್ಲಾ ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆ ಸ್ಥಗಿತಗೊಳಿಸಿ"]),
                "elderly": ("ವಾಯು ಗುಣಮಟ್ಟ ಗಂಭೀರವಾಗಿದೆ. ಹಿರಿಯರು ಮನೆಯೊಳಗೇ ಇರಬೇಕು.", ["ಹೊರಗೆ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ", "ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿಡಿ", "ಎಲ್ಲಾ ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆ ಸ್ಥಗಿತಗೊಳಿಸಿ"]),
                "outdoor_worker": ("ವಾಯು ಗುಣಮಟ್ಟ ಗಂಭೀರವಾಗಿದೆ. ಹೊರಾಂಗಣ ಕೆಲಸವನ್ನು ಸ್ಥಗಿತಗೊಳಿಸಬೇಕು.", ["ಹೊರಗೆ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ", "ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿಡಿ", "ಎಲ್ಲಾ ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆ ಸ್ಥಗಿತಗೊಳಿಸಿ"]),
                "asthma": ("ವಾಯು ಗುಣಮಟ್ಟ ಗಂಭೀರವಾಗಿದೆ. ಉಸಿರಾಟದ ತೊಂದರೆಯ ತೀವ್ರ ಅಪಾಯವಿದೆ. ಮನೆಯಲ್ಲೇ ಇರಿ.", ["ಹೊರಗೆ N95 ಮಾಸ್ಕ್ ಧರಿಸಿ", "ಕಿಟಕಿಗಳನ್ನು ಮುಚ್ಚಿಡಿ", "ಎಲ್ಲಾ ಹೊರಾಂಗಣ ಚಟುವಟಿಕೆ ಸ್ಥಗಿತಗೊಳಿಸಿ"]),
            }
        },
        "ta": {
            "good": {
                "healthy_adult": ("காற்றின் தரம் நன்றாக உள்ளது. வெளிப்புற நடவடிக்கைகளை அனுபவிக்கவும்.", ["முகமூடி தேவையில்லை", "ஜன்னல்களை திறந்து வைக்கவும்", "வெளிப்புற நடவடிக்கைகள் பாதுகாப்பானவை"]),
                "sensitive": ("சிறந்த காற்றின் தரம். குழந்தைகள் பாதுகாப்பாக வெளியில் விளையாடலாம்.", ["முகமூடி தேவையில்லை", "ஜன்னல்களை திறந்து வைக்கவும்", "வெளிப்புற நடவடிக்கைகள் பாதுகாப்பானவை"]),
                "elderly": ("காற்றின் தரம் சிறப்பாக உள்ளது. முதியவர்கள் வெளியே நடைப்பயிற்சி செய்ய உகந்த நேரம்.", ["முகமூடி தேவையில்லை", "ஜன்னல்களை திறந்து வைக்கவும்", "வெளிப்புற நடவடிக்கைகள் பாதுகாப்பானவை"]),
                "outdoor_worker": ("பாதுகாப்பான பணிச்சூழல். பாதுகாப்பு உபகரணங்கள் தேவையில்லை.", ["முகமூடி தேவையில்லை", "ஜன்னல்களை திறந்து வைக்கவும்", "வெளிப்புற நடவடிக்கைகள் பாதுகாப்பானவை"]),
                "asthma": ("காற்று சுத்தமாக உள்ளது. கவலையின்றி வெளிப்புற நடவடிக்கைகளில் ஈடுபடலாம்.", ["முகமூடி தேவையில்லை", "ஜன்னல்களை திறந்து வைக்கவும்", "வெளிப்புற நடவடிக்கைகள் பாதுகாப்பானவை"]),
            },
            "satisfactory": {
                "healthy_adult": ("காற்றின் தரம் ஏற்றுக்கொள்ளத்தக்கது. சிறப்பு நடவடிக்கை தேவையில்லை.", ["முகமூடி தேவையில்லை", "ஜன்னல்களை திறந்து வைக்கலாம்", "சாதாரண வெளிப்புற செயல்பாடுகள்"]),
                "sensitive": ("காற்றின் தரம் திருப்திகரமானது. உணர்திறன் உள்ள குழந்தைகள் அறிகுறிகளைக் கண்காணிக்கவும்.", ["முகமூடி தேவையில்லை", "ஜன்னல்களை திறந்து வைக்கலாம்", "சாதாரண வெளிப்புற செயல்பாடுகள்"]),
                "elderly": ("காற்றின் தரம் திருப்திகரமானது. வெளிப்புற நடவடிக்கைகளுக்கு ஏற்றது.", ["முகமூடி தேவையில்லை", "ஜன்னல்களை திறந்து வைக்கலாம்", "சாதாரண வெளிப்புற செயல்பாடுகள்"]),
                "outdoor_worker": ("காற்றின் தரம் திருப்திகரமானது. சாதாரண வேலை நேரங்களுக்கு பாதுகாப்பானது.", ["முகமூடி தேவையில்லை", "ஜன்னல்களை திறந்து வைக்கலாம்", "சாதாரண வெளிப்புற செயல்பாடுகள்"]),
                "asthma": ("காற்றின் தரம் திருப்திகரமானது. சுவாச நோயாளிகள் அறிகுறிகளைக் கண்காணிக்க வேண்டும்.", ["இன்ஹேலரை அருகில் வைக்கவும்", "ஜன்னல்களை திறந்து வைக்கலாம்", "சாதாரண வெளிப்புற செயல்பாடுகள்"]),
            },
            "moderate": {
                "healthy_adult": ("காற்றின் தரம் மிதமானது. வெளிப்புற உழைப்பை மிதமாக வைக்கவும்.", ["முகமூடி விருப்பத்தேர்வு", "உணர்திறன் இருந்தால் ஜன்னல்களை மூடவும்", "வெளிப்புற உழைப்பைக் குறைக்கவும்"]),
                "sensitive": ("காற்றின் தரம் மிதமானது. குழந்தைகள் வெளியில் விளையாடுவதைக் கட்டுப்படுத்த வேண்டும்.", ["முகமூடி விருப்பத்தேர்வு", "உணர்திறன் இருந்தால் ஜன்னல்களை மூடவும்", "வெளிப்புற உழைப்பைக் குறைக்கவும்"]),
                "elderly": ("காற்றின் தரம் மிதமானது. முதியவர்கள் வெளிப்புற உழைப்பைக் கட்டுப்படுத்த வேண்டும்.", ["முகமூடி விருப்பத்தேர்வு", "உணர்திறன் இருந்தால் ஜன்னல்களை மூடவும்", "வெளிப்புற உழைப்பைக் குறைக்கவும்"]),
                "outdoor_worker": ("காற்றின் தரம் மிதமானது. வெளிப்புறப் பணியாளர்கள் முகமூடி அணிய வேண்டும்.", ["முகமூடி விருப்பத்தேர்வு", "உணர்திறன் இருந்தால் ஜன்னல்களை மூடவும்", "வெளிப்புற உழைப்பைக் குறைக்கவும்"]),
                "asthma": ("காற்றின் தரம் மிதமானது. ஆஸ்துமா நோயாளிகள் தீவிர வெளிப்புற உடற்பயிற்சியைத் தவிர்க்க வேண்டும்.", ["இன்ஹேலரை அருகில் வைக்கவும்", "உணர்திறன் இருந்தால் ஜன்னல்களை மூடவும்", "தீவிர உடற்பயிற்சிகளை தவிர்க்கவும்"]),
            },
            "poor": {
                "healthy_adult": ("காற்றின் தரம் மோசமாக உள்ளது. உணர்திறன் உள்ளவர்களுக்கு உடல்நல பாதிப்புகள் ஏற்படலாம்.", ["வெளியே N95 முகமூடி அணியவும்", "ஜன்னல்களை மூடி வைக்கவும்", "வெளிப்புற நடவடிக்கைகளைத் தவிர்க்கவும்"]),
                "sensitive": ("காற்றின் தரம் மோசமாக உள்ளது. குழந்தைகள் வெளிப்புற நடவடிக்கைகளைத் தவிர்க்க வேண்டும்.", ["வெளியே N95 முகமூடி அணியவும்", "ஜன்னல்களை மூடி வைக்கவும்", "வெளிப்புற நடவடிக்கைகளைத் தவிர்க்கவும்"]),
                "elderly": ("காற்றின் தரம் மோசமாக உள்ளது. முதியவர்கள் வீட்டிற்குள்ளேயே இருக்க வேண்டும்.", ["வெளியே N95 முகமூடி அணியவும்", "ஜன்னல்களை மூடி வைக்கவும்", "வெளிப்புற நடவடிக்கைகளைத் தவிர்க்கவும்"]),
                "outdoor_worker": ("காற்றின் தரம் மோசமாக உள்ளது. N95 முகமூடிகளை அணியவும், வேலை நேரத்தைக் குறைக்கவும்.", ["வெளியே N95 முகமூடி அணியவும்", "ஜன்னல்களை மூடி வைக்கவும்", "வேலை நேரத்தைக் குறைக்கவும்"]),
                "asthma": ("காற்றின் தரம் மோசமானது. ஆஸ்துமா நோயாளிகள் வீட்டிற்குள் இருக்க வேண்டும், இன்ஹேலரை தயார் நிலையில் வைக்க வேண்டும்.", ["வெளியே N95 முகமூடி அணியவும்", "ஜன்னல்களை மூடி வைக்கவும்", "வெளியே செல்வதை தவிர்க்கவும், இன்ஹேலர் வைக்கவும்"]),
            },
            "very_poor": {
                "healthy_adult": ("காற்றின் தரம் மிகவும் மோசமாக உள்ளது. அனைவரும் வெளிப்புற நடவடிக்கைகளைக் கட்டுப்படுத்த வேண்டும்.", ["வெளியே N95 முகமூடி அணியவும்", "ஜன்னல்களை மூடி வைக்கவும்", "வெளிப்புற உழைப்பைத் தவிர்க்கவும்"]),
                "sensitive": ("காற்றின் தரம் மிகவும் மோசமாக உள்ளது. குழந்தைகள் வீட்டிற்குள்ளேயே இருக்க வேண்டும்.", ["வெளியே N95 முகமூடி அணியவும்", "ஜன்னல்களை மூடி வைக்கவும்", "வெளிப்புற உழைப்பைத் தவிர்க்கவும்"]),
                "elderly": ("காற்றின் தரம் மிகவும் மோசமாக உள்ளது. முதியவர்கள் வீட்டிற்குள்ளேயே இருக்க வேண்டும்.", ["வெளியே N95 முகமூடி அணியவும்", "ஜன்னல்களை மூடி வைக்கவும்", "வெளிப்புற உழைப்பைத் தவிர்க்கவும்"]),
                "outdoor_worker": ("காற்றின் தரம் மிகவும் மோசமானது. வெளியில் பணிபுரிபவர்கள் கட்டாயம் N95 முகமூடி அணிய வேண்டும்.", ["வெளியே N95 முகமூடி அணியவும்", "ஜன்னல்களை மூடி வைக்கவும்", "வெளிப்புற உழைப்பைத் தவிர்க்கவும்"]),
                "asthma": ("காற்றின் தரம் மிகவும் மோசமாக உள்ளது. சுவாச நோயாளிகள் வீட்டிற்குள்ளேயே இருக்க வேண்டும்.", ["வெளியே N95 முகமூடி அணியவும்", "ஜன்னல்களை மூடி வைக்கவும்", "வெளிப்புற உழைப்பைத் தவிர்க்கவும்"]),
            },
            "severe": {
                "healthy_adult": ("காற்றின் தரம் கடுமையானது. அனைத்து வெளிப்புற உடல் செயல்பாடுகளையும் தவிர்க்கவும்.", ["வெளியே N95 முகமூடி அணியவும்", "ஜன்னல்களை மூடி வைக்கவும்", "அனைத்து வெளிப்புற வேலைகளையும் நிறுத்தவும்"]),
                "sensitive": ("காற்றின் தரம் கடுமையானது. குழந்தைகள் வீட்டிலேயே இருக்க வேண்டும், உழைப்பைத் தவிர்க்க வேண்டும்.", ["வெளியே N95 முகமூடி அணியவும்", "ஜன்னல்களை மூடி வைக்கவும்", "அனைத்து வெளிப்புற வேலைகளையும் நிறுத்தவும்"]),
                "elderly": ("காற்றின் தரம் கடுமையானது. முதியவர்கள் வீட்டிற்குள்ளேயே இருக்க வேண்டும்.", ["வெளியே N95 முகமூடி அணியவும்", "ஜன்னல்களை மூடி வைக்கவும்", "அனைத்து வெளிப்புற வேலைகளையும் நிறுத்தவும்"]),
                "outdoor_worker": ("காற்றின் தரம் கடுமையானது. வெளிப்புறப் பணிகள் நிறுத்தப்பட வேண்டும்.", ["வெளியே N95 முகமூடி அணியவும்", "ஜன்னல்களை மூடி வைக்கவும்", "அனைத்து வெளிப்புற வேலைகளையும் நிறுத்தவும்"]),
                "asthma": ("காற்றின் தரம் கடுமையானது. தீவிர ஆஸ்துமா தாக்குதல் அபாயம். வீட்டிற்குள் இருங்கள்.", ["வெளியே N95 முகமூடி அணியவும்", "ஜன்னல்களை மூடி வைக்கவும்", "அனைத்து வெளிப்புற வேலைகளையும் நிறுத்தவும்"]),
            }
        },
        "te": {
            "good": {
                "healthy_adult": ("వాయు నాణ్యత బాగుంది. అవుట్‌డోర్ కార్యకలాపాలను ఆనందించండి.", ["మాస్క్ అవసరం లేదు", "కిటికీలు తెరిచి ఉంచండి", "బయట తిరగడం సురక్షితం"]),
                "sensitive": ("అద్భుతమైన వాయు నాణ్యత. పిల్లలు సురక్షితంగా బయట ఆడుకోవచ్చు.", ["మాస్క్ అవసరం లేదు", "కిటికీలు తెరిచి ఉంచండి", "బయట తిరగడం సురక్షితం"]),
                "elderly": ("వాయు నాణ్యత అద్భుతంగా ఉంది. వృద్ధులు బయట నడవడానికి అనుకూలమైన సమయం.", ["మాస్క్ అవసరం లేదు", "కిటికీలు తెరిచి ఉంచండి", "బయట తిరగడం సురక్షితం"]),
                "outdoor_worker": ("సురక్షితమైన పని వాతావరణం. రక్షణ పరికరాలు అవసరం లేదు.", ["మాస్క్ అవసరం లేదు", "కిటికీలు తెరిచి ఉంచండి", "బయట తిరగడం సురక్షితం"]),
                "asthma": ("గాలి స్వచ్ఛంగా ఉంది. ఆందోళన లేకుండా బయటి కార్యకలాపాలకు సురక్షితం.", ["మాస్క్ అవసరం లేదు", "కిటికీలు తెరిచి ఉంచండి", "బయట తిరగడం సురక్షితం"]),
            },
            "satisfactory": {
                "healthy_adult": ("వాయు నాణ్యత ఆమోదయోగ్యంగా ఉంది. ప్రత్యేక చర్యలు అవసరం లేదు.", ["మాస్క్ అవసరం లేదు", "కిటికీలు తెరిచి ఉంచవచ్చు", "సాధారణ బాహ్య కార్యకలాపాలు"]),
                "sensitive": ("వాయు నాణ్యత సంతృప్తికరంగా ఉంది. సున్నితమైన పిల్లలు లక్షణాలను గమనించాలి.", ["మాస్క్ అవసరం లేదు", "కిటికీలు తెరిచి ఉంచవచ్చు", "సాధారణ బాహ్య కార్యకలాపాలు"]),
                "elderly": ("వాయు నాణ్యత సంతృప్తికరంగా ఉంది. బయటి కార్యకలాపాలకు సౌకర్యవంతంగా ఉంటుంది.", ["మాస్క్ అవసరం లేదు", "కిటికీలు తెరిచి ఉంచవచ్చు", "సాధారణ బాహ్య కార్యకలాపాలు"]),
                "outdoor_worker": ("వాయు నాణ్యత సంతృప్తికరంగా ఉంది. సాధారణ అవుట్‌డోర్ డ్యూటీలకు సురక్షితం.", ["మాస్క్ అవసరం లేదు", "కిటికీలు తెరిచి ఉంచవచ్చు", "సాధారణ బాహ్య కార్యకలాపాలు"]),
                "asthma": ("వాయు నాణ్యత సంతృప్తికరంగా ఉంది. శ్వాసకోశ రోగులు లక్షణాలను పర్యవేక్షించాలి.", ["ఇన్హేలర్ దగ్గర ఉంచుకోండి", "కిటికీలు తెరిచి ఉంచవచ్చు", "సాధారణ బాహ్య కార్యకలాపాలు"]),
            },
            "moderate": {
                "healthy_adult": ("వాయు నాణ్యత మధ్యస్థంగా ఉంది. బయటి శ్రమను పరిమితంగా ఉంచండి.", ["మాస్క్ ఐచ్ఛికం", "గాలి పడకపోతే కిటికీలు మూయండి", "బయటి శ్రమను తగ్గించండి"]),
                "sensitive": ("వాయు నాణ్యత మధ్యస్థంగా ఉంది. పిల్లలు బయట ఆడుకునే సమయాన్ని తగ్గించాలి.", ["మాస్క్ ఐచ్ఛికం", "గాలి పడకపోతే కిటికీలు మూయండి", "బయటి శ్రమను తగ్గించండి"]),
                "elderly": ("వాయు నాణ్యత మధ్యస్థంగా ఉంది. వృద్ధులు బయటి శ్రమను పరిమితం చేయాలి.", ["మాస్క్ ఐచ్ఛికం", "గాలి పడకపోతే కిటికీలు మూయండి", "బయటి శ్రమను తగ్గించండి"]),
                "outdoor_worker": ("వాయు నాణ్యత మధ్యస్థంగా ఉంది. అవుట్‌డోర్ కార్మికులు మాస్క్ ధరించాలి.", ["మాస్క్ ఐచ్ఛికం", "గాలి పడకపోతే కిటికీలు మూయండి", "బయటి శ్రమను తగ్గించండి"]),
                "asthma": ("వాయు నాణ్యత మధ్యస్థంగా ఉంది. ఆస్తమా రోగులు తీవ్రమైన వ్యాయామాలను నివారించాలి.", ["ఇన్హేలర్ దగ్గర ఉంచుకోండి", "గాలి పడకపోతే కిటికీలు మూయండి", "తీవ్ర వ్యాయామాలు నివారించండి"]),
            },
            "poor": {
                "healthy_adult": ("వాయు నాణ్యత తక్కువగా ఉంది. సున్నితమైన వ్యక్తులు ఆరోగ్య సమస్యలను ఎదుర్కొనవచ్చు.", ["బయట N95 మాస్క్ ధరించండి", "కిటికీలు మూసి ఉంచండి", "బయటి కార్యకలాపాలను నివారించండి"]),
                "sensitive": ("వాయు నాణ్యత తక్కువగా ఉంది. పిల్లలు బయటి కార్యకలాపాలకు దూరంగా ఉండాలి.", ["బయట N95 మాస్క్ ధరించండి", "కిటికీలు మూసి ఉంచండి", "బయటి కార్యకలాపాలను నివారించండి"]),
                "elderly": ("వాయు నాణ్యత తక్కువగా ఉంది. వృద్ధులు ఇంట్లోనే ఉండాలి.", ["బయట N95 మాస్క్ ధరించండి", "కిటికీలు మూసి ఉంచండి", "బయటి కార్యకలాపాలను నివారించండి"]),
                "outdoor_worker": ("వాయు నాణ్యత తక్కువగా ఉంది. N95 మాస్క్ ధరించండి మరియు పని సమయం తగ్గించండి.", ["బయట N95 మాస్క్ ధరించండి", "కిటికీలు మూసి ఉంచండి", "పని సమయం తగ్గించండి"]),
                "asthma": ("వాయు నాణ్యత తక్కువగా ఉంది. ఆస్తమా రోగులు ఇంట్లోనే ఉంటూ ఇన్హేలర్ సిద్ధంగా ఉంచుకోవాలి.", ["బయట N95 మాస్క్ ధరించండి", "కిటికీలు మూసి ఉంచండి", "బయటి కార్యకలాపాలు నివారించండి, ఇన్హేలర్ సిద్ధంగా ఉంచండి"]),
            },
            "very_poor": {
                "healthy_adult": ("వాయు నాణ్యత చాలా పేలవంగా ఉంది. ప్రతి ఒక్కరూ బయటి పనులను పరిమితం చేయాలి.", ["బయట N95 మాస్క్ ధరించండి", "కిటికీలు మూసి ఉంచండి", "బయటి శారీరక శ్రమను నివారించండి"]),
                "sensitive": ("వాయు నాణ్యత చాలా పేలవంగా ఉంది. పిల్లలు ఇంట్లోనే ఉండాలి.", ["బయట N95 మాస్క్ ధరించండి", "కిటికీలు మూసి ఉంచండి", "బయటి శారీరక శ్రమను నివారించండి"]),
                "elderly": ("వాయు నాణ్యత చాలా పేలవంగా ఉంది. వృద్ధులు ఇంట్లోనే ఉండాలి.", ["బయట N95 మాస్క్ ధరించండి", "కిటికీలు మూసి ఉంచండి", "బయటి శారీరక శ్రమను నివారించండి"]),
                "outdoor_worker": ("గాలి నాణ్యత చాలా దారుణంగా ఉంది. బయట పనిచేసేవారు తప్పనిసరిగా N95 మాస్క్ వాడాలి.", ["బయట N95 మాస్క్ ధరించండి", "కిటికీలు మూసి ఉంచండి", "బయటి శారీరక శ్రమను నివారించండి"]),
                "asthma": ("వాయు నాణ్యత చాలా పేలవంగా ఉంది. శ్వాసకోశ రోగులు ఇంట్లోనే ఉండాలి.", ["బయట N95 మాస్క్ ధరించండి", "కిటికీలు మూసి ఉంచండి", "బయటి శారీరక శ్రమను నివారించండి"]),
            },
            "severe": {
                "healthy_adult": ("గాలి నాణ్యత అత్యంత ప్రమాదకరంగా ఉంది. బయట శారీరక శ్రమలన్నీ నిలిపివేయండి.", ["బయట N95 మాస్క్ ధరించండి", "కిటికీలు మూసి ఉంచండి", "బయటి కార్యకలాపాలన్నీ నిలిపివేయండి"]),
                "sensitive": ("గాలి నాణ్యత అత్యంత ప్రమాదకరంగా ఉంది. పిల్లలు ఇంట్లోనే ఉంటూ శ్రమ నివారించాలి.", ["బయట N95 మాస్క్ ధరించండి", "కిటికీలు మూసి ఉంచండి", "బయటి కార్యకలాపాలన్నీ నిలిపివేయండి"]),
                "elderly": ("గాలి నాణ్యత అత్యంత ప్రమాదకరంగా ఉంది. వృద్ధులు ఖచ్చితంగా ఇంట్లోనే ఉండాలి.", ["బయట N95 మాస్క్ ధరించండి", "కిటికీలు మూసి ఉంచండి", "బయటి కార్యకలాపాలన్నీ నిలిపివేయండి"]),
                "outdoor_worker": ("గాలి నాణ్యత అత్యంత ప్రమాదకరంగా ఉంది. బయటి పనులన్నీ నిలిపివేయాలి.", ["బయట N95 మాస్క్ ధరించండి", "కిటికీలు మూసి ఉంచండి", "బయటి కార్యకలాపాలన్నీ నిలిపివేయండి"]),
                "asthma": ("గాలి నాణ్యత అత్యంత ప్రమాదకరం. తీవ్రమైన ఆస్తమా ఎటాక్ వచ్చే ప్రమాదం ఉంది. ఇంట్లోనే ఉండండి.", ["బయట N95 మాస్క్ ధరించండి", "కిటికీలు మూసి ఉంచండి", "బయటి కార్యకలాపాలన్నీ నిలిపివేయండి"]),
            }
        }
    }

    async def run(
        self,
        ward: Dict[str, Any],
        aqi: float,
        lang: str = "en",
        pollutants: Dict[str, float] = None,
        weather: Dict[str, Any] = None,
        sources: List[Dict[str, Any]] = None,
        profile: str = "healthy_adult"
    ) -> Dict[str, Any]:
        level = self._aqi_level(aqi)

        # Attempt to use Gemini LLM for dynamic multi-lingual advisory generation if key is provided
        import os
        import json
        import httpx

        gemini_api_key = os.environ.get("GEMINI_API_KEY")
        if gemini_api_key:
            try:
                lang_names = {
                    "en": "English",
                    "hi": "Hindi",
                    "kn": "Kannada",
                    "ta": "Tamil",
                    "te": "Telugu"
                }
                lang_name = lang_names.get(lang, "English")
                level_label = level.replace("_", " ").upper()
                
                dominant = "PM2.5"
                if pollutants:
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
                stagnant_str = "yes" if (ws_kmh is not None and ws_kmh < 8.0) else "no"

                nearby_names = []
                if sources and "center" in ward:
                    for s in sources:
                        dist = _haversine(ward["center"][0], ward["center"][1], s["location"][0], s["location"][1])
                        if dist < 6.0:
                            nearby_names.append(s["name"])

                prompt = f"""You are the Air Quality Advisory Agent. Generate a localized health advisory and precaution list in the language '{lang_name}' (language code: '{lang}') for a citizen with the profile '{profile}' in ward '{ward["name"]}'.
Current conditions:
- AQI: {aqi} ({level_label})
- Dominant pollutant: {dominant}
- Weather: Temperature {weather.get('temperature_c') if weather else 'N/A'}°C, Wind speed {ws_kmh if ws_kmh is not None else 'N/A'} km/h
- Is wind stagnant (preventing dispersion): {stagnant_str}
- Nearby emission sources: {', '.join(nearby_names[:3]) if nearby_names else 'None'}

Format your output EXACTLY as a JSON object with these keys:
"advisory": "<A concise, warning or reassuring citizen health advisory in {lang_name} based on the AQI level and user profile. Length: 1-2 sentences>"
"reason": "<A brief explanation in {lang_name} of why the AQI is at this level (mentioning dominant pollutant, wind/weather conditions, or nearby emission sources if relevant). Length: 1-2 sentences>"
"precautions": ["<Precaution 1 in {lang_name}>", "<Precaution 2 in {lang_name}>", "<Precaution 3 in {lang_name}>"]
"health_tip": "<One short actionable health tip in {lang_name}>"

IMPORTANT: Return ONLY the raw JSON object. Do not wrap it in markdown block quotes or include backticks like ```json."""

                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_api_key}"
                headers = {"Content-Type": "application/json"}
                payload = {
                    "contents": [{
                        "parts": [{"text": prompt}]
                    }]
                }

                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(url, json=payload, headers=headers)
                    if resp.status_code == 200:
                        res_data = resp.json()
                        text_response = res_data["candidates"][0]["content"]["parts"][0]["text"].strip()
                        if text_response.startswith("```"):
                            text_response = text_response.split("```")[1]
                            if text_response.startswith("json"):
                                text_response = text_response[4:]
                        text_response = text_response.strip()
                        
                        parsed = json.loads(text_response)
                        return {
                            "ward_id": ward["id"],
                            "ward_name": ward["name"],
                            "aqi": aqi,
                            "level": level,
                            "language": self.LANGUAGES.get(lang, "English"),
                            "language_code": lang,
                            "advisory": parsed["advisory"],
                            "reason": parsed["reason"],
                            "precautions": parsed["precautions"],
                            "health_tip": parsed["health_tip"],
                            "vulnerable_info": ward.get("vulnerable", {}),
                            "generated_at": datetime.now(timezone.utc).isoformat(),
                        }
            except Exception as e:
                print(f"Gemini API Error, falling back to static advisory: {e}")

        # Fallback static logic
        lang_key = lang if lang in self.PROFILE_ADVISORIES else "en"
        profile_key = profile if profile in self.PROFILE_ADVISORIES[lang_key][level] else "healthy_adult"

        advisory_text, precautions = self.PROFILE_ADVISORIES[lang_key][level][profile_key]
        health_tip = self.HEALTH_TIPS.get(level, {}).get(lang_key, self.HEALTH_TIPS[level]["en"])

        # Determine dominant pollutant
        dominant = "PM2.5"
        if pollutants:
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
                "weather": " காற்றின் வேகம் குறைவாக இருப்பதால் மாசுகள் பரவ முடியாமல் தேங்கி நிற்கின்றன.",
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

        lang_key_exp = lang if lang in explanations else "en"
        exp = explanations[lang_key_exp]

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
            "health_tip": health_tip,
            "vulnerable_info": ward.get("vulnerable", {}),
            "generated_at": datetime.now(timezone.utc).isoformat(),
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
