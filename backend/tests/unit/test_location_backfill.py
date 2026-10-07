from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.presentation.api.v1.routers.location_router import usable_backfill_points

NOW = datetime(2026, 10, 7, 12, 0, tzinfo=UTC)


def pt(ts):
    return SimpleNamespace(timestamp=ts)


def test_sorted_oldest_first():
    a, b, c = pt(NOW - timedelta(minutes=1)), pt(NOW - timedelta(minutes=30)), pt(NOW - timedelta(minutes=10))
    assert usable_backfill_points([a, b, c], NOW, 90) == [b, c, a]


def test_drops_future_and_too_old():
    future = pt(NOW + timedelta(hours=1))
    ancient = pt(NOW - timedelta(days=91))
    good = pt(NOW - timedelta(days=2))
    assert usable_backfill_points([future, ancient, good], NOW, 90) == [good]


def test_naive_timestamp_is_treated_as_utc():
    naive = pt(datetime(2026, 10, 7, 11, 0))
    assert usable_backfill_points([naive], NOW, 90) == [naive]


def test_small_clock_skew_is_allowed():
    assert len(usable_backfill_points([pt(NOW + timedelta(minutes=2))], NOW, 90)) == 1
