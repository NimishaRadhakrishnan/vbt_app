"""
Rate limiting.

A fixed-window counter (Redis INCR + EXPIRE), applied as a FastAPI
dependency. A fixed window is a deliberate, simple choice over a
sliding-window/token-bucket algorithm for Phase 1 — it's sufficient to
blunt naive abuse and is trivial to reason about; it can be swapped for a
more precise algorithm later without touching callers, since each check
is exposed as its own dependency.

Two limiters exist:
- Login: keyed by client IP, since the caller isn't authenticated yet.
- Location ping: keyed by the authenticated officer's user_id rather than
  IP. /location/ping is called by every officer's phone frequently under
  normal operation (~every 15s per LocationService.ts), and IP-based
  keying would be both less accurate (multiple officers can share a NAT'd
  IP; a single officer's IP changes across cellular handoffs) and
  pointless to bypass (an attacker with a valid token can just rotate IPs,
  but can't rotate which account the token authenticates as).
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from redis.asyncio import Redis

from app.core.container import get_redis
from app.infrastructure.config.settings import Settings, get_settings
from app.presentation.api.v1.dependencies import CurrentUser


async def _enforce_fixed_window_limit(
    key: str,
    max_attempts: int,
    window_seconds: int,
    redis: Redis,
) -> None:
    current = await redis.incr(key)
    if current == 1:
        await redis.expire(key, window_seconds)

    if current > max_attempts:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later.",
        )


async def _check_without_counting(
    key: str,
    max_attempts: int,
    redis: Redis,
) -> None:
    """Refuse if the counter is already spent, without spending from it."""
    try:
        current = int(await redis.get(key) or 0)
    except Exception:
        # A rate limiter that cannot reach Redis must not take login down
        # with it. Failing open here is the lesser harm: passwords are still
        # the barrier, and a Redis outage would otherwise lock out the whole
        # field force.
        return
    if current >= max_attempts:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed sign-in attempts. Please try again in a few minutes.",
        )


async def _count_one_failure(key: str, window_seconds: int, redis: Redis) -> None:
    try:
        current = await redis.incr(key)
        if current == 1:
            await redis.expire(key, window_seconds)
    except Exception:
        return


def login_account_key(identifier: str) -> str:
    """Redis key for one account's failed-login counter."""
    return f"rate_limit:login:account:{identifier.strip().lower()}"


def client_ip_of(request) -> str:
    """The real client's address, not the proxy's.

    WHY THIS EXISTS
    ---------------
    ``request.client.host`` is the address of whatever opened the TCP
    connection. Behind Nginx that is Nginx; behind Cloudflare and Nginx it is
    still Nginx. So on any real deployment every request in the world arrives
    from ONE address, and the per-IP backstop below stops being a backstop and
    becomes a single shared bucket:

        100 failed logins from anyone, anywhere
        -> every user of the company is locked out for five minutes

    That is not a theoretical risk. With a few hundred officers mistyping
    passwords on rural phones it is a Monday morning.

    ORDER, AND WHY
    --------------
    1. ``CF-Connecting-IP`` - set by Cloudflare, and the only header there
       that a client cannot forge, because Cloudflare overwrites it.
    2. ``X-Forwarded-For``, leftmost entry - the conventional chain. Trusted
       only because Nginx is configured to rewrite it from Cloudflare's own
       ranges (see infra/nginx/nginx.conf); a request that reaches the app
       without passing through that proxy could put anything here.
    3. The socket address - correct when there is no proxy at all, e.g. a
       local run.

    A spoofed header can only ever shift an attacker into a DIFFERENT bucket,
    never out of the per-account one, which is the strict limit. The per-IP
    bucket is deliberately wide precisely because addresses are shared and
    approximate.
    """
    headers = getattr(request, "headers", {})

    cf_ip = headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()

    forwarded = headers.get("x-forwarded-for")
    if forwarded:
        # Leftmost is the original client; the rest are proxies that appended
        # themselves on the way through.
        first = forwarded.split(",")[0].strip()
        if first:
            return first

    return request.client.host if getattr(request, "client", None) else "unknown"


def login_ip_key(client_ip: str) -> str:
    return f"rate_limit:login:ip:{client_ip}"


def login_identifier(payload_email: str | None, payload_employee_id: str | None) -> str | None:
    raw = payload_email or payload_employee_id
    return raw if isinstance(raw, str) and raw.strip() else None


async def clear_login_rate_limit(identifier: str | None, redis: Redis) -> None:
    """Forget an account's failures after a correct password."""
    if not identifier:
        return
    try:
        await redis.delete(login_account_key(identifier))
    except Exception:
        # Never fail a login the password already satisfied. Worst case the
        # officer waits out the window.
        return


async def record_login_failure(
    identifier: str | None,
    client_ip: str,
    settings: Settings,
    redis: Redis,
) -> None:
    """Count one wrong password against the account and the source address."""
    window = settings.login_rate_limit_window_seconds
    if identifier:
        await _count_one_failure(login_account_key(identifier), window, redis)
    await _count_one_failure(login_ip_key(client_ip), window, redis)


async def enforce_login_rate_limit(
    request: Request,
    settings: Settings = Depends(get_settings),
    redis: Redis = Depends(get_redis),
) -> None:
    """Throttle FAILED sign-ins, per account and per source address.

    Three things had to change together.

    The counter used to increment on every attempt, so it capped sign-ins
    rather than failures: an officer who signed in correctly on the phone
    and then the web portal was spending the same budget as an attacker.

    It was keyed only on client IP, which is wrong in both directions for a
    field-force app. Too strict, because officers reach the API over mobile
    networks that NAT an entire region behind a few addresses - one
    colleague's typo would lock out the rest. Too loose, because an attacker
    guessing one officer's password just rotates source addresses and gets a
    fresh allowance each time, so the account itself was never protected.

    And an IP bucket sized for a single user throttles a whole carrier. The
    first version of this fix set it to 50 per five minutes and promptly
    throttled the test suite - the same way it would have throttled a
    district checking in at 9am.

    So: this dependency only READS the counters. Increments happen on the
    failure path in the login handler, via record_login_failure. A correct
    password costs nothing and clears the account's counter, which means
    legitimate traffic - however much of it shares one address - can never
    exhaust either bucket.
    """
    client_ip = client_ip_of(request)
    await _check_without_counting(
        login_ip_key(client_ip), settings.login_ip_rate_limit_attempts, redis
    )

    # The identifier lives in the JSON body. Starlette caches the body on the
    # request, so reading it here does not consume it before the endpoint's
    # own parsing.
    identifier: str | None = None
    try:
        body = await request.json()
        if isinstance(body, dict):
            identifier = login_identifier(body.get("email"), body.get("employee_id"))
    except Exception:
        # Malformed or empty body: request validation will produce the 422.
        # There is no account to protect yet.
        identifier = None

    if identifier:
        await _check_without_counting(
            login_account_key(identifier), settings.login_rate_limit_attempts, redis
        )


async def enforce_location_ping_rate_limit(
    current_user: CurrentUser,
    settings: Settings = Depends(get_settings),
    redis: Redis = Depends(get_redis),
) -> None:
    key = f"rate_limit:location_ping:{current_user.user_id}"
    await _enforce_fixed_window_limit(
        key,
        settings.location_ping_rate_limit_attempts,
        settings.location_ping_rate_limit_window_seconds,
        redis,
    )
