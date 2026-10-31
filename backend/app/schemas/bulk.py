"""Bulk vehicle upload (Excel / CSV) and publishing several vehicles (with auctions) at once."""
import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.auctions import Money


class BulkAuction(BaseModel):
    starting_price: str
    starts_at: datetime
    ends_at: datetime


class BulkRow(BaseModel):
    row: int = Field(description="Line number in the file (the heading is line 1)")
    registration_number: str
    title: str
    listing_type: Literal["auction", "ready_to_lift"]
    claim_number: str = ""
    category: str = ""
    auction: Optional[BulkAuction] = None
    errors: list[str]


class BulkCheckOut(BaseModel):
    rows: list[BulkRow]
    valid: int
    invalid: int
    with_auction: int


class BulkCreatedRow(BulkRow):
    vehicle_id: uuid.UUID


class BulkImportOut(BaseModel):
    created: list[BulkCreatedRow]
    skipped: list[BulkRow]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PublishAuction(_Strict):
    starting_price: Money
    starts_at: AwareDatetime
    ends_at: AwareDatetime

    @model_validator(mode="after")
    def _order(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("The end time must be after the start time.")
        return self


class PublishItem(_Strict):
    vehicle_id: uuid.UUID
    auction: Optional[PublishAuction] = None


class BulkPublishRequest(_Strict):
    items: list[PublishItem] = Field(min_length=1, max_length=200)
    extension_enabled: bool = True
    extension_minutes: Optional[int] = Field(None, ge=1, le=60)

    @field_validator("items")
    @classmethod
    def _unique(cls, items):
        ids = [i.vehicle_id for i in items]
        if len(ids) != len(set(ids)):
            raise ValueError("A vehicle is listed twice.")
        return items


class PublishResult(BaseModel):
    vehicle_id: uuid.UUID
    registration_number: Optional[str]
    status: Optional[str]
    published: bool = Field(description="Submitted and approved by this request")
    auction_id: Optional[uuid.UUID]
    error: Optional[str]
    code: Optional[str]


class BulkPublishOut(BaseModel):
    results: list[PublishResult]
    published: int
    auctions: int
    failed: int
