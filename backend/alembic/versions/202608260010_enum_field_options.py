"""enum_field_options: convert CHECK-constrained fields to admin-manageable lookup tables

Revision ID: 202608260010
Revises: 202608260009
Create Date: 2026-08-29 03:00:00

Direct request asked for a UI that generates and runs a NEW alembic
migration live, from an admin button click, to add/remove values from
crop_status/demo_status/farming_type's CHECK constraints. That's not
implemented as described - see the chat message accompanying this
migration for the full reasoning, summarized here: it would require the
running app server to write Python files into its own source tree and
execute `alembic upgrade` from inside a request handler (real code-
execution risk from a web action), and "wrap the migration and the
config update in one transaction" doesn't actually correspond to
anything real - a transaction can roll back database rows, not a
Python file already written to disk.

This migration makes the ONE real, reviewed schema change needed to
achieve the actual goal safely: converts these three fields from
CHECK-constraint-enforced to lookup-table-validated, the same pattern
`pests`/`diseases`/`crop_categories` already use elsewhere in this
schema. After this migration, every future add/remove/deactivate of an
option is ordinary transactional row CRUD against `enum_field_options` -
never touching the schema again, never generating code at runtime.

Seeded with the EXACT current allowed values, read directly from the
CHECK constraints being replaced (202608260006 and 202608250001), not
guessed - so this is a pure mechanism swap, not a values change.

Validation for these three fields moves from the database (CHECK
constraint) to the application layer (daily_visit_tracker_router.py's
submit_daily_visit(), checked against this table) - a live lookup table
can't be expressed as a static CHECK constraint, so this is the standard
trade-off for making a value set admin-editable at all.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260010"
down_revision: str | None = "202608260009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (field_name, value, label, display_order)
_SEED_OPTIONS = [
    # crop_status - from ck_visit_health_crop_status (202608260006)
    ("crop_status", "healthy", "Healthy", 10),
    ("crop_status", "mild_stress", "Mild Stress", 20),
    ("crop_status", "pest_disease_affected", "Pest/Disease Affected", 30),
    ("crop_status", "drought", "Drought", 40),
    ("crop_status", "waterlogged", "Waterlogged", 50),
    ("crop_status", "nutrient_deficiency", "Nutrient Deficiency", 60),
    ("crop_status", "other", "Other", 70),
    # demo_status - from ck_visit_trial_demo_status (202608260006)
    ("demo_status", "not_discussed", "No demo - not discussed", 10),
    ("demo_status", "explained_not_interested", "Demo explained - farmer not interested", 20),
    ("demo_status", "agreed_not_started", "Farmer AGREED for demo - not yet started", 30),
    ("demo_status", "started_today", "Demo STARTED today - plot set up", 40),
    ("demo_status", "followup_running", "Follow-up visit on running demo", 50),
    ("demo_status", "completed_success", "Demo completed - success", 60),
    ("demo_status", "completed_failed", "Demo completed - failed", 70),
    ("demo_status", "converted", "Converted to paid purchase", 80),
    # farming_type - from ck_visits_farming_type (202608250001)
    ("farming_type", "certified_organic", "Yes - certified organic", 10),
    ("farming_type", "natural_farming", "Yes - natural farming (no certification)", 20),
    ("farming_type", "transitioning", "Transitioning to organic", 30),
    ("farming_type", "conventional", "No - conventional (chemical)", 40),
]


def upgrade() -> None:
    op.create_table(
        "enum_field_options",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("field_name", sa.String(50), nullable=False),
        sa.Column("value", sa.String(50), nullable=False),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # Case-insensitive uniqueness per field, enforced by the database
    # itself (not just application code) - matches the "never allow
    # duplicate values (case-insensitive)" safety rail at the level that
    # actually guarantees it even under concurrent requests.
    op.execute(
        "CREATE UNIQUE INDEX uq_enum_field_options_field_value_ci "
        "ON enum_field_options (field_name, lower(value))"
    )

    for field_name, value, label, order in _SEED_OPTIONS:
        op.execute(
            sa.text("""
                INSERT INTO enum_field_options (id, field_name, value, label, display_order)
                VALUES (gen_random_uuid(), :field_name, :value, :label, :order)
            """).bindparams(field_name=field_name, value=value, label=label, order=order)
        )

    # Drop the CHECK constraints these fields relied on - validation
    # moves to the application layer against enum_field_options (see
    # module docstring). The columns themselves are untouched.
    op.drop_constraint("ck_visit_health_crop_status", "visit_health", type_="check")
    op.drop_constraint("ck_visit_trial_demo_status", "visit_trial_details", type_="check")
    op.drop_constraint("ck_visits_farming_type", "visits", type_="check")


def downgrade() -> None:
    op.create_check_constraint(
        "ck_visits_farming_type", "visits",
        "farming_type IS NULL OR farming_type IN ('certified_organic', 'natural_farming', 'transitioning', 'conventional')",
    )
    op.create_check_constraint(
        "ck_visit_trial_demo_status", "visit_trial_details",
        "demo_status IS NULL OR demo_status IN ("
        "'not_discussed','explained_not_interested','agreed_not_started','started_today',"
        "'followup_running','completed_success','completed_failed','converted')",
    )
    op.create_check_constraint(
        "ck_visit_health_crop_status", "visit_health",
        "crop_status IN ('healthy','mild_stress','pest_disease_affected','drought','waterlogged',"
        "'nutrient_deficiency','other')",
    )
    op.drop_index("uq_enum_field_options_field_value_ci", table_name="enum_field_options")
    op.drop_table("enum_field_options")
