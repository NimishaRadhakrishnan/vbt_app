from app.application.services.geofence_service import (
    Fence,
    haversine_m,
    is_outside_all,
    nearest_fence,
)
import uuid

CBE = (11.0168, 76.9558)


def fence(lat, lng, r, name="Coimbatore"):
    return Fence(uuid.uuid4(), name, lat, lng, r)


def test_haversine_known_distance():
    # 0.01 degrees of latitude is about 1.11 km
    d = haversine_m(11.0, 76.0, 11.01, 76.0)
    assert 1100 < d < 1120


def test_inside_single_fence():
    assert not is_outside_all([fence(*CBE, 5000)], 11.02, 76.96)


def test_outside_single_fence():
    assert is_outside_all([fence(*CBE, 5000)], 11.2, 76.96)


def test_inside_any_of_several_fences_is_inside():
    fences = [fence(*CBE, 1000), fence(11.2, 76.96, 5000, "Erode")]
    assert not is_outside_all(fences, 11.2, 76.96)


def test_no_fences_is_never_outside():
    assert not is_outside_all([], 11.0, 76.0)


def test_nearest_fence_by_edge_distance():
    near = fence(11.03, 76.96, 500, "Near")
    far = fence(12.0, 77.0, 500, "Far")
    best, dist = nearest_fence([far, near], 11.05, 76.96)
    assert best.name == "Near"
    assert dist > 0


# --- evaluate(): alert once per excursion, close when back inside ------------
import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo

from app.application.services import geofence_service as gs

IST = ZoneInfo("Asia/Kolkata")


class FakeRedis:
    def __init__(self):
        self.d = {}

    async def incr(self, k):
        self.d[k] = int(self.d.get(k, 0)) + 1
        return self.d[k]

    async def expire(self, k, s):
        return True

    async def get(self, k):
        return self.d.get(k)

    async def set(self, k, v, ex=None):
        self.d[k] = v

    async def delete(self, k):
        self.d.pop(k, None)


class FakeSession:
    statements: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def execute(self, stmt, *a, **k):
        FakeSession.statements.append(str(stmt))

    async def commit(self):
        pass


class FakeBroadcaster:
    sent: list = []

    def __init__(self, redis):
        pass

    async def broadcast(self, channel, payload):
        FakeBroadcaster.sent.append((channel, payload))


def _setup(monkeypatch, now):
    redis = FakeRedis()
    FakeSession.statements = []
    FakeBroadcaster.sent = []
    fences = [fence(*CBE, 5000)]

    async def fake_load(_oid):
        return "Asha", fences

    monkeypatch.setattr(gs, "_load", fake_load)
    monkeypatch.setattr(gs, "get_redis_client", lambda: redis)
    monkeypatch.setattr(gs, "AsyncSessionLocal", FakeSession)
    monkeypatch.setattr(gs, "RedisPubSubBroadcaster", FakeBroadcaster)
    monkeypatch.setattr(gs, "company_now", lambda: now)
    return redis


WORK = datetime(2026, 10, 7, 11, 0, tzinfo=IST)      # Wednesday, in hours
EVENING = datetime(2026, 10, 7, 19, 0, tzinfo=IST)
SUNDAY = datetime(2026, 10, 11, 11, 0, tzinfo=IST)
OUT = (11.2, 76.96)
IN = (11.02, 76.96)


def run(coro):
    return asyncio.run(coro)


def test_alert_raised_once_after_three_outside_fixes(monkeypatch):
    _setup(monkeypatch, WORK)
    uid = uuid.uuid4()
    results = [run(gs.evaluate(uid, *OUT, 10.0)) for _ in range(5)]
    assert results == [True] * 5
    assert len(FakeBroadcaster.sent) == 1
    assert FakeBroadcaster.sent[0][1]["type"] == "territory_violation"
    assert sum("INSERT INTO location_alerts" in s for s in FakeSession.statements) == 1


def test_two_outside_fixes_do_not_alert(monkeypatch):
    _setup(monkeypatch, WORK)
    uid = uuid.uuid4()
    run(gs.evaluate(uid, *OUT, 10.0))
    run(gs.evaluate(uid, *OUT, 10.0))
    assert FakeBroadcaster.sent == []


def test_return_inside_closes_alert_and_resets(monkeypatch):
    _setup(monkeypatch, WORK)
    uid = uuid.uuid4()
    for _ in range(3):
        run(gs.evaluate(uid, *OUT, 10.0))
    assert run(gs.evaluate(uid, *IN, 10.0)) is False
    assert any("UPDATE location_alerts SET ended_at" in s for s in FakeSession.statements)
    # a new excursion alerts again
    for _ in range(3):
        run(gs.evaluate(uid, *OUT, 10.0))
    assert len(FakeBroadcaster.sent) == 2


def test_poor_accuracy_is_ignored(monkeypatch):
    _setup(monkeypatch, WORK)
    assert run(gs.evaluate(uuid.uuid4(), *OUT, 500.0)) is None


def test_not_judged_after_hours_or_on_sunday(monkeypatch):
    uid = uuid.uuid4()
    _setup(monkeypatch, EVENING)
    assert run(gs.evaluate(uid, *OUT, 10.0)) is None
    _setup(monkeypatch, SUNDAY)
    assert run(gs.evaluate(uid, *OUT, 10.0)) is None


def test_missing_coordinates_are_ignored(monkeypatch):
    _setup(monkeypatch, WORK)
    assert run(gs.evaluate(uuid.uuid4(), None, None, 10.0)) is None
