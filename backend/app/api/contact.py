"""
Public Contact page.
  POST /api/contact  - anyone can send a message (rate limited per network). Admins get a bell notification
                       and handle it in the admin panel (/api/admin/contact-messages).
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import enforce_rate_limit
from app.db.session import get_db
from app.models.contact import ContactMessage
from app.schemas.contact import ContactAccepted, ContactCreate
from app.services.notifications import notify_admins

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/contact", tags=["Contact"])


@router.post("", response_model=ContactAccepted, status_code=status.HTTP_201_CREATED,
             summary="Send a message to the Salvex team")
async def send_message(body: ContactCreate, request: Request, db: AsyncSession = Depends(get_db)):
    enforce_rate_limit("contact", request, str(body.email))
    if body.website:
        # Filled-in spam trap: answer like a success so bots learn nothing, but store nothing.
        logger.info("contact message dropped by spam trap")
        return ContactAccepted(number="MSG-0")
    n = (await db.execute(text("SELECT nextval('contact_message_number_seq')"))).scalar_one()
    item = ContactMessage(number=f"MSG-{datetime.now(timezone.utc).year}-{n:06d}", name=body.name,
                          email=str(body.email).lower(), mobile=body.mobile, subject=body.subject,
                          message=body.message, status="new")
    db.add(item)
    await db.flush()
    await notify_admins(db, "contact_new", "New contact message",
                        f"{item.number}: {item.subject} from {item.name}.", f"/admin?tab=messages&status=new&open={item.id}")
    await db.commit()
    return ContactAccepted(number=item.number)
