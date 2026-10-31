"""
Audit trail for sensitive administrative actions.

`record_audit` ADDS a row to the caller's database session and flushes it, but never commits. The
caller commits once, so the action and its audit record are saved together or not at all:

    user.is_active = False
    await record_audit(db, actor=admin, action="user.suspend", target_type="user", target_id=user.id,
                       details={"reason": "..."})
    await db.commit()      # both changes are stored in the same transaction

The table is append-only (a database trigger rejects UPDATE, DELETE and TRUNCATE). Details must be
small and must not contain secrets: keys that look like passwords, tokens or codes are refused.
"""
import re
import uuid
from typing import Any, Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditLog
from app.models.user import User

ACTION_PATTERN = re.compile(r"^[a-z0-9_]+(\.[a-z0-9_]+)+$")   # e.g. "user.suspend", "kyc.reject"
MAX_DETAILS_JSON_CHARS = 4000
MAX_STRING_CHARS = 500
MAX_DEPTH = 4

# A detail key containing any of these words is rejected, whatever the value.
FORBIDDEN_KEY_WORDS = (
    "password", "passwd", "secret", "token", "otp", "hash", "api_key", "apikey",
    "authorization", "cookie", "csrf", "credential", "private_key", "session_id",
)


class AuditError(ValueError):
    """The audit entry is malformed or would store something it must not."""


def _clean(value: Any, depth: int) -> Any:
    if depth > MAX_DEPTH:
        raise AuditError("audit details are nested too deeply")
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, str):
        return value[:MAX_STRING_CHARS]
    if isinstance(value, (list, tuple)):
        return [_clean(item, depth + 1) for item in value]
    if isinstance(value, dict):
        cleaned: Dict[str, Any] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise AuditError("audit detail keys must be text")
            lowered = key.lower()
            if any(word in lowered for word in FORBIDDEN_KEY_WORDS):
                raise AuditError(f"audit details must not contain a '{key}' field")
            cleaned[key] = _clean(item, depth + 1)
        return cleaned
    raise AuditError(f"audit details cannot store a value of type {type(value).__name__}")


def clean_details(details: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Validate and normalise the structured details; raises AuditError if they are unsafe."""
    if details is None:
        return {}
    if not isinstance(details, dict):
        raise AuditError("audit details must be a dictionary")
    cleaned = _clean(details, 0)
    if len(repr(cleaned)) > MAX_DETAILS_JSON_CHARS:
        raise AuditError("audit details are too large")
    return cleaned


async def record_audit(
    db: AsyncSession,
    *,
    actor: Optional[User],
    action: str,
    target_type: str,
    target_id: Any = None,
    details: Optional[Dict[str, Any]] = None,
) -> AuditLog:
    """
    Add an audit entry to `db` (flushed, NOT committed). `actor=None` records an automatic system action.
    """
    if not ACTION_PATTERN.match(action or "") or len(action) > 64:
        raise AuditError("action must look like 'area.verb' (lowercase letters, digits and underscores)")
    if not target_type or len(target_type) > 50:
        raise AuditError("target_type is required (at most 50 characters)")
    entry = AuditLog(
        actor_id=actor.id if actor else None,
        actor_role=actor.role if actor else "system",
        action=action,
        target_type=target_type,
        target_id=None if target_id is None else str(target_id)[:64],
        details=clean_details(details),
    )
    db.add(entry)
    await db.flush()
    return entry
