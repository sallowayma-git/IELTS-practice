//! Coach preference cards: the learner confirms or dismisses what the coach offers
//! to remember. The rules live in `ielts_application::MemoryCardService`; this file
//! is the IPC surface and the database adapter for the card reads.

use ielts_application::{ApplicationError, MemoryCardService, MemoryCardStore};
use ielts_db::MemoryCardSource;
use ielts_domain::{CommandResponse, ErrorEnvelope};
use serde::Serialize;
use tauri::State;

use crate::app::application_store::ApplicationStore;
use crate::app::state::AppDb;

const LOCAL_USER: &str = "local";

/// The memory a confirmed card became.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCardConfirmed {
    pub memory_id: String,
}

/// `memoryCard` reads and the `memoryCardState` write, against the app database.
struct CardStore<'a>(&'a AppDb);

impl MemoryCardStore for CardStore<'_> {
    fn card_source(
        &self,
        user_id: &str,
        message_id: &str,
        note_index: usize,
    ) -> Result<Option<MemoryCardSource>, ApplicationError> {
        self.0
            .with_conn(|conn| ielts_db::load_memory_card(conn, user_id, message_id, note_index))
            .map_err(card_error)
    }

    fn active_card_memory(&self, user_id: &str, canonical_key: &str) -> Result<Option<String>, ApplicationError> {
        self.0
            .with_conn(|conn| ielts_db::active_card_memory(conn, user_id, canonical_key))
            .map_err(card_error)
    }

    fn record_card_state(&self, message_id: &str, state: &str) -> Result<(), ApplicationError> {
        self.0.with_conn(|conn| ielts_db::set_memory_card_state(conn, message_id, state)).map_err(card_error)
    }
}

fn card_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("memory_card.persistence_failed", error.to_string(), true)
}

/// Remember a coach note as the learner wrote it: a `user_explicit` preference memory
/// for reading, written through the memory service. Idempotent per (messageId,
/// noteIndex): a repeat returns the same `memoryId`.
///
/// Errors: `memory_card.not_found`, `memory_card.invalid_text`, `memory_card.no_source`,
/// `memory_card.rejected`, `memory_card.persistence_failed` (retryable).
#[tauri::command]
pub fn coach_confirm_memory_card(
    db: State<'_, AppDb>,
    message_id: String,
    note_index: u32,
    text: String,
) -> CommandResponse<MemoryCardConfirmed> {
    respond(confirm(db.inner(), &message_id, note_index, &text))
}

/// Decline a card: records `memoryCardState: "dismissed"` and nothing else.
///
/// Errors: `memory_card.not_found`, `memory_card.already_confirmed`,
/// `memory_card.persistence_failed` (retryable).
#[tauri::command]
pub fn coach_dismiss_memory_card(
    db: State<'_, AppDb>,
    message_id: String,
    note_index: u32,
) -> CommandResponse<()> {
    respond(dismiss(db.inner(), &message_id, note_index))
}

fn confirm(db: &AppDb, message_id: &str, note_index: u32, text: &str) -> Result<MemoryCardConfirmed, ApplicationError> {
    let (memory, cards) = (ApplicationStore::new(db), CardStore(db));
    MemoryCardService::new(&memory, &cards)
        .confirm(LOCAL_USER, message_id, note_index as usize, text)
        .map(|memory_id| MemoryCardConfirmed { memory_id })
}

fn dismiss(db: &AppDb, message_id: &str, note_index: u32) -> Result<(), ApplicationError> {
    let (memory, cards) = (ApplicationStore::new(db), CardStore(db));
    MemoryCardService::new(&memory, &cards).dismiss(LOCAL_USER, message_id, note_index as usize)
}

fn respond<T>(result: Result<T, ApplicationError>) -> CommandResponse<T> {
    match result {
        Ok(value) => CommandResponse::success(value),
        Err(error) => CommandResponse::failure(ErrorEnvelope::new(error.code, error.message, error.retryable)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ielts_db::{
        append_coach_message, ensure_coach_thread, import_asset_payload_file, migrate, open_connection,
        submit_reading_attempt, AppendCoachMessageCommand, DbOpenOptions, EnsureCoachThreadCommand,
    };
    use serde_json::{json, Value};

    fn say(db: &AppDb, role: &str, payload: Value) -> String {
        db.with_conn(|conn| {
            let message = append_coach_message(
                conn,
                &AppendCoachMessageCommand {
                    thread_id: "t1".into(),
                    role: role.into(),
                    content: "text".into(),
                    structured_payload: Some(payload),
                    status: "completed".into(),
                },
            )?;
            conn.execute("UPDATE coach_messages SET created_at = '2026-10-05T10:05:00Z' WHERE id = ?1", [&message.id])?;
            Ok(message.id)
        })
        .unwrap()
    }

    /// A real database with one coach turn: the learner's message, then an answer with a note and a card.
    fn fixture() -> (tempfile::TempDir, AppDb, String) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("card.db");
        let mut conn = open_connection(&DbOpenOptions::create(&path)).unwrap();
        migrate(&mut conn).unwrap();
        let asset = dir.path().join("P1.json");
        let payload = json!({
            "examId": "P1", "meta": {"title": "Passage P1", "category": "P1"},
            "questionCount": 2, "questionOrder": ["q1", "q2"],
            "answerKey": {"q1": "TRUE", "q2": "FALSE"},
            "passage": {"blocks": [{"html": "<p>Never leaves the host.</p>"}]},
            "questionGroups": [{"kind": "tfng", "questionIds": ["q1", "q2"]}]
        });
        std::fs::write(&asset, serde_json::to_vec(&payload).unwrap()).unwrap();
        import_asset_payload_file(&conn, &asset).unwrap();
        submit_reading_attempt(
            &conn,
            &serde_json::from_value(json!({"attemptId": "a1", "assetId": "P1", "answers": {"q1": "FALSE", "q2": "FALSE"}, "idempotencyKey": "a1"}))
                .unwrap(),
        )
        .unwrap();
        ensure_coach_thread(
            &conn,
            &EnsureCoachThreadCommand {
                thread_id: Some("t1".into()),
                attempt_id: Some("a1".into()),
                asset_id: Some("P1".into()),
                kind: "chat".into(),
            },
        )
        .unwrap();
        let db = AppDb::from_test_connection(conn, path);
        say(&db, "user", json!({"promptKind": "freeform"}));
        let answer = say(
            &db,
            "assistant",
            json!({
                "answer": "x",
                "teachingNotes": [{"kind": "preference", "text": "判断题上需要先给例子再讲证据"}],
                "memoryCard": {"noteIndex": 0, "text": "判断题上先给例子再讲证据"},
            }),
        );
        (dir, db, answer)
    }

    fn state(db: &AppDb, message: &str) -> Option<String> {
        db.with_conn(|conn| {
            conn.query_row(
                "SELECT json_extract(structured_payload, '$.memoryCardState') FROM coach_messages WHERE id = ?1",
                [message],
                |row| row.get(0),
            )
            .map_err(Into::into)
        })
        .unwrap()
    }

    #[test]
    fn confirm_returns_the_memory_id_once_and_records_the_decision() {
        let (_dir, db, answer) = fixture();
        let first = confirm(&db, &answer, 0, "判断题上，先给例子再讲证据").unwrap();
        let again = confirm(&db, &answer, 0, "判断题上，先给例子再讲证据").unwrap();
        assert_eq!(first, again);
        assert!(first.memory_id.starts_with("mem-"), "{first:?}");
        assert_eq!(state(&db, &answer).as_deref(), Some("confirmed"));
        let (source, scope, namespace): (String, String, String) = db
            .with_conn(|conn| {
                conn.query_row(
                    "SELECT source_class, scope, namespace FROM memory_items WHERE id = ?1",
                    [&first.memory_id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .map_err(Into::into)
            })
            .unwrap();
        assert_eq!((source.as_str(), scope.as_str(), namespace.as_str()), ("user_explicit", "activity:reading", "preference"));
        assert_eq!(serde_json::to_value(&first).unwrap(), json!({"memoryId": first.memory_id}));
    }

    #[test]
    fn dismiss_records_only_the_decision_and_cannot_undo_a_confirmed_card() {
        let (_dir, db, answer) = fixture();
        dismiss(&db, &answer, 0).unwrap();
        assert_eq!(state(&db, &answer).as_deref(), Some("dismissed"));
        let memories: i64 = db.with_conn(|conn| conn.query_row("SELECT COUNT(*) FROM memory_items", [], |row| row.get(0)).map_err(Into::into)).unwrap();
        assert_eq!(memories, 0);

        confirm(&db, &answer, 0, "先给例子").unwrap();
        assert_eq!(dismiss(&db, &answer, 0).unwrap_err().code, "memory_card.already_confirmed");
    }

    #[test]
    fn refusals_carry_their_codes_through_the_envelope() {
        let (_dir, db, answer) = fixture();
        let envelope = |result: Result<MemoryCardConfirmed, ApplicationError>| {
            let response = respond(result);
            assert!(!response.ok);
            response.error.expect("a failure carries its error").code
        };
        assert_eq!(envelope(confirm(&db, &answer, 0, "  ")), "memory_card.invalid_text");
        assert_eq!(envelope(confirm(&db, &answer, 3, "先给例子")), "memory_card.not_found");
        assert_eq!(envelope(confirm(&db, "no-such-message", 0, "先给例子")), "memory_card.not_found");
        assert_eq!(state(&db, &answer), None);
    }
}
