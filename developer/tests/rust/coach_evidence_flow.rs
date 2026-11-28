use super::*;
use ielts_application::{
    AgentMessage, AgentModel, AgentModelFailure, AgentModelRequest, AgentModelResponse,
    AgentToolCall, TokenUsage,
};

struct ToolModel {
    captured: Arc<Mutex<Vec<AgentModelRequest>>>,
    fail_second: bool,
}
#[async_trait]
impl LanguageModel for ToolModel {
    fn identity(&self) -> (&str, &str) {
        ("fake-tools", "tools-test")
    }
    fn evidence_agent(&self) -> Option<&dyn AgentModel> {
        Some(self)
    }
    async fn complete(&self, _: CompletionRequest) -> Result<CompletionResponse, ModelError> {
        panic!("must use existing Agent transport")
    }
}
#[async_trait]
impl AgentModel for ToolModel {
    async fn respond(
        &self,
        request: AgentModelRequest,
    ) -> Result<AgentModelResponse, AgentModelFailure> {
        let mut captured = self.captured.lock().unwrap();
        captured.push(request);
        if captured.len() == 2 && self.fail_second {
            return Err(AgentModelFailure::new(ModelError::classed(
                "test timeout",
                true,
                "timeout",
            )));
        }
        Ok(AgentModelResponse {
            content: if captured.len() == 1 {
                None
            } else {
                Some(r#"{"answer":"Use the supplied official evidence."}"#.into())
            },
            tool_calls: if captured.len() == 1 {
                vec![AgentToolCall {
                    id: "read-q2".into(),
                    name: "get_question_evidence".into(),
                    arguments_json: json!({"questionIds":["q2"]}).to_string(),
                }]
            } else {
                vec![]
            },
            model: "tools-test".into(),
            latency_ms: 7,
            usage: Some(TokenUsage {
                input_tokens: 100,
                output_tokens: 20,
                ..Default::default()
            }),
            provider_request_id: None,
            retry_count: 0,
            reasoning: None,
        })
    }
}

#[tokio::test]
async fn two_rounds_keep_coach_receipts_and_bill_usage_once() {
    let (_dir, mut store, thread) = fixture();
    store.1 = true;
    let captured = Arc::new(Mutex::new(Vec::new()));
    let response = CoachService::run(
        &store,
        command(&thread, Some(json!({"focusQuestionIds":["q2"]}))),
        || {
            Ok(ToolModel {
                captured: captured.clone(),
                fail_second: false,
            })
        },
    )
    .await
    .unwrap();
    let payload = response.assistant_message.structured_payload.unwrap();
    let run = payload["runId"].as_str().unwrap();
    let requests = captured.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(requests[1]
        .messages
        .iter()
        .any(|m| matches!(m,AgentMessage::ToolResult{content,..} if content.contains("FALSE"))));
    assert!(requests
        .iter()
        .all(|r| ielts_domain::estimate_tokens(&serde_json::to_string(r).unwrap()) < 6000));
    let conn = store.0.lock().unwrap();
    let counts: (i64, i64) = conn
        .query_row(
            "SELECT rounds,tool_call_count FROM agent_runs WHERE id=?1",
            [run],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(counts, (2, 1));
    let usage = llm_usage_summary(&conn, None).unwrap();
    assert_eq!(
        (usage.calls, usage.prompt_tokens, usage.completion_tokens),
        (1, 200, 40)
    );
    let snapshots: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_context_snapshots WHERE run_id=?1",
            [run],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(snapshots, 3);
    let raw: String = conn
        .query_row(
            "SELECT rendered_context FROM agent_context_snapshots WHERE id=?1",
            [format!("context-{run}-round-2")],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&raw).unwrap(),
        serde_json::to_value(&requests[1]).unwrap()
    );
}

#[tokio::test]
async fn later_failure_keeps_first_round_usage_and_typed_timeout() {
    let (_dir, mut store, thread) = fixture();
    store.1 = true;
    let failure = CoachService::run(
        &store,
        command(&thread, Some(json!({"focusQuestionIds":["q2"]}))),
        || {
            Ok(ToolModel {
                captured: Arc::new(Mutex::new(vec![])),
                fail_second: true,
            })
        },
    )
    .await
    .unwrap_err();
    assert_eq!(failure.code, "coach.timeout");
    let conn = store.0.lock().unwrap();
    let usage = llm_usage_summary(&conn, None).unwrap();
    assert_eq!((usage.calls, usage.prompt_tokens), (1, 100));
    let running: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_runs WHERE status='running'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(running, 0);
}

struct UnsupportedTools;
#[async_trait]
impl LanguageModel for UnsupportedTools {
    fn identity(&self) -> (&str, &str) {
        ("fake-tools", "tools-test")
    }
    fn evidence_agent(&self) -> Option<&dyn AgentModel> {
        Some(self)
    }
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, ModelError> {
        assert!(request.messages[0]
            .content
            .contains("Tools are unavailable"));
        Ok(CompletionResponse {
            content: r#"{"answer":"Limited to the supplied evidence."}"#.into(),
            model: "tools-test".into(),
            latency_ms: 1,
            usage: Some(TokenUsage {
                input_tokens: 10,
                output_tokens: 2,
                ..Default::default()
            }),
            provider_request_id: None,
        })
    }
}
#[async_trait]
impl AgentModel for UnsupportedTools {
    async fn respond(&self, _: AgentModelRequest) -> Result<AgentModelResponse, AgentModelFailure> {
        Err(AgentModelFailure::new(ModelError::http_status(
            "tools is not supported",
            false,
            400,
        )))
    }
}
#[tokio::test]
async fn explicit_tool_rejection_falls_back_once_with_compact_evidence() {
    let (_dir, mut store, thread) = fixture();
    store.1 = true;
    let reply = CoachService::run(
        &store,
        command(&thread, Some(json!({"focusQuestionIds":["q2"]}))),
        || Ok(UnsupportedTools),
    )
    .await
    .unwrap();
    assert_eq!(
        reply.assistant_message.content,
        "Limited to the supplied evidence."
    );
    let conn = store.0.lock().unwrap();
    let usage = llm_usage_summary(&conn, None).unwrap();
    assert_eq!((usage.calls, usage.prompt_tokens), (1, 10));
    let rounds: i64 = conn
        .query_row("SELECT rounds FROM agent_runs", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rounds, 2);
}

struct ClosingModel(Arc<Mutex<Vec<AgentModelRequest>>>);
#[async_trait]
impl LanguageModel for ClosingModel {
    fn identity(&self) -> (&str, &str) { ("fake-tools", "tools-test") }
    fn evidence_agent(&self) -> Option<&dyn AgentModel> { Some(self) }
    async fn complete(&self, _: CompletionRequest) -> Result<CompletionResponse, ModelError> { panic!("agent required") }
}
#[async_trait]
impl AgentModel for ClosingModel {
    async fn respond(&self, request: AgentModelRequest) -> Result<AgentModelResponse, AgentModelFailure> {
        let closing = request.tools.is_empty();
        let mut captured = self.0.lock().unwrap();
        captured.push(request);
        Ok(AgentModelResponse {
            content: closing.then(|| r#"{"answer":"Evidence is limited; this is the verified part."}"#.into()),
            tool_calls: if closing { vec![] } else { vec![AgentToolCall {
                id: format!("read-{}", captured.len()), name:"get_question_evidence".into(),
                arguments_json:json!({"questionIds":["q2"]}).to_string(),
            }] }, model:"tools-test".into(),latency_ms:1,usage:None,provider_request_id:None,retry_count:0,reasoning:None,
        })
    }
}

#[tokio::test]
async fn retrieval_budget_reserves_a_final_answer_instead_of_exhausting_after_tools() {
    let (_dir, mut store, thread) = fixture();
    store.1 = true;
    let captured = Arc::new(Mutex::new(vec![]));
    let result = CoachService::run(&store, command(&thread, Some(json!({"focusQuestionIds":["q2"]}))), || Ok(ClosingModel(captured.clone()))).await.unwrap();
    assert!(result.assistant_message.content.contains("Evidence is limited"));
    let requests = captured.lock().unwrap();
    assert!((2..=4).contains(&requests.len()));
    assert!(requests.last().unwrap().tools.is_empty());
    let costs:Vec<_> = requests.iter().map(|r|ielts_domain::estimate_tokens(&serde_json::to_string(r).unwrap())).collect();
    assert!(costs.iter().all(|c|*c<=6000));
    assert!(costs.iter().sum::<u32>()<=14000);
}
