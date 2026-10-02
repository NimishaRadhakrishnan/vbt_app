"""
Auto-feeds the knowledge base from resolved crop issues.

YOUR REQUIREMENT: when an expert submits advice on the crop-disease page,
that advice should reach the knowledge base automatically.

WHAT ALREADY EXISTED
--------------------
`knowledge_router.admin_promote_issue` already did the promotion. It was
just manual, and its own code carried a note explaining why:

    "Deliberately an ADMIN-REVIEWED action, not a bulk auto-import: an
     expert_reply was written for one farmer's specific situation and was
     never intended as reusable guidance. Some will be excellent, some
     will be 'call me', some will reference a farm only that officer
     knows."

That reasoning is correct and worth keeping. A reply reading "spray as we
discussed last week", published verbatim into a searchable knowledge
base, actively misleads the next officer who finds it - which is worse
than an empty knowledge base, because officers who search twice and get
bad answers stop searching.

THE RESOLUTION
--------------
Automatic, with a quality gate that costs the expert nothing:

  * Replies that look reusable are PUBLISHED IMMEDIATELY (status
    'verified'), searchable the same minute.
  * Replies that are short or contain a personal reference land in the
    existing admin review queue as 'pending_review' - one click to
    publish, edit or skip. Nothing is lost; nothing bad goes out raw.
  * The expert can override either way with an explicit flag on the
    resolve request, and can supply a rewritten reusable version.

So every expert reply reaches the knowledge base, and the small fraction
that shouldn't go out unedited gets one admin click instead of blocking
the other 90%.

Never raises. A knowledge-base write failing must not roll back the
resolution of an actual farmer's crop problem, and must not stop the
reporting officer getting their answer - that is the load-bearing part
of the transaction; this is the useful side effect.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# A reply shorter than this is almost never actionable guidance - it is
# "ok", "noted", "call me". Tuned low deliberately: the cost of queuing a
# good short reply is one admin click, the cost of publishing a bad one
# is a wrong answer in search results indefinitely.
MIN_REUSABLE_LENGTH = 40

# Phrases that mean the reply depends on context a future reader does not
# have. Matched case-insensitively on word boundaries so "recall" does not
# trip "call me".
PERSONAL_REFERENCE_PATTERNS = [
    r"\bcall me\b",
    r"\bcall back\b",
    r"\bas discussed\b",
    r"\bas we discussed\b",
    r"\bas we spoke\b",
    r"\bas per our (call|discussion|talk)\b",
    r"\bi will visit\b",
    r"\bi'll visit\b",
    r"\bwill come (there|tomorrow|today)\b",
    r"\bsame as (last|previous)\b",
    r"\bcontact me\b",
    r"\bwhatsapp me\b",
]

_COMPILED = [re.compile(p, re.IGNORECASE) for p in PERSONAL_REFERENCE_PATTERNS]


def assess_reply(reply: str) -> tuple[bool, str | None]:
    """Returns (is_auto_publishable, reason_if_not).

    Pure function with no I/O, so the policy is directly testable without
    a database - which matters, because this is the rule that decides
    what officers see in search results.
    """
    cleaned = (reply or "").strip()

    if len(cleaned) < MIN_REUSABLE_LENGTH:
        return False, "Reply is too short to be reusable guidance on its own."

    for pattern in _COMPILED:
        if pattern.search(cleaned):
            return False, (
                "Reply refers to a specific conversation or visit, so it needs "
                "rewriting before other officers can use it."
            )

    return True, None


async def auto_create_knowledge_case(
    session: AsyncSession,
    *,
    issue_id: uuid.UUID,
    officer_id: uuid.UUID,
    crop: str | None,
    district: str | None,
    symptoms: str | None,
    expert_reply: str,
    image_url: str | None,
    resolved_by: uuid.UUID,
    add_to_knowledge: bool = True,
    reusable_text: str | None = None,
) -> uuid.UUID | None:
    """Creates a knowledge case + solution from a resolved crop issue.

    Runs inside the caller's transaction and does NOT commit. Returns the
    new case id, or None when nothing was created.
    """
    if not add_to_knowledge:
        return None

    solution_text = (reusable_text or expert_reply or "").strip()
    question = (symptoms or "").strip()
    if not solution_text or not question:
        return None

    try:
        # Idempotency: resolve can legitimately be called more than once
        # (an expert correcting their answer). A second case for the same
        # issue would show up as a duplicate in every future search.
        existing = await session.execute(
            text("SELECT id FROM knowledge_cases WHERE source_crop_issue_id = :iid")
            .bindparams(iid=issue_id)
        )
        if existing.first():
            return None

        # An explicitly supplied reusable_text is the expert deliberately
        # rewriting for reuse, so it skips the heuristic - the check
        # exists to catch replies written without reuse in mind, and this
        # one plainly was not.
        if reusable_text:
            publishable, reason = True, None
        else:
            publishable, reason = assess_reply(solution_text)

        status_value = "verified" if publishable else "pending_review"

        solution_id = uuid.uuid4()
        version_id = uuid.uuid4()
        title = f"{crop}: {question[:80]}" if crop else question[:100]

        # verified_by / verified_at are computed in Python rather than with
        # a CASE over a bound parameter. asyncpg infers parameter types
        # from usage, and reusing :status as both a VARCHAR value and a
        # CASE comparand makes that inference ambiguous - it fails at
        # execute time with "inconsistent types deduced". Computing the
        # values here is also simply clearer about what is being written.
        verified_by = resolved_by if publishable else None
        verified_at = datetime.now(UTC) if publishable else None

        await session.execute(
            text(
                """
                INSERT INTO solutions (id, title, status, created_by, verified_by, verified_at)
                VALUES (:id, :title, :status, :uid, :vby, :vat)
                """
            ).bindparams(
                id=solution_id,
                title=title,
                status=status_value,
                uid=resolved_by,
                vby=verified_by,
                vat=verified_at,
            )
        )
        await session.execute(
            text(
                """
                INSERT INTO solution_versions
                    (id, solution_id, version_number, solution_text, source_reference, created_by)
                VALUES (:id, :sid, 1, :txt, :src, :uid)
                """
            ).bindparams(
                id=version_id,
                sid=solution_id,
                txt=solution_text,
                src=f"Expert reply on crop issue {issue_id}",
                uid=resolved_by,
            )
        )
        await session.execute(
            text("UPDATE solutions SET current_version_id = :vid WHERE id = :sid")
            .bindparams(vid=version_id, sid=solution_id)
        )

        case_id = uuid.uuid4()
        await session.execute(
            text(
                """
                INSERT INTO knowledge_cases (
                    id, officer_id, crop_text, question, symptoms, district,
                    solution_version_id, verification_status, verified_by, verified_at,
                    rejection_reason, source_crop_issue_id
                ) VALUES (
                    :id, :officer_id, :crop_text, :question, :symptoms, :district,
                    :vid, :status, :vby, :vat, :queue_reason, :iid
                )
                """
            ).bindparams(
                id=case_id,
                # Credit stays with the officer who did the fieldwork, not
                # the expert who answered - same convention the manual
                # promotion path already uses.
                officer_id=officer_id,
                crop_text=crop,
                question=question,
                symptoms=symptoms,
                district=district,
                vid=version_id,
                status=status_value,
                vby=verified_by,
                vat=verified_at,
                # Reused as the queue note when pending. It tells the
                # reviewing admin WHY it was held, which is the difference
                # between a queue they act on and one they ignore.
                queue_reason=reason,
                iid=issue_id,
            )
        )

        if image_url:
            await session.execute(
                text(
                    """
                    INSERT INTO case_images
                        (id, case_id, image_url, image_type, caption, uploaded_by)
                    VALUES (gen_random_uuid(), :cid, :url, 'other',
                            'From the original crop issue report',
                            :uid)
                    """
                ).bindparams(cid=case_id, url=image_url, uid=resolved_by)
            )

        return case_id

    except Exception:
        # Deliberately swallowed. The farmer's issue being resolved and
        # the reporting officer being notified are the load-bearing parts
        # of this request; seeding the knowledge base is the side effect.
        # Letting a knowledge write fail the whole resolution would trade
        # a real outcome for an optional one.
        logger.exception(
            "Auto knowledge-case creation failed for crop issue %s; "
            "resolution itself is unaffected.",
            issue_id,
        )
        return None
