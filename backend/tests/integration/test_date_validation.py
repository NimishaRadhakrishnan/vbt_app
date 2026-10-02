import uuid
import jwt
from datetime import datetime, timezone, timedelta
from app.infrastructure.config.settings import Settings

def get_token(user_id: uuid.UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "role": "field_officer", "type": "access", "iat": now, "exp": now + timedelta(days=1)}
    return jwt.encode(payload, Settings().jwt_secret_key, algorithm="HS256")

import pytest
from datetime import date, timedelta
from app.presentation.schemas.date_validators import validate_not_past, validate_current_week_or_later, get_today_ist


from httpx import AsyncClient, ASGITransport
from app.main import app

@pytest.fixture
async def clients():
    transport = ASGITransport(app=app)
    client = AsyncClient(transport=transport, base_url="http://test")
    yield client
    await client.aclose()

@pytest.fixture
async def fo_token(clients):
    res = await clients.post("/api/v1/auth/login", json={"email": "dinesh@vishakan.com", "password": "Password123!"})
    if res.status_code == 200:
        return res.json()["access_token"]
    pytest.skip("Could not log in as dinesh for test")


def test_yesterday_rejected():
    yesterday = get_today_ist() - timedelta(days=1)
    with pytest.raises(ValueError, match="Date cannot be in the past"):
        validate_not_past(yesterday)

def test_today_accepted():
    today = get_today_ist()
    assert validate_not_past(today) == today

def test_tomorrow_accepted():
    tomorrow = get_today_ist() + timedelta(days=1)
    assert validate_not_past(tomorrow) == tomorrow

def test_frozen_at_0030_ist(monkeypatch):
    import zoneinfo
    from datetime import datetime, timezone
    
    real_datetime = datetime
    frozen_utc = real_datetime(2026, 9, 23, 19, 0, tzinfo=timezone.utc)  # = 00:30 IST on the 24th
    
    class MockDatetime(real_datetime):
        @classmethod
        def now(cls, tz=None):
            return frozen_utc.astimezone(tz) if tz else frozen_utc
            
    monkeypatch.setattr("app.presentation.schemas.date_validators.datetime", MockDatetime)
    
    test_date = date(2026, 9, 24)
    assert get_today_ist() == test_date
    assert validate_not_past(test_date) == test_date

@pytest.mark.asyncio
async def test_retrospective_endpoint_accepts_past(clients, fo_token):
    past_date = (get_today_ist() - timedelta(days=30)).isoformat()
    res = await clients.post(
        "/api/v1/day-closure",
        json={
            "date": past_date,
            "status": "completed",
            "distance_travelled_km": 10.0,
            "transport_mode": "bike",
            "start_time": "09:00:00",
            "end_time": "18:00:00"
        },
        headers={"Authorization": f"Bearer {fo_token}"}
    )
    assert res.status_code != 401
    if res.status_code == 422:
        assert not any(err.get("loc") == ["body", "date"] for err in res.json().get("detail", [])), "Date field failed validation in retrospective endpoint"

def test_current_week_plan_editable_on_thursday(monkeypatch):
    import zoneinfo
    from datetime import datetime, timezone
    
    real_datetime = datetime
    frozen_utc = real_datetime(2026, 9, 24, 6, 30, tzinfo=timezone.utc)  # 12:00 IST on Thursday 2026-09-24
    
    class MockDatetime(real_datetime):
        @classmethod
        def now(cls, tz=None):
            return frozen_utc.astimezone(tz) if tz else frozen_utc
            
    monkeypatch.setattr("app.presentation.schemas.date_validators.datetime", MockDatetime)
    
    monday = date(2026, 9, 21)
    assert validate_current_week_or_later(monday) == monday
    
    sunday = date(2026, 9, 20)
    with pytest.raises(ValueError, match="Date cannot be before the start of the current week"):
        validate_current_week_or_later(sunday)