"""FastAPI WebSocket router for streaming real-time alerts."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from redis.asyncio import Redis

from app.core.container import get_redis, get_websocket_manager
from app.infrastructure.security.jwt_token_service import JWTTokenService
from app.infrastructure.websockets.connection_manager import ConnectionManager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websockets"])


@router.websocket("/alerts")
async def websocket_alerts_endpoint(
    websocket: WebSocket,
    manager: Annotated[ConnectionManager, Depends(get_websocket_manager)],
    redis: Annotated[Redis, Depends(get_redis)],
    token: str = Query(...),
) -> None:
    token_service = JWTTokenService()
    user_payload = await token_service.verify_access_token(token)
    if not user_payload:
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
