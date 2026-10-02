"""
Expense domain entity.
"""

from __future__ import annotations
from typing import Optional

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime


@dataclass
class Expense:
    user_id: uuid.UUID
    date: date
    amount: float
    category: str  # fuel, lodging, food, farmer_meeting, other
    visit_id: Optional[uuid.UUID] = None
    receipt_url: Optional[str] = None
    status: str = "pending"  # pending, approved, rejected
    approved_by: Optional[uuid.UUID] = None
    comments: Optional[str] = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    created_at: datetime = field(default_factory=datetime.utcnow)

    def approve(self, manager_id: uuid.UUID, comments: Optional[str] = None) -> None:
        self.status = "approved"
        self.approved_by = manager_id
        self.comments = comments

    def reject(self, manager_id: uuid.UUID, comments: Optional[str] = None) -> None:
        self.status = "rejected"
        self.approved_by = manager_id
        self.comments = comments