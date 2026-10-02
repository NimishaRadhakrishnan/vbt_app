from __future__ import annotations

import uuid

import pytest

from app.application.dto.auth_dto import RefreshTokenInput
from app.application.use_cases.auth.refresh_token import RefreshTokenUseCase
from app.domain.exceptions.domain_exceptions import InvalidTokenException
from tests.unit.fakes import FakeTokenService


async def test_refresh_token_rotates_and_invalidates_old_token() -> None:
    token_service = FakeTokenService()
    initial = await token_service.issue_token_pair(uuid.uuid4(), "viewer")

    use_case = RefreshTokenUseCase(token_service)
    result = await use_case.execute(RefreshTokenInput(refresh_token=initial.refresh_token))

    assert result.refresh_token != initial.refresh_token

    # Reusing the old (rotated-out) refresh token must fail.
    with pytest.raises(InvalidTokenException):
        await use_case.execute(RefreshTokenInput(refresh_token=initial.refresh_token))
