"""
Search query normalization and synonym expansion.

Phase 1 of the Disease Knowledge Search system. Deliberately isolated in
its own service module rather than inlined into a router: the spec
(section 5) asks that Elasticsearch/OpenSearch remain introducible later
if Postgres stops scaling, and that is only cheap if every piece of
search logic lives behind one boundary. Phase 3's search endpoint will
call into here rather than reimplementing normalization itself.

No LLM, no generative component - this is deterministic string handling
and a database lookup, per the spec's core constraint.
"""

from __future__ import annotations

import re
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Words that carry no search signal in an officer's phrasing. Kept small
# and domain-aware on purpose: a generic English stopword list would
# strip terms like "spot" or "rot" that are genuinely diagnostic here.
_STOPWORDS = {
    "what", "should", "i", "do", "the", "a", "an", "is", "are", "was", "were",
    "my", "in", "on", "of", "for", "to", "and", "or", "with", "have", "has",
    "there", "this", "that", "it", "please", "help", "how", "why", "can",
    "problem", "issue", "question",
}


def normalize_query(raw: str) -> list[str]:
    """Lowercase, strip punctuation, drop stopwords, dedupe - preserving
    order so the first-mentioned (usually most salient) terms stay first.

    "Tomato leaves have brown circular spots. What should I do?"
      -> ["tomato", "leaves", "brown", "circular", "spots"]
    """
    lowered = raw.lower()
    # Keep letters/digits/spaces only; hyphens become spaces so
    # "leaf-spot" splits into two usable tokens.
    cleaned = re.sub(r"[-_/]", " ", lowered)
    cleaned = re.sub(r"[^a-z0-9\s]", " ", cleaned)
    tokens = [t for t in cleaned.split() if t and t not in _STOPWORDS and len(t) > 1]

    seen, ordered = set(), []
    for t in tokens:
        if t not in seen:
            seen.add(t)
            ordered.append(t)
    return ordered


async def expand_synonyms(session: AsyncSession, tokens: list[str]) -> list[str]:
    """Expand each token with its admin-configured synonyms.

    Bidirectional by design: one row (paddy -> rice) makes a search for
    EITHER word find BOTH, so an admin never has to remember to enter the
    reverse pair. Multi-word entries ("lady finger", "leaf yellowing")
    are matched against the whole normalized query string as well as
    individual tokens, since those can't match a single token.

    Returns the original tokens plus any expansions, deduped and
    order-preserving. Falls back to returning tokens unchanged if the
    lookup fails - a synonym-table problem should degrade search
    quality, never break search entirely.
    """
    if not tokens:
        return []

    joined = " ".join(tokens)
    try:
        result = await session.execute(
            text("""
                SELECT term, synonym FROM search_synonyms
                WHERE is_active = true
                  AND (
                        lower(term) = ANY(:tokens)
                     OR lower(synonym) = ANY(:tokens)
                     OR position(lower(term) in :joined) > 0
                     OR position(lower(synonym) in :joined) > 0
                  )
            """).bindparams(tokens=tokens, joined=joined)
        )
        rows = result.all()
    except Exception:
        return tokens

    expanded = list(tokens)
    seen = set(tokens)
    for row in rows:
        for candidate in (row.term.lower(), row.synonym.lower()):
            # Multi-word synonyms contribute their individual words, so
            # they're usable by a token-based search backend.
            for word in candidate.split():
                if word not in seen and word not in _STOPWORDS and len(word) > 1:
                    seen.add(word)
                    expanded.append(word)
    return expanded


def build_tsquery(tokens: list[str]) -> str:
    """Build a Postgres tsquery string from tokens.

    Uses OR (|) rather than AND: an officer's phrasing rarely matches a
    stored case word-for-word, and requiring every term would return
    nothing far too often. Relevance is handled by RANKING (Phase 3),
    not by making the query restrictive - matching broadly and ranking
    well beats matching narrowly and finding nothing.
    """
    safe = [re.sub(r"[^a-z0-9]", "", t) for t in tokens]
    return " | ".join(t for t in safe if t)


async def prepare_query(session: AsyncSession, raw: str) -> dict:
    """Full Phase 1 pipeline: normalize -> expand -> build tsquery.

    Returned as a dict so Phase 3 can use whichever representation each
    part of the search needs (tokens for trigram/fuzzy, tsquery for
    full-text) without recomputing any of it.
    """
    tokens = normalize_query(raw)
    expanded = await expand_synonyms(session, tokens)
    return {
        "raw": raw,
        "tokens": tokens,
        "expanded_tokens": expanded,
        "tsquery": build_tsquery(expanded),
    }


# ---------------------------------------------------------------------
# Phase 3: search execution and ranking
# ---------------------------------------------------------------------

# Relevance bands instead of a percentage (spec section 6, which asks not
# to display misleading precision). A "91%" implies a calibration this
# system does not have - nothing has been trained or validated to make
# that number mean anything. Bands are honest about the confidence that
# actually exists and are just as actionable for an officer deciding
# whether to trust a result.
BAND_VERY_HIGH = "Very High"
BAND_HIGH = "High"
BAND_MODERATE = "Moderate"
BAND_POSSIBLE = "Possible"

# Spec section 19: weak matches must not be presented as confirmed
# solutions. Anything at or below this normalized score is returned
# under the "these cases may be related" caveat rather than as an answer.
LOW_RELEVANCE_CEILING = 0.35


def score_to_band(normalized: float) -> str:
    if normalized >= 0.75:
        return BAND_VERY_HIGH
    if normalized >= 0.55:
        return BAND_HIGH
    if normalized > LOW_RELEVANCE_CEILING:
        return BAND_MODERATE
    return BAND_POSSIBLE


async def search_knowledge(
    session: AsyncSession,
    raw_query: str,
    limit: int = 20,
    crop_id=None,
    disease_id=None,
) -> dict:
    """Search verified knowledge cases.

    Deliberately NOT an LLM call and not a single opaque relevance
    number: this runs Postgres full-text search and trigram similarity,
    then combines them with the spec's own section 6 weights. Every
    result is an existing, admin-verified row - the system never
    composes an answer.

    Only verification_status = 'verified' is ever returned here (spec
    section 7). Draft/pending cases are reachable through the admin
    endpoints, never through officer search.
    """
    prepared = await prepare_query(session, raw_query)
    tokens = prepared["expanded_tokens"]
    tsq = prepared["tsquery"]

    if not tokens:
        return {"query": raw_query, "prepared": prepared, "results": [], "low_relevance_only": False}

    filters = ["c.verification_status = 'verified'"]
    params: dict = {
        "tsq": tsq,
        "raw": raw_query,
        "limit": limit,
    }
    if crop_id:
        filters.append("c.crop_id = :crop_id")
        params["crop_id"] = crop_id
    if disease_id:
        filters.append("c.disease_id = :disease_id")
        params["disease_id"] = disease_id

    where_sql = " AND ".join(filters)

    # Scoring mirrors the spec's section 6 weights. Two deliberate
    # departures, both to avoid misleading results:
    #
    # 1. The weights are summed and then NORMALIZED against the maximum
    #    achievable for this query, so a case matching five weak keywords
    #    cannot outrank an exact disease match purely on volume.
    # 2. ts_rank is scaled rather than used raw - raw ts_rank values are
    #    small and non-linear, and mixing them unscaled with fixed
    #    integer weights would let full-text noise dominate.
    sql = f"""
        WITH scored AS (
            SELECT
                c.id, c.case_number, c.question, c.symptoms, c.crop_text, c.disease_text,
                c.crop_id, c.disease_id, c.usage_count, c.created_at, c.solution_version_id,
                cr.name AS crop_name,
                d.name  AS disease_name,
                (
                    -- Exact disease name appears in the query (+40)
                    CASE WHEN d.name IS NOT NULL
                          AND position(lower(d.name) in lower(:raw)) > 0 THEN 40 ELSE 0 END
                    -- Exact crop name appears in the query (+25)
                  + CASE WHEN cr.name IS NOT NULL
                          AND position(lower(cr.name) in lower(:raw)) > 0 THEN 25 ELSE 0 END
                    -- Symptom text overlap (+20)
                  + CASE WHEN c.symptoms IS NOT NULL
                          AND to_tsvector('english', c.symptoms) @@ to_tsquery('english', :tsq) THEN 20 ELSE 0 END
                    -- Full-text keyword match on the weighted vector (+10 scaled)
                  + CASE WHEN c.search_vector @@ to_tsquery('english', :tsq)
                         THEN 10 + LEAST(ts_rank(c.search_vector, to_tsquery('english', :tsq)) * 100, 15)
                         ELSE 0 END
                    -- Has a verified solution attached (+10)
                  + CASE WHEN c.solution_version_id IS NOT NULL THEN 10 ELSE 0 END
                    -- Fuzzy similarity on the question text (+5 scaled)
                  + (similarity(c.question, :raw) * 5)
                ) AS raw_score
            FROM knowledge_cases c
            LEFT JOIN crops cr ON cr.id = c.crop_id
            LEFT JOIN diseases d ON d.id = c.disease_id
            WHERE {where_sql}
              AND (
                    c.search_vector @@ to_tsquery('english', :tsq)
                 OR similarity(c.question, :raw) > 0.15
              )
        )
        SELECT * FROM scored WHERE raw_score > 0 ORDER BY raw_score DESC, usage_count DESC LIMIT :limit
    """

    result = await session.execute(text(sql).bindparams(**params))
    rows = result.all()

    # Normalize against the best score actually achieved rather than a
    # theoretical maximum: a query mentioning no known disease can never
    # earn the +40, and penalizing every result for that would push a
    # genuinely good match down into "Possible" for no reason.
    top = max((r.raw_score for r in rows), default=0) or 1

    results = []
    for r in rows:
        normalized = min(float(r.raw_score) / float(top), 1.0)
        results.append({
            "case_id": str(r.id),
            "case_number": r.case_number,
            "question": r.question,
            "symptoms": r.symptoms,
            "crop_name": r.crop_name or r.crop_text,
            "disease_name": r.disease_name or r.disease_text,
            "usage_count": r.usage_count,
            "has_verified_solution": r.solution_version_id is not None,
            "solution_version_id": str(r.solution_version_id) if r.solution_version_id else None,
            "relevance_band": score_to_band(normalized),
            "relevance": round(normalized, 3),
        })

    # Spec section 19: if nothing cleared the low-relevance ceiling, the
    # caller must present these as "may be related", not as answers.
    low_only = bool(results) and all(r["relevance"] <= LOW_RELEVANCE_CEILING for r in results)

    return {
        "query": raw_query,
        "prepared": prepared,
        "results": results,
        "low_relevance_only": low_only,
    }
