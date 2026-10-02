"""add form_config_versions table

Revision ID: 202608260027
Revises: 202608260026_stock_ledger
Create Date: 2026-09-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '202608260027'
down_revision = '202608260026'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        'form_config_versions',
        sa.Column('form_key', sa.String(length=255), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('form_key')
    )
    # Seed the initial version for day_closure
    op.execute("INSERT INTO form_config_versions (form_key, version) VALUES ('day_closure', 1)")

def downgrade() -> None:
    op.drop_table('form_config_versions')
