"""FastAPI router for user management."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.interfaces.password_hasher import PasswordHasher
from app.domain.entities.user import User
from app.domain.repositories.user_repository import UserRepository
from app.domain.value_objects.email import Email
from app.domain.value_objects.role import Role
from app.core.container import get_user_repository, get_password_hasher
from app.infrastructure.database.session import get_db_session
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.presentation.schemas.user_management_schemas import (
    CreateUserRequest,
    EditUserRequest,
    ResetPasswordRequest,
    AssignUserDetailsRequest,
    UpdateUserStatusRequest,
    UserListResponse,
    UserResponse,
)

router = APIRouter(prefix="/users", tags=["user-management"])

_AdminAccess = Annotated[object, Depends(require_role(Role.ADMIN))]


import re
from zoneinfo import ZoneInfo
from datetime import datetime, timezone

def _to_response(user: User) -> UserResponse:
    failed_logins_today = 0
    if user.failed_logins > 0 and user.last_failed_login_at:
        ist = ZoneInfo("Asia/Kolkata")
        # Ensure last_failed_login_at is UTC before converting
        dt_utc = user.last_failed_login_at
        if dt_utc.tzinfo is None:
            dt_utc = dt_utc.replace(tzinfo=timezone.utc)
        if dt_utc.astimezone(ist).date() == datetime.now(timezone.utc).astimezone(ist).date():
            failed_logins_today = user.failed_logins
            
    return UserResponse(
        id=user.id,
        email=str(user.email),
        full_name=user.full_name,
        role=user.role.value,
        is_active=user.is_active,
        employee_id=user.employee_id,
        phone=user.phone,
        device_id=user.device_id,
        manager_id=user.manager_id,
        last_login_at=user.last_login_at,
        password_changed_at=user.password_changed_at,
        password_changed_by=user.password_changed_by,
        failed_logins=user.failed_logins,
        failed_logins_today=failed_logins_today,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.get("", response_model=UserListResponse)
async def list_users(
    _current_user: CurrentUser,
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    archived: bool = Query(default=False),
) -> UserListResponse:
    users = await user_repo.list_all(limit=limit, offset=offset, include_deleted=archived)
    # The repo should filter by is_deleted == archived
    return UserListResponse(
        items=[_to_response(user) for user in users],
        total=len(users),
    )


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: uuid.UUID,
    current_user: CurrentUser,
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
) -> UserResponse:
    """Single-officer detail — powers the Officer 360 profile's Overview
    tab. Self-serve for your own record; admin/manager for anyone else."""
    is_privileged = current_user.role in (Role.ADMIN.value, Role.MANAGER.value)
    if user_id != current_user.user_id and not is_privileged:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view this profile.")

    user = await user_repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return _to_response(user)


PLACEHOLDER_EMAIL_DOMAIN = "noemail.vbt.local"


async def _placeholder_email(employee_id: str, user_repo: UserRepository) -> Email:
    """users.email is NOT NULL and unique, but accounts are now created from an
    Employee ID, not an email. Give such accounts a stable internal address
    derived from the Employee ID. It is never shown or mailed."""
    slug = re.sub(r"[^a-z0-9._-]+", "-", employee_id.lower()).strip("-") or "user"
    candidate = Email(f"{slug}@{PLACEHOLDER_EMAIL_DOMAIN}")
    if await user_repo.exists_by_email(candidate):
        candidate = Email(f"{slug}-{uuid.uuid4().hex[:6]}@{PLACEHOLDER_EMAIL_DOMAIN}")
    return candidate


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: CreateUserRequest,
    _current_user: CurrentUser,
    _admin_access: _AdminAccess,
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
    hasher: Annotated[PasswordHasher, Depends(get_password_hasher)],
) -> UserResponse:
    if await user_repo.exists_by_employee_id(payload.employee_id):
        raise HTTPException(status_code=400, detail="Employee ID already registered")

    if payload.email:
        email_vo = Email(str(payload.email))
        if await user_repo.exists_by_email(email_vo):
            raise HTTPException(status_code=400, detail="Email already registered")
    else:
        email_vo = await _placeholder_email(payload.employee_id, user_repo)

    hashed_pw = hasher.hash(payload.password)
    user = User(
        email=email_vo,
        hashed_password=hashed_pw,
        full_name=payload.full_name,
        role=Role(payload.role),
        employee_id=payload.employee_id,
        phone=payload.phone,
        manager_id=payload.manager_id,
        device_id=payload.device_id,
    )
    result = await user_repo.add(user)
    return _to_response(result)


@router.put("/{user_id}", response_model=UserResponse)
async def edit_user(
    user_id: uuid.UUID,
    payload: EditUserRequest,
    _current_user: CurrentUser,
    _admin_access: _AdminAccess,
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
) -> UserResponse:
    user = await user_repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # No email in the payload = leave the account's email exactly as it is.
    if payload.email:
        email_vo = Email(str(payload.email))
        if str(user.email) != str(email_vo) and await user_repo.exists_by_email(email_vo):
            raise HTTPException(status_code=400, detail="Email already registered")
        user.email = email_vo

    if user.employee_id != payload.employee_id and await user_repo.exists_by_employee_id(payload.employee_id):
        raise HTTPException(status_code=400, detail="Employee ID already registered")

    user.full_name = payload.full_name
    user.role = Role(payload.role)
    user.employee_id = payload.employee_id
    user.phone = payload.phone
    user.manager_id = payload.manager_id
    user.device_id = payload.device_id
    user.updated_by = _current_user.user_id

    result = await user_repo.update(user)
    return _to_response(result)


@router.post("/{user_id}/reset-password", response_model=UserResponse)
async def reset_password(
    user_id: uuid.UUID,
    payload: ResetPasswordRequest,
    _current_user: CurrentUser,
    _admin_access: _AdminAccess,
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
    hasher: Annotated[PasswordHasher, Depends(get_password_hasher)],
) -> UserResponse:
    user = await user_repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.change_password(hasher.hash(payload.password)); user.password_changed_by = _current_user.user_id
    user.updated_by = _current_user.user_id
    result = await user_repo.update(user)
    return _to_response(result)


@router.post("/{user_id}/status", response_model=UserResponse)
async def update_status(
    user_id: uuid.UUID,
    payload: UpdateUserStatusRequest,
    _current_user: CurrentUser,
    _admin_access: _AdminAccess,
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
) -> UserResponse:
    user = await user_repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user_id == _current_user.user_id and not payload.is_active:
        raise HTTPException(status_code=400, detail="An administrator cannot deactivate their own account.")

    if not payload.is_active and user.role.value == "admin":
        from sqlalchemy import text
        from app.infrastructure.database.session import get_db_session
        # we can't easily inject session here, let's use user_repo to get active admins
        # Actually user_repo list_all is enough
        all_admins = await user_repo.list_all(limit=100)
        active_admins = [u for u in all_admins if u.role.value == "admin" and u.is_active and not u.is_deleted]
        if len(active_admins) <= 1:
            raise HTTPException(status_code=400, detail="Cannot disable the last active admin.")

    user.is_active = payload.is_active
    user.updated_by = _current_user.user_id
    result = await user_repo.update(user)
    return _to_response(result)


@router.post("/{user_id}/assignments", response_model=UserResponse)
async def assign_user_details(
    user_id: uuid.UUID,
    payload: AssignUserDetailsRequest,
    _current_user: CurrentUser,
    _admin_access: _AdminAccess,
    user_repo: Annotated[UserRepository, Depends(get_user_repository)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> UserResponse:
    user = await user_repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # 1. Update manager and device mapping on user
    user.manager_id = payload.manager_id
    user.device_id = payload.device_id
    user.updated_by = _current_user.user_id
    await user_repo.update(user)

    # 2. Clear existing user_territories
    await session.execute(
        text("DELETE FROM user_territories WHERE user_id = :user_id").bindparams(user_id=user_id)
    )

    # 3. Add new user_territories mappings
    for t_id in payload.territory_ids:
        await session.execute(
            text("INSERT INTO user_territories (user_id, territory_id) VALUES (:user_id, :t_id)")
            .bindparams(user_id=user_id, t_id=t_id)
        )
    await session.commit()
    return _to_response(user)
