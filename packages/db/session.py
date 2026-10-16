"""
Async engine and session factory for DEEP REVERSE.
Supports PostgreSQL (with asyncpg) and SQLite (with aiosqlite).
Automatically initializes database schema if running in local standalone mode.
"""
import os
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from packages.db.models import Base
from packages.shared.config import get_settings

logger = logging.getLogger("deep_reverse.db")
settings = get_settings()

raw_url = settings.database_url

# A service URL such as "db" only resolves inside the Compose network. Use
# SQLite for a local standalone run, but keep PostgreSQL when this process is
# running inside the container where the "db" service is reachable.
running_in_container = os.path.exists("/.dockerenv") or os.environ.get("APP_IN_CONTAINER") == "true"
if "sqlite" in raw_url or ("@db:" in raw_url and not running_in_container):
    _url = "sqlite+aiosqlite:///deep_reverse.db"
else:
    _url = raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)

if _url.startswith("sqlite"):
    engine = create_async_engine(_url, echo=False)
else:
    engine = create_async_engine(_url, pool_size=10, max_overflow=20, pool_pre_ping=True)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def init_db():
    """Create all database tables on startup if they don't exist yet."""
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("database_initialized", extra={"url": _url.split("@")[-1] if "@" in _url else "sqlite"})
    except Exception as e:
        logger.warning(f"Database auto-init notice: {e}")


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
