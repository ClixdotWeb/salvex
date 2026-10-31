"""
Email delivery for verification codes, password recovery and security notices.

  - SmtpEmailService       real delivery (the only provider allowed outside development/test)
  - DevOutboxEmailService  development/test only: writes messages to a local file instead of
                           sending them. One-time codes are NEVER written to the application log.

Rules enforced here:
  - Codes, passwords, tokens and full recipient addresses never appear in log output.
  - User-supplied text is HTML-escaped before it is placed in an HTML email.
  - SMTP connections verify the server certificate (STARTTLS or implicit TLS).
  - The developer outbox refuses to run in production-like environments.
"""
import asyncio
import html
import json
import logging
import smtplib
import ssl
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import List, Optional, Tuple

from app.core.config import settings

logger = logging.getLogger("salvex.email")


def mask_email(address: str) -> str:
    """a***@example.com - enough to recognise in logs, not enough to identify a person."""
    local, _, domain = (address or "").partition("@")
    return f"{local[:1]}***@{domain}" if domain else "***"


class BaseEmailService(ABC):
    """Interface used by the authentication code. The two OTP methods are required; the notices
    are optional (default: do nothing) so simple test doubles keep working."""

    @abstractmethod
    async def send_verification_otp(self, to_email: str, otp: str, user_name: str) -> Tuple[bool, str]:
        pass

    @abstractmethod
    async def send_password_reset_otp(self, to_email: str, otp: str, user_name: str) -> Tuple[bool, str]:
        pass

    async def send_account_exists_notice(self, to_email: str, user_name: str) -> Tuple[bool, str]:
        return True, "not supported by this email service"

    async def send_password_changed_notice(self, to_email: str, user_name: str) -> Tuple[bool, str]:
        return True, "not supported by this email service"

    async def send_notification(self, to_email: str, user_name: str, title: str, body: str,
                                link: Optional[str] = None) -> Tuple[bool, str]:
        """A website notification by email (outbid, won, payment, KYC result...)."""
        return False, "notifications are not supported by this email service"


class TemplatedEmailService(BaseEmailService):
    """Builds the message texts; subclasses only decide how a message is delivered."""

    @abstractmethod
    async def _deliver(self, to_email: str, subject: str, text: str, html_body: str) -> Tuple[bool, str]:
        pass

    @staticmethod
    def _wrap_html(inner: str) -> str:
        return (
            '<div style="font-family: sans-serif; max-width: 500px; margin: auto; padding: 20px; '
            'border: 1px solid #e2e8f0; border-radius: 8px;">' + inner + "</div>"
        )

    @staticmethod
    def _code_box(otp: str) -> str:
        return (
            '<div style="background-color: #f1f5f9; padding: 16px; text-align: center; font-size: 28px; '
            'font-weight: bold; letter-spacing: 4px; border-radius: 6px;">' + html.escape(otp) + "</div>"
        )

    async def send_verification_otp(self, to_email: str, otp: str, user_name: str) -> Tuple[bool, str]:
        minutes = settings.OTP_VERIFY_EXPIRE_MINUTES
        text = (
            f"Hello {user_name},\n\n"
            f"Your Salvex verification code is: {otp}\n"
            f"This code expires in {minutes} minutes and can be used once.\n\n"
            "Never share this code with anyone. If you did not create a Salvex account, ignore this email."
        )
        body = self._wrap_html(
            "<h2>Verify your Salvex account</h2>"
            f"<p>Hello <strong>{html.escape(user_name)}</strong>,</p>"
            "<p>Your one-time verification code is:</p>" + self._code_box(otp) +
            f'<p style="color:#64748b;font-size:14px">This code expires in {minutes} minutes and can be used once. '
            "Never share it with anyone. If you did not create a Salvex account, ignore this email.</p>"
        )
        return await self._deliver(to_email, "Verify your Salvex account", text, body)

    async def send_password_reset_otp(self, to_email: str, otp: str, user_name: str) -> Tuple[bool, str]:
        minutes = settings.OTP_RESET_EXPIRE_MINUTES
        text = (
            f"Hello {user_name},\n\n"
            f"Your Salvex password reset code is: {otp}\n"
            f"This code expires in {minutes} minutes and can be used once.\n\n"
            "Never share this code with anyone. If you did not ask to reset your password, ignore this "
            "email; your password has not been changed."
        )
        body = self._wrap_html(
            "<h2>Reset your Salvex password</h2>"
            f"<p>Hello <strong>{html.escape(user_name)}</strong>,</p>"
            "<p>Your password reset code is:</p>" + self._code_box(otp) +
            f'<p style="color:#64748b;font-size:14px">This code expires in {minutes} minutes and can be used once. '
            "If you did not ask to reset your password, ignore this email; your password has not been changed.</p>"
        )
        return await self._deliver(to_email, "Reset your Salvex password", text, body)

    async def send_account_exists_notice(self, to_email: str, user_name: str) -> Tuple[bool, str]:
        text = (
            f"Hello {user_name},\n\n"
            "Someone tried to create a Salvex account with this email address, but an account already exists.\n"
            "If it was you, please sign in, or use 'Forgot password' if you cannot remember your password.\n"
            "If it was not you, no action is needed; your account has not been changed."
        )
        body = self._wrap_html(
            "<h2>You already have a Salvex account</h2>"
            f"<p>Hello <strong>{html.escape(user_name)}</strong>,</p>"
            "<p>Someone tried to create a Salvex account with this email address, but an account already exists.</p>"
            "<p>If it was you, please sign in, or use <em>Forgot password</em>. "
            "If it was not you, no action is needed; your account has not been changed.</p>"
        )
        return await self._deliver(to_email, "You already have a Salvex account", text, body)

    async def send_password_changed_notice(self, to_email: str, user_name: str) -> Tuple[bool, str]:
        text = (
            f"Hello {user_name},\n\n"
            "The password for your Salvex account was just changed and all your devices were signed out.\n"
            "If you did this, no action is needed. If you did not, reset your password immediately and "
            "contact Salvex support."
        )
        body = self._wrap_html(
            "<h2>Your Salvex password was changed</h2>"
            f"<p>Hello <strong>{html.escape(user_name)}</strong>,</p>"
            "<p>The password for your account was just changed and all your devices were signed out.</p>"
            "<p>If you did not do this, reset your password immediately and contact Salvex support.</p>"
        )
        return await self._deliver(to_email, "Your Salvex password was changed", text, body)

    async def send_notification(self, to_email: str, user_name: str, title: str, body: str,
                                link: Optional[str] = None) -> Tuple[bool, str]:
        url = f"{settings.PUBLIC_SITE_URL.rstrip('/')}{link}" if link else None
        text = f"Hello {user_name},\n\n{title}\n\n{body}\n" + (f"\nOpen: {url}\n" if url else "") + "\n- Salvex"
        button = (f'<p style="margin: 24px 0;"><a href="{html.escape(url)}" style="background: #075BFF; color: #fff; '
                  'padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Open on Salvex</a></p>') if url else ""
        inner = (f"<p>Hello <strong>{html.escape(user_name)}</strong>,</p>"
                 f"<h2 style=\"margin: 0 0 12px; font-size: 18px;\">{html.escape(title)}</h2>"
                 f"<p>{html.escape(body)}</p>{button}")
        return await self._deliver(to_email, f"Salvex: {title}", text, self._wrap_html(inner))


class DevOutboxEmailService(TemplatedEmailService):
    """
    Development/test transport. Messages (including the one-time code) are appended to a local
    file and the application log only says that a message was written. Read the latest code with:
        python -m app.cli dev-last-code you@example.com
    """

    def __init__(self, path: Optional[str] = None):
        if settings.is_production_like:
            raise RuntimeError("The developer email outbox cannot be used outside development/test.")
        self.path = Path(path or settings.DEV_OUTBOX_PATH)

    async def _deliver(self, to_email: str, subject: str, text: str, html_body: str) -> Tuple[bool, str]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "time": datetime.now(timezone.utc).isoformat(),
            "to": to_email,
            "subject": subject,
            "text": text,
        }
        with open(self.path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(record) + "\n")
        logger.info("[DEV_EMAIL] '%s' written to the developer outbox for %s", subject, mask_email(to_email))
        return True, "Written to the developer outbox"


# Backwards-compatible name.
ConsoleEmailService = DevOutboxEmailService


def read_dev_outbox(path: Optional[str] = None) -> List[dict]:
    """All messages in the developer outbox (oldest first). Development/test only."""
    if settings.is_production_like:
        raise RuntimeError("The developer email outbox is not available outside development/test.")
    outbox = Path(path or settings.DEV_OUTBOX_PATH)
    if not outbox.exists():
        return []
    return [json.loads(line) for line in outbox.read_text(encoding="utf-8").splitlines() if line.strip()]


class SmtpEmailService(TemplatedEmailService):
    """Real delivery over SMTP with certificate verification (STARTTLS, or implicit TLS on 465)."""

    async def _deliver(self, to_email: str, subject: str, text: str, html_body: str) -> Tuple[bool, str]:
        if not settings.SMTP_HOST:
            logger.error("SMTP is not configured; email to %s was not sent", mask_email(to_email))
            return False, "SMTP is not configured"

        msg = EmailMessage()
        msg["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
        msg["To"] = to_email
        msg["Subject"] = subject
        msg.set_content(text)
        msg.add_alternative(html_body, subtype="html")

        def _send() -> None:
            context = ssl.create_default_context()  # verifies the certificate and host name
            if settings.SMTP_PORT == 465:
                server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10.0, context=context)
            else:
                server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10.0)
            with server:
                if settings.SMTP_PORT != 465:
                    server.starttls(context=context)
                if settings.SMTP_USER:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.send_message(msg)

        try:
            await asyncio.to_thread(_send)
            return True, "Email sent"
        except Exception as exc:  # never log the exception text: it can contain addresses
            logger.error("Email delivery to %s failed: %s", mask_email(to_email), type(exc).__name__)
            return False, f"Email delivery error: {type(exc).__name__}"


def get_email_service() -> BaseEmailService:
    """Factory for the configured provider. Settings validation already guarantees that
    production-like environments use SMTP."""
    if settings.EMAIL_PROVIDER == "smtp":
        return SmtpEmailService()
    return DevOutboxEmailService()
