"""
Orders (winner pays). One order per sold auction, created in the same transaction that closes the auction.

    awaiting_payment -> payment_submitted (buyer entered the bank transfer UTR) -> paid (finance confirmed)
                     ^          | finance rejects the UTR (wrong / not received)
                     +----------+
    awaiting_payment | payment_submitted -> defaulted (deadline passed) | cancelled (admin, with reason)

Amounts are copied from the auction on the server; the buyer can never set them. Online gateway payment
plugs in later as another way to reach "paid" (the gateway's webhook).
"""
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Numeric, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

ORDER_STATUSES = ("awaiting_payment", "payment_submitted", "paid", "defaulted", "cancelled")
OPEN_ORDER_STATUSES = ("awaiting_payment", "payment_submitted")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint(
            "status IN ('awaiting_payment', 'payment_submitted', 'paid', 'defaulted', 'cancelled')", name="ck_orders_status"),
        CheckConstraint("amount > 0", name="ck_orders_amount_positive"),
        # A UTR can only pay one order (a re-used reference is refused).
        Index("uq_orders_utr", "utr", unique=True, postgresql_where=text("utr IS NOT NULL")),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    number: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)          # ORD-2026-000001
    auction_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("auctions.id", ondelete="RESTRICT"), unique=True, nullable=False
    )
    vehicle_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    buyer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="awaiting_payment", index=True, nullable=False)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)

    payment_method: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)      # bank_transfer (gateway later)
    utr: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    payment_submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    status_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)      # last rejection / cancel note
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)  # paid/defaulted/cancelled

    # The deal (the client is a middleman; money moves outside the website, the admin records it):
    approved_amount: Mapped[Optional[Decimal]] = mapped_column(Numeric(14, 2), nullable=True)   # starts as the winning bid
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    service_fee: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)       # the client's fee
    # Payment reminders (3 a day at the configured Indian times until paid or the deadline passes).
    reminder_count: Mapped[int] = mapped_column(default=0, server_default="0", nullable=False)
    last_reminder_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)

    vehicle: Mapped["Vehicle"] = relationship("Vehicle", lazy="raise")
    buyer: Mapped["User"] = relationship("User", foreign_keys=[buyer_id], lazy="raise")
