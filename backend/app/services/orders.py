"""
Orders and winner payment. Functions add changes and audit entries to the caller's session WITHOUT
committing; the route (or the closer) commits once, so a status change and its audit entry are saved together.

Rules (values in settings, provisional until the client confirms):
  * a sold auction creates one order for the winner, amount = final price, due in ORDER_PAYMENT_DEADLINE_HOURS;
  * while a user has an unpaid order (awaiting_payment / payment_submitted) they cannot place new bids;
  * bank transfer: the buyer enters the UTR; an admin checks the bank statement and confirms (or rejects);
  * an order still awaiting payment after its deadline defaults automatically: the default is counted and
    bidding is blocked for DEFAULT_BIDDING_BLOCK_DAYS; after PERMANENT_BLOCK_AFTER_DEFAULTS defaults, for good.
    (An order whose UTR is waiting for verification is never defaulted automatically - finance decides.)
"""
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import exists, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import record_audit
from app.core.config import settings
from app.core.errors import ApiError
from app.models.auction import Auction
from app.models.order import OPEN_ORDER_STATUSES, Order
from app.models.user import User
from app.services.notifications import notify, notify_admins

PERMANENT = datetime(9999, 12, 31, tzinfo=timezone.utc)
_UTR = re.compile(r"^[A-Z0-9]{6,30}$")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


async def _next_number(db: AsyncSession) -> str:
    n = (await db.execute(text("SELECT nextval('order_number_seq')"))).scalar_one()
    return f"ORD-{now_utc().year}-{n:06d}"


async def create_order_for(db: AsyncSession, auction: Auction) -> Optional[Order]:
    """Called inside the transaction that closes a sold auction."""
    if auction.result != "sold" or auction.current_winner_id is None:
        return None
    order = Order(
        number=await _next_number(db), auction_id=auction.id, vehicle_id=auction.vehicle_id,
        buyer_id=auction.current_winner_id, amount=auction.current_price, status="awaiting_payment",
        due_at=now_utc() + timedelta(hours=settings.ORDER_PAYMENT_DEADLINE_HOURS),
        approved_amount=auction.current_price, approved_at=now_utc(),
    )
    db.add(order)
    await db.flush()
    await record_audit(db, actor=None, action="order.create", target_type="order", target_id=order.id,
                       details={"number": order.number, "auction_id": auction.id, "amount": str(order.amount),
                                "buyer_id": order.buyer_id, "due_at": order.due_at.isoformat()})
    return order


async def bidding_refusal(db: AsyncSession, user: User) -> Optional[ApiError]:
    """Why this user may not bid right now (payment discipline), or None."""
    if user.bidding_blocked_until is not None and user.bidding_blocked_until > now_utc():
        until = "permanently" if user.bidding_blocked_until >= PERMANENT - timedelta(days=1) \
            else f"until {user.bidding_blocked_until.date().isoformat()}"
        return ApiError(403, f"Bidding is blocked {until} because a won auction was not paid.", "bidding_blocked")
    if not settings.ONLINE_PAYMENT_FLOW:
        return None                                # wins are settled with our team, not a reason to stop bidding
    unpaid = (await db.execute(select(exists().where(Order.buyer_id == user.id, Order.status.in_(OPEN_ORDER_STATUSES))))).scalar()
    if unpaid:
        return ApiError(403, "Please complete the payment for the auction you won before bidding again.", "payment_due")
    return None


async def _lock(db: AsyncSession, order_id: uuid.UUID) -> Order:
    order = (await db.execute(
        select(Order).where(Order.id == order_id).with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if order is None:
        raise ApiError(404, "Order not found.", "order_not_found")
    return order


async def _recheck_admin(db: AsyncSession, actor: User) -> None:
    row = (await db.execute(
        select(User).where(User.id == actor.id).with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if row is None or row.role != "admin" or not row.is_active:
        raise ApiError(403, "Access denied. You do not have permission to do this.", "forbidden")


def normalise_utr(value: str) -> str:
    clean = re.sub(r"[\s\-]", "", (value or "").upper())
    if not _UTR.match(clean):
        raise ApiError(422, "Enter the UTR / transaction reference exactly as your bank shows it (6-30 letters and digits).", "invalid_utr")
    return clean


async def submit_bank_transfer(db: AsyncSession, buyer: User, order_id: uuid.UUID, utr: str) -> Order:
    if not settings.ONLINE_PAYMENT_FLOW:
        raise ApiError(409, "Payment is arranged directly with our team. We will contact you.", "online_payment_off")
    clean = normalise_utr(utr)
    order = await _lock(db, order_id)
    if order.buyer_id != buyer.id:
        raise ApiError(404, "Order not found.", "order_not_found")
    if order.status != "awaiting_payment":
        raise ApiError(409, "This order is not waiting for a payment.", "order_not_awaiting_payment")
    if order.due_at <= now_utc():
        raise ApiError(409, "The payment deadline for this order has passed. Please contact support.", "order_overdue")
    order.status = "payment_submitted"
    order.payment_method = "bank_transfer"
    order.utr = clean
    order.payment_submitted_at = now_utc()
    order.status_reason = None
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise ApiError(409, "This UTR has already been used for another payment.", "utr_already_used") from None
    await record_audit(db, actor=buyer, action="order.payment_submitted", target_type="order", target_id=order.id,
                       details={"number": order.number, "utr": clean, "method": "bank_transfer"})
    await notify_admins(db, "payment_submitted", "Payment to verify", f"{order.number}: UTR {clean} for {order.amount}.",
                        f"/admin?tab=orders&status=payment_submitted&open={order.id}")
    return order


async def confirm_payment(db: AsyncSession, actor: User, order_id: uuid.UUID) -> Order:
    order = await _lock(db, order_id)
    await _recheck_admin(db, actor)
    if order.status != "payment_submitted":
        raise ApiError(409, "Only a submitted payment can be confirmed.", "order_not_submitted")
    now = now_utc()
    order.status, order.paid_at, order.closed_at, order.confirmed_by_id = "paid", now, now, actor.id
    await record_audit(db, actor=actor, action="order.payment_confirmed", target_type="order", target_id=order.id,
                       details={"number": order.number, "utr": order.utr, "amount": str(order.amount)})
    await notify(db, order.buyer_id, "payment_confirmed", "Payment confirmed",
                 f"We received your payment for {order.number}. Our team will contact you about the vehicle handover.", "/dashboard?tab=won")
    return order


async def reject_payment(db: AsyncSession, actor: User, order_id: uuid.UUID, reason: str) -> Order:
    """The UTR could not be matched: back to awaiting payment so the buyer can correct it before the deadline."""
    order = await _lock(db, order_id)
    await _recheck_admin(db, actor)
    if order.status != "payment_submitted":
        raise ApiError(409, "Only a submitted payment can be rejected.", "order_not_submitted")
    rejected_utr = order.utr
    order.status, order.utr, order.payment_submitted_at, order.status_reason = "awaiting_payment", None, None, reason
    await record_audit(db, actor=actor, action="order.payment_rejected", target_type="order", target_id=order.id,
                       details={"number": order.number, "utr": rejected_utr, "reason": reason})
    await notify(db, order.buyer_id, "payment_rejected", "Payment reference not verified",
                 f"{order.number}: {reason}. Please check and enter the correct UTR before the deadline.", "/dashboard?tab=won")
    return order


async def complete_deal(db: AsyncSession, actor: User, order_id: uuid.UUID, note: Optional[str]) -> Order:
    """No online payment: the admin marks the deal done once the buyer and the owner have completed it."""
    order = await _lock(db, order_id)
    await _recheck_admin(db, actor)
    if order.status not in OPEN_ORDER_STATUSES:
        raise ApiError(409, "This deal is already completed or cancelled.", "order_closed")
    now = now_utc()
    order.status, order.paid_at, order.closed_at, order.confirmed_by_id = "paid", now, now, actor.id
    order.status_reason = note or "Deal completed"
    await record_audit(db, actor=actor, action="order.deal_completed", target_type="order", target_id=order.id,
                       details={"number": order.number, "note": note})
    await notify(db, order.buyer_id, "deal_completed", "Purchase completed",
                 f"{order.number}: your purchase is complete. Thank you for buying with Salvex.", "/dashboard?tab=won")
    return order


async def cancel_order(db: AsyncSession, actor: User, order_id: uuid.UUID, reason: str) -> Order:
    """Admin cancels (e.g. the sale fell through for a reason that is not the buyer's fault). No penalty."""
    order = await _lock(db, order_id)
    await _recheck_admin(db, actor)
    if order.status not in OPEN_ORDER_STATUSES:
        raise ApiError(409, "Only an unpaid order can be cancelled.", "order_closed")
    order.status, order.closed_at, order.status_reason = "cancelled", now_utc(), reason
    await record_audit(db, actor=actor, action="order.cancel", target_type="order", target_id=order.id,
                       details={"number": order.number, "reason": reason})
    await notify(db, order.buyer_id, "order_cancelled", "Order cancelled", f"{order.number} was cancelled: {reason}", "/dashboard?tab=won")
    return order


async def apply_default(db: AsyncSession, order: Order) -> None:
    """Mark a LOCKED overdue order defaulted and block the buyer's bidding (system action)."""
    now = now_utc()
    order.status, order.closed_at, order.status_reason = "defaulted", now, "Payment deadline passed"
    buyer = (await db.execute(
        select(User).where(User.id == order.buyer_id).with_for_update().execution_options(populate_existing=True)
    )).scalar_one()
    buyer.payment_defaults += 1
    permanent = buyer.payment_defaults >= settings.PERMANENT_BLOCK_AFTER_DEFAULTS
    buyer.bidding_blocked_until = PERMANENT if permanent else now + timedelta(days=settings.DEFAULT_BIDDING_BLOCK_DAYS)
    await record_audit(db, actor=None, action="order.default", target_type="order", target_id=order.id,
                       details={"number": order.number, "buyer_id": buyer.id, "defaults": buyer.payment_defaults,
                                "blocked": "permanently" if permanent else f"{settings.DEFAULT_BIDDING_BLOCK_DAYS} days"})
    await notify(db, buyer.id, "order_defaulted", "Payment deadline missed",
                 f"{order.number} was not paid in time and is cancelled. Bidding on your account is blocked. Please contact support.",
                 "/dashboard?tab=won")


async def default_overdue_orders(session_factory, limit: int = 100) -> int:
    """Run by the background closer: each overdue order in its own transaction, skipping locked rows."""
    if not settings.ONLINE_PAYMENT_FLOW:
        return 0                                   # payment is arranged outside the website: no deadline
    async with session_factory() as db:
        due = (await db.execute(
            select(Order.id).where(Order.status == "awaiting_payment", Order.due_at <= now_utc()).limit(limit)
        )).scalars().all()
    done = 0
    for order_id in due:
        async with session_factory() as db:
            order = (await db.execute(
                select(Order).where(Order.id == order_id).with_for_update(skip_locked=True)
                .execution_options(populate_existing=True)
            )).scalar_one_or_none()
            if order is None or order.status != "awaiting_payment" or order.due_at > now_utc():
                await db.rollback()
                continue
            await apply_default(db, order)
            await db.commit()
            done += 1
    return done


IST = timezone(timedelta(hours=5, minutes=30))
REMINDER_WINDOW = timedelta(hours=4)       # a reminder slot is still sent this long after its time (e.g. after a restart)


def reminder_hours() -> list:
    hours = []
    for part in (settings.PAYMENT_REMINDER_HOURS_IST or "").split(","):
        part = part.strip()
        if part.isdigit() and 0 <= int(part) <= 23:
            hours.append(int(part))
    return sorted(set(hours))


def latest_reminder_slot(now: datetime) -> Optional[datetime]:
    """The most recent reminder time (UTC) at or before `now`, or None when reminders are switched off."""
    hours = reminder_hours()
    if not hours:
        return None
    local = now.astimezone(IST)
    candidates = []
    for days_back in (0, 1):
        day = (local - timedelta(days=days_back)).date()
        for h in hours:
            slot = datetime(day.year, day.month, day.day, h, tzinfo=IST)
            if slot <= local:
                candidates.append(slot)
    return max(candidates).astimezone(timezone.utc) if candidates else None


def _left(delta: timedelta) -> str:
    hours = int(delta.total_seconds() // 3600)
    minutes = int(delta.total_seconds() % 3600 // 60)
    if hours >= 1:
        return f"{hours} hour{'s' if hours != 1 else ''}" + (f" {minutes} min" if hours < 6 and minutes else "")
    return f"{max(minutes, 1)} minutes"


async def send_payment_reminders(session_factory, now: Optional[datetime] = None, limit: int = 200) -> int:
    """
    Run by the background loop: at each reminder time (default 9 am, 2 pm, 7 pm IST) every winner who still has
    to pay gets one reminder, until the order is paid, a UTR is submitted, or the deadline passes. Orders created
    less than an hour before the slot are skipped (they just got the "you won" message). Each order is locked, so
    two backend processes never send the same reminder twice.
    """
    if not settings.ONLINE_PAYMENT_FLOW:
        return 0
    now = now or now_utc()
    slot = latest_reminder_slot(now)
    if slot is None or now - slot > REMINDER_WINDOW:
        return 0
    async with session_factory() as db:
        ids = (await db.execute(
            select(Order.id).where(
                Order.status == "awaiting_payment", Order.due_at > now, Order.created_at <= slot - timedelta(hours=1),
                or_(Order.last_reminder_at.is_(None), Order.last_reminder_at < slot),
            ).limit(limit)
        )).scalars().all()
    sent = 0
    for order_id in ids:
        async with session_factory() as db:
            order = (await db.execute(
                select(Order).options(selectinload(Order.vehicle)).where(Order.id == order_id)
                .with_for_update(of=Order, skip_locked=True).execution_options(populate_existing=True)
            )).scalar_one_or_none()
            if (order is None or order.status != "awaiting_payment" or order.due_at <= now
                    or (order.last_reminder_at is not None and order.last_reminder_at >= slot)):
                await db.rollback()
                continue
            v = order.vehicle
            due_local = order.due_at.astimezone(IST)
            due_text = f"{due_local.day} {due_local.strftime('%b')}, {due_local.strftime('%I:%M').lstrip('0')} {due_local.strftime('%p').lower()}"
            await notify(db, order.buyer_id, "payment_reminder", f"Payment reminder: {_left(order.due_at - now)} left",
                         f"{v.manufacturing_year} {v.make} {v.model} {v.variant}: please pay {order.amount} for order "
                         f"{order.number} by {due_text}. After that the win is cancelled and bidding is blocked.",
                         "/dashboard?tab=won")
            order.reminder_count += 1
            order.last_reminder_at = now
            await db.commit()
            sent += 1
    return sent


async def lift_bidding_block(db: AsyncSession, actor: User, user_id: uuid.UUID, reason: str) -> User:
    target = (await db.execute(
        select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if target is None:
        raise ApiError(404, "User not found.", "user_not_found")
    await _recheck_admin(db, actor)
    if target.bidding_blocked_until is None:
        raise ApiError(409, "This user's bidding is not blocked.", "not_blocked")
    previous = target.bidding_blocked_until
    target.bidding_blocked_until = None
    await record_audit(db, actor=actor, action="user.unblock_bidding", target_type="user", target_id=target.id,
                       details={"reason": reason, "was_blocked_until": previous.isoformat()})
    return target


def bank_details() -> Optional[dict]:
    if not (settings.COMPANY_BANK_ACCOUNT_NUMBER and settings.COMPANY_BANK_IFSC):
        return None
    return {"account_name": settings.COMPANY_BANK_ACCOUNT_NAME, "account_number": settings.COMPANY_BANK_ACCOUNT_NUMBER,
            "ifsc": settings.COMPANY_BANK_IFSC, "bank_name": settings.COMPANY_BANK_NAME, "branch": settings.COMPANY_BANK_BRANCH}
