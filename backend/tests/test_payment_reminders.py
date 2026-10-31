"""
Payment reminders for unpaid wins: three a day (9 am, 2 pm, 7 pm IST by default) until paid / UTR sent / deadline.
"""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.config import settings
from app.models.notification import Notification
from app.models.order import Order
from app.services.orders import IST, latest_reminder_slot, send_payment_reminders
from test_kyc import storage  # noqa: F401  (fixture)
from test_orders import won_order


async def reminders(api, user_id):
    async with api.db() as db:
        return (await db.execute(select(Notification).where(Notification.user_id == user_id,
                                                            Notification.kind == "payment_reminder"))).scalars().all()


def test_reminder_slots_follow_indian_time(monkeypatch):
    monkeypatch.setattr(settings, "PAYMENT_REMINDER_HOURS_IST", "9,14,19")
    at = lambda d, h, m=0: datetime(2026, 10, d, h, m, tzinfo=IST)          # noqa: E731
    assert latest_reminder_slot(at(24, 9, 30)) == at(24, 9).astimezone(timezone.utc)
    assert latest_reminder_slot(at(24, 15, 0)) == at(24, 14).astimezone(timezone.utc)
    assert latest_reminder_slot(at(24, 8, 59)) == at(23, 19).astimezone(timezone.utc)   # before 9 am: yesterday 7 pm
    monkeypatch.setattr(settings, "PAYMENT_REMINDER_HOURS_IST", "")
    assert latest_reminder_slot(at(24, 10)) is None


async def test_one_reminder_per_slot_until_the_winner_pays(api, storage, monkeypatch):
    monkeypatch.setattr(settings, "PAYMENT_REMINDER_HOURS_IST", ",".join(str(h) for h in range(24)))   # every hour, for the test
    admin, buyer, buyer_id, order, _ = await won_order(api)
    async with api.db() as db:
        created = (await db.get(Order, uuid.UUID(order["id"]))).created_at
    now = latest_reminder_slot(created + timedelta(hours=3)) + timedelta(minutes=5)          # 5 min into a slot (IST is UTC+5:30)

    # a just-created order is not reminded at once (the "you won" message was just sent)
    assert await send_payment_reminders(api.db, now=created + timedelta(minutes=10)) == 0

    assert await send_payment_reminders(api.db, now=now) == 1
    assert await send_payment_reminders(api.db, now=now + timedelta(minutes=20)) == 0          # same slot: no repeat
    [first] = await reminders(api, buyer_id)
    assert first.title.startswith("Payment reminder: ") and "left" in first.title
    assert order["number"] in first.body and "75000" in first.body and first.link == "/dashboard?tab=won"
    assert first.email_status == "pending"                                                      # also goes by email

    assert await send_payment_reminders(api.db, now=now + timedelta(hours=1)) == 1              # next slot
    async with api.db() as db:
        row = await db.get(Order, uuid.UUID(order["id"]))
        await db.refresh(row)
    assert row.reminder_count == 2

    # once the winner submits the UTR the reminders stop
    sent = await api.client.post(f"/api/orders/{order['id']}/bank-transfer", headers=buyer, json={"utr": "SBIN226100099999"})
    assert sent.status_code == 200
    assert await send_payment_reminders(api.db, now=now + timedelta(hours=2)) == 0
    assert len(await reminders(api, buyer_id)) == 2


async def test_no_reminder_after_the_deadline_or_when_switched_off(api, storage, monkeypatch):
    monkeypatch.setattr(settings, "PAYMENT_REMINDER_HOURS_IST", ",".join(str(h) for h in range(24)))
    _, _, buyer_id, order, _ = await won_order(api)
    async with api.db() as db:
        row = await db.get(Order, uuid.UUID(order["id"]))
        late = row.due_at + timedelta(minutes=5)
    assert await send_payment_reminders(api.db, now=late) == 0
    monkeypatch.setattr(settings, "PAYMENT_REMINDER_HOURS_IST", "")
    assert await send_payment_reminders(api.db, now=late - timedelta(hours=10)) == 0
    assert await reminders(api, buyer_id) == []
