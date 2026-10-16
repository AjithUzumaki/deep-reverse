from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.deps import get_current_user, get_db
from packages.db.models import Conversation, Message, User
from packages.shared.errors import ForbiddenError, NotFoundError

router = APIRouter(prefix="/conversations", tags=["conversations"])


class ConversationOut(BaseModel):
    id: str
    title: str
    pinned: bool
    archived: bool
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, c: Conversation) -> "ConversationOut":
        return cls(
            id=str(c.id),
            title=c.title,
            pinned=c.pinned,
            archived=c.archived_at is not None,
            created_at=c.created_at,
            updated_at=c.updated_at,
        )


class MessageOut(BaseModel):
    id: str
    role: str
    content: list[dict]
    created_at: datetime

    @classmethod
    def from_model(cls, m: Message) -> "MessageOut":
        return cls(id=str(m.id), role=m.role, content=m.content, created_at=m.created_at)


class ConversationDetail(ConversationOut):
    messages: list[MessageOut]


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=200)


class ConversationPatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    pinned: bool | None = None
    archived: bool | None = None


async def _get_owned_conversation(db: AsyncSession, conversation_id: str, user: User) -> Conversation:
    try:
        conv_id = UUID(conversation_id)
    except ValueError:
        raise NotFoundError("Conversation not found")

    conv = await db.get(Conversation, conv_id)
    if conv is None:
        raise NotFoundError("Conversation not found")
    if conv.user_id != user.id:
        # 404 rather than 403 would also be defensible (avoids confirming
        # the id exists at all) — 403 is fine here since ids are UUIDs
        # and not guessable/enumerable in practice.
        raise ForbiddenError("You don't have access to this conversation")
    return conv


@router.get("", response_model=list[ConversationOut])
async def list_conversations(
    include_archived: bool = Query(default=False),
    limit: int = Query(default=50, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Conversation).where(Conversation.user_id == user.id)
    if not include_archived:
        stmt = stmt.where(Conversation.archived_at.is_(None))
    stmt = stmt.order_by(Conversation.pinned.desc(), Conversation.updated_at.desc()).limit(limit)

    result = await db.execute(stmt)
    return [ConversationOut.from_model(c) for c in result.scalars().all()]


@router.post("", response_model=ConversationOut, status_code=201)
async def create_conversation(
    body: ConversationCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conv = Conversation(user_id=user.id, title=body.title or "New conversation")
    db.add(conv)
    await db.flush()
    return ConversationOut.from_model(conv)


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conv = await _get_owned_conversation(db, conversation_id, user)
    result = await db.execute(
        select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at)
    )
    messages = [MessageOut.from_model(m) for m in result.scalars().all()]
    return ConversationDetail(**ConversationOut.from_model(conv).model_dump(), messages=messages)


@router.patch("/{conversation_id}", response_model=ConversationOut)
async def update_conversation(
    conversation_id: str,
    body: ConversationPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conv = await _get_owned_conversation(db, conversation_id, user)

    if body.title is not None:
        conv.title = body.title
    if body.pinned is not None:
        conv.pinned = body.pinned
    if body.archived is not None:
        conv.archived_at = datetime.now(timezone.utc) if body.archived else None
    conv.updated_at = datetime.now(timezone.utc)

    await db.flush()
    return ConversationOut.from_model(conv)


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation(
    conversation_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conv = await _get_owned_conversation(db, conversation_id, user)
    await db.delete(conv)
