"""
Redis client.

Single shared async Redis connection pool for the whole application. Used
by: the JWT refresh-token store (security/jwt_token_service.py) and the
login rate limiter (presentation/middleware/rate_limiter.py). Later phases
will also use it as a short-lived cache for MCP discovery/scan results.
"""

from __future__ import annotations

from redis.asyncio import ConnectionPool, Redis

from app.infrastructure.config.settings import get_settings

settings = get_settings()

_pool = ConnectionPool.from_url(settings.redis_url, decode_responses=True, max_connections=50)


def get_redis_client() -> Redis:
    return Redis(connection_pool=_pool)
