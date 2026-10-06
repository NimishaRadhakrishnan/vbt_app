"""
SQLAlchemyUserRepository implementation.
"""

from __future__ import annotations
from typing import Optional

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.entities.user import User
from app.domain.repositories.user_repository import UserRepository
from app.domain.value_objects.email import Email
from app.domain.value_objects.role import Role
from app.infrastructure.database.models.user_model import UserModel


class SQLAlchemyUserRepository(UserRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @staticmethod
    def _to_entity(model: UserModel) -> User:
        return User(
            id=model.id,
            email=Email(model.email),
            hashed_password=model.hashed_password,
            full_name=model.full_name,
            role=Role(model.role),
            is_active=model.is_active,
            employee_id=model.employee_id,
            phone=model.phone,
            device_id=model.device_id,
            biometric_token=model.biometric_token,
            manager_id=model.manager_id,
            last_login_at=model.last_login_at,
            password_changed_at=model.password_changed_at,
            password_changed_by=model.password_changed_by,
            failed_logins=model.failed_logins,
            last_failed_login_at=model.last_failed_login_at,
            is_deleted=model.is_deleted,
            updated_by=model.updated_by,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )

    async def get_by_id(self, user_id: uuid.UUID) -> Optional[User]:
        model = await self._session.get(UserModel, user_id)
        return self._to_entity(model) if model else None

    async def get_by_email(self, email: Email) -> Optional[User]:
        result = await self._session.execute(
            select(UserModel).where(UserModel.email == str(email))
        )
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None

    async def get_by_employee_id(self, employee_id: str) -> Optional[User]:
        result = await self._session.execute(
            select(UserModel).where(UserModel.employee_id == employee_id)
        )
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None

    async def add(self, user: User) -> User:
        model = UserModel(
            id=user.id,
            email=str(user.email),
            hashed_password=user.hashed_password,
            full_name=user.full_name,
            role=user.role.value,
            is_active=user.is_active,
            employee_id=user.employee_id,
            phone=user.phone,
            device_id=user.device_id,
            biometric_token=user.biometric_token,
            manager_id=user.manager_id,
            last_login_at=user.last_login_at,
            password_changed_at=user.password_changed_at,
            password_changed_by=user.password_changed_by,
            failed_logins=user.failed_logins,
            last_failed_login_at=user.last_failed_login_at,
            is_deleted=user.is_deleted,
        )
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def update(self, user: User) -> User:
        model = await self._session.get(UserModel, user.id)
        if model is None:
            raise ValueError(f"Cannot update non-existent user {user.id}")
        model.email = str(user.email)
        model.hashed_password = user.hashed_password
        model.full_name = user.full_name
        model.role = user.role.value
        model.is_active = user.is_active
        model.employee_id = user.employee_id
        model.phone = user.phone
        model.device_id = user.device_id
        model.biometric_token = user.biometric_token
        model.manager_id = user.manager_id
        model.last_login_at = user.last_login_at
        model.password_changed_at = user.password_changed_at
        model.password_changed_by = user.password_changed_by
        model.failed_logins = user.failed_logins
        model.last_failed_login_at = user.last_failed_login_at
        model.is_deleted = user.is_deleted
        model.updated_by = user.updated_by
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def exists_by_email(self, email: Email) -> bool:
        result = await self._session.execute(
            select(UserModel.id).where(UserModel.email == str(email))
        )
        return result.scalar_one_or_none() is not None

    async def exists_by_employee_id(self, employee_id: str) -> bool:
        result = await self._session.execute(
            select(UserModel.id).where(UserModel.employee_id == employee_id)
        )
        return result.scalar_one_or_none() is not None

    async def list_all(self, *, limit: int = 50, offset: int = 0, include_deleted: bool = False) -> list[User]:
        result = await self._session.execute(
            select(UserModel)
            .where(UserModel.is_deleted == include_deleted)  # noqa: E712
            .order_by(UserModel.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return [self._to_entity(m) for m in result.scalars().all()]