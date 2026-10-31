"""Spare parts and part requests (request / response shapes)."""
import re
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator, model_validator

_PHONE = re.compile(r"^\+?[0-9][0-9 \-]{6,18}[0-9]$")

Price = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2, allow_inf_nan=False),
                  AfterValidator(lambda v: v.quantize(Decimal("0.01")))]


def _text(value: Optional[str], label: str, required: bool = True) -> Optional[str]:
    clean = " ".join((value or "").split())
    if required and not clean:
        raise ValueError(f"{label} is required.")
    if "<" in clean or ">" in clean or any(ord(ch) < 32 or ord(ch) == 127 for ch in clean):
        raise ValueError(f"{label} contains invalid characters.")
    return clean


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PartOut(BaseModel):
    id: uuid.UUID
    name: str
    make: str
    model: Optional[str]
    year_from: Optional[int]
    year_to: Optional[int]
    condition: str
    price: Decimal
    stock: int
    description: str
    has_photo: bool
    is_active: bool

    @classmethod
    def build(cls, part) -> "PartOut":
        return cls(id=part.id, name=part.name, make=part.make, model=part.model, year_from=part.year_from,
                   year_to=part.year_to, condition=part.condition, price=part.price, stock=part.stock,
                   description=part.description, has_photo=part.photo_key is not None, is_active=part.is_active)


class PartWrite(_Strict):
    name: str = Field(..., max_length=120)
    make: str = Field(..., max_length=60)
    model: Optional[str] = Field(None, max_length=60)
    year_from: Optional[int] = Field(None, ge=1950, le=2100)
    year_to: Optional[int] = Field(None, ge=1950, le=2100)
    condition: Literal["new", "used"] = "used"
    price: Price
    stock: int = Field(1, ge=0, le=100000)
    description: str = Field("", max_length=1000)
    is_active: bool = True

    @field_validator("name", "make")
    @classmethod
    def _required(cls, v, info):
        return _text(v, info.field_name.capitalize())

    @field_validator("model", "description")
    @classmethod
    def _optional(cls, v, info):
        clean = _text(v, info.field_name.capitalize(), required=False)
        return clean if info.field_name == "description" else (clean or None)

    @model_validator(mode="after")
    def _years(self):
        if self.year_from and self.year_to and self.year_to < self.year_from:
            raise ValueError("'Year to' cannot be before 'year from'.")
        return self


class PartRequestCreate(_Strict):
    part_id: Optional[uuid.UUID] = None
    vehicle_make: str = Field(..., max_length=60)
    vehicle_model: str = Field(..., max_length=60)
    vehicle_year: Optional[int] = Field(None, ge=1950, le=2100)
    part_name: str = Field(..., max_length=120)
    details: str = Field("", max_length=1000)
    contact_phone: str = Field(..., max_length=20, description="Our team calls this number")

    @field_validator("contact_phone")
    @classmethod
    def _phone(cls, v):
        clean = (v or "").strip()
        if not _PHONE.match(clean):
            raise ValueError("Enter a valid mobile number so our team can call you.")
        return clean

    @field_validator("vehicle_make", "vehicle_model", "part_name")
    @classmethod
    def _required(cls, v, info):
        return _text(v, info.field_name.replace("_", " ").capitalize())

    @field_validator("details")
    @classmethod
    def _details(cls, v):
        return _text(v, "Details", required=False)


class PartRequestUpdate(_Strict):
    """Admin update: status and / or the internal note (at least one). Nothing is sent to the customer."""
    status: Optional[Literal["new", "contacted", "closed"]] = None
    admin_note: Optional[str] = Field(None, max_length=1000)

    @field_validator("admin_note")
    @classmethod
    def _note(cls, v):
        return None if v is None else _text(v, "Note", required=False)

    @model_validator(mode="after")
    def _something(self):
        if not self.model_fields_set:
            raise ValueError("Send a status or a note.")
        return self


class PartRequestOut(BaseModel):
    id: uuid.UUID
    number: str
    part_id: Optional[uuid.UUID]
    vehicle_make: str
    vehicle_model: str
    vehicle_year: Optional[int]
    part_name: str
    details: str
    status: str
    contact_phone: str = ""
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminPartRequestOut(PartRequestOut):
    admin_note: Optional[str] = None
    buyer_id: str = ""
    user_id: uuid.UUID
    user_name: str
    user_email: str
    user_mobile: str
