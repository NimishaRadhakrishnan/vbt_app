"""Day closure form changes requested for the Field and Sales Officer forms.

Revision ID: 202610140004
Revises: 202610140003

Both the live configuration and the "Restore defaults" reference are changed,
so Restore defaults returns to this form, not the very first one.
"""
from alembic import op

revision = "202610140004"
down_revision = "202610140003"
branch_labels = None
depends_on = None

_DELETED = ["crop_category", "sowing_date", "operations", "organic_solutions",
            "sales_amount_collected", "sales_new_dealer"]


def upgrade() -> None:
    op.execute("ALTER TABLE day_closure_field_config_defaults ADD COLUMN IF NOT EXISTS default_deleted BOOLEAN NOT NULL DEFAULT false")
    keys = ", ".join(f"'{k}'" for k in _DELETED)
    for table in ("day_closure_field_configs", "day_closure_field_config_defaults"):
        deleted_col = "is_deleted" if table == "day_closure_field_configs" else "default_deleted"
        op.execute(f"UPDATE {table} SET {deleted_col} = true WHERE field_key IN ({keys})")
        op.execute(f"UPDATE {table} SET field_type = 'text', placeholder = 'Type crop name' WHERE field_key = 'crop_name'")
        op.execute(f"UPDATE {table} SET is_required = false WHERE field_key IN ('previous_crop', 'sales_dealer_photos')")
        op.execute(
            f"UPDATE {table} SET label = 'Micronutrients Applied and Added', field_type = 'text', "
            "placeholder = 'Type the micronutrients applied / added' WHERE field_key = 'micronutrients'"
        )
        op.execute(f"UPDATE {table} SET label = 'Consulting Agri-Clinic / Dealer shop?' WHERE field_key = 'advisory'")


def downgrade() -> None:
    op.execute("ALTER TABLE day_closure_field_config_defaults DROP COLUMN IF EXISTS default_deleted")
