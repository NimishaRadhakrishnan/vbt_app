import uuid
import logging
from typing import Dict, Any

from app.infrastructure.cache.redis_client import get_redis_client
from app.infrastructure.websockets.redis_pubsub_broadcaster import RedisPubSubBroadcaster

logger = logging.getLogger(__name__)

class AlertsService:
    def __init__(self):
        self.redis = get_redis_client()
        self.broadcaster = RedisPubSubBroadcaster(self.redis)

    async def evaluate_location(self, officer_id: uuid.UUID, payload_dict: Dict[str, Any]) -> None:
        """
        Evaluate a location ping for anomalies and broadcast alerts to the dashboard.
        """
        alerts = []
        
        # 1. Battery Low
        battery = payload_dict.get('battery_pct')
        if battery is not None and battery < 15:
            alerts.append({
                "type": "battery_critical",
                "officer_id": str(officer_id),
                "message": f"Battery critically low ({battery}%)"
            })

        # 2. Mock Location
        is_mocked = payload_dict.get('is_mocked', False)
        if is_mocked:
            alerts.append({
                "type": "mock_location",
                "officer_id": str(officer_id),
                "message": "Mock location detected!"
            })

        # 3. Territory Violation (Simplified for now - assumes we have a territory check logic)
        territory_violation = payload_dict.get('territory_violation', False)
        if territory_violation:
            alerts.append({
                "type": "territory_violation",
                "officer_id": str(officer_id),
                "message": "Officer exited assigned territory."
            })

        # Broadcast all generated alerts
        for alert in alerts:
            await self.broadcaster.broadcast("alerts", alert)
