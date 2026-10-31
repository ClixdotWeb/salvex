"""
Buyer ID, the deal on a won auction (approved amount / date, service fee, fee received outside the website) and the
monthly report (screen + CSV for Excel) with the "report ready" notice on the 1st.
"""
import csv
import io
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.models.audit_log import AuditLog
from app.models.notification import Notification
from app.models.user import User
from app.services.reports import IST, send_monthly_report_notice
from test_admin_foundation import load_user
from test_kyc import storage  # noqa: F401  (fixture)
from test_orders import won_order
from test_users_admin import make_user

TODAY = datetime.now(IST).date()
MONTH = f"{TODAY.year:04d}-{TODAY.month:02d}"


# ---------------------------------------------------------------------------- Buyer ID
async def test_every_user_gets_a_buyer_id_and_admins_can_search_by_it(api):
    from test_admin_foundation import make_admin
    _, admin = await make_admin(api)
    email, user, uid = await make_user(api)
    me = (await api.client.get("/api/auth/me", headers=user)).json()
    assert me["buyer_id"].startswith("SLX-") and len(me["buyer_id"]) == 10
    async with api.db() as db:
        number = (await db.get(User, uid)).buyer_number
    other_email, _, _ = await make_user(api)
    assert (await load_user(api, other_email)).buyer_number == number + 1               # one after another

    for query in (me["buyer_id"], me["buyer_id"].lower().replace("-", ""), str(number)):
        found = (await api.client.get(f"/api/admin/users?q={query}", headers=admin)).json()["items"]
        assert [u["email"] for u in found if u["buyer_id"] == me["buyer_id"]] == [email], query


# ---------------------------------------------------------------------------- the deal
async def test_deal_starts_with_the_winning_bid_and_only_admins_change_it(api, storage):
    admin, buyer, buyer_id, order, _ = await won_order(api)
    oid = order["id"]
    deal = (await api.client.get(f"/api/admin/orders/{oid}/deal", headers=admin)).json()
    assert deal["approved_amount"] == "75000.00" and deal["approved_at"] and deal["service_fee"] is None
    assert deal["fee_received"] == "0.00" and deal["fee_pending"] is None and deal["payments"] == []

    url = f"/api/admin/orders/{oid}/deal"
    assert (await api.client.patch(url, json={"service_fee": "5000"})).status_code == 401
    assert (await api.client.patch(url, headers=buyer, json={"service_fee": "5000"})).status_code == 403
    for bad in ({}, {"service_fee": "-1"}, {"approved_amount": "0"}, {"approved_on": None},
                {"approved_on": (TODAY + timedelta(days=2)).isoformat()}, {"status": "paid"}):
        assert (await api.client.patch(url, headers=admin, json=bad)).status_code == 422, bad
    res = await api.client.patch(url, headers=admin, json={"service_fee": "5000", "approved_amount": "74000",
                                                           "approved_on": TODAY.isoformat()})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["service_fee"] == "5000.00" and body["approved_amount"] == "74000.00" and body["fee_pending"] == "5000.00"
    async with api.db() as db:
        audit = (await db.execute(select(AuditLog).where(AuditLog.action == "order.deal_update",
                                                         AuditLog.target_id == oid))).scalars().all()
    assert audit and audit[-1].details["service_fee"] == "5000.00"

    detail = (await api.client.get(f"/api/admin/results/{order['auction_id']}", headers=admin)).json()
    assert detail["deal"]["service_fee"] == "5000.00" and detail["winner_buyer_id"].startswith("SLX-")
    row = next(r for r in (await api.client.get("/api/admin/results?page_size=100", headers=admin)).json()["items"]
               if r["auction_id"] == order["auction_id"])
    assert row["fee_pending"] == "5000.00" and row["winner_buyer_id"] == detail["winner_buyer_id"]


async def test_fee_received_part_payments_corrections_and_limits(api, storage):
    admin, buyer, buyer_id, order, _ = await won_order(api)
    oid = order["id"]
    fees = f"/api/admin/orders/{oid}/fees"
    first = {"amount": "3000", "received_on": TODAY.isoformat(), "reference": "UPI 4567 8901"}
    assert (await api.client.post(fees, headers=admin, json=first)).status_code == 409                # no fee set yet
    await api.client.patch(f"/api/admin/orders/{oid}/deal", headers=admin, json={"service_fee": "5000"})

    assert (await api.client.post(fees, headers=buyer, json=first)).status_code == 403
    res = await api.client.post(fees, headers=admin, json=first)
    assert res.status_code == 201 and res.json()["fee_received"] == "3000.00" and res.json()["fee_pending"] == "2000.00"
    async with api.db() as db:
        note = (await db.execute(select(Notification).where(Notification.user_id == buyer_id,
                                                            Notification.kind == "fee_received"))).scalar_one()
    assert "₹3,000" in note.title and "Still pending: ₹2,000" in note.body

    for bad in ({**first, "amount": "0"}, {**first, "amount": "-100"},                 # minus needs a note
                {**first, "reference": "  "}, {**first, "received_on": (TODAY + timedelta(days=1)).isoformat()},
                {**first, "extra": 1}):
        assert (await api.client.post(fees, headers=admin, json=bad)).status_code == 422, bad
    too_much = await api.client.post(fees, headers=admin, json={**first, "amount": "2500"})
    assert too_much.status_code == 422 and too_much.json()["code"] == "fee_above_service_fee"
    fix = await api.client.post(fees, headers=admin, json={**first, "amount": "-500", "note": "Typed 3000, was 2500"})
    assert fix.status_code == 201 and fix.json()["fee_received"] == "2500.00"
    below = await api.client.post(fees, headers=admin, json={**first, "amount": "-3000", "note": "x"})
    assert below.status_code == 422
    lower = await api.client.patch(f"/api/admin/orders/{oid}/deal", headers=admin, json={"service_fee": "2000"})
    assert lower.status_code == 422 and lower.json()["code"] == "fee_below_received"
    done = await api.client.post(fees, headers=admin, json={**first, "amount": "2500", "reference": "Cash"})
    assert done.json()["fee_pending"] == "0.00" and len(done.json()["payments"]) == 3

    async with api.db() as db:                                                              # append-only
        pid = done.json()["payments"][0]["id"]
        for sql in ("UPDATE fee_payments SET amount = 1 WHERE id = :i", "DELETE FROM fee_payments WHERE id = :i"):
            with pytest.raises(DBAPIError):
                async with db.begin_nested():
                    await db.execute(text(sql), {"i": pid})


# ---------------------------------------------------------------------------- monthly report
async def test_monthly_report_lists_deals_vehicles_and_buyers_with_totals(api, storage):
    admin, buyer, buyer_id, order, vid = await won_order(api)
    oid = order["id"]
    await api.client.patch(f"/api/admin/orders/{oid}/deal", headers=admin, json={"service_fee": "4000"})
    await api.client.post(f"/api/admin/orders/{oid}/fees", headers=admin,
                          json={"amount": "1500", "received_on": TODAY.isoformat(), "reference": "=SUM(A1)"})
    assert (await api.client.get(f"/api/admin/reports/monthly?month={MONTH}", headers=buyer)).status_code == 403
    report = (await api.client.get(f"/api/admin/reports/monthly?month={MONTH}", headers=admin)).json()
    row = next(p for p in report["payments"] if p["order_id"] == oid)
    async with api.db() as db:
        user = await db.get(User, buyer_id)
    assert row["buyer_id"] == user.buyer_id and row["buyer_name"] == user.name and row["claim_number"]
    assert row["approved_amount"] == "75000.00" and row["service_fee"] == "4000.00"
    assert row["fee_received"] == "1500.00" and row["fee_pending"] == "2500.00" and row["fee_received_on"] == TODAY.isoformat()
    assert any(v["vehicle_id"] == vid for v in report["vehicles"])
    assert any(b["user_id"] == str(buyer_id) for b in report["buyers"])
    t = report["totals"]
    assert t["deals"] >= 1 and float(t["fee_received"]) >= 1500 and t["vehicles_uploaded"] >= 1 and t["buyers_registered"] >= 1

    csv_res = await api.client.get(f"/api/admin/reports/monthly/export?month={MONTH}&section=payments", headers=admin)
    assert csv_res.status_code == 200 and csv_res.headers["content-type"].startswith("text/csv")
    assert "attachment" in csv_res.headers["content-disposition"]
    content = csv_res.content.decode("utf-8")
    assert content.startswith("﻿")
    lines = list(csv.reader(io.StringIO(content.lstrip("﻿"))))
    assert lines[1][:3] == ["Claim number", "Vehicle", "Registration"]
    mine = next(line for line in lines if order["number"] in line)
    assert "'=SUM(A1)" in mine                                         # formulas are neutralised for Excel
    for section in ("vehicles", "buyers"):
        assert (await api.client.get(f"/api/admin/reports/monthly/export?month={MONTH}&section={section}",
                                     headers=admin)).status_code == 200
    for bad in ("month=2026-13", "month=26-10", "section=money"):
        assert (await api.client.get(f"/api/admin/reports/monthly/export?{bad}", headers=admin)).status_code == 422, bad

    # a different month does not contain this deal
    other = (await api.client.get("/api/admin/reports/monthly?month=2020-01", headers=admin)).json()
    assert all(p["order_id"] != oid for p in other["payments"])


async def test_report_ready_notice_once_on_the_first(api):
    from test_admin_foundation import make_admin
    admin_email, _ = await make_admin(api)
    admin_id = (await load_user(api, admin_email)).id
    first = datetime(2031, 3, 1, 9, 30, tzinfo=IST)
    assert await send_monthly_report_notice(api.db, now=first - timedelta(hours=1)) is False      # before 9 am
    assert await send_monthly_report_notice(api.db, now=first) is True
    assert await send_monthly_report_notice(api.db, now=first + timedelta(hours=2)) is False      # once only
    assert await send_monthly_report_notice(api.db, now=first + timedelta(days=1)) is False       # not on the 2nd
    async with api.db() as db:
        note = (await db.execute(select(Notification).where(Notification.user_id == admin_id,
                                                            Notification.kind == "monthly_report"))).scalar_one()
    assert note.title == "February 2031 report is ready" and note.link == "/admin?tab=reports&month=2031-02"
    assert note.email_status == "pending"


async def test_deal_completed_or_sale_cancelled_from_the_result(api, storage):
    """No online payment: the admin marks the deal completed, or cancels the sale when the winner withdraws."""
    admin, buyer, _, order, vid = await won_order(api)
    oid = order["id"]
    deal = (await api.client.get(f"/api/admin/orders/{oid}/deal", headers=admin)).json()
    assert deal["status"] == "awaiting_payment"

    # cancel: the vehicle is free again for a new auction and back on the website
    _, other, _ = await make_user(api)
    assert (await api.client.post(f"/api/admin/orders/{oid}/cancel", headers=other, json={"reason": "x y z"})).status_code == 403
    assert (await api.client.post(f"/api/admin/orders/{oid}/cancel", headers=admin, json={})).status_code == 422
    res = await api.client.post(f"/api/admin/orders/{oid}/cancel", headers=admin, json={"reason": "Winner withdrew"})
    assert res.status_code == 200 and res.json()["status"] == "cancelled"
    deal = (await api.client.get(f"/api/admin/orders/{oid}/deal", headers=admin)).json()
    assert deal["status"] == "cancelled" and deal["status_reason"] == "Winner withdrew"
    ready = (await api.client.get("/api/admin/vehicles?ready_for_auction=true&page_size=100", headers=admin)).json()["items"]
    assert any(v["id"] == vid for v in ready)
    mine = (await api.client.get("/api/orders/mine", headers=buyer)).json()
    assert mine[0]["status"] == "cancelled"
    assert (await api.client.post(f"/api/admin/orders/{oid}/complete", headers=admin, json={})).status_code == 409

    # complete: another sale, marked completed; the buyer is told, nothing can be cancelled afterwards
    admin2, buyer2, buyer2_id, order2, _ = await won_order(api)
    done = await api.client.post(f"/api/admin/orders/{order2['id']}/complete", headers=admin2, json={"reason": "Handed over on 26 Oct"})
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "paid" and done.json()["status_reason"] == "Handed over on 26 Oct"
    assert (await api.client.get("/api/orders/mine", headers=buyer2)).json()[0]["status"] == "paid"
    async with api.db() as db:
        kinds = (await db.execute(select(Notification.kind).where(Notification.user_id == buyer2_id))).scalars().all()
    assert "deal_completed" in kinds
    assert (await api.client.post(f"/api/admin/orders/{order2['id']}/cancel", headers=admin2, json={"reason": "late"})).status_code == 409
    assert (await api.client.post(f"/api/admin/orders/{order2['id']}/complete", headers=admin2, json={})).status_code == 409


def test_vehicle_photos_have_their_own_bigger_upload_limit():
    from app.core.rate_limit import POLICIES
    assert POLICIES["photo"][0][1] >= 1000 and POLICIES["upload"][0][1] == 60       # KYC documents keep the strict limit
