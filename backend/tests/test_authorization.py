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


def role_escalation_problems(openapi: dict) -> list:
    """
    Every way a client could SEND a role value other than bidder/seller to a state-changing route.
    All request bodies (any content type, nested models, arrays, unions, $refs resolved) and every
    parameter of every non-GET route are inspected. A role field that accepts free text counts as a
    problem too. Response models are not inspected: showing that a user IS an admin grants nothing.
    """
    components = openapi.get("components", {}).get("schemas", {})
    problems = []

    def resolve(node):
        while isinstance(node, dict) and "$ref" in node:
            node = components[node["$ref"].rsplit("/", 1)[-1]]
        return node

    def role_values(node) -> list:
        node = resolve(node)
        if "enum" in node:
            return list(node["enum"])
        if "const" in node:
            return [node["const"]]
        options = node.get("anyOf") or node.get("oneOf") or node.get("allOf")
        if options:
            return [v for o in options if resolve(o).get("type") != "null" for v in role_values(o)]
        return ["<any text>"]

    def roles_in(node, seen) -> list:
        if isinstance(node, dict) and "$ref" in node:
            name = node["$ref"].rsplit("/", 1)[-1]
            if name in seen:
                return []
            seen = seen | {name}
        node = resolve(node)
        found = []
        for key, prop in node.get("properties", {}).items():
            if key.lower() == "role":
                found.append(role_values(prop))
            found += roles_in(prop, seen)
        for key in ("items", "additionalProperties"):
            if isinstance(node.get(key), dict):
                found += roles_in(node[key], seen)
        for key in ("anyOf", "oneOf", "allOf"):
            for option in node.get(key, []):
                found += roles_in(option, seen)
        return found

    for path, methods in openapi["paths"].items():
        for method, operation in methods.items():
            if method == "get":
                continue
            for content in operation.get("requestBody", {}).get("content", {}).values():
                for values in roles_in(content.get("schema", {}), frozenset()):
                    if not set(values) <= {"bidder", "seller"}:
                        problems.append(f"{method.upper()} {path} body role accepts {values}")
            for param in operation.get("parameters", []):
                if param["name"].lower() == "role":
                    problems.append(f"{method.upper()} {path} takes role as a {param['in']} parameter")
    return problems


async def test_no_public_endpoint_accepts_a_role_other_than_bidder_or_seller():
    schema = main_app.openapi()
    assert role_escalation_problems(schema) == []
    # The walk really reaches the role fields that exist, so the empty result above is not the checker
    # seeing nothing: allowing "admin" in either real request model is caught on the real route.
    import copy
    for model, route in (("UserRegisterRequest", "POST /api/auth/register"),
                         ("ChangeRoleRequest", "POST /api/admin/users/{user_id}/role")):
        tampered = copy.deepcopy(schema)
        tampered["components"]["schemas"][model]["properties"]["role"]["enum"].append("admin")
        assert any(p.startswith(route + " ") for p in role_escalation_problems(tampered)), model

    # Route inventory: a new state-changing admin route must be reviewed and added here on purpose.
    allowed_writes = {
        "/api/admin/users/{user_id}/suspend": {"post"},
        "/api/admin/users/{user_id}/reactivate": {"post"},
        "/api/admin/users/{user_id}/role": {"post"},
        "/api/admin/kyc/submissions/{submission_id}/decision": {"post"},
        "/api/admin/vehicles/{vehicle_id}/review": {"post"},
        "/api/admin/auctions": {"post"},
        "/api/admin/auctions/{auction_id}": {"patch"},
        "/api/admin/auctions/{auction_id}/pause": {"post"},
        "/api/admin/auctions/{auction_id}/resume": {"post"},
        "/api/admin/auctions/{auction_id}/extend": {"post"},
        "/api/admin/auctions/{auction_id}/cancel": {"post"},
        "/api/admin/auctions/{auction_id}/close": {"post"},
        "/api/admin/orders/{order_id}/confirm-payment": {"post"},
        "/api/admin/orders/{order_id}/reject-payment": {"post"},
        "/api/admin/orders/{order_id}/cancel": {"post"},
        "/api/admin/orders/{order_id}/complete": {"post"},
        "/api/admin/users/{user_id}/unblock-bidding": {"post"},
        "/api/admin/parts": {"post"},
        "/api/admin/parts/{part_id}": {"put"},
        "/api/admin/parts/{part_id}/photo": {"post"},
        "/api/admin/part-requests/{request_id}/update": {"post"},
        "/api/admin/contact-messages/{message_id}/update": {"post"},
        "/api/admin/orders/{order_id}/deal": {"patch"},
        "/api/admin/orders/{order_id}/fees": {"post"},
        "/api/admin/vehicles/{vehicle_id}/mark-sold": {"post"},
        "/api/admin/vehicles/{vehicle_id}/reopen": {"post"},
        "/api/admin/enquiries/{enquiry_id}/update": {"post"},
        "/api/admin/vehicles/bulk-check": {"post"},
        "/api/admin/vehicles/bulk-import": {"post"},
        "/api/admin/vehicles/bulk-publish": {"post"},
    }
    for path, methods in schema["paths"].items():
        if "admin" in path.lower():
            writes = set(methods) - {"get"}
            assert writes == allowed_writes.get(path, set()), path


def test_the_role_checker_catches_every_kind_of_escalation_route():
    """The checker above is only useful if it fails on unsafe routes; prove it with a throwaway app."""
    from typing import List, Literal, Optional, Union

    from fastapi import Header
    from pydantic import BaseModel

    class Safe(BaseModel):
        role: Literal["bidder", "seller"]

    class Direct(BaseModel):
        role: Literal["bidder", "seller", "admin"]

    class FreeText(BaseModel):
        role: str

    class Inner(BaseModel):
        role: Optional[Literal["admin"]] = None

    class Nested(BaseModel):
        profile: Inner

    class InList(BaseModel):
        people: List[Inner]

    class Alt(BaseModel):
        other: int

    bad = FastAPI()

    @bad.post("/safe")
    async def safe(body: Safe): ...

    @bad.get("/read")                      # a GET filter by role is a read, not an escalation
    async def read(role: Optional[str] = None): ...

    @bad.post("/direct")
    async def direct(body: Direct): ...

    @bad.patch("/free")
    async def free(body: FreeText): ...

    @bad.put("/nested")
    async def nested(body: Nested): ...

    @bad.post("/list")
    async def in_list(body: InList): ...

    @bad.post("/union")
    async def union(body: Union[Alt, Inner]): ...

    @bad.post("/query")
    async def query(role: str): ...

    @bad.post("/header")
    async def header(role: str = Header(...)): ...

    # (Form bodies are inspected the same way as JSON - every requestBody content type is walked - but
    # FastAPI cannot declare a Form route here without the python-multipart package, which is not installed.)
    problems = role_escalation_problems(bad.openapi())
    flagged = {p.split(" ")[1] for p in problems}
    assert flagged == {"/direct", "/free", "/nested", "/list", "/union", "/query", "/header"}, problems


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
