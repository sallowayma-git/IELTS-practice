//! Annotations with stable text anchors (Phase 8).
//! Prefer quote + before/after + occurrence over bare DOM offsets.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use ielts_domain::dto::AttemptAnnotationDto;

use crate::sqlite::{DbError, DbResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextAnchor {
    /// Selected / highlighted text (normalized whitespace).
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
    /// 0-based occurrence of `text` within scope document.
    #[serde(default)]
    pub occurrence: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_offset: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_offset: Option<u32>,
    /// Optional content fingerprint of the host HTML/text at save time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationRecord {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    pub asset_id: String,
    pub scope: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question_id: Option<String>,
    pub kind: String,
    pub anchor: TextAnchor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_text: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Set when re-resolve fails against current document text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mismatch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAnnotationCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    pub asset_id: String,
    pub scope: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question_id: Option<String>,
    #[serde(default = "default_kind")]
    pub kind: String,
    pub anchor: TextAnchor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_text: Option<String>,
}

fn default_kind() -> String {
    "highlight".into()
}

pub fn normalize_ws(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Resolve anchor inside document text. Returns (start, end) or mismatch reason.
pub fn resolve_anchor(document: &str, anchor: &TextAnchor) -> Result<(usize, usize), String> {
    let hay = normalize_ws(document);
    let needle = normalize_ws(&anchor.text);
    if needle.is_empty() {
        return Err("empty_anchor_text".into());
    }
    let mut search_from = 0usize;
    let mut found = 0u32;
    loop {
        if let Some(rel) = hay[search_from..].find(&needle) {
            let start = search_from + rel;
            let end = start + needle.len();
            if found == anchor.occurrence {
                // optional context check
                if let Some(before) = anchor.before.as_deref() {
                    let b = normalize_ws(before);
                    if !b.is_empty() {
                        let ctx_start = start.saturating_sub(b.len() + 8);
                        let window = &hay[ctx_start..start];
                        if !window.contains(&b) && !hay[..start].ends_with(&b) {
                            return Err("before_context_mismatch".into());
                        }
                    }
                }
                if let Some(after) = anchor.after.as_deref() {
                    let a = normalize_ws(after);
                    if !a.is_empty() {
                        let ctx_end = (end + a.len() + 8).min(hay.len());
                        let window = &hay[end..ctx_end];
                        if !window.contains(&a) && !hay[end..].starts_with(&a) {
                            return Err("after_context_mismatch".into());
                        }
                    }
                }
                return Ok((start, end));
            }
            found += 1;
            search_from = start + 1;
        } else {
            return Err("text_not_found".into());
        }
    }
}

pub fn upsert_annotation(
    conn: &Connection,
    cmd: &UpsertAnnotationCommand,
) -> DbResult<AnnotationRecord> {
    let now = chrono::Utc::now().to_rfc3339();
    let id = cmd
        .id
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("ann-{}", Uuid::new_v4()));
    let mut anchor = cmd.anchor.clone();
    anchor.text = normalize_ws(&anchor.text);
    if let Some(b) = anchor.before.as_mut() {
        *b = normalize_ws(b);
    }
    if let Some(a) = anchor.after.as_mut() {
        *a = normalize_ws(a);
    }
    if anchor.text.is_empty() {
        return Err(DbError::Validation("anchor.text required".into()));
    }
    let scope = normalize_scope(&cmd.scope);
    let kind = if cmd.kind.trim().is_empty() {
        "highlight".into()
    } else {
        cmd.kind.trim().to_ascii_lowercase()
    };
    let anchor_json =
        serde_json::to_string(&anchor).map_err(|e| DbError::Message(e.to_string()))?;

    conn.execute(
        "INSERT INTO attempt_annotations (
            id, attempt_id, asset_id, scope, question_id, kind, anchor_json, note_text, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
         ON CONFLICT(id) DO UPDATE SET
            attempt_id = excluded.attempt_id,
            asset_id = excluded.asset_id,
            scope = excluded.scope,
            question_id = excluded.question_id,
            kind = excluded.kind,
            anchor_json = excluded.anchor_json,
            note_text = excluded.note_text,
            updated_at = excluded.updated_at",
        params![
            id,
            cmd.attempt_id,
            cmd.asset_id,
            scope,
            cmd.question_id,
            kind,
            anchor_json,
            cmd.note_text,
            now,
        ],
    )?;

    Ok(AnnotationRecord {
        id,
        attempt_id: cmd.attempt_id.clone(),
        asset_id: cmd.asset_id.clone(),
        scope,
        question_id: cmd.question_id.clone(),
        kind,
        anchor,
        note_text: cmd.note_text.clone(),
        created_at: now.clone(),
        updated_at: now,
        mismatch: None,
    })
}

pub fn list_annotations(
    conn: &Connection,
    asset_id: &str,
    attempt_id: Option<&str>,
) -> DbResult<Vec<AnnotationRecord>> {
    let mut out = Vec::new();
    if let Some(aid) = attempt_id {
        let mut stmt = conn.prepare(
            "SELECT id, attempt_id, asset_id, scope, question_id, kind, anchor_json, note_text, created_at, updated_at
             FROM attempt_annotations
             WHERE asset_id = ?1 AND (attempt_id = ?2 OR attempt_id IS NULL)
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![asset_id, aid], map_row)?;
        for row in rows {
            out.push(row?);
        }
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, attempt_id, asset_id, scope, question_id, kind, anchor_json, note_text, created_at, updated_at
             FROM attempt_annotations
             WHERE asset_id = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![asset_id], map_row)?;
        for row in rows {
            out.push(row?);
        }
    }
    Ok(out)
}

/// Delete an annotation only from its exact ownership scope.
///
/// Attempt-owned annotations must never be removable by a different attempt that
/// happens to practice the same asset. `None` is the asset-global scope used by
/// reading notes, so it deliberately deletes only records whose attempt id is
/// also NULL.
pub fn delete_annotation(
    conn: &Connection,
    id: &str,
    asset_id: &str,
    attempt_id: Option<&str>,
) -> DbResult<bool> {
    let n = if let Some(attempt_id) = attempt_id {
        conn.execute(
            "DELETE FROM attempt_annotations
             WHERE id = ?1 AND asset_id = ?2 AND attempt_id = ?3",
            params![id, asset_id, attempt_id],
        )?
    } else {
        conn.execute(
            "DELETE FROM attempt_annotations
             WHERE id = ?1 AND asset_id = ?2 AND attempt_id IS NULL",
            params![id, asset_id],
        )?
    };
    Ok(n > 0)
}

/// Re-resolve annotations against current document; marks mismatch without deleting.
pub fn revalidate_annotations(
    conn: &Connection,
    asset_id: &str,
    attempt_id: Option<&str>,
    scope: &str,
    document: &str,
) -> DbResult<Vec<AnnotationRecord>> {
    // Keep the same visibility contract as annotation_list: an attempt sees its
    // own annotations plus asset-global records (for example, reading notes),
    // never annotations belonging to another attempt for the same asset.
    let mut list = list_annotations(conn, asset_id, attempt_id)?;
    let scope_n = normalize_scope(scope);
    for ann in &mut list {
        if ann.scope != scope_n && scope_n != "any" {
            continue;
        }
        match resolve_anchor(document, &ann.anchor) {
            Ok((start, end)) => {
                ann.mismatch = None;
                ann.anchor.start_offset = Some(start as u32);
                ann.anchor.end_offset = Some(end as u32);
            }
            Err(reason) => {
                ann.mismatch = Some(reason);
            }
        }
    }
    Ok(list)
}

pub fn annotation_to_dto(ann: &AnnotationRecord) -> AttemptAnnotationDto {
    AttemptAnnotationDto {
        id: ann.id.clone(),
        attempt_id: ann.attempt_id.clone(),
        asset_id: ann.asset_id.clone(),
        scope: ann.scope.clone(),
        question_id: ann.question_id.clone(),
        kind: ann.kind.clone(),
        anchor: serde_json::to_value(&ann.anchor).unwrap_or(json!({})),
        note_text: ann.note_text.clone(),
    }
}

fn normalize_scope(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "passage" | "questions" | "note" => raw.trim().to_ascii_lowercase(),
        _ => "unknown".into(),
    }
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AnnotationRecord> {
    let anchor_json: String = row.get(6)?;
    let anchor: TextAnchor = serde_json::from_str(&anchor_json).unwrap_or(TextAnchor {
        text: String::new(),
        before: None,
        after: None,
        occurrence: 0,
        start_offset: None,
        end_offset: None,
        content_fingerprint: None,
    });
    Ok(AnnotationRecord {
        id: row.get(0)?,
        attempt_id: row.get(1)?,
        asset_id: row.get(2)?,
        scope: row.get(3)?,
        question_id: row.get(4)?,
        kind: row.get(5)?,
        anchor,
        note_text: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        mismatch: None,
    })
}

#[allow(dead_code)]
fn _value_link() -> Value {
    json!({})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_with_occurrence_and_context() {
        let doc = "The cat sat. The cat ran.";
        let anchor = TextAnchor {
            text: "cat".into(),
            before: Some("The".into()),
            after: Some("ran".into()),
            occurrence: 1,
            start_offset: None,
            end_offset: None,
            content_fingerprint: None,
        };
        let (s, e) = resolve_anchor(doc, &anchor).unwrap();
        assert!(s < e);
        assert!(normalize_ws(doc)[s..e].contains("cat"));
    }
}
