"""A day closure can hold both a farmer part and a dealer part.

Revision ID: 202610140006
Revises: 202610140005
"""
from alembic import op

revision = "202610140006"
down_revision = "202610140005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_day_closures_type", "day_closures", type_="check")
    op.create_check_constraint(
        "ck_day_closures_type", "day_closures",
        "closure_type IN ('field_visit', 'sales_activity', 'no_activity', 'both')",
    )


def downgrade() -> None:
    op.execute("UPDATE day_closures SET closure_type = 'field_visit' WHERE closure_type = 'both'")
    op.drop_constraint("ck_day_closures_type", "day_closures", type_="check")
    op.create_check_constraint(
        "ck_day_closures_type", "day_closures",
        "closure_type IN ('field_visit', 'sales_activity', 'no_activity')",
    )
