from typing import AsyncIterator
from uuid import UUID

import jwt
from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from packages.auth.tokens import decode_access_token
from packages.db.models import User
from packages.db.session import SessionLocal
from packages.shared.errors import AuthError


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_current_user(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise AuthError("Missing or malformed Authorization header")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        raise AuthError("Access token expired", code="token_expired")
    except jwt.PyJWTError:
        raise AuthError("Invalid access token")

    user_id = payload.get("sub")
    if not user_id:
        raise AuthError("Invalid access token")

    result = await db.execute(select(User).where(User.id == UUID(user_id), User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()
    if user is None:
        raise AuthError("User not found")
    return user
