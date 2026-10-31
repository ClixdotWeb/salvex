"""
Module 1 foundation: the append-only audit trail, account-suspension fields, the admin router's
authorization and the shared pagination helper.

Everything runs on the isolated local test database inside a transaction that is always rolled back.
"""
import uuid

import pytest
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.exc import DBAPIError

from app.core.audit import AuditError, clean_details, record_audit
from app.core.config import settings
from app.main import app as main_app
from app.models.audit_log import AuditLog
from app.models.user import User
from app.services.admin_provisioning import provision_admin
from helpers import PASSWORD, login, new_email, register_and_verify, signed_in

ADMIN_PASSWORD = "a-long-admin-passphrase-2026"


async def bearer_headers(api, email: str, password: str = PASSWORD) -> dict:
    res = await login(api.client, email, password, bearer=True)
    assert res.status_code == 200, res.text
    api.client.cookies.clear()
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def make_admin(api) -> tuple[str, dict]:
    email = new_email("admin")
    async with api.db() as db:
        await provision_admin(db, email=email, name="Admin User", password=ADMIN_PASSWORD)
        await db.commit()
    return email, await bearer_headers(api, email, ADMIN_PASSWORD)


async def load_user(api, email: str) -> User:
    async with api.db() as db:
        return (await db.execute(select(User).where(User.email == email))).scalar_one()


async def seed_audit(api, admin_email: str, action: str, count: int = 1, target_type: str = "user") -> None:
    admin = await load_user(api, admin_email)
    async with api.db() as db:
        for i in range(count):
            await record_audit(db, actor=admin, action=action, target_type=target_type, target_id=f"t{i}", details={"n": i})
        await db.commit()


# ---------------------------------------------------------------------------- admin authorization
async def test_anonymous_callers_get_401_before_any_parameter_checking(api):
    for url in ("/api/admin/audit-logs", "/api/admin/audit-logs?page_size=100000&page=0"):
        res = await api.client.get(url)
        assert res.status_code == 401 and res.json()["code"] == "not_authenticated"


@pytest.mark.parametrize("role", ["bidder", "seller"])
async def test_ordinary_signed_in_users_get_403(api, role):
    email = new_email(role)
    await register_and_verify(api, email, role=role)
    res = await api.client.get("/api/admin/audit-logs", headers=await bearer_headers(api, email))
    assert res.status_code == 403 and res.json()["code"] == "forbidden"


async def test_an_administrator_can_read_the_audit_trail(api):
    _, headers = await make_admin(api)
    res = await api.client.get("/api/admin/audit-logs", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"items", "page", "page_size", "total", "pages"}
    assert body["page"] == 1 and body["page_size"] == 25


async def test_the_role_is_read_from_the_database_so_a_demoted_admin_loses_access_at_once(api):
    email, headers = await make_admin(api)
    assert (await api.client.get("/api/admin/audit-logs", headers=headers)).status_code == 200
    async with api.db() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        user.role = "bidder"
        await db.commit()
    assert (await api.client.get("/api/admin/audit-logs", headers=headers)).status_code == 403


async def test_a_suspended_administrator_is_refused(api):
    email, headers = await make_admin(api)
    async with api.db() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        user.is_active = False
        await db.commit()
    assert (await api.client.get("/api/admin/audit-logs", headers=headers)).status_code == 401


async def test_every_route_under_api_admin_denies_anonymous_and_ordinary_users(api):
    """Deny-by-default: a route added to the admin router later is checked here automatically."""
    paths = [(p, m) for p, methods in main_app.openapi()["paths"].items() if p.startswith("/api/admin") for m in methods]
    assert paths, "the admin router must be mounted"
    bidder = new_email("bidder")
    await register_and_verify(api, bidder)
    bidder_headers = await bearer_headers(api, bidder)
    for path, method in paths:
        url = path.replace("{", "").replace("}", "") if "{" not in path else path
        for part in [seg for seg in path.split("/") if seg.startswith("{")]:
            url = url.replace(part, str(uuid.uuid4()))
        anonymous = await api.client.request(method.upper(), url, json={} if method != "get" else None)
        assert anonymous.status_code == 401, (method, path)
        ordinary = await api.client.request(method.upper(), url, headers=bidder_headers, json={} if method != "get" else None)
        assert ordinary.status_code == 403, (method, path)


# ---------------------------------------------------------------------------- pagination
async def test_pagination_pages_filters_and_ordering(api):
    admin_email, headers = await make_admin(api)
    action = "test.paginate_" + uuid.uuid4().hex[:8]
    await seed_audit(api, admin_email, action, count=5)

    first = (await api.client.get(f"/api/admin/audit-logs?action={action}&page_size=2", headers=headers)).json()
    assert first["total"] == 5 and first["pages"] == 3 and len(first["items"]) == 2
    last = (await api.client.get(f"/api/admin/audit-logs?action={action}&page_size=2&page=3", headers=headers)).json()
    assert len(last["items"]) == 1
    beyond = (await api.client.get(f"/api/admin/audit-logs?action={action}&page_size=2&page=9", headers=headers)).json()
    assert beyond["items"] == [] and beyond["total"] == 5

    stamps = [item["created_at"] for item in first["items"]]
    assert stamps == sorted(stamps, reverse=True)            # newest first

    other = (await api.client.get("/api/admin/audit-logs?action=test.nothing_here", headers=headers)).json()
    assert other["total"] == 0 and other["pages"] == 0


async def test_pagination_limits_are_enforced(api):
    _, headers = await make_admin(api)
    for query in ("page_size=101", "page_size=0", "page=0", "page=abc", "page=100001"):
        res = await api.client.get(f"/api/admin/audit-logs?{query}", headers=headers)
        assert res.status_code == 422, query
        assert res.json()["code"] == "validation_error"


async def test_filters_accept_only_plain_identifiers(api):
    _, headers = await make_admin(api)
    for query in ("action=x'%20OR%201=1", "target_type=a%20b", "target_id=" + "a" * 65, "action=" + "a" * 65):
        res = await api.client.get(f"/api/admin/audit-logs?{query}", headers=headers)
        assert res.status_code == 422, query


async def test_audit_entries_expose_only_the_expected_fields(api):
    admin_email, headers = await make_admin(api)
    action = "test.fields_" + uuid.uuid4().hex[:8]
    await seed_audit(api, admin_email, action)
    item = (await api.client.get(f"/api/admin/audit-logs?action={action}", headers=headers)).json()["items"][0]
    assert set(item) == {"id", "created_at", "actor_id", "actor_role", "action", "target_type", "target_id", "details"}
    assert item["actor_role"] == "admin" and item["details"] == {"n": 0}


# ---------------------------------------------------------------------------- audit trail rules
async def test_the_audit_entry_and_the_action_are_one_transaction(api):
    """record_audit never commits: rolling the session back removes both the change and its entry."""
    admin_email, _ = await make_admin(api)
    admin = await load_user(api, admin_email)
    target_email = new_email("target")
    await register_and_verify(api, target_email)
    action = "test.atomic_" + uuid.uuid4().hex[:8]

    async with api.db() as db:
        target = (await db.execute(select(User).where(User.email == target_email))).scalar_one()
        target.is_active = False
        await record_audit(db, actor=admin, action=action, target_type="user", target_id=target.id, details={"reason": "test"})
        await db.rollback()                                    # the action failed after the audit call

    async with api.db() as db:
        assert (await db.execute(select(AuditLog).where(AuditLog.action == action))).first() is None
        assert (await db.execute(select(User.is_active).where(User.email == target_email))).scalar_one() is True

    async with api.db() as db:                                 # and when it succeeds, both are stored together
        target = (await db.execute(select(User).where(User.email == target_email))).scalar_one()
        target.is_active = False
        await record_audit(db, actor=admin, action=action, target_type="user", target_id=target.id, details={"reason": "test"})
        await db.commit()
    async with api.db() as db:
        entry = (await db.execute(select(AuditLog).where(AuditLog.action == action))).scalar_one()
        assert entry.actor_id == admin.id and entry.actor_role == "admin" and entry.details == {"reason": "test"}
        assert (await db.execute(select(User.is_active).where(User.email == target_email))).scalar_one() is False


async def test_system_actions_have_no_actor(api):
    action = "test.system_" + uuid.uuid4().hex[:8]
    async with api.db() as db:
        entry = await record_audit(db, actor=None, action=action, target_type="auction", target_id=7)
        await db.commit()
        assert entry.actor_id is None and entry.actor_role == "system" and entry.target_id == "7"


async def _assert_rejected(api, sql: str, params: dict) -> None:
    async with api.db() as db:
        with pytest.raises(DBAPIError) as caught:
            await db.execute(text(sql), params)
        assert "append-only" in str(caught.value)
        await db.rollback()


async def test_audit_history_cannot_be_updated_deleted_or_truncated(api):
    admin_email, _ = await make_admin(api)
    action = "test.immutable_" + uuid.uuid4().hex[:8]
    await seed_audit(api, admin_email, action)
    async with api.db() as db:
        entry_id = (await db.execute(select(AuditLog.id).where(AuditLog.action == action))).scalar_one()

    await _assert_rejected(api, "UPDATE audit_logs SET action = 'tampered.action' WHERE id = :i", {"i": entry_id})
    await _assert_rejected(api, "UPDATE audit_logs SET details = '{}'::jsonb WHERE id = :i", {"i": entry_id})
    await _assert_rejected(api, "DELETE FROM audit_logs WHERE id = :i", {"i": entry_id})
    await _assert_rejected(api, "DELETE FROM audit_logs", {})
    await _assert_rejected(api, "TRUNCATE audit_logs", {})

    async with api.db() as db:                                 # the entry is still there, unchanged
        entry = (await db.execute(select(AuditLog).where(AuditLog.id == entry_id))).scalar_one()
        assert entry.action == action and entry.details == {"n": 0}


async def test_a_user_with_audit_history_cannot_be_hard_deleted(api):
    admin_email, _ = await make_admin(api)
    await seed_audit(api, admin_email, "test.restrict_" + uuid.uuid4().hex[:8])
    admin = await load_user(api, admin_email)
    async with api.db() as db:
        with pytest.raises(DBAPIError):
            await db.execute(text("DELETE FROM users WHERE id = :i"), {"i": admin.id})
        await db.rollback()


@pytest.mark.parametrize("key", [
    "password", "new_password", "passwd", "secret", "client_secret", "access_token", "refresh_token",
    "otp", "OTP_code", "token_hash", "password_hash", "api_key", "apiKey", "Authorization", "cookie",
    "csrf", "csrf_token", "credentials", "private_key", "session_id",
])
def test_secret_looking_detail_keys_are_refused(key):
    with pytest.raises(AuditError):
        clean_details({key: "x"})
    with pytest.raises(AuditError):
        clean_details({"outer": {"inner": [{key: "x"}]}})        # also when nested


def test_details_are_validated_and_normalised():
    assert clean_details(None) == {}
    ident = uuid.uuid4()
    assert clean_details({"old": "bidder", "new": "seller", "id": ident, "n": 3, "ok": True, "none": None}) == {
        "old": "bidder", "new": "seller", "id": str(ident), "n": 3, "ok": True, "none": None,
    }
    assert len(clean_details({"reason": "x" * 2000})["reason"]) == 500          # long text is cut, not stored whole
    with pytest.raises(AuditError):
        clean_details({"blob": object()})
    with pytest.raises(AuditError):
        clean_details("not a dict")                                              # type: ignore[arg-type]
    with pytest.raises(AuditError):
        clean_details({1: "numeric key"})                                        # type: ignore[dict-item]
    with pytest.raises(AuditError):
        clean_details({"a": {"b": {"c": {"d": {"e": {"f": 1}}}}}})               # nested too deeply
    with pytest.raises(AuditError):
        clean_details({f"k{i}": "v" * 400 for i in range(20)})                   # too large overall


@pytest.mark.parametrize("action", ["", "Suspend", "user", "user.Suspend", "user suspend", "user.suspend;drop", "a." + "b" * 70])
async def test_malformed_action_names_are_refused(api, action):
    async with api.db() as db:
        with pytest.raises(AuditError):
            await record_audit(db, actor=None, action=action, target_type="user")


async def test_target_type_is_required(api):
    async with api.db() as db:
        with pytest.raises(AuditError):
            await record_audit(db, actor=None, action="user.suspend", target_type="")


# ---------------------------------------------------------------------------- suspension fields
async def test_new_accounts_have_no_suspension_record(api):
    email = new_email("fresh")
    await register_and_verify(api, email)
    user = await load_user(api, email)
    assert user.suspended_at is None and user.suspension_reason is None and user.suspended_by_id is None
    assert user.is_active is True


async def test_suspension_fields_can_be_stored_and_a_suspended_account_cannot_sign_in(api):
    admin_email, _ = await make_admin(api)
    admin = await load_user(api, admin_email)
    email, _csrf = await signed_in(api)
    assert (await api.client.get("/api/auth/me")).status_code == 200

    from datetime import datetime, timezone
    async with api.db() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one()
        user.is_active = False
        user.suspended_at = datetime.now(timezone.utc)
        user.suspension_reason = "Test suspension"
        user.suspended_by_id = admin.id
        await db.commit()

    assert (await api.client.get("/api/auth/me")).status_code == 401           # the existing session stops working
    stored = await load_user(api, email)
    assert stored.suspension_reason == "Test suspension" and stored.suspended_by_id == admin.id
    assert (await login(api.client, email)).status_code in (401, 403)           # and signing in again is refused


async def test_suspension_details_are_never_returned_to_the_user(api):
    await signed_in(api)
    body = (await api.client.get("/api/auth/me")).json()
    assert not {"suspended_at", "suspension_reason", "suspended_by_id"} & set(body)


# ---------------------------------------------------------------------------- database layout
def test_audit_log_table_layout_and_triggers():
    engine = create_engine(settings.sync_database_url)           # the isolated test database
    try:
        inspector = inspect(engine)
        columns = {c["name"]: c for c in inspector.get_columns("audit_logs")}
        assert set(columns) == {"id", "created_at", "actor_id", "actor_role", "action", "target_type", "target_id", "details"}
        for required in ("created_at", "actor_role", "action", "target_type", "details"):
            assert not columns[required]["nullable"], required
        assert columns["actor_id"]["nullable"] and columns["target_id"]["nullable"]
        fk = inspector.get_foreign_keys("audit_logs")[0]
        assert fk["referred_table"] == "users" and fk["options"].get("ondelete") == "RESTRICT"
        indexed = {tuple(i["column_names"]) for i in inspector.get_indexes("audit_logs")}
        assert {("action",), ("actor_id",), ("created_at",), ("target_type", "target_id")} <= indexed
        with engine.connect() as conn:
            triggers = {r[0] for r in conn.execute(text(
                "select tgname from pg_trigger where tgrelid = 'audit_logs'::regclass and not tgisinternal"))}
        assert triggers == {"audit_logs_no_update_delete", "audit_logs_no_truncate"}
    finally:
        engine.dispose()


def test_user_suspension_columns_are_optional_and_linked_to_users():
    engine = create_engine(settings.sync_database_url)
    try:
        inspector = inspect(engine)
        columns = {c["name"]: c for c in inspector.get_columns("users")}
        for name in ("suspended_at", "suspension_reason", "suspended_by_id"):
            assert columns[name]["nullable"], name
        fks = [f for f in inspector.get_foreign_keys("users") if f["constrained_columns"] == ["suspended_by_id"]]
        assert fks and fks[0]["referred_table"] == "users" and fks[0]["options"].get("ondelete") == "SET NULL"
    finally:
        engine.dispose()
