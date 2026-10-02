"""user soft delete and constraints

Revision ID: 202609220001
Revises: 202608260027
Create Date: 2026-09-22 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '202609220001'
down_revision = '202608260027'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # Add columns to users
    op.add_column('users', sa.Column('password_changed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('password_changed_by', sa.UUID(), nullable=True))
    op.add_column('users', sa.Column('failed_logins', sa.Integer(), server_default='0', nullable=False))
    op.add_column('users', sa.Column('last_failed_login_at', sa.DateTime(timezone=True), nullable=True))

    op.create_foreign_key(
        'fk_users_password_changed_by_users',
        'users', 'users',
        ['password_changed_by'], ['id'],
        ondelete='SET NULL'
    )

    # Change foreign keys to RESTRICT
    # gps_tracks
    op.drop_constraint('gps_tracks_user_id_fkey', 'gps_tracks', type_='foreignkey')
    op.create_foreign_key(
        'gps_tracks_user_id_fkey',
        'gps_tracks', 'users',
        ['user_id'], ['id'],
        ondelete='RESTRICT'
    )
    
    # stock_ledger
    op.drop_constraint('stock_ledger_officer_id_fkey', 'stock_ledger', type_='foreignkey')
    op.create_foreign_key(
        'stock_ledger_officer_id_fkey',
        'stock_ledger', 'users',
        ['officer_id'], ['id'],
        ondelete='RESTRICT'
    )

def downgrade() -> None:
    # Reverse foreign keys to CASCADE
    op.drop_constraint('stock_ledger_officer_id_fkey', 'stock_ledger', type_='foreignkey')
    op.create_foreign_key(
        'stock_ledger_officer_id_fkey',
        'stock_ledger', 'users',
        ['officer_id'], ['id'],
        ondelete='CASCADE'
    )

    op.drop_constraint('gps_tracks_user_id_fkey', 'gps_tracks', type_='foreignkey')
    op.create_foreign_key(
        'gps_tracks_user_id_fkey',
        'gps_tracks', 'users',
        ['user_id'], ['id'],
        ondelete='CASCADE'
    )

    op.drop_constraint('fk_users_password_changed_by_users', 'users', type_='foreignkey')
    op.drop_column('users', 'last_failed_login_at')
    op.drop_column('users', 'failed_logins')
    op.drop_column('users', 'password_changed_by')
    op.drop_column('users', 'password_changed_at')
