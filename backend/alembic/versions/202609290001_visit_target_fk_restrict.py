"""visits.farmer_id / dealer_id: SET NULL -> RESTRICT

The two constraints contradicted each other:

  * visits_farmer_id_fkey  FOREIGN KEY (farmer_id) ... ON DELETE SET NULL
  * check_visit_target     CHECK (visit_type='farmer' AND farmer_id IS NOT NULL ...)

Deleting a farmer made Postgres set visits.farmer_id = NULL, which the CHECK
then refused. The delete could never succeed; it raised CheckViolation and the
API returned 500. The same held for dealers.

SET NULL was never reachable, so switching to RESTRICT removes no behaviour
that ever worked. It makes the database refuse the delete cleanly, which the
router turns into a readable 400 telling the admin to archive instead. This
matches the policy already applied to the other history tables: visits are the
company's record of work done and must not be orphaned.

Revision ID: 202609290001
Revises: 202609220003
Create Date: 2026-09-29
"""
from typing import Sequence, Union

from alembic import op

revision: str = "202609290001"
down_revision: Union[str, None] = "202609220003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_farmer_id_fkey")
    op.execute(
        "ALTER TABLE visits ADD CONSTRAINT visits_farmer_id_fkey "
        "FOREIGN KEY (farmer_id) REFERENCES farmers(id) ON DELETE RESTRICT"
    )

    op.execute("ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_dealer_id_fkey")
    op.execute(
        "ALTER TABLE visits ADD CONSTRAINT visits_dealer_id_fkey "
        "FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE RESTRICT"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_farmer_id_fkey")
    op.execute(
        "ALTER TABLE visits ADD CONSTRAINT visits_farmer_id_fkey "
        "FOREIGN KEY (farmer_id) REFERENCES farmers(id) ON DELETE SET NULL"
    )

    op.execute("ALTER TABLE visits DROP CONSTRAINT IF EXISTS visits_dealer_id_fkey")
    op.execute(
        "ALTER TABLE visits ADD CONSTRAINT visits_dealer_id_fkey "
        "FOREIGN KEY (dealer_id) REFERENCES dealers(id) ON DELETE SET NULL"
    )
