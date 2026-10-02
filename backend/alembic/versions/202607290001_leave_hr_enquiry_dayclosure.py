"""create leave_requests, hr_policies, enquiries, day_closures tables

Revision ID: 202607290001
Revises: 202607280001
Create Date: 2026-07-29 00:01:00

Four independent, additive tables backing four separate features:

- leave_requests: officer-submitted leave (planned or emergency), approved
  or rejected by admin/manager. Validation of the "2 days prior" / "2 hours
  prior" rule happens in the router at submission time, not here — this
  table just stores the outcome.

- hr_policies: small, admin-editable set of policy sections (login timing,
  leave rules, etc.) visible read-only to every officer. Deliberately a
  table, not a static page, so admin can update wording without a
  redeploy.

- enquiries: for farmers who are hesitant to share personal details.
  Intentionally has NO farmer_id / phone / name — just a description,
  an optional photo, and whichever officer is handling it. This is a
  different, lighter-weight flow than crop_issues, which requires a
  registered farmer.

- day_closures: one row per officer per day, holding the "task done"
  document an officer must upload before logging out for the day.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "202607290001"
down_revision: str | None = "202607280001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "leave_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("officer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("leave_type", sa.String(length=20), nullable=False),  # planned | emergency
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),  # pending | approved | rejected
        sa.Column("decided_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("leave_type IN ('planned', 'emergency')", name="ck_leave_requests_type"),
        sa.CheckConstraint("status IN ('pending', 'approved', 'rejected')", name="ck_leave_requests_status"),
        sa.ForeignKeyConstraint(["officer_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["decided_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_leave_requests_officer_id", "leave_requests", ["officer_id"])
    op.create_index("ix_leave_requests_status", "leave_requests", ["status"])

    op.create_table(
        "hr_policies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("section", sa.String(length=100), nullable=False, unique=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
    )

    op.create_table(
        "enquiries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("reported_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("district", sa.String(length=100), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("image_url", sa.String(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),  # open | resolved
        sa.Column("solution", sa.Text(), nullable=True),
        sa.Column("resolved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("status IN ('open', 'resolved')", name="ck_enquiries_status"),
        sa.ForeignKeyConstraint(["reported_by"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["resolved_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_enquiries_status", "enquiries", ["status"])

    op.create_table(
        "day_closures",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("officer_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("document_url", sa.String(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["officer_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("officer_id", "date", name="uq_day_closures_officer_date"),
    )

    # Seed the initial HR policy content admins can then edit in place.
    op.execute(
        """
        INSERT INTO hr_policies (id, section, title, content, display_order)
        VALUES
            (gen_random_uuid(), 'login_time', 'Daily Login Time',
             'All field and sales officers must check in through the app before 9:00 AM every working day. Officers who have not checked in by 9:00 AM will be flagged as late on the admin dashboard and will receive an in-app reminder.',
             1),
            (gen_random_uuid(), 'monitoring_window', 'Monitoring Window',
             'Officers are expected to remain reachable and keep location sharing on from check-in until 6:00 PM. Before logging out for the day, upload a document/photo confirming the day''s task is complete.',
             2),
            (gen_random_uuid(), 'planned_leave', 'Planned Leave',
             'Planned leave must be requested at least 2 days before the leave start date. Submit the leave form with your reason; your manager will approve or reject it.',
             3),
            (gen_random_uuid(), 'emergency_leave', 'Emergency Leave',
             'Emergency leave must be requested at least 2 hours before the leave start time wherever possible. Use the "Emergency" leave type and explain the situation briefly.',
             4)
        """
    )


def downgrade() -> None:
    op.drop_table("day_closures")
    op.drop_index("ix_enquiries_status", table_name="enquiries")
    op.drop_table("enquiries")
    op.drop_table("hr_policies")
    op.drop_index("ix_leave_requests_status", table_name="leave_requests")
    op.drop_index("ix_leave_requests_officer_id", table_name="leave_requests")
    op.drop_table("leave_requests")
