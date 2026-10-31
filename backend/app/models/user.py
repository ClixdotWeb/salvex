import uuid
from datetime import datetime, timezone
import re
from typing import Optional
from sqlalchemy import Index, Integer, Sequence, String, DateTime, ForeignKey, Table, Column, Enum as SQLEnum, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base

# Association table for User Watchlist (Many-to-Many between User and VehicleLot)
user_watchlist = Table(
    "user_watchlist",
    Base.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("lot_id", UUID(as_uuid=True), ForeignKey("vehicle_lots.id", ondelete="CASCADE"), primary_key=True),
    Column("created_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
)


def format_buyer_id(number) -> str:
    return f"SLX-{int(number):06d}" if number else ""


def parse_buyer_id(text_value: str):
    """'SLX-000123', 'slx123', '000123' or '123' -> 123; anything else -> None."""
    m = re.fullmatch(r"\s*(?:slx[-\s]?)?0*(\d{1,9})\s*", text_value or "", flags=re.IGNORECASE)
    return int(m.group(1)) if m and int(m.group(1)) > 0 else None


class User(Base):
    """
    User entity representing institutional bidders, consignor sellers, and platform administrators.
    Preserves legacy Mongoose enum values and role semantics.
    """
    __tablename__ = "users"
    __table_args__ = (Index("uq_users_buyer_number", "buyer_number", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    # Readable Buyer ID: 1 -> "SLX-000001" (see buyer_id). Taken from a sequence when the row is inserted.
    buyer_number: Mapped[int] = mapped_column(
        Integer, Sequence("buyer_number_seq"), server_default=text("nextval('buyer_number_seq')"), nullable=False
    )

    @property
    def buyer_id(self) -> str:
        return format_buyer_id(self.buyer_number)

    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    
    role: Mapped[str] = mapped_column(
        SQLEnum("bidder", "seller", "admin", name="user_role_enum", native_enum=False),
        default="bidder",
        server_default="bidder",
        insert_default="bidder",
        nullable=False,
        index=True
    )
    mobile: Mapped[str] = mapped_column(String(50), default="", server_default="", insert_default="", nullable=False)
    organization: Mapped[str] = mapped_column(String(255), default="", server_default="", insert_default="", nullable=False)
    
    kyc_status: Mapped[str] = mapped_column(
        SQLEnum("pending", "verified", "rejected", name="kyc_status_enum", native_enum=False),
        default="pending",
        server_default="pending",
        insert_default="pending",
        nullable=False,
        index=True
    )
    is_email_verified: Mapped[bool] = mapped_column(
        default=False,
        server_default="false",
        insert_default=False,
        nullable=False
    )
    # Set when the user enters the code sent by SMS to `mobile`. Changing the number clears it.
    is_mobile_verified: Mapped[bool] = mapped_column(
        default=False,
        server_default="false",
        insert_default=False,
        nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        default=True,
        server_default="true",
        insert_default=True,
        nullable=False
    )

    # Suspension record. A suspended account has is_active = false (which is what blocks access); these
    # columns say why, who did it and when. All three are NULL for an account that was never suspended.
    suspended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    suspension_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    suspended_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL", name="fk_users_suspended_by_id_users"),
        nullable=True
    )

    # Payment discipline (no advance deposit is taken, so non-payment has consequences):
    # every unpaid win (default) is counted; bidding is blocked until `bidding_blocked_until`
    # (a far-future date = permanently). Login still works so the user can see why.
    payment_defaults: Mapped[int] = mapped_column(default=0, server_default="0", insert_default=0, nullable=False)
    bidding_blocked_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    # Relationships
    consignments: Mapped[list["VehicleLot"]] = relationship(
        "VehicleLot",
        back_populates="seller",
        foreign_keys="VehicleLot.seller_id"
    )
    bids: Mapped[list["Bid"]] = relationship(
        "Bid",
        back_populates="bidder",
        cascade="all, delete-orphan"
    )
    watchlist: Mapped[list["VehicleLot"]] = relationship(
        "VehicleLot",
        secondary=user_watchlist,
        back_populates="watchers"
    )
    auth_tokens: Mapped[list["AuthToken"]] = relationship(
        "AuthToken",
        back_populates="user",
        cascade="all, delete-orphan"
    )
    sessions: Mapped[list["AuthSession"]] = relationship(
        "AuthSession",
        back_populates="user",
        cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User {self.email} ({self.role})>"


class AuthToken(Base):
    """
    Stores cryptographically hashed verification codes and password reset secrets.
    Never stores plaintext OTPs. Enforces expiry, single-use, and attempt limiting.
    """
    __tablename__ = "auth_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    purpose: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    attempts: Mapped[int] = mapped_column(default=0, server_default="0", insert_default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(default=5, server_default="5", insert_default=5, nullable=False)
    is_used: Mapped[bool] = mapped_column(default=False, server_default="false", insert_default=False, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    user: Mapped["User"] = relationship("User", back_populates="auth_tokens")

    def __repr__(self) -> str:
        return f"<AuthToken {self.purpose} for user={self.user_id} (used={self.is_used})>"


class AuthSession(Base):
    """
    One signed-in browser/device. The login token carries this row's id ("sid"); a token is only
    accepted while its session exists, is not revoked, has not expired and has not been idle too
    long. Logging out, resetting a password or deactivating an account revokes sessions here, so
    stolen tokens stop working immediately instead of living until they expire.
    """
    __tablename__ = "auth_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    revoke_reason: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="sessions")

    def __repr__(self) -> str:
        return f"<AuthSession {self.id} user={self.user_id} revoked={self.revoked_at is not None}>"
