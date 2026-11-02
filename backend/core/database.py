import os
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    Enum as SAEnum,
    inspect,
    text,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'aqify.db')}")

connect_args = {"check_same_thread": False} if DEFAULT_DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DEFAULT_DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class UserRole(str, Enum):
    USER = "User"
    INSPECTOR = "Inspector"


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True)
    name = Column(String(50), unique=True, nullable=False)
    description = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    users = relationship("User", back_populates="role")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    password_hash = Column(String(255), nullable=False)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=False, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    role = relationship("Role", back_populates="users")
    alert_subscriptions = relationship("AlertSubscription", back_populates="user")
    alerts = relationship("Alert", back_populates="user")
    inspector = relationship("Inspector", back_populates="user", uselist=False)

    __table_args__ = (UniqueConstraint("email", name="uq_users_email"),)


class Location(Base):
    __tablename__ = "locations"

    id = Column(Integer, primary_key=True)
    city_key = Column(String(80), index=True, nullable=False)
    name = Column(String(180), nullable=False)
    state = Column(String(120), nullable=True)
    country = Column(String(120), nullable=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    source = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    subscriptions = relationship("AlertSubscription", back_populates="location", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="location")
    interventions = relationship("Intervention", back_populates="location")
    inspectors = relationship("Inspector", back_populates="location")

    __table_args__ = (
        CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_locations_latitude_range"),
        CheckConstraint("longitude >= -180 AND longitude <= 180", name="ck_locations_longitude_range"),
        Index("ix_locations_city_lat_lng", "city_key", "latitude", "longitude"),
    )


class AlertSubscription(Base):
    __tablename__ = "alert_subscriptions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=True, index=True)
    ward_id = Column(String(120), nullable=True, index=True)
    email = Column(String(255), nullable=True, index=True)
    profile = Column(String(50), nullable=True)
    confirm_token = Column(String(64), unique=True, nullable=True, index=True)
    confirmed = Column(Boolean, default=True, nullable=False)
    last_alerted_aqi = Column(Float, default=0.0, nullable=False)
    lang = Column(String(10), default="en", nullable=False)
    threshold_aqi = Column(Float, default=100.0, nullable=False)
    forecast_threshold = Column(Float, default=150.0, nullable=False)
    spike_threshold = Column(Float, default=30.0, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    last_alerted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    user = relationship("User", back_populates="alert_subscriptions")
    location = relationship("Location", back_populates="subscriptions")

    __table_args__ = (
        UniqueConstraint("user_id", "location_id", name="uq_user_location_subscription"),
        UniqueConstraint("email", "ward_id", name="uq_public_email_ward_subscription"),
        Index("ix_alert_subscriptions_user_active", "user_id", "is_active"),
    )


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False, index=True)
    alert_type = Column(String(50), nullable=False, index=True)
    threshold_value = Column(Float, nullable=True)
    aqi_value = Column(Float, nullable=False)
    message = Column(Text, nullable=False)
    sent_via_email = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    user = relationship("User", back_populates="alerts")
    location = relationship("Location", back_populates="alerts")

    __table_args__ = (Index("ix_alerts_user_time", "user_id", "created_at"),)


class Inspector(Base):
    __tablename__ = "inspectors"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=True, index=True)
    badge_number = Column(String(80), unique=True, nullable=True)
    specialty = Column(String(120), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    user = relationship("User", back_populates="inspector")
    location = relationship("Location", back_populates="inspectors")
    interventions = relationship("Intervention", back_populates="assigned_inspector")


class InterventionStatus(str, Enum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    INVESTIGATING = "investigating"
    RESOLVED = "resolved"


class InterventionSeverity(str, Enum):
    MODERATE = "moderate"
    VERY_POOR = "very_poor"
    SEVERE = "severe"


class Intervention(Base):
    __tablename__ = "interventions"

    id = Column(Integer, primary_key=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False, index=True)
    aqi = Column(Float, nullable=False)
    severity = Column(
        SAEnum(
            InterventionSeverity,
            name="intervention_severity",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
        nullable=False,
        index=True,
    )
    suspected_source = Column(String(255), nullable=True)
    description = Column(Text, nullable=False)
    assigned_inspector_id = Column(Integer, ForeignKey("inspectors.id"), nullable=True, index=True)
    status = Column(
        SAEnum(
            InterventionStatus,
            name="intervention_status",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
        default=InterventionStatus.PENDING.value,
        nullable=False,
        index=True,
    )
    priority_score = Column(Float, default=0.0, nullable=False)
    recommendation = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    location = relationship("Location", back_populates="interventions")
    assigned_inspector = relationship("Inspector", back_populates="interventions")
    findings = relationship("InvestigationFinding", back_populates="intervention", cascade="all, delete-orphan")
    outcome = relationship("InterventionOutcome", back_populates="intervention", uselist=False, cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("aqi >= 0 AND aqi <= 500", name="ck_interventions_aqi_range"),
        CheckConstraint("priority_score >= 0", name="ck_interventions_priority_nonnegative"),
    )


class InvestigationFinding(Base):
    __tablename__ = "investigation_findings"

    id = Column(Integer, primary_key=True)
    intervention_id = Column(Integer, ForeignKey("interventions.id"), nullable=False, index=True)
    inspector_id = Column(Integer, ForeignKey("inspectors.id"), nullable=True, index=True)
    findings = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    intervention = relationship("Intervention", back_populates="findings")
    inspector = relationship("Inspector", back_populates="findings")


class InterventionOutcome(Base):
    __tablename__ = "intervention_outcomes"

    id = Column(Integer, primary_key=True)
    intervention_id = Column(Integer, ForeignKey("interventions.id"), nullable=False, unique=True, index=True)
    aqi_before = Column(Float, nullable=False)
    aqi_after = Column(Float, nullable=False)
    change_pct = Column(Float, nullable=False)
    intervention_type = Column(String(100), nullable=False)
    suspected_source = Column(String(255), nullable=True)
    location = Column(String(255), nullable=True)
    resolution_date = Column(DateTime(timezone=True), nullable=False)
    inspector_findings = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    intervention = relationship("Intervention", back_populates="outcome")


Inspector.findings = relationship("InvestigationFinding", back_populates="inspector")


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _remove_unused_legacy_tables()
    _ensure_legacy_sqlite_columns()


def _remove_unused_legacy_tables() -> None:
    """Remove tables from the retired persistence-only AQI pipeline."""
    with engine.begin() as connection:
        existing_tables = set(inspect(engine).get_table_names())
        for table_name in ("forecasts", "weather_readings", "pollution_readings"):
            if table_name in existing_tables:
                connection.execute(text(f'DROP TABLE "{table_name}"'))


def _ensure_legacy_sqlite_columns() -> None:
    """Bring older local SQLite databases up to the current model shape.

    ``create_all`` intentionally does not alter existing tables. A previously
    created local ``aqify.db`` therefore lacked the public subscription fields,
    and any User delete/update could fail while SQLAlchemy loaded the related
    subscriptions. Production deployments should use Alembic migrations; this
    idempotent compatibility step keeps local development and existing demo
    databases usable when migrations have not been run yet.
    """
    if engine.dialect.name != "sqlite":
        return

    inspector = inspect(engine)
    with engine.begin() as connection:
        if "alert_subscriptions" in inspector.get_table_names():
            existing = {column["name"] for column in inspector.get_columns("alert_subscriptions")}
            missing = {
                "ward_id": "VARCHAR(120)",
                "email": "VARCHAR(255)",
                "profile": "VARCHAR(50)",
                "confirm_token": "VARCHAR(64)",
                "confirmed": "BOOLEAN NOT NULL DEFAULT 1",
                "last_alerted_aqi": "FLOAT NOT NULL DEFAULT 0",
                "lang": "VARCHAR(10) NOT NULL DEFAULT 'en'",
            }
            for name, definition in missing.items():
                if name not in existing:
                    connection.execute(text(f"ALTER TABLE alert_subscriptions ADD COLUMN {name} {definition}"))

            connection.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_subscriptions_confirm_token "
                "ON alert_subscriptions (confirm_token)"
            ))
            connection.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_public_email_ward_subscription "
                "ON alert_subscriptions (email, ward_id)"
            ))

        if "interventions" in inspector.get_table_names():
            existing = {column["name"] for column in inspector.get_columns("interventions")}
            missing = {
                "priority_score": "FLOAT NOT NULL DEFAULT 0",
                "recommendation": "TEXT",
            }
            for name, definition in missing.items():
                if name not in existing:
                    connection.execute(text(f"ALTER TABLE interventions ADD COLUMN {name} {definition}"))


def get_db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
