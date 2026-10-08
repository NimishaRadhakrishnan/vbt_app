"""An "Other" choice in every officer pick-list, with room to type the answer

* visit_crop_profiles.crop_other_text: where the typed crop name goes when an
  officer picks "Other" as the crop (the crop category, variety and chemical
  already had somewhere to put it).
* Makes sure pests, diseases, micronutrients, farm operations and organic
  solutions each have an active "Other" row. They were seeded earlier, but an
  admin can deactivate or delete a row, and the officer then has no way to
  record something that is not on the list.

Revision ID: 202610080001
Revises: 202610070002
Create Date: 2026-10-08
"""
from typing import Sequence, Union

from alembic import op

revision: str = "202610080001"
down_revision: Union[str, None] = "202610070002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_LISTS = ["pests", "diseases", "micronutrients", "farm_operations", "organic_solutions"]


def upgrade() -> None:
    op.execute("ALTER TABLE visit_crop_profiles ADD COLUMN IF NOT EXISTS crop_other_text VARCHAR(200)")
    for table in _LISTS:
        op.execute(f"UPDATE {table} SET is_active = true WHERE lower(name) IN ('other', 'others')")
        op.execute(
            f"""
            INSERT INTO {table} (id, name)
            SELECT gen_random_uuid(), 'Other'
            WHERE NOT EXISTS (SELECT 1 FROM {table} WHERE lower(name) IN ('other', 'others'))
            """
        )


def downgrade() -> None:
    op.execute("ALTER TABLE visit_crop_profiles DROP COLUMN IF EXISTS crop_other_text")
