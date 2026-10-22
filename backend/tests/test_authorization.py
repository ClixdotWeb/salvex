"""
Authorization boundaries: roles are enforced on the server, from the database, and cannot be
chosen or changed through any public endpoint.
"""
import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.deps import get_current_user, require_role
from app.core.errors import register_error_handlers
from app.db.session import get_db
from app.main import app as main_app
from app.models.user import User
from app.services.admin_provisioning import provision_admin
from helpers import PASSWORD, login, new_email, register_and_verify


@pytest.fixture
async def guarded(api):
    """A tiny app with role-protected routes that shares the test database with the real app."""
    small = FastAPI()
    register_error_handlers(small)

    @small.get("/admin-only")
    async def admin_only(user: User = Depends(require_role(["admin"]))):
        return {"role": user.role}

    @small.get("/seller-or-admin")
    async def seller_or_admin(user: User = Depends(require_role(["seller", "admin"]))):
        return {"role": user.role}

    @small.get("/any-user")
    async def any_user(user: User = Depends(get_current_user)):
        return {"email": user.email}

    small.dependency_overrides[get_db] = main_app.dependency_overrides[get_db]
    async with AsyncClient(transport=ASGITransport(app=small), base_url="http://test") as client:
        yield client


async def token_for(api, email: str, password: str = PASSWORD) -> dict:
    res = await login(api.client, email, password, bearer=True)
    assert res.status_code == 200, res.text
    api.client.cookies.clear()
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_anonymous_users_get_401_and_ordinary_users_get_403(api, guarded):
    assert (await guarded.get("/admin-only")).status_code == 401

    bidder, seller = new_email("b"), new_email("s")
    await register_and_verify(api, bidder)
    await register_and_verify(api, seller, role="seller")

    res = await guarded.get("/admin-only", headers=await token_for(api, bidder))
    assert res.status_code == 403 and res.json()["code"] == "forbidden"
    assert "admin" not in res.json()["detail"].lower()          # does not list which roles would be allowed
    assert (await guarded.get("/admin-only", headers=await token_for(api, seller))).status_code == 403
    assert (await guarded.get("/seller-or-admin", headers=await token_for(api, bidder))).status_code == 403
    assert (await guarded.get("/seller-or-admin", headers=await token_for(api, seller))).status_code == 200
    assert (await guarded.get("/any-user", headers=await token_for(api, bidder))).status_code == 200


async def test_a_provisioned_administrator_passes_the_admin_check(api, guarded):
    admin_email = new_email("admin")
    async with api.db() as db:
        await provision_admin(db, email=admin_email, name="Admin User", password="a-long-admin-passphrase-2026")
        await db.commit()
    headers = await token_for(api, admin_email, "a-long-admin-passphrase-2026")
    res = await guarded.get("/admin-only", headers=headers)
    assert res.status_code == 200 and res.json()["role"] == "admin"


async def test_role_changes_take_effect_immediately_in_both_directions(api, guarded):
    email = new_email("changing")
    await register_and_verify(api, email)
    headers = await token_for(api, email)
    assert (await guarded.get("/admin-only", headers=headers)).status_code == 403

    async with api.db() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        user.role = "admin"
        await db.commit()
    assert (await guarded.get("/admin-only", headers=headers)).status_code == 200   # same token, no re-login

    async with api.db() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        user.role = "bidder"
        await db.commit()
    assert (await guarded.get("/admin-only", headers=headers)).status_code == 403


async def test_no_public_endpoint_accepts_a_role_other_than_bidder_or_seller():
    schema = main_app.openapi()
    for name, definition in schema["components"]["schemas"].items():
        props = definition.get("properties", {})
        if "role" in props and name != "UserResponse" and name != "MeResponse":
            assert props["role"].get("enum") == ["bidder", "seller"], name
    assert not [path for path in schema["paths"] if "admin" in path.lower()]   # no admin-creation route exists


async def test_requests_cannot_smuggle_privileged_fields(api):
    email = new_email("smuggle")
    res = await api.client.post(
        "/api/auth/register",
        json={"name": "Valid Name", "email": email, "password": PASSWORD, "role": "bidder", "is_active": True, "kyc_status": "verified"},
    )
    assert res.status_code == 422
    # login and the other endpoints refuse unknown fields as well
    assert (await api.client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD, "role": "admin"})).status_code == 422
    assert (await api.client.post("/api/auth/reset-password", json={"email": email, "otp": "123456", "new_password": PASSWORD, "role": "admin"})).status_code == 422


async def test_a_user_only_ever_sees_their_own_account(api):
    first, second = new_email("one"), new_email("two")
    await register_and_verify(api, first)
    await register_and_verify(api, second)
    h1, h2 = await token_for(api, first), await token_for(api, second)
    assert (await api.client.get("/api/auth/me", headers=h1)).json()["email"] == first
    assert (await api.client.get("/api/auth/me", headers=h2)).json()["email"] == second
    # there is no endpoint that takes a user id, so there is nothing to tamper with
    assert (await api.client.get("/api/auth/me", params={"user_id": "x", "email": second}, headers=h1)).json()["email"] == first
