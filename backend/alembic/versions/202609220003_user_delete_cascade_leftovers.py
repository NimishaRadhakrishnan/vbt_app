"""user_delete_cascade_leftovers

Revision ID: 202609220003
Revises: 202609220002
Create Date: 2026-09-22 17:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '202609220003'
down_revision: Union[str, None] = '202609220002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # device_registry
    op.drop_constraint('device_registry_user_id_fkey', 'device_registry', type_='foreignkey')
    op.create_foreign_key('device_registry_user_id_fkey', 'device_registry', 'users', ['user_id'], ['id'], ondelete='CASCADE')

    # user_territories
    op.drop_constraint('user_territories_user_id_fkey', 'user_territories', type_='foreignkey')
    op.create_foreign_key('user_territories_user_id_fkey', 'user_territories', 'users', ['user_id'], ['id'], ondelete='CASCADE')

    # notifications
    op.drop_constraint('notifications_user_id_fkey', 'notifications', type_='foreignkey')
    op.create_foreign_key('notifications_user_id_fkey', 'notifications', 'users', ['user_id'], ['id'], ondelete='CASCADE')

    # visit_drafts
    op.drop_constraint('visit_drafts_officer_id_fkey', 'visit_drafts', type_='foreignkey')
    op.create_foreign_key('visit_drafts_officer_id_fkey', 'visit_drafts', 'users', ['officer_id'], ['id'], ondelete='CASCADE')

    # personal_bests
    op.drop_constraint('personal_bests_user_id_fkey', 'personal_bests', type_='foreignkey')
    op.create_foreign_key('personal_bests_user_id_fkey', 'personal_bests', 'users', ['user_id'], ['id'], ondelete='CASCADE')

    # user_badges
    op.drop_constraint('user_badges_user_id_fkey', 'user_badges', type_='foreignkey')
    op.create_foreign_key('user_badges_user_id_fkey', 'user_badges', 'users', ['user_id'], ['id'], ondelete='CASCADE')

    # officer_locations
    op.drop_constraint('officer_locations_officer_id_fkey', 'officer_locations', type_='foreignkey')
    op.create_foreign_key('officer_locations_officer_id_fkey', 'officer_locations', 'users', ['officer_id'], ['id'], ondelete='CASCADE')


def downgrade() -> None:
    # device_registry
    op.drop_constraint('device_registry_user_id_fkey', 'device_registry', type_='foreignkey')
    op.create_foreign_key('device_registry_user_id_fkey', 'device_registry', 'users', ['user_id'], ['id'], ondelete='RESTRICT')

    # user_territories
    op.drop_constraint('user_territories_user_id_fkey', 'user_territories', type_='foreignkey')
    op.create_foreign_key('user_territories_user_id_fkey', 'user_territories', 'users', ['user_id'], ['id'], ondelete='RESTRICT')

    # notifications
    op.drop_constraint('notifications_user_id_fkey', 'notifications', type_='foreignkey')
    op.create_foreign_key('notifications_user_id_fkey', 'notifications', 'users', ['user_id'], ['id'], ondelete='RESTRICT')

    # visit_drafts
    op.drop_constraint('visit_drafts_officer_id_fkey', 'visit_drafts', type_='foreignkey')
    op.create_foreign_key('visit_drafts_officer_id_fkey', 'visit_drafts', 'users', ['officer_id'], ['id'], ondelete='RESTRICT')

    # personal_bests
    op.drop_constraint('personal_bests_user_id_fkey', 'personal_bests', type_='foreignkey')
    op.create_foreign_key('personal_bests_user_id_fkey', 'personal_bests', 'users', ['user_id'], ['id'], ondelete='RESTRICT')

    # user_badges
    op.drop_constraint('user_badges_user_id_fkey', 'user_badges', type_='foreignkey')
    op.create_foreign_key('user_badges_user_id_fkey', 'user_badges', 'users', ['user_id'], ['id'], ondelete='RESTRICT')

    # officer_locations
    op.drop_constraint('officer_locations_officer_id_fkey', 'officer_locations', type_='foreignkey')
    op.create_foreign_key('officer_locations_officer_id_fkey', 'officer_locations', 'users', ['officer_id'], ['id'], ondelete='RESTRICT')
