"""
Production/development separation, email delivery, and "secrets never leak" tests.
All values below are fake; nothing is sent over the network.
"""
import json
import logging
import re
import secrets
import ssl

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.core.config import Settings, settings
from app.services import email as email_module
from app.services.email import DevOutboxEmailService, SmtpEmailService, get_email_service, mask_email, read_dev_outbox
from helpers import PASSWORD, login, new_email, register, register_and_verify



def _fresh_production_grade_secret() -> str:
    """A random 64-character secret generated for this test run (nothing secret-looking is committed)."""
    weak_hints = ("change", "example", "default", "secret_key", "development", "test_secret", "salvex_dev",
                  "password", "your_", "placeholder", "12345")
    while True:
        candidate = secrets.token_urlsafe(48)
        if not any(hint in candidate.lower() for hint in weak_hints):
            return candidate


GOOD_SECRET = _fresh_production_grade_secret()
PROD_ENV = {
    "APP_ENV": "production",
    "APP_SECRET_KEY": GOOD_SECRET,
    "DATABASE_URL": "postgresql://u:p@db.example.invalid:5432/salvex?sslmode=require",
    "FRONTEND_ORIGINS": "https://app.salvex.example",
    "EMAIL_PROVIDER": "smtp",
    "SMTP_HOST": "smtp.example.invalid",
    "SMTP_USER": "smtp-user",
    "SMTP_PASSWORD": "smtp-password-value",
    "RATE_LIMIT_ENABLED": "true",
}


def make_settings(monkeypatch, **overrides) -> Settings:
    for key, value in {**PROD_ENV, **overrides}.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)
    return Settings(_env_file=None)


# ------------------------------------------------------------------ configuration safety
def test_a_complete_production_configuration_is_accepted_and_hardened(monkeypatch):
    s = make_settings(monkeypatch)
    assert s.is_production_like and s.cookie_secure is True
    assert s.auth_cookie_name == "__Host-access_token"   # browser enforces Secure + no Domain + Path=/


def test_the_default_environment_is_production_not_development(monkeypatch):
    # With APP_ENV unset the application assumes PRODUCTION...
    assert make_settings(monkeypatch, APP_ENV=None).APP_ENV == "production"
    # ...so a forgotten APP_ENV can never silently enable developer behaviour (outbox email, insecure cookies)
    with pytest.raises(ValidationError):
        make_settings(monkeypatch, APP_ENV=None, EMAIL_PROVIDER="console")


@pytest.mark.parametrize("override, mentions", [
    ({"APP_SECRET_KEY": "short-but-sixteen!!"}, "APP_SECRET_KEY"),
    ({"APP_SECRET_KEY": "change_me_" + "x" * 40}, "APP_SECRET_KEY"),
    ({"EMAIL_PROVIDER": "console"}, "EMAIL_PROVIDER"),
    ({"SMTP_PASSWORD": ""}, "SMTP_USER"),
    ({"COOKIE_SECURE": "false"}, "COOKIE_SECURE"),
    ({"RATE_LIMIT_ENABLED": "false"}, "RATE_LIMIT_ENABLED"),
    ({"FRONTEND_ORIGINS": "http://app.salvex.example"}, "FRONTEND_ORIGINS"),
    ({"FRONTEND_ORIGINS": "https://localhost:5173"}, "FRONTEND_ORIGINS"),
    ({"FRONTEND_ORIGINS": "*"}, "FRONTEND_ORIGINS"),
    ({"FRONTEND_ORIGINS": "https://ok.example,http://127.0.0.1:5173"}, "FRONTEND_ORIGINS"),
])
def test_unsafe_production_settings_stop_the_application_from_starting(monkeypatch, override, mentions):
    with pytest.raises(ValidationError) as exc:
        make_settings(monkeypatch, **override)
    message = str(exc.value)
    assert mentions in message
    for secret in (GOOD_SECRET, "smtp-password-value", "db.example.invalid"):
        assert secret not in message   # the error names the setting, never the value


def test_staging_is_held_to_the_production_standard(monkeypatch):
    with pytest.raises(ValidationError):
        make_settings(monkeypatch, APP_ENV="staging", EMAIL_PROVIDER="console")


def test_unknown_environment_names_are_rejected(monkeypatch):
    with pytest.raises(ValidationError):
        make_settings(monkeypatch, APP_ENV="prod-ish")


def test_samesite_none_requires_secure_cookies(monkeypatch):
    with pytest.raises(ValidationError):
        make_settings(monkeypatch, APP_ENV="development", EMAIL_PROVIDER="console", COOKIE_SAMESITE="none", COOKIE_SECURE="false")
    ok = make_settings(monkeypatch, COOKIE_SAMESITE="none", COOKIE_SECURE=None)
    assert ok.COOKIE_SAMESITE == "none" and ok.cookie_secure


def test_development_keeps_working_without_production_requirements(monkeypatch):
    s = make_settings(
        monkeypatch, APP_ENV="development", APP_SECRET_KEY="development-only-secret-key-1234567890",
        EMAIL_PROVIDER="console", FRONTEND_ORIGINS="http://localhost:5173", SMTP_HOST=None, SMTP_USER=None, SMTP_PASSWORD=None,
    )
    assert s.is_dev_like and s.cookie_secure is False and s.auth_cookie_name == "access_token"


def test_the_developer_email_outbox_refuses_to_run_in_production(monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    with pytest.raises(RuntimeError):
        DevOutboxEmailService()
    with pytest.raises(RuntimeError):
        read_dev_outbox()


def test_the_email_factory_picks_the_configured_provider(monkeypatch):
    assert isinstance(get_email_service(), DevOutboxEmailService)   # APP_ENV=test
    monkeypatch.setattr(settings, "EMAIL_PROVIDER", "smtp")
    assert isinstance(get_email_service(), SmtpEmailService)


async def test_api_docs_are_hidden_and_hsts_is_sent_in_production(monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    from app.main import create_application

    app = create_application()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert (await client.get(path)).status_code == 404
        res = await client.get("/api/health")
        assert "max-age=31536000" in res.headers["strict-transport-security"]


async def test_api_docs_are_available_in_development_only(monkeypatch):
    from app.main import create_application

    app = create_application()   # APP_ENV=test
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/docs")).status_code == 200
        assert "strict-transport-security" not in (await client.get("/api/health")).headers


# ------------------------------------------------------------------ nothing sensitive in logs or responses
async def test_codes_and_passwords_never_appear_in_logs_or_responses(api, monkeypatch, caplog, tmp_path):
    outbox_path = tmp_path / "outbox.jsonl"
    monkeypatch.setattr("app.api.auth.get_email_service", lambda: DevOutboxEmailService(path=str(outbox_path)))
    caplog.set_level(logging.DEBUG)

    email = new_email("logs")
    responses = [await register(api.client, email)]
    code = re.search(r"code is: (\d{6})", read_dev_outbox(str(outbox_path))[-1]["text"]).group(1)   # only in the file
    responses.append(await api.client.post("/api/auth/verify-email", json={"email": email, "otp": code}))
    responses.append(await login(api.client, email))
    responses.append(await login(api.client, email, "a-wrong-password-777"))
    responses.append(await api.client.post("/api/auth/forgot-password", json={"email": email}))
    reset_code = re.search(r"code is: (\d{6})", read_dev_outbox(str(outbox_path))[-1]["text"]).group(1)
    responses.append(await api.client.post("/api/auth/reset-password", json={"email": email, "otp": "000000", "new_password": PASSWORD + "!"}))

    assert code not in caplog.text and reset_code not in caplog.text
    assert PASSWORD not in caplog.text and "a-wrong-password-777" not in caplog.text
    assert email not in caplog.text and mask_email(email) in caplog.text   # addresses are masked in logs
    for res in responses:
        assert code not in res.text and reset_code not in res.text
        assert PASSWORD not in res.text
    # the code IS available to a developer, in the outbox file only
    assert any(code in m["text"] for m in read_dev_outbox(str(outbox_path)))


def test_the_developer_command_shows_the_latest_code_for_an_address(monkeypatch, tmp_path, capsys):
    outbox = tmp_path / "outbox.jsonl"
    outbox.write_text(
        json.dumps({"time": "t1", "to": "a@x.test", "subject": "old", "text": "code is: 111111"}) + "\n"
        + json.dumps({"time": "t2", "to": "a@x.test", "subject": "new", "text": "code is: 222222"}) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(settings, "DEV_OUTBOX_PATH", str(outbox))
    from app.cli import main

    assert main(["dev-last-code", "A@X.test"]) == 0
    out = capsys.readouterr().out
    assert "222222" in out and "111111" not in out
    assert main(["dev-last-code", "nobody@x.test"]) == 1


async def test_a_failing_email_provider_never_breaks_or_changes_the_answer(api, monkeypatch):
    class Broken(email_module.BaseEmailService):
        async def send_verification_otp(self, *a, **k):
            raise ConnectionError("smtp down: user@secret.example")

        async def send_password_reset_otp(self, *a, **k):
            raise ConnectionError("smtp down")

    monkeypatch.setattr("app.api.auth.get_email_service", lambda: Broken())
    res = await register(api.client, new_email("broken"))
    assert res.status_code == 201


# ------------------------------------------------------------------ SMTP delivery
class FakeSMTP:
    instances = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host, self.port, self.context = host, port, context
        self.calls, self.sent = [], []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        self.calls.append("starttls")
        self.tls_context = context

    def login(self, user, password):
        self.calls.append("login")

    def send_message(self, msg):
        self.calls.append("send")
        self.sent.append(msg)


@pytest.fixture
def smtp(monkeypatch):
    FakeSMTP.instances.clear()
    monkeypatch.setattr(email_module.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(email_module.smtplib, "SMTP_SSL", FakeSMTP)
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.invalid")
    monkeypatch.setattr(settings, "SMTP_USER", "smtp-user")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "smtp-password-value")
    return FakeSMTP


async def test_smtp_verifies_the_server_certificate_before_logging_in(smtp, monkeypatch):
    monkeypatch.setattr(settings, "SMTP_PORT", 587)
    ok, _ = await SmtpEmailService().send_verification_otp("person@x.test", "123456", "Pat")
    assert ok
    server = smtp.instances[-1]
    assert server.calls == ["starttls", "login", "send"]          # TLS first, credentials only afterwards
    assert server.tls_context.verify_mode == ssl.CERT_REQUIRED and server.tls_context.check_hostname


async def test_smtp_on_port_465_uses_implicit_tls_with_verification(smtp, monkeypatch):
    monkeypatch.setattr(settings, "SMTP_PORT", 465)
    await SmtpEmailService().send_password_reset_otp("person@x.test", "123456", "Pat")
    server = smtp.instances[-1]
    assert "starttls" not in server.calls
    assert server.context.verify_mode == ssl.CERT_REQUIRED and server.context.check_hostname


async def test_user_supplied_text_is_escaped_in_html_emails(smtp):
    hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>'
    await SmtpEmailService().send_verification_otp("person@x.test", "123456", hostile)
    await SmtpEmailService().send_account_exists_notice("person@x.test", hostile)
    await SmtpEmailService().send_password_changed_notice("person@x.test", hostile)
    for server in smtp.instances:
        html_part = server.sent[0].get_body(preferencelist=("html",)).get_content()
        assert "<script>" not in html_part and "<img" not in html_part and "&lt;script&gt;" in html_part


async def test_smtp_failures_are_reported_without_leaking_addresses_or_passwords(smtp, monkeypatch, caplog):
    def explode(self, msg):
        raise ConnectionRefusedError("refused for person@x.test using smtp-password-value")

    monkeypatch.setattr(FakeSMTP, "send_message", explode)
    caplog.set_level(logging.DEBUG)
    ok, message = await SmtpEmailService().send_verification_otp("person@x.test", "123456", "Pat")
    assert ok is False and "ConnectionRefusedError" in message
    assert "person@x.test" not in caplog.text + message and "smtp-password-value" not in caplog.text + message


async def test_smtp_without_configuration_fails_loudly_instead_of_pretending(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    ok, message = await SmtpEmailService().send_verification_otp("person@x.test", "123456", "Pat")
    assert ok is False and "not configured" in message


def test_mask_email_hides_the_identity():
    assert mask_email("person@example.com") == "p***@example.com"
    assert mask_email("nonsense") == "***"
