"""
Monthly report for the client: vehicles uploaded, buyers registered, and the deals (approved amount, buyer,
service fee received / pending). Months follow India time. Also the CSV export (opens in Excel) and the
"report ready" notice sent to admins on the 1st of each month.
"""
import csv
import io
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.models.fee_payment import FeePayment
from app.models.notification import Notification
from app.models.order import Order
from app.models.user import User, format_buyer_id
from app.models.vehicle import OPTIONS, Vehicle
from app.services.notifications import notify_admins

IST = timezone(timedelta(hours=5, minutes=30))
ZERO = Decimal("0.00")
MAX_ROWS = 10000
_MONTH = re.compile(r"^(\d{4})-(\d{2})$")


def parse_month(value: Optional[str]) -> tuple[int, int]:
    """'2026-10' -> (2026, 10); empty -> last month (India time)."""
    if not value:
        first = datetime.now(IST).date().replace(day=1)
        prev = first - timedelta(days=1)
        return prev.year, prev.month
    m = _MONTH.match(value)
    if not m or not 1 <= int(m.group(2)) <= 12 or not 2000 <= int(m.group(1)) <= 2100:
        raise ApiError(422, "Choose a month like 2026-10.", "invalid_month")
    return int(m.group(1)), int(m.group(2))


def month_range(year: int, month: int) -> tuple[datetime, datetime]:
    start = datetime(year, month, 1, tzinfo=IST)
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=IST)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def month_label(year: int, month: int) -> str:
    return date(year, month, 1).strftime("%B %Y")


async def monthly_report(db: AsyncSession, year: int, month: int) -> dict:
    start, end = month_range(year, month)

    vehicles = (await db.execute(
        select(Vehicle).where(Vehicle.created_at >= start, Vehicle.created_at < end)
        .order_by(Vehicle.created_at, Vehicle.id).limit(MAX_ROWS)
    )).scalars().all()
    buyers = (await db.execute(
        select(User).where(User.role == "bidder", User.created_at >= start, User.created_at < end)
        .order_by(User.created_at, User.id).limit(MAX_ROWS)
    )).scalars().all()

    fees = (select(FeePayment.order_id.label("order_id"), func.sum(FeePayment.amount).label("received"),
                   func.max(FeePayment.received_on).filter(FeePayment.amount > 0).label("last_on"),
                   func.string_agg(FeePayment.reference, text("', ' ORDER BY fee_payments.created_at")).label("refs"))
            .group_by(FeePayment.order_id).subquery())
    approved = func.coalesce(Order.approved_at, Order.created_at)
    deals = (await db.execute(
        select(Order, Vehicle, User, fees.c.received, fees.c.last_on, fees.c.refs)
        .join(Vehicle, Vehicle.id == Order.vehicle_id).join(User, User.id == Order.buyer_id)
        .outerjoin(fees, fees.c.order_id == Order.id)
        .where(approved >= start, approved < end, Order.status != "cancelled")
        .order_by(approved, Order.id).limit(MAX_ROWS)
    )).all()

    payments = []
    for order, v, buyer, received, last_on, refs in deals:
        received = Decimal(received or 0).quantize(Decimal("0.01"))
        payments.append({
            "order_id": order.id, "order_number": order.number, "auction_id": order.auction_id,
            "claim_number": v.claim_number, "vehicle": f"{v.manufacturing_year} {v.make} {v.model} {v.variant}",
            "registration_number": v.registration_number, "approved_amount": order.approved_amount or order.amount,
            "approved_at": order.approved_at or order.created_at, "buyer_name": buyer.name,
            "buyer_id": format_buyer_id(buyer.buyer_number), "buyer_mobile": buyer.mobile,
            "service_fee": order.service_fee, "fee_received": received,
            "fee_pending": None if order.service_fee is None else order.service_fee - received,
            "fee_received_on": last_on, "references": refs or "",
        })
    categories = OPTIONS["category"]
    return {
        "month": f"{year:04d}-{month:02d}", "label": month_label(year, month),
        "totals": {
            "vehicles_uploaded": len(vehicles), "buyers_registered": len(buyers), "deals": len(payments),
            "approved_amount": sum((p["approved_amount"] for p in payments), ZERO),
            "service_fee": sum((p["service_fee"] or ZERO for p in payments), ZERO),
            "fee_received": sum((p["fee_received"] for p in payments), ZERO),
            "fee_pending": sum((p["fee_pending"] or ZERO for p in payments), ZERO),
        },
        "payments": payments,
        "vehicles": [{"vehicle_id": v.id, "added_at": v.created_at, "claim_number": v.claim_number,
                      "registration_number": v.registration_number,
                      "vehicle": f"{v.manufacturing_year} {v.make} {v.model} {v.variant}",
                      "category": categories.get(v.category, v.category), "location": v.location, "status": v.status}
                     for v in vehicles],
        "buyers": [{"user_id": u.id, "buyer_id": format_buyer_id(u.buyer_number), "name": u.name, "email": u.email,
                    "mobile": u.mobile, "kyc_status": u.kyc_status, "is_active": u.is_active, "registered_at": u.created_at}
                   for u in buyers],
    }


# ---------------------------------------------------------------------------- CSV (Excel)
def _cell(value) -> str:
    """Text for one cell. Cells that Excel would run as a formula are prefixed with an apostrophe."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.astimezone(IST).strftime("%d-%m-%Y %H:%M")
    if isinstance(value, date):
        return value.strftime("%d-%m-%Y")
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    text_value = str(value)
    if text_value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text_value
    return text_value


SECTIONS = {
    "payments": [
        ("Claim number", "claim_number"), ("Vehicle", "vehicle"), ("Registration", "registration_number"),
        ("Approved amount", "approved_amount"), ("Approved date", "approved_at"), ("Buyer name", "buyer_name"),
        ("Buyer ID", "buyer_id"), ("Buyer mobile", "buyer_mobile"), ("Service fee", "service_fee"),
        ("Fee received", "fee_received"), ("Pending fee", "fee_pending"), ("Fee received date", "fee_received_on"),
        ("Reference number", "references"), ("Order", "order_number"),
    ],
    "vehicles": [
        ("Added on", "added_at"), ("Claim number", "claim_number"), ("Registration", "registration_number"),
        ("Vehicle", "vehicle"), ("Category", "category"), ("Location", "location"), ("Status", "status"),
    ],
    "buyers": [
        ("Buyer ID", "buyer_id"), ("Name", "name"), ("Email", "email"), ("Mobile", "mobile"), ("KYC", "kyc_status"),
        ("Active", "is_active"), ("Registered on", "registered_at"),
    ],
}


def to_csv(report: dict, section: str) -> bytes:
    if section not in SECTIONS:
        raise ApiError(422, "Choose payments, vehicles or buyers.", "invalid_section")
    columns = SECTIONS[section]
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([f"Salvex report: {section.title()}, {report['label']}"])
    writer.writerow([heading for heading, _ in columns])
    for row in report[section]:
        writer.writerow([_cell(row.get(key)) for _, key in columns])
    if section == "payments":
        t = report["totals"]
        writer.writerow([])
        writer.writerow(["Totals", "", "", _cell(t["approved_amount"]), "", "", "", "", _cell(t["service_fee"]),
                         _cell(t["fee_received"]), _cell(t["fee_pending"])])
    return ("﻿" + out.getvalue()).encode("utf-8")       # BOM: Excel opens it as UTF-8 (₹, Malayalam names)


# ---------------------------------------------------------------------------- "report ready" on the 1st
async def send_monthly_report_notice(session_factory, now: Optional[datetime] = None) -> bool:
    """On the 1st of a month from 9 am (India time), tell admins once that last month's report is ready."""
    local = (now or datetime.now(timezone.utc)).astimezone(IST)
    if local.day != 1 or local.hour < 9:
        return False
    prev = local.date() - timedelta(days=1)
    key = f"{prev.year:04d}-{prev.month:02d}"
    link = f"/admin?tab=reports&month={key}"
    async with session_factory() as db:
        # one process at a time (several backend processes may run this loop)
        if not (await db.execute(text("SELECT pg_try_advisory_xact_lock(7731001)"))).scalar():
            await db.rollback()
            return False
        exists = (await db.execute(select(Notification.id).where(
            Notification.kind == "monthly_report", Notification.link == link).limit(1))).first()
        if exists:
            await db.rollback()
            return False
        await notify_admins(db, "monthly_report", f"{month_label(prev.year, prev.month)} report is ready",
                            "Vehicles uploaded, buyers registered and service fees for the month. Open it to view or "
                            "download Excel.", link, email=True)
        await db.commit()
        return True
