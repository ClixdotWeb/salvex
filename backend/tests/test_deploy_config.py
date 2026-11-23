"""
Website nginx configuration (audit SEC-03). nginx itself is not run here (no Docker in the test
environment); these checks catch the mistakes that silently drop headers.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = (ROOT / "deploy" / "nginx.conf.template").read_text(encoding="utf-8")
HEADERS = (ROOT / "deploy" / "security-headers.conf").read_text(encoding="utf-8")
WEB_DOCKERFILE = (ROOT / "Dockerfile").read_text(encoding="utf-8")
SNIPPET = "include /etc/nginx/snippets/security-headers.conf;"


def _locations():
    return dict(re.findall(r"location\s+([^{]+?)\s*\{(.*?)\n    \}", TEMPLATE, flags=re.S))


def test_every_website_location_sends_the_security_headers():
    locations = _locations()
    website = {k: v for k, v in locations.items() if "api" not in k}
    assert len(website) == 3
    for name, body in website.items():
        assert SNIPPET in body, name


def test_api_responses_keep_only_the_api_headers():
    api = next(body for name, body in _locations().items() if "api" in name)
    assert "add_header" not in api and SNIPPET not in api


def test_no_server_level_add_header_that_locations_would_silently_drop():
    server_level = re.sub(r"location\s+[^{]+\{.*?\n    \}", "", TEMPLATE, flags=re.S)
    assert "add_header" not in server_level.split("server {", 1)[1]


def test_the_policy_allows_no_inline_scripts_or_eval():
    csp = re.search(r'add_header Content-Security-Policy "([^"]+)" always;', HEADERS).group(1)
    directives = dict(d.strip().split(" ", 1) for d in csp.split(";"))
    assert directives["script-src"] == "'self'"
    assert "unsafe" not in csp
    assert directives["object-src"] == "'none'" and directives["frame-ancestors"] == "'none'"


def test_hsts_is_sent_only_for_https_requests():
    assert "add_header Strict-Transport-Security $salvex_hsts always;" in HEADERS
    hsts_map = re.search(r"map \$http_x_forwarded_proto \$salvex_hsts \{(.*?)\}", TEMPLATE, flags=re.S).group(1)
    assert re.search(r'https\s+"max-age=31536000";', hsts_map)
    assert re.search(r'default\s+"";', hsts_map)


def test_the_header_file_is_copied_into_the_website_image():
    assert "COPY deploy/security-headers.conf /etc/nginx/snippets/security-headers.conf" in WEB_DOCKERFILE
