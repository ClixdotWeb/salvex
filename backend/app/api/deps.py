"""
Authentication and authorization dependencies.

A request is authenticated only if ALL of these hold (checked against the database on every request):
  - the token's signature, issuer and expiry are valid,
  - its session exists, is not revoked, has not expired and has not been idle too long,
  - the user exists, is active and has a verified email.
The role is always read from the database row, never from the token or the browser.
"""
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import ApiError
from app.core.security import decode_access_token, verify_csrf_token
from app.db.session import get_db
from app.models.user import AuthSession, User

http_bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class AuthContext:
    user: User
    session: AuthSession
    via_cookie: bool  # True when authenticated by the browser cookie (so CSRF protection applies)


async def get_auth_context_optional(
    request: Request,
    auth_header: Optional[HTTPAuthorizationCredentials] = Depends(http_bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> Optional[AuthContext]:
    token: Optional[str] = None
    via_cookie = False
    if auth_header and auth_header.credentials:
        token = auth_header.credentials  # explicit header wins over the cookie
    else:
        cookie = request.cookies.get(settings.auth_cookie_name)
        if cookie:
            token, via_cookie = cookie, True
    if not token:
        return None

    payload = decode_access_token(token)
    if not payload:
        return None
    try:
        user_id = uuid.UUID(str(payload["sub"]))
        session_id = uuid.UUID(str(payload["sid"]))
    except (KeyError, ValueError, TypeError):
        return None  # includes old tokens without a session id

    res = await db.execute(
        select(AuthSession, User)
        .join(User, User.id == AuthSession.user_id)
        .where(AuthSession.id == session_id, AuthSession.user_id == user_id)
    )
    pair = res.first()
    if pair is None:
        return None
    session, user = pair

    now = datetime.now(timezone.utc)
    if session.revoked_at is not None or session.expires_at <= now:
        return None

    if now - session.last_seen_at > timedelta(minutes=settings.SESSION_IDLE_TIMEOUT_MINUTES):
        session.revoked_at = now
        session.revoke_reason = "idle"
        await db.commit()
        return None

    if not user.is_active or not user.is_email_verified:
        return None

    if (now - session.last_seen_at).total_seconds() >= settings.SESSION_TOUCH_INTERVAL_SECONDS:
        session.last_seen_at = now
        await db.commit()

    return AuthContext(user=user, session=session, via_cookie=via_cookie)


async def get_auth_context(ctx: Optional[AuthContext] = Depends(get_auth_context_optional)) -> AuthContext:
    if ctx is None:
        raise ApiError(
            401,
            "Authentication required. Please sign in to access this resource.",
            "not_authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return ctx


async def get_current_user_optional(ctx: Optional[AuthContext] = Depends(get_auth_context_optional)) -> Optional[User]:
    return ctx.user if ctx else None


async def get_current_user(ctx: AuthContext = Depends(get_auth_context)) -> User:
    """Require a valid signed-in user."""
    return ctx.user


async def require_csrf(request: Request, ctx: AuthContext = Depends(get_auth_context)) -> AuthContext:
    """
    For state-changing endpoints: when the browser cookie authenticates the request, also require
    the per-session CSRF token in the X-CSRF-Token header. Another website can make a browser send
    the cookie, but it cannot read the token, so it cannot forge this header.
    """
    if ctx.via_cookie and not verify_csrf_token(str(ctx.session.id), request.headers.get("x-csrf-token")):
        raise ApiError(403, "Security check failed. Please refresh the page and try again.", "csrf_failed")
    return ctx


def require_role(allowed_roles: List[str]):
    """Role-based authorization dependency factory (role comes from the database)."""
    async def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise ApiError(403, "Access denied. You do not have permission to do this.", "forbidden")
        return current_user
    return role_checker
