"""momentum v2

Revision ID: fd40f6131803
Revises: 202607310001
Create Date: 2026-07-31 11:48:26.227457

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'fd40f6131803'
down_revision: Union[str, None] = '202607310001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop old momentum tables if they exist
    op.execute("DROP TABLE IF EXISTS kudos CASCADE;")
    op.execute("DROP TABLE IF EXISTS user_badges CASCADE;")
    op.execute("DROP TABLE IF EXISTS badges CASCADE;")
    op.execute("DROP TABLE IF EXISTS personal_bests CASCADE;")
    op.execute("DROP TABLE IF EXISTS momentum_events CASCADE;")

    # 1. momentum_targets
    op.create_table(
        "momentum_targets",
        sa.Column("role", sa.String(length=30), primary_key=True),
        sa.Column("monthly_task_target", sa.Integer(), nullable=False, server_default="25"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # Seed momentum_targets with defaults
    op.execute("""
        INSERT INTO momentum_targets (role, monthly_task_target) VALUES
        ('field_officer', 25),
        ('sales_officer', 30),
        ('manager', 10)
    """)

    # 2. personal_bests
    op.create_table(
        "personal_bests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("metric", sa.String(length=50), nullable=False),
        sa.Column("value", sa.Numeric(), nullable=False),
        sa.Column("achieved_period_start", sa.Date(), nullable=False),
        sa.Column("achieved_period_end", sa.Date(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "metric", name="uq_personal_bests_user_metric")
    )

    # 3. badges
    op.create_table(
        "badges",
        sa.Column("code", sa.String(length=50), primary_key=True),
        sa.Column("title", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("metric", sa.String(length=50), nullable=False),
        sa.Column("threshold", sa.Integer(), nullable=False)
    )

    # Seed badges
    op.execute("""
        INSERT INTO badges (code, title, description, metric, threshold) VALUES
        ('farmer_visits_50', '50 Farmer Visits', 'Completed 50 farmer visits.', 'related_type:farmer', 50),
        ('farmer_visits_100', '100 Farmer Visits', 'Completed 100 farmer visits.', 'related_type:farmer', 100),
        ('crop_issues_20', '20 Crop Issues Resolved', 'Resolved 20 crop issues.', 'related_type:crop_issue', 20),
        ('on_time_reports_3mo', '3 Months On-Time Reporting', 'Submitted reports on time for 90 days.', 'on_time_reports', 90)
    """)

    # 4. user_badges
    op.create_table(
        "user_badges",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("badge_code", sa.String(length=50), nullable=False),
        sa.Column("earned_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["badge_code"], ["badges.code"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "badge_code", name="uq_user_badges_user_badge_code")
    )

    # 5. kudos
    op.create_table(
        "kudos",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("from_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("to_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message", sa.String(length=280), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["from_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["to_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="SET NULL"),
    )


def downgrade() -> None:
    op.drop_table("kudos")
    op.drop_table("user_badges")
    op.drop_table("badges")
    op.drop_table("personal_bests")
    op.drop_table("momentum_targets")
