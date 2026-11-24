"""
Email first, mobile before bidding:

  - Sign-up is ALWAYS finished with the code sent to the email address (so every account has a proven
    email), whatever MOBILE_OTP_REQUIRED says. No SMS is sent at sign-up.
  - MOBILE_OTP_REQUIRED=true means bidding needs a mobile number confirmed with an SMS code. The buyer
    confirms it from the dashboard (signed in). With the switch off, the mobile is not needed to bid.
  - Production refuses the developer SMS outbox while the switch is on.
"""
import uuid

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.user import User
from helpers import PASSWORD, new_email, register, register_and_verify, wrong_code
from test_bidding import verify_kyc
from test_users_admin import make_user

MOBILE = "+91 98765 43210"


@pytest.fixture
def sms_on(monkeypatch):
    monkeypatch.setattr(settings, "MOBILE_OTP_REQUIRED", True)


async def user_row(api, email: str) -> User:
    async with api.db() as db:
        return (await db.execute(select(User).where(User.email == email))).scalar_one()


async def signed_in(api, email: str) -> dict:
    """Register + email code, then a bearer sign-in. Returns the headers."""
    await register_and_verify(api, email, mobile=MOBILE)
    login = await api.client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD},
                                  headers={"X-Auth-Mode": "bearer"})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def bid(api, headers):
    return await api.client.post(f"/api/auctions/{uuid.uuid4()}/bids", headers=headers,
                                 json={"amount": 1000, "terms_accepted": True})


# ---------------------------------------------------------------------------- sign-up (always email)
@pytest.mark.parametrize("switch", [False, True])
async def test_sign_up_sends_only_an_email_code_whatever_the_switch(api, monkeypatch, switch):
    monkeypatch.setattr(settings, "MOBILE_OTP_REQUIRED", switch)
    email = new_email("signup")
    res = await register(api.client, email, mobile=MOBILE)
    assert res.status_code == 201 and "sent to it" in res.json()["message"]
    assert api.sms.sent == []                                   # never an SMS at sign-up
    assert api.mail.of_type("verification", email)
    row = await user_row(api, email)
    assert not row.is_email_verified and not row.is_mobile_verified and row.mobile == MOBILE


async def test_sign_in_is_refused_until_the_email_code_is_entered(api, sms_on):
    email = new_email("unverified")
    await register(api.client, email, mobile=MOBILE)
    res = await api.client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD})
    assert res.status_code == 403 and res.json()["code"] == "email_not_verified"
    assert "email" in res.json()["detail"].lower()             # the message matches the code (audit F-2)


async def test_the_email_code_finishes_sign_up_and_signs_in(api, sms_on):
    email = new_email("finish")
    await register(api.client, email, mobile=MOBILE)
    res = await api.client.post("/api/auth/verify-email", json={"email": email, "otp": api.mail.last_otp("verification", email)})
    assert res.status_code == 200 and res.json()["user"]["is_email_verified"] is True
    row = await user_row(api, email)
    assert row.is_email_verified and not row.is_mobile_verified   # the mobile is confirmed later


async def test_the_old_sms_sign_up_route_is_gone(api, sms_on):
    res = await api.client.post("/api/auth/verify-mobile", json={"email": new_email("old"), "otp": "123456"})
    assert res.status_code in (404, 405)


async def test_asking_for_an_sms_code_while_signed_out_sends_nothing(api, sms_on):
    email = new_email("resend")
    await register(api.client, email, mobile=MOBILE)
    res = await api.client.post("/api/auth/resend-otp", json={"email": email, "purpose": "mobile_verification"})
    assert res.status_code == 200 and api.sms.sent == []      # same neutral answer, no SMS


async def test_someone_elses_email_cannot_be_taken_with_your_own_mobile(api, sms_on):
    """Audit F-1: an account only exists once the code sent to the email address is entered."""
    victim = new_email("victim")
    await register(api.client, victim, mobile="+91 90000 99999")   # attacker's number
    assert api.sms.sent == []
    login = await api.client.post("/api/auth/login", json={"identifier": victim, "password": PASSWORD})
    assert login.status_code == 403
    assert (await user_row(api, victim)).is_email_verified is False


async def test_registering_again_before_finishing_replaces_the_details(api, sms_on):
    email = new_email("again")
    await register(api.client, email, name="First")
    await register(api.client, email, name="Second", mobile="+91 90000 33333")
    row = await user_row(api, email)
    assert row.name == "Second" and row.mobile == "+91 90000 33333"
    async with api.db() as db:
        assert len((await db.execute(select(User).where(User.email == email))).scalars().all()) == 1


async def test_a_finished_account_is_never_overwritten_by_a_new_registration(api, sms_on):
    email = new_email("done")
    await register_and_verify(api, email, name="Owner")
    res = await register(api.client, email, name="Intruder", password="Another-Long-Pass-77")
    assert res.status_code == 201                               # same answer as a new address
    assert (await user_row(api, email)).name == "Owner"
    assert api.mail.of_type("exists", email)


# ---------------------------------------------------------------------------- mobile before bidding
async def test_with_the_switch_on_bidding_needs_the_mobile_confirmed_from_the_dashboard(api, sms_on):
    email = new_email("bidder")
    headers = await signed_in(api, email)
    await verify_kyc(api, (await user_row(api, email)).id)

    res = await bid(api, headers)
    assert res.status_code == 403 and res.json()["code"] == "mobile_not_verified"

    assert (await api.client.post("/api/auth/mobile/send-code", headers=headers, json={})).status_code == 200
    code = api.sms.last_otp(MOBILE)
    bad = await api.client.post("/api/auth/mobile/verify", headers=headers, json={"otp": wrong_code(code)})
    assert bad.status_code == 400 and bad.json()["code"] == "invalid_mobile_code"
    ok = await api.client.post("/api/auth/mobile/verify", headers=headers, json={"otp": code})
    assert ok.status_code == 200 and ok.json()["is_mobile_verified"] is True
    assert (await bid(api, headers)).json().get("code") not in ("mobile_not_verified", "email_not_verified")


async def test_with_the_switch_off_bidding_needs_only_email_and_kyc(api):
    assert settings.MOBILE_OTP_REQUIRED is False                # the default
    email = new_email("nosms")
    headers = await signed_in(api, email)
    await verify_kyc(api, (await user_row(api, email)).id)
    assert (await bid(api, headers)).json().get("code") not in ("mobile_not_verified", "email_not_verified")
    off = await api.client.post("/api/auth/mobile/send-code", headers=headers, json={})
    assert off.status_code == 409 and off.json()["code"] == "mobile_otp_off"
    assert api.sms.sent == []


async def test_a_new_number_replaces_the_old_one_and_must_be_confirmed(api, monkeypatch):
    email, headers, _ = await make_user(api, "bidder")
    monkeypatch.setattr(settings, "MOBILE_OTP_REQUIRED", True)
    res = await api.client.post("/api/auth/mobile/send-code", headers=headers, json={"mobile": "+91 99999 11111"})
    assert res.status_code == 200 and api.sms.sent[-1]["to"] == "+91 99999 11111"
    row = await user_row(api, email)
    assert row.mobile == "+91 99999 11111" and not row.is_mobile_verified

    again = await api.client.post("/api/auth/mobile/send-code", headers=headers, json={})
    assert again.status_code == 429 and again.json()["code"] == "code_cooldown"
    bad_number = await api.client.post("/api/auth/mobile/send-code", headers=headers, json={"mobile": "12"})
    assert bad_number.status_code == 422


async def test_a_verified_mobile_cannot_ask_for_another_code(api, sms_on):
    headers = await signed_in(api, new_email("verified"))
    await api.client.post("/api/auth/mobile/send-code", headers=headers, json={})
    await api.client.post("/api/auth/mobile/verify", headers=headers, json={"otp": api.sms.last_otp(MOBILE)})
    res = await api.client.post("/api/auth/mobile/send-code", headers=headers, json={})
    assert res.status_code == 409 and res.json()["code"] == "mobile_already_verified"


async def test_changing_the_number_in_the_profile_needs_a_new_sms_code(api, sms_on):
    headers = await signed_in(api, new_email("profile"))
    await api.client.post("/api/auth/mobile/send-code", headers=headers, json={})
    await api.client.post("/api/auth/mobile/verify", headers=headers, json={"otp": api.sms.last_otp(MOBILE)})
    same = await api.client.patch("/api/users/me", headers=headers, json={"name": "New Name"})
    assert same.status_code == 200 and same.json()["is_mobile_verified"] is True
    changed = await api.client.patch("/api/users/me", headers=headers, json={"mobile": "+91 90000 22222"})
    assert changed.status_code == 200 and changed.json()["is_mobile_verified"] is False


async def test_signed_in_routes_need_a_signed_in_user(api, sms_on):
    for path, body in (("/api/auth/mobile/send-code", {}), ("/api/auth/mobile/verify", {"otp": "123456"}),
                       ("/api/auth/email/send-code", None), ("/api/auth/email/verify", {"otp": "123456"})):
        assert (await api.client.post(path, json=body)).status_code == 401, path


async def test_the_site_config_tells_the_website_whether_the_mobile_is_needed(api, monkeypatch):
    assert (await api.client.get("/api/site-config")).json()["mobile_otp"] is False
    monkeypatch.setattr(settings, "MOBILE_OTP_REQUIRED", True)
    assert (await api.client.get("/api/site-config")).json()["mobile_otp"] is True


# ---------------------------------------------------------------------------- production
def test_production_refuses_the_developer_sms_outbox_while_sms_codes_are_required(monkeypatch):
    from test_production_safeguards import make_settings  # complete, valid production settings

    with pytest.raises(ValueError, match="MOBILE_OTP_REQUIRED"):
        make_settings(monkeypatch, MOBILE_OTP_REQUIRED="true")
    assert make_settings(monkeypatch, MOBILE_OTP_REQUIRED="false").MOBILE_OTP_REQUIRED is False


def test_mobile_verification_is_off_by_default(monkeypatch):
    from test_production_safeguards import make_settings

    assert make_settings(monkeypatch, MOBILE_OTP_REQUIRED=None).MOBILE_OTP_REQUIRED is False
