"""
UserRepository interface (port).
"""

from __future__ import annotations
from typing import Optional

import uuid
from abc import ABC, abstractmethod

from app.domain.entities.user import User
from app.domain.value_objects.email import Email


class UserRepository(ABC):
    @abstractmethod
    async def get_by_id(self, user_id: uuid.UUID) -> Optional[User]: ...

    @abstractmethod
    async def get_by_email(self, email: Email) -> Optional[User]: ...

    @abstractmethod
    async def get_by_employee_id(self, employee_id: str) -> Optional[User]: ...

    @abstractmethod
    async def find_by_phone(self, phone: str) -> list[User]: ...

    @abstractmethod
    async def add(self, user: User) -> User: ...

    @abstractmethod
    async def update(self, user: User) -> User: ...

    @abstractmethod
    async def exists_by_email(self, email: Email) -> bool: ...

    @abstractmethod
    async def exists_by_employee_id(self, employee_id: str) -> bool: ...

    @abstractmethod
    async def list_all(self, *, limit: int = 50, offset: int = 0, include_deleted: bool = False) -> list[User]: ...