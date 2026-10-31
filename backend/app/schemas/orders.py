"""Order shapes. Amounts are Decimal (text in JSON); the buyer never sets an amount."""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class BankDetails(BaseModel):
    account_name: str
    account_number: str
    ifsc: str
    bank_name: str
    branch: str


class OrderOut(BaseModel):
    """What the buyer (and an admin) sees."""
    id: uuid.UUID
    number: str
    status: str
    amount: Decimal
    due_at: datetime
    auction_id: uuid.UUID
    vehicle_id: uuid.UUID
    vehicle_title: str
    registration_number: str
    payment_method: Optional[str]
    utr: Optional[str]
    payment_submitted_at: Optional[datetime]
    paid_at: Optional[datetime]
    status_reason: Optional[str]
    created_at: datetime
    bank: Optional[BankDetails]            # None until the company's bank details are configured
    server_time: datetime
    online_payment: bool = True            # False: no pay-on-website; our team contacts the winner
    approved_amount: Optional[Decimal] = None
    service_fee: Optional[Decimal] = None
    fee_received: Optional[Decimal] = None
    fee_pending: Optional[Decimal] = None

    @classmethod
    def build(cls, order, bank, now: datetime, **extra):
        v = order.vehicle
        return cls(
            id=order.id, number=order.number, status=order.status, amount=order.amount, due_at=order.due_at,
            auction_id=order.auction_id, vehicle_id=order.vehicle_id,
            vehicle_title=f"{v.manufacturing_year} {v.make} {v.model} {v.variant}", registration_number=v.registration_number,
            payment_method=order.payment_method, utr=order.utr, payment_submitted_at=order.payment_submitted_at,
            paid_at=order.paid_at, status_reason=order.status_reason, created_at=order.created_at,
            bank=BankDetails(**bank) if bank else None, server_time=now, **extra,
        )


class AdminOrderOut(OrderOut):
    buyer_id: uuid.UUID
    buyer_name: str
    buyer_email: str
    buyer_mobile: str
    confirmed_by_id: Optional[uuid.UUID]


class BankTransferRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    utr: str = Field(..., min_length=6, max_length=40, description="UTR / transaction reference from your bank")


class OrderReasonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(..., min_length=3, max_length=500)
