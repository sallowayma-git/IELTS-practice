"""M5-03 lexical retrieval via SQLite FTS5 + query normalization.

Pure lexical retrieval over the derived index. No embeddings, no provider calls.
Returns candidates carrying inclusion reasons so the fusion/rerank stages and
the Rust materializer can explain why each chunk surfaced.

The FTS5 mirror lives in `IndexStore` (fts_chunks table). We query it directly
through the same derived connection — this stays inside the disposable index DB
and never touches the canonical IELTS SQLite.
"""

from __future__ import annotations

import re
import time
import unicodedata
from typing import Any, Protocol

from .index_store import IndexStore
from .types import RetrievalCandidate, RetrievalQuery, SourceKind, Sensitivity

# FTS5 query language has operator characters that must be sanitized so a
# user query can never inject FTS syntax. We keep terms alphanumeric.
_FTS_TOKEN_RE = re.compile(r"[^\w]+", re.UNICODE)
_STOPWORDS = frozenset(
    {
        "a", "an", "the", "and", "or", "but", "if", "then", "of", "to", "in",
        "on", "for", "is", "are", "was", "were", "be", "been", "being",
        "this", "that", "these", "those", "it", "its", "as", "at", "by",
    }
)


def normalize_query(raw_text: str) -> str:
    """Lowercase, strip accents, drop punctuation/stopwords, collapse whitespace.

    Returns a non-empty normalized string. Raises ValueError if the query has
    no usable lexical signal after normalization.
    """
    if not raw_text or not raw_text.strip():
        raise ValueError("query text must be non-empty")
    decomposed = unicodedata.normalize("NFKD", raw_text.lower())
    ascii_only = decomposed.encode("ascii", "ignore").decode("ascii")
    tokens = [
        token
        for token in _FTS_TOKEN_RE.split(ascii_only)
        if token and token not in _STOPWORDS
    ]
    normalized = " ".join(tokens)
    if not normalized:
        raise ValueError("query has no lexical signal after normalization")
    return normalized


def build_fts_query(normalized_text: str) -> str:
    """Build a safe FTS5 MATCH expression: quoted terms joined by implicit AND."""
    quoted = [f'"{token}"' for token in normalized_text.split() if token]
    if not quoted:
        raise ValueError("normalized query produced no FTS terms")
    return " ".join(quoted)


class IndexStoreLike(Protocol):
    def open(self) -> Any: ...


def lexical_search(
    store: IndexStore,
    query: RetrievalQuery,
    *,
    top_k: int | None = None,
) -> list[RetrievalCandidate]:
    """Run a lexical lookup against the derived index text mirror.

    Uses case-insensitive LIKE over normalized terms (a portable stand-in for
    FTS5 when the runtime does not compile FTS5 support). Candidates are scored
    by hit-count mapped into [0, 1]: more matching terms -> higher score, with
    the top hit approaching 1.0. Inclusion reasons describe the match path.

    The plan permits FTS5 "if runtime capability available"; LIKE keeps the
    base installer dependency-free and deterministic across platforms.
    """
    limit = max(1, top_k or query.top_k)
    terms = [token for token in query.normalized_text.split() if token]
    if not terms:
        return []
    conn = store.open()
    # Fetch every chunk that matches at least one term, then score + rank in
    # Python. Scoring must not be truncated by a SQL LIMIT, or the strongest
    # match could be dropped before ranking.
    like_clauses = " OR ".join("LOWER(text) LIKE ?" for _ in terms)
    params: list[Any] = [f"%{term}%" for term in terms]
    rows = conn.execute(
        f"SELECT chunk_id, text FROM fts_chunks WHERE {like_clauses}",
        tuple(params),
    ).fetchall()
    if not rows:
        return []
    scored: list[tuple[float, str]] = []
    lowered_terms = [t.lower() for t in terms]
    for row in rows:
        text_lower = (row["text"] or "").lower()
        hits = sum(1 for term in lowered_terms if term in text_lower)
        if hits == 0:
            continue
        scored.append((hits / len(terms), row["chunk_id"]))
    if not scored:
        return []
    scored.sort(key=lambda pair: pair[0], reverse=True)
    max_score = scored[0][0] or 1.0
    candidates: list[RetrievalCandidate] = []
    for position, (frac, chunk_id) in enumerate(scored[:limit]):
        lexical_score = min(1.0, frac / max_score) if max_score > 0 else frac
        candidates.append(
            RetrievalCandidate(
                chunk_id=chunk_id,
                score=round(lexical_score, 6),
                inclusion_reasons=[f"lexical:like:rank{position}:hits{int(frac * len(terms))}"],
            )
        )
    _attach_chunk_metadata(store, candidates)
    return candidates


def exact_lookup(
    store: IndexStore,
    query: RetrievalQuery,
) -> list[RetrievalCandidate]:
    """M5-03 step 1: exact stable-ID lookup. Highest-trust, no scoring drift."""
    if not query.exact_ids:
        return []
    placeholders = ",".join("?" for _ in query.exact_ids)
    conn = store.open()
    rows = conn.execute(
        f"SELECT chunk_id, source_kind, source_id, sensitivity "
        f"FROM chunks WHERE chunk_id IN ({placeholders})",
        tuple(query.exact_ids),
    ).fetchall()
    found = {row["chunk_id"]: row for row in rows}
    candidates: list[RetrievalCandidate] = []
    for identifier in query.exact_ids:
        row = found.get(identifier)
        if row is None:
            continue
        candidates.append(
            RetrievalCandidate(
                chunk_id=identifier,
                score=1.0,
                inclusion_reasons=["exact:stable_id"],
                source_kind=SourceKind(row["source_kind"]) if row["source_kind"] else None,
                source_id=row["source_id"],
                sensitivity=Sensitivity(row["sensitivity"]) if row["sensitivity"] else None,
            )
        )
    return candidates


def filter_by_scope(
    store: IndexStore,
    query: RetrievalQuery,
    candidates: list[RetrievalCandidate],
) -> list[RetrievalCandidate]:
    """M5-03 step 2: scope/activity/skill filtering using chunk metadata."""
    if not (query.scope or query.activity or query.skill) or not candidates:
        return list(candidates)
    wanted_ids = {candidate.chunk_id for candidate in candidates}
    placeholders = ",".join("?" for _ in wanted_ids)
    clauses: list[str] = []
    params: list[Any] = list(wanted_ids)
    if query.scope:
        clauses.append("scope = ?")
        params.append(query.scope)
    if query.activity:
        clauses.append("activity = ?")
        params.append(query.activity)
    if query.skill:
        clauses.append("skill = ?")
        params.append(query.skill)
    conn = store.open()
    rows = conn.execute(
        f"SELECT chunk_id FROM chunks WHERE chunk_id IN ({placeholders}) "
        f"AND ({' AND '.join(clauses)})",
        tuple(params),
    ).fetchall()
    allowed = {row["chunk_id"] for row in rows}
    return [candidate for candidate in candidates if candidate.chunk_id in allowed]


def _attach_chunk_metadata(
    store: IndexStore, candidates: list[RetrievalCandidate]
) -> None:
    if not candidates:
        return
    ids = [candidate.chunk_id for candidate in candidates]
    placeholders = ",".join("?" for _ in ids)
    conn = store.open()
    rows = conn.execute(
        f"SELECT chunk_id, source_kind, source_id, sensitivity "
        f"FROM chunks WHERE chunk_id IN ({placeholders})",
        tuple(ids),
    ).fetchall()
    meta = {row["chunk_id"]: row for row in rows}
    for candidate in candidates:
        row = meta.get(candidate.chunk_id)
        if row is None:
            continue
        # Frozen pydantic model: rebuild with metadata attached.
        object.__setattr__(
            candidate,
            "source_kind",
            SourceKind(row["source_kind"]) if row["source_kind"] else None,
        )
        object.__setattr__(candidate, "source_id", row["source_id"] or None)
        object.__setattr__(
            candidate,
            "sensitivity",
            Sensitivity(row["sensitivity"]) if row["sensitivity"] else None,
        )


__all__ = [
    "build_fts_query",
    "exact_lookup",
    "filter_by_scope",
    "lexical_search",
    "normalize_query",
]
