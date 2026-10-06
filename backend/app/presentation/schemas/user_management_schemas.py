"""Pydantic schemas for the user management endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional, List

import re

from pydantic import BaseModel, Field, EmailStr, field_validator


def _clean_phone(value: Optional[str]) -> Optional[str]:
    """Optional phone: spaces and dashes are dropped, 7-15 digits with an
    optional leading +. Blank means "no phone"."""
    if value is None:
        return None
    cleaned = re.sub(r"[\s\-()]", "", value)
    if not cleaned:
        return None
    if not re.fullmatch(r"\+?[0-9]{7,15}", cleaned):
        raise ValueError("Enter a valid phone number (7-15 digits).")
    return cleaned


class CreateUserRequest(BaseModel):
    # Email is no longer asked for: the Employee ID is the sign-in name. If an
    # email is still sent (older clients) it is used; otherwise the API
    # generates an internal placeholder.
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    password: str = Field(..., min_length=8)
    full_name: str = Field(..., min_length=1)
    role: str = Field(..., pattern="^(admin|manager|sales_officer|field_officer|dealer|farmer)$")
    employee_id: str = Field(..., min_length=1, max_length=50)
    manager_id: Optional[uuid.UUID] = None
    device_id: Optional[str] = None

    @field_validator("phone", mode="before")
    @classmethod
    def _phone(cls, v):
        return _clean_phone(v)

    @field_validator("employee_id", mode="before")
    @classmethod
    def _employee_id(cls, v):
        return v.strip() if isinstance(v, str) else v


class EditUserRequest(BaseModel):
    # Omitted email = keep the account's current one.
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    full_name: str = Field(..., min_length=1)
    role: str = Field(..., pattern="^(admin|manager|sales_officer|field_officer|dealer|farmer)$")
    employee_id: str = Field(..., min_length=1, max_length=50)
    manager_id: Optional[uuid.UUID] = None
    device_id: Optional[str] = None

    @field_validator("phone", mode="before")
    @classmethod
    def _phone(cls, v):
        return _clean_phone(v)

    @field_validator("employee_id", mode="before")
    @classmethod
    def _employee_id(cls, v):
        return v.strip() if isinstance(v, str) else v


class ResetPasswordRequest(BaseModel):
    password: str = Field(..., min_length=8)


class AssignUserDetailsRequest(BaseModel):
    territory_ids: List[uuid.UUID] = []
    district: Optional[str] = None
    taluk: Optional[str] = None
    village: Optional[str] = None
    manager_id: Optional[uuid.UUID] = None
    device_id: Optional[str] = None


class UpdateUserStatusRequest(BaseModel):
    is_active: bool


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    is_active: bool
    employee_id: Optional[str] = None
    phone: Optional[str] = None
    device_id: Optional[str] = None
    manager_id: Optional[uuid.UUID] = None
    last_login_at: Optional[datetime] = None
    password_changed_at: Optional[datetime] = None
    password_changed_by: Optional[uuid.UUID] = None
    password_changed_by_name: Optional[str] = None
    failed_logins: int = 0
    failed_logins_today: int = 0
    created_at: datetime
    updated_at: datetime


class UserListResponse(BaseModel):
    items: List[UserResponse]
    total: int
