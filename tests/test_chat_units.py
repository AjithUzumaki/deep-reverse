import os

os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost:5432/x")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("JWT_SECRET", "test-secret")

from apps.api.routers.chat import _derive_title, _sse  # noqa: E402


def test_derive_title_uses_first_line():
    assert _derive_title("What's the capital of France?\nAnd why?") == "What's the capital of France?"


def test_derive_title_truncates_long_messages():
    long_message = "x" * 100
    title = _derive_title(long_message)
    assert len(title) == 61  # 60 chars + ellipsis
    assert title.endswith("…")


def test_derive_title_handles_empty_message():
    assert _derive_title("   ") == "New conversation"


def test_sse_format_is_well_formed():
    event = _sse("delta", {"text": "hello"})
    assert event.startswith("event: delta\n")
    assert '"text": "hello"' in event or '"text":"hello"' in event
    assert event.endswith("\n\n")
