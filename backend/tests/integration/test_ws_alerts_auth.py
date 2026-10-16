"""The live-alerts websocket used to answer every connection with a 500."""
import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app


def test_bad_token_is_refused_cleanly_and_good_token_connects():
    with TestClient(app) as c:
        with pytest.raises(WebSocketDisconnect) as bad:
            with c.websocket_connect("/api/v1/ws/alerts?token=not-a-token"):
                pass
        assert bad.value.code == 1008

        login = c.post("/api/v1/auth/login", json={"email": "admin@vishakan.com", "password": "Password123!"})
        assert login.status_code == 200, login.text
        token = login.json()["access_token"]
        with c.websocket_connect(f"/api/v1/ws/alerts?token={token}") as ws:
            ws.send_text("ping")  # connected: no 500, no close
