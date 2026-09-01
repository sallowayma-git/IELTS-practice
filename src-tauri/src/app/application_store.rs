use std::sync::atomic::{AtomicBool, Ordering};

use ielts_application::{
    AgentStore, AgentThreadStore, ApplicationError, CoachFeedbackStore, CognitiveReadStore,
    ConsolidationStore, ContextSnapshotStore, CoachStore, CorpusExportStore, DreamStore,
    EventSink, JournalStore, LearnerModelAdminStore, LearnerModelStore, LearningObservationStore,
    MemoryStore, PromptSkillStore, TeachingStrategyStore, WritingEvaluationStore,
};
use ielts_db::{
    AppendCoachMessageCommand, BeginAgentRunCommand, BeginAgentToolCallCommand, CoachMessage,
    EvaluationEvent, EvaluationRunResult, FinishAgentRunCommand, FinishAgentToolCallCommand,
    PreparedEvaluation, ProviderError, RecordCoachFailureCommand, StartEvaluationCommand,
};
use ielts_domain::dto::{WritingFeedbackV4, WritingScoreV4};
use serde_json::Value;
use tauri::ipc::Channel;

use super::state::AppDb;

pub(crate) struct ApplicationStore<'a> {
    db: &'a AppDb,
}

impl<'a> ApplicationStore<'a> {
    pub(crate) fn new(db: &'a AppDb) -> Self {
        Self { db }
    }
}

impl WritingEvaluationStore for ApplicationStore<'_> {
    fn prepare(
        &self,
        command: &StartEvaluationCommand,
        provider_id: &str,
        model: &str,
    ) -> Result<PreparedEvaluation, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::prepare_evaluation(conn, command, provider_id, model))
            .map_err(writing_error)
    }

    fn list_events(
        &self,
        evaluation_id: &str,
        after_sequence: u32,
    ) -> Result<Vec<EvaluationEvent>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::list_events(conn, evaluation_id, after_sequence))
            .map_err(writing_error)
    }

    fn finish(
        &self,
        prepared: &PreparedEvaluation,
        score: Result<WritingScoreV4, ProviderError>,
        feedback: Option<WritingFeedbackV4>,
        review_error: Option<ProviderError>,
    ) -> Result<EvaluationRunResult, ApplicationError> {
        self.db
            .with_conn(|conn| {
                ielts_db::finish_evaluation(conn, prepared, score, feedback, review_error)
            })
            .map_err(writing_error)
    }

    fn request_cancel(&self, evaluation_id: &str) -> Result<bool, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::request_cancel(conn, evaluation_id))
            .map_err(writing_error)
    }
}

impl CoachStore for ApplicationStore<'_> {
    fn append_message(
        &self,
        command: &AppendCoachMessageCommand,
    ) -> Result<CoachMessage, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::append_coach_message(conn, command))
            .map_err(enrichment_error)
    }

    fn load_history(
        &self,
        thread_id: &str,
        limit: u32,
    ) -> Result<Vec<CoachMessage>, ApplicationError> {
        self.db
            // Round-3 audit (7.8): the coach prompt needs the NEWEST turns.
            // `list_coach_messages(.., None, limit)` is an ASC cursor and would
            // return the oldest `limit` rows, dropping the question the user
            // just asked once a thread grows past it.
            .with_conn(|conn| ielts_db::list_recent_coach_messages(conn, thread_id, limit))
            .map_err(enrichment_error)
    }

    fn complete_run(
        &self,
        thread_id: &str,
        content: &str,
        payload: Option<Value>,
    ) -> Result<CoachMessage, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::complete_coach_run(conn, thread_id, content, payload))
            .map_err(enrichment_error)
    }

    fn record_failure(&self, command: &RecordCoachFailureCommand) -> Result<(), ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::record_coach_failure(conn, command))
            .map(|_| ())
            .map_err(enrichment_error)
    }
}

impl CoachFeedbackStore for ApplicationStore<'_> {
    fn record_coach_feedback(
        &self,
        command: &ielts_domain::RecordCoachFeedbackCommand,
    ) -> Result<ielts_domain::CoachFeedbackRecord, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::record_coach_feedback(conn, command))
            .map_err(coach_feedback_error)
    }

    fn record_reask_link(
        &self,
        command: &ielts_domain::RecordReaskLinkCommand,
    ) -> Result<ielts_domain::CoachReaskLinkRecord, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::record_reask_link(conn, command))
            .map_err(coach_feedback_error)
    }

    fn record_coach_strategy_assignment(
        &self,
        command: &ielts_domain::RecordCoachStrategyAssignmentCommand,
    ) -> Result<ielts_domain::CoachStrategyAssignmentRecord, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::record_coach_strategy_assignment(conn, command))
            .map_err(coach_feedback_error)
    }

    fn link_coach_outcome(
        &self,
        command: &ielts_domain::LinkCoachOutcomeCommand,
    ) -> Result<ielts_domain::CoachOutcomeLinkRecord, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::link_coach_outcome(conn, command))
            .map_err(coach_feedback_error)
    }
}

impl AgentStore for ApplicationStore<'_> {
    fn begin_run(&self, run: &BeginAgentRunCommand) -> Result<(), ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::begin_agent_run(conn, run))
            .map_err(agent_error)
    }

    fn begin_tool_call(&self, call: &BeginAgentToolCallCommand) -> Result<(), ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::begin_agent_tool_call(conn, call))
            .map_err(agent_error)
    }

    fn finish_tool_call(&self, call: &FinishAgentToolCallCommand) -> Result<(), ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::finish_agent_tool_call(conn, call))
            .map_err(agent_error)
    }

    fn finish_run(&self, run: &FinishAgentRunCommand) -> Result<(), ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::finish_agent_run(conn, run))
            .map_err(agent_error)
    }
}

impl AgentThreadStore for ApplicationStore<'_> {
    fn create_thread(
        &self,
        command: &ielts_domain::CreateThreadCommand,
    ) -> Result<ielts_domain::AgentThread, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::create_thread(conn, command))
            .map_err(agent_thread_error)
    }

    fn append_message(
        &self,
        command: &ielts_domain::AppendMessageCommand,
    ) -> Result<ielts_domain::AgentMessageRecord, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::append_message(conn, command))
            .map_err(agent_thread_error)
    }

    fn list_threads(
        &self,
        user_id: &str,
        limit: u32,
    ) -> Result<Vec<ielts_domain::AgentThread>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::list_threads(conn, user_id, limit))
            .map_err(agent_thread_error)
    }

    fn archive_thread(&self, thread_id: &str) -> Result<bool, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::archive_thread(conn, thread_id))
            .map_err(agent_thread_error)
    }

    fn list_messages(
        &self,
        thread_id: &str,
        limit: u32,
    ) -> Result<Vec<ielts_domain::AgentMessageRecord>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::list_messages(conn, thread_id, limit))
            .map_err(agent_thread_error)
    }

    fn save_checkpoint(
        &self,
        command: &ielts_domain::SaveCheckpointCommand,
    ) -> Result<ielts_domain::AgentCheckpointRecord, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::save_checkpoint(conn, command))
            .map_err(agent_thread_error)
    }

    fn load_latest_checkpoint(
        &self,
        thread_id: &str,
    ) -> Result<Option<ielts_domain::AgentCheckpointRecord>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::load_latest_checkpoint(conn, thread_id))
            .map_err(agent_thread_error)
    }

    fn request_cancel(
        &self,
        command: &ielts_domain::RequestCancelCommand,
    ) -> Result<ielts_domain::CancelOutcome, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::request_thread_cancel(conn, command))
            .map_err(agent_thread_error)
    }

    fn restart_recovery(
        &self,
    ) -> Result<ielts_domain::ThreadRecoveryReport, ApplicationError> {
        self.db
            .with_conn(ielts_db::restart_recovery)
            .map_err(agent_thread_error)
    }

    fn create_study_plan(
        &self,
        command: &ielts_domain::CreateStudyPlanCommand,
    ) -> Result<ielts_domain::StudyPlan, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::create_study_plan(conn, command))
            .map_err(agent_thread_error)
    }

    fn list_study_plan_items(
        &self,
        plan_id: &str,
    ) -> Result<Vec<ielts_domain::StudyPlanItem>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::list_study_plan_items(conn, plan_id))
            .map_err(agent_thread_error)
    }

    fn load_latest_plan(
        &self,
        user_id: &str,
    ) -> Result<Option<ielts_domain::StudyPlanSnapshot>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::load_latest_study_plan(conn, user_id))
            .map_err(agent_thread_error)
    }

    fn mark_plan_item_done(
        &self,
        command: &ielts_domain::MarkPlanItemDoneCommand,
    ) -> Result<bool, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::mark_plan_item_done(conn, command))
            .map_err(agent_thread_error)
    }

    fn record_action_approval(
        &self,
        command: &ielts_domain::RecordApprovalCommand,
    ) -> Result<ielts_domain::ActionApproval, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::record_action_approval(conn, command))
            .map_err(agent_thread_error)
    }

    fn list_pending_approvals(
        &self,
        limit: u32,
    ) -> Result<Vec<ielts_domain::ActionApproval>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::list_pending_approvals(conn, limit))
            .map_err(agent_thread_error)
    }

    fn decide_approval(
        &self,
        command: &ielts_domain::DecideApprovalCommand,
    ) -> Result<ielts_domain::ActionApproval, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::decide_approval(conn, command))
            .map_err(agent_thread_error)
    }
}

impl LearningObservationStore for ApplicationStore<'_> {
    fn rebuild_learning_observations(
        &self,
    ) -> Result<ielts_db::LearningObservationsRebuildReport, ApplicationError> {
        self.db
            .with_conn(ielts_db::learning_observations_rebuild)
            .map_err(observation_error)
    }

    fn verify_learning_observations(
        &self,
    ) -> Result<ielts_db::LearningObservationsVerifyReport, ApplicationError> {
        self.db
            .with_conn(ielts_db::learning_observations_verify)
            .map_err(observation_error)
    }
}

impl CognitiveReadStore for ApplicationStore<'_> {
    fn observation_snapshot(
        &self,
        query: &ielts_domain::ObservationSnapshotQuery,
    ) -> Result<ielts_domain::ObservationSnapshot, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::observation_snapshot(conn, query))
            .map_err(cognitive_read_error)
    }

    fn observations_by_ids(
        &self,
        ids: &[String],
    ) -> Result<ielts_domain::ObservationBatch, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::observations_by_ids(conn, ids))
            .map_err(cognitive_read_error)
    }

    fn learning_events_by_ids(
        &self,
        ids: &[String],
    ) -> Result<ielts_domain::LearningEventEvidenceBatch, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::learning_events_by_ids(conn, ids))
            .map_err(cognitive_read_error)
    }
}

#[cfg(feature = "context-compiler-v1")]
impl CorpusExportStore for ApplicationStore<'_> {
    fn corpus_manifest(&self) -> Result<ielts_domain::CorpusManifest, ApplicationError> {
        self.db
            .with_conn(ielts_db::corpus_manifest)
            .map_err(corpus_error)
    }

    fn export_chunks(
        &self,
        query: &ielts_domain::CorpusExportQuery,
    ) -> Result<ielts_domain::CorpusExportPage, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::export_corpus_chunks(conn, query))
            .map_err(corpus_error)
    }

    fn fetch_chunks(
        &self,
        query: &ielts_domain::CorpusFetchQuery,
    ) -> Result<ielts_domain::CorpusFetchResult, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::fetch_corpus_chunks(conn, query))
            .map_err(corpus_error)
    }
}

#[cfg(feature = "context-compiler-v1")]
impl ContextSnapshotStore for ApplicationStore<'_> {
    fn insert_context_snapshot(
        &self,
        manifest: &ielts_domain::ContextManifest,
        rendered_context: &str,
        query_plan_json: &serde_json::Value,
        scope: &str,
    ) -> Result<(), ApplicationError> {
        self.db
            .with_conn(|conn| {
                ielts_db::insert_context_snapshot(conn, manifest, rendered_context, query_plan_json, scope)
            })
            .map_err(corpus_error)
    }
}

impl MemoryStore for ApplicationStore<'_> {
    fn prepare_candidate_input(
        &self,
        user_id: &str,
        activity: ielts_domain::Activity,
        since: Option<String>,
        max_candidates: usize,
    ) -> Result<ielts_domain::MemoryCandidateInput, ApplicationError> {
        self.db
            .with_conn(|conn| {
                ielts_db::prepare_memory_candidate_input(
                    conn,
                    user_id,
                    activity,
                    since,
                    max_candidates,
                )
            })
            .map_err(memory_error)
    }

    fn validation_snapshot(
        &self,
        user_id: &str,
        observation_ids: &[String],
    ) -> Result<ielts_domain::MemoryValidationSnapshot, ApplicationError> {
        self.db
            .with_conn(|conn| {
                ielts_db::load_memory_validation_snapshot(conn, user_id, observation_ids)
            })
            .map_err(memory_error)
    }

    fn persist_candidate_batch(
        &self,
        input: &ielts_domain::MemoryCandidatePersistenceInput,
    ) -> Result<ielts_domain::MemoryCandidateBatchReceipt, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::persist_memory_candidate_batch(conn, input))
            .map_err(memory_error)
    }

    fn promote_candidate(
        &self,
        command: &ielts_domain::MemoryPromotionCommand,
    ) -> Result<ielts_domain::MemoryMutationReceipt, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::promote_memory_candidate(conn, command))
            .map_err(memory_error)
    }

    fn upsert_explicit_preference(
        &self,
        command: &ielts_domain::ExplicitPreferenceUpsert,
    ) -> Result<ielts_domain::ExplicitPreference, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::upsert_explicit_preference(conn, command))
            .map_err(memory_error)
    }

    fn context_preview(
        &self,
        query: &ielts_domain::MemoryContextQuery,
    ) -> Result<ielts_domain::MemoryContextPreview, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::memory_context_preview(conn, query))
            .map_err(memory_error)
    }

    fn load_catalog(
        &self,
        query: &ielts_domain::MemoryCatalogQuery,
    ) -> Result<ielts_domain::MemoryCatalog, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::load_memory_catalog(conn, query))
            .map_err(memory_error)
    }

    fn forget_memory(
        &self,
        command: &ielts_domain::MemoryForgetCommand,
    ) -> Result<(), ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::forget_memory(conn, command))
            .map_err(memory_error)
    }
}

impl LearnerModelStore for ApplicationStore<'_> {
    fn learner_state_snapshot(
        &self,
        query: &ielts_domain::LearnerStateQuery,
    ) -> Result<ielts_domain::LearnerStateSnapshot, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::learner_state_snapshot(conn, query))
            .map_err(learner_error)
    }

    fn skill_review_needs_snapshot(
        &self,
        query: &ielts_domain::SkillReviewNeedsQuery,
    ) -> Result<ielts_domain::SkillReviewNeedsSnapshot, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::skill_review_needs_snapshot(conn, query))
            .map_err(learner_error)
    }
}

impl LearnerModelAdminStore for ApplicationStore<'_> {
    fn learner_model_rebuild(
        &self,
    ) -> Result<ielts_domain::LearnerRebuildReport, ApplicationError> {
        self.db
            .with_conn(ielts_db::learner_model_rebuild)
            .map_err(learner_error)
    }

    fn learner_model_verify(
        &self,
    ) -> Result<ielts_domain::LearnerVerifyReport, ApplicationError> {
        self.db
            .with_conn(ielts_db::learner_model_verify)
            .map_err(learner_error)
    }
}

#[cfg(feature = "daily-dream-v1")]
impl JournalStore for ApplicationStore<'_> {
    fn build_facts(
        &self,
        query: &ielts_domain::DailyJournalQuery,
    ) -> Result<ielts_domain::JournalFacts, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::build_daily_facts(conn, &query.user_id, &query.journal_date))
            .map_err(journal_error)
    }

    fn insert_journal(
        &self,
        facts: &ielts_domain::JournalFacts,
        rendered_markdown: Option<&str>,
    ) -> Result<ielts_domain::DailyJournal, ApplicationError> {
        self.db
            .with_conn(|conn| {
                ielts_db::insert_journal(conn, "local", facts, rendered_markdown)
            })
            .map_err(journal_error)
    }

    fn load_latest_journal(
        &self,
        query: &ielts_domain::DailyJournalQuery,
    ) -> Result<Option<ielts_domain::DailyJournal>, ApplicationError> {
        self.db
            .with_conn(|conn| {
                ielts_db::load_latest_journal(conn, &query.user_id, &query.journal_date)
            })
            .map_err(journal_error)
    }
}

#[cfg(feature = "daily-dream-v1")]
impl DreamStore for ApplicationStore<'_> {
    fn insert_dream_run(
        &self,
        query: &ielts_domain::DailyDreamQuery,
        input_hash: Option<&str>,
    ) -> Result<ielts_domain::DreamRun, ApplicationError> {
        self.db
            .with_conn(|conn| {
                ielts_db::insert_dream_run(conn, &query.user_id, &query.journal_id, input_hash)
            })
            .map_err(dream_error)
    }

    fn insert_dream_candidate(
        &self,
        run_id: &str,
        proposal: &ielts_domain::DreamProposal,
    ) -> Result<ielts_domain::DreamCandidate, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::insert_dream_candidate(conn, run_id, proposal))
            .map_err(dream_error)
    }

    fn start_dream_run(
        &self,
        run_id: &str,
        now: &str,
    ) -> Result<ielts_domain::DreamRun, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::start_dream_run(conn, run_id, now))
            .map_err(dream_error)
    }

    fn finish_dream_run(
        &self,
        run_id: &str,
        output_hash: &str,
        now: &str,
    ) -> Result<ielts_domain::DreamRun, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::finish_dream_run(conn, run_id, output_hash, now))
            .map_err(dream_error)
    }

    fn fail_dream_run(
        &self,
        run_id: &str,
        error: &serde_json::Value,
        now: &str,
    ) -> Result<ielts_domain::DreamRun, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::fail_dream_run(conn, run_id, error, now))
            .map_err(dream_error)
    }

    fn load_daily_dream_result(
        &self,
        run_id: &str,
    ) -> Result<Option<ielts_domain::DailyDreamResult>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::load_daily_dream_result(conn, run_id))
            .map_err(dream_error)
    }
}

#[cfg(feature = "daily-dream-v1")]
impl ConsolidationStore for ApplicationStore<'_> {
    fn load_support_memories(
        &self,
        ids: &[String],
        user_id: &str,
    ) -> Result<Vec<ielts_db::SupportMemory>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::load_support_memories(conn, ids, user_id))
            .map_err(dream_error)
    }

    fn validate_patterns(
        &self,
        proposals: &[ielts_domain::PatternProposal],
        user_id: &str,
        config: &ielts_domain::ConsolidationConfig,
    ) -> Result<ielts_domain::PatternValidationReport, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::validate_patterns(conn, proposals, user_id, config))
            .map_err(dream_error)
    }

    fn apply_consolidation(
        &self,
        pattern: &ielts_domain::ValidatedPattern,
        user_id: &str,
        now: &str,
    ) -> Result<ielts_domain::ConsolidationReceipt, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::apply_consolidation(conn, pattern, user_id, now))
            .map_err(dream_error)
    }

    fn propagate_support_change(
        &self,
        memory_id: &str,
        new_status: &str,
        now: &str,
    ) -> Result<ielts_domain::SupportChangeOutcome, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::propagate_support_change(conn, memory_id, new_status, now))
            .map_err(dream_error)
    }

    fn archive_stale(
        &self,
        now: &str,
    ) -> Result<ielts_domain::StaleArchiveReport, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::archive_stale(conn, now))
            .map_err(dream_error)
    }

    fn record_memory_feedback(
        &self,
        memory_id: &str,
        kind: ielts_domain::MemoryFeedbackKind,
        user_id: &str,
        payload: &serde_json::Value,
        now: &str,
    ) -> Result<ielts_domain::MemoryFeedbackRecord, ApplicationError> {
        self.db
            .with_conn(|conn| {
                ielts_db::record_memory_feedback(conn, memory_id, kind, user_id, payload, now)
            })
            .map_err(dream_error)
    }
}

#[cfg(feature = "daily-dream-v1")]
impl TeachingStrategyStore for ApplicationStore<'_> {
    fn load_catalog(
        &self,
    ) -> Result<Vec<ielts_domain::TeachingStrategyCatalogEntry>, ApplicationError> {
        self.db
            .with_conn(ielts_db::load_catalog)
            .map_err(teaching_strategy_error)
    }

    fn load_catalog_entry(
        &self,
        strategy_id: ielts_domain::TeachingStrategyId,
    ) -> Result<Option<ielts_domain::TeachingStrategyCatalogEntry>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::load_catalog_entry(conn, strategy_id))
            .map_err(teaching_strategy_error)
    }

    fn record_strategy_assignment(
        &self,
        command: &ielts_domain::RecordStrategyAssignmentCommand,
    ) -> Result<ielts_domain::StrategyAssignmentRecord, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::record_strategy_assignment(conn, command))
            .map_err(teaching_strategy_error)
    }

    fn record_strategy_feedback(
        &self,
        command: &ielts_domain::RecordStrategyFeedbackCommand,
    ) -> Result<ielts_domain::StrategyFeedbackRecord, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::record_strategy_feedback(conn, command))
            .map_err(teaching_strategy_error)
    }

    fn record_strategy_outcome(
        &self,
        command: &ielts_domain::RecordStrategyOutcomeCommand,
    ) -> Result<ielts_domain::OutcomeAttribution, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::record_strategy_outcome(conn, command))
            .map_err(teaching_strategy_error)
    }

    fn load_user_strategy_state(
        &self,
        user_id: &str,
        strategy_id: ielts_domain::TeachingStrategyId,
        scope: &str,
    ) -> Result<Option<ielts_domain::UserStrategyState>, ApplicationError> {
        self.db
            .with_conn(|conn| {
                ielts_db::load_user_strategy_state(conn, user_id, strategy_id, scope)
            })
            .map_err(teaching_strategy_error)
    }

    fn select_strategy(
        &self,
        command: &ielts_domain::SelectStrategyCommand,
    ) -> Result<ielts_domain::StrategySelection, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::select_strategy(conn, command))
            .map_err(teaching_strategy_error)
    }

    fn record_strategy_candidate_batch(
        &self,
        command: &ielts_domain::RecordStrategyCandidateBatchCommand,
    ) -> Result<ielts_domain::StrategyCandidateBatchRecord, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::record_strategy_candidate_batch(conn, command))
            .map_err(teaching_strategy_error)
    }

    fn record_strategy_candidate_evaluation(
        &self,
        command: &ielts_domain::RecordStrategyCandidateEvaluationCommand,
    ) -> Result<ielts_domain::StrategyCandidateEvaluationRecord, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::record_strategy_candidate_evaluation(conn, command))
            .map_err(teaching_strategy_error)
    }

    fn promote_strategy_candidate(
        &self,
        command: &ielts_domain::PromoteStrategyCandidateCommand,
    ) -> Result<ielts_domain::StrategyCandidateDecision, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::promote_strategy_candidate(conn, command))
            .map_err(teaching_strategy_error)
    }
}

pub(crate) struct ChannelEventSink {
    channel: Channel<EvaluationEvent>,
    closed: AtomicBool,
}

impl ChannelEventSink {
    pub(crate) fn new(channel: Channel<EvaluationEvent>) -> Self {
        Self {
            channel,
            closed: AtomicBool::new(false),
        }
    }
}

impl EventSink for ChannelEventSink {
    fn emit(&self, event: EvaluationEvent) {
        if self.closed.load(Ordering::Relaxed) {
            return;
        }
        if let Err(error) = self.channel.send(event) {
            self.closed.store(true, Ordering::Relaxed);
            tracing::debug!(error = %error, "writing evaluation channel closed");
        }
    }
}

fn writing_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("writing.error", error.to_string(), false)
}

fn enrichment_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("enrichment.error", error.to_string(), false)
}

fn coach_feedback_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("coach.feedback_failed", error.to_string(), false)
}

fn agent_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("agent.persistence_failed", error.to_string(), false)
}

fn agent_thread_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("agent_thread.persistence_failed", error.to_string(), false)
}

fn observation_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new(
        "learning.observation_projection_failed",
        error.to_string(),
        false,
    )
}

fn cognitive_read_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("learning.cognitive_read_failed", error.to_string(), false)
}

#[cfg(feature = "context-compiler-v1")]
fn corpus_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("retrieval.corpus_export_failed", error.to_string(), false)
}

fn memory_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("memory.persistence_failed", error.to_string(), false)
}

fn learner_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("learning.learner_model_failed", error.to_string(), false)
}

#[cfg(feature = "daily-dream-v1")]
fn journal_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("journal.build_failed", error.to_string(), false)
}

#[cfg(feature = "daily-dream-v1")]
fn dream_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("dream.run_failed", error.to_string(), false)
}

#[cfg(feature = "daily-dream-v1")]
fn teaching_strategy_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("teaching.strategy_failed", error.to_string(), false)
}

#[cfg(feature = "daily-dream-v1")]
fn prompt_skill_error(error: ielts_db::DbError) -> ApplicationError {
    ApplicationError::new("prompt_skill.failed", error.to_string(), false)
}

#[cfg(feature = "daily-dream-v1")]
impl PromptSkillStore for ApplicationStore<'_> {
    fn ensure_prompt_template(
        &self,
        module: ielts_domain::PromptModule,
        description: Option<&str>,
    ) -> Result<ielts_domain::PromptTemplate, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::ensure_prompt_template(conn, module, description))
            .map_err(prompt_skill_error)
    }

    fn create_prompt_version(
        &self,
        template_id: &str,
        content_text: &str,
        prompt_metadata: &serde_json::Value,
        created_by: &str,
    ) -> Result<ielts_domain::PromptVersion, ApplicationError> {
        self.db
            .with_conn(|conn| {
                ielts_db::create_prompt_version(conn, template_id, content_text, prompt_metadata, created_by)
            })
            .map_err(prompt_skill_error)
    }

    fn list_prompt_versions(
        &self,
        module: ielts_domain::PromptModule,
    ) -> Result<Vec<ielts_domain::PromptVersion>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::list_prompt_versions(conn, module))
            .map_err(prompt_skill_error)
    }

    fn get_active_prompt_version(
        &self,
        module: ielts_domain::PromptModule,
    ) -> Result<Option<ielts_domain::PromptVersion>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::get_active_prompt_version(conn, module))
            .map_err(prompt_skill_error)
    }

    fn ensure_skill_definition(
        &self,
        skill_name: ielts_domain::SkillName,
        description: Option<&str>,
    ) -> Result<ielts_domain::SkillDefinition, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::ensure_skill_definition(conn, skill_name, description))
            .map_err(prompt_skill_error)
    }

    fn create_skill_version(
        &self,
        skill_definition_id: &str,
        definition: &serde_json::Value,
        created_by: &str,
    ) -> Result<ielts_domain::SkillVersion, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::create_skill_version(conn, skill_definition_id, definition, created_by))
            .map_err(prompt_skill_error)
    }

    fn list_skill_versions(
        &self,
        skill_name: ielts_domain::SkillName,
    ) -> Result<Vec<ielts_domain::SkillVersion>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::list_skill_versions(conn, skill_name))
            .map_err(prompt_skill_error)
    }

    fn insert_eval_case(
        &self,
        case_kind: ielts_domain::EvalCaseKind,
        input: &serde_json::Value,
        expected: &serde_json::Value,
        holdout: bool,
    ) -> Result<ielts_domain::EvalCase, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::insert_eval_case(conn, case_kind, input, expected, holdout))
            .map_err(prompt_skill_error)
    }

    fn list_eval_cases(&self, include_holdout: bool) -> Result<Vec<ielts_domain::EvalCase>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::list_eval_cases(conn, include_holdout))
            .map_err(prompt_skill_error)
    }

    fn propose_candidate(
        &self,
        command: &ielts_domain::ProposeCandidateCommand,
    ) -> Result<ielts_domain::CandidatePromotion, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::propose_candidate(conn, command))
            .map_err(prompt_skill_error)
    }

    fn run_eval(&self, command: &ielts_domain::RunEvalCommand) -> Result<ielts_domain::EvalRunOutcome, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::run_eval(conn, command))
            .map_err(prompt_skill_error)
    }

    fn approve_candidate(
        &self,
        command: &ielts_domain::ApproveCandidateCommand,
    ) -> Result<ielts_domain::CandidatePromotion, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::approve_candidate(conn, command))
            .map_err(prompt_skill_error)
    }

    fn promote_candidate(
        &self,
        command: &ielts_domain::PromoteCandidateCommand,
    ) -> Result<ielts_domain::CandidateDecision, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::promote_candidate(conn, command))
            .map_err(prompt_skill_error)
    }

    fn rollback_version(
        &self,
        command: &ielts_domain::RollbackCommand,
    ) -> Result<ielts_domain::RollbackOutcome, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::rollback_version(conn, command))
            .map_err(prompt_skill_error)
    }

    fn record_shadow_run(
        &self,
        candidate_id: &str,
        input_hash: &str,
        output_diff: &serde_json::Value,
        no_user_visible_side_effect: bool,
    ) -> Result<(), ApplicationError> {
        self.db
            .with_conn(|conn| {
                ielts_db::record_shadow_run(conn, candidate_id, input_hash, output_diff, no_user_visible_side_effect)
            })
            .map_err(prompt_skill_error)
    }
}
