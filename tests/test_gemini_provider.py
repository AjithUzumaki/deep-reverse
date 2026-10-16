import os

os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost:5432/x")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("JWT_SECRET", "test-secret")

from packages.ai_core.providers.gemini_provider import _to_gemini_contents  # noqa: E402


def test_assistant_role_maps_to_model():
    messages = [{"role": "assistant", "content": [{"type": "text", "text": "hi"}]}]
    contents = _to_gemini_contents(messages)
    assert contents[0].role == "model"


def test_user_role_stays_user():
    messages = [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]
    contents = _to_gemini_contents(messages)
    assert contents[0].role == "user"


def test_text_blocks_are_concatenated():
    messages = [{"role": "user", "content": [{"type": "text", "text": "hello "}, {"type": "text", "text": "world"}]}]
    contents = _to_gemini_contents(messages)
    assert contents[0].parts[0].text == "hello world"


def test_preserves_message_order():
    messages = [
        {"role": "user", "content": [{"type": "text", "text": "first"}]},
        {"role": "assistant", "content": [{"type": "text", "text": "second"}]},
    ]
    contents = _to_gemini_contents(messages)
    assert [c.parts[0].text for c in contents] == ["first", "second"]
