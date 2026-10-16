"""
Concrete AIProvider backed by Google's Gemini Developer API (google-genai SDK).
Incorporates DEEP REVERSE persona, empathic mindset comprehension, and strict multilingual mirroring.
"""
from google import genai
from google.genai import types

from packages.ai_core.providers.base import ChatUsage
from packages.ai_core.system_prompt import get_system_prompt


def _to_gemini_contents(messages: list[dict]) -> list[types.Content]:
    contents = []
    for m in messages:
        role = "model" if m["role"] == "assistant" else "user"
        parts = []
        for block in m.get("content", []):
            if block.get("type") == "text" and block.get("text"):
                parts.append(types.Part(text=block["text"]))
            elif block.get("type") == "audio":
                parts.append(types.Part.from_bytes(
                    data=block["data"],
                    mime_type=block["mime_type"],
                ))
            elif block.get("type") in {"image", "document"}:
                parts.append(types.Part.from_bytes(
                    data=block["data"],
                    mime_type=block["mime_type"],
                ))
        contents.append(types.Content(role=role, parts=parts or [types.Part(text="")]))
    return contents


class GeminiChatStream:
    def __init__(
        self,
        client: genai.Client,
        model: str,
        contents: list[types.Content],
        system: str | None,
        max_tokens: int,
    ):
        self._client = client
        self._model = model
        self._contents = contents
        self._system = system
        self._max_tokens = max_tokens
        self._last_usage = None

    async def __aiter__(self):
        config = types.GenerateContentConfig(
            max_output_tokens=self._max_tokens,
            system_instruction=self._system or None,
            temperature=0.7,
        )
        stream = await self._client.aio.models.generate_content_stream(
            model=self._model,
            contents=self._contents,
            config=config,
        )
        async for chunk in stream:
            if chunk.usage_metadata is not None:
                self._last_usage = chunk.usage_metadata
            try:
                text = chunk.text
            except Exception:
                text = None
            if text:
                yield text

    async def usage(self) -> ChatUsage:
        if self._last_usage is None:
            raise RuntimeError("usage() is only available after the stream is fully consumed")
        return ChatUsage(
            model=self._model,
            input_tokens=self._last_usage.prompt_token_count or 0,
            output_tokens=self._last_usage.candidates_token_count or 0,
        )


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str, model: str):
        self._client = genai.Client(api_key=api_key)
        self._model = model

    def stream_chat(
        self,
        messages: list[dict],
        *,
        system: str | None = None,
        max_tokens: int = 4096,
    ) -> GeminiChatStream:
        system_instruction = get_system_prompt(system)
        contents = _to_gemini_contents(messages)
        return GeminiChatStream(self._client, self._model, contents, system_instruction, max_tokens)
