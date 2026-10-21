"""harden AQI data constraints and intervention enums

Revision ID: 20260922_harden
Revises: f9d20643d0b4
Create Date: 2026-09-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260922_harden"
down_revision = "f9d20643d0b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in (
        "roles",
        "users",
        "locations",
        "pollution_readings",
        "weather_readings",
        "forecasts",
        "alert_subscriptions",
        "alerts",
        "inspectors",
        "interventions",
    ):
        op.drop_index(op.f("ix_{0}_id".format(table)), table_name=table)

    op.drop_index(op.f("ix_users_email"), table_name="users")

    with op.batch_alter_table("locations") as batch_op:
        batch_op.create_check_constraint("ck_locations_latitude_range", "latitude >= -90 AND latitude <= 90")
        batch_op.create_check_constraint("ck_locations_longitude_range", "longitude >= -180 AND longitude <= 180")

    with op.batch_alter_table("pollution_readings") as batch_op:
        batch_op.create_check_constraint("ck_pollution_readings_aqi_range", "aqi >= 0 AND aqi <= 500")
        batch_op.create_check_constraint("ck_pollution_readings_aqi_in_range", "aqi_in IS NULL OR (aqi_in >= 0 AND aqi_in <= 500)")
        for column in ("pm25", "pm10", "no2", "so2", "o3", "co"):
            batch_op.create_check_constraint(
                "ck_pollution_readings_{0}_nonnegative".format(column),
                "{0} IS NULL OR {0} >= 0".format(column),
            )
        batch_op.create_unique_constraint("uq_pollution_location_timestamp", ["location_id", "timestamp"])

    with op.batch_alter_table("weather_readings") as batch_op:
        batch_op.create_check_constraint("ck_weather_readings_humidity_range", "humidity_pct IS NULL OR (humidity_pct >= 0 AND humidity_pct <= 100)")
        batch_op.create_check_constraint("ck_weather_readings_wind_speed_nonnegative", "wind_speed_kmh IS NULL OR wind_speed_kmh >= 0")
        batch_op.create_check_constraint("ck_weather_readings_precipitation_nonnegative", "precipitation_mm IS NULL OR precipitation_mm >= 0")
        batch_op.create_unique_constraint("uq_weather_location_timestamp", ["location_id", "timestamp"])

    with op.batch_alter_table("forecasts") as batch_op:
        batch_op.create_check_constraint("ck_forecasts_predicted_aqi_range", "predicted_aqi >= 0 AND predicted_aqi <= 500")
        batch_op.create_check_constraint("ck_forecasts_confidence_range", "confidence IS NULL OR (confidence >= 0 AND confidence <= 1)")

    with op.batch_alter_table("interventions") as batch_op:
        batch_op.alter_column(
            "status",
            existing_type=sa.String(length=30),
            type_=sa.Enum("pending", "assigned", "investigating", "resolved", name="intervention_status", native_enum=False),
        )
        batch_op.alter_column(
            "severity",
            existing_type=sa.String(length=30),
            type_=sa.Enum("moderate", "very_poor", "severe", name="intervention_severity", native_enum=False),
        )
        batch_op.create_check_constraint("ck_interventions_aqi_range", "aqi >= 0 AND aqi <= 500")


def downgrade() -> None:
    raise NotImplementedError("Downgrading schema hardening requires restoring removed indexes and constraints manually")