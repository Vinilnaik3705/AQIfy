import os
from datetime import datetime, timezone
from enum import Enum

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

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'aqify.db')}")

connect_args = {"check_same_thread": False} if DEFAULT_DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DEFAULT_DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class UserRole(str, Enum):
    CITIZEN = "Citizen"
    INSPECTOR = "Inspector"
    AUTHORITY = "Authority"
    ADMIN = "Admin"


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

    pollution_readings = relationship("PollutionReading", back_populates="location", passive_deletes=True)
    weather_readings = relationship("WeatherReading", back_populates="location", passive_deletes=True)
    forecasts = relationship("Forecast", back_populates="location", cascade="all, delete-orphan")
    subscriptions = relationship("AlertSubscription", back_populates="location", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="location")
    interventions = relationship("Intervention", back_populates="location")
    inspectors = relationship("Inspector", back_populates="location")

    __table_args__ = (
        CheckConstraint("latitude >= -90 AND latitude <= 90", name="ck_locations_latitude_range"),
        CheckConstraint("longitude >= -180 AND longitude <= 180", name="ck_locations_longitude_range"),
        Index("ix_locations_city_lat_lng", "city_key", "latitude", "longitude"),
    )


class PollutionReading(Base):
    __tablename__ = "pollution_readings"

    id = Column(Integer, primary_key=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False, index=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    aqi = Column(Float, nullable=False)
    aqi_in = Column(Float, nullable=True)
    pm25 = Column(Float, nullable=True)
    pm10 = Column(Float, nullable=True)
    no2 = Column(Float, nullable=True)
    so2 = Column(Float, nullable=True)
    o3 = Column(Float, nullable=True)
    co = Column(Float, nullable=True)
    source = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    location = relationship("Location", back_populates="pollution_readings")

    __table_args__ = (
        CheckConstraint("aqi >= 0 AND aqi <= 500", name="ck_pollution_readings_aqi_range"),
        CheckConstraint("aqi_in IS NULL OR (aqi_in >= 0 AND aqi_in <= 500)", name="ck_pollution_readings_aqi_in_range"),
        CheckConstraint("pm25 IS NULL OR pm25 >= 0", name="ck_pollution_readings_pm25_nonnegative"),
        CheckConstraint("pm10 IS NULL OR pm10 >= 0", name="ck_pollution_readings_pm10_nonnegative"),
        CheckConstraint("no2 IS NULL OR no2 >= 0", name="ck_pollution_readings_no2_nonnegative"),
        CheckConstraint("so2 IS NULL OR so2 >= 0", name="ck_pollution_readings_so2_nonnegative"),
        CheckConstraint("o3 IS NULL OR o3 >= 0", name="ck_pollution_readings_o3_nonnegative"),
        CheckConstraint("co IS NULL OR co >= 0", name="ck_pollution_readings_co_nonnegative"),
        UniqueConstraint("location_id", "timestamp", name="uq_pollution_location_timestamp"),
        Index("ix_pollution_readings_location_time", "location_id", "timestamp"),
    )


class WeatherReading(Base):
    __tablename__ = "weather_readings"

    id = Column(Integer, primary_key=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False, index=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    temperature_c = Column(Float, nullable=True)
    humidity_pct = Column(Float, nullable=True)
    wind_speed_kmh = Column(Float, nullable=True)
    precipitation_mm = Column(Float, nullable=True)
    source = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    location = relationship("Location", back_populates="weather_readings")

    __table_args__ = (
        CheckConstraint("humidity_pct IS NULL OR (humidity_pct >= 0 AND humidity_pct <= 100)", name="ck_weather_readings_humidity_range"),
        CheckConstraint("wind_speed_kmh IS NULL OR wind_speed_kmh >= 0", name="ck_weather_readings_wind_speed_nonnegative"),
        CheckConstraint("precipitation_mm IS NULL OR precipitation_mm >= 0", name="ck_weather_readings_precipitation_nonnegative"),
        UniqueConstraint("location_id", "timestamp", name="uq_weather_location_timestamp"),
        Index("ix_weather_readings_location_time", "location_id", "timestamp"),
    )


class Forecast(Base):
    __tablename__ = "forecasts"

    id = Column(Integer, primary_key=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False, index=True)
    forecast_time = Column(DateTime(timezone=True), nullable=False, index=True)
    predicted_aqi = Column(Float, nullable=False)
    confidence = Column(Float, nullable=True)
    model_type = Column(String(80), nullable=True)
    source = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    location = relationship("Location", back_populates="forecasts")

    __table_args__ = (
        CheckConstraint("predicted_aqi >= 0 AND predicted_aqi <= 500", name="ck_forecasts_predicted_aqi_range"),
        CheckConstraint("confidence IS NULL OR (confidence >= 0 AND confidence <= 1)", name="ck_forecasts_confidence_range"),
        Index("ix_forecasts_location_time", "location_id", "forecast_time"),
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
    _ensure_legacy_sqlite_columns()


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
    if "alert_subscriptions" not in inspector.get_table_names():
        return

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

    with engine.begin() as connection:
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


def get_db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
