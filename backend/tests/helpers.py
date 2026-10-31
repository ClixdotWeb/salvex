"""Shared helpers for the HTTP-level authentication tests."""
import uuid
from typing import List, Optional, Tuple

from app.services.email import BaseEmailService
from app.services.sms import BaseSmsService

PASSWORD = "StrongPassword@2026"
NEW_PASSWORD = "NewSecretPassword456!"


def new_email(prefix: str = "user") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}@salvex-test.in"


def wrong_code(correct: str) -> str:
    return "000000" if correct != "000000" else "111111"


class CapturingEmailService(BaseEmailService):
    """Test double that records messages instead of sending them."""

    def __init__(self) -> None:
        self.sent: List[dict] = []

    async def send_verification_otp(self, to_email: str, otp: str, user_name: str) -> Tuple[bool, str]:
        self.sent.append({"type": "verification", "to": to_email, "otp": otp, "name": user_name})
        return True, "captured"

    async def send_password_reset_otp(self, to_email: str, otp: str, user_name: str) -> Tuple[bool, str]:
        self.sent.append({"type": "reset", "to": to_email, "otp": otp, "name": user_name})
        return True, "captured"

    async def send_account_exists_notice(self, to_email: str, user_name: str) -> Tuple[bool, str]:
        self.sent.append({"type": "exists", "to": to_email, "name": user_name})
        return True, "captured"

    async def send_password_changed_notice(self, to_email: str, user_name: str) -> Tuple[bool, str]:
        self.sent.append({"type": "changed", "to": to_email, "name": user_name})
        return True, "captured"

    def of_type(self, kind: str, to: Optional[str] = None) -> List[dict]:
        return [m for m in self.sent if m["type"] == kind and (to is None or m["to"] == to.lower())]

    def last_otp(self, kind: str, to: Optional[str] = None) -> str:
        return self.of_type(kind, to)[-1]["otp"]


class CapturingSmsService(BaseSmsService):
    """Test double that records SMS codes instead of sending them."""

    def __init__(self) -> None:
        self.sent: List[dict] = []

    async def send_verification_otp(self, mobile: str, otp: str) -> Tuple[bool, str]:
        self.sent.append({"to": mobile, "otp": otp})
        return True, "captured"

    def last_otp(self, to: Optional[str] = None) -> str:
        return [m for m in self.sent if to is None or m["to"] == to][-1]["otp"]


async def register(client, email: str, password: str = PASSWORD, **extra):
    payload = {"name": "Api Test User", "email": email, "password": password, "role": "bidder", "mobile": "+91 90000 00001"}
    payload.update(extra)
    return await client.post("/api/auth/register", json=payload)


async def register_and_verify(api, email: str, password: str = PASSWORD, **extra) -> None:
    res = await register(api.client, email, password, **extra)
    assert res.status_code == 201, res.text
    res = await api.client.post(
        "/api/auth/verify-email", json={"email": email, "otp": api.mail.last_otp("verification", email)}
    )
    assert res.status_code == 200, res.text
    # Verifying also signs the user in (cookie). Tests that need a session sign in explicitly,
    # so start every caller from a signed-out client as before.
    api.client.cookies.clear()


async def login(client, email: str, password: str = PASSWORD, bearer: bool = False):
    headers = {"X-Auth-Mode": "bearer"} if bearer else {}
    return await client.post("/api/auth/login", json={"identifier": email, "password": password}, headers=headers)


async def signed_in(api, email: Optional[str] = None, password: str = PASSWORD, **extra) -> Tuple[str, str]:
    """Register + verify + sign in. Returns (email, csrf_token). The client keeps the cookie."""
    email = email or new_email("signedin")
    await register_and_verify(api, email, password, **extra)
    res = await login(api.client, email, password)
    assert res.status_code == 200, res.text
    return email, res.json()["csrf_token"]
