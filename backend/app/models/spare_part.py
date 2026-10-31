"""
Spare parts (fixed price) and part requests.

  * SparePart - a part the company lists for sale at a fixed price, for a make (and optionally a model and
    year range). Only active parts are public. One optional photo, kept in storage area "parts".
  * PartRequest - a user asks for a part for their vehicle (either a listed part or something not listed).
    Admins are notified and call the customer (no messages to the customer from the website):
        new -> contacted -> closed       (the admin keeps an internal note)
"""
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, Numeric, SmallInteger, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

PART_CONDITIONS = ("new", "used")
REQUEST_STATUSES = ("new", "contacted", "closed")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class SparePart(Base):
    __tablename__ = "spare_parts"
    __table_args__ = (
        CheckConstraint("price > 0", name="ck_spare_parts_price_positive"),
        CheckConstraint("stock >= 0", name="ck_spare_parts_stock_non_negative"),
        CheckConstraint("condition IN ('new', 'used')", name="ck_spare_parts_condition"),
        CheckConstraint("year_to IS NULL OR year_from IS NULL OR year_to >= year_from", name="ck_spare_parts_years"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    make: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    model: Mapped[Optional[str]] = mapped_column(String(60), index=True, nullable=True)     # None = fits any model
    year_from: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    year_to: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    condition: Mapped[str] = mapped_column(String(10), default="used", nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    stock: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    description: Mapped[str] = mapped_column(String(1000), default="", nullable=False)
    photo_key: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    photo_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)


class PartRequest(Base):
    __tablename__ = "part_requests"
    __table_args__ = (
        CheckConstraint("status IN ('new', 'contacted', 'closed')", name="ck_part_requests_status"),
        CheckConstraint("quoted_price IS NULL OR quoted_price > 0", name="ck_part_requests_price_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    number: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)          # PRQ-2026-000001
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False)
    part_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("spare_parts.id", ondelete="SET NULL"), nullable=True)
    vehicle_make: Mapped[str] = mapped_column(String(60), nullable=False)
    vehicle_model: Mapped[str] = mapped_column(String(60), nullable=False)
    vehicle_year: Mapped[Optional[int]] = mapped_column(SmallInteger, nullable=True)
    part_name: Mapped[str] = mapped_column(String(120), nullable=False)
    details: Mapped[str] = mapped_column(String(1000), default="", nullable=False)
    contact_phone: Mapped[str] = mapped_column(String(20), default="", server_default="", nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="new", index=True, nullable=False)
    admin_note: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)      # internal, never shown to the customer
    quoted_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)  # old requests only (unused)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)
