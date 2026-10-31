"""
Module 6 acceptance: many simultaneous bids stay consistent.

These tests use SEPARATE database connections that really commit (row locks can only be proven that way),
on the isolated local test database only. Everything created here uses the @salvex-race.in domain and is
deleted afterwards. Bids are append-only, so the clean-up switches the append-only trigger off, deletes
ONLY this test's bids and switches it back on - all inside one transaction on the test database. The
application and the migrations are not changed by this. Users, the vehicle and the auction are created
directly (no audit rows), so they can be deleted too.
"""
import asyncio
import random
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.rate_limit import limiter
from app.core.security import hash_password
from app.db.session import get_db
from app.main import app
from app.models.auction import Auction
from app.models.auction_bid import AuctionBid
from app.models.user import User
from app.models.vehicle import Vehicle
from helpers import CapturingEmailService, PASSWORD, login
from safe_db import safe_test_url
from test_concurrency import DOMAIN, race_email
from test_vehicles import random_registration, vehicle_body

ROUNDS = 3
BIDDERS = 10
BIDS_PER_BIDDER = 5          # 50 simultaneous bids per round

PURGE = [
    "ALTER TABLE auction_bids DISABLE TRIGGER auction_bids_no_update_delete",
    "DELETE FROM auction_bids WHERE bidder_id IN (SELECT id FROM users WHERE email LIKE :p)",
    "ALTER TABLE auction_bids ENABLE TRIGGER auction_bids_no_update_delete",
    "DELETE FROM orders WHERE vehicle_id IN (SELECT v.id FROM vehicles v JOIN users u ON u.id = v.owner_id WHERE u.email LIKE :p)",
    "DELETE FROM auctions WHERE vehicle_id IN (SELECT v.id FROM vehicles v JOIN users u ON u.id = v.owner_id WHERE u.email LIKE :p)",
    "DELETE FROM vehicles WHERE owner_id IN (SELECT id FROM users WHERE email LIKE :p)",
    "DELETE FROM users WHERE email LIKE :p",
]


@pytest.fixture
async def bid_race(monkeypatch):
    engine = create_async_engine(safe_test_url(), pool_size=20, max_overflow=0)   # local test database only
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with maker() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    async def purge():
        async with engine.begin() as conn:            # one transaction: the trigger is never left switched off
            for sql in PURGE:
                await conn.execute(text(sql), {"p": f"%{DOMAIN}"})

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr("app.api.auth.get_email_service", lambda: CapturingEmailService())
    await purge()
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client, maker
    finally:
        app.dependency_overrides.pop(get_db, None)
        await purge()
        await engine.dispose()


async def _users(maker, role: str, count: int, kyc: str = "verified") -> list[User]:
    password_hash = hash_password(PASSWORD)
    users = [User(name="Race User", email=race_email(role), password_hash=password_hash, role=role,
                  is_email_verified=True, kyc_status=kyc) for _ in range(count)]
    async with maker() as db:
        db.add_all(users)
        await db.commit()
    return users


async def _live_auction(maker, seller: User, admin: User, starting_price: str = "50000") -> Auction:
    now = datetime.now(timezone.utc)
    fields = vehicle_body(registration_number=random_registration())
    async with maker() as db:
        vehicle = Vehicle(owner_id=seller.id, status="approved", **fields)
        db.add(vehicle)
        await db.flush()
        auction = Auction(vehicle_id=vehicle.id, status="scheduled", starting_price=Decimal(starting_price),
                          starts_at=now - timedelta(minutes=1), ends_at=now + timedelta(minutes=30),
                          scheduled_ends_at=now + timedelta(minutes=30), created_by_id=admin.id)
        db.add(auction)
        await db.commit()
    return auction


async def _tokens(client, users) -> list[dict]:
    headers = []
    for user in users:
        res = await login(client, user.email, PASSWORD, bearer=True)
        assert res.status_code == 200, res.text
        headers.append({"Authorization": f"Bearer {res.json()['access_token']}"})
    client.cookies.clear()
    return headers


async def test_fifty_simultaneous_bids_stay_consistent(bid_race):
    client, maker = bid_race
    seller, = await _users(maker, "seller", 1, kyc="pending")
    admin, = await _users(maker, "admin", 1, kyc="pending")
    bidders = await _users(maker, "bidder", BIDDERS)
    headers = await _tokens(client, bidders)

    for _ in range(ROUNDS):
        limiter.reset()          # this test is about locking; the rate limiter has its own tests
        auction = await _live_auction(maker, seller, admin)
        amounts = random.sample(range(50_000, 150_000), BIDDERS * BIDS_PER_BIDDER)
        requests = [(i % BIDDERS, Decimal(a)) for i, a in enumerate(amounts)]
        results = await asyncio.gather(*[
            client.post(f"/api/auctions/{auction.id}/bids", headers=headers[who], json={"amount": str(amount), "terms_accepted": True})
            for who, amount in requests
        ], return_exceptions=True)

        crashed = [r for r in results if isinstance(r, BaseException)]
        assert not crashed, f"a request raised instead of answering: {crashed[:3]!r}"
        codes = [r.status_code for r in results]
        assert set(codes) <= {201, 409}, sorted(set(codes))
        assert all(r.json()["code"] in ("bid_too_low", "already_highest") for r in results if r.status_code == 409)

        async with maker() as db:
            stored = (await db.execute(select(Auction).where(Auction.id == auction.id))).scalar_one()
            bids = (await db.execute(select(AuctionBid).where(AuctionBid.auction_id == auction.id)
                                     .order_by(AuctionBid.created_at, AuctionBid.amount))).scalars().all()

        assert len(bids) == codes.count(201) == stored.bid_count >= 1
        ordered = [b.amount for b in bids]
        assert ordered == sorted(ordered) and len(set(ordered)) == len(ordered)       # strictly increasing
        assert stored.current_price == bids[-1].amount == max(ordered)
        assert stored.current_winner_id == bids[-1].bidder_id
        assert all(a.bidder_id != b.bidder_id for a, b in zip(bids, bids[1:]))      # nobody outbid themselves
        assert bids[0].amount >= stored.starting_price
        accepted = sorted(Decimal(r.json()["amount"]) for r in results if r.status_code == 201)
        assert accepted == ordered                                                   # every 201 is a stored bid


async def test_the_same_click_sent_many_times_at_once_is_one_bid(bid_race):
    client, maker = bid_race
    seller, = await _users(maker, "seller", 1, kyc="pending")
    admin, = await _users(maker, "admin", 1, kyc="pending")
    bidder, = await _users(maker, "bidder", 1)
    headers, = await _tokens(client, [bidder])
    auction = await _live_auction(maker, seller, admin)

    results = await asyncio.gather(*[
        client.post(f"/api/auctions/{auction.id}/bids", json={"amount": "60000", "terms_accepted": True},
                    headers={**headers, "Idempotency-Key": "double-click-0001"})
        for _ in range(15)
    ], return_exceptions=True)
    assert not [r for r in results if isinstance(r, BaseException)]
    codes = sorted(r.status_code for r in results)
    assert codes.count(201) == 1 and codes.count(200) == 14, codes
    assert len({r.json()["bid_id"] for r in results}) == 1
    async with maker() as db:
        count = len((await db.execute(select(AuctionBid).where(AuctionBid.auction_id == auction.id))).all())
        stored = (await db.execute(select(Auction).where(Auction.id == auction.id))).scalar_one()
    assert count == 1 and stored.bid_count == 1
