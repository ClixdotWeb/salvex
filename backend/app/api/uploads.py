"""Reading a raw file upload (the file itself as the request body) with a hard size limit."""
from fastapi import Request

from app.core.errors import ApiError


def _too_large(limit: int) -> ApiError:
    return ApiError(413, f"The file is too large (at most {limit // (1024 * 1024)} MB).", "file_too_large")


async def read_body_capped(request: Request, limit: int) -> bytes:
    """Refuse early when Content-Length is too big, and stop reading as soon as the body passes the limit."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise _too_large(limit)
    chunks, total = [], 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise _too_large(limit)
        chunks.append(chunk)
    return b"".join(chunks)
