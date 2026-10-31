"""
Race conditions. These tests use SEPARATE database connections that really commit, because row
locking can only be proven that way. Only the isolated local test database is ever used (see
safe_db.py) and every row created here is deleted afterwards (all use the @salvex-race.in domain).
"""
import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.session import get_db
from app.main import app
from app.models.user import AuthSession, AuthToken, User
from helpers import CapturingEmailService, PASSWORD, login, wrong_code
from safe_db import safe_test_url

DOMAIN = "@salvex-race.in"


def race_email(name: str) -> str:
    import uuid

    return f"{name}_{uuid.uuid4().hex[:8]}{DOMAIN}"


async def purge(engine) -> None:
    async with engine.begin() as conn:
        await conn.execute(text("DELETE FROM users WHERE email LIKE :pattern"), {"pattern": f"%{DOMAIN}"})


@pytest.fixture
async def race(monkeypatch):
    engine = create_async_engine(safe_test_url(), pool_size=12, max_overflow=0)   # local test database only
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with maker() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    mail = CapturingEmailService()
    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr("app.api.auth.get_email_service", lambda: mail)
    await purge(engine)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client, mail, maker
    finally:
        app.dependency_overrides.pop(get_db, None)
        await purge(engine)
        await engine.dispose()


async def register_new(client, email, password=PASSWORD):
    return await client.post("/api/auth/register", json={"name": "Race Test", "email": email, "password": password, "mobile": "+91 98765 43210"})


async def test_a_code_can_be_used_by_only_one_of_many_simultaneous_requests(race):
    client, mail, maker = race
    email = race_email("once")
    await register_new(client, email)
    code = mail.last_otp("verification", email)

    results = await asyncio.gather(*[
        client.post("/api/auth/verify-email", json={"email": email, "otp": code}) for _ in range(6)
    ])
    assert sorted(r.status_code for r in results).count(200) == 1
    async with maker() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        assert user.is_email_verified


async def test_simultaneous_wrong_guesses_cannot_exceed_the_attempt_limit(race):
    client, mail, maker = race
    email = race_email("guesses")
    await register_new(client, email)
    code = mail.last_otp("verification", email)
    bad = wrong_code(code)

    results = await asyncio.gather(*[
        client.post("/api/auth/verify-email", json={"email": email, "otp": bad}) for _ in range(8)
    ])
    assert all(r.status_code == 400 for r in results)

    async with maker() as db:
        token = (await db.execute(select(AuthToken).order_by(AuthToken.created_at.desc()))).scalars().first()
        assert token.attempts <= token.max_attempts            # parallel requests did not skip the counter
        assert token.is_used                                    # and the code is burned
    # the correct code no longer works either
    assert (await client.post("/api/auth/verify-email", json={"email": email, "otp": code})).status_code == 400
    async with maker() as db:
        assert not (await db.execute(select(User).where(User.email == email))).scalar_one().is_email_verified


async def test_a_reset_code_changes_the_password_only_once(race):
    client, mail, maker = race
    email = race_email("reset")
    await register_new(client, email)
    await client.post("/api/auth/verify-email", json={"email": email, "otp": mail.last_otp("verification", email)})
    await client.post("/api/auth/forgot-password", json={"email": email})
    code = mail.last_otp("reset", email)

    results = await asyncio.gather(
        client.post("/api/auth/reset-password", json={"email": email, "otp": code, "new_password": "FirstNewPassword!91"}),
        client.post("/api/auth/reset-password", json={"email": email, "otp": code, "new_password": "SecondNewPassword!92"}),
    )
    assert sorted(r.status_code for r in results) == [200, 400]
    winner = "FirstNewPassword!91" if results[0].status_code == 200 else "SecondNewPassword!92"
    assert (await login(client, email, winner)).status_code == 200


async def test_two_simultaneous_registrations_of_one_new_email_create_one_account(race):
    client, mail, maker = race
    email = race_email("twice")
    results = await asyncio.gather(register_new(client, email), register_new(client, email, "OtherStrongPass!77"))
    assert [r.status_code for r in results] == [201, 201]            # no 500 and the same answer
    async with maker() as db:
        count = (await db.execute(select(func.count()).select_from(User).where(User.email == email))).scalar_one()
    assert count == 1


async def test_simultaneous_logins_each_get_their_own_valid_session(race):
    client, mail, maker = race
    email = race_email("logins")
    await register_new(client, email)
    await client.post("/api/auth/verify-email", json={"email": email, "otp": mail.last_otp("verification", email)})

    responses = await asyncio.gather(*[login(client, email, bearer=True) for _ in range(5)])
    assert all(r.status_code == 200 for r in responses)
    client.cookies.clear()
    tokens = {r.json()["access_token"] for r in responses}
    assert len(tokens) == 5
    for token in tokens:
        assert (await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})).status_code == 200
    async with maker() as db:
        count = (await db.execute(select(func.count()).select_from(AuthSession))).scalar_one()
        assert count >= 5
