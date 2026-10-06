"""Territory geofence checks for live pings.

Each territory may have a circular geofence (territories.center_lat/lng +
radius_m). An officer is "outside" when they are beyond the radius of EVERY
fenced territory assigned to them. Officers with no fenced territory are never
flagged.

Design choices that keep this free of false alarms:
  * Only judged during company working hours on working weekdays, so a phone
    at home in the evening never raises an alert.
  * A fix with accuracy worse than MAX_ACCURACY_M is ignored: a poor fix can
    jump hundreds of metres and would look like leaving the area.
  * An alert needs OUTSIDE_PINGS_REQUIRED consecutive outside fixes, and is
    raised once per excursion; coming back inside closes it.
  * Fences are cached in memory for FENCE_TTL_SECONDS so a 5-second ping rate
    costs no extra database query per ping.
"""
from __future__ import annotations

import logging
import math
import time as _time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import text

from app.infrastructure.cache.redis_client import get_redis_client
from app.infrastructure.config.company_time import (
    company_now,
    is_weekly_working_day,
    is_within_working_hours,
)
from app.infrastructure.database.session import AsyncSessionLocal
from app.infrastructure.websockets.redis_pubsub_broadcaster import RedisPubSubBroadcaster

logger = logging.getLogger(__name__)

MAX_ACCURACY_M = 100.0
OUTSIDE_PINGS_REQUIRED = 3
FENCE_TTL_SECONDS = 60.0


@dataclass(frozen=True)
class Fence:
    territory_id: uuid.UUID
    name: str
    lat: float
    lng: float
    radius_m: float


_cache: dict[str, tuple[float, str, list[Fence]]] = {}


def invalidate_fence_cache() -> None:
    """Call after a geofence or an officer's territory assignment changes."""
    _cache.clear()


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearest_fence(fences: list[Fence], lat: float, lng: float) -> tuple[Fence, float]:
    """The fence whose edge is closest, and the distance to its centre."""
    best = min(fences, key=lambda f: haversine_m(f.lat, f.lng, lat, lng) - f.radius_m)
    return best, haversine_m(best.lat, best.lng, lat, lng)


def is_outside_all(fences: list[Fence], lat: float, lng: float) -> bool:
    return bool(fences) and all(haversine_m(f.lat, f.lng, lat, lng) > f.radius_m for f in fences)


async def _load(officer_id: str) -> tuple[str, list[Fence]]:
    hit = _cache.get(officer_id)
    if hit and _time.monotonic() - hit[0] < FENCE_TTL_SECONDS:
        return hit[1], hit[2]
    async with AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT u.full_name, t.id AS tid, t.name, t.center_lat, t.center_lng, t.radius_m
                    FROM users u
                    LEFT JOIN user_territories ut ON ut.user_id = u.id
                    LEFT JOIN territories t ON t.id = ut.territory_id
                         AND t.center_lat IS NOT NULL AND t.center_lng IS NOT NULL
                         AND t.radius_m IS NOT NULL
                    WHERE u.id = :uid
                    """
                ).bindparams(uid=uuid.UUID(officer_id))
            )
        ).all()
    name = rows[0].full_name if rows else "Officer"
    fences = [
        Fence(r.tid, r.name, float(r.center_lat), float(r.center_lng), float(r.radius_m))
        for r in rows
        if r.tid is not None
    ]
    _cache[officer_id] = (_time.monotonic(), name, fences)
    return name, fences


async def evaluate(
    officer_id: uuid.UUID, lat: Optional[float], lng: Optional[float], accuracy: Optional[float]
) -> Optional[bool]:
    """Returns True when the fix is outside every assigned fence, False when
    inside one, None when it cannot be judged (no fence, off hours, no/poor
    fix). Raises an alert once an excursion is confirmed. Never raises: a
    failure here must not lose the GPS point itself."""
    try:
        if lat is None or lng is None:
            return None
        now = company_now()
        if not is_weekly_working_day(now.date()) or not is_within_working_hours(now):
            return None
        if accuracy is not None and accuracy > MAX_ACCURACY_M:
            return None

        oid = str(officer_id)
        name, fences = await _load(oid)
        if not fences:
            return None

        redis = get_redis_client()
        count_key = f"geofence_out_count:{oid}"
        alert_key = f"geofence_alert:{oid}"

        if not is_outside_all(fences, lat, lng):
            await redis.delete(count_key)
            open_alert = await redis.get(alert_key)
            if open_alert:
                alert_id = open_alert.decode() if isinstance(open_alert, bytes) else open_alert
                await redis.delete(alert_key)
                async with AsyncSessionLocal() as session:
                    await session.execute(
                        text("UPDATE location_alerts SET ended_at = :now WHERE id = :id AND ended_at IS NULL")
                        .bindparams(now=datetime.now(UTC), id=uuid.UUID(alert_id))
                    )
                    await session.commit()
            return False

        count = await redis.incr(count_key)
        await redis.expire(count_key, 600)
        if count >= OUTSIDE_PINGS_REQUIRED and not await redis.get(alert_key):
            fence, dist = nearest_fence(fences, lat, lng)
            message = (
                f"{name} has left {fence.name}: {dist / 1000:.1f} km from its centre "
                f"(allowed {fence.radius_m / 1000:.1f} km)."
            )
            alert_id = uuid.uuid4()
            async with AsyncSessionLocal() as session:
                await session.execute(
                    text(
                        """
                        INSERT INTO location_alerts
                            (id, user_id, alert_type, message, territory_id, latitude, longitude)
                        VALUES (:id, :uid, 'territory_exit', :msg, :tid, :lat, :lng)
                        """
                    ).bindparams(id=alert_id, uid=officer_id, msg=message, tid=fence.territory_id, lat=lat, lng=lng)
                )
                await session.commit()
            await redis.set(alert_key, str(alert_id), ex=12 * 3600)
            await RedisPubSubBroadcaster(redis).broadcast(
                "alerts",
                {
                    "type": "territory_violation",
                    "alert_id": str(alert_id),
                    "officer_id": oid,
                    "message": message,
                },
            )
        return True
    except Exception:
        logger.exception("geofence_evaluate_failed")
        return None
