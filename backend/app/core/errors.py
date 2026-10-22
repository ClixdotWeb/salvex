"""
Uniform API errors: {"detail": "<message>", "code": "<machine_code>"}.
`detail` is for people, `code` is for the website to react to without parsing text.
"""
from typing import Dict, Optional
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status_code: int, detail: str, code: str, headers: Optional[Dict[str, str]] = None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code
        self.headers = headers or {}


async def _handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "code": exc.code},
        headers=exc.headers,
    )


async def _handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """
    FastAPI's default 422 body echoes the submitted values back ("input"), which would reflect
    passwords and codes. Return only where the problem is and a plain message.
    """
    problems = []
    for item in exc.errors():
        message = str(item.get("msg", "Invalid value"))
        if message.startswith("Value error, "):
            message = message[len("Value error, "):]
        problems.append({"loc": [str(part) for part in item.get("loc", [])], "msg": message})
    return JSONResponse(status_code=422, content={"detail": problems, "code": "validation_error"})


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _handle_api_error)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _handle_validation_error)  # type: ignore[arg-type]
