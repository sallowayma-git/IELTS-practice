//! W3-4: weekly cross-module memory promotion.
//!
//! Runs only inside the weekly report transaction and never calls a model.
//! Rule A promotes a canonical key that is active in at least two activity
//! scopes into one `global` memory. Rule B promotes vocabulary that is both
//! repeatedly forgotten and tied to wrong reading answers. Both rules are
//! idempotent, a full global scope skips a promotion instead of failing the
//! weekly report, and a memory the user archived or forgot is never refreshed
//! or recreated.

use std::collections::{BTreeMap, BTreeSet};

use ielts_domain::{is_safe_for_prompt, WeeklyMemoryChange, MAX_ACTIVE_MEMORY_PER_SCOPE};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::sqlite::DbResult;

/// The author recorded on every memory this weekly pass creates or refreshes.
pub const CROSS_MODULE_CREATED_BY: &str = "weekly-cross-module";

const CONSOLIDATED_CONTENT_BYTES: usize = 320;
const CONSOLIDATED_CONFIDENCE: f64 = 0.7;
const CONSOLIDATED_IMPORTANCE: f64 = 0.6;
const CONSOLIDATED_SOURCE_TRUST: f64 = 0.7;

const CHRONIC_VOCAB_MIN_LAPSES: u32 = 3;
const CHRONIC_VOCAB_MAX_TERMS: usize = 5;
const CHRONIC_VOCAB_KEY: &str = "language.vocabulary.chronic_reading_misses";
const CHRONIC_VOCAB_LABEL: &str = "chronic reading vocabulary misses";

/// Canonical keys promoted (`new`), and existing global rows whose content was
/// refreshed. A key is reported once per pass. `changes` is the same work in
/// the shape the weekly report stores, so a caller that writes both in one
/// transaction can show the promotion instead of hiding it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossModuleReport {
    pub promoted: Vec<String>,
    pub updated: Vec<String>,
    #[serde(default)]
    pub changes: Vec<WeeklyMemoryChange>,
}

/// Promote cross-module memories for one user. The caller owns the transaction
/// (both weekly report paths already run in one); this function never opens a
/// nested transaction and never treats "scope full" as an error.
pub fn promote_cross_module_memories(
    conn: &Connection,
    user_id: &str,
    now: &str,
) -> DbResult<CrossModuleReport> {
    let mut report = CrossModuleReport::default();
    promote_cross_scope_memories(conn, user_id, now, &mut report)?;
    promote_chronic_reading_vocabulary(conn, user_id, now, &mut report)?;
    Ok(report)
}

struct ActivityMemory {
    id: String,
    scope: String,
    namespace: String,
    memory_type: String,
    content: String,
}

/// Rule A: the same canonical key in two or more activity scopes.
fn promote_cross_scope_memories(
    conn: &Connection,
    user_id: &str,
    now: &str,
    report: &mut CrossModuleReport,
) -> DbResult<()> {
    let mut statement = conn.prepare(
        "SELECT canonical_key,id,scope,namespace,memory_type,content
         FROM memory_items
         WHERE user_id=?1 AND status='active' AND sensitivity='normal'
           AND (valid_to IS NULL OR valid_to > ?2)
           AND scope LIKE 'activity:%'
           AND namespace <> 'preference'
         ORDER BY canonical_key,scope,id",
    )?;
    let rows = statement.query_map(params![user_id, now], |row| {
        Ok((
            row.get::<_, String>(0)?,
            ActivityMemory {
                id: row.get(1)?,
                scope: row.get(2)?,
                namespace: row.get(3)?,
                memory_type: row.get(4)?,
                content: row.get(5)?,
            },
        ))
    })?;
    let mut groups: BTreeMap<String, Vec<ActivityMemory>> = BTreeMap::new();
    for row in rows {
        let (canonical_key, memory) = row?;
        groups.entry(canonical_key).or_default().push(memory);
    }
    for (canonical_key, memories) in groups {
        let Some(candidate) = cross_scope_candidate(&memories) else {
            continue;
        };
        let Some(target_id) = upsert_global_memory(
            conn,
            user_id,
            now,
            &candidate.namespace,
            &candidate.memory_type,
            &canonical_key,
            &normalized_label(&canonical_key),
            &candidate.content,
            None,
            false,
            Some(&candidate.source_ids),
            report,
        )?
        else {
            continue;
        };
        link_supports_consolidation(conn, &target_id, &candidate.source_ids, now)?;
    }
    Ok(())
}

struct CrossScopeCandidate {
    content: String,
    namespace: String,
    memory_type: String,
    source_ids: Vec<String>,
}

/// A group qualifies only when every row agrees on namespace and memory_type.
/// Disagreement is ambiguous, so the group is skipped rather than guessed.
fn cross_scope_candidate(memories: &[ActivityMemory]) -> Option<CrossScopeCandidate> {
    let scopes: BTreeSet<&str> = memories
        .iter()
        .map(|memory| memory.scope.as_str())
        .collect();
    if scopes.len() < 2 {
        return None;
    }
    let namespace = memories.first()?.namespace.clone();
    let memory_type = memories.first()?.memory_type.clone();
    if memories
        .iter()
        .any(|memory| memory.namespace != namespace || memory.memory_type != memory_type)
    {
        return None;
    }
    let mut contents: Vec<&str> = Vec::new();
    for memory in memories {
        let content = memory.content.as_str();
        if !content.trim().is_empty() && !contents.contains(&content) {
            contents.push(content);
        }
    }
    if contents.is_empty() {
        return None;
    }
    let content = truncate_utf8(&contents.join(" / "), CONSOLIDATED_CONTENT_BYTES);
    if !is_safe_for_prompt(&content) {
        return None;
    }
    Some(CrossScopeCandidate {
        content,
        namespace,
        memory_type,
        source_ids: memories.iter().map(|memory| memory.id.clone()).collect(),
    })
}

struct ChronicReadingTerm {
    term: String,
    lapses: u32,
    asset_id: String,
}

/// Rule B: vocabulary with repeated lapses whose source material also produced
/// a wrong reading answer. The terms actually written (at most five) must span
/// at least two distinct source assets.
fn promote_chronic_reading_vocabulary(
    conn: &Connection,
    user_id: &str,
    now: &str,
    report: &mut CrossModuleReport,
) -> DbResult<()> {
    let mut statement = conn.prepare(
        "SELECT v.term,v.source_asset_id,r.lapses
         FROM vocabulary_items v
         JOIN vocabulary_review_state r ON r.item_id=v.id
         WHERE r.lapses >= ?1
           AND v.source_asset_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM learning_events e
             WHERE e.user_id=?2
               AND e.event_type='reading_question_outcome'
               AND e.asset_id=v.source_asset_id
               AND json_extract(e.payload_json,'$.isCorrect')=0
               AND COALESCE(json_extract(e.payload_json,'$.answered'),1)=1
           )
         ORDER BY r.lapses DESC,v.normalized_term ASC,v.id ASC",
    )?;
    let terms = statement
        .query_map(params![CHRONIC_VOCAB_MIN_LAPSES as i64, user_id], |row| {
            Ok(ChronicReadingTerm {
                term: row.get(0)?,
                asset_id: row.get(1)?,
                lapses: row.get::<_, i64>(2)? as u32,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let selected: Vec<&ChronicReadingTerm> = terms.iter().take(CHRONIC_VOCAB_MAX_TERMS).collect();
    if selected.is_empty() {
        return Ok(());
    }
    // The gate judges what is actually written, not the unbounded candidate
    // list: after `take`, the five terms may all come from one asset even when
    // some other asset also had a chronic miss. Truncating first is the fix —
    // checking the full list and then truncating let one asset's terms claim the
    // whole promotion while structured_json honestly recorded one asset.
    let asset_count = selected
        .iter()
        .map(|term| term.asset_id.as_str())
        .collect::<BTreeSet<_>>()
        .len();
    if asset_count < 2 {
        return Ok(());
    }
    let listed = selected
        .iter()
        .map(|term| format!("{} ({} lapses)", term.term, term.lapses))
        .collect::<Vec<_>>()
        .join(", ");
    let content = format!(
        "These words are repeatedly forgotten and caused wrong answers in reading: {listed}"
    );
    // Vocabulary terms are user data; the same prompt guard as every other
    // memory write applies, and a refused term skips the promotion.
    if !is_safe_for_prompt(&content) {
        return Ok(());
    }
    let structured = json!({
        "terms": selected
            .iter()
            .map(|term| json!({
                "term": term.term,
                "lapses": term.lapses,
                "assetIds": [term.asset_id],
            }))
            .collect::<Vec<Value>>(),
        "assetCount": asset_count,
    })
    .to_string();
    // Rule B has no memory-item sources (vocabulary is not a memory), so it
    // deliberately creates no supports_consolidation relations.
    let _ = upsert_global_memory(
        conn,
        user_id,
        now,
        "language",
        "semantic",
        CHRONIC_VOCAB_KEY,
        CHRONIC_VOCAB_LABEL,
        &content,
        Some(&structured),
        true,
        None,
        report,
    )?;
    Ok(())
}

/// Insert the global memory, or refresh an existing active one. Returns the
/// target id, or `None` when the user already archived/forgot this key or a new
/// insert would exceed the scope cap.
#[allow(clippy::too_many_arguments)]
fn upsert_global_memory(
    conn: &Connection,
    user_id: &str,
    now: &str,
    namespace: &str,
    memory_type: &str,
    canonical_key: &str,
    normalized_label: &str,
    content: &str,
    structured_json: Option<&str>,
    sync_structured: bool,
    source_ids: Option<&[String]>,
    report: &mut CrossModuleReport,
) -> DbResult<Option<String>> {
    let existing = conn
        .query_row(
            "SELECT id,content,structured_json FROM memory_items
             WHERE user_id=?1 AND scope='global' AND canonical_key=?2 AND status='active'
             ORDER BY id LIMIT 1",
            params![user_id, canonical_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    if let Some((id, stored_content, stored_structured)) = existing {
        let structured_changed = sync_structured && stored_structured.as_deref() != structured_json;
        if stored_content != content || structured_changed {
            // Content changed: refresh it, confirm freshness, and bump the
            // version the same way REFINE/REINFORCE/archive do, so a stale
            // `expected_version` can never archive the row the pass just wrote.
            if sync_structured {
                conn.execute(
                    "UPDATE memory_items
                     SET content=?1,content_hash=?2,structured_json=?3,version=version+1,
                         last_observed_at=?4,updated_at=?4
                     WHERE id=?5 AND status='active'",
                    params![content, hash_text(content), structured_json, now, id],
                )?;
            } else {
                conn.execute(
                    "UPDATE memory_items
                     SET content=?1,content_hash=?2,version=version+1,
                         last_observed_at=?3,updated_at=?3
                     WHERE id=?4 AND status='active'",
                    params![content, hash_text(content), now, id],
                )?;
            }
            report.updated.push(canonical_key.to_owned());
            report.changes.push(WeeklyMemoryChange {
                action: "REFINE".into(),
                memory_id: id.clone(),
                statement: content.to_owned(),
            });
        } else {
            // Unchanged: the pass still observed it now. Without this the stale
            // sweep could archive a memory the weekly pass just confirmed.
            // `updated_at` stays the last content change.
            conn.execute(
                "UPDATE memory_items SET last_observed_at=?1 WHERE id=?2 AND status='active'",
                params![now, id],
            )?;
        }
        return Ok(Some(id));
    }

    // No active row. The user may have archived ("inaccurate", "outdated", "not
    // about me") or forgotten a memory this pass promoted earlier; that verdict
    // is durable, so the content must not come back.
    if promotion_was_rejected(conn, user_id, canonical_key, source_ids)? {
        return Ok(None);
    }

    let active_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM memory_items
         WHERE user_id=?1 AND scope='global' AND status='active'",
        [user_id],
        |row| row.get(0),
    )?;
    if active_count >= MAX_ACTIVE_MEMORY_PER_SCOPE as i64 {
        return Ok(None);
    }

    let id = format!("mem-{}", Uuid::new_v4());
    conn.execute(
        "INSERT INTO memory_items (
           id,user_id,namespace,scope,memory_type,canonical_key,normalized_label,content,
           structured_json,status,source_class,confidence,importance,source_trust,sensitivity,
           improvement_state,first_observed_at,last_observed_at,version,created_by,created_run_id,
           content_hash,created_at,updated_at
         ) VALUES (?1,?2,?3,'global',?4,?5,?6,?7,?8,'active','consolidated',?9,?10,?11,
                   'normal','baseline',?12,?12,1,?13,NULL,?14,?12,?12)",
        params![
            id,
            user_id,
            namespace,
            memory_type,
            canonical_key,
            normalized_label,
            content,
            structured_json,
            CONSOLIDATED_CONFIDENCE,
            CONSOLIDATED_IMPORTANCE,
            CONSOLIDATED_SOURCE_TRUST,
            now,
            CROSS_MODULE_CREATED_BY,
            hash_text(content),
        ],
    )?;
    report.promoted.push(canonical_key.to_owned());
    report.changes.push(WeeklyMemoryChange {
        action: "ADD".into(),
        memory_id: id.clone(),
        statement: content.to_owned(),
    });
    Ok(Some(id))
}

/// Whether the user already took this promotion away. Two independent traces:
///
/// * any `global` row with the same canonical key that is no longer active —
///   archive keeps the key, so this covers both archive verdicts;
/// * for rule A, the `supports_consolidation` lineage from the activity memories
///   that back the candidate. Forget redacts the key itself, but the edge keeps
///   pointing at the stable id, whose status is then `deleted`.
///
/// Rejection feedback is checked as well as status because the verdict is the
/// user's decision, not a side effect of the archive transition.
fn promotion_was_rejected(
    conn: &Connection,
    user_id: &str,
    canonical_key: &str,
    source_ids: Option<&[String]>,
) -> DbResult<bool> {
    let revoked: bool = conn.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM memory_items m
            WHERE m.user_id=?1 AND m.scope='global' AND m.canonical_key=?2
              AND (m.status <> 'active' OR EXISTS(
                    SELECT 1 FROM memory_feedback f
                     WHERE f.memory_id=m.id AND f.user_id=?1
                       AND f.feedback_kind IN ('inaccurate','outdated','not_about_me'))))",
        params![user_id, canonical_key],
        |row| row.get(0),
    )?;
    if revoked {
        return Ok(true);
    }
    let Some(source_ids) = source_ids.filter(|ids| !ids.is_empty()) else {
        return Ok(false);
    };
    let sources = json!(source_ids).to_string();
    let rejected_by_lineage: bool = conn.query_row(
        "SELECT EXISTS(
           SELECT 1
             FROM memory_relations r
             JOIN memory_items t ON t.id=r.target_memory_id
            WHERE r.relation_kind='supports_consolidation'
              AND r.source_memory_id IN (SELECT value FROM json_each(?2))
              AND t.user_id=?1 AND t.scope='global'
              AND (t.status <> 'active' OR EXISTS(
                    SELECT 1 FROM memory_feedback f
                     WHERE f.memory_id=t.id AND f.user_id=?1
                       AND f.feedback_kind IN ('inaccurate','outdated','not_about_me'))))",
        params![user_id, sources],
        |row| row.get(0),
    )?;
    Ok(rejected_by_lineage)
}

/// Idempotent support edges: one row per contributing memory. The unique index
/// is the dedupe, so an existing edge keeps its original id.
fn link_supports_consolidation(
    conn: &Connection,
    target_id: &str,
    source_ids: &[String],
    now: &str,
) -> DbResult<()> {
    let mut linked: BTreeSet<&str> = BTreeSet::new();
    for source_id in source_ids {
        if !linked.insert(source_id.as_str()) {
            continue;
        }
        let exists: bool = conn.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM memory_relations
               WHERE source_memory_id=?1 AND target_memory_id=?2
                 AND relation_kind='supports_consolidation'
             )",
            params![source_id, target_id],
            |row| row.get(0),
        )?;
        if exists {
            continue;
        }
        conn.execute(
            "INSERT INTO memory_relations (
               id,source_memory_id,target_memory_id,relation_kind,created_at
             ) VALUES (?1,?2,?3,'supports_consolidation',?4)",
            params![
                format!("mrel-{}", Uuid::new_v4()),
                source_id,
                target_id,
                now
            ],
        )?;
    }
    Ok(())
}

fn normalized_label(canonical_key: &str) -> String {
    canonical_key
        .rsplit('.')
        .next()
        .unwrap_or(canonical_key)
        .replace('_', " ")
        .to_ascii_lowercase()
}

fn truncate_utf8(mut value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }
    let mut boundary = max_bytes;
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value = &value[..boundary];
    value.to_owned()
}

fn hash_text(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}
