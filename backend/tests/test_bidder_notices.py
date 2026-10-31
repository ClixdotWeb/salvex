"""
Bidders are told when an auction they bid on is paused, resumed, extended, cancelled or won by someone else.
"""
from sqlalchemy import select

from app.models.notification import Notification
from test_auctions import action
from test_bidding import bid, live_auction, verified_bidder
from test_kyc import storage  # noqa: F401  (fixture)


async def notes(api, user_id, kind):
    async with api.db() as db:
        return (await db.execute(select(Notification).where(Notification.user_id == user_id, Notification.kind == kind))).scalars().all()


async def test_pause_resume_extend_and_result_reach_every_bidder_once(api, storage):
    admin, _, _, aid = await live_auction(api)
    first, first_id = await verified_bidder(api)
    second, second_id = await verified_bidder(api)
    outsider, outsider_id = await verified_bidder(api)
    await bid(api, first, aid, "60000")
    await bid(api, second, aid, "61000")
    await bid(api, first, aid, "62000")                                        # first bid twice: still one message each

    assert (await action(api, admin, aid, "pause", reason="Checking documents")).status_code == 200
    for uid in (first_id, second_id):
        [n] = await notes(api, uid, "auction_paused")
        assert n.title.startswith("Auction paused: ") and n.link == f"/auctions/{aid}"
        assert "Checking documents" not in n.body                              # the admin's reason stays internal
    assert await notes(api, outsider_id, "auction_paused") == []

    assert (await action(api, admin, aid, "resume")).status_code == 200
    assert len(await notes(api, second_id, "auction_resumed")) == 1
    assert (await action(api, admin, aid, "extend", minutes=10, reason="More interest")).status_code == 200
    [ext] = await notes(api, first_id, "auction_extended")
    assert "now ends" in ext.body

    assert (await action(api, admin, aid, "close", reason="Ended")).status_code == 200
    [won] = await notes(api, first_id, "auction_won")
    assert "62000" in won.body and "please pay by" in won.body
    assert await notes(api, first_id, "auction_lost") == []                   # the winner is not told they lost
    [lost] = await notes(api, second_id, "auction_lost")
    assert "62000" in lost.body and lost.link == f"/auctions/{aid}"


async def test_cancel_reaches_bidders(api, storage):
    admin, _, _, aid = await live_auction(api)
    bidder, bidder_id = await verified_bidder(api)
    await bid(api, bidder, aid, "60000")
    assert (await action(api, admin, aid, "cancel", reason="Owner withdrew")).status_code == 200
    [n] = await notes(api, bidder_id, "auction_cancelled")
    assert n.title.startswith("Auction cancelled: ") and "nothing is owed" in n.body
