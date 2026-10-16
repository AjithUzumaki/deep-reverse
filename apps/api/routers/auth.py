from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.deps import get_current_user, get_db
from packages.auth.passwords import hash_password, verify_password
from packages.auth.tokens import create_access_token, hash_refresh_token, new_refresh_token
from packages.db.models import Session as SessionModel
from packages.db.models import User
from packages.shared.config import get_settings
from packages.shared.errors import AuthError, ConflictError

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

REFRESH_COOKIE = "dr_refresh"


class RegisterBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=100)


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


def _set_refresh_cookie(response: Response, token: str, expires_at: datetime) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        httponly=True,
        secure=settings.env != "development",
        samesite="lax",
        expires=expires_at,
        path="/api/v1/auth",
    )


async def _issue_session(db: AsyncSession, user: User, response: Response, *, user_agent: str | None = None) -> str:
    access = create_access_token(str(user.id), role=user.role)
    plaintext, hashed, expires_at = new_refresh_token()
    db.add(SessionModel(user_id=user.id, refresh_hash=hashed, user_agent=user_agent, expires_at=expires_at))
    _set_refresh_cookie(response, plaintext, expires_at)
    return access


def _public_user(user: User) -> dict:
    return {"id": str(user.id), "email": user.email, "display_name": user.display_name}


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(body: RegisterBody, response: Response, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        # Deliberately vague — don't confirm which emails are registered.
        raise ConflictError("Could not create account with those details")

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        display_name=body.display_name,
    )
    db.add(user)
    await db.flush()  # populate user.id before we issue tokens against it

    access = await _issue_session(db, user, response)
    return AuthResponse(access_token=access, user=_public_user(user))


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginBody, response: Response, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()

    if user is None or user.password_hash is None or not verify_password(body.password, user.password_hash):
        raise AuthError("Invalid email or password", code="invalid_credentials")

    access = await _issue_session(db, user, response)
    return AuthResponse(access_token=access, user=_public_user(user))


@router.post("/refresh", response_model=AuthResponse)
async def refresh(
    response: Response,
    db: AsyncSession = Depends(get_db),
    dr_refresh: str | None = Cookie(default=None),
):
    if not dr_refresh:
        raise AuthError("Missing refresh token")

    hashed = hash_refresh_token(dr_refresh)
    result = await db.execute(select(SessionModel).where(SessionModel.refresh_hash == hashed))
    session = result.scalar_one_or_none()

    if session is None:
        raise AuthError("Invalid refresh token")

    if session.revoked_at is not None:
        # A rotated-out token being presented again means the token was
        # copied somewhere it shouldn't have been. Kill every live session
        # for this user rather than trust anything further from it.
        await db.execute(
            update(SessionModel)
            .where(SessionModel.user_id == session.user_id, SessionModel.revoked_at.is_(None))
            .values(revoked_at=datetime.now(timezone.utc))
        )
        raise AuthError("Session invalid — please log in again", code="reuse_detected")

    if session.expires_at < datetime.now(timezone.utc):
        raise AuthError("Refresh token expired")

    user_result = await db.execute(select(User).where(User.id == session.user_id, User.deleted_at.is_(None)))
    user = user_result.scalar_one_or_none()
    if user is None:
        raise AuthError("User not found")

    session.revoked_at = datetime.now(timezone.utc)
    access = await _issue_session(db, user, response)
    return AuthResponse(access_token=access, user=_public_user(user))


@router.post("/logout", status_code=204)
async def logout(
    response: Response,
    db: AsyncSession = Depends(get_db),
    dr_refresh: str | None = Cookie(default=None),
):
    if dr_refresh:
        hashed = hash_refresh_token(dr_refresh)
        await db.execute(
            update(SessionModel)
            .where(SessionModel.refresh_hash == hashed)
            .values(revoked_at=datetime.now(timezone.utc))
        )
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth")


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {**_public_user(user), "role": user.role}
