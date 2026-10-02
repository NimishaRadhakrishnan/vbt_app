"""
Location consent gate + knowledge auto-feed policy.

Two features, one file, because both are small and both are about a rule
being enforced where it cannot be bypassed rather than where it is
convenient.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.application.services.knowledge_autofeed_service import (
    MIN_REUSABLE_LENGTH,
    assess_reply,
    auto_create_knowledge_case,
)

# ---------------------------------------------------------------------------
# Consent
# ---------------------------------------------------------------------------


@pytest.fixture
async def officer_without_consent(db_session):
    officer_id = (
        await db_session.execute(
            text("SELECT id FROM users WHERE role = 'field_officer' LIMIT 1")
        )
    ).scalar_one()
    await db_session.execute(
    text("DELETE FROM location_consent_acceptances WHERE user_id = :u")
        .bindparams(u=officer_id)
    )
    await db_session.commit()
    yield officer_id
    await db_session.execute(
    text("DELETE FROM location_consent_acceptances WHERE user_id = :u")
        .bindparams(u=officer_id)
    )
    await db_session.commit()


async def test_exactly_one_disclosure_is_active(db_session):
    """Enforced by a partial unique index, not by application code.

    "Which notice is current?" must never have two answers - an officer
    accepting one version while the guard checks another would be a
    consent record that proves nothing.
    """
    count = (
        await db_session.execute(
            text("SELECT COUNT(*) FROM location_disclosure_versions WHERE is_active")
        )
    ).scalar_one()
    assert count == 1

    with pytest.raises(Exception) as exc:
        await db_session.execute(
            text(
                """
                INSERT INTO location_disclosure_versions
                    (version, title, points, footer, retention_months, is_active)
                VALUES (99, 't', '[]'::jsonb, 'f', 12, true)
                """
            )
        )
        await db_session.flush()
    assert "uq_location_disclosure_one_active" in str(exc.value)
    await db_session.rollback()


async def test_seeded_disclosure_covers_all_five_required_points(db_session):
    """Play requires what / when / why / who / how long, before the prompt."""
    points = (
        await db_session.execute(
            text("SELECT points FROM location_disclosure_versions WHERE is_active")
        )
    ).scalar_one()

    labels = {p["label"].lower() for p in points}
    assert "what" in labels
    assert "when" in labels
    assert "why" in labels
    assert any("who" in label for label in labels)
    assert any("long" in label for label in labels)


async def test_guard_blocks_check_in_without_consent(db_session, officer_without_consent):
    """Server-side enforcement, not just a screen the client shows.

    A client-side gate can be skipped by an older build, a modified APK,
    or a plain bug - and the result would be tracking running for an
    unknown subset of officers with no consent record. Gating the
    endpoint that STARTS tracking makes the claim true by construction.
    """
    from app.presentation.api.v1.routers.consent_router import require_location_consent

    class FakeUser:
        user_id = officer_without_consent
        role = "field_officer"

    with pytest.raises(HTTPException) as exc:
        await require_location_consent(FakeUser(), db_session)

    assert exc.value.status_code == 403
    assert "location notice" in exc.value.detail


async def test_guard_allows_check_in_after_accepting(db_session, officer_without_consent):
    from app.presentation.api.v1.routers.consent_router import require_location_consent

    version = (
        await db_session.execute(
            text("SELECT version FROM location_disclosure_versions WHERE is_active")
        )
    ).scalar_one()
    await db_session.execute(
        text(
            """
            INSERT INTO location_consent_acceptances (user_id, disclosure_version, source)
            VALUES (:u, :v, 'server')
            """
        ).bindparams(u=officer_without_consent, v=version)
    )
    await db_session.commit()

    class FakeUser:
        user_id = officer_without_consent
        role = "field_officer"

    await require_location_consent(FakeUser(), db_session)  # must not raise


async def test_acceptance_log_is_append_only_across_versions(db_session, officer_without_consent):
    """A new disclosure version does not overwrite the old acceptance.

    The old row is the record of what the officer agreed to at the time.
    Overwriting it would destroy exactly the evidence the table exists
    to provide.
    """
    await db_session.execute(
        text(
            """
            INSERT INTO location_consent_acceptances (user_id, disclosure_version, source)
            VALUES (:u, 1, 'server'), (:u, 2, 'server')
            """
        ).bindparams(u=officer_without_consent)
    )
    await db_session.flush()

    rows = (
        await db_session.execute(
            text(
                "SELECT disclosure_version FROM location_consent_acceptances "
                "WHERE user_id = :u ORDER BY disclosure_version"
            ).bindparams(u=officer_without_consent)
        )
    ).all()
    assert [r.disclosure_version for r in rows] == [1, 2]
    await db_session.rollback()


# ---------------------------------------------------------------------------
# Knowledge auto-feed policy
# ---------------------------------------------------------------------------

@pytest.fixture
async def actors(db_session):
    """Real officer, admin and crop issue.

    knowledge_cases.source_crop_issue_id is a real foreign key, so a
    made-up UUID is rejected - correctly. The idempotency guard depends
    on that column, so the test has to exercise the real constraint
    rather than work around it.
    """
    officer_id = (
        await db_session.execute(
            text("SELECT id FROM users WHERE role = 'field_officer' LIMIT 1")
        )
    ).scalar_one()
    admin_id = (
        await db_session.execute(text("SELECT id FROM users WHERE role = 'admin' LIMIT 1"))
    ).scalar_one()
    farmer_id = (
        await db_session.execute(text("SELECT id FROM farmers LIMIT 1"))
    ).scalar_one()

    issue_id = uuid.uuid4()
    await db_session.execute(
        text(
            """
            INSERT INTO crop_issues
                (id, user_id, farmer_id, symptoms, crop, district,
                 assigned_expert_whatsapp, status)
            VALUES (:id, :u, :f, 'seed symptoms', 'Tomato', 'Salem',
                    '+910000000000', 'resolved')
            """
        ).bindparams(id=issue_id, u=officer_id, f=farmer_id)
    )
    await db_session.flush()
    return officer_id, admin_id, issue_id



def test_substantive_reply_publishes_immediately():
    ok, reason = assess_reply(
        "Spray neem oil at 5ml per litre in the early morning, repeat after 7 days. "
        "Remove and burn affected leaves to stop the spread."
    )
    assert ok is True
    assert reason is None


@pytest.mark.parametrize(
    "reply",
    [
        "Call me and I will explain what to do about this problem today.",
        "Please follow the same treatment as we discussed on the phone last week.",
        "I will visit the field tomorrow morning and check the affected plants.",
        "Treatment is the same as last time for this particular farmer's field.",
    ],
)
def test_personal_reference_replies_are_queued_not_published(reply):
    """These are the replies that make a knowledge base worse than empty.

    Published verbatim, they mislead the next officer who searches - and
    an officer who searches twice and gets bad answers stops searching.
    """
    ok, reason = assess_reply(reply)
    assert ok is False
    assert reason


def test_very_short_reply_is_queued():
    ok, reason = assess_reply("Use neem oil.")
    assert ok is False
    assert "too short" in reason.lower()
    assert len("Use neem oil.") < MIN_REUSABLE_LENGTH


def test_recall_does_not_trip_the_call_me_pattern():
    """Word-boundary matching, so ordinary words aren't false positives.

    An over-eager blocklist quietly sends good advice to a review queue
    nobody empties, which is the same outcome as not having the feature.
    """
    ok, _ = assess_reply(
        "Recall that this fungus spreads in humid weather, so improve drainage "
        "and space the plants further apart before the next sowing."
    )
    assert ok is True


async def test_autofeed_creates_a_verified_case(db_session, actors):
    officer_id, admin_id, issue_id = actors

    case_id = await auto_create_knowledge_case(
        db_session,
        issue_id=issue_id,
        officer_id=officer_id,
        crop="Tomato",
        district="Salem",
        symptoms="Yellow patches spreading on lower leaves",
        expert_reply=(
            "Spray copper oxychloride at 3g per litre and avoid overhead irrigation. "
            "Repeat once after ten days if patches continue to spread."
        ),
        image_url=None,
        resolved_by=admin_id,
    )

    assert case_id is not None
    row = (
        await db_session.execute(
            text(
                "SELECT verification_status, officer_id, source_crop_issue_id "
                "FROM knowledge_cases WHERE id = :id"
            ).bindparams(id=case_id)
        )
    ).first()
    assert row.verification_status == "verified"
    # Credit belongs to the officer who did the fieldwork, not the expert.
    assert row.officer_id == officer_id
    assert row.source_crop_issue_id == issue_id
    await db_session.rollback()


async def test_autofeed_queues_a_personal_reply_with_a_reason(db_session, actors):
    officer_id, admin_id, issue_id = actors

    case_id = await auto_create_knowledge_case(
        db_session,
        issue_id=issue_id,
        officer_id=officer_id,
        crop="Brinjal",
        district="Erode",
        symptoms="Wilting after transplant",
        expert_reply="Please call me and I will explain the treatment in detail.",
        image_url=None,
        resolved_by=admin_id,
    )

    assert case_id is not None
    row = (
        await db_session.execute(
            text(
                "SELECT verification_status, rejection_reason "
                "FROM knowledge_cases WHERE id = :id"
            ).bindparams(id=case_id)
        )
    ).first()
    assert row.verification_status == "pending_review"
    # The reviewing admin is told WHY it was held. A queue without
    # reasons is a queue nobody works through.
    assert row.rejection_reason
    await db_session.rollback()


async def test_expert_rewrite_bypasses_the_heuristic(db_session, actors):
    """An explicit reusable version IS the expert judging it reusable."""
    officer_id, admin_id, issue_id = actors

    case_id = await auto_create_knowledge_case(
        db_session,
        issue_id=issue_id,
        officer_id=officer_id,
        crop="Chilli",
        district="Salem",
        symptoms="Leaf curl",
        expert_reply="Call me.",
        reusable_text="Leaf curl here is thrips damage. Spray spinosad at 0.3ml per litre.",
        image_url=None,
        resolved_by=admin_id,
    )

    assert case_id is not None
    status_value = (
        await db_session.execute(
            text("SELECT verification_status FROM knowledge_cases WHERE id = :id")
            .bindparams(id=case_id)
        )
    ).scalar_one()
    assert status_value == "verified"
    await db_session.rollback()


async def test_autofeed_is_idempotent(db_session, actors):
    """Resolve can legitimately be called twice - an expert correcting
    their answer. A second case would be a duplicate in every future
    search.
    """
    officer_id, admin_id, issue_id = actors

    kwargs = dict(
        issue_id=issue_id,
        officer_id=officer_id,
        crop="Paddy",
        district="Thanjavur",
        symptoms="Brown spots on leaf tips spreading downward",
        expert_reply=(
            "Apply potash at the recommended dose and drain standing water for two days."
        ),
        image_url=None,
        resolved_by=admin_id,
    )

    first = await auto_create_knowledge_case(db_session, **kwargs)
    await db_session.flush()
    second = await auto_create_knowledge_case(db_session, **kwargs)

    assert first is not None
    assert second is None
    await db_session.rollback()


async def test_autofeed_never_breaks_the_resolution(db_session):
    """A knowledge write failing must not fail the farmer's resolution.

    A non-existent crop issue violates the real foreign key, forcing the
    insert to fail. The service must swallow it and return None rather
    than propagating and rolling back the actual resolution - the
    farmer's problem being resolved and the officer being notified are
    what that endpoint is FOR; seeding the knowledge base is the side
    effect.
    """
    case_id = await auto_create_knowledge_case(
        db_session,
        issue_id=uuid.uuid4(),  # no such crop issue
        officer_id=uuid.uuid4(),
        crop="Tomato",
        district="Salem",
        symptoms="Yellow patches spreading on the lower leaves of the plant",
        expert_reply=(
            "Spray copper oxychloride at 3g per litre and improve field drainage."
        ),
        image_url=None,
        resolved_by=uuid.uuid4(),
    )
    assert case_id is None
    await db_session.rollback()
