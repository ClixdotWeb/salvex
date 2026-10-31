"""
Messages sent from the public Contact page. Anyone can send one (rate limited); admins are notified,
see them in the admin panel, reply by email or phone, and move them  new -> in_progress -> closed.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import CheckConstraint, DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

CONTACT_STATUSES = ("new", "in_progress", "closed")
CONTACT_SUBJECTS = (
    "General enquiry",
    "Registration & KYC",
    "Bidding & auctions",
    "Payments",
    "Selling a vehicle",
    "Spare parts",
    "Vehicle handover",
    "Other",
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ContactMessage(Base):
    __tablename__ = "contact_messages"
    __table_args__ = (
        CheckConstraint("status IN ('new', 'in_progress', 'closed')", name="ck_contact_messages_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    number: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)          # MSG-2026-000001
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    mobile: Mapped[str] = mapped_column(String(20), nullable=False)
    subject: Mapped[str] = mapped_column(String(40), nullable=False)
    message: Mapped[str] = mapped_column(String(3000), nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="new", index=True, nullable=False)
    admin_note: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)
