import os
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.exc import IntegrityError

from auth import (
    create_access_token,
    get_current_user,
    hash_password,
    require_roles,
    verify_password,
    JWT_EXPIRE_MINUTES,
)
from database import Inspector, Role, SessionLocal, User, UserRole
from redis_client import rate_limit_or_429

router = APIRouter()


def _set_session_cookie(response: Response, token: str) -> None:
    production = os.getenv("APP_ENV", "development").lower() in {"production", "prod"}
    response.set_cookie(
        "aqify_session",
        token,
        max_age=JWT_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=production,
        samesite="none" if production else "lax",
        path="/",
    )


def normalize_role_name(value: Any) -> str:
    if value is None:
        return UserRole.CITIZEN.value
    value = str(value).strip()
    if not value:
        return UserRole.CITIZEN.value
    normalized = value.lower().replace("-", " ").replace("_", " ")
    aliases = {
        "citizen": UserRole.CITIZEN.value,
        "citizens": UserRole.CITIZEN.value,
        "inspector": UserRole.INSPECTOR.value,
        "inspectors": UserRole.INSPECTOR.value,
        "authority": UserRole.AUTHORITY.value,
        "authorities": UserRole.AUTHORITY.value,
        "admin": UserRole.ADMIN.value,
        "admins": UserRole.ADMIN.value,
    }
    return aliases.get(normalized, value if value in {role.value for role in UserRole} else UserRole.CITIZEN.value)


def infer_role_for_email(email: str) -> str:
    email_lower = (email or "").lower()
    if "authority" in email_lower:
        return UserRole.AUTHORITY.value
    if "inspector" in email_lower:
        return UserRole.INSPECTOR.value
    if "admin" in email_lower:
        return UserRole.ADMIN.value
    return UserRole.CITIZEN.value


def ensure_default_roles():
    db = SessionLocal()
    try:
        for role_name in [UserRole.CITIZEN.value, UserRole.INSPECTOR.value, UserRole.AUTHORITY.value, UserRole.ADMIN.value]:
            if not db.query(Role).filter(Role.name == role_name).first():
                db.add(Role(name=role_name, description=f"{role_name} access role"))

        for role in db.query(Role).all():
            canonical_name = normalize_role_name(role.name)
            if canonical_name != role.name:
                role.name = canonical_name

        db.commit()

        for user in db.query(User).all():
            role_name = normalize_role_name(user.role.name if user.role else infer_role_for_email(user.email))
            target_role = db.query(Role).filter(Role.name == role_name).first()
            if target_role is not None and user.role_id != target_role.id:
                user.role_id = target_role.id

        reserved_accounts = {
            "admin@aqify.local": {"password": os.getenv("DEFAULT_ADMIN_PASSWORD"), "role": UserRole.ADMIN.value, "full_name": "AQIfy Admin"},
            "authority@aqify.local": {"password": os.getenv("DEFAULT_AUTHORITY_PASSWORD"), "role": UserRole.AUTHORITY.value, "full_name": "AQIfy Authority"},
            "inspector@aqify.local": {"password": os.getenv("DEFAULT_INSPECTOR_PASSWORD"), "role": UserRole.INSPECTOR.value, "full_name": "AQIfy Inspector"},
        }

        for email, details in reserved_accounts.items():
            if not details["password"]:
                if os.getenv("APP_ENV", "development").lower() in {"production", "prod"}:
                    raise RuntimeError(f"{details['role']} password configuration is required")
                # Reserved accounts are optional in development. Normal users
                # can still register without placeholder credentials.
                continue
            role = db.query(Role).filter(Role.name == details["role"]).first()
            if role is None:
                continue
            user = db.query(User).filter(User.email == email).first()
            if user is None:
                user = User(
                    email=email,
                    full_name=details["full_name"],
                    password_hash=hash_password(details["password"]),
                    role_id=role.id,
                    is_active=True,
                )
                db.add(user)
            else:
                user.password_hash = hash_password(details["password"])
                user.role_id = role.id
                user.full_name = details["full_name"]
                user.is_active = True

            # The reserved Inspector account must have an Inspector profile so
            # Admin assignments are visible when that account logs in.
            if details["role"] == UserRole.INSPECTOR.value:
                db.flush()
                inspector = db.query(Inspector).filter(Inspector.user_id == user.id).first()
                if inspector is None:
                    db.add(Inspector(user_id=user.id, specialty="Air quality inspection"))

        db.commit()
    finally:
        db.close()


@router.post("/api/auth/register")
async def register_user(request: Request, response: Response):
    await rate_limit_or_429(request, "auth_register", limit=10, window_seconds=60)
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    full_name = (body.get("full_name") or "").strip()
    role_name = normalize_role_name(body.get("role") or UserRole.CITIZEN.value)
    # Public registration can never grant elevated privileges. Authorities,
    # inspectors, and admins must be provisioned by an existing authority/admin.
    valid_roles = {UserRole.CITIZEN.value}
    if role_name not in valid_roles:
        raise HTTPException(status_code=403, detail="Elevated roles must be assigned by an administrator")
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email is required")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    reserved_emails = {"admin@aqify.local", "authority@aqify.local", "inspector@aqify.local"}
    if email in reserved_emails:
        raise HTTPException(status_code=409, detail="This email is reserved for the system roles and cannot be registered by a citizen.")

    db = SessionLocal()
    try:
        if db.query(User).filter(User.email == email).first():
            raise HTTPException(status_code=409, detail="User already exists")

        role = db.query(Role).filter(Role.name == role_name).first()
        if role is None:
            role = Role(name=role_name, description=f"{role_name} access role")
            db.add(role)
            db.commit()
            db.refresh(role)

        user = User(email=email, full_name=full_name or email.split("@")[0], password_hash=hash_password(password), role_id=role.id, is_active=True)
        db.add(user)
        db.commit()
        db.refresh(user)
        token = create_access_token(user.id, role.name)
        _set_session_cookie(response, token)
        return {"user": {"id": user.id, "email": user.email, "role": role.name, "full_name": user.full_name}}
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this email already exists") from exc
    finally:
        db.close()


@router.post("/api/auth/login")
async def login_user(request: Request, response: Response):
    await rate_limit_or_429(request, "auth_login", limit=20, window_seconds=60)
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user or not verify_password(password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        token = create_access_token(user.id, user.role.name if user.role else UserRole.CITIZEN.value)
        _set_session_cookie(response, token)
        return {"user": {"id": user.id, "email": user.email, "role": user.role.name if user.role else UserRole.CITIZEN.value, "full_name": user.full_name}}
    finally:
        db.close()


@router.get("/api/auth/me")
async def get_current_user_profile(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "email": current_user.email, "role": current_user.role.name if current_user.role else UserRole.CITIZEN.value, "full_name": current_user.full_name}


@router.post("/api/auth/logout")
async def logout_user(response: Response):
    response.delete_cookie("aqify_session", path="/")
    return {"status": "ok"}


@router.get("/api/admin/roles")
async def list_roles(current_user: User = Depends(require_roles(UserRole.ADMIN.value))):
    db = SessionLocal()
    try:
        return [{"id": role.id, "name": role.name, "description": role.description} for role in db.query(Role).all()]
    finally:
        db.close()


@router.get("/api/admin/users")
async def list_users(current_user: User = Depends(require_roles(UserRole.ADMIN.value))):
    db = SessionLocal()
    try:
        users = db.query(User).all()
        return [{"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role.name if u.role else UserRole.CITIZEN.value, "is_active": u.is_active} for u in users]
    finally:
        db.close()


@router.post("/api/admin/users/{user_id}/role")
async def update_user_role(user_id: int, request: Request, current_user: User = Depends(require_roles(UserRole.ADMIN.value))):
    body = await request.json()
    role_name = normalize_role_name(body.get("role") or UserRole.CITIZEN.value)
    if role_name not in {role.value for role in UserRole}:
        raise HTTPException(status_code=400, detail="Unsupported role")
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        if user.id == current_user.id and role_name != UserRole.ADMIN.value:
            raise HTTPException(status_code=400, detail="An administrator cannot remove their own admin access")
        role = db.query(Role).filter(Role.name == role_name).first()
        if not role:
            role = Role(name=role_name, description=f"{role_name} access role")
            db.add(role)
            db.commit()
            db.refresh(role)
        user.role_id = role.id
        db.commit()
        return {"id": user.id, "email": user.email, "role": role.name}
    finally:
        db.close()


@router.post("/api/auth/inspectors")
async def create_inspector_account(request: Request, current_user: User = Depends(require_roles(UserRole.ADMIN.value))):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            user = User(
                email=email,
                full_name=body.get("full_name") or email.split("@")[0],
                password_hash=hash_password(password),
                role_id=db.query(Role).filter(Role.name == UserRole.INSPECTOR.value).first().id,
                is_active=True,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        inspector = db.query(Inspector).filter(Inspector.user_id == user.id).first()
        if not inspector:
            inspector = Inspector(
                user_id=user.id,
                location_id=body.get("location_id"),
                badge_number=body.get("badge_number"),
                specialty=body.get("specialty"),
            )
            db.add(inspector)
            db.commit()
            db.refresh(inspector)
        return {"id": user.id, "email": user.email, "role": UserRole.INSPECTOR.value, "inspector_id": inspector.id}
    finally:
        db.close()
