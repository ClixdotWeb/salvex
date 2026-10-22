"""Password hashing and policy."""
import pytest

from app.core import security
from app.core.password_policy import validate_password_strength
from app.core.security import dummy_password_check, hash_password, verify_password
from helpers import new_email, register, register_and_verify


def test_hashes_are_salted_bcrypt_with_cost_12():
    a, b = hash_password("correct horse battery staple"), hash_password("correct horse battery staple")
    assert a != b                                           # per-password random salt
    assert a.startswith("$2b$12$") and len(a) == 60
    assert verify_password("correct horse battery staple", a) and verify_password("correct horse battery staple", b)


@pytest.mark.parametrize("password", [
    "é" * 100,                      # 200 bytes: bcrypt 5 raises on > 72 bytes without the pre-hash
    "x" * 128,
    "𝕊" * 60,
    "pass\x00word-with-nul",         # NUL bytes are not truncated away
    "   spaces at both ends   ",
    "Pässwörd-with-ünicode-1",
])
def test_any_length_unicode_and_odd_characters_round_trip(password):
    hashed = hash_password(password)
    assert verify_password(password, hashed)
    assert not verify_password(password + "x", hashed)


def test_no_truncation_two_long_passwords_that_share_a_prefix_differ():
    prefix = "a" * 72
    hashed = hash_password(prefix + "ONE")
    assert not verify_password(prefix + "TWO", hashed)      # plain bcrypt would accept this


def test_wrong_password_and_garbage_hashes_are_just_false():
    hashed = hash_password("right-password-1")
    assert not verify_password("wrong-password-1", hashed)
    assert not verify_password("right-password-1", "")
    assert not verify_password("right-password-1", "not-a-bcrypt-hash")
    assert not verify_password("", hashed)


def test_plaintext_is_never_part_of_the_stored_hash():
    assert "right-password-1" not in hash_password("right-password-1")


def test_dummy_check_really_does_the_expensive_work(monkeypatch):
    calls = []
    real = security.verify_password
    monkeypatch.setattr(security, "verify_password", lambda p, h: calls.append(h) or real(p, h))
    dummy_password_check("anything")
    assert len(calls) == 1 and calls[0].startswith("$2b$12$")


async def test_unknown_accounts_and_known_verified_registrations_pay_the_same_password_cost(api, monkeypatch):
    spent = []
    monkeypatch.setattr("app.services.auth_service.dummy_password_check", lambda pw: spent.append("dummy"))

    from helpers import login

    await login(api.client, new_email("ghost"), "some-password-123")          # unknown email
    known = new_email("known")
    await register_and_verify(api, known)
    spent.clear()
    await register(api.client, known)                                            # register over a verified account
    assert spent == ["dummy"]


@pytest.mark.parametrize("password", [
    "short", "1234567", "a" * 129, "        ", "Password", "PASSWORD123", "qwertyuiop",
    "password1234", "Admin@2026", "welcome2026!", "Salvex2026",       # common word + digits/symbols
])
def test_policy_rejects_short_long_blank_and_common_passwords(password):
    with pytest.raises(ValueError):
        validate_password_strength(password)


def test_policy_rejects_the_email_address_as_a_password():
    with pytest.raises(ValueError):
        validate_password_strength("Someone@Example.com", "someone@example.com")


@pytest.mark.parametrize("password", [
    "alllowercaseletters",           # no forced character classes
    "correct horse battery staple",   # passphrases with spaces
    "12-34-56-78-90",
    "𝕊" * 8,
])
def test_policy_does_not_demand_arbitrary_composition(password):
    assert validate_password_strength(password) == password
