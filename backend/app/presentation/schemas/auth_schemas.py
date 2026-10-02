"""
Pydantic schemas for the auth API surface.
"""

from __future__ import annotations
from typing import Optional

import uuid

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=1, max_length=200)
    role: str = Field(default="field_officer")
    employee_id: Optional[str] = Field(default=None, max_length=50)
    device_id: Optional[str] = Field(default=None, max_length=100)


class RegisterResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    employee_id: Optional[str] = None


class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)
    email: Optional[str] = None
    employee_id: Optional[str] = None
    device_id: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshRequest(BaseModel):
    refresh_token: str


class CurrentUserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    is_active: bool
    employee_id: Optional[str] = None
    device_id: Optional[str] = None