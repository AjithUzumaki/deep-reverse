"""
Two token types, deliberately different:

- Access token: short-lived JWT, stateless, carried in the Authorization
  header, never stored server-side. Cheap to verify on every request.
- Refresh token: opaque random string, long-lived, stored ONLY as a hash
  in `sessions.refresh_hash` (httpOnly cookie on the client). Rotated on
  every use; if a used-and-already-rotated token is presented again, that
  is reuse (token theft) and the whole session family is revoked.
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import jwt

from packages.shared.config import get_settings

settings = get_settings()


def create_access_token(user_id: str, *, role: str = "user") -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_ttl_minutes),
        "type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Raises jwt.PyJWTError subclasses on invalid/expired tokens —
    callers should catch and translate to AuthError."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


def new_refresh_token() -> tuple[str, str, datetime]:
    """Returns (plaintext_token, sha256_hash, expires_at). Store only the
    hash; hand the plaintext to the client in an httpOnly cookie."""
    plaintext = secrets.token_urlsafe(48)
    hashed = hash_refresh_token(plaintext)
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_ttl_days)
    return plaintext, hashed, expires_at


def hash_refresh_token(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode()).hexdigest()
