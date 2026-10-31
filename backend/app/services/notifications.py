"""
Notifications: written in the caller's transaction (never committed here), so a notification exists exactly
when the event it reports was saved. Emails are sent later by the background loop from the outbox
(`send_pending_emails`), with up to MAX_ATTEMPTS tries.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification
from app.models.user import User

logger = logging.getLogger("salvex.notifications")
MAX_ATTEMPTS = 3


async def notify(db: AsyncSession, user_id: uuid.UUID, kind: str, title: str, body: str,
                 link: Optional[str] = None, email: bool = True) -> Notification:
    note = Notification(user_id=user_id, kind=kind, title=title[:200], body=body[:1000], link=link,
                        email_status="pending" if email else "skipped", email_attempts=0)
    db.add(note)
    await db.flush()
    return note


async def notify_admins(db: AsyncSession, kind: str, title: str, body: str, link: Optional[str] = None,
                        email: bool = False) -> int:
    """Bell notification for every active administrator (email off by default: admins see the dashboard)."""
    admins = (await db.execute(select(User.id).where(User.role == "admin", User.is_active.is_(True)))).scalars().all()
    for admin_id in admins:
        await notify(db, admin_id, kind, title, body, link, email=email)
    return len(admins)


async def send_pending_emails(session_factory, email_service=None, limit: int = 20) -> int:
    """Send emails for pending notifications. Each one is claimed with SKIP LOCKED, so two workers never send twice."""
    if email_service is None:
        from app.services.email import get_email_service
        email_service = get_email_service()
    sent = 0
    async with session_factory() as db:
        ids = (await db.execute(
            select(Notification.id).where(Notification.email_status == "pending").order_by(Notification.created_at).limit(limit)
        )).scalars().all()
    for note_id in ids:
        async with session_factory() as db:
            row = (await db.execute(
                select(Notification, User.email, User.name, User.is_active).join(User, User.id == Notification.user_id)
                .where(Notification.id == note_id).with_for_update(of=Notification, skip_locked=True)
            )).first()
            if row is None or row[0].email_status != "pending":
                await db.rollback()
                continue
            note, address, name, active = row
            if not active:
                note.email_status = "skipped"
            else:
                try:
                    ok, _ = await email_service.send_notification(address, name, note.title, note.body, note.link)
                except Exception:                     # a delivery failure must not stop the others
                    logger.exception("Notification email could not be sent")
                    ok = False
                note.email_attempts += 1
                if ok:
                    note.email_status, note.emailed_at = "sent", datetime.now(timezone.utc)
                    sent += 1
                elif note.email_attempts >= MAX_ATTEMPTS:
                    note.email_status = "failed"
            await db.commit()
    return sent
