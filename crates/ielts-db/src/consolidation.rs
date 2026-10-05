//! M8 Weekly Dream consolidation persistence (§23.16/§23.17).
//!
//! Rust-owned authority for the cross-scope pattern pipeline. The Python
//! Weekly Dream proposes patterns with stable `mem-*` IDs; Rust re-loads those
//! IDs from `memory_items` (never trusting the LLM index), and applies
//! consolidation as relations + supersede — never physically deleting supports.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashSet;
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
    let rows = statement.query_map(params.as_slice(), |row| {
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
    })?;
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
        params![
            format!("mrel-{}", Uuid::new_v4()),
            source,
            target,
            kind.as_str(),
            now
        ],
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
    apply_consolidation_with_config(conn, pattern, user_id, now, &ConsolidationConfig::default())
}

/// Apply using policy supplied by the trusted service, never by the receipt.
/// The legacy entry point above always uses the default policy. Custom-policy
/// callers must pass the same trusted config to validation and this function.
pub fn apply_consolidation_with_config(
    conn: &Connection,
    pattern: &ValidatedPattern,
    user_id: &str,
    now: &str,
    config: &ConsolidationConfig,
) -> DbResult<ConsolidationReceipt> {
    let tx = conn.unchecked_transaction()?;
    let snapshot: ValidationSnapshot = serde_json::from_str(&pattern.evidence_snapshot)
        .map_err(|_| DbError::Validation("missing consolidation validation receipt".into()))?;
    if snapshot.config != *config {
        return Err(DbError::Validation(
            "consolidation validation policy mismatch".into(),
        ));
    }
    let proposal = PatternProposal {
        statement: pattern.statement.clone(),
        supporting_memory_ids: pattern.support_ids.clone(),
        pattern_kind: pattern.pattern_kind,
        confidence_proposal: pattern.confidence,
    };
    let current = validate_one(&tx, &proposal, user_id, config)?
        .map_err(|reason| DbError::Validation(format!("consolidation revalidation: {reason:?}")))?;
    if &current != pattern {
        return Err(DbError::Validation(
            "consolidation evidence changed since validation".into(),
        ));
    }
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
        // Preserve the verified practice lineage for later consolidation too;
        // a newly created pattern must not become another evidence-free label.
        tx.execute(
            "INSERT OR IGNORE INTO memory_evidence
                (memory_id,observation_id,source_fingerprint,projector_key,projector_version,
                 evidence_role,event_ids_json,evidence_hash,created_at)
             SELECT ?1,observation_id,source_fingerprint,projector_key,projector_version,
                    evidence_role,event_ids_json,evidence_hash,created_at
             FROM memory_evidence WHERE memory_id=?2 AND evidence_role='support'",
            params![consolidated_id, support_id],
        )?;
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

/// M8-07: same-owner, cycle-safe propagation. All changes are atomic.
pub fn propagate_support_change(
    conn: &Connection,
    memory_id: &str,
    new_status: &str,
    now: &str,
) -> DbResult<SupportChangeOutcome> {
    let tx = conn.unchecked_transaction()?;
    let outcome = propagate_support_change_in_transaction(&tx, memory_id, new_status, now)?;
    tx.commit()?;
    Ok(outcome)
}

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

/// M8-02: the validator's core. Re-loads support memories by stable ID, runs
/// the Stage 3 four gates + IELTS-specific gates. Returns a report;
/// empty `validated` is success (M8-01).
pub fn validate_patterns(
    conn: &Connection,
    proposals: &[PatternProposal],
    user_id: &str,
    config: &ConsolidationConfig,
) -> DbResult<PatternValidationReport> {
    // One read snapshot for all memory/projection/ledger reads.
    let tx = conn.unchecked_transaction()?;
    let mut validated: Vec<ValidatedPattern> = Vec::new();
    let mut rejected: Vec<ielts_domain::PatternRejection> = Vec::new();
    for proposal in proposals {
        match validate_one(&tx, proposal, user_id, config)? {
            Ok(pattern) => validated.push(pattern),
            Err(reason) => rejected.push(ielts_domain::PatternRejection {
                statement: proposal.statement.clone(),
                reason,
            }),
        }
    }
    tx.commit()?;
    Ok(PatternValidationReport {
        schema_version: ielts_domain::CONSOLIDATION_SCHEMA_VERSION,
        validated,
        rejected,
    })
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ValidationSnapshot {
    config: ConsolidationConfig,
    fingerprint: String,
}

struct PracticeEvidence {
    observation: String,
    event: String,
    asset: String,
    question: Option<String>,
    session: String,
    skill: Option<String>,
    snapshot: String,
}

fn load_practice_evidence(
    conn: &Connection,
    memory_id: &str,
    user_id: &str,
) -> DbResult<Vec<PracticeEvidence>> {
    // Durable lineage must agree with the current projection AND its ledger.
    // Labels and memory scopes never establish practice identity. Suite attempts
    // share a session; free-standing attempts use their own stable IDs.
    let mut query = conn.prepare(
        "SELECT a.asset_id, e.question_id,
                CASE WHEN a.suite_id IS NOT NULL AND a.suite_id != ''
                     THEN 'suite:' || a.suite_id ELSE 'attempt:' || a.id END,
                sc.skill_key,
                json_array(
                    json_array(me.memory_id,me.observation_id,me.source_fingerprint,me.projector_key,
                        me.projector_version,me.evidence_role,me.event_ids_json,me.evidence_hash,me.created_at),
                    json_array(o.id,o.user_id,o.observation_type,o.namespace,o.scope_kind,o.scope_key,
                        o.polarity,o.value_num,o.value_text,o.payload_json,o.confidence,o.evidence_strength,
                        o.observed_at,o.projector_key,o.projector_version,o.source_fingerprint,o.created_at),
                    json_array(oe.evidence_role,oe.ordinal),
                    json_array(e.id,e.user_id,e.event_type,e.source_kind,e.source_id,e.idempotency_key,
                        e.activity,e.asset_id,e.attempt_id,e.question_id,e.skill_key,e.occurred_at,
                        e.payload_json,e.content_hash,e.schema_version,e.consolidation_state,
                        e.sensitivity,e.created_at,e.updated_at),
                    json_array(a.id,a.activity,a.asset_id,a.mode,a.suite_id,a.status,a.started_at,
                        a.submitted_at,a.completed_at,a.duration_ms,a.score_value,a.score_scale,
                        a.correct_count,a.question_count,a.title_snapshot,a.prompt_snapshot,
                        a.content_text,a.schema_version,a.created_at,a.updated_at,a.task_type),
                    json_array(ans.answer_json,ans.is_correct,ans.weight,ans.question_kind,
                        ans.change_count,ans.visit_count,ans.elapsed_ms,ans.marked,ans.answered_at),
                    json_array(so.id,so.user_id,so.skill_key,so.outcome,so.mapping_weight,so.evidence_weight,
                        so.novelty_weight,so.familiarity_weight,so.time_weight,so.error_type,
                        so.context_json,so.observed_at,so.intervention_id,so.intervention_type),
                    json_array(qm.skill_key,qm.weight,qm.mapping_source,qm.mapping_version,qm.created_at,qm.updated_at),
                    json_array(sc.skill_key,sc.activity,sc.parent_key,sc.label,sc.description,
                        sc.taxonomy_version,sc.mapping_source,sc.created_at,sc.updated_at),
                    json_array(asset.id,asset.activity,asset.source_kind,asset.source_key,asset.title,
                        asset.category,asset.difficulty,asset.frequency,asset.content_ref,
                        asset.schema_version,asset.fingerprint,asset.pdf_only,asset.metadata_json,
                        asset.created_at,asset.updated_at)),
                me.observation_id,e.id
         FROM memory_evidence me
         JOIN learner_observations o ON o.id=me.observation_id AND o.user_id=?2
              AND o.source_fingerprint=me.source_fingerprint
              AND o.projector_key=me.projector_key AND o.projector_version=me.projector_version
         JOIN learner_observation_evidence oe ON oe.observation_id=o.id AND oe.evidence_role='support'
         JOIN learning_events e ON e.id=oe.event_id AND e.user_id=?2
         JOIN json_each(me.event_ids_json) cited ON cited.value=e.id AND cited.type='text'
         JOIN attempts a ON a.id=e.attempt_id
         JOIN practice_assets asset ON asset.id=a.asset_id AND asset.activity=a.activity
         LEFT JOIN attempt_answers ans ON ans.attempt_id=a.id AND ans.question_id=e.question_id
         LEFT JOIN learner_skill_observations so ON so.event_id=e.id AND so.user_id=?2
              AND so.attempt_id=a.id AND so.asset_id=a.asset_id AND so.question_id=e.question_id
         LEFT JOIN question_skill_map qm ON qm.asset_id=a.asset_id AND qm.question_id=e.question_id
              AND qm.active=1 AND qm.mapping_source != 'model_proposed'
         LEFT JOIN skill_catalog sc ON sc.skill_key=COALESCE(so.skill_key,e.skill_key,qm.skill_key)
              AND sc.active=1 AND sc.mapping_source != 'model_proposed' AND sc.activity=a.activity
         WHERE me.memory_id=?1 AND me.evidence_role='support'
              AND a.status='completed'
              AND (e.asset_id IS NULL OR e.asset_id=a.asset_id)
              AND (e.activity IS NULL OR e.activity=a.activity)
              AND e.consolidation_state IN ('pending','processed')
              AND e.event_type IN ('attempt_completed','reading_question_outcome','writing_evaluation_completed')
              AND (e.question_id IS NULL OR ans.question_id IS NOT NULL)
         ORDER BY me.observation_id,e.id,sc.skill_key,so.id,qm.skill_key",
    )?;
    let rows = query.query_map(params![memory_id, user_id], |r| {
        Ok(PracticeEvidence {
            asset: r.get(0)?,
            question: r.get(1)?,
            session: r.get(2)?,
            skill: r.get(3)?,
            snapshot: r.get(4)?,
            observation: r.get(5)?,
            event: r.get(6)?,
        })
    })?;
    let rows = rows.collect::<Result<Vec<_>, _>>()?;
    let malformed: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM memory_evidence WHERE memory_id=?1
            AND evidence_role='support' AND
            (json_type(event_ids_json) != 'array' OR json_array_length(event_ids_json)=0
             OR EXISTS(SELECT 1 FROM json_each(event_ids_json) WHERE type != 'text')))",
        [memory_id],
        |r| r.get(0),
    )?;
    if malformed {
        return Ok(Vec::new());
    }
    let expected = conn
        .prepare(
            "SELECT me.observation_id,cited.value FROM memory_evidence me
         JOIN json_each(me.event_ids_json) cited
         WHERE me.memory_id=?1 AND me.evidence_role='support'",
        )?
        .query_map([memory_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<Result<HashSet<_>, _>>()?;
    let resolved: HashSet<_> = rows
        .iter()
        .map(|r| (r.observation.clone(), r.event.clone()))
        .collect();
    if expected != resolved {
        return Ok(Vec::new());
    }
    Ok(rows)
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
            Some(s) => {
                if !verified
                    .iter()
                    .any(|existing| existing.memory_id == s.memory_id)
                {
                    verified.push(s);
                }
            }
            None => {
                return Ok(Err(RejectReason::HallucinatedSupportId {
                    support_id: id.clone(),
                }))
            }
        }
    }
    // No predicted-only / superseded supports (M8-10, M8-04).
    for support in &verified {
        if support.source_class == "predicted" {
            return Ok(Err(RejectReason::PredictedOnlySupport {
                support_id: support.memory_id.clone(),
            }));
        }
        if support.status != "active" {
            return Ok(Err(RejectReason::SupersededSupport {
                support_id: support.memory_id.clone(),
            }));
        }
    }
    let mut evidence = Vec::new();
    let mut snapshots = Vec::new();
    for support in &verified {
        let rows = load_practice_evidence(conn, &support.memory_id, user_id)?;
        if rows.is_empty() {
            return Ok(Err(RejectReason::MissingPracticeEvidence {
                support_id: support.memory_id.clone(),
            }));
        }
        let memory_snapshot: String = conn.query_row(
            "SELECT json_array(id,user_id,version,status,source_class,content,content_hash,
                namespace,memory_type,canonical_key,normalized_label,scope,subject_key,title,
                structured_json,confidence,importance,source_trust,sensitivity,improvement_state,
                valid_from,valid_to,first_observed_at,last_observed_at,supersedes_id,
                created_by,created_run_id,created_at,updated_at)
             FROM memory_items WHERE id=?1",
            [&support.memory_id],
            |r| r.get(0),
        )?;
        snapshots.push(memory_snapshot);
        snapshots.extend(rows.iter().map(|r| r.snapshot.clone()));
        evidence.extend(rows);
    }
    let independent: HashSet<_> = evidence
        .iter()
        .map(|r| (&r.session, &r.asset, &r.question))
        .collect();
    let sessions: HashSet<_> = evidence.iter().map(|r| &r.session).collect();
    let independent_count = independent.len().min(sessions.len());
    if independent_count < config.min_supports.max(1) {
        return Ok(Err(RejectReason::BelowMinSupports {
            provided: independent_count,
            required: config.min_supports.max(1),
        }));
    }
    let distinct_scopes: HashSet<_> = evidence.iter().filter_map(|r| r.skill.as_ref()).collect();
    let distinct_assets: HashSet<_> = evidence.iter().map(|r| &r.asset).collect();
    if distinct_assets.len() < config.min_distinct_assets {
        return Ok(Err(RejectReason::InsufficientDistinctAssets {
            provided: distinct_assets.len(),
            required: config.min_distinct_assets,
        }));
    }
    // Distinct scopes for cross-cutting patterns (M8-03).
    if proposal.pattern_kind.is_cross_cutting() {
        if distinct_scopes.len() < config.min_distinct_scopes {
            return Ok(Err(RejectReason::InsufficientDistinctScopes {
                provided: distinct_scopes.len(),
                required: config.min_distinct_scopes,
            }));
        }
    }
    let support_ids: Vec<String> = verified.iter().map(|s| s.memory_id.clone()).collect();
    snapshots.push(
        json!({
            "statement": proposal.statement, "supportIds": support_ids,
            "patternKind": proposal.pattern_kind,
            "confidence": proposal.confidence_proposal.clamp(0.0, 1.0),
        })
        .to_string(),
    );
    Ok(Ok(ValidatedPattern {
        statement: proposal.statement.clone(),
        support_ids,
        pattern_kind: proposal.pattern_kind,
        confidence: proposal.confidence_proposal.clamp(0.0, 1.0),
        distinct_asset_count: distinct_assets.len(),
        distinct_scope_count: distinct_scopes.len(),
        evidence_snapshot: serde_json::to_string(&ValidationSnapshot {
            config: *config,
            fingerprint: sha256_hex(&serde_json::to_string(&(config, snapshots))?),
        })?,
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
