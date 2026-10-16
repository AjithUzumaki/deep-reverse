"""Streaming chat provider for a local Ollama server."""
import json
from typing import Any

import httpx

from packages.ai_core.providers.base import ChatUsage
from packages.ai_core.system_prompt import get_system_prompt


class OllamaChatStream:
    def __init__(
        self,
        base_url: str,
        model: str,
        messages: list[dict],
        system: str | None,
        max_tokens: int,
    ):
        self._base_url = base_url.rstrip("/")
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
            "stream": True,
            "think": False,
            "options": {"num_predict": self._max_tokens},
        }
        timeout = httpx.Timeout(300.0, connect=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{self._base_url}/api/chat",
                headers={"Content-Type": "application/json", "Accept": "application/x-ndjson"},
                json=request,
            ) as response:
                if response.is_error:
                    await response.aread()
                    response.raise_for_status()

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        payload: dict[str, Any] = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    message = payload.get("message") or {}
                    content = message.get("content")
                    if isinstance(content, str) and content:
                        yield content

                    if payload.get("done"):
                        self._usage = ChatUsage(
                            model=payload.get("model") or self._model,
                            input_tokens=payload.get("prompt_eval_count", 0),
                            output_tokens=payload.get("eval_count", 0),
                        )

    async def usage(self) -> ChatUsage:
        if self._usage is None:
            raise RuntimeError("Ollama did not include token usage in the completed stream")
        return self._usage


class OllamaProvider:
    name = "ollama"

    def __init__(self, base_url: str, model: str):
        self._base_url = base_url
        self._model = model

    def stream_chat(
        self,
        messages: list[dict],
        *,
        system: str | None = None,
        max_tokens: int = 4096,
    ) -> OllamaChatStream:
        return OllamaChatStream(
            self._base_url,
            self._model,
            messages,
            get_system_prompt(system),
            max_tokens,
        )
