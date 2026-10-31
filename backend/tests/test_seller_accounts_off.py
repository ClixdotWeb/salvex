"""
The client's flow: no public seller accounts; only administrators add vehicles.
"""
import pytest

from app.core.config import settings
from helpers import new_email
from test_admin_foundation import make_admin
from test_users_admin import make_user

GOOD = {"name": "Asha Menon", "password": "Str0ng-Passw0rd!", "mobile": "+91 98765 43210"}


@pytest.fixture
def sellers_off(monkeypatch):
    monkeypatch.setattr(settings, "SELLER_ACCOUNTS", False)


async def test_nobody_can_register_as_a_seller(api, sellers_off):
    assert (await api.client.get("/api/site-config")).json()["seller_accounts"] is False
    res = await api.client.post("/api/auth/register", json={**GOOD, "email": new_email("s"), "role": "seller"})
    assert res.status_code == 422 and res.json()["code"] == "seller_accounts_off"
    ok = await api.client.post("/api/auth/register", json={**GOOD, "email": new_email("b"), "role": "bidder"})
    assert ok.status_code in (200, 201)
    default = await api.client.post("/api/auth/register", json={**GOOD, "email": new_email("d")})
    assert default.status_code in (200, 201)


async def test_admins_cannot_turn_a_user_into_a_seller(api, sellers_off):
    _, admin = await make_admin(api)
    _, user, uid = await make_user(api)
    res = await api.client.post(f"/api/admin/users/{uid}/role", headers=admin, json={"role": "seller", "reason": "Wants to sell"})
    assert res.status_code == 422 and res.json()["code"] == "seller_accounts_off"
    # bidders still cannot add vehicles
    assert (await api.client.post("/api/vehicles", headers=user, json={})).status_code in (403, 422)
