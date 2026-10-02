"""Tiered pricing: by quantity band, and by dealer.

A product used to have exactly one price, so a dealer buying 500 units paid
the rate of a dealer buying 2. These tests cover the three things that can go
wrong once a price depends on how much is being bought:

1. **Two bands claiming the same quantity.** If 1-10 and 5-20 both exist, the
   price of 7 units depends on which row a query reaches first, and the same
   order can be billed two ways. The database refuses the overlap outright;
   ``test_overlapping_bands_are_refused_by_the_database`` proves it rather
   than trusting the DDL.

2. **The open-ended band.** "51 and above" is the band every product needs,
   and the first version of the migration could not store it at all: the
   inclusive-upper-bound form normalised 2147483647 to 2147483648 and the
   insert died with "integer out of range".
   ``test_an_open_ended_band_can_actually_be_created`` is here because that
   bug shipped in a migration that looked correct.

3. **Precedence.** Dealer band beats general band beats list price. Get this
   backwards and a dealer on special terms is quoted the standard rate.

Every test cleans up the tiers it creates. They run against the shared demo
database, and a tier left behind would make the next test's band overlap
something invisible.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text

from app.application.use_cases.dealer_use_case import DealerUseCase
from app.domain.exceptions.domain_exceptions import (
    BusinessRuleViolationException,
    ConflictException,
)
from app.domain.services.pricing import (
    PRICE_SOURCE_DEALER_TIER,
    PRICE_SOURCE_GENERAL_TIER,
    PRICE_SOURCE_LIST,
    ResolvedPrice,
    merge_quantities,
)
from app.infrastructure.database.session import AsyncSessionLocal
from app.infrastructure.repositories.sqlalchemy_dealer_repository import (
    SQLAlchemyDealerRepository,
)


async def _fixture_ids(session) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, Decimal]:
    """A product and two dealers from the seeded data, plus the list price."""
    product = (
        await session.execute(
            text("SELECT id, price FROM products ORDER BY created_at LIMIT 1")
        )
    ).first()
    dealers = (
        await session.execute(text("SELECT id FROM dealers ORDER BY created_at LIMIT 2"))
    ).fetchall()
    if product is None or len(dealers) < 2:
        pytest.skip("Seeded products/dealers required; run scripts/demo_seed.py")
    return product.id, dealers[0].id, dealers[1].id, Decimal(product.price)


async def _clear_tiers(session, product_id: uuid.UUID) -> None:
    await session.execute(
        text("DELETE FROM product_price_tiers WHERE product_id = CAST(:p AS UUID)"),
        {"p": str(product_id)},
    )
    await session.commit()


@pytest.mark.asyncio
async def test_an_open_ended_band_can_actually_be_created() -> None:
    """"51 and above" must be storable.

    The first version of migration 202609300001 built the exclusion range as
    ``int4range(min, COALESCE(max, 2147483647), '[]')``. Postgres normalises an
    inclusive top to max + 1, so the sentinel overflowed int4 and every
    open-ended band was rejected with "integer out of range" - the most common
    band in the business, impossible to enter.
    """
    async with AsyncSessionLocal() as session:
        product_id, _, _, _ = await _fixture_ids(session)
        await _clear_tiers(session, product_id)
        repo = SQLAlchemyDealerRepository(session)
        use_case = DealerUseCase(repo)
        try:
            tier = await use_case.add_price_tier(
                product_id=product_id, min_quantity=51, max_quantity=None,
                price=Decimal("400.00"),
            )
            await session.commit()
            assert tier["max_quantity"] is None

            # And it must price a quantity far above its floor.
            resolved = await use_case.quote_price(product_id, 5000)
            assert resolved.price == Decimal("400.00")
            assert resolved.band_label == "51+ units"
        finally:
            await _clear_tiers(session, product_id)


@pytest.mark.asyncio
async def test_overlapping_bands_are_refused_by_the_database() -> None:
    """The guarantee the whole feature rests on, checked at the database.

    The use case also checks for overlaps so it can name the offending band,
    but that check is a courtesy. This test bypasses it and inserts directly,
    because the constraint is what makes a two-priced order unrepresentable.
    """
    async with AsyncSessionLocal() as session:
        product_id, dealer_id, _, _ = await _fixture_ids(session)
        await _clear_tiers(session, product_id)
        try:
            await session.execute(
                text(
                    "INSERT INTO product_price_tiers "
                    "(product_id, min_quantity, max_quantity, price) "
                    "VALUES (CAST(:p AS UUID), 1, 10, 450)"
                ),
                {"p": str(product_id)},
            )
            await session.commit()

            with pytest.raises(Exception) as exc:
                await session.execute(
                    text(
                        "INSERT INTO product_price_tiers "
                        "(product_id, min_quantity, max_quantity, price) "
                        "VALUES (CAST(:p AS UUID), 5, 20, 420)"
                    ),
                    {"p": str(product_id)},
                )
                await session.commit()
            assert "ex_price_tier_no_overlap" in str(exc.value), (
                "an overlapping band was accepted - the price of 7 units is now "
                f"whichever row the query reaches first. Error was: {exc.value}"
            )
            await session.rollback()

            # A band for one specific dealer over the same quantities is NOT an
            # overlap: it is the more specific rule, and must be allowed.
            await session.execute(
                text(
                    "INSERT INTO product_price_tiers "
                    "(product_id, dealer_id, min_quantity, max_quantity, price) "
                    "VALUES (CAST(:p AS UUID), CAST(:d AS UUID), 1, 10, 430)"
                ),
                {"p": str(product_id), "d": str(dealer_id)},
            )
            await session.commit()
        finally:
            await session.rollback()
            await _clear_tiers(session, product_id)


@pytest.mark.asyncio
async def test_precedence_is_dealer_then_general_then_list_price() -> None:
    async with AsyncSessionLocal() as session:
        product_id, dealer_id, other_dealer_id, list_price = await _fixture_ids(session)
        await _clear_tiers(session, product_id)
        repo = SQLAlchemyDealerRepository(session)
        use_case = DealerUseCase(repo)
        try:
            await use_case.add_price_tier(
                product_id=product_id, min_quantity=1, max_quantity=10,
                price=Decimal("450.00"),
            )
            await use_case.add_price_tier(
                product_id=product_id, min_quantity=11, max_quantity=50,
                price=Decimal("420.00"),
            )
            await use_case.add_price_tier(
                product_id=product_id, min_quantity=1, max_quantity=10,
                price=Decimal("430.00"), dealer_id=dealer_id,
            )
            await session.commit()

            # This dealer has their own band for 1-10.
            got = await use_case.quote_price(product_id, 5, dealer_id=dealer_id)
            assert got.price == Decimal("430.00")
            assert got.source == PRICE_SOURCE_DEALER_TIER

            # Same dealer at 20 units has no band of their own, so the general
            # 11-50 band applies - not their 1-10 rate.
            got = await use_case.quote_price(product_id, 20, dealer_id=dealer_id)
            assert got.price == Decimal("420.00")
            assert got.source == PRICE_SOURCE_GENERAL_TIER

            # A different dealer gets the general rate at 5 units.
            got = await use_case.quote_price(product_id, 5, dealer_id=other_dealer_id)
            assert got.price == Decimal("450.00")
            assert got.source == PRICE_SOURCE_GENERAL_TIER

            # No dealer at all: general bands still apply.
            got = await use_case.quote_price(product_id, 5)
            assert got.price == Decimal("450.00")

            # Above every band, the list price stands. This is what keeps the
            # feature backwards-compatible.
            got = await use_case.quote_price(product_id, 999, dealer_id=dealer_id)
            assert got.source == PRICE_SOURCE_LIST
            assert got.price == list_price
        finally:
            await _clear_tiers(session, product_id)


@pytest.mark.asyncio
async def test_a_product_with_no_tiers_prices_exactly_as_before() -> None:
    """The regression that would be most expensive to ship."""
    async with AsyncSessionLocal() as session:
        product_id, dealer_id, _, list_price = await _fixture_ids(session)
        await _clear_tiers(session, product_id)
        use_case = DealerUseCase(SQLAlchemyDealerRepository(session))
        for quantity in (1, 7, 50, 1000):
            got = await use_case.quote_price(product_id, quantity, dealer_id=dealer_id)
            assert got.price == list_price, f"quantity {quantity} drifted off list price"
            assert got.source == PRICE_SOURCE_LIST
            assert got.is_tiered is False


@pytest.mark.asyncio
async def test_band_edges_are_inclusive_the_way_a_person_reads_them() -> None:
    """"11 to 50" includes 11 and includes 50."""
    async with AsyncSessionLocal() as session:
        product_id, _, _, _ = await _fixture_ids(session)
        await _clear_tiers(session, product_id)
        use_case = DealerUseCase(SQLAlchemyDealerRepository(session))
        try:
            await use_case.add_price_tier(
                product_id=product_id, min_quantity=11, max_quantity=50,
                price=Decimal("420.00"),
            )
            await session.commit()

            assert (await use_case.quote_price(product_id, 11)).price == Decimal("420.00")
            assert (await use_case.quote_price(product_id, 50)).price == Decimal("420.00")
            # Just outside on either side falls through to the list price.
            assert (await use_case.quote_price(product_id, 10)).source == PRICE_SOURCE_LIST
            assert (await use_case.quote_price(product_id, 51)).source == PRICE_SOURCE_LIST
        finally:
            await _clear_tiers(session, product_id)


@pytest.mark.asyncio
async def test_an_overlap_names_the_band_in_the_way() -> None:
    """A refusal has to be actionable, not a constraint name."""
    async with AsyncSessionLocal() as session:
        product_id, _, _, _ = await _fixture_ids(session)
        await _clear_tiers(session, product_id)
        use_case = DealerUseCase(SQLAlchemyDealerRepository(session))
        try:
            await use_case.add_price_tier(
                product_id=product_id, min_quantity=1, max_quantity=10,
                price=Decimal("450.00"),
            )
            await session.commit()

            with pytest.raises(ConflictException) as exc:
                await use_case.add_price_tier(
                    product_id=product_id, min_quantity=5, max_quantity=20,
                    price=Decimal("420.00"),
                )
            message = str(exc.value)
            assert "1-10" in message, message
            assert "overlap" in message.lower(), message
            assert "ex_price_tier" not in message, (
                "the raw constraint name reached the user: " + message
            )
        finally:
            await session.rollback()
            await _clear_tiers(session, product_id)


@pytest.mark.asyncio
async def test_a_backwards_band_is_explained_not_crashed() -> None:
    async with AsyncSessionLocal() as session:
        product_id, _, _, _ = await _fixture_ids(session)
        use_case = DealerUseCase(SQLAlchemyDealerRepository(session))

        with pytest.raises(BusinessRuleViolationException) as exc:
            await use_case.add_price_tier(
                product_id=product_id, min_quantity=500, max_quantity=400,
                price=Decimal("380.00"),
            )
        assert "ends before it begins" in str(exc.value)

        with pytest.raises(BusinessRuleViolationException) as exc:
            await use_case.add_price_tier(
                product_id=product_id, min_quantity=1, max_quantity=10,
                price=Decimal("0"),
            )
        assert "greater than zero" in str(exc.value)


def test_quantities_for_one_product_are_totalled_before_pricing() -> None:
    """Two lines of 5 is an order for 10, and must be priced as 10.

    Pricing each line on its own would withhold the discount the order has
    earned. Pure function, so no database needed.
    """
    a, b = uuid.uuid4(), uuid.uuid4()
    assert merge_quantities([(a, 5), (a, 5), (b, 3)]) == {a: 10, b: 3}


@pytest.mark.asyncio
async def test_an_order_is_priced_at_the_total_quantity_not_per_line() -> None:
    async with AsyncSessionLocal() as session:
        product_id, dealer_id, _, _ = await _fixture_ids(session)
        await _clear_tiers(session, product_id)
        repo = SQLAlchemyDealerRepository(session)
        use_case = DealerUseCase(repo)
        officer = (
            await session.execute(
                text(
                    "SELECT id FROM users WHERE role = 'field_officer' "
                    "AND is_active = true AND is_deleted = false LIMIT 1"
                )
            )
        ).scalar_one_or_none()
        if officer is None:
            pytest.skip("Seeded field officer required")
        try:
            await use_case.add_price_tier(
                product_id=product_id, min_quantity=1, max_quantity=10,
                price=Decimal("450.00"),
            )
            await use_case.add_price_tier(
                product_id=product_id, min_quantity=11, max_quantity=50,
                price=Decimal("420.00"),
            )
            await session.commit()

            # Six plus six is twelve, which is in the 11-50 band. Priced per
            # line both would be 450; the dealer is owed 420.
            order = await use_case.place_order(
                dealer_id=dealer_id,
                created_by=officer,
                items=[
                    {"product_id": str(product_id), "quantity": 6},
                    {"product_id": str(product_id), "quantity": 6},
                ],
            )
            await session.commit()

            assert all(
                Decimal(item.unit_price) == Decimal("420.00") for item in order.items
            ), [str(i.unit_price) for i in order.items]
            assert Decimal(order.total_amount) == Decimal("5040.00")
        finally:
            await session.rollback()
            await _clear_tiers(session, product_id)


@pytest.mark.asyncio
async def test_a_bulk_upload_with_one_bad_row_saves_nothing() -> None:
    """All or nothing.

    A half-applied price sheet is worse than a rejected one: the operator
    cannot tell which products are now priced wrongly, and the dealer finds
    out first.
    """
    async with AsyncSessionLocal() as session:
        product_id, _, _, _ = await _fixture_ids(session)
        await _clear_tiers(session, product_id)
        use_case = DealerUseCase(SQLAlchemyDealerRepository(session))
        try:
            result = await use_case.bulk_add_price_tiers(
                [
                    {"product_id": product_id, "min_quantity": 1, "max_quantity": 10,
                     "price": "450"},
                    {"product_id": product_id, "min_quantity": 11, "max_quantity": 50,
                     "price": "420"},
                    # Backwards band, row 3.
                    {"product_id": product_id, "min_quantity": 80, "max_quantity": 60,
                     "price": "400"},
                ]
            )
            await session.commit()

            assert result["applied"] == 0
            assert result["rejected"] == 1
            assert result["errors"][0]["row_number"] == 3

            remaining = await use_case.list_price_tiers(product_id=product_id)
            assert remaining == [], (
                "rows 1 and 2 were saved even though row 3 failed - the upload "
                "half-applied"
            )
        finally:
            await _clear_tiers(session, product_id)


@pytest.mark.asyncio
async def test_two_rows_in_one_upload_that_overlap_each_other_are_caught() -> None:
    """The database would catch this halfway through. Catch it first, by row."""
    async with AsyncSessionLocal() as session:
        product_id, _, _, _ = await _fixture_ids(session)
        await _clear_tiers(session, product_id)
        use_case = DealerUseCase(SQLAlchemyDealerRepository(session))
        try:
            result = await use_case.bulk_add_price_tiers(
                [
                    {"product_id": product_id, "min_quantity": 1, "max_quantity": 10,
                     "price": "450"},
                    {"product_id": product_id, "min_quantity": 5, "max_quantity": 20,
                     "price": "420"},
                ]
            )
            await session.commit()
            assert result["applied"] == 0
            assert result["errors"][0]["row_number"] == 2
            assert "row 1" in result["errors"][0]["error"], result["errors"]
            assert await use_case.list_price_tiers(product_id=product_id) == []
        finally:
            await _clear_tiers(session, product_id)


@pytest.mark.asyncio
async def test_a_dry_run_validates_and_writes_nothing() -> None:
    async with AsyncSessionLocal() as session:
        product_id, _, _, _ = await _fixture_ids(session)
        await _clear_tiers(session, product_id)
        use_case = DealerUseCase(SQLAlchemyDealerRepository(session))
        try:
            rows = [
                {"product_id": product_id, "min_quantity": 1, "max_quantity": 10,
                 "price": "450"},
                {"product_id": product_id, "min_quantity": 11, "max_quantity": None,
                 "price": "420"},
            ]
            preview = await use_case.bulk_add_price_tiers(rows, dry_run=True)
            await session.commit()
            assert preview["would_apply"] == 2
            assert preview["applied"] == 0
            assert await use_case.list_price_tiers(product_id=product_id) == []

            # The same rows, for real this time.
            applied = await use_case.bulk_add_price_tiers(rows)
            await session.commit()
            assert applied["applied"] == 2
            assert len(await use_case.list_price_tiers(product_id=product_id)) == 2
        finally:
            await _clear_tiers(session, product_id)


def test_band_labels_read_like_a_price_sheet() -> None:
    def label(lo, hi):
        return ResolvedPrice(
            price=Decimal("1"), source=PRICE_SOURCE_GENERAL_TIER,
            min_quantity=lo, max_quantity=hi,
        ).band_label

    assert label(11, 50) == "11–50 units"
    assert label(51, None) == "51+ units"
    assert label(1, 1) == "1 unit"
    assert label(5, 5) == "5 units"
    assert ResolvedPrice(price=Decimal("1"), source=PRICE_SOURCE_LIST).band_label == "list price"
