"""
Sign-up with the mobile number first (MOBILE_OTP_REQUIRED):

  - Registration sends ONE code, by SMS. Entering it creates the account and signs the buyer in.
  - The email address is confirmed afterwards from the dashboard (or by any password reset).
  - Bidding needs approved KYC, a verified mobile AND a verified email.
  - Accounts made before SMS codes (or with the switch off) sign in as before and confirm the mobile
    from their dashboard before they can bid.
"""
import uuid

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.user import AuthToken, User
from helpers import NEW_PASSWORD, PASSWORD, new_email, register, wrong_code
from test_bidding import verify_kyc
from test_users_admin import make_user

MOBILE = "+91 98765 43210"


@pytest.fixture
def sms_on(monkeypatch):
    monkeypatch.setattr(settings, "MOBILE_OTP_REQUIRED", True)


async def user_row(api, email: str) -> User:
    async with api.db() as db:
        return (await db.execute(select(User).where(User.email == email))).scalar_one()


async def verify_sms(api, email: str, otp: str):
    return await api.client.post("/api/auth/verify-mobile", json={"email": email, "otp": otp})


async def past_cooldown(api, email: str) -> None:
    async with api.db() as db:
        rows = (await db.execute(select(AuthToken).join(User).where(User.email == email))).scalars().all()
        for token in rows:
            token.created_at = token.created_at.replace(year=token.created_at.year - 1)
        await db.commit()


async def signed_up(api, email: str) -> dict:
    """Register + SMS code. Returns bearer headers for the new buyer."""
    await register(api.client, email, mobile=MOBILE)
    res = await verify_sms(api, email, api.sms.last_otp(MOBILE))
    assert res.status_code == 200, res.text
    api.client.cookies.clear()
    login = await api.client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD},
                                  headers={"X-Auth-Mode": "bearer"})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


# ---------------------------------------------------------------------------- sign-up
async def test_registration_sends_only_an_sms_code(api, sms_on):
    email = new_email("sms")
    res = await register(api.client, email, mobile=MOBILE)
    assert res.status_code == 201
    assert "SMS" in res.json()["message"]
    assert api.sms.sent and api.sms.sent[-1]["to"] == MOBILE
    assert api.mail.of_type("verification", email) == []      # no email code at sign-up
    assert (await api.client.get("/api/site-config")).json()["mobile_otp"] is True


async def test_the_sms_code_creates_the_account_and_signs_in(api, sms_on):
    email = new_email("ok")
    await register(api.client, email, mobile=MOBILE)
    res = await verify_sms(api, email, api.sms.last_otp(MOBILE))
    assert res.status_code == 200, res.text
    user = res.json()["user"]
    assert user["is_mobile_verified"] is True and user["is_email_verified"] is False
    me = await api.client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["email"] == email


async def test_sign_in_is_refused_until_the_sms_code_is_entered(api, sms_on):
    email = new_email("early")
    await register(api.client, email, mobile=MOBILE)
    res = await api.client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD})
    assert res.status_code == 403 and res.json()["code"] == "email_not_verified"
    assert "mobile" in res.json()["detail"]


async def test_wrong_sms_codes_count_down_and_then_lock(api, sms_on):
    email = new_email("wrong")
    await register(api.client, email, mobile=MOBILE)
    code = api.sms.last_otp(MOBILE)
    res = await verify_sms(api, email, wrong_code(code))
    assert res.status_code == 400 and res.json()["code"] == "invalid_mobile_code"
    assert "4 attempt(s) remaining" in res.json()["detail"]
    for _ in range(settings.OTP_MAX_ATTEMPTS - 1):
        await verify_sms(api, email, wrong_code(code))
    res = await verify_sms(api, email, code)
    assert res.status_code == 400 and res.json()["code"] == "mobile_code_locked"


async def test_unknown_emails_get_the_same_answer_as_real_ones(api, sms_on):
    res = await verify_sms(api, new_email("ghost"), "123456")
    assert res.status_code == 400 and res.json()["code"] == "invalid_mobile_code"
    assert "attempt(s) remaining" in res.json()["detail"]


async def test_a_new_sms_code_can_be_requested_during_sign_up(api, sms_on):
    email = new_email("resend")
    await register(api.client, email, mobile=MOBILE)
    first = api.sms.last_otp(MOBILE)
    await past_cooldown(api, email)
    res = await api.client.post("/api/auth/resend-otp", json={"email": email, "purpose": "mobile_verification"})
    assert res.status_code == 200 and len(api.sms.sent) == 2
    second = api.sms.last_otp(MOBILE)
    if first != second:
        assert (await verify_sms(api, email, first)).status_code == 400
    assert (await verify_sms(api, email, second)).status_code == 200


async def test_registering_again_before_finishing_replaces_the_details(api, sms_on):
    email = new_email("again")
    await register(api.client, email, mobile=MOBILE)
    await register(api.client, email, mobile="+91 91234 56789")
    row = await user_row(api, email)
    assert row.mobile == "+91 91234 56789" and not row.is_mobile_verified
    assert api.sms.sent[-1]["to"] == "+91 91234 56789"


async def test_a_finished_account_is_never_overwritten_by_a_new_registration(api, sms_on):
    email = new_email("taken")
    await signed_up(api, email)
    res = await register(api.client, email, mobile="+91 90000 99999")
    assert res.status_code == 201                                   # same answer as always
    assert (await user_row(api, email)).mobile == MOBILE           # nothing changed
    assert api.mail.of_type("exists", email)                        # the owner is told by email


async def test_the_email_owner_takes_an_account_back_with_a_password_reset(api, sms_on):
    email = new_email("owner")
    await signed_up(api, email)                                     # someone else finished sign-up
    assert not (await user_row(api, email)).is_email_verified
    await api.client.post("/api/auth/forgot-password", json={"email": email})
    res = await api.client.post("/api/auth/reset-password", json={
        "email": email, "otp": api.mail.last_otp("reset", email), "new_password": NEW_PASSWORD})
    assert res.status_code == 200
    assert (await user_row(api, email)).is_email_verified           # the emailed code proved the address


# ---------------------------------------------------------------------------- email from the dashboard
async def test_the_email_is_confirmed_from_the_dashboard(api, sms_on):
    email = new_email("dash")
    headers = await signed_up(api, email)
    assert (await api.client.post("/api/auth/email/send-code", headers=headers)).status_code == 200
    code = api.mail.last_otp("verification", email)
    bad = await api.client.post("/api/auth/email/verify", headers=headers, json={"otp": wrong_code(code)})
    assert bad.status_code == 400 and bad.json()["code"] == "invalid_code"
    ok = await api.client.post("/api/auth/email/verify", headers=headers, json={"otp": code})
    assert ok.status_code == 200 and ok.json()["is_email_verified"] is True
    again = await api.client.post("/api/auth/email/send-code", headers=headers)
    assert again.status_code == 409 and again.json()["code"] == "email_already_verified"


async def test_email_codes_have_a_resend_cooldown(api, sms_on):
    headers = await signed_up(api, new_email("cool"))
    assert (await api.client.post("/api/auth/email/send-code", headers=headers)).status_code == 200
    res = await api.client.post("/api/auth/email/send-code", headers=headers)
    assert res.status_code == 429 and res.json()["code"] == "code_cooldown"


# ---------------------------------------------------------------------------- bidding
async def bid(api, headers):
    return await api.client.post(f"/api/auctions/{uuid.uuid4()}/bids", headers=headers, json={"amount": 1000})


async def test_bidding_needs_kyc_mobile_and_email(api, sms_on):
    email = new_email("bidder")
    headers = await signed_up(api, email)
    await verify_kyc(api, (await user_row(api, email)).id)

    res = await bid(api, headers)
    assert res.status_code == 403 and res.json()["code"] == "email_not_verified"

    await api.client.post("/api/auth/email/send-code", headers=headers)
    await api.client.post("/api/auth/email/verify", headers=headers, json={"otp": api.mail.last_otp("verification", email)})
    res = await bid(api, headers)
    assert res.json().get("code") not in ("email_not_verified", "mobile_not_verified")  # the made-up auction is not found


async def test_old_accounts_sign_in_but_must_confirm_the_mobile_before_bidding(api, monkeypatch):
    _, headers, uid = await make_user(api, "bidder")   # made with SMS codes switched off
    await verify_kyc(api, uid)
    monkeypatch.setattr(settings, "MOBILE_OTP_REQUIRED", True)

    me = await api.client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200 and me.json()["is_mobile_verified"] is False

    res = await bid(api, headers)
    assert res.status_code == 403 and res.json()["code"] == "mobile_not_verified"

    assert (await api.client.post("/api/auth/mobile/send-code", headers=headers, json={})).status_code == 200
    code = api.sms.sent[-1]["otp"]
    bad = await api.client.post("/api/auth/mobile/verify", headers=headers, json={"otp": wrong_code(code)})
    assert bad.status_code == 400 and bad.json()["code"] == "invalid_mobile_code"
    ok = await api.client.post("/api/auth/mobile/verify", headers=headers, json={"otp": code})
    assert ok.status_code == 200 and ok.json()["is_mobile_verified"] is True
    assert (await bid(api, headers)).json().get("code") != "mobile_not_verified"


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
    headers = await signed_up(api, new_email("done"))
    res = await api.client.post("/api/auth/mobile/send-code", headers=headers, json={})
    assert res.status_code == 409 and res.json()["code"] == "mobile_already_verified"


async def test_changing_the_number_in_the_profile_needs_a_new_sms_code(api, sms_on):
    headers = await signed_up(api, new_email("profile"))
    same = await api.client.patch("/api/users/me", headers=headers, json={"name": "New Name"})
    assert same.status_code == 200 and same.json()["is_mobile_verified"] is True
    changed = await api.client.patch("/api/users/me", headers=headers, json={"mobile": "+91 90000 22222"})
    assert changed.status_code == 200 and changed.json()["is_mobile_verified"] is False


async def test_signed_in_routes_need_a_signed_in_user(api, sms_on):
    for path, body in (("/api/auth/mobile/send-code", {}), ("/api/auth/mobile/verify", {"otp": "123456"}),
                       ("/api/auth/email/send-code", None), ("/api/auth/email/verify", {"otp": "123456"})):
        assert (await api.client.post(path, json=body)).status_code == 401, path


# ---------------------------------------------------------------------------- switch off
async def test_with_the_switch_off_sign_up_uses_the_email_code_and_no_sms(api):
    email = new_email("off")
    await register(api.client, email, mobile=MOBILE)
    assert api.sms.sent == [] and api.mail.of_type("verification", email)
    _, headers, uid = await make_user(api, "bidder")
    await verify_kyc(api, uid)
    assert (await bid(api, headers)).json().get("code") not in ("mobile_not_verified", "email_not_verified")


def test_production_refuses_the_developer_sms_outbox_while_sms_codes_are_required(monkeypatch):
    from test_production_safeguards import make_settings  # complete, valid production settings

    with pytest.raises(ValueError, match="MOBILE_OTP_REQUIRED"):
        make_settings(monkeypatch, MOBILE_OTP_REQUIRED="true")
    assert make_settings(monkeypatch, MOBILE_OTP_REQUIRED="false").MOBILE_OTP_REQUIRED is False
