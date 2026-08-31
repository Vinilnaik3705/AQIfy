import os
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import (
    Boolean,
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

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)
    description = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    users = relationship("User", back_populates="role")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
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

    id = Column(Integer, primary_key=True, index=True)
    city_key = Column(String(80), index=True, nullable=False)
    name = Column(String(180), nullable=False)
    state = Column(String(120), nullable=True)
    country = Column(String(120), nullable=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    source = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    pollution_readings = relationship("PollutionReading", back_populates="location")
    weather_readings = relationship("WeatherReading", back_populates="location")
    forecasts = relationship("Forecast", back_populates="location")
    subscriptions = relationship("AlertSubscription", back_populates="location")
    alerts = relationship("Alert", back_populates="location")
    interventions = relationship("Intervention", back_populates="location")
    inspectors = relationship("Inspector", back_populates="location")

    __table_args__ = (
        Index("ix_locations_city_lat_lng", "city_key", "latitude", "longitude"),
    )


class PollutionReading(Base):
    __tablename__ = "pollution_readings"

    id = Column(Integer, primary_key=True, index=True)
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

    __table_args__ = (Index("ix_pollution_readings_location_time", "location_id", "timestamp"),)


class WeatherReading(Base):
    __tablename__ = "weather_readings"

    id = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False, index=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    temperature_c = Column(Float, nullable=True)
    humidity_pct = Column(Float, nullable=True)
    wind_speed_kmh = Column(Float, nullable=True)
    precipitation_mm = Column(Float, nullable=True)
    source = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    location = relationship("Location", back_populates="weather_readings")

    __table_args__ = (Index("ix_weather_readings_location_time", "location_id", "timestamp"),)


class Forecast(Base):
    __tablename__ = "forecasts"

    id = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False, index=True)
    forecast_time = Column(DateTime(timezone=True), nullable=False, index=True)
    predicted_aqi = Column(Float, nullable=False)
    confidence = Column(Float, nullable=True)
    model_type = Column(String(80), nullable=True)
    source = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    location = relationship("Location", back_populates="forecasts")

    __table_args__ = (Index("ix_forecasts_location_time", "location_id", "forecast_time"),)


class AlertSubscription(Base):
    __tablename__ = "alert_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False, index=True)
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
        Index("ix_alert_subscriptions_user_active", "user_id", "is_active"),
    )


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
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

    id = Column(Integer, primary_key=True, index=True)
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


class Intervention(Base):
    __tablename__ = "interventions"

    id = Column(Integer, primary_key=True, index=True)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=False, index=True)
    aqi = Column(Float, nullable=False)
    severity = Column(String(30), nullable=False, index=True)
    suspected_source = Column(String(255), nullable=True)
    description = Column(Text, nullable=False)
    assigned_inspector_id = Column(Integer, ForeignKey("inspectors.id"), nullable=True, index=True)
    status = Column(String(30), default=InterventionStatus.PENDING.value, nullable=False, index=True)
    priority_score = Column(Float, default=0.0, nullable=False)
    recommendation = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    location = relationship("Location", back_populates="interventions")
    assigned_inspector = relationship("Inspector", back_populates="interventions")
    findings = relationship("InvestigationFinding", back_populates="intervention", cascade="all, delete-orphan")
    outcome = relationship("InterventionOutcome", back_populates="intervention", uselist=False, cascade="all, delete-orphan")


class InvestigationFinding(Base):
    __tablename__ = "investigation_findings"

    id = Column(Integer, primary_key=True, index=True)
    intervention_id = Column(Integer, ForeignKey("interventions.id"), nullable=False, index=True)
    inspector_id = Column(Integer, ForeignKey("inspectors.id"), nullable=True, index=True)
    findings = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    intervention = relationship("Intervention", back_populates="findings")
    inspector = relationship("Inspector", back_populates="findings")


class InterventionOutcome(Base):
    __tablename__ = "intervention_outcomes"

    id = Column(Integer, primary_key=True, index=True)
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


def get_db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
