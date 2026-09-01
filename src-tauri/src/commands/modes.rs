//! Suite / endless / memorize / timer Tauri commands (Phase 7).

use ielts_domain::dto::CommandResponse;
use ielts_domain::ErrorEnvelope;
use tauri::State;

use crate::app::state::AppDb;
use ielts_db::{
    advance_endless, cancel_endless, cancel_suite, create_endless_session, create_memorize_session,
    create_suite_session, finish_memorize_session, get_endless_session, get_suite_session,
    save_endless_passage_draft, submit_endless_passage, submit_suite_passage,
    AdvanceEndlessCommand, CreateEndlessCommand, CreateMemorizeCommand, CreateSuiteCommand,
    EndlessSession, MemorizeSession, ReadingSuiteSession, SaveEndlessPassageDraftCommand,
    SaveEndlessPassageDraftResult, SaveSuitePassageDraftCommand, SaveSuitePassageDraftResult,
    SubmitEndlessCommand, SubmitEndlessResult, SubmitSuitePassageCommand, SubmitSuitePassageResult,
    TimerState,
};

fn map_err(err: ielts_db::DbError) -> ErrorEnvelope {
    ErrorEnvelope {
        code: "modes.error".into(),
        message: err.to_string(),
        retryable: false,
        context: None,
        cause_id: None,
    }
}

#[tauri::command]
pub fn suite_create(
    db: State<'_, AppDb>,
    cmd: CreateSuiteCommand,
) -> CommandResponse<ReadingSuiteSession> {
    match db.with_conn(|conn| create_suite_session(conn, &cmd)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn suite_get(db: State<'_, AppDb>, suite_id: String) -> CommandResponse<ReadingSuiteSession> {
    match db.with_conn(|conn| get_suite_session(conn, &suite_id)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn suite_submit_passage(
    db: State<'_, AppDb>,
    cmd: SubmitSuitePassageCommand,
) -> CommandResponse<SubmitSuitePassageResult> {
    match db.with_conn(|conn| submit_suite_passage(conn, &cmd)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn suite_save_passage_draft(
    db: State<'_, AppDb>,
    cmd: SaveSuitePassageDraftCommand,
) -> CommandResponse<SaveSuitePassageDraftResult> {
    match db.with_conn(|conn| ielts_db::save_suite_passage_draft(conn, &cmd)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn suite_cancel(
    db: State<'_, AppDb>,
    suite_id: String,
) -> CommandResponse<ReadingSuiteSession> {
    match db.with_conn(|conn| cancel_suite(conn, &suite_id)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn endless_create(
    db: State<'_, AppDb>,
    cmd: CreateEndlessCommand,
) -> CommandResponse<EndlessSession> {
    match db.with_conn(|conn| create_endless_session(conn, &cmd)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn endless_get(db: State<'_, AppDb>, session_id: String) -> CommandResponse<EndlessSession> {
    match db.with_conn(|conn| get_endless_session(conn, &session_id)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn endless_save_passage_draft(
    db: State<'_, AppDb>,
    cmd: SaveEndlessPassageDraftCommand,
) -> CommandResponse<SaveEndlessPassageDraftResult> {
    match db.with_conn(|conn| save_endless_passage_draft(conn, &cmd)) {
        Ok(value) => CommandResponse::success(value),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

#[tauri::command]
pub fn endless_cancel(db: State<'_, AppDb>, session_id: String) -> CommandResponse<EndlessSession> {
    match db.with_conn(|conn| cancel_endless(conn, &session_id)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn endless_advance(
    db: State<'_, AppDb>,
    cmd: AdvanceEndlessCommand,
) -> CommandResponse<EndlessSession> {
    match db.with_conn(|conn| advance_endless(conn, &cmd)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn endless_submit(
    db: State<'_, AppDb>,
    cmd: SubmitEndlessCommand,
) -> CommandResponse<SubmitEndlessResult> {
    match db.with_conn(|conn| submit_endless_passage(conn, &cmd)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn memorize_create(
    db: State<'_, AppDb>,
    cmd: CreateMemorizeCommand,
) -> CommandResponse<MemorizeSession> {
    match db.with_conn(|conn| create_memorize_session(conn, &cmd)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn memorize_finish(
    db: State<'_, AppDb>,
    attempt_id: String,
) -> CommandResponse<ielts_domain::dto::AttemptRecord> {
    match db.with_conn(|conn| finish_memorize_session(conn, &attempt_id)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

/// Pure timer helpers for frontend (no DB).
#[tauri::command]
pub fn timer_elapsed_seconds(timer: TimerState, now_ms: i64) -> CommandResponse<u64> {
    CommandResponse::success(timer.elapsed_seconds(now_ms))
}

#[tauri::command]
pub fn timer_should_auto_submit(timer: TimerState, now_ms: i64) -> CommandResponse<bool> {
    CommandResponse::success(timer.should_auto_submit(now_ms))
}
