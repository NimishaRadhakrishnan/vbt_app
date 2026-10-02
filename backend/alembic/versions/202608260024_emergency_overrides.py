"""emergency_overrides: admin-declared suspension of day-closure enforcement

Revision ID: 202608260024
Revises: 202608260023
Create Date: 2026-09-08 10:00:00

Approved requirement (§6): an authorised admin can declare an emergency
that suspends day-closure enforcement, with a reason, a scope, a start
and end time, and a mandatory audit trail.

Why this is a blocker rather than a nice-to-have
------------------------------------------------
17:30 logout enforcement is live. Without an override there is NO escape
hatch: if a genuine incident stops officers filing closures - a network
outage, a regional disruption, a festival day declared late - every
affected officer is locked out of signing out, and the only remedy is a
developer changing code or an admin hand-inserting closure rows.

Effect (approved, and deliberately narrow)
------------------------------------------
An active override suppresses:
  - the 17:30 day-closure warning
  - the logout day-closure gate

It does NOT change working hours, and does NOT stop officers submitting
closures if they want to. "Emergency" here means "do not penalise
people", not "turn the day off".

Scope targeting
---------------
NULL = "all", for both role and district; a non-null value narrows.
Kept as two independent nullable columns rather than a scope-type enum
because the combinations an admin actually needs (all / one role / one
district / one role in one district) fall out naturally, with no
invalid states to guard.

District targeting works via territories.district joined through
user_territories - `users` itself has no district column (verified).
That indirection is why district scope is resolved in the router rather
than expressed as a foreign key here.

Times are timestamptz, compared against company time - an override
declared "until 6pm" must mean 6pm in India, not on whichever server
happens to run this.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260024"
down_revision: str | None = "202608260023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "emergency_overrides",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        # Mandatory: an override with no stated cause is not auditable,
        # and this is the control that switches off a compliance rule.
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        # NULL = every role / every district.
        sa.Column("scope_role", sa.String(30), nullable=True),
        sa.Column("scope_district", sa.String(100), nullable=True),
        # Manual kill switch, independent of the end time (approved:
        # "required start and end time, PLUS manual disable").
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("cancelled_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("ends_at > starts_at", name="ck_emergency_override_window"),
        sa.CheckConstraint(
            "scope_role IS NULL OR scope_role IN ('field_officer', 'sales_officer')",
            name="ck_emergency_override_role",
        ),
        sa.CheckConstraint("length(trim(reason)) > 0", name="ck_emergency_override_reason"),
    )
    # Lookup is "is anything active right now for this officer?", run on
    # every logout and every warning check, so it needs to be cheap.
    op.create_index(
        "ix_emergency_overrides_window",
        "emergency_overrides",
        ["is_active", "starts_at", "ends_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_emergency_overrides_window", table_name="emergency_overrides")
    op.drop_table("emergency_overrides")
