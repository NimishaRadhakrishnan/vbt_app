"""
In-memory fakes for the application layer's ports.

These implement the same interfaces as the real infrastructure classes,
which is exactly what makes use cases testable without a database or Redis.
"""

from __future__ import annotations
from typing import Optional

import uuid

from app.application.interfaces.password_hasher import PasswordHasher
from app.application.interfaces.token_service import AccessTokenClaims, TokenPair, TokenService
from app.domain.entities.user import User
from app.domain.repositories.user_repository import UserRepository
from app.domain.value_objects.email import Email


class FakeUserRepository(UserRepository):
    def __init__(self) -> None:
        self._users: dict[uuid.UUID, User] = {}

    async def get_by_id(self, user_id: uuid.UUID) -> Optional[User]:
        return self._users.get(user_id)

    async def get_by_email(self, email: Email) -> Optional[User]:
        for user in self._users.values():
            if str(user.email) == str(email):
                return user
        return None

    async def add(self, user: User) -> User:
        self._users[user.id] = user
        return user

    async def update(self, user: User) -> User:
        self._users[user.id] = user
        return user

    async def exists_by_email(self, email: Email) -> bool:
        return await self.get_by_email(email) is not None

    async def get_by_employee_id(self, employee_id: str) -> Optional[User]:
        for user in self._users.values():
            if user.employee_id == employee_id:
                return user
        return None

    async def exists_by_employee_id(self, employee_id: str) -> bool:
        return await self.get_by_employee_id(employee_id) is not None

    async def list_all(self, *, limit: int = 50, offset: int = 0) -> list[User]:
        return list(self._users.values())[offset : offset + limit]


class FakePasswordHasher(PasswordHasher):
    """Reversible 'hash' for test speed/clarity — never used outside tests."""

    def hash(self, plain_password: str) -> str:
        return f"hashed::{plain_password}"

    def verify(self, plain_password: str, hashed_password: str) -> bool:
        return hashed_password == f"hashed::{plain_password}"


class FakeTokenService(TokenService):
    def __init__(self) -> None:
        self._refresh_store: dict[str, tuple[uuid.UUID, str]] = {}
        self.issued_count = 0

    async def issue_token_pair(self, user_id: uuid.UUID, role: str) -> TokenPair:
        self.issued_count += 1
        refresh = f"refresh-{self.issued_count}"
        self._refresh_store[refresh] = (user_id, role)
        return TokenPair(access_token=f"access-{user_id}", refresh_token=refresh, expires_in=900)

    async def decode_access_token(self, token: str) -> AccessTokenClaims:
        user_id_str = token.removeprefix("access-")
        return AccessTokenClaims(user_id=uuid.UUID(user_id_str), role="viewer")

    async def rotate_refresh_token(self, refresh_token: str) -> TokenPair:
        from app.domain.exceptions.domain_exceptions import InvalidTokenException

        entry = self._refresh_store.pop(refresh_token, None)
        if entry is None:
            raise InvalidTokenException("Refresh token is invalid, expired, or already used.")
        user_id, role = entry
        return await self.issue_token_pair(user_id, role)

    async def revoke_refresh_token(self, refresh_token: str) -> None:
        self._refresh_store.pop(refresh_token, None)