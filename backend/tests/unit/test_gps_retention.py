import asyncio

import pytest

from app.application.services import gps_retention as gr


class _Result:
    def __init__(self, n):
        self.rowcount = n


class _Session:
    """Each DELETE reports a scripted number of rows, per table."""
    script: dict = {}
    calls: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def execute(self, stmt, params):
        sql = str(stmt)
        table = next(t for t in ("gps_tracks", "officer_locations", "location_alerts") if f"DELETE FROM {t}" in sql)
        _Session.calls.append((table, params["cutoff"], params["batch"]))
        queue = _Session.script[table]
        return _Result(queue.pop(0) if queue else 0)

    async def commit(self):
        pass


def test_purge_deletes_in_batches_until_a_short_batch(monkeypatch):
    _Session.calls = []
    _Session.script = {"gps_tracks": [10000, 10000, 37], "officer_locations": [2], "location_alerts": []}
    monkeypatch.setattr(gr, "AsyncSessionLocal", _Session)
    counts = asyncio.run(gr.purge_old_gps(days=90))
    assert counts == {"gps_tracks": 20037, "officer_locations": 2, "location_alerts": 0}
    assert sum(1 for c in _Session.calls if c[0] == "gps_tracks") == 3


def test_cutoff_is_ninety_days_by_default(monkeypatch):
    from datetime import UTC, datetime, timedelta
    _Session.calls = []
    _Session.script = {"gps_tracks": [], "officer_locations": [], "location_alerts": []}
    monkeypatch.setattr(gr, "AsyncSessionLocal", _Session)
    asyncio.run(gr.purge_old_gps())
    cutoff = _Session.calls[0][1]
    expected = datetime.now(UTC) - timedelta(days=90)
    assert abs((cutoff - expected).total_seconds()) < 5


def test_zero_days_is_refused():
    with pytest.raises(ValueError):
        asyncio.run(gr.purge_old_gps(days=0))
