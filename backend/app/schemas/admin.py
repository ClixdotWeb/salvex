import uuid
from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AuditLogOut(BaseModel):
    """One audit entry. `details` is sanitised when it is written (see app/core/audit.py)."""
    id: uuid.UUID
    created_at: datetime
    actor_id: Optional[uuid.UUID]
    actor_role: str
    action: str
    target_type: str
    target_id: Optional[str]
    details: Dict[str, Any]

    model_config = ConfigDict(from_attributes=True)


class AdminUserOut(BaseModel):
    """A user as an administrator sees them in lists. Never includes the password hash or any token."""
    id: uuid.UUID
    buyer_id: str = ""
    name: str
    email: str
    role: str
    mobile: str
    organization: str
    kyc_status: str
    is_email_verified: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminUserDetail(AdminUserOut):
    """The single-user view: the list fields plus the suspension record and the number of live sessions."""
    suspended_at: Optional[datetime]
    suspension_reason: Optional[str]
    suspended_by_id: Optional[uuid.UUID]
    active_session_count: int
    payment_defaults: int = 0
    bidding_blocked_until: Optional[datetime] = None


class _StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _clean_reason(value: str) -> str:
    clean = value.strip()
    if len(clean) < 3:
        raise ValueError("A reason of at least 3 characters is required.")
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in clean):
        raise ValueError("The reason contains invalid characters.")
    return clean


class SuspendUserRequest(_StrictBody):
    reason: str = Field(..., min_length=3, max_length=500, description="Why the account is suspended (stored in the audit log)")

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        return _clean_reason(v)


class ReactivateUserRequest(_StrictBody):
    reason: Optional[str] = Field(default=None, max_length=500, description="Optional note recorded in the audit log")

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: Optional[str]) -> Optional[str]:
        return _clean_reason(v) if v and v.strip() else None


class ChangeRoleRequest(_StrictBody):
    # "admin" is deliberately not accepted: administrators are provisioned only from the server shell.
    role: Literal["bidder", "seller"]
    reason: str = Field(..., min_length=3, max_length=500)

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        return _clean_reason(v)


class AdminDashboard(BaseModel):
    """Counts for the admin home screen (all read live from the database)."""
    users_total: int
    bidders: int
    sellers: int
    suspended_users: int
    kyc_waiting_review: int
    vehicles_waiting_review: int
    vehicles_approved: int
    auctions_live: int
    auctions_upcoming: int
    auctions_paused: int
    auctions_awaiting_close: int
    bids_today: int
    orders_awaiting_payment: int = 0
    payments_to_confirm: int = 0
    part_requests_new: int = 0
    contact_messages_new: int = 0
    deals_fee_pending: int = 0              # sold, not cancelled, service fee not set or not fully received
    online_payment: bool = True
    enquiries_new: int = 0                  # Ready to Lift "I'm interested" not yet handled
    ready_to_lift_available: int = 0
    server_time: datetime
