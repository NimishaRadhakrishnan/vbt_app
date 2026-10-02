"""
Stock ledger: the tests that make the old two-systems bug unrepeatable.

The defect being guarded against was not "a wrong number" - it was two
routers answering the same question by two formulas, one of which moved
when a trial was given and one of which did not. Tests 3 and 4 below are
the ones that would have failed on the old code.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text

from app.presentation.api.v1.routers.stock_router import (
    get_balance,
    record_movement,
    reverse_movements_for_ref,
)


@pytest.fixture
async def officer_and_product(db_session):
    """A real officer + product, so FK constraints are genuinely exercised."""
    officer_id = (
        await db_session.execute(
            text("SELECT id FROM users WHERE role = 'field_officer' LIMIT 1")
        )
    ).scalar_one()
    product_id = (
        await db_session.execute(
            text("SELECT id FROM products WHERE is_active LIMIT 1")
        )
    ).scalar_one()

    yield officer_id, product_id

    await db_session.execute(
    text("DELETE FROM stock_ledger WHERE officer_id = :o AND product_id = :p")
        .bindparams(o=officer_id, p=product_id)
    )
    await db_session.commit()


async def test_balance_is_zero_without_allocation(db_session, officer_and_product):
    """An officer holds nothing until admin issues stock.

    This is the state the old code left EVERY officer in permanently,
    because nothing ever wrote opening_stock or received_stock. The
    difference now is that it is a starting state rather than a dead end.
    """
    officer_id, product_id = officer_and_product
    assert await get_balance(db_session, officer_id, product_id) == Decimal("0")


async def test_allocation_increases_balance(db_session, officer_and_product):
    officer_id, product_id = officer_and_product
    admin_id = (
        await db_session.execute(text("SELECT id FROM users WHERE role = 'admin' LIMIT 1"))
    ).scalar_one()

    balance = await record_movement(
        db_session,
        officer_id=officer_id,
        product_id=product_id,
        quantity=50,
        movement_type="allocation",
        created_by=admin_id,
    )
    assert balance == Decimal("50.000")


async def test_trial_given_reduces_balance_automatically(db_session, officer_and_product):
    """THE core regression test.

    On the old code a trial reduced trial_router's derived figure and left
    sales_stock_router's current_quantity untouched. There is now only one
    figure, so 'reduces one view but not the other' has no way to happen.
    """
    officer_id, product_id = officer_and_product

    await record_movement(
        db_session, officer_id=officer_id, product_id=product_id,
        quantity=50, movement_type="allocation", created_by=officer_id,
    )
    after_trial = await record_movement(
        db_session, officer_id=officer_id, product_id=product_id,
        quantity=5, movement_type="trial_given", created_by=officer_id,
        ref_type="visit", ref_id=uuid.uuid4(),
    )

    assert after_trial == Decimal("45.000")
    # And the balance any other caller reads is the same number, because
    # there is no other place for it to be stored.
    assert await get_balance(db_session, officer_id, product_id) == Decimal("45.000")


async def test_caller_passes_magnitude_and_sign_is_derived(db_session, officer_and_product):
    """A positive quantity on an outgoing movement must still reduce stock.

    Sign is derived from movement_type inside record_movement rather than
    being the caller's job. If it were the caller's job, one forgotten
    minus sign would silently INCREASE an officer's stock when they gave
    product away - a bug that is easy to write and hard to spot, because
    the number does move.
    """
    officer_id, product_id = officer_and_product

    await record_movement(
        db_session, officer_id=officer_id, product_id=product_id,
        quantity=20, movement_type="allocation", created_by=officer_id,
    )
    balance = await record_movement(
        db_session, officer_id=officer_id, product_id=product_id,
        quantity=8, movement_type="sale", created_by=officer_id,
    )
    assert balance == Decimal("12.000")


async def test_cannot_give_more_than_held(db_session, officer_and_product):
    from fastapi import HTTPException

    officer_id, product_id = officer_and_product
    await record_movement(
        db_session, officer_id=officer_id, product_id=product_id,
        quantity=3, movement_type="allocation", created_by=officer_id,
    )

    with pytest.raises(HTTPException) as exc:
        await record_movement(
            db_session, officer_id=officer_id, product_id=product_id,
            quantity=10, movement_type="trial_given", created_by=officer_id,
        )
    assert exc.value.status_code == 400
    assert await get_balance(db_session, officer_id, product_id) == Decimal("3.000")


async def test_reversal_writes_compensating_row_not_a_delete(db_session, officer_and_product):
    """Editing a trial must restore stock WITHOUT erasing what happened.

    An officer disputing their stock is owed the full sequence, including
    the correction - not a history with the inconvenient part removed.
    """
    officer_id, product_id = officer_and_product
    visit_id = uuid.uuid4()

    await record_movement(
        db_session, officer_id=officer_id, product_id=product_id,
        quantity=30, movement_type="allocation", created_by=officer_id,
    )
    await record_movement(
        db_session, officer_id=officer_id, product_id=product_id,
        quantity=7, movement_type="trial_given", created_by=officer_id,
        ref_type="visit", ref_id=visit_id,
    )
    assert await get_balance(db_session, officer_id, product_id) == Decimal("23.000")

    reversed_count = await reverse_movements_for_ref(
        db_session, ref_type="visit", ref_id=visit_id, created_by=officer_id
    )

    assert reversed_count == 1
    assert await get_balance(db_session, officer_id, product_id) == Decimal("30.000")

    # The original trial row is still there. Three rows, not one.
    rows = (
        await db_session.execute(
            text(
                "SELECT movement_type, qty_delta FROM stock_ledger "
                "WHERE officer_id = :o AND product_id = :p ORDER BY created_at"
            ).bindparams(o=officer_id, p=product_id)
        )
    ).all()
    assert len(rows) == 3
    assert [r.movement_type for r in rows] == [
        "allocation", "trial_given", "count_correction",
    ]


async def test_database_rejects_wrong_sign(db_session, officer_and_product):
    """Sign discipline is enforced by the database, not only by Python.

    Any future code path that writes the ledger directly - a migration, a
    script, a new router - is caught by the constraint rather than
    silently corrupting balances.
    """
    officer_id, product_id = officer_and_product

    with pytest.raises(Exception) as exc:
        await db_session.execute(
            text(
                """
                INSERT INTO stock_ledger (officer_id, product_id, qty_delta, movement_type)
                VALUES (:o, :p, 5, 'trial_given')
                """
            ).bindparams(o=officer_id, p=product_id)
        )
        await db_session.flush()
    assert "ck_stock_ledger_sign" in str(exc.value)
    await db_session.rollback()


async def test_database_rejects_zero_delta(db_session, officer_and_product):
    officer_id, product_id = officer_and_product
    with pytest.raises(Exception) as exc:
        await db_session.execute(
            text(
                """
                INSERT INTO stock_ledger (officer_id, product_id, qty_delta, movement_type)
                VALUES (:o, :p, 0, 'allocation')
                """
            ).bindparams(o=officer_id, p=product_id)
        )
        await db_session.flush()
    assert "ck_stock_ledger_nonzero" in str(exc.value)
    await db_session.rollback()

async def test_reconciliation_total_matching(db_session, officer_and_product):
    from app.presentation.api.v1.routers.stock_router import get_reconciliation

    class MockUser:
        def __init__(self, user_id):
            self.user_id = user_id
            self.role = 'admin'
            self.email = 'admin@example.com'

    officer_id, product_id = officer_and_product
    admin = MockUser(uuid.uuid4())
    
    # 1. Allocate 50
    await record_movement(
        db_session, officer_id=officer_id, product_id=product_id,
        quantity=50, movement_type="allocation", created_by=admin.user_id,
    )
    
    # 2. Trial 5
    await record_movement(
        db_session, officer_id=officer_id, product_id=product_id,
        quantity=5, movement_type="trial_given", created_by=officer_id,
        ref_type="visit", ref_id=uuid.uuid4(),
    )
    
    # 3. Check reconciliation
    rows = await get_reconciliation(admin, db_session, officer_id=officer_id)
    
    # Find the product
    row = next((r for r in rows if r.product_id == product_id), None)
    assert row is not None
    assert row.allocated == 50.0
    assert row.trial_given == 5.0
    assert row.sold == 0.0
    assert row.other == 0.0
    assert row.on_hand == 45.0
