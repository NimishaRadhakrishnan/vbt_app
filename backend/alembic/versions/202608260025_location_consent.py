"""location_consent: prominent-disclosure text + per-officer acceptance log

Revision ID: 202608260025
Revises: 202608260024
Create Date: 2026-09-15 10:00:00

Phase 3a item 6. Google Play requires a prominent in-app disclosure
shown BEFORE the OS location permission prompt, plus affirmative user
consent. This migration stores both halves of that: the disclosure text
that was shown, and who accepted which version when.

Why the TEXT is in the database and not in the app bundle
---------------------------------------------------------
The acceptance log is only meaningful if we can say what wording the
officer agreed to. If the text lived in the mobile bundle, "version 1"
would mean different words on different phones depending on when each
officer last updated, and the consent record would prove nothing.

It also means a wording correction requested during Play review can ship
without a new build and another review round - which, on this app's
timeline, is the difference between days and weeks.

Why acceptances are append-only
-------------------------------
One row per acceptance, never updated. When the disclosure text changes,
a new version row is published and every officer accepts again; the old
acceptance stays as the record of what they agreed to at the time.
Overwriting would destroy exactly the evidence this table exists to
provide.

Retention
---------
`retention_months` lives on the disclosure version, not in a settings
constant, because the number we TELL officers and the number we ENFORCE
must be the same one. The deletion job (see docs) reads it from here.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "202608260025"
down_revision = "202608260024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "location_disclosure_versions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("version", sa.Integer(), nullable=False, unique=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        # Ordered what/when/why/who/how-long blocks, as
        # [{"label": "...", "text": "..."}]. JSONB rather than five
        # columns so the wording can gain or lose a block without a
        # migration - Play review feedback often asks for exactly that.
        sa.Column("points", postgresql.JSONB(), nullable=False),
        sa.Column("footer", sa.Text(), nullable=False),
        sa.Column("retention_months", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
    )

    # Exactly one active version at a time. Enforced by the database
    # rather than by application code: "which disclosure is current?" must
    # never have two answers, and a partial unique index makes the
    # ambiguous state unrepresentable instead of merely discouraged.
    op.create_index(
        "uq_location_disclosure_one_active",
        "location_disclosure_versions",
        ["is_active"],
        unique=True,
        postgresql_where=sa.text("is_active"),
    )

    op.create_table(
        "location_consent_acceptances",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("disclosure_version", sa.Integer(), nullable=False),
        sa.Column(
            "accepted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # 'server' = officer saw the backend-served text.
        # 'bundled_fallback' = device could not reach the backend on first
        # run and showed the copy compiled into the app. Recorded because
        # the two are not the same evidentially, and a log that cannot
        # distinguish them quietly overstates what we know.
        sa.Column("source", sa.String(length=32), nullable=False, server_default="server"),
        sa.Column("device_id", sa.String(length=128), nullable=True),
        sa.Column("app_version", sa.String(length=32), nullable=True),
    )

    op.create_index(
        "ix_location_consent_user_version",
        "location_consent_acceptances",
        ["user_id", "disclosure_version"],
    )

    # Seed version 1. Text matches BUNDLED_DISCLOSURE in
    # mobile/src/constants/disclosure.ts exactly - if these two ever
    # diverge, an officer who accepted offline agreed to different words
    # than the log claims.
    op.execute(
        sa.text(
            """
            INSERT INTO location_disclosure_versions
                (version, title, points, footer, retention_months, is_active)
            VALUES (
                1,
                'How VBT One uses your location',
                :points,
                'While tracking is on, your phone will show a notification '
                || 'saying VBT One is recording your location. You can see '
                || 'your own location history any time from Profile > My tracking.',
                12,
                true
            )
            """
        ).bindparams(
            sa.bindparam(
                "points",
                value=[
                    {
                        "label": "What",
                        "text": (
                            "This app records where you are while you are "
                            "checked in for work."
                        ),
                    },
                    {
                        "label": "When",
                        "text": (
                            "Only from the moment you check in until the moment you check out. "
                            "It never runs when you are checked out, and it "
                            "never runs at night or on leave."
                        ),
                    },
                    {
                        "label": "Why",
                        "text": (
                            "So your visits to farmers and dealers can be "
                            "confirmed, and your attendance is accurate."
                        ),
                    },
                    {
                        "label": "Who can see it",
                        "text": (
                            "Your manager and the company admin. "
                            "Nobody outside the company."
                        ),
                    },
                    {
                        "label": "How long it is kept",
                        "text": (
                            "Location history is kept for 12 months, "
                            "then deleted automatically."
                        ),
                    },
                ],
                type_=postgresql.JSONB(),
            )
        )
    )


def downgrade() -> None:
    op.drop_index("ix_location_consent_user_version", table_name="location_consent_acceptances")
    op.drop_table("location_consent_acceptances")
    op.drop_index(
        "uq_location_disclosure_one_active", table_name="location_disclosure_versions"
    )
    op.drop_table("location_disclosure_versions")
