"""
Client IP for rate limits (audit finding BE-04 / SEC-01): a visitor must not be able to choose
their own address with an X-Forwarded-For header.
"""
import re
from pathlib import Path

import pytest
from pydantic import ValidationError
from starlette.requests import Request

from app.core.config import Settings, settings
from app.core.rate_limit import client_ip
from helpers import new_email, register_and_verify

DOCKERFILE = Path(__file__).resolve().parents[1] / "Dockerfile"


def _request(peer: str, forwarded: str = None) -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded is not None else []
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers, "client": (peer, 1234)})


@pytest.fixture
def coolify(monkeypatch):
    """Coolify: Coolify's proxy -> the website's nginx -> API, all on the private Docker network."""
    monkeypatch.setattr(settings, "TRUSTED_PROXY_COUNT", 2)


def test_without_trusted_proxies_the_header_is_ignored():
    assert settings.TRUSTED_PROXY_COUNT == 0
    assert client_ip(_request("198.51.100.7", "203.0.113.9")) == "198.51.100.7"


def test_behind_coolify_the_real_client_is_used_and_forged_entries_are_ignored(coolify):
    # the visitor wrote "6.6.6.6, 7.7.7.7"; Coolify's proxy appended the real client; nginx appended the proxy
    req = _request("10.0.1.5", "6.6.6.6, 7.7.7.7, 203.0.113.50, 10.0.1.2")
    assert client_ip(req) == "203.0.113.50"


def test_behind_coolify_without_any_forged_entries(coolify):
    assert client_ip(_request("172.18.0.4", "203.0.113.50, 172.18.0.2")) == "203.0.113.50"


def test_a_direct_connection_from_outside_the_private_network_is_never_trusted(coolify):
    # someone reaches the API port directly and sends a header shaped like the proxies' one
    assert client_ip(_request("198.51.100.7", "203.0.113.1, 10.0.0.1")) == "198.51.100.7"


def test_too_few_entries_fall_back_to_the_connection_address(coolify):
    assert client_ip(_request("10.0.1.5", "203.0.113.50")) == "10.0.1.5"
    assert client_ip(_request("10.0.1.5")) == "10.0.1.5"


def test_an_entry_that_is_not_an_ip_address_is_not_used(coolify):
    assert client_ip(_request("10.0.1.5", "not-an-ip, 10.0.1.2")) == "10.0.1.5"


def test_ipv6_clients_are_normalised(coolify):
    assert client_ip(_request("fd00::5", "2001:0db8:0000::0001, fd00::2")) == "2001:db8::1"


def test_the_trusted_networks_can_be_narrowed(coolify, monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_NETWORKS", "10.0.1.0/24")
    assert client_ip(_request("10.0.1.5", "203.0.113.50, 10.0.1.2")) == "203.0.113.50"
    assert client_ip(_request("172.18.0.4", "203.0.113.50, 172.18.0.2")) == "172.18.0.4"


def test_an_invalid_trusted_network_setting_is_refused():
    with pytest.raises(ValidationError, match="TRUSTED_PROXY_NETWORKS"):
        Settings(APP_ENV="test", TRUSTED_PROXY_NETWORKS="10.0.0.0/8,not-a-network")


def test_the_api_container_does_not_let_uvicorn_rewrite_the_client_address():
    cmd = next(line for line in DOCKERFILE.read_text(encoding="utf-8").splitlines() if line.startswith("CMD"))
    assert "--no-proxy-headers" in cmd
    assert not re.search(r"forwarded-allow-ips", cmd)


async def test_forged_entries_cannot_evade_the_login_limit_behind_coolify(api, monkeypatch):
    """End to end through the app: rotating fake left-hand entries does not reset the limit."""
    monkeypatch.setattr(settings, "TRUSTED_PROXY_COUNT", 2)
    email = new_email("coolify")
    await register_and_verify(api, email)
    for i in range(8):
        await api.client.post("/api/auth/login", json={"identifier": email, "password": f"wrong-{i}"},
                              headers={"X-Forwarded-For": f"6.6.6.{i}, 203.0.113.50, 10.0.1.2"})
    blocked = await api.client.post("/api/auth/login", json={"identifier": email, "password": "wrong-9"},
                                    headers={"X-Forwarded-For": "9.9.9.9, 203.0.113.50, 10.0.1.2"})
    assert blocked.status_code == 429
    # a different real client keeps its own budget
    other = await api.client.post("/api/auth/login", json={"identifier": email, "password": "wrong-9"},
                                  headers={"X-Forwarded-For": "203.0.113.51, 10.0.1.2"})
    assert other.status_code == 401
