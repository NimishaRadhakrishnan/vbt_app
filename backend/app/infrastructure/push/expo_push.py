"""Send a phone push through Expo's free push service.

Dormant until the phone app registers a token (POST /kpi/me/push-token): with
no token for an officer nothing is sent. Failures are logged and never stop
the nudge job - the in-app message is always saved first.
"""
from __future__ import annotations

import logging
from typing import Sequence

import httpx

logger = logging.getLogger(__name__)
EXPO_URL = "https://exp.host/--/api/v2/push/send"


async def send_push(tokens: Sequence[str], title: str, body: str) -> int:
    tokens = [t for t in tokens if t.startswith(("ExponentPushToken[", "ExpoPushToken["))]
    if not tokens:
        return 0
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(EXPO_URL, json=[{"to": t, "title": title, "body": body, "sound": "default"} for t in tokens])
            r.raise_for_status()
        return len(tokens)
    except Exception as e:  # noqa: BLE001 - a push problem must never break the job
        logger.warning("expo_push_failed error=%s", e)
        return 0
