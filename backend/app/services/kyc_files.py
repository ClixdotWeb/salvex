"""
Checks on uploaded KYC files. The type is decided from the file's own bytes ("magic numbers"), never from
the name or the Content-Type the client claims; the claim must simply agree with what the bytes are.

Accepted: PDF, JPEG, PNG. PDFs that declare active content (scripts, launch actions, embedded files,
forms that run code) are refused. This is a best-effort structural check, NOT a virus scan: compressed
object streams can hide such markers. Files are therefore only ever downloaded as attachments with
`nosniff` and a sandboxing Content-Security-Policy, never shown inline by the API. Malware scanning is a
pending company/hosting decision (docs/MASTER_PLAN.md).
"""
import re
from typing import Optional

from app.core.errors import ApiError

PDF, JPEG, PNG = "application/pdf", "image/jpeg", "image/png"
EXTENSIONS = {PDF: "pdf", JPEG: "jpg", PNG: "png"}

_PDF_ACTIVE = re.compile(rb"/(JavaScript|JS|Launch|EmbeddedFile|EmbeddedFiles|RichMedia|XFA|AA|SubmitForm|ImportData)(?![A-Za-z0-9])")


def detect_content_type(data: bytes) -> Optional[str]:
    if data.startswith(b"%PDF-"):
        return PDF
    if data.startswith(b"\x89PNG\r\n\x1a\n") and data[12:16] == b"IHDR":
        return PNG
    if data.startswith(b"\xff\xd8\xff"):
        return JPEG
    return None


def validate_upload(data: bytes, declared_type: Optional[str], max_bytes: int, allowed=(PDF, JPEG, PNG)) -> str:
    """Return the verified content type, or raise ApiError (413 too large, 415 unsupported, 422 unsafe)."""
    if len(data) > max_bytes:
        raise ApiError(413, f"The file is too large (at most {max_bytes // (1024 * 1024)} MB).", "file_too_large")
    if not data:
        raise ApiError(422, "The file is empty.", "file_empty")
    declared = (declared_type or "").split(";")[0].strip().lower()
    if declared == "image/jpg":
        declared = JPEG
    actual = detect_content_type(data)
    if actual is None or declared not in allowed:
        labels = [EXTENSIONS[t].upper().replace("JPG", "JPEG") for t in allowed]
        names = labels[0] if len(labels) == 1 else ", ".join(labels[:-1]) + " and " + labels[-1]
        raise ApiError(415, f"Only {names} files are accepted.", "unsupported_file_type")
    if actual != declared:
        raise ApiError(415, "The file's contents do not match its declared type.", "file_type_mismatch")
    if actual == PDF:
        if _PDF_ACTIVE.search(data):
            raise ApiError(422, "PDFs with scripts, actions, forms or attachments are not accepted.", "unsafe_pdf")
        if b"%%EOF" not in data[-2048:]:
            raise ApiError(422, "The PDF appears to be incomplete or damaged.", "damaged_file")
    elif actual == PNG and b"IEND" not in data[-64:]:
        raise ApiError(422, "The image appears to be incomplete or damaged.", "damaged_file")
    elif actual == JPEG and not data.rstrip(b"\x00").endswith(b"\xff\xd9"):
        raise ApiError(422, "The image appears to be incomplete or damaged.", "damaged_file")
    return actual
