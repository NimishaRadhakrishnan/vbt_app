"""phase 2: trial field, visit KPI rollup, annual/weighted targets, admin soft-delete

Revision ID: 202608240001
Revises: 202608130001
Create Date: 2026-08-24 00:01:00

Adds:
- visits.is_trial + visit_trial_products (structured Trial data - product,
  quantity given, leftover - instead of overloading products_demonstrated,
  which is untyped text[])
- visits KPI columns (farmers_covered, demos_conducted, villages_covered,
  acres_covered, conversions) to replace the free-text daily_work_reports
  summary as the primary productivity record
- annual_targets + monthly_target_weights: an annual number per role,
  split across months by an admin-editable weight (not a flat 1/12 split -
  agri work is seasonal) - the shared machinery behind both the Dashboard
  productivity widget's 3-month view and the KPI rollup's yearly target
- is_deleted on every module admin CRUD needs delete support for, so
  "delete" is consistently a status flag here rather than a real DROP -
  matching the existing dealer pending_approval/active/rejected pattern
  (holiday_calendar and audit_logs already exist from earlier migrations
  and are reused as-is, not recreated here)
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608240001"
down_revision: str | None = "202608130001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


SOFT_DELETE_TABLES = [
    "farmers",
    "dealers",
    "tasks",
    "weekly_plans",
    "crop_issues",
    "leave_requests",
    "hr_policies",
    "enquiries",
    "day_closures",
]


def upgrade() -> None:
    # --- Trial field on visits ---
    op.add_column("visits", sa.Column("is_trial", sa.Boolean(), nullable=False, server_default="false"))

    op.create_table(
        "visit_trial_products",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quantity_given", sa.Numeric(12, 2), nullable=False),
        sa.Column("quantity_leftover", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
    )
    op.create_index("idx_visit_trial_products_visit", "visit_trial_products", ["visit_id"])

    # --- Structured visit KPIs (replaces daily_work_reports.summary as the
    # primary record - see daily_report_router.py, kept read-only alongside
    # this for any historical free-text reports already submitted) ---
    op.add_column("visits", sa.Column("farmers_covered", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("visits", sa.Column("demos_conducted", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("visits", sa.Column("villages_covered", postgresql.ARRAY(sa.String()), nullable=True))
    op.add_column("visits", sa.Column("acres_covered", sa.Numeric(10, 2), nullable=True))
    op.add_column("visits", sa.Column("conversions", sa.Integer(), nullable=False, server_default="0"))

    # --- Annual target + monthly weighting (role-scoped, matching how
    # momentum_targets already scopes by role) ---
    op.create_table(
        "annual_targets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        # "metric" lets the same table anchor different KPIs (task
        # completion for the section 2 widget, farmers_covered for the
        # section 5 KPI rollup) off one yearly-target mechanism instead of
        # building two parallel systems.
        sa.Column("metric", sa.String(50), nullable=False, server_default="tasks_completed"),
        sa.Column("annual_value", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        sa.UniqueConstraint("role", "year", "metric", name="uq_annual_targets_role_year_metric"),
    )

    op.create_table(
        "monthly_target_weights",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("metric", sa.String(50), nullable=False, server_default="tasks_completed"),
        sa.Column("month", sa.SmallInteger(), nullable=False),
        # Fraction of the annual target assigned to this month (should sum
        # to ~1.0 across the 12 rows for a role+metric - enforced at the
        # application layer with a rounding tolerance, not by the DB).
        sa.Column("weight", sa.Numeric(6, 4), nullable=False),
        sa.CheckConstraint("month >= 1 AND month <= 12", name="ck_monthly_target_weights_month"),
        sa.UniqueConstraint("role", "metric", "month", name="uq_monthly_target_weights_role_metric_month"),
    )

    # --- Soft-delete flag for admin CRUD delete support ---
    for table in SOFT_DELETE_TABLES:
        op.add_column(table, sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"))


def downgrade() -> None:
    for table in SOFT_DELETE_TABLES:
        op.drop_column(table, "is_deleted")

    op.drop_table("monthly_target_weights")
    op.drop_table("annual_targets")

    op.drop_column("visits", "conversions")
    op.drop_column("visits", "acres_covered")
    op.drop_column("visits", "villages_covered")
    op.drop_column("visits", "demos_conducted")
    op.drop_column("visits", "farmers_covered")

    op.drop_index("idx_visit_trial_products_visit", table_name="visit_trial_products")
    op.drop_table("visit_trial_products")
    op.drop_column("visits", "is_trial")
