"""users.phone: optional contact number

Admins now create accounts with an Employee ID (mandatory, used to sign in)
and an optional phone number instead of an email address. Existing accounts
keep their email untouched. The email column stays NOT NULL and unique;
accounts created without one get an internal placeholder address generated
by the API, so nothing that reads users.email has to change.

Revision ID: 202610060001
Revises: 202609300002
Create Date: 2026-10-06
"""
from typing import Sequence, Union

from alembic import op

revision: str = "202610060001"
down_revision: Union[str, None] = "202609300002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20)")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS phone")
