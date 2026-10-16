"""
Concrete AIProvider backed by the Anthropic Messages API.
Incorporates DEEP REVERSE persona, empathic mindset comprehension, and strict multilingual mirroring.
"""
import base64

from anthropic import AsyncAnthropic

from packages.ai_core.providers.base import ChatUsage
from packages.ai_core.system_prompt import get_system_prompt


class AnthropicChatStream:
    def __init__(self, stream_manager):
        self._manager = stream_manager
        self._final = None

    async def __aiter__(self):
        stream = await self._manager.__aenter__()
        try:
            async for text in stream.text_stream:
                yield text
            self._final = await stream.get_final_message()
        finally:
            await self._manager.__aexit__(None, None, None)

    async def usage(self) -> ChatUsage:
        if self._final is None:
            raise RuntimeError("usage() is only available after the stream is fully consumed")
        return ChatUsage(
            model=self._final.model,
            input_tokens=self._final.usage.input_tokens,
            output_tokens=self._final.usage.output_tokens,
            stop_reason=self._final.stop_reason,
        )


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str, model: str):
        self._client = AsyncAnthropic(api_key=api_key)
        self._model = model

    def stream_chat(
        self,
        messages: list[dict],
        *,
        system: str | None = None,
        max_tokens: int = 4096,
    ) -> AnthropicChatStream:
        system_instruction = get_system_prompt(system)
        anthropic_messages = []
        for message in messages:
            content = []
            for block in message.get("content", []):
                if block.get("type") in {"image", "document"}:
                    mime_type = block["mime_type"]
                    source = {
                        "type": "base64",
                        "media_type": mime_type,
                        "data": base64.b64encode(block["data"]).decode("ascii"),
                    }
                    if block["type"] == "image":
                        content.append({"type": "image", "source": source})
                    else:
                        content.append({"type": "document", "source": source})
                else:
                    content.append(block)
            anthropic_messages.append({"role": message["role"], "content": content})
        kwargs = {
            "model": self._model,
            "max_tokens": max_tokens,
            "messages": anthropic_messages,
            "system": system_instruction,
        }
        manager = self._client.messages.stream(**kwargs)
        return AnthropicChatStream(manager)
