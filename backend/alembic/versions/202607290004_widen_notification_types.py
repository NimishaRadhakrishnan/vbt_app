"""fix: widen notifications_type_check to include leave/enquiry notification types

Revision ID: 202607290004
Revises: 202607290003
Create Date: 2026-07-29 00:04:00

Found by exercising the new leave-request flow end to end: submitting a
valid leave request throws a 500 because the notifications table's
CHECK constraint only allows a fixed, older whitelist of `type` values
and rejects 'leave_requested' / 'leave_decided'. This widens the
constraint additively — every value it already allowed is kept.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "202607290004"
down_revision: str | None = "202607290003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_TYPES = (
    "disease_uploaded", "weekly_target_missed", "outside_territory",
    "low_dealer_stock", "approval_update", "broadcast",
    "task_assigned", "task_completed",
)
_NEW_TYPES = ("leave_requested", "leave_decided", "enquiry_created", "enquiry_resolved")


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


def upgrade() -> None:
    op.drop_constraint("notifications_type_check", "notifications", type_="check")
    op.create_check_constraint(
        "notifications_type_check",
        "notifications",
        f"type IN ({_quoted(_OLD_TYPES + _NEW_TYPES)})",
    )


def downgrade() -> None:
    op.drop_constraint("notifications_type_check", "notifications", type_="check")
    op.create_check_constraint(
        "notifications_type_check",
        "notifications",
        f"type IN ({_quoted(_OLD_TYPES)})",
    )
