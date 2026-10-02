"""
JWTTokenService.

Access tokens: short-lived, stateless JWTs (HS256), verified purely by
signature + expiry — no DB/Redis round trip needed on every request, which
matters once this endpoint is called for every protected route.

Refresh tokens: opaque random strings. Only their SHA-256 hash is stored in
Redis (mapped to user_id + role), with a TTL matching
`refresh_token_expire_days`. This gives us what a stateless JWT refresh
token cannot: the ability to revoke a single session (logout, "sign out
everywhere", suspected compromise) without waiting for expiry, while never
storing a token value in a state that could be replayed if the exact value
leaked from a Redis dump. Rotation-on-use is enforced: every refresh call
deletes the old key and issues a new one, so a stolen-then-used refresh
token immediately invalidates the legitimate session's copy too — a
detectable signal that something is wrong (in a later phase, this can
trigger an audit-log alert).
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import timezone, datetime, timedelta

import jwt
from jwt import PyJWTError
from redis.asyncio import Redis

from app.application.interfaces.token_service import (
    AccessTokenClaims,
    TokenPair,
    TokenService,
)
from app.domain.exceptions.domain_exceptions import InvalidTokenException
from app.infrastructure.config.settings import Settings

_REFRESH_KEY_PREFIX = "refresh_token:"


class JWTTokenService(TokenService):
    def __init__(self, settings: Settings, redis: Redis) -> None:
        self._settings = settings
        self._redis = redis

    def _create_access_token(self, user_id: uuid.UUID, role: str) -> tuple[str, int]:
        expire_seconds = self._settings.access_token_expire_minutes * 60
        now = datetime.now(timezone.utc)
        payload = {
            "sub": str(user_id),
            "role": role,
            "iat": now,
            "exp": now + timedelta(seconds=expire_seconds),
            "type": "access",
        }
        token = jwt.encode(
            payload, self._settings.jwt_secret_key, algorithm=self._settings.jwt_algorithm
        )
        return token, expire_seconds

    @staticmethod
    def _hash_refresh_token(raw_token: str) -> str:
        return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    async def issue_token_pair(self, user_id: uuid.UUID, role: str) -> TokenPair:
        access_token, expires_in = self._create_access_token(user_id, role)

        raw_refresh_token = secrets.token_urlsafe(48)
        hashed = self._hash_refresh_token(raw_refresh_token)
        ttl_seconds = self._settings.refresh_token_expire_days * 24 * 3600
        await self._redis.set(
            f"{_REFRESH_KEY_PREFIX}{hashed}",
            f"{user_id}:{role}",
            ex=ttl_seconds,
        )

        return TokenPair(
            access_token=access_token,
            refresh_token=raw_refresh_token,
            expires_in=expires_in,
        )

    async def decode_access_token(self, token: str) -> AccessTokenClaims:
        try:
            payload = jwt.decode(
                token,
                self._settings.jwt_secret_key,
                algorithms=[self._settings.jwt_algorithm],
            )
        except PyJWTError as exc:
            raise InvalidTokenException() from exc

        if payload.get("type") != "access":
            raise InvalidTokenException("Token is not an access token.")

        try:
            user_id = uuid.UUID(payload["sub"])
        except (KeyError, ValueError) as exc:
            raise InvalidTokenException() from exc

        return AccessTokenClaims(user_id=user_id, role=payload["role"])

    async def rotate_refresh_token(self, refresh_token: str) -> TokenPair:
        hashed = self._hash_refresh_token(refresh_token)
        key = f"{_REFRESH_KEY_PREFIX}{hashed}"

        stored = await self._redis.get(key)
        if stored is None:
            raise InvalidTokenException("Refresh token is invalid, expired, or already used.")

        user_id_str, role = stored.split(":", 1)
        await self._redis.delete(key)  # rotation: old token is single-use

        return await self.issue_token_pair(uuid.UUID(user_id_str), role)

    async def revoke_refresh_token(self, refresh_token: str) -> None:
        hashed = self._hash_refresh_token(refresh_token)
        await self._redis.delete(f"{_REFRESH_KEY_PREFIX}{hashed}")
