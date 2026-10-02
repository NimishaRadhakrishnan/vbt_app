"""Redis-backed location cache for high-frequency active pings."""
import json
import logging
from typing import Optional, Dict, Any

from redis.asyncio import Redis

logger = logging.getLogger(__name__)

class LocationCache:
    def __init__(self, redis: Redis):
        self._redis = redis
        self._prefix = "officer_location:"
        self._stale_alert_prefix = "officer_stale_alerted:"

    async def set_active_location(self, officer_id: str, data: Dict[str, Any], ttl: int = 600) -> None:
        """Stores the officer's latest location. Caller supplies ttl -
        see settings.location_cache_ttl_seconds for why this must outlive
        the Tier 2 staleness threshold, not just be a round number."""
        key = f"{self._prefix}{officer_id}"
        try:
            await self._redis.set(key, json.dumps(data), ex=ttl)
        except Exception as e:
            logger.error(f"Failed to set location cache for {officer_id}: {e}")

    async def get_active_location(self, officer_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves the officer's latest location."""
        key = f"{self._prefix}{officer_id}"
        try:
            data = await self._redis.get(key)
            if data:
                return json.loads(data)
        except Exception as e:
            logger.error(f"Failed to get location cache for {officer_id}: {e}")
        return None

    async def get_all_active_locations(self, officer_ids: list[str]) -> Dict[str, Dict[str, Any]]:
        """Retrieves latest locations for a batch of officers."""
        if not officer_ids:
            return {}
        
        keys = [f"{self._prefix}{uid}" for uid in officer_ids]
        result = {}
        try:
            values = await self._redis.mget(keys)
            for uid, val in zip(officer_ids, values):
                if val:
                    result[uid] = json.loads(val)
        except Exception as e:
            logger.error(f"Failed to mget location cache: {e}")
        return result

    # --- Tier 2 stale-alert dedup ---
    # A single ongoing gap shouldn't re-fire the admin alert every sweep
    # tick (e.g. a 2-hour outage swept every 90s would otherwise send ~80
    # duplicate alerts). This is deliberately a single boolean per
    # officer, not the fuller per-day occurrence-counting state a
    # repeated-pattern model (deferred, not built) would need - it only
    # answers "have I already alerted for the officer's *current* gap",
    # cleared the moment they ping again.

    async def mark_stale_alert_sent(self, officer_id: str, ttl: int = 86400) -> None:
        """Flags that a Tier 2 alert has already fired for this officer's
        current gap, so the sweep loop doesn't re-alert every tick. TTL
        is a safety net only (so a key can't leak forever if a ping
        never arrives to clear it) - normal clearing happens via
        clear_stale_alert() on the next successful ping."""
        key = f"{self._stale_alert_prefix}{officer_id}"
        try:
            await self._redis.set(key, "1", ex=ttl)
        except Exception as e:
            logger.error(f"Failed to set stale-alert flag for {officer_id}: {e}")

    async def has_stale_alert_been_sent(self, officer_id: str) -> bool:
        key = f"{self._stale_alert_prefix}{officer_id}"
        try:
            return bool(await self._redis.exists(key))
        except Exception as e:
            logger.error(f"Failed to check stale-alert flag for {officer_id}: {e}")
            return False

    async def clear_stale_alert(self, officer_id: str) -> None:
        """Called on every successful ping - a fresh ping means the gap
        that triggered the last alert (if any) is over, so the next gap
        should be able to alert again rather than staying suppressed."""
        key = f"{self._stale_alert_prefix}{officer_id}"
        try:
            await self._redis.delete(key)
        except Exception as e:
            logger.error(f"Failed to clear stale-alert flag for {officer_id}: {e}")
