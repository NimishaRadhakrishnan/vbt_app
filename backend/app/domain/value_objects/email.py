"""
Email value object.

Encapsulates the validation rule "what makes a string a valid email" in one
place so it can never be bypassed by constructing a User with a raw string.
Value objects are immutable and compare by value, not identity.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@dataclass(frozen=True)
class Email:
    value: str

    def __post_init__(self) -> None:
        normalized = self.value.strip().lower()
        if not _EMAIL_PATTERN.match(normalized):
            raise ValueError(f"'{self.value}' is not a valid email address.")
        object.__setattr__(self, "value", normalized)

    def __str__(self) -> str:
        return self.value
