"""
The client's flow (default in production): no payment on the website. The winner is told our team will contact
them; there is no deadline, no automatic default, no reminders and no bidding block for an open win.
"""
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.notification import Notification
from app.models.order import Order
from app.services.orders import default_overdue_orders, send_payment_reminders
from test_auctions import action
from test_bidding import bid, live_auction, verified_bidder
from test_kyc import storage  # noqa: F401  (fixture)
from test_orders import set_due


@pytest.fixture
def manual(monkeypatch):
    monkeypatch.setattr(settings, "ONLINE_PAYMENT_FLOW", False)


async def test_winner_is_contacted_not_asked_to_pay_online(api, storage, manual, monkeypatch):
    assert (await api.client.get("/api/site-config")).json()["online_payment"] is False
    admin, _, _, aid = await live_auction(api)
    buyer, buyer_id = await verified_bidder(api)
    await bid(api, buyer, aid, "64000")
    await action(api, admin, aid, "close", reason="Ended")

    async with api.db() as db:
        won = (await db.execute(select(Notification).where(Notification.user_id == buyer_id,
                                                           Notification.kind == "auction_won"))).scalar_one()
    assert "Our team will contact you" in won.body and "please pay by" not in won.body

    [order] = (await api.client.get("/api/orders/mine", headers=buyer)).json()
    assert order["online_payment"] is False and order["approved_amount"] == "64000.00"
    assert order["service_fee"] is None and order["fee_received"] == "0.00"
    refused = await api.client.post(f"/api/orders/{order['id']}/bank-transfer", headers=buyer, json={"utr": "SBIN226100012345"})
    assert refused.status_code == 409 and refused.json()["code"] == "online_payment_off"

    # an open win does not stop the buyer bidding elsewhere
    _, _, _, other = await live_auction(api)
    assert (await bid(api, buyer, other, "60000")).status_code == 201

    # no deadline: nothing defaults, nothing is reminded
    await set_due(api, order["id"], -60)
    assert await default_overdue_orders(api.db) == 0
    async with api.db() as db:
        row = await db.get(Order, uuid.UUID(order["id"]))
        await db.refresh(row)
        assert row.status == "awaiting_payment"
        created = row.created_at
    monkeypatch.setattr(settings, "PAYMENT_REMINDER_HOURS_IST", ",".join(str(h) for h in range(24)))
    assert await send_payment_reminders(api.db, now=created + timedelta(hours=3)) == 0


async def test_dashboard_counts_deals_with_fee_pending(api, storage, manual):
    from test_orders import won_order
    admin, _, _, order, _ = await won_order(api)
    dash = (await api.client.get("/api/admin/dashboard", headers=admin)).json()
    assert dash["online_payment"] is False and dash["deals_fee_pending"] >= 1
    before = dash["deals_fee_pending"]
    await api.client.patch(f"/api/admin/orders/{order['id']}/deal", headers=admin, json={"service_fee": "1000"})
    await api.client.post(f"/api/admin/orders/{order['id']}/fees", headers=admin,
                          json={"amount": "1000", "received_on": "2026-01-02", "reference": "Cash"})
    assert (await api.client.get("/api/admin/dashboard", headers=admin)).json()["deals_fee_pending"] == before - 1
