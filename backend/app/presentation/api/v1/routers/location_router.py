from __future__ import annotations

import math
import uuid
from datetime import UTC, datetime, time, timedelta
from typing import Annotated, Optional

from pydantic import BaseModel, Field
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.dto.auth_dto import CurrentUserOutput
from app.application.services import geofence_service
from app.application.services.alerts_service import AlertsService
from app.domain.value_objects.role import Role
from app.infrastructure.cache.location_cache import LocationCache
from app.infrastructure.cache.redis_client import get_redis_client
from app.infrastructure.config.company_time import company_today, company_tz
from app.infrastructure.config.settings import get_settings
from app.infrastructure.database.session import AsyncSessionLocal, get_db_session
from app.infrastructure.websockets.redis_pubsub_broadcaster import RedisPubSubBroadcaster
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.presentation.middleware.rate_limiter import enforce_location_ping_rate_limit
from app.presentation.schemas.location_schemas import LocationActiveResponse, LocationPingRequest

router = APIRouter(prefix="/location", tags=["location"])

async def async_insert_gps_track(
    officer_id: uuid.UUID, payload: LocationPingRequest, territory_violation: bool = False
):
    """
    distance_from_prev is computed for real here (previously always 0.0).
    Two design decisions worth being explicit about:

    - Same-day only, not "most recent regardless of day": if an officer
      checks out at 6pm at one location and checks in the next morning
      somewhere else entirely, comparing against yesterday's last point
      would produce a large, meaningless "distance" that has nothing to
      do with today's actual movement - it would corrupt the first
      distance_from_prev value of every single day, for every officer,
      forever. Same-day scoping also matches how every other GPS-related
      computation in this file already treats a day as the natural unit
      (get_location_history, get_location_diagnostics, the staleness
      tiers) - this isn't a new rule, it's consistency with the existing
      ones. The first ping of a day correctly gets 0.0 (via COALESCE),
      same as before this change, just now for a real reason instead of
      a hardcoded one.

    - PostGIS ST_Distance, computed inside the INSERT itself via a scalar
      subquery, rather than a separate SELECT-then-INSERT round trip.
      Either literal option in the original ask (ST_Distance vs. the
      _haversine_meters helper) needs to look up the prior point first -
      you can't compute a distance without knowing what the prior point
      is - so "avoid an extra round trip" isn't actually available by
      switching to Python/haversine; the prior-point lookup happens
      either way. Doing it as one INSERT...SELECT with ST_Distance in a
      subquery gets both the precision of PostGIS's geography-aware
      distance calculation AND stays at exactly one round trip per ping,
      which is strictly better than the two options as literally posed.
    """
    async with AsyncSessionLocal() as session:
        if payload.status == "active" and payload.lat is not None and payload.lng is not None:
            # Only an implausible jump vs. the officer's own last point
            # today (>2km in <60s, ~120+ km/h - a GPS teleport artifact,
            # never a real walk/drive) is dropped outright here. A flat
            # accuracy>500m cutoff used to live here too and was removed:
            # an officer with a genuinely weak signal (indoors, dense
            # cover) can report >500m accuracy on every single fix for
            # their whole shift, and dropping all of them silently erased
            # their entire Movement History for the day while the live
            # map still showed them "Active" (that status comes from the
            # unfiltered Redis cache, not this table) - looking broken
            # when tracking was in fact working, just imprecise. A real,
            # if imprecise, point is still worth a breadcrumb on the map;
            # the diagnostics endpoint already flags low-accuracy pings
            # for review rather than hiding them, and this now matches
            # that same stored-but-flagged philosophy instead of erasing.
            prev_row = (
                await session.execute(
                    text("""
                        SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, recorded_at
                        FROM gps_tracks
                        WHERE user_id = :user_id
                          AND DATE(recorded_at AT TIME ZONE :company_tz) = DATE(:recorded_at AT TIME ZONE :company_tz)
                        ORDER BY recorded_at DESC
                        LIMIT 1
                    """).bindparams(
                        user_id=officer_id,
                        company_tz=get_settings().company_timezone,
                        recorded_at=payload.timestamp,
                    )
                )
            ).first()

            if prev_row and prev_row.lat is not None:
                gap_seconds = (payload.timestamp - prev_row.recorded_at).total_seconds()
                if 0 <= gap_seconds < 60:
                    distance_m = _haversine_meters(prev_row.lat, prev_row.lng, payload.lat, payload.lng)
                    if distance_m > 2000:
                        return

            await session.execute(
                text("""
                    INSERT INTO gps_tracks (
                        id, user_id, recorded_at, location, accuracy, speed, is_idle,
                        distance_from_prev, territory_violation, battery_level, created_at
                    )
                    SELECT
                        gen_random_uuid(), :user_id, :recorded_at,
                        ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                        :accuracy, :speed, :is_idle,
                        COALESCE(
                            ST_Distance(
                                (
                                    SELECT location FROM gps_tracks
                                    WHERE user_id = :user_id
                                      AND DATE(recorded_at AT TIME ZONE :company_tz) = DATE(:recorded_at AT TIME ZONE :company_tz)
                                    ORDER BY recorded_at DESC
                                    LIMIT 1
                                ),
                                ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
                            ),
                            0.0
                        ),
                        :territory_violation, :battery_level, :created_at
                """).bindparams(
                    user_id=officer_id,
                    company_tz=get_settings().company_timezone,
                    recorded_at=payload.timestamp,
                    lng=payload.lng,
                    lat=payload.lat,
                    accuracy=payload.accuracy if payload.accuracy is not None else 9999.0,
                    speed=payload.speed_kmh or 0.0,
                    is_idle=(payload.speed_kmh or 0.0) < 0.5,
                    battery_level=payload.battery_pct,
                    territory_violation=territory_violation,
                    created_at=datetime.now(UTC),
                )
            )
            await session.commit()


async def sweep_stale_locations() -> None:
    """Tier 2 check: broadcasts an admin alert for officers whose location
    has gone stale past settings.location_stale_tier2_seconds. Called
    periodically by the sweep loop in main.py's lifespan handler - see
    that file for the single-process assumption this relies on.

    Scope, deliberately: this only fires for officers who were checked in
    AND have not checked out AND have a cache entry whose status was
    "active" and has since gone quiet. It does NOT cover an officer who
    checked in but never sent a single ping at all (e.g. a location
    permission that was never granted) - that's a genuinely different
    problem ("tracking never started" vs. "tracking stopped mid-shift")
    that this sweep isn't designed to catch; conflating the two would
    blur two signals admin needs to tell apart. Also deliberately
    excludes officers who have already checked out today - their cache
    entry ages normally after checkout (nothing sends a final ping on
    check-out), and without this exclusion every officer would trigger a
    false Tier 2 alert like clockwork ~30 minutes after every single
    normal end-of-shift, which is guaranteed, predictable alert fatigue
    from day one - a different problem than the "we don't know rural
    conditions" uncertainty already flagged for the threshold itself.
    """
    settings = get_settings()
    redis = get_redis_client()
    cache = LocationCache(redis)
    broadcaster = RedisPubSubBroadcaster(redis)

    
    tz = company_tz()
    day_start = datetime.combine(company_today(), time.min, tzinfo=tz)
    day_end = day_start + timedelta(days=1)
    
    async with AsyncSessionLocal() as session:
        res = await session.execute(
            text("""
                SELECT u.id AS officer_id, u.full_name AS officer_name,
                       att.check_in_time AS check_in_time,
                       EXISTS (
                           SELECT 1 FROM gps_tracks g
                           WHERE g.user_id = u.id AND g.recorded_at >= :day_start
                       ) AS has_track
                FROM users u
                JOIN attendance att ON att.user_id = u.id AND att.check_in_time >= :day_start AND att.check_in_time < :day_end
                WHERE u.role IN ('field_officer', 'sales_officer')
                  AND u.is_active = true AND u.is_deleted = false
                  AND att.check_out_time IS NULL
            """).bindparams(day_start=day_start, day_end=day_end)
        )
        rows = res.all()

    if not rows:
        return

    officer_ids = [str(r.officer_id) for r in rows]
    cached_locations = await cache.get_all_active_locations(officer_ids)
    now = datetime.now(UTC)

    for r in rows:
        uid_str = str(r.officer_id)
        cached_data = cached_locations.get(uid_str)
        if not cached_data and not r.has_track:
            # Checked in but not one ping all day: tracking never started
            # (permission refused, phone killed the app, no signal). Alert once
            # after a grace period; the next ping clears the flag.
            grace = 600  # seconds
            check_in = r.check_in_time
            if check_in.tzinfo is None:
                check_in = check_in.replace(tzinfo=UTC)
            if (now - check_in).total_seconds() > grace and not await cache.has_stale_alert_been_sent(uid_str):
                msg = f"{r.officer_name} checked in but no location has been received yet."
                await broadcaster.broadcast("alerts", {
                    "type": "tracking_not_started",
                    "officer_id": uid_str,
                    "message": msg,
                })
                await cache.mark_stale_alert_sent(uid_str)
                async with AsyncSessionLocal() as alert_session:
                    await alert_session.execute(
                        text(
                            """
                            INSERT INTO location_alerts (id, user_id, alert_type, message)
                            VALUES (gen_random_uuid(), :uid, 'tracking_not_started', :msg)
                            """
                        ).bindparams(uid=r.officer_id, msg=msg)
                    )
                    await alert_session.commit()
            continue
        if not cached_data or cached_data.get("status") != "active":
            continue

        updated_at_str = cached_data.get("updated_at")
        if not updated_at_str:
            continue
        updated_at = datetime.fromisoformat(updated_at_str)
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=UTC)
        time_diff = (now - updated_at).total_seconds()

        if time_diff <= settings.location_stale_tier2_seconds:
            continue

        if await cache.has_stale_alert_been_sent(uid_str):
            continue  # already alerted for this ongoing gap, don't repeat

        await broadcaster.broadcast("alerts", {
            "type": "tracking_gap",
            "officer_id": uid_str,
            "message": f"{r.officer_name}'s location hasn't updated in over "
                       f"{settings.location_stale_tier2_seconds // 60} minutes.",
        })
        await cache.mark_stale_alert_sent(uid_str)
        async with AsyncSessionLocal() as alert_session:
            await alert_session.execute(
                text(
                    """
                    INSERT INTO location_alerts (id, user_id, alert_type, message)
                    VALUES (gen_random_uuid(), :uid, 'tracking_gap', :msg)
                    """
                ).bindparams(
                    uid=r.officer_id,
                    msg=f"{r.officer_name}'s location hasn't updated in over "
                        f"{settings.location_stale_tier2_seconds // 60} minutes.",
                )
            )
            await alert_session.commit()

@router.post(
    "/ping",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(enforce_location_ping_rate_limit)],
)
async def ping_location(
    payload: LocationPingRequest,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks
) -> dict:
    officer_id = current_user.user_id
    now = datetime.now(UTC)
    settings = get_settings()

    redis = get_redis_client()
    cache = LocationCache(redis)
    broadcaster = RedisPubSubBroadcaster(redis)

    # Checked out for the day: record nothing and tell the phone to stop.
    if await cache.is_off_duty(str(officer_id)):
        return {"status": "stopped"}

    # 1. Save live state to Redis
    location_data = {
        "officer_id": str(officer_id),
        "latitude": payload.lat,
        "longitude": payload.lng,
        "accuracy": payload.accuracy,
        "speed": payload.speed_kmh,
        "battery_level": payload.battery_pct,
        "status": payload.status,
        "updated_at": now.isoformat()
    }
    await cache.set_active_location(str(officer_id), location_data, ttl=settings.location_cache_ttl_seconds)

    # A fresh ping means any gap that previously triggered a Tier 2 alert
    # is over - clear the dedup flag so a future gap can alert again
    # rather than staying permanently suppressed by an old flag.
    await cache.clear_stale_alert(str(officer_id))

    # 2. Broadcast via WebSocket
    await broadcaster.broadcast("location_updates", location_data)

    # 3. Evaluate Alerts
    alerts_service = AlertsService()
    await alerts_service.evaluate_location(officer_id, {
        "battery_pct": payload.battery_pct,
        "is_mocked": payload.is_mocked if hasattr(payload, 'is_mocked') else False,
    })

    # 3b. Territory geofence. Raises its own stored alert once an excursion
    # is confirmed; returns whether this fix is outside every assigned fence.
    outside = await geofence_service.evaluate(
        officer_id, payload.lat, payload.lng, payload.accuracy
    )

    # 4. Background DB insert for historical track
    background_tasks.add_task(async_insert_gps_track, officer_id, payload, bool(outside))

    return {"status": "success"}

@router.get("/active", response_model=list[LocationActiveResponse])
async def get_active_locations(
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[LocationActiveResponse]:
    
    tz = company_tz()
    day_start = datetime.combine(company_today(), time.min, tzinfo=tz)
    day_end = day_start + timedelta(days=1)

    # 1. Fetch user & attendance data from Postgres
    res = await session.execute(
        text("""
            SELECT u.id AS officer_id, u.full_name AS officer_name, u.role AS officer_role,
                   att.check_in_time AS login_time,
                   att.check_out_time AS logout_time,
                   ST_Y(att.check_in_location::geometry) AS login_latitude,
                   ST_X(att.check_in_location::geometry) AS login_longitude
            FROM users u
            LEFT JOIN attendance att ON att.user_id = u.id AND att.check_in_time >= :day_start AND att.check_in_time < :day_end
            WHERE u.role IN ('field_officer', 'sales_officer') AND u.is_active = true AND u.is_deleted = false
        """).bindparams(day_start=day_start, day_end=day_end)
    )
    rows = res.all()

    officer_ids = [str(r.officer_id) for r in rows]

    # The live cache forgets an officer ~35 minutes after their last ping.
    # The stored track remembers, so "last seen" survives that.
    last_track_res = await session.execute(
        text("""
            SELECT user_id, MAX(recorded_at) AS last_at
            FROM gps_tracks
            WHERE recorded_at >= :day_start AND recorded_at < :day_end
            GROUP BY user_id
        """).bindparams(day_start=day_start, day_end=day_end)
    )
    last_track_at = {str(t.user_id): t.last_at for t in last_track_res.all()}

    # 2. Fetch active locations from Redis
    redis = get_redis_client()
    cache = LocationCache(redis)
    cached_locations = await cache.get_all_active_locations(officer_ids)

    active_locations = []
    now = datetime.now(UTC)
    settings = get_settings()

    for r in rows:
        uid_str = str(r.officer_id)
        cached_data = cached_locations.get(uid_str, {})

        updated_at_str = cached_data.get("updated_at")
        updated_at = datetime.fromisoformat(updated_at_str) if updated_at_str else None

        status_val = cached_data.get("status", "location_unavailable")
        accuracy = cached_data.get("accuracy")

        if updated_at:
            if updated_at.tzinfo is not None:
                time_diff = (now - updated_at).total_seconds()
            else:
                time_diff = (datetime.now(UTC) - updated_at).total_seconds()

            # Tier 1: dashboard-only "signal lost" label, no alert - see
            # settings.location_stale_tier1_seconds. Brief gaps are
            # expected (dead zones, indoors, battery dip) and not
            # inherently suspicious; Tier 2 (the sweep loop in main.py)
            # is what actually notifies admin, at a much longer threshold.
            if status_val == "active" and time_diff > settings.location_stale_tier1_seconds:
                status_val = "stale"
            elif status_val == "active" and accuracy is not None and accuracy > 100:
                status_val = "low_accuracy"
        else:
            status_val = "location_unavailable"

        active_locations.append(
            LocationActiveResponse(
                officer_id=r.officer_id,
                officer_name=r.officer_name,
                officer_role=r.officer_role,
                latitude=cached_data.get("latitude"),
                longitude=cached_data.get("longitude"),
                accuracy=accuracy,
                speed=cached_data.get("speed"),
                battery_level=cached_data.get("battery_level"),
                status=status_val,
                updated_at=updated_at,
                last_seen_at=max(
                    (d for d in (updated_at, last_track_at.get(uid_str)) if d is not None),
                    default=None,
                ),
                check_out_time=r.logout_time,
                login_time=r.login_time,
                login_latitude=r.login_latitude,
                login_longitude=r.login_longitude,
            )
        )

    return active_locations

@router.get("/history/{officer_id}")
async def get_location_history(
    officer_id: uuid.UUID,
    date: str,
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[dict]:
    # Same fix as get_location_diagnostics below, same root cause: asyncpg's
    # strict prepared-statement typing binds a plain Python str as VARCHAR,
    # and Postgres has no implicit VARCHAR->date cast in this comparison.
    # Confirmed live against a real database before this fix existed:
    # "operator does not exist: date = character varying".
    #
    # Uses HTTPException here rather than diagnostics' `return {"error": ...}`
    # style - the only other error-handling precedent anywhere in this file,
    # but not followed here for two reasons: (1) this endpoint's declared
    # return type is `list[dict]`, and returning a bare {"error": ...} dict
    # on the failure path would make the actual response shape sometimes a
    # list, sometimes a plain object - a client can't trust the type without
    # inspecting the body first. Raising instead keeps the success path
    # honestly always a list, and lets a client (including RouteReplay,
    # which calls this endpoint) distinguish success/empty/error purely by
    # status code. (2) HTTPException is the dominant convention across the
    # rest of this backend's routers (task_router, planning_router,
    # enquiry_router, etc.) - the diagnostics dict-return is the outlier
    # here, not the house style.
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {date!r}. Expected YYYY-MM-DD.")

    # Two bugs fixed here together, because they share one line.
    #
    # BUG A - the day boundary was UTC, not company time. Officers are in
    # IST (UTC+5:30), so EVERY ping recorded between 00:00 and 05:30 IST
    # fell on the previous UTC day: an officer starting early, or a late
    # evening visit, had their route silently split across two dates on
    # the admin map. Points went missing from the day being viewed and
    # appeared on a day nobody was looking at.
    #
    # This file already had the fix available and didn't use it -
    # app/infrastructure/config/company_time.py exists precisely for
    # this, and its own docstring says every "which day is this?"
    # decision must use the company's calendar day, never the server's.
    #
    # BUG B - DATE(recorded_at AT TIME ZONE ...) is not sargable. Wrapping
    # the column in a function meant the composite index on
    # (user_id, recorded_at) could not be used, so every history lookup
    # scanned. At one ping / 15s that is ~2,000 rows per officer per day
    # and half a million a month for ten officers: the map would have got
    # slower every month until it timed out.
    #
    # A half-open range on the raw column fixes both at once - correct
    # across the timezone boundary AND index-friendly.
    tz = company_tz()
    day_start = datetime.combine(target_date, time.min, tzinfo=tz)
    day_end = day_start + timedelta(days=1)

    res = await session.execute(
        text("""
            SELECT ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, recorded_at, speed, battery_level, accuracy
            FROM gps_tracks
            WHERE user_id = :officer_id
              AND recorded_at >= :day_start
              AND recorded_at <  :day_end
            ORDER BY recorded_at ASC
        """).bindparams(officer_id=officer_id, day_start=day_start, day_end=day_end)
    )
    rows = res.all()
    # `accuracy` (metres) lets the Route Replay screen ignore very poor fixes;
    # 9999 is the "phone gave no figure" placeholder written at ping time.
    return [
        {
            "lat": r.lat,
            "lng": r.lng,
            "recorded_at": r.recorded_at,
            "speed": r.speed,
            "battery_level": r.battery_level,
            "accuracy": r.accuracy,
        }
        for r in rows
    ]


@router.get("/me/today")
async def get_my_tracking_today(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """An officer's own tracking summary for today.

    /location/history/{officer_id} is ADMIN/MANAGER only, so before this
    endpoint an officer had no way to see what was being recorded about
    them. That gap is a compliance problem as much as a product one: the
    single strongest signal that a tracking app is not covert is that the
    tracked person can see their own data.

    A summary rather than the raw point list, deliberately. The officer's
    real questions are "is it on?", "what did it record?", "when did it
    start and stop?" - a 2,000-row payload answers none of them better
    than four numbers do, and would be slow on a field phone.

    Company-local day boundary, for the same reason as the history
    endpoint above. On THIS screen specifically, showing a UTC day would
    make an officer's own early-morning points appear missing, which
    looks like the app hiding something.
    """
    tz = company_tz()
    today = company_today()
    day_start = datetime.combine(today, time.min, tzinfo=tz)
    day_end = day_start + timedelta(days=1)

    row = (
        await session.execute(
            text("""
                SELECT COUNT(*) AS point_count,
                       MIN(recorded_at) AS first_recorded_at,
                       MAX(recorded_at) AS last_recorded_at,
                       COALESCE(SUM(distance_from_prev), 0) / 1000.0 AS total_distance_km
                FROM gps_tracks
                WHERE user_id = :user_id
                  AND recorded_at >= :day_start
                  AND recorded_at <  :day_end
            """).bindparams(user_id=current_user.user_id, day_start=day_start, day_end=day_end)
        )
    ).first()

    checked_in = (
        await session.execute(
            text("""
                SELECT 1 FROM attendance
                WHERE user_id = :user_id AND date = :today AND check_out_time IS NULL
            """).bindparams(user_id=current_user.user_id, today=today)
        )
    ).first() is not None

    retention = (
        await session.execute(
            text("SELECT retention_months FROM location_disclosure_versions WHERE is_active")
        )
    ).scalar_one_or_none() or 12

    return {
        "point_count": row.point_count or 0,
        "first_recorded_at": row.first_recorded_at,
        "last_recorded_at": row.last_recorded_at,
        "total_distance_km": float(row.total_distance_km or 0.0),
        "checked_in": checked_in,
        "retention_months": retention,
    }


def _haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two lat/lng points, in meters.
    Used only for the diagnostics endpoint's implausible-jump check below
    - a ~2km-scale heuristic for flagging suspect points, not a precision
    calculation, so plain haversine is accurate enough without needing a
    PostGIS ST_Distance round trip per point pair."""
    R = 6371000.0  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


@router.get("/diagnostics/{officer_id}")
async def get_location_diagnostics(
    officer_id: uuid.UUID,
    date: str,
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """
    GPS-accuracy diagnostic for real-device field testing. This is a QA
    tool for verifying tracking behavior against real rural/device
    conditions, not a production officer-facing feature - deliberately
    minimal, no frontend, admin/manager only like the rest of this
    router's read endpoints.

    Summarizes one officer's gps_tracks for one date: actual vs.
    theoretical delivery rate (15s interval), accuracy distribution,
    timing gaps measured against the existing two-tier staleness
    thresholds (settings.location_stale_tier1_seconds /
    _tier2_seconds - the same numbers that drive the dashboard "stale"
    label and the Tier 2 admin alert, so a diagnostic run and production
    behavior are always talking about the same thresholds), and any
    implausible location jumps. Jumps are flagged for a human to look at,
    not auto-corrected or excluded from the stats above - a bad point
    should be visible, not silently smoothed away.
    """
    settings = get_settings()

    # Parsed once, up front, into a real date object rather than passed
    # through as a raw string. Discovered via live testing (not visible
    # from reading the code alone): asyncpg's strict prepared-statement
    # parameter typing binds a plain Python str as VARCHAR, and Postgres
    # has no implicit VARCHAR->date cast in a comparison context - this
    # is a genuine, pre-existing bug in get_location_history's identical
    # query pattern above (confirmed by running that exact query against
    # a real database: it fails with "operator does not exist: date =
    # character varying"). Not fixed here since that's a different,
    # already-shipped endpoint outside this task's scope - flagging it,
    # not silently patching it.
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        return {"error": f"Invalid date format: {date!r}. Expected YYYY-MM-DD."}

    # Same company-day range as get_location_history above, with accuracy
    # added to the selected columns.
    #
    # This endpoint carried the SAME UTC day-boundary bug and was missed
    # on the first pass - the source guard in
    # tests/integration/test_location_day_boundary.py caught it. Worth
    # noting why it mattered here specifically: diagnostics compares
    # actual ping count against an expected count derived from check-in
    # duration, so counting a UTC day's pings against an IST day's
    # attendance made the delivery rate wrong for any officer who started
    # before 05:30, and "tracking looks unreliable" is precisely the
    # conclusion this endpoint exists to test.
    day_start_diag = datetime.combine(target_date, time.min, tzinfo=company_tz())
    day_end_diag = day_start_diag + timedelta(days=1)

    res = await session.execute(
        text("""
            SELECT ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng,
                   recorded_at, accuracy
            FROM gps_tracks
            WHERE user_id = :officer_id
              AND recorded_at >= :day_start
              AND recorded_at <  :day_end
            ORDER BY recorded_at ASC
        """).bindparams(officer_id=officer_id, day_start=day_start_diag, day_end=day_end_diag)
    )
    pings = res.all()

    attendance_res = await session.execute(
        text("""
            SELECT check_in_time, check_out_time
            FROM attendance
            WHERE user_id = :officer_id AND date = :target_date
        """).bindparams(officer_id=officer_id, target_date=target_date)
    )
    attendance_row = attendance_res.first()

    # --- Actual vs. theoretical delivery rate ---
    checked_in_duration_seconds: float | None = None
    expected_ping_count: int | None = None
    if attendance_row and attendance_row.check_in_time:
        check_in = attendance_row.check_in_time
        if attendance_row.check_out_time:
            end = attendance_row.check_out_time
        elif pings:
            # Shift not checked out yet - use the last actual ping as the
            # end reference rather than "now", so a diagnostic pulled
            # mid-shift doesn't count future time as "expected but
            # missing".
            end = pings[-1].recorded_at
        else:
            end = check_in
        checked_in_duration_seconds = max(0.0, (end - check_in).total_seconds())
        expected_ping_count = round(checked_in_duration_seconds / 15) if checked_in_duration_seconds else 0

    ping_count = len(pings)
    delivery_rate_pct = (
        round(ping_count / expected_ping_count * 100, 1)
        if expected_ping_count else None
    )

    # --- Accuracy distribution ---
    accuracies = [p.accuracy for p in pings if p.accuracy is not None]
    accuracy_summary = {
        "min": round(min(accuracies), 1) if accuracies else None,
        "max": round(max(accuracies), 1) if accuracies else None,
        "avg": round(sum(accuracies) / len(accuracies), 1) if accuracies else None,
    }
    low_accuracy_count = sum(1 for a in accuracies if a > 100)
    low_accuracy_pct = round(low_accuracy_count / len(accuracies) * 100, 1) if accuracies else None

    # --- Gaps against the existing two-tier thresholds, and implausible jumps ---
    largest_gap_seconds = 0.0
    gaps_exceeding_tier1 = 0
    gaps_exceeding_tier2 = 0
    suspect_jumps = []

    for prev, curr in zip(pings, pings[1:], strict=False):
        gap_seconds = (curr.recorded_at - prev.recorded_at).total_seconds()
        if gap_seconds > largest_gap_seconds:
            largest_gap_seconds = gap_seconds
        if gap_seconds > settings.location_stale_tier1_seconds:
            gaps_exceeding_tier1 += 1
        if gap_seconds > settings.location_stale_tier2_seconds:
            gaps_exceeding_tier2 += 1

        # Implausible jump: >2km apart in <60s. Both thresholds are
        # illustrative starting points for a QA tool, not tuned against
        # real device/GPS-drift behavior yet - adjust once this has
        # actually been used in the field a few times.
        if 0 <= gap_seconds < 60 and prev.lat is not None and curr.lat is not None:
            distance_m = _haversine_meters(prev.lat, prev.lng, curr.lat, curr.lng)
            if distance_m > 2000:
                suspect_jumps.append({
                    "from_recorded_at": prev.recorded_at.isoformat(),
                    "to_recorded_at": curr.recorded_at.isoformat(),
                    "distance_meters": round(distance_m, 1),
                    "time_gap_seconds": round(gap_seconds, 1),
                })

    return {
        "officer_id": str(officer_id),
        "date": date,
        "ping_count": ping_count,
        "expected_ping_count": expected_ping_count,
        "delivery_rate_pct": delivery_rate_pct,
        "checked_in_duration_seconds": (
            round(checked_in_duration_seconds) if checked_in_duration_seconds is not None else None
        ),
        "accuracy": accuracy_summary,
        "low_accuracy_count": low_accuracy_count,
        "low_accuracy_pct": low_accuracy_pct,
        "largest_gap_seconds": round(largest_gap_seconds, 1),
        "gaps_exceeding_tier1_seconds": gaps_exceeding_tier1,
        "gaps_exceeding_tier2_seconds": gaps_exceeding_tier2,
        "tier1_threshold_seconds": settings.location_stale_tier1_seconds,
        "tier2_threshold_seconds": settings.location_stale_tier2_seconds,
        "suspect_jumps": suspect_jumps,
    }


# --- Territories (geofences) and stored alerts -------------------------------

class GeofenceBody(BaseModel):
    center_lat: float = Field(ge=-90, le=90)
    center_lng: float = Field(ge=-180, le=180)
    radius_m: float = Field(ge=100, le=200000)


@router.get("/territories")
async def list_territories(
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[dict]:
    """Every territory with its geofence (null when none is set) and how
    many officers are assigned to it."""
    rows = (
        await session.execute(
            text(
                """
                SELECT t.id, t.name, t.district, t.center_lat, t.center_lng, t.radius_m,
                       (SELECT COUNT(*) FROM user_territories ut WHERE ut.territory_id = t.id) AS officers
                FROM territories t
                ORDER BY t.district, t.name
                """
            )
        )
    ).all()
    return [
        {
            "id": str(r.id),
            "name": r.name,
            "district": r.district,
            "center_lat": r.center_lat,
            "center_lng": r.center_lng,
            "radius_m": r.radius_m,
            "officers": int(r.officers),
        }
        for r in rows
    ]


@router.put("/territories/{territory_id}/geofence")
async def set_territory_geofence(
    territory_id: uuid.UUID,
    body: GeofenceBody,
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    res = await session.execute(
        text(
            "UPDATE territories SET center_lat = :lat, center_lng = :lng, radius_m = :r, "
            "updated_at = now() WHERE id = :id"
        ).bindparams(lat=body.center_lat, lng=body.center_lng, r=body.radius_m, id=territory_id)
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Territory not found")
    await session.commit()
    geofence_service.invalidate_fence_cache()
    return {"status": "ok"}


@router.delete("/territories/{territory_id}/geofence")
async def clear_territory_geofence(
    territory_id: uuid.UUID,
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    res = await session.execute(
        text(
            "UPDATE territories SET center_lat = NULL, center_lng = NULL, radius_m = NULL, "
            "updated_at = now() WHERE id = :id"
        ).bindparams(id=territory_id)
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Territory not found")
    await session.commit()
    geofence_service.invalidate_fence_cache()
    return {"status": "ok"}


@router.get("/alerts")
async def list_location_alerts(
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN, Role.MANAGER))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    date: Optional[str] = None,
) -> list[dict]:
    """Territory exits and tracking gaps for one company day (default today),
    newest first. `ended_at` is set once an officer is back inside."""
    try:
        day = datetime.strptime(date, "%Y-%m-%d").date() if date else company_today()
    except ValueError:
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")
    day_start = datetime.combine(day, time.min, tzinfo=company_tz())
    rows = (
        await session.execute(
            text(
                """
                SELECT a.id, a.user_id, u.full_name, a.alert_type, a.message,
                       a.latitude, a.longitude, a.created_at, a.ended_at
                FROM location_alerts a JOIN users u ON u.id = a.user_id
                WHERE a.created_at >= :s AND a.created_at < :e
                ORDER BY a.created_at DESC
                LIMIT 500
                """
            ).bindparams(s=day_start, e=day_start + timedelta(days=1))
        )
    ).all()
    return [
        {
            "id": str(r.id),
            "officer_id": str(r.user_id),
            "officer_name": r.full_name,
            "type": r.alert_type,
            "message": r.message,
            "latitude": r.latitude,
            "longitude": r.longitude,
            "created_at": r.created_at.isoformat(),
            "ended_at": r.ended_at.isoformat() if r.ended_at else None,
        }
        for r in rows
    ]
