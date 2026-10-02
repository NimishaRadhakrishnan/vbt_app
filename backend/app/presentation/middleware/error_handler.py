"""
Global exception handlers.

This is the ONLY place domain exceptions get translated to HTTP status
codes. Use cases and repositories never touch FastAPI's Request/Response
types. Unhandled, unexpected exceptions are caught by the catch-all handler
and logged with full detail server-side, but the client only ever receives
a generic message + request_id — never a stack trace or internal exception
string, which would otherwise leak implementation details to an attacker.
"""

from __future__ import annotations
from typing import Optional

import logging
import re

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app.domain.exceptions.domain_exceptions import (
    BusinessRuleViolationException,
    ConflictException,
    DomainException,
    DuplicateEntityException,
    EntityNotFoundException,
    InactiveAccountException,
    InsufficientPermissionsException,
    InvalidCredentialsException,
    InvalidTokenException,
    WeakPasswordException,
)
from app.presentation.schemas.error_schemas import ErrorResponse

logger = logging.getLogger(__name__)

_EXCEPTION_STATUS_MAP: dict[type[DomainException], int] = {
    EntityNotFoundException: status.HTTP_404_NOT_FOUND,
    DuplicateEntityException: status.HTTP_409_CONFLICT,
    InvalidCredentialsException: status.HTTP_401_UNAUTHORIZED,
    InactiveAccountException: status.HTTP_403_FORBIDDEN,
    InvalidTokenException: status.HTTP_401_UNAUTHORIZED,
    InsufficientPermissionsException: status.HTTP_403_FORBIDDEN,
    WeakPasswordException: status.HTTP_422_UNPROCESSABLE_ENTITY,
    ConflictException: status.HTTP_409_CONFLICT,
    BusinessRuleViolationException: status.HTTP_400_BAD_REQUEST,
}


# Constraint name -> (status, message the user can act on).
#
# Keyed on the constraint name because that is the one stable, non-sensitive
# thing the driver reports. The driver's own message is never passed through:
# it names tables and columns, and on a unique violation it quotes the
# conflicting value, which on some of these tables is somebody's phone number.
_INTEGRITY_MESSAGES: dict[str, tuple[int, str]] = {
    "ex_price_tier_no_overlap": (
        status.HTTP_409_CONFLICT,
        "That quantity range overlaps a price band that already exists for this "
        "product. Adjust one of them so they do not share any quantity.",
    ),
    "ck_price_tier_band_ordered": (
        status.HTTP_400_BAD_REQUEST,
        "The quantity range ends before it begins. Leave the top blank for an "
        'open-ended band such as "51 and above".',
    ),
    "ck_price_tier_min_positive": (
        status.HTTP_400_BAD_REQUEST,
        "The smallest quantity in a band must be at least 1.",
    ),
    "ck_price_tier_price_positive": (
        status.HTTP_400_BAD_REQUEST,
        "A price must be greater than zero.",
    ),
    "ck_price_tier_max_headroom": (
        status.HTTP_400_BAD_REQUEST,
        "That upper quantity is too large to store. Leave the top blank for an "
        "open-ended band instead.",
    ),
    "products_name_key": (
        status.HTTP_409_CONFLICT,
        "A product with this name already exists.",
    ),
    "products_sku_code_key": (
        status.HTTP_409_CONFLICT,
        "A product with this SKU code already exists.",
    ),
    "dealers_phone_key": (
        status.HTTP_409_CONFLICT,
        "A dealer is already registered with this phone number.",
    ),
    "check_visit_target": (
        status.HTTP_400_BAD_REQUEST,
        "A visit must name either a farmer or a dealer.",
    ),
}


def _constraint_name(exc: BaseException) -> Optional[str]:
    """The constraint a database error names, if it names one.

    The name is not on the exception SQLAlchemy hands over. Its asyncpg
    dialect re-raises inside an adapter class of its own
    (``AsyncAdapt_asyncpg_dbapi.IntegrityError``) which carries only
    ``sqlstate`` and a formatted string; the real
    ``asyncpg.exceptions.ExclusionViolationError``, with
    ``constraint_name`` on it, is further down the ``__cause__`` chain. So
    walk the chain rather than reading one level and assuming.

    psycopg2 puts it on ``diag.constraint_name`` instead, which is checked at
    each level too, so this keeps working if the driver is ever swapped.

    A last resort parses the name out of the message text, because the
    alternative - a generic message where a specific one exists - is a worse
    outcome than a regex.
    """
    seen: set[int] = set()
    node: Optional[BaseException] = exc
    while node is not None and id(node) not in seen:
        seen.add(id(node))

        name = getattr(node, "constraint_name", None)
        if name:
            return str(name)
        diag = getattr(node, "diag", None)
        if diag is not None and getattr(diag, "constraint_name", None):
            return str(diag.constraint_name)

        node = getattr(node, "orig", None) or node.__cause__ or node.__context__

    match = re.search(r'constraint "([^"]+)"', str(exc))
    return match.group(1) if match else None


def _request_id(request: Request) -> Optional[str]:
    return getattr(request.state, "request_id", None)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainException)
    async def handle_domain_exception(request: Request, exc: DomainException) -> JSONResponse:
        status_code = _EXCEPTION_STATUS_MAP.get(type(exc), status.HTTP_400_BAD_REQUEST)
        return JSONResponse(
            status_code=status_code,
            content=ErrorResponse(
                code=exc.code, message=exc.message, request_id=_request_id(request)
            ).model_dump(),
        )

    @app.exception_handler(IntegrityError)
    async def handle_integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
        """A rule the database enforces, refused by the database.

        Without this, every such refusal fell through to the catch-all below
        and the user was shown "An unexpected error occurred" with a 500 - the
        same failure the sixteen bare ValueErrors used to cause. Application
        code checks these rules first so it can give a better message, but
        those checks cannot be atomic: two admins saving overlapping price
        bands a moment apart both pass their own check, and the second one is
        stopped here.

        The constraint NAME is used to pick a message. The driver's text is
        never returned: it carries table and column names, and on a unique
        violation it quotes the conflicting VALUE, which on some tables is
        somebody's phone number.
        """
        constraint = _constraint_name(exc)
        status_code, message = _INTEGRITY_MESSAGES.get(
            constraint, (None, None)
        ) or (None, None)

        if status_code is None:
            # An unrecognised constraint is still a rule, not a crash. Say so
            # generically, at 409, and log the detail for whoever investigates.
            status_code = status.HTTP_409_CONFLICT
            message = (
                "That change conflicts with data already saved. Check for a "
                "duplicate or an overlapping entry and try again."
            )
            logger.warning(
                "unmapped_integrity_error",
                extra={
                    "request_id": _request_id(request),
                    "path": request.url.path,
                    "constraint": constraint,
                },
                exc_info=exc,
            )

        return JSONResponse(
            status_code=status_code,
            content=ErrorResponse(
                code="constraint_violation",
                message=message,
                request_id=_request_id(request),
            ).model_dump(),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "unhandled_exception",
            extra={"request_id": _request_id(request), "path": request.url.path},
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorResponse(
                code="internal_server_error",
                message="An unexpected error occurred. Our team has been notified.",
                request_id=_request_id(request),
            ).model_dump(),
        )