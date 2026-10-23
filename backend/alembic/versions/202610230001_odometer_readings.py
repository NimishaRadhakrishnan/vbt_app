"""speedometer photo + km readings at check-in / check-out

Revision ID: 202610230001
Revises: 202610150001
"""
from alembic import op

revision = "202610230001"
down_revision = "202610150001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE odometer_readings (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            attendance_id uuid NULL,
            reading_date date NOT NULL,
            kind varchar(10) NOT NULL CHECK (kind IN ('check_in', 'check_out')),
            km numeric(10,1) NOT NULL CHECK (km >= 0),
            filename varchar(120) NOT NULL,
            is_late boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (user_id, reading_date, kind)
        )
    """)
    op.execute("CREATE INDEX ix_odometer_date ON odometer_readings (reading_date DESC)")
    op.execute("CREATE INDEX ix_odometer_created ON odometer_readings (created_at)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS odometer_readings")
