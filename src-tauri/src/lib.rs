//! Tauri 2 shell for IELTS Practice.
//!
//! Phase 2: boot Vue UI without Fastify; diagnostics / paths / routes.
//! Phase 4: unified history, settings, backup, secret-ref commands.

pub(crate) mod agent;
pub(crate) mod ai;
pub(crate) mod cognitive_runtime;
pub mod app;
pub mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app::logging::init();

    let paths = app::state::AppPaths::discover();
    if let Err(err) = paths.ensure_layout() {
        tracing::error!(error = %err, "failed to ensure app data layout");
    }

    let db = match app::state::AppDb::open(&paths) {
        Ok(db) => db,
        Err(err) => {
            tracing::error!(error = %err, "failed to open v2 database");
            panic!("failed to open v2 database: {err}");
        }
    };
    // M7-02/R3: on startup, recover abandoned leases and enqueue missing daily
    // journal/dream windows discovered from canonical activity dates. This does
    // not execute business logic or spawn a worker thread; jobs remain durable
    // queued work for the existing journal/dream execution paths. No OS
    // scheduler is implied, so the app makes no promise about work while closed.
    #[cfg(feature = "daily-dream-v1")]
    {
        let now = chrono::Utc::now().to_rfc3339();
        if let Err(err) = db.with_conn(|conn| {
            let report = ielts_db::background_jobs::startup_recovery_with_catch_up(conn, &now, 300)?;
            if report.journal_jobs_enqueued > 0 || report.dream_jobs_enqueued > 0 {
                tracing::info!(
                    requeued = report.requeued_jobs,
                    journal_jobs = report.journal_jobs_enqueued,
                    dream_jobs = report.dream_jobs_enqueued,
                    "background job startup recovery enqueued canonical catch-up windows"
                );
            }
            Ok::<(), ielts_db::DbError>(())
        }) {
            tracing::warn!(error = %err, "background job startup recovery failed");
        }
    }
    // M12-02: on startup, mark threads whose latest checkpoint is non-terminal
    // as interrupted. Write tools are never auto-replayed; the user must retry
    // explicitly. This only records the interrupted state for the UI.
    #[cfg(feature = "agent-threads-v1")]
    {
        if let Err(err) = db.with_conn(ielts_db::restart_recovery) {
            tracing::warn!(error = %err, "agent thread startup recovery failed");
        }
    }
    let vault = match app::state::AppVault::open(&paths) {
        Ok(v) => v,
        Err(err) => {
            tracing::error!(error = %err, "failed to open secret vault");
            panic!("failed to open secret vault: {err}");
        }
    };

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(paths)
        .manage(db)
        .manage(vault)
        .manage(agent::WorkspaceGrants::default())
        .manage(agent::AgentCancelRegistry::default())
        .manage(commands::backup::BackupImportGrants::default())
        .manage(commands::diagnostics::UpdaterRuntimeState::default())
        .manage(cognitive_runtime::RuntimeManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::ai::ai_test_provider,
            commands::ai::ai_list_configs,
            commands::ai::ai_upsert_config,
            commands::ai::ai_delete_config,
            commands::ai::ai_set_default_config,
            commands::agent::agent_pick_workspace,
            commands::agent::agent_run,
            commands::agent::agent_run_attempt_review,
            commands::agent::agent_get_run,
            commands::agent::agent_cancel_run,
            #[cfg(feature = "agent-threads-v1")]
            commands::agent::study_plan_run,
            #[cfg(feature = "agent-threads-v1")]
            commands::agent_thread::agent_thread_create,
            #[cfg(feature = "agent-threads-v1")]
            commands::agent_thread::agent_thread_append_message,
            #[cfg(feature = "agent-threads-v1")]
            commands::agent_thread::agent_thread_list,
            #[cfg(feature = "agent-threads-v1")]
            commands::agent_thread::agent_thread_list_messages,
            #[cfg(feature = "agent-threads-v1")]
            commands::agent_thread::agent_thread_archive,
            #[cfg(feature = "agent-threads-v1")]
            commands::agent_thread::agent_thread_save_checkpoint,
            #[cfg(feature = "agent-threads-v1")]
            commands::agent_thread::agent_thread_load_latest_checkpoint,
            #[cfg(feature = "agent-threads-v1")]
            commands::agent_thread::agent_thread_request_cancel,
            #[cfg(feature = "agent-threads-v1")]
            commands::agent_thread::agent_approval_list,
            #[cfg(feature = "agent-threads-v1")]
            commands::agent_thread::agent_approval_decide,
            #[cfg(feature = "agent-threads-v1")]
            commands::agent_thread::study_plan_create,
            #[cfg(feature = "agent-threads-v1")]
            commands::agent_thread::study_plan_list_items,
            #[cfg(feature = "agent-threads-v1")]
            commands::agent_thread::study_plan_get_latest,
            #[cfg(feature = "agent-threads-v1")]
            commands::agent_thread::study_plan_mark_done,
            commands::diagnostics::get_app_info,
            commands::diagnostics::check_for_updates,
            commands::diagnostics::install_update,
            commands::diagnostics::restart_after_update,
            commands::diagnostics::get_startup_diagnostics,
            commands::diagnostics::get_performance_budgets,
            commands::diagnostics::get_query_plan_baselines,
            commands::paths::get_app_data_paths,
            commands::paths::discover_legacy_data_dirs,
            commands::routes::normalize_shell_route,
            commands::routes::resolve_legacy_route,
            commands::history::list_history,
            commands::history::get_history_detail,
            commands::history::history_writing_statistics,
            commands::history::export_history,
            commands::history::delete_history_attempt,
            commands::history::delete_history_attempts,
            commands::history::clear_history,
            commands::history::import_reading_archive_value,
            commands::history::history_get_retention_policy,
            commands::history::history_set_retention_policy,
            commands::learning::learning_get_attempt_detail,
            commands::learning::learning_compare_attempts,
            commands::learning::learning_get_question_history,
            commands::learning::learning_search_events,
            #[cfg(feature = "learning-observation-v1")]
            commands::learning::learning_observations_snapshot,
            #[cfg(feature = "learning-observation-v1")]
            commands::learning::learning_observations_get_by_ids,
            #[cfg(feature = "learning-observation-v1")]
            commands::learning::learning_events_get_evidence_by_ids,
            #[cfg(feature = "memory-core-v1")]
            commands::memory::memory_generate_candidates,
            #[cfg(feature = "memory-core-v1")]
            commands::memory::cognitive_runtime_status,
            #[cfg(feature = "memory-core-v1")]
            commands::memory::cognitive_runtime_health,
            #[cfg(feature = "memory-core-v1")]
            commands::memory::cognitive_runtime_cancel,
            #[cfg(all(feature = "memory-core-v1", feature = "developer-tools"))]
            commands::memory::cognitive_runtime_restart,
            #[cfg(feature = "memory-core-v1")]
            commands::memory::memory_promote_candidate,
            #[cfg(feature = "memory-core-v1")]
            commands::memory::memory_put_explicit_preference,
            #[cfg(feature = "memory-core-v1")]
            commands::memory::memory_context_preview,
            #[cfg(feature = "memory-core-v1")]
            commands::memory::memory_catalog_list,
            #[cfg(feature = "memory-core-v1")]
            commands::memory::memory_forget,
            #[cfg(feature = "developer-tools")]
            commands::learning::learning_events_rebuild,
            #[cfg(feature = "developer-tools")]
            commands::learning::learning_events_verify,
            #[cfg(all(feature = "developer-tools", feature = "learning-observation-v1"))]
            commands::learning::learning_observations_rebuild,
            #[cfg(all(feature = "developer-tools", feature = "learning-observation-v1"))]
            commands::learning::learning_observations_verify,
            #[cfg(feature = "learner-model-v1")]
            commands::learner::learner_model_get_state,
            #[cfg(feature = "learner-model-v1")]
            commands::learner::learner_model_get_review_needs,
            #[cfg(all(feature = "developer-tools", feature = "learner-model-v1"))]
            commands::learner::learner_model_rebuild,
            #[cfg(all(feature = "developer-tools", feature = "learner-model-v1"))]
            commands::learner::learner_model_verify,
            #[cfg(feature = "context-compiler-v1")]
            commands::corpus::corpus_manifest,
            #[cfg(feature = "context-compiler-v1")]
            commands::corpus::corpus_export_chunks,
            #[cfg(feature = "context-compiler-v1")]
            commands::corpus::corpus_fetch_chunks,
            #[cfg(feature = "context-compiler-v1")]
            commands::context::context_materialize,
            #[cfg(feature = "daily-dream-v1")]
            commands::journal::journal_get_daily,
            #[cfg(feature = "daily-dream-v1")]
            commands::journal::journal_rerun,
            #[cfg(feature = "daily-dream-v1")]
            commands::journal::journal_list_versions,
            #[cfg(feature = "daily-dream-v1")]
            commands::journal::dream_run_daily,
            #[cfg(feature = "daily-dream-v1")]
            commands::journal::background_job_status,
            // Round-3 audit (A3): `dream_run_weekly` is deliberately NOT
            // registered here. Weekly consolidation writes active memory and
            // supersedes supports, so it must never accept webview-supplied
            // patterns. The only entry is the host-gated sidecar reverse-RPC
            // handler, which calls `commands::journal::run_weekly_consolidation`.
            #[cfg(feature = "daily-dream-v1")]
            commands::journal::memory_record_feedback,
            #[cfg(feature = "daily-dream-v1")]
            commands::journal::consolidation_archive_stale,
            commands::settings::list_settings,
            commands::settings::upsert_setting,
            commands::settings::migrate_local_preferences,
            commands::settings::set_secret,
            commands::settings::list_secret_refs,
            commands::settings::delete_secret,
            commands::backup::create_backup,
            commands::backup::list_backups,
            commands::backup::pick_backup_import_path,
            commands::backup::import_backup_path,
            commands::writing::writing_save_draft,
            commands::writing::writing_get_draft,
            commands::writing::writing_clone_draft,
            commands::writing::writing_submit_attempt,
            commands::writing::writing_start_evaluation,
            commands::writing::writing_list_evaluation_events,
            commands::writing::writing_cancel_evaluation,
            commands::writing::writing_get_evaluation,
            commands::writing::writing_topic_list,
            commands::writing::writing_topic_get,
            commands::writing::writing_topic_upsert,
            commands::writing::writing_topic_delete,
            commands::writing::writing_topic_import,
            commands::writing::writing_topic_statistics,
            commands::writing::writing_prompt_list,
            commands::writing::writing_prompt_get,
            commands::writing::writing_prompt_upsert,
            commands::writing::writing_prompt_import,
            commands::writing::writing_prompt_activate,
            commands::writing::writing_prompt_delete,
            commands::reading::reading_list_assets,
            commands::reading::reading_pick_practice_asset,
            commands::reading::reading_get_asset_payload,
            commands::reading::reading_get_pdf_data_url,
            commands::reading::reading_export_archive,
            commands::reading::reading_import_archive,
            commands::reading::reading_save_draft,
            commands::reading::reading_get_open_draft,
            commands::reading::reading_patch_answer,
            commands::reading::reading_submit_attempt,
            commands::modes::suite_create,
            commands::modes::suite_get,
            commands::modes::suite_submit_passage,
            commands::modes::suite_save_passage_draft,
            commands::modes::suite_cancel,
            commands::modes::endless_create,
            commands::modes::endless_get,
            commands::modes::endless_save_passage_draft,
            commands::modes::endless_cancel,
            commands::modes::endless_advance,
            commands::modes::endless_submit,
            commands::modes::memorize_create,
            commands::modes::memorize_finish,
            commands::modes::timer_elapsed_seconds,
            commands::modes::timer_should_auto_submit,
            commands::enrichment::annotation_upsert,
            commands::enrichment::annotation_list,
            commands::enrichment::annotation_delete,
            commands::enrichment::annotation_revalidate,
            commands::enrichment::dictionary_lookup,
            commands::enrichment::dictionary_import,
            commands::enrichment::vocab_upsert,
            commands::enrichment::vocab_list,
            commands::enrichment::vocab_review,
            commands::enrichment::vocab_delete,
            commands::enrichment::coach_ensure_thread,
            commands::enrichment::coach_list_messages,
            commands::enrichment::coach_run,
            #[cfg(feature = "learning-observation-v1")]
            commands::coach_feedback::coach_record_feedback,
            #[cfg(feature = "learning-observation-v1")]
            commands::coach_feedback::coach_record_reask_link,
            #[cfg(feature = "learning-observation-v1")]
            commands::coach_feedback::coach_record_strategy_assignment,
            #[cfg(feature = "learning-observation-v1")]
            commands::coach_feedback::coach_link_outcome,
            #[cfg(feature = "daily-dream-v1")]
            commands::teaching_strategy::teaching_strategy_select,
            #[cfg(feature = "daily-dream-v1")]
            commands::teaching_strategy::teaching_strategy_record_assignment,
            #[cfg(feature = "daily-dream-v1")]
            commands::teaching_strategy::teaching_strategy_record_feedback,
            #[cfg(feature = "daily-dream-v1")]
            commands::teaching_strategy::teaching_strategy_record_outcome,
            #[cfg(feature = "daily-dream-v1")]
            commands::teaching_strategy::teaching_strategy_user_state,
            #[cfg(feature = "daily-dream-v1")]
            commands::teaching_strategy::teaching_strategy_record_candidate_batch,
            #[cfg(feature = "daily-dream-v1")]
            commands::teaching_strategy::teaching_strategy_record_candidate_evaluation,
            #[cfg(feature = "daily-dream-v1")]
            commands::teaching_strategy::teaching_strategy_promote_candidate,
            #[cfg(feature = "daily-dream-v1")]
            commands::prompt_skill::prompt_list_versions,
            #[cfg(feature = "daily-dream-v1")]
            commands::prompt_skill::prompt_get_active,
            #[cfg(feature = "daily-dream-v1")]
            commands::prompt_skill::prompt_propose_candidate,
            #[cfg(feature = "daily-dream-v1")]
            commands::prompt_skill::eval_run_case,
            #[cfg(feature = "daily-dream-v1")]
            commands::prompt_skill::prompt_approve_candidate,
            #[cfg(feature = "daily-dream-v1")]
            commands::prompt_skill::prompt_promote_candidate,
            #[cfg(feature = "daily-dream-v1")]
            commands::prompt_skill::prompt_rollback,
            #[cfg(feature = "daily-dream-v1")]
            commands::prompt_skill::skill_list_versions,
        ])
        .setup(|app| {
            let paths = app.state::<app::state::AppPaths>();
            let db = app.state::<app::state::AppDb>();
            let writing_catalog = app
                .path()
                .resource_dir()?
                .join("writing-topics")
                .join("bc-task2-2024-12_2025-01.catalog.json");
            let writing_seed = db
                .with_conn(|conn| ielts_db::seed_builtin_writing_catalog(conn, &writing_catalog))?;
            tracing::info!(
                declared = writing_seed.declared,
                created = writing_seed.created,
                updated = writing_seed.updated,
                unchanged = writing_seed.unchanged,
                preserved = writing_seed.preserved,
                "validated and indexed bundled writing catalog"
            );
            let reading_pack = app.path().resource_dir()?.join("reading");
            let seed_report =
                db.with_conn(|conn| ielts_db::seed_builtin_reading_pack(conn, &reading_pack))?;
            tracing::info!(
                pack_id = %seed_report.pack_id,
                assets = seed_report.imported,
                "validated and indexed bundled reading resources"
            );
            match db.with_conn(|conn| ielts_db::recover_interrupted_sessions(conn)) {
                Ok(n) if n > 0 => {
                    tracing::warn!(count = n, "marked interrupted evaluation sessions")
                }
                Ok(_) => {}
                Err(err) => tracing::error!(error = %err, "failed to recover evaluation sessions"),
            }
            match db.with_conn(ielts_db::recover_interrupted_dream_runs) {
                Ok(n) if n > 0 => {
                    tracing::warn!(count = n, "marked interrupted dream runs")
                }
                Ok(_) => {}
                Err(err) => tracing::error!(error = %err, "failed to recover dream runs"),
            }
            match db.with_conn(ielts_db::recover_interrupted_agent_runs) {
                Ok(report) if report.runs > 0 || report.tool_calls > 0 => tracing::warn!(
                    runs = report.runs,
                    tool_calls = report.tool_calls,
                    "marked interrupted Agent work"
                ),
                Ok(_) => {}
                Err(err) => tracing::error!(error = %err, "failed to recover Agent work"),
            }
            tracing::info!(
                app_data = %paths.app_data.display(),
                db = %paths.v2_db_path().display(),
                legacy_candidates = paths.legacy_candidates.len(),
                "IELTS Practice Tauri shell ready (no Fastify localhost API)"
            );
            Ok(())
        });

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building IELTS Practice Tauri application");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let runtime = app.state::<cognitive_runtime::RuntimeManager>();
            if let Err(error) = tauri::async_runtime::block_on(runtime.shutdown()) {
                tracing::warn!(%error, "failed to shut down Python cognitive runtime cleanly");
            }
        }
    });
}
