"""RedisPubSubBroadcaster implementation."""

from __future__ import annotations

import json
import logging

from redis.asyncio import Redis

from app.application.interfaces.websocket_broadcaster import WebSocketBroadcaster

logger = logging.getLogger(__name__)


class RedisPubSubBroadcaster(WebSocketBroadcaster):
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def broadcast(self, channel: str, message: dict) -> None:
        try:
            payload = json.dumps(message)
            await self._redis.publish(channel, payload)
            logger.info(
                "redis_pubsub_published",
                extra={"channel": channel, "message": message},
            )
        except Exception as e:
            logger.error(
                "redis_pubsub_publish_failed",
                extra={"channel": channel, "error": str(e)},
            )
        # Fallback to local logs or other hooks can go here
