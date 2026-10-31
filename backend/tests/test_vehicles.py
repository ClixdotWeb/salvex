"""
Module 4: vehicles - adding, editing, photos, admin review and the public catalogue.

Database work runs on the isolated local test database inside a transaction that is always rolled back;
photos go to a temporary folder per test.
"""
import uuid

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.audit_log import AuditLog
from app.models.vehicle import Vehicle
from test_admin_foundation import load_user, make_admin
from test_kyc import JPEG, PDF, png, storage, stored_files  # noqa: F401  (storage is a fixture)
from test_users_admin import make_user


def random_registration() -> str:
    n = uuid.uuid4().int
    letters = chr(65 + n % 26) + chr(65 + (n // 26) % 26)
    return f"KL{(n // 676) % 100:02d}{letters}{(n // 67600) % 10000:04d}"   # ~6.7 million combinations


def vehicle_body(**overrides) -> dict:
    body = {
        "registration_number": random_registration(),
        "claim_number": "CLM-2026-0001",
        "make": "Maruti Suzuki",
        "model": "Swift",
        "variant": "VXi",
        "manufacturing_year": 2019,
        "registration_year": 2019,
        "fuel_type": "petrol",
        "transmission": "manual",
        "number_of_owners": 1,
        "damage_type": "accident",
        "location": "Kochi Yard",
        "rc_status": "available",
        "registration_type": "private",
        "hypothecation_status": "not_hypothecated",
    }
    body.update(overrides)
    return body


async def create(api, headers, **overrides):
    return await api.client.post("/api/vehicles", headers=headers, json=vehicle_body(**overrides))


async def add_photo(api, headers, vehicle_id, data=JPEG, content_type="image/jpeg"):
    return await api.client.post(f"/api/vehicles/{vehicle_id}/photos", content=data,
                                 headers={**headers, "Content-Type": content_type})


async def submitted_vehicle(api, headers, **overrides) -> str:
    res = await create(api, headers, **overrides)
    assert res.status_code == 201, res.text
    vid = res.json()["id"]
    assert (await add_photo(api, headers, vid)).status_code == 201
    assert (await api.client.post(f"/api/vehicles/{vid}/submit", headers=headers)).status_code == 200
    return vid


async def review(api, admin, vid, decision, reason=None):
    body = {"decision": decision} if reason is None else {"decision": decision, "reason": reason}
    return await api.client.post(f"/api/admin/vehicles/{vid}/review", headers=admin, json=body)


async def approved_vehicle(api, seller, admin, **overrides) -> str:
    vid = await submitted_vehicle(api, seller, **overrides)
    assert (await review(api, admin, vid, "approve")).status_code == 200
    return vid


# ---------------------------------------------------------------------------- access control
async def test_vehicle_management_needs_a_seller_or_admin(api, storage):
    some = uuid.uuid4()
    for method, url in (("post", "/api/vehicles"), ("get", "/api/vehicles/mine"), ("get", f"/api/vehicles/{some}"),
                        ("patch", f"/api/vehicles/{some}"), ("post", f"/api/vehicles/{some}/submit"),
                        ("post", f"/api/vehicles/{some}/photos"), ("get", "/api/vehicles/registration-check?number=KL07AB1234")):
        assert (await api.client.request(method, url)).status_code == 401, url
    _, bidder, _ = await make_user(api, "bidder")
    res = await create(api, bidder)
    assert res.status_code == 403 and res.json()["code"] == "forbidden"
    _, seller, _ = await make_user(api, "seller")
    assert (await create(api, seller)).status_code == 201
    _, admin = await make_admin(api)
    assert (await create(api, admin)).status_code == 201                       # admins can add stock too


async def test_a_seller_cannot_see_or_change_another_sellers_vehicle(api, storage):
    _, owner, _ = await make_user(api, "seller")
    vid = (await create(api, owner)).json()["id"]
    photo = (await add_photo(api, owner, vid)).json()["id"]
    _, other, _ = await make_user(api, "seller")
    for res in (await api.client.get(f"/api/vehicles/{vid}", headers=other),
                await api.client.patch(f"/api/vehicles/{vid}", headers=other, json={"make": "Hijacked"}),
                await add_photo(api, other, vid),
                await api.client.delete(f"/api/vehicles/{vid}/photos/{photo}", headers=other),
                await api.client.get(f"/api/vehicles/{vid}/photos/{photo}", headers=other),
                await api.client.post(f"/api/vehicles/{vid}/submit", headers=other)):
        assert res.status_code == 404
    assert (await api.client.get("/api/vehicles/mine", headers=other)).json()["total"] == 0
    mine = (await api.client.get(f"/api/vehicles/{vid}", headers=owner)).json()
    assert mine["make"] == "Maruti Suzuki" and mine["status"] == "draft" and len(mine["photos"]) == 1
    assert len(stored_files(storage)) == 1


async def test_only_admins_review(api, storage):
    _, seller, _ = await make_user(api, "seller")
    vid = await submitted_vehicle(api, seller)
    for url in ("/api/admin/vehicles", f"/api/admin/vehicles/{vid}"):
        assert (await api.client.get(url, headers=seller)).status_code == 403
    assert (await review(api, seller, vid, "approve")).status_code == 403
    assert (await api.client.get(f"/api/catalogue/vehicles/{vid}")).status_code == 404


# ---------------------------------------------------------------------------- the company's fields
async def test_all_company_fields_are_stored_and_the_registration_is_normalised(api, storage):
    _, seller, _ = await make_user(api, "seller")
    res = await create(api, seller, registration_number="kl-07 ab.1234", make="  Maruti   Suzuki ")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["registration_number"] == "KL07AB1234" and body["make"] == "Maruti Suzuki"
    for field, value in vehicle_body().items():
        if field not in ("registration_number", "make"):
            assert body[field] == value, field
    assert "owner_id" not in body                                             # sellers do not see admin-only fields


@pytest.mark.parametrize("field", list(vehicle_body()))
async def test_every_field_is_mandatory(api, storage, field):
    _, seller, _ = await make_user(api, "seller")
    body = vehicle_body()
    del body[field]
    assert (await api.client.post("/api/vehicles", headers=seller, json=body)).status_code == 422
    body[field] = None
    assert (await api.client.post("/api/vehicles", headers=seller, json=body)).status_code == 422


@pytest.mark.parametrize("overrides", [
    {"registration_number": "1234"}, {"registration_number": "ABCDEFG"}, {"registration_number": "KL07<b>12"},
    {"registration_number": "KL07AB12345678"}, {"fuel_type": "steam"}, {"transmission": "cvt-ish"},
    {"damage_type": "bad"}, {"category": "boats"}, {"category": None}, {"rc_status": "maybe"}, {"registration_type": "royal"}, {"hypothecation_status": "x"},
    {"manufacturing_year": 1900}, {"manufacturing_year": 2101}, {"registration_year": 2018},   # before manufacture
    {"number_of_owners": -1}, {"number_of_owners": 21}, {"make": "<script>"}, {"make": "   "}, {"location": "a\x00b"},
    {"status": "approved"}, {"owner_id": str(uuid.uuid4())}, {"reviewed_by_id": str(uuid.uuid4())},
])
async def test_invalid_vehicle_details_are_refused(api, storage, overrides):
    _, seller, _ = await make_user(api, "seller")
    res = await create(api, seller, **overrides)
    assert res.status_code == 422, (overrides, res.text)


async def test_vehicle_options_are_public(api):
    options = (await api.client.get("/api/catalogue/vehicle-options")).json()
    assert set(options) == {"category", "fuel_type", "transmission", "damage_type", "rc_status", "registration_type", "hypothecation_status"}
    assert set(options["category"]) == {"insurance", "bank_nbfc", "used_vehicle"}
    assert "petrol" in options["fuel_type"]


# ---------------------------------------------------------------------------- duplicates
async def test_duplicate_registration_numbers_are_refused(api, storage):
    _, admin = await make_admin(api)
    _, first, _ = await make_user(api, "seller")
    _, second, _ = await make_user(api, "seller")
    vid = (await create(api, first, registration_number="KL07CD4321")).json()["id"]
    for headers, number in ((first, "KL07CD4321"), (second, "kl 07 cd 4321"), (admin, "KL-07-CD-4321")):
        res = await create(api, headers, registration_number=number)
        assert res.status_code == 409 and res.json()["code"] == "registration_exists", number
    check = (await api.client.get("/api/vehicles/registration-check?number=kl07cd4321", headers=second)).json()
    assert check == {"registration_number": "KL07CD4321", "available": False}
    assert (await api.client.get("/api/vehicles/registration-check?number=KL07CD9999", headers=second)).json()["available"] is True
    assert (await api.client.get("/api/vehicles/registration-check?number=????", headers=second)).status_code == 422

    other = (await create(api, second, registration_number="KL07CD5555")).json()["id"]
    res = await api.client.patch(f"/api/vehicles/{other}", headers=second, json={"registration_number": "KL07CD4321"})
    assert res.status_code == 409                                            # also when editing

    # a rejected vehicle frees its registration number
    await add_photo(api, first, vid)
    await api.client.post(f"/api/vehicles/{vid}/submit", headers=first)
    assert (await review(api, admin, vid, "reject", "Wrong vehicle")).status_code == 200
    assert (await create(api, second, registration_number="KL07CD4321")).status_code == 201


# ---------------------------------------------------------------------------- editing
async def test_editing_rules(api, storage):
    _, admin = await make_admin(api)
    _, seller, _ = await make_user(api, "seller")
    vid = (await create(api, seller)).json()["id"]

    res = await api.client.patch(f"/api/vehicles/{vid}", headers=seller, json={"location": "Thrissur Yard"})
    assert res.status_code == 200 and res.json()["location"] == "Thrissur Yard" and res.json()["make"] == "Maruti Suzuki"
    for body in ({}, {"make": None}, {"status": "approved"}, {"registration_year": 2015}, {"fuel_type": "steam"}):
        assert (await api.client.patch(f"/api/vehicles/{vid}", headers=seller, json=body)).status_code == 422, body

    await add_photo(api, seller, vid)
    await api.client.post(f"/api/vehicles/{vid}/submit", headers=seller)
    locked = await api.client.patch(f"/api/vehicles/{vid}", headers=seller, json={"location": "Elsewhere"})
    assert locked.status_code == 409 and locked.json()["code"] == "vehicle_not_editable"
    assert (await add_photo(api, seller, vid)).status_code == 409

    # an admin may correct a submitted vehicle; the change is audit-logged with the field names only
    fixed = await api.client.patch(f"/api/vehicles/{vid}", headers=admin, json={"variant": "ZXi", "location": "Thrissur Yard"})
    assert fixed.status_code == 200 and fixed.json()["variant"] == "ZXi" and fixed.json()["owner_id"]
    async with api.db() as db:
        entry = (await db.execute(select(AuditLog).where(AuditLog.action == "vehicle.admin_edit", AuditLog.target_id == vid))).scalar_one()
    assert entry.details == {"fields": ["variant"], "status": "submitted"}


# ---------------------------------------------------------------------------- photos
async def test_photo_rules(api, storage, monkeypatch):
    monkeypatch.setattr(settings, "VEHICLE_MAX_PHOTOS", 2)
    _, seller, _ = await make_user(api, "seller")
    vid = (await create(api, seller)).json()["id"]
    first = await add_photo(api, seller, vid)
    assert first.status_code == 201 and first.json()["content_type"] == "image/jpeg"
    assert (await add_photo(api, seller, vid, png(), "image/png")).status_code == 201
    full = await add_photo(api, seller, vid)
    assert full.status_code == 409 and full.json()["code"] == "too_many_photos"
    assert all(p.parent.name == "vehicles" for p in stored_files(storage))

    for data, content_type in ((PDF, "application/pdf"), (PDF, "image/jpeg"), (b"<svg/>", "image/svg+xml"), (b"", "image/png")):
        assert (await add_photo(api, seller, vid, data, content_type)).status_code in (415, 422), content_type

    own = await api.client.get(f"/api/vehicles/{vid}/photos/{first.json()['id']}", headers=seller)
    assert own.status_code == 200 and own.content == JPEG and "no-store" in own.headers["cache-control"]

    gone = await api.client.delete(f"/api/vehicles/{vid}/photos/{first.json()['id']}", headers=seller)
    assert gone.status_code == 204 and len(stored_files(storage)) == 1
    assert (await api.client.get(f"/api/vehicles/{vid}/photos/{first.json()['id']}", headers=seller)).status_code == 404


async def test_submitting_needs_a_photo(api, storage):
    _, seller, _ = await make_user(api, "seller")
    vid = (await create(api, seller)).json()["id"]
    res = await api.client.post(f"/api/vehicles/{vid}/submit", headers=seller)
    assert res.status_code == 422 and res.json()["code"] == "photos_required"


# ---------------------------------------------------------------------------- review and catalogue
async def test_review_flow_and_public_catalogue(api, storage):
    admin_email, admin = await make_admin(api)
    _, seller, _ = await make_user(api, "seller")
    vid = await submitted_vehicle(api, seller, registration_number="KL07EF2468", fuel_type="diesel")

    queue = (await api.client.get("/api/admin/vehicles?status=submitted&page_size=100", headers=admin)).json()
    assert vid in [v["id"] for v in queue["items"]]
    assert (await api.client.get("/api/admin/vehicles?q=ef2468", headers=admin)).json()["items"][0]["id"] == vid
    assert (await api.client.get(f"/api/catalogue/vehicles/{vid}")).status_code == 404       # not public yet

    for body in ({"decision": "reject"}, {"decision": "request_changes", "reason": "  "}, {"decision": "publish"},
                 {"decision": "approve", "status": "approved"}):
        assert (await api.client.post(f"/api/admin/vehicles/{vid}/review", headers=admin, json=body)).status_code == 422, body

    changes = await review(api, admin, vid, "request_changes", "Add a photo of the rear")
    assert changes.status_code == 200 and changes.json()["status"] == "changes_requested"
    mine = (await api.client.get(f"/api/vehicles/{vid}", headers=seller)).json()
    assert mine["review_reason"] == "Add a photo of the rear"
    await add_photo(api, seller, vid, png(), "image/png")
    assert (await api.client.post(f"/api/vehicles/{vid}/submit", headers=seller)).status_code == 200

    approved = await review(api, admin, vid, "approve")
    assert approved.status_code == 200 and approved.json()["status"] == "approved"
    assert approved.json()["reviewed_by_id"] == str((await load_user(api, admin_email)).id)
    assert (await review(api, admin, vid, "reject", "too late")).status_code == 409        # decided stays decided

    public = await api.client.get(f"/api/catalogue/vehicles/{vid}")                         # no sign-in
    assert public.status_code == 200
    card = public.json()
    assert card["registration_masked"] == "KL07**2468"
    assert not {"registration_number", "claim_number", "owner_id", "review_reason", "status"} & set(card)
    assert len(card["photo_ids"]) == 2
    photo = await api.client.get(f"/api/catalogue/vehicles/{vid}/photos/{card['photo_ids'][0]}")
    assert photo.status_code == 200 and photo.headers["content-type"] == "image/jpeg" and "public" in photo.headers["cache-control"]

    async with api.db() as db:
        actions = [a.action for a in (await db.execute(
            select(AuditLog).where(AuditLog.target_id == vid).order_by(AuditLog.created_at))).scalars()]
    assert actions == ["vehicle.submit", "vehicle.request_changes", "vehicle.submit", "vehicle.approve"]


async def test_catalogue_shows_only_approved_vehicles_and_filters(api, storage):
    _, admin = await make_admin(api)
    _, seller, _ = await make_user(api, "seller")
    tag = uuid.uuid4().hex[:6]
    diesel = await approved_vehicle(api, seller, admin, make=f"Tata{tag}", fuel_type="diesel", manufacturing_year=2015, registration_year=2016)
    petrol = await approved_vehicle(api, seller, admin, make=f"Tata{tag}", fuel_type="petrol", manufacturing_year=2021, registration_year=2021)
    draft = (await create(api, seller, make=f"Tata{tag}")).json()["id"]
    pending = await submitted_vehicle(api, seller, make=f"Tata{tag}")
    draft_photo = (await add_photo(api, seller, draft)).json()["id"]

    async def ids(query):
        res = await api.client.get(f"/api/catalogue/vehicles?make=Tata{tag}&page_size=100&{query}")
        assert res.status_code == 200, res.text
        return {v["id"] for v in res.json()["items"]}

    assert await ids("") == {diesel, petrol}
    assert await ids("fuel_type=diesel") == {diesel}
    assert await ids("year_from=2020") == {petrol}
    assert await ids("year_to=2016") == {diesel}
    assert await ids(f"q=tata{tag}") == {diesel, petrol}
    assert await ids("location=nowhere") == set()
    assert await ids("category=used_vehicle") == {diesel, petrol}               # the default category
    assert await ids("category=insurance") == set()
    for query in ("category=boats", "fuel_type=steam", "page_size=101", "year_from=1800", "q=%3Cscript%3E"):
        assert (await api.client.get(f"/api/catalogue/vehicles?{query}")).status_code == 422, query
    for vid in (draft, pending):
        assert (await api.client.get(f"/api/catalogue/vehicles/{vid}")).status_code == 404
    assert (await api.client.get(f"/api/catalogue/vehicles/{draft}/photos/{draft_photo}")).status_code == 404


async def test_a_failed_audit_write_undoes_the_review(api, storage, monkeypatch):
    _, admin = await make_admin(api)
    _, seller, _ = await make_user(api, "seller")
    vid = await submitted_vehicle(api, seller)

    async def broken(*args, **kwargs):
        raise RuntimeError("audit store unavailable")

    monkeypatch.setattr("app.services.vehicles.record_audit", broken)
    with pytest.raises(RuntimeError):
        await review(api, admin, vid, "approve")
    monkeypatch.undo()
    async with api.db() as db:
        vehicle = await db.get(Vehicle, uuid.UUID(vid))
        await db.refresh(vehicle)
        assert vehicle.status == "submitted" and vehicle.reviewed_by_id is None
    assert (await api.client.get(f"/api/catalogue/vehicles/{vid}")).status_code == 404


async def test_category_is_stored_editable_and_filters_the_catalogue(api, storage):
    _, admin = await make_admin(api)
    _, seller, _ = await make_user(api, "seller")
    tag = uuid.uuid4().hex[:6]
    insurance = await approved_vehicle(api, seller, admin, make=f"Cat{tag}", category="insurance")
    bank = await approved_vehicle(api, seller, admin, make=f"Cat{tag}", category="bank_nbfc")
    draft = (await create(api, seller, make=f"Cat{tag}", category="insurance")).json()
    assert draft["category"] == "insurance"
    changed = await api.client.patch(f"/api/vehicles/{draft['id']}", headers=seller, json={"category": "used_vehicle"})
    assert changed.status_code == 200 and changed.json()["category"] == "used_vehicle"

    async def ids(category):
        res = await api.client.get(f"/api/catalogue/vehicles?make=Cat{tag}&category={category}&page_size=100")
        return {v["id"] for v in res.json()["items"]}

    assert await ids("insurance") == {insurance}
    assert await ids("bank_nbfc") == {bank}
    one = (await api.client.get(f"/api/catalogue/vehicles/{insurance}")).json()
    assert one["category"] == "insurance"


async def test_damage_type_other_needs_a_typed_description(api, storage):
    _, admin = await make_admin(api)
    _, seller, _ = await make_user(api, "seller")
    assert (await create(api, seller, damage_type="other")).status_code == 422                     # no description
    assert (await create(api, seller, damage_type="other", damage_other="   ")).status_code == 422
    assert (await create(api, seller, damage_type="other", damage_other="<b>x</b>")).status_code == 422
    made = await create(api, seller, damage_type="other", damage_other="  Rat bite on   wiring ")
    assert made.status_code == 201 and made.json()["damage_other"] == "Rat bite on wiring"
    vid = made.json()["id"]
    # a description only belongs to "Other": it is dropped when another type is chosen
    plain = await create(api, seller, damage_type="accident", damage_other="ignored")
    assert plain.status_code == 201 and plain.json()["damage_other"] is None
    changed = await api.client.patch(f"/api/vehicles/{vid}", headers=seller, json={"damage_type": "flood"})
    assert changed.status_code == 200 and changed.json()["damage_other"] is None
    back = await api.client.patch(f"/api/vehicles/{vid}", headers=seller, json={"damage_type": "other"})
    assert back.status_code == 422
    back = await api.client.patch(f"/api/vehicles/{vid}", headers=seller, json={"damage_type": "other", "damage_other": "Fire in boot"})
    assert back.status_code == 200 and back.json()["damage_other"] == "Fire in boot"
    # shown publicly once approved
    assert (await add_photo(api, seller, vid)).status_code == 201
    assert (await api.client.post(f"/api/vehicles/{vid}/submit", headers=seller)).status_code == 200
    assert (await review(api, admin, vid, "approve")).status_code == 200
    assert (await api.client.get(f"/api/catalogue/vehicles/{vid}")).json()["damage_other"] == "Fire in boot"
