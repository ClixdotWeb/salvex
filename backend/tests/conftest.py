import os
import tempfile
from pathlib import Path

import pytest

from safe_db import SafeTestDatabaseError, assert_safe_test_url, resolve_test_database_url

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


def pytest_configure(config):
    """
    Point the whole app at a LOCAL test database before any application module is imported.
    If no safe test database is configured, the run stops here, before anything connects.
    """
    try:
        test_url = resolve_test_database_url(ENV_FILE, os.environ)
    except SafeTestDatabaseError as exc:
        raise pytest.UsageError(f"Refusing to run tests: {exc}") from None

    os.environ["APP_ENV"] = "test"
    os.environ["APP_SECRET_KEY"] = "test_secret_key_minimum_32_characters_long_for_salvex_unit_tests"
    os.environ["DATABASE_URL"] = test_url  # overrides backend/.env for the app, Alembic and tests
    os.environ["FRONTEND_ORIGINS"] = "http://localhost:5173"
    # Anything written by the developer email outbox during tests goes to a temp folder, never the repo
    os.environ["DEV_OUTBOX_PATH"] = str(Path(tempfile.gettempdir()) / "salvex-test-outbox" / "outbox.jsonl")
    for name in ("COOKIE_SECURE", "COOKIE_SAMESITE", "COOKIE_DOMAIN", "EMAIL_PROVIDER", "RATE_LIMIT_ENABLED", "TRUSTED_PROXY_COUNT"):
        os.environ.pop(name, None)  # tests start from the defaults, whatever the developer's shell has set


@pytest.fixture(scope="session", autouse=True)
def _enforce_local_test_database():
    """Safety net: fail if the app settings somehow point anywhere but the local test database."""
    from app.core.config import settings

    try:
        assert_safe_test_url(settings.DATABASE_URL)
    except SafeTestDatabaseError as exc:
        pytest.exit(f"Refusing to run tests: application database is unsafe: {exc}", returncode=2)


@pytest.fixture(autouse=True)
def _fresh_abuse_protection_state():
    """Rate-limit counters and fake-attempt counters live in memory; start every test from zero."""
    from app.core.rate_limit import fake_attempts, limiter

    limiter.reset()
    fake_attempts.reset()
    yield
    limiter.reset()
    fake_attempts.reset()


# ---------------------------------------------------------------------------
# HTTP test harness: the real FastAPI app, a mocked email service, and an isolated database.
# ---------------------------------------------------------------------------
class ApiHarness:
    def __init__(self, client, mail, connection):
        self.client = client
        self.mail = mail
        self._connection = connection

    def db(self):
        """A database session on the same connection/transaction as the app (rolled back at the end)."""
        from sqlalchemy.ext.asyncio import AsyncSession

        return AsyncSession(bind=self._connection, expire_on_commit=False, join_transaction_mode="create_savepoint")


@pytest.fixture
async def api(monkeypatch):
    """
    Every request goes through the real routes, middleware and dependencies. All requests share one
    connection with an outer transaction that is ALWAYS rolled back, and each request commits to a
    SAVEPOINT, so nothing is ever persisted. Emails are captured, never sent.
    """
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
    from sqlalchemy.pool import NullPool

    from app.db.session import get_db
    from app.main import app
    from helpers import CapturingEmailService
    from safe_db import safe_test_url

    engine = create_async_engine(safe_test_url(), poolclass=NullPool)  # local test database only
    conn = await engine.connect()
    outer = await conn.begin()

    async def override_get_db():
        async with AsyncSession(bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint") as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    mail = CapturingEmailService()
    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr("app.api.auth.get_email_service", lambda: mail)

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield ApiHarness(client, mail, conn)
    finally:
        app.dependency_overrides.pop(get_db, None)
        await outer.rollback()
        await conn.close()
        await engine.dispose()
