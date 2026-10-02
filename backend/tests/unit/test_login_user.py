from __future__ import annotations

import pytest

from app.application.dto.auth_dto import LoginInput, RegisterUserInput
from app.application.use_cases.auth.login_user import LoginUserUseCase
from app.application.use_cases.auth.register_user import RegisterUserUseCase
from app.domain.exceptions.domain_exceptions import (
    InactiveAccountException,
    InvalidCredentialsException,
)
from app.domain.value_objects.email import Email
from tests.unit.fakes import FakePasswordHasher, FakeTokenService, FakeUserRepository


@pytest.fixture
def repo() -> FakeUserRepository:
    return FakeUserRepository()


@pytest.fixture
def hasher() -> FakePasswordHasher:
    return FakePasswordHasher()


@pytest.fixture
def token_service() -> FakeTokenService:
    return FakeTokenService()


async def _register(repo: FakeUserRepository, hasher: FakePasswordHasher) -> None:
    await RegisterUserUseCase(repo, hasher).execute(
        RegisterUserInput(email="user@example.com", password="StrongPass123", full_name="A User")
    )


async def test_login_success_issues_tokens(
    repo: FakeUserRepository, hasher: FakePasswordHasher, token_service: FakeTokenService
) -> None:
    await _register(repo, hasher)
    use_case = LoginUserUseCase(repo, hasher, token_service)

    result = await use_case.execute(LoginInput(email="user@example.com", password="StrongPass123"))

    assert result.access_token
    assert result.refresh_token
    assert result.token_type == "bearer"


async def test_login_wrong_password_rejected(
    repo: FakeUserRepository, hasher: FakePasswordHasher, token_service: FakeTokenService
) -> None:
    await _register(repo, hasher)
    use_case = LoginUserUseCase(repo, hasher, token_service)

    with pytest.raises(InvalidCredentialsException):
        await use_case.execute(LoginInput(email="user@example.com", password="WrongPassword123"))


async def test_login_unknown_email_rejected(
    repo: FakeUserRepository, hasher: FakePasswordHasher, token_service: FakeTokenService
) -> None:
    use_case = LoginUserUseCase(repo, hasher, token_service)

    with pytest.raises(InvalidCredentialsException):
        await use_case.execute(LoginInput(email="ghost@example.com", password="Whatever123"))


async def test_login_inactive_account_rejected(
    repo: FakeUserRepository, hasher: FakePasswordHasher, token_service: FakeTokenService
) -> None:
    await _register(repo, hasher)
    user = await repo.get_by_email(Email("user@example.com"))
    assert user is not None
    user.deactivate()
    await repo.update(user)

    use_case = LoginUserUseCase(repo, hasher, token_service)
    with pytest.raises(InactiveAccountException):
        await use_case.execute(LoginInput(email="user@example.com", password="StrongPass123"))
