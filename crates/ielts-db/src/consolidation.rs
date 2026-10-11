//! M8 memory lifecycle persistence: user feedback and the stale-archive sweep.
//!
//! Feedback and the stale sweep archive memory and invalidate the supports that
//! depend on it (`propagate_support_change_in_transaction`). Facts are never
//! physically deleted. The pattern-consolidation pipeline that once lived here
//! was removed because nothing produced or consumed it.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use uuid::Uuid;

use ielts_domain::{
    ArchivePolicy, MemoryFeedbackKind, MemoryFeedbackRecord, StaleArchiveReport,
    SupportChangeOutcome,
};

use crate::sqlite::{DbError, DbResult};

pub(crate) fn propagate_support_change_in_transaction(
    conn: &Connection,
    memory_id: &str,
    new_status: &str,
    now: &str,
) -> DbResult<SupportChangeOutcome> {
    let owner: String = conn.query_row(
        "SELECT user_id FROM memory_items WHERE id=?1",
        [memory_id],
        |row| row.get(0),
    )?;
    // UNION (not UNION ALL) visits each stable ID once, including old cyclic
    // backup graphs. Never traverse a foreign owner, even to re-enter this one.
    let affected: Vec<String> = conn
        .prepare(
            "WITH RECURSIVE dependents(id) AS (
                SELECT ?1
                UNION
                SELECT r.target_memory_id FROM dependents d
                JOIN memory_relations r ON r.source_memory_id=d.id
                JOIN memory_items target ON target.id=r.target_memory_id
                WHERE r.relation_kind='supports_consolidation' AND target.user_id=?2
             ) SELECT id FROM dependents WHERE id != ?1 ORDER BY id",
        )?
        .query_map(params![memory_id, owner], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    if affected.is_empty() {
        return Ok(SupportChangeOutcome::NoPatternAffected);
    }
    if new_status == "improved" {
        // Support improved → decay the pattern's confidence (not delete).
        for pattern_id in &affected {
            conn.execute(
                "UPDATE memory_items SET confidence=MAX(0, confidence*0.7),
                     version=version+1, updated_at=?1
                 WHERE id=?2 AND status IN ('active','superseded')",
                params![now, pattern_id],
            )?;
        }
        return Ok(SupportChangeOutcome::ConfidenceDecayed);
    }
    // Missing/refuted evidence invalidates every derived conclusion, not just
    // a currently active direct child. Preserve content and lineage for review.
    for pattern_id in &affected {
        crate::memory::archive_memory_record(
            conn,
            pattern_id,
            "system",
            None,
            "support memory invalidated",
            now,
        )?;
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
    let tx = conn.unchecked_transaction()?;
    let conn = &*tx;
    let now_ts = chrono::DateTime::parse_from_rfc3339(now)
        .map(|dt| dt.timestamp())
        .unwrap_or(0);
    let kinds: Vec<String> = conn
        .prepare("SELECT memory_kind FROM memory_capacity_state ORDER BY memory_kind")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let archived_before: i64 = conn.query_row(
        "SELECT COUNT(*) FROM memory_items WHERE status='archived'",
        [],
        |row| row.get(0),
    )?;
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
                let ids = conn
                    .prepare(
                        "SELECT id FROM memory_items
                     WHERE namespace=?2 AND status='active'
                       AND COALESCE(last_observed_at, updated_at, created_at) < ?3",
                    )?
                    .query_map(params![now, kind, cutoff_iso], |row| {
                        row.get::<_, String>(0)
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                for id in ids {
                    crate::memory::archive_memory_record(
                        conn,
                        &id,
                        "system",
                        None,
                        "stale memory policy",
                        now,
                    )?;
                    propagate_support_change_in_transaction(conn, &id, "archived", now)?;
                }
            }
        }
    }
    let archived_after: i64 = conn.query_row(
        "SELECT COUNT(*) FROM memory_items WHERE status='archived'",
        [],
        |row| row.get(0),
    )?;
    tx.commit()?;
    Ok(StaleArchiveReport {
        archived_count: (archived_after - archived_before) as usize,
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
    let tx = conn.unchecked_transaction()?;
    let owned: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM memory_items
         WHERE id=?1 AND user_id=?2 AND status != 'deleted')",
        params![memory_id, user_id],
        |row| row.get(0),
    )?;
    if !owned {
        return Err(DbError::Validation("missing or foreign memory".into()));
    }
    let id = format!("mfb-{}", Uuid::new_v4());
    tx.execute(
        "INSERT INTO memory_feedback (id, memory_id, feedback_kind, user_id, payload_json,
            created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            id,
            memory_id,
            kind.as_str(),
            user_id,
            payload.to_string(),
            now
        ],
    )?;
    if kind.is_contradiction() || kind.archives_memory() {
        crate::memory::archive_memory_record(
            &tx,
            memory_id,
            "user",
            Some(user_id),
            kind.as_str(),
            now,
        )?;
        propagate_support_change_in_transaction(&tx, memory_id, "refuted", now)?;
    }
    tx.commit()?;
    Ok(MemoryFeedbackRecord {
        id,
        memory_id: memory_id.to_string(),
        feedback_kind: kind,
        user_id: user_id.to_string(),
        payload: payload.clone(),
        created_at: now.to_string(),
    })
}
