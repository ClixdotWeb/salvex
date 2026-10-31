"""Admin auction list split into Upcoming / Live / Ended (the admin's simple Auctions screen)."""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import update

from app.models.auction import Auction
from test_admin_foundation import make_admin
from test_auctions import action, at, new_auction
from test_kyc import storage  # noqa: F401  (fixture)
from test_vehicles import approved_vehicle


async def test_auctions_by_view(api, storage):
    _, admin = await make_admin(api)
    ids = {}
    for name, start, end in (("upcoming", 60, 120), ("live", -5, 60), ("ended", -5, 60)):
        vid = await approved_vehicle(api, admin, admin)
        res = await new_auction(api, admin, vid, starts_at=at(start if start > 0 else 1), ends_at=at(end))
        assert res.status_code == 201, res.text
        ids[name] = res.json()["id"]
    assert (await action(api, admin, ids["ended"], "cancel", reason="Withdrawn by insurer")).status_code == 200
    async with api.db() as db:                         # the "live" one has started
        await db.execute(update(Auction).where(Auction.id == uuid.UUID(ids["live"]))
                         .values(starts_at=datetime.now(timezone.utc) - timedelta(minutes=5)))
        await db.commit()

    def found(view):
        return api.client.get(f"/api/admin/auctions?view={view}&page_size=100", headers=admin)
    upcoming = {a["id"] for a in (await found("upcoming")).json()["items"]}
    live = {a["id"] for a in (await found("live")).json()["items"]}
    ended = {a["id"] for a in (await found("ended")).json()["items"]}
    assert ids["upcoming"] in upcoming and ids["upcoming"] not in live | ended
    assert ids["live"] in live and ids["live"] not in upcoming | ended
    assert ids["ended"] in ended and ids["ended"] not in upcoming | live
    assert (await found("other")).status_code == 422
