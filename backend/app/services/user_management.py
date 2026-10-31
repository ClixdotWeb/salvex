"""
Administrator actions on user accounts. Each function changes the account, revokes sessions where
required and adds the audit entry to the caller's session WITHOUT committing; the route commits once so
the change, the session revocation and the audit record are stored together or not at all.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import record_audit
from app.core.config import settings
from app.core.errors import ApiError
from app.models.user import AuthSession, User


async def _lock_for_action(db: AsyncSession, actor: User, user_id: uuid.UUID) -> tuple[User, list[User]]:
    """
    Lock the target, the acting admin and every active administrator in ONE statement, always in id
    order. A single fixed lock order means two administrators acting on each other at the same moment
    are handled one after the other instead of deadlocking. Once the locks are held the rows are current
    (populate_existing refreshes copies loaded earlier in this request), so the actor is re-checked: an
    admin suspended or demoted while this request waited is refused. Returns (target, active admins).
    """
    rows = (await db.execute(
        select(User)
        .where(or_(User.id.in_([user_id, actor.id]), and_(User.role == "admin", User.is_active.is_(True))))
        .order_by(User.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )).scalars().all()
    by_id = {row.id: row for row in rows}
    current_actor = by_id.get(actor.id)
    if current_actor is None or current_actor.role != "admin" or not current_actor.is_active:
        raise ApiError(403, "Access denied. You do not have permission to do this.", "forbidden")
    target = by_id.get(user_id)
    if target is None:
        raise ApiError(404, "User not found.", "user_not_found")
    return target, [row for row in rows if row.role == "admin" and row.is_active]


async def revoke_sessions(db: AsyncSession, user_id: uuid.UUID, reason: str) -> int:
    result = await db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc), revoke_reason=reason[:32])
    )
    return result.rowcount or 0


def _guard_last_admin(target: User, active_admins: list[User]) -> None:
    """
    Never leave the platform without an active administrator. `active_admins` comes from
    `_lock_for_action`, so those rows are locked and current. Because the actor must itself be an active
    admin other than the target, this cannot normally fire; it is kept as a second line of defence.
    """
    if target.role == "admin" and target.is_active and not [a for a in active_admins if a.id != target.id]:
        raise ApiError(409, "This is the last active administrator and cannot be suspended or demoted.", "last_admin")


def _refuse_self(actor: User, target: User, what: str) -> None:
    if actor.id == target.id:
        raise ApiError(403, f"You cannot {what} your own account.", "self_action_forbidden")


async def suspend_user(db: AsyncSession, actor: User, user_id: uuid.UUID, reason: str) -> User:
    target, active_admins = await _lock_for_action(db, actor, user_id)
    _refuse_self(actor, target, "suspend")
    if not target.is_active:
        raise ApiError(409, "This account is already suspended.", "already_suspended")
    _guard_last_admin(target, active_admins)
    target.is_active = False
    target.suspended_at = datetime.now(timezone.utc)
    target.suspension_reason = reason
    target.suspended_by_id = actor.id
    revoked = await revoke_sessions(db, target.id, "suspended")
    await record_audit(db, actor=actor, action="user.suspend", target_type="user", target_id=target.id,
                       details={"reason": reason, "target_role": target.role, "sessions_revoked": revoked})
    return target


async def reactivate_user(db: AsyncSession, actor: User, user_id: uuid.UUID, reason: Optional[str]) -> User:
    target, _ = await _lock_for_action(db, actor, user_id)
    _refuse_self(actor, target, "reactivate")
    if target.is_active:
        raise ApiError(409, "This account is not suspended.", "not_suspended")
    target.is_active = True
    target.suspended_at = None
    target.suspension_reason = None
    target.suspended_by_id = None
    await record_audit(db, actor=actor, action="user.reactivate", target_type="user", target_id=target.id,
                       details={"reason": reason, "target_role": target.role})
    return target


async def change_role(db: AsyncSession, actor: User, user_id: uuid.UUID, new_role: str, reason: str) -> User:
    if new_role == "admin":  # defence in depth: the request schema already refuses it
        raise ApiError(403, "Administrators can only be created from the server shell.", "admin_grant_forbidden")
    if new_role == "seller" and not settings.SELLER_ACCOUNTS:
        raise ApiError(422, "Seller accounts are switched off: only administrators add vehicles.", "seller_accounts_off")
    target, active_admins = await _lock_for_action(db, actor, user_id)
    _refuse_self(actor, target, "change the role of")
    if target.role == new_role:
        raise ApiError(409, "The user already has this role.", "role_unchanged")
    _guard_last_admin(target, active_admins)
    old_role = target.role
    target.role = new_role
    revoked = await revoke_sessions(db, target.id, "role_changed")   # stale sessions must not keep old rights
    await record_audit(db, actor=actor, action="user.role_change", target_type="user", target_id=target.id,
                       details={"old_role": old_role, "new_role": new_role, "reason": reason, "sessions_revoked": revoked})
    return target


async def active_session_count(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Sessions that would still be accepted: not revoked, not expired and not idle too long (see deps.py)."""
    now = datetime.now(timezone.utc)
    idle_cutoff = now - timedelta(minutes=settings.SESSION_IDLE_TIMEOUT_MINUTES)
    return (await db.execute(
        select(func.count()).select_from(AuthSession).where(
            AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > now, AuthSession.last_seen_at > idle_cutoff)
    )).scalar_one()
