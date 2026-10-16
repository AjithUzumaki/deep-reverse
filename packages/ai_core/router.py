"""
This is deliberately the ONLY place that picks a concrete provider by
name. Adding a second provider later means adding a branch here and a
new file under providers/ — nothing else in the app should need to know
which vendor is behind AIProvider.

Ring 2 upgrades this into the full ModelRouter from ARCHITECTURE.md §2.5
(routing by capability/complexity/cost, not just a single fixed choice).
For now, Phase 1 needs exactly one working provider end to end.
"""
from functools import lru_cache

from packages.ai_core.providers.anthropic_provider import AnthropicProvider
from packages.ai_core.providers.base import AIProvider
from packages.ai_core.providers.gemini_provider import GeminiProvider
from packages.ai_core.providers.groq_provider import GroqProvider
from packages.ai_core.providers.ollama_provider import OllamaProvider
from packages.shared.config import get_settings
from packages.shared.errors import ProviderError


@lru_cache
def get_provider() -> AIProvider:
    settings = get_settings()

    if settings.ai_provider == "anthropic":
        if not settings.ai_api_key:
            raise ProviderError(
                "AI_API_KEY is not set. Add your Anthropic API key to .env to enable chat.",
                code="provider_not_configured",
            )
        return AnthropicProvider(api_key=settings.ai_api_key, model=settings.anthropic_model)

    if settings.ai_provider == "gemini":
        if not settings.ai_api_key:
            raise ProviderError(
                "AI_API_KEY is not set. Add your Gemini API key to .env to enable chat.",
                code="provider_not_configured",
            )
        return GeminiProvider(api_key=settings.ai_api_key, model=settings.gemini_model)

    if settings.ai_provider == "groq":
        if not settings.groq_api_key:
            raise ProviderError(
                "GROQ_API_KEY is not set. Add a Groq API key to .env to enable chat.",
                code="provider_not_configured",
            )
        return GroqProvider(api_key=settings.groq_api_key, model=settings.groq_model)

    if settings.ai_provider == "ollama":
        return OllamaProvider(base_url=settings.ollama_base_url, model=settings.ollama_model)

    raise ProviderError(
        f"AI_PROVIDER is set to {settings.ai_provider!r}, which isn't supported yet. "
        "Set AI_PROVIDER=anthropic, gemini, groq, or ollama in .env.",
        code="provider_not_configured",
    )


@lru_cache
def get_chat_fallbacks() -> list[AIProvider]:
    """Return optional text-only fallbacks, preferring local Ollama over Groq."""
    settings = get_settings()
    fallbacks: list[AIProvider] = []
    if settings.ollama_enabled and settings.ai_provider != "ollama":
        fallbacks.append(OllamaProvider(base_url=settings.ollama_base_url, model=settings.ollama_model))
    if settings.groq_api_key and settings.ai_provider != "groq":
        fallbacks.append(GroqProvider(api_key=settings.groq_api_key, model=settings.groq_model))
    return fallbacks
