"""The management dashboard: the numbers, and the words beside them.

This screen is read by the owner of the company and acted on. Two failures
matter more than anything else here, and most of these tests exist for one of
them:

**A wrong number.** Revenue has to be the sum of what was actually sold -
dealer orders plus priced field sales - and nothing else. So the figures are
checked against rows written by the test itself, not against whatever the demo
seed happens to contain.

**An unknown drawn as a zero.** A dashboard that shows "profit: 0" when nobody
has entered a cost price is worse than one that shows nothing, because the
owner believes it. Every path where data is missing is tested for saying so:
no cost price, no target, not enough history for a seasonal claim, too few
visits to judge a conversion rate.

The wording is tested as carefully as the arithmetic. The sentences ARE the
product for this reader - a figure they cannot interpret is not information.
"""

from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.application.services.management_analytics_service import (
    ManagementAnalyticsService,
    ManagementPeriod,
    _rupees,
    _growth_percent,
)
from app.infrastructure.database.session import AsyncSessionLocal
from app.main import app

_TAG = "ZZMGMT"


async def _fixture(session) -> dict:
    """A product, a dealer and an officer belonging to this test alone."""
    officer = (
        await session.execute(
            text(
                "SELECT id FROM users WHERE role = 'field_officer' AND is_active = true "
                "AND is_deleted = false ORDER BY created_at LIMIT 1"
            )
        )
    ).scalar_one_or_none()
    dealer = (
        await session.execute(
            text("SELECT id, district FROM dealers WHERE is_deleted = false ORDER BY created_at LIMIT 1")
        )
    ).first()
    if officer is None or dealer is None:
        pytest.skip("Seeded officer and dealer required; run scripts/demo_seed.py")

    product_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO products (id, name, category, sku_code, price, is_active) "
            "VALUES (:id, :name, 'Test', :sku, 100, true)"
        ),
        {"id": product_id, "name": f"{_TAG} Product", "sku": f"{_TAG}-1"},
    )
    await session.commit()
    return {"officer_id": officer, "dealer_id": dealer.id, "district": dealer.district,
            "product_id": product_id}


async def _clean(session) -> None:
    await session.execute(
        text(
            "DELETE FROM order_items WHERE order_id IN "
            "(SELECT id FROM dealer_orders WHERE comments = :tag)"
        ),
        {"tag": _TAG},
    )
    await session.execute(text("DELETE FROM dealer_orders WHERE comments = :tag"), {"tag": _TAG})
    await session.execute(text("DELETE FROM products WHERE sku_code LIKE :p"), {"p": f"{_TAG}%"})
    await session.commit()


async def _place_order(session, fx: dict, *, when: dt.date, quantity: int, unit_price: str) -> None:
    order_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO dealer_orders (id, dealer_id, created_by, status, total_amount, "
            "order_date, comments) VALUES (:id, :dealer, :officer, 'submitted', :total, "
            ":when, :tag)"
        ),
        {
            "id": order_id,
            "dealer": fx["dealer_id"],
            "officer": fx["officer_id"],
            "total": Decimal(unit_price) * quantity,
            "when": dt.datetime.combine(when, dt.time(9, 0), tzinfo=dt.timezone.utc),
            "tag": _TAG,
        },
    )
    await session.execute(
        text(
            "INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) "
            "VALUES (gen_random_uuid(), :order, :product, :qty, :price)"
        ),
        {"order": order_id, "product": fx["product_id"], "qty": quantity, "price": Decimal(unit_price)},
    )
    await session.commit()


# --------------------------------------------------------------- arithmetic


@pytest.mark.asyncio
async def test_revenue_is_the_sum_of_what_was_actually_sold() -> None:
    """The number the whole screen rests on."""
    async with AsyncSessionLocal() as session:
        await _clean(session)
        fx = await _fixture(session)
        try:
            period = ManagementPeriod.for_today()
            service = ManagementAnalyticsService(session)
            before = Decimal(str((await service.headline(period))["total_sales"]["value"]))

            await _place_order(session, fx, when=period.today, quantity=10, unit_price="250.00")
            await _place_order(session, fx, when=period.today, quantity=4, unit_price="250.00")

            after = Decimal(str((await service.headline(period))["total_sales"]["value"]))
            assert after - before == Decimal("3500.00"), (
                f"14 units at 250 should add 3500; total moved by {after - before}"
            )
        finally:
            await _clean(session)


@pytest.mark.asyncio
async def test_last_month_is_compared_over_the_same_number_of_days() -> None:
    """Growth must not be an artefact of the calendar.

    Comparing a partial month against a whole one would show every business as
    collapsing on the 2nd and recovering by the 30th. The comparison window is
    cut to the same elapsed day.
    """
    today = dt.date(2026, 6, 10)
    period = ManagementPeriod.for_today(today)
    assert period.this_month_start == dt.date(2026, 6, 1)
    assert period.last_month_start == dt.date(2026, 5, 1)
    # Ten days elapsed in June, so May is measured over its first ten days.
    assert period.last_month_cutoff == dt.date(2026, 5, 11)
    assert "first 10 days of May" in period.comparison_label


def test_growth_against_a_zero_month_is_unknown_not_a_hundred_percent() -> None:
    """The first month of anything is not "up 100%".

    That figure is a fact about division, not about demand, and printing it
    beside an arrow would tell the owner something that is not true.
    """
    assert _growth_percent(Decimal("5000"), Decimal("0")) is None
    assert _growth_percent(Decimal("0"), Decimal("0")) is None
    assert _growth_percent(Decimal("150"), Decimal("100")) == Decimal("50.0")
    assert _growth_percent(Decimal("50"), Decimal("100")) == Decimal("-50.0")


def test_money_reads_in_the_units_a_person_says_out_loud() -> None:
    """Lakhs and crores, because that is how this business talks about money."""
    assert _rupees(Decimal("4523")) == "₹4,523"
    assert _rupees(Decimal("452300")) == "₹4.52 lakh"
    assert _rupees(Decimal("45230000")) == "₹4.52 crore"


# ------------------------------------------------------- unknown, not zero


@pytest.mark.asyncio
async def test_profit_says_it_is_unavailable_rather_than_showing_zero() -> None:
    """The most dangerous number on the screen is a confident wrong one.

    With no cost price there is no profit. Reporting zero would be read as
    "we made nothing"; reporting revenue as profit would be read as a 100%
    margin. Both are lies. The card has to say it cannot tell.
    """
    async with AsyncSessionLocal() as session:
        await _clean(session)
        fx = await _fixture(session)
        try:
            period = ManagementPeriod.for_today()
            service = ManagementAnalyticsService(session)
            await _place_order(session, fx, when=period.today, quantity=5, unit_price="100.00")

            # The test product has no cost_price.
            await session.execute(
                text("UPDATE products SET cost_price = NULL WHERE id = :id"),
                {"id": fx["product_id"]},
            )
            await session.commit()

            result = await service.contribution(period)
            if result["available"]:
                # Other seeded products may carry a cost. What must always
                # hold is that coverage is reported and is not claimed to be
                # complete while an uncosted product sold.
                assert result["products_without_cost"] >= 1
                assert result["coverage_percent"] < 100.0, result
                assert "cost price" in result["contribution"]["note"].lower(), result
            else:
                assert result["contribution"]["value"] is None
                assert "cost price" in result["contribution"]["note"].lower()
                assert result["contribution"]["direction"] == "unknown"
        finally:
            await _clean(session)


@pytest.mark.asyncio
async def test_profit_never_treats_an_unknown_cost_as_zero_cost() -> None:
    """An uncosted product must be excluded, not counted as free.

    Including it would add its whole revenue to contribution and report a
    margin far above the real one - the error would flatter the business,
    which is the direction nobody checks.
    """
    async with AsyncSessionLocal() as session:
        await _clean(session)
        fx = await _fixture(session)
        try:
            period = ManagementPeriod.for_today()
            service = ManagementAnalyticsService(session)

            await _place_order(session, fx, when=period.today, quantity=100, unit_price="100.00")
            uncosted = await service.contribution(period)

            await session.execute(
                text("UPDATE products SET cost_price = 60 WHERE id = :id"),
                {"id": fx["product_id"]},
            )
            await session.commit()
            costed = await service.contribution(period)

            assert costed["available"] is True
            gained = Decimal(str(costed["contribution"]["value"])) - Decimal(
                str(uncosted["contribution"]["value"] or 0)
            )
            # 100 units at 100 with a cost of 60 contributes exactly 4000.
            assert gained == Decimal("4000"), (
                f"costing the product should add exactly 4000 of contribution, added {gained}"
            )
        finally:
            await _clean(session)


@pytest.mark.asyncio
async def test_an_officer_with_no_target_is_not_shown_as_failing() -> None:
    """No target set is not 0% achieved.

    A blank where nobody set a number must not look like the officer missed
    it, and the final milestone stage must explain why it is out of reach
    rather than sitting there greyed out with no reason.
    """
    async with AsyncSessionLocal() as session:
        period = ManagementPeriod.for_today()
        service = ManagementAnalyticsService(session)

        # Targets are shared demo state. Take a copy, remove them for the
        # length of this test, and put them back - a test that leaves the
        # database without its targets would make every later run of the
        # dashboard show "no target set" and look like a bug in the app.
        saved = (
            await session.execute(
                text(
                    "SELECT officer_id, target_value, notes, set_by FROM officer_monthly_targets "
                    "WHERE period = :p AND metric = 'sales_value'"
                ),
                {"p": period.this_month_start},
            )
        ).all()
        await session.execute(
            text("DELETE FROM officer_monthly_targets WHERE period = :p AND metric = 'sales_value'"),
            {"p": period.this_month_start},
        )
        await session.commit()

        try:
            officers = await service.officers(period)
            assert officers, "no active officers to check"
            for officer in officers:
                assert officer["achievement_percent"] is None
                assert officer["target_value"] is None
                assert "No sales target set" in officer["target_note"]
                assert officer["milestone"]["reached_index"] < 5, (
                    "Target Achieved was reached with no target in existence"
                )
                if officer["milestone"]["reached_index"] == 4:
                    assert "No sales target set" in officer["milestone"]["note"]
        finally:
            for row in saved:
                await session.execute(
                    text(
                        "INSERT INTO officer_monthly_targets "
                        "(id, officer_id, period, metric, target_value, notes, set_by, "
                        " created_at, updated_at) "
                        "VALUES (gen_random_uuid(), :officer, :period, 'sales_value', "
                        ":target, :notes, :set_by, now(), now())"
                    ),
                    {
                        "officer": row.officer_id,
                        "period": period.this_month_start,
                        "target": row.target_value,
                        "notes": row.notes,
                        "set_by": row.set_by,
                    },
                )
            await session.commit()


@pytest.mark.asyncio
async def test_a_conversion_rate_is_not_judged_on_a_handful_of_visits() -> None:
    """Two visits and no sale is not a failing field force.

    0% off three visits is arithmetic, not evidence. Telling the owner his
    officers are not converting, on that, would send him into a meeting with
    a conclusion the data cannot support.
    """
    async with AsyncSessionLocal() as session:
        service = ManagementAnalyticsService(session)
        result = await service.activity_to_business(ManagementPeriod.for_today())
        if result["visits"] == 0:
            assert "nothing to convert" in result["note"].lower()
        elif result["visits"] < 10:
            assert "too few visits" in result["note"].lower(), result["note"]
            assert "worth looking at" not in result["note"].lower(), (
                "a verdict was passed on a handful of visits: " + result["note"]
            )


@pytest.mark.asyncio
async def test_no_seasonal_claim_is_made_without_a_year_of_history() -> None:
    """Seasonality is the one thing a short period cannot show.

    With three months of data, "sells more in June" is the shape of what
    happened to be recorded. The dashboard must say the history is too short
    and how much is needed, not draw a confident line through noise.
    """
    async with AsyncSessionLocal() as session:
        service = ManagementAnalyticsService(session)
        result = await service.seasonality(ManagementPeriod.for_today())

        assert result["months_needed"] == 12
        if not result["has_enough_history"]:
            assert result["insights"] == [], (
                "a seasonal claim was made on "
                f"{result['months_with_sales']} months of history"
            )
            assert "at least 12 months" in result["history_note"]
        else:
            assert result["months_with_sales"] >= 12


# ------------------------------------------------------------ the wording


def test_a_steady_product_is_not_called_seasonal() -> None:
    """A detector that flags everything is worth nothing.

    A product selling the same amount every month must come back as even,
    not with an invented peak. Pure function, so no database is needed.
    """
    points = [
        {"year": 2025, "month": m, "label": f"M{m}", "revenue": 1000.0, "units": 10}
        for m in range(1, 13)
    ]
    insight = ManagementAnalyticsService._seasonal_insight("Steady Product", points)
    assert insight is not None
    assert insight["peak_months"] == []
    assert "fairly evenly" in insight["sentence"]


def test_a_seasonal_product_names_its_months_as_a_range() -> None:
    """"June to August", the way a person says it - not a list of three."""
    points = []
    for month in range(1, 13):
        revenue = 5000.0 if month in (6, 7, 8) else 800.0
        points.append(
            {"year": 2025, "month": month, "label": f"M{month}", "revenue": revenue, "units": 10}
        )
    insight = ManagementAnalyticsService._seasonal_insight("Bio-NPK", points)
    assert insight is not None
    assert insight["peak_months"] == [6, 7, 8]
    assert "usually sells more from June to August" in insight["sentence"], insight["sentence"]


def test_non_consecutive_peaks_are_listed_not_turned_into_a_range() -> None:
    """March and September is not "March to September"."""
    points = []
    for month in range(1, 13):
        revenue = 5000.0 if month in (3, 9) else 800.0
        points.append(
            {"year": 2025, "month": month, "label": f"M{month}", "revenue": revenue, "units": 10}
        )
    insight = ManagementAnalyticsService._seasonal_insight("Split Product", points)
    assert insight is not None
    assert insight["peak_months"] == [3, 9]
    assert "March and September" in insight["sentence"], insight["sentence"]
    assert "March to September" not in insight["sentence"]


def test_milestone_stages_are_reached_in_the_order_work_happens() -> None:
    service = ManagementAnalyticsService(session=None)  # type: ignore[arg-type]

    nothing = service._milestone(visits=0, farmers=0, orders=0, products=0, achievement=None)
    assert nothing["current_stage"] == "Started"
    assert "No visits recorded" in nothing["note"]

    visiting = service._milestone(visits=5, farmers=0, orders=0, products=0, achievement=None)
    assert visiting["current_stage"] == "Visits Completed"

    selling = service._milestone(visits=5, farmers=3, orders=2, products=2, achievement=None)
    assert selling["current_stage"] == "Products Sold"

    hit = service._milestone(
        visits=5, farmers=3, orders=2, products=2, achievement=Decimal("103")
    )
    assert hit["current_stage"] == "Target Achieved"
    assert hit["reached_index"] == 5

    missed = service._milestone(
        visits=5, farmers=3, orders=2, products=2, achievement=Decimal("64")
    )
    assert missed["current_stage"] == "Products Sold", (
        "an officer at 64% of target must not show as having achieved it"
    )


def test_every_officer_gets_at_most_one_reason_to_look_at_them() -> None:
    """Thirty seconds does not survive three warnings per person."""
    service = ManagementAnalyticsService(session=None)  # type: ignore[arg-type]

    assert service._needs_attention(Decimal("0"), 0, None, 0) == "No activity recorded this month"
    assert (
        service._needs_attention(Decimal("0"), 12, None, 3)
        == "Visits are happening but no sales yet"
    )
    assert "Below half of target" in (
        service._needs_attention(Decimal("500"), 12, Decimal("20"), 0) or ""
    )
    assert service._needs_attention(Decimal("500"), 12, Decimal("90"), 0) is None, (
        "an officer at 90% of target with no overdue work should not be flagged"
    )


# ------------------------------------------------------------------- HTTP


@pytest.mark.asyncio
async def test_the_dashboard_loads_and_answers_all_eight_questions() -> None:
    async with AsyncSessionLocal() as session:
        email = (
            await session.execute(
                text(
                    "SELECT email FROM users WHERE role = 'admin' AND is_active = true "
                    "AND is_deleted = false ORDER BY created_at LIMIT 1"
                )
            )
        ).scalar_one_or_none()
    if not email:
        pytest.skip("Seeded admin required")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post(
            "/api/v1/auth/login", json={"email": email, "password": "Password123!"}
        )
        if login.status_code != 200:
            pytest.skip("Seeded admin login unavailable")
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        response = await client.get("/api/v1/momentum/management/dashboard", headers=headers)
        assert response.status_code == 200, response.text
        body = response.json()

        expected = {
            "how_much_did_we_sell",
            "is_it_increasing",
            "who_sells_most",
            "what_sells_most",
            "where_it_sells",
            "what_is_seasonal",
            "who_needs_attention",
            "is_field_work_working",
        }
        assert set(body["answers"]) == expected, body["answers"].keys()
        for question, answer in body["answers"].items():
            assert isinstance(answer, str) and answer.strip(), f"{question} came back empty"

        # Every headline figure ships the words to read it by.
        for name, figure in body["headline"].items():
            if isinstance(figure, dict):
                assert figure["note"].strip(), f"{name} has a number and no explanation"


@pytest.mark.asyncio
async def test_an_officer_cannot_see_the_management_dashboard() -> None:
    """It ranks people. That is not a screen the ranked get to open."""
    async with AsyncSessionLocal() as session:
        email = (
            await session.execute(
                text(
                    "SELECT email FROM users WHERE role = 'field_officer' AND is_active = true "
                    "AND is_deleted = false ORDER BY created_at LIMIT 1"
                )
            )
        ).scalar_one_or_none()
    if not email:
        pytest.skip("Seeded field officer required")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        login = await client.post(
            "/api/v1/auth/login", json={"email": email, "password": "Password123!"}
        )
        if login.status_code != 200:
            pytest.skip("Seeded officer login unavailable")
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

        for path in (
            "/api/v1/momentum/management/dashboard",
            "/api/v1/momentum/management/officers",
            "/api/v1/momentum/management/products",
            "/api/v1/momentum/management/seasonality",
            "/api/v1/momentum/management/territories",
        ):
            response = await client.get(path, headers=headers)
            assert response.status_code == 403, f"{path} let a field officer in"


@pytest.mark.asyncio
async def test_the_dashboard_survives_an_empty_database() -> None:
    """The state every real installation starts in.

    A first install has no orders at all. The screen has to come up and say so
    in words, not crash on a division or render a wall of NaN - the README
    already warns that an unseeded app "looks broken", and this is the screen
    where that impression would cost the most.
    """
    async with AsyncSessionLocal() as session:
        service = ManagementAnalyticsService(session)
        # A month far enough back that no seeded row can fall inside it.
        period = ManagementPeriod.for_today(dt.date(2019, 3, 15))

        headline = await service.headline(period)
        assert headline["total_sales"]["value"] == 0
        assert "No sales recorded" in headline["total_sales"]["note"]
        assert headline["total_sales"]["direction"] == "unknown"

        contribution = await service.contribution(period)
        assert contribution["available"] is False

        territories = await service.territories(period)
        assert "No district" in territories["note"]

        products = await service.products(period)
        assert products["top"] is None or products["top"]["revenue"] == 0

        funnel = await service.activity_to_business(period)
        assert funnel["visits"] == 0
        assert "nothing to convert" in funnel["note"].lower()

        trend = await service.monthly_trend(period)
        assert trend["points"] == []
