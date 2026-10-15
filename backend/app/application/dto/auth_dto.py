"""
Data Transfer Objects for the auth use cases.
"""

from __future__ import annotations
from typing import Optional

import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class RegisterUserInput:
    email: str
    password: str
    full_name: str
    role: str = "field_officer"
    employee_id: Optional[str] = None
    device_id: Optional[str] = None
    work_mode: str = "both"


@dataclass(frozen=True)
class RegisterUserOutput:
    user_id: uuid.UUID
    email: str
    full_name: str
    role: str
    employee_id: Optional[str]


@dataclass(frozen=True)
class LoginInput:
    password: str
    employee_id: Optional[str] = None
    email: Optional[str] = None
    device_id: Optional[str] = None
    # Shown to the admin when the sign-in is held: "Samsung SM-A52, Android 13".
    device_name: Optional[str] = None
    ip_address: Optional[str] = None


@dataclass(frozen=True)
class LoginOutput:
    access_token: str
    refresh_token: str
    token_type: str
    expires_in: int


@dataclass(frozen=True)
class RefreshTokenInput:
    refresh_token: str


@dataclass(frozen=True)
class CurrentUserOutput:
    user_id: uuid.UUID
    email: str
    full_name: str
    role: str
    is_active: bool
    employee_id: Optional[str] = None
    device_id: Optional[str] = None
    work_mode: str = "both"