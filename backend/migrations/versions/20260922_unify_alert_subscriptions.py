"""unify public alert subscriptions with SQLAlchemy subscriptions

Revision ID: 20260922_subscriptions
Revises: 20260922_harden
Create Date: 2026-09-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260922_subscriptions"
down_revision = "20260922_harden"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("alert_subscriptions") as batch_op:
        batch_op.alter_column("user_id", existing_type=sa.Integer(), nullable=True)
        batch_op.alter_column("location_id", existing_type=sa.Integer(), nullable=True)
        batch_op.add_column(sa.Column("ward_id", sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column("email", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("profile", sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column("confirm_token", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("confirmed", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch_op.add_column(sa.Column("last_alerted_aqi", sa.Float(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("lang", sa.String(length=10), nullable=False, server_default="en"))
        batch_op.create_unique_constraint("uq_alert_subscriptions_confirm_token", ["confirm_token"])
        batch_op.create_unique_constraint("uq_public_email_ward_subscription", ["email", "ward_id"])
        batch_op.create_index("ix_alert_subscriptions_ward_id", ["ward_id"])
        batch_op.create_index("ix_alert_subscriptions_email", ["email"])
        batch_op.create_index("ix_alert_subscriptions_confirm_token", ["confirm_token"])


def downgrade() -> None:
    with op.batch_alter_table("alert_subscriptions") as batch_op:
        batch_op.drop_index("ix_alert_subscriptions_confirm_token")
        batch_op.drop_index("ix_alert_subscriptions_email")
        batch_op.drop_index("ix_alert_subscriptions_ward_id")
        batch_op.drop_constraint("uq_alert_subscriptions_confirm_token", type_="unique")
        batch_op.drop_constraint("uq_public_email_ward_subscription", type_="unique")
        for column in ("lang", "last_alerted_aqi", "confirmed", "confirm_token", "profile", "email", "ward_id"):
            batch_op.drop_column(column)
        batch_op.alter_column("location_id", existing_type=sa.Integer(), nullable=False)
        batch_op.alter_column("user_id", existing_type=sa.Integer(), nullable=False)