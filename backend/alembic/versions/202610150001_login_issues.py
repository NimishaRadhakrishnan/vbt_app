"""Officer login issues: admin-reviewed device changes with a full audit trail.

Revision ID: 202610150001
Revises: 202610140009

login_issues        one row per blocked sign-in problem (pending until an
                    admin acts on it)
login_issue_events  append-only history: created, repeat attempts, every
                    admin action, the officer notification
users.login_status  what the officer would see today: active,
                    pending_review (waiting for admin), blocked (rejected)
"""
from alembic import op

revision = "202610150001"
down_revision = "202610140009"
branch_labels = None
depends_on = None

_OLD = (
    "disease_uploaded", "weekly_target_missed", "outside_territory",
    "low_dealer_stock", "approval_update", "broadcast",
    "task_assigned", "task_completed",
    "leave_requested", "leave_decided", "enquiry_created", "enquiry_resolved",
    "daily_report_submitted", "task_submitted_for_review", "task_rejected",
    "stock_request", "plan_submitted", "plan_decided",
)
_NEW = ("login_issue", "login_resolved")


def _q(v):
    return ", ".join(f"'{x}'" for x in v)


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS login_status varchar(20) NOT NULL DEFAULT 'active'")
    op.execute(
        """
        CREATE TABLE login_issues (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            issue_type varchar(30) NOT NULL,
            status varchar(20) NOT NULL DEFAULT 'pending',
            description text,
            attempted_device_id varchar(100),
            device_name varchar(200),
            bound_device_id varchar(100),
            ip_address varchar(64),
            attempt_count integer NOT NULL DEFAULT 1,
            last_attempt_at timestamptz NOT NULL DEFAULT now(),
            resolution_action varchar(30),
            resolution_note text,
            resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
            resolved_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_login_issue_type CHECK (issue_type IN ('device_mismatch', 'account_inactive', 'other')),
            CONSTRAINT ck_login_issue_status CHECK (status IN ('pending', 'resolved', 'rejected'))
        )
        """
    )
    op.execute("CREATE INDEX ix_login_issues_status ON login_issues (status, created_at DESC)")
    op.execute("CREATE INDEX ix_login_issues_user ON login_issues (user_id, created_at DESC)")
    op.execute(
        """
        CREATE TABLE login_issue_events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            issue_id uuid NOT NULL REFERENCES login_issues(id) ON DELETE CASCADE,
            event_type varchar(40) NOT NULL,
            actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
            actor_name varchar(200),
            detail text,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_login_issue_events_issue ON login_issue_events (issue_id, created_at)")
    # The admin is notified of a request, the officer of its outcome.
    op.drop_constraint("notifications_type_check", "notifications", type_="check")
    op.create_check_constraint("notifications_type_check", "notifications", f"type IN ({_q(_OLD + _NEW)})")


def downgrade() -> None:
    op.execute(f"DELETE FROM notifications WHERE type IN ({_q(_NEW)})")
    op.drop_constraint("notifications_type_check", "notifications", type_="check")
    op.create_check_constraint("notifications_type_check", "notifications", f"type IN ({_q(_OLD)})")
    op.execute("DROP TABLE IF EXISTS login_issue_events")
    op.execute("DROP TABLE IF EXISTS login_issues")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS login_status")
