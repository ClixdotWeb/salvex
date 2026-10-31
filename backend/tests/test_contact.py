"""
Contact page messages: anyone can send one, admins are notified and handle it, spam is limited.
"""
from sqlalchemy import select

from app.models.audit_log import AuditLog
from app.models.contact import ContactMessage
from app.models.notification import Notification
from test_admin_foundation import load_user, make_admin
from test_users_admin import make_user

GOOD = {"name": "Asha Menon", "email": "Asha@Example.com", "mobile": "+91 98765 43210",
        "subject": "Payments", "message": "How do I pay for a vehicle I won?\nThanks."}


async def test_anyone_can_send_and_admins_are_notified(api):
    admin_email, admin = await make_admin(api)
    res = await api.client.post("/api/contact", json=GOOD)
    assert res.status_code == 201
    number = res.json()["number"]
    assert number.startswith("MSG-")
    async with api.db() as db:
        item = (await db.execute(select(ContactMessage).where(ContactMessage.number == number))).scalar_one()
        assert item.email == "asha@example.com" and item.status == "new"
        assert item.message == "How do I pay for a vehicle I won?\nThanks."        # line breaks kept
        admin_id = (await load_user(api, admin_email)).id
        note = (await db.execute(select(Notification).where(Notification.user_id == admin_id,
                                                            Notification.kind == "contact_new"))).scalar_one()
    assert number in note.body and note.link == f"/admin?tab=messages&status=new&open={item.id}"

    one = (await api.client.get(f"/api/admin/contact-messages/{item.id}", headers=admin))
    assert one.status_code == 200 and one.json()["number"] == number

    dash = (await api.client.get("/api/admin/dashboard", headers=admin)).json()
    assert dash["contact_messages_new"] >= 1


async def test_invalid_messages_are_refused(api):
    for change in ({"subject": "Free money"}, {"mobile": "abc"}, {"email": "not-an-email"}, {"message": "hi"},
                   {"name": "  "}, {"name": "<script>"}, {"role": "admin"}):
        res = await api.client.post("/api/contact", json={**GOOD, **change})
        assert res.status_code == 422, change


async def test_spam_trap_stores_nothing(api):
    async with api.db() as db:
        before = len((await db.execute(select(ContactMessage.id))).all())
    res = await api.client.post("/api/contact", json={**GOOD, "website": "http://spam.example"})
    assert res.status_code == 201
    async with api.db() as db:
        assert len((await db.execute(select(ContactMessage.id))).all()) == before


async def test_rate_limited_per_email(api, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
    codes = [(await api.client.post("/api/contact", json=GOOD)).status_code for _ in range(6)]
    assert codes[:5] == [201] * 5 and codes[5] == 429


async def test_only_admins_see_and_update_messages(api):
    _, admin = await make_admin(api)
    _, user, _ = await make_user(api)
    number = (await api.client.post("/api/contact", json=GOOD)).json()["number"]

    assert (await api.client.get("/api/admin/contact-messages")).status_code == 401
    assert (await api.client.get("/api/admin/contact-messages", headers=user)).status_code == 403
    page = (await api.client.get("/api/admin/contact-messages?status=new", headers=admin)).json()
    row = next(i for i in page["items"] if i["number"] == number)
    assert row["mobile"] == "+91 98765 43210"

    url = f"/api/admin/contact-messages/{row['id']}/update"
    assert (await api.client.post(url, headers=user, json={"status": "closed"})).status_code == 403
    assert (await api.client.post(url, headers=admin, json={})).status_code == 422
    assert (await api.client.post(url, headers=admin, json={"status": "done"})).status_code == 422
    res = await api.client.post(url, headers=admin, json={"status": "closed", "admin_note": "Called back"})
    assert res.status_code == 200 and res.json()["status"] == "closed" and res.json()["admin_note"] == "Called back"
    async with api.db() as db:
        audit = (await db.execute(select(AuditLog).where(AuditLog.action == "contact_message.update"))).scalars().all()
    assert any(a.details.get("number") == number for a in audit)
