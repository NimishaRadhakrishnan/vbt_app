"""
DailyWorkReportRepository interface.
"""

from __future__ import annotations

import abc
import uuid
from datetime import date
from typing import Optional

from app.domain.entities.daily_work_report import DailyWorkReport


class DailyWorkReportRepository(abc.ABC):
    @abc.abstractmethod
    async def add(self, report: DailyWorkReport) -> DailyWorkReport:
        pass

    @abc.abstractmethod
    async def get_by_user_and_date(self, user_id: uuid.UUID, report_date: date) -> Optional[DailyWorkReport]:
        pass

    @abc.abstractmethod
    async def list_reports(
        self,
        user_id: Optional[uuid.UUID] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[DailyWorkReport]:
        pass
