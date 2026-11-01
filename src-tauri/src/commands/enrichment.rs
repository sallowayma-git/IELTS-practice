//! Annotations, dictionary, vocab, coach Tauri commands (Phase 8).

use ielts_application::{ApplicationError, CoachService};
use ielts_domain::dto::CommandResponse;
use ielts_domain::ErrorEnvelope;
use serde::Serialize;
use tauri::ipc::{Channel, CommandArg, CommandItem, InvokeBody, InvokeError};
use tauri::{Runtime, State};

use crate::ai::load_runtime;
use crate::app::application_store::ApplicationStore;
use crate::app::state::{AppDb, AppVault};
use ielts_db::{
    delete_annotation, delete_vocab, ensure_coach_thread, import_dictionary, list_annotations,
    list_coach_messages, list_vocab, lookup_term_with_bundled, revalidate_annotations,
    review_vocab, upsert_annotation, upsert_vocab, AnnotationRecord, BundledDictionary,
    CoachMessage, CoachRunResult, CoachThread, DictionaryEntry, EnsureCoachThreadCommand,
    ImportDictionaryCommand, ReviewVocabCommand, RunCoachCommand, UpsertAnnotationCommand,
    UpsertVocabCommand, VocabularyItem, PLACEHOLDER_DEFINITION,
};

/// Bundled ECDICT subset shipped as a Tauri resource. Parsed at most once, on first use
/// (or by the background warm-up spawned in setup); a missing/corrupt file degrades to
/// SQLite-only lookup instead of failing the command.
pub struct BundledDictionaryState {
    path: std::path::PathBuf,
    cell: std::sync::OnceLock<Option<BundledDictionary>>,
}

impl BundledDictionaryState {
    pub fn new(path: std::path::PathBuf) -> Self {
        Self {
            path,
            cell: std::sync::OnceLock::new(),
        }
    }

    pub fn get(&self) -> Option<&BundledDictionary> {
        self.cell
            .get_or_init(|| match BundledDictionary::load(&self.path) {
                Ok(dict) => {
                    tracing::info!(entries = dict.len(), "loaded bundled ECDICT dictionary");
                    Some(dict)
                }
                Err(error) => {
                    tracing::warn!(%error, path = %self.path.display(), "bundled ECDICT unavailable");
                    None
                }
            })
            .as_ref()
    }
}

fn map_err(err: ielts_db::DbError) -> ErrorEnvelope {
    ErrorEnvelope {
        code: "enrichment.error".into(),
        message: err.to_string(),
        retryable: false,
        context: None,
        cause_id: None,
    }
}

fn map_application_error(error: ApplicationError) -> ErrorEnvelope {
    ErrorEnvelope::new(error.code, error.message, error.retryable)
}

#[tauri::command]
pub fn annotation_upsert(
    db: State<'_, AppDb>,
    cmd: UpsertAnnotationCommand,
) -> CommandResponse<AnnotationRecord> {
    match db.with_conn(|conn| upsert_annotation(conn, &cmd)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn annotation_list(
    db: State<'_, AppDb>,
    asset_id: String,
    attempt_id: Option<String>,
) -> CommandResponse<Vec<AnnotationRecord>> {
    match db.with_conn(|conn| list_annotations(conn, &asset_id, attempt_id.as_deref())) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn annotation_delete(
    db: State<'_, AppDb>,
    id: String,
    asset_id: String,
    attempt_id: Option<String>,
) -> CommandResponse<bool> {
    match db.with_conn(|conn| delete_annotation(conn, &id, &asset_id, attempt_id.as_deref())) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn annotation_revalidate(
    db: State<'_, AppDb>,
    asset_id: String,
    attempt_id: Option<String>,
    scope: String,
    document: String,
) -> CommandResponse<Vec<AnnotationRecord>> {
    match db.with_conn(|conn| {
        revalidate_annotations(conn, &asset_id, attempt_id.as_deref(), &scope, &document)
    }) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn dictionary_lookup(
    db: State<'_, AppDb>,
    bundled: State<'_, BundledDictionaryState>,
    term: String,
) -> CommandResponse<DictionaryEntry> {
    let bundled = bundled.get();
    match db.with_conn(|conn| lookup_term_with_bundled(conn, &term, bundled)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn dictionary_import(
    db: State<'_, AppDb>,
    cmd: ImportDictionaryCommand,
) -> CommandResponse<u32> {
    match db.with_conn(|conn| import_dictionary(conn, &cmd)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn vocab_upsert(
    db: State<'_, AppDb>,
    bundled: State<'_, BundledDictionaryState>,
    mut cmd: UpsertVocabCommand,
) -> CommandResponse<VocabularyItem> {
    // A save after a missed lookup arrives without a real definition; fill it from the
    // bundled dictionary instead of persisting the UI placeholder.
    let missing = cmd.definition.as_deref().map_or(true, |d| {
        d.trim().is_empty() || d.trim() == PLACEHOLDER_DEFINITION
    });
    if missing {
        if let Some(hit) = bundled.get().and_then(|b| b.get(&cmd.term)) {
            cmd.definition = Some(hit.definition);
            cmd.phonetic = cmd.phonetic.or(hit.phonetic);
        }
    }
    match db.with_conn(|conn| upsert_vocab(conn, &cmd)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn vocab_list(
    db: State<'_, AppDb>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> CommandResponse<Vec<VocabularyItem>> {
    match db.with_conn(|conn| list_vocab(conn, limit.unwrap_or(100), offset.unwrap_or(0))) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn vocab_review(
    db: State<'_, AppDb>,
    cmd: ReviewVocabCommand,
) -> CommandResponse<VocabularyItem> {
    match db.with_conn(|conn| review_vocab(conn, &cmd)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn vocab_delete(db: State<'_, AppDb>, id: String) -> CommandResponse<bool> {
    match db.with_conn(|conn| delete_vocab(conn, &id)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn coach_ensure_thread(
    db: State<'_, AppDb>,
    cmd: EnsureCoachThreadCommand,
) -> CommandResponse<CoachThread> {
    match db.with_conn(|conn| ensure_coach_thread(conn, &cmd)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn coach_list_messages(
    db: State<'_, AppDb>,
    thread_id: String,
    after_sequence: Option<u32>,
    limit: Option<u32>,
) -> CommandResponse<Vec<CoachMessage>> {
    match db.with_conn(|conn| {
        list_coach_messages(conn, &thread_id, after_sequence, limit.unwrap_or(100))
    }) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

/// A channel argument the webview may leave out. Tauri's own `Channel` argument
/// is required; this reads it only when the key is present and not null, so
/// callers that pass no channel keep working.
pub struct OptionalChannel<T>(pub Option<Channel<T>>);

impl<'de, R: Runtime, T> CommandArg<'de, R> for OptionalChannel<T> {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        let present = match command.message.payload() {
            InvokeBody::Json(value) => value.get(command.key).is_some_and(|value| !value.is_null()),
            InvokeBody::Raw(_) => false,
        };
        if !present {
            return Ok(Self(None));
        }
        Channel::from_command(command).map(|channel| Self(Some(channel)))
    }
}

/// Progress on the optional coach channel. The command's return value stays the
/// final, validated result.
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum CoachStreamEvent {
    /// The next piece of the learner-visible answer, in order.
    Delta { text: String },
}

#[tauri::command]
pub async fn coach_run(
    db: State<'_, AppDb>,
    vault: State<'_, AppVault>,
    cmd: RunCoachCommand,
    on_delta: OptionalChannel<CoachStreamEvent>,
) -> Result<CommandResponse<CoachRunResult>, ErrorEnvelope> {
    let store = ApplicationStore::new(&db);
    let load_model = || {
        load_runtime(&db, &vault)
            .map_err(|error| ApplicationError::new("enrichment.error", error.to_string(), false))
    };
    let result = match on_delta.0 {
        None => CoachService::run(&store, cmd, load_model).await,
        Some(channel) => {
            let mut on_visible = |text: &str| {
                // A closed channel (the view went away) must not fail the run:
                // the reply is still persisted and returned.
                let _ = channel.send(CoachStreamEvent::Delta { text: text.to_owned() });
            };
            CoachService::run_streaming(&store, cmd, load_model, &mut on_visible).await
        }
    };
    match result {
        Ok(result) => Ok(CommandResponse::success(result)),
        Err(error) => Ok(CommandResponse::failure(map_application_error(error))),
    }
}

#[cfg(test)]
mod coach_stream_tests {
    use super::CoachStreamEvent;

    #[test]
    fn delta_events_keep_the_frontend_wire_shape() {
        let event = serde_json::to_value(CoachStreamEvent::Delta { text: "你好".into() }).unwrap();
        assert_eq!(event, serde_json::json!({"event": "delta", "data": {"text": "你好"}}));
    }
}
