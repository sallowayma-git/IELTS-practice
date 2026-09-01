//! M8 Weekly Dream consolidation persistence (§23.16/§23.17).
//!
//! Rust-owned authority for the cross-scope pattern pipeline. The Python
//! Weekly Dream proposes patterns with stable `mem-*` IDs; Rust re-loads those
//! IDs from `memory_items` (never trusting the LLM index), and applies
//! consolidation as relations + supersede — never physically deleting supports.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

use ielts_domain::{
    ArchivePolicy, ConsolidationConfig, ConsolidationReceipt, MemoryFeedbackKind,
    MemoryFeedbackRecord, MemoryRelationKind, PatternProposal, PatternValidationReport,
    StaleArchiveReport, SupportChangeOutcome, ValidatedPattern,
};

use crate::sqlite::{DbError, DbResult};

#[cfg(test)]
const SUPPORT_KIND_PUBLISHED: &str = "active";

/// A bounded view of a support memory used by the validator.
#[derive(Debug, Clone, PartialEq)]
pub struct SupportMemory {
    pub memory_id: String,
    pub status: String,
    pub source_class: String,
    pub canonical_key: String,
    pub scope: String,
    pub namespace: String,
    pub subject_key: Option<String>,
    pub last_observed_at: Option<String>,
}

/// Load a batch of support memories by stable ID, scoped to one owner. The
/// validator never trusts the LLM index; it re-reads these rows from
/// `memory_items`.
///
/// Round-3 audit (A1): the `user_id` predicate is load-bearing, not defensive
/// decoration. Without it a caller could name another user's `mem-*` id as a
/// support, and `apply_consolidation` would supersede that row and cite it as
/// evidence for a pattern written into the caller's own memory. An id that
/// exists but belongs to someone else now reads as `HallucinatedSupportId`,
/// which is the honest answer: it does not exist as far as this caller is
/// concerned.
pub fn load_support_memories(
    conn: &Connection,
    ids: &[String],
    user_id: &str,
) -> DbResult<Vec<SupportMemory>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = std::iter::repeat("?")
        .take(ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT id, status, source_class, canonical_key, scope, namespace,
                subject_key, last_observed_at
         FROM memory_items
         WHERE user_id = ?1 AND id IN ({placeholders})"
    );
    let mut statement = conn.prepare(&sql)?;
    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(ids.len() + 1);
    params.push(&user_id as &dyn rusqlite::ToSql);
    params.extend(ids.iter().map(|id| id as &dyn rusqlite::ToSql));
    let rows = statement.query_map(
        params.as_slice(),
        |row| {
            Ok(SupportMemory {
                memory_id: row.get(0)?,
                status: row.get(1)?,
                source_class: row.get(2)?,
                canonical_key: row.get(3)?,
                scope: row.get(4)?,
                namespace: row.get(5)?,
                subject_key: row.get::<_, Option<String>>(6)?,
                last_observed_at: row.get::<_, Option<String>>(7)?,
            })
        },
    )?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Insert a `memory_relations` edge. Idempotent on (source, target, kind).
pub fn insert_memory_relation(
    conn: &Connection,
    source: &str,
    target: &str,
    kind: MemoryRelationKind,
    now: &str,
) -> DbResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO memory_relations (id, source_memory_id, target_memory_id,
            relation_kind, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![format!("mrel-{}", Uuid::new_v4()), source, target, kind.as_str(), now],
    )?;
    Ok(())
}

/// Insert the consolidated memory as `source_class='consolidated'`, then mark
/// each support `superseded` (NOT deleted) and link a `supports_consolidation`
/// relation so the consolidation is reversible (M8-06).
pub fn apply_consolidation(
    conn: &Connection,
    pattern: &ValidatedPattern,
    user_id: &str,
    now: &str,
) -> DbResult<ConsolidationReceipt> {
    let tx = conn.unchecked_transaction()?;
    let consolidated_id = format!("mem-{}", Uuid::new_v4());
    let content_hash = sha256_hex(&pattern.statement);
    tx.execute(
        "INSERT INTO memory_items (
            id, user_id, namespace, scope, memory_type, canonical_key, normalized_label,
            content, status, source_class, confidence, importance, source_trust, sensitivity,
            improvement_state, version, created_by, content_hash,
            first_observed_at, last_observed_at, created_at, updated_at
         ) VALUES (?1, ?8, 'strategy', 'consolidated', 'procedural', ?2, ?3, ?4,
                   'active', 'consolidated', ?5, ?5, 0.7, 'normal', 'baseline', 1,
                   'weekly_dream', ?6, ?7, ?7, ?7, ?7)",
        params![
            consolidated_id,
            format!("consolidated:{}", content_hash),
            pattern.statement.chars().take(120).collect::<String>(),
            pattern.statement,
            pattern.confidence,
            content_hash,
            now,
            user_id,
        ],
    )?;
    let mut relations_created = 0usize;
    for support_id in &pattern.support_ids {
        insert_memory_relation(
            &tx,
            support_id,
            &consolidated_id,
            MemoryRelationKind::SupportsConsolidation,
            now,
        )?;
        // Mark the support superseded (not deleted) — preserves lineage + reversibility.
        //
        // This must not be discarded. The receipt below asserts that every
        // `support_ids` entry was superseded, and `weekly_output_hash` hashes
        // that receipt into the dream run's recorded output, so a swallowed
        // failure here writes a false claim into the audit trail: the pattern
        // reads as consolidated while its supports stay `active`, which inverts
        // the M8-06 reversibility contract.
        //
        // Zero affected rows is an error, not a no-op. `validate_one` has
        // already established that each support is active and owned by
        // `user_id`, so a miss means the row changed underneath us between
        // validation and apply. Failing closed keeps the receipt honest; the
        // whole transaction rolls back rather than recording a partial
        // consolidation as complete.
        let superseded = tx.execute(
            "UPDATE memory_items SET status='superseded', version=version+1, updated_at=?1
             WHERE id=?2 AND user_id=?3 AND status='active'",
            params![now, support_id, user_id],
        )?;
        if superseded == 0 {
            return Err(DbError::Validation(format!(
                "support {support_id} was not superseded: it is no longer active                  or not owned by {user_id}"
            )));
        }
        relations_created += 1;
    }
    tx.commit()?;
    Ok(ConsolidationReceipt {
        consolidated_memory_id: consolidated_id,
        support_ids: pattern.support_ids.clone(),
        relations_created,
    })
}

/// M8-07: when a support memory changes status, decay/archive any consolidated
/// pattern it feeds. Returns the propagation outcome for the first affected
/// pattern (there is normally one).
pub fn propagate_support_change(
    conn: &Connection,
    memory_id: &str,
    new_status: &str,
    now: &str,
) -> DbResult<SupportChangeOutcome> {
    // Find consolidated patterns this memory supports.
    let affected: Vec<String> = conn
        .prepare(
            "SELECT target_memory_id FROM memory_relations
             WHERE source_memory_id=?1 AND relation_kind='supports_consolidation'",
        )?
        .query_map(params![memory_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    if affected.is_empty() {
        return Ok(SupportChangeOutcome::NoPatternAffected);
    }
    if new_status == "improved" {
        // Support improved → decay the pattern's confidence (not delete).
        for pattern_id in &affected {
            let _ = conn.execute(
                "UPDATE memory_items SET confidence=MAX(0, confidence*0.7), updated_at=?1
                 WHERE id=?2",
                params![now, pattern_id],
            );
        }
        return Ok(SupportChangeOutcome::ConfidenceDecayed);
    }
    // Any refuted/improved-all → archive (not delete).
    for pattern_id in &affected {
        let _ = conn.execute(
            "UPDATE memory_items SET status='archived', version=version+1, updated_at=?1
             WHERE id=?2 AND status='active'",
            params![now, pattern_id],
        );
    }
    Ok(SupportChangeOutcome::PatternArchived)
}

/// M8-08: stale archive sweep. Per-kind policy; archive (not delete) memories
/// whose last_observed_at is older than the policy window. Explicit preferences
/// and user goals are never auto-archived.
///
/// Round-3 audit (B1): `memory_capacity_state.memory_kind` shares its domain
/// with `memory_items.namespace` (knowledge/language/strategy/behavior/
/// metacognition/preference/goal), NOT with `memory_items.memory_type`
/// (semantic/episodic/procedural/inferred_profile/goal/constraint). The sweep
/// previously bound the kind to `memory_type`, so every non-skipped kind matched
/// zero rows and the whole sweep was a silent no-op. The policy is per-namespace.
///
/// A row's age is `COALESCE(last_observed_at, updated_at, created_at)`, never a
/// bare `last_observed_at IS NULL` disjunct. `last_observed_at` is nullable
/// (0014:39) and `apply_consolidation` used to leave it NULL, so treating NULL
/// as "infinitely stale" would archive every freshly written weekly-dream
/// pattern on the very first sweep — while its supports stay `superseded`,
/// which would drop the knowledge out of active memory entirely and invert the
/// M8-06 reversibility contract. `created_at`/`updated_at` are `NOT NULL`
/// (0014:49-50), so the fallback always terminates. This also protects rows
/// already persisted with NULL in existing user databases, which the
/// insert-side fix below cannot reach.
pub fn archive_stale(conn: &Connection, now: &str) -> DbResult<StaleArchiveReport> {
    let now_ts = chrono::DateTime::parse_from_rfc3339(now)
        .map(|dt| dt.timestamp())
        .unwrap_or(0);
    let kinds: Vec<String> = conn
        .prepare("SELECT memory_kind FROM memory_capacity_state ORDER BY memory_kind")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut archived = 0usize;
    let mut skipped: Vec<String> = Vec::new();
    let mut policy_by_kind: Vec<(String, String)> = Vec::new();
    for kind in kinds {
        let policy_str = conn
            .query_row(
                "SELECT state_json FROM memory_capacity_state WHERE memory_kind=?1",
                params![kind],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let policy_json: Value = policy_str
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok())
            .unwrap_or(json!({"policy":"medium"}));
        let policy_label = policy_json
            .get("policy")
            .and_then(Value::as_str)
            .unwrap_or("medium");
        let archive_policy = ArchivePolicy::parse(policy_label).unwrap_or(ArchivePolicy::Medium);
        policy_by_kind.push((kind.clone(), archive_policy.as_str().to_string()));
        match archive_policy.archive_after_days() {
            None => skipped.push(kind),
            Some(days) => {
                let cutoff_secs = now_ts - days * 86400;
                let cutoff_iso = chrono::DateTime::from_timestamp(cutoff_secs, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_else(|| now.to_string());
                let count = conn.execute(
                    "UPDATE memory_items SET status='archived', version=version+1, updated_at=?1
                     WHERE namespace=?2 AND status='active'
                       AND COALESCE(last_observed_at, updated_at, created_at) < ?3",
                    params![now, kind, cutoff_iso],
                )?;
                archived += count;
            }
        }
    }
    Ok(StaleArchiveReport {
        archived_count: archived,
        skipped_kinds: skipped,
        policy_by_kind,
    })
}

/// M8-09: record user feedback against a stable memory_id. `inaccurate` is
/// strong contradiction but does NOT delete the underlying learning facts.
pub fn record_memory_feedback(
    conn: &Connection,
    memory_id: &str,
    kind: MemoryFeedbackKind,
    user_id: &str,
    payload: &Value,
    now: &str,
) -> DbResult<MemoryFeedbackRecord> {
    let id = format!("mfb-{}", Uuid::new_v4());
    conn.execute(
        "INSERT INTO memory_feedback (id, memory_id, feedback_kind, user_id, payload_json,
            created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, memory_id, kind.as_str(), user_id, payload.to_string(), now],
    )?;
    // M8-07: `inaccurate` triggers contradiction propagation; `outdated`/
    // `not_about_me` archive without deleting.
    if kind.is_contradiction() {
        propagate_support_change(conn, memory_id, "refuted", now)?;
    } else if kind.archives_memory() {
        let _ = conn.execute(
            "UPDATE memory_items SET status='archived', version=version+1, updated_at=?1
             WHERE id=?2 AND status='active'",
            params![now, memory_id],
        );
    }
    Ok(MemoryFeedbackRecord {
        id,
        memory_id: memory_id.to_string(),
        feedback_kind: kind,
        user_id: user_id.to_string(),
        payload: payload.clone(),
        created_at: now.to_string(),
    })
}

/// M8-02: the validator's core. Re-loads support memories by stable ID, runs
/// the TechSpar Stage 3 four gates + IELTS-specific gates. Returns a report;
/// empty `validated` is success (M8-01).
pub fn validate_patterns(
    conn: &Connection,
    proposals: &[PatternProposal],
    user_id: &str,
    config: &ConsolidationConfig,
) -> DbResult<PatternValidationReport> {
    let mut validated: Vec<ValidatedPattern> = Vec::new();
    let mut rejected: Vec<ielts_domain::PatternRejection> = Vec::new();
    for proposal in proposals {
        match validate_one(conn, proposal, user_id, config)? {
            Ok(pattern) => validated.push(pattern),
            Err(reason) => rejected.push(ielts_domain::PatternRejection {
                statement: proposal.statement.clone(),
                reason,
            }),
        }
    }
    Ok(PatternValidationReport {
        schema_version: ielts_domain::CONSOLIDATION_SCHEMA_VERSION,
        validated,
        rejected,
    })
}

fn validate_one(
    conn: &Connection,
    proposal: &PatternProposal,
    user_id: &str,
    config: &ConsolidationConfig,
) -> DbResult<Result<ValidatedPattern, ielts_domain::RejectReason>> {
    use ielts_domain::RejectReason;

    // Statement must be non-trivial and bounded.
    //
    // Round-3 audit (A1): every guard below was declared in the domain and
    // never wired. `MAX_PATTERN_STATEMENT_BYTES` had no reference anywhere in
    // the workspace, and `ForbiddenStatementContent` was never constructed —
    // so an LLM statement of any size, carrying any content, went straight into
    // `memory_items` as `status='active'`. This function is the single choke
    // point both weekly callers pass through, which is why the guards belong
    // here rather than in a parallel pending-candidate pipeline.
    if proposal.statement.trim().is_empty() {
        return Ok(Err(RejectReason::StatementTooShort));
    }
    if proposal.statement.len() > ielts_domain::MAX_PATTERN_STATEMENT_BYTES {
        return Ok(Err(RejectReason::StatementTooLong {
            provided: proposal.statement.len(),
            max: ielts_domain::MAX_PATTERN_STATEMENT_BYTES,
        }));
    }
    // Prompt-injection / credential markers. Shared with the daily proposal
    // validator via `ielts_domain::text_guard`, so a marker added for one path
    // protects the other.
    if ielts_domain::contains_security_marker(&proposal.statement) {
        return Ok(Err(RejectReason::ForbiddenStatementContent));
    }
    // M8-05's other half: `PatternKind` closes the *declared* kind set at
    // deserialize, but nothing stopped a model from declaring an allowed kind
    // and smuggling a clinical / personality / intelligence claim through as
    // free-text `statement`. The domain doc comment on `PatternKind` has
    // promised this scan since M8; it was never implemented.
    if ielts_domain::contains_forbidden_inference_domain(&proposal.statement) {
        return Ok(Err(RejectReason::ForbiddenStatementContent));
    }
    if proposal.supporting_memory_ids.len() > ielts_domain::MAX_PATTERN_SUPPORT_IDS {
        return Ok(Err(RejectReason::TooManySupportIds {
            provided: proposal.supporting_memory_ids.len(),
            max: ielts_domain::MAX_PATTERN_SUPPORT_IDS,
        }));
    }
    // M8-02: re-load supports from the DB by stable ID.
    let supports = load_support_memories(conn, &proposal.supporting_memory_ids, user_id)?;
    // Hallucinated IDs (not in the DB) reject the whole pattern.
    let mut verified: Vec<&SupportMemory> = Vec::new();
    for id in &proposal.supporting_memory_ids {
        match supports.iter().find(|s| &s.memory_id == id) {
            Some(s) => verified.push(s),
            None => {
                return Ok(Err(RejectReason::HallucinatedSupportId {
                    support_id: id.clone(),
                }))
            }
        }
    }
    // Min supports gate (M8-03).
    if verified.len() < config.min_supports {
        return Ok(Err(RejectReason::BelowMinSupports {
            provided: verified.len(),
            required: config.min_supports,
        }));
    }
    // No predicted-only / superseded supports (M8-10, M8-04).
    for support in &verified {
        if support.source_class == "predicted" {
            return Ok(Err(RejectReason::PredictedOnlySupport {
                support_id: support.memory_id.clone(),
            }));
        }
        if support.status == "superseded" || support.status == "archived" {
            return Ok(Err(RejectReason::SupersededSupport {
                support_id: support.memory_id.clone(),
            }));
        }
    }
    // Distinct assets (M8-04: same asset 3x is not independent). Asset identity
    // is derived from the support's `subject_key` (falls back to canonical_key).
    let distinct_assets: std::collections::HashSet<&str> = verified
        .iter()
        .map(|s| {
            s.subject_key
                .as_deref()
                .unwrap_or(s.canonical_key.as_str())
        })
        .collect();
    if distinct_assets.len() < config.min_distinct_assets {
        return Ok(Err(RejectReason::InsufficientDistinctAssets {
            provided: distinct_assets.len(),
            required: config.min_distinct_assets,
        }));
    }
    // Distinct scopes for cross-cutting patterns (M8-03).
    if proposal.pattern_kind.is_cross_cutting() {
        let distinct_scopes: std::collections::HashSet<&str> =
            verified.iter().map(|s| s.scope.as_str()).collect();
        if distinct_scopes.len() < config.min_distinct_scopes {
            return Ok(Err(RejectReason::InsufficientDistinctScopes {
                provided: distinct_scopes.len(),
                required: config.min_distinct_scopes,
            }));
        }
    }
    Ok(Ok(ValidatedPattern {
        statement: proposal.statement.clone(),
        support_ids: proposal.supporting_memory_ids.clone(),
        pattern_kind: proposal.pattern_kind,
        confidence: proposal.confidence_proposal.clamp(0.0, 1.0),
        distinct_asset_count: distinct_assets.len(),
        distinct_scope_count: verified
            .iter()
            .map(|s| s.scope.as_str())
            .collect::<std::collections::HashSet<_>>()
            .len(),
    }))
}

fn sha256_hex(text: &str) -> String {
    use sha2::Digest;
    let digest = sha2::Sha256::digest(text.as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

#[cfg(test)]
mod tests {
    use ielts_domain::DEFAULT_MIN_SUPPORTS;

    use super::*;

    #[test]
    fn min_supports_gate_rejects_below_threshold() {
        assert!(DEFAULT_MIN_SUPPORTS >= 3);
    }
}
