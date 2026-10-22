"""
Controlled creation of administrator accounts.

Administrators can NOT be created through the website or any HTTP endpoint: public registration
only accepts the roles "bidder" and "seller", and the request schemas reject unknown fields. The
only way to get an administrator is to run `python -m app.cli create-admin` on the server (needs
shell access and database access). That command calls `provision_admin` below.

Nothing here runs automatically.
"""
import asyncio
import logging
from typing import Optional

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.password_policy import validate_password_strength
from app.core.security import hash_password
from app.models.user import User
from app.services.auth_service import AuthService
from app.services.email import BaseEmailService, mask_email

logger = logging.getLogger("salvex.admin")

MIN_ADMIN_PASSWORD_LENGTH = 12


class AdminProvisioningError(Exception):
    """A safe-to-display reason why an administrator could not be provisioned."""


async def provision_admin(
    db: AsyncSession,
    *,
    email: str,
    name: str,
    password: Optional[str] = None,
    promote_existing: bool = False,
) -> User:
    """
    Create a new verified administrator, or (only when promote_existing=True) promote an existing,
    active, email-verified user. Existing sessions of a promoted user are revoked. The caller
    commits the transaction.
    """
    try:
        clean_email = validate_email(email, check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise AdminProvisioningError("That email address is not valid.")

    existing = (await db.execute(select(User).where(User.email == clean_email))).scalar_one_or_none()

    if existing is not None:
        if not promote_existing:
            raise AdminProvisioningError(
                "A user with this email already exists. Re-run with explicit promotion to change its role."
            )
        if not existing.is_active or not existing.is_email_verified:
            raise AdminProvisioningError("Only an active, email-verified user can be promoted.")
        existing.role = "admin"
        service = AuthService(db, _NoEmail())
        await service.revoke_all_sessions(existing.id, reason="role_change")
        await db.flush()
        logger.warning("User %s was promoted to administrator", mask_email(clean_email))
        return existing

    if not name or len(name.strip()) < 2:
        raise AdminProvisioningError("A name of at least 2 characters is required.")
    if not password:
        raise AdminProvisioningError("A password is required for a new administrator.")
    if len(password) < MIN_ADMIN_PASSWORD_LENGTH:
        raise AdminProvisioningError(f"Administrator passwords must be at least {MIN_ADMIN_PASSWORD_LENGTH} characters.")
    try:
        validate_password_strength(password, clean_email)
    except ValueError as exc:
        raise AdminProvisioningError(str(exc))

    user = User(
        name=name.strip(),
        email=clean_email,
        password_hash=await asyncio.to_thread(hash_password, password),
        role="admin",
        mobile="",
        organization="",
        is_email_verified=True,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    logger.warning("Administrator account created for %s", mask_email(clean_email))
    return user


class _NoEmail(BaseEmailService):
    async def send_verification_otp(self, to_email, otp, user_name):
        return True, "unused"

    async def send_password_reset_otp(self, to_email, otp, user_name):
        return True, "unused"
