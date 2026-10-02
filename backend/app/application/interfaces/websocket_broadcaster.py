"""WebSocketBroadcaster interface."""

from __future__ import annotations

from abc import ABC, abstractmethod


class WebSocketBroadcaster(ABC):
    @abstractmethod
    async def broadcast(self, channel: str, message: dict) -> None:
        """Broadcasts a message payload to a specific pubsub channel."""
        ...
