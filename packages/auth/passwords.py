"""
Argon2id password hashing. Never use bcrypt/md5/sha256-for-passwords —
argon2id is the current recommended KDF for password storage.
"""
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_hasher = PasswordHasher(
    time_cost=3,        # iterations
    memory_cost=65536,  # 64 MB
    parallelism=2,
    hash_len=32,
)


def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, plain)
    except VerifyMismatchError:
        return False


def needs_rehash(hashed: str) -> bool:
    """Call after a successful verify; if True, re-hash and update storage
    (lets you bump cost parameters over time without forcing resets)."""
    return _hasher.check_needs_rehash(hashed)
