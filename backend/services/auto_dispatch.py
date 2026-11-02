from __future__ import annotations

from sqlalchemy import func

from database import (
    Inspector,
    Intervention,
    InterventionStatus,
    Location,
    SessionLocal,
    User,
)


def create_auto_interventions(city_key: str, dispatches: list[dict]) -> int:
    db = SessionLocal()
    created = 0
    try:
        active_inspectors = (
            db.query(Inspector)
            .join(User, Inspector.user_id == User.id)
            .filter(User.is_active.is_(True))
            .all()
        )
        if not active_inspectors:
            return 0

        for dispatch in dispatches:
            if created >= 5:
                break
            if dispatch.get("severity") not in {"severe", "very_poor"}:
                continue

            ward_name = str(dispatch.get("ward_name") or city_key).strip()
            location = (
                db.query(Location)
                .filter(Location.city_key == city_key, Location.name == ward_name)
                .first()
            )
            if location is None:
                coordinates = dispatch.get("location") or [0.0, 0.0]
                location = Location(
                    city_key=city_key,
                    name=ward_name,
                    latitude=float(coordinates[0]),
                    longitude=float(coordinates[1]),
                    country="India",
                    source="auto_dispatch",
                )
                db.add(location)
                db.flush()

            unresolved = (
                db.query(Intervention.id)
                .filter(
                    Intervention.location_id == location.id,
                    Intervention.status != InterventionStatus.RESOLVED.value,
                )
                .first()
            )
            if unresolved is not None:
                continue

            inspector = min(
                active_inspectors,
                key=lambda item: (
                    db.query(func.count(Intervention.id))
                    .filter(
                        Intervention.assigned_inspector_id == item.id,
                        Intervention.status != InterventionStatus.RESOLVED.value,
                    )
                    .scalar()
                    or 0,
                    item.id,
                ),
            )
            inferred_sources = dispatch.get("inferred_sources") or []
            recommended_actions = dispatch.get("recommended_actions") or []
            db.add(
                Intervention(
                    location_id=location.id,
                    aqi=float(dispatch.get("aqi", 0.0)),
                    severity=dispatch["severity"],
                    priority_score=float(dispatch.get("priority_score", 0.0)),
                    suspected_source=", ".join(str(source) for source in inferred_sources) or None,
                    recommendation="\n".join(str(action) for action in recommended_actions) or None,
                    description=f"Autonomous dispatch generated for {ward_name}.",
                    assigned_inspector_id=inspector.id,
                    status=InterventionStatus.ASSIGNED.value,
                )
            )
            created += 1

        db.commit()
        return created
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
