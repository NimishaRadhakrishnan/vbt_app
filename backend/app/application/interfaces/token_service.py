"""
TokenService interface (port).

Abstracts JWT issuance/validation and refresh-token lifecycle from the use
cases that need them. The concrete implementation
(app/infrastructure/security/jwt_token_service.py) owns the actual signing
algorithm, secret, and Redis-backed revocation store.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = 0  # seconds, for the access token


@dataclass(frozen=True)
class AccessTokenClaims:
    user_id: uuid.UUID
    role: str


class TokenService(ABC):
    @abstractmethod
    async def issue_token_pair(self, user_id: uuid.UUID, role: str) -> TokenPair: ...

    @abstractmethod
    async def decode_access_token(self, token: str) -> AccessTokenClaims: ...

    @abstractmethod
    async def rotate_refresh_token(self, refresh_token: str) -> TokenPair: ...

    @abstractmethod
    async def revoke_refresh_token(self, refresh_token: str) -> None: ...
