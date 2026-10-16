"""Streaming chat provider for Groq's OpenAI-compatible Chat Completions API."""
import json
from typing import Any

import httpx

from packages.ai_core.providers.base import ChatUsage
from packages.ai_core.system_prompt import get_system_prompt


class GroqChatStream:
    def __init__(self, api_key: str, model: str, messages: list[dict], system: str | None, max_tokens: int):
        self._api_key = api_key
        self._model = model
        self._messages = messages
        self._system = system
        self._max_tokens = max_tokens
        self._usage: ChatUsage | None = None

    async def __aiter__(self):
        messages: list[dict[str, str]] = []
        if self._system:
            messages.append({"role": "system", "content": self._system})

        for message in self._messages:
            content = "\n".join(
                block["text"]
                for block in message.get("content", [])
                if block.get("type") == "text" and block.get("text")
            )
            if content:
                messages.append({
                    "role": "assistant" if message["role"] == "assistant" else "user",
                    "content": content,
                })

        request = {
            "model": self._model,
            "messages": messages,
            "max_completion_tokens": self._max_tokens,
            "temperature": 0.7,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        timeout = httpx.Timeout(120.0, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                },
                json=request,
            ) as response:
                if response.is_error:
                    await response.aread()
                    response.raise_for_status()

                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload_text = line[5:].strip()
                    if payload_text == "[DONE]":
                        break
                    try:
                        payload: dict[str, Any] = json.loads(payload_text)
                    except json.JSONDecodeError:
                        continue

                    usage = payload.get("usage")
                    if usage:
                        self._usage = ChatUsage(
                            model=self._model,
                            input_tokens=usage.get("prompt_tokens", 0),
                            output_tokens=usage.get("completion_tokens", 0),
                        )

                    choices = payload.get("choices") or []
                    if not choices:
                        continue
                    delta = (choices[0].get("delta") or {}).get("content")
                    if isinstance(delta, str) and delta:
                        yield delta

    async def usage(self) -> ChatUsage:
        if self._usage is None:
            raise RuntimeError("Groq did not include token usage in the completed stream")
        return self._usage


class GroqProvider:
    name = "groq"

    def __init__(self, api_key: str, model: str):
        self._api_key = api_key
        self._model = model

    def stream_chat(
        self,
        messages: list[dict],
        *,
        system: str | None = None,
        max_tokens: int = 4096,
    ) -> GroqChatStream:
        return GroqChatStream(
            self._api_key,
            self._model,
            messages,
            get_system_prompt(system),
            max_tokens,
        )
