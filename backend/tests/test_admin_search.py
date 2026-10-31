"""Admin search (Buyer ID / name / phone, registration / claim number) and the buyer and vehicle overviews."""
from test_kyc import storage  # noqa: F401  (fixture)
from test_orders import won_order
from test_ready_to_lift import rtl_vehicle
from test_users_admin import make_user


async def test_find_buyer_and_vehicle_and_see_everything(api, storage):
    admin, buyer, buyer_user_id, order, vid = await won_order(api)
    vehicle = (await api.client.get(f"/api/admin/vehicles/{vid}", headers=admin)).json()
    me = (await api.client.get(f"/api/admin/users/{buyer_user_id}", headers=admin)).json()
    buyer_id = me["buyer_id"]

    async def search(q):
        res = await api.client.get("/api/admin/search", headers=admin, params={"q": q})
        assert res.status_code == 200, res.text
        return res.json()

    for q in (buyer_id, buyer_id.lower().replace("-", ""), str(int(buyer_id.split("-")[1]))):
        assert any(b["id"] == str(buyer_user_id) for b in (await search(q))["buyers"]), q
    reg = vehicle["registration_number"]
    spaced = f"{reg[:2]} {reg[2:4]} {reg[4:]}"
    for q in (reg, spaced.lower()):
        hits = (await search(q))["vehicles"]
        assert hits[0]["id"] == vid and hits[0]["sold"] is True, q
    assert any(v["id"] == vid for v in (await search(vehicle["claim_number"]))["vehicles"])

    # the buyer: the auction won, with the deal
    overview = (await api.client.get(f"/api/admin/users/{buyer_user_id}/overview", headers=admin)).json()
    assert overview["buyer_id"] == buyer_id and overview["bids_total"] >= 1 and overview["auctions_bid_on"] >= 1
    won = overview["won"][0]
    assert won["vehicle_id"] == vid and won["amount"] == "75000.00" and won["deal"]["order_number"] == order["number"]
    assert won["deal"]["status"] == "awaiting_payment"
    assert overview["recent_bids"][0]["registration_number"] == reg

    # the vehicle: its auction with the winner
    vo = (await api.client.get(f"/api/admin/vehicles/{vid}/overview", headers=admin)).json()
    assert vo["vehicle"]["id"] == vid and vo["sold"] is True
    line = vo["auctions"][0]
    assert line["result"] == "sold" and line["winner_buyer_id"] == buyer_id and line["deal"]["order_number"] == order["number"]

    # a Ready to Lift enquiry shows on both sides
    lift = await rtl_vehicle(api, admin)
    assert (await api.client.post(f"/api/ready-to-lift/{lift}/interest", headers=buyer)).status_code == 201
    overview = (await api.client.get(f"/api/admin/users/{buyer_user_id}/overview", headers=admin)).json()
    assert overview["vehicle_enquiries"][0]["number"].startswith("ENQ-")
    vo = (await api.client.get(f"/api/admin/vehicles/{lift}/overview", headers=admin)).json()
    assert vo["enquiries"][0]["buyer_id"] == buyer_id

    # a cancelled sale says so in both overviews
    assert (await api.client.post(f"/api/admin/orders/{order['id']}/cancel", headers=admin, json={"reason": "Winner withdrew"})).status_code == 200
    again = (await api.client.get(f"/api/admin/users/{buyer_user_id}/overview", headers=admin)).json()["won"][0]["deal"]
    assert again["status"] == "cancelled" and again["status_reason"] == "Winner withdrew"
    vo = (await api.client.get(f"/api/admin/vehicles/{vid}/overview", headers=admin)).json()
    assert vo["sold"] is False and vo["auctions"][0]["deal"]["status"] == "cancelled"

    # admin only
    _, other, _ = await make_user(api)
    assert (await api.client.get("/api/admin/search", headers=other, params={"q": reg})).status_code == 403
    assert (await api.client.get(f"/api/admin/users/{buyer_user_id}/overview", headers=other)).status_code == 403
