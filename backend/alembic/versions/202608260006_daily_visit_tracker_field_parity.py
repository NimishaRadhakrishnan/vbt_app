"""daily visit tracker: full field-list parity with the source Google Form

Revision ID: 202608260006
Revises: 202608260005
Create Date: 2026-08-26 04:00:00

Brings the schema up to full parity with the real, currently-used Field
Officer Daily Visit Tracker Google Form. Confirmed gaps, checked against
the actual seed data and CHECK constraints (not guessed):

1. demo_status CHECK constraint only allowed 6 values (agreed,
   started_today, running, success, failed, converted) - the previous
   session's DayClosureForm.tsx frontend was ALREADY sending an 8-stage
   set (not_discussed, explained_not_interested, agreed_not_started,
   started_today, followup_running, completed_success, completed_failed,
   converted) that only overlaps on 2 of 8 values. Any submission
   choosing one of the other 6 stages would have hit a database
   CHECK-constraint violation. This migration widens the constraint to
   the correct 8-value set - a real bug fix, not just new-feature scope.

2. crop_status was missing 'nutrient_deficiency' and had no 'other'
   catch-all + free-text column, even though the form offers both.

3. farm_operations was missing 'Thinning'; micronutrients had no
   selectable 'NA' row (the form's own instruction - "if not applied,
   mention NA" - implies a real value, not just an empty field);
   pests was missing 'Brown plant hopper' and 'Army worm'; diseases was
   missing 'Downy mildew'; organic_solutions only had 2 of the form's 8
   organic-practice options (Jeevamrutham, Panchagavya) because it was
   previously conflated with the *separate* IPM/bio-solutions list
   (Trichoderma, Pseudomonas, Neem oil, Pheromone traps also live in
   that same table today).

4. IPM/bio solutions needs its OWN table distinct from organic_solutions
   - the form explicitly keeps "Neem-based spray" (organic practice) and
   "Neem oil" (IPM solution) as two different items in two different
   lists, so a shared table can't represent both correctly even though
   Trichoderma/Pseudomonas/Neem oil/Pheromone traps happen to also be
   valid organic-practice-adjacent items in the loose sense.

5. visit_trial_details had no "number of farmers present at this visit"
   column. visit_crop_profiles had no column for "any recurring pest/
   disease issue from past seasons" free text.

Deliberately NOT touched: existing pests/diseases/organic_solutions rows
and IDs (nothing removed, nothing renamed - only additive INSERTs guarded
with WHERE NOT EXISTS so re-running this migration, or it having already
run partially, can't create duplicates).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260006"
down_revision: str | None = "202608260005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _uuid_pk():
    return sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _insert_if_missing(table: str, names: list[str]) -> None:
    for name in names:
        op.execute(
            sa.text(f"INSERT INTO {table} (id, name) SELECT gen_random_uuid(), :name "
                     f"WHERE NOT EXISTS (SELECT 1 FROM {table} WHERE name = :name)").bindparams(name=name)
        )


def upgrade() -> None:
    # --- 1. demo_status: widen to the real 8-stage set ---
    op.drop_constraint("ck_visit_trial_demo_status", "visit_trial_details", type_="check")
    op.create_check_constraint(
        "ck_visit_trial_demo_status",
        "visit_trial_details",
        "demo_status IS NULL OR demo_status IN ("
        "'not_discussed','explained_not_interested','agreed_not_started','started_today',"
        "'followup_running','completed_success','completed_failed','converted')",
    )

    # --- 2. crop_status: add nutrient_deficiency + other, plus a
    # free-text column for when 'other' is chosen ---
    op.drop_constraint("ck_visit_health_crop_status", "visit_health", type_="check")
    op.create_check_constraint(
        "ck_visit_health_crop_status",
        "visit_health",
        "crop_status IN ('healthy','mild_stress','pest_disease_affected','drought','waterlogged',"
        "'nutrient_deficiency','other')",
    )
    op.add_column("visit_health", sa.Column("status_other_text", sa.String(200), nullable=True))
    op.add_column("visit_health", sa.Column("pest_other_text", sa.String(200), nullable=True))
    op.add_column("visit_health", sa.Column("disease_other_text", sa.String(200), nullable=True))

    # --- 3. crop_category "Other" + recurring-issue free text ---
    op.add_column("visit_crop_profiles", sa.Column("crop_category_other_text", sa.String(200), nullable=True))
    op.add_column("visit_crop_profiles", sa.Column("recurring_issue_text", sa.Text(), nullable=True))

    # --- 4. visit_trial_details: number of farmers present ---
    op.add_column("visit_trial_details", sa.Column("farmers_present_count", sa.Integer(), nullable=True))

    # --- 5. IPM/bio solutions: its own table + junction, distinct from
    # organic_solutions (see module docstring point 4). ipm_other_text
    # lives on visit_advisory rather than visit_trial_details since
    # visit_advisory is always inserted unconditionally for every visit -
    # visit_trial_details only exists when is_trial is true, but IPM
    # solutions can be used on a non-trial visit too. ---
    op.create_table(
        "ipm_solutions",
        _uuid_pk(),
        sa.Column("name", sa.String(50), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.execute(
        """
        INSERT INTO ipm_solutions (id, name) VALUES
        (gen_random_uuid(), 'Trichoderma'), (gen_random_uuid(), 'Pseudomonas'),
        (gen_random_uuid(), 'Beauveria bassiana'), (gen_random_uuid(), 'Metarhizium'),
        (gen_random_uuid(), 'Trichogramma cards'), (gen_random_uuid(), 'Pheromone traps'),
        (gen_random_uuid(), 'Yellow sticky traps'), (gen_random_uuid(), 'Neem oil'),
        (gen_random_uuid(), 'Bio-pesticide')
        """
    )
    op.create_table(
        "visit_ipm_solutions",
        _uuid_pk(),
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("visits.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ipm_solution_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ipm_solutions.id"), nullable=False),
    )
    op.add_column("visit_advisory", sa.Column("ipm_other_text", sa.String(200), nullable=True))

    # --- 6. Master-data gaps, additive only ---
    _insert_if_missing("farm_operations", ["Thinning", "Other"])
    _insert_if_missing("micronutrients", ["NA", "Other"])
    _insert_if_missing("pests", ["Brown plant hopper", "Army worm", "Other"])
    _insert_if_missing("diseases", ["Downy mildew", "Other"])
    _insert_if_missing(
        "organic_solutions",
        ["Vermicompost", "Green manure", "Neem-based spray", "Bio-fertilisers", "Crop rotation", "Trap crops", "Other"],
    )
    _insert_if_missing("ipm_solutions", ["Other"])
    op.add_column("visit_organic_solutions", sa.Column("other_text", sa.String(200), nullable=True))
    op.add_column("visit_micronutrients", sa.Column("other_text", sa.String(200), nullable=True))
    op.add_column("visit_farm_operations", sa.Column("other_text", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("visit_farm_operations", "other_text")
    op.drop_column("visit_micronutrients", "other_text")
    op.drop_column("visit_organic_solutions", "other_text")
    op.drop_table("visit_ipm_solutions")
    op.drop_table("ipm_solutions")
    op.drop_column("visit_advisory", "ipm_other_text")
    op.drop_column("visit_trial_details", "farmers_present_count")
    op.drop_column("visit_crop_profiles", "recurring_issue_text")
    op.drop_column("visit_crop_profiles", "crop_category_other_text")
    op.drop_column("visit_health", "disease_other_text")
    op.drop_column("visit_health", "pest_other_text")
    op.drop_column("visit_health", "status_other_text")
    op.drop_constraint("ck_visit_health_crop_status", "visit_health", type_="check")
    op.create_check_constraint(
        "ck_visit_health_crop_status", "visit_health",
        "crop_status IN ('healthy','mild_stress','pest_disease_affected','drought','waterlogged')",
    )
    op.drop_constraint("ck_visit_trial_demo_status", "visit_trial_details", type_="check")
    op.create_check_constraint(
        "ck_visit_trial_demo_status", "visit_trial_details",
        "demo_status IS NULL OR demo_status IN ('agreed','started_today','running','success','failed','converted')",
    )
