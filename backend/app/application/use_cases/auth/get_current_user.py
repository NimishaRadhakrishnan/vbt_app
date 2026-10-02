"""
GetCurrentUser use case.
"""

from __future__ import annotations

from app.application.dto.auth_dto import CurrentUserOutput
from app.application.interfaces.token_service import TokenService
from app.domain.exceptions.domain_exceptions import (
    InactiveAccountException,
    InvalidTokenException,
)
from app.domain.repositories.user_repository import UserRepository


class GetCurrentUserUseCase:
    def __init__(self, user_repository: UserRepository, token_service: TokenService) -> None:
        self._user_repository = user_repository
        self._token_service = token_service

    async def execute(self, access_token: str) -> CurrentUserOutput:
        claims = await self._token_service.decode_access_token(access_token)

        user = await self._user_repository.get_by_id(claims.user_id)
        if user is None:
            raise InvalidTokenException("Token refers to a user that no longer exists.")
        if not user.is_active:
            raise InactiveAccountException()

        return CurrentUserOutput(
            user_id=user.id,
            email=str(user.email),
            full_name=user.full_name,
            role=user.role.value,
            is_active=user.is_active,
            employee_id=user.employee_id,
            device_id=user.device_id,
        )
