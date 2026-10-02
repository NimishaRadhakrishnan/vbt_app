"""
DailyWorkReport domain entity.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime


@dataclass
class DailyWorkReport:
    user_id: uuid.UUID
    report_date: date
    summary: str
    attachment_url: str | None = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)
    officer_name: str | None = None  # Only populated when joining with users table
