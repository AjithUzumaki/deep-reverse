import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.api.core.errors import RequestIDMiddleware, register_error_handlers
from apps.api.routers import auth, health
from packages.shared.config import get_settings
from packages.shared.logging import configure_logging

settings = get_settings()
configure_logging("DEBUG" if settings.debug else "INFO")
logger = logging.getLogger("deep_reverse.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("deep_reverse_api_started", extra={"env": settings.env})
    yield


app = FastAPI(
    title="DEEP REVERSE API",
    version="0.1.0",
    docs_url="/docs" if settings.env != "production" else None,
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(RequestIDMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

register_error_handlers(app)

app.include_router(health.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")

# Ring 2+ routers (chat, files, images, memory, tools) plug in here as they
# land — see docs/API.md for the full planned surface. Keeping them out of
# main.py until they're real, per the no-placeholder-endpoints rule.
