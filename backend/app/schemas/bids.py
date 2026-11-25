"""Bid request/response shapes. Amounts are Decimal (text in JSON). The public never sees who bid."""
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, StrictBool, field_validator

from app.schemas.auctions import Money


class BidRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: Money
    # "A bid cannot be withdrawn; if I win I must buy." The website asks before every bid.
    terms_accepted: StrictBool          # only a real JSON true counts (not "yes" or 1)

    @field_validator("terms_accepted")
    @classmethod
    def _must_accept(cls, v: bool) -> bool:
        if v is not True:
            raise ValueError("You must accept the bidding terms to place a bid.")
        return v


class BidResult(BaseModel):
    bid_id: uuid.UUID
    amount: Decimal
    placed_at: datetime
    auction_id: uuid.UUID
    phase: str
    current_price: Decimal
    bid_count: int
    ends_at: datetime
    time_extended: bool
    you_are_highest: bool
    repeated: bool                 # true when the same request (same Idempotency-Key) was sent again
    server_time: datetime


class PublicBid(BaseModel):
    amount: Decimal
    placed_at: datetime
    bidder: str                    # "Bidder 1", "Bidder 2", ... per auction
    is_you: bool


class MyBidRow(BaseModel):
    auction_id: uuid.UUID
    vehicle_id: uuid.UUID
    title: str
    registration_number: str
    my_highest_bid: Decimal
    current_price: Decimal
    phase: str
    result: Optional[str]
    ends_at: datetime
    you_are_highest: bool
    you_won: bool
    server_time: datetime
    photo_id: Optional[uuid.UUID] = None      # cover photo (public URL: /api/catalogue/vehicles/{vehicle_id}/photos/{photo_id})


class AdminBid(BaseModel):
    id: uuid.UUID
    bidder_id: uuid.UUID
    bidder_name: str
    bidder_email: str
    amount: Decimal
    created_at: datetime
