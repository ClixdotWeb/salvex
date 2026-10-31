"""
Admin "Results": who won each finished auction and for how much; admins are notified of every result.
"""
from sqlalchemy import select

from app.models.notification import Notification
from test_admin_foundation import load_user
from test_auctions import action
from test_bidding import bid, live_auction, verified_bidder
from test_kyc import storage  # noqa: F401  (fixture)
from test_users_admin import make_user


async def admin_notes(api, kind):
    async with api.db() as db:
        return (await db.execute(select(Notification).where(Notification.kind == kind))).scalars().all()


async def test_sold_result_notifies_admins_and_lists_the_winner(api, storage):
    admin, _, _, aid = await live_auction(api)
    first, _ = await verified_bidder(api)
    second, second_id = await verified_bidder(api)
    await bid(api, first, aid, "60000")
    await bid(api, second, aid, "61500")
    assert (await action(api, admin, aid, "close", reason="Ended")).status_code == 200

    async with api.db() as db:
        winner = (await db.execute(select(Notification.user_id).where(Notification.kind == "auction_won"))).scalars().all()
    notes = [n for n in await admin_notes(api, "auction_won") if n.user_id != second_id]   # the admin's, not the winner's
    assert notes and notes[0].title.endswith(" sold") and "61500" in notes[0].body and notes[0].link == f"/admin?tab=results&status=sold&open={aid}"
    assert second_id in winner

    page = (await api.client.get("/api/admin/results?result=sold&page_size=100", headers=admin)).json()
    row = next(r for r in page["items"] if r["auction_id"] == aid)
    assert row["winning_amount"] == "61500.00" and row["winner_id"] == str(second_id) and row["bid_count"] == 2
    assert row["order_status"] == "awaiting_payment" and row["order_number"].startswith("ORD-")
    assert row["cover_photo_id"]                                              # thumbnail for the list
    listed = (await api.client.get("/api/admin/auctions?status=closed&page_size=100", headers=admin)).json()["items"]
    card = next(x for x in listed if x["id"] == aid)
    assert card["cover_photo_id"] == row["cover_photo_id"] and card["registration_number"] and card["category"]
    vehicles = (await api.client.get(f"/api/admin/vehicles?q={card['registration_number']}", headers=admin)).json()["items"]
    assert vehicles[0]["cover_photo_id"] == row["cover_photo_id"] and vehicles[0]["variant"]
    winner_user = await load_user(api, row["winner_email"])
    assert winner_user.id == second_id

    detail = (await api.client.get(f"/api/admin/results/{aid}", headers=admin)).json()
    assert detail["winner_kyc_status"] == "verified" and detail["order_due_at"]
    assert [b["amount"] for b in detail["top_bids"]] == ["61500.00", "60000.00"]

    by_name = (await api.client.get(f"/api/admin/results?q={row['winner_email'][:8]}", headers=admin)).json()
    assert any(r["auction_id"] == aid for r in by_name["items"])


async def test_no_sale_result_and_access(api, storage):
    admin, _, _, aid = await live_auction(api)
    await action(api, admin, aid, "close", reason="Nobody bid")
    notes = await admin_notes(api, "auction_no_sale")
    assert notes and notes[0].link == f"/admin?tab=results&status=no_sale&open={aid}"
    page = (await api.client.get("/api/admin/results?result=no_sale&page_size=100", headers=admin)).json()
    row = next(r for r in page["items"] if r["auction_id"] == aid)
    assert row["winner_id"] is None and row["winning_amount"] is None and row["order_id"] is None
    sold = (await api.client.get("/api/admin/results?result=sold&page_size=100", headers=admin)).json()
    assert all(r["auction_id"] != aid for r in sold["items"])

    _, user, _ = await make_user(api)
    assert (await api.client.get("/api/admin/results")).status_code == 401
    assert (await api.client.get("/api/admin/results", headers=user)).status_code == 403
    assert (await api.client.get(f"/api/admin/results/{aid}", headers=user)).status_code == 403
    assert (await api.client.get("/api/admin/results?result=maybe", headers=admin)).status_code == 422
    assert (await api.client.get("/api/admin/results?q=%3Cx%3E", headers=admin)).status_code == 422


async def test_an_open_auction_is_not_a_result(api, storage):
    admin, _, _, aid = await live_auction(api)
    assert (await api.client.get(f"/api/admin/results/{aid}", headers=admin)).status_code == 404


async def test_an_admin_owned_vehicle_gives_admins_one_message_per_sale(api, storage):
    from test_admin_foundation import make_admin
    from test_auctions import new_auction, at
    from test_vehicles import approved_vehicle
    admin_email, admin = await make_admin(api)
    admin_id = (await load_user(api, admin_email)).id
    vid = await approved_vehicle(api, admin, admin)                    # the admin added this vehicle
    aid = (await new_auction(api, admin, vid, starts_at=at(-0.2), ends_at=at(60))).json()["id"]
    bidder, _ = await verified_bidder(api)
    await bid(api, bidder, aid, "60000")
    await action(api, admin, aid, "close", reason="Ended")
    async with api.db() as db:
        kinds = (await db.execute(select(Notification.kind).where(Notification.user_id == admin_id,
                                                                  Notification.kind.in_(("auction_won", "vehicle_sold"))))).scalars().all()
    assert kinds == ["auction_won"]
