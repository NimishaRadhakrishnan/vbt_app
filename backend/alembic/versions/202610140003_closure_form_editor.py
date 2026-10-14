"""Closure form editor: deletable built-in fields, separate Sales custom form.

Revision ID: 202610140003
Revises: 202610140002
"""
from alembic import op

revision = "202610140003"
down_revision = "202610140002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE day_closure_field_configs ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false")
    op.execute("ALTER TABLE day_closure_sections ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false")
    op.execute("ALTER TABLE day_closure_sections ADD COLUMN IF NOT EXISTS form_kind VARCHAR(10) NOT NULL DEFAULT 'farm'")
    op.execute("ALTER TABLE day_closure_sections ADD COLUMN IF NOT EXISTS default_label VARCHAR(200)")
    op.execute("ALTER TABLE day_closure_sections ADD COLUMN IF NOT EXISTS default_order INTEGER")
    op.execute("UPDATE day_closure_sections SET default_label = label, default_order = display_order WHERE is_original")
    op.execute("UPDATE day_closure_sections SET form_kind = 'sales' WHERE section_key LIKE 'sales\\_%'")
    op.execute(
        "INSERT INTO form_config_versions (form_key, version) VALUES ('sales_day_closure', 1) "
        "ON CONFLICT (form_key) DO NOTHING"
    )
    # Custom fields added so far were shown to every officer; the ones that
    # were made for the sales form keep working there, so copy none and leave
    # existing fields on the Field Officer form.


def downgrade() -> None:
    op.execute("ALTER TABLE day_closure_sections DROP COLUMN IF EXISTS default_label")
    op.execute("ALTER TABLE day_closure_sections DROP COLUMN IF EXISTS default_order")
    op.execute("ALTER TABLE day_closure_sections DROP COLUMN IF EXISTS form_kind")
    op.execute("ALTER TABLE day_closure_sections DROP COLUMN IF EXISTS is_deleted")
    op.execute("DELETE FROM form_config_versions WHERE form_key = 'sales_day_closure'")
    op.execute("ALTER TABLE day_closure_field_configs DROP COLUMN IF EXISTS is_deleted")
