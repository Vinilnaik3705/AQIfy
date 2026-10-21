"""FastAPI Backend — AQI Intervention Platform (Multi-City + Real AQI)
====================================================================
Modular entry point configuring app lifecycle, middleware, static files,
and route modularization.
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from database import init_db
from forecaster import close_http_client, close_training_executor
from routes.agents import router as agents_router
from routes.alerts import router as alerts_router
from routes.auth import ensure_default_roles, router as auth_router
from routes.cities import router as cities_router
from routes.forecast import router as forecast_router
from routes.interventions import router as interventions_router
from routes.state import router as state_router
from routes.translate import router as translate_router
from routes.websocket import router as websocket_router
from services.alert_service import send_aqi_alerts
from services.email_service import _get_resend_key
from simulation import close_simulation_http_client
from singletons import (
    _cancel_background_tasks,
    _schedule_background,
    forecaster,
)

# ── Application Setup ─────────────────────────────────────────────────────────

app = FastAPI(
    title="AQI Intervention Platform",
    description="AI-powered urban air quality intelligence — multi-city, real-time data",
    version="2.0.0",
)

cors_env = os.getenv("CORS_ORIGINS", "*").strip()
if os.getenv("APP_ENV", "development").lower() in {"production", "prod"} and cors_env == "*":
    raise RuntimeError("CORS_ORIGINS must be configured explicitly in production")
if cors_env == "*":
    allowed_origins = ["*"]
else:
    allowed_origins = [origin.strip() for origin in cors_env.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=cors_env != "*",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if os.getenv("APP_ENV", "development").lower() in {"production", "prod"}:
        # HTTPS is terminated by the hosting proxy in production. HSTS tells
        # browsers to refuse a later downgrade to plaintext HTTP.
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response

# ── Include Routers ───────────────────────────────────────────────────────────

app.include_router(state_router)
app.include_router(forecast_router)
app.include_router(auth_router)
app.include_router(alerts_router)
app.include_router(cities_router)
app.include_router(websocket_router)
app.include_router(interventions_router)
app.include_router(agents_router)
app.include_router(translate_router)

# ── Health Endpoint ───────────────────────────────────────────────────────────

@app.get("/api/health")
async def health_check():
    from database import SessionLocal
    from redis_client import get_redis_client
    from sqlalchemy import text

    redis_ok = await get_redis_client()
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
    finally:
        db.close()
    return {"status": "ok", "database": "ready", "redis": "ready" if redis_ok is not None else "unavailable"}


# ── Lifecycle Events ──────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup_event():
    # Initialize the configured SQLAlchemy database & roles
    init_db()
    ensure_default_roles()

    resend_key = _get_resend_key()
    if resend_key:
        print(f"[STARTUP] Resend configured ({len(resend_key)} chars).")

    background_jobs_enabled = os.getenv("ENABLE_BACKGROUND_JOBS", "true").lower() == "true"

    # Startup training is opt-in because loading/fitting every parent-city
    # model duplicates large sklearn objects and competes with web requests on
    # a small web service. Requests still return live-data fallbacks and can
    # warm one city at a time through generate_ml_forecast().
    from simulation import LIVE_CITIES
    from simulation import DEFAULT_CITY

    parent_cities = [k for k in LIVE_CITIES if "_" not in k]
    configured_startup_cities = [
        key.strip() for key in os.getenv("STARTUP_TRAIN_CITIES", DEFAULT_CITY).split(",")
        if key.strip() in parent_cities
    ] or [DEFAULT_CITY]

    async def train_all():
        import logging

        log = logging.getLogger("main")
        # Keep startup work strictly serial even if an old deployment still
        # provides TRAIN_CONCURRENCY; this is a web-service memory guard.
        concurrency = 1
        t0 = datetime.now(timezone.utc)
        try:
            await forecaster.train_all_cities(city_keys=configured_startup_cities, concurrency=concurrency)
        except Exception as e:
            log.error(f"Startup training batch failed: {type(e).__name__}: {e or 'no details'}")
        log.info(
            f"Startup training for {len(configured_startup_cities)} cities finished in "
            f"{(datetime.now(timezone.utc) - t0).total_seconds():.1f}s ({concurrency} concurrent)."
        )

    if background_jobs_enabled and os.getenv("ENABLE_STARTUP_TRAINING", "false").lower() == "true":
        _schedule_background(train_all())

    # Start periodic alert processing loop
    async def alert_loop():
        interval = int(os.environ.get("ALERT_LOOP_INTERVAL", "3600"))
        public_base_url = os.environ.get("PUBLIC_BASE_URL", "http://localhost:7860").rstrip("/")
        print(f"Starting alert background loop with interval {interval}s")
        await asyncio.sleep(10)
        while True:
            try:
                await send_aqi_alerts(base_url=public_base_url)
            except Exception as e:
                print("Error in alert loop:", e)
            await asyncio.sleep(interval)

    if background_jobs_enabled:
        _schedule_background(alert_loop())


@app.on_event("shutdown")
async def shutdown_event():
    await forecaster.cancel_training_tasks()
    await _cancel_background_tasks()
    await close_http_client()
    await close_simulation_http_client()
    close_training_executor()


# ── Static SPA Delivery ───────────────────────────────────────────────────────

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
