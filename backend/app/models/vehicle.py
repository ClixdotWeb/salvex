"""
Vehicles (Module 4). A vehicle is separate from any auction: it is added (by a seller or an admin),
reviewed by an admin, and only an APPROVED vehicle is visible in the public catalogue. Auctions (Module 5)
will refer to approved vehicles.

    draft -> submitted -> approved | rejected | changes_requested -> submitted -> ...

The company's field list is used as given; every field is mandatory. The option lists for the choice
fields below are PROVISIONAL until the company sends its own (docs/MASTER_PLAN.md section 6); they are
validated by the application, not by database constraints, so changing them needs no migration.

The older `vehicle_lots` table (legacy, auction and vehicle mixed together, unused by any API) is left
untouched.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, SmallInteger, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

VEHICLE_STATUSES = ("draft", "submitted", "changes_requested", "approved", "rejected")
EDITABLE_STATUSES = ("draft", "changes_requested")
LISTING_TYPES = ("auction", "ready_to_lift")   # ready_to_lift: no auction, no price, buyers enquire
ACTIVE_STATUSES = ("draft", "submitted", "changes_requested", "approved")   # a registration number may appear once among these

# PROVISIONAL option lists (value -> label). Replace with the company's lists when received.
OPTIONS = {
    # Auction category (the client wants these listed separately in the menu).
    "category": {"insurance": "Insurance", "bank_nbfc": "Bank / NBFC", "used_vehicle": "Used vehicle"},
    "fuel_type": {
        "petrol": "Petrol", "diesel": "Diesel", "cng": "CNG", "lpg": "LPG", "electric": "Electric",
        "hybrid": "Hybrid", "petrol_cng": "Petrol + CNG",
    },
    "transmission": {"manual": "Manual", "automatic": "Automatic"},
    "damage_type": {
        "accident": "Accident", "flood": "Flood / water", "fire": "Fire", "theft_recovered": "Theft recovered",
        "mechanical": "Mechanical", "other": "Other",
    },
    "rc_status": {"available": "RC available", "duplicate": "Duplicate RC", "not_available": "RC not available"},
    "registration_type": {"private": "Private", "commercial": "Commercial"},
    "hypothecation_status": {
        "not_hypothecated": "Not hypothecated", "hypothecated": "Hypothecated", "noc_available": "Hypothecation closed (NOC available)",
    },
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _in(column: str, values) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (
        CheckConstraint(_in("status", VEHICLE_STATUSES), name="ck_vehicles_status"),
        CheckConstraint("registration_year >= manufacturing_year", name="ck_vehicles_registration_after_manufacture"),
        CheckConstraint("number_of_owners >= 0", name="ck_vehicles_owners_non_negative"),
        CheckConstraint("listing_type IN ('auction', 'ready_to_lift')", name="ck_vehicles_listing_type"),
        CheckConstraint("km_driven IS NULL OR km_driven >= 0", name="ck_vehicles_km_driven"),
        # Duplicates refused: one active vehicle per registration number (rejected ones may be re-added).
        Index("uq_vehicles_active_registration", "registration_number", unique=True,
              postgresql_where=text(_in("status", ACTIVE_STATUSES))),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Who added it (a seller, or an admin adding stock). Only this user (or an admin) may edit it.
    owner_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True, nullable=False)
    category: Mapped[str] = mapped_column(String(20), default="used_vehicle", server_default="used_vehicle",
                                          index=True, nullable=False)
    listing_type: Mapped[str] = mapped_column(String(20), default="auction", server_default="auction", index=True,
                                              nullable=False)
    km_driven: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    superdari: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)        # court custody (Yes / No)
    sold_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)   # Ready to Lift sold

    # The company's field list (all mandatory).
    registration_number: Mapped[str] = mapped_column(String(15), index=True, nullable=False)   # normalised: A-Z 0-9
    claim_number: Mapped[str] = mapped_column(String(50), nullable=False)
    make: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    model: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    variant: Mapped[str] = mapped_column(String(80), nullable=False)
    manufacturing_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    registration_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    fuel_type: Mapped[str] = mapped_column(String(20), nullable=False)
    transmission: Mapped[str] = mapped_column(String(20), nullable=False)
    number_of_owners: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    damage_type: Mapped[str] = mapped_column(String(30), nullable=False)
    damage_other: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)   # the description when damage_type is "other"
    location: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    rc_status: Mapped[str] = mapped_column(String(20), nullable=False)
    registration_type: Mapped[str] = mapped_column(String(20), nullable=False)
    hypothecation_status: Mapped[str] = mapped_column(String(20), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Latest review (the full history is in the audit log).
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    review_reason: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

    photos: Mapped[list["VehiclePhoto"]] = relationship(
        "VehiclePhoto", back_populates="vehicle", order_by="(VehiclePhoto.position, VehiclePhoto.uploaded_at)",
        lazy="raise"
    )

    def __repr__(self) -> str:
        return f"<Vehicle {self.registration_number} {self.status}>"


class VehiclePhoto(Base):
    """One photo. The file lives in storage (area "vehicles") under a random key; never in this row."""
    __tablename__ = "vehicle_photos"
    __table_args__ = (
        CheckConstraint("content_type IN ('image/jpeg', 'image/png')", name="ck_vehicle_photos_content_type"),
        CheckConstraint("size_bytes > 0", name="ck_vehicle_photos_size_positive"),
        UniqueConstraint("thumb_key", name="uq_vehicle_photos_thumb_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vehicles.id", ondelete="CASCADE"), index=True, nullable=False
    )
    storage_key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    content_type: Mapped[str] = mapped_column(String(50), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    # Order on the website: 0 = cover. The thumbnail (lists and cards) is optional; without it the photo is served.
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    thumb_key: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    thumb_sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    vehicle: Mapped["Vehicle"] = relationship("Vehicle", back_populates="photos", lazy="raise")
