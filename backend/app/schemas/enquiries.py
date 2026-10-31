"""Ready to Lift enquiries ("I'm interested")."""
import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class MyEnquiryOut(BaseModel):
    id: uuid.UUID
    number: str
    vehicle_id: uuid.UUID
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminEnquiryOut(MyEnquiryOut):
    admin_note: Optional[str]
    updated_at: datetime
    vehicle_title: str
    registration_number: str
    claim_number: str
    location: str
    vehicle_sold: bool
    cover_photo_id: Optional[uuid.UUID] = None
    buyer_id: str
    buyer_user_id: uuid.UUID
    buyer_name: str
    buyer_email: str
    buyer_mobile: str
    buyer_kyc_status: str


class EnquiryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Optional[Literal["new", "contacted", "closed"]] = None
    admin_note: Optional[str] = Field(None, max_length=1000)

    @field_validator("admin_note")
    @classmethod
    def _note(cls, v):
        if v is None:
            return None
        clean = " ".join(v.split())
        if "<" in clean or ">" in clean:
            raise ValueError("Note contains invalid characters.")
        return clean

    @model_validator(mode="after")
    def _something(self):
        if not self.model_fields_set:
            raise ValueError("Send a status or a note.")
        return self
