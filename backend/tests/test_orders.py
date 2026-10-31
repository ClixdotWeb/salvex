"""
Winner payment: order creation on close, payment-due bidding block, bank transfer (UTR) submit / confirm /
reject, cancel, automatic default with bidding block, admin unblock, and re-auction after a default.
"""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.config import settings
from app.models.audit_log import AuditLog
from app.models.order import Order
from app.models.user import User
from app.services.orders import PERMANENT, default_overdue_orders
from test_auctions import action, new_auction
from test_bidding import bid, live_auction, verified_bidder
from test_kyc import storage  # noqa: F401  (fixture)
from test_users_admin import make_user


async def won_order(api):
    """admin headers, buyer headers, buyer id, order json, vehicle id - for an auction the buyer just won."""
    admin, _, _, aid = await live_auction(api)
    buyer, buyer_id = await verified_bidder(api)
    assert (await bid(api, buyer, aid, "75000")).status_code == 201
    assert (await action(api, admin, aid, "close", reason="Ended")).status_code == 200
    orders = (await api.client.get("/api/orders/mine", headers=buyer)).json()
    assert len(orders) == 1
    vid = (await api.client.get(f"/api/auctions/{aid}")).json()["vehicle"]["id"]
    return admin, buyer, buyer_id, orders[0], vid


async def set_due(api, order_id, minutes):
    async with api.db() as db:
        (await db.get(Order, uuid.UUID(order_id))).due_at = datetime.now(timezone.utc) + timedelta(minutes=minutes)
        await db.commit()


async def test_closing_a_sold_auction_creates_the_winners_order(api, storage):
    admin, buyer, buyer_id, order, _ = await won_order(api)
    assert order["status"] == "awaiting_payment" and order["amount"] == "75000.00"
    assert order["number"].startswith(f"ORD-{datetime.now(timezone.utc).year}-")
    due = datetime.fromisoformat(order["due_at"]) - datetime.fromisoformat(order["server_time"])
    assert timedelta(hours=settings.ORDER_PAYMENT_DEADLINE_HOURS) - timedelta(minutes=1) < due <= timedelta(hours=settings.ORDER_PAYMENT_DEADLINE_HOURS)
    assert order["bank"] is None                                         # until the company's bank details are set
    assert (await api.client.get(f"/api/orders/{order['id']}", headers=admin)).status_code == 200
    _, stranger, _ = await make_user(api, "bidder")
    assert (await api.client.get(f"/api/orders/{order['id']}", headers=stranger)).status_code == 404
    async with api.db() as db:
        entry = (await db.execute(select(AuditLog).where(AuditLog.action == "order.create", AuditLog.target_id == order["id"]))).scalar_one()
    assert entry.actor_role == "system" and entry.details["amount"] == "75000.00"


async def test_no_sale_creates_no_order(api, storage):
    admin, _, _, aid = await live_auction(api)
    await action(api, admin, aid, "close", reason="Nobody bid")
    async with api.db() as db:
        assert (await db.execute(select(Order).where(Order.auction_id == uuid.UUID(aid)))).first() is None


async def test_an_unpaid_win_blocks_new_bids_until_paid(api, storage):
    admin, buyer, _, order, _ = await won_order(api)
    _, _, _, other_auction = await live_auction(api)
    refused = await bid(api, buyer, other_auction, "60000")
    assert refused.status_code == 403 and refused.json()["code"] == "payment_due"
    await api.client.post(f"/api/orders/{order['id']}/bank-transfer", headers=buyer, json={"utr": "SBIN226100012345"})
    assert (await bid(api, buyer, other_auction, "60000")).json()["code"] == "payment_due"   # still unpaid until confirmed
    confirmed = await api.client.post(f"/api/admin/orders/{order['id']}/confirm-payment", headers=admin)
    assert confirmed.status_code == 200 and confirmed.json()["status"] == "paid"
    assert (await bid(api, buyer, other_auction, "60000")).status_code == 201


async def test_bank_transfer_submission_rules(api, storage):
    admin, buyer, _, order, _ = await won_order(api)
    url = f"/api/orders/{order['id']}/bank-transfer"
    for utr in ("12", "not a utr!", "x" * 41):
        assert (await api.client.post(url, headers=buyer, json={"utr": utr})).status_code == 422, utr
    _, stranger, _ = await make_user(api, "bidder")
    assert (await api.client.post(url, headers=stranger, json={"utr": "SBIN226100099999"})).status_code == 404
    ok = await api.client.post(url, headers=buyer, json={"utr": "sbin 2261-0009 9999"})
    assert ok.status_code == 200 and ok.json()["status"] == "payment_submitted" and ok.json()["utr"] == "SBIN226100099999"
    again = await api.client.post(url, headers=buyer, json={"utr": "SBIN226100011111"})
    assert again.status_code == 409 and again.json()["code"] == "order_not_awaiting_payment"

    _, buyer2, _, order2, _ = await won_order(api)                       # the same UTR cannot pay a second order
    reused = await api.client.post(f"/api/orders/{order2['id']}/bank-transfer", headers=buyer2, json={"utr": "SBIN226100099999"})
    assert reused.status_code == 409 and reused.json()["code"] == "utr_already_used"
    await set_due(api, order2["id"], -1)
    late = await api.client.post(f"/api/orders/{order2['id']}/bank-transfer", headers=buyer2, json={"utr": "SBIN226100077777"})
    assert late.status_code == 409 and late.json()["code"] == "order_overdue"


async def test_admin_confirms_or_rejects_a_payment(api, storage):
    admin, buyer, _, order, _ = await won_order(api)
    oid = order["id"]
    assert (await api.client.post(f"/api/admin/orders/{oid}/confirm-payment", headers=admin)).status_code == 409   # nothing submitted
    await api.client.post(f"/api/orders/{oid}/bank-transfer", headers=buyer, json={"utr": "HDFC000123456789"})
    assert (await api.client.post(f"/api/admin/orders/{oid}/reject-payment", headers=admin, json={"reason": "x"})).status_code == 422
    rejected = await api.client.post(f"/api/admin/orders/{oid}/reject-payment", headers=admin, json={"reason": "Not in the bank statement"})
    assert rejected.status_code == 200 and rejected.json()["status"] == "awaiting_payment" and rejected.json()["utr"] is None
    mine = (await api.client.get(f"/api/orders/{oid}", headers=buyer)).json()
    assert mine["status_reason"] == "Not in the bank statement"
    await api.client.post(f"/api/orders/{oid}/bank-transfer", headers=buyer, json={"utr": "HDFC000123456790"})
    paid = (await api.client.post(f"/api/admin/orders/{oid}/confirm-payment", headers=admin)).json()
    assert paid["status"] == "paid" and paid["paid_at"] and paid["buyer_email"]
    assert (await api.client.post(f"/api/admin/orders/{oid}/confirm-payment", headers=admin)).status_code == 409
    assert (await api.client.post(f"/api/admin/orders/{oid}/confirm-payment", headers=buyer)).status_code == 403
    listed = (await api.client.get("/api/admin/orders?status=paid&page_size=100", headers=admin)).json()
    assert oid in [o["id"] for o in listed["items"]]
    async with api.db() as db:
        actions = (await db.execute(select(AuditLog.action).where(AuditLog.target_id == oid).order_by(AuditLog.created_at))).scalars().all()
    assert actions == ["order.create", "order.payment_submitted", "order.payment_rejected", "order.payment_submitted", "order.payment_confirmed"]


async def test_overdue_orders_default_and_block_bidding(api, storage):
    admin, buyer, buyer_id, order, vid = await won_order(api)
    await set_due(api, order["id"], -1)
    assert await default_overdue_orders(api.db) >= 1
    mine = (await api.client.get(f"/api/orders/{order['id']}", headers=buyer)).json()
    assert mine["status"] == "defaulted"
    async with api.db() as db:
        user = await db.get(User, buyer_id)
        await db.refresh(user)
    assert user.payment_defaults == 1
    assert timedelta(days=settings.DEFAULT_BIDDING_BLOCK_DAYS - 1) < user.bidding_blocked_until - datetime.now(timezone.utc)

    _, _, _, other = await live_auction(api)
    refused = await bid(api, buyer, other, "60000")
    assert refused.status_code == 403 and refused.json()["code"] == "bidding_blocked"
    # the defaulted vehicle can go back to auction
    assert (await new_auction(api, admin, vid)).status_code == 201

    # admin lifts the block (reason required, audited)
    assert (await api.client.post(f"/api/admin/users/{buyer_id}/unblock-bidding", headers=admin, json={"reason": "x"})).status_code == 422
    lifted = await api.client.post(f"/api/admin/users/{buyer_id}/unblock-bidding", headers=admin, json={"reason": "Paid offline after talking to us"})
    assert lifted.status_code == 200 and lifted.json()["bidding_blocked_until"] is None and lifted.json()["payment_defaults"] == 1
    assert (await bid(api, buyer, other, "60000")).status_code == 201


async def test_repeated_defaults_block_permanently_and_pending_utrs_are_not_defaulted(api, storage):
    admin, buyer, buyer_id, order, _ = await won_order(api)
    async with api.db() as db:
        (await db.get(User, buyer_id)).payment_defaults = settings.PERMANENT_BLOCK_AFTER_DEFAULTS - 1
        await db.commit()
    await set_due(api, order["id"], -1)
    await default_overdue_orders(api.db)
    async with api.db() as db:
        user = await db.get(User, buyer_id)
        await db.refresh(user)
    assert user.bidding_blocked_until == PERMANENT

    _, buyer2, _, order2, _ = await won_order(api)
    await api.client.post(f"/api/orders/{order2['id']}/bank-transfer", headers=buyer2, json={"utr": "ICIC000987654321"})
    await set_due(api, order2["id"], -1)
    await default_overdue_orders(api.db)
    assert (await api.client.get(f"/api/orders/{order2['id']}", headers=buyer2)).json()["status"] == "payment_submitted"


async def test_cancelling_an_order_frees_the_vehicle_without_penalty(api, storage):
    admin, buyer, buyer_id, order, vid = await won_order(api)
    cancelled = await api.client.post(f"/api/admin/orders/{order['id']}/cancel", headers=admin, json={"reason": "Vehicle damaged in the yard"})
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert (await new_auction(api, admin, vid)).status_code == 201
    async with api.db() as db:
        user = await db.get(User, buyer_id)
        await db.refresh(user)
    assert user.payment_defaults == 0 and user.bidding_blocked_until is None


async def test_bank_details_come_from_settings(api, storage, monkeypatch):
    for name, value in (("COMPANY_BANK_ACCOUNT_NAME", "Salvex Auctions Pvt Ltd"), ("COMPANY_BANK_ACCOUNT_NUMBER", "000123456789"),
                        ("COMPANY_BANK_IFSC", "HDFC0000001"), ("COMPANY_BANK_NAME", "HDFC Bank"), ("COMPANY_BANK_BRANCH", "Kochi")):
        monkeypatch.setattr(settings, name, value)
    _, buyer, _, order, _ = await won_order(api)
    assert order["bank"] == {"account_name": "Salvex Auctions Pvt Ltd", "account_number": "000123456789",
                             "ifsc": "HDFC0000001", "bank_name": "HDFC Bank", "branch": "Kochi"}


async def test_a_vehicle_sold_in_an_auction_leaves_the_public_catalogue(api, storage):
    admin, _, _, order, vid = await won_order(api)
    listed = (await api.client.get("/api/catalogue/vehicles?page_size=100")).json()["items"]
    assert all(v["id"] != vid for v in listed)
    detail = (await api.client.get(f"/api/catalogue/vehicles/{vid}")).json()
    assert detail["sold"] is True                    # an old link still opens and says "sold"
    # a cancelled sale makes the vehicle available again
    assert (await api.client.post(f"/api/admin/orders/{order['id']}/cancel", headers=admin,
                                  json={"reason": "Buyer withdrew"})).status_code == 200
    listed = (await api.client.get("/api/catalogue/vehicles?page_size=100")).json()["items"]
    assert any(v["id"] == vid for v in listed)
    assert (await api.client.get(f"/api/catalogue/vehicles/{vid}")).json()["sold"] is False


async def test_a_vehicle_sold_in_an_auction_leaves_the_public_catalogue(api, storage):
    admin, _, _, order, vid = await won_order(api)
    listed = (await api.client.get("/api/catalogue/vehicles?page_size=100")).json()["items"]
    assert all(v["id"] != vid for v in listed)
    detail = (await api.client.get(f"/api/catalogue/vehicles/{vid}")).json()
    assert detail["sold"] is True                    # an old link still opens and says "sold"
    # a cancelled sale makes the vehicle available again
    assert (await api.client.post(f"/api/admin/orders/{order['id']}/cancel", headers=admin,
                                  json={"reason": "Buyer withdrew"})).status_code == 200
    listed = (await api.client.get("/api/catalogue/vehicles?page_size=100")).json()["items"]
    assert any(v["id"] == vid for v in listed)
    assert (await api.client.get(f"/api/catalogue/vehicles/{vid}")).json()["sold"] is False
