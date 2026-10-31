"""
The deal on a won auction, kept for the client (a middleman): approved amount, approved date, the client's
service fee, and every amount of that fee received outside the website (cash / UPI / bank). Admin only; every
change is audit-logged; fee entries are append-only (a mistake is corrected with a minus entry and a note).
"""
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import record_audit
from app.core.errors import ApiError
from app.models.fee_payment import FeePayment
from app.models.order import Order
from app.models.user import User
from app.services.notifications import notify

IST = timezone(timedelta(hours=5, minutes=30))
ZERO = Decimal("0.00")


def today_ist() -> date:
    return datetime.now(IST).date()


def ist_noon(day: date) -> datetime:
    """A calendar date stored as a moment: midday India time (stays on the same date in every report)."""
    return datetime.combine(day, time(12, 0), tzinfo=IST).astimezone(timezone.utc)


def money(value) -> str:
    """₹1,23,456 (Indian grouping) for messages."""
    amount = Decimal(value).quantize(Decimal("0.01"))
    sign = "-" if amount < 0 else ""
    whole, frac = f"{abs(amount):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{sign}₹{whole}" + ("" if frac == "00" else f".{frac}")


async def _lock_order(db: AsyncSession, order_id: uuid.UUID) -> Order:
    order = (await db.execute(
        select(Order).options(selectinload(Order.vehicle)).where(Order.id == order_id)
        .with_for_update(of=Order).execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if order is None:
        raise ApiError(404, "Order not found.", "order_not_found")
    return order


async def _recheck_admin(db: AsyncSession, actor: User) -> None:
    row = (await db.execute(select(User.role, User.is_active).where(User.id == actor.id))).first()
    if row is None or row.role != "admin" or not row.is_active:
        raise ApiError(403, "Access denied. You do not have permission to do this.", "forbidden")


async def fee_totals(db: AsyncSession, order_id: uuid.UUID) -> tuple[Decimal, Optional[date]]:
    total, last = (await db.execute(
        select(func.coalesce(func.sum(FeePayment.amount), 0), func.max(FeePayment.received_on))
        .where(FeePayment.order_id == order_id)
    )).one()
    return Decimal(total).quantize(Decimal("0.01")), last


async def deal_view(db: AsyncSession, order: Order) -> dict:
    rows = (await db.execute(
        select(FeePayment, User.name).join(User, User.id == FeePayment.created_by_id)
        .where(FeePayment.order_id == order.id).order_by(FeePayment.created_at, FeePayment.id)
    )).all()
    received = sum((p.amount for p, _ in rows), ZERO)
    return {
        "order_id": order.id, "order_number": order.number, "status": order.status, "status_reason": order.status_reason,
        "closed_at": order.closed_at, "approved_amount": order.approved_amount,
        "approved_at": order.approved_at, "service_fee": order.service_fee, "fee_received": received,
        "fee_pending": None if order.service_fee is None else order.service_fee - received,
        "last_fee_received_on": max((p.received_on for p, _ in rows if p.amount > 0), default=None),
        "payments": [{"id": p.id, "amount": p.amount, "received_on": p.received_on, "reference": p.reference,
                      "note": p.note, "created_at": p.created_at, "created_by_name": name} for p, name in rows],
    }


async def update_deal(db: AsyncSession, actor: User, order_id: uuid.UUID, changes: dict) -> Order:
    order = await _lock_order(db, order_id)
    await _recheck_admin(db, actor)
    if order.status == "cancelled":
        raise ApiError(409, "This deal was cancelled.", "order_closed")
    values = dict(changes)
    if "approved_on" in values:
        day = values.pop("approved_on")
        if day > today_ist():
            raise ApiError(422, "The approved date cannot be in the future.", "invalid_date")
        values["approved_at"] = ist_noon(day)
    if "service_fee" in values:
        received, _ = await fee_totals(db, order.id)
        if values["service_fee"] < received:
            raise ApiError(422, f"The service fee cannot be less than the fee already received ({money(received)}).",
                           "fee_below_received")
    changed = {k: v for k, v in values.items() if getattr(order, k) != v}
    for name, value in changed.items():
        setattr(order, name, value)
    if changed:
        await db.flush()
        await record_audit(db, actor=actor, action="order.deal_update", target_type="order", target_id=order.id,
                           details={"number": order.number, **{k: str(v) for k, v in changed.items()}})
    return order


async def add_fee_payment(db: AsyncSession, actor: User, order_id: uuid.UUID, amount: Decimal, received_on: date,
                          reference: str, note: Optional[str]) -> FeePayment:
    order = await _lock_order(db, order_id)              # one writer per order: totals stay correct
    await _recheck_admin(db, actor)
    if order.status == "cancelled":
        raise ApiError(409, "This deal was cancelled.", "order_closed")
    if order.service_fee is None:
        raise ApiError(409, "Set the service fee first.", "service_fee_missing")
    if received_on > today_ist():
        raise ApiError(422, "The received date cannot be in the future.", "invalid_date")
    received, _ = await fee_totals(db, order.id)
    new_total = received + amount
    if new_total < 0:
        raise ApiError(422, "A correction cannot take the fee received below zero.", "fee_below_zero")
    if new_total > order.service_fee:
        raise ApiError(422, f"This is more than the fee still pending ({money(order.service_fee - received)}). "
                            "Raise the service fee first if the buyer pays more.", "fee_above_service_fee")
    payment = FeePayment(order_id=order.id, amount=amount, received_on=received_on, reference=reference, note=note,
                         created_by_id=actor.id)
    db.add(payment)
    await db.flush()
    await record_audit(db, actor=actor, action="order.fee_received" if amount > 0 else "order.fee_corrected",
                       target_type="order", target_id=order.id,
                       details={"number": order.number, "amount": str(amount), "received_on": received_on.isoformat(),
                                "reference": reference, "note": note})
    if amount > 0:
        v = order.vehicle
        pending = order.service_fee - new_total
        await notify(db, order.buyer_id, "fee_received", f"Service fee received: {money(amount)}",
                     f"{v.manufacturing_year} {v.make} {v.model} {v.variant}: we received {money(amount)} "
                     f"on {received_on.strftime('%d %b %Y')} (reference {reference}). "
                     + ("The service fee is fully paid. Thank you." if pending == 0 else f"Still pending: {money(pending)}."),
                     "/dashboard?tab=won")
    return payment
