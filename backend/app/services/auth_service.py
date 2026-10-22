import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from enum import Enum
from typing import Awaitable, Callable, List, Optional, Tuple

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.rate_limit import email_key, fake_attempts
from app.core.security import (
    create_access_token,
    dummy_password_check,
    generate_secure_otp,
    hash_password,
    hash_token,
    verify_password,
    verify_token_hash,
)
from app.models.user import AuthSession, AuthToken, User
from app.services.email import BaseEmailService

logger = logging.getLogger("salvex.auth")

PURPOSE_VERIFY = "email_verification"
PURPOSE_RESET = "password_reset"
PUBLIC_ROLES = ("bidder", "seller")  # roles that may be chosen at registration (never "admin")

ERR_INVALID_CREDENTIALS = "Invalid email or password. Please check your credentials."
ERR_SUSPENDED = "This account is suspended. Please contact Salvex support."
ERR_UNVERIFIED = "Please verify your email address before logging in."
GENERIC_RESEND_MESSAGE = "If this email is registered, a new code has been sent."
MSG_VERIFY_FAILED = "Invalid or expired verification code. {n} attempt(s) remaining."
MSG_RESET_FAILED = "Invalid or expired reset code. {n} attempt(s) remaining."
MSG_LOCKED = "Too many failed attempts. Please request a new code."
FAKE_ATTEMPT_TTL_SECONDS = 600


class CodeResult(str, Enum):
    OK = "ok"
    NO_CODE = "no_code"
    EXPIRED = "expired"
    LOCKED = "locked"
    WRONG = "wrong"


@dataclass
class CodeCheck:
    result: CodeResult
    remaining: int = 0


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _context(purpose: str, user_id) -> str:
    """Binds a code to one purpose and one user, so it can never be used for anything else."""
    return f"{purpose}:{user_id}"


def _fake_key(purpose: str, email: str) -> str:
    return f"fake:{purpose}:{email_key(email)}"


# bcrypt takes ~250 ms of CPU on purpose. It runs in a worker thread (bcrypt releases the GIL) so a burst of
# sign-in attempts cannot freeze the web server's event loop for everyone else.


class AuthService:
    def __init__(self, db: AsyncSession, email_service: BaseEmailService, *, defer_email: bool = False):
        """
        defer_email=True queues emails and sends them only when `send_pending_emails()` is
        called (the API does this in a background task AFTER the database commit). That way no
        email is sent for a transaction that is rolled back, and response time does not reveal
        whether an email was sent.
        """
        self.db = db
        self.email_service = email_service
        self.defer_email = defer_email
        self._pending: List[Callable[[], Awaitable[object]]] = []

    # ------------------------------------------------------------------ helpers
    async def _emit(self, factory: Callable[[], Awaitable[object]]) -> None:
        if self.defer_email:
            self._pending.append(factory)
        else:
            await factory()

    async def send_pending_emails(self) -> None:
        pending, self._pending = self._pending, []
        for factory in pending:
            try:
                await factory()
            except Exception as exc:  # delivery problems must never surface to (or crash) the request
                logger.error("Queued email could not be delivered: %s", type(exc).__name__)

    async def _get_user_by_email(self, clean_email: str) -> Optional[User]:
        res = await self.db.execute(select(User).where(User.email == clean_email))
        return res.scalar_one_or_none()

    async def _invalidate_unused_codes(self, user_id, purpose: str) -> None:
        await self.db.execute(
            update(AuthToken)
            .where(AuthToken.user_id == user_id, AuthToken.purpose == purpose, AuthToken.is_used == False)  # noqa: E712
            .values(is_used=True)
        )

    async def _issue_code(self, user: User, purpose: str) -> str:
        """Create a fresh single-use code; every earlier unused code for this purpose is invalidated."""
        await self._invalidate_unused_codes(user.id, purpose)
        otp = generate_secure_otp(6)
        ttl = settings.OTP_RESET_EXPIRE_MINUTES if purpose == PURPOSE_RESET else settings.OTP_VERIFY_EXPIRE_MINUTES
        self.db.add(AuthToken(
            user_id=user.id,
            token_hash=hash_token(otp, _context(purpose, user.id)),
            purpose=purpose,
            attempts=0,
            max_attempts=settings.OTP_MAX_ATTEMPTS,
            is_used=False,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=ttl),
        ))
        await self.db.flush()
        fake_attempts.clear(_fake_key(purpose, user.email))
        return otp

    async def _cooldown_active(self, user: User, purpose: str) -> bool:
        res = await self.db.execute(
            select(AuthToken.created_at)
            .where(AuthToken.user_id == user.id, AuthToken.purpose == purpose)
            .order_by(AuthToken.created_at.desc())
            .limit(1)
        )
        latest = res.scalar_one_or_none()
        if latest is None:
            return False
        return (datetime.now(timezone.utc) - latest).total_seconds() < settings.OTP_RESEND_COOLDOWN_SECONDS

    async def _check_code(self, user: User, purpose: str, otp: str) -> CodeCheck:
        """
        Check a one-time code. The newest unused code is locked (SELECT ... FOR UPDATE), so two
        simultaneous attempts cannot both use the same code or skip the attempt counter.
        """
        res = await self.db.execute(
            select(AuthToken)
            .where(AuthToken.user_id == user.id, AuthToken.purpose == purpose, AuthToken.is_used == False)  # noqa: E712
            .order_by(AuthToken.created_at.desc())
            .limit(1)
            .with_for_update()
        )
        token = res.scalars().first()
        if token is None:
            return CodeCheck(CodeResult.NO_CODE)

        if datetime.now(timezone.utc) > token.expires_at:
            token.is_used = True
            await self.db.flush()
            return CodeCheck(CodeResult.EXPIRED)

        if token.attempts >= token.max_attempts:
            token.is_used = True
            await self.db.flush()
            return CodeCheck(CodeResult.LOCKED)

        token.attempts += 1
        if not verify_token_hash(otp, token.token_hash, _context(purpose, user.id)):
            await self.db.flush()
            return CodeCheck(CodeResult.WRONG, remaining=token.max_attempts - token.attempts)

        token.is_used = True  # single use
        await self.db.flush()
        return CodeCheck(CodeResult.OK)

    # ------------------------------------------------------------------ registration
    async def register_user(
        self,
        name: str,
        email: str,
        password: str,
        role: str,
        mobile: str = "",
        organization: str = "",
    ) -> Tuple[Optional[User], Optional[str]]:
        """Create a new unverified account and send the verification code. Fails if the email exists."""
        if role not in PUBLIC_ROLES:
            return None, "Invalid account type."
        clean_email = _normalize_email(email)
        if await self._get_user_by_email(clean_email):
            return None, "An account with this email address already exists."

        user = User(
            name=name.strip(),
            email=clean_email,
            password_hash=await asyncio.to_thread(hash_password, password),
            role=role,
            mobile=mobile.strip(),
            organization=organization.strip(),
            kyc_status="pending",
            is_email_verified=False,
            is_active=True,
        )
        self.db.add(user)
        await self.db.flush()

        otp = await self._issue_code(user, PURPOSE_VERIFY)
        await self._emit(lambda: self.email_service.send_verification_otp(user.email, otp, user.name))
        return user, None

    async def register_public(
        self,
        *,
        name: str,
        email: str,
        password: str,
        role: str,
        mobile: str = "",
        organization: str = "",
    ) -> None:
        """
        Registration that looks the same to the caller whether or not the email is already known.
          - new email                  -> create the account, email a verification code
          - existing UNVERIFIED email  -> the newest registration wins (name, password, role are
                                          replaced) and a fresh code is emailed. Whoever does not
                                          own the mailbox can never verify, so cannot take over
                                          an address by pre-registering it.
          - existing VERIFIED email    -> nothing changes; the owner gets a "you already have an
                                          account" email.
        """
        clean_email = _normalize_email(email)
        user = await self._get_user_by_email(clean_email)

        if user is None:
            await self.register_user(name, clean_email, password, role, mobile, organization)
            return

        if user.is_active and not user.is_email_verified and role in PUBLIC_ROLES:
            user.name = name.strip()
            user.password_hash = await asyncio.to_thread(hash_password, password)
            user.role = role
            user.mobile = mobile.strip()
            user.organization = organization.strip()
            await self.db.flush()
            # Always issue a NEW code (the resend cooldown does not apply here): the single live
            # code must belong to the newest submission, so an older code can never verify an
            # account that now carries a newer password. (Request volume is bounded by the rate limiter.)
            otp = await self._issue_code(user, PURPOSE_VERIFY)
            await self._emit(lambda: self.email_service.send_verification_otp(user.email, otp, user.name))
            return

        # Existing verified (or suspended) account: spend the same time as a real registration.
        await asyncio.to_thread(dummy_password_check, password)
        if user.is_active:
            await self._emit(lambda: self.email_service.send_account_exists_notice(user.email, user.name))

    # ------------------------------------------------------------------ email verification
    async def verify_email_otp(self, email: str, otp: str) -> Tuple[bool, str]:
        """Service-level verification with detailed messages (the public API uses verify_email_public)."""
        user = await self._get_user_by_email(_normalize_email(email))
        if not user:
            return False, "Invalid or expired verification code."
        if user.is_email_verified:
            return True, "Email is already verified."

        check = await self._check_code(user, PURPOSE_VERIFY, otp)
        if check.result == CodeResult.OK:
            user.is_email_verified = True
            await self.db.flush()
            return True, "Email verified successfully."
        if check.result == CodeResult.WRONG:
            return False, f"Invalid verification code. {check.remaining} attempt(s) remaining."
        if check.result == CodeResult.EXPIRED:
            return False, "Verification code has expired. Please request a new one."
        if check.result == CodeResult.LOCKED:
            return False, "Too many failed attempts. Code has been invalidated. Please request a new code."
        return False, "No pending verification code found. Please request a new code."

    async def verify_email_public(self, email: str, otp: str) -> Tuple[bool, str]:
        """
        Verification for the public API. Every failure has the same shape for registered and
        unregistered emails ("... N attempt(s) remaining", then "Too many failed attempts").
        """
        clean = _normalize_email(email)
        user = await self._get_user_by_email(clean)

        if user and user.is_active and not user.is_email_verified:
            check = await self._check_code(user, PURPOSE_VERIFY, otp)
            if check.result == CodeResult.OK:
                user.is_email_verified = True
                await self.db.flush()
                fake_attempts.clear(_fake_key(PURPOSE_VERIFY, clean))
                return True, "Email verified successfully."
            if check.result == CodeResult.WRONG:
                return False, MSG_VERIFY_FAILED.format(n=check.remaining)
            if check.result == CodeResult.LOCKED:
                fake_attempts.exhaust(_fake_key(PURPOSE_VERIFY, clean), settings.OTP_MAX_ATTEMPTS)
                return False, MSG_LOCKED
            # NO_CODE / EXPIRED fall through and look like any other failed attempt

        remaining = fake_attempts.attempt(
            _fake_key(PURPOSE_VERIFY, clean), settings.OTP_MAX_ATTEMPTS, FAKE_ATTEMPT_TTL_SECONDS
        )
        if remaining < 0:
            return False, MSG_LOCKED
        return False, MSG_VERIFY_FAILED.format(n=remaining)

    async def resend_otp(self, email: str, purpose: str = PURPOSE_VERIFY) -> Tuple[bool, str]:
        """
        Send a new code if the account exists and the cooldown allows it. The answer is always the
        same generic message, so it does not reveal whether the email is registered or whether a
        message was actually sent. (The website enforces the cooldown visibly with a countdown, and
        the rate limiter rejects abuse with HTTP 429 identically for every email.)
        """
        clean = _normalize_email(email)
        user = await self._get_user_by_email(clean)

        if user is None or not user.is_active:
            fake_attempts.clear(_fake_key(purpose, clean))
            return True, GENERIC_RESEND_MESSAGE
        if purpose == PURPOSE_VERIFY and user.is_email_verified:
            return True, GENERIC_RESEND_MESSAGE
        if await self._cooldown_active(user, purpose):
            return True, GENERIC_RESEND_MESSAGE

        otp = await self._issue_code(user, purpose)
        if purpose == PURPOSE_RESET:
            await self._emit(lambda: self.email_service.send_password_reset_otp(user.email, otp, user.name))
        else:
            await self._emit(lambda: self.email_service.send_verification_otp(user.email, otp, user.name))
        return True, GENERIC_RESEND_MESSAGE

    # ------------------------------------------------------------------ sessions
    async def _create_session(self, user: User, user_agent: Optional[str]) -> AuthSession:
        now = datetime.now(timezone.utc)
        session = AuthSession(
            user_id=user.id,
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(seconds=settings.session_lifetime_seconds),
            user_agent=(user_agent or "")[:255] or None,
        )
        self.db.add(session)
        await self.db.flush()

        # Keep only the newest MAX_SESSIONS_PER_USER active sessions.
        res = await self.db.execute(
            select(AuthSession)
            .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None), AuthSession.expires_at > now)
            .order_by(AuthSession.created_at.desc())
        )
        for old in res.scalars().all()[settings.MAX_SESSIONS_PER_USER:]:
            old.revoked_at = now
            old.revoke_reason = "limit"

        # Housekeeping: forget this user's sessions that ended more than 30 days ago.
        await self.db.execute(
            delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.expires_at < now - timedelta(days=30))
        )
        await self.db.flush()
        return session

    async def revoke_session(self, session_id, reason: str = "logout") -> None:
        await self.db.execute(
            update(AuthSession)
            .where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=datetime.now(timezone.utc), revoke_reason=reason[:32])
        )

    async def revoke_all_sessions(self, user_id, reason: str = "logout_all", except_session_id=None) -> None:
        stmt = (
            update(AuthSession)
            .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=datetime.now(timezone.utc), revoke_reason=reason[:32])
        )
        if except_session_id is not None:
            stmt = stmt.where(AuthSession.id != except_session_id)
        await self.db.execute(stmt)

    # ------------------------------------------------------------------ login
    async def authenticate_user_with_session(
        self,
        identifier: str,
        password: str,
        user_agent: Optional[str] = None,
    ) -> Tuple[Optional[User], Optional[str], Optional[AuthSession], Optional[str]]:
        """
        Check credentials and open a session. Returns (user, token, session, error).
        Wrong password and unknown email give the same error and take the same time.
        Suspended / unverified status is only revealed AFTER a correct password.
        """
        user = await self._get_user_by_email(_normalize_email(identifier))

        if user is None:
            await asyncio.to_thread(dummy_password_check, password)
            return None, None, None, ERR_INVALID_CREDENTIALS
        if not await asyncio.to_thread(verify_password, password, user.password_hash):
            return None, None, None, ERR_INVALID_CREDENTIALS
        if not user.is_active:
            return None, None, None, ERR_SUSPENDED
        if not user.is_email_verified:
            return None, None, None, ERR_UNVERIFIED

        session = await self._create_session(user, user_agent)
        token = create_access_token(
            subject=str(user.id),
            role=user.role,
            expires_delta=session.expires_at - session.created_at,
            session_id=str(session.id),
        )
        return user, token, session, None

    async def authenticate_user(
        self, identifier: str, password: str
    ) -> Tuple[Optional[User], Optional[str], Optional[str]]:
        user, token, _session, error = await self.authenticate_user_with_session(identifier, password)
        return user, token, error

    # ------------------------------------------------------------------ password reset
    async def request_password_reset(self, email: str) -> Tuple[bool, str]:
        """Send a reset code if the account exists. The answer never reveals whether it does."""
        return await self.resend_otp(email, purpose=PURPOSE_RESET)

    async def _apply_new_password(self, user: User, new_password: str) -> None:
        user.password_hash = await asyncio.to_thread(hash_password, new_password)
        await self._invalidate_unused_codes(user.id, PURPOSE_RESET)
        await self.revoke_all_sessions(user.id, reason="password_reset")  # every device is signed out
        await self.db.flush()
        await self._emit(lambda: self.email_service.send_password_changed_notice(user.email, user.name))

    async def reset_password_with_otp(self, email: str, otp: str, new_password: str) -> Tuple[bool, str]:
        """Service-level reset with detailed messages (the public API uses reset_password_public)."""
        user = await self._get_user_by_email(_normalize_email(email))
        if not user:
            return False, "Invalid or expired reset code."

        check = await self._check_code(user, PURPOSE_RESET, otp)
        if check.result == CodeResult.OK:
            await self._apply_new_password(user, new_password)
            return True, "Password updated successfully. You can now log in with your new password."
        if check.result == CodeResult.WRONG:
            return False, f"Invalid reset code. {check.remaining} attempt(s) remaining."
        if check.result == CodeResult.EXPIRED:
            return False, "Password reset code has expired. Please request a new one."
        if check.result == CodeResult.LOCKED:
            return False, "Too many failed attempts. Reset code invalidated."
        return False, "No active password reset request found. Please request a new code."

    async def reset_password_public(self, email: str, otp: str, new_password: str) -> Tuple[bool, str]:
        """Reset for the public API: failures look identical for registered and unregistered emails."""
        clean = _normalize_email(email)
        user = await self._get_user_by_email(clean)

        if user and user.is_active:
            check = await self._check_code(user, PURPOSE_RESET, otp)
            if check.result == CodeResult.OK:
                await self._apply_new_password(user, new_password)
                fake_attempts.clear(_fake_key(PURPOSE_RESET, clean))
                return True, "Password updated successfully. You can now log in with your new password."
            if check.result == CodeResult.WRONG:
                return False, MSG_RESET_FAILED.format(n=check.remaining)
            if check.result == CodeResult.LOCKED:
                fake_attempts.exhaust(_fake_key(PURPOSE_RESET, clean), settings.OTP_MAX_ATTEMPTS)
                return False, MSG_LOCKED

        remaining = fake_attempts.attempt(
            _fake_key(PURPOSE_RESET, clean), settings.OTP_MAX_ATTEMPTS, FAKE_ATTEMPT_TTL_SECONDS
        )
        if remaining < 0:
            return False, MSG_LOCKED
        return False, MSG_RESET_FAILED.format(n=remaining)
