"""Drop tables that belong to another product, and the cut Marketing module.

Two groups, both dead:

1. MCP Server Risk Scanner scaffold. This repository was started from that
   project, and its migrations came along: mcp_servers, tool_capabilities,
   risk_findings, risk_cards, governance_recommendations, alerts, connections,
   policies. No file under app/ references any of them, nothing in the
   Vishakan schema points at them, and they are empty in every install. The
   app's own "alerts" are Redis pub/sub messages (AlertsService), not rows in
   the alerts table, which carries a server_id pointing at mcp_servers.

2. Marketing. The module was cut from the product; its router was already
   deleted, leaving marketing_materials and marketing_categories reachable
   from nothing.

Dropped in dependency order. The downgrade recreates nothing: these tables
never held Vishakan data, so there is nothing to restore, and recreating empty
scaffolding from another product would be worse than leaving it gone.

Revision ID: 202609290002
Revises: 202609290001
Create Date: 2026-09-29
"""
from typing import Sequence, Union

from alembic import op

revision: str = "202609290002"
down_revision: Union[str, None] = "202609290001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Children first, parents last.
_DROP_ORDER = [
    "governance_recommendations",
    "risk_cards",
    "risk_findings",
    "tool_capabilities",
    "alerts",
    "mcp_servers",
    "connections",
    "policies",
    "marketing_materials",
    "marketing_categories",
]


def upgrade() -> None:
    for table in _DROP_ORDER:
        op.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')


def downgrade() -> None:
    # Intentionally empty: see the module docstring.
    pass
