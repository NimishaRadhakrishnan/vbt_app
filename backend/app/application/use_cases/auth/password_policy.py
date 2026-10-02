"""
Password policy.

A small, explicit, testable business rule: what makes a password acceptable.
Kept in the application layer (not domain) because it's a policy that could
plausibly change per deployment/tenant later, whereas domain entities encode
invariants that must always hold.
"""

from __future__ import annotations

from app.domain.exceptions.domain_exceptions import WeakPasswordException

MIN_LENGTH = 10


def enforce_password_policy(password: str) -> None:
    if len(password) < MIN_LENGTH:
        raise WeakPasswordException(f"Password must be at least {MIN_LENGTH} characters long.")
    if not any(c.isupper() for c in password):
        raise WeakPasswordException("Password must contain at least one uppercase letter.")
    if not any(c.islower() for c in password):
        raise WeakPasswordException("Password must contain at least one lowercase letter.")
    if not any(c.isdigit() for c in password):
        raise WeakPasswordException("Password must contain at least one digit.")
