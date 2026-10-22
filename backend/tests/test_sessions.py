"""
Server-side sessions: revocation, expiry, idle timeout, forged tokens, and "role comes from the database".
"""
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import create_access_token, decode_access_token
from app.models.user import AuthSession, User
from helpers import NEW_PASSWORD, PASSWORD, login, new_email, register_and_verify, signed_in, wrong_code


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def bearer_login(api, email: str, password: str = PASSWORD):
    """Sign in as a non-browser client and return (token, csrf). The cookie jar is kept empty."""
    res = await login(api.client, email, password, bearer=True)
    assert res.status_code == 200, res.text
    api.client.cookies.clear()
    return res.json()["access_token"], res.json()["csrf_token"]


async def get_user(api, email: str) -> User:
    async with api.db() as db:
        return (await db.execute(select(User).where(User.email == email))).scalar_one()


async def session_of(api, token: str) -> AuthSession:
    sid = uuid.UUID(decode_access_token(token)["sid"])
    async with api.db() as db:
        return (await db.execute(select(AuthSession).where(AuthSession.id == sid))).scalar_one()


async def test_login_creates_a_server_side_session_bound_to_the_token(api):
    email = new_email("sess")
    await register_and_verify(api, email)
    token, _ = await bearer_login(api, email)

    payload = decode_access_token(token)
    session = await session_of(api, token)
    user = await get_user(api, email)
    assert str(session.user_id) == payload["sub"] == str(user.id)
    assert session.revoked_at is None
    lifetime = (session.expires_at - session.created_at).total_seconds()
    assert abs(lifetime - settings.session_lifetime_seconds) < 5
    assert (await api.client.get("/api/auth/me", headers=bearer(token))).status_code == 200


async def test_logout_revokes_the_session_so_a_copied_token_stops_working(api):
    email = new_email("logout")
    await register_and_verify(api, email)
    token, _ = await bearer_login(api, email)

    assert (await api.client.post("/api/auth/logout", headers=bearer(token))).status_code == 200
    assert (await api.client.get("/api/auth/me", headers=bearer(token))).status_code == 401  # replay fails
    session = await session_of(api, token)
    assert session.revoked_at is not None and session.revoke_reason == "logout"


async def test_a_stolen_cookie_is_useless_after_logout(api):
    email, csrf = await signed_in(api)
    stolen = api.client.cookies.get(settings.auth_cookie_name)
    assert stolen

    assert (await api.client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf})).status_code == 200
    api.client.cookies.set(settings.auth_cookie_name, stolen)  # attacker replays the copied cookie
    assert (await api.client.get("/api/auth/me")).status_code == 401


async def test_password_reset_signs_out_every_device(api):
    email = new_email("resetsess")
    await register_and_verify(api, email)
    first, _ = await bearer_login(api, email)
    second, _ = await bearer_login(api, email)
    assert (await api.client.get("/api/auth/me", headers=bearer(first))).status_code == 200

    await api.client.post("/api/auth/forgot-password", json={"email": email})
    otp = api.mail.last_otp("reset", email)
    res = await api.client.post("/api/auth/reset-password", json={"email": email, "otp": otp, "new_password": NEW_PASSWORD})
    assert res.status_code == 200

    for token in (first, second):
        assert (await api.client.get("/api/auth/me", headers=bearer(token))).status_code == 401
        assert (await session_of(api, token)).revoke_reason == "password_reset"
    fresh, _ = await bearer_login(api, email, NEW_PASSWORD)
    assert (await api.client.get("/api/auth/me", headers=bearer(fresh))).status_code == 200


async def test_logout_all_revokes_every_session_of_the_user_but_not_other_users(api):
    mine = new_email("all")
    other = new_email("other")
    await register_and_verify(api, mine)
    await register_and_verify(api, other)
    a1, _ = await bearer_login(api, mine)
    a2, _ = await bearer_login(api, mine)
    b1, _ = await bearer_login(api, other)

    assert (await api.client.post("/api/auth/logout-all", headers=bearer(a1))).status_code == 200
    assert (await api.client.get("/api/auth/me", headers=bearer(a1))).status_code == 401
    assert (await api.client.get("/api/auth/me", headers=bearer(a2))).status_code == 401
    assert (await api.client.get("/api/auth/me", headers=bearer(b1))).status_code == 200


async def test_logging_out_one_device_keeps_the_other_signed_in(api):
    email = new_email("two")
    await register_and_verify(api, email)
    phone, _ = await bearer_login(api, email)
    laptop, _ = await bearer_login(api, email)
    await api.client.post("/api/auth/logout", headers=bearer(phone))
    assert (await api.client.get("/api/auth/me", headers=bearer(phone))).status_code == 401
    assert (await api.client.get("/api/auth/me", headers=bearer(laptop))).status_code == 200


async def test_an_expired_session_is_refused(api):
    email = new_email("exp")
    await register_and_verify(api, email)
    token, _ = await bearer_login(api, email)
    async with api.db() as db:
        row = (await db.execute(select(AuthSession))).scalars().all()[-1]
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()
    assert (await api.client.get("/api/auth/me", headers=bearer(token))).status_code == 401


async def test_an_idle_session_times_out_and_is_revoked(api):
    email = new_email("idle")
    await register_and_verify(api, email)
    token, _ = await bearer_login(api, email)
    async with api.db() as db:
        row = (await db.execute(select(AuthSession))).scalars().all()[-1]
        row.last_seen_at = datetime.now(timezone.utc) - timedelta(minutes=settings.SESSION_IDLE_TIMEOUT_MINUTES + 1)
        await db.commit()
    assert (await api.client.get("/api/auth/me", headers=bearer(token))).status_code == 401
    assert (await session_of(api, token)).revoke_reason == "idle"


async def test_activity_refreshes_last_seen_without_writing_on_every_request(api):
    email = new_email("touch")
    await register_and_verify(api, email)
    token, _ = await bearer_login(api, email)
    stale = datetime.now(timezone.utc) - timedelta(seconds=settings.SESSION_TOUCH_INTERVAL_SECONDS + 30)
    async with api.db() as db:
        row = (await db.execute(select(AuthSession))).scalars().all()[-1]
        row.last_seen_at = stale
        await db.commit()
    await api.client.get("/api/auth/me", headers=bearer(token))
    refreshed = (await session_of(api, token)).last_seen_at
    assert refreshed > stale + timedelta(seconds=settings.SESSION_TOUCH_INTERVAL_SECONDS)

    await api.client.get("/api/auth/me", headers=bearer(token))
    assert (await session_of(api, token)).last_seen_at == refreshed  # no write inside the interval


async def test_forged_or_malformed_tokens_are_refused(api):
    email = new_email("forge")
    await register_and_verify(api, email)
    token, _ = await bearer_login(api, email)
    payload = decode_access_token(token)
    other_email = new_email("forge2")
    await register_and_verify(api, other_email)
    other_token, _ = await bearer_login(api, other_email)
    other_payload = decode_access_token(other_token)

    now = int(datetime.now(timezone.utc).timestamp())
    good = {"sub": payload["sub"], "sid": payload["sid"], "iss": "salvex-api", "iat": now, "exp": now + 600}
    candidates = {
        "wrong signing key": jwt.encode(good, "x" * 40, algorithm="HS256"),
        "alg none": jwt.encode(good, key="", algorithm="none"),
        "expired": jwt.encode({**good, "exp": now - 10}, settings.APP_SECRET_KEY, algorithm="HS256"),
        "wrong issuer": jwt.encode({**good, "iss": "someone-else"}, settings.APP_SECRET_KEY, algorithm="HS256"),
        "no session id (old style token)": jwt.encode({k: v for k, v in good.items() if k != "sid"}, settings.APP_SECRET_KEY, algorithm="HS256"),
        "someone else's user id with my session": jwt.encode({**good, "sub": other_payload["sub"]}, settings.APP_SECRET_KEY, algorithm="HS256"),
        "unknown session id": jwt.encode({**good, "sid": str(uuid.uuid4())}, settings.APP_SECRET_KEY, algorithm="HS256"),
        "tampered payload": token[:-4] + ("AAAA" if not token.endswith("AAAA") else "BBBB"),
        "not a token": "this-is-not-a-jwt",
    }
    for label, bad in candidates.items():
        res = await api.client.get("/api/auth/me", headers=bearer(bad))
        assert res.status_code == 401, label
    # and the genuine token is unaffected
    assert (await api.client.get("/api/auth/me", headers=bearer(token))).status_code == 200


async def test_the_role_comes_from_the_database_not_from_the_token(api):
    email = new_email("role")
    await register_and_verify(api, email)
    token, _ = await bearer_login(api, email)
    payload = decode_access_token(token)

    # a validly signed token that CLAIMS to be an admin is still just a bidder
    claiming_admin = create_access_token(subject=payload["sub"], role="admin", session_id=payload["sid"])
    res = await api.client.get("/api/auth/me", headers=bearer(claiming_admin))
    assert res.status_code == 200 and res.json()["role"] == "bidder"

    # a role change in the database applies to the existing token immediately
    async with api.db() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        user.role = "seller"
        await db.commit()
    assert (await api.client.get("/api/auth/me", headers=bearer(token))).json()["role"] == "seller"


async def test_only_the_newest_sessions_stay_active(api):
    email = new_email("cap")
    await register_and_verify(api, email)
    tokens = [(await bearer_login(api, email))[0] for _ in range(settings.MAX_SESSIONS_PER_USER + 2)]

    async with api.db() as db:
        active = (await db.execute(
            select(func.count()).select_from(AuthSession).where(AuthSession.revoked_at.is_(None))
        )).scalar_one()
    assert active == settings.MAX_SESSIONS_PER_USER
    assert (await api.client.get("/api/auth/me", headers=bearer(tokens[0]))).status_code == 401
    assert (await api.client.get("/api/auth/me", headers=bearer(tokens[-1]))).status_code == 200


async def test_cookie_attributes_in_development(api):
    email = new_email("cookie")
    await register_and_verify(api, email)
    res = await login(api.client, email)
    cookie = res.headers["set-cookie"].lower()
    assert cookie.startswith("access_token=")
    assert "httponly" in cookie and "path=/" in cookie and "samesite=lax" in cookie
    assert f"max-age={settings.session_lifetime_seconds}" in cookie
    assert "domain=" not in cookie  # host-only cookie
    assert "secure" not in cookie.replace("samesite", "")  # allowed only because APP_ENV=test


async def test_a_wrong_code_does_not_create_or_touch_sessions(api):
    email = new_email("nosession")
    await register_and_verify(api, email)
    async with api.db() as db:
        before = (await db.execute(select(func.count()).select_from(AuthSession))).scalar_one()
    await api.client.post("/api/auth/verify-email", json={"email": email, "otp": wrong_code("123456")})
    await login(api.client, email, "wrong-password-xyz")
    async with api.db() as db:
        after = (await db.execute(select(func.count()).select_from(AuthSession))).scalar_one()
    assert before == after
