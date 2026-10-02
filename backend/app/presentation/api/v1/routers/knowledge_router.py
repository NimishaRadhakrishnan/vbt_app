"""
Knowledge Search router - Phase 1 (synonym management).

Admin CRUD for the search_synonyms table (spec section 26). This exists
in Phase 1 rather than later because the synonym dictionary is genuinely
load-bearing for this system, not a refinement: Postgres full-text
stemming is English-only, so regional and transliterated terms officers
actually type ("thakkali", "brinjal", "paddy") will never match their
English equivalents without it.

Search endpoints themselves arrive in Phase 3 - the expansion logic they
will use already lives in
app/application/services/search_service.py.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.audit.audit_log import write_audit_log
from app.infrastructure.database.session import get_db_session
from app.infrastructure.storage.local_file_storage import save_upload
from app.presentation.api.v1.dependencies import CurrentUser, require_role
from app.domain.value_objects.role import Role
from app.application.dto.auth_dto import CurrentUserOutput
from app.presentation.schemas.knowledge_schemas import (
    SynonymResponse,
    SynonymCreateRequest,
    SynonymUpdateRequest,
    CaseCreateRequest,
    CaseResponse,
    CaseImageResponse,
    SolutionResponse,
    SolutionVersionResponse,
    SolutionCreateRequest,
    SolutionNewVersionRequest,
    CaseVerifyRequest,
    CaseRejectRequest,
)

router = APIRouter(tags=["knowledge"])

_SELECT = "id, term, synonym, is_active, created_at"


@router.get("/admin/knowledge/synonyms", response_model=list[SynonymResponse])
async def admin_list_synonyms(
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[SynonymResponse]:
    result = await session.execute(
        text(f"SELECT {_SELECT} FROM search_synonyms ORDER BY lower(term), lower(synonym)")
    )
    return [SynonymResponse(**dict(row._mapping)) for row in result.all()]


@router.post("/admin/knowledge/synonyms", response_model=SynonymResponse, status_code=status.HTTP_201_CREATED)
async def admin_create_synonym(
    payload: SynonymCreateRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> SynonymResponse:
    term = payload.term.strip()
    synonym = payload.synonym.strip()
    if term.lower() == synonym.lower():
        raise HTTPException(status_code=400, detail="A term and its synonym cannot be the same word.")

    # The database's own unique index is the real guarantee under
    # concurrent edits; this check just produces a clear message instead
    # of a raw constraint-violation error.
    existing = await session.execute(
        text("SELECT 1 FROM search_synonyms WHERE lower(term) = lower(:t) AND lower(synonym) = lower(:s)")
        .bindparams(t=term, s=synonym)
    )
    if existing.first():
        raise HTTPException(status_code=400, detail=f'"{term} → {synonym}" already exists.')

    new_id = uuid.uuid4()
    try:
        await session.execute(
            text("INSERT INTO search_synonyms (id, term, synonym, created_by) VALUES (:id, :t, :s, :uid)")
            .bindparams(id=new_id, t=term, s=synonym, uid=current_user.user_id)
        )
    except Exception:
        await session.rollback()
        raise HTTPException(status_code=400, detail=f'"{term} → {synonym}" already exists.')

    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_search_synonym_add",
        description=f"Admin added search synonym '{term}' -> '{synonym}'",
        context_data={"term": term, "synonym": synonym},
    )
    await session.commit()

    result = await session.execute(text(f"SELECT {_SELECT} FROM search_synonyms WHERE id = :id").bindparams(id=new_id))
    return SynonymResponse(**dict(result.first()._mapping))


@router.put("/admin/knowledge/synonyms/{synonym_id}", response_model=SynonymResponse)
async def admin_update_synonym(
    synonym_id: uuid.UUID,
    payload: SynonymUpdateRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> SynonymResponse:
    existing = await session.execute(
        text("SELECT id FROM search_synonyms WHERE id = :id").bindparams(id=synonym_id)
    )
    if not existing.first():
        raise HTTPException(status_code=404, detail="Synonym not found.")

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided to update.")

    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    await session.execute(
        text(f"UPDATE search_synonyms SET {set_clause}, updated_at = now() WHERE id = :id")
        .bindparams(**fields, id=synonym_id)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_search_synonym_edit",
        description=f"Admin edited search synonym {synonym_id}",
        context_data={"synonym_id": str(synonym_id), "changes": list(fields.keys())},
    )
    await session.commit()

    result = await session.execute(text(f"SELECT {_SELECT} FROM search_synonyms WHERE id = :id").bindparams(id=synonym_id))
    return SynonymResponse(**dict(result.first()._mapping))


@router.delete("/admin/knowledge/synonyms/{synonym_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def admin_delete_synonym(
    synonym_id: uuid.UUID,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> None:
    # Hard delete is safe here, unlike the enum options elsewhere in this
    # app: a synonym is pure search configuration. No stored record ever
    # references it, so removing one affects future query expansion only
    # and can never orphan or invalidate historical data.
    existing = await session.execute(
        text("SELECT term, synonym FROM search_synonyms WHERE id = :id").bindparams(id=synonym_id)
    )
    row = existing.first()
    if not row:
        raise HTTPException(status_code=404, detail="Synonym not found.")

    await session.execute(text("DELETE FROM search_synonyms WHERE id = :id").bindparams(id=synonym_id))
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_search_synonym_delete",
        description=f"Admin deleted search synonym '{row.term}' -> '{row.synonym}'",
        context_data={"term": row.term, "synonym": row.synonym},
    )
    await session.commit()


@router.get("/knowledge/synonyms/preview")
async def preview_query_expansion(
    q: str,
    _current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """Shows how a query gets normalized and synonym-expanded.

    Useful to an admin tuning the dictionary (does 'thakkali' actually
    reach 'tomato'?) and to verifying Phase 1 end-to-end before any
    search endpoint exists. Read-only and side-effect free.
    """
    from app.application.services.search_service import prepare_query
    return await prepare_query(session, q)


# ---------------------------------------------------------------------
# Phase 2: cases and versioned solutions
# ---------------------------------------------------------------------

_CASE_SELECT = """
    c.id, c.case_number, c.question, c.crop_id, c.disease_id, c.crop_text, c.disease_text,
    c.symptoms, c.solution_used, c.notes, c.district, c.verification_status,
    c.rejection_reason, c.usage_count, c.created_at, c.solution_version_id,
    cr.name AS crop_name, d.name AS disease_name, u.full_name AS officer_name
"""

_CASE_FROM = """
    FROM knowledge_cases c
    LEFT JOIN crops cr ON cr.id = c.crop_id
    LEFT JOIN diseases d ON d.id = c.disease_id
    LEFT JOIN users u ON u.id = c.officer_id
"""


async def _load_case_images(session: AsyncSession, case_id: uuid.UUID) -> list[CaseImageResponse]:
    rows = await session.execute(
        text("SELECT id, image_url, image_type, caption FROM case_images WHERE case_id = :cid ORDER BY created_at")
        .bindparams(cid=case_id)
    )
    return [CaseImageResponse(**dict(r._mapping)) for r in rows.all()]


def _case_row_to_response(row, images, is_admin: bool) -> CaseResponse:
    data = dict(row._mapping)
    data.pop("solution_version_id", None)
    # Spec section 32: knowledge reuse needs the symptom and the
    # solution, not which colleague handled it. Officer identity is
    # withheld from non-admins by default rather than exposed and later
    # restricted - the safer direction to get wrong.
    if not is_admin:
        data["officer_name"] = None
    return CaseResponse(**data, images=images)


@router.post("/knowledge/cases", response_model=CaseResponse, status_code=status.HTTP_201_CREATED)
async def create_case(
    payload: CaseCreateRequest,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> CaseResponse:
    """Officer files a new case (spec section 8). Always starts at
    'pending_review' - never 'verified'. An officer cannot self-verify
    their own knowledge; that is the entire point of the approval
    workflow, and letting the client pick the status would defeat it."""
    case_id = uuid.uuid4()
    await session.execute(
        text("""
            INSERT INTO knowledge_cases (
                id, officer_id, crop_id, disease_id, crop_text, disease_text,
                question, symptoms, solution_used, notes, district, verification_status
            ) VALUES (
                :id, :officer_id, :crop_id, :disease_id, :crop_text, :disease_text,
                :question, :symptoms, :solution_used, :notes, :district, 'pending_review'
            )
        """).bindparams(
            id=case_id, officer_id=current_user.user_id, crop_id=payload.crop_id,
            disease_id=payload.disease_id, crop_text=payload.crop_text,
            disease_text=payload.disease_text, question=payload.question,
            symptoms=payload.symptoms, solution_used=payload.solution_used,
            notes=payload.notes, district=payload.district,
        )
    )
    for img in payload.images:
        await session.execute(
            text("""
                INSERT INTO case_images (id, case_id, image_url, image_type, caption, uploaded_by)
                VALUES (gen_random_uuid(), :cid, :url, :itype, :caption, :uid)
            """).bindparams(
                cid=case_id, url=img.image_url, itype=img.image_type,
                caption=img.caption, uid=current_user.user_id,
            )
        )
    await session.commit()

    result = await session.execute(
        text(f"SELECT {_CASE_SELECT} {_CASE_FROM} WHERE c.id = :id").bindparams(id=case_id)
    )
    images = await _load_case_images(session, case_id)
    return _case_row_to_response(result.first(), images, is_admin=(current_user.role == "admin"))


@router.get("/knowledge/cases/my", response_model=list[CaseResponse])
async def list_my_cases(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[CaseResponse]:
    """An officer's own submissions, whatever their status - so they can
    see that something they filed is still pending, or was rejected and
    why."""
    result = await session.execute(
        text(f"SELECT {_CASE_SELECT} {_CASE_FROM} WHERE c.officer_id = :uid ORDER BY c.created_at DESC LIMIT 100")
        .bindparams(uid=current_user.user_id)
    )
    out = []
    for row in result.all():
        out.append(_case_row_to_response(row, await _load_case_images(session, row.id), is_admin=True))
    return out


@router.get("/knowledge/cases/{case_id}", response_model=CaseResponse)
async def get_case(
    case_id: uuid.UUID,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> CaseResponse:
    result = await session.execute(
        text(f"SELECT {_CASE_SELECT} {_CASE_FROM} WHERE c.id = :id").bindparams(id=case_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Case not found.")

    is_admin = current_user.role == "admin"
    # Spec section 7: unverified knowledge is visible to admins (who
    # need it to review) and to the officer who filed it, but is never
    # served to other officers as if it were official.
    if not is_admin and row.verification_status != "verified":
        owner = await session.execute(
            text("SELECT 1 FROM knowledge_cases WHERE id = :id AND officer_id = :uid")
            .bindparams(id=case_id, uid=current_user.user_id)
        )
        if not owner.first():
            raise HTTPException(status_code=404, detail="Case not found.")

    images = await _load_case_images(session, case_id)
    response = _case_row_to_response(row, images, is_admin=is_admin)

    if row.solution_version_id:
        response.solution = await _load_solution_for_version(session, row.solution_version_id)
    return response


async def _load_solution_for_version(session: AsyncSession, version_id: uuid.UUID):
    """Loads a solution AS OF the exact version a case used (spec
    section 13), not whatever the current version happens to be - a case
    must keep showing the advice the officer was actually given."""
    row = await session.execute(
        text("""
            SELECT s.id, s.title, s.disease_id, s.crop_id, s.status, s.usage_count,
                   s.helpful_count, s.not_helpful_count, s.created_at,
                   v.id AS v_id, v.version_number, v.solution_text, v.instructions,
                   v.precautions, v.source_reference, v.created_at AS v_created_at
            FROM solution_versions v
            JOIN solutions s ON s.id = v.solution_id
            WHERE v.id = :vid
        """).bindparams(vid=version_id)
    )
    r = row.first()
    if not r:
        return None
    return SolutionResponse(
        id=r.id, title=r.title, disease_id=r.disease_id, crop_id=r.crop_id,
        status=r.status, usage_count=r.usage_count, helpful_count=r.helpful_count,
        not_helpful_count=r.not_helpful_count, created_at=r.created_at,
        current_version=SolutionVersionResponse(
            id=r.v_id, version_number=r.version_number, solution_text=r.solution_text,
            instructions=r.instructions, precautions=r.precautions,
            source_reference=r.source_reference, created_at=r.v_created_at,
        ),
    )


# --- Admin: review queue and verification (spec section 8) ---

@router.get("/admin/knowledge/cases", response_model=list[CaseResponse])
async def admin_list_cases(
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    verification_status: str | None = None,
) -> list[CaseResponse]:
    where = "WHERE c.verification_status = :vs" if verification_status else ""
    params = {"vs": verification_status} if verification_status else {}
    result = await session.execute(
        text(f"SELECT {_CASE_SELECT} {_CASE_FROM} {where} ORDER BY c.created_at DESC LIMIT 200").bindparams(**params)
    )
    out = []
    for row in result.all():
        out.append(_case_row_to_response(row, await _load_case_images(session, row.id), is_admin=True))
    return out


@router.put("/admin/knowledge/cases/{case_id}/verify", response_model=CaseResponse)
async def admin_verify_case(
    case_id: uuid.UUID,
    payload: CaseVerifyRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> CaseResponse:
    existing = await session.execute(
        text("SELECT id FROM knowledge_cases WHERE id = :id").bindparams(id=case_id)
    )
    if not existing.first():
        raise HTTPException(status_code=404, detail="Case not found.")

    version_id = None
    if payload.solution_id:
        # Pin the case to the solution's CURRENT version at approval
        # time, so later revisions don't retroactively change what this
        # case says.
        v = await session.execute(
            text("SELECT current_version_id FROM solutions WHERE id = :sid").bindparams(sid=payload.solution_id)
        )
        srow = v.first()
        if not srow:
            raise HTTPException(status_code=404, detail="Solution not found.")
        version_id = srow.current_version_id

    await session.execute(
        text("""
            UPDATE knowledge_cases
            SET verification_status = 'verified', verified_by = :uid, verified_at = now(),
                rejection_reason = NULL,
                solution_version_id = COALESCE(:vid, solution_version_id),
                updated_at = now()
            WHERE id = :id
        """).bindparams(uid=current_user.user_id, vid=version_id, id=case_id)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_knowledge_case_verify",
        description=f"Admin verified knowledge case {case_id}",
        context_data={"case_id": str(case_id), "solution_id": str(payload.solution_id) if payload.solution_id else None},
    )
    await session.commit()

    result = await session.execute(
        text(f"SELECT {_CASE_SELECT} {_CASE_FROM} WHERE c.id = :id").bindparams(id=case_id)
    )
    return _case_row_to_response(result.first(), await _load_case_images(session, case_id), is_admin=True)


@router.put("/admin/knowledge/cases/{case_id}/reject", response_model=CaseResponse)
async def admin_reject_case(
    case_id: uuid.UUID,
    payload: CaseRejectRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> CaseResponse:
    existing = await session.execute(
        text("SELECT id FROM knowledge_cases WHERE id = :id").bindparams(id=case_id)
    )
    if not existing.first():
        raise HTTPException(status_code=404, detail="Case not found.")

    await session.execute(
        text("""
            UPDATE knowledge_cases
            SET verification_status = 'rejected', verified_by = :uid, verified_at = now(),
                rejection_reason = :reason, updated_at = now()
            WHERE id = :id
        """).bindparams(uid=current_user.user_id, reason=payload.reason, id=case_id)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_knowledge_case_reject",
        description=f"Admin rejected knowledge case {case_id}",
        context_data={"case_id": str(case_id), "reason": payload.reason},
    )
    await session.commit()

    result = await session.execute(
        text(f"SELECT {_CASE_SELECT} {_CASE_FROM} WHERE c.id = :id").bindparams(id=case_id)
    )
    return _case_row_to_response(result.first(), await _load_case_images(session, case_id), is_admin=True)


# --- Admin: solutions and versioning (spec sections 12, 13) ---

@router.post("/admin/knowledge/solutions", response_model=SolutionResponse, status_code=status.HTTP_201_CREATED)
async def admin_create_solution(
    payload: SolutionCreateRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> SolutionResponse:
    """Creates a solution and its v1 in one transaction - a solution
    with no version is meaningless, so the two are never separable."""
    solution_id = uuid.uuid4()
    version_id = uuid.uuid4()

    await session.execute(
        text("""
            INSERT INTO solutions (id, title, disease_id, crop_id, status, created_by, verified_by, verified_at)
            VALUES (:id, :title, :did, :cid, 'verified', :uid, :uid, now())
        """).bindparams(
            id=solution_id, title=payload.title, did=payload.disease_id,
            cid=payload.crop_id, uid=current_user.user_id,
        )
    )
    await session.execute(
        text("""
            INSERT INTO solution_versions (
                id, solution_id, version_number, solution_text, instructions,
                precautions, source_reference, created_by
            ) VALUES (:id, :sid, 1, :txt, :instr, :prec, :src, :uid)
        """).bindparams(
            id=version_id, sid=solution_id, txt=payload.solution_text,
            instr=payload.instructions, prec=payload.precautions,
            src=payload.source_reference, uid=current_user.user_id,
        )
    )
    await session.execute(
        text("UPDATE solutions SET current_version_id = :vid WHERE id = :sid")
        .bindparams(vid=version_id, sid=solution_id)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_knowledge_solution_create",
        description=f"Admin created solution '{payload.title}'",
        context_data={"solution_id": str(solution_id)},
    )
    await session.commit()
    return await _load_solution_for_version(session, version_id)


@router.post("/admin/knowledge/solutions/{solution_id}/versions", response_model=SolutionResponse)
async def admin_add_solution_version(
    solution_id: uuid.UUID,
    payload: SolutionNewVersionRequest,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> SolutionResponse:
    """Adds a new version and points the solution at it (spec section
    13). The previous version is left completely untouched - any case
    pinned to it keeps showing exactly what it always showed."""
    existing = await session.execute(
        text("SELECT id FROM solutions WHERE id = :id").bindparams(id=solution_id)
    )
    if not existing.first():
        raise HTTPException(status_code=404, detail="Solution not found.")

    max_v = await session.execute(
        text("SELECT COALESCE(MAX(version_number), 0) AS m FROM solution_versions WHERE solution_id = :sid")
        .bindparams(sid=solution_id)
    )
    next_v = (max_v.first().m or 0) + 1

    version_id = uuid.uuid4()
    await session.execute(
        text("""
            INSERT INTO solution_versions (
                id, solution_id, version_number, solution_text, instructions,
                precautions, source_reference, created_by
            ) VALUES (:id, :sid, :vnum, :txt, :instr, :prec, :src, :uid)
        """).bindparams(
            id=version_id, sid=solution_id, vnum=next_v, txt=payload.solution_text,
            instr=payload.instructions, prec=payload.precautions,
            src=payload.source_reference, uid=current_user.user_id,
        )
    )
    await session.execute(
        text("UPDATE solutions SET current_version_id = :vid, updated_at = now() WHERE id = :sid")
        .bindparams(vid=version_id, sid=solution_id)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_knowledge_solution_version",
        description=f"Admin published v{next_v} of solution {solution_id}",
        context_data={"solution_id": str(solution_id), "version_number": next_v},
    )
    await session.commit()
    return await _load_solution_for_version(session, version_id)


@router.get("/knowledge/solutions/{solution_id}", response_model=SolutionResponse)
async def get_solution(
    solution_id: uuid.UUID,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> SolutionResponse:
    row = await session.execute(
        text("SELECT current_version_id, status FROM solutions WHERE id = :id").bindparams(id=solution_id)
    )
    r = row.first()
    if not r or not r.current_version_id:
        raise HTTPException(status_code=404, detail="Solution not found.")
    # Spec section 7: only verified solutions are served as official
    # recommendations to officers.
    if r.status != "verified" and current_user.role != "admin":
        raise HTTPException(status_code=404, detail="Solution not found.")
    return await _load_solution_for_version(session, r.current_version_id)


@router.get("/knowledge/solutions/{solution_id}/versions", response_model=list[SolutionVersionResponse])
async def list_solution_versions(
    solution_id: uuid.UUID,
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[SolutionVersionResponse]:
    """Full revision history - admin-only, since it exposes superseded
    advice that should never be presented as current guidance."""
    rows = await session.execute(
        text("""
            SELECT id, version_number, solution_text, instructions, precautions,
                   source_reference, created_at
            FROM solution_versions WHERE solution_id = :sid ORDER BY version_number DESC
        """).bindparams(sid=solution_id)
    )
    return [SolutionVersionResponse(**dict(r._mapping)) for r in rows.all()]


# ---------------------------------------------------------------------
# Phase 3: search
# ---------------------------------------------------------------------

@router.post("/knowledge/search")
async def search_knowledge_base(
    payload: dict,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """Search verified knowledge (spec sections 2, 14, 27).

    No LLM anywhere in this path. The response is assembled entirely
    from stored, admin-verified rows; if nothing suitable exists the
    system says so (section 18) rather than composing an answer.

    Side effects are deliberate and both come from the spec: every
    search is logged (section 20), and a search that finds nothing
    useful is recorded as a knowledge gap with a running count
    (section 24).
    """
    from app.application.services.search_service import (
        search_knowledge, normalize_query, LOW_RELEVANCE_CEILING,
    )

    raw_query = (payload.get("query") or "").strip()
    if not raw_query:
        raise HTTPException(status_code=400, detail="Please enter something to search for.")

    outcome = await search_knowledge(
        session,
        raw_query,
        limit=int(payload.get("limit") or 20),
        crop_id=payload.get("crop_id"),
        disease_id=payload.get("disease_id"),
    )
    results = outcome["results"]

    # Attach the verified solution to each hit, loading it by the exact
    # version the case was pinned to (spec section 13) rather than the
    # solution's current version.
    for r in results:
        if r.get("solution_version_id"):
            sol = await _load_solution_for_version(session, uuid.UUID(r["solution_version_id"]))
            if sol:
                r["solution"] = {
                    "id": str(sol.id),
                    "title": sol.title,
                    "solution_text": sol.current_version.solution_text if sol.current_version else None,
                    "instructions": sol.current_version.instructions if sol.current_version else None,
                    "precautions": sol.current_version.precautions if sol.current_version else None,
                    "version_number": sol.current_version.version_number if sol.current_version else None,
                }

    top_band = results[0]["relevance_band"] if results else None

    # Section 20: search history.
    await session.execute(
        text("""
            INSERT INTO search_history (id, officer_id, query, result_count, top_relevance_band)
            VALUES (gen_random_uuid(), :uid, :q, :cnt, :band)
        """).bindparams(uid=current_user.user_id, q=raw_query, cnt=len(results), band=top_band)
    )

    # Section 24: a search with no results at all, or only weak ones, is
    # a knowledge gap. Recorded against the NORMALIZED query so
    # differently-worded versions of the same gap collapse into one row
    # with a rising count instead of many one-off entries.
    no_useful_answer = (not results) or outcome["low_relevance_only"]
    if no_useful_answer:
        normalized_key = " ".join(sorted(normalize_query(raw_query)))
        if normalized_key:
            await session.execute(
                text("""
                    INSERT INTO unanswered_searches (id, normalized_query, sample_query)
                    VALUES (gen_random_uuid(), :nk, :raw)
                    ON CONFLICT (normalized_query) DO UPDATE
                    SET search_count = unanswered_searches.search_count + 1,
                        last_searched_at = now()
                """).bindparams(nk=normalized_key, raw=raw_query)
            )
    await session.commit()

    # Section 18/19: the message is part of the contract, not UI garnish -
    # it is what stops a weak match being read as a confirmed answer.
    if not results:
        message = "No verified solution was found in the knowledge base."
    elif outcome["low_relevance_only"]:
        message = "No highly relevant verified solution was found. These cases may be related:"
    else:
        message = None

    return {
        "query": raw_query,
        "results": results,
        "result_count": len(results),
        "low_relevance_only": outcome["low_relevance_only"],
        "message": message,
        "can_create_case": no_useful_answer,
        "expanded_terms": outcome["prepared"]["expanded_tokens"],
    }


@router.post("/knowledge/search/select")
async def record_search_selection(
    payload: dict,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """Records which result an officer actually opened (section 20) and
    bumps that case's usage counter (section 22), so admins can see
    which knowledge is genuinely earning its place."""
    case_id = payload.get("case_id")
    if not case_id:
        raise HTTPException(status_code=400, detail="case_id is required.")

    await session.execute(
        text("""
            UPDATE search_history SET selected_case_id = :cid
            WHERE id = (
                SELECT id FROM search_history
                WHERE officer_id = :uid ORDER BY created_at DESC LIMIT 1
            )
        """).bindparams(cid=case_id, uid=current_user.user_id)
    )
    await session.execute(
        text("UPDATE knowledge_cases SET usage_count = usage_count + 1, last_used_at = now() WHERE id = :cid")
        .bindparams(cid=case_id)
    )
    await session.commit()
    return {"recorded": True}


@router.get("/knowledge/search/history")
async def get_my_search_history(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[dict]:
    rows = await session.execute(
        text("""
            SELECT query, result_count, top_relevance_band, created_at
            FROM search_history WHERE officer_id = :uid
            ORDER BY created_at DESC LIMIT 50
        """).bindparams(uid=current_user.user_id)
    )
    return [dict(r._mapping) for r in rows.all()]


@router.get("/admin/knowledge/unanswered")
async def admin_list_unanswered(
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[dict]:
    """The knowledge-gap queue (section 24), most-requested first - so
    the most repeated gap gets filled before a one-off curiosity."""
    rows = await session.execute(
        text("""
            SELECT id, normalized_query, sample_query, search_count, last_searched_at
            FROM unanswered_searches
            WHERE is_resolved = false
            ORDER BY search_count DESC, last_searched_at DESC
            LIMIT 100
        """)
    )
    return [dict(r._mapping) for r in rows.all()]


@router.put("/admin/knowledge/unanswered/{unanswered_id}/resolve")
async def admin_resolve_unanswered(
    unanswered_id: uuid.UUID,
    payload: dict,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """Marks a gap as filled, optionally linking the case that now
    answers it (section 25)."""
    existing = await session.execute(
        text("SELECT id FROM unanswered_searches WHERE id = :id").bindparams(id=unanswered_id)
    )
    if not existing.first():
        raise HTTPException(status_code=404, detail="Unanswered search not found.")

    await session.execute(
        text("UPDATE unanswered_searches SET is_resolved = true, resolved_case_id = :cid WHERE id = :id")
        .bindparams(cid=payload.get("case_id"), id=unanswered_id)
    )
    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_knowledge_gap_resolved",
        description=f"Admin resolved knowledge gap {unanswered_id}",
        context_data={"unanswered_id": str(unanswered_id)},
    )
    await session.commit()
    return {"resolved": True}


# ---------------------------------------------------------------------
# Phase 4: feedback and admin analytics
# ---------------------------------------------------------------------

_FEEDBACK_REASONS = {"not_relevant", "incorrect", "outdated", "incomplete", "other"}


@router.post("/knowledge/cases/{case_id}/feedback")
async def submit_feedback(
    case_id: uuid.UUID,
    payload: dict,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """Was this solution useful? (spec section 21)

    Idempotent per officer: re-submitting updates that officer's existing
    answer rather than adding a second row, so one person changing their
    mind cannot inflate the section 22 counts.
    """
    was_useful = payload.get("was_useful")
    if was_useful is None:
        raise HTTPException(status_code=400, detail="was_useful is required.")
    was_useful = bool(was_useful)

    reason = payload.get("reason")
    if reason is not None and reason not in _FEEDBACK_REASONS:
        raise HTTPException(status_code=400, detail=f"reason must be one of: {', '.join(sorted(_FEEDBACK_REASONS))}")
    # A reason only means anything on negative feedback; silently drop it
    # on positive so the data stays clean.
    if was_useful:
        reason = None

    case_row = await session.execute(
        text("""
            SELECT c.id, v.solution_id
            FROM knowledge_cases c
            LEFT JOIN solution_versions v ON v.id = c.solution_version_id
            WHERE c.id = :cid
        """).bindparams(cid=case_id)
    )
    case = case_row.first()
    if not case:
        raise HTTPException(status_code=404, detail="Case not found.")

    # What this officer said last time, so the denormalized counters can
    # be adjusted correctly instead of double-counting a changed answer.
    prior = await session.execute(
        text("SELECT was_useful FROM solution_feedback WHERE case_id = :cid AND officer_id = :uid")
        .bindparams(cid=case_id, uid=current_user.user_id)
    )
    prior_row = prior.first()

    await session.execute(
        text("""
            INSERT INTO solution_feedback (id, case_id, solution_id, officer_id, was_useful, reason, comment)
            VALUES (gen_random_uuid(), :cid, :sid, :uid, :useful, :reason, :comment)
            ON CONFLICT (case_id, officer_id) DO UPDATE
            SET was_useful = EXCLUDED.was_useful,
                reason = EXCLUDED.reason,
                comment = EXCLUDED.comment,
                updated_at = now()
        """).bindparams(
            cid=case_id, sid=case.solution_id, uid=current_user.user_id,
            useful=was_useful, reason=reason, comment=payload.get("comment"),
        )
    )

    # Keep solutions.helpful_count / not_helpful_count in step. Only
    # applied when the answer actually changed (or is new), so repeated
    # identical submissions are no-ops rather than drift.
    if case.solution_id:
        if prior_row is None:
            col = "helpful_count" if was_useful else "not_helpful_count"
            await session.execute(
                text(f"UPDATE solutions SET {col} = {col} + 1 WHERE id = :sid").bindparams(sid=case.solution_id)
            )
        elif prior_row.was_useful != was_useful:
            inc = "helpful_count" if was_useful else "not_helpful_count"
            dec = "not_helpful_count" if was_useful else "helpful_count"
            await session.execute(
                text(f"""
                    UPDATE solutions
                    SET {inc} = {inc} + 1,
                        {dec} = GREATEST({dec} - 1, 0)
                    WHERE id = :sid
                """).bindparams(sid=case.solution_id)
            )

    await session.commit()
    return {"recorded": True, "was_useful": was_useful}


@router.get("/knowledge/cases/{case_id}/feedback/mine")
async def get_my_feedback(
    case_id: uuid.UUID,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """Lets the UI show an officer what they already said, rather than
    re-prompting as though they never answered."""
    row = await session.execute(
        text("SELECT was_useful, reason, comment FROM solution_feedback WHERE case_id = :cid AND officer_id = :uid")
        .bindparams(cid=case_id, uid=current_user.user_id)
    )
    r = row.first()
    return dict(r._mapping) if r else {"was_useful": None, "reason": None, "comment": None}


@router.get("/admin/knowledge/stats")
async def admin_knowledge_stats(
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """Admin dashboard figures (spec section 23).

    Counts are computed live rather than cached: at this data scale the
    queries are cheap, and a stale knowledge dashboard is worse than a
    slightly slower one - it would mislead the person deciding what to
    document next.
    """
    case_counts = await session.execute(
        text("""
            SELECT verification_status, COUNT(*) AS cnt
            FROM knowledge_cases GROUP BY verification_status
        """)
    )
    by_status = {r.verification_status: r.cnt for r in case_counts.all()}

    totals = await session.execute(
        text("""
            SELECT
              (SELECT COUNT(*) FROM knowledge_cases)              AS total_cases,
              (SELECT COUNT(*) FROM solutions)                    AS total_solutions,
              (SELECT COUNT(*) FROM diseases)                     AS total_diseases,
              (SELECT COUNT(*) FROM crops)                        AS total_crops,
              (SELECT COUNT(*) FROM search_synonyms WHERE is_active) AS active_synonyms
        """)
    )
    t = totals.first()

    # Section 23: searches that found nothing are the most actionable
    # number on this dashboard - they are the documented gaps.
    search_stats = await session.execute(
        text("""
            SELECT
              (SELECT COUNT(*) FROM search_history)                                   AS total_searches,
              (SELECT COUNT(*) FROM search_history WHERE result_count = 0)            AS no_result_searches,
              (SELECT COUNT(*) FROM search_history WHERE top_relevance_band = 'Possible') AS low_relevance_searches,
              (SELECT COUNT(*) FROM unanswered_searches WHERE is_resolved = false)    AS open_knowledge_gaps
        """)
    )
    s = search_stats.first()

    most_used = await session.execute(
        text("""
            SELECT c.id, c.case_number, c.question, c.usage_count,
                   COALESCE(SUM(CASE WHEN f.was_useful THEN 1 ELSE 0 END), 0) AS helpful,
                   COALESCE(SUM(CASE WHEN f.was_useful THEN 0 ELSE 1 END), 0) AS not_helpful
            FROM knowledge_cases c
            LEFT JOIN solution_feedback f ON f.case_id = c.id
            WHERE c.verification_status = 'verified' AND c.usage_count > 0
            GROUP BY c.id, c.case_number, c.question, c.usage_count
            ORDER BY c.usage_count DESC LIMIT 10
        """)
    )

    # Cases people open but then mark unhelpful - the clearest signal of
    # knowledge that needs revising rather than more of.
    needs_attention = await session.execute(
        text("""
            SELECT c.id, c.case_number, c.question,
                   COUNT(*) FILTER (WHERE NOT f.was_useful) AS not_helpful,
                   COUNT(*) AS total_feedback
            FROM knowledge_cases c
            JOIN solution_feedback f ON f.case_id = c.id
            GROUP BY c.id, c.case_number, c.question
            HAVING COUNT(*) FILTER (WHERE NOT f.was_useful) > COUNT(*) FILTER (WHERE f.was_useful)
            ORDER BY not_helpful DESC LIMIT 10
        """)
    )

    top_gaps = await session.execute(
        text("""
            SELECT sample_query, search_count FROM unanswered_searches
            WHERE is_resolved = false ORDER BY search_count DESC LIMIT 10
        """)
    )

    return {
        "cases": {
            "total": t.total_cases,
            "draft": by_status.get("draft", 0),
            "pending_review": by_status.get("pending_review", 0),
            "verified": by_status.get("verified", 0),
            "rejected": by_status.get("rejected", 0),
            "archived": by_status.get("archived", 0),
        },
        "totals": {
            "solutions": t.total_solutions,
            "diseases": t.total_diseases,
            "crops": t.total_crops,
            "active_synonyms": t.active_synonyms,
        },
        "search": {
            "total_searches": s.total_searches,
            "no_result_searches": s.no_result_searches,
            "low_relevance_searches": s.low_relevance_searches,
            "open_knowledge_gaps": s.open_knowledge_gaps,
        },
        "most_used_cases": [dict(r._mapping) for r in most_used.all()],
        "needs_attention": [dict(r._mapping) for r in needs_attention.all()],
        "top_knowledge_gaps": [dict(r._mapping) for r in top_gaps.all()],
    }


# ---------------------------------------------------------------------
# Phase 5: promoting existing crop_issues into knowledge (cold start)
# ---------------------------------------------------------------------

# The knowledge base launches empty, and officers who search twice and
# get nothing stop searching. This app already holds real, answered
# questions: `crop_issues` rows where an officer described symptoms and
# an expert replied. Promoting the good ones seeds the knowledge base
# with genuine content on day one instead of waiting months for it to
# accumulate.
#
# Deliberately an ADMIN-REVIEWED action, not a bulk auto-import: an
# expert_reply was written for one farmer's specific situation and was
# never intended as reusable guidance. Some will be excellent, some will
# be "call me", some will reference a farm only that officer knows. An
# admin reads it and decides - which is exactly the section 8 approval
# standard applied to legacy data, not a shortcut around it.


@router.get("/admin/knowledge/promotable-issues")
async def admin_list_promotable_issues(
    _current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[dict]:
    """Resolved crop issues that have an expert answer and haven't been
    promoted yet.

    Filters to rows with a non-empty expert_reply: a resolved issue with
    no written answer has nothing to contribute as knowledge, and
    listing it would just add noise to the admin's queue.
    """
    rows = await session.execute(
        text("""
            SELECT ci.id, ci.symptoms, ci.crop, ci.district, ci.expert_reply,
                   ci.image_url, ci.created_at,
                   u.full_name AS officer_name,
                   f.name AS farmer_name
            FROM crop_issues ci
            LEFT JOIN users u ON u.id = ci.user_id
            LEFT JOIN farmers f ON f.id = ci.farmer_id
            WHERE ci.status IN ('resolved', 'closed')
              AND ci.expert_reply IS NOT NULL
              AND length(trim(ci.expert_reply)) > 0
              AND NOT EXISTS (
                    SELECT 1 FROM knowledge_cases kc WHERE kc.source_crop_issue_id = ci.id
              )
            ORDER BY ci.created_at DESC
            LIMIT 100
        """)
    )
    return [dict(r._mapping) for r in rows.all()]


@router.post("/admin/knowledge/promote-issue/{issue_id}", response_model=CaseResponse, status_code=status.HTTP_201_CREATED)
async def admin_promote_issue(
    issue_id: uuid.UUID,
    payload: dict,
    current_user: Annotated[CurrentUserOutput, Depends(require_role(Role.ADMIN))],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> CaseResponse:
    """Promotes one resolved crop issue into a verified knowledge case,
    optionally creating a reusable solution from the expert's reply.

    The admin can override the question/symptoms/solution text before
    promoting - an expert reply written as "spray as we discussed" needs
    rewriting into something a future officer can actually act on, and
    forcing the original text through verbatim would put low-quality
    entries into the knowledge base permanently.

    Verified immediately: an admin performing this action IS the review
    step (they have read the content and edited it), so requiring a
    second separate approval of their own work would be theatre.
    """
    issue = await session.execute(
        text("""
            SELECT ci.id, ci.user_id, ci.symptoms, ci.crop, ci.district,
                   ci.expert_reply, ci.image_url, ci.status
            FROM crop_issues ci WHERE ci.id = :iid
        """).bindparams(iid=issue_id)
    )
    row = issue.first()
    if not row:
        raise HTTPException(status_code=404, detail="Crop issue not found.")
    if row.status not in ("resolved", "closed"):
        raise HTTPException(status_code=400, detail="Only a resolved crop issue can be promoted into knowledge.")

    already = await session.execute(
        text("SELECT id FROM knowledge_cases WHERE source_crop_issue_id = :iid").bindparams(iid=issue_id)
    )
    if already.first():
        raise HTTPException(status_code=400, detail="This issue has already been promoted into a knowledge case.")

    question = (payload.get("question") or row.symptoms or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="A question/problem description is required.")
    solution_text = (payload.get("solution_text") or row.expert_reply or "").strip()
    if not solution_text:
        raise HTTPException(status_code=400, detail="A solution is required to promote this issue.")

    # Build a reusable solution from the expert's answer, so future
    # cases about the same problem can point at the same record rather
    # than duplicating the text (spec section 12).
    solution_id = uuid.uuid4()
    version_id = uuid.uuid4()
    title = (payload.get("title") or f"{row.crop}: {question[:80]}").strip()

    await session.execute(
        text("""
            INSERT INTO solutions (id, title, disease_id, crop_id, status, created_by, verified_by, verified_at)
            VALUES (:id, :title, :did, :cid, 'verified', :uid, :uid, now())
        """).bindparams(
            id=solution_id, title=title,
            did=payload.get("disease_id"), cid=payload.get("crop_id"),
            uid=current_user.user_id,
        )
    )
    await session.execute(
        text("""
            INSERT INTO solution_versions (id, solution_id, version_number, solution_text, source_reference, created_by)
            VALUES (:id, :sid, 1, :txt, :src, :uid)
        """).bindparams(
            id=version_id, sid=solution_id, txt=solution_text,
            src=f"Promoted from crop issue {issue_id}", uid=current_user.user_id,
        )
    )
    await session.execute(
        text("UPDATE solutions SET current_version_id = :vid WHERE id = :sid")
        .bindparams(vid=version_id, sid=solution_id)
    )

    case_id = uuid.uuid4()
    await session.execute(
        text("""
            INSERT INTO knowledge_cases (
                id, officer_id, crop_id, disease_id, crop_text, disease_text,
                question, symptoms, district, solution_version_id,
                verification_status, verified_by, verified_at, source_crop_issue_id
            ) VALUES (
                :id, :officer_id, :crop_id, :disease_id, :crop_text, :disease_text,
                :question, :symptoms, :district, :vid,
                'verified', :uid, now(), :iid
            )
        """).bindparams(
            id=case_id,
            # Credit stays with the officer who originally raised it -
            # they did the fieldwork, and the audit trail should reflect
            # that rather than attributing it to the promoting admin.
            officer_id=row.user_id,
            crop_id=payload.get("crop_id"), disease_id=payload.get("disease_id"),
            crop_text=row.crop, disease_text=payload.get("disease_text"),
            question=question, symptoms=payload.get("symptoms") or row.symptoms,
            district=row.district, vid=version_id, uid=current_user.user_id, iid=issue_id,
        )
    )

    # Carry the original photo across - a picture of the affected leaf is
    # often the most useful part of the record for the next officer.
    if row.image_url:
        await session.execute(
            text("""
                INSERT INTO case_images (id, case_id, image_url, image_type, caption, uploaded_by)
                VALUES (gen_random_uuid(), :cid, :url, 'other', 'From original crop issue report', :uid)
            """).bindparams(cid=case_id, url=row.image_url, uid=current_user.user_id)
        )

    await write_audit_log(
        session, user_id=current_user.user_id, event_type="admin_knowledge_promote_issue",
        description=f"Admin promoted crop issue {issue_id} into knowledge case",
        context_data={"crop_issue_id": str(issue_id), "case_id": str(case_id), "solution_id": str(solution_id)},
    )
    await session.commit()

    result = await session.execute(
        text(f"SELECT {_CASE_SELECT} {_CASE_FROM} WHERE c.id = :id").bindparams(id=case_id)
    )
    response = _case_row_to_response(result.first(), await _load_case_images(session, case_id), is_admin=True)
    response.solution = await _load_solution_for_version(session, version_id)
    return response


# ---------------------------------------------------------------------
# Phase 6: image upload and disease detection interface
# ---------------------------------------------------------------------

@router.post("/knowledge/upload")
async def upload_knowledge_image(
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    file: UploadFile = File(...),
) -> dict:
    """Image upload for case attachments and image search. Reuses the
    same save_upload() every other module in this app uses, so files
    land in one place with one access-control story."""
    url = await save_upload(file, current_user.user_id, session)
    return {"url": url}


@router.post("/knowledge/detect")
async def detect_and_search(
    payload: dict,
    current_user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict:
    """Image (optionally + text) -> disease identification -> knowledge
    search (spec sections 15, 17).

    The two halves stay strictly separate per section 33: detection
    produces only a disease id, and the SAME verified-knowledge search
    used for typed queries produces the answer. Detection never
    generates a solution, and this endpoint has no path by which it
    could.

    Detection is currently unavailable (no model is deployed - see
    disease_detection_service). Rather than failing, this falls back to
    searching whatever text the officer supplied, so an image+text
    request still returns useful verified knowledge.
    """
    from app.application.services.disease_detection_service import detect_disease
    from app.application.services.search_service import search_knowledge

    image_url = payload.get("image_url")
    query_text = (payload.get("query") or "").strip()
    if not image_url and not query_text:
        raise HTTPException(status_code=400, detail="Provide an image, some text, or both.")

    detection = None
    if image_url:
        result = await detect_disease(image_url)
        detection = {
            "available": result.available,
            "predicted_disease_id": str(result.predicted_disease_id) if result.predicted_disease_id else None,
            "predicted_disease_name": result.predicted_disease_name,
            "confidence": float(result.confidence) if result.confidence is not None else None,
            "message": result.message,
        }
        await session.execute(
            text("""
                INSERT INTO disease_detection_log
                    (id, officer_id, image_url, predicted_disease_id, confidence, provider, was_available)
                VALUES (gen_random_uuid(), :uid, :url, :did, :conf, :prov, :avail)
            """).bindparams(
                uid=current_user.user_id, url=image_url,
                did=result.predicted_disease_id, conf=result.confidence,
                prov=result.provider, avail=result.available,
            )
        )
        await session.commit()

    # Search using the identified disease when detection worked, else on
    # the officer's own words. Either way it is the same verified-only
    # search path - there is no separate "image answer".
    search_payload = None
    if detection and detection["available"] and detection["predicted_disease_id"]:
        search_payload = await search_knowledge(
            session,
            detection["predicted_disease_name"] or query_text or "",
            disease_id=detection["predicted_disease_id"],
        )
    elif query_text:
        search_payload = await search_knowledge(session, query_text)

    results = search_payload["results"] if search_payload else []
    for r in results:
        if r.get("solution_version_id"):
            sol = await _load_solution_for_version(session, uuid.UUID(r["solution_version_id"]))
            if sol:
                r["solution"] = {
                    "id": str(sol.id),
                    "title": sol.title,
                    "solution_text": sol.current_version.solution_text if sol.current_version else None,
                    "precautions": sol.current_version.precautions if sol.current_version else None,
                    "version_number": sol.current_version.version_number if sol.current_version else None,
                }

    if not results:
        message = "No verified solution was found in the knowledge base."
    elif search_payload and search_payload["low_relevance_only"]:
        message = "No highly relevant verified solution was found. These cases may be related:"
    else:
        message = None

    return {
        "detection": detection,
        "results": results,
        "result_count": len(results),
        "message": message,
        "can_create_case": not results or bool(search_payload and search_payload["low_relevance_only"]),
    }
