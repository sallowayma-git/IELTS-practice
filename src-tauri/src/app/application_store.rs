use std::sync::atomic::{AtomicBool, Ordering};

use ielts_application::{
    AgentStore, AgentThreadStore, ApplicationError, CoachFeedbackStore, CognitiveReadStore,
    ConsolidationStore, CoachStore, DreamStore,
    EventSink, JournalStore, LearnerModelAdminStore, LearnerModelStore, LearningObservationStore,
    MemoryStore, WritingEvaluationStore,
};
use ielts_db::{
    AppendCoachMessageCommand, BeginAgentRunCommand, BeginAgentToolCallCommand, CoachMessage,
    EvaluationEvent, EvaluationRunResult, FinishAgentRunCommand, FinishAgentToolCallCommand,
    PreparedEvaluation, ProviderError, RecordCoachFailureCommand, StartEvaluationCommand,
};
use ielts_domain::dto::{WritingDiagnosisV4, WritingFeedbackV4, WritingScoreV4};
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
        diagnosis: Option<WritingDiagnosisV4>,
        feedback: Option<WritingFeedbackV4>,
        review_error: Option<ProviderError>,
    ) -> Result<EvaluationRunResult, ApplicationError> {
        self.db
            .with_conn(|conn| {
                ielts_db::finish_evaluation(conn, prepared, score, diagnosis, feedback, review_error)
            })
            .map_err(writing_error)
    }

    fn request_cancel(&self, evaluation_id: &str) -> Result<bool, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::request_cancel(conn, evaluation_id))
            .map_err(writing_error)
    }

    fn cancel_requested(&self, evaluation_id: &str) -> Result<bool, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::evaluation_cancel_requested(conn, evaluation_id))
            .map_err(writing_error)
    }
}

impl CoachStore for ApplicationStore<'_> {
    fn begin_trace(&self, thread: &str, user: &str, request: &Value, provider: &str, model: &str, budget: u32) -> Result<String, ApplicationError> {
        self.db.with_conn(|conn| ielts_db::begin_coach_trace(conn, thread, user, request, provider, model, budget)).map_err(enrichment_error)
    }
    fn complete_trace(&self, run: &str, thread: &str, answer: &str, payload: Value, response: &Value) -> Result<CoachMessage, ApplicationError> {
        self.db.with_conn(|conn| ielts_db::complete_traced_coach(conn, run, thread, answer, payload, response)).map_err(enrichment_error)
    }
    fn fail_trace(&self, run: &str, error: &Value, response: Option<&Value>) -> Result<(), ApplicationError> {
        self.db.with_conn(|conn| ielts_db::fail_coach_trace(conn, run, error, response)).map_err(enrichment_error)
    }
    fn resolve_context(
        &self,
        thread_id: &str,
        selector: Option<&Value>,
    ) -> Result<ielts_db::ResolvedCoachContext, ApplicationError> {
        self.db.with_conn(|conn| ielts_db::resolve_reading_coach_context(conn, thread_id, selector))
            .map_err(enrichment_error)
    }

    fn find_completed_review(
        &self,
        thread_id: &str,
    ) -> Result<Option<ielts_db::CoachRunResult>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::find_completed_review(conn, thread_id))
            .map_err(enrichment_error)
    }

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

    fn learner_profile(
        &self,
        thread_id: &str,
    ) -> Result<ielts_db::LearnerProfileSnapshot, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::freeze_coach_learner_profile(conn, thread_id))
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

    fn reject_candidate(&self, candidate_id: &str) -> Result<(), ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::reject_pending_candidate(conn, candidate_id))
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

    fn list_explicit_preferences(
        &self,
        user_id: &str,
    ) -> Result<Vec<ielts_domain::ExplicitPreference>, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::list_explicit_preferences(conn, user_id))
            .map_err(memory_error)
    }

    fn delete_explicit_preference(
        &self,
        command: &ielts_domain::ExplicitPreferenceDelete,
    ) -> Result<bool, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::delete_explicit_preference(conn, command))
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

    fn archive_memory(
        &self,
        command: &ielts_domain::MemoryArchiveCommand,
    ) -> Result<(), ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::archive_memory(conn, command))
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
            .with_conn(|conn| ielts_db::build_fresh_daily_facts(conn, &query.user_id, &query.journal_date))
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

    fn ensure_journal(
        &self,
        query: &ielts_domain::DailyJournalQuery,
    ) -> Result<ielts_domain::DailyJournal, ApplicationError> {
        self.db
            .with_conn(|conn| ielts_db::ensure_journal(conn, &query.user_id, &query.journal_date))
            .map_err(journal_error)
    }

    fn list_journal_versions(
        &self,
        query: &ielts_domain::DailyJournalQuery,
    ) -> Result<Vec<ielts_domain::DailyJournal>, ApplicationError> {
        self.db
            .with_conn(|conn| {
                ielts_db::list_journal_versions(conn, &query.user_id, &query.journal_date)
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
}

#[cfg(feature = "daily-dream-v1")]
impl ConsolidationStore for ApplicationStore<'_> {
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
