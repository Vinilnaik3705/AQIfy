import os
import secrets
import warnings
from datetime import datetime, timedelta, timezone
from typing import Annotated, Iterable

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from database import User, get_db_session

APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
JWT_SECRET = os.getenv("JWT_SECRET", "").strip()
if len(JWT_SECRET) < 32:
    if APP_ENV in {"development", "dev", "test"}:
        # Keep a fresh local checkout runnable without making development users
        # copy secrets into chat or commit them. Production still hard-fails.
        JWT_SECRET = f"aqify-dev-{secrets.token_urlsafe(48)}"
        warnings.warn(
            "JWT_SECRET is not configured; using an ephemeral development secret. "
            "Set JWT_SECRET before deploying to production.",
            RuntimeWarning,
            stacklevel=2,
        )
    else:
        raise RuntimeError(
            "JWT_SECRET must be configured with a random secret of at least 32 characters before starting the backend"
        )
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "120"))
if JWT_EXPIRE_MINUTES <= 0:
    raise RuntimeError("JWT_EXPIRE_MINUTES must be positive")

# Accept both current and previously stored hashes from earlier app runs.
pwd_context = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        if isinstance(hashed_password, str) and hashed_password.startswith("$2"):
            try:
                return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
            except Exception:
                return False
        return False


def create_access_token(user_id: int, role_name: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role_name,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=JWT_EXPIRE_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str):
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


def get_user_from_db(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    db: Annotated[Session, Depends(get_db_session)],
    session_cookie: Annotated[str | None, Cookie(alias="aqify_session")] = None,
) -> User:
    # Prefer the HttpOnly cookie. The bearer fallback keeps older clients
    # compatible without allowing a stale localStorage token to override a
    # valid current session cookie.
    token = session_cookie
    if not token and credentials is not None and credentials.scheme and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid bearer token")

    try:
        payload = decode_token(token)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject")

    user = get_user_from_db(db, int(user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user


def require_roles(*allowed_roles: Iterable[str]):
    allowed = {str(role).lower() for role in allowed_roles}

    async def dependency(current_user: User = Depends(get_current_user)):
        role_name = (current_user.role.name if current_user.role else "Citizen").lower()
        if role_name not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied for role '{current_user.role.name if current_user.role else 'unknown'}'",
            )
        return current_user

    return dependency

