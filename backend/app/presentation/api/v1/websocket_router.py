"""FastAPI WebSocket router for streaming real-time alerts."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from redis.asyncio import Redis

from app.application.interfaces.token_service import TokenService
from app.core.container import get_redis, get_token_service, get_websocket_manager
from app.domain.exceptions.domain_exceptions import InvalidTokenException
from app.infrastructure.websockets.connection_manager import ConnectionManager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websockets"])


@router.websocket("/alerts")
async def websocket_alerts_endpoint(
    websocket: WebSocket,
    manager: Annotated[ConnectionManager, Depends(get_websocket_manager)],
    redis: Annotated[Redis, Depends(get_redis)],
    token_service: Annotated[TokenService, Depends(get_token_service)],
    token: str = Query(...),
) -> None:
    # This used to build the service with no arguments and call a method that
    # does not exist, so every connection ended in a 500.
    try:
        await token_service.decode_access_token(token)
    except InvalidTokenException:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket)
    pubsub = redis.pubsub()
    await pubsub.subscribe("alerts")

    async def redis_listener() -> None:
        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    data = json.loads(message["data"])
                    await websocket.send_json(data)
        except Exception as e:
            logger.error("ws_redis_listener_error", extra={"error": str(e)})

    # Listen to Redis updates concurrently
    listener_task = asyncio.create_task(redis_listener())

    try:
        while True:
            # Maintain connection, ignore client uploads
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        listener_task.cancel()
        try:
            await pubsub.unsubscribe("alerts")
            await pubsub.close()
        except Exception:
            pass
