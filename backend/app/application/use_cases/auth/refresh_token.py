"""
RefreshToken use case.

Rotates a refresh token: the old one is invalidated and a new access/refresh
pair is issued (rotation, not reuse) so a leaked refresh token has a single
usable window before it stops working, and reuse of an already-rotated
token is a strong signal of theft that the TokenService implementation logs.
"""

from __future__ import annotations

from app.application.dto.auth_dto import LoginOutput, RefreshTokenInput
from app.application.interfaces.token_service import TokenService


class RefreshTokenUseCase:
    def __init__(self, token_service: TokenService) -> None:
        self._token_service = token_service

    async def execute(self, data: RefreshTokenInput) -> LoginOutput:
        token_pair = await self._token_service.rotate_refresh_token(data.refresh_token)
        return LoginOutput(
            access_token=token_pair.access_token,
            refresh_token=token_pair.refresh_token,
            token_type=token_pair.token_type,
            expires_in=token_pair.expires_in,
        )
