"""
PasswordHasher interface (port).

The application layer needs to hash and verify passwords but must not know
*how* (bcrypt, argon2, etc.) — that's an infrastructure concern. This keeps
the hashing algorithm swappable (e.g. bcrypt -> argon2id) with zero changes
to use cases.
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class PasswordHasher(ABC):
    @abstractmethod
    def hash(self, plain_password: str) -> str: ...

    @abstractmethod
    def verify(self, plain_password: str, hashed_password: str) -> bool: ...
