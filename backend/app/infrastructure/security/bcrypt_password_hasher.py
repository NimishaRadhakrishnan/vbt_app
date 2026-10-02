"""
BcryptPasswordHasher.

Uses passlib's bcrypt scheme. Bcrypt is chosen over plain sha/md5-family
hashes because it is deliberately slow and includes a built-in per-hash
salt, which is the baseline expectation for credential storage. (argon2id
is a reasonable future upgrade; swapping it in only requires a new class
implementing the same PasswordHasher port.)
"""

from __future__ import annotations

from passlib.context import CryptContext

from app.application.interfaces.password_hasher import PasswordHasher

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class BcryptPasswordHasher(PasswordHasher):
    def hash(self, plain_password: str) -> str:
        return _pwd_context.hash(plain_password)

    def verify(self, plain_password: str, hashed_password: str) -> bool:
        return _pwd_context.verify(plain_password, hashed_password)
