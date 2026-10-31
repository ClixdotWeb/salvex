"""Deal & service fee (recorded by the admin) and the monthly report. Amounts are Decimal (text in JSON)."""
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, List, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

Amount = Annotated[Decimal, Field(max_digits=12, decimal_places=2, allow_inf_nan=False),
                   AfterValidator(lambda v: v.quantize(Decimal("0.01")))]


def _line(value: Optional[str], label: str, required: bool) -> Optional[str]:
    clean = " ".join((value or "").split())
    if required and not clean:
        raise ValueError(f"{label} is required.")
    if "<" in clean or ">" in clean:
        raise ValueError(f"{label} contains invalid characters.")
    return clean or None


class DealUpdate(BaseModel):
    """Change any of: approved amount, approved date, service fee (at least one)."""
    model_config = ConfigDict(extra="forbid")

    approved_amount: Optional[Amount] = None
    approved_on: Optional[date] = None
    service_fee: Optional[Amount] = None

    @model_validator(mode="after")
    def _check(self):
        if not self.model_fields_set:
            raise ValueError("Send the approved amount, the approved date or the service fee.")
        if "approved_amount" in self.model_fields_set and (self.approved_amount is None or self.approved_amount <= 0):
            raise ValueError("The approved amount must be above 0.")
        if "service_fee" in self.model_fields_set and (self.service_fee is None or self.service_fee < 0):
            raise ValueError("The service fee cannot be negative.")
        if "approved_on" in self.model_fields_set and self.approved_on is None:
            raise ValueError("Choose the approved date.")
        return self


class FeePaymentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: Amount
    received_on: date
    reference: str = Field(..., max_length=60)
    note: Optional[str] = Field(None, max_length=300)

    @field_validator("reference")
    @classmethod
    def _reference(cls, v):
        return _line(v, "Reference number", required=True)

    @field_validator("note")
    @classmethod
    def _note(cls, v):
        return None if v is None else _line(v, "Note", required=False)

    @model_validator(mode="after")
    def _amount(self):
        if self.amount == 0:
            raise ValueError("Enter an amount (use a minus amount only to correct a mistake).")
        if self.amount < 0 and not self.note:
            raise ValueError("A correction (minus amount) needs a note explaining it.")
        return self


class FeePaymentOut(BaseModel):
    id: uuid.UUID
    amount: Decimal
    received_on: date
    reference: str
    note: Optional[str]
    created_at: datetime
    created_by_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class DealOut(BaseModel):
    order_id: uuid.UUID
    order_number: str
    status: str = "awaiting_payment"               # awaiting_payment = open; paid = completed; cancelled
    status_reason: Optional[str] = None
    closed_at: Optional[datetime] = None
    approved_amount: Optional[Decimal]
    approved_at: Optional[datetime]
    service_fee: Optional[Decimal]
    fee_received: Decimal
    fee_pending: Optional[Decimal]                 # None until the service fee is set
    last_fee_received_on: Optional[date]
    payments: List[FeePaymentOut]


# ---------------------------------------------------------------------------- monthly report
class ReportPaymentRow(BaseModel):
    order_id: uuid.UUID
    order_number: str
    auction_id: uuid.UUID
    claim_number: str
    vehicle: str
    registration_number: str
    approved_amount: Optional[Decimal]
    approved_at: Optional[datetime]
    buyer_name: str
    buyer_id: str
    buyer_mobile: str
    service_fee: Optional[Decimal]
    fee_received: Decimal
    fee_pending: Optional[Decimal]
    fee_received_on: Optional[date]
    references: str


class ReportVehicleRow(BaseModel):
    vehicle_id: uuid.UUID
    added_at: datetime
    claim_number: str
    registration_number: str
    vehicle: str
    category: str
    location: str
    status: str


class ReportBuyerRow(BaseModel):
    user_id: uuid.UUID
    buyer_id: str
    name: str
    email: str
    mobile: str
    kyc_status: str
    is_active: bool
    registered_at: datetime


class ReportTotals(BaseModel):
    vehicles_uploaded: int
    buyers_registered: int
    deals: int
    approved_amount: Decimal
    service_fee: Decimal
    fee_received: Decimal
    fee_pending: Decimal


class MonthlyReport(BaseModel):
    month: str                                   # "2026-10"
    label: str                                   # "October 2026"
    totals: ReportTotals
    payments: List[ReportPaymentRow]
    vehicles: List[ReportVehicleRow]
    buyers: List[ReportBuyerRow]
