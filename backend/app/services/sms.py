"""
SMS delivery for one-time codes.

  - BaseSmsService is what the rest of the app calls. A real provider (MSG91, Twilio, Fast2SMS, ...) is one
    more subclass plus its name in config.SMS_PROVIDERS; nothing else changes.
  - DevOutboxSmsService (SMS_PROVIDER=console) writes the message to the same developer outbox file as the
    emails, for development/test only. Read the latest code with:
        python -m app.cli dev-last-code +919876543210
  - Indian SMS needs DLT registration (entity, sender ID and the exact message template) before a provider
    will deliver it. VERIFICATION_TEMPLATE is the text to register.
"""
import json
import logging
import re
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

from app.core.config import settings

logger = logging.getLogger("salvex.sms")

VERIFICATION_TEMPLATE = "{otp} is your Salvex Auction verification code. It expires in {minutes} minutes. Do not share it with anyone."


def normalize_mobile(mobile: str) -> str:
    """'+91 98765-43210' -> '+919876543210'; a bare 10-digit Indian number gets +91."""
    digits = re.sub(r"[^\d+]", "", mobile or "")
    if digits.startswith("+"):
        return "+" + re.sub(r"\D", "", digits)
    if len(digits) == 10:
        return "+91" + digits
    return digits


def mask_mobile(mobile: str) -> str:
    """Only the last 2 digits ever reach the log."""
    digits = re.sub(r"\D", "", mobile or "")
    return f"******{digits[-2:]}" if len(digits) >= 2 else "******"


class BaseSmsService(ABC):
    @abstractmethod
    async def send_verification_otp(self, mobile: str, otp: str) -> Tuple[bool, str]:
        """Send the mobile verification code. Never raises for delivery problems."""


class DevOutboxSmsService(BaseSmsService):
    def __init__(self, path: Optional[str] = None):
        if settings.is_production_like:
            raise RuntimeError("The developer SMS outbox cannot be used outside development/test.")
        self.path = Path(path or settings.DEV_OUTBOX_PATH)

    async def send_verification_otp(self, mobile: str, otp: str) -> Tuple[bool, str]:
        text = VERIFICATION_TEMPLATE.format(otp=otp, minutes=settings.OTP_VERIFY_EXPIRE_MINUTES)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "time": datetime.now(timezone.utc).isoformat(),
            "channel": "sms",
            "to": normalize_mobile(mobile),
            "subject": "SMS: mobile verification code",
            "text": text,
        }
        with open(self.path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(record) + "\n")
        logger.info("[DEV_SMS] verification code written to the developer outbox for %s", mask_mobile(mobile))
        return True, "Written to the developer outbox"


def get_sms_service() -> BaseSmsService:
    """Factory for the configured provider. Settings validation keeps the outbox out of production."""
    return DevOutboxSmsService()
