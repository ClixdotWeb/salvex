"""
Automatic auction closing (Module 7).

A small loop inside the backend wakes every AUCTION_CLOSER_INTERVAL_SECONDS and closes every auction whose
end time has passed. Each auction is closed in its OWN transaction:
  * the row is locked with FOR UPDATE SKIP LOCKED, so if two backend processes run the loop at the same
    time, each auction is picked up by only one of them;
  * the status and end time are re-checked under the lock, so an auction is never closed twice and a
    late bid that extended the end time is respected;
  * `finish_auction` decides the result (sold to the highest bidder, or no_sale) and writes the audit entry
    as a SYSTEM action (no actor).
Order creation and notifications hook in here in Modules 8 and 12.
"""
import asyncio
import logging
from datetime import datetime
from typing import Callable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.auction import Auction
from app.services.auctions import finish_auction, now_utc
from app.services.notifications import send_pending_emails
from app.services.orders import default_overdue_orders, send_payment_reminders
from app.services.reports import send_monthly_report_notice

logger = logging.getLogger("salvex.auction_closer")

SessionFactory = Callable[[], AsyncSession]


async def close_due_auctions(session_factory: SessionFactory, now: Optional[datetime] = None, limit: int = 100) -> int:
    """Close every open auction whose end time has passed. Returns how many this call closed."""
    now = now or now_utc()
    async with session_factory() as db:
        due = (await db.execute(
            select(Auction.id).where(Auction.status == "scheduled", Auction.ends_at <= now)
            .order_by(Auction.ends_at).limit(limit)
        )).scalars().all()

    closed = 0
    for auction_id in due:
        async with session_factory() as db:
            auction = (await db.execute(
                select(Auction).where(Auction.id == auction_id).with_for_update(skip_locked=True)
                .execution_options(populate_existing=True)
            )).scalar_one_or_none()
            # Locked by another closer (or a bid in progress), already closed, paused, or extended: skip.
            if auction is None or auction.status != "scheduled" or auction.ends_at > now_utc():
                await db.rollback()
                continue
            await finish_auction(db, auction, None, "End time reached")
            await db.commit()
            closed += 1
    return closed


class AuctionCloser:
    """Runs `close_due_auctions` in the background for the life of the application."""

    def __init__(self, session_factory: SessionFactory, interval_seconds: float) -> None:
        self._factory = session_factory
        self._interval = interval_seconds
        self._task: Optional[asyncio.Task] = None
        self._stopping = asyncio.Event()

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="auction-closer")

    async def stop(self) -> None:
        if self._task is not None:
            self._stopping.set()
            await self._task
            self._task = None

    async def _run(self) -> None:
        logger.info("Auction closer started (every %ss).", self._interval)
        while not self._stopping.is_set():
            try:
                count = await close_due_auctions(self._factory)
                if count:
                    logger.info("Closed %d auction(s).", count)
                defaulted = await default_overdue_orders(self._factory)
                if defaulted:
                    logger.info("Marked %d unpaid order(s) as defaulted.", defaulted)
                reminded = await send_payment_reminders(self._factory)
                if reminded:
                    logger.info("Sent %d payment reminder(s).", reminded)
                await send_monthly_report_notice(self._factory)
                await send_pending_emails(self._factory)          # notification email outbox
            except Exception:                          # keep running; the next pass retries
                logger.exception("Auction closer pass failed")
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=self._interval)
            except asyncio.TimeoutError:
                pass


def closer_enabled() -> bool:
    return settings.AUCTION_CLOSER_ENABLED and settings.APP_ENV != "test"
