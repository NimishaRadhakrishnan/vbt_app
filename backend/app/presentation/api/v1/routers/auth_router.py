"""
Auth router.
"""

from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Request, Response, status, HTTPException

from app.application.dto.auth_dto import (
    LoginInput,
    RefreshTokenInput,
    RegisterUserInput,
    CurrentUserOutput,
)
from app.application.interfaces.token_service import TokenService
from app.application.use_cases.auth.login_user import LoginUserUseCase
from app.application.use_cases.auth.refresh_token import RefreshTokenUseCase
from app.application.use_cases.auth.register_user import RegisterUserUseCase
from redis.asyncio import Redis

from app.core.container import (
    get_login_user_use_case,
    get_redis,
    get_refresh_token_use_case,
    get_register_user_use_case,
    get_token_service,
)
from app.domain.exceptions.domain_exceptions import (
    InactiveAccountException,
    InvalidCredentialsException,
)
from app.domain.value_objects.role import Role
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.services.emergency_override_service import is_override_active
from app.infrastructure.config.company_time import (
    company_today, is_after_working_hours, is_company_working_day,
)
from app.infrastructure.config.settings import Settings, get_settings
from app.infrastructure.database.session import get_db_session
from app.application.dto.auth_dto import CurrentUserOutput
from app.presentation.api.v1.dependencies import (
    CurrentUser, get_current_user_optional, require_role,
)
from app.presentation.middleware.rate_limiter import (
    client_ip_of,
    clear_login_rate_limit,
    enforce_login_rate_limit,
    login_identifier,
    record_login_failure,
)
from app.presentation.schemas.auth_schemas import (
    CurrentUserResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    RegisterResponse,
    TokenResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


# NOTE (Phase 1 review): an earlier version of the consolidation plan
# listed this endpoint for deletion, describing it as a self-registration
# route and "an open door". That was WRONG, and the correction is
# recorded here rather than quietly dropped: this endpoint is already
# gated on require_role(Role.ADMIN), so it has never been publicly
# reachable. Only the /register PAGE was public-looking, and that page is
# deleted.
#
# What IS true is that it duplicates POST /users in user_management_router
# - two admin-only endpoints that create a user. Collapsing them is worth
# doing, but it is a refactor with live test coverage on both sides
# (test_register_user.py, test_auth_flow.py) and no user-visible benefit,
# so it is deferred rather than rushed in alongside the stock and location
# work. See PHASE_STATUS.md.
@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    use_case: Annotated[RegisterUserUseCase, Depends(get_register_user_use_case)],
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
) -> RegisterResponse:
    result = await use_case.execute(
        RegisterUserInput(
            email=payload.email,
            password=payload.password,
            full_name=payload.full_name,
            role=payload.role,
            employee_id=payload.employee_id,
            device_id=payload.device_id,
        )
    )
    return RegisterResponse(
        id=result.user_id,
        email=result.email,
        full_name=result.full_name,
        role=result.role,
        employee_id=result.employee_id,
    )


@router.post(
    "/login",
    response_model=TokenResponse,
    dependencies=[Depends(enforce_login_rate_limit)],
)
async def login(
    payload: LoginRequest,
    request: Request,
    use_case: Annotated[LoginUserUseCase, Depends(get_login_user_use_case)],
    settings: Annotated[Settings, Depends(get_settings)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> TokenResponse:
    identifier = login_identifier(payload.email, payload.employee_id)
    # Same address the read-only check used, so the counter that gets
    # incremented is the one that gets read. See client_ip_of.
    client_ip = client_ip_of(request)
    try:
        result = await use_case.execute(
            LoginInput(
                email=payload.email,
                employee_id=payload.employee_id,
                password=payload.password,
                device_id=payload.device_id,
            )
        )
    except (InvalidCredentialsException, InactiveAccountException):
        # Only a rejected sign-in spends from the throttle. Counting every
        # attempt would have meant an officer signing in on the phone and
        # then the portal burned the same budget as an attacker - and, on a
        # NAT'd carrier network, that a whole district shared one allowance.
        await record_login_failure(identifier, client_ip, settings, redis)
        raise
    # Correct password: forget the earlier failures entirely.
    await clear_login_rate_limit(identifier, redis)
    return TokenResponse(
        access_token=result.access_token,
        refresh_token=result.refresh_token,
        token_type="bearer",
        expires_in=result.expires_in,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    payload: RefreshRequest,
    use_case: Annotated[RefreshTokenUseCase, Depends(get_refresh_token_use_case)],
) -> TokenResponse:
    result = await use_case.execute(RefreshTokenInput(refresh_token=payload.refresh_token))
    return TokenResponse(
        access_token=result.access_token,
        refresh_token=result.refresh_token,
        token_type="bearer",
        expires_in=result.expires_in,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def logout(
    payload: RefreshRequest,
    token_service: Annotated[TokenService, Depends(get_token_service)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    current_user: Annotated[Optional[CurrentUserOutput], Depends(get_current_user_optional)] = None,
) -> Response:
    """Sign out, subject to the approved day-closure rule.

    Approved behaviour:
      - before 09:00      -> logout allowed
      - 09:00 to 17:29    -> logout allowed
      - 17:30 onwards     -> a completed day closure is required
      - non-working day   -> not enforced (Sun + admin-declared holidays)
      - field/sales officers only; admin and manager exempt

    Enforced HERE, server-side, because the web and mobile gates are
    both client-side and trivially bypassed (clear storage, or call this
    endpoint directly). This is the check that actually holds.

    Honest limitation, worth stating plainly: logout is client-initiated,
    so a client that simply discards its tokens is signed out whatever
    this returns. This blocks the ordinary path and makes bypass
    deliberate rather than accidental; it is not airtight, and making it
    so would need short token TTLs plus server-side session
    invalidation.
    """
    # Only enforceable when we know who is signing out. Logout has
    # always accepted a refresh token alone, and requiring an access
    # token here would break existing clients whose access token has
    # already expired - locking them out of signing out entirely.
    if current_user is not None:
        await _enforce_day_closure_before_logout(session, current_user)
    await token_service.revoke_refresh_token(payload.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _enforce_day_closure_before_logout(session: AsyncSession, current_user) -> None:
    if current_user.role not in ("field_officer", "sales_officer"):
        return  # admin/manager exempt (approved)

    try:
        if not is_after_working_hours():
            return  # before or during working hours - approved as allowed
        if not await is_company_working_day(session):
            return  # Sunday or an admin-declared holiday

        # An admin-declared emergency suspends enforcement (approved
        # §6g). Checked BEFORE the closure lookup: during a declared
        # incident we should not be asking the database whether someone
        # complied, we should simply be letting them go.
        if await is_override_active(session, current_user.user_id, current_user.role):
            return

        today = company_today()
        row = await session.execute(
            text("""
                SELECT 1 FROM day_closures
                WHERE officer_id = :oid AND date = :d AND is_deleted = false
            """).bindparams(oid=current_user.user_id, d=today)
        )
        submitted = row.first() is not None
    except HTTPException:
        raise
    except Exception:
        # Approved fail-open on LOOKUP failure: if the database or
        # holiday check is unavailable we cannot prove a closure is
        # missing, and locking an entire field team out of signing out
        # over an infrastructure fault is worse than the bypass this
        # leaves. Distinct from a VERIFIED-missing closure below, which
        # does block.
        return

    if not submitted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Please submit your day closure before signing out. "
                "If you had no visits today, use the \"No activity today\" option."
            ),
        )


@router.get("/me", response_model=CurrentUserResponse)
async def me(current_user: CurrentUser, response: Response) -> CurrentUserResponse:
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
    response.headers["Pragma"] = "no-cache"
    return CurrentUserResponse(
        id=current_user.user_id,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role,
        is_active=current_user.is_active,
        employee_id=current_user.employee_id,
        device_id=current_user.device_id,
    )
