"""
Abuse protection for the authentication endpoints.

IMPORTANT LIMITATION: the default limiter keeps its counters in the memory of ONE server
process. If the API runs with several workers or several instances, each one counts on its
own, so the real limit is (configured limit x number of processes) and a restart forgets all
counters. For a multi-process deployment, replace `limiter` with a shared store (for example
Redis) that implements the same `check_and_record` / `clear` / `reset` methods.
Database-backed protections (one-time-code attempt limits and resend cooldowns, session
revocation) are shared across processes and are not affected by this limitation.

Limits are applied per client IP, per email address (hashed, never stored in clear text) and
per IP+email pair, so one attacker cannot lock a legitimate user out (the IP+email pair is the
strictest), while distributed guessing against one account is still slowed down.
There is deliberately NO permanent or long account lockout: every block expires on its own.
"""
import hashlib
import ipaddress
import threading
import time
from collections import deque
from typing import Deque, Dict, List, Optional, Tuple

from fastapi import Request

from app.core.config import settings
from app.core.errors import ApiError

Rule = Tuple[str, int, int]  # (key, max requests, window in seconds)

# scope -> list of (key kind, limit, window seconds)
POLICIES: Dict[str, List[Tuple[str, int, int]]] = {
    "login": [("ip+email", 8, 900), ("ip", 40, 900), ("email", 30, 900)],
    "register": [("ip", 10, 3600), ("email", 5, 3600)],
    "verify": [("ip+email", 10, 900), ("ip", 60, 900), ("email", 30, 900)],
    "resend": [("email", 5, 3600), ("ip", 20, 3600)],
    "forgot": [("email", 5, 3600), ("ip", 20, 3600)],
    "reset": [("ip+email", 10, 900), ("ip", 60, 900), ("email", 30, 900)],
    "session": [("ip", 600, 60)],
    "upload": [("ip", 60, 600)],      # KYC document uploads
    # vehicle photos + their thumbnails: a bulk upload sends hundreds (admins only, sellers are off)
    "photo": [("ip", 3000, 600)],
    "bid": [("ip", 120, 60), ("email", 30, 60)],   # bids per minute (per network / per bidder)
    "contact": [("ip", 10, 3600), ("email", 5, 3600)],   # contact-page messages
}


class InMemoryRateLimiter:
    """Sliding-window limiter. A request is recorded against every rule only if ALL rules allow it."""

    MAX_KEYS = 200_000

    def __init__(self) -> None:
        self._hits: Dict[str, Deque[float]] = {}
        self._windows: Dict[str, int] = {}
        self._lock = threading.Lock()
        self._ops = 0

    def check_and_record(self, rules: List[Rule], now: Optional[float] = None) -> int:
        """Return 0 if allowed (and record it), otherwise the number of seconds to wait."""
        now = time.monotonic() if now is None else now
        with self._lock:
            self._ops += 1
            if self._ops % 1000 == 0 or len(self._hits) > self.MAX_KEYS:
                self._sweep(now)
            retry = 0
            for key, limit, window in rules:
                hits = self._hits.get(key)
                if not hits:
                    continue
                cutoff = now - window
                while hits and hits[0] <= cutoff:
                    hits.popleft()
                if len(hits) >= limit:
                    retry = max(retry, int(hits[0] + window - now) + 1)
            if retry:
                return retry
            for key, _limit, window in rules:
                self._hits.setdefault(key, deque()).append(now)
                self._windows[key] = window
            return 0

    def clear(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)
            self._windows.pop(key, None)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
            self._windows.clear()

    def _sweep(self, now: float) -> None:
        for key in list(self._hits):
            hits = self._hits[key]
            window = self._windows.get(key, 3600)
            while hits and hits[0] <= now - window:
                hits.popleft()
            if not hits:
                del self._hits[key]
                self._windows.pop(key, None)
        if len(self._hits) > self.MAX_KEYS:  # still too many: forget the least recently used half
            by_age = sorted(self._hits, key=lambda k: self._hits[k][-1])
            for key in by_age[: len(by_age) // 2]:
                del self._hits[key]
                self._windows.pop(key, None)


class FakeAttemptCounter:
    """
    Mimics the "N attempts remaining" behaviour of real one-time codes for emails that have no
    live code, so that the responses for registered and unregistered emails look identical.
    """

    def __init__(self) -> None:
        self._state: Dict[str, Tuple[int, float]] = {}
        self._lock = threading.Lock()

    def attempt(self, key: str, max_attempts: int, ttl_seconds: int, now: Optional[float] = None) -> int:
        """Register one wrong attempt. Returns attempts remaining, or -1 if already used up."""
        now = time.monotonic() if now is None else now
        with self._lock:
            if len(self._state) > 100_000:
                self._state = {k: v for k, v in self._state.items() if now - v[1] < ttl_seconds}
            count, started = self._state.get(key, (0, now))
            if now - started >= ttl_seconds:
                count, started = 0, now
            if count >= max_attempts:
                self._state[key] = (count, started)
                return -1
            count += 1
            self._state[key] = (count, started)
            return max_attempts - count

    def exhaust(self, key: str, max_attempts: int, now: Optional[float] = None) -> None:
        """Mark all attempts as used (mirrors a real code that has just been locked)."""
        now = time.monotonic() if now is None else now
        with self._lock:
            self._state[key] = (max_attempts, now)

    def clear(self, key: str) -> None:
        with self._lock:
            self._state.pop(key, None)

    def reset(self) -> None:
        with self._lock:
            self._state.clear()


limiter = InMemoryRateLimiter()
fake_attempts = FakeAttemptCounter()


def _digest(value: str) -> str:
    return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()[:32]


def email_key(email: str) -> str:
    """Hashed form of an email for use in rate-limit keys and logs."""
    return _digest(email)


def _parse_ip(value: str) -> Optional[str]:
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None


def _is_trusted_proxy(peer: str) -> bool:
    ip = _parse_ip(peer)
    if ip is None:
        return False
    address = ipaddress.ip_address(ip)
    return any(address in network for network in settings.trusted_proxy_networks)


def client_ip(request: Request) -> str:
    """
    The client's IP address, used as a rate-limit key.

    X-Forwarded-For can be written by anyone, so it is only read when BOTH are true:
      * TRUSTED_PROXY_COUNT says how many of our own proxies sit in front of the API, and
      * the direct connection comes from TRUSTED_PROXY_NETWORKS (our private Docker network).
    Each proxy appends the address it received the request from, so the real client is the entry
    TRUSTED_PROXY_COUNT places from the right. Anything a client puts further left is ignored.
    The server must NOT rewrite the connection address from the header itself (uvicorn runs with
    --no-proxy-headers, see backend/Dockerfile), otherwise the peer below would already be forged.
    """
    peer = request.client.host if request.client else "unknown"
    count = settings.TRUSTED_PROXY_COUNT
    if count <= 0 or not _is_trusted_proxy(peer):
        return peer
    forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    if len(forwarded) < count:
        return peer
    return _parse_ip(forwarded[-count]) or peer


def _rules(scope: str, request: Request, email: Optional[str]) -> List[Rule]:
    ip = client_ip(request)
    rules: List[Rule] = []
    for kind, limit, window in POLICIES[scope]:
        if kind == "ip":
            rules.append((f"{scope}:ip:{ip}", limit, window))
        elif kind == "email" and email:
            rules.append((f"{scope}:email:{_digest(email)}", limit, window))
        elif kind == "ip+email" and email:
            rules.append((f"{scope}:pair:{ip}:{_digest(email)}", limit, window))
    return rules


def enforce_rate_limit(scope: str, request: Request, email: Optional[str] = None) -> None:
    """Raise a 429 (with Retry-After) if this request exceeds the policy for the scope."""
    if not settings.RATE_LIMIT_ENABLED:
        return
    retry = limiter.check_and_record(_rules(scope, request, email))
    if retry:
        raise ApiError(
            429,
            f"Too many requests. Please try again in {retry} seconds.",
            "rate_limited",
            headers={"Retry-After": str(retry)},
        )


def forgive_pair(scope: str, request: Request, email: str) -> None:
    """After a successful login, forget the failed-attempt counter for this IP + email pair."""
    limiter.clear(f"{scope}:pair:{client_ip(request)}:{_digest(email)}")
