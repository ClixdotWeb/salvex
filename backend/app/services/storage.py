"""
Private file storage behind a small adapter, so the backing store can change (local disk now; an object
store once hosting is decided) without touching the KYC code.

Rules every adapter must keep:
  * files are PRIVATE: there is no public URL; the only way to read one is the authorised API route;
  * the key is generated here from random bytes - nothing the user sent ever becomes part of a path;
  * keys are validated on every read, so a stored key can never point outside the storage area.

The local-disk adapter is for development and staging. Production storage (provider, encryption at
rest, backups, retention) is a pending company decision; see docs/MASTER_PLAN.md.
"""
import os
import re
import secrets
from pathlib import Path
from typing import Protocol

from app.core.config import settings

AREAS = ("kyc", "vehicles", "parts")
_KEY = re.compile(r"^(kyc|vehicles|parts)/[0-9a-f]{32}$")


class StorageError(Exception):
    """A storage operation failed or was given an invalid key."""


class PrivateStorage(Protocol):
    def save(self, data: bytes, area: str = "kyc") -> str: ...
    def read(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...


class LocalPrivateStorage:
    def __init__(self, root: str | os.PathLike) -> None:
        self.root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        if not _KEY.match(key or ""):
            raise StorageError("invalid storage key")
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise StorageError("invalid storage key")
        return path

    def save(self, data: bytes, area: str = "kyc") -> str:
        if area not in AREAS:
            raise StorageError("unknown storage area")
        key = f"{area}/{secrets.token_hex(16)}"
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(path.name + ".part")
        # Write to a temporary name, then rename: a reader never sees a half-written file.
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.replace(temp, path)
        except BaseException:
            temp.unlink(missing_ok=True)
            raise
        return key

    def read(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError:
            raise StorageError("file missing from storage") from None

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


_storage: PrivateStorage | None = None


def get_private_storage() -> PrivateStorage:
    """FastAPI dependency (tests replace it with a temporary folder)."""
    global _storage
    if _storage is None:
        _storage = LocalPrivateStorage(settings.KYC_STORAGE_DIR)
    return _storage
