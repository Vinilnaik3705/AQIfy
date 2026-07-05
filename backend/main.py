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
from dotenv import load_dotenv
load_dotenv()

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import sqlite3
import uuid
from typing import Optional, Dict, Tuple
from datetime import datetime, timezone
import httpx
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse

from simulation import SimulationEngine, CITIES, DEFAULT_CITY, get_sources_for_city
from agents import (
    AttributionAgent,
    PredictiveAgent,
    EnforcementAgent,
    AdvisoryAgent,
)
from forecaster import AQIForecaster

# ── Database Initialization ──────────────────────────────────────────────────

def init_db():
    db_path = os.path.join(os.path.dirname(__file__), "subscriptions.db")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS aqi_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ward_id TEXT NOT NULL,
            profile TEXT NOT NULL,
            email TEXT NOT NULL,
            confirm_token TEXT UNIQUE,
            confirmed INTEGER DEFAULT 0,
            last_alerted_aqi REAL DEFAULT 0.0,
            created_at TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


def _get_resend_key() -> Optional[str]:
    """Get Resend API key — checks multiple environment variable names for compatibility."""
    return (
        os.environ.get("RESEND_API_KEY") or
        os.environ.get("Resend") or
        os.environ.get("RESEND") or
        None
    )


def _send_email(to_email: str, subject: str, html_body: str) -> bool:
    """Send an email using SMTP (if configured), Resend (as fallback), or Console simulation."""
    # 1. SMTP Dispatch (if SMTP credentials are provided in .env)
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = os.environ.get("SMTP_PORT")
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASSWORD")
    smtp_from = os.environ.get("SMTP_FROM") or smtp_user

    if smtp_host and smtp_port and smtp_user and smtp_pass:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = smtp_from
            msg["To"] = to_email
            
            part = MIMEText(html_body, "html", "utf-8")
            msg.attach(part)
            
            port = int(smtp_port)
            if port == 465:
                server = smtplib.SMTP_SSL(smtp_host, port, timeout=10.0)
            else:
                server = smtplib.SMTP(smtp_host, port, timeout=10.0)
                server.starttls()
                
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_from, [to_email], msg.as_string())
            server.quit()
            print(f"[SMTP] Email successfully sent to {to_email} | Subject: {subject}")
            return True
        except Exception as e:
            print(f"[SMTP] Failed to send email to {to_email}: {type(e).__name__}: {e}")
            # Fall through to Resend / Console if SMTP configuration is invalid or fails

    # 2. Resend API Dispatch
    resend_key = _get_resend_key()
    if resend_key:
        from_email = os.environ.get("RESEND_FROM_EMAIL") or "AQI Alerts <onboarding@resend.dev>"
        try:
            import resend
            resend.api_key = resend_key
            result = resend.Emails.send({
                "from": from_email,
                "to": to_email,
                "subject": subject,
                "html": html_body
            })
            print(f"[RESEND] Email successfully sent to {to_email} | Resend ID: {result}")
            return True
        except Exception as e:
            err_msg = str(e)
            print(f"[RESEND] Failed to send email to {to_email}: {type(e).__name__}: {err_msg}")
            
            # Print a clear diagnostic message if they hit Resend's sandbox mode limit
            if "onboarding@resend.dev" in from_email or "sandbox" in err_msg.lower() or "validation" in err_msg.lower():
                print(
                    "\n" + "="*85 + "\n"
                    f"DIAGNOSTIC WARNING: Resend API call failed when sending to: {to_email}\n"
                    f"If you are using Resend in Free/Sandbox mode (e.g. using onboarding@resend.dev),\n"
                    f"Resend RESTRICTS emails to ONLY your own registered account email address\n"
                    f"(vinilnaikdharavath3705@gmail.com).\n\n"
                    f"HOW TO SEND TO OTHER EMAILS:\n"
                    f"Option A: Add & verify a custom sending domain in your Resend dashboard, then set RESEND_FROM_EMAIL.\n"
                    f"Option B: Use SMTP by adding these to your backend/.env file:\n"
                    f"          SMTP_HOST=smtp.gmail.com\n"
                    f"          SMTP_PORT=587\n"
                    f"          SMTP_USER=your-email@gmail.com\n"
                    f"          SMTP_PASSWORD=your-app-password\n"
                    + "="*85 + "\n"
                )
            return False

    # 3. Development Console Simulation
    print(f"[CONSOLE EMAIL SIMULATION] No active mail sender config. To: {to_email} | Subject: {subject}")
    return True


def _aqi_category_style(aqi: float) -> Dict[str, str]:
    """Map an AQI value to its category label + brand colors for the alert email.
    Thresholds match the ones already used elsewhere in send_aqi_alerts/get_alerts."""
    if aqi > 300:
        return {"label": "Severe", "color": "#7f1d1d", "bg": "#fef2f2", "dot": "\U0001F7E4"}
    if aqi > 200:
        return {"label": "Very Poor", "color": "#b91c1c", "bg": "#fef2f2", "dot": "\U0001F534"}
    if aqi > 150:
        return {"label": "Poor", "color": "#ea580c", "bg": "#fff7ed", "dot": "\U0001F7E0"}
    if aqi > 100:
        return {"label": "Moderate", "color": "#ca8a04", "bg": "#fefce8", "dot": "\U0001F7E1"}
    if aqi > 50:
        return {"label": "Satisfactory", "color": "#65a30d", "bg": "#f7fee7", "dot": "\U0001F7E2"}
    return {"label": "Good", "color": "#16a34a", "bg": "#f0fdf4", "dot": "\U0001F7E2"}


PROFILE_LABELS = {
    "asthma": "Asthma / Respiratory Condition",
    "sensitive": "Sensitive Group",
    "elderly": "Elderly",
    "outdoor_worker": "Outdoor Worker",
    "healthy_adult": "Healthy Adult",
}

# 3 short, profile-specific tips per subscription type — kept deliberately brief
# (an email is skimmed, not read) and consistent with the guidance style already
# used in agents.py's EnforcementAgent._recommend().
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

# (label, safe-limit, unit) — the safe-limit values match the exceedance
# thresholds already used in agents.py's EnforcementAgent for consistency.
POLLUTANT_INFO = {
    "pm25": ("PM2.5", 60.0, "\u00b5g/m\u00b3"),
    "pm10": ("PM10", 100.0, "\u00b5g/m\u00b3"),
    "no2": ("NO\u2082", 40.0, "\u00b5g/m\u00b3"),
    "so2": ("SO\u2082", 40.0, "\u00b5g/m\u00b3"),
    "o3": ("O\u2083", 100.0, "\u00b5g/m\u00b3"),
    "co": ("CO", 2.0, "mg/m\u00b3"),
}


def _build_alert_email(city_name: str, current_aqi: float, profile: str,
                       pollutants: Dict[str, float], trend_delta: float,
                       dashboard_url: str, unsubscribe_url: str) -> Tuple[str, str]:
    """Build the branded, table-based (email-client-safe) alert email.
    Returns (subject, html_body)."""
    style = _aqi_category_style(current_aqi)
    profile_label = PROFILE_LABELS.get(profile, profile.replace("_", " ").title())
    guidance = PROFILE_GUIDANCE.get(profile, PROFILE_GUIDANCE["healthy_adult"])

    if trend_delta > 10:
        trend_html = '<span style="color:#b91c1c;">&#9650; rising</span>'
    elif trend_delta < -10:
        trend_html = '<span style="color:#16a34a;">&#9660; falling</span>'
    else:
        trend_html = '<span style="color:#64748b;">&#8212; steady</span>'

    pollutant_cells = []
    for key, (label, safe_limit, unit) in POLLUTANT_INFO.items():
        val = pollutants.get(key)
        if val is None:
            continue
        exceeded = val > safe_limit
        val_color = "#b91c1c" if exceeded else "#1e293b"
        pollutant_cells.append(f"""
        <td width="33%" style="padding:10px; text-align:center; border:1px solid #e2e8f0; border-radius:6px;">
          <div style="font-size:12px; color:#64748b; font-weight:600;">{label}</div>
          <div style="font-size:18px; font-weight:700; color:{val_color};">{val:.1f}</div>
          <div style="font-size:11px; color:#94a3b8;">{unit} &middot; safe &lt; {safe_limit:g}</div>
        </td>""")
    # Wrap into rows of 3 (33% width each) instead of one overflowing row —
    # up to 6 pollutants means up to 2 rows.
    pollutant_rows = "".join(
        f"<tr>{''.join(pollutant_cells[i:i+3])}</tr>"
        for i in range(0, len(pollutant_cells), 3)
    )

    guidance_html = "".join(
        f'<tr><td style="padding:6px 0; font-size:14px; color:#334155;">&#8226;&nbsp; {tip}</td></tr>'
        for tip in guidance
    )

    subject = f"{style['dot']} AQI Alert: {city_name} is {style['label']} ({current_aqi:.0f})"

    html = f"""
    <div style="background:#f1f5f9; padding:24px 12px; font-family:Arial,Helvetica,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e2e8f0;">
        <tr>
          <td style="padding:20px 24px; background:#1e293b;">
            <span style="font-size:18px; font-weight:800; color:#ffffff;">AQIfy</span>
            <span style="font-size:12px; color:#94a3b8; margin-left:8px;">Personal Air Quality Alert</span>
          </td>
        </tr>
        <tr>
          <td style="padding:0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{style['bg']};">
              <tr>
                <td style="padding:28px 24px; text-align:center;">
                  <div style="font-size:13px; color:#64748b; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">{city_name}</div>
                  <div style="font-size:48px; font-weight:800; color:{style['color']}; line-height:1.1; margin-top:4px;">{current_aqi:.0f}</div>
                  <div style="font-size:16px; font-weight:700; color:{style['color']};">{style['dot']} {style['label']}</div>
                  <div style="font-size:12px; color:#64748b; margin-top:4px;">Trend since last alert: {trend_html}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 24px 4px;">
            <div style="font-size:13px; font-weight:700; color:#1e293b; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:10px;">Pollutant breakdown</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="6">{pollutant_rows}</table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 24px 4px;">
            <div style="font-size:13px; font-weight:700; color:#1e293b; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:8px;">
              What this means for you &mdash; {profile_label}
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">{guidance_html}</table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px; text-align:center;">
            <a href="{dashboard_url}" style="display:inline-block; background:#3b82f6; color:#ffffff; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:700; font-size:14px;">View Live Dashboard</a>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px; border-top:1px solid #e2e8f0; text-align:center;">
            <div style="font-size:11px; color:#94a3b8;">
              You're receiving this because you subscribed to alerts for {city_name} ({profile_label}).<br/>
              <a href="{unsubscribe_url}" style="color:#94a3b8; text-decoration:underline;">Unsubscribe from these alerts</a>
            </div>
          </td>
        </tr>
      </table>
    </div>
    """
    return subject, html

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
    # Initialize local SQLite DB
    init_db()

    # Debug: log which API keys are available at startup
    resend_key = _get_resend_key()
    resend_from_env = _get_resend_key()
    print(f"[STARTUP] RESEND_API_KEY from os.environ: {'SET (len={})'.format(len(resend_key)) if resend_key else 'NOT SET'}")
    print(f"[STARTUP] RESEND_API_KEY from .env file:  {'SET (len={})'.format(len(resend_from_env)) if resend_from_env else 'NOT SET'}")
    print(f"[STARTUP] All env keys containing 'RESEND': {[k for k in os.environ if 'RESEND' in k.upper()]}")
    print(f"[STARTUP] All env keys containing 'API':    {[k for k in os.environ if 'API' in k.upper()]}")
    # Pre-train ALL live cities in the background
    from simulation import LIVE_CITIES
    PARENT_CITIES = [k for k in LIVE_CITIES if "_" not in k]

    async def train_all():
        import logging
        log = logging.getLogger("main")
        # Train cities concurrently (bounded pool) instead of one-at-a-time with a
        # hardcoded 5s cooldown between each. That old loop was the reason startup
        # training crawled at 5+ seconds per city and, combined with the lock that
        # used to span the whole fetch+train pipeline in forecaster.py, could stall
        # unrelated requests too. forecaster.train_all_cities() already fetches AQ
        # + weather concurrently per city, retries 429s with capped backoff, and
        # runs the CPU-bound model fitting in a worker thread — so a handful of
        # cities training at once is safe and no longer blocks the event loop.
        # TRAIN_CONCURRENCY is tunable via env if you ever see 429s/timeouts in
        # practice. Lowered from 6 to 3: the historical-data fetch hits Open-
        # Meteo's dedicated historical-forecast host with a 14-day range per
        # city, and 6-way concurrent load against it was implicated in the
        # ConnectTimeout failures seen in production.
        concurrency = int(os.environ.get("TRAIN_CONCURRENCY", "3"))
        t0 = datetime.now()
        try:
            await forecaster.train_all_cities(city_keys=PARENT_CITIES, concurrency=concurrency)
        except Exception as e:
            log.error(f"Startup training batch failed: {type(e).__name__}: {e or 'no details'}")
        log.info(f"Startup training for {len(PARENT_CITIES)} cities finished in "
                 f"{(datetime.now() - t0).total_seconds():.1f}s ({concurrency} concurrent).")
    asyncio.create_task(train_all())

    # Start the background alert loop
    async def alert_loop():
        # Check environment variable or load default (3600 seconds)
        interval = int(os.environ.get("ALERT_LOOP_INTERVAL", "3600"))
        # No Request object exists in a background task, so the public URL used
        # for the "View Live Dashboard" button and unsubscribe link in alert
        # emails has to come from an env var instead of request.base_url.
        public_base_url = os.environ.get("PUBLIC_BASE_URL", "http://localhost:7860").rstrip("/")
        print(f"Starting alert background loop with interval {interval}s")
        await asyncio.sleep(10)  # Wait for startup to stabilize
        while True:
            try:
                await send_aqi_alerts(base_url=public_base_url)
            except Exception as e:
                print("Error in alert loop:", e)
            await asyncio.sleep(interval)

    asyncio.create_task(alert_loop())



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


@app.post("/api/cache/clear")
async def clear_cache():
    """Force clear all cached data so next request fetches live data."""
    sim.invalidate_cache()
    return {"status": "ok", "message": "All caches cleared. Next request will fetch fresh live data."}


@app.get("/api/test-email")
async def test_email(to: str = "test@example.com"):
    """Diagnostic endpoint to test SMTP/Resend email sending and print exact errors."""
    import sys
    import traceback
    
    # Read variables directly
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = os.environ.get("SMTP_PORT")
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASSWORD")
    resend_key = _get_resend_key()
    
    results = {
        "env": {
            "SMTP_HOST": smtp_host,
            "SMTP_PORT": smtp_port,
            "SMTP_USER": smtp_user,
            "SMTP_PASSWORD_SET": bool(smtp_pass),
            "RESEND_API_KEY_SET": bool(resend_key),
        },
        "smtp_status": "Not attempted",
        "smtp_error": None,
        "resend_status": "Not attempted",
        "resend_error": None,
    }
    
    # Try SMTP
    if smtp_host and smtp_port and smtp_user and smtp_pass:
        results["smtp_status"] = "Attempting..."
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = "AQI Platform SMTP Test"
            msg["From"] = smtp_user
            msg["To"] = to
            msg.attach(MIMEText("This is a diagnostic SMTP test email.", "plain"))
            
            port = int(smtp_port)
            if port == 465:
                server = smtplib.SMTP_SSL(smtp_host, port, timeout=10.0)
            else:
                server = smtplib.SMTP(smtp_host, port, timeout=10.0)
                server.ehlo()
                server.starttls()
                server.ehlo()
                
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_user, [to], msg.as_string())
            server.quit()
            results["smtp_status"] = "Success"
        except Exception as e:
            results["smtp_status"] = "Failed"
            results["smtp_error"] = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
            
    # Try Resend
    if resend_key:
        results["resend_status"] = "Attempting..."
        try:
            import resend
            resend.api_key = resend_key
            from_email = os.environ.get("RESEND_FROM_EMAIL") or "AQI Alerts <onboarding@resend.dev>"
            res = resend.Emails.send({
                "from": from_email,
                "to": to,
                "subject": "AQI Platform Resend Test",
                "html": "<p>This is a diagnostic Resend test email.</p>"
            })
            results["resend_status"] = f"Success (ID: {res})"
        except Exception as e:
            results["resend_status"] = "Failed"
            results["resend_error"] = f"{type(e).__name__}: {str(e)}"
            
    return results


@app.get("/api/data-freshness")
def get_data_freshness():
    """Return cache status for debugging — shows age of each cached entry."""
    import time as _time
    now = _time.time()
    entries = {}
    for key in sim._cache_ts:
        age = round(now - sim._cache_ts[key], 1)
        ttl = sim._forecast_cache_ttl if key.startswith("forecast_") else sim._cache_ttl
        entries[key] = {
            "age_seconds": age,
            "ttl_seconds": ttl,
            "is_stale": age >= ttl,
            "refreshes_in": max(0, round(ttl - age, 1))
        }
    return {
        "cache_entries": entries,
        "readings_ttl": sim._cache_ttl,
        "forecast_ttl": sim._forecast_cache_ttl,
        "total_cached": len(entries)
    }

@app.get("/api/state")
async def get_state(city: str = Query(default="all"), fresh: bool = Query(default=False)):
    """Return a complete snapshot of the selected city or all cities combined with REAL AQI data.
    Pass fresh=true to bypass cache and fetch live data from APIs."""
    force = fresh
    if city == "all":
        readings = await sim.generate_readings("all", force_refresh=force)
        
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
    return await sim.get_city_state(city, force_refresh=force)



@app.get("/api/forecast")
async def get_forecast(
    city: str = Query(default=DEFAULT_CITY),
    hours: int = Query(default=24, ge=1, le=72),
    fresh: bool = Query(default=False),
):
    """Return ward-level AQI forecast grid using real Open-Meteo forecast data with ML predictions."""
    # 1. Fetch raw forecast grid for all cities
    raw_forecast = await sim.generate_forecast(city, hours, force_refresh=fresh)
    
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
        return await advisory_agent.run(
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
    
    return await advisory_agent.run(
        ward, avg_aqi, lang, 
        pollutants=avg_pollutants, 
        weather=weather, 
        sources=sources,
        profile=profile
    )


@app.post("/api/health-assistant")
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
            "ml": "Malayalam"
        }
        lang_name = lang_names.get(lang, "English")

        prompt = f"""You are a professional medical and environmental health assistant.
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

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                res_data = resp.json()
                text_response = res_data["candidates"][0]["content"]["parts"][0]["text"].strip()
                
                # Robust JSON parsing helper
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
                        "precautions": parsed.get("precautions", [])
                    }
                except Exception:
                    # Fallback if JSON parsing fails
                    return {
                        "response": text_response,
                        "precautions": []
                    }
            else:
                return {
                    "response": f"Gemini API Error: received status code {resp.status_code}",
                    "precautions": []
                }
    except Exception as e:
        return {
            "response": f"Error communicating with Gemini: {str(e)}",
            "precautions": []
        }


# ── Email Alert Subscriptions (SQLite + Resend) ──────────────────────────────

@app.post("/api/advisory/subscribe")
async def subscribe_advisory(
    request: Request,
    ward_id: str = Query(...),
    profile: str = Query(default="healthy_adult"),
    email: str = Query(...),
):
    """Register a public health advisory alert subscription (double opt-in)."""
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address.")

    db_path = os.path.join(os.path.dirname(__file__), "subscriptions.db")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Check for duplicates
    cursor.execute(
        "SELECT id FROM aqi_subscriptions WHERE email = ? AND ward_id = ?",
        (email, ward_id)
    )
    if cursor.fetchone():
        conn.close()
        return {"status": "success", "message": "Already subscribed for this location."}

    # Insert unconfirmed subscription
    token = str(uuid.uuid4())
    cursor.execute(
        "INSERT INTO aqi_subscriptions (ward_id, profile, email, confirm_token, confirmed, created_at) VALUES (?, ?, ?, ?, 0, ?)",
        (ward_id, profile, email, token, datetime.now(timezone.utc).isoformat())
    )
    conn.commit()
    conn.close()

    # Send confirmation email
    city_name = CITIES.get(ward_id, {}).get("name", ward_id.capitalize())
    
    # Generate absolute confirmation link dynamically from the request host
    base_url = str(request.base_url).rstrip("/")
    confirm_url = f"{base_url}/api/advisory/confirm?token={token}"
    
    subject = f"Confirm your AQI alert subscription for {city_name}"
    
    html_body = f"""
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b;">
            <h2 style="color: #3b82f6;">Confirm Your Subscription</h2>
            <p>You requested to receive air quality alerts for <strong>{city_name}</strong> (Profile: {profile.replace('_', ' ').capitalize()}).</p>
            <p>Please click the button below to confirm your subscription:</p>
            <div style="margin: 24px 0;">
                <a href="{confirm_url}" style="background-color: #3b82f6; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">Confirm Subscription</a>
            </div>
            <p style="font-size: 13px; color: #64748b;">If you didn't request this alert, please ignore this email.</p>
        </div>
    """
    
    _send_email(email, subject, html_body)

    return {"status": "success", "message": "Verification email sent. Please check your inbox to confirm."}


@app.get("/api/advisory/confirm")
async def confirm_advisory(request: Request, token: str):
    """Verify double opt-in email subscription and activate it."""
    db_path = os.path.join(os.path.dirname(__file__), "subscriptions.db")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    cursor.execute("SELECT id FROM aqi_subscriptions WHERE confirm_token = ?", (token,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Invalid or expired verification token.")

    cursor.execute("UPDATE aqi_subscriptions SET confirmed = 1 WHERE confirm_token = ?", (token,))
    conn.commit()
    conn.close()

    # Fire an immediate alert check so the user doesn't wait up to 1 hour
    try:
        public_base_url = os.environ.get("PUBLIC_BASE_URL", str(request.base_url).rstrip("/"))
        asyncio.create_task(send_aqi_alerts(base_url=public_base_url))
    except Exception:
        pass  # Best-effort; the periodic loop will catch it anyway

    # Redirect user back to frontend with a success flag
    return RedirectResponse("/?alert=confirmed")


@app.get("/api/advisory/unsubscribe")
async def unsubscribe_advisory(token: str):
    """Remove a subscription via the unsubscribe link included in alert emails."""
    db_path = os.path.join(os.path.dirname(__file__), "subscriptions.db")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM aqi_subscriptions WHERE confirm_token = ?", (token,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Invalid or expired unsubscribe link.")

    cursor.execute("DELETE FROM aqi_subscriptions WHERE confirm_token = ?", (token,))
    conn.commit()
    conn.close()

    return RedirectResponse("/?alert=unsubscribed")


async def send_aqi_alerts(base_url: str = "http://localhost:7860"):
    """Query confirmed subscriptions, fetch current AQI, and send alert emails if threshold exceeded."""
    db_path = os.path.join(os.path.dirname(__file__), "subscriptions.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM aqi_subscriptions WHERE confirmed = 1")
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        return

    print(f"Checking thresholds for {len(rows)} confirmed subscriptions...")
    THRESHOLDS = {
        "asthma": 50.0,
        "sensitive": 100.0,
        "elderly": 100.0,
        "outdoor_worker": 100.0,
        "healthy_adult": 150.0
    }

    # Fetch latest simulation snapshot to get current AQI + full pollutant
    # breakdown for each ward (previously only "aqi" was kept, which is why
    # the old template couldn't show a pollutant breakdown at all).
    readings = await sim.generate_readings("all")
    ward_reading_map = {r["ward_id"]: r for r in readings}

    for row in rows:
        ward_id = row["ward_id"]
        profile = row["profile"]
        email = row["email"]
        last_alerted = row["last_alerted_aqi"]

        reading = ward_reading_map.get(ward_id)
        current_aqi = reading["aqi"] if reading else 80.0
        pollutants = reading.get("pollutants", {}) if reading else {}
        threshold = THRESHOLDS.get(profile, 100.0)

        # Alert if threshold is reached/exceeded.
        # For brand-new subscriptions (last_alerted == 0) skip the delta guard
        # so the very first alert fires immediately when AQI >= threshold.
        is_first_alert = (last_alerted is None or last_alerted == 0.0)
        delta_ok = is_first_alert or abs(current_aqi - last_alerted) > 10.0
        if current_aqi >= threshold and delta_ok:
            city_name = CITIES.get(ward_id, {}).get("name", ward_id.capitalize())
            trend_delta = current_aqi - last_alerted if last_alerted else 0.0

            subject, html_body = _build_alert_email(
                city_name=city_name,
                current_aqi=current_aqi,
                profile=profile,
                pollutants=pollutants,
                trend_delta=trend_delta,
                dashboard_url=base_url,
                unsubscribe_url=f"{base_url}/api/advisory/unsubscribe?token={row['confirm_token']}",
            )

            _send_email(email, subject, html_body)

            # Update database to avoid duplicate notifications in the next cycles
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("UPDATE aqi_subscriptions SET last_alerted_aqi = ? WHERE id = ?", (current_aqi, row["id"]))
            conn.commit()
            conn.close()



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


# ── Translation Endpoint ──────────────────────────────────────────────────────

# In-memory cache: (text, lang) -> translated_text — avoids repeated API calls
_translation_cache: Dict[tuple, str] = {}

@app.post("/api/translate")
async def translate_texts(request: Request):
    """Translate an array of text strings to a target language using deep-translator.
    Request body: { "texts": ["Hello", "Dashboard"], "target": "hi" }
    Response:     { "translations": ["नमस्ते", "डैशबोर्ड"] }
    """
    body = await request.json()
    texts = body.get("texts", [])
    target = body.get("target", "en")

    if target == "en" or not texts:
        return {"translations": texts}

    from deep_translator import GoogleTranslator

    results = [None] * len(texts)
    to_translate = []   # (original_index, text) pairs for uncached strings
    seen = {}           # dedup: text -> first index in to_translate

    for i, text in enumerate(texts):
        stripped = text.strip()
        if not stripped:
            results[i] = text
            continue
        cache_key = (stripped, target)
        if cache_key in _translation_cache:
            results[i] = _translation_cache[cache_key]
        elif stripped in seen:
            # Same text appears twice — we'll fill it in after translation
            to_translate.append((i, stripped))
        else:
            seen[stripped] = len(to_translate)
            to_translate.append((i, stripped))

    if to_translate:
        unique_texts = list(dict.fromkeys(t for _, t in to_translate))
        try:
            translator = GoogleTranslator(source='en', target=target)
            # deep-translator's translate_batch handles up to ~5000 chars
            # Split into chunks of 50 texts to stay safe
            translated_map = {}
            for chunk_start in range(0, len(unique_texts), 50):
                chunk = unique_texts[chunk_start:chunk_start + 50]
                translated = translator.translate_batch(chunk)
                for orig, trans in zip(chunk, translated):
                    translated_map[orig] = trans or orig
                    _translation_cache[(orig, target)] = trans or orig
        except Exception as e:
            print(f"Translation error: {e}")
            # Fallback: return originals
            return {"translations": texts}

        # Fill in results
        for i, stripped in to_translate:
            results[i] = translated_map.get(stripped, stripped)

    # Fill any remaining None entries with originals
    for i in range(len(results)):
        if results[i] is None:
            results[i] = texts[i]

    return {"translations": results}


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
        return FileResponse(index_file, headers={"Cache-Control": "no-store, no-cache, must-revalidate"})
    return {"message": "AQI Intervention Platform Backend Running. Build frontend to view dashboard."}

@app.get("/{catchall:path}")
def serve_static(catchall: str):
    if catchall.startswith("api/") or catchall.startswith("docs") or catchall.startswith("openapi.json"):
        return None
    index_file = os.path.join(frontend_dist, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file, headers={"Cache-Control": "no-store, no-cache, must-revalidate"})
    return {"message": "Not Found"}