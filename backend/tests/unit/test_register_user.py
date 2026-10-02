from __future__ import annotations

import pytest

from app.application.dto.auth_dto import RegisterUserInput
from app.application.use_cases.auth.register_user import RegisterUserUseCase
from app.domain.exceptions.domain_exceptions import DuplicateEntityException, WeakPasswordException
from tests.unit.fakes import FakePasswordHasher, FakeUserRepository


@pytest.fixture
def use_case() -> RegisterUserUseCase:
    return RegisterUserUseCase(FakeUserRepository(), FakePasswordHasher())


async def test_register_user_success(use_case: RegisterUserUseCase) -> None:
    result = await use_case.execute(
        RegisterUserInput(
            email="nimisha@example.com", password="StrongPass123", full_name="Nimisha R"
        )
    )

    assert result.email == "nimisha@example.com"
    assert result.full_name == "Nimisha R"
    assert result.role == "field_officer"


async def test_register_user_duplicate_email_rejected(use_case: RegisterUserUseCase) -> None:
    data = RegisterUserInput(email="dup@example.com", password="StrongPass123", full_name="A")
    await use_case.execute(data)

    with pytest.raises(DuplicateEntityException):
        await use_case.execute(data)


@pytest.mark.parametrize(
    "weak_password",
    ["short1A", "alllowercase123", "ALLUPPERCASE123", "NoDigitsHere"],
)
async def test_register_user_rejects_weak_password(
    use_case: RegisterUserUseCase, weak_password: str
) -> None:
    with pytest.raises(WeakPasswordException):
        await use_case.execute(
            RegisterUserInput(email="weak@example.com", password=weak_password, full_name="A")
        )


async def test_register_user_rejects_invalid_email(use_case: RegisterUserUseCase) -> None:
    with pytest.raises(ValueError):
        await use_case.execute(
            RegisterUserInput(email="not-an-email", password="StrongPass123", full_name="A")
        )
