"""
HTTP-level authentication tests: every call goes through the real FastAPI routes, middleware and
dependencies (see the `api` fixture in conftest.py). Nothing is persisted and no email is sent.
"""
import pytest
from sqlalchemy import select

from app.models.user import AuthToken, User
from helpers import (
    NEW_PASSWORD,
    PASSWORD,
    login,
    new_email,
    register,
    register_and_verify,
    signed_in,
    wrong_code,
)


# ------------------------------------------------------------------ the happy path
async def test_full_flow_register_verify_login_me_logout(api):
    client, mail = api.client, api.mail
    email = new_email("flow")

    res = await register(client, email)
    assert res.status_code == 201

    # Login before verification is blocked (only after the password is correct)
    res = await login(client, email)
    assert res.status_code == 403
    assert res.json()["code"] == "email_not_verified"

    otp = mail.last_otp("verification", email)
    wrong = wrong_code(otp)

    # Two wrong codes: the second response proves the first attempt was saved
    res = await client.post("/api/auth/verify-email", json={"email": email, "otp": wrong})
    assert res.status_code == 400
    assert "4 attempt(s) remaining" in res.json()["detail"]
    res = await client.post("/api/auth/verify-email", json={"email": email, "otp": wrong})
    assert res.status_code == 400
    assert "3 attempt(s) remaining" in res.json()["detail"]

    res = await client.post("/api/auth/verify-email", json={"email": email, "otp": otp})
    assert res.status_code == 200

    # Login sets an HttpOnly cookie. The token is NOT in the response body for browsers.
    res = await login(client, email)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["user"]["email"] == email and body["user"]["role"] == "bidder"
    assert body["access_token"] is None
    csrf = body["csrf_token"]
    set_cookie = res.headers.get("set-cookie", "")
    assert "access_token=" in set_cookie and "httponly" in set_cookie.lower() and "samesite=lax" in set_cookie.lower()

    # /me works with the cookie and returns the CSRF token for the website to keep in memory
    res = await client.get("/api/auth/me")
    assert res.status_code == 200
    assert res.json()["email"] == email and res.json()["csrf_token"] == csrf

    # Logout needs the CSRF token (cookie-authenticated, state-changing)
    res = await client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf})
    assert res.status_code == 200
    assert 'access_token=""' in res.headers.get("set-cookie", "")
    assert "access_token" not in client.cookies
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_bearer_token_is_returned_only_when_a_non_browser_client_asks(api):
    email = new_email("bearer")
    await register_and_verify(api, email)

    plain = await login(api.client, email)
    assert plain.json()["access_token"] is None

    api.client.cookies.clear()
    res = await login(api.client, email, bearer=True)
    token = res.json()["access_token"]
    assert token

    api.client.cookies.clear()
    assert (await api.client.get("/api/auth/me")).status_code == 401
    ok = await api.client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert ok.status_code == 200 and ok.json()["email"] == email


# ------------------------------------------------------------------ registration & enumeration
async def test_registering_a_verified_email_looks_identical_and_changes_nothing(api):
    email = new_email("dup")
    await register_and_verify(api, email)
    first_users = len(api.mail.of_type("verification"))

    res = await register(api.client, email, "AnotherStrongPass#77", name="Someone Else", role="seller")
    assert res.status_code == 201
    brand_new = await register(api.client, new_email("fresh"))
    assert res.json() == brand_new.json()  # same wording for known and unknown emails

    # The owner is told by email; the attacker gets no code; nothing about the account changed
    assert len(api.mail.of_type("exists", email)) == 1
    assert len(api.mail.of_type("verification")) == first_users + 1  # only the brand-new address got a code
    login_res = await login(api.client, email, PASSWORD)
    assert login_res.status_code == 200 and login_res.json()["user"]["role"] == "bidder"
    assert (await login(api.client, email, "AnotherStrongPass#77")).status_code == 401


async def test_preregistering_someone_elses_unverified_email_cannot_take_over_the_account(api):
    email = new_email("victim")
    attacker_password = "AttackerPass#12345"

    await register(api.client, email, attacker_password, name="Attacker")  # unverified, attacker password
    # The real owner now registers with their own password and verifies with the code sent to them
    await register(api.client, email, PASSWORD, name="Real Owner")
    code = api.mail.last_otp("verification", email)
    assert (await api.client.post("/api/auth/verify-email", json={"email": email, "otp": code})).status_code == 200

    assert (await login(api.client, email, attacker_password)).status_code == 401
    ok = await login(api.client, email, PASSWORD)
    assert ok.status_code == 200 and ok.json()["user"]["name"] == "Real Owner"


async def test_attacker_cannot_verify_a_pending_account_without_the_code(api):
    email = new_email("pending")
    await register(api.client, email, "AttackerPass#12345")
    first_code = api.mail.last_otp("verification", email)
    # a newer registration (even seconds later, inside the resend cooldown) issues a new code and
    # the old one stops working, so an old code can never verify an account with a newer password
    await register(api.client, email, PASSWORD)
    new_code = api.mail.last_otp("verification", email)
    if first_code != new_code:  # (one in a million that two random codes are equal)
        res = await api.client.post("/api/auth/verify-email", json={"email": email, "otp": first_code})
        assert res.status_code == 400
    assert (await api.client.post("/api/auth/verify-email", json={"email": email, "otp": new_code})).status_code == 200
    assert (await login(api.client, email, "AttackerPass#12345")).status_code == 401
    assert (await login(api.client, email, PASSWORD)).status_code == 200


async def test_unknown_and_known_emails_get_the_same_verification_failures(api):
    known = new_email("known")
    await register(api.client, known)
    unknown = new_email("unknown")

    def shape(res):
        return res.status_code, res.json()["code"], res.json()["detail"].split(". ")[0]

    for _ in range(5):
        a = await api.client.post("/api/auth/verify-email", json={"email": known, "otp": wrong_code(api.mail.last_otp("verification", known))})
        b = await api.client.post("/api/auth/verify-email", json={"email": unknown, "otp": "123456"})
        assert shape(a) == shape(b)
    a = await api.client.post("/api/auth/verify-email", json={"email": known, "otp": "654321"})
    b = await api.client.post("/api/auth/verify-email", json={"email": unknown, "otp": "654321"})
    assert a.json()["code"] == b.json()["code"] == "code_locked"
    assert a.json()["detail"] == b.json()["detail"]


async def test_resend_and_forgot_password_answers_never_reveal_whether_an_email_exists(api):
    known = new_email("rk")
    await register_and_verify(api, known)
    unknown = new_email("ru")

    for path, payload in (
        ("/api/auth/resend-otp", {"purpose": "password_reset"}),
        ("/api/auth/forgot-password", {}),
    ):
        a = await api.client.post(path, json={"email": known, **payload})
        b = await api.client.post(path, json={"email": unknown, **payload})
        assert a.status_code == b.status_code == 200
        assert a.json() == b.json()
    assert api.mail.of_type("reset", unknown) == []


async def test_resend_respects_the_cooldown_and_invalidates_the_previous_code(api):
    email = new_email("resend")
    await register(api.client, email)
    first = api.mail.last_otp("verification", email)

    # inside the cooldown no second message is sent (and the answer does not say so)
    res = await api.client.post("/api/auth/resend-otp", json={"email": email})
    assert res.status_code == 200
    assert len(api.mail.of_type("verification", email)) == 1

    # age the first code past the cooldown, then resend
    async with api.db() as db:
        for token in (await db.execute(select(AuthToken))).scalars():
            token.created_at = token.created_at.replace(year=token.created_at.year - 1)
        await db.commit()
    res = await api.client.post("/api/auth/resend-otp", json={"email": email})
    assert res.status_code == 200
    second = api.mail.last_otp("verification", email)
    assert len(api.mail.of_type("verification", email)) == 2

    if first != second:  # (one in a million that two random codes are equal)
        assert (await api.client.post("/api/auth/verify-email", json={"email": email, "otp": first})).status_code == 400
    assert (await api.client.post("/api/auth/verify-email", json={"email": email, "otp": second})).status_code == 200


async def test_a_verified_user_gets_no_new_verification_code_on_resend(api):
    email = new_email("verified")
    await register_and_verify(api, email)
    before = len(api.mail.of_type("verification", email))
    res = await api.client.post("/api/auth/resend-otp", json={"email": email})
    assert res.status_code == 200
    assert len(api.mail.of_type("verification", email)) == before


# ------------------------------------------------------------------ one-time codes
async def test_verification_code_locks_after_five_wrong_attempts(api):
    email = new_email("lock")
    await register(api.client, email)
    otp = api.mail.last_otp("verification", email)
    wrong = wrong_code(otp)

    for _ in range(5):
        res = await api.client.post("/api/auth/verify-email", json={"email": email, "otp": wrong})
        assert res.status_code == 400

    # Even the correct code must now be refused
    res = await api.client.post("/api/auth/verify-email", json={"email": email, "otp": otp})
    assert res.status_code == 400
    assert "Too many failed attempts" in res.json()["detail"]
    assert (await login(api.client, email)).status_code == 403  # still unverified


async def test_a_verification_code_works_only_once(api):
    email = new_email("once")
    await register(api.client, email)
    otp = api.mail.last_otp("verification", email)
    assert (await api.client.post("/api/auth/verify-email", json={"email": email, "otp": otp})).status_code == 200
    replay = await api.client.post("/api/auth/verify-email", json={"email": email, "otp": otp})
    assert replay.status_code == 400


async def test_an_expired_code_is_refused(api):
    email = new_email("expired")
    await register(api.client, email)
    otp = api.mail.last_otp("verification", email)
    async with api.db() as db:
        for token in (await db.execute(select(AuthToken))).scalars():
            token.expires_at = token.expires_at.replace(year=token.expires_at.year - 1)
        await db.commit()
    res = await api.client.post("/api/auth/verify-email", json={"email": email, "otp": otp})
    assert res.status_code == 400
    assert (await login(api.client, email)).status_code == 403


async def test_a_reset_code_cannot_verify_an_email_and_a_verification_code_cannot_reset_a_password(api):
    email = new_email("purpose")
    await register(api.client, email)
    verify_code = api.mail.last_otp("verification", email)
    # make sure we have a reset code too: verify the account first, then ask for a reset
    assert (await api.client.post("/api/auth/verify-email", json={"email": email, "otp": verify_code})).status_code == 200
    await api.client.post("/api/auth/forgot-password", json={"email": email})
    reset_code = api.mail.last_otp("reset", email)

    # verification code used as a reset code
    res = await api.client.post("/api/auth/reset-password", json={"email": email, "otp": verify_code, "new_password": NEW_PASSWORD})
    if verify_code != reset_code:
        assert res.status_code == 400
    # the real reset code still works (a failed guess used one of five attempts, not the code)
    res = await api.client.post("/api/auth/reset-password", json={"email": email, "otp": reset_code, "new_password": NEW_PASSWORD})
    assert res.status_code == 200


async def test_codes_are_stored_hashed_and_bound_to_the_user_and_purpose(api):
    email = new_email("stored")
    await register(api.client, email)
    otp = api.mail.last_otp("verification", email)
    async with api.db() as db:
        token = (await db.execute(select(AuthToken))).scalars().all()[-1]
        assert otp not in token.token_hash and len(token.token_hash) == 64
        from app.core.security import hash_token, verify_token_hash

        assert verify_token_hash(otp, token.token_hash, f"email_verification:{token.user_id}")
        assert not verify_token_hash(otp, token.token_hash, f"password_reset:{token.user_id}")
        assert token.token_hash != hash_token(otp)  # not a plain, unkeyed hash of the code


# ------------------------------------------------------------------ password reset
async def test_password_reset_flow(api):
    email = new_email("reset")
    await register_and_verify(api, email)

    res = await api.client.post("/api/auth/forgot-password", json={"email": email})
    assert res.status_code == 200
    otp = api.mail.last_otp("reset", email)

    res = await api.client.post("/api/auth/reset-password", json={"email": email, "otp": wrong_code(otp), "new_password": NEW_PASSWORD})
    assert res.status_code == 400
    assert "4 attempt(s) remaining" in res.json()["detail"]

    res = await api.client.post("/api/auth/reset-password", json={"email": email, "otp": otp, "new_password": NEW_PASSWORD})
    assert res.status_code == 200
    assert len(api.mail.of_type("changed", email)) == 1  # the owner is told

    # The code is single-use
    res = await api.client.post("/api/auth/reset-password", json={"email": email, "otp": otp, "new_password": "AnotherPassword789!"})
    assert res.status_code == 400

    assert (await login(api.client, email, PASSWORD)).status_code == 401
    assert (await login(api.client, email, NEW_PASSWORD)).status_code == 200


async def test_reset_code_locks_after_five_wrong_attempts(api):
    email = new_email("resetlock")
    await register_and_verify(api, email)
    await api.client.post("/api/auth/forgot-password", json={"email": email})
    otp = api.mail.last_otp("reset", email)

    for _ in range(5):
        res = await api.client.post("/api/auth/reset-password", json={"email": email, "otp": wrong_code(otp), "new_password": NEW_PASSWORD})
        assert res.status_code == 400

    res = await api.client.post("/api/auth/reset-password", json={"email": email, "otp": otp, "new_password": NEW_PASSWORD})
    assert res.status_code == 400
    assert "Too many failed attempts" in res.json()["detail"]
    assert (await login(api.client, email, PASSWORD)).status_code == 200  # password unchanged


async def test_reset_works_for_an_unverified_account_owner_but_login_still_needs_verification(api):
    email = new_email("unverified_reset")
    await register(api.client, email)
    await api.client.post("/api/auth/forgot-password", json={"email": email})
    otp = api.mail.last_otp("reset", email)
    assert (await api.client.post("/api/auth/reset-password", json={"email": email, "otp": otp, "new_password": NEW_PASSWORD})).status_code == 200
    assert (await login(api.client, email, NEW_PASSWORD)).status_code == 403


# ------------------------------------------------------------------ login errors
async def test_login_errors_do_not_reveal_which_part_was_wrong(api):
    email = new_email("exists")
    await register_and_verify(api, email)

    wrong_pw = await login(api.client, email, "definitely-wrong-password")
    no_user = await login(api.client, new_email("nobody"), PASSWORD)
    assert wrong_pw.status_code == no_user.status_code == 401
    assert wrong_pw.json() == no_user.json()
    assert "Invalid email or password" in wrong_pw.json()["detail"]


async def test_a_suspended_account_cannot_sign_in_and_existing_sessions_stop_working(api):
    email, csrf = await signed_in(api)
    assert (await api.client.get("/api/auth/me")).status_code == 200

    async with api.db() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        user.is_active = False
        await db.commit()

    assert (await api.client.get("/api/auth/me")).status_code == 401  # takes effect immediately
    api.client.cookies.clear()
    res = await login(api.client, email)
    assert res.status_code == 403 and res.json()["code"] == "account_suspended"
    # a wrong password on a suspended account still looks like any other wrong password
    assert (await login(api.client, email, "wrong-password-123")).json()["code"] == "invalid_credentials"


# ------------------------------------------------------------------ validation
async def test_registration_cannot_create_an_administrator_or_set_privileged_fields(api):
    for extra in ({"role": "admin"}, {"is_active": True}, {"is_email_verified": True}, {"kyc_status": "verified"}):
        res = await register(api.client, new_email("evil"), **extra)
        assert res.status_code == 422, extra
    async with api.db() as db:
        assert (await db.execute(select(User).where(User.role == "admin"))).first() is None


async def test_weak_and_malformed_input_is_rejected_with_field_level_errors(api):
    cases = {
        "password": [dict(password="short"), dict(password="password123"), dict(password="a" * 129)],
        "email": [dict(email="not-an-email")],
        "mobile": [dict(mobile="abc")],
        "name": [dict(name="<script>x</script>"), dict(name="A")],
    }
    for field, variants in cases.items():
        for variant in variants:
            payload = {"name": "Valid Name", "email": new_email("v"), "password": PASSWORD, "role": "bidder"}
            payload.update(variant)
            res = await api.client.post("/api/auth/register", json=payload)
            assert res.status_code == 422, variant
            assert res.json()["code"] == "validation_error"
            assert field in {part for item in res.json()["detail"] for part in item["loc"]}


async def test_a_password_equal_to_the_email_is_rejected(api):
    email = new_email("same")
    res = await register(api.client, email, password=email)
    assert res.status_code == 422


async def test_validation_errors_never_echo_the_submitted_password(api):
    secret = "Sh0rt"
    res = await api.client.post("/api/auth/register", json={"name": "Valid Name", "email": new_email("e"), "password": secret})
    assert res.status_code == 422
    assert secret not in res.text and '"input"' not in res.text


@pytest.mark.parametrize("password", ["é" * 70, "𝕊" * 40 + "Aa1!", "p" * 128, "pass word with spaces 123"])
async def test_long_unicode_and_spaced_passwords_work(api, password):
    """Regression: bcrypt 5 rejects inputs over 72 bytes, which used to crash registration with a 500."""
    email = new_email("longpw")
    await register_and_verify(api, email, password)
    res = await login(api.client, email, password)
    assert res.status_code == 200
    different = password[:-1] + ("a" if password[-1] != "a" else "b")
    assert (await login(api.client, email, different)).status_code == 401


async def test_malformed_requests_get_a_clean_error_not_a_server_crash(api):
    for path in ("/api/auth/register", "/api/auth/login", "/api/auth/verify-email", "/api/auth/reset-password"):
        res = await api.client.post(path, content=b"{not json", headers={"content-type": "application/json"})
        assert res.status_code == 422
        res = await api.client.post(path, json=["unexpected", "list"])
        assert res.status_code == 422
    # numeric code must be exactly six digits
    res = await api.client.post("/api/auth/verify-email", json={"email": new_email("c"), "otp": "12a456"})
    assert res.status_code == 422


# ------------------------------------------------------------------ responses
async def test_authentication_responses_are_not_cacheable_and_carry_security_headers(api):
    res = await api.client.get("/api/auth/me")
    assert res.status_code == 401
    assert res.headers["cache-control"] == "no-store"
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert "default-src 'none'" in res.headers["content-security-policy"]
