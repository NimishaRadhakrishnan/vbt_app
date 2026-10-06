"""
Application entry point / composition root.

Assembles the FastAPI app: middleware stack (order matters — outermost
first), exception handlers, and routers. This file should stay thin;
anything more than wiring belongs in a lower layer.

Middleware order (outer to inner):
  1. CORS            - must run first to handle preflight before anything else.
  2. SecurityHeaders  - stamp every response, including error responses.
  3. RequestContext   - request_id + access logging, needs to wrap everything
                        it measures/tags including exception handling.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.application.services.gps_retention import purge_old_gps
from app.core.logging_config import configure_logging
from app.infrastructure.config.settings import get_settings
from app.presentation.api.v1.router import api_v1_router
from app.presentation.api.v1.routers.location_router import sweep_stale_locations
from app.presentation.middleware.error_handler import register_exception_handlers
from app.presentation.middleware.request_context import RequestContextMiddleware
from app.presentation.middleware.security_headers import SecurityHeadersMiddleware

settings = get_settings()
configure_logging()
logger = logging.getLogger(__name__)

# Sweep interval for Tier 2 location-staleness alerts (settings.
# location_stale_tier2_seconds). 90s keeps alert latency proportionate to
# a 30-minute threshold without polling Redis/Postgres excessively.
_STALE_SWEEP_INTERVAL_SECONDS = 90


async def _stale_location_sweep_loop() -> None:
    """Runs sweep_stale_locations() on a fixed interval for the lifetime
    of the app process. A single failed iteration (e.g. a transient
    Redis/DB blip) is caught and logged rather than left to kill the
    loop silently - an unhandled exception in a bare asyncio.create_task
    just ends the task with no crash and no further sweeps, ever, which
    would be a much worse failure mode than one missed cycle.
    """
    while True:
        try:
            await sweep_stale_locations()
        except Exception:
            logger.exception("stale_location_sweep_failed")
        await asyncio.sleep(_STALE_SWEEP_INTERVAL_SECONDS)


_RETENTION_INTERVAL_SECONDS = 24 * 3600


async def _gps_retention_loop() -> None:
    """Deletes GPS history older than settings.gps_retention_days, once a day.
    First run is a minute after start-up so a restart never delays boot."""
    await asyncio.sleep(60)
    while True:
        try:
            await purge_old_gps()
        except Exception:
            logger.exception("gps_retention_failed")
        await asyncio.sleep(_RETENTION_INTERVAL_SECONDS)


_INSECURE_JWT_SECRETS = {
    "change-me-to-a-random-64-char-hex-string",
    "test-secret-key-for-unit-tests-only",
    # The development key that was committed to this repository. Anyone with
    # a copy of the history can mint a valid admin token with it, so it must
    # never be the key a deployment runs on.
    "caf02b09d4e2df9455cfb3805a8065fd0a0eca792f5ab1c0fa1c3ab649a53e18",
}


def _assert_production_config_is_safe(s) -> None:
    """Refuse to start a production deployment on development settings.

    Every one of these was live in the shipped .env at least once. A bad
    value here does not break anything visibly - the app starts, the login
    page loads, and the weakness is invisible until it is exploited - so
    failing loudly at boot is the only point where it reliably gets noticed.
    """
    if s.environment != "production":
        return

    problems: list[str] = []
    if s.debug:
        problems.append("DEBUG=true would echo every SQL statement and its parameters into the logs")
    if not s.jwt_secret_key or s.jwt_secret_key in _INSECURE_JWT_SECRETS:
        problems.append("JWT_SECRET_KEY is a known/example value - generate one with `openssl rand -hex 32`")
    if len(s.jwt_secret_key or "") < 32:
        problems.append("JWT_SECRET_KEY is shorter than 32 characters")
    if s.login_rate_limit_attempts > 10 or s.login_rate_limit_window_seconds < 60:
        problems.append(
            f"login rate limit of {s.login_rate_limit_attempts} attempts per "
            f"{s.login_rate_limit_window_seconds}s leaves passwords effectively unthrottled"
        )
    if any(o in ("*", "") for o in s.cors_allowed_origins):
        problems.append("CORS_ALLOWED_ORIGINS contains a wildcard, which is unsafe with credentials")

    if problems:
        raise RuntimeError(
            "Refusing to start in production with unsafe configuration:\n  - "
            + "\n  - ".join(problems)
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _assert_production_config_is_safe(settings)
    logger.info("application_startup", extra={"environment": settings.environment})

    # SINGLE-PROCESS ASSUMPTION - read before scaling this app.
    # This in-process loop is only correct because this app currently
    # runs as exactly one process: uvicorn is started with no --workers
    # flag (see backend/start.sh) and docker-compose defines a single
    # `backend` service with no replica count. If this ever moves to
    # multiple replicas or `--workers N`, EVERY replica would run its own
    # independent copy of this loop and each would independently detect
    # and broadcast the same Tier 2 gap - i.e. duplicate admin alerts,
    # not just duplicate work. Before scaling horizontally, this needs a
    # Redis-lock-based leader-election guard (e.g. SET NX with a TTL, only
    # the replica holding the lock runs the sweep) so exactly one replica
    # sweeps at a time. Not built now - this comment is the tripwire so
    # it isn't silently forgotten when/if that scaling happens.
    sweep_task = asyncio.create_task(_stale_location_sweep_loop())
    retention_task = asyncio.create_task(_gps_retention_loop())

    yield

    for task in (sweep_task, retention_task):
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    logger.info("application_shutdown")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs" if settings.environment != "production" else None,
        redoc_url="/redoc" if settings.environment != "production" else None,
        lifespan=lifespan,
    )

    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    # allow_origin_regex="https?://.*" used to sit alongside the allowlist.
    # Starlette treats the regex as an OR with allow_origins, and that pattern
    # matches every origin there is - so the allowlist below was decorative
    # and, with allow_credentials=True, any website a signed-in admin visited
    # could call this API with their session. The regex is gone; outside
    # production a localhost pattern keeps dev servers on arbitrary ports
    # working without reopening the door in a deployment.
    cors_kwargs: dict = {
        "allow_origins": settings.cors_allowed_origins,
        "allow_credentials": True,
        "allow_methods": ["*"],
        "allow_headers": ["*"],
    }
    if settings.environment != "production":
        cors_kwargs["allow_origin_regex"] = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
    app.add_middleware(CORSMiddleware, **cors_kwargs)

    register_exception_handlers(app)

    # Previously an unauthenticated StaticFiles mount at /static - anyone
    # with (or guessing) a UUID filename could view any uploaded file,
    # logged in or not. Replaced with an authenticated route; see
    # file_router.py for the full reasoning (token-in-query-param, since
    # browsers can't attach headers to <img>/<a> tags; role/ownership
    # check backed by the new file_uploads table).
    #
    # Registered directly on `app`, not inside api_v1_router, so it stays
    # at the same root-level path (/files/..., not /api/v1/files/...) the
    # old /static mount used - save_upload()'s returned URL
    # (public_backend_url + /files/...) depends on this staying unversioned.
    from app.presentation.api.v1.routers.file_router import router as file_router
    app.include_router(file_router)

    @app.get("/", include_in_schema=False)
    async def root_redirect():
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url="/docs")

    app.include_router(api_v1_router, prefix=settings.api_v1_prefix)

    return app


app = create_app()
