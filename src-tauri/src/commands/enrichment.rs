//! Annotations, dictionary, vocab, coach Tauri commands (Phase 8).

use ielts_application::{ApplicationError, CoachService};
use ielts_domain::dto::CommandResponse;
use ielts_domain::ErrorEnvelope;
use tauri::State;

use crate::ai::load_runtime;
use crate::app::application_store::ApplicationStore;
use crate::app::state::{AppDb, AppVault};
use ielts_db::{
    delete_annotation, delete_vocab, ensure_coach_thread, import_dictionary, list_annotations,
    list_coach_messages, list_vocab, lookup_term, revalidate_annotations, review_vocab,
    upsert_annotation, upsert_vocab, AnnotationRecord, CoachMessage, CoachRunResult, CoachThread,
    DictionaryEntry, EnsureCoachThreadCommand, ImportDictionaryCommand, ReviewVocabCommand,
    RunCoachCommand, UpsertAnnotationCommand, UpsertVocabCommand, VocabularyItem,
};

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
pub fn dictionary_lookup(db: State<'_, AppDb>, term: String) -> CommandResponse<DictionaryEntry> {
    match db.with_conn(|conn| lookup_term(conn, &term)) {
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
    cmd: UpsertVocabCommand,
) -> CommandResponse<VocabularyItem> {
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

#[tauri::command]
pub async fn coach_run(
    db: State<'_, AppDb>,
    vault: State<'_, AppVault>,
    cmd: RunCoachCommand,
) -> Result<CommandResponse<CoachRunResult>, ErrorEnvelope> {
    let store = ApplicationStore::new(&db);
    let result = CoachService::run(&store, cmd, || {
        load_runtime(&db, &vault)
            .map_err(|error| ApplicationError::new("enrichment.error", error.to_string(), false))
    })
    .await;
    match result {
        Ok(result) => Ok(CommandResponse::success(result)),
        Err(error) => Ok(CommandResponse::failure(map_application_error(error))),
    }
}
