"""
Cross-site request protection: (1) Origin/Referer check on state-changing requests, and
(2) a per-session CSRF token required whenever the browser cookie is what authenticates the request.
"""
from app.core.config import settings
from helpers import PASSWORD, login, new_email, register_and_verify, signed_in

ALLOWED = "http://localhost:5173"
EVIL = "https://evil.example"


async def test_logout_with_the_cookie_needs_the_csrf_token(api):
    email, csrf = await signed_in(api)

    missing = await api.client.post("/api/auth/logout")
    assert missing.status_code == 403 and missing.json()["code"] == "csrf_failed"
    wrong = await api.client.post("/api/auth/logout", headers={"X-CSRF-Token": "0" * 64})
    assert wrong.status_code == 403 and wrong.json()["code"] == "csrf_failed"

    # the failed attempts did not sign the user out
    assert (await api.client.get("/api/auth/me")).status_code == 200

    ok = await api.client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf})
    assert ok.status_code == 200
    assert (await api.client.get("/api/auth/me")).status_code == 401


async def test_a_csrf_token_from_another_session_is_refused(api):
    _, other_csrf = await signed_in(api)          # session A (cookie in the jar)
    api.client.cookies.clear()
    await signed_in(api)                          # session B replaces the cookie
    res = await api.client.post("/api/auth/logout", headers={"X-CSRF-Token": other_csrf})
    assert res.status_code == 403
    assert (await api.client.get("/api/auth/me")).status_code == 200


async def test_logout_all_needs_the_csrf_token_too(api):
    _, csrf = await signed_in(api)
    assert (await api.client.post("/api/auth/logout-all")).status_code == 403
    assert (await api.client.post("/api/auth/logout-all", headers={"X-CSRF-Token": csrf})).status_code == 200


async def test_bearer_clients_do_not_need_a_csrf_token(api):
    email = new_email("bearercsrf")
    await register_and_verify(api, email)
    res = await login(api.client, email, bearer=True)
    token = res.json()["access_token"]
    api.client.cookies.clear()
    # no cookie => not a browser-ambient credential => nothing to forge
    ok = await api.client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert ok.status_code == 200


async def test_the_csrf_token_is_not_exposed_unless_you_are_authenticated(api):
    res = await api.client.get("/api/auth/me")
    assert res.status_code == 401 and "csrf" not in res.text.lower().replace("csrf_", "")


async def test_state_changing_requests_from_a_foreign_origin_are_blocked_everywhere(api):
    email = new_email("origin")
    await register_and_verify(api, email)
    for path, body in (
        ("/api/auth/login", {"identifier": email, "password": PASSWORD}),   # blocks "login CSRF"
        ("/api/auth/register", {"name": "Evil", "email": new_email("e"), "password": PASSWORD, "mobile": "+91 98765 43210"}),
        ("/api/auth/forgot-password", {"email": email}),
        ("/api/auth/verify-email", {"email": email, "otp": "123456"}),
    ):
        res = await api.client.post(path, json=body, headers={"Origin": EVIL})
        assert res.status_code == 403 and res.json()["code"] == "csrf_origin", path
    # nothing was sent or created by the blocked requests
    assert api.mail.of_type("reset", email) == []


async def test_origin_check_details(api):
    email = new_email("origin2")
    await register_and_verify(api, email)
    body = {"identifier": email, "password": PASSWORD}

    ok = await api.client.post("/api/auth/login", json=body, headers={"Origin": ALLOWED})
    assert ok.status_code == 200
    assert (await api.client.post("/api/auth/login", json=body, headers={"Origin": "null"})).status_code == 403
    assert (await api.client.post("/api/auth/login", json=body, headers={"Origin": ALLOWED + ".evil.example"})).status_code == 403
    assert (await api.client.post("/api/auth/login", json=body, headers={"Origin": "http://localhost:5174"})).status_code == 403

    # no Origin but a foreign Referer is also refused; a matching Referer is fine
    assert (await api.client.post("/api/auth/login", json=body, headers={"Referer": EVIL + "/page"})).status_code == 403
    assert (await api.client.post("/api/auth/login", json=body, headers={"Referer": ALLOWED + "/login"})).status_code == 200
    # a request with neither header is not a browser cross-site request (curl, mobile apps)
    assert (await api.client.post("/api/auth/login", json=body)).status_code == 200


async def test_safe_methods_are_not_blocked_by_the_origin_check(api):
    res = await api.client.get("/api/health", headers={"Origin": EVIL})
    assert res.status_code == 200


async def test_cors_allows_only_the_configured_website_and_never_wildcards(api):
    assert ALLOWED in settings.cors_origins and "*" not in settings.cors_origins

    allowed = await api.client.options(
        "/api/auth/login",
        headers={"Origin": ALLOWED, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-csrf-token"},
    )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == ALLOWED
    assert allowed.headers["access-control-allow-credentials"] == "true"

    foreign = await api.client.options(
        "/api/auth/login",
        headers={"Origin": EVIL, "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in foreign.headers

    bad_header = await api.client.options(
        "/api/auth/login",
        headers={"Origin": ALLOWED, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-something-else"},
    )
    assert bad_header.status_code == 400  # only the explicitly allowed headers are accepted
