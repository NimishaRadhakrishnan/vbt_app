"""Value objects package exports."""

from __future__ import annotations

from app.domain.value_objects.email import Email
from app.domain.value_objects.role import Role

__all__ = [
    "Email",
    "Role",
]
