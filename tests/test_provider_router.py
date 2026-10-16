import os

os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost:5432/x")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("JWT_SECRET", "test-secret")

import pytest  # noqa: E402

from packages.ai_core.providers.anthropic_provider import AnthropicProvider  # noqa: E402
from packages.ai_core.providers.gemini_provider import GeminiProvider  # noqa: E402
from packages.shared.errors import ProviderError  # noqa: E402


def _fresh_get_provider(monkeypatch, **env):
    """get_provider() is @lru_cache'd, so re-import a clean copy per test
    rather than fighting the cache across test cases."""
    for key in ("AI_PROVIDER", "AI_API_KEY", "ANTHROPIC_MODEL", "GEMINI_MODEL"):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)

    from packages.shared.config import get_settings
    get_settings.cache_clear()

    import importlib
    import packages.ai_core.router as router_module
    importlib.reload(router_module)
    return router_module.get_provider


def test_unconfigured_provider_raises(monkeypatch):
    get_provider = _fresh_get_provider(monkeypatch, AI_PROVIDER="")
    with pytest.raises(ProviderError) as exc_info:
        get_provider()
    assert exc_info.value.code == "provider_not_configured"


def test_anthropic_without_api_key_raises(monkeypatch):
    get_provider = _fresh_get_provider(monkeypatch, AI_PROVIDER="anthropic", AI_API_KEY="")
    with pytest.raises(ProviderError) as exc_info:
        get_provider()
    assert "AI_API_KEY" in exc_info.value.message


def test_anthropic_with_key_returns_provider(monkeypatch):
    get_provider = _fresh_get_provider(
        monkeypatch, AI_PROVIDER="anthropic", AI_API_KEY="sk-ant-test-key", ANTHROPIC_MODEL="claude-sonnet-5"
    )
    provider = get_provider()
    assert isinstance(provider, AnthropicProvider)
    assert provider.name == "anthropic"


def test_gemini_without_api_key_raises(monkeypatch):
    get_provider = _fresh_get_provider(monkeypatch, AI_PROVIDER="gemini", AI_API_KEY="")
    with pytest.raises(ProviderError) as exc_info:
        get_provider()
    assert "AI_API_KEY" in exc_info.value.message


def test_gemini_with_key_returns_provider(monkeypatch):
    get_provider = _fresh_get_provider(
        monkeypatch, AI_PROVIDER="gemini", AI_API_KEY="test-gemini-key", GEMINI_MODEL="gemini-2.5-flash"
    )
    provider = get_provider()
    assert isinstance(provider, GeminiProvider)
    assert provider.name == "gemini"


def test_unknown_provider_name_raises(monkeypatch):
    get_provider = _fresh_get_provider(monkeypatch, AI_PROVIDER="made-up-provider")
    with pytest.raises(ProviderError):
        get_provider()
