"""Health guidance service boundary."""

from __future__ import annotations

import os
import re
import json
from collections import OrderedDict
from typing import Dict, List, Any, Tuple, Optional

from forecaster import get_http_client

PROFILE_LABELS = {
    "asthma": "Asthma / Respiratory Condition",
    "sensitive": "Sensitive Group",
    "elderly": "Elderly",
    "outdoor_worker": "Outdoor Worker",
    "healthy_adult": "Healthy Adult",
}

PROFILE_GUIDANCE = {
    "asthma": [
        "Keep your rescue inhaler within reach today.",
        "Avoid outdoor activity entirely — stay indoors with windows closed.",
        "Run an air purifier if available; seek medical help if you feel breathless.",
    ],
    "sensitive": [
        "Avoid prolonged or heavy outdoor exertion.",
        "Wear an N95 mask if you must go outside.",
        "Watch for coughing, throat irritation, or eye discomfort.",
    ],
    "elderly": [
        "Limit outdoor exposure, especially early morning and evening.",
        "Avoid busy traffic corridors and construction areas.",
        "Stay hydrated and keep any prescribed medication accessible.",
    ],
    "outdoor_worker": [
        "Wear an N95/N99 mask throughout your work hours.",
        "Take frequent breaks indoors or in cleaner air where possible.",
        "Report any breathing difficulty to your supervisor immediately.",
    ],
    "healthy_adult": [
        "Reduce strenuous outdoor exercise, especially cardio.",
        "Consider a mask for prolonged time outside.",
        "Keep windows closed during peak traffic hours.",
    ],
}

POLLUTANT_INFO = {
    "pm25": ("PM2.5", 60.0, "\u00b5g/m\u00b3"),
    "pm10": ("PM10", 100.0, "\u00b5g/m\u00b3"),
    "no2": ("NO\u2082", 40.0, "ppb"),
    "so2": ("SO\u2082", 40.0, "ppb"),
    "o3": ("O\u2083", 50.0, "ppb"),
    "co": ("CO", 2000.0, "ppb"),
}

_translation_cache: OrderedDict[tuple, str] = OrderedDict()
_TRANSLATION_CACHE_MAX_ENTRIES = max(128, int(os.getenv("TRANSLATION_CACHE_MAX_ENTRIES", "1024")))


def _cache_translation(cache_key: tuple, value: str) -> None:
    _translation_cache.pop(cache_key, None)
    _translation_cache[cache_key] = value
    while len(_translation_cache) > _TRANSLATION_CACHE_MAX_ENTRIES:
        _translation_cache.popitem(last=False)

_LOCAL_TRANSLATIONS = {
    "hi": {
        "Dashboard": "डैशबोर्ड",
        "EnforceHub": "एन्फोर्सहब",
        "Logout": "लॉगआउट",
        "AQIfy": "AQIfy",
        "Live Air Quality Map": "लाइव एयर क्वालिटी मैप",
        "Search city or village...": "शहर या गाँव खोजें...",
        "Air quality stations": "एयर क्वालिटी स्टेशन",
        "Fires": "आग",
        "Factories": "कारखाने",
        "Vehicular Traffic": "वाहन ट्रैफिक",
        "Construction Sites": "निर्माण स्थल",
        "Health Advisory Portal": "स्वास्थ्य सलाह पोर्टल",
        "AI Health Assistant": "एआई स्वास्थ्य सहायक",
        "Analysis": "विश्लेषण",
        "AQI": "AQI",
        "PM2.5": "PM2.5",
        "PM10": "PM10",
        "NO2": "NO₂",
        "SO2": "SO₂",
        "CO": "CO",
        "Sign In": "साइन इन",
        "Login": "लॉगिन",
        "Register": "रजिस्टर",
        "Create Account": "अकाउंट बनाएं",
        "Real-time air quality metrics and AI-driven source analysis.": "रियल-टाइम एयर क्वालिटी मेट्रिक्स और एआई-संचालित सोर्स एनालिसिस।",
    },
    "kn": {
        "Dashboard": "ಡ್ಯಾಶ್ಬೋರ್ಡ್",
        "EnforceHub": "ಎನ್ಫೋರ್ಸ್‌ಹಬ್",
        "Logout": "ಲಾಗ್ಔಟ್",
        "AQIfy": "AQIfy",
        "Live Air Quality Map": "ಲೈವ್ ಏರ್ ಕ್ವಾಲಿಟಿ ಮಾಪ್",
        "Search city or village...": "ನಗರ ಅಥವಾ ಗ್ರಾಮ ಹುಡುಕಿ...",
        "Air quality stations": "ವಾತಾವರಣ ಗುಣಮಟ್ಟದ ನಿಲ್ದಾಣಗಳು",
        "Fires": "ಮಸಲಗಳ್ಳು",
        "Factories": "ಕಾರ್ಖಾನೆಗಳು",
        "Vehicular Traffic": "ವಾಹನ ಸಂಚಾರ",
        "Construction Sites": "ನಿರ್ಮಾಣ ಸೈಟ್ಗಳು",
        "Health Advisory Portal": "ಆರೋಗ್ಯ ಸಲಹಾ ಪೋರ್ಟ್‌ಬಲ್",
        "AI Health Assistant": "ಎಐ ಆರೋಗ್ಯ ಸಹಾಯಕಿ",
        "Analysis": "ವಿಶ್ಲೇಷಣೆ",
        "AQI": "AQI",
        "PM2.5": "PM2.5",
        "PM10": "PM10",
        "NO2": "NO₂",
        "SO2": "SO₂",
        "CO": "CO",
        "Sign In": "ಸೈನ್ ಇನ್",
        "Login": "ಲಾಗಿನ್",
        "Register": "ರಿಜಿಸ್ಟರ್",
        "Create Account": "ಖಾತೆ ರಚಿಸಿ",
    },
    "ta": {
        "Dashboard": "டாஷ்போர்டு",
        "EnforceHub": "என்போர்ஸ்‌ஹப்",
        "Logout": "லாக்அவுட்",
        "AQIfy": "AQIfy",
        "Live Air Quality Map": "லைவ் ஏர் குவாலிட்டி மேப்",
        "Search city or village...": "நகரம் அல்லது கிராமம் தேடுங்கள்...",
        "Air quality stations": "காற்றின் தர நிலையங்கள்",
        "Fires": "தீ",
        "Factories": "ஆலைகள்",
        "Vehicular Traffic": "வாகன போக்குவரத்து",
        "Construction Sites": "கட்டுமான தளங்கள்",
        "Health Advisory Portal": "சுகாதார ஆலோசனை போர்டல்",
        "AI Health Assistant": "AI சுகாதார உதவியாளர்",
        "Analysis": "விளக்கம்",
        "AQI": "AQI",
        "PM2.5": "PM2.5",
        "PM10": "PM10",
        "NO2": "NO₂",
        "SO2": "SO₂",
        "CO": "CO",
        "Sign In": "உள்நுழைக",
        "Login": "உள்நுழை",
        "Register": "பதிவு",
        "Create Account": "கணக்கை உருவாக்கு",
    },
}

# Keep the core dashboard usable when the public translation provider is
# unavailable or throttled. These are the strings users encounter immediately
# after choosing a language; less common dynamic copy can still use the remote
# translator and falls back to its English source without blocking the page.
_LOCAL_TRANSLATIONS.update({
    "te": {
        "Dashboard": "డాష్‌బోర్డ్", "EnforceHub": "ఎన్‌ఫోర్స్‌హబ్", "Logout": "లాగ్‌అవుట్",
        "Live Air Quality Map": "లైవ్ గాలి నాణ్యత మ్యాప్", "Search city or village...": "నగరం లేదా గ్రామాన్ని వెతకండి...",
        "Air quality stations": "గాలి నాణ్యత స్టేషన్లు", "Fires": "మంటలు", "Factories": "కర్మాగారాలు",
        "Vehicular Traffic": "వాహన రాకపోకలు", "Construction Sites": "నిర్మాణ ప్రదేశాలు",
        "Emission Sources": "ఉద్గార మూలాలు", "Outdoor": "బయట", "Air pollutants breakdown": "గాలి కాలుష్యకారకాల వివరాలు",
        "Health recommendations": "ఆరోగ్య సూచనలు", "Avoid outdoor exercise": "బయట వ్యాయామం నివారించండి",
        "Close windows": "కిటికీలు మూసివేయండి", "Wear a mask outdoors": "బయట మాస్క్ ధరించండి",
        "Run an air purifier": "ఎయిర్ ప్యూరిఫైయర్ నడపండి", "Fetching local weather...": "స్థానిక వాతావరణాన్ని పొందుతోంది...",
        "Map tiles are unavailable": "మ్యాప్ టైల్స్ అందుబాటులో లేవు", "Live AQI markers are still shown below.": "లైవ్ AQI సూచికలు క్రింద కనిపిస్తాయి.",
    },
    "ml": {
        "Dashboard": "ഡാഷ്ബോർഡ്", "EnforceHub": "എൻഫോഴ്സ്ഹബ്", "Logout": "ലോഗ്ഔട്ട്",
        "Live Air Quality Map": "തത്സമയ വായു ഗുണനിലവാര മാപ്പ്", "Search city or village...": "നഗരം അല്ലെങ്കിൽ ഗ്രാമം തിരയുക...",
        "Air quality stations": "വായു ഗുണനിലവാര സ്റ്റേഷനുകൾ", "Fires": "തീ", "Factories": "ഫാക്ടറികൾ",
        "Vehicular Traffic": "വാഹന ഗതാഗതം", "Construction Sites": "നിർമാണ സ്ഥലങ്ങൾ",
        "Emission Sources": "മലിനീകരണ ഉറവിടങ്ങൾ", "Outdoor": "പുറം", "Air pollutants breakdown": "വായു മലിനീകരണ വിശദാംശങ്ങൾ",
        "Health recommendations": "ആരോഗ്യ നിർദേശങ്ങൾ", "Avoid outdoor exercise": "പുറത്തെ വ്യായാമം ഒഴിവാക്കുക",
        "Close windows": "ജനലുകൾ അടയ്ക്കുക", "Wear a mask outdoors": "പുറത്ത് മാസ്ക് ധരിക്കുക",
        "Run an air purifier": "എയർ പ്യൂരിഫയർ പ്രവർത്തിപ്പിക്കുക", "Fetching local weather...": "പ്രാദേശിക കാലാവസ്ഥ ലഭ്യമാക്കുന്നു...",
        "Map tiles are unavailable": "മാപ്പ് ടൈലുകൾ ലഭ്യമല്ല", "Live AQI markers are still shown below.": "തത്സമയ AQI മാർക്കറുകൾ താഴെ കാണാം.",
    },
    "mr": {
        "Dashboard": "डॅशबोर्ड", "EnforceHub": "एन्फोर्सहब", "Logout": "लॉगआउट",
        "Live Air Quality Map": "थेट हवेच्या गुणवत्तेचा नकाशा", "Search city or village...": "शहर किंवा गाव शोधा...",
        "Air quality stations": "हवेच्या गुणवत्तेची केंद्रे", "Fires": "आगी", "Factories": "कारखाने",
        "Vehicular Traffic": "वाहतूक", "Construction Sites": "बांधकाम ठिकाणे",
        "Emission Sources": "उत्सर्जनाचे स्रोत", "Outdoor": "बाहेरील", "Air pollutants breakdown": "हवा प्रदूषकांचे विश्लेषण",
        "Health recommendations": "आरोग्यविषयक सूचना", "Avoid outdoor exercise": "बाहेरील व्यायाम टाळा",
        "Close windows": "खिडक्या बंद करा", "Wear a mask outdoors": "बाहेर मास्क घाला",
        "Run an air purifier": "एअर प्युरिफायर चालवा", "Fetching local weather...": "स्थानिक हवामान मिळवत आहे...",
        "Map tiles are unavailable": "नकाशा टाइल्स उपलब्ध नाहीत", "Live AQI markers are still shown below.": "थेट AQI चिन्हे खाली दिसत आहेत.",
    },
    "gu": {
        "Dashboard": "ડેશબોર્ડ", "EnforceHub": "એન્ફોર્સહબ", "Logout": "લોગઆઉટ",
        "Live Air Quality Map": "લાઇવ હવાની ગુણવત્તાનો નકશો", "Search city or village...": "શહેર અથવા ગામ શોધો...",
        "Air quality stations": "હવાની ગુણવત્તા સ્ટેશનો", "Fires": "આગ", "Factories": "કારખાનાં",
        "Vehicular Traffic": "વાહનવ્યવહાર", "Construction Sites": "બાંધકામ સ્થળો",
        "Emission Sources": "ઉત્સર્જન સ્ત્રોતો", "Outdoor": "બહાર", "Air pollutants breakdown": "હવા પ્રદૂષકોની વિગતો",
        "Health recommendations": "આરોગ્ય ભલામણો", "Avoid outdoor exercise": "બહાર કસરત ટાળો",
        "Close windows": "બારીઓ બંધ કરો", "Wear a mask outdoors": "બહાર માસ્ક પહેરો",
        "Run an air purifier": "એર પ્યુરિફાયર ચલાવો", "Fetching local weather...": "સ્થાનિક હવામાન મેળવી રહ્યા છીએ...",
        "Map tiles are unavailable": "નકશાની ટાઇલ્સ ઉપલબ્ધ નથી", "Live AQI markers are still shown below.": "લાઇવ AQI નિશાનીઓ નીચે દેખાય છે.",
    },
    "bn": {
        "Dashboard": "ড্যাশবোর্ড", "EnforceHub": "এনফোর্সহাব", "Logout": "লগআউট",
        "Live Air Quality Map": "লাইভ বায়ুর মানচিত্র", "Search city or village...": "শহর বা গ্রাম খুঁজুন...",
        "Air quality stations": "বায়ুর মানের স্টেশন", "Fires": "আগুন", "Factories": "কারখানা",
        "Vehicular Traffic": "যানবাহন চলাচল", "Construction Sites": "নির্মাণস্থল",
        "Emission Sources": "দূষণের উৎস", "Outdoor": "বাইরে", "Air pollutants breakdown": "বায়ু দূষকের বিবরণ",
        "Health recommendations": "স্বাস্থ্য পরামর্শ", "Avoid outdoor exercise": "বাইরে ব্যায়াম এড়িয়ে চলুন",
        "Close windows": "জানালা বন্ধ রাখুন", "Wear a mask outdoors": "বাইরে মাস্ক পরুন",
        "Run an air purifier": "এয়ার পিউরিফায়ার চালান", "Fetching local weather...": "স্থানীয় আবহাওয়া আনা হচ্ছে...",
        "Map tiles are unavailable": "মানচিত্রের টাইল পাওয়া যাচ্ছে না", "Live AQI markers are still shown below.": "লাইভ AQI চিহ্ন নিচে দেখা যাচ্ছে।",
    },
})


def _local_translate_text(text: str, target: str) -> str:
    if not text or target in (None, "en"):
        return text
    return _LOCAL_TRANSLATIONS.get(target, {}).get(text, text)


def _translate_text(text: str, target_lang: str) -> str:
    """Helper to translate static text to the user's selected language using deep-translator."""
    if not target_lang or target_lang == "en" or not text.strip():
        return text
    try:
        from deep_translator import GoogleTranslator
        translator = GoogleTranslator(source="en", target=target_lang)
        translated = translator.translate(text)
        return translated if translated else text
    except Exception as e:
        print(f"[TRANSLATION FALLBACK] Failed to translate '{text[:30]}...' to {target_lang}: {e}")
        return text


translate_text = _translate_text


def _get_fallback_guidance(profile: str, aqi: float) -> list[str]:
    """Provide structured precautions that dynamically change based on AQI seriousness levels.
    Brackets correspond to the AQI category scales.
    """
    if aqi <= 100:
        return {
            "asthma": [
                "Air quality is acceptable; standard precautions apply.",
                "Keep rescue inhaler nearby during outdoor activity.",
                "Report any minor irritation or wheezing to your doctor.",
            ],
            "sensitive": [
                "Enjoy outdoor activities with standard pacing.",
                "Ideal day for light walks and ventilation.",
                "Monitor children for unusual coughing.",
            ],
            "elderly": [
                "Fine to spend time outdoors and perform regular routines.",
                "Keep living areas ventilated.",
                "Stay hydrated throughout the day.",
            ],
            "outdoor_worker": [
                "Safe to work outdoors normally.",
                "Keep hydrated during shifts.",
                "Observe standard safety protocols.",
            ],
            "healthy_adult": [
                "Air quality is safe for all normal outdoor activities.",
                "Great day for outdoor workouts or running.",
                "Keep windows open to refresh indoor air.",
            ],
        }.get(profile, [
            "Air quality is acceptable.",
            "Normal activities are safe.",
            "Stay hydrated.",
        ])

    elif aqi <= 200:
        return {
            "asthma": [
                "AQI is elevated. Keep your rescue inhaler with you at all times.",
                "Avoid strenuous outdoor exercises or high-energy workouts.",
                "Consider staying indoors if you feel any chest tightness.",
            ],
            "sensitive": [
                "Limit prolonged outdoor play or heavy exertion.",
                "Watch for coughing, throat irritation, or slight fatigue.",
                "Consider wearing a basic mask if staying outdoors for hours.",
            ],
            "elderly": [
                "Limit outdoor morning walks when air is heavier.",
                "Keep windows closed during peak traffic hours.",
                "Rest indoors if you experience breathing discomfort.",
            ],
            "outdoor_worker": [
                "Take regular breaks in closed, cleaner air spaces.",
                "Wear a light protective mask if working near dusty areas.",
                "Stay well-hydrated to help clear throat irritation.",
            ],
            "healthy_adult": [
                "Reduce heavy outdoor workouts (e.g. long runs); shift indoors.",
                "Close windows if you live near main traffic roads.",
                "Take it easy if you begin to feel eye or throat irritation.",
            ],
        }.get(profile, [
            "Consider reducing outdoor activities.",
            "Wear a mask if sensitive.",
            "Keep hydrated.",
        ])

    elif aqi <= 300:
        return {
            "asthma": [
                "High risk. Avoid all outdoor activity entirely today.",
                "Keep windows closed and run an air purifier if available.",
                "Ensure emergency medication is easily accessible.",
            ],
            "sensitive": [
                "Do not play outdoors. Stay in well-ventilated indoor spaces.",
                "Wear an N95 mask if you absolutely must step outside.",
                "Watch closely for wheezing or deep coughing.",
            ],
            "elderly": [
                "Stay indoors in air-conditioned or filtered rooms.",
                "Avoid any physical strain or lifting today.",
                "Keep emergency medical contacts handy.",
            ],
            "outdoor_worker": [
                "Mandatory: Wear an N95 mask during your entire shift.",
                "Avoid heavy manual labor; take frequent breaks indoors.",
                "Wash face and hands immediately after shifts.",
            ],
            "healthy_adult": [
                "Avoid prolonged outdoor running or sports.",
                "Wear a mask for outdoor commutes.",
                "Close all windows to keep ambient pollution out of the home.",
            ],
        }.get(profile, [
            "Limit outdoor activities.",
            "Wear an N95 mask outdoors.",
            "Keep windows closed.",
        ])

    else:
        return {
            "asthma": [
                "CRITICAL. Stay indoors with windows closed at all costs.",
                "Run air purifier on max; avoid any physical exertion.",
                "Seek immediate medical attention if you experience breathing difficulty.",
            ],
            "sensitive": [
                "Strictly stay indoors in closed, clean-air environments.",
                "Do not step outside without a sealed N95/N99 mask.",
                "Monitor oxygen levels or call a doctor if symptoms worsen.",
            ],
            "elderly": [
                "Strictly stay inside. Avoid any outdoor exposure.",
                "Ensure family or neighbors check on your well-being.",
                "Keep all breathing medicines close at hand.",
            ],
            "outdoor_worker": [
                "Severe health hazard. Avoid working outdoors if possible.",
                "If you must, wear a tightly sealed N95/N99 respirator.",
                "Report any breathing distress to supervisors immediately.",
            ],
            "healthy_adult": [
                "Cancel all outdoor exercise; exercise indoors instead.",
                "Keep all windows and doors closed tightly.",
                "Limit time outdoors; wear an N95 mask if commuting.",
            ],
        }.get(profile, [
            "Stay indoors.",
            "Wear an N95/N99 mask.",
            "Seek medical help if breathless.",
        ])


get_fallback_guidance = _get_fallback_guidance


async def _get_dynamic_guidance(profile: str, current_aqi: float, city_name: str, pollutants: Dict[str, float], lang: str = "en") -> list[str]:
    """Retrieve precautions dynamically from Gemini or fallback to static AQI brackets."""
    gemini_api_key = os.environ.get("GEMINI_API_KEY")
    profile_label = PROFILE_LABELS.get(profile, profile.replace("_", " ").title())

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

    if not gemini_api_key:
        print(f"[GUIDANCE] No Gemini key found. Using fallback precautions for aqi={current_aqi} in lang={lang}.")
        fallback = _get_fallback_guidance(profile, current_aqi)
        return [_translate_text(t, lang) for t in fallback]

    pollutant_summary = ", ".join([f"{k.upper()}: {v:.1f}" for k, v in pollutants.items()])

    prompt = f"""You are a professional medical health advisor.
A user has subscribed to air quality alerts for the location: '{city_name}'.
- Current AQI: {current_aqi}
- Current Pollutant values: {pollutant_summary}
- User Profile: {profile_label}

Please provide exactly 3 specific, practical, and highly relevant precautions they should take today.
Make the advice highly specific to their profile ({profile_label}) and the current AQI level ({current_aqi}).
Provide general public-health precautions only; do not diagnose, prescribe, or replace a clinician.

IMPORTANT: You must write your entire response in the language '{lang_name}' (language code: '{lang}').

Return the precautions EXACTLY as a JSON list of strings, like this:
["Precaution 1", "Precaution 2", "Precaution 3"]

Do not include any bullet points, numbering, or markdown formatting (no ```json or ```). Return ONLY the raw JSON array.
"""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_api_key}"
    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [{
            "parts": [{"text": prompt}]
        }]
    }

    try:
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

            parsed = json.loads(text_response)
            if isinstance(parsed, list) and len(parsed) >= 3 and all(isinstance(item, str) for item in parsed[:3]):
                print(f"[GUIDANCE] Successfully fetched Gemini precautions for {profile_label} (AQI {current_aqi}) in {lang_name}")
                cleaned = [re.sub(r"<[^>]*>", "", item).strip()[:300] for item in parsed[:3]]
                if all(cleaned):
                    return cleaned
    except Exception as e:
        print(f"[GUIDANCE] Failed to fetch dynamic precautions from Gemini: {e}. Falling back.")

    fallback = _get_fallback_guidance(profile, current_aqi)
    return [_translate_text(t, lang) for t in fallback]


get_dynamic_guidance = _get_dynamic_guidance
