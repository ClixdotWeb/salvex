"""
In-app notifications (the bell) with an email outbox. A notification is written in the SAME transaction as
the event it reports, so it can never be lost or sent for something that was rolled back. The background
loop sends pending emails afterwards (email_status: pending -> sent / failed after retries; skipped when
no email is wanted).
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, SmallInteger, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint("email_status IN ('pending', 'sent', 'failed', 'skipped')", name="ck_notifications_email_status"),
        Index("ix_notifications_user_created", "user_id", "created_at"),
        Index("ix_notifications_email_pending", "email_status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(String(1000), nullable=False)
    link: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)      # path on the website, e.g. /auctions/<id>
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    email_status: Mapped[str] = mapped_column(String(10), default="pending", nullable=False)
    email_attempts: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    emailed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
