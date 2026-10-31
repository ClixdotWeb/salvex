"""Contact page messages (request / response shapes)."""
import re
import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.models.contact import CONTACT_SUBJECTS

_MOBILE = re.compile(r"^\+?[0-9][0-9 \-]{6,18}[0-9]$")


def _line(value: Optional[str], label: str, required: bool = True) -> Optional[str]:
    clean = " ".join((value or "").split())
    if required and not clean:
        raise ValueError(f"{label} is required.")
    if "<" in clean or ">" in clean:
        raise ValueError(f"{label} contains invalid characters.")
    return clean


class ContactCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., max_length=100)
    email: EmailStr
    mobile: str = Field(..., max_length=20)
    subject: Literal[CONTACT_SUBJECTS]
    message: str = Field(..., max_length=3000)
    website: str = Field("", max_length=200, description="Leave empty (spam trap).")

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        return _line(v, "Name")

    @field_validator("mobile")
    @classmethod
    def _mobile(cls, v):
        v = (v or "").strip()
        if not _MOBILE.match(v):
            raise ValueError("Enter a valid mobile number.")
        return v

    @field_validator("message")
    @classmethod
    def _message(cls, v):
        # Keep line breaks; drop other control characters.
        text = "".join(ch for ch in (v or "") if ch in "\n\t" or ord(ch) >= 32).strip()
        if len(text) < 10:
            raise ValueError("Please write a little more (at least 10 characters).")
        return text


class ContactAccepted(BaseModel):
    number: str


class ContactUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Optional[Literal["new", "in_progress", "closed"]] = None
    admin_note: Optional[str] = Field(None, max_length=1000)

    @field_validator("admin_note")
    @classmethod
    def _note(cls, v):
        return None if v is None else _line(v, "Note", required=False)

    @model_validator(mode="after")
    def _something(self):
        if not self.model_fields_set:
            raise ValueError("Send a status or a note.")
        return self


class AdminContactOut(BaseModel):
    id: uuid.UUID
    number: str
    name: str
    email: str
    mobile: str
    subject: str
    message: str
    status: str
    admin_note: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
