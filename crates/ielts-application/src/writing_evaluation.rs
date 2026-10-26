use ielts_db::{
    DeterministicProvider, EvaluationHandle, EvaluationRunResult, PreparedEvaluation,
    ProviderError, StartEvaluationCommand, WritingProvider,
};
use ielts_domain::domain::WritingTaskType;
use ielts_domain::dto::{WritingDiagnosisV4, WritingFeedbackV4, WritingScoreV4};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::{
    ApplicationError, ChatMessage, CompletionRequest, EventSink, LanguageModel, ModelError,
    WritingEvaluationStore,
};

#[derive(Debug)]
pub struct StartEvaluationOutcome {
    pub handle: EvaluationHandle,
    pub pending: Option<PreparedEvaluation>,
}

pub enum EvaluationBackend<M> {
    Deterministic,
    Language(M),
    Unavailable(ModelError),
}

/// Scoring must be repeatable, so it ignores the user's creativity setting.
const SCORING_TEMPERATURE: f32 = 0.1;

#[derive(Debug)]
struct ProviderOutput {
    score: WritingScoreV4,
    diagnosis: Option<WritingDiagnosisV4>,
    feedback: Result<WritingFeedbackV4, ProviderError>,
}

/// Criterion bands as the model returns them; the overall band is ours.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CriterionBands {
    task_response: f64,
    coherence: f64,
    lexical: f64,
    grammar: f64,
}

/// Facts measured locally so the model never has to count.
#[derive(Debug, PartialEq)]
struct EssayFacts {
    words: usize,
    paragraphs: usize,
    minimum_words: usize,
}

pub struct WritingEvaluationService;

impl WritingEvaluationService {
    pub fn start<S: WritingEvaluationStore, E: EventSink + ?Sized>(
        store: &S,
        command: &StartEvaluationCommand,
        provider_id: &str,
        model: &str,
        events: &E,
    ) -> Result<StartEvaluationOutcome, ApplicationError> {
        let prepared = store.prepare(command, provider_id, model)?;
        let handle = prepared.handle.clone();

        if let Some(existing) = prepared.existing.as_ref() {
            emit_all(events, existing.events.iter().cloned());
            return Ok(StartEvaluationOutcome {
                handle,
                pending: None,
            });
        }

        if let Ok(initial_events) = store.list_events(&handle.evaluation_id, 0) {
            emit_all(events, initial_events);
        }

        Ok(StartEvaluationOutcome {
            handle,
            pending: Some(prepared),
        })
    }

    pub async fn execute<S: WritingEvaluationStore, M: LanguageModel, E: EventSink + ?Sized>(
        store: &S,
        prepared: PreparedEvaluation,
        backend: EvaluationBackend<M>,
        events: &E,
    ) -> Result<EvaluationRunResult, ApplicationError> {
        let sequence = prepared.handle.sequence;
        let provider_result = match backend {
            EvaluationBackend::Deterministic => run_deterministic(&prepared),
            EvaluationBackend::Language(model) => evaluate_language_model(&model, &prepared).await,
            EvaluationBackend::Unavailable(error) => Err(error.into()),
        };

        let (score, diagnosis, feedback, review_error) = match provider_result {
            Ok(output) => match output.feedback {
                Ok(feedback) => (Ok(output.score), output.diagnosis, Some(feedback), None),
                Err(error) => (Ok(output.score), output.diagnosis, None, Some(error)),
            },
            Err(error) => (Err(error), None, None, None),
        };

        let result = store.finish(&prepared, score, diagnosis, feedback, review_error)?;
        emit_all(
            events,
            result
                .events
                .iter()
                .filter(|event| event.sequence > sequence)
                .cloned(),
        );
        Ok(result)
    }
}

fn run_deterministic(prepared: &PreparedEvaluation) -> Result<ProviderOutput, ProviderError> {
    let provider = DeterministicProvider;
    let score = provider.score(
        &prepared.essay,
        prepared.prompt.as_deref(),
        prepared.task_type,
    )?;
    let feedback = provider.review(&prepared.essay, &score);
    Ok(ProviderOutput {
        score,
        diagnosis: None,
        feedback,
    })
}

async fn evaluate_language_model<M: LanguageModel>(
    model: &M,
    prepared: &PreparedEvaluation,
) -> Result<ProviderOutput, ProviderError> {
    let response = model
        .complete(CompletionRequest {
            messages: vec![
                ChatMessage::new("system", prepared.system_prompt.clone()),
                ChatMessage::new("user", user_message(prepared)),
            ],
            temperature: SCORING_TEMPERATURE,
            max_tokens: crate::WRITING_EVALUATION_MAX_TOKENS,
            cache_key: Some(evaluation_cache_key(&prepared.system_prompt)),
        })
        .await?;
    parse_output(&response.content)
}

fn user_message(prepared: &PreparedEvaluation) -> String {
    let facts = measure_essay(&prepared.essay, prepared.task_type);
    let length = if facts.words < facts.minimum_words {
        "below the minimum, so the task criterion is limited"
    } else {
        "meets the minimum"
    };
    format!(
        "Task type: {}\nTask prompt: {}\nMeasured facts: {} words (minimum {}; {length}), {} paragraphs.\n\nEssay:\n{}",
        task_label(prepared.task_type),
        prepared.prompt.as_deref().unwrap_or("not provided"),
        facts.words,
        facts.minimum_words,
        facts.paragraphs,
        prepared.essay
    )
}

fn task_label(task_type: Option<WritingTaskType>) -> &'static str {
    match task_type {
        Some(WritingTaskType::Task1) => "IELTS Academic Writing Task 1",
        Some(WritingTaskType::Task2) => "IELTS Writing Task 2",
        None => "IELTS Writing (task not specified; assess as Task 2)",
    }
}

fn measure_essay(essay: &str, task_type: Option<WritingTaskType>) -> EssayFacts {
    let blocks = essay
        .split("\n\n")
        .filter(|block| !block.trim().is_empty())
        .count();
    let lines = essay.lines().filter(|line| !line.trim().is_empty()).count();
    EssayFacts {
        words: essay.split_whitespace().count(),
        // Many learners separate paragraphs with a single newline.
        paragraphs: if blocks > 1 { blocks } else { lines },
        minimum_words: match task_type {
            Some(WritingTaskType::Task1) => 150,
            _ => 250,
        },
    }
}

/// Same system prompt, same key: the rubric prefix is what the cache can reuse.
fn evaluation_cache_key(system_prompt: &str) -> String {
    let digest = Sha256::digest(system_prompt.as_bytes());
    let hex: String = digest
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("writing-eval-{hex}")
}

fn parse_output(content: &str) -> Result<ProviderOutput, ProviderError> {
    let trimmed = content.trim();
    let json = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed)
        .strip_suffix("```")
        .unwrap_or(trimmed)
        .trim();
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|error| provider_error(format!("AI evaluation JSON invalid: {error}"), false))?;
    let bands: CriterionBands = serde_json::from_value(
        value
            .get("score")
            .cloned()
            .ok_or_else(|| provider_error("AI evaluation score is missing", false))?,
    )
    .map_err(|error| provider_error(format!("AI evaluation score invalid: {error}"), false))?;
    let score = score_from_bands(&bands)?;
    // Diagnosis explains the score; a malformed one is dropped, never fatal.
    let diagnosis = value
        .get("diagnosis")
        .cloned()
        .and_then(|diagnosis| serde_json::from_value(diagnosis).ok());
    let feedback = value
        .get("feedback")
        .cloned()
        .ok_or_else(|| provider_error("AI evaluation feedback is missing", true))
        .and_then(|feedback| {
            serde_json::from_value(feedback).map_err(|error| {
                provider_error(format!("AI evaluation feedback invalid: {error}"), true)
            })
        });
    Ok(ProviderOutput {
        score,
        diagnosis,
        feedback,
    })
}

/// Snap each criterion to a half band and derive the overall band from them,
/// so the overall can never disagree with the criteria the learner sees.
fn score_from_bands(bands: &CriterionBands) -> Result<WritingScoreV4, ProviderError> {
    let criteria = [
        bands.task_response,
        bands.coherence,
        bands.lexical,
        bands.grammar,
    ];
    if !criteria
        .iter()
        .all(|value| value.is_finite() && (0.0..=9.0).contains(value))
    {
        return Err(provider_error(
            "AI evaluation contains an invalid band score",
            false,
        ));
    }
    let [task_response, coherence, lexical, grammar] =
        criteria.map(|value| (value * 2.0).round() / 2.0);
    let mean = (task_response + coherence + lexical + grammar) / 4.0;
    Ok(WritingScoreV4 {
        // IELTS rounds a mean ending in .25 or .75 up to the next half band.
        overall: (mean * 2.0 + 0.5 + 1e-9).floor() / 2.0,
        task_response,
        coherence,
        lexical,
        grammar,
    })
}

fn provider_error(message: impl Into<String>, retryable: bool) -> ProviderError {
    ProviderError {
        message: message.into(),
        retryable,
    }
}

fn emit_all<E: EventSink + ?Sized>(
    sink: &E,
    events: impl IntoIterator<Item = ielts_db::EvaluationEvent>,
) {
    for event in events {
        sink.emit(event);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use ielts_db::{EvaluationRunResult, EvaluationSession};
    use ielts_domain::domain::{EvaluationStage, EvaluationStatus};
    use ielts_domain::dto::WritingEvaluationV4;

    use super::*;

    #[derive(Debug, Clone)]
    struct FinishCapture {
        score: Result<WritingScoreV4, (String, bool)>,
        feedback: Option<WritingFeedbackV4>,
        review_error: Option<(String, bool)>,
    }

    struct WritingState {
        prepared: PreparedEvaluation,
        events: Vec<ielts_db::EvaluationEvent>,
        finish: Option<FinishCapture>,
        prepared_provider: Option<(String, String)>,
    }

    #[derive(Clone)]
    struct FakeWritingStore {
        state: Arc<Mutex<WritingState>>,
    }

    impl FakeWritingStore {
        fn fresh() -> Self {
            let prepared = prepared_evaluation(None);
            Self {
                state: Arc::new(Mutex::new(WritingState {
                    events: vec![event(1, EvaluationStage::Preparing)],
                    prepared,
                    finish: None,
                    prepared_provider: None,
                })),
            }
        }

        fn resumed() -> Self {
            let events = vec![
                event(1, EvaluationStage::Preparing),
                event(2, EvaluationStage::Scoring),
                event(3, EvaluationStage::Reviewing),
                event(4, EvaluationStage::Finalizing),
            ];
            let existing = completed_result(events.clone(), None, None);
            Self {
                state: Arc::new(Mutex::new(WritingState {
                    events,
                    prepared: prepared_evaluation(Some(existing)),
                    finish: None,
                    prepared_provider: None,
                })),
            }
        }
    }

    impl WritingEvaluationStore for FakeWritingStore {
        fn prepare(
            &self,
            _command: &StartEvaluationCommand,
            provider_id: &str,
            model: &str,
        ) -> Result<PreparedEvaluation, ApplicationError> {
            self.state.lock().unwrap().prepared_provider =
                Some((provider_id.to_string(), model.to_string()));
            Ok(self.state.lock().unwrap().prepared.clone())
        }

        fn list_events(
            &self,
            _evaluation_id: &str,
            after_sequence: u32,
        ) -> Result<Vec<ielts_db::EvaluationEvent>, ApplicationError> {
            Ok(self
                .state
                .lock()
                .unwrap()
                .events
                .iter()
                .filter(|event| event.sequence > after_sequence)
                .cloned()
                .collect())
        }

        fn finish(
            &self,
            prepared: &PreparedEvaluation,
            score: Result<WritingScoreV4, ProviderError>,
            _diagnosis: Option<WritingDiagnosisV4>,
            feedback: Option<WritingFeedbackV4>,
            review_error: Option<ProviderError>,
        ) -> Result<EvaluationRunResult, ApplicationError> {
            let score_capture = score
                .as_ref()
                .map(Clone::clone)
                .map_err(|error| (error.message.clone(), error.retryable));
            let review_capture = review_error
                .as_ref()
                .map(|error| (error.message.clone(), error.retryable));
            let result_score = score.ok();
            let result = completed_result(
                vec![
                    event(1, EvaluationStage::Preparing),
                    event(2, EvaluationStage::Scoring),
                    event(3, EvaluationStage::Reviewing),
                    event(4, EvaluationStage::Finalizing),
                ],
                result_score,
                feedback.clone(),
            );
            assert_eq!(prepared.evaluation_id, "evaluation-1");
            self.state.lock().unwrap().finish = Some(FinishCapture {
                score: score_capture,
                feedback,
                review_error: review_capture,
            });
            Ok(result)
        }

        fn request_cancel(&self, evaluation_id: &str) -> Result<bool, ApplicationError> {
            Ok(evaluation_id == "evaluation-1")
        }
    }

    #[derive(Default)]
    struct RecordingSink(Mutex<Vec<ielts_db::EvaluationEvent>>);

    impl EventSink for RecordingSink {
        fn emit(&self, event: ielts_db::EvaluationEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    #[derive(Clone)]
    struct FakeModel {
        response: Result<String, ModelError>,
        store_state: Option<Arc<Mutex<WritingState>>>,
    }

    #[async_trait]
    impl LanguageModel for FakeModel {
        async fn complete(
            &self,
            _request: CompletionRequest,
        ) -> Result<crate::CompletionResponse, ModelError> {
            if let Some(state) = &self.store_state {
                assert!(
                    state.try_lock().is_ok(),
                    "store lock was held during model I/O"
                );
            }
            self.response
                .clone()
                .map(|content| crate::CompletionResponse {
                    content,
                    model: "fake-model".into(),
                    latency_ms: 1,
                    usage: None,
                    provider_request_id: None,
                })
        }
    }

    #[test]
    fn replays_existing_evaluation_without_starting_another_run() {
        let store = FakeWritingStore::resumed();
        let sink = RecordingSink::default();
        let outcome = WritingEvaluationService::start(
            &store,
            &start_command(),
            "openai-compatible",
            "fake-model",
            &sink,
        )
        .unwrap();

        assert!(outcome.pending.is_none());
        assert_eq!(outcome.handle.evaluation_id, "evaluation-1");
        let sequences = sink
            .0
            .lock()
            .unwrap()
            .iter()
            .map(|event| event.sequence)
            .collect::<Vec<_>>();
        assert_eq!(sequences, vec![1, 2, 3, 4]);
    }

    #[test]
    fn prepare_keeps_the_selected_provider_snapshot() {
        let store = FakeWritingStore::fresh();
        let sink = RecordingSink::default();

        WritingEvaluationService::start(
            &store,
            &start_command(),
            "openai-compatible",
            "gpt-snapshot",
            &sink,
        )
        .unwrap();

        let snapshot = store.state.lock().unwrap().prepared_provider.clone();
        assert_eq!(
            snapshot,
            Some(("openai-compatible".to_string(), "gpt-snapshot".to_string()))
        );
    }

    #[tokio::test]
    async fn releases_store_lock_during_model_io_and_preserves_event_order() {
        let store = FakeWritingStore::fresh();
        let sink = RecordingSink::default();
        let model = FakeModel {
            response: Ok(valid_evaluation_json()),
            store_state: Some(store.state.clone()),
        };

        WritingEvaluationService::execute(
            &store,
            prepared_evaluation(None),
            EvaluationBackend::Language(model),
            &sink,
        )
        .await
        .unwrap();

        let sequences = sink
            .0
            .lock()
            .unwrap()
            .iter()
            .map(|event| event.sequence)
            .collect::<Vec<_>>();
        assert_eq!(sequences, vec![2, 3, 4]);
        assert!(store
            .state
            .lock()
            .unwrap()
            .finish
            .as_ref()
            .unwrap()
            .score
            .is_ok());
    }

    #[tokio::test]
    async fn keeps_score_when_feedback_is_invalid() {
        let store = FakeWritingStore::fresh();
        let model = FakeModel {
            response: Ok(valid_score_with_invalid_feedback()),
            store_state: None,
        };

        WritingEvaluationService::execute(
            &store,
            prepared_evaluation(None),
            EvaluationBackend::Language(model),
            &RecordingSink::default(),
        )
        .await
        .unwrap();

        let state = store.state.lock().unwrap();
        let finish = state.finish.as_ref().unwrap();
        assert!(finish.score.is_ok());
        assert!(finish.feedback.is_none());
        assert!(finish.review_error.is_some());
        assert!(finish.review_error.as_ref().unwrap().1);
    }

    #[tokio::test]
    async fn persists_model_and_json_failures() {
        for response in [
            Err(ModelError::new("request timed out", true)),
            Ok("not-json".to_string()),
        ] {
            let store = FakeWritingStore::fresh();
            let model = FakeModel {
                response,
                store_state: None,
            };
            WritingEvaluationService::execute(
                &store,
                prepared_evaluation(None),
                EvaluationBackend::Language(model),
                &RecordingSink::default(),
            )
            .await
            .unwrap();
            assert!(store
                .state
                .lock()
                .unwrap()
                .finish
                .as_ref()
                .unwrap()
                .score
                .is_err());
        }
    }

    #[tokio::test]
    async fn persists_unavailable_backend_as_provider_failure() {
        let store = FakeWritingStore::fresh();
        WritingEvaluationService::execute(
            &store,
            prepared_evaluation(None),
            EvaluationBackend::<FakeModel>::Unavailable(ModelError::new(
                "AI is not configured",
                false,
            )),
            &RecordingSink::default(),
        )
        .await
        .unwrap();

        let state = store.state.lock().unwrap();
        let error = state.finish.as_ref().unwrap().score.as_ref().unwrap_err();
        assert_eq!(error.0, "AI is not configured");
        assert!(!error.1);
    }

    #[test]
    fn parses_fenced_json() {
        let output = parse_output("```json\n{\"score\":{\"overall\":7.0,\"taskResponse\":7.0,\"coherence\":6.5,\"lexical\":7.0,\"grammar\":6.5},\"feedback\":{\"overall\":\"Clear\",\"plan\":[],\"paragraphs\":[],\"sentences\":[],\"rewrites\":[]}}\n```").unwrap();
        // mean 6.75 rounds up to 7.0
        assert_eq!(output.score.overall, 7.0);
        assert!(output.feedback.is_ok());
    }

    #[test]
    fn rejects_invalid_scores_and_malformed_json() {
        assert!(parse_output("not-json").is_err());
        assert!(parse_output("{\"score\":{\"overall\":7.0,\"taskResponse\":10.0,\"coherence\":7.0,\"lexical\":7.0,\"grammar\":7.0},\"feedback\":{\"plan\":[],\"paragraphs\":[],\"sentences\":[],\"rewrites\":[]}}").is_err());
    }

    #[test]
    fn keeps_valid_score_when_review_payload_is_invalid() {
        let output = parse_output("{\"score\":{\"overall\":7.0,\"taskResponse\":7.0,\"coherence\":6.5,\"lexical\":7.0,\"grammar\":6.5},\"feedback\":false}").unwrap();
        assert_eq!(output.score.overall, 7.0);
        assert!(output.feedback.is_err());
    }

    #[test]
    fn overall_band_is_derived_from_snapped_criteria() {
        // Model claims 8.0 overall; the criteria say otherwise.
        let output = parse_output("{\"score\":{\"overall\":8.0,\"taskResponse\":7.0,\"coherence\":6.5,\"lexical\":6.5,\"grammar\":6.0},\"feedback\":{}}").unwrap();
        assert_eq!(output.score.overall, 6.5);

        let snapped = parse_output("{\"score\":{\"taskResponse\":6.3,\"coherence\":6.0,\"lexical\":6.0,\"grammar\":6.0},\"feedback\":{}}").unwrap();
        assert_eq!(snapped.score.task_response, 6.5);
        // mean 6.125 rounds to the nearest half band, 6.0
        assert_eq!(snapped.score.overall, 6.0);

        let quarter = parse_output("{\"score\":{\"taskResponse\":7.0,\"coherence\":7.0,\"lexical\":7.0,\"grammar\":6.0},\"feedback\":{}}").unwrap();
        assert_eq!(quarter.score.overall, 7.0);

        let low_quarter = parse_output("{\"score\":{\"taskResponse\":6.0,\"coherence\":6.0,\"lexical\":6.0,\"grammar\":7.0},\"feedback\":{}}").unwrap();
        assert_eq!(low_quarter.score.overall, 6.5);
    }

    #[test]
    fn diagnosis_is_kept_and_malformed_diagnosis_is_dropped() {
        let output = parse_output("{\"diagnosis\":{\"task\":{\"position_clarity\":\"清晰\"},\"rationale\":{\"task_achievement\":\"论点展开充分\"}},\"score\":{\"taskResponse\":7.0,\"coherence\":7.0,\"lexical\":7.0,\"grammar\":7.0},\"feedback\":{}}").unwrap();
        let diagnosis = output.diagnosis.unwrap();
        assert_eq!(
            diagnosis.rationale.unwrap()["task_achievement"],
            "论点展开充分"
        );

        let malformed = parse_output("{\"diagnosis\":\"oops\",\"score\":{\"taskResponse\":7.0,\"coherence\":7.0,\"lexical\":7.0,\"grammar\":7.0},\"feedback\":{}}").unwrap();
        assert!(malformed.diagnosis.is_none());
        assert_eq!(malformed.score.overall, 7.0);
    }

    #[test]
    fn measures_words_paragraphs_and_task_minimum() {
        let facts = measure_essay(
            "One two three.\nFour five.\n\n",
            Some(WritingTaskType::Task1),
        );
        assert_eq!(
            facts,
            EssayFacts {
                words: 5,
                paragraphs: 2,
                minimum_words: 150
            }
        );
        let blocks = measure_essay("A b.\nc d.\n\nE f.", Some(WritingTaskType::Task2));
        assert_eq!(blocks.paragraphs, 2);
        assert_eq!(blocks.minimum_words, 250);
    }

    #[test]
    fn user_message_carries_measured_facts() {
        let message = user_message(&prepared_evaluation(None));
        assert!(message.contains("5 words (minimum 250; below the minimum"));
        assert!(message.contains("Discuss both views."));
    }

    #[tokio::test]
    async fn scoring_request_is_low_temperature_with_stable_cache_key() {
        #[derive(Clone, Default)]
        struct CapturingModel(Arc<Mutex<Vec<CompletionRequest>>>);

        #[async_trait]
        impl LanguageModel for CapturingModel {
            async fn complete(
                &self,
                request: CompletionRequest,
            ) -> Result<crate::CompletionResponse, ModelError> {
                self.0.lock().unwrap().push(request);
                Ok(crate::CompletionResponse {
                    content: valid_evaluation_json(),
                    model: "fake-model".into(),
                    latency_ms: 1,
                    usage: None,
                    provider_request_id: None,
                })
            }
        }

        let model = CapturingModel::default();
        let prepared = prepared_evaluation(None);
        evaluate_language_model(&model, &prepared).await.unwrap();
        evaluate_language_model(&model, &prepared).await.unwrap();
        let requests = model.0.lock().unwrap();
        assert_eq!(requests[0].temperature, SCORING_TEMPERATURE);
        assert!(requests[0].cache_key.is_some());
        assert_eq!(requests[0].cache_key, requests[1].cache_key);
    }

    fn start_command() -> StartEvaluationCommand {
        StartEvaluationCommand {
            attempt_id: "attempt-1".into(),
            idempotency_key: "idempotency-1".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        }
    }

    fn prepared_evaluation(existing: Option<EvaluationRunResult>) -> PreparedEvaluation {
        PreparedEvaluation {
            evaluation_id: "evaluation-1".into(),
            session_id: "session-1".into(),
            essay: "A sufficiently detailed IELTS essay.".into(),
            prompt: Some("Discuss both views.".into()),
            task_type: None,
            system_prompt: "Return the required JSON schema.".into(),
            temperature: 0.2,
            prompt_id: None,
            prompt_version: "prompt-v1".into(),
            handle: ielts_db::EvaluationHandle {
                attempt_id: "attempt-1".into(),
                session_id: "session-1".into(),
                evaluation_id: "evaluation-1".into(),
                status: EvaluationStatus::Queued,
                stage: EvaluationStage::Preparing,
                retry_of: None,
                sequence: 1,
            },
            existing,
        }
    }

    fn completed_result(
        events: Vec<ielts_db::EvaluationEvent>,
        score: Option<WritingScoreV4>,
        feedback: Option<WritingFeedbackV4>,
    ) -> EvaluationRunResult {
        EvaluationRunResult {
            session: EvaluationSession {
                id: "session-1".into(),
                attempt_id: "attempt-1".into(),
                evaluation_id: "evaluation-1".into(),
                status: EvaluationStatus::Completed,
                stage: EvaluationStage::Finalizing,
                revision: 1,
                sequence: 4,
                retry_of: None,
                cancel_requested: false,
                provider_id: Some("openai-compatible".into()),
                model: Some("fake-model".into()),
                started_at: "2026-08-07T00:00:00Z".into(),
                updated_at: "2026-08-07T00:00:01Z".into(),
                completed_at: Some("2026-08-07T00:00:01Z".into()),
            },
            evaluation: WritingEvaluationV4 {
                schema_version: WritingEvaluationV4::SCHEMA_VERSION,
                id: "evaluation-1".into(),
                status: EvaluationStatus::Completed,
                stage: EvaluationStage::Finalizing,
                task_type: None,
                score,
                diagnosis: None,
                feedback,
                degradation: None,
                error: None,
            },
            events,
        }
    }

    fn event(sequence: u32, stage: EvaluationStage) -> ielts_db::EvaluationEvent {
        ielts_db::EvaluationEvent {
            evaluation_id: "evaluation-1".into(),
            sequence,
            revision: 1,
            event_type: "stage".into(),
            stage: Some(stage),
            payload: serde_json::json!({ "sequence": sequence }),
            created_at: "2026-08-07T00:00:00Z".into(),
        }
    }

    fn valid_evaluation_json() -> String {
        r#"{"score":{"overall":7.0,"taskResponse":7.0,"coherence":6.5,"lexical":7.0,"grammar":6.5},"feedback":{"overall":"Clear","plan":[],"paragraphs":[],"sentences":[],"rewrites":[]}}"#.into()
    }

    fn valid_score_with_invalid_feedback() -> String {
        r#"{"score":{"overall":7.0,"taskResponse":7.0,"coherence":6.5,"lexical":7.0,"grammar":6.5},"feedback":false}"#.into()
    }
}
