"""add task review columns and widen notification types for review workflow

Revision ID: 202608090001
Revises: 202608070001
Create Date: 2026-08-09 00:01:00

Two changes, both needed for the manager/admin task-review workflow:

1. Adds reviewed_by / reviewed_at / rejection_reason to tasks, following
   the exact pattern of 7c10461ba2c1 (add proof to tasks) - nullable
   columns, no backfill needed since no task has ever been reviewed
   before this feature existed.

2. Widens notifications_type_check to include task_submitted_for_review
   and task_rejected. This constraint has already been widened twice
   before (202607290004, 202607290005) for exactly this reason - adding
   a new notification type without updating this check causes the
   INSERT to fail at runtime with a constraint violation, not at
   review/deploy time, so it's easy to miss without checking for it
   directly (confirmed this constraint exists and got the current full
   type list by reading 202607290005 rather than assuming).
3. Widens tasks' own ck_tasks_status CHECK constraint to include
   pending_review. This is a separate, easy-to-miss constraint from the
   notifications one above - it wasn't visible from reading task_router.py
   or the original task-table migration; only found by inspecting the
   real resulting schema (\\d tasks) after running this migration once.
   Without it, setting status='pending_review' fails at the database
   layer with a constraint violation, not in application code.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608090001"
down_revision: str | None = "202608070001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_NOTIFICATION_TYPES = (
    "disease_uploaded", "weekly_target_missed", "outside_territory",
    "low_dealer_stock", "approval_update", "broadcast",
    "task_assigned", "task_completed",
    "leave_requested", "leave_decided", "enquiry_created", "enquiry_resolved",
    "daily_report_submitted",
)
_NEW_NOTIFICATION_TYPES = ("task_submitted_for_review", "task_rejected")

_OLD_TASK_STATUSES = ("assigned", "in_progress", "done", "cancelled")
_NEW_TASK_STATUSES = ("pending_review",)


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


def upgrade() -> None:
    op.add_column("tasks", sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_tasks_reviewed_by_users", "tasks", "users", ["reviewed_by"], ["id"], ondelete="SET NULL"
    )
    op.add_column("tasks", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tasks", sa.Column("rejection_reason", sa.Text(), nullable=True))

    op.drop_constraint("notifications_type_check", "notifications", type_="check")
    op.create_check_constraint(
        "notifications_type_check",
        "notifications",
        f"type IN ({_quoted(_OLD_NOTIFICATION_TYPES + _NEW_NOTIFICATION_TYPES)})",
    )

    op.drop_constraint("ck_tasks_status", "tasks", type_="check")
    op.create_check_constraint(
        "ck_tasks_status",
        "tasks",
        f"status IN ({_quoted(_OLD_TASK_STATUSES + _NEW_TASK_STATUSES)})",
    )


def downgrade() -> None:
    op.drop_constraint("ck_tasks_status", "tasks", type_="check")
    op.create_check_constraint(
        "ck_tasks_status",
        "tasks",
        f"status IN ({_quoted(_OLD_TASK_STATUSES)})",
    )

    op.drop_constraint("notifications_type_check", "notifications", type_="check")
    op.create_check_constraint(
        "notifications_type_check",
        "notifications",
        f"type IN ({_quoted(_OLD_NOTIFICATION_TYPES)})",
    )

    op.drop_column("tasks", "rejection_reason")
    op.drop_column("tasks", "reviewed_at")
    op.drop_constraint("fk_tasks_reviewed_by_users", "tasks", type_="foreignkey")
    op.drop_column("tasks", "reviewed_by")
