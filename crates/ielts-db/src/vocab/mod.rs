//! Vocabulary items + simple SM-2-ish review state (Phase 8).

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::sqlite::{DbError, DbResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VocabularyItem {
    pub id: String,
    pub term: String,
    pub normalized_term: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub definition: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonetic: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part_of_speech: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub example: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_attempt_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review: Option<ReviewState>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewState {
    pub ease: f64,
    pub interval_days: f64,
    pub repetitions: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_reviewed_at: Option<String>,
    pub lapses: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertVocabCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub term: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub definition: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phonetic: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part_of_speech: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub example: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_asset_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_attempt_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewVocabCommand {
    pub item_id: String,
    /// 0 again, 1 hard, 2 good, 3 easy
    pub grade: u8,
}

pub fn normalize_term(term: &str) -> String {
    term.trim().to_ascii_lowercase()
}

pub fn upsert_vocab(conn: &Connection, cmd: &UpsertVocabCommand) -> DbResult<VocabularyItem> {
    let term = cmd.term.trim();
    if term.is_empty() {
        return Err(DbError::Validation("term required".into()));
    }
    let normalized = normalize_term(term);
    let now = chrono::Utc::now().to_rfc3339();
    let id = cmd
        .id
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("vocab-{}", Uuid::new_v4()));
    let tags_json =
        serde_json::to_string(&cmd.tags).map_err(|e| DbError::Message(e.to_string()))?;

    conn.execute(
        "INSERT INTO vocabulary_items (
            id, term, normalized_term, definition, phonetic, part_of_speech, example,
            source_asset_id, source_attempt_id, tags_json, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
         ON CONFLICT(id) DO UPDATE SET
            term = excluded.term,
            normalized_term = excluded.normalized_term,
            definition = excluded.definition,
            phonetic = excluded.phonetic,
            part_of_speech = excluded.part_of_speech,
            example = excluded.example,
            source_asset_id = excluded.source_asset_id,
            source_attempt_id = excluded.source_attempt_id,
            tags_json = excluded.tags_json,
            updated_at = excluded.updated_at",
        params![
            id,
            term,
            normalized,
            cmd.definition,
            cmd.phonetic,
            cmd.part_of_speech,
            cmd.example,
            cmd.source_asset_id,
            cmd.source_attempt_id,
            tags_json,
            now,
        ],
    )?;

    // ensure review row
    conn.execute(
        "INSERT OR IGNORE INTO vocabulary_review_state (item_id, ease, interval_days, repetitions, due_at, last_reviewed_at, lapses)
         VALUES (?1, 2.5, 0, 0, ?2, NULL, 0)",
        params![id, now],
    )?;

    get_vocab(conn, &id)
}

pub fn get_vocab(conn: &Connection, id: &str) -> DbResult<VocabularyItem> {
    conn.query_row(
        "SELECT v.id, v.term, v.normalized_term, v.definition, v.phonetic, v.part_of_speech, v.example,
                v.source_asset_id, v.source_attempt_id, v.tags_json, v.created_at, v.updated_at,
                r.ease, r.interval_days, r.repetitions, r.due_at, r.last_reviewed_at, r.lapses
         FROM vocabulary_items v
         LEFT JOIN vocabulary_review_state r ON r.item_id = v.id
         WHERE v.id = ?1",
        params![id],
        map_item,
    )
    .map_err(|_| DbError::Message(format!("vocab not found: {id}")))
}

pub fn list_vocab(conn: &Connection, limit: u32, offset: u32) -> DbResult<Vec<VocabularyItem>> {
    let mut stmt = conn.prepare(
        "SELECT v.id, v.term, v.normalized_term, v.definition, v.phonetic, v.part_of_speech, v.example,
                v.source_asset_id, v.source_attempt_id, v.tags_json, v.created_at, v.updated_at,
                r.ease, r.interval_days, r.repetitions, r.due_at, r.last_reviewed_at, r.lapses
         FROM vocabulary_items v
         LEFT JOIN vocabulary_review_state r ON r.item_id = v.id
         ORDER BY v.updated_at DESC
         LIMIT ?1 OFFSET ?2",
    )?;
    let rows = stmt.query_map(params![limit.min(500) as i64, offset as i64], map_item)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn delete_vocab(conn: &Connection, id: &str) -> DbResult<bool> {
    let n = conn.execute("DELETE FROM vocabulary_items WHERE id = ?1", params![id])?;
    Ok(n > 0)
}

/// Apply review grade; does not touch attempt scores.
pub fn review_vocab(conn: &Connection, cmd: &ReviewVocabCommand) -> DbResult<VocabularyItem> {
    let mut item = get_vocab(conn, &cmd.item_id)?;
    let mut review = item.review.unwrap_or(ReviewState {
        ease: 2.5,
        interval_days: 0.0,
        repetitions: 0,
        due_at: None,
        last_reviewed_at: None,
        lapses: 0,
    });
    let grade = cmd.grade.min(3);
    let now = chrono::Utc::now();
    if grade == 0 {
        review.repetitions = 0;
        review.interval_days = 0.0;
        review.lapses += 1;
        review.ease = (review.ease - 0.2).max(1.3);
    } else {
        review.ease = (review.ease
            + match grade {
                1 => -0.05,
                2 => 0.0,
                _ => 0.15,
            })
        .clamp(1.3, 3.0);
        review.repetitions += 1;
        review.interval_days = match review.repetitions {
            1 => 1.0,
            2 => 3.0,
            _ => (review.interval_days * review.ease).max(1.0),
        };
        if grade == 1 {
            review.interval_days = (review.interval_days * 0.7).max(1.0);
        }
    }
    let due = now + chrono::Duration::days(review.interval_days.round() as i64);
    review.due_at = Some(due.to_rfc3339());
    review.last_reviewed_at = Some(now.to_rfc3339());

    conn.execute(
        "UPDATE vocabulary_review_state SET
            ease = ?1, interval_days = ?2, repetitions = ?3, due_at = ?4, last_reviewed_at = ?5, lapses = ?6
         WHERE item_id = ?7",
        params![
            review.ease,
            review.interval_days,
            review.repetitions as i64,
            review.due_at,
            review.last_reviewed_at,
            review.lapses as i64,
            cmd.item_id,
        ],
    )?;
    item.review = Some(review);
    item.updated_at = now.to_rfc3339();
    Ok(item)
}

fn map_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<VocabularyItem> {
    let tags_json: Option<String> = row.get(9)?;
    let tags: Vec<String> = tags_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let ease: Option<f64> = row.get(12)?;
    let review = ease.map(|ease| ReviewState {
        ease,
        interval_days: row.get::<_, f64>(13).unwrap_or(0.0),
        repetitions: row.get::<_, i64>(14).unwrap_or(0) as u32,
        due_at: row.get(15).ok().flatten(),
        last_reviewed_at: row.get(16).ok().flatten(),
        lapses: row.get::<_, i64>(17).unwrap_or(0) as u32,
    });
    Ok(VocabularyItem {
        id: row.get(0)?,
        term: row.get(1)?,
        normalized_term: row.get(2)?,
        definition: row.get(3)?,
        phonetic: row.get(4)?,
        part_of_speech: row.get(5)?,
        example: row.get(6)?,
        source_asset_id: row.get(7)?,
        source_attempt_id: row.get(8)?,
        tags,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        review,
    })
}
