"""
Company-local date helpers.

Every "which day is this closure for?" decision must use the company's
calendar day, never the server's. A server running UTC rolls over at
5:30am IST, so an officer filing at 11pm IST would have their closure
stored against tomorrow - making today's closure look missing, and the
logout gate re-prompt them for a day they already closed.

Kept in its own module (rather than inline in each router) so there is
exactly one definition of "today" for the whole application.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.infrastructure.config.settings import get_settings


def company_tz() -> ZoneInfo:
    return ZoneInfo(get_settings().company_timezone)


def company_now() -> datetime:
    """Current time in the company's timezone."""
    return datetime.now(company_tz())


def company_today() -> date:
    """The calendar date it currently is for the company.

    This is the value that must be written to, and compared against,
    day_closures.date.
    """
    return company_now().date()


# --- Working-day rules (approved) ---
# Mon-Sat are working days; Sunday is not. Company holidays come from
# holiday_calendar, which admins maintain from their own login - the
# same table the leave calendar already uses, rather than a second
# list that could disagree with it.
#
# NOTE: general working HOURS (start/end per role/district) remain
# unconfigured and are deliberately NOT implemented here. The only time
# value this module encodes is the day-closure warning threshold, which
# was given explicitly as 17:30 company time.

SUNDAY = 6  # Python's weekday(): Monday=0 ... Sunday=6

# Approved explicitly for the 17:30 day-closure warning. Kept as a named
# constant so it is changed in one place, and so nothing infers a
# general "end of working day" from it - that is a separate, still
# unconfigured decision.
DAY_CLOSURE_WARNING_HOUR = 17
DAY_CLOSURE_WARNING_MINUTE = 30


def is_weekly_working_day(day: date) -> bool:
    """Mon-Sat true, Sunday false. Holiday check is separate because it
    needs a database lookup."""
    return day.weekday() != SUNDAY


def warning_threshold_passed(now=None) -> bool:
    """Has the company clock reached 17:30 today?

    Uses company time, never the device or server timezone - a device
    set to another zone would otherwise warn at the wrong moment, and a
    UTC server would warn 5.5 hours late.
    """
    now = now or company_now()
    return (now.hour, now.minute) >= (DAY_CLOSURE_WARNING_HOUR, DAY_CLOSURE_WARNING_MINUTE)


# --- Fixed company working hours (approved) ---
# 09:00 - 17:30 IST, Monday to Saturday.
#
# Deliberately DISTINCT from DAY_CLOSURE_WARNING_HOUR above. Those two
# happen to share 17:30 today, but they answer different questions:
# the warning asks "should we nudge this officer?", working hours ask
# "is the working day over?". Collapsing them into one constant would
# mean a future change to the nudge time silently moved the enforcement
# boundary too.
WORK_START_HOUR = 9
WORK_START_MINUTE = 0
WORK_END_HOUR = 17
WORK_END_MINUTE = 30


def is_before_working_hours(now=None) -> bool:
    now = now or company_now()
    return (now.hour, now.minute) < (WORK_START_HOUR, WORK_START_MINUTE)


def is_after_working_hours(now=None) -> bool:
    """At or after 17:30. This is the boundary day-closure enforcement
    keys off - approved as 'at or after 5:30 PM', so 17:30 exactly
    counts as after."""
    now = now or company_now()
    return (now.hour, now.minute) >= (WORK_END_HOUR, WORK_END_MINUTE)


def is_within_working_hours(now=None) -> bool:
    now = now or company_now()
    return not is_before_working_hours(now) and not is_after_working_hours(now)


async def is_company_working_day(session, day=None) -> bool:
    """Mon-Sat, excluding admin-maintained holidays.

    Async because the holiday list lives in the database - a hardcoded
    national-holiday list would go stale and would not reflect the
    company closures an admin actually declares.
    """
    from sqlalchemy import text as _text
    day = day or company_today()
    if not is_weekly_working_day(day):
        return False
    row = await session.execute(
        _text("SELECT 1 FROM holiday_calendar WHERE date = :d").bindparams(d=day)
    )
    return row.first() is None


# --- Location tracking window (approved) ---
# The officer's route is recorded and shown only from 09:00 to 18:00 company
# time, and not at all on a day of approved leave. This is the tracking
# window, kept separate from WORK_END (17:30, used by day-closure rules):
# the two answer different questions and may change independently.
TRACKING_START = time(9, 0)
TRACKING_END = time(18, 0)


def tracking_window_bounds(day: date) -> tuple[datetime, datetime]:
    """Start and end (inclusive) of the tracking window on a company day."""
    tz = company_tz()
    return (
        datetime.combine(day, TRACKING_START, tzinfo=tz),
        datetime.combine(day, TRACKING_END, tzinfo=tz),
    )


def in_tracking_window(moment: datetime | None = None) -> bool:
    """Is this moment (timezone-aware, or now) inside 09:00-18:00 company time?"""
    local = (moment or company_now()).astimezone(company_tz())
    start, end = tracking_window_bounds(local.date())
    return start <= local <= end


async def is_on_approved_leave(session, officer_id, day: date) -> bool:
    """True when the officer has an approved leave covering this company day."""
    from sqlalchemy import text as _text
    row = await session.execute(
        _text(
            "SELECT 1 FROM leave_requests WHERE officer_id = :uid AND status = 'approved' "
            "AND start_date <= :d AND end_date >= :d LIMIT 1"
        ).bindparams(uid=officer_id, d=day)
    )
    return row.first() is not None
