import re
import uuid
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, ValidationInfo, field_validator

from app.core.password_policy import MAX_LENGTH, MIN_LENGTH, validate_password_strength

_PHONE_FORMATTING = re.compile(r"[\s\-()]")
_PHONE = re.compile(r"^\+?[0-9]{7,15}$")


def _reject_control_chars(value: str, label: str) -> str:
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        raise ValueError(f"{label} contains invalid characters.")
    return value


class StrictRequest(BaseModel):
    # Unknown fields are rejected (blocks attempts to send e.g. "role": "admin" or "is_active").
    model_config = ConfigDict(extra="forbid")


class UserRegisterRequest(StrictRequest):
    name: str = Field(..., min_length=2, max_length=100, description="Full name")
    email: EmailStr = Field(..., description="Unique user email address")
    password: str = Field(..., min_length=MIN_LENGTH, max_length=MAX_LENGTH, description="Account password")
    role: Literal["bidder", "seller"] = Field(default="bidder", description="Account type (admins cannot self-register)")
    mobile: str = Field(..., max_length=50, description="Contact mobile number (our team calls buyers)")
    organization: Optional[str] = Field(default="", max_length=255, description="Registered organization")

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        clean = v.strip()
        if len(clean) < 2:
            raise ValueError("Name must be at least 2 characters")
        if "<" in clean or ">" in clean:
            raise ValueError("Name must not contain < or >")
        return _reject_control_chars(clean, "Name")

    @field_validator("mobile")
    @classmethod
    def validate_mobile(cls, v: Optional[str]) -> str:
        clean = (v or "").strip()
        if not clean:
            raise ValueError("Enter your mobile number.")
        if not _PHONE.match(_PHONE_FORMATTING.sub("", clean)):
            raise ValueError("Enter a valid mobile number (7 to 15 digits, optionally starting with +).")
        return clean

    @field_validator("organization")
    @classmethod
    def validate_organization(cls, v: Optional[str]) -> str:
        clean = (v or "").strip()
        if "<" in clean or ">" in clean:
            raise ValueError("Organization must not contain < or >")
        return _reject_control_chars(clean, "Organization")

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str, info: ValidationInfo) -> str:
        # "email" is declared before "password", so it is already validated here
        return validate_password_strength(v, str(info.data.get("email", "")) or None)


class UserLoginRequest(StrictRequest):
    identifier: str = Field(..., min_length=1, max_length=254, description="Registered email address")
    password: str = Field(..., min_length=1, max_length=MAX_LENGTH, description="Account password")


class VerifyEmailRequest(StrictRequest):
    email: EmailStr = Field(..., description="User email address")
    otp: str = Field(..., pattern=r"^[0-9]{6}$", description="6-digit verification code")


class MobileCodeRequest(StrictRequest):
    mobile: Optional[str] = Field(default=None, max_length=50,
                                  description="A new number to use instead of the current one (optional)")

    @field_validator("mobile")
    @classmethod
    def validate_mobile(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not v.strip():
            return None
        clean = v.strip()
        if not _PHONE.match(_PHONE_FORMATTING.sub("", clean)):
            raise ValueError("Enter a valid mobile number (7 to 15 digits, optionally starting with +).")
        return clean


class VerifyCodeRequest(StrictRequest):
    otp: str = Field(..., pattern=r"^[0-9]{6}$", description="6-digit code (SMS or email)")


VerifyMobileRequest = VerifyCodeRequest  # earlier name


class ResendOtpRequest(StrictRequest):
    email: EmailStr = Field(..., description="User email address")
    purpose: Literal["email_verification", "password_reset", "mobile_verification"] = Field(
        default="email_verification",
        description="Purpose of the code"
    )


class ForgotPasswordRequest(StrictRequest):
    email: EmailStr = Field(..., description="Registered account email")


class ResetPasswordRequest(StrictRequest):
    email: EmailStr = Field(..., description="Registered account email")
    otp: str = Field(..., pattern=r"^[0-9]{6}$", description="6-digit password reset code")
    new_password: str = Field(..., min_length=MIN_LENGTH, max_length=MAX_LENGTH, description="New account password")

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str, info: ValidationInfo) -> str:
        return validate_password_strength(v, str(info.data.get("email", "")) or None)


class UserResponse(BaseModel):
    id: uuid.UUID
    buyer_id: str = ""
    name: str
    email: str
    role: str
    mobile: str
    organization: str
    kyc_status: str
    is_email_verified: bool
    is_mobile_verified: bool = False
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class MeResponse(UserResponse):
    """The signed-in user plus the per-session CSRF token the website must send on state-changing calls."""
    csrf_token: str


class AuthTokenResponse(BaseModel):
    message: str
    # True only on the very first successful sign-in for this account, so the website can say
    # "Welcome" instead of "Welcome back". Not on MeResponse: that is re-read on every page load.
    is_first_login: bool = False
    # Only returned to non-browser clients that ask for it with the header "X-Auth-Mode: bearer".
    # Browsers receive the token only in an HttpOnly cookie that scripts cannot read.
    access_token: Optional[str] = None
    token_type: str = "bearer"
    user: UserResponse
    csrf_token: str


class GenericMessageResponse(BaseModel):
    message: str
    success: bool = True


class VerifyEmailResponse(GenericMessageResponse):
    """A successful verification also signs the user in (same session, cookie and CSRF rules as login)."""
    user: UserResponse
    csrf_token: str
    # Only for non-browser clients that ask with "X-Auth-Mode: bearer"; browsers get the HttpOnly cookie.
    access_token: Optional[str] = None
    token_type: str = "bearer"
