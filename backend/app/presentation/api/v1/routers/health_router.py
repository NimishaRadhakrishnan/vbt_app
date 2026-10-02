"""
Health router.

Two distinct probes, matching Kubernetes/ECS conventions:
  - /health/live:  is the process up at all (no dependency checks)?
  - /health/ready: can it actually serve traffic (DB + Redis reachable)?
Conflating these causes an app to be killed/restarted for a transient DB
blip instead of just being taken out of the load balancer's rotation, so
they're kept separate.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.container import get_redis
from app.infrastructure.database.session import get_db_session

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
async def liveness() -> dict[str, str]:
    return {"status": "alive"}


@router.get("/ready")
async def readiness(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> JSONResponse:
    checks = {"database": "unknown", "redis": "unknown"}
    healthy = True

    try:
        await session.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:
        checks["database"] = "unreachable"
        healthy = False

    try:
        await redis.ping()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "unreachable"
        healthy = False

    return JSONResponse(
        status_code=status.HTTP_200_OK if healthy else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "ready" if healthy else "not_ready", "checks": checks},
    )
