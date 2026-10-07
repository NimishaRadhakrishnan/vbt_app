"""Place names for GPS positions ("Perur Road, Sundarapuram, Coimbatore").

Used by the route timeline on the web and the app, which list the places an
officer stopped at the way "where is my train" lists stations.

Names come from an OpenStreetMap-compatible reverse geocoder (Nominatim by
default). Two rules keep that polite and cheap:

- every answer is cached in Redis for the GPS retention period, keyed on the
  position rounded to 4 decimals (about 11 m), so a place is looked up once
  and an officer who visits it daily never costs another request;
- lookups are spaced at least one second apart (the public service's limit)
  and a failed lookup is remembered briefly, so a service outage cannot turn
  into a flood of retries.

A position that cannot be named returns None; callers show the coordinates.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

import httpx
from redis.asyncio import Redis

logger = logging.getLogger(__name__)

_KEY = "placename:{lat}:{lng}"
_MISS_KEY = "placename_miss:{lat}:{lng}"
_MISS_TTL_SECONDS = 600
_MIN_GAP_SECONDS = 1.0

_PLACE_KEYS = ("amenity", "shop", "tourism", "office", "leisure", "building", "man_made", "historic")
_AREA_KEYS = ("suburb", "neighbourhood", "quarter", "hamlet", "village", "city_district")
_CITY_KEYS = ("city", "town", "municipality", "county", "state_district")

_lock = asyncio.Lock()
_last_call = 0.0


def _round(v: float) -> str:
    return f"{v:.4f}"


def compose_name(payload: dict) -> Optional[str]:
    """Short readable name from a Nominatim reverse-geocode response."""
    address = payload.get("address") or {}
    if not isinstance(address, dict):
        return None

    def first(keys: tuple[str, ...]) -> Optional[str]:
        for key in keys:
            value = address.get(key)
            if isinstance(value, str) and value.strip() and value.strip().lower() != "yes":
                return value.strip()
        return None

    place = payload.get("name") if isinstance(payload.get("name"), str) and payload.get("name") else None
    place = place or first(_PLACE_KEYS) or address.get("road")
    parts: list[str] = []
    for candidate in (place, first(_AREA_KEYS), first(_CITY_KEYS)):
        if candidate and candidate not in parts:
            parts.append(candidate)
    return ", ".join(parts[:3]) or None


class PlaceNameService:
    def __init__(self, redis: Redis, url: str, user_agent: str, cache_ttl_seconds: int) -> None:
        self._redis = redis
        self._url = url
        self._user_agent = user_agent
        self._ttl = cache_ttl_seconds

    async def names_for(self, points: list[tuple[float, float]]) -> list[Optional[str]]:
        """One name (or None) per point, in the same order."""
        results: dict[tuple[str, str], Optional[str]] = {}
        async with httpx.AsyncClient(timeout=4.0, headers={"User-Agent": self._user_agent}) as client:
            for lat, lng in points:
                key = (_round(lat), _round(lng))
                if key not in results:
                    results[key] = await self._one(client, lat, lng, key)
        return [results[(_round(lat), _round(lng))] for lat, lng in points]

    async def _one(self, client: httpx.AsyncClient, lat: float, lng: float, key: tuple[str, str]) -> Optional[str]:
        cache_key = _KEY.format(lat=key[0], lng=key[1])
        try:
            cached = await self._redis.get(cache_key)
            if cached:
                return cached.decode() if isinstance(cached, bytes) else str(cached)
            if await self._redis.exists(_MISS_KEY.format(lat=key[0], lng=key[1])):
                return None
        except Exception as exc:  # Redis down: still try the lookup
            logger.warning("place_name_cache_unavailable", extra={"error": str(exc)})

        name = await self._lookup(client, lat, lng)
        try:
            if name:
                await self._redis.set(cache_key, name, ex=self._ttl)
            else:
                await self._redis.set(_MISS_KEY.format(lat=key[0], lng=key[1]), "1", ex=_MISS_TTL_SECONDS)
        except Exception:
            pass
        return name

    async def _lookup(self, client: httpx.AsyncClient, lat: float, lng: float) -> Optional[str]:
        global _last_call
        async with _lock:  # one request at a time, at least a second apart
            wait = _MIN_GAP_SECONDS - (time.monotonic() - _last_call)
            if wait > 0:
                await asyncio.sleep(wait)
            _last_call = time.monotonic()
            try:
                res = await client.get(
                    self._url,
                    params={"format": "jsonv2", "lat": f"{lat:.6f}", "lon": f"{lng:.6f}", "zoom": 17, "addressdetails": 1, "accept-language": "en"},
                )
                if res.status_code != 200:
                    logger.warning("place_name_lookup_status", extra={"status": res.status_code})
                    return None
                return compose_name(res.json())
            except Exception as exc:
                logger.warning("place_name_lookup_failed", extra={"error": str(exc)})
                return None
