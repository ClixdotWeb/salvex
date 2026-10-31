"""
Module 2: administrator user management (search, detail, suspend/reactivate, role change) and the
signed-in user's own profile (`/api/users/me`).

Everything runs on the isolated local test database inside a transaction that is always rolled back.
"""
import uuid

import pytest
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.user import AuthSession, User
from helpers import PASSWORD, login, new_email, register_and_verify
from test_admin_foundation import ADMIN_PASSWORD, bearer_headers, load_user, make_admin

SECRET_FIELDS = {"password_hash", "password", "token", "token_hash", "otp", "csrf_token"}


async def make_user(api, role: str = "bidder", **extra) -> tuple[str, dict, uuid.UUID]:
    """A verified user with a bearer-token header. Returns (email, headers, id)."""
    email = new_email(role)
    await register_and_verify(api, email, role=role, **extra)
    headers = await bearer_headers(api, email)
    return email, headers, (await load_user(api, email)).id


async def audit_for(api, action: str, target_id) -> list[AuditLog]:
    async with api.db() as db:
        rows = await db.execute(select(AuditLog).where(AuditLog.action == action, AuditLog.target_id == str(target_id)))
        return list(rows.scalars().all())


async def session_rows(api, user_id) -> list[AuthSession]:
    async with api.db() as db:
        return list((await db.execute(select(AuthSession).where(AuthSession.user_id == user_id))).scalars().all())


# ---------------------------------------------------------------------------- authorization matrix
def _user_routes():
    uid = "00000000-0000-0000-0000-000000000001"
    return [
        ("get", "/api/admin/users", None),
        ("get", f"/api/admin/users/{uid}", None),
        ("post", f"/api/admin/users/{uid}/suspend", {"reason": "abuse of rules"}),
        ("post", f"/api/admin/users/{uid}/reactivate", {}),
        ("post", f"/api/admin/users/{uid}/role", {"role": "seller", "reason": "requested by user"}),
    ]


async def test_admin_user_routes_return_401_for_anonymous_and_403_for_non_admins(api):
    _, bidder, _ = await make_user(api, "bidder")
    _, seller, _ = await make_user(api, "seller")
    for method, url, body in _user_routes():
        anon = await api.client.request(method, url, json=body)
        assert anon.status_code == 401 and anon.json()["code"] == "not_authenticated", url
        for headers in (bidder, seller):
            res = await api.client.request(method, url, json=body, headers=headers)
            assert res.status_code == 403 and res.json()["code"] == "forbidden", url


async def test_me_routes_require_sign_in(api):
    assert (await api.client.get("/api/users/me")).status_code == 401
    assert (await api.client.patch("/api/users/me", json={"name": "Someone"})).status_code == 401


# ---------------------------------------------------------------------------- search
async def _seed_search_users(api, tag: str):
    a, _, a_id = await make_user(api, "bidder", name=f"Aarav {tag} Traders", mobile="+91 98765-43210")
    b, _, b_id = await make_user(api, "seller", name=f"Bhavna {tag} Motors", mobile="+91 70123 45678")
    c, _, c_id = await make_user(api, "bidder", name=f"Chetan {tag} Auto", mobile="(022) 2345 6789")
    return (a, a_id), (b, b_id), (c, c_id)


async def test_search_by_name_email_phone_and_free_text(api):
    _, admin = await make_admin(api)
    tag = uuid.uuid4().hex[:8]
    (a, a_id), (b, b_id), (c, c_id) = await _seed_search_users(api, tag)

    async def ids(query: str) -> set[str]:
        res = await api.client.get(f"/api/admin/users?{query}&page_size=100", headers=admin)
        assert res.status_code == 200, res.text
        return {item["id"] for item in res.json()["items"]}

    assert await ids(f"name={tag.upper()}") == {str(a_id), str(b_id), str(c_id)}        # case-insensitive
    assert await ids(f"name=Bhavna%20{tag}") == {str(b_id)}
    assert await ids(f"email={a.split('@')[0]}") == {str(a_id)}
    assert await ids(f"q={tag}") == {str(a_id), str(b_id), str(c_id)}
    assert await ids("phone=9876543210") == {str(a_id)}                                  # formatting ignored
    assert await ids("phone=%2B91%2098765-43210") == {str(a_id)}
    assert await ids("phone=022%202345") == {str(c_id)}
    assert await ids("q=9876543210") == {str(a_id)}
    assert await ids(f"name={tag}&role=seller") == {str(b_id)}                           # filters combine with AND
    assert await ids(f"name={tag}&kyc_status=verified") == set()
    assert await ids(f"name={tag}&kyc_status=pending&is_email_verified=true") == {str(a_id), str(b_id), str(c_id)}


async def test_search_status_filter_and_wildcards_are_literal(api):
    admin_email, admin = await make_admin(api)
    tag = uuid.uuid4().hex[:8]
    (a, a_id), (b, b_id), _ = await _seed_search_users(api, tag)
    res = await api.client.post(f"/api/admin/users/{a_id}/suspend", headers=admin, json={"reason": "test suspension"})
    assert res.status_code == 200, res.text

    async def ids(query: str) -> set[str]:
        res = await api.client.get(f"/api/admin/users?{query}&page_size=100", headers=admin)
        assert res.status_code == 200, res.text
        return {item["id"] for item in res.json()["items"]}

    assert await ids(f"name={tag}&status=suspended") == {str(a_id)}
    assert str(a_id) not in await ids(f"name={tag}&status=active")
    # % and _ are ordinary characters, not wildcards: nothing in the data contains them in a name
    for query in ("name=%25", "name=_", "email=%25", "q=%25%25"):
        assert await ids(query) == set(), query
    assert await ids("name=x'%20OR%201=1%20--") == set()                                 # injection text is just text


async def test_search_results_never_contain_secrets_and_use_the_page_shape(api):
    _, admin = await make_admin(api)
    await make_user(api)
    body = (await api.client.get("/api/admin/users", headers=admin)).json()
    assert set(body) == {"items", "page", "page_size", "total", "pages"}
    assert body["items"]
    for item in body["items"]:
        assert not SECRET_FIELDS & set(item)
        assert set(item) == {"id", "buyer_id", "name", "email", "role", "mobile", "organization", "kyc_status",
                             "is_email_verified", "is_active", "created_at", "updated_at"}


async def test_search_pagination_ordering_and_limits(api):
    _, admin = await make_admin(api)
    tag = uuid.uuid4().hex[:8]
    for i in range(5):
        await make_user(api, name=f"Pager {tag} {i}")
    first = (await api.client.get(f"/api/admin/users?name={tag}&page_size=2", headers=admin)).json()
    assert first["total"] == 5 and first["pages"] == 3 and len(first["items"]) == 2
    last = (await api.client.get(f"/api/admin/users?name={tag}&page_size=2&page=3", headers=admin)).json()
    assert len(last["items"]) == 1
    seen = [i["id"] for p in (1, 2, 3) for i in (await api.client.get(
        f"/api/admin/users?name={tag}&page_size=2&page={p}", headers=admin)).json()["items"]]
    assert len(seen) == len(set(seen)) == 5                                              # no repeats, none missing
    stamps = [i["created_at"] for i in first["items"]]
    assert stamps == sorted(stamps, reverse=True)

    for query in ("page_size=101", "page_size=0", "page=0", "role=superuser", "status=gone",
                  "kyc_status=maybe", "q=", "name=" + "a" * 101, "email=a%00b", "is_email_verified=perhaps"):
        res = await api.client.get(f"/api/admin/users?{query}", headers=admin)
        assert res.status_code == 422 and res.json()["code"] == "validation_error", query


# ---------------------------------------------------------------------------- detail
async def test_user_detail_shows_suspension_record_and_session_count_without_secrets(api):
    admin_email, admin = await make_admin(api)
    _, _, uid = await make_user(api)
    res = await api.client.get(f"/api/admin/users/{uid}", headers=admin)
    assert res.status_code == 200
    body = res.json()
    assert not SECRET_FIELDS & set(body)
    # two sessions: one from verifying the email (that signs the user in) and one from signing in
    assert body["active_session_count"] == 2 and body["suspended_at"] is None and body["is_active"] is True

    await api.client.post(f"/api/admin/users/{uid}/suspend", headers=admin, json={"reason": "fraud review"})
    body = (await api.client.get(f"/api/admin/users/{uid}", headers=admin)).json()
    admin_id = (await load_user(api, admin_email)).id
    assert body["is_active"] is False and body["suspension_reason"] == "fraud review"
    assert body["suspended_by_id"] == str(admin_id) and body["suspended_at"] and body["active_session_count"] == 0


async def test_user_detail_unknown_or_malformed_id(api):
    _, admin = await make_admin(api)
    res = await api.client.get(f"/api/admin/users/{uuid.uuid4()}", headers=admin)
    assert res.status_code == 404 and res.json()["code"] == "user_not_found"
    assert (await api.client.get("/api/admin/users/not-a-uuid", headers=admin)).status_code == 422


# ---------------------------------------------------------------------------- suspension
async def test_suspension_blocks_access_at_once_and_revokes_every_session(api):
    admin_email, admin = await make_admin(api)
    email, user_headers, uid = await make_user(api)
    second = await bearer_headers(api, email)                      # a second device
    assert (await api.client.get("/api/users/me", headers=user_headers)).status_code == 200

    res = await api.client.post(f"/api/admin/users/{uid}/suspend", headers=admin, json={"reason": "  Chargeback fraud  "})
    assert res.status_code == 200, res.text
    assert res.json()["is_active"] is False and res.json()["suspension_reason"] == "Chargeback fraud"

    for headers in (user_headers, second):
        assert (await api.client.get("/api/users/me", headers=headers)).status_code == 401
        assert (await api.client.get("/api/auth/me", headers=headers)).status_code == 401
    rows = await session_rows(api, uid)
    # verification session + two signed-in devices: every one of them is revoked
    assert len(rows) == 3 and all(r.revoked_at is not None and r.revoke_reason == "suspended" for r in rows)

    refused = await login(api.client, email)
    assert refused.status_code == 403 and refused.json()["code"] == "account_suspended"

    stored = await load_user(api, email)
    assert stored.is_active is False and stored.suspended_by_id == (await load_user(api, admin_email)).id


async def test_reactivation_restores_login_but_not_old_sessions_and_clears_the_record(api):
    _, admin = await make_admin(api)
    email, old_headers, uid = await make_user(api)
    await api.client.post(f"/api/admin/users/{uid}/suspend", headers=admin, json={"reason": "temporary hold"})

    res = await api.client.post(f"/api/admin/users/{uid}/reactivate", headers=admin, json={"reason": "cleared after review"})
    assert res.status_code == 200 and res.json()["is_active"] is True
    assert res.json()["suspension_reason"] is None and res.json()["suspended_at"] is None and res.json()["suspended_by_id"] is None

    assert (await api.client.get("/api/users/me", headers=old_headers)).status_code == 401   # old token stays dead
    fresh = await login(api.client, email, bearer=True)
    assert fresh.status_code == 200
    ok = await api.client.get("/api/users/me", headers={"Authorization": f"Bearer {fresh.json()['access_token']}"})
    assert ok.status_code == 200


async def test_suspend_and_reactivate_rules(api):
    admin_email, admin = await make_admin(api)
    admin_id = (await load_user(api, admin_email)).id
    _, _, uid = await make_user(api)

    # reason is required and validated
    for body in ({}, {"reason": ""}, {"reason": "  "}, {"reason": "ab"}, {"reason": "x" * 501},
                 {"reason": "bad\x00reason"}, {"reason": "fine reason", "role": "admin"}, {"reason": 5}):
        res = await api.client.post(f"/api/admin/users/{uid}/suspend", headers=admin, json=body)
        assert res.status_code == 422, body
    assert (await load_user(api, (await _email_of(api, uid)))).is_active is True

    assert (await api.client.post(f"/api/admin/users/{uuid.uuid4()}/suspend", headers=admin,
                                  json={"reason": "no such user"})).status_code == 404
    # an administrator cannot suspend or reactivate themselves
    res = await api.client.post(f"/api/admin/users/{admin_id}/suspend", headers=admin, json={"reason": "oops by mistake"})
    assert res.status_code == 403 and res.json()["code"] == "self_action_forbidden"

    assert (await api.client.post(f"/api/admin/users/{uid}/reactivate", headers=admin, json={})).status_code == 409
    assert (await api.client.post(f"/api/admin/users/{uid}/suspend", headers=admin, json={"reason": "first time"})).status_code == 200
    again = await api.client.post(f"/api/admin/users/{uid}/suspend", headers=admin, json={"reason": "second time"})
    assert again.status_code == 409 and again.json()["code"] == "already_suspended"
    assert len(await audit_for(api, "user.suspend", uid)) == 1                  # failed attempts write nothing


async def _email_of(api, uid) -> str:
    async with api.db() as db:
        return (await db.execute(select(User.email).where(User.id == uid))).scalar_one()


async def test_an_administrator_can_suspend_another_administrator_who_then_loses_access(api):
    _, first = await make_admin(api)
    second_email, second = await make_admin(api)
    second_id = (await load_user(api, second_email)).id
    assert (await api.client.get("/api/admin/users", headers=second)).status_code == 200
    res = await api.client.post(f"/api/admin/users/{second_id}/suspend", headers=first, json={"reason": "security incident"})
    assert res.status_code == 200
    assert (await api.client.get("/api/admin/users", headers=second)).status_code == 401


async def test_cookie_authenticated_changes_need_the_csrf_token(api):
    admin_email, _ = await make_admin(api)
    _, _, uid = await make_user(api)
    res = await login(api.client, admin_email, ADMIN_PASSWORD)                     # browser-style: cookie only
    assert res.status_code == 200
    csrf = res.json()["csrf_token"]
    url = f"/api/admin/users/{uid}/suspend"
    body = {"reason": "csrf check"}
    refused = await api.client.post(url, json=body)
    assert refused.status_code == 403 and refused.json()["code"] == "csrf_failed"
    refused = await api.client.post(url, json=body, headers={"X-CSRF-Token": "wrong"})
    assert refused.status_code == 403
    assert (await load_user(api, await _email_of(api, uid))).is_active is True
    assert (await api.client.post(url, json=body, headers={"X-CSRF-Token": csrf})).status_code == 200


# ---------------------------------------------------------------------------- role changes
async def test_role_change_is_audited_revokes_sessions_and_takes_effect_immediately(api):
    _, admin = await make_admin(api)
    email, user_headers, uid = await make_user(api, "bidder")
    res = await api.client.post(f"/api/admin/users/{uid}/role", headers=admin,
                                json={"role": "seller", "reason": "Converted to consignor"})
    assert res.status_code == 200 and res.json()["role"] == "seller"
    assert (await api.client.get("/api/users/me", headers=user_headers)).status_code == 401       # old session revoked
    rows = await session_rows(api, uid)
    assert all(r.revoked_at is not None and r.revoke_reason == "role_changed" for r in rows)
    fresh = await bearer_headers(api, email)
    assert (await api.client.get("/api/users/me", headers=fresh)).json()["role"] == "seller"

    entry = (await audit_for(api, "user.role_change", uid))[0]
    assert entry.details["old_role"] == "bidder" and entry.details["new_role"] == "seller"
    assert entry.details["reason"] == "Converted to consignor" and entry.actor_role == "admin"


async def test_role_change_cannot_grant_admin_or_target_oneself_or_use_unknown_roles(api):
    admin_email, admin = await make_admin(api)
    admin_id = (await load_user(api, admin_email)).id
    _, _, uid = await make_user(api, "bidder")
    url = f"/api/admin/users/{uid}/role"
    for body in ({"role": "admin", "reason": "promote please"}, {"role": "superuser", "reason": "valid reason"},
                 {"role": "seller"}, {"role": "seller", "reason": "x"}, {"reason": "valid reason"},
                 {"role": "seller", "reason": "valid reason", "is_active": False}):
        assert (await api.client.post(url, headers=admin, json=body)).status_code == 422, body
    assert (await load_user(api, await _email_of(api, uid))).role == "bidder"

    same = await api.client.post(url, headers=admin, json={"role": "bidder", "reason": "no actual change"})
    assert same.status_code == 409 and same.json()["code"] == "role_unchanged"
    own = await api.client.post(f"/api/admin/users/{admin_id}/role", headers=admin, json={"role": "bidder", "reason": "demote myself"})
    assert own.status_code == 403 and own.json()["code"] == "self_action_forbidden"
    assert (await load_user(api, admin_email)).role == "admin"
    assert (await audit_for(api, "user.role_change", uid)) == []


async def test_demoting_another_administrator_removes_admin_rights_and_sessions(api):
    _, first = await make_admin(api)
    second_email, second = await make_admin(api)
    second_id = (await load_user(api, second_email)).id
    res = await api.client.post(f"/api/admin/users/{second_id}/role", headers=first,
                                json={"role": "bidder", "reason": "left the organisation"})
    assert res.status_code == 200 and res.json()["role"] == "bidder"
    assert (await api.client.get("/api/admin/users", headers=second)).status_code == 401
    relogin = await bearer_headers(api, second_email, ADMIN_PASSWORD)
    assert (await api.client.get("/api/admin/users", headers=relogin)).status_code == 403


# ---------------------------------------------------------------------------- audit & transactions
async def test_every_account_action_writes_one_audit_record_with_the_actor(api):
    admin_email, admin = await make_admin(api)
    admin_id = (await load_user(api, admin_email)).id
    _, _, uid = await make_user(api)
    await api.client.post(f"/api/admin/users/{uid}/suspend", headers=admin, json={"reason": "policy breach"})
    await api.client.post(f"/api/admin/users/{uid}/reactivate", headers=admin, json={"reason": "appeal accepted"})
    await api.client.post(f"/api/admin/users/{uid}/role", headers=admin, json={"role": "seller", "reason": "role request"})

    suspend, = await audit_for(api, "user.suspend", uid)
    reactivate, = await audit_for(api, "user.reactivate", uid)
    role, = await audit_for(api, "user.role_change", uid)
    for entry in (suspend, reactivate, role):
        assert entry.actor_id == admin_id and entry.actor_role == "admin" and entry.target_type == "user"
    assert suspend.details["reason"] == "policy breach" and suspend.details["sessions_revoked"] == 2   # verification + sign-in
    assert reactivate.details["reason"] == "appeal accepted"

    listed = (await api.client.get(f"/api/admin/audit-logs?target_id={uid}", headers=admin)).json()
    assert {i["action"] for i in listed["items"]} == {"user.suspend", "user.reactivate", "user.role_change"}
    assert not any(any(k in str(i["details"]).lower() for k in ("hash", "token", "password")) for i in listed["items"])


@pytest.mark.parametrize("path,body,flip", [
    ("suspend", {"reason": "atomicity check"}, "suspend"),
    ("role", {"role": "seller", "reason": "atomicity check"}, "role"),
])
async def test_if_the_audit_write_fails_nothing_else_is_saved(api, monkeypatch, path, body, flip):
    """The audit entry and the change share one transaction: a failing audit write undoes the change."""
    _, admin = await make_admin(api)
    email, user_headers, uid = await make_user(api)

    async def broken(*args, **kwargs):
        raise RuntimeError("audit store unavailable")

    monkeypatch.setattr("app.services.user_management.record_audit", broken)
    with pytest.raises(RuntimeError):
        await api.client.post(f"/api/admin/users/{uid}/{path}", headers=admin, json=body)
    monkeypatch.undo()

    stored = await load_user(api, email)
    assert stored.is_active is True and stored.role == "bidder" and stored.suspension_reason is None
    assert all(r.revoked_at is None for r in await session_rows(api, uid))        # revocation rolled back too
    assert (await api.client.get("/api/users/me", headers=user_headers)).status_code == 200
    assert await audit_for(api, f"user.{'suspend' if flip == 'suspend' else 'role_change'}", uid) == []


# ---------------------------------------------------------------------------- own profile
async def test_get_and_update_own_profile(api):
    email, headers, uid = await make_user(api, name="Original Name", mobile="9876543210")
    me = (await api.client.get("/api/users/me", headers=headers)).json()
    assert me["email"] == email and me["name"] == "Original Name"
    assert not SECRET_FIELDS & set(me) and "suspension_reason" not in me

    res = await api.client.patch("/api/users/me", headers=headers,
                                 json={"name": "  New Name  ", "organization": "Acme Salvage", "mobile": "+91 99999 88888"})
    assert res.status_code == 200
    assert res.json()["name"] == "New Name" and res.json()["organization"] == "Acme Salvage"
    stored = await load_user(api, email)
    assert stored.name == "New Name" and stored.mobile == "+91 99999 88888" and stored.organization == "Acme Salvage"

    only_one = await api.client.patch("/api/users/me", headers=headers, json={"organization": ""})   # partial update
    assert only_one.status_code == 200 and (await load_user(api, email)).name == "New Name"
    assert (await load_user(api, email)).organization == ""


@pytest.mark.parametrize("body", [
    {"role": "admin"}, {"is_active": False}, {"is_active": True}, {"kyc_status": "verified"},
    {"is_email_verified": True}, {"email": "other@salvex-test.in"}, {"password_hash": "x"}, {"id": str(uuid.uuid4())},
    {"suspended_at": "2026-01-01T00:00:00Z"}, {"suspension_reason": "x"}, {"created_at": "2020-01-01T00:00:00Z"},
    {"name": "Fine Name", "role": "admin"},                      # one allowed field cannot smuggle in a forbidden one
])
async def test_protected_profile_fields_cannot_be_edited(api, body):
    email, headers, _ = await make_user(api, name="Keep This Name")
    before = await load_user(api, email)
    res = await api.client.patch("/api/users/me", headers=headers, json=body)
    assert res.status_code == 422 and res.json()["code"] == "validation_error"
    after = await load_user(api, email)
    for field in ("name", "email", "role", "is_active", "kyc_status", "is_email_verified", "suspended_at",
                  "suspension_reason", "password_hash", "id", "created_at"):
        assert getattr(after, field) == getattr(before, field), field


@pytest.mark.parametrize("body", [
    {}, {"name": None}, {"name": "A"}, {"name": "<script>"}, {"name": "x" * 101}, {"mobile": "abc"}, {"mobile": "123"},
    {"organization": "<b>"}, {"organization": "x" * 256}, {"name": 5}, {"name": "Bad\x00Name"},
])
async def test_invalid_profile_values_are_rejected(api, body):
    email, headers, _ = await make_user(api, name="Stay Same")
    assert (await api.client.patch("/api/users/me", headers=headers, json=body)).status_code == 422
    assert (await load_user(api, email)).name == "Stay Same"


async def test_profile_update_needs_csrf_for_cookie_sessions_and_fails_for_suspended_users(api):
    admin_email, admin = await make_admin(api)
    email = new_email("cookie")
    await register_and_verify(api, email)
    res = await login(api.client, email)
    csrf = res.json()["csrf_token"]
    refused = await api.client.patch("/api/users/me", json={"name": "Cookie Name"})
    assert refused.status_code == 403 and refused.json()["code"] == "csrf_failed"
    assert (await load_user(api, email)).name == "Api Test User"
    ok = await api.client.patch("/api/users/me", json={"name": "Cookie Name"}, headers={"X-CSRF-Token": csrf})
    assert ok.status_code == 200

    uid = (await load_user(api, email)).id
    await api.client.post(f"/api/admin/users/{uid}/suspend", headers=admin, json={"reason": "profile test"})
    gone = await api.client.patch("/api/users/me", json={"name": "After Suspension"}, headers={"X-CSRF-Token": csrf})
    assert gone.status_code == 401
    assert (await load_user(api, email)).name == "Cookie Name"


# ---------------------------------------------------------------------------- review regressions
async def _admin_count(api) -> int:
    from sqlalchemy import func
    async with api.db() as db:
        return (await db.execute(select(func.count()).select_from(User).where(User.role == "admin"))).scalar_one()


async def test_no_client_request_can_make_anyone_an_administrator(api):
    """Try every client-controlled way to obtain the admin role; none may change the number of admins."""
    _, admin = await make_admin(api)
    email, headers, uid = await make_user(api, "bidder")
    before = await _admin_count(api)

    for role in ("admin", "Admin", " admin", "ADMIN", "superuser"):
        fresh = new_email("escalate")
        res = await api.client.post("/api/auth/register", json={
            "name": "Escalation Try", "email": fresh, "password": PASSWORD, "role": role, "mobile": "+91 98765 43210"})
        assert res.status_code == 422, role
    # re-registering an existing UNVERIFIED address replaces its role, but only with bidder/seller
    pending = new_email("pending")
    assert (await api.client.post("/api/auth/register", json={
        "name": "Pending User", "email": pending, "password": PASSWORD, "role": "seller", "mobile": "+91 98765 43210"})).status_code == 201
    assert (await api.client.post("/api/auth/register", json={
        "name": "Pending User", "email": pending, "password": PASSWORD, "role": "admin", "mobile": "+91 98765 43210"})).status_code == 422
    assert (await load_user(api, pending)).role == "seller"

    assert (await api.client.patch("/api/users/me", headers=headers, json={"role": "admin"})).status_code == 422
    assert (await api.client.post(f"/api/admin/users/{uid}/role", headers=admin,
                                  json={"role": "admin", "reason": "please promote"})).status_code == 422
    # the role header/claim in a token is never trusted: a bidder token cannot reach admin routes
    assert (await api.client.get("/api/admin/users", headers=headers)).status_code == 403

    assert await _admin_count(api) == before
    assert (await load_user(api, email)).role == "bidder"


async def test_the_service_refuses_to_grant_admin_even_if_the_schema_were_bypassed(api):
    from app.core.errors import ApiError
    from app.services.user_management import change_role
    admin_email, _ = await make_admin(api)
    email, _, uid = await make_user(api)
    async with api.db() as db:
        actor = (await db.execute(select(User).where(User.email == admin_email))).scalar_one()
        with pytest.raises(ApiError) as refused:
            await change_role(db, actor, uid, "admin", "bypass attempt")
        assert refused.value.status_code == 403 and refused.value.code == "admin_grant_forbidden"
        await db.rollback()
    assert (await load_user(api, email)).role == "bidder"


@pytest.mark.parametrize("change", ["suspend", "demote"])
async def test_an_admin_who_loses_rights_while_a_request_is_in_flight_is_refused(api, change):
    """
    The acting admin passed the access check, then (before the action locked its rows) was suspended or
    demoted by someone else. The action must be refused, not carried out on stale rights.
    """
    from app.core.errors import ApiError
    from app.services.user_management import reactivate_user, suspend_user
    actor_email, _ = await make_admin(api)
    _, _, target_id = await make_user(api)
    _, _, suspended_id = await make_user(api)

    async with api.db() as request_db:
        actor = (await request_db.execute(select(User).where(User.email == actor_email))).scalar_one()
        assert actor.role == "admin" and actor.is_active          # what the access check saw
        async with api.db() as other:                              # meanwhile, another admin acts
            row = (await other.execute(select(User).where(User.email == actor_email))).scalar_one()
            if change == "suspend":
                row.is_active = False
            else:
                row.role = "bidder"
            await other.commit()
        for action, target in ((suspend_user, target_id), (reactivate_user, suspended_id)):
            with pytest.raises(ApiError) as refused:
                await action(request_db, actor, target, "stale rights")
            assert refused.value.status_code == 403 and refused.value.code == "forbidden"
        await request_db.rollback()
    assert (await load_user(api, await _email_of(api, target_id))).is_active is True


def test_last_admin_guard_refuses_to_remove_the_only_active_admin():
    from app.core.errors import ApiError
    from app.services.user_management import _guard_last_admin
    only = User(id=uuid.uuid4(), role="admin", is_active=True)
    other = User(id=uuid.uuid4(), role="admin", is_active=True)
    with pytest.raises(ApiError) as refused:
        _guard_last_admin(only, [only])
    assert refused.value.status_code == 409 and refused.value.code == "last_admin"
    _guard_last_admin(only, [only, other])                              # another active admin: allowed
    _guard_last_admin(User(id=uuid.uuid4(), role="seller", is_active=True), [only])   # not an admin


async def test_reactivation_does_not_revive_sessions_and_role_change_revokes_only_the_target(api):
    _, admin = await make_admin(api)
    _, target_headers, target_id = await make_user(api)
    _, bystander_headers, _ = await make_user(api)
    await api.client.post(f"/api/admin/users/{target_id}/role", headers=admin, json={"role": "seller", "reason": "move"})
    assert (await api.client.get("/api/users/me", headers=target_headers)).status_code == 401
    assert (await api.client.get("/api/users/me", headers=bystander_headers)).status_code == 200   # others untouched
    assert (await api.client.get("/api/admin/users", headers=admin)).status_code == 200            # actor untouched


async def test_session_count_ignores_idle_sessions(api):
    from datetime import datetime, timedelta, timezone
    from app.core.config import settings
    _, admin = await make_admin(api)
    email, _, uid = await make_user(api)
    await bearer_headers(api, email)                                          # a second live session
    # verification session + two sign-ins
    assert (await api.client.get(f"/api/admin/users/{uid}", headers=admin)).json()["active_session_count"] == 3
    async with api.db() as db:
        session = (await db.execute(select(AuthSession).where(AuthSession.user_id == uid))).scalars().first()
        session.last_seen_at = datetime.now(timezone.utc) - timedelta(minutes=settings.SESSION_IDLE_TIMEOUT_MINUTES + 1)
        await db.commit()
    assert (await api.client.get(f"/api/admin/users/{uid}", headers=admin)).json()["active_session_count"] == 2
