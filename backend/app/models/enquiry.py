"""
"I'm interested" on a Ready to Lift vehicle. Ready to Lift vehicles are not auctioned and show no price: a signed-in
buyer says they are interested, admins are notified, and the team contacts the buyer.

    new -> contacted -> closed        (one enquiry per buyer per vehicle)
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

ENQUIRY_STATUSES = ("new", "contacted", "closed")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class VehicleEnquiry(Base):
    __tablename__ = "vehicle_enquiries"
    __table_args__ = (
        CheckConstraint("status IN ('new', 'contacted', 'closed')", name="ck_vehicle_enquiries_status"),
        UniqueConstraint("vehicle_id", "user_id", name="uq_vehicle_enquiries_vehicle_user"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    number: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)          # ENQ-2026-000001
    vehicle_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    status: Mapped[str] = mapped_column(String(12), default="new", index=True, nullable=False)
    admin_note: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)
