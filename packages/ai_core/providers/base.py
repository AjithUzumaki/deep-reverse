"""
The provider abstraction from ARCHITECTURE.md §2.5. Nothing outside
packages/ai_core/providers/ should import a vendor SDK directly — the
orchestrator (and, for now, the chat route) only ever talks to AIProvider.

Two pieces:
  - AIProvider: given a message history, returns a ChatStream.
  - ChatStream: an async-iterable of text chunks that also exposes the
    final token usage once fully consumed — needed because we want to
    stream to the client AND persist accurate token counts afterward.
"""
from dataclasses import dataclass
from typing import AsyncIterator, Protocol


@dataclass
class ChatUsage:
    model: str
    input_tokens: int
    output_tokens: int
    stop_reason: str | None = None


class ChatStream(Protocol):
    def __aiter__(self) -> AsyncIterator[str]: ...

    async def usage(self) -> ChatUsage:
        """Only valid after the stream has been fully consumed."""
        ...


class AIProvider(Protocol):
    name: str

    def stream_chat(
        self,
        messages: list[dict],
        *,
        system: str | None = None,
        max_tokens: int = 1024,
    ) -> ChatStream:
        """messages is [{"role": "user"|"assistant", "content": [...]}, ...]
        using Anthropic-style content blocks — the format our own message
        storage already uses, so no translation layer is needed for the
        first provider. A second provider with a different wire format
        would translate at its own boundary, not here."""
        ...
