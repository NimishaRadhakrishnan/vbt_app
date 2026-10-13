"""
Role value object defining user permissions.
"""

from __future__ import annotations

from enum import Enum


class Role(str, Enum):
    ADMIN = "admin"
    MANAGER = "manager"
    FIELD_OFFICER = "field_officer"
    DEALER = "dealer"
    FARMER = "farmer"

    @classmethod
    def default(cls) -> Role:
        return cls.FIELD_OFFICER
