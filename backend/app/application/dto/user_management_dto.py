"""DTOs for user management use cases."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class UserOutput:
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime


@dataclass(frozen=True)
class ListUsersOutput:
    items: list[UserOutput]
    total: int
