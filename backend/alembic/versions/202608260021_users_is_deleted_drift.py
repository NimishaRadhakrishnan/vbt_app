"""users.is_deleted: repair schema drift between model and database

Revision ID: 202608260021
Revises: 202608260020
Create Date: 2026-09-07 13:00:00

Bug found while running the integration suite against a freshly
migrated database.

`UserModel` declares:

    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, ...)

but no migration ever created that column. So the ORM emits INSERT and
SELECT statements naming users.is_deleted against a database that does
not have it, and every path touching the users table fails with
UndefinedColumnError.

This was masked in day-to-day use because long-lived environments were
presumably created before the field was added to the model (or by
create_all rather than alembic), so their `users` table happened to
have the column. It surfaces the moment anyone provisions a database
purely from the migration chain - which is what a new deployment, a CI
run, or `scripts/demo_seed.py` on a clean database does.

Pre-existing defect, not introduced by any recent work: no migration in
the chain has ever referenced it.

server_default 'false' so existing rows are backfilled as not-deleted,
which is correct - a user who exists today has not been deleted.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "202608260021"
down_revision: str | None = "202608260020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # IF NOT EXISTS: environments that predate the migration chain may
    # already carry this column (see docstring). Without the guard this
    # migration would fail on exactly the long-lived databases it is
    # meant to bring back into line.
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS is_deleted")
