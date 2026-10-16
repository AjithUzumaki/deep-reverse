import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.api.core.errors import RequestIDMiddleware, register_error_handlers
from apps.api.routers import auth, chat, conversations, health, images, tools, videos
from packages.db.session import init_db
from packages.shared.config import get_settings
from packages.shared.logging import configure_logging

settings = get_settings()
configure_logging("DEBUG" if settings.debug else "INFO")
logger = logging.getLogger("deep_reverse.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("deep_reverse_api_started", extra={"env": settings.env, "project": settings.project_name})
    yield


app = FastAPI(
    title="DEEP REVERSE API",
    description="Multimodal general-purpose AI assistant platform: Chat, sandboxed code execution, verified math, data analytics, and image generation.",
    version="0.2.0",
    docs_url="/docs" if settings.env != "production" else None,
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(RequestIDMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

register_error_handlers(app)

app.include_router(health.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(conversations.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(tools.router, prefix="/api/v1")
app.include_router(images.router, prefix="/api/v1")
app.include_router(videos.router, prefix="/api/v1")
