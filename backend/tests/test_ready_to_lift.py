"""
Ready to Lift: admin-only listing without auction or price; buyers say "I'm interested"; admins handle enquiries.
"""
from sqlalchemy import select

from app.models.notification import Notification
from test_admin_foundation import load_user, make_admin
from test_auctions import new_auction, at
from test_kyc import storage  # noqa: F401  (fixture)
from test_users_admin import make_user
from test_vehicles import add_photo, create, review

RTL = {"listing_type": "ready_to_lift", "km_driven": 48210, "superdari": False}


async def rtl_vehicle(api, admin, **extra) -> str:
    res = await create(api, admin, **{**RTL, **extra})
    assert res.status_code == 201, res.text
    vid = res.json()["id"]
    assert (await add_photo(api, admin, vid)).status_code == 201
    assert (await api.client.post(f"/api/vehicles/{vid}/submit", headers=admin)).status_code == 200
    assert (await review(api, admin, vid, "approve")).status_code == 200
    return vid


async def test_ready_to_lift_needs_km_and_superdari_and_is_never_auctioned(api, storage):
    _, admin = await make_admin(api)
    for missing in ({"km_driven": None}, {"superdari": None}):
        assert (await create(api, admin, **{**RTL, **missing})).status_code == 422, missing
    assert (await create(api, admin, **{**RTL, "km_driven": -1})).status_code == 422
    vid = await rtl_vehicle(api, admin)
    refused = await new_auction(api, admin, vid, starts_at=at(5), ends_at=at(60))
    assert refused.status_code == 409 and refused.json()["code"] == "ready_to_lift_not_auctioned"


async def test_public_list_has_no_price_and_hides_sold_vehicles(api, storage):
    _, admin = await make_admin(api)
    vid = await rtl_vehicle(api, admin, make="Toyota", model="Innova")
    listed = (await api.client.get("/api/ready-to-lift?page_size=100")).json()["items"]
    card = next(v for v in listed if v["id"] == vid)
    assert card["km_driven"] == 48210 and card["superdari"] is False and card["listing_type"] == "ready_to_lift"
    assert card["auction"] is None and "claim_number" not in card and "*" not in card["registration_number"]
    assert any(v["id"] == vid for v in (await api.client.get("/api/ready-to-lift?q=innova")).json()["items"])
    assert any(v["id"] == vid for v in (await api.client.get(
        "/api/catalogue/vehicles?listing_type=ready_to_lift&page_size=100")).json()["items"])

    sold = await api.client.post(f"/api/admin/vehicles/{vid}/mark-sold", headers=admin, json={"reason": "Sold to buyer"})
    assert sold.status_code == 200 and sold.json()["sold_at"]
    assert all(v["id"] != vid for v in (await api.client.get("/api/ready-to-lift?page_size=100")).json()["items"])
    assert all(v["id"] != vid for v in (await api.client.get("/api/catalogue/vehicles?page_size=100")).json()["items"])
    assert (await api.client.post(f"/api/admin/vehicles/{vid}/mark-sold", headers=admin, json={})).status_code == 409
    assert (await api.client.post(f"/api/admin/vehicles/{vid}/reopen", headers=admin, json={})).status_code == 200
    assert any(v["id"] == vid for v in (await api.client.get("/api/ready-to-lift?page_size=100")).json()["items"])


async def test_interest_notifies_admins_once_and_admins_handle_it(api, storage):
    admin_email, admin = await make_admin(api)
    admin_id = (await load_user(api, admin_email)).id
    vid = await rtl_vehicle(api, admin)
    _, buyer, buyer_id = await make_user(api)

    url = f"/api/ready-to-lift/{vid}/interest"
    assert (await api.client.post(url)).status_code == 401
    assert (await api.client.post(url, headers=admin)).status_code == 403
    first = await api.client.post(url, headers=buyer)
    assert first.status_code == 201 and first.json()["number"].startswith("ENQ-")
    again = await api.client.post(url, headers=buyer)
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"]
    async with api.db() as db:
        notes = (await db.execute(select(Notification).where(Notification.user_id == admin_id,
                                                             Notification.kind == "enquiry_new"))).scalars().all()
    assert len(notes) == 1 and notes[0].link == f"/admin?tab=enquiries&status=new&open={first.json()['id']}"
    mine = (await api.client.get("/api/ready-to-lift/interests/mine", headers=buyer)).json()
    assert [m["vehicle_id"] for m in mine] == [vid]

    me = (await api.client.get("/api/auth/me", headers=buyer)).json()
    listed = (await api.client.get(f"/api/admin/enquiries?q={me['buyer_id']}", headers=admin)).json()["items"]
    row = next(e for e in listed if e["id"] == first.json()["id"])
    assert row["buyer_user_id"] == str(buyer_id) and row["claim_number"] and row["status"] == "new"
    assert (await api.client.get("/api/admin/enquiries", headers=buyer)).status_code == 403
    upd = await api.client.post(f"/api/admin/enquiries/{row['id']}/update", headers=admin,
                                json={"status": "contacted", "admin_note": "Called, visiting yard Monday"})
    assert upd.status_code == 200 and upd.json()["status"] == "contacted"
    dash = (await api.client.get("/api/admin/dashboard", headers=admin)).json()
    assert dash["ready_to_lift_available"] >= 1 and "enquiries_new" in dash

    await api.client.post(f"/api/admin/vehicles/{vid}/mark-sold", headers=admin, json={})
    assert (await api.client.post(url, headers=buyer)).status_code == 404          # sold: no new interest


async def test_only_admins_list_ready_to_lift(api, storage):
    _, seller, _ = await make_user(api, "seller")
    refused = await create(api, seller, **RTL)
    assert refused.status_code == 403 and refused.json()["code"] == "ready_to_lift_admin_only"
    created = await create(api, seller)
    assert created.status_code == 201 and created.json()["listing_type"] == "auction"
    vid = created.json()["id"]
    changed = await api.client.patch(f"/api/vehicles/{vid}", headers=seller, json=RTL)
    assert changed.status_code == 403 and changed.json()["code"] == "ready_to_lift_admin_only"
