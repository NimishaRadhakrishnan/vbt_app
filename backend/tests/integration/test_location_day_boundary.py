import re
from pathlib import Path
from datetime import UTC, datetime
from httpx import AsyncClient, ASGITransport
import pytest
from app.main import app

def test_location_router_has_no_utc_boundaries() -> None:
    # A source guard test to catch naïve date logic.
    router_paths = [
        Path("app/presentation/api/v1/routers/location_router.py"),
        Path("app/presentation/api/v1/routers/daily_visit_tracker_router.py"),
    ]
    for p in router_paths:
        source = p.read_text()
        assert "CURRENT_DATE" not in source, f"Found CURRENT_DATE in {p.name}. Use company_tz() explicitly."
        assert "NOW()::date" not in source, f"Found NOW()::date in {p.name}."
        assert "AT TIME ZONE 'UTC'" not in source, f"Found UTC timezone logic in {p.name}."
        assert "datetime.utcnow()" not in source, f"Found datetime.utcnow() in {p.name}."
        assert "date.today()" not in source, f"Found date.today() in {p.name}."

