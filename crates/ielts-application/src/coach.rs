use ielts_db::{
    AppendCoachMessageCommand, CoachRunResult, RecordCoachFailureCommand, RunCoachCommand,
};
use ielts_domain::{estimate_tokens, CONTEXT_HARD_TOKEN_CEILING};
use serde_json::{json, Value};

use crate::{
    ApplicationError, ChatMessage, CoachStore, CompletionRequest, LanguageModel, ModelError,
};

/// How many recent coach turns are loaded as candidate history. The store
/// returns the NEWEST `n`; the token budget below decides how many survive.
const COACH_HISTORY_MESSAGE_LIMIT: u32 = 100;

/// Round-3 audit (7.8): input budget for the assembled coach prompt. Reuses the
/// single 32k authority rather than introducing a second hardcoded number.
///
/// The output ceiling is subtracted rather than sitting alongside it: a provider
/// window bounds prompt + completion together, so budgeting the full 32k for
/// input and then asking for 2k of output requests ~34k against a 32k window and
/// is rejected by the provider, not silently truncated. Deriving it here keeps
/// the two numbers from drifting apart if either is retuned.
const COACH_INPUT_TOKEN_BUDGET: u32 =
    CONTEXT_HARD_TOKEN_CEILING.saturating_sub(COACH_OUTPUT_TOKEN_CEILING);

/// Round-3 audit (7.8): provider-side output ceiling. The coach answer is a
/// small `{"answer":"..."}` JSON document, so a tight cap is correct here. This
/// is deliberately coach-local: `ielts_domain::MAX_TOKEN_BUDGET` is dream-scoped
/// and asserted against 4000 by the Python dream contract tests.
const COACH_OUTPUT_TOKEN_CEILING: u32 = 2_000;

pub struct CoachService;

impl CoachService {
    pub async fn run<S, M, F>(
        store: &S,
        command: RunCoachCommand,
        load_model: F,
    ) -> Result<CoachRunResult, ApplicationError>
    where
        S: CoachStore,
        M: LanguageModel,
        F: FnOnce() -> Result<M, ApplicationError>,
    {
        if command.content.trim().is_empty() {
            return Err(ApplicationError::new(
                "enrichment.error",
                "content required",
                false,
            ));
        }
        let user_message = store.append_message(&AppendCoachMessageCommand {
            thread_id: command.thread_id.clone(),
            role: "user".into(),
            content: command.content.clone(),
            structured_payload: command.question_context.clone(),
            status: "completed".into(),
        })?;
        let history = store.load_history(&command.thread_id, COACH_HISTORY_MESSAGE_LIMIT)?;
        let model = match load_model() {
            Ok(model) => model,
            Err(error) => {
                record_failure(store, &command.thread_id, &error);
                return Err(error);
            }
        };

        let request = build_request(&history, command.question_context.as_ref());
        let provider_result = model
            .complete(request)
            .await
            .map_err(provider_failure)
            .and_then(|response| parse_answer(&response.content));

        match provider_result {
            Ok((answer, payload)) => {
                let assistant_message =
                    store.complete_run(&command.thread_id, &answer, Some(payload))?;
                Ok(CoachRunResult {
                    user_message,
                    assistant_message,
                })
            }
            Err(error) => {
                record_failure(store, &command.thread_id, &error);
                Err(error)
            }
        }
    }
}

fn build_request(
    history: &[ielts_db::CoachMessage],
    question_context: Option<&Value>,
) -> CompletionRequest {
    let mut messages = vec![ChatMessage::new(
        "system",
        "You are an IELTS reading coach. Explain reasoning from the supplied question context, do not invent passage facts, and never claim to change scores. Return JSON only as {\"answer\":\"...\"}.",
    )];
    if let Some(context) = question_context {
        messages.push(ChatMessage::new(
            "system",
            format!("Current IELTS question context:\n{context}"),
        ));
    }

    // Round-3 audit (7.8): the prefix above is non-droppable; history is then
    // admitted newest-first until the input budget is spent, and re-reversed so
    // the provider still sees chronological order. Trimming the OLDEST turns
    // mirrors the context materializer's truncation policy and guarantees the
    // question the user just asked always survives.
    let mut budget = COACH_INPUT_TOKEN_BUDGET.saturating_sub(
        messages
            .iter()
            .map(|message| estimate_tokens(&message.content))
            .sum::<u32>(),
    );
    let mut tail: Vec<ChatMessage> = Vec::new();
    for message in history
        .iter()
        .rev()
        .filter(|message| {
            message.status == "completed" && matches!(message.role.as_str(), "user" | "assistant")
        })
    {
        let cost = estimate_tokens(&message.content);
        if cost > budget {
            break;
        }
        budget -= cost;
        tail.push(ChatMessage::new(
            message.role.clone(),
            message.content.clone(),
        ));
    }
    tail.reverse();
    messages.extend(tail);

    CompletionRequest {
        messages,
        temperature: 0.2,
        max_tokens: Some(COACH_OUTPUT_TOKEN_CEILING),
    }
}

fn parse_answer(raw: &str) -> Result<(String, Value), ApplicationError> {
    let payload: Value = serde_json::from_str(raw).map_err(|error| {
        ApplicationError::new(
            "coach.provider_failed",
            format!("coach response JSON invalid: {error}"),
            false,
        )
    })?;
    let answer = payload
        .get("answer")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|answer| !answer.is_empty())
        .ok_or_else(|| {
            ApplicationError::new(
                "coach.provider_failed",
                "coach response missing non-empty answer",
                false,
            )
        })?;
    Ok((answer.to_string(), payload))
}

fn provider_failure(error: ModelError) -> ApplicationError {
    ApplicationError::new("coach.provider_failed", error.message, error.retryable)
}

fn record_failure<S: CoachStore>(store: &S, thread_id: &str, error: &ApplicationError) {
    let _ = store.record_failure(&RecordCoachFailureCommand {
        thread_id: thread_id.to_string(),
        error: serde_json::to_value(error).unwrap_or_else(|_| {
            json!({
                "code": error.code,
                "message": error.message,
                "retryable": error.retryable,
            })
        }),
        preserve_scores: true,
    });
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use ielts_db::{AppendCoachMessageCommand, CoachMessage, RecordCoachFailureCommand};

    use super::*;

    #[derive(Default)]
    struct CoachState {
        messages: Vec<CoachMessage>,
        failures: Vec<RecordCoachFailureCommand>,
    }

    #[derive(Clone, Default)]
    struct FakeCoachStore {
        state: Arc<Mutex<CoachState>>,
    }

    impl CoachStore for FakeCoachStore {
        fn append_message(
            &self,
            command: &AppendCoachMessageCommand,
        ) -> Result<CoachMessage, ApplicationError> {
            let mut state = self.state.lock().unwrap();
            let message = message(
                &command.thread_id,
                &command.role,
                &command.content,
                state.messages.len() as u32 + 1,
                &command.status,
                command.structured_payload.clone(),
            );
            state.messages.push(message.clone());
            Ok(message)
        }

        /// Mirrors the production contract: the NEWEST `limit` messages in
        /// chronological order. The old double ignored `limit` entirely, which
        /// is why neither the cap nor the head/tail bug was observable.
        fn load_history(
            &self,
            _thread_id: &str,
            limit: u32,
        ) -> Result<Vec<CoachMessage>, ApplicationError> {
            let messages = self.state.lock().unwrap().messages.clone();
            let start = messages.len().saturating_sub(limit as usize);
            Ok(messages[start..].to_vec())
        }

        fn complete_run(
            &self,
            thread_id: &str,
            content: &str,
            payload: Option<Value>,
        ) -> Result<CoachMessage, ApplicationError> {
            let mut state = self.state.lock().unwrap();
            let message = message(
                thread_id,
                "assistant",
                content,
                state.messages.len() as u32 + 1,
                "completed",
                payload,
            );
            state.messages.push(message.clone());
            Ok(message)
        }

        fn record_failure(
            &self,
            command: &RecordCoachFailureCommand,
        ) -> Result<(), ApplicationError> {
            self.state.lock().unwrap().failures.push(command.clone());
            Ok(())
        }
    }

    #[derive(Clone)]
    struct FakeModel {
        response: Result<String, ModelError>,
        store_state: Arc<Mutex<CoachState>>,
        request: Arc<Mutex<Option<CompletionRequest>>>,
    }

    #[async_trait]
    impl LanguageModel for FakeModel {
        async fn complete(
            &self,
            request: CompletionRequest,
        ) -> Result<crate::CompletionResponse, ModelError> {
            assert!(
                self.store_state.try_lock().is_ok(),
                "store lock was held during model I/O"
            );
            *self.request.lock().unwrap() = Some(request);
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

    #[tokio::test]
    async fn persists_user_and_assistant_messages_and_builds_context() {
        let store = FakeCoachStore::default();
        let request = Arc::new(Mutex::new(None));
        let model = FakeModel {
            response: Ok(r#"{"answer":"Check the qualifier.","kind":"hint"}"#.into()),
            store_state: store.state.clone(),
            request: request.clone(),
        };

        let result = CoachService::run(&store, command("Why?"), || Ok(model))
            .await
            .unwrap();

        assert_eq!(result.user_message.role, "user");
        assert_eq!(result.assistant_message.content, "Check the qualifier.");
        let request = request.lock().unwrap().clone().unwrap();
        assert!(request
            .messages
            .iter()
            .any(|message| message.content.contains("question-1")));
        assert_eq!(request.messages.last().unwrap().content, "Why?");
        assert!(store.state.lock().unwrap().failures.is_empty());
    }

    #[tokio::test]
    async fn rejects_empty_question_before_loading_model() {
        let store = FakeCoachStore::default();
        let error = CoachService::run::<_, FakeModel, _>(&store, command("  "), || {
            panic!("model loader must not run")
        })
        .await
        .unwrap_err();

        assert_eq!(error.code, "enrichment.error");
        assert!(store.state.lock().unwrap().messages.is_empty());
    }

    #[tokio::test]
    async fn records_invalid_and_provider_failures_without_score_mutation_permission() {
        for response in [
            Ok("not-json".to_string()),
            Ok(r#"{"answer":""}"#.to_string()),
            Err(ModelError::new("provider timeout", true)),
        ] {
            let store = FakeCoachStore::default();
            let model = FakeModel {
                response,
                store_state: store.state.clone(),
                request: Arc::new(Mutex::new(None)),
            };
            let error = CoachService::run(&store, command("Why?"), || Ok(model))
                .await
                .unwrap_err();
            assert_eq!(error.code, "coach.provider_failed");
            let state = store.state.lock().unwrap();
            assert_eq!(state.failures.len(), 1);
            assert!(state.failures[0].preserve_scores);
            assert_eq!(state.messages.len(), 1);
        }
    }

    #[tokio::test]
    async fn records_runtime_load_failure_after_persisting_user_message() {
        let store = FakeCoachStore::default();
        let error = CoachService::run::<_, FakeModel, _>(&store, command("Why?"), || {
            Err(ApplicationError::new(
                "enrichment.error",
                "AI is not configured",
                false,
            ))
        })
        .await
        .unwrap_err();

        assert_eq!(error.code, "enrichment.error");
        let state = store.state.lock().unwrap();
        assert_eq!(state.messages.len(), 1);
        assert_eq!(state.failures.len(), 1);
        assert!(state.failures[0].preserve_scores);
    }

    #[test]
    fn rejects_empty_and_non_json_answers() {
        assert!(parse_answer("not-json").is_err());
        assert!(parse_answer(r#"{"answer":""}"#).is_err());
    }

    #[test]
    fn parses_valid_answer_without_losing_payload() {
        let (answer, payload) =
            parse_answer(r#"{"answer":"Check the qualifier.","kind":"hint"}"#).unwrap();
        assert_eq!(answer, "Check the qualifier.");
        assert_eq!(payload["kind"], "hint");
    }

    fn command(content: &str) -> RunCoachCommand {
        RunCoachCommand {
            thread_id: "thread-1".into(),
            content: content.into(),
            question_context: Some(json!({ "questionId": "question-1" })),
        }
    }

    /// Round-3 audit (7.8): the assembled prompt must stay inside the input
    /// budget, and it must drop the OLDEST turns so the question the user just
    /// asked always reaches the model.
    #[test]
    fn build_request_trims_oldest_history_to_stay_within_budget() {
        // Each message is ~1 token per 4 chars; 8k chars => ~2k tokens.
        let bulk = "x".repeat(8_000);
        let history: Vec<CoachMessage> = (1..=40)
            .map(|sequence| {
                let content = if sequence == 40 {
                    "the newest question".to_string()
                } else {
                    bulk.clone()
                };
                message("thread-1", "user", &content, sequence, "completed", None)
            })
            .collect();

        let request = build_request(&history, None);
        let total: u32 = request
            .messages
            .iter()
            .map(|message| estimate_tokens(&message.content))
            .sum();

        assert!(
            total <= COACH_INPUT_TOKEN_BUDGET,
            "assembled prompt {total} exceeded budget {COACH_INPUT_TOKEN_BUDGET}"
        );
        assert!(
            request.messages.len() < history.len(),
            "oversized history must be trimmed, got all {} messages",
            request.messages.len()
        );
        assert_eq!(
            request.messages.last().unwrap().content,
            "the newest question",
            "the newest turn must survive trimming"
        );
        assert_eq!(
            request.messages.first().unwrap().role,
            "system",
            "the non-droppable system prefix must be kept"
        );
    }

    #[test]
    fn input_budget_and_output_ceiling_fit_inside_one_provider_window() {
        // Round-3 audit (7.8, residual). A provider window bounds prompt +
        // completion together. These two constants used to be independent
        // (input = the full 32k, output = 2k on top), so a full prompt asked for
        // ~34k against a 32k window — a hard provider rejection, not a silent
        // truncation. Whatever either is retuned to, their sum must stay within
        // the single authority.
        assert!(
            COACH_INPUT_TOKEN_BUDGET + COACH_OUTPUT_TOKEN_CEILING
                <= CONTEXT_HARD_TOKEN_CEILING,
            "input {COACH_INPUT_TOKEN_BUDGET} + output {COACH_OUTPUT_TOKEN_CEILING}              exceeds the {CONTEXT_HARD_TOKEN_CEILING} window"
        );
        // And the input budget must still be worth having: reserving output room
        // should not collapse it to nothing.
        assert!(COACH_INPUT_TOKEN_BUDGET > CONTEXT_HARD_TOKEN_CEILING / 2);
    }

    #[test]
    fn build_request_keeps_chronological_order_and_sets_output_ceiling() {
        let history = vec![
            message("thread-1", "user", "first", 1, "completed", None),
            message("thread-1", "assistant", "second", 2, "completed", None),
            message("thread-1", "user", "third", 3, "completed", None),
        ];

        let request = build_request(&history, None);

        let contents: Vec<&str> = request
            .messages
            .iter()
            .skip(1) // system prefix
            .map(|message| message.content.as_str())
            .collect();
        assert_eq!(contents, vec!["first", "second", "third"]);
        assert_eq!(request.max_tokens, Some(COACH_OUTPUT_TOKEN_CEILING));
    }

    #[test]
    fn build_request_skips_incomplete_and_system_history() {
        let history = vec![
            message("thread-1", "user", "kept", 1, "completed", None),
            message("thread-1", "assistant", "pending", 2, "running", None),
            message("thread-1", "system", "failure note", 3, "completed", None),
        ];

        let request = build_request(&history, None);

        let contents: Vec<&str> = request
            .messages
            .iter()
            .skip(1)
            .map(|message| message.content.as_str())
            .collect();
        assert_eq!(contents, vec!["kept"]);
    }

    fn message(
        thread_id: &str,
        role: &str,
        content: &str,
        sequence: u32,
        status: &str,
        structured_payload: Option<Value>,
    ) -> CoachMessage {
        CoachMessage {
            id: format!("message-{sequence}"),
            thread_id: thread_id.into(),
            role: role.into(),
            content: content.trim().into(),
            structured_payload,
            status: status.into(),
            sequence,
            created_at: "2026-08-07T00:00:00Z".into(),
        }
    }
}
