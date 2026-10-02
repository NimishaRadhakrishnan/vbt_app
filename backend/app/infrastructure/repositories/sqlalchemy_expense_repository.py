"""
SQLAlchemyExpenseRepository implementation.
"""

from __future__ import annotations
from typing import Optional

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.expense import Expense
from app.domain.repositories.expense_repository import ExpenseRepository
from app.infrastructure.database.models.expense_model import ExpenseModel


class SQLAlchemyExpenseRepository(ExpenseRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @staticmethod
    def _to_entity(model: ExpenseModel) -> Expense:
        return Expense(
            id=model.id,
            user_id=model.user_id,
            visit_id=model.visit_id,
            date=model.date,
            amount=float(model.amount),
            category=model.category,
            receipt_url=model.receipt_url,
            status=model.status,
            approved_by=model.approved_by,
            comments=model.comments,
            created_at=model.created_at,
        )

    async def get_by_id(self, expense_id: uuid.UUID) -> Optional[Expense]:
        model = await self._session.get(ExpenseModel, expense_id)
        return self._to_entity(model) if model else None

    async def add(self, expense: Expense) -> Expense:
        model = ExpenseModel(
            id=expense.id,
            user_id=expense.user_id,
            visit_id=expense.visit_id,
            date=expense.date,
            amount=expense.amount,
            category=expense.category,
            receipt_url=expense.receipt_url,
            status=expense.status,
            approved_by=expense.approved_by,
            comments=expense.comments,
        )
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def update(self, expense: Expense) -> Expense:
        model = await self._session.get(ExpenseModel, expense.id)
        if model is None:
            raise ValueError(f"Expense not found: {expense.id}")
        model.status = expense.status
        model.approved_by = expense.approved_by
        model.comments = expense.comments
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def list_by_user(self, user_id: uuid.UUID, *, limit: int = 50, offset: int = 0) -> list[Expense]:
        result = await self._session.execute(
            select(ExpenseModel)
            .where(ExpenseModel.user_id == user_id)
            .order_by(ExpenseModel.date.desc())
            .limit(limit)
            .offset(offset)
        )
        return [self._to_entity(m) for m in result.scalars().all()]

    async def list_pending(self, *, limit: int = 50, offset: int = 0) -> list[Expense]:
        result = await self._session.execute(
            select(ExpenseModel)
            .where(ExpenseModel.status == "pending")
            .order_by(ExpenseModel.date.desc())
            .limit(limit)
            .offset(offset)
        )
        return [self._to_entity(m) for m in result.scalars().all()]