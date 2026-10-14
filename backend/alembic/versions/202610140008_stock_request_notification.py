"""Allow 'stock_request' notifications (stock requests failed with a DB conflict).

Revision ID: 202610140008
Revises: 202610140007
"""
from alembic import op

revision = "202610140008"
down_revision = "202610140007"
branch_labels = None
depends_on = None

_OLD = (
    "disease_uploaded", "weekly_target_missed", "outside_territory",
    "low_dealer_stock", "approval_update", "broadcast",
    "task_assigned", "task_completed",
    "leave_requested", "leave_decided", "enquiry_created", "enquiry_resolved",
    "daily_report_submitted", "task_submitted_for_review", "task_rejected",
)
_NEW = ("stock_request", "plan_submitted", "plan_decided")


def _q(v):
    return ", ".join(f"'{x}'" for x in v)


def upgrade() -> None:
    op.drop_constraint("notifications_type_check", "notifications", type_="check")
    op.create_check_constraint("notifications_type_check", "notifications", f"type IN ({_q(_OLD + _NEW)})")


def downgrade() -> None:
    op.execute(f"DELETE FROM notifications WHERE type IN ({_q(_NEW)})")
    op.drop_constraint("notifications_type_check", "notifications", type_="check")
    op.create_check_constraint("notifications_type_check", "notifications", f"type IN ({_q(_OLD)})")
