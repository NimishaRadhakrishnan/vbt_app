"""The management dashboard's data, in one call.

Mounted under /momentum/management because it lives in the Momentum &
Milestones area of the app, beside the officer-facing momentum view - but it
is a different thing for a different reader, and the split is deliberate:

  * /momentum/me and /momentum/team are for the officers. That code says
    "personal trend only, never a ranking", and it means it: an officer who
    is behind is told they are building, not that they are last.

  * this router is for the owner and the managers. It ranks. It names who
    needs attention. Those two purposes cannot share a payload without one of
    them being wrong, so they do not.

Everything here is admin or manager only.

WHY ONE ENDPOINT RETURNS EVERYTHING
-----------------------------------
`GET /momentum/management/dashboard` returns the whole screen. The brief was
that the owner should understand the business in thirty seconds without
hunting through pages; eight separate requests would mean eight separate
loading states and a screen that assembles itself piece by piece in front of
them. The individual sections are exposed too, for drilling in without
re-fetching the rest.
"""

from __future__ import annotations

import datetime as dt
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.services.management_analytics_service import (
    ManagementAnalyticsService,
    ManagementPeriod,
)
from app.domain.value_objects.role import Role
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import require_role

router = APIRouter(prefix="/momentum/management", tags=["management-dashboard"])

_ManagerOrAdmin = Annotated[object, Depends(require_role(Role.ADMIN, Role.MANAGER))]


def _period(month: Optional[str]) -> ManagementPeriod:
    """The window to report on. Defaults to the current month in IST.

    ``month`` is YYYY-MM. An unparseable value falls back to today rather than
    erroring: a dashboard that refuses to load because of a malformed query
    string is worse than one showing the current month.
    """
    if month:
        try:
            year, mon = month.split("-")
            return ManagementPeriod.for_today(dt.date(int(year), int(mon), 1))
        except (ValueError, TypeError):
            pass
    return ManagementPeriod.for_today()


@router.get("/dashboard")
async def management_dashboard(
    _current_user: _ManagerOrAdmin,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    month: Optional[str] = Query(
        default=None, description="YYYY-MM. Defaults to the current month (IST)."
    ),
) -> dict:
    """Everything the first screen shows, in one request."""
    period = _period(month)
    service = ManagementAnalyticsService(session)

    headline = await service.headline(period)
    contribution = await service.contribution(period)
    officers = await service.officers(period)
    products = await service.products(period)
    territories = await service.territories(period)
    seasonality = await service.seasonality(period)
    funnel = await service.activity_to_business(period)
    trend = await service.monthly_trend(period)

    # An officer who did nothing at all this month is a different problem from
    # one who is working and falling short, and mixing them ruins the list.
    #
    # This was found by looking at the real screen: with several dormant
    # accounts on the books, every one of them raised its own warning and the
    # section became a wall of identical alerts. A "needs attention" list that
    # is always full teaches the reader to skip it just as surely as one that
    # is always empty - and the officers who are actually struggling were
    # buried among accounts nobody expects anything from.
    #
    # So dormant officers are counted in one line, and the list itself is kept
    # for people whose month can still be acted on.
    dormant = [o for o in officers if o["visits"] == 0 and o["sales_value"] <= 0]
    attention = [
        {"name": o["name"], "officer_id": o["officer_id"], "reason": o["needs_attention"]}
        for o in officers
        if o["needs_attention"] and not (o["visits"] == 0 and o["sales_value"] <= 0)
    ]
    top_officer = officers[0] if officers and officers[0]["sales_value"] > 0 else None

    return {
        "period": {
            "label": period.label,
            "month": period.this_month_start.isoformat(),
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        },
        "headline": headline,
        "contribution": contribution,
        "funnel": funnel,
        "trend": trend,
        "officers": officers,
        "products": products,
        "territories": territories,
        "seasonality": seasonality,
        # The eight questions the brief said the first screen must answer,
        # each already reduced to one sentence. Assembled here rather than in
        # the page so the words cannot drift from the figures they describe.
        "answers": {
            "how_much_did_we_sell": headline["total_sales"]["display"],
            "is_it_increasing": headline["total_sales"]["note"],
            "who_sells_most": (
                f"{top_officer['name']} - {top_officer['sales_display']}"
                if top_officer
                else "No officer has recorded a sale this month."
            ),
            "what_sells_most": (
                products["top"]["note"]
                if products.get("top")
                else "No product has sold this month."
            ),
            "where_it_sells": territories["note"],
            "what_is_seasonal": (
                seasonality["insights"][0]["sentence"]
                if seasonality["insights"]
                else seasonality["history_note"]
            ),
            "who_needs_attention": (
                f"{len(attention)} officer(s) need attention."
                if attention
                else "No active officer is flagged for attention this month."
            ),
            "is_field_work_working": funnel["note"],
        },
        "needs_attention": attention,
        "dormant": {
            "count": len(dormant),
            "officer_ids": [o["officer_id"] for o in dormant],
            "note": (
                f"{len(dormant)} officer(s) recorded no visits and no sales at all in "
                f"{period.label}."
                if dormant
                else ""
            ),
        },
    }


@router.get("/officers")
async def management_officers(
    _current_user: _ManagerOrAdmin,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    month: Optional[str] = None,
) -> list[dict]:
    return await ManagementAnalyticsService(session).officers(_period(month))


@router.get("/products")
async def management_products(
    _current_user: _ManagerOrAdmin,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    month: Optional[str] = None,
) -> dict:
    return await ManagementAnalyticsService(session).products(_period(month))


@router.get("/officer-products")
async def management_officer_products(
    _current_user: _ManagerOrAdmin,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    month: Optional[str] = None,
) -> list[dict]:
    """Who is selling more of which product."""
    return await ManagementAnalyticsService(session).officer_product_matrix(_period(month))


@router.get("/seasonality")
async def management_seasonality(
    _current_user: _ManagerOrAdmin,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    months: int = Query(default=24, ge=6, le=60),
) -> dict:
    return await ManagementAnalyticsService(session).seasonality(
        ManagementPeriod.for_today(), months=months
    )


@router.get("/territories")
async def management_territories(
    _current_user: _ManagerOrAdmin,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    month: Optional[str] = None,
) -> dict:
    return await ManagementAnalyticsService(session).territories(_period(month))
