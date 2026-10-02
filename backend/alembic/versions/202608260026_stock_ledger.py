"""stock_ledger: one append-only ledger replacing two disagreeing stock systems

Revision ID: 202608260026
Revises: 202608260025
Create Date: 2026-09-15 11:00:00

THE DEFECT THIS FIXES
---------------------
`officer_product_stock` was being used by two routers that answered the
same question differently:

  trial_router     remaining = opening_stock + received_stock
                               - SUM(visit_trial_products.quantity_given)
  sales_stock_rtr  remaining = officer_product_stock.current_quantity
                               (directly editable by the officer)

Giving a trial moved the first and left the second untouched. An officer
who gave 5kg saw 45 on one screen and 50 on another, both "correct" by
their own definition, both backed by the same table.

Second defect: `opening_stock` and `received_stock` were only ever READ
(trial_router, farmer_router, daily_visit_tracker_router). Nothing in the
entire backend ever wrote them - no admin endpoint, no seed, no
allocation flow. So every officer's remaining was 0 for every product,
and the trial step was blocked for everyone.

THE FIX
-------
One append-only ledger. Current stock is ALWAYS `SUM(qty_delta)`. There
is no stored balance for anything to drift from, so the two-systems
class of bug becomes unrepresentable rather than merely fixed.

A trial recorded on a visit writes its ledger row in the SAME
TRANSACTION as the visit (see daily_visit_tracker_router). Automatic
deduction is therefore not a step that can be forgotten - it is the same
commit.

WHY APPEND-ONLY
---------------
Corrections are compensating rows, never mutations. Someone will
eventually dispute a stock number; the answer has to be a list of what
happened, not a single figure that was overwritten some unknown number
of times.

BACKFILL
--------
Three passes, in order, so the resulting balance matches what officers
see today rather than resetting everyone to zero:

  1. `allocation` from opening_stock + received_stock (what was issued)
  2. `trial_given` from visit_trial_products (what was handed out)
  3. `count_correction` for any residual gap against current_quantity,
     but ONLY where current_quantity > 0.

Pass 3 needs justifying: current_quantity was an officer-editable
physical count, which is genuinely better evidence of what is in the bag
than a derived figure. Where it was set, it wins, and the ledger records
the difference honestly as a correction rather than silently discarding
either number. Where it was never set (0), passes 1+2 stand on their own
- adding a correction there would fabricate a count nobody performed.

The legacy tables are NOT dropped here. They stay readable for one
release so the backfill can be audited against them; dropping them is a
separate migration once reconciliation has been checked in production.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "202608260026"
down_revision = "202608260025"
branch_labels = None
depends_on = None

MOVEMENT_TYPES = (
    "allocation",
    "return_to_company",
    "trial_given",
    "sale",
    "damage",
    "transfer_in",
    "transfer_out",
    "count_correction",
)


def upgrade() -> None:
    op.create_table(
        "stock_ledger",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "officer_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "product_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        # Signed. Positive = stock arrives with the officer, negative =
        # stock leaves. One column rather than in/out columns so the
        # balance is a plain SUM with no CASE, which is exactly the
        # property that makes drift impossible.
        sa.Column("qty_delta", sa.Numeric(12, 3), nullable=False),
        sa.Column("unit", sa.String(length=32), nullable=True),
        sa.Column("movement_type", sa.String(length=32), nullable=False),
        # Links a movement back to what caused it: ('visit', <visit_id>)
        # for a trial. This is what makes "why is my stock down 5kg?"
        # answerable without guessing.
        sa.Column("ref_type", sa.String(length=32), nullable=True),
        sa.Column("ref_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "movement_type IN ("
            + ", ".join(f"'{m}'" for m in MOVEMENT_TYPES)
            + ")",
            name="ck_stock_ledger_movement_type",
        ),
        # A zero-delta row records nothing and would only pollute history.
        sa.CheckConstraint("qty_delta <> 0", name="ck_stock_ledger_nonzero"),
        # Sign discipline enforced by the database rather than by every
        # caller remembering it. A `trial_given` with a positive delta
        # would silently INCREASE stock when an officer gave product
        # away - the exact inversion that is easy to write and hard to
        # notice, because the number still moves.
        sa.CheckConstraint(
            """
            (movement_type IN ('allocation', 'transfer_in') AND qty_delta > 0)
            OR (movement_type IN ('trial_given', 'sale', 'damage',
                                  'transfer_out', 'return_to_company')
                AND qty_delta < 0)
            OR movement_type = 'count_correction'
            """,
            name="ck_stock_ledger_sign",
        ),
    )

    # Balance lookups are always (officer, product) scoped.
    op.create_index(
        "ix_stock_ledger_officer_product",
        "stock_ledger",
        ["officer_id", "product_id"],
    )
    # Reversal lookups when a visit's trial is edited or deleted.
    op.create_index(
        "ix_stock_ledger_ref",
        "stock_ledger",
        ["ref_type", "ref_id"],
    )

    # ---- Backfill pass 1: what was allocated -----------------------------
    op.execute(
        """
        INSERT INTO stock_ledger
            (officer_id, product_id, qty_delta, unit, movement_type, remarks)
        SELECT ops.officer_id,
               ops.product_id,
               COALESCE(ops.opening_stock, 0) + COALESCE(ops.received_stock, 0),
               ops.unit,
               'allocation',
               'Backfilled from officer_product_stock (opening + received)'
        FROM officer_product_stock ops
        WHERE COALESCE(ops.opening_stock, 0) + COALESCE(ops.received_stock, 0) > 0
        """
    )

    # ---- Backfill pass 2: what was given out as trials -------------------
    op.execute(
        """
        INSERT INTO stock_ledger
            (officer_id, product_id, qty_delta, movement_type,
             ref_type, ref_id, remarks, created_at)
        SELECT v.user_id,
               vtp.product_id,
               -vtp.quantity_given,
               'trial_given',
               'visit',
               v.id,
               'Backfilled from visit_trial_products',
               COALESCE(vtp.created_at, now())
        FROM visit_trial_products vtp
        JOIN visits v ON v.id = vtp.visit_id
        WHERE vtp.quantity_given > 0
        """
    )

    # ---- Backfill pass 2b: farmer-registration trials --------------------
    # A THIRD trial path existed in farmer_router, writing
    # farmer_trial_products and deducting nothing from anywhere. Same
    # treatment as visit trials.
    op.execute(
        """
        INSERT INTO stock_ledger
            (officer_id, product_id, qty_delta, movement_type,
             ref_type, ref_id, remarks)
        SELECT ftp.created_by,
               ftp.product_id,
               -ftp.quantity,
               'trial_given',
               'farmer',
               ftp.farmer_id,
               'Backfilled from farmer_trial_products'
        FROM farmer_trial_products ftp
        WHERE ftp.quantity > 0 AND ftp.created_by IS NOT NULL
        """
    )

    # ---- Backfill pass 3: reconcile to the officer's physical count ------
    op.execute(
        """
        WITH derived AS (
            SELECT ops.officer_id,
                   ops.product_id,
                   ops.current_quantity,
                   ops.unit,
                   COALESCE((
                       SELECT SUM(sl.qty_delta)
                       FROM stock_ledger sl
                       WHERE sl.officer_id = ops.officer_id
                         AND sl.product_id = ops.product_id
                   ), 0) AS ledger_balance
            FROM officer_product_stock ops
            WHERE COALESCE(ops.current_quantity, 0) > 0
        )
        INSERT INTO stock_ledger
            (officer_id, product_id, qty_delta, unit, movement_type, remarks)
        SELECT officer_id,
               product_id,
               current_quantity - ledger_balance,
               unit,
               'count_correction',
               'Backfill reconciliation to officer-recorded physical count'
        FROM derived
        WHERE current_quantity - ledger_balance <> 0
        """
    )


def downgrade() -> None:
    op.drop_index("ix_stock_ledger_ref", table_name="stock_ledger")
    op.drop_index("ix_stock_ledger_officer_product", table_name="stock_ledger")
    op.drop_table("stock_ledger")
