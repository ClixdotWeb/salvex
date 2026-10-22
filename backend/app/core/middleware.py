"""
Request protection applied to every response/request.

1. Cross-site request defence (CSRF, layer 1): for state-changing methods (POST/PUT/PATCH/DELETE)
   a browser always tells us where the request came from (Origin, or Referer as a fallback). If
   that origin is not one of the configured website origins, the request is refused before any
   code runs. Requests with no Origin/Referer (scripts, mobile apps, curl) are not browser
   cross-site requests; they are still subject to the per-session CSRF token check on
   cookie-authenticated endpoints (layer 2, see app/api/deps.py).
2. Security headers: no-store caching for authentication responses, no MIME sniffing, no
   framing, no referrer, and HSTS when running in a production-like environment.
"""
from typing import Awaitable, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _header(scope: Scope, name: str) -> Optional[str]:
    needle = name.lower().encode("latin-1")
    for key, value in scope.get("headers", []):
        if key == needle:
            return value.decode("latin-1")
    return None


def _origin_of_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    parts = urlsplit(url)
    if not parts.scheme or not parts.netloc:
        return "invalid"
    return f"{parts.scheme}://{parts.netloc}".lower()


class SecurityMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if scope["method"] in UNSAFE_METHODS:
            origin = _header(scope, "origin")
            claimed = origin.strip().lower() if origin is not None else _origin_of_url(_header(scope, "referer"))
            allowed = {o.lower().rstrip("/") for o in settings.cors_origins}
            if claimed is not None and claimed not in allowed:
                response = JSONResponse(
                    {"detail": "Cross-site request blocked.", "code": "csrf_origin"}, status_code=403
                )
                await response(scope, receive, self._with_headers(scope, send))
                return

        await self.app(scope, receive, self._with_headers(scope, send))

    def _with_headers(self, scope: Scope, send: Send) -> Send:
        path: str = scope.get("path", "")
        extra: List[Tuple[bytes, bytes]] = [
            (b"x-content-type-options", b"nosniff"),
            (b"referrer-policy", b"no-referrer"),
            (b"x-frame-options", b"DENY"),
        ]
        if path.startswith("/api/"):
            extra.append((b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"))
        if path.startswith("/api/auth"):
            extra.append((b"cache-control", b"no-store"))
            extra.append((b"pragma", b"no-cache"))
        if settings.is_production_like:
            extra.append((b"strict-transport-security", b"max-age=31536000; includeSubDomains"))

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                present = {k.lower() for k, _ in headers}
                headers.extend((k, v) for k, v in extra if k not in present)
                message = {**message, "headers": headers}
            await send(message)

        return send_wrapper
