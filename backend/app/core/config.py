from typing import List, Optional
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from app.core.db_url import to_async_url, to_sync_url

# Environments where relaxed (developer-friendly) behaviour is allowed.
DEV_ENVIRONMENTS = {"development", "test"}
ALL_ENVIRONMENTS = {"development", "test", "staging", "production"}

# Substrings that mark a secret key as a placeholder/sample value.
_WEAK_SECRET_HINTS = (
    "change", "example", "default", "secret_key", "development", "test_secret",
    "salvex_dev", "password", "your_", "placeholder", "12345",
)


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables and/or .env file.
    Fails explicitly if required variables or PostgreSQL format is invalid.

    Safe by default: when APP_ENV is not set, the application assumes PRODUCTION and
    refuses to start unless the production security requirements below are met.
    """
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # Validation errors must never echo the value (DATABASE_URL contains a password)
        hide_input_in_errors=True,
    )

    # ---------------- Application ----------------
    APP_ENV: str = Field(default="production", description="development, test, staging or production")
    APP_HOST: str = Field(default="127.0.0.1", description="Server host interface")
    APP_PORT: int = Field(default=8000, description="Server port")
    APP_SECRET_KEY: str = Field(..., min_length=16, description="Secret key for security and token signatures")

    DATABASE_URL: str = Field(
        ...,
        description="Async PostgreSQL connection URL (e.g. postgresql+asyncpg://user:pass@host:port/dbname)"
    )

    FRONTEND_ORIGINS: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173",
        description="Comma-separated list of allowed frontend origins"
    )

    # ---------------- Sessions / tokens ----------------
    JWT_ALGORITHM: str = Field(default="HS256", description="JWT signing algorithm (HS256/HS384/HS512)")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(
        default=720, ge=5, le=60 * 24 * 14,
        description="Absolute session lifetime in minutes (the user must sign in again after this)"
    )
    SESSION_IDLE_TIMEOUT_MINUTES: int = Field(
        default=120, ge=5, le=60 * 24 * 14,
        description="A session unused for this long is ended"
    )
    SESSION_TOUCH_INTERVAL_SECONDS: int = Field(default=300, ge=10, description="How often last-seen is written")
    MAX_SESSIONS_PER_USER: int = Field(default=10, ge=1, le=100, description="Oldest sessions are revoked beyond this")

    # ---------------- Cookies ----------------
    COOKIE_SECURE: Optional[bool] = Field(
        default=None,
        description="Send the auth cookie over HTTPS only. Default: True except in development/test."
    )
    COOKIE_SAMESITE: str = Field(default="lax", description="lax, strict or none")
    COOKIE_DOMAIN: Optional[str] = Field(default=None, description="Leave empty for a host-only cookie (safest)")

    # ---------------- Abuse protection ----------------
    RATE_LIMIT_ENABLED: bool = Field(default=True, description="Must stay True outside development/test")
    TRUSTED_PROXY_COUNT: int = Field(
        default=0, ge=0, le=5,
        description="Number of reverse proxies in front of the API whose X-Forwarded-For is trusted"
    )

    # ---------------- One-time codes ----------------
    OTP_VERIFY_EXPIRE_MINUTES: int = Field(default=10, ge=1, le=60)
    OTP_RESET_EXPIRE_MINUTES: int = Field(default=15, ge=1, le=60)
    OTP_MAX_ATTEMPTS: int = Field(default=5, ge=1, le=10)
    OTP_RESEND_COOLDOWN_SECONDS: int = Field(default=60, ge=0, le=3600)

    # ---------------- Email ----------------
    EMAIL_PROVIDER: str = Field(
        default="console",
        description="console = developer outbox file (development/test only); smtp = real delivery"
    )
    SMTP_HOST: str = Field(default="", description="SMTP server host")
    SMTP_PORT: int = Field(default=587, description="SMTP server port (587 = STARTTLS, 465 = implicit TLS)")
    SMTP_USER: str = Field(default="", description="SMTP username")
    SMTP_PASSWORD: str = Field(default="", description="SMTP password")
    SMTP_FROM_EMAIL: str = Field(default="noreply@salvex-auction.in", description="Sender email address")
    SMTP_FROM_NAME: str = Field(default="Salvex Auction Platform", description="Sender display name")
    DEV_OUTBOX_PATH: str = Field(
        default=".dev_outbox/outbox.jsonl",
        description="Where the development email outbox is written (development/test only)"
    )

    # ---------------- Validators ----------------
    @field_validator("APP_ENV")
    @classmethod
    def validate_app_env(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in ALL_ENVIRONMENTS:
            raise ValueError("APP_ENV must be one of: " + ", ".join(sorted(ALL_ENVIRONMENTS)))
        return v

    @field_validator("COOKIE_SAMESITE")
    @classmethod
    def validate_samesite(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in {"lax", "strict", "none"}:
            raise ValueError("COOKIE_SAMESITE must be lax, strict or none")
        return v

    @field_validator("JWT_ALGORITHM")
    @classmethod
    def validate_jwt_algorithm(cls, v: str) -> str:
        v = v.strip().upper()
        if v not in {"HS256", "HS384", "HS512"}:
            raise ValueError("JWT_ALGORITHM must be HS256, HS384 or HS512")
        return v

    @field_validator("EMAIL_PROVIDER")
    @classmethod
    def validate_email_provider(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in {"console", "smtp"}:
            raise ValueError("EMAIL_PROVIDER must be console or smtp")
        return v

    @field_validator("COOKIE_DOMAIN")
    @classmethod
    def blank_domain_is_none(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() or None if v else None

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_postgres_url(cls, v: str) -> str:
        # Strictly require PostgreSQL driver
        if not (v.startswith("postgresql://") or v.startswith("postgresql+asyncpg://") or v.startswith("postgres://")):
            raise ValueError(
                "Invalid DATABASE_URL. Salvex backend requires PostgreSQL. "
                "Provided connection string must start with 'postgresql://' or 'postgresql+asyncpg://'."
            )
        # Normalize to asyncpg for async SQLAlchemy engine if not specified
        if v.startswith("postgresql://"):
            v = v.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif v.startswith("postgres://"):
            v = v.replace("postgres://", "postgresql+asyncpg://", 1)
        # asyncpg spells the SSL option ?ssl=..., while the company/provider URL (and
        # psycopg2) use ?sslmode=.... Translate it; never add or weaken SSL.
        return to_async_url(v)

    @model_validator(mode="after")
    def check_environment_safety(self) -> "Settings":
        """Refuse to start with an unsafe configuration. Messages name settings only, never values."""
        problems: List[str] = []

        if self.COOKIE_SAMESITE == "none" and not self.cookie_secure:
            problems.append("COOKIE_SAMESITE=none requires secure cookies")

        if self.EMAIL_PROVIDER == "smtp" and not (self.SMTP_HOST and self.SMTP_FROM_EMAIL):
            problems.append("EMAIL_PROVIDER=smtp requires SMTP_HOST and SMTP_FROM_EMAIL")

        if self.is_production_like:
            if self.COOKIE_SECURE is False:
                problems.append("COOKIE_SECURE must not be false")
            if not self.RATE_LIMIT_ENABLED:
                problems.append("RATE_LIMIT_ENABLED must be true")
            if len(self.APP_SECRET_KEY) < 32 or any(h in self.APP_SECRET_KEY.lower() for h in _WEAK_SECRET_HINTS):
                problems.append("APP_SECRET_KEY must be a random value of at least 32 characters")
            if self.EMAIL_PROVIDER != "smtp":
                problems.append("EMAIL_PROVIDER must be smtp (the developer outbox is not allowed)")
            elif not (self.SMTP_USER and self.SMTP_PASSWORD):
                problems.append("SMTP_USER and SMTP_PASSWORD must be set")
            origins = self.cors_origins
            if not origins:
                problems.append("FRONTEND_ORIGINS must list the website origin(s)")
            for origin in origins:
                low = origin.lower()
                if "*" in origin or not low.startswith("https://") or "localhost" in low or "127.0.0.1" in low:
                    problems.append("FRONTEND_ORIGINS must be explicit https:// origins (no wildcards or localhost)")
                    break

        if problems:
            raise ValueError("Unsafe configuration for APP_ENV=%s: %s" % (self.APP_ENV, "; ".join(problems)))
        return self

    # ---------------- Derived values ----------------
    @property
    def is_dev_like(self) -> bool:
        return self.APP_ENV in DEV_ENVIRONMENTS

    @property
    def is_production_like(self) -> bool:
        return not self.is_dev_like

    @property
    def cookie_secure(self) -> bool:
        """Secure cookies are the default everywhere except development/test."""
        if self.COOKIE_SECURE is not None:
            return self.COOKIE_SECURE
        return self.is_production_like

    @property
    def auth_cookie_name(self) -> str:
        """The __Host- prefix makes browsers enforce Secure, Path=/ and no Domain."""
        if self.cookie_secure and not self.COOKIE_DOMAIN:
            return "__Host-access_token"
        return "access_token"

    @property
    def session_lifetime_seconds(self) -> int:
        return self.ACCESS_TOKEN_EXPIRE_MINUTES * 60

    @property
    def sync_database_url(self) -> str:
        """DATABASE_URL in the form Alembic's psycopg2 driver understands."""
        return to_sync_url(self.DATABASE_URL)

    @property
    def cors_origins(self) -> List[str]:
        """Parse comma-separated origins string into a clean list of allowed origins."""
        return [origin.strip() for origin in self.FRONTEND_ORIGINS.split(",") if origin.strip()]


# Global settings singleton
settings = Settings()
