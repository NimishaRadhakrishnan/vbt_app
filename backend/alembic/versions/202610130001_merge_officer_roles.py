"""Merge the Sales Officer role into Officer (field_officer).

Revision ID: 202610130001
Revises: 202610080002

Every user with role 'sales_officer' becomes 'field_officer'. Nothing is
deleted: closures, orders, dealers and visits keep pointing at the same user.
Tables keyed by role (targets, momentum targets, emergency scopes) are merged
so the unique keys never clash: where a field_officer row already exists the
old sales_officer row is dropped, otherwise it is renamed.

Not reversible: after this, the former sales officers cannot be told apart.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "202610130001"
down_revision: Union[str, None] = "202610080002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _merge_keyed(table: str, keys: list[str]) -> str:
    same = " AND ".join(f"f.{k} = s.{k}" for k in keys)
    return f"""
    IF to_regclass('{table}') IS NOT NULL THEN
        DELETE FROM {table} s WHERE s.role = 'sales_officer'
            AND EXISTS (SELECT 1 FROM {table} f WHERE f.role = 'field_officer' AND {same});
        UPDATE {table} SET role = 'field_officer' WHERE role = 'sales_officer';
    END IF;
    """


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            UPDATE users SET role = 'field_officer' WHERE role = 'sales_officer';
            """
        + _merge_keyed("annual_targets", ["year", "metric"])
        + _merge_keyed("monthly_target_weights", ["metric", "month"])
        + _merge_keyed("momentum_targets", [])
        .replace("AND EXISTS (SELECT 1 FROM momentum_targets f WHERE f.role = 'field_officer' AND )",
                 "AND EXISTS (SELECT 1 FROM momentum_targets f WHERE f.role = 'field_officer')")
        + """
            IF to_regclass('emergency_overrides') IS NOT NULL THEN
                UPDATE emergency_overrides SET scope_role = 'field_officer' WHERE scope_role = 'sales_officer';
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Cannot tell which officers used to be sales officers.
    pass
