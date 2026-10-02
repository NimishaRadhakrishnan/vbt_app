"""Pydantic schemas for the user management endpoints."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, Field, EmailStr


class CreateUserRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: str = Field(..., min_length=1)
    role: str = Field(..., pattern="^(admin|manager|sales_officer|field_officer|dealer|farmer)$")
    employee_id: Optional[str] = None
    manager_id: Optional[uuid.UUID] = None
    device_id: Optional[str] = None


class EditUserRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=1)
    role: str = Field(..., pattern="^(admin|manager|sales_officer|field_officer|dealer|farmer)$")
    employee_id: Optional[str] = None
    manager_id: Optional[uuid.UUID] = None
    device_id: Optional[str] = None


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
