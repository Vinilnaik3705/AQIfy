"""Alert processing service boundary."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from database import SessionLocal, Alert, AlertSubscription
from simulation import sim, CITIES
from services.guidance_service import _get_dynamic_guidance
from services.email_service import _build_alert_email, _send_email


async def _record_alert(
    user_id: int,
    location_id: int,
    alert_type: str,
    aqi_value: float,
    message: str,
    threshold_value: float | None = None,
    email_sent: bool = False,
):
    db = SessionLocal()
    try:
        alert = Alert(
            user_id=user_id,
            location_id=location_id,
            alert_type=alert_type,
            threshold_value=threshold_value,
            aqi_value=aqi_value,
            message=message,
            sent_via_email=email_sent,
        )
        db.add(alert)
        db.commit()
    finally:
        db.close()


record_alert = _record_alert


async def _forecast_window_for_ward(ward_id: str):
    city_key = ward_id.split("_")[0] if "_" in ward_id else ward_id
    forecast = await sim.generate_forecast(city_key, 24, force_refresh=False)
    highest = 0.0
    relevant = []
    for entry in forecast:
        for ward in entry.get("wards", []):
            if ward.get("ward_id") == ward_id or (
                ward_id.startswith(f"{city_key}_")
                and ward.get("ward_id", "").startswith(f"{city_key}_")
            ):
                relevant.append(float(ward.get("predicted_aqi", 0)))
    if relevant:
        highest = max(relevant)
    return highest


async def _trigger_alert_for_subscription(
    row: AlertSubscription,
    current_aqi: float,
    city_name: str,
    alert_type: str,
    threshold_value: float,
    message: str,
    base_url: str,
):
    if not row.email:
        return False
    subject = f"AQI Alert: {city_name} ({alert_type.replace('_', ' ').title()})"
    guidance = await _get_dynamic_guidance(
        profile=row.profile or "healthy_adult",
        current_aqi=current_aqi,
        city_name=city_name,
        pollutants={},
        lang=row.lang or "en",
    )
    email_html = _build_alert_email(
        city_name=city_name,
        current_aqi=current_aqi,
        profile=row.profile or "healthy_adult",
        pollutants={},
        trend_delta=max(current_aqi - float(row.last_alerted_aqi or 0), 0),
        dashboard_url=base_url,
        unsubscribe_url=f"{base_url}/api/advisory/unsubscribe?token={row.confirm_token}",
        guidance=guidance,
        lang=row.lang or "en",
    )
    sent_ok = _send_email(row.email, subject, email_html[1])
    return sent_ok


trigger_alert_for_subscription = _trigger_alert_for_subscription


async def send_aqi_alerts(base_url: str = "http://localhost:7860"):
    """Query confirmed subscriptions, fetch current AQI, and send alert emails if threshold exceeded."""
    db = SessionLocal()
    subscription_query = db.query(AlertSubscription).filter(
        AlertSubscription.confirmed.is_(True),
        AlertSubscription.is_active.is_(True),
        AlertSubscription.email.is_not(None),
    )
    subscription_count = subscription_query.count()
    db.close()

    if not subscription_count:
        print("[ALERT LOOP] No confirmed subscriptions found — nothing to do.")
        return

    print(f"[ALERT LOOP] Checking thresholds for {subscription_count} confirmed subscription(s)...")
    THRESHOLDS = {
        "asthma": 50.0,
        "sensitive": 100.0,
        "elderly": 100.0,
        "outdoor_worker": 100.0,
        "healthy_adult": 150.0,
    }

    readings = await sim.generate_readings("all")
    ward_reading_map = {r["ward_id"]: r for r in readings}

    alerts_sent = 0
    alerts_skipped = 0
    alerts_failed = 0

    # Process subscriptions in bounded pages so a large alert table cannot
    # turn the hourly background job into an unbounded ORM object allocation.
    last_id = 0
    while True:
        db = SessionLocal()
        rows = db.query(AlertSubscription).filter(
            AlertSubscription.confirmed.is_(True),
            AlertSubscription.is_active.is_(True),
            AlertSubscription.email.is_not(None),
            AlertSubscription.id > last_id,
        ).order_by(AlertSubscription.id).limit(100).all()
        db.expunge_all()
        db.close()
        if not rows:
            break
        last_id = rows[-1].id

        for row in rows:
            ward_id = row.ward_id
            profile = row.profile or "healthy_adult"
            email = row.email
            last_alerted = row.last_alerted_aqi or 0.0

            reading = ward_reading_map.get(ward_id)
            if not reading:
                parent_key = ward_id.split("_")[0] if "_" in ward_id else None
                if parent_key:
                    reading = ward_reading_map.get(parent_key)

            current_aqi = reading["aqi"] if reading else 80.0
            pollutants = reading.get("pollutants", {}) if reading else {}
            threshold = THRESHOLDS.get(profile, 100.0)

            is_first_alert = last_alerted is None or last_alerted == 0.0
            delta_ok = is_first_alert or abs(current_aqi - last_alerted) > 10.0

            if current_aqi < threshold:
                print(
                    f"[ALERT LOOP]   SKIP {email} | {ward_id} ({profile}): "
                    f"AQI {current_aqi:.0f} < threshold {threshold:.0f}"
                )
                alerts_skipped += 1
                continue

            if not delta_ok:
                print(
                    f"[ALERT LOOP]   SKIP {email} | {ward_id} ({profile}): "
                    f"AQI {current_aqi:.0f} ≥ {threshold:.0f} but delta from last alert "
                    f"({last_alerted:.0f}) is ≤ 10 — suppressing duplicate"
                )
                alerts_skipped += 1
                continue

            city_name = CITIES.get(ward_id, {}).get("name", ward_id.capitalize())
            trend_delta = current_aqi - last_alerted if last_alerted else 0.0

            sub_lang = row.lang or "en"
            guidance = await _get_dynamic_guidance(
                profile=profile,
                current_aqi=current_aqi,
                city_name=city_name,
                pollutants=pollutants,
                lang=sub_lang,
            )

            subject, html_body = _build_alert_email(
                city_name=city_name,
                current_aqi=current_aqi,
                profile=profile,
                pollutants=pollutants,
                trend_delta=trend_delta,
                dashboard_url=base_url,
                unsubscribe_url=f"{base_url}/api/advisory/unsubscribe?token={row.confirm_token}",
                guidance=guidance,
                lang=sub_lang,
            )

            sent_ok = _send_email(email, subject, html_body)

            if sent_ok:
                update_db = SessionLocal()
                try:
                    stored_row = update_db.get(AlertSubscription, row.id)
                    if stored_row is not None:
                        stored_row.last_alerted_aqi = current_aqi
                        stored_row.last_alerted_at = datetime.now(timezone.utc)
                        update_db.commit()
                finally:
                    update_db.close()
                alerts_sent += 1
                print(
                    f"[ALERT LOOP]   SENT {email} | {ward_id} ({profile}): "
                    f"AQI {current_aqi:.0f} ≥ {threshold:.0f} — alert delivered"
                )
            else:
                alerts_failed += 1
                print(
                    f"[ALERT LOOP]   FAIL {email} | {ward_id} ({profile}): "
                    f"AQI {current_aqi:.0f} ≥ {threshold:.0f} — email send FAILED, will retry next cycle"
                )

    print(f"[ALERT LOOP] Done: {alerts_sent} sent, {alerts_skipped} skipped, {alerts_failed} failed")
