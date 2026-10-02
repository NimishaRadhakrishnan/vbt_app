"""
RegisterUser use case.
"""

from __future__ import annotations

import logging

from app.application.dto.auth_dto import RegisterUserInput, RegisterUserOutput
from app.application.interfaces.password_hasher import PasswordHasher
from app.application.use_cases.auth.password_policy import enforce_password_policy
from app.domain.entities.user import User
from app.domain.exceptions.domain_exceptions import DuplicateEntityException
from app.domain.repositories.user_repository import UserRepository
from app.domain.value_objects.email import Email
from app.domain.value_objects.role import Role

logger = logging.getLogger(__name__)


class RegisterUserUseCase:
    def __init__(self, user_repository: UserRepository, password_hasher: PasswordHasher) -> None:
        self._user_repository = user_repository
        self._password_hasher = password_hasher

    async def execute(self, data: RegisterUserInput) -> RegisterUserOutput:
        email = Email(data.email)

        if await self._user_repository.exists_by_email(email):
            raise DuplicateEntityException("User", "email", str(email))

        if data.employee_id and await self._user_repository.exists_by_employee_id(data.employee_id):
            raise DuplicateEntityException("User", "employee_id", data.employee_id)

        enforce_password_policy(data.password)
        hashed_password = self._password_hasher.hash(data.password)

        role = Role(data.role) if data.role in Role.__members__.values() or data.role in [r.value for r in Role] else Role.default()

        user = User(
            email=email,
            hashed_password=hashed_password,
            full_name=data.full_name.strip(),
            role=role,
            employee_id=data.employee_id,
            device_id=data.device_id,
        )
        created = await self._user_repository.add(user)

        logger.info(
            "user_registered",
            extra={"user_id": str(created.id), "role": created.role.value},
        )

        return RegisterUserOutput(
            user_id=created.id,
            email=str(created.email),
            full_name=created.full_name,
            role=created.role.value,
            employee_id=created.employee_id,
        )
