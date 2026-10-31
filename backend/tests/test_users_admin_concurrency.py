"""
Module 2 race conditions: two administrators acting on each other at the same moment.

Like test_concurrency.py these use SEPARATE connections that really commit (row locks can only be proven
that way), on the isolated local test database only, and every user created here is deleted afterwards
(all use the @salvex-race.in domain). Audit rows are append-only and would block that clean-up, so the
audit writer is replaced by an in-memory recorder here; that the audit row shares the action's
transaction is proven in test_users_admin.py.
"""
import asyncio

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.session import get_db
from app.main import app
from app.models.user import User
from app.services.admin_provisioning import provision_admin
from helpers import CapturingEmailService, login
from safe_db import safe_test_url
from test_concurrency import DOMAIN, race_email

ADMIN_PASSWORD = "a-long-admin-passphrase-2026"
ROUNDS = 8


@pytest.fixture
async def admin_race(monkeypatch):
    engine = create_async_engine(safe_test_url(), pool_size=12, max_overflow=0)   # local test database only
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with maker() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    audits: list[dict] = []

    async def record(db, **kwargs):
        audits.append(kwargs)

    async def purge():
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM users WHERE email LIKE :pattern"), {"pattern": f"%{DOMAIN}"})

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr("app.api.auth.get_email_service", lambda: CapturingEmailService())
    monkeypatch.setattr("app.services.user_management.record_audit", record)
    await purge()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client, maker, audits, purge
    finally:
        app.dependency_overrides.pop(get_db, None)
        await purge()
        await engine.dispose()


async def _two_admins(client, maker):
    emails = [race_email("adm"), race_email("adm")]
    async with maker() as db:
        for email in emails:
            await provision_admin(db, email=email, name="Race Admin", password=ADMIN_PASSWORD)
        await db.commit()
        ids = [(await db.execute(select(User.id).where(User.email == e))).scalar_one() for e in emails]
    headers = []
    for email in emails:
        res = await login(client, email, ADMIN_PASSWORD, bearer=True)
        assert res.status_code == 200, res.text
        headers.append({"Authorization": f"Bearer {res.json()['access_token']}"})
    client.cookies.clear()
    return ids, headers


async def _other_active_admins(maker) -> int:
    async with maker() as db:
        return (await db.execute(select(func.count()).select_from(User).where(
            User.role == "admin", User.is_active.is_(True), User.email.not_like(f"%{DOMAIN}")))).scalar_one()


def _request(kind: str, target):
    if kind == "suspend":
        return f"/api/admin/users/{target}/suspend", {"reason": "race test"}
    return f"/api/admin/users/{target}/role", {"role": "bidder", "reason": "race test"}


@pytest.mark.parametrize("first,second", [("suspend", "suspend"), ("role", "role"), ("suspend", "role")])
async def test_admins_acting_on_each_other_at_once_always_leave_an_active_admin_and_never_crash(admin_race, first, second):
    client, maker, audits, purge = admin_race
    # The last-admin rule counts every active admin in the database, so this only proves something when
    # the two race admins are the only ones. The isolated test database must not hold other admins.
    assert await _other_active_admins(maker) == 0, "salvex_test_db contains committed admin accounts"

    for _ in range(ROUNDS):
        audits.clear()
        (x, y), (hx, hy) = await _two_admins(client, maker)
        url_a, body_a = _request(first, y)            # X acts on Y ...
        url_b, body_b = _request(second, x)           # ... while Y acts on X
        results = await asyncio.gather(
            client.post(url_a, json=body_a, headers=hx),
            client.post(url_b, json=body_b, headers=hy),
            return_exceptions=True,
        )
        crashed = [r for r in results if isinstance(r, BaseException)]
        assert not crashed, f"a request raised instead of answering: {crashed!r}"
        codes = [r.status_code for r in results]
        # Exactly one wins; the other is refused cleanly (its admin was suspended/demoted a moment
        # earlier: 401 if that happened before it signed in the request, 403 if while it waited).
        loser = [c for c in codes if c != 200]
        assert codes.count(200) == 1 and loser[0] in (401, 403, 409), [(r.status_code, r.text) for r in results]
        assert len(audits) == 1                        # only the action that happened is audited

        async with maker() as db:
            remaining = (await db.execute(select(func.count()).select_from(User).where(
                User.id.in_([x, y]), User.role == "admin", User.is_active.is_(True)))).scalar_one()
        assert remaining == 1
        await purge()
