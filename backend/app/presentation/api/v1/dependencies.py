"""
Auth dependencies for protected routes.

`get_current_user` resolves the bearer token into a CurrentUserOutput DTO —
every protected router depends on this, never on decoding tokens itself.
`require_role` is a dependency factory used to gate admin-only endpoints;
later modules (e.g. Policy Evaluation, Alert acknowledgement) will reuse it
verbatim: `Depends(require_role(Role.ADMIN))`.
"""

from __future__ import annotations

from typing import Annotated, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.application.dto.auth_dto import CurrentUserOutput
from app.application.use_cases.auth.get_current_user import GetCurrentUserUseCase
from app.core.container import get_current_user_use_case
from app.domain.exceptions.domain_exceptions import InsufficientPermissionsException
from app.domain.value_objects.role import Role

# auto_error=False, deliberately.
#
# FastAPI's HTTPBearer(auto_error=True) answers a MISSING Authorization
# header with 403, not 401. That is the wrong code - 401 means "you are not
# authenticated", 403 means "you are, and still may not" - and it had a real
# cost: the web client refreshes its access token only on a 401, so after a
# page reload GET /auth/me returned 403, the refresh never fired, and the
# admin was bounced to the login screen on every refresh or bookmarked link.
#
# Raising 401 ourselves restores the correct semantics and the silent
# re-authentication that depends on it.
_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    use_case: Annotated[GetCurrentUserUseCase, Depends(get_current_user_use_case)],
    credentials: Annotated[
        Optional[HTTPAuthorizationCredentials], Depends(_bearer_scheme)
    ] = None,
) -> CurrentUserOutput:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await use_case.execute(credentials.credentials)


CurrentUser = Annotated[CurrentUserOutput, Depends(get_current_user)]


def require_role(*allowed_roles: Role):
    async def _guard(current_user: CurrentUser) -> CurrentUserOutput:
        if current_user.role not in [r.value for r in allowed_roles]:
            raise InsufficientPermissionsException(required_role=f"Wanted {allowed_roles[0].value}, got {current_user.role}")
        return current_user

    return _guard


async def get_current_user_optional(
    use_case: Annotated[GetCurrentUserUseCase, Depends(get_current_user_use_case)],
    credentials: Annotated[
        Optional[HTTPAuthorizationCredentials], Depends(HTTPBearer(auto_error=False))
    ] = None,
) -> Optional[CurrentUserOutput]:
    """Identify the caller if a valid bearer token is present, else None.

    Added for POST /auth/logout, which must keep working when the access
    token has already expired - logout has always accepted a refresh
    token on its own, and requiring a live access token would lock a
    user out of signing out entirely. The day-closure rule is enforced
    when the identity IS known and skipped when it is not.

    auto_error=False is the key difference from _bearer_scheme: a
    missing header yields None instead of a 401.
    """
    if credentials is None:
        return None
    try:
        return await use_case.execute(credentials.credentials)
    except Exception:
        return None
