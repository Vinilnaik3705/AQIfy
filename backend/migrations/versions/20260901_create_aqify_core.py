"""create aqify authorization, locations and intervention tables

Revision ID: f9d20643d0b4
Revises: 
Create Date: 2026-09-01 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "f9d20643d0b4"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "roles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_roles_name"),
    )
    op.create_index(op.f("ix_roles_id"), "roles", ["id"], unique=False)

    op.create_table(
        "locations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("city_key", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("state", sa.String(length=120), nullable=True),
        sa.Column("country", sa.String(length=120), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_locations_id"), "locations", ["id"], unique=False)
    op.create_index("ix_locations_city_lat_lng", "locations", ["city_key", "latitude", "longitude"], unique=False)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role_id", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)
    op.create_index(op.f("ix_users_role_id"), "users", ["role_id"], unique=False)

    op.create_table(
        "pollution_readings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("aqi", sa.Float(), nullable=False),
        sa.Column("aqi_in", sa.Float(), nullable=True),
        sa.Column("pm25", sa.Float(), nullable=True),
        sa.Column("pm10", sa.Float(), nullable=True),
        sa.Column("no2", sa.Float(), nullable=True),
        sa.Column("so2", sa.Float(), nullable=True),
        sa.Column("o3", sa.Float(), nullable=True),
        sa.Column("co", sa.Float(), nullable=True),
        sa.Column("source", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_pollution_readings_id"), "pollution_readings", ["id"], unique=False)
    op.create_index(op.f("ix_pollution_readings_location_id"), "pollution_readings", ["location_id"], unique=False)
    op.create_index("ix_pollution_readings_location_time", "pollution_readings", ["location_id", "timestamp"], unique=False)

    op.create_table(
        "weather_readings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("temperature_c", sa.Float(), nullable=True),
        sa.Column("humidity_pct", sa.Float(), nullable=True),
        sa.Column("wind_speed_kmh", sa.Float(), nullable=True),
        sa.Column("precipitation_mm", sa.Float(), nullable=True),
        sa.Column("source", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_weather_readings_id"), "weather_readings", ["id"], unique=False)
    op.create_index(op.f("ix_weather_readings_location_id"), "weather_readings", ["location_id"], unique=False)
    op.create_index("ix_weather_readings_location_time", "weather_readings", ["location_id", "timestamp"], unique=False)

    op.create_table(
        "forecasts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=False),
        sa.Column("forecast_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("predicted_aqi", sa.Float(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("model_type", sa.String(length=80), nullable=True),
        sa.Column("source", sa.String(length=100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_forecasts_id"), "forecasts", ["id"], unique=False)
    op.create_index(op.f("ix_forecasts_location_id"), "forecasts", ["location_id"], unique=False)
    op.create_index("ix_forecasts_location_time", "forecasts", ["location_id", "forecast_time"], unique=False)

    op.create_table(
        "alert_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=False),
        sa.Column("threshold_aqi", sa.Float(), nullable=False),
        sa.Column("forecast_threshold", sa.Float(), nullable=False),
        sa.Column("spike_threshold", sa.Float(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("last_alerted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "location_id", name="uq_user_location_subscription"),
    )
    op.create_index(op.f("ix_alert_subscriptions_id"), "alert_subscriptions", ["id"], unique=False)
    op.create_index(op.f("ix_alert_subscriptions_user_id"), "alert_subscriptions", ["user_id"], unique=False)
    op.create_index(op.f("ix_alert_subscriptions_location_id"), "alert_subscriptions", ["location_id"], unique=False)
    op.create_index("ix_alert_subscriptions_user_active", "alert_subscriptions", ["user_id", "is_active"], unique=False)

    op.create_table(
        "alerts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=False),
        sa.Column("alert_type", sa.String(length=50), nullable=False),
        sa.Column("threshold_value", sa.Float(), nullable=True),
        sa.Column("aqi_value", sa.Float(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("sent_via_email", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_alerts_id"), "alerts", ["id"], unique=False)
    op.create_index(op.f("ix_alerts_user_id"), "alerts", ["user_id"], unique=False)
    op.create_index(op.f("ix_alerts_alert_type"), "alerts", ["alert_type"], unique=False)
    op.create_index("ix_alerts_user_time", "alerts", ["user_id", "created_at"], unique=False)

    op.create_table(
        "inspectors",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=True),
        sa.Column("badge_number", sa.String(length=80), nullable=True),
        sa.Column("specialty", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("badge_number", name="uq_inspectors_badge_number"),
        sa.UniqueConstraint("user_id", name="uq_inspectors_user_id"),
    )
    op.create_index(op.f("ix_inspectors_id"), "inspectors", ["id"], unique=False)
    op.create_index(op.f("ix_inspectors_user_id"), "inspectors", ["user_id"], unique=True)
    op.create_index(op.f("ix_inspectors_location_id"), "inspectors", ["location_id"], unique=False)

    op.create_table(
        "interventions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=False),
        sa.Column("aqi", sa.Float(), nullable=False),
        sa.Column("severity", sa.String(length=30), nullable=False),
        sa.Column("suspected_source", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("assigned_inspector_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"]),
        sa.ForeignKeyConstraint(["assigned_inspector_id"], ["inspectors.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_interventions_id"), "interventions", ["id"], unique=False)
    op.create_index(op.f("ix_interventions_location_id"), "interventions", ["location_id"], unique=False)
    op.create_index(op.f("ix_interventions_assigned_inspector_id"), "interventions", ["assigned_inspector_id"], unique=False)
    op.create_index(op.f("ix_interventions_status"), "interventions", ["status"], unique=False)
    op.create_index(op.f("ix_interventions_severity"), "interventions", ["severity"], unique=False)


def downgrade() -> None:
    op.drop_table("interventions")
    op.drop_table("inspectors")
    op.drop_table("alerts")
    op.drop_table("alert_subscriptions")
    op.drop_table("forecasts")
    op.drop_table("weather_readings")
    op.drop_table("pollution_readings")
    op.drop_table("users")
    op.drop_table("locations")
    op.drop_table("roles")
