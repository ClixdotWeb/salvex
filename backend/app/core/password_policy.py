"""
Password rules, following current guidance (length matters; no forced character classes):
  - 8 to 128 characters
  - not one of the most common passwords
  - not the same as the account's email address
"""
from typing import Optional

MIN_LENGTH = 8
MAX_LENGTH = 128

# A small deny-list of the most common passwords that satisfy the length rule.
_COMMON_PASSWORDS = frozenset({
    "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "p@ssword",
    "12345678", "123456789", "1234567890", "11111111", "00000000", "87654321", "123123123",
    "qwertyui", "qwerty123", "qwertyuiop", "1q2w3e4r", "1qaz2wsx", "abcd1234", "abc12345",
    "iloveyou", "letmein1", "welcome1", "welcome123", "admin123", "administrator", "changeme",
    "football", "baseball", "monkey123", "dragon123", "sunshine", "princess", "trustno1",
    "salvex123", "salvex@123", "salvexauction",
})


# Very common words that stay weak when digits or symbols are tacked on the end ("password1234", "admin@2026").
_COMMON_STEMS = frozenset({
    "password", "passw0rd", "p@ssw0rd", "p@ssword", "qwerty", "qwertyuiop", "qwertyui", "admin", "administrator",
    "welcome", "letmein", "iloveyou", "monkey", "dragon", "football", "baseball", "sunshine", "princess",
    "trustno", "changeme", "abc", "abcd", "abcdef", "login", "master", "test", "testing", "secret", "salvex",
    "salvexauction", "auction", "bidder", "seller",
})
_TRAILING = "0123456789!@#$%^&*._-"


def validate_password_strength(password: str, email: Optional[str] = None) -> str:
    """Return the password if acceptable, otherwise raise ValueError with a user-safe message."""
    if len(password) < MIN_LENGTH:
        raise ValueError(f"Password must be at least {MIN_LENGTH} characters long.")
    if len(password) > MAX_LENGTH:
        raise ValueError(f"Password must be at most {MAX_LENGTH} characters long.")
    if password.lower() in _COMMON_PASSWORDS or password.lower().rstrip(_TRAILING) in _COMMON_STEMS:
        raise ValueError("This password is too common. Please choose a different one.")
    if email and password.lower() == email.strip().lower():
        raise ValueError("Password must not be the same as your email address.")
    if password.strip() == "":
        raise ValueError("Password must not be only spaces.")
    return password
