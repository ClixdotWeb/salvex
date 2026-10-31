"""Admin dashboard counts move with real activity (compared before/after, so other rows do not matter)."""
from test_auctions import new_auction, shift
from test_bidding import bid, live_auction, verified_bidder
from test_kyc import start, storage, upload  # noqa: F401  (storage is a fixture)
from test_users_admin import make_user
from test_vehicles import submitted_vehicle


async def counts(api, admin) -> dict:
    res = await api.client.get("/api/admin/dashboard", headers=admin)
    assert res.status_code == 200, res.text
    return res.json()


async def test_dashboard_counts_follow_activity(api, storage):
    admin, seller, _, live = await live_auction(api)
    before = await counts(api, admin)
    assert before["server_time"]

    _, kyc_user, _ = await make_user(api, "bidder")
    sid = await start(api, kyc_user)
    await upload(api, kyc_user, sid)
    await api.client.post(f"/api/kyc/submissions/{sid}/submit", headers=kyc_user)
    await submitted_vehicle(api, seller)
    headers, _ = await verified_bidder(api)
    await bid(api, headers, live, "60000")
    _, _, _, other = await live_auction(api)
    await shift(api, other, starts_at=30, ends_at=90)                        # upcoming

    after = await counts(api, admin)
    assert after["kyc_waiting_review"] == before["kyc_waiting_review"] + 1
    assert after["vehicles_waiting_review"] == before["vehicles_waiting_review"] + 1
    assert after["bids_today"] == before["bids_today"] + 1
    assert after["auctions_upcoming"] == before["auctions_upcoming"] + 1
    assert after["users_total"] >= before["users_total"] + 2
    assert after["auctions_live"] >= 1


async def test_dashboard_is_admin_only(api, storage):
    assert (await api.client.get("/api/admin/dashboard")).status_code == 401
    _, bidder, _ = await make_user(api, "bidder")
    assert (await api.client.get("/api/admin/dashboard", headers=bidder)).status_code == 403
