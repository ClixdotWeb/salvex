"""The signed-in user's notifications (the bell)."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AuthContext, get_auth_context, require_csrf
from app.api.pagination import PaginationParams, paginate, pagination_params
from app.core.errors import ApiError
from app.core.rate_limit import enforce_rate_limit
from app.db.session import get_db
from app.models.notification import Notification
from app.schemas.common import Page

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])


class NotificationOut(BaseModel):
    id: uuid.UUID
    kind: str
    title: str
    body: str
    link: Optional[str]
    read_at: Optional[datetime]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UnreadCount(BaseModel):
    unread: int


@router.get("", response_model=Page[NotificationOut], summary="Your notifications, newest first")
async def list_notifications(request: Request, params: PaginationParams = Depends(pagination_params),
                             ctx: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    enforce_rate_limit("session", request)
    stmt = select(Notification).where(Notification.user_id == ctx.user.id).order_by(Notification.created_at.desc(), Notification.id)
    return await paginate(db, stmt, params, NotificationOut)


@router.get("/unread-count", response_model=UnreadCount, summary="How many unread notifications you have")
async def unread_count(request: Request, ctx: AuthContext = Depends(get_auth_context), db: AsyncSession = Depends(get_db)):
    enforce_rate_limit("session", request)
    n = (await db.execute(select(func.count()).select_from(Notification)
                          .where(Notification.user_id == ctx.user.id, Notification.read_at.is_(None)))).scalar_one()
    return UnreadCount(unread=n)


@router.post("/{notification_id}/read", response_model=NotificationOut, summary="Mark one notification read")
async def mark_read(notification_id: uuid.UUID, ctx: AuthContext = Depends(require_csrf), db: AsyncSession = Depends(get_db)):
    note = (await db.execute(select(Notification).where(Notification.id == notification_id))).scalar_one_or_none()
    if note is None or note.user_id != ctx.user.id:
        raise ApiError(404, "Notification not found.", "notification_not_found")
    if note.read_at is None:
        note.read_at = datetime.now(timezone.utc)
        await db.commit()
    return NotificationOut.model_validate(note)


@router.post("/read-all", response_model=UnreadCount, summary="Mark all your notifications read")
async def mark_all_read(ctx: AuthContext = Depends(require_csrf), db: AsyncSession = Depends(get_db)):
    await db.execute(update(Notification).where(Notification.user_id == ctx.user.id, Notification.read_at.is_(None))
                     .values(read_at=datetime.now(timezone.utc)))
    await db.commit()
    return UnreadCount(unread=0)
