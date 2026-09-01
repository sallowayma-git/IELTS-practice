"""M5-03/M5-05 fusion: Reciprocal Rank Fusion + salience/time-decay + diversity.

Deterministic fusion of lexical / embedding / exact candidate lists into a
single ranked list. No provider calls. Salience and time-decay features are
derived from the index metadata so a stale chunk naturally demotes without
being dropped (the Rust materializer re-authorizes anyway).

Clean-room from TechSpa `vector_memory.py:_time_decay` (R2): we borrow the
half-life idea but drive it from canonical `updated_at` and never mix predicted
with observed source trust.
"""

from __future__ import annotations

import math
import time
from datetime import datetime, timezone
from typing import Any, Protocol

from .types import FusionScore, RetrievalCandidate


class IndexStoreLike(Protocol):
    def open(self) -> Any: ...


# RRF constant. Standard k=60 keeps rank-1 from dominating. Deterministic.
RRF_K = 60
# Salience half-life in seconds (~30 days). Stale chunks decay toward 0 but
# never reach it, so a still-relevant old chunk can still surface on lexical
# strength alone.
SALIENCE_HALF_LIFE_SECONDS = 30 * 24 * 3600


def reciprocal_rank_fusion(
    ranked_lists: list[list[RetrievalCandidate]],
) -> list[FusionScore]:
    """Fuse multiple ranked candidate lists via Reciprocal Rank Fusion.

    Each input list is already ordered (best first). Returns FusionScore per
    unique chunk_id with the RRF score and the per-list rank that contributed.
    Lists with no exact rank contribution leave that field None.
    """
    if not ranked_lists:
        return []
    contributions: dict[str, dict[str, int | None]] = {}
    rrf_scores: dict[str, float] = {}
    for list_index, ranked in enumerate(ranked_lists):
        label = _list_label(list_index, ranked_lists)
        for position, candidate in enumerate(ranked):
            cid = candidate.chunk_id
            entry = contributions.setdefault(
                cid,
                {"lexical_rank": None, "embedding_rank": None, "exact_rank": None},
            )
            entry[label] = position + 1
            rrf_scores[cid] = rrf_scores.get(cid, 0.0) + 1.0 / (RRF_K + position + 1)
    # Carry inclusion reasons + source metadata from the first list that surfaced each id.
    reasons: dict[str, list[str]] = {}
    source_meta: dict[str, dict[str, Any]] = {}
    for ranked in ranked_lists:
        for candidate in ranked:
            cid = candidate.chunk_id
            if cid not in reasons and candidate.inclusion_reasons:
                reasons[cid] = list(candidate.inclusion_reasons)
                source_meta[cid] = {
                    "source_kind": candidate.source_kind,
                    "source_id": candidate.source_id,
                    "sensitivity": candidate.sensitivity,
                }
    scores: list[FusionScore] = []
    for cid, rrf in rrf_scores.items():
        ranks = contributions[cid]
        scores.append(
            FusionScore(
                chunk_id=cid,
                lexical_rank=ranks["lexical_rank"],
                embedding_rank=ranks["embedding_rank"],
                exact_rank=ranks["exact_rank"],
                rrf_score=round(rrf, 6),
                salience=0.0,
                time_decay=1.0,
                final_score=round(rrf, 6),
                inclusion_reasons=reasons.get(cid) or ["fusion:rrf"],
            )
        )
    scores.sort(key=lambda score: score.final_score, reverse=True)
    return scores


def apply_time_decay(
    store: IndexStoreLike,
    scores: list[FusionScore],
    *,
    now: float | None = None,
) -> list[FusionScore]:
    """Multiply each score by a time-decay factor derived from canonical updated_at.

    Chunks with no updated_at keep time_decay=1.0 (unknown freshness is not a
    demotion — Rust re-authorizes anyway). Decay is monotonic and bounded in
    (0, 1].
    """
    if not scores:
        return []
    moment = now if now is not None else time.time()
    ids = [score.chunk_id for score in scores]
    placeholders = ",".join("?" for _ in ids)
    conn = store.open()
    rows = conn.execute(
        f"SELECT chunk_id, updated_at FROM chunks WHERE chunk_id IN ({placeholders})",
        tuple(ids),
    ).fetchall()
    updated_at: dict[str, float] = {}
    for row in rows:
        parsed = _parse_updated_at(row["updated_at"])
        if parsed is not None:
            updated_at[row["chunk_id"]] = parsed
    adjusted: list[FusionScore] = []
    for score in scores:
        ts = updated_at.get(score.chunk_id)
        if ts is None:
            adjusted.append(score)
            continue
        age = max(0.0, moment - ts)
        decay = 0.5 ** (age / SALIENCE_HALF_LIFE_SECONDS)
        decay = max(0.0, min(1.0, decay))
        final = min(1.0, score.rrf_score * decay)
        adjusted.append(
            score.model_copy(
                update={
                    "time_decay": round(decay, 6),
                    "final_score": round(final, 6),
                }
            )
        )
    adjusted.sort(key=lambda s: s.final_score, reverse=True)
    return adjusted


def apply_diversity(
    scores: list[FusionScore],
    *,
    max_per_source: int = 3,
) -> list[FusionScore]:
    """Anti-duplicate / diversity cap: at most `max_per_source` per source_id.

    Keeps the strongest candidates per source while preventing a single source
    from flooding the ContextPlan. Deterministic: ties broken by chunk_id.
    """
    if max_per_source <= 0:
        return list(scores)
    seen_per_source: dict[str, int] = {}
    kept: list[FusionScore] = []
    # No source metadata on FusionScore — diversity operates on chunk_id prefix
    # group (activity:asset...) which is stable. This avoids a second DB hit.
    for score in scores:
        group = _source_group(score.chunk_id)
        count = seen_per_source.get(group, 0)
        if count >= max_per_source:
            continue
        seen_per_source[group] = count + 1
        kept.append(score)
    return kept


def finalize_candidates(
    scores: list[FusionScore],
    *,
    top_k: int,
) -> list[RetrievalCandidate]:
    """Project final FusionScores back into RetrievalCandidate for the planner."""
    capped = scores[: max(0, top_k)]
    return [
        RetrievalCandidate(
            chunk_id=score.chunk_id,
            score=score.final_score,
            inclusion_reasons=list(score.inclusion_reasons),
        )
        for score in capped
    ]


def _list_label(index: int, lists: list[list[RetrievalCandidate]]) -> str:
    # Position in the ranked_lists argument determines which rank field it fills.
    # The planner always passes [exact, lexical, embedding] in that order.
    labels = ["exact_rank", "lexical_rank", "embedding_rank"]
    if index < len(labels):
        return labels[index]
    return f"list{index}_rank"


def _parse_updated_at(raw: str | None) -> float | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        return None


def _source_group(chunk_id: str) -> str:
    # chunk_id format from Rust corpus export: "{activity}:{asset_id}:v{N}:{i}"
    # Right-split to allow asset_id to contain ':'. Group on activity+asset.
    stripped = chunk_id
    for _ in range(2):
        stripped = stripped.rsplit(":", 1)[0] if ":" in stripped else stripped
    return stripped


__all__ = [
    "RRF_K",
    "SALIENCE_HALF_LIFE_SECONDS",
    "apply_diversity",
    "apply_time_decay",
    "finalize_candidates",
    "reciprocal_rank_fusion",
]
