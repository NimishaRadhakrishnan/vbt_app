"""create daily_work_reports table and widen notification types

Revision ID: 202607290005
Revises: 202607290004
Create Date: 2026-07-29 17:35:00

"""

from __future__ import annotations

from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202607290005"
down_revision: str | None = "202607290004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_TYPES = (
    "disease_uploaded", "weekly_target_missed", "outside_territory",
    "low_dealer_stock", "approval_update", "broadcast",
    "task_assigned", "task_completed",
    "leave_requested", "leave_decided", "enquiry_created", "enquiry_resolved"
)
_NEW_TYPES = ("daily_report_submitted",)

def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)

def upgrade() -> None:
    # Create daily_work_reports table
    op.create_table(
        "daily_work_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("report_date", sa.Date(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("attachment_url", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    
    op.create_unique_constraint(
        "uq_daily_work_reports_user_date",
        "daily_work_reports",
        ["user_id", "report_date"]
    )

    # Widen notification types
    op.drop_constraint("notifications_type_check", "notifications", type_="check")
    op.create_check_constraint(
        "notifications_type_check",
        "notifications",
        f"type IN ({_quoted(_OLD_TYPES + _NEW_TYPES)})",
    )


def downgrade() -> None:
    # Revert notification types
    op.drop_constraint("notifications_type_check", "notifications", type_="check")
    op.create_check_constraint(
        "notifications_type_check",
        "notifications",
        f"type IN ({_quoted(_OLD_TYPES)})",
    )

    # Drop table
    op.drop_table("daily_work_reports")
