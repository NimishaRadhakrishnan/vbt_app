from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.infrastructure.config.company_time import in_tracking_window, tracking_window_bounds

IST = ZoneInfo("Asia/Kolkata")


def at(h, m=0, s=0):
    return datetime(2026, 10, 8, h, m, s, tzinfo=IST)


def test_inside_the_window():
    assert in_tracking_window(at(9, 0))
    assert in_tracking_window(at(12, 30))
    assert in_tracking_window(at(18, 0))


def test_outside_the_window():
    assert not in_tracking_window(at(8, 59, 59))
    assert not in_tracking_window(at(18, 0, 1))
    assert not in_tracking_window(at(23, 0))


def test_utc_moment_is_read_in_company_time():
    utc = datetime(2026, 10, 8, 3, 30, tzinfo=ZoneInfo("UTC"))  # 09:00 IST
    assert in_tracking_window(utc)
    assert not in_tracking_window(datetime(2026, 10, 8, 2, 29, tzinfo=ZoneInfo("UTC")))


def test_bounds_are_nine_to_six():
    start, end = tracking_window_bounds(date(2026, 10, 8))
    assert (start.hour, start.minute) == (9, 0)
    assert (end.hour, end.minute) == (18, 0)
