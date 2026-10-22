import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timezone, timedelta
from functools import lru_cache
from typing import Optional, Any, Dict
import bcrypt
import jwt
from app.core.config import settings

JWT_ISSUER = "salvex-api"
BCRYPT_ROUNDS = 12


# ---------------------------------------------------------------- passwords
def _prehash(password: str) -> bytes:
    """
    bcrypt only looks at the first 72 bytes (and bcrypt 5 raises an error beyond that).
    Hashing the password with SHA-256 first and base64-encoding the digest gives bcrypt a
    fixed 44-byte, NUL-free input, so passwords of any length are handled and none is truncated.
    """
    return base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())


def hash_password(password: str) -> str:
    """Hash a password with bcrypt (12 rounds, per-password random salt)."""
    return bcrypt.hashpw(_prehash(password), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a stored hash (constant time inside bcrypt)."""
    try:
        return bcrypt.checkpw(_prehash(plain_password), hashed_password.encode("utf-8"))
    except Exception:
        return False


@lru_cache(maxsize=1)
def _dummy_password_hash() -> str:
    return hash_password(secrets.token_urlsafe(24))


def dummy_password_check(password: str) -> None:
    """Spend the same time as a real password check (used for unknown accounts)."""
    verify_password(password, _dummy_password_hash())


# ---------------------------------------------------------------- one-time codes
def generate_secure_otp(length: int = 6) -> str:
    """Generate a cryptographically secure numeric OTP."""
    return "".join(str(secrets.randbelow(10)) for _ in range(length))


def hash_token(token: str, context: str = "") -> str:
    """
    Keyed hash (HMAC-SHA256) of an OTP or reset token, bound to a context such as
    "<purpose>:<user id>". Because the key is the server secret, a copy of the database alone
    is not enough to brute-force the six-digit codes, and a code for one purpose or user
    can never match another.
    """
    key = settings.APP_SECRET_KEY.encode("utf-8")
    return hmac.new(key, f"{context}|{token}".encode("utf-8"), hashlib.sha256).hexdigest()


def verify_token_hash(plain_token: str, stored_hash: str, context: str = "") -> bool:
    """Compare in constant time."""
    return hmac.compare_digest(hash_token(plain_token, context), stored_hash)


# ---------------------------------------------------------------- CSRF
@lru_cache(maxsize=1)
def _csrf_key() -> bytes:
    return hmac.new(settings.APP_SECRET_KEY.encode("utf-8"), b"salvex-csrf-v1", hashlib.sha256).digest()


def csrf_token_for_session(session_id: str) -> str:
    """Per-session CSRF token. Only code that can read an authenticated response (i.e. our own
    website, not another site) ever learns it."""
    return hmac.new(_csrf_key(), str(session_id).encode("utf-8"), hashlib.sha256).hexdigest()


def verify_csrf_token(session_id: str, provided: Optional[str]) -> bool:
    if not provided:
        return False
    return hmac.compare_digest(csrf_token_for_session(session_id), provided)


# ---------------------------------------------------------------- access tokens
def create_access_token(
    subject: str,
    role: str = "",
    expires_delta: Optional[timedelta] = None,
    extra_claims: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
) -> str:
    """
    Signed JWT. "sid" ties it to a server-side session row so it can be revoked.
    The optional "role" claim is informational only: authorization always uses the role in the
    database, never the token.
    """
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta if expires_delta else timedelta(seconds=settings.session_lifetime_seconds))

    payload: Dict[str, Any] = {
        "sub": str(subject),
        "iss": JWT_ISSUER,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    if role:
        payload["role"] = str(role)
    if session_id:
        payload["sid"] = str(session_id)
    if extra_claims:
        payload.update(extra_claims)

    return jwt.encode(payload, settings.APP_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and verify the signature, issuer and expiry. Returns None if invalid."""
    try:
        return jwt.decode(
            token,
            settings.APP_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            issuer=JWT_ISSUER,
            options={"require": ["exp", "iat", "sub", "iss"]},
        )
    except jwt.PyJWTError:
        return None
