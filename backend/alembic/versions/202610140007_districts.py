"""Admin-managed districts list.

Revision ID: 202610140007
Revises: 202610140006
"""
from alembic import op

revision = "202610140007"
down_revision = "202610140006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS districts (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name varchar(100) NOT NULL,
            sort_order integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_districts_name_lower ON districts (lower(name))")
    op.execute("""
        INSERT INTO districts (name, sort_order) VALUES
        ('Dindigul',1),('Tiruppur',2),('Coimbatore',3),('Erode',4),('Salem',5),('Theni',6),('Idukki',7),('Tirunelveli',8)
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS districts")
