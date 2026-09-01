//! M5-08 persistence for context snapshots and items.
//!
//! Inserts only into `agent_context_snapshots` / `agent_context_items` (the
//! schema is owned by migration 0016). Rust owns these rows: they are the
//! authorization/materialization audit. Python never writes them.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use ielts_domain::{
    ContextManifest, ContextMaterializedItem, ContextMaterializedSection, ContextSection,
};

use crate::sqlite::{DbError, DbResult};

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Insert one context snapshot + its items in a single transaction. The caller
/// has already materialized and hashed the context; this is pure persistence.
pub fn insert_context_snapshot(
    conn: &Connection,
    manifest: &ContextManifest,
    rendered_context: &str,
    query_plan_json: &Value,
    scope: &str,
) -> DbResult<()> {
    let query_plan = serialize_json(query_plan_json)?;
    let now = now_rfc3339();
    let tx = conn.unchecked_transaction()?;

    // Round-3 audit (R7a), defence in depth. `run_id` is a foreign key into
    // `agent_runs(id)` (0016:17) and enforcement is on for every connection
    // (sqlite/mod.rs:76), so an unknown id already aborts this transaction —
    // but as a raw `FOREIGN KEY constraint failed` string, which tells a
    // caller nothing about which field was wrong. Checking it here turns that
    // into a typed, attributable validation error, and keeps the guarantee
    // independent of whatever any future caller decides to put in the
    // manifest. Only `Some` is checked: NULL is the normal case (the
    // materializer never attributes a run) and the column is nullable.
    if let Some(run_id) = manifest.run_id.as_deref() {
        let known: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM agent_runs WHERE id = ?1)",
                params![run_id],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !known {
            return Err(DbError::Validation(format!(
                "context.unknown_run_id: run_id {run_id:?} is not an existing agent_runs id"
            )));
        }
    }
    tx.execute(
        "INSERT INTO agent_context_snapshots (
            id, run_id, planner_version, scope, query_plan_json,
            token_budget, used_tokens, rendered_context, content_hash, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            manifest.snapshot_id,
            manifest.run_id,
            manifest.planner_version,
            scope,
            query_plan,
            manifest.token_budget as i64,
            manifest.used_tokens as i64,
            rendered_context,
            manifest.content_hash,
            now,
        ],
    )?;
    for section in &manifest.sections {
        for (index, item) in section.items.iter().enumerate() {
            insert_item(&tx, &manifest.snapshot_id, item, index as i64)?;
        }
    }
    tx.commit()?;
    Ok(())
}

fn insert_item(
    tx: &Connection,
    snapshot_id: &str,
    item: &ContextMaterializedItem,
    rank: i64,
) -> DbResult<()> {
    let provenance = json!({
        "sourceKind": item.source_kind,
        "sourceId": item.source_id,
        "contentHash": item.content_hash,
        "sensitivity": item.sensitivity,
        "score": item.score,
        "section": item.section.as_str(),
    });
    let provenance_json = serialize_json(&provenance)?;
    tx.execute(
        "INSERT INTO agent_context_items (
            snapshot_id, item_type, item_id, rank, score,
            estimated_tokens, inclusion_reason, provenance_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            snapshot_id,
            item.section.as_str(),
            item.item_id,
            rank,
            item.score,
            item.estimated_tokens as i64,
            item.inclusion_reason,
            provenance_json,
        ],
    )?;
    Ok(())
}

/// Load a persisted snapshot + items back into a `ContextManifest`. Used by
/// audits and tests; the rendered text is returned alongside.
pub fn load_context_snapshot(
    conn: &Connection,
    snapshot_id: &str,
) -> DbResult<Option<(ContextManifest, String)>> {
    let row = conn
        .query_row(
            "SELECT id, run_id, planner_version, scope, token_budget, used_tokens,
                    rendered_context, content_hash, created_at
             FROM agent_context_snapshots WHERE id = ?1",
            params![snapshot_id],
            |row| {
                Ok(SnapshotRow {
                    id: row.get(0)?,
                    run_id: row.get(1)?,
                    planner_version: row.get(2)?,
                    scope: row.get(3)?,
                    token_budget: row.get::<_, i64>(4)? as u32,
                    used_tokens: row.get::<_, i64>(5)? as u32,
                    rendered_context: row.get(6)?,
                    content_hash: row.get(7)?,
                    rendered_at: row.get(8)?,
                })
            },
        )
        .optional()?;
    let Some(row) = row else { return Ok(None) };
    let items = load_items(conn, snapshot_id)?;
    let sections = group_items(items);
    let manifest = ContextManifest {
        snapshot_id: row.id,
        run_id: row.run_id,
        planner_version: row.planner_version,
        scope: row.scope,
        token_budget: row.token_budget,
        used_tokens: row.used_tokens,
        content_hash: row.content_hash,
        rendered_at: row.rendered_at,
        sections,
    };
    Ok(Some((manifest, row.rendered_context)))
}

fn load_items(conn: &Connection, snapshot_id: &str) -> DbResult<Vec<StoredItem>> {
    let mut statement = conn.prepare(
        "SELECT item_type, item_id, rank, score, estimated_tokens, inclusion_reason, provenance_json
         FROM agent_context_items
         WHERE snapshot_id = ?1
         ORDER BY item_type, rank",
    )?;
    let rows = statement.query_map(params![snapshot_id], |row| {
        Ok(StoredItem {
            item_type: row.get(0)?,
            item_id: row.get(1)?,
            rank: row.get::<_, i64>(2)? as u32,
            score: row.get(3)?,
            estimated_tokens: row.get::<_, i64>(4)? as u32,
            inclusion_reason: row.get(5)?,
            provenance_json: row.get::<_, Option<String>>(6)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

fn group_items(items: Vec<StoredItem>) -> Vec<ContextMaterializedSection> {
    let mut sections: Vec<ContextMaterializedSection> = Vec::new();
    for item in items {
        let section = parse_section(&item.item_type);
        let materialized = ContextMaterializedItem {
            item_id: item.item_id.clone(),
            section,
            source_kind: provenance_field(&item.provenance_json, "sourceKind")
                .unwrap_or_default(),
            source_id: provenance_field(&item.provenance_json, "sourceId")
                .unwrap_or_default(),
            content_hash: provenance_field(&item.provenance_json, "contentHash")
                .unwrap_or_default(),
            sensitivity: provenance_field(&item.provenance_json, "sensitivity")
                .unwrap_or_default(),
            estimated_tokens: item.estimated_tokens,
            rank: item.rank,
            score: item.score,
            inclusion_reason: item.inclusion_reason,
        };
        match sections.iter_mut().find(|s| s.section == section) {
            Some(existing) => existing.items.push(materialized),
            None => sections.push(ContextMaterializedSection {
                section,
                items: vec![materialized],
                estimated_tokens: 0,
            }),
        }
    }
    for section in &mut sections {
        section.estimated_tokens = section.items.iter().map(|i| i.estimated_tokens).sum();
    }
    sections
}

fn parse_section(value: &str) -> ContextSection {
    match value {
        "SOUL_POLICY" => ContextSection::SoulPolicy,
        "CURRENT_TASK" => ContextSection::CurrentTask,
        "EXPLICIT_USER" => ContextSection::ExplicitUser,
        "LEARNER_STATE" => ContextSection::LearnerState,
        "ACTIVE_MEMORY" => ContextSection::ActiveMemory,
        "RECENT_RELEVANT_EVIDENCE" => ContextSection::RecentRelevantEvidence,
        "RETRIEVED_CORPUS" => ContextSection::RetrievedCorpus,
        "RECENT_JOURNAL" => ContextSection::RecentJournal,
        "TOOL_RESERVE" => ContextSection::ToolReserve,
        other => {
            tracing::warn!(section = %other, "unknown context section persisted; defaulting to tool reserve");
            ContextSection::ToolReserve
        }
    }
}

fn provenance_field(provenance_json: &Option<String>, field: &str) -> Option<String> {
    provenance_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|value| value.get(field).and_then(Value::as_str).map(str::to_string))
}

fn serialize_json(value: &Value) -> DbResult<String> {
    serde_json::to_string(value).map_err(|error| DbError::Message(error.to_string()))
}

struct SnapshotRow {
    id: String,
    run_id: Option<String>,
    planner_version: String,
    scope: String,
    token_budget: u32,
    used_tokens: u32,
    rendered_context: String,
    content_hash: String,
    rendered_at: String,
}

struct StoredItem {
    item_type: String,
    item_id: String,
    rank: u32,
    score: f64,
    estimated_tokens: u32,
    inclusion_reason: String,
    provenance_json: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_section_recovers_all_fixed_sections() {
        assert_eq!(parse_section("SOUL_POLICY"), ContextSection::SoulPolicy);
        assert_eq!(parse_section("CURRENT_TASK"), ContextSection::CurrentTask);
        assert_eq!(parse_section("TOOL_RESERVE"), ContextSection::ToolReserve);
    }
}
