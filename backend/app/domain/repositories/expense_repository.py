"""
ExpenseRepository interface.
"""

from __future__ import annotations
from typing import Optional

import uuid
from abc import ABC, abstractmethod

from app.domain.entities.expense import Expense


class ExpenseRepository(ABC):
    @abstractmethod
    async def get_by_id(self, expense_id: uuid.UUID) -> Optional[Expense]: ...

    @abstractmethod
    async def add(self, expense: Expense) -> Expense: ...

    @abstractmethod
    async def update(self, expense: Expense) -> Expense: ...

    @abstractmethod
    async def list_by_user(self, user_id: uuid.UUID, *, limit: int = 50, offset: int = 0) -> list[Expense]: ...

    @abstractmethod
    async def list_pending(self, *, limit: int = 50, offset: int = 0) -> list[Expense]: ...