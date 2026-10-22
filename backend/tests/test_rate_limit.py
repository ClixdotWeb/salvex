"""Rate limiting and abuse resistance."""
import pytest

from app.core.config import settings
from app.core.rate_limit import FakeAttemptCounter, InMemoryRateLimiter, POLICIES
from helpers import PASSWORD, login, new_email, register, register_and_verify


# ------------------------------------------------------------------ the limiter itself
def test_limiter_blocks_after_the_limit_and_reports_how_long_to_wait():
    lim = InMemoryRateLimiter()
    rules = [("k", 3, 60)]
    assert [lim.check_and_record(rules, now=t) for t in (0, 1, 2)] == [0, 0, 0]
    wait = lim.check_and_record(rules, now=3)
    assert 55 <= wait <= 60                      # the oldest hit (t=0) expires at t=60


def test_limiter_window_slides_and_recovers_by_itself():
    lim = InMemoryRateLimiter()
    rules = [("k", 2, 10)]
    lim.check_and_record(rules, now=0)
    lim.check_and_record(rules, now=1)
    assert lim.check_and_record(rules, now=2) > 0
    assert lim.check_and_record(rules, now=10.5) == 0   # first hit has left the window: no permanent lockout


def test_a_blocked_request_does_not_extend_the_block():
    lim = InMemoryRateLimiter()
    rules = [("k", 1, 10)]
    lim.check_and_record(rules, now=0)
    for t in range(1, 9):
        assert lim.check_and_record(rules, now=t) > 0   # an attacker hammering the endpoint...
    assert lim.check_and_record(rules, now=10.1) == 0   # ...does not push the unblock time back


def test_a_request_is_only_counted_when_every_rule_allows_it():
    lim = InMemoryRateLimiter()
    lim.check_and_record([("strict", 1, 60)], now=0)
    assert lim.check_and_record([("strict", 1, 60), ("loose", 5, 60)], now=1) > 0
    # the loose counter was not charged for the rejected request
    for t in range(2, 7):
        assert lim.check_and_record([("loose", 5, 60)], now=t) == 0


def test_limiter_memory_is_bounded():
    lim = InMemoryRateLimiter()
    lim.MAX_KEYS = 100
    for i in range(500):
        lim.check_and_record([(f"key{i}", 5, 3600)], now=float(i))
    assert len(lim._hits) <= 200


def test_fake_attempt_counter_mimics_a_real_code():
    fake = FakeAttemptCounter()
    assert [fake.attempt("k", 5, 600, now=t) for t in range(5)] == [4, 3, 2, 1, 0]
    assert fake.attempt("k", 5, 600, now=6) == -1
    assert fake.attempt("k", 5, 600, now=700) == 4      # forgets after the time-to-live


def test_every_authentication_scope_has_a_policy():
    assert {"login", "register", "verify", "resend", "forgot", "reset", "session"} <= set(POLICIES)


# ------------------------------------------------------------------ through the real endpoints
async def test_login_is_rate_limited_per_ip_and_email_with_retry_after(api):
    email = new_email("brute")
    await register_and_verify(api, email)
    statuses = [(await login(api.client, email, f"wrong-password-{i}")).status_code for i in range(8)]
    assert statuses == [401] * 8
    blocked = await login(api.client, email, "wrong-password-9")
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "rate_limited" and int(blocked.headers["retry-after"]) > 0
    # even the correct password is refused while blocked (otherwise guesses could be confirmed)
    assert (await login(api.client, email, PASSWORD)).status_code == 429


async def test_blocking_one_account_does_not_block_other_accounts_from_the_same_ip(api):
    victim = new_email("victim")
    other = new_email("other")
    await register_and_verify(api, victim)
    await register_and_verify(api, other)
    for i in range(9):
        await login(api.client, victim, f"wrong-{i}")
    assert (await login(api.client, victim, PASSWORD)).status_code == 429
    assert (await login(api.client, other, PASSWORD)).status_code == 200   # no site-wide lockout


async def test_rate_limit_answers_are_identical_for_known_and_unknown_emails(api):
    known = new_email("known")
    await register_and_verify(api, known)
    unknown = new_email("unknown")
    for email in (known, unknown):
        for i in range(8):
            await login(api.client, email, f"wrong-{i}")
    a = await login(api.client, known, "wrong-x")
    b = await login(api.client, unknown, "wrong-x")
    assert a.status_code == b.status_code == 429
    assert a.json()["code"] == b.json()["code"]


async def test_a_successful_login_resets_the_failed_attempt_counter(api):
    email = new_email("forgive")
    await register_and_verify(api, email)
    for i in range(6):
        await login(api.client, email, f"wrong-{i}")
    assert (await login(api.client, email, PASSWORD)).status_code == 200
    for i in range(7):  # a fresh budget after the success
        assert (await login(api.client, email, f"wrong-again-{i}")).status_code == 401


async def test_registration_is_limited_per_email_and_per_ip(api):
    email = new_email("regspam")
    codes = [(await register(api.client, email)).status_code for _ in range(6)]
    assert codes[:5] == [201] * 5 and codes[5] == 429


async def test_verification_guessing_is_limited(api):
    email = new_email("guess")
    await register(api.client, email)
    statuses = []
    for i in range(12):
        res = await api.client.post("/api/auth/verify-email", json={"email": email, "otp": f"{i:06d}"})
        statuses.append(res.status_code)
    assert 429 in statuses
    assert statuses.index(429) <= 10   # the pair limit (10) stops it before the code space can be walked


async def test_resend_and_forgot_password_are_limited_so_mailboxes_cannot_be_flooded(api):
    email = new_email("flood")
    await register_and_verify(api, email)
    for path in ("/api/auth/resend-otp", "/api/auth/forgot-password"):
        api_statuses = [(await api.client.post(path, json={"email": email})).status_code for _ in range(7)]
        assert api_statuses[:5] == [200] * 5 and 429 in api_statuses[5:]


async def test_a_forged_x_forwarded_for_header_cannot_evade_the_limit(api):
    email = new_email("spoof")
    await register_and_verify(api, email)
    assert settings.TRUSTED_PROXY_COUNT == 0
    for i in range(8):
        await api.client.post(
            "/api/auth/login", json={"identifier": email, "password": f"wrong-{i}"},
            headers={"X-Forwarded-For": f"203.0.113.{i}"},
        )
    res = await api.client.post(
        "/api/auth/login", json={"identifier": email, "password": "wrong-9"},
        headers={"X-Forwarded-For": "198.51.100.77"},
    )
    assert res.status_code == 429


async def test_x_forwarded_for_is_used_only_behind_a_configured_trusted_proxy(api, monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_COUNT", 1)
    email = new_email("proxy")
    await register_and_verify(api, email)
    # behind one trusted proxy, the last entry is the real client address
    for i in range(8):
        await api.client.post("/api/auth/login", json={"identifier": email, "password": f"wrong-{i}"},
                              headers={"X-Forwarded-For": f"10.0.0.{i}, 198.51.100.1"})
    blocked = await api.client.post("/api/auth/login", json={"identifier": email, "password": "wrong-9"},
                                    headers={"X-Forwarded-For": "10.9.9.9, 198.51.100.1"})
    assert blocked.status_code == 429
    # a different real client (different last entry) has its own budget
    other = await api.client.post("/api/auth/login", json={"identifier": email, "password": "wrong-9"},
                                  headers={"X-Forwarded-For": "10.0.0.1, 198.51.100.2"})
    assert other.status_code == 401


async def test_rate_limiting_can_be_switched_off_in_the_test_environment(api, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", False)
    email = new_email("off")
    await register_and_verify(api, email)
    statuses = {(await login(api.client, email, f"wrong-{i}")).status_code for i in range(12)}
    assert statuses == {401}
