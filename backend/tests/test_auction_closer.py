"""
Module 7: automatic closing of auctions whose end time has passed - result (sold / no_sale), system audit
entry, never twice, never a paused or still-running auction, and two closers running at the same moment.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.auction import Auction
from app.services.auction_closer import AuctionCloser, close_due_auctions, closer_enabled
from test_auctions import action, shift
from test_bidding import bid, live_auction, verified_bidder
from test_bidding_concurrency import _live_auction, _users, bid_race  # noqa: F401  (fixture)
from test_kyc import storage  # noqa: F401  (fixture)


async def _noop():
    return None


async def stored(api, auction_id) -> Auction:
    async with api.db() as db:
        auction = await db.get(Auction, uuid.UUID(auction_id))
        await db.refresh(auction)
        return auction


async def test_due_auctions_are_closed_with_the_right_result_and_nothing_else_is_touched(api, storage):
    admin, _, _, sold = await live_auction(api)
    headers, bidder_id = await verified_bidder(api)
    await bid(api, headers, sold, "70000")
    _, _, _, unsold = await live_auction(api)
    _, _, _, paused = await live_auction(api)
    _, _, _, running = await live_auction(api)
    await action(api, admin, paused, "pause", reason="Checking")
    for aid in (sold, unsold, paused):
        await shift(api, aid, starts_at=-60, ends_at=-1)

    assert await close_due_auctions(api.db) == 2
    first, second = await stored(api, sold), await stored(api, unsold)
    assert (first.status, first.result, first.current_winner_id) == ("closed", "sold", bidder_id)
    assert str(first.current_price) == "70000.00" and first.closed_at is not None
    assert (second.status, second.result) == ("closed", "no_sale")
    assert (await stored(api, paused)).status == "paused"                   # paused auctions are left alone
    assert (await stored(api, running)).status == "scheduled"               # not ended yet

    async with api.db() as db:
        entry = (await db.execute(select(AuditLog).where(AuditLog.action == "auction.close",
                                                         AuditLog.target_id == sold))).scalar_one()
    assert entry.actor_id is None and entry.actor_role == "system"
    assert entry.details["reason"] == "End time reached" and entry.details["winner_id"] == str(bidder_id)

    public = (await api.client.get(f"/api/auctions/{sold}")).json()
    assert public["phase"] == "ended" and public["result"] == "sold"
    won = (await api.client.get("/api/bids/mine", headers=headers)).json()["items"][0]
    assert won["you_won"] is True
    # the winner now has an unpaid order, so they cannot bid anywhere until they pay
    blocked = await bid(api, headers, unsold, "90000")
    assert blocked.status_code == 403 and blocked.json()["code"] == "payment_due"
    other, _ = await verified_bidder(api)
    late = await bid(api, other, unsold, "90000")
    assert late.status_code == 409 and late.json()["code"] == "auction_not_live"


async def test_running_the_closer_again_changes_nothing(api, storage):
    _, _, _, aid = await live_auction(api)
    await shift(api, aid, starts_at=-60, ends_at=-1)
    assert await close_due_auctions(api.db) == 1
    assert await close_due_auctions(api.db) == 0
    async with api.db() as db:
        closes = (await db.execute(select(AuditLog).where(AuditLog.action == "auction.close",
                                                          AuditLog.target_id == aid))).scalars().all()
    assert len(closes) == 1


async def test_a_late_bid_extension_keeps_the_auction_open(api, storage):
    _, _, _, aid = await live_auction(api, extension_enabled=True, extension_minutes=2)
    headers, _ = await verified_bidder(api)
    await shift(api, aid, ends_at=0.05)                                     # 3 seconds left
    assert (await bid(api, headers, aid, "60000")).json()["time_extended"] is True
    assert await close_due_auctions(api.db, now=datetime.now(timezone.utc) + timedelta(seconds=10)) == 0
    assert (await stored(api, aid)).status == "scheduled"


async def test_the_background_loop_closes_auctions_and_stops_cleanly(api, storage):
    assert closer_enabled() is False                                        # never runs on its own in tests
    _, _, _, aid = await live_auction(api)
    await shift(api, aid, starts_at=-60, ends_at=-1)
    closer = AuctionCloser(api.db, interval_seconds=1)
    closer.start()
    try:
        for _ in range(50):
            if (await stored(api, aid)).status == "closed":
                break
            await asyncio.sleep(0.1)
    finally:
        await closer.stop()
    assert (await stored(api, aid)).status == "closed"


async def test_two_closers_at_the_same_moment_close_each_auction_once(bid_race, monkeypatch):
    """Real separate connections (see test_bidding_concurrency.py for the clean-up rules)."""
    client, maker = bid_race
    closes = []

    async def record(db, **kwargs):          # audit rows are append-only; count them here instead
        closes.append(kwargs["target_id"])

    monkeypatch.setattr("app.services.auctions.record_audit", record)
    monkeypatch.setattr("app.services.orders.record_audit", lambda *a, **k: _noop())   # order audit rows are append-only too
    seller, = await _users(maker, "seller", 1, kyc="pending")
    admin, = await _users(maker, "admin", 1, kyc="pending")
    winner, = await _users(maker, "bidder", 1)
    ids = []
    for n in range(20):
        auction = await _live_auction(maker, seller, admin)
        async with maker() as db:
            row = await db.get(Auction, auction.id)
            row.starts_at = datetime.now(timezone.utc) - timedelta(hours=1)
            row.ends_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            if n % 2 == 0:
                row.current_price, row.current_winner_id, row.bid_count = Decimal("60000.00"), winner.id, 1
            await db.commit()
        ids.append(auction.id)

    counts = await asyncio.gather(*[close_due_auctions(maker) for _ in range(4)])
    assert sum(counts) == 20, counts
    assert sorted(map(str, closes)) == sorted(map(str, ids))                 # one close entry per auction
    async with maker() as db:
        rows = (await db.execute(select(Auction).where(Auction.id.in_(ids)))).scalars().all()
    assert all(r.status == "closed" for r in rows)
    assert sum(r.result == "sold" for r in rows) == 10 and sum(r.result == "no_sale" for r in rows) == 10
