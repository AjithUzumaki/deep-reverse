import os

os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost:5432/x")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("JWT_SECRET", "test-secret")

from packages.auth.passwords import hash_password, verify_password  # noqa: E402
from packages.auth.tokens import create_access_token, decode_access_token, hash_refresh_token, new_refresh_token  # noqa: E402


def test_password_hash_roundtrip():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", hashed)
    assert not verify_password("wrong password", hashed)


def test_password_hash_is_not_plaintext():
    hashed = hash_password("secret123")
    assert hashed != "secret123"
    assert hashed.startswith("$argon2id$")


def test_access_token_roundtrip():
    token = create_access_token("11111111-1111-1111-1111-111111111111", role="user")
    payload = decode_access_token(token)
    assert payload["sub"] == "11111111-1111-1111-1111-111111111111"
    assert payload["role"] == "user"
    assert payload["type"] == "access"


def test_refresh_token_hash_is_deterministic():
    plaintext, hashed, expires_at = new_refresh_token()
    assert hash_refresh_token(plaintext) == hashed
    assert len(plaintext) > 32
    assert expires_at is not None
