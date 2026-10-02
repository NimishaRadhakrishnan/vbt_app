"""
Live location tracking websocket.

Section 0b requires the live/continuous location tracking VIEW to be
Admin-only (Manager too, matching the REST endpoints in
`location_router.py`: GET /location/active, /history/{officer_id},
/diagnostics/{officer_id} all gate on `require_role(Role.ADMIN,
Role.MANAGER)`). This socket is that view's data feed, so it must carry
the identical gate - otherwise the REST guard is decorative and any
authenticated Field/Sales Officer can still open this socket directly
and receive every officer's live location broadcast.

Two bugs fixed here, not just the missing role check:
1. `JWTTokenService()` was being constructed with no arguments even
   though its __init__ requires `settings` and `redis` - this would
   raise a TypeError on every connection attempt, before auth was even
   checked.
2. `token_service.verify_access_token(...)` does not exist on
   JWTTokenService (the real method is `decode_access_token`, returning
   `AccessTokenClaims(user_id, role)` - see jwt_token_service.py). So as
   written, this endpoint could not have authenticated anyone
   successfully; it would fail closed with an unhandled exception,
   not fail open. Rewritten to mirror the working pattern already used
   in `file_router.py` for the same "token as query param" websocket
   auth tradeoff.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from redis.asyncio import Redis

from app.core.container import get_redis
from app.domain.exceptions.domain_exceptions import InvalidTokenException
from app.domain.value_objects.role import Role
from app.infrastructure.cache.redis_client import get_redis_client
from app.infrastructure.config.settings import Settings, get_settings
from app.infrastructure.security.jwt_token_service import JWTTokenService
from app.infrastructure.websockets.connection_manager import ConnectionManager

router = APIRouter(prefix="/ws", tags=["websockets"])
logger = logging.getLogger(__name__)

location_ws_manager = ConnectionManager()

_ALLOWED_ROLES = {Role.ADMIN.value, Role.MANAGER.value}


@router.websocket("/locations")
async def websocket_locations(
    websocket: WebSocket,
    auth_redis: Annotated[Redis, Depends(get_redis)],
    token: str = Query(...),
):
    # --- Authenticate + authorize before accepting the connection ---
    settings: Settings = get_settings()
    token_service = JWTTokenService(settings=settings, redis=auth_redis)
    try:
        claims = await token_service.decode_access_token(token)
    except InvalidTokenException:
        await websocket.close(code=1008)
        return

    if claims.role not in _ALLOWED_ROLES:
        # Field/Sales Officers still submit their own location pings via
        # the REST endpoints elsewhere - they just don't get the "see
        # everyone's live position" feed this socket streams.
        await websocket.close(code=1008)
        return

    await location_ws_manager.connect(websocket)
    redis = get_redis_client()
    pubsub = redis.pubsub()

    try:
        await pubsub.subscribe("location_updates")

        async def read_from_ws():
            try:
                while True:
                    _ = await websocket.receive_text()
            except WebSocketDisconnect:
                pass

        async def write_to_ws():
            try:
                async for message in pubsub.listen():
                    if message["type"] == "message":
                        data = message["data"]
                        if isinstance(data, bytes):
                            data = data.decode('utf-8')
                        await websocket.send_text(data)
            except Exception as e:
                logger.error(f"Error in websocket broadcast: {e}")

        await asyncio.gather(
            read_from_ws(),
            write_to_ws()
        )

    except WebSocketDisconnect:
        location_ws_manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket location error: {e}")
        location_ws_manager.disconnect(websocket)
    finally:
        await pubsub.unsubscribe("location_updates")
