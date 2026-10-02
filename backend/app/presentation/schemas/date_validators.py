from datetime import date, datetime, timedelta
from typing import Any
from app.infrastructure.config.company_time import company_tz

def get_today_ist() -> date:
    return datetime.now(company_tz()).date()

def validate_not_past(v: date | None) -> date | None:
    if v is None:
        return v
    if v < get_today_ist():
        raise ValueError("Date cannot be in the past")
    return v

def validate_current_week_or_later(v: date | None) -> date | None:
    if v is None:
        return v
    today = get_today_ist()
    start_of_week = today - timedelta(days=today.weekday())
    if v < start_of_week:
        raise ValueError("Date cannot be before the start of the current week")
    return v
