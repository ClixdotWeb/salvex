from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.auth import _PHONE, _PHONE_FORMATTING, _reject_control_chars


class UpdateProfileRequest(BaseModel):
    """
    The ONLY fields a user may change about themselves. Anything else (role, is_active, kyc_status,
    email, is_email_verified, ...) is rejected with 422, so it cannot be edited by mistake or on purpose.
    """
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=2, max_length=100)
    mobile: Optional[str] = Field(default=None, max_length=50)
    organization: Optional[str] = Field(default=None, max_length=255)

    @field_validator("name")
    @classmethod
    def _name(cls, v: Optional[str]) -> str:
        if v is None:
            raise ValueError("Name cannot be empty.")
        clean = v.strip()
        if len(clean) < 2:
            raise ValueError("Name must be at least 2 characters")
        if "<" in clean or ">" in clean:
            raise ValueError("Name must not contain < or >")
        return _reject_control_chars(clean, "Name")

    @field_validator("mobile")
    @classmethod
    def _mobile(cls, v: Optional[str]) -> str:
        clean = (v or "").strip()
        if not clean:
            return ""
        if not _PHONE.match(_PHONE_FORMATTING.sub("", clean)):
            raise ValueError("Enter a valid mobile number (7 to 15 digits, optionally starting with +).")
        return clean

    @field_validator("organization")
    @classmethod
    def _organization(cls, v: Optional[str]) -> str:
        clean = (v or "").strip()
        if "<" in clean or ">" in clean:
            raise ValueError("Organization must not contain < or >")
        return _reject_control_chars(clean, "Organization")

    @model_validator(mode="after")
    def _at_least_one(self):
        if not self.model_fields_set:
            raise ValueError("Send at least one field to change: name, mobile or organization.")
        return self
