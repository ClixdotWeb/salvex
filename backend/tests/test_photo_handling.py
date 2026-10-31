"""
Vehicle photos: hidden location data is removed, photos keep an order (first = cover), a small thumbnail can be
stored for lists, and deleting a photo deletes both files. Also: the bulk upload's default category.
"""
import struct
import zlib

from app.services.image_meta import strip_jpeg, strip_png
from test_admin_foundation import make_admin
from test_bulk_upload import post, row, to_csv
from test_kyc import JPEG, png, storage, stored_files  # noqa: F401  (storage is a fixture)
from test_vehicles import add_photo, create


def exif_app1(orientation: int) -> bytes:
    """An APP1 EXIF segment (little-endian) with Orientation and a GPS pointer + some GPS-looking text."""
    entries = struct.pack("<HHIHH", 0x0112, 3, 1, orientation, 0) + struct.pack("<HHII", 0x8825, 4, 1, 38)
    tiff = b"II*\x00" + struct.pack("<I", 8) + struct.pack("<H", 2) + entries + struct.pack("<I", 0) + b"GPS 10.0158N 76.3418E"
    payload = b"Exif\x00\x00" + tiff
    return b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload


def jpeg_with_location(orientation: int = 6) -> bytes:
    app0 = b"\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    xmp = b"http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta>Phone owner</x:xmpmeta>"
    app1_xmp = b"\xff\xe1" + struct.pack(">H", len(xmp) + 2) + xmp
    comment = b"\xff\xfe" + struct.pack(">H", 12) + b"Taken here"
    dqt = b"\xff\xdb" + struct.pack(">H", 67) + b"\x00" + bytes(range(64))
    sos = b"\xff\xda" + struct.pack(">H", 8) + b"\x01\x01\x00\x00\x3f\x00"
    return b"\xff\xd8" + app0 + exif_app1(orientation) + app1_xmp + comment + dqt + sos + b"\x12\x34\xff\x00\x56" + b"\xff\xd9"


def test_jpeg_metadata_is_removed_but_orientation_and_image_data_stay():
    original = jpeg_with_location(6)
    clean = strip_jpeg(original)
    for secret in (b"GPS", b"Phone owner", b"Taken here", b"xmpmeta"):
        assert secret not in clean
    assert clean.startswith(b"\xff\xd8\xff\xe1")                       # rebuilt orientation-only EXIF first
    assert b"MM\x00\x2a" in clean and struct.pack(">HHIHH", 0x0112, 3, 1, 6, 0) in clean
    assert original[original.index(b"\xff\xdb"):] in clean                # tables, scan and pixels untouched
    assert b"\xff\xe0\x00\x10JFIF" in clean
    # upright photos get no EXIF at all; unknown / damaged files are returned as they are
    assert b"Exif" not in strip_jpeg(jpeg_with_location(1))
    assert strip_jpeg(JPEG) == JPEG
    assert strip_jpeg(b"not a jpeg") == b"not a jpeg"


def test_png_text_chunks_are_removed():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    base = png()
    with_text = base[:33] + chunk(b"tEXt", b"Location\x0010.01,76.34") + chunk(b"eXIf", b"MM\x00*") + base[33:]
    clean = strip_png(with_text)
    assert b"Location" not in clean and b"eXIf" not in clean and clean == base


async def test_upload_strips_location_keeps_order_thumbnail_and_deletes_both_files(api, storage):
    _, admin = await make_admin(api)
    vid = (await create(api, admin)).json()["id"]
    first = await add_photo(api, admin, vid, data=jpeg_with_location())
    assert first.status_code == 201, first.text
    second = await add_photo(api, admin, vid)
    p1, p2 = first.json(), second.json()
    assert (p1["position"], p2["position"]) == (0, 1) and p1["has_thumbnail"] is False
    stored = (await api.client.get(f"/api/vehicles/{vid}/photos/{p1['id']}", headers=admin)).content
    assert b"GPS" not in stored and b"Phone owner" not in stored and stored.startswith(b"\xff\xd8")

    # thumbnail: stored, served with ?size=thumb, the full photo is unchanged
    thumb = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00THUMB\xff\xd9"
    res = await api.client.put(f"/api/vehicles/{vid}/photos/{p1['id']}/thumbnail", content=thumb,
                               headers={**admin, "Content-Type": "image/jpeg"})
    assert res.status_code == 204, res.text
    small = await api.client.get(f"/api/vehicles/{vid}/photos/{p1['id']}?size=thumb", headers=admin)
    assert small.status_code == 200 and small.content == thumb
    assert (await api.client.get(f"/api/vehicles/{vid}/photos/{p1['id']}", headers=admin)).content == stored
    # no thumbnail yet -> the full photo is served
    assert (await api.client.get(f"/api/vehicles/{vid}/photos/{p2['id']}?size=thumb", headers=admin)).content == JPEG
    too_big = await api.client.put(f"/api/vehicles/{vid}/photos/{p2['id']}/thumbnail", content=JPEG + b"\x00" * 500_000,
                                   headers={**admin, "Content-Type": "image/jpeg"})
    assert too_big.status_code == 413
    # replacing a thumbnail deletes the old file
    before = len(stored_files(storage))
    assert (await api.client.put(f"/api/vehicles/{vid}/photos/{p1['id']}/thumbnail", content=thumb.replace(b"THUMB", b"THUMB2"),
                                 headers={**admin, "Content-Type": "image/jpeg"})).status_code == 204
    assert len(stored_files(storage)) == before

    # order: the second photo becomes the cover
    order = await api.client.put(f"/api/vehicles/{vid}/photos/order", headers=admin, json={"photo_ids": [p2["id"], p1["id"]]})
    assert order.status_code == 200 and [p["id"] for p in order.json()] == [p2["id"], p1["id"]]
    detail = (await api.client.get(f"/api/admin/vehicles/{vid}", headers=admin)).json()
    assert [p["id"] for p in detail["photos"]] == [p2["id"], p1["id"]]
    assert (await api.client.put(f"/api/vehicles/{vid}/photos/order", headers=admin,
                                 json={"photo_ids": [p2["id"]]})).json()["code"] == "photo_order_mismatch"

    # deleting the photo deletes the photo file and its thumbnail
    files = len(stored_files(storage))
    assert (await api.client.delete(f"/api/vehicles/{vid}/photos/{p1['id']}", headers=admin)).status_code == 204
    assert len(stored_files(storage)) == files - 2


async def test_bulk_rows_without_category_use_the_chosen_one(api):
    _, admin = await make_admin(api)
    data = to_csv(row(category=""), row(category="Used vehicle"))
    default = (await post(api, admin, "bulk-check", data)).json()["rows"]
    assert [r["category"] for r in default] == ["insurance", "used_vehicle"]
    assert all(r["claim_number"] == "CLM-1" for r in default)
    bank = (await post(api, admin, "bulk-check?category=bank_nbfc", data)).json()["rows"]
    assert [r["category"] for r in bank] == ["bank_nbfc", "used_vehicle"]
    assert (await post(api, admin, "bulk-check?category=cars", data)).status_code == 422


async def test_admin_lists_show_the_chosen_cover(api, storage):
    from test_ready_to_lift import rtl_vehicle
    from test_users_admin import make_user
    _, admin = await make_admin(api)
    vid = await rtl_vehicle(api, admin)                     # one photo already
    second = (await add_photo(api, admin, vid)).json()
    first = (await api.client.get(f"/api/admin/vehicles/{vid}", headers=admin)).json()["photos"][0]["id"]
    assert (await api.client.put(f"/api/vehicles/{vid}/photos/order", headers=admin,
                                 json={"photo_ids": [second["id"], first]})).status_code == 200
    _, buyer, _ = await make_user(api)
    assert (await api.client.post(f"/api/ready-to-lift/{vid}/interest", headers=buyer)).status_code == 201
    rows = (await api.client.get("/api/admin/enquiries?page_size=100", headers=admin)).json()["items"]
    assert next(r for r in rows if r["vehicle_id"] == vid)["cover_photo_id"] == second["id"]


async def test_published_vehicle_keeps_a_photo_and_locked_vehicles_are_flagged(api, storage):
    from test_orders import won_order
    from test_ready_to_lift import rtl_vehicle
    _, admin = await make_admin(api)
    vid = await rtl_vehicle(api, admin)                     # published with one photo
    only = (await api.client.get(f"/api/admin/vehicles/{vid}", headers=admin)).json()
    assert only["locked"] is False
    refused = await api.client.delete(f"/api/vehicles/{vid}/photos/{only['photos'][0]['id']}", headers=admin)
    assert refused.status_code == 409 and refused.json()["code"] == "last_photo"
    second = (await add_photo(api, admin, vid)).json()
    assert (await api.client.delete(f"/api/vehicles/{vid}/photos/{only['photos'][0]['id']}", headers=admin)).status_code == 204
    assert (await api.client.get(f"/api/admin/vehicles/{vid}", headers=admin)).json()["photos"][0]["id"] == second["id"]
    # a vehicle that was sold in an auction is locked
    admin2, _, _, _, sold = await won_order(api)
    assert (await api.client.get(f"/api/admin/vehicles/{sold}", headers=admin2)).json()["locked"] is True
