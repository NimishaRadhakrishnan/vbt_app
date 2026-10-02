"""knowledge search phase 6: disease detection log

Revision ID: 202608260016
Revises: 202608260015
Create Date: 2026-09-03 21:00:00

Phase 6: the image-based disease detection INTERFACE (spec sections 15,
17, 33).

Being direct about what this is and is not: there is no trained disease
detection model in this system. Building one is a genuine ML project -
a labelled dataset of diseased crop images from these specific crops and
regions, training, validation, and a deployment target. It is not
something that can be honestly stubbed into existence.

So this phase builds the INTERFACE and the boundary the spec asks for
(section 33: detection and knowledge-search must stay separate), with
the model itself behind a provider that reports "not configured" until a
real one is wired in. The alternative - returning plausible-looking fake
predictions - would be far worse than returning nothing: an officer
treating a crop based on a fabricated diagnosis is real-world harm, and
the spec's entire premise is not inventing answers.

`disease_detection_log` exists so that when a model IS wired in, its
predictions are recorded against what the knowledge base and admins
subsequently confirmed. That gives a real evaluation signal (how often
was the model right?) rather than trusting it blindly. `confirmed_
disease_id` is filled in later, if and when a human establishes the
actual diagnosis - it is deliberately nullable and usually stays null.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "202608260016"
down_revision: str | None = "202608260015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "disease_detection_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("officer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("image_url", sa.String(500), nullable=False),
        # Null when the provider is unavailable - the row is still worth
        # keeping, since "officers tried image search 200 times and got
        # nothing" is exactly the evidence for whether building the model
        # is worth it.
        sa.Column("predicted_disease_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("diseases.id", ondelete="SET NULL"), nullable=True),
        sa.Column("confidence", sa.Numeric(5, 4), nullable=True),
        sa.Column("provider", sa.String(50), nullable=False, server_default="none"),
        sa.Column("was_available", sa.Boolean(), nullable=False, server_default="false"),
        # Filled in later by a human if the true diagnosis becomes known,
        # giving a measurable accuracy signal for any future model.
        sa.Column("confirmed_disease_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("diseases.id", ondelete="SET NULL"), nullable=True),
        sa.Column("case_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("knowledge_cases.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_detection_log_officer", "disease_detection_log", ["officer_id"])
    op.create_index("ix_detection_log_created", "disease_detection_log", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_detection_log_created", table_name="disease_detection_log")
    op.drop_index("ix_detection_log_officer", table_name="disease_detection_log")
    op.drop_table("disease_detection_log")
