"""
Buyer-side order routes: my orders, one order (owner or admin), and submitting a bank transfer UTR.
"""
import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import AuthContext, get_auth_context, require_csrf
from app.core.errors import ApiError
from app.core.rate_limit import enforce_rate_limit
from app.db.session import get_db
from app.models.order import Order
from app.schemas.orders import BankTransferRequest, OrderOut
from app.services import orders as order_service
from decimal import Decimal

from app.core.config import settings
from app.models.fee_payment import FeePayment

router = APIRouter(prefix="/api/orders", tags=["Orders"])


async def load_order(db: AsyncSession, order_id: uuid.UUID):
    return (await db.execute(
        select(Order).where(Order.id == order_id).options(selectinload(Order.vehicle), selectinload(Order.buyer))
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()


async def _fees(db: AsyncSession, order_ids) -> dict:
    if not order_ids:
        return {}
    rows = (await db.execute(select(FeePayment.order_id, func.sum(FeePayment.amount))
                             .where(FeePayment.order_id.in_(order_ids)).group_by(FeePayment.order_id))).all()
    return {oid: Decimal(total).quantize(Decimal("0.01")) for oid, total in rows}


def _deal_extra(order, fees: dict) -> dict:
    received = fees.get(order.id, Decimal("0.00"))
    return {"online_payment": settings.ONLINE_PAYMENT_FLOW, "approved_amount": order.approved_amount or order.amount,
            "service_fee": order.service_fee, "fee_received": received,
            "fee_pending": None if order.service_fee is None else order.service_fee - received}


@router.get("/mine", response_model=list[OrderOut], summary="Your orders (auctions you won), newest first")
async def my_orders(request: Request, ctx: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    enforce_rate_limit("session", request)
    rows = (await db.execute(
        select(Order).where(Order.buyer_id == ctx.user.id).options(selectinload(Order.vehicle))
        .order_by(Order.created_at.desc()).limit(100)
    )).scalars().all()
    now, bank = order_service.now_utc(), order_service.bank_details()
    fees = await _fees(db, [o.id for o in rows])
    return [OrderOut.build(o, bank, now, **_deal_extra(o, fees)) for o in rows]


@router.get("/{order_id}", response_model=OrderOut, summary="One order (its buyer or an admin)")
async def get_order(order_id: uuid.UUID, request: Request, ctx: AuthContext = Depends(get_auth_context),
                    db: AsyncSession = Depends(get_db)):
    enforce_rate_limit("session", request)
    order = await load_order(db, order_id)
    if order is None or (order.buyer_id != ctx.user.id and ctx.user.role != "admin"):
        raise ApiError(404, "Order not found.", "order_not_found")
    fees = await _fees(db, [order.id])
    return OrderOut.build(order, order_service.bank_details(), order_service.now_utc(), **_deal_extra(order, fees))


@router.post("/{order_id}/bank-transfer", response_model=OrderOut,
             summary="Tell us you paid by bank transfer (UTR). An admin confirms after checking the bank statement.")
async def submit_bank_transfer(order_id: uuid.UUID, body: BankTransferRequest, request: Request,
                               ctx: AuthContext = Depends(require_csrf), db: AsyncSession = Depends(get_db)):
    enforce_rate_limit("session", request)
    await order_service.submit_bank_transfer(db, ctx.user, order_id, body.utr)
    await db.commit()
    return OrderOut.build(await load_order(db, order_id), order_service.bank_details(), order_service.now_utc())
