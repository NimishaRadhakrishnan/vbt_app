"""
Weekly Plan domain entity.
"""

from __future__ import annotations
from typing import Optional

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime


@dataclass
class WeeklyPlanActivity:
    date: date
    territory_id: uuid.UUID
    activity_type: str
    planned_villages: list[str] = field(default_factory=list)
    planned_dealers: list[str] = field(default_factory=list)
    description: Optional[str] = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)


@dataclass
class WeeklyPlanDeviation:
    date: date
    reason: str  # Rain, Farmer unavailable, Emergency, Vehicle issue, Medical, Other
    details: str
    recorded_at: datetime = field(default_factory=datetime.utcnow)
    id: uuid.UUID = field(default_factory=uuid.uuid4)


@dataclass
class WeeklyPlan:
    user_id: uuid.UUID
    week_start_date: date
    status: str = "draft"  # draft, pending, approved, rejected, needs_modification, escalated
    approved_by: Optional[uuid.UUID] = None
    approved_at: Optional[datetime] = None
    manager_comment: Optional[str] = None
    activities: list[WeeklyPlanActivity] = field(default_factory=list)
    deviations: list[WeeklyPlanDeviation] = field(default_factory=list)
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)

    def submit(self) -> None:
        self.status = "pending"
        self.updated_at = datetime.utcnow()

    def approve(self, manager_id: uuid.UUID, comment: Optional[str] = None) -> None:
        self.status = "approved"
        self.approved_by = manager_id
        self.approved_at = datetime.utcnow()
        self.manager_comment = comment
        self.updated_at = datetime.utcnow()

    def reject(self, manager_id: uuid.UUID, comment: Optional[str] = None) -> None:
        self.status = "rejected"
        self.approved_by = manager_id
        self.approved_at = datetime.utcnow()
        self.manager_comment = comment
        self.updated_at = datetime.utcnow()

    def request_modification(self, manager_id: uuid.UUID, comment: Optional[str] = None) -> None:
        self.status = "needs_modification"
        self.approved_by = manager_id
        self.approved_at = datetime.utcnow()
        self.manager_comment = comment
        self.updated_at = datetime.utcnow()

    def add_deviation(self, date_val: date, reason: str, details: str) -> None:
        deviation = WeeklyPlanDeviation(date=date_val, reason=reason, details=details)
        self.deviations.append(deviation)
        self.updated_at = datetime.utcnow()