"""
Bulk vehicle upload: Excel / CSV template, check (nothing saved), import (drafts), publish with auctions,
and creating auctions for several approved vehicles at once.
"""
import csv
import io
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.auction import Auction
from app.models.vehicle import Vehicle
from app.services import xlsx
from test_admin_foundation import make_admin
from test_kyc import storage  # noqa: F401  (fixture)
from test_users_admin import make_user
from test_vehicles import add_photo, random_registration

IST = timezone(timedelta(hours=5, minutes=30))
HEAD = ["Registration number*", "Claim number*", "Listing (Auction / Ready to Lift)", "Make*", "Model*", "Variant*",
        "Manufacturing year*", "Registration year*", "Fuel type*", "Transmission*", "Number of owners*", "KM driven",
        "Superdari (Yes / No)", "Damage type*", "Damage description (if Other)", "Vehicle location*", "RC status*",
        "Registration type*", "Hypothecation status*", "Auction category", "Starting price (Rs)",
        "Auction start (YYYY-MM-DD HH:MM)", "Auction end (YYYY-MM-DD HH:MM)"]


def when(hours: float) -> str:
    return (datetime.now(IST) + timedelta(hours=hours)).strftime("%Y-%m-%d %H:%M")


def row(reg=None, **over) -> list[str]:
    base = {
        "reg": reg or random_registration(), "claim": "CLM-1", "listing": "", "make": "Maruti Suzuki", "model": "Swift",
        "variant": "VXI", "mfg": "2019", "regyear": "2019", "fuel": "Petrol", "gear": "manual", "owners": "1", "km": "",
        "superdari": "", "damage": "Accident", "damage_other": "", "location": "Kochi Yard", "rc": "RC available",
        "regtype": "Private", "hyp": "Not hypothecated", "category": "Insurance", "price": "", "start": "", "end": "",
    }
    base.update(over)
    return list(base.values())


def to_csv(*rows, head=HEAD) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(head)
    for r in rows:
        w.writerow(r)
    return buf.getvalue().encode("utf-8")


async def post(api, admin, path, data: bytes, content_type="text/csv"):
    return await api.client.post(f"/api/admin/vehicles/{path}", content=data,
                                 headers={**admin, "Content-Type": content_type})


async def test_template_downloads_and_reads_back_as_valid_examples(api):
    _, admin = await make_admin(api)
    res = await api.client.get("/api/admin/vehicles/bulk-template", headers=admin)
    assert res.status_code == 200 and res.headers["content-type"].startswith("application/vnd.openxmlformats")
    sheet = xlsx.read_first_sheet(res.content)
    from app.services.bulk_vehicles import HEADINGS
    assert sheet[0] == list(HEADINGS.values()) and len(sheet) == 3 and sheet[1][1].startswith("e.g.")
    assert sheet[0][:3] == ["Claim number*", "Registration number*", "Vehicle make*"]       # the client's order
    # the examples are ignored, so the untouched template has no vehicles
    empty = await post(api, admin, "bulk-check", res.content, xlsx_type())
    assert empty.status_code == 422 and empty.json()["code"] == "bulk_bad_file"
    csv_res = await api.client.get("/api/admin/vehicles/bulk-template?format=csv", headers=admin)
    assert csv_res.status_code == 200 and csv_res.content.startswith("﻿".encode())
    # the template's example rows are valid once the "e.g." is removed
    fixed = csv_res.content.decode("utf-8-sig").replace("e.g. KL07AB1234", random_registration()).replace(
        "e.g. KL01CD5678", random_registration()).encode()
    checked = (await post(api, admin, "bulk-check", fixed)).json()
    assert checked["valid"] == 2 and checked["invalid"] == 0 and checked["with_auction"] == 1, checked
    assert {r["listing_type"] for r in checked["rows"]} == {"auction", "ready_to_lift"}


def xlsx_type():
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


async def test_check_lists_every_problem_and_saves_nothing(api, storage):
    _, admin = await make_admin(api)
    good, dup = random_registration(), random_registration()
    data = to_csv(
        row(good),
        row(dup), row(dup),                                                   # repeated in the file
        row(fuel="Steam"),                                                    # unknown choice
        row(listing="Ready to Lift"),                                         # RTL needs KM + Superdari
        row(listing="Ready to Lift", km="12,000", superdari="yes", price="1000", start=when(5), end=when(8)),
        row(price="50000", start=when(5)),                                    # half an auction
        row(price="50000", start=when(-5), end=when(2)),                      # start in the past
        row(mfg="twenty"),
        row(superdari="maybe"),
    )
    res = await post(api, admin, "bulk-check", data)
    assert res.status_code == 200, res.text
    body = res.json()
    by_row = {r["row"]: r for r in body["rows"]}
    assert body["valid"] == 2 and body["invalid"] == 8
    assert by_row[2]["errors"] == [] and by_row[3]["errors"] == []
    assert "repeats row 3" in by_row[4]["errors"][0]
    assert any("Fuel type" in e for e in by_row[5]["errors"])
    assert any("KM driven" in e or "Ready to Lift" in e for e in by_row[6]["errors"])
    assert any("not auctioned" in e for e in by_row[7]["errors"])
    assert any("all three" in e for e in by_row[8]["errors"])
    assert any("past" in e for e in by_row[9]["errors"])
    assert any("whole number" in e for e in by_row[10]["errors"])
    assert any("Superdari" in e for e in by_row[11]["errors"])
    async with api.db() as db:
        assert (await db.execute(select(Vehicle).where(Vehicle.registration_number == good))).first() is None

    missing = await post(api, admin, "bulk-check", to_csv(row(), head=HEAD[:3]))
    assert missing.status_code == 422 and missing.json()["code"] == "bulk_missing_columns"
    assert (await post(api, admin, "bulk-check", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1rest")).json()["code"] == "bulk_bad_file"
    assert (await post(api, admin, "bulk-check", b"PK\x03\x04broken", xlsx_type())).json()["code"] == "bulk_bad_file"


async def test_excel_file_is_read_like_csv(api):
    _, admin = await make_admin(api)
    reg = random_registration()
    book = xlsx.write_workbook([("Vehicles", [HEAD, row(reg, listing="Ready to Lift", km="48210", superdari="No")], [20] * 23, 1)])
    res = await post(api, admin, "bulk-check", book, xlsx_type())
    assert res.status_code == 200, res.text
    only = res.json()["rows"][0]
    assert only["errors"] == [] and only["registration_number"] == reg and only["listing_type"] == "ready_to_lift"


async def test_import_then_publish_with_photos_and_auctions(api, storage):
    _, admin = await make_admin(api)
    with_auction, lift, no_photo, bad = (random_registration() for _ in range(4))
    data = to_csv(
        row(with_auction, price="1,50,000", start=when(24), end=when(26)),
        row(lift, listing="Ready to Lift", km="32500", superdari="Yes"),
        row(no_photo),
        row(bad, fuel="Steam"),
    )
    res = await post(api, admin, "bulk-import", data)
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["created"]) == 3 and [r["registration_number"] for r in body["skipped"]] == [bad]
    ids = {r["registration_number"]: r["vehicle_id"] for r in body["created"]}
    async with api.db() as db:
        stored = (await db.execute(select(Vehicle).where(Vehicle.registration_number == lift))).scalar_one()
    assert stored.status == "draft" and stored.listing_type == "ready_to_lift" and stored.km_driven == 32500 and stored.superdari
    # importing the same file again refuses the vehicles that now exist
    again = (await post(api, admin, "bulk-check", data)).json()
    assert again["valid"] == 0 and all(any("already" in e or "Fuel" in e for e in r["errors"]) for r in again["rows"])

    for reg in (with_auction, lift):
        assert (await add_photo(api, admin, ids[reg])).status_code == 201
    auction = next(r["auction"] for r in body["created"] if r["registration_number"] == with_auction)
    assert auction["starting_price"] == "150000.00"
    items = [{"vehicle_id": ids[with_auction], "auction": auction}, {"vehicle_id": ids[lift]}, {"vehicle_id": ids[no_photo]}]
    pub = await api.client.post("/api/admin/vehicles/bulk-publish", headers=admin, json={"items": items})
    assert pub.status_code == 200, pub.text
    out = {r["registration_number"]: r for r in pub.json()["results"]}
    assert pub.json()["published"] == 2 and pub.json()["auctions"] == 1 and pub.json()["failed"] == 1
    assert out[with_auction]["status"] == "approved" and out[with_auction]["auction_id"]
    assert out[lift]["status"] == "approved" and out[lift]["auction_id"] is None
    assert out[no_photo]["code"] == "photos_required" and out[no_photo]["status"] == "draft"
    async with api.db() as db:
        created = (await db.execute(select(Auction).where(Auction.id == out[with_auction]["auction_id"]))).scalar_one()
    assert created.extension_enabled and str(created.starting_price) == "150000.00"

    # Ready to Lift is never auctioned, even through the bulk route
    refused = await api.client.post("/api/admin/vehicles/bulk-publish", headers=admin, json={"items": [
        {"vehicle_id": ids[lift], "auction": {"starting_price": "1000", "starts_at": auction["starts_at"], "ends_at": auction["ends_at"]}}]})
    assert refused.json()["results"][0]["code"] == "ready_to_lift_not_auctioned"


async def test_create_auctions_for_several_approved_vehicles(api, storage):
    _, admin = await make_admin(api)
    regs = [random_registration() for _ in range(3)]
    created = (await post(api, admin, "bulk-import", to_csv(*(row(r) for r in regs)))).json()["created"]
    ids = [c["vehicle_id"] for c in created]
    for vid in ids:
        assert (await add_photo(api, admin, vid)).status_code == 201
    assert (await api.client.post("/api/admin/vehicles/bulk-publish", headers=admin,
                                  json={"items": [{"vehicle_id": v} for v in ids]})).json()["published"] == 3

    ready = (await api.client.get("/api/admin/vehicles?ready_for_auction=true&page_size=100", headers=admin)).json()["items"]
    assert set(ids) <= {v["id"] for v in ready}
    start = datetime.now(timezone.utc) + timedelta(hours=2)
    items = [{"vehicle_id": vid, "auction": {"starting_price": f"{50000 + i * 1000}", "starts_at": start.isoformat(),
                                              "ends_at": (start + timedelta(hours=1, minutes=5 * i)).isoformat()}}
             for i, vid in enumerate(ids)]
    res = await api.client.post("/api/admin/vehicles/bulk-publish", headers=admin,
                                json={"items": items, "extension_enabled": False})
    assert res.status_code == 200 and res.json()["auctions"] == 3 and res.json()["published"] == 0, res.text
    ready = (await api.client.get("/api/admin/vehicles?ready_for_auction=true&page_size=100", headers=admin)).json()["items"]
    assert not set(ids) & {v["id"] for v in ready}
    # asking again: each vehicle already has an auction, reported per vehicle
    again = (await api.client.post("/api/admin/vehicles/bulk-publish", headers=admin, json={"items": items})).json()
    assert again["failed"] == 3 and {r["code"] for r in again["results"]} == {"vehicle_already_auctioned"}
    assert (await api.client.post("/api/admin/vehicles/bulk-publish", headers=admin,
                                  json={"items": items[:1] * 2})).status_code == 422


async def test_bulk_routes_are_admin_only(api):
    _, bidder, _ = await make_user(api)
    assert (await post(api, bidder, "bulk-check", to_csv(row()))).status_code == 403
    assert (await api.client.get("/api/admin/vehicles/bulk-template", headers=bidder)).status_code == 403


async def test_the_clients_own_excel_headings_are_understood(api):
    """The client's sheet: 15 numbered columns, "Transmission type", and "Hypothycation" as they spell it."""
    _, admin = await make_admin(api)
    head = ["1. Claim number", "2 .Registration Number", "3. Vehicle Make", "4. Model", "5.Variant", "6.Manufacturing   Year",
            "7. Registration Year", "8.Fuel type", "9. Transmission type", "10.Number of Owners", "11. Vehicle Damage Type",
            "12. Vehicle Location", "13. RC status", "14. Registration Type", "15. Hypothycation status"]
    reg = random_registration()
    values = ["CLM-9", reg, "MARUTI SUZUKI", "Swift", "VXI", "2019", "2019", "PETROL", "Manual", "1", "accident",
              "Kochi Yard", "RC available", "private", "hypothecated"]
    book = xlsx.write_workbook([("Sheet1", [head, values], [20] * 15, 1)])
    res = await post(api, admin, "bulk-check", book, xlsx_type())
    assert res.status_code == 200, res.text
    only = res.json()["rows"][0]
    assert only["errors"] == [] and only["registration_number"] == reg and only["listing_type"] == "auction"


async def test_ready_to_lift_section_defaults_and_sold_filter(api, storage):
    """The Ready to Lift section uploads Ready to Lift vehicles (Listing column may be empty) and lists sold ones apart."""
    _, admin = await make_admin(api)
    lift, auction = random_registration(), random_registration()
    data = to_csv(row(lift, km="32500", superdari="No"), row(auction, listing="Auction"))
    checked = (await post(api, admin, "bulk-check?listing=ready_to_lift", data)).json()["rows"]
    assert [r["listing_type"] for r in checked] == ["ready_to_lift", "auction"] and all(not r["errors"] for r in checked)
    plain = (await post(api, admin, "bulk-check", data)).json()["rows"]
    assert plain[0]["listing_type"] == "auction"                     # the default outside the Ready to Lift section
    created = (await post(api, admin, "bulk-import?listing=ready_to_lift", data)).json()["created"]
    vid = next(c["vehicle_id"] for c in created if c["registration_number"] == lift)
    assert (await add_photo(api, admin, vid)).status_code == 201
    assert (await api.client.post("/api/admin/vehicles/bulk-publish", headers=admin, json={"items": [{"vehicle_id": vid}]})).json()["published"] == 1
    url = "/api/admin/vehicles?listing_type=ready_to_lift&page_size=100&sold="
    assert any(v["id"] == vid for v in (await api.client.get(url + "false", headers=admin)).json()["items"])
    assert (await api.client.post(f"/api/admin/vehicles/{vid}/mark-sold", headers=admin, json={})).status_code == 200
    assert any(v["id"] == vid for v in (await api.client.get(url + "true", headers=admin)).json()["items"])
    assert all(v["id"] != vid for v in (await api.client.get(url + "false", headers=admin)).json()["items"])
