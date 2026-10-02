"""CORS origins, and the guard that stops unsafe settings reaching production.

Both of these were wrong in a way nothing visible would have caught: the
app started, the login page loaded, and the weakness sat there silently.

The CORS middleware was configured with an allowlist AND
`allow_origin_regex="https?://.*"`. Starlette ORs the two, and that
pattern matches every origin there is, so the allowlist did nothing.
Combined with `allow_credentials=True`, any page a signed-in admin
visited could call this API with their session.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import _assert_production_config_is_safe, app


def _allowed_origin_for(client: TestClient, origin: str) -> str | None:
    resp = client.options(
        "/api/v1/health/live",
        headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
    )
    return resp.headers.get("access-control-allow-origin")


def test_arbitrary_origins_are_not_allowed() -> None:
    client = TestClient(app)
    assert _allowed_origin_for(client, "https://evil.example.com") is None, (
        "an unlisted origin was allowed - check that allow_origin_regex has not "
        "been reintroduced; a catch-all regex silently overrides the allowlist"
    )


def test_configured_origin_is_allowed() -> None:
    client = TestClient(app)
    assert _allowed_origin_for(client, "http://localhost:3000") == "http://localhost:3000"


class _Cfg:
    """Minimal stand-in for Settings - the guard only reads these."""

    def __init__(self, **kw):
        self.environment = kw.get("environment", "production")
        self.debug = kw.get("debug", False)
        self.jwt_secret_key = kw.get("jwt_secret_key", "a" * 64)
        self.login_rate_limit_attempts = kw.get("login_rate_limit_attempts", 5)
        self.login_rate_limit_window_seconds = kw.get("login_rate_limit_window_seconds", 300)
        self.cors_allowed_origins = kw.get(
            "cors_allowed_origins", ["https://portal.vishakanbiotech.com"]
        )


def test_guard_allows_a_correct_production_config() -> None:
    _assert_production_config_is_safe(_Cfg())


def test_guard_never_blocks_development() -> None:
    """Developers keep DEBUG on and a throwaway key; that is fine."""
    _assert_production_config_is_safe(
        _Cfg(environment="development", debug=True, jwt_secret_key="change-me-to-a-random-64-char-hex-string")
    )


@pytest.mark.parametrize(
    "bad, expected_phrase",
    [
        ({"debug": True}, "DEBUG=true"),
        (
            {"jwt_secret_key": "caf02b09d4e2df9455cfb3805a8065fd0a0eca792f5ab1c0fa1c3ab649a53e18"},
            "JWT_SECRET_KEY",
        ),
        ({"jwt_secret_key": "short"}, "JWT_SECRET_KEY"),
        ({"login_rate_limit_attempts": 5000, "login_rate_limit_window_seconds": 1}, "rate limit"),
        ({"cors_allowed_origins": ["*"]}, "wildcard"),
    ],
)
def test_guard_refuses_each_unsafe_setting(bad: dict, expected_phrase: str) -> None:
    with pytest.raises(RuntimeError) as err:
        _assert_production_config_is_safe(_Cfg(**bad))
    assert expected_phrase in str(err.value), str(err.value)
