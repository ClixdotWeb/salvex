"""
Verifying the email address signs the user in (same session, cookie and CSRF rules as a normal login);
a wrong, expired or reused code signs nobody in.
"""
from sqlalchemy import select

from app.core.config import settings
from app.models.user import AuthSession, User
from helpers import PASSWORD, new_email, register, wrong_code


async def _register(api, role="bidder"):
    email = new_email("autosign")
    assert (await register(api.client, email, role=role)).status_code == 201
    return email, api.mail.last_otp("verification", email)


async def test_a_correct_code_signs_the_user_in_with_a_cookie_session(api):
    email, code = await _register(api)
    res = await api.client.post("/api/auth/verify-email", json={"email": email, "otp": code})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["user"]["email"] == email and body["user"]["is_email_verified"] is True
    assert body["user"]["role"] == "bidder" and body["csrf_token"] and body["access_token"] is None
    assert "password_hash" not in body["user"]

    cookie = res.headers["set-cookie"]
    assert settings.auth_cookie_name in cookie and "HttpOnly" in cookie and "samesite=lax" in cookie.lower()
    me = await api.client.get("/api/auth/me")                       # the cookie alone restores the session
    assert me.status_code == 200 and me.json()["email"] == email

    # a state-changing call still needs the CSRF token from the verification response
    assert (await api.client.patch("/api/users/me", json={"name": "New Name"})).status_code == 403
    ok = await api.client.patch("/api/users/me", json={"name": "New Name"}, headers={"X-CSRF-Token": body["csrf_token"]})
    assert ok.status_code == 200

    async with api.db() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        sessions = (await db.execute(select(AuthSession).where(AuthSession.user_id == user.id))).scalars().all()
    assert len(sessions) == 1 and sessions[0].revoked_at is None


async def test_wrong_or_reused_codes_sign_nobody_in(api):
    email, code = await _register(api)
    wrong = await api.client.post("/api/auth/verify-email", json={"email": email, "otp": wrong_code(code)})
    assert wrong.status_code == 400 and "set-cookie" not in wrong.headers
    assert (await api.client.get("/api/auth/me")).status_code == 401

    assert (await api.client.post("/api/auth/verify-email", json={"email": email, "otp": code})).status_code == 200
    api.client.cookies.clear()
    replay = await api.client.post("/api/auth/verify-email", json={"email": email, "otp": code})
    assert replay.status_code == 400 and "set-cookie" not in replay.headers      # one code, one sign-in
    assert (await api.client.get("/api/auth/me")).status_code == 401

    unknown = await api.client.post("/api/auth/verify-email", json={"email": new_email("ghost"), "otp": "123456"})
    assert unknown.status_code == 400 and "set-cookie" not in unknown.headers


async def test_mobile_clients_can_ask_for_the_token(api):
    email, code = await _register(api, role="seller")
    res = await api.client.post("/api/auth/verify-email", json={"email": email, "otp": code},
                                headers={"X-Auth-Mode": "bearer"})
    token = res.json()["access_token"]
    api.client.cookies.clear()
    me = await api.client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["role"] == "seller"


async def test_a_suspended_account_is_not_signed_in_even_with_a_correct_code(api):
    email, code = await _register(api)
    async with api.db() as db:
        (await db.execute(select(User).where(User.email == email))).scalar_one().is_active = False
        await db.commit()
    res = await api.client.post("/api/auth/verify-email", json={"email": email, "otp": code})
    assert res.status_code == 400 and "set-cookie" not in res.headers


async def test_the_password_still_works_afterwards(api):
    email, code = await _register(api)
    await api.client.post("/api/auth/verify-email", json={"email": email, "otp": code})
    api.client.cookies.clear()
    login = await api.client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD})
    assert login.status_code == 200
