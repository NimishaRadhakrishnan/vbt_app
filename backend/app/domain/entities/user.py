"""
User entity representing system users and roles.
"""

from __future__ import annotations
from typing import Optional

import uuid
from dataclasses import dataclass, field
from datetime import timezone, datetime

from app.domain.value_objects.email import Email
from app.domain.value_objects.role import Role


@dataclass
class User:
    email: Email
    hashed_password: str
    full_name: str
    role: Role = field(default_factory=Role.default)
    employee_id: Optional[str] = None
    phone: Optional[str] = None
    device_id: Optional[str] = None
    biometric_token: Optional[str] = None
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    is_active: bool = True
    manager_id: Optional[uuid.UUID] = None
    last_login_at: Optional[datetime] = None
    password_changed_at: Optional[datetime] = None
    password_changed_by: Optional[uuid.UUID] = None
    failed_logins: int = 0
    last_failed_login_at: Optional[datetime] = None
    is_deleted: bool = False
    updated_by: Optional[uuid.UUID] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def deactivate(self) -> None:
        self.is_active = False
        self.updated_at = datetime.now(timezone.utc)

    def activate(self) -> None:
        self.is_active = True
        self.updated_at = datetime.now(timezone.utc)

    def change_password(self, new_hashed_password: str) -> None:
        self.hashed_password = new_hashed_password
        self.password_changed_at = datetime.now(timezone.utc)
        self.updated_at = datetime.now(timezone.utc)

    def bind_device(self, device_uuid: str) -> None:
        self.device_id = device_uuid
        self.updated_at = datetime.now(timezone.utc)

    def unbind_device(self) -> None:
        self.device_id = None
        self.updated_at = datetime.now(timezone.utc)

    def has_role(self, *roles: Role) -> bool:
        return self.role in roles

    def is_admin(self) -> bool:
        return self.role == Role.ADMIN