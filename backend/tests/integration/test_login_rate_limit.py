"""Login throttling: per account, counting failures only.

Three things had to be true at once and none of them were.

The shipped defaults were 5000 attempts per 1 second - not a limit, and
they applied even with no .env present. Tightening the numbers alone was
not safe either, because the counter was keyed on client IP: officers
reach the API over carrier networks that NAT a whole region behind a
handful of addresses, so a five-attempt IP limit would have let one
officer's typo lock out every colleague on the same carrier. And a
counter that counts *all* attempts rather than failures locks out someone
who simply signs in on their phone and then the web portal.

So: a strict per-account bucket, a wide per-IP backstop, and a reset on
success.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.infrastructure.cache.redis_client import get_redis_client
from app.infrastructure.config.settings import get_settings
from app.infrastructure.database.session import AsyncSessionLocal
from app.main import app
from app.presentation.middleware.rate_limiter import login_account_key


async def _clear(identifier: str) -> None:
    redis = get_redis_client()
    await redis.delete(login_account_key(identifier))
    for ip in ("testclient", "unknown", "127.0.0.1"):
        await redis.delete(f"rate_limit:login:ip:{ip}")


async def _seeded_officer_email() -> str | None:
    async with AsyncSessionLocal() as session:
        return (
            await session.execute(
                text(
                    "SELECT email FROM users WHERE is_active = true AND is_deleted = false "
                    "ORDER BY created_at LIMIT 1"
                )
            )
        ).scalar()


def test_shipped_defaults_are_a_real_limit() -> None:
    """The values a deployment gets when nothing overrides them.

    Read from the field declarations, NOT from get_settings(). An earlier
    version of this test asserted against get_settings() and passed even
    with the old 5000-per-second defaults in place, because the local .env
    was overriding them - it was testing this machine's config file, not
    what the code ships. The dangerous case is precisely a deployment with
    no .env, or one that forgets these keys.
    """
    from app.infrastructure.config.settings import Settings

    fields = Settings.model_fields
    attempts = fields["login_rate_limit_attempts"].default
    window = fields["login_rate_limit_window_seconds"].default
    ip_attempts = fields["login_ip_rate_limit_attempts"].default

    assert attempts <= 10, f"default of {attempts} attempts is not a brute-force guard"
    assert window >= 60, f"a default {window}s window resets too fast to limit anything"
    assert ip_attempts > attempts, (
        "the per-IP backstop must default looser than the per-account limit, or officers "
        "sharing carrier NAT will lock each other out"
    )

    # And the values actually in force here, whatever the .env says.
    live = get_settings()
    assert live.login_rate_limit_attempts <= 10
    assert live.login_rate_limit_window_seconds >= 60


@pytest.mark.asyncio
async def test_wrong_passwords_lock_that_account() -> None:
    email = await _seeded_officer_email()
    if not email:
        pytest.skip("No seeded user available")
    await _clear(email)

    limit = get_settings().login_rate_limit_attempts
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        statuses = []
        for _ in range(limit + 2):
            resp = await client.post(
                "/api/v1/auth/login", json={"email": email, "password": "definitely-wrong"}
            )
            statuses.append(resp.status_code)

        assert 429 in statuses, f"never throttled after {limit + 2} wrong passwords: {statuses}"
        assert statuses[-1] == 429, statuses
        # A correct password must not rescue a locked account.
        locked = await client.post(
            "/api/v1/auth/login", json={"email": email, "password": "Password123!"}
        )
        assert locked.status_code == 429, locked.status_code

    await _clear(email)


@pytest.mark.asyncio
async def test_one_account_being_attacked_does_not_lock_another() -> None:
    """The counter is per account, not per IP.

    Both requests here come from the same client address. If the limiter
    were still IP-keyed, exhausting one account's allowance would lock the
    other one out too - which on a NAT'd carrier network means a whole
    region of officers.
    """
    victim = f"attacked-{uuid.uuid4().hex[:8]}@vishakan.com"
    bystander = await _seeded_officer_email()
    if not bystander:
        pytest.skip("No seeded user available")
    await _clear(victim)
    await _clear(bystander)

    limit = get_settings().login_rate_limit_attempts
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for _ in range(limit + 2):
            await client.post(
                "/api/v1/auth/login", json={"email": victim, "password": "wrong"}
            )
        resp = await client.post(
            "/api/v1/auth/login", json={"email": bystander, "password": "Password123!"}
        )
        assert resp.status_code == 200, (
            f"a bystander on the same IP got {resp.status_code}; the limiter is still IP-keyed"
        )

    await _clear(victim)
    await _clear(bystander)


@pytest.mark.asyncio
async def test_successful_logins_do_not_accumulate() -> None:
    """Signing in correctly many times must never lock the account."""
    email = await _seeded_officer_email()
    if not email:
        pytest.skip("No seeded user available")
    await _clear(email)

    limit = get_settings().login_rate_limit_attempts
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for attempt in range(limit + 3):
            resp = await client.post(
                "/api/v1/auth/login", json={"email": email, "password": "Password123!"}
            )
            assert resp.status_code == 200, (
                f"correct password rejected with {resp.status_code} on sign-in "
                f"{attempt + 1}; the counter is counting logins, not failures"
            )

    await _clear(email)


@pytest.mark.asyncio
async def test_a_busy_shared_address_is_never_throttled() -> None:
    """Many successful sign-ins from one address must not exhaust the IP budget.

    This is the test that the first version of the fix failed. That version
    counted every attempt against a 50-per-five-minutes IP bucket, so a run
    of ordinary sign-ins from a single address eventually 429'd - it took
    down most of this suite, and in the field it would have been a district
    of officers behind one carrier NAT at nine in the morning.

    Well past the IP allowance, from one client, all correct.
    """
    email = await _seeded_officer_email()
    if not email:
        pytest.skip("No seeded user available")
    await _clear(email)

    # Shrink both budgets rather than performing a hundred real bcrypt
    # verifications: the property under test is "a correct password costs
    # nothing", which a tiny budget demonstrates faster and more sharply
    # than a large one.
    # model_copy, not a stub: get_settings is also what the token service
    # resolves, so anything narrower breaks the parts of login that are not
    # under test here.
    tiny = get_settings().model_copy(
        update={"login_rate_limit_attempts": 2, "login_ip_rate_limit_attempts": 3}
    )
    app.dependency_overrides[get_settings] = lambda: tiny
    try:
        rounds = 12  # four times the shrunken IP budget
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            for attempt in range(rounds):
                resp = await client.post(
                    "/api/v1/auth/login", json={"email": email, "password": "Password123!"}
                )
                assert resp.status_code == 200, (
                    f"sign-in {attempt + 1} of {rounds} from one address returned "
                    f"{resp.status_code} against an IP budget of "
                    f"{tiny.login_ip_rate_limit_attempts}; successful logins are still "
                    "spending from a bucket"
                )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    await _clear(email)


# ---------------------------------------------------------------------------
# Behind a proxy
# ---------------------------------------------------------------------------

def test_the_client_ip_is_the_user_not_the_proxy() -> None:
    """The bug that would lock out the whole company on a Monday morning.

    ``request.client.host`` is whoever opened the TCP connection. Behind Nginx
    that is Nginx; behind Cloudflare and Nginx it is still Nginx. So on any
    real deployment every request in the world shares ONE per-IP bucket, and
    100 failed logins from anyone locks out every officer for five minutes.

    This is not the same test as the shared-address one above. That one proves
    the limiter counts failures rather than attempts. This one proves it can
    tell two clients apart at all once there is a proxy in front of it -
    without which the first test's guarantee is worthless in production.
    """
    from app.presentation.middleware.rate_limiter import client_ip_of

    class _Request:
        def __init__(self, headers: dict, peer: str | None = "10.0.0.5") -> None:
            self.headers = {k.lower(): v for k, v in headers.items()}
            self.client = type("C", (), {"host": peer})() if peer else None

    # Cloudflare's own header wins: it is the one a client cannot forge.
    assert client_ip_of(
        _Request({"CF-Connecting-IP": "49.207.1.9", "X-Forwarded-For": "1.2.3.4"})
    ) == "49.207.1.9"

    # Otherwise the leftmost entry of the chain - the original client.
    assert client_ip_of(
        _Request({"X-Forwarded-For": "49.207.1.9, 172.18.0.4, 10.0.0.5"})
    ) == "49.207.1.9"

    # No proxy at all: the socket address is correct.
    assert client_ip_of(_Request({})) == "10.0.0.5"

    # Nothing at all is survivable, not a crash.
    assert client_ip_of(_Request({}, peer=None)) == "unknown"

    # The failure this guards: two officers behind the same proxy must not
    # resolve to the same bucket just because the proxy is the same.
    first = client_ip_of(_Request({"CF-Connecting-IP": "49.207.1.9"}))
    second = client_ip_of(_Request({"CF-Connecting-IP": "49.207.1.10"}))
    assert first != second, (
        "two different clients collapsed to one rate-limit bucket - a single "
        "user's failures would lock out everybody else"
    )
