from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request

from auth import get_current_user, require_roles
from database import (
    Inspector,
    Intervention,
    InterventionOutcome,
    InterventionStatus,
    InvestigationFinding,
    Location,
    SessionLocal,
    User,
    UserRole,
)

router = APIRouter()


@router.post("/api/locations")
async def upsert_location(
    request: Request,
    current_user: User = Depends(require_roles(UserRole.AUTHORITY.value, UserRole.ADMIN.value)),
):
    body = await request.json()
    city_key = (body.get("city_key") or "unknown").strip()
    name = (body.get("name") or city_key).strip()
    db = SessionLocal()
    try:
        location = db.query(Location).filter(Location.city_key == city_key, Location.name == name).first()
        if not location:
            location = Location(
                city_key=city_key,
                name=name,
                state=body.get("state"),
                country=body.get("country"),
                latitude=float(body.get("latitude", 0)),
                longitude=float(body.get("longitude", 0)),
                source=body.get("source") or "manual",
            )
            db.add(location)
            db.commit()
            db.refresh(location)
        return {
            "id": location.id,
            "city_key": location.city_key,
            "name": location.name,
            "latitude": location.latitude,
            "longitude": location.longitude,
        }
    finally:
        db.close()


@router.get("/api/interventions")
async def list_interventions(
    current_user: User = Depends(require_roles(UserRole.INSPECTOR.value, UserRole.AUTHORITY.value, UserRole.ADMIN.value)),
):
    db = SessionLocal()
    try:
        role_name = current_user.role.name if current_user.role else UserRole.CITIZEN.value
        query = db.query(Intervention)
        if role_name == UserRole.INSPECTOR.value:
            inspector = db.query(Inspector).filter(Inspector.user_id == current_user.id).first()
            if inspector:
                query = query.filter(Intervention.assigned_inspector_id == inspector.id)
            else:
                query = query.filter(Intervention.id == -1)
        interventions = query.order_by(Intervention.created_at.desc()).all()
        return [
            {
                "id": item.id,
                "location_id": item.location_id,
                "aqi": item.aqi,
                "severity": item.severity,
                "suspected_source": item.suspected_source,
                "description": item.description,
                "assigned_inspector_id": item.assigned_inspector_id,
                "status": item.status,
                "created_at": item.created_at.isoformat() if item.created_at else None,
                "updated_at": item.updated_at.isoformat() if item.updated_at else None,
            }
            for item in interventions
        ]
    finally:
        db.close()


@router.post("/api/interventions")
async def create_intervention(
    request: Request,
    current_user: User = Depends(require_roles(UserRole.AUTHORITY.value, UserRole.ADMIN.value)),
):
    body = await request.json()
    lat = float(body.get("latitude", 0.0))
    lng = float(body.get("longitude", 0.0))
    city_key = body.get("city_key") or "unknown"
    name = body.get("location_name") or city_key
    db = SessionLocal()
    try:
        location = db.query(Location).filter(Location.city_key == city_key, Location.name == name).first()
        if not location:
            location = Location(
                city_key=city_key,
                name=name,
                state=body.get("state"),
                country=body.get("country"),
                latitude=lat,
                longitude=lng,
                source="intervention",
            )
            db.add(location)
            db.commit()
            db.refresh(location)
        assigned_id = body.get("assigned_inspector_id")
        if assigned_id:
            inspector = db.query(Inspector).filter(Inspector.id == assigned_id).first()
            if not inspector:
                raise HTTPException(status_code=404, detail="Assigned inspector not found")
        intervention = Intervention(
            location_id=location.id,
            aqi=float(body.get("aqi", 0)),
            severity=(body.get("severity") or ("severe" if float(body.get("aqi", 0)) > 200 else "moderate")).strip(),
            suspected_source=body.get("suspected_source"),
            description=body.get("description") or "Intervention requested.",
            assigned_inspector_id=assigned_id,
            status=InterventionStatus.ASSIGNED.value if assigned_id else InterventionStatus.PENDING.value,
        )
        db.add(intervention)
        db.commit()
        db.refresh(intervention)
        return {"id": intervention.id, "status": intervention.status}
    finally:
        db.close()


@router.patch("/api/interventions/{intervention_id}/status")
async def update_intervention_status(
    intervention_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    body = await request.json()
    status_value = (body.get("status") or "").strip().lower()
    if status_value not in {item.value for item in InterventionStatus}:
        raise HTTPException(status_code=400, detail="Invalid intervention status")
    db = SessionLocal()
    try:
        intervention = db.query(Intervention).filter(Intervention.id == intervention_id).first()
        if not intervention:
            raise HTTPException(status_code=404, detail="Intervention not found")
        role_name = current_user.role.name if current_user.role else UserRole.CITIZEN.value
        if role_name == UserRole.INSPECTOR.value:
            inspector = db.query(Inspector).filter(Inspector.user_id == current_user.id).first()
            if inspector is None or intervention.assigned_inspector_id != inspector.id:
                raise HTTPException(status_code=403, detail="This inspector is not assigned to the intervention")
        elif role_name not in {UserRole.AUTHORITY.value, UserRole.ADMIN.value}:
            raise HTTPException(status_code=403, detail="Access denied")
        intervention.status = status_value
        intervention.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(intervention)
        return {"id": intervention.id, "status": intervention.status}
    finally:
        db.close()


@router.post("/api/interventions/{intervention_id}/findings")
async def add_intervention_findings(
    intervention_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    body = await request.json()
    findings_text = (body.get("findings") or "").strip()
    if not findings_text:
        raise HTTPException(status_code=400, detail="Investigation findings are required")
    db = SessionLocal()
    try:
        intervention = db.query(Intervention).filter(Intervention.id == intervention_id).first()
        if not intervention:
            raise HTTPException(status_code=404, detail="Intervention not found")
        role_name = current_user.role.name if current_user.role else UserRole.CITIZEN.value
        if role_name == UserRole.INSPECTOR.value:
            inspector = db.query(Inspector).filter(Inspector.user_id == current_user.id).first()
            if inspector is None or intervention.assigned_inspector_id != inspector.id:
                raise HTTPException(status_code=403, detail="This inspector is not assigned to the intervention")
        elif role_name not in {UserRole.AUTHORITY.value, UserRole.ADMIN.value}:
            raise HTTPException(status_code=403, detail="Access denied")

        inspector_id = None
        if role_name == UserRole.INSPECTOR.value:
            inspector = db.query(Inspector).filter(Inspector.user_id == current_user.id).first()
            inspector_id = inspector.id if inspector else None

        record = InvestigationFinding(intervention_id=intervention.id, inspector_id=inspector_id, findings=findings_text)
        db.add(record)
        db.commit()
        db.refresh(record)
        return {"id": record.id, "findings": record.findings, "created_at": record.created_at.isoformat()}
    finally:
        db.close()


@router.post("/api/interventions/{intervention_id}/outcome")
async def add_intervention_outcome(
    intervention_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    body = await request.json()
    aqi_before = float(body.get("aqi_before", 0.0))
    aqi_after = float(body.get("aqi_after", 0.0))
    intervention_type = (body.get("intervention_type") or "Inspection").strip()
    suspected_source = (body.get("suspected_source") or "Unknown").strip()
    resolution_date = datetime.now(timezone.utc)
    inspector_findings = (body.get("inspector_findings") or "").strip()
    db = SessionLocal()
    try:
        intervention = db.query(Intervention).filter(Intervention.id == intervention_id).first()
        if not intervention:
            raise HTTPException(status_code=404, detail="Intervention not found")
        role_name = current_user.role.name if current_user.role else UserRole.CITIZEN.value
        if role_name == UserRole.INSPECTOR.value:
            inspector = db.query(Inspector).filter(Inspector.user_id == current_user.id).first()
            if inspector is None or intervention.assigned_inspector_id != inspector.id:
                raise HTTPException(status_code=403, detail="This inspector is not assigned to the intervention")
        elif role_name not in {UserRole.AUTHORITY.value, UserRole.ADMIN.value}:
            raise HTTPException(status_code=403, detail="Access denied")

        change_pct = 0.0
        if aqi_before > 0:
            change_pct = ((aqi_before - aqi_after) / aqi_before) * 100.0

        outcome = InterventionOutcome(
            intervention_id=intervention.id,
            aqi_before=aqi_before,
            aqi_after=aqi_after,
            change_pct=round(change_pct, 2),
            intervention_type=intervention_type,
            suspected_source=suspected_source,
            location=(body.get("location") or (intervention.location.name if intervention.location else "Unknown")).strip(),
            resolution_date=resolution_date,
            inspector_findings=inspector_findings,
        )
        db.add(outcome)
        intervention.status = InterventionStatus.RESOLVED.value
        intervention.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(outcome)
        return {
            "id": outcome.id,
            "aqi_before": outcome.aqi_before,
            "aqi_after": outcome.aqi_after,
            "change_pct": outcome.change_pct,
            "intervention_type": outcome.intervention_type,
            "location": outcome.location,
            "resolution_date": outcome.resolution_date.isoformat(),
        }
    finally:
        db.close()
