"""
Application settings.

Single source of truth for configuration, loaded from environment variables
(and a local .env file in development) via pydantic-settings. Nothing in
this codebase should call os.environ directly outside this module — that
keeps configuration centralized, typed, and validated at startup rather than
failing deep inside a request handler.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- App ---
    app_name: str = "Vishakan Field Force Platform"
    environment: str = Field(default="development")  # development | staging | production
    debug: bool = Field(default=False)
    api_v1_prefix: str = "/api/v1"
    public_backend_url: str = Field(default="http://localhost:8001")

    # --- Security / Auth ---
    jwt_secret_key: str = Field(..., description="Required. Generate with `openssl rand -hex 32`.")
    jwt_algorithm: str = Field(default="HS256")
    access_token_expire_minutes: int = Field(default=15)
    refresh_token_expire_days: int = Field(default=7)

    # --- CORS ---
    cors_allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    # --- Rate limiting ---
    #
    # These defaulted to 5000 attempts per 1 second, which is not a limit -
    # it is the limiter switched off, and it applied even with no .env file
    # present. Five wrong passwords per five minutes, per ACCOUNT, is the
    # brute-force guard; the counter is cleared on a correct password, so it
    # only ever counts failures.
    login_rate_limit_attempts: int = Field(default=5)
    login_rate_limit_window_seconds: int = Field(default=300)
    # Per-source-address backstop over the same window, for one host trying a
    # password against many different accounts - which the per-account limit
    # alone cannot see. Only FAILED sign-ins count toward it, so a district of
    # officers sharing one carrier NAT never spends from it by working
    # normally; 100 failures in five minutes from a single address is well
    # past honest mistyping and well short of useful credential stuffing.
    # An earlier version of this counted every attempt at 50, and throttled
    # both the test suite and, by implication, a 9am check-in rush.
    login_ip_rate_limit_attempts: int = Field(default=100)
    # /location/ping is called by every officer's phone roughly every 15s
    # under normal operation (~4/min) per LocationService.ts's
    # timeInterval. 20 per 60s gives headroom for retries/reconnects
    # while still capping a runaway client or abuse.
    location_ping_rate_limit_attempts: int = Field(default=20)
    location_ping_rate_limit_window_seconds: int = Field(default=60)

    # --- Location staleness (two-tier) ---
    # Tier 1: dashboard status only ("signal lost"), no admin alert -
    # brief gaps (dead zones, indoors, battery dip) are expected and not
    # inherently suspicious. Checked reactively in GET /location/active.
    # Tier 2: fires an admin alert via the sweep loop in main.py's
    # lifespan handler, since a gap this long needs someone told even if
    # no one has the dashboard open when it happens.
    #
    # STARTING VALUES ONLY, not tuned against real usage yet. Especially
    # Tier 2: this app's own investigation found real-world reports of
    # correctly-configured iOS apps (Always granted) still seeing
    # 60-130 minute background delivery gaps under iOS's own power
    # management, independent of any bug. If your officers' actual rural
    # coverage is worse than assumed here, 30 minutes will alert on
    # routine signal loss (alert fatigue); if it's better, genuine
    # absence could go undetected for a while. Revisit once there's a
    # few weeks of real field data - there's no way to get this number
    # right from the code alone.
    location_stale_tier1_seconds: int = Field(default=180)
    location_stale_tier2_seconds: int = Field(default=1800)
    # The Redis cache entry itself must outlive Tier 2's threshold, or an
    # officer's entry disappears entirely (becomes "location_unavailable")
    # before the sweep loop ever gets a chance to detect the Tier 2
    # crossing and alert on it. Previously this TTL and the (single) stale
    # threshold were the same literal 600, which worked by coincidence,
    # not design - now that Tier 2 is longer than the old threshold, the
    # TTL has to be deliberately set past it. The +300s buffer covers the
    # sweep loop's own polling interval so a slow tick right at the
    # boundary doesn't lose the entry moments before the sweep checks it.
    location_cache_ttl_seconds: int = Field(default=1800 + 300)

    # GPS history older than this is deleted by the daily retention job
    # (app/application/services/gps_retention.py). Must match what the
    # location disclosure tells officers.
    gps_retention_days: int = Field(default=90)

    # --- Place names for the route timeline ---
    # Any OpenStreetMap-compatible reverse-geocoding URL. The public
    # Nominatim service allows one request a second and asks for a
    # User-Agent that identifies the application; answers are cached, so
    # normal use is a few requests a day. Point this at your own instance
    # if usage grows.
    geocoder_url: str = Field(default="https://nominatim.openstreetmap.org/reverse")
    geocoder_user_agent: str = Field(default="VBTOne-FieldForce/1.0 (vishakanbiotech.com)")

    # --- Company locale ---
    # The calendar day a closure belongs to is the day in the COMPANY's
    # timezone, not the server's. Without this, a closure filed at 11pm
    # IST on a UTC server is stored against the NEXT day, so the
    # officer's real closure looks missing and the logout gate re-prompts
    # them for a day they already closed.
    company_timezone: str = Field(default="Asia/Kolkata")

    # --- Database ---
    postgres_user: str = Field(default="vishakan_ffm")
    postgres_password: str = Field(..., description="Required. Set via environment/secret store.")
    postgres_host: str = Field(default="postgres")
    postgres_port: int = Field(default=5432)
    postgres_db: str = Field(default="vishakan_ffm")

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def database_url_sync(self) -> str:
        """Used by Alembic, which does not run in an async context."""
        return (
            f"postgresql+psycopg2://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    # --- Redis ---
    redis_host: str = Field(default="redis")
    redis_port: int = Field(default=6379)
    redis_db: int = Field(default=0)
    redis_password: Optional[str] = Field(default=None)
    redis_ssl: bool = Field(default=False, description="Set true for hosted Redis providers (e.g. Upstash) that require TLS")

    @property
    def redis_url(self) -> str:
        auth = f":{self.redis_password}@" if self.redis_password else ""
        scheme = "rediss" if self.redis_ssl else "redis"
        return f"{scheme}://{auth}{self.redis_host}:{self.redis_port}/{self.redis_db}"

    # --- Logging ---
    log_level: str = Field(default="INFO")


@lru_cache
def get_settings() -> Settings:
    """Cached so settings are parsed/validated once per process."""
    return Settings()
