import os
from datetime import datetime, timedelta, timezone
from typing import Annotated, Iterable

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from database import User, UserRole, get_db_session

JWT_SECRET = os.getenv("JWT_SECRET") or os.getenv("SECRET_KEY") or "aqify-dev-secret-change-me"
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "120"))

# Accept both current and previously stored hashes from earlier app runs.
pwd_context = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        try:
            if isinstance(hashed_password, str) and hashed_password.startswith("$2"):
                return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
        except Exception:
            pass
        return False


def create_access_token(user_id: int, email: str, role_name: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
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
) -> User:
    if credentials is None or not credentials.scheme or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid bearer token")

    token = credentials.credentials
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


def role_name_for_user(user: User | None) -> str:
    if user is None or user.role is None:
        return UserRole.CITIZEN.value
    return user.role.name
