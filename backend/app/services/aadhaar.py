"""
Aadhaar number handling. The full number is never stored: only the last 4 digits (to show "XXXX XXXX 1234") and
a keyed hash (HMAC with the app secret) so the same Aadhaar cannot be used for two accounts.
"""
import hashlib
import hmac
import re
from typing import Optional

from app.core.config import settings

# Verhoeff check digit tables (Aadhaar numbers end with a Verhoeff check digit).
_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]


def verhoeff_ok(number: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(number)):
        c = _D[c][_P[i % 8][int(ch)]]
    return c == 0


def clean_aadhaar(value: str) -> Optional[str]:
    """'2345 6789 0124' -> '234567890124' if it is a valid Aadhaar number, else None."""
    digits = re.sub(r"[\s-]", "", value or "")
    if not re.fullmatch(r"[2-9]\d{11}", digits) or not verhoeff_ok(digits):
        return None
    return digits


def aadhaar_hash(number: str) -> str:
    return hmac.new(settings.APP_SECRET_KEY.encode(), b"aadhaar:" + number.encode(), hashlib.sha256).hexdigest()


def masked(last4: Optional[str]) -> Optional[str]:
    return f"XXXX XXXX {last4}" if last4 else None
