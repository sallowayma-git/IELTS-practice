//! Vocabulary items and persisted SM-2 review scheduling.

use ielts_domain::{
    vocab_sm2::{schedule_after_result, Sm2Rating, Sm2State, DEFAULT_EASE_FACTOR},
    LearningEventType,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::learning_events::{append_learning_event_if_enabled, event_key, NewLearningEvent};
use crate::safety::with_delete_gate;
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

/// Canonical lookup/dedupe key: trims whitespace and surrounding punctuation
/// (a highlight like `“Abandon,”` must hit the same key as `abandon`).
pub fn normalize_term(term: &str) -> String {
    const EDGE_PUNCT: &str = ".,;:!?\"'()[]\u{201c}\u{201d}\u{2018}\u{2019}";
    term.trim_matches(|c: char| c.is_whitespace() || EDGE_PUNCT.contains(c))
        .to_ascii_lowercase()
}

/// UI placeholder written by older clients when a lookup missed. Never a real definition.
pub const PLACEHOLDER_DEFINITION: &str = "待补充释义";

/// `None` for blank text or the placeholder, so a merge never overwrites real data with it.
fn meaningful(value: &Option<String>) -> Option<&str> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty() && *v != PLACEHOLDER_DEFINITION)
}

fn find_vocab_id_by_normalized(conn: &Connection, normalized: &str) -> DbResult<Option<String>> {
    match conn.query_row(
        "SELECT id FROM vocabulary_items WHERE normalized_term = ?1
         ORDER BY created_at ASC, id ASC LIMIT 1",
        params![normalized],
        |r| r.get::<_, String>(0),
    ) {
        Ok(id) => Ok(Some(id)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn upsert_vocab(conn: &Connection, cmd: &UpsertVocabCommand) -> DbResult<VocabularyItem> {
    let term = cmd.term.trim();
    if term.is_empty() {
        return Err(DbError::Validation("term required".into()));
    }
    let normalized = normalize_term(term);
    let now = chrono::Utc::now().to_rfc3339();
    // One row per normalized word: an id-less save of a known word updates that row.
    let id = match cmd.id.clone().filter(|s| !s.trim().is_empty()) {
        Some(id) => id,
        None => find_vocab_id_by_normalized(conn, &normalized)?
            .unwrap_or_else(|| format!("vocab-{}", Uuid::new_v4())),
    };
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
            definition = CASE
                WHEN excluded.definition IS NOT NULL THEN excluded.definition
                WHEN definition = ?12 THEN NULL
                ELSE definition END,
            phonetic = COALESCE(excluded.phonetic, phonetic),
            part_of_speech = COALESCE(excluded.part_of_speech, part_of_speech),
            example = COALESCE(excluded.example, example),
            source_asset_id = COALESCE(excluded.source_asset_id, source_asset_id),
            source_attempt_id = COALESCE(excluded.source_attempt_id, source_attempt_id),
            tags_json = excluded.tags_json,
            updated_at = excluded.updated_at",
        params![
            id,
            term,
            normalized,
            meaningful(&cmd.definition),
            meaningful(&cmd.phonetic),
            meaningful(&cmd.part_of_speech),
            meaningful(&cmd.example),
            cmd.source_asset_id,
            cmd.source_attempt_id,
            tags_json,
            now,
            PLACEHOLDER_DEFINITION,
        ],
    )?;

    // ensure review row
    conn.execute(
        "INSERT OR IGNORE INTO vocabulary_review_state (item_id) VALUES (?1)",
        params![id],
    )?;

    get_vocab(conn, &id)
}

pub fn get_vocab(conn: &Connection, id: &str) -> DbResult<VocabularyItem> {
    conn.query_row(
        "SELECT v.id, v.term, v.normalized_term, v.definition, v.phonetic, v.part_of_speech, v.example,
                v.source_asset_id, v.source_attempt_id, v.tags_json, v.created_at, v.updated_at,
                r.ease_factor, r.interval_days, r.repetitions, r.due_at, r.last_reviewed_at, r.lapses
         FROM vocabulary_items v
         LEFT JOIN vocabulary_review_state r ON r.item_id = v.id
         WHERE v.id = ?1",
        params![id],
        map_item,
    )
    .optional()?
    .ok_or_else(|| DbError::Message(format!("vocab not found: {id}")))
}

pub fn list_vocab(conn: &Connection, limit: u32, offset: u32) -> DbResult<Vec<VocabularyItem>> {
    let mut stmt = conn.prepare(
        "SELECT v.id, v.term, v.normalized_term, v.definition, v.phonetic, v.part_of_speech, v.example,
                v.source_asset_id, v.source_attempt_id, v.tags_json, v.created_at, v.updated_at,
                r.ease_factor, r.interval_days, r.repetitions, r.due_at, r.last_reviewed_at, r.lapses
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
    // An explicit user delete (the review state goes with the word by cascade).
    let n = with_delete_gate(conn, || {
        Ok(conn.execute("DELETE FROM vocabulary_items WHERE id = ?1", params![id])?)
    })?;
    Ok(n > 0)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChronicVocabItem {
    pub term: String,
    pub lapses: u32,
    pub source_asset_id: Option<String>,
}

/// Words repeatedly forgotten, including their originating material.
pub fn chronic_vocab(
    conn: &Connection,
    min_lapses: u32,
    limit: u32,
) -> DbResult<Vec<ChronicVocabItem>> {
    let mut stmt = conn.prepare(
        "SELECT v.term, r.lapses, v.source_asset_id
         FROM vocabulary_items v JOIN vocabulary_review_state r ON r.item_id = v.id
         WHERE r.lapses >= ?1 ORDER BY r.lapses DESC, v.normalized_term ASC, v.id ASC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![min_lapses, limit.min(500)], |row| {
        Ok(ChronicVocabItem {
            term: row.get(0)?,
            lapses: row.get(1)?,
            source_asset_id: row.get(2)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
}

/// Apply review grade; does not touch attempt scores.
pub fn review_vocab(conn: &Connection, cmd: &ReviewVocabCommand) -> DbResult<VocabularyItem> {
    review_vocab_at(conn, cmd, None)
}

#[derive(Debug, PartialEq)]
struct StoredReview {
    state: Sm2State,
    correct_count: u32,
    last_reviewed_at: Option<String>,
}

fn load_review(conn: &Connection, item_id: &str) -> DbResult<StoredReview> {
    conn.query_row(
        "SELECT ease_factor, interval_days, repetitions, intra_cycles, lapses, correct_count, last_reviewed_at
         FROM vocabulary_review_state WHERE item_id=?1",
        [item_id],
        |row| Ok(StoredReview {
            state: Sm2State {
                ease_factor: row.get(0)?, interval: row.get(1)?, repetitions: row.get(2)?,
                intra_cycles: row.get(3)?, lapses: row.get(4)?,
            },
            correct_count: row.get(5)?, last_reviewed_at: row.get(6)?,
        }),
    ).optional()?.ok_or_else(|| DbError::Validation(format!("vocabulary review state missing: {item_id}")))
}

// A supplied time identifies an exact review for replay; production assigns a fresh time.
fn review_vocab_at(
    conn: &Connection,
    cmd: &ReviewVocabCommand,
    at_ms: Option<i64>,
) -> DbResult<VocabularyItem> {
    let rating = match cmd.grade {
        0 => Sm2Rating::Wrong,
        1 => Sm2Rating::Hard,
        2 => Sm2Rating::Good,
        3 => Sm2Rating::Easy,
        _ => {
            return Err(DbError::Validation(format!(
                "invalid vocabulary grade: {}",
                cmd.grade
            )))
        }
    };
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let item = get_vocab(&tx, &cmd.item_id)?;
    let old = load_review(&tx, &cmd.item_id)?;
    let previous_ms = old
        .last_reviewed_at
        .as_deref()
        .map(rfc3339_to_ms)
        .transpose()?;
    // Rapid successive reviews and a clock moving backwards must still have distinct event IDs.
    let now_ms = at_ms.unwrap_or_else(|| {
        chrono::Utc::now()
            .timestamp_millis()
            .max(previous_ms.map_or(i64::MIN, |v| v.saturating_add(1)))
    });
    let source_id = format!("{}:{now_ms}", cmd.item_id);
    let key = event_key(
        LearningEventType::VocabularyReviewCompleted,
        Some(&source_id),
        LearningEventType::SCHEMA_VERSION,
    );
    let existing_grade: Option<u8> = tx.query_row(
        "SELECT json_extract(payload_json, '$.grade') FROM learning_events WHERE idempotency_key=?1",
        [&key], |row| row.get(0),
    ).optional()?;
    if let Some(grade) = existing_grade {
        if grade != cmd.grade {
            return Err(DbError::Validation(format!(
                "vocabulary review replay grade conflict: {source_id}"
            )));
        }
        tx.commit()?;
        return Ok(item);
    }
    let outcome = schedule_after_result(&old.state, rating, now_ms);
    let due_at = outcome.next_review.map(ms_to_rfc3339).transpose()?;
    let reviewed_at = ms_to_rfc3339(now_ms)?;
    // origin/main:js/core/vocabScheduler.js:206-208,228,246.
    let correct_count = match (old.state.ease_factor, rating) {
        (None, _) => old.correct_count,
        (Some(_), Sm2Rating::Wrong) => 0,
        (Some(_), _) => old.correct_count.saturating_add(1),
    };
    tx.execute(
        "UPDATE vocabulary_review_state SET ease_factor=?1, interval_days=?2, repetitions=?3,
            intra_cycles=?4, correct_count=?5, due_at=?6, last_reviewed_at=?7, lapses=?8 WHERE item_id=?9",
        params![outcome.state.ease_factor, outcome.state.interval, outcome.state.repetitions,
            outcome.state.intra_cycles, correct_count, due_at, reviewed_at, outcome.state.lapses, cmd.item_id],
    )?;
    let event = NewLearningEvent {
        event_type: LearningEventType::VocabularyReviewCompleted,
        source_kind: "vocabulary_review".into(),
        source_id: Some(source_id),
        activity: Some("vocabulary".into()),
        asset_id: item.source_asset_id.clone(),
        attempt_id: None,
        question_id: None,
        skill_key: None,
        occurred_at: reviewed_at.clone(),
        payload: json!({"normalizedTerm": item.normalized_term, "grade": cmd.grade,
            "lapses": outcome.state.lapses, "intervalDays": outcome.state.interval,
            "repetitions": outcome.state.repetitions}),
        schema_version: LearningEventType::SCHEMA_VERSION,
        sensitivity: "normal".into(),
    };
    append_learning_event_if_enabled(&tx, event)?;
    tx.execute(
        "UPDATE vocabulary_items SET updated_at=?1 WHERE id=?2",
        params![reviewed_at, cmd.item_id],
    )?;
    let updated = get_vocab(&tx, &cmd.item_id)?;
    tx.commit()?;
    Ok(updated)
}

/// No local calendar arithmetic: SM-2 keeps fixed 24h days (JS uses local calendar days).
fn ms_to_rfc3339(value: i64) -> DbResult<String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(value)
        .map(|dt| dt.to_rfc3339())
        .ok_or_else(|| DbError::Validation(format!("invalid vocabulary timestamp: {value}")))
}

fn rfc3339_to_ms(value: &str) -> DbResult<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.timestamp_millis())
        .map_err(|e| DbError::Validation(format!("invalid vocabulary review time: {e}")))
}

fn map_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<VocabularyItem> {
    let tags_json: Option<String> = row.get(9)?;
    let tags: Vec<String> = tags_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let review = match row.get::<_, Option<f64>>(13)? {
        Some(interval_days) => Some(ReviewState {
            // The public DTO keeps its numeric ease; nullable EF is internal to the scheduler.
            ease: row
                .get::<_, Option<f64>>(12)?
                .unwrap_or(DEFAULT_EASE_FACTOR),
            interval_days,
            repetitions: row.get(14)?,
            due_at: row.get(15)?,
            last_reviewed_at: row.get(16)?,
            lapses: row.get(17)?,
        }),
        None => None,
    };
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{learning_events::list_learning_events, migrate::migrate};
    use ielts_domain::vocab_sm2::DAY_MS;
    const NOW: i64 = 1_700_000_000_000;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON").unwrap();
        migrate(&mut conn).unwrap();
        conn
    }
    fn add_word(conn: &Connection, id: &str) -> VocabularyItem {
        upsert_vocab(
            conn,
            &UpsertVocabCommand {
                id: Some(id.into()),
                term: id.into(),
                definition: None,
                phonetic: None,
                part_of_speech: None,
                example: None,
                source_asset_id: Some("asset-1".into()),
                source_attempt_id: None,
                tags: vec![],
            },
        )
        .unwrap()
    }
    fn review(conn: &Connection, grade: u8, at: i64) -> DbResult<VocabularyItem> {
        review_vocab_at(
            conn,
            &ReviewVocabCommand {
                item_id: "abandon".into(),
                grade,
            },
            Some(at),
        )
    }
    fn mid_progress(conn: &Connection) {
        conn.execute(
            "UPDATE vocabulary_review_state SET ease_factor=2.5, interval_days=15,
            repetitions=2, intra_cycles=4, lapses=3, correct_count=7,
            last_reviewed_at='2023-11-01T00:00:00Z' WHERE item_id='abandon'",
            [],
        )
        .unwrap();
    }
    #[test]
    fn first_review_four_ratings_initialize_without_scheduling_or_counting_success() {
        for (grade, ease, cycles, lapses) in [
            (0, 2.5, 1, 1),
            (1, 1.8, 1, 0),
            (2, 2.5, 1, 0),
            (3, 2.8, 0, 0),
        ] {
            let conn = db();
            add_word(&conn, "abandon");
            conn.execute(
                "UPDATE vocabulary_review_state SET correct_count=7 WHERE item_id='abandon'",
                [],
            )
            .unwrap();
            let item = review(&conn, grade, NOW).unwrap();
            let stored = load_review(&conn, "abandon").unwrap();
            assert_eq!(
                stored.state,
                Sm2State {
                    ease_factor: Some(ease),
                    interval: 1.0,
                    repetitions: 0,
                    intra_cycles: cycles,
                    lapses
                }
            );
            assert_eq!(stored.correct_count, 7);
            assert_eq!(item.review.unwrap().due_at, None);
            let events = list_learning_events(&conn, None, None, 100).unwrap();
            assert_eq!(
                events.len(),
                usize::from(crate::learning_events::learning_event_generation_enabled())
            );
            if let Some(event) = events.first() {
                assert_eq!(
                    event.event_type,
                    LearningEventType::VocabularyReviewCompleted
                );
                assert_eq!(event.source_kind, "vocabulary_review");
                assert_eq!(
                    event.source_id.as_deref(),
                    Some(format!("abandon:{NOW}").as_str())
                );
                assert_eq!(event.activity.as_deref(), Some("vocabulary"));
                assert_eq!(event.asset_id.as_deref(), Some("asset-1"));
                assert_eq!(
                    event.payload,
                    json!({"normalizedTerm":"abandon","grade":grade,"lapses":lapses,"intervalDays":1.0,"repetitions":0})
                );
            }
        }
    }
    #[test]
    fn existing_four_ratings_match_domain_examples_and_main_correct_count() {
        for (grade, ease, interval, reps, cycles, lapses, count) in [
            (0, 2.3, 1.0, 0, 1, 4, 0),
            (1, 2.36, 35.0, 3, 0, 3, 8),
            (2, 2.5, 38.0, 3, 0, 3, 8),
            (3, 2.6, 39.0, 3, 0, 3, 8),
        ] {
            let conn = db();
            add_word(&conn, "abandon");
            mid_progress(&conn);
            let item = review(&conn, grade, NOW).unwrap();
            let stored = load_review(&conn, "abandon").unwrap();
            assert!((stored.state.ease_factor.unwrap() - ease).abs() < 1e-9);
            assert_eq!(
                (
                    stored.state.interval,
                    stored.state.repetitions,
                    stored.state.intra_cycles,
                    stored.state.lapses,
                    stored.correct_count
                ),
                (interval, reps, cycles, lapses, count)
            );
            assert_eq!(
                rfc3339_to_ms(item.review.unwrap().due_at.as_deref().unwrap()).unwrap(),
                NOW + interval as i64 * DAY_MS
            );
            assert_eq!(item.updated_at, ms_to_rfc3339(NOW).unwrap());
        }
    }
    #[test]
    fn good_progression_persists_new_then_six_then_fifteen_days() {
        let conn = db();
        add_word(&conn, "abandon");
        assert_eq!(review(&conn, 2, NOW).unwrap().review.unwrap().due_at, None);
        assert_eq!(
            review(&conn, 2, NOW + 1)
                .unwrap()
                .review
                .unwrap()
                .interval_days,
            6.0
        );
        assert_eq!(
            review(&conn, 2, NOW + DAY_MS * 6)
                .unwrap()
                .review
                .unwrap()
                .interval_days,
            15.0
        );
        assert_eq!(load_review(&conn, "abandon").unwrap().correct_count, 2);
    }
    #[test]
    #[cfg(feature = "learning-event-ledger-v1")]
    fn exact_review_replay_is_noop_and_different_grade_conflicts() {
        let conn = db();
        add_word(&conn, "abandon");
        mid_progress(&conn);
        let first = review(&conn, 2, NOW).unwrap();
        let stored = load_review(&conn, "abandon").unwrap();
        assert_eq!(review(&conn, 2, NOW).unwrap(), first);
        assert_eq!(load_review(&conn, "abandon").unwrap(), stored);
        assert_eq!(
            list_learning_events(&conn, None, None, 100).unwrap().len(),
            1
        );
        assert!(review(&conn, 0, NOW).is_err());
        assert_eq!(get_vocab(&conn, "abandon").unwrap(), first);
        assert_eq!(load_review(&conn, "abandon").unwrap(), stored);
        assert_eq!(
            list_learning_events(&conn, None, None, 100).unwrap().len(),
            1
        );
    }
    #[test]
    #[cfg(feature = "learning-event-ledger-v1")]
    fn event_failure_rolls_back_state_and_word_metadata() {
        let conn = db();
        let before = add_word(&conn, "abandon");
        let state = load_review(&conn, "abandon").unwrap();
        conn.execute_batch("CREATE TRIGGER fail_vocab_event BEFORE INSERT ON learning_events BEGIN SELECT RAISE(ABORT,'test event failure'); END;").unwrap();
        assert!(review(&conn, 0, NOW).is_err());
        assert_eq!(get_vocab(&conn, "abandon").unwrap(), before);
        assert_eq!(load_review(&conn, "abandon").unwrap(), state);
        assert_eq!(
            list_learning_events(&conn, None, None, 100).unwrap().len(),
            0
        );
    }
    #[test]
    fn successive_public_reviews_use_distinct_times_even_when_clock_moves_backwards() {
        let conn = db();
        add_word(&conn, "abandon");
        let future = chrono::Utc::now().timestamp_millis() + DAY_MS;
        conn.execute(
            "UPDATE vocabulary_review_state SET last_reviewed_at=?1 WHERE item_id='abandon'",
            [ms_to_rfc3339(future).unwrap()],
        )
        .unwrap();
        let cmd = ReviewVocabCommand {
            item_id: "abandon".into(),
            grade: 2,
        };
        let a = review_vocab(&conn, &cmd).unwrap();
        let b = review_vocab(&conn, &cmd).unwrap();
        assert_eq!(
            rfc3339_to_ms(a.review.unwrap().last_reviewed_at.as_deref().unwrap()).unwrap(),
            future + 1
        );
        assert_eq!(
            rfc3339_to_ms(b.review.unwrap().last_reviewed_at.as_deref().unwrap()).unwrap(),
            future + 2
        );
    }
    #[test]
    fn invalid_grade_missing_word_or_missing_state_cannot_write_events() {
        let conn = db();
        add_word(&conn, "abandon");
        for grade in [4, 255] {
            assert!(review(&conn, grade, NOW).is_err());
        }
        assert!(review_vocab(
            &conn,
            &ReviewVocabCommand {
                item_id: "missing".into(),
                grade: 2
            }
        )
        .is_err());
        with_delete_gate(&conn, || {
            Ok(conn.execute(
                "DELETE FROM vocabulary_review_state WHERE item_id='abandon'",
                [],
            )?)
        })
        .unwrap();
        assert_eq!(get_vocab(&conn, "abandon").unwrap().review, None);
        assert!(review(&conn, 2, NOW).is_err());
        assert_eq!(
            list_learning_events(&conn, None, None, 100).unwrap().len(),
            0
        );
    }
    #[test]
    fn chronic_words_filter_sort_limit_and_keep_source() {
        let conn = db();
        for word in ["a", "b", "c"] {
            add_word(&conn, word);
        }
        conn.execute("UPDATE vocabulary_review_state SET lapses=CASE item_id WHEN 'a' THEN 4 WHEN 'b' THEN 7 ELSE 1 END",[]).unwrap();
        assert_eq!(
            chronic_vocab(&conn, 3, 2).unwrap(),
            vec![
                ChronicVocabItem {
                    term: "b".into(),
                    lapses: 7,
                    source_asset_id: Some("asset-1".into())
                },
                ChronicVocabItem {
                    term: "a".into(),
                    lapses: 4,
                    source_asset_id: Some("asset-1".into())
                }
            ]
        );
        assert_eq!(chronic_vocab(&conn, 3, 1).unwrap().len(), 1);
        assert!(chronic_vocab(&conn, 3, 0).unwrap().is_empty());
    }
    #[test]
    fn review_wire_shape_keeps_numeric_ease_and_existing_fields() {
        let conn = db();
        let item = add_word(&conn, "abandon");
        assert_eq!(
            serde_json::to_value(item.review.unwrap()).unwrap(),
            json!({"ease":2.5,"intervalDays":1.0,"repetitions":0,"lapses":0})
        );
        let value = serde_json::to_value(review(&conn, 2, NOW).unwrap().review.unwrap()).unwrap();
        assert!(value["ease"].is_number());
        assert!(value.get("intraCycles").is_none());
        assert!(value.get("correctCount").is_none());
    }
    #[test]
    fn time_conversion_preserves_offsets_milliseconds_and_fixed_days() {
        assert_eq!(
            rfc3339_to_ms("2023-11-14T22:13:20.123+00:00").unwrap(),
            NOW + 123
        );
        assert_eq!(
            rfc3339_to_ms("2023-11-15T06:13:20.123+08:00").unwrap(),
            NOW + 123
        );
        assert_eq!(
            rfc3339_to_ms(&ms_to_rfc3339(NOW + 123).unwrap()).unwrap(),
            NOW + 123
        );
        let spring = rfc3339_to_ms("2026-03-28T12:00:00+00:00").unwrap();
        let next = ielts_domain::vocab_sm2::next_review_at(spring, 1.0);
        assert_eq!(next - spring, DAY_MS);
        assert_eq!(ms_to_rfc3339(next).unwrap(), "2026-03-29T12:00:00+00:00");
        assert!(rfc3339_to_ms("bad date").is_err());
        assert!(ms_to_rfc3339(i64::MAX).is_err());
    }
}
