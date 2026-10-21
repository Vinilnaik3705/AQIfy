import asyncio
import os
import uuid
from datetime import datetime, timezone
from html import escape
from typing import Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse

from auth import require_roles
from database import AlertSubscription, SessionLocal, User, UserRole
from redis_client import rate_limit_or_429
from routes.cities import _city_wards
from routes.websocket import broadcast_aqi_update
from services.alert_service import send_aqi_alerts
from services.email_service import _get_resend_key, _send_email
from services.guidance_service import PROFILE_LABELS, _translate_text
from simulation import CITIES, DEFAULT_CITY, sim
from singletons import _schedule_background

router = APIRouter()


@router.post("/api/ws/refresh")
async def refresh_ws(request: Request):
    await rate_limit_or_429(request, "ws_refresh", limit=5, window_seconds=60)
    payload = {"type": "manual_refresh", "timestamp": datetime.now(timezone.utc).isoformat()}
    await broadcast_aqi_update(payload)
    return {"status": "ok"}


@router.post("/api/advisory/subscribe")
async def subscribe_advisory(
    request: Request,
    ward_id: str = Query(...),
    profile: str = Query(default="healthy_adult"),
    email: str = Query(...),
    lang: str = Query(default="en"),
):
    """Register a public health advisory alert subscription (auto-confirmed)."""
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address.")

    db = SessionLocal()
    existing = db.query(AlertSubscription).filter(
        AlertSubscription.email == email,
        AlertSubscription.ward_id == ward_id,
    ).first()

    if existing:
        needs_update = False

        if not existing.confirmed:
            needs_update = True
        if existing.profile != profile:
            needs_update = True
        if existing.lang != lang:
            needs_update = True

        if needs_update:
            existing.profile = profile
            existing.lang = lang
            existing.confirmed = True
            existing.last_alerted_aqi = 0.0
            db.commit()
            print(
                f"[SUBSCRIBE] Updated existing subscription id={existing.id} "
                f"for {email} / {ward_id}: profile={profile}, lang={lang}, confirmed=1"
            )
        db.close()

        try:
            public_base_url = os.environ.get("PUBLIC_BASE_URL", str(request.base_url).rstrip("/"))
            _schedule_background(send_aqi_alerts(base_url=public_base_url))
        except Exception:
            pass

        if needs_update:
            return {"status": "success", "message": "Subscription updated and activated! You will receive alerts when AQI exceeds your threshold."}
        return {"status": "success", "message": "Already subscribed for this location."}

    token = str(uuid.uuid4())
    subscription = AlertSubscription(
        ward_id=ward_id,
        profile=profile,
        email=email,
        confirm_token=token,
        confirmed=True,
        lang=lang,
    )
    db.add(subscription)
    db.commit()
    db.refresh(subscription)
    db.close()
    print(f"[SUBSCRIBE] New subscription created for {email} | ward={ward_id} | profile={profile} | lang={lang} | auto-confirmed=True")

    city_name = CITIES.get(ward_id, {}).get("name", ward_id.capitalize())
    base_url = str(request.base_url).rstrip("/")
    unsubscribe_url = f"{base_url}/api/advisory/unsubscribe?token={token}"
    profile_label = PROFILE_LABELS.get(profile, profile.replace("_", " ").title())
    threshold = {"asthma": 50, "sensitive": 100, "elderly": 100, "outdoor_worker": 100, "healthy_adult": 150}.get(profile, 100)

    welcome_subject = _translate_text(f"AQI alerts activated for {city_name}", lang)
    h2_text = _translate_text("Your AQI Alert Subscription is Active", lang)
    p1_text = _translate_text(f"You will receive air quality alerts for {city_name} whenever the AQI exceeds {threshold} (your profile: {profile_label}).", lang)
    p2_text = _translate_text("No further action is needed — alerts are already active.", lang)
    what_next_header = _translate_text("What happens next?", lang)
    li1 = _translate_text("We check AQI levels every hour", lang)
    li2 = _translate_text(f"If AQI exceeds {threshold}, you'll get a detailed alert email", lang)
    li3 = _translate_text("Each alert includes pollutant breakdown and health guidance for your profile", lang)
    unsubscribe_text = _translate_text("Don't want these alerts? Unsubscribe", lang)
    safe_unsubscribe_url = escape(unsubscribe_url, quote=True)
    safe_h2_text = escape(h2_text)
    safe_p1_text = escape(p1_text)
    safe_p2_text = escape(p2_text)
    safe_what_next_header = escape(what_next_header)
    safe_li1 = escape(li1)
    safe_li2 = escape(li2)
    safe_li3 = escape(li3)
    safe_unsubscribe_text = escape(unsubscribe_text)

    welcome_html = f"""
    <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #3b82f6;">\U00002705 {safe_h2_text}</h2>
        <p>{safe_p1_text}</p>
        <p style="font-size: 14px; color: #475569;">{safe_p2_text}</p>
        <div style="margin: 20px 0; padding: 14px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;">
            <strong style="color: #166534;">{safe_what_next_header}</strong>
            <ul style="color: #334155; margin: 8px 0 0 0; padding-left: 20px;">
                <li>{safe_li1}</li>
                <li>{safe_li2}</li>
                <li>{safe_li3}</li>
            </ul>
        </div>
        <p style="font-size: 12px; color: #94a3b8;"><a href="{safe_unsubscribe_url}" style="color: #94a3b8; text-decoration: underline;">{safe_unsubscribe_text}</a></p>
    </div>
    """

    _send_email(email, welcome_subject, welcome_html)

    try:
        public_base_url = os.environ.get("PUBLIC_BASE_URL", str(request.base_url).rstrip("/"))
        _schedule_background(send_aqi_alerts(base_url=public_base_url))
    except Exception:
        pass

    return {"status": "success", "message": "Subscription activated! You will receive alerts when AQI exceeds your threshold."}


@router.get("/api/advisory/confirm")
async def confirm_advisory(request: Request, token: str):
    """Verify double opt-in email subscription and activate it."""
    db = SessionLocal()
    row = db.query(AlertSubscription).filter(AlertSubscription.confirm_token == token).first()
    if row is None:
        db.close()
        raise HTTPException(status_code=404, detail="Invalid or expired verification token.")

    row.confirmed = True
    db.commit()
    db.close()

    public_base_url = os.environ.get("PUBLIC_BASE_URL", str(request.base_url).rstrip("/"))
    try:
        _schedule_background(send_aqi_alerts(base_url=public_base_url))
    except Exception:
        pass

    return RedirectResponse(f"{public_base_url}/?alert=confirmed")


@router.get("/api/advisory/unsubscribe")
async def unsubscribe_advisory(request: Request, token: str):
    """Remove a subscription via the unsubscribe link included in alert emails."""
    db = SessionLocal()
    row = db.query(AlertSubscription).filter(AlertSubscription.confirm_token == token).first()
    if row is None:
        db.close()
        raise HTTPException(status_code=404, detail="Invalid or expired unsubscribe link.")

    db.delete(row)
    db.commit()
    db.close()

    public_base_url = os.environ.get("PUBLIC_BASE_URL", str(request.base_url).rstrip("/"))
    return RedirectResponse(f"{public_base_url}/?alert=unsubscribed")


@router.get("/api/advisory/subscriptions/debug")
async def debug_subscriptions(current_user: User = Depends(require_roles(UserRole.ADMIN.value))):
    """Diagnostic endpoint — returns all subscriptions, email config status, and current AQI."""
    db = SessionLocal()
    rows = db.query(AlertSubscription).filter(AlertSubscription.email.is_not(None)).all()

    THRESHOLDS = {
        "asthma": 50.0,
        "sensitive": 100.0,
        "elderly": 100.0,
        "outdoor_worker": 100.0,
        "healthy_adult": 150.0,
    }

    brevo_ok = bool(os.environ.get("BREVO_API_KEY"))
    smtp_ok = all(os.environ.get(k) for k in ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD"))
    resend_ok = bool(_get_resend_key())
    email_config = {
        "brevo_configured": brevo_ok,
        "smtp_configured": smtp_ok,
        "resend_configured": resend_ok,
        "any_provider_active": brevo_ok or smtp_ok or resend_ok,
    }

    try:
        readings = await sim.generate_readings("all")
        ward_aqi_map = {r["ward_id"]: round(r["aqi"], 1) for r in readings}
    except Exception:
        ward_aqi_map = {}

    subscriptions = []
    for row in rows:
        ward_id = row.ward_id
        profile = row.profile or "healthy_adult"
        threshold = THRESHOLDS.get(profile, 100.0)
        current_aqi = ward_aqi_map.get(ward_id, "N/A")
        would_alert = current_aqi != "N/A" and current_aqi >= threshold

        subscriptions.append({
            "id": row.id,
            "ward_id": ward_id,
            "profile": profile,
            "email": row.email[:3] + "***" + row.email[row.email.index("@"):],
            "confirmed": bool(row.confirmed),
            "threshold": threshold,
            "current_aqi": current_aqi,
            "would_alert": would_alert,
            "last_alerted_aqi": row.last_alerted_aqi,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        })

    db.close()
    return {
        "email_config": email_config,
        "total_subscriptions": len(subscriptions),
        "confirmed_count": sum(1 for s in subscriptions if s["confirmed"]),
        "subscriptions": subscriptions,
    }


@router.get("/api/alerts")
async def get_alerts(city: str = Query(default=DEFAULT_CITY)):
    """Return all active alerts where AQI exceeds the safe threshold."""
    keys = [city]
    if city == "all":
        keys = [c["key"] for c in sim.get_available_cities()]

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
