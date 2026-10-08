"""Allow "years" as a crop age unit (days, weeks, months, years)

Revision ID: 202610080002
Revises: 202610080001
Create Date: 2026-10-08
"""
from typing import Sequence, Union

from alembic import op

revision: str = "202610080002"
down_revision: Union[str, None] = "202610080001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop whichever check constraint limits crop_age_unit (found by what it
    # says rather than by name), then add the wider one.
    op.execute(
        """
        DO $$
        DECLARE c record;
        BEGIN
            FOR c IN
                SELECT conname FROM pg_constraint
                WHERE conrelid = 'visit_crop_profiles'::regclass
                  AND contype = 'c'
                  AND pg_get_constraintdef(oid) ILIKE '%crop_age_unit%'
            LOOP
                EXECUTE format('ALTER TABLE visit_crop_profiles DROP CONSTRAINT %I', c.conname);
            END LOOP;
        END $$;
        """
    )
    op.execute(
        "ALTER TABLE visit_crop_profiles ADD CONSTRAINT ck_crop_age_unit "
        "CHECK (crop_age_unit IS NULL OR crop_age_unit IN ('days','weeks','months','years'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE visit_crop_profiles DROP CONSTRAINT IF EXISTS ck_crop_age_unit")
    op.execute(
        "ALTER TABLE visit_crop_profiles ADD CONSTRAINT ck_crop_age_unit "
        "CHECK (crop_age_unit IS NULL OR crop_age_unit IN ('days','weeks','months'))"
    )
