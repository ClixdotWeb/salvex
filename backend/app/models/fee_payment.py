"""
Service fee received from a buyer for a won auction (the "deal" kept on the order).

The client is a middleman: the vehicle price and the service fee are paid outside the website (cash, UPI, bank).
The admin records each amount received here; the monthly report adds them up. Rows are append-only (a database
trigger refuses UPDATE / DELETE / TRUNCATE); a mistake is fixed with a correcting (negative) entry and a note.
"""
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class FeePayment(Base):
    __tablename__ = "fee_payments"
    __table_args__ = (CheckConstraint("amount <> 0", name="ck_fee_payments_amount_not_zero"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)        # negative = correction
    received_on: Mapped[date] = mapped_column(Date, nullable=False)
    reference: Mapped[str] = mapped_column(String(60), nullable=False)             # UTR / receipt no. / "Cash"
    note: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
