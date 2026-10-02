from __future__ import annotations

import pytest

from app.domain.value_objects.email import Email


def test_email_normalizes_case_and_whitespace() -> None:
    assert str(Email("  User@Example.COM ")) == "user@example.com"


@pytest.mark.parametrize("invalid", ["not-an-email", "missing-domain@", "@missing-local.com", ""])
def test_email_rejects_invalid_format(invalid: str) -> None:
    with pytest.raises(ValueError):
        Email(invalid)


def test_email_equality_is_value_based() -> None:
    assert Email("a@example.com") == Email("A@Example.com")
