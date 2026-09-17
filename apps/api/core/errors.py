import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from packages.shared.errors import AppError

logger = logging.getLogger("deep_reverse.api")


def _envelope(code: str, message: str, request_id: str) -> dict:
    return {"error": {"code": code, "message": message, "request_id": request_id}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError):
        request_id = getattr(request.state, "request_id", "-")
        logger.warning("app_error", extra={"request_id": request_id, "code": exc.code})
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(exc.code, exc.message, request_id),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError):
        request_id = getattr(request.state, "request_id", "-")
        return JSONResponse(
            status_code=422,
            content=_envelope("validation_error", "Invalid request body", request_id),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception):
        request_id = getattr(request.state, "request_id", "-")
        # Full detail goes to logs only. The client never sees a stack trace.
        logger.exception("unhandled_exception", extra={"request_id": request_id})
        return JSONResponse(
            status_code=500,
            content=_envelope("internal_error", "Something went wrong. Please try again.", request_id),
        )


class RequestIDMiddleware:
    """Bare-bones ASGI middleware that stamps every request with an id,
    used for log correlation and returned in error envelopes."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        request_id = str(uuid.uuid4())
        scope.setdefault("state", {})

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                headers.append((b"x-request-id", request_id.encode()))
            await send(message)

        scope["state"]["request_id"] = request_id
        await self.app(scope, receive, send_wrapper)
