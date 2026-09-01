//! Writing draft + evaluation Tauri commands (Phase 5).

use ielts_application::{
    ApplicationError, EvaluationBackend, ModelError, WritingEvaluationService,
    WritingEvaluationStore,
};
use ielts_domain::domain::WritingTaskType;
use ielts_domain::dto::{
    CloneWritingDraftCommand, CommandResponse, ImportWritingPromptsCommand,
    ImportWritingTopicsCommand, ListWritingTopicsQuery, SaveDraftCommand, SubmitAttemptCommand,
    UpsertWritingPromptCommand, UpsertWritingTopicCommand, WritingPromptDto,
    WritingPromptImportReport, WritingTopicDto, WritingTopicImportReport, WritingTopicPage,
    WritingTopicStatistics,
};
use ielts_domain::ErrorEnvelope;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::ai::{load_provider_config, load_runtime_from_provider_config};
use crate::app::application_store::{ApplicationStore, ChannelEventSink};
use crate::app::state::{AppDb, AppVault};
use ielts_db::{
    activate_writing_prompt, clone_writing_draft, delete_writing_prompt, delete_writing_topic,
    get_writing_draft, get_writing_prompt, get_writing_topic, import_writing_prompts,
    import_writing_topics, list_writing_prompts, list_writing_topics, load_evaluation_for_attempt,
    save_writing_draft, submit_writing_attempt, upsert_writing_prompt, upsert_writing_topic,
    writing_topic_statistics as load_writing_topic_statistics, EvaluationEvent, EvaluationHandle,
    StartEvaluationCommand, WritingDraft,
};

fn map_err(err: ielts_db::DbError) -> ErrorEnvelope {
    ErrorEnvelope {
        code: "writing.error".into(),
        message: err.to_string(),
        retryable: false,
        context: None,
        cause_id: None,
    }
}

fn map_application_error(error: ApplicationError) -> ErrorEnvelope {
    ErrorEnvelope::new(error.code, error.message, error.retryable)
}

fn map_ai_not_configured(_: ielts_db::DbError) -> ErrorEnvelope {
    ErrorEnvelope {
        code: "ai.not_configured".into(),
        message: "未配置可用 AI：请在设置中添加并启用默认模型，并在此设备填写 API Key。".into(),
        retryable: false,
        context: None,
        cause_id: None,
    }
}

#[tauri::command]
pub fn writing_save_draft(
    db: State<'_, AppDb>,
    cmd: SaveDraftCommand,
) -> CommandResponse<WritingDraft> {
    match db.with_conn(|conn| save_writing_draft(conn, &cmd)) {
        Ok(d) => CommandResponse::success(d),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn writing_get_draft(
    db: State<'_, AppDb>,
    attempt_id: String,
) -> CommandResponse<Option<WritingDraft>> {
    match db.with_conn(|conn| get_writing_draft(conn, &attempt_id)) {
        Ok(d) => CommandResponse::success(d),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn writing_clone_draft(
    db: State<'_, AppDb>,
    cmd: CloneWritingDraftCommand,
) -> CommandResponse<WritingDraft> {
    match db.with_conn(|conn| clone_writing_draft(conn, &cmd)) {
        Ok(draft) => CommandResponse::success(draft),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

#[tauri::command]
pub fn writing_submit_attempt(
    db: State<'_, AppDb>,
    cmd: SubmitAttemptCommand,
) -> CommandResponse<ielts_domain::dto::AttemptRecord> {
    // Durable submission is independent from provider availability. Provider
    // configuration is resolved only when the evaluation command starts;
    // otherwise users could lose a completed essay merely because AI is
    // temporarily unconfigured.
    match db.with_conn(|conn| submit_writing_attempt(conn, &cmd)) {
        Ok(a) => CommandResponse::success(a),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub async fn writing_start_evaluation(
    app: AppHandle,
    db: State<'_, AppDb>,
    cmd: StartEvaluationCommand,
    on_event: Channel<EvaluationEvent>,
) -> Result<CommandResponse<EvaluationHandle>, ErrorEnvelope> {
    let vault = app.state::<AppVault>();
    let config = match load_provider_config(&db, &vault) {
        Ok(config) => config,
        Err(error) => return Ok(CommandResponse::failure(map_ai_not_configured(error))),
    };

    // Fail closed when no AI is configured. Deterministic is only for explicit offline mode.
    if config.provider == "unconfigured" || config.provider.trim().is_empty() {
        return Ok(CommandResponse::failure(ErrorEnvelope {
            code: "ai.not_configured".into(),
            message: "未配置 AI：请先在设置中添加并启用默认模型与 API Key。".into(),
            retryable: false,
            context: None,
            cause_id: None,
        }));
    }

    let deterministic = config.provider == "deterministic";
    // The evaluation record and the provider request must use the same
    // configuration snapshot. Re-reading the default in the background task
    // would allow a settings change between prepare and execution to mix two
    // providers in one evaluation.
    let provider_config = config.clone();
    let store = ApplicationStore::new(&db);
    let events = ChannelEventSink::new(on_event);
    let outcome = match WritingEvaluationService::start(
        &store,
        &cmd,
        &config.provider,
        &config.model,
        &events,
    ) {
        Ok(outcome) => outcome,
        Err(error) => return Ok(CommandResponse::failure(map_application_error(error))),
    };
    let handle = outcome.handle;
    let Some(prepared) = outcome.pending else {
        return Ok(CommandResponse::success(handle));
    };

    // The command returns the durable handle now. The task owns only request
    // data and never carries a SQLite guard across provider I/O.
    let evaluation_id = handle.evaluation_id.clone();
    tauri::async_runtime::spawn(async move {
        let db = app.state::<AppDb>();
        let store = ApplicationStore::new(&db);
        let backend = if deterministic {
            EvaluationBackend::Deterministic
        } else {
            let vault = app.state::<AppVault>();
            match load_runtime_from_provider_config(&db, &vault, provider_config) {
                Ok(runtime) => EvaluationBackend::Language(runtime),
                Err(error) => {
                    EvaluationBackend::Unavailable(ModelError::new(error.to_string(), false))
                }
            }
        };
        if let Err(error) =
            WritingEvaluationService::execute(&store, prepared, backend, &events).await
        {
            tracing::error!(
                evaluation_id = %evaluation_id,
                error = %error,
                "background writing evaluation failed"
            );
        }
    });

    Ok(CommandResponse::success(handle))
}

#[tauri::command]
pub fn writing_list_evaluation_events(
    db: State<'_, AppDb>,
    evaluation_id: String,
    after_sequence: Option<u32>,
) -> CommandResponse<Vec<EvaluationEvent>> {
    let store = ApplicationStore::new(&db);
    match store.list_events(&evaluation_id, after_sequence.unwrap_or(0)) {
        Ok(events) => CommandResponse::success(events),
        Err(error) => CommandResponse::failure(map_application_error(error)),
    }
}

#[tauri::command]
pub fn writing_cancel_evaluation(
    db: State<'_, AppDb>,
    evaluation_id: String,
) -> CommandResponse<bool> {
    let store = ApplicationStore::new(&db);
    match store.request_cancel(&evaluation_id) {
        Ok(cancelled) => CommandResponse::success(cancelled),
        Err(error) => CommandResponse::failure(map_application_error(error)),
    }
}

#[tauri::command]
pub fn writing_get_evaluation(
    db: State<'_, AppDb>,
    attempt_id: String,
) -> CommandResponse<Option<ielts_domain::dto::WritingEvaluationV4>> {
    match db.with_conn(|conn| load_evaluation_for_attempt(conn, &attempt_id)) {
        Ok(v) => CommandResponse::success(v),
        Err(e) => CommandResponse::failure(map_err(e)),
    }
}

#[tauri::command]
pub fn writing_topic_list(
    db: State<'_, AppDb>,
    query: ListWritingTopicsQuery,
) -> CommandResponse<WritingTopicPage> {
    match db.with_conn(|conn| list_writing_topics(conn, &query)) {
        Ok(page) => CommandResponse::success(page),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

#[tauri::command]
pub fn writing_topic_get(
    db: State<'_, AppDb>,
    id: String,
) -> CommandResponse<Option<WritingTopicDto>> {
    match db.with_conn(|conn| get_writing_topic(conn, &id)) {
        Ok(topic) => CommandResponse::success(topic),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

#[tauri::command]
pub fn writing_topic_upsert(
    db: State<'_, AppDb>,
    cmd: UpsertWritingTopicCommand,
) -> CommandResponse<WritingTopicDto> {
    match db.with_conn(|conn| upsert_writing_topic(conn, &cmd)) {
        Ok(topic) => CommandResponse::success(topic),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

#[tauri::command]
pub fn writing_topic_delete(db: State<'_, AppDb>, id: String) -> CommandResponse<bool> {
    match db.with_conn(|conn| delete_writing_topic(conn, &id)) {
        Ok(deleted) => CommandResponse::success(deleted),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

#[tauri::command]
pub fn writing_topic_import(
    db: State<'_, AppDb>,
    cmd: ImportWritingTopicsCommand,
) -> CommandResponse<WritingTopicImportReport> {
    match db.with_conn(|conn| import_writing_topics(conn, &cmd)) {
        Ok(report) => CommandResponse::success(report),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

#[tauri::command]
pub fn writing_topic_statistics(db: State<'_, AppDb>) -> CommandResponse<WritingTopicStatistics> {
    match db.with_conn(load_writing_topic_statistics) {
        Ok(statistics) => CommandResponse::success(statistics),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

#[tauri::command]
pub fn writing_prompt_list(
    db: State<'_, AppDb>,
    task_type: Option<WritingTaskType>,
) -> CommandResponse<Vec<WritingPromptDto>> {
    match db.with_conn(|conn| list_writing_prompts(conn, task_type)) {
        Ok(prompts) => CommandResponse::success(prompts),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

#[tauri::command]
pub fn writing_prompt_get(
    db: State<'_, AppDb>,
    id: String,
) -> CommandResponse<Option<WritingPromptDto>> {
    match db.with_conn(|conn| get_writing_prompt(conn, &id)) {
        Ok(prompt) => CommandResponse::success(prompt),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

#[tauri::command]
pub fn writing_prompt_upsert(
    db: State<'_, AppDb>,
    cmd: UpsertWritingPromptCommand,
) -> CommandResponse<WritingPromptDto> {
    match db.with_conn(|conn| upsert_writing_prompt(conn, &cmd)) {
        Ok(prompt) => CommandResponse::success(prompt),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

#[tauri::command]
pub fn writing_prompt_import(
    db: State<'_, AppDb>,
    cmd: ImportWritingPromptsCommand,
) -> CommandResponse<WritingPromptImportReport> {
    match db.with_conn(|conn| import_writing_prompts(conn, &cmd)) {
        Ok(report) => CommandResponse::success(report),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

#[tauri::command]
pub fn writing_prompt_activate(
    db: State<'_, AppDb>,
    id: String,
) -> CommandResponse<WritingPromptDto> {
    match db.with_conn(|conn| activate_writing_prompt(conn, &id)) {
        Ok(prompt) => CommandResponse::success(prompt),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}

#[tauri::command]
pub fn writing_prompt_delete(db: State<'_, AppDb>, id: String) -> CommandResponse<bool> {
    match db.with_conn(|conn| delete_writing_prompt(conn, &id)) {
        Ok(deleted) => CommandResponse::success(deleted),
        Err(error) => CommandResponse::failure(map_err(error)),
    }
}
