use async_trait::async_trait;
use ielts_application::{
    AgentToolCall, AgentToolDefinition, AgentToolExecution, AgentToolExecutor,
};
use ielts_domain::{
    CompareAttemptsQuery, QuestionHistoryQuery, SearchLearningEventsQuery,
};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::app::application_store::ApplicationStore;
use crate::app::state::AppDb;

const MAX_MODEL_RESULT_BYTES: usize = 64 * 1024;

pub(crate) struct LearningReadTools<'a> {
    db: &'a AppDb,
}

impl<'a> LearningReadTools<'a> {
    pub(crate) fn new(db: &'a AppDb) -> Self {
        Self { db }
    }
}

#[async_trait]
impl AgentToolExecutor for LearningReadTools<'_> {
    fn definitions(&self) -> Vec<AgentToolDefinition> {
        vec![
            AgentToolDefinition {
                name: "get_attempt_detail".into(),
                description: "Read a compact canonical evidence view for one completed Reading attempt. Raw answers and passage content are excluded.".into(),
                parameters: object_schema(json!({
                    "attemptId": {"type":"string","minLength":1,"maxLength":256}
                }), &["attemptId"]),
            },
            AgentToolDefinition {
                name: "compare_attempts_for_asset".into(),
                description: "Compare up to ten completed attempts for one Reading asset using deterministic score, timing, and question-transition metrics.".into(),
                parameters: object_schema(json!({
                    "assetId": {"type":"string","minLength":1,"maxLength":256},
                    "limit": {"type":"integer","minimum":1,"maximum":10,"default":5},
                    "minimumGapHours": {"type":"integer","minimum":0,"maximum":8760,"default":12}
                }), &["assetId"]),
            },
            AgentToolDefinition {
                name: "get_question_history".into(),
                description: "Read bounded canonical outcome and timeline evidence for one question across attempts of one Reading asset.".into(),
                parameters: object_schema(json!({
                    "assetId": {"type":"string","minLength":1,"maxLength":256},
                    "questionId": {"type":"string","minLength":1,"maxLength":256},
                    "limit": {"type":"integer","minimum":1,"maximum":50,"default":10}
                }), &["assetId", "questionId"]),
            },
            AgentToolDefinition {
                name: "search_learning_events".into(),
                description: "Search the append-only learning evidence ledger using bounded structured filters. This tool is read-only.".into(),
                parameters: object_schema(json!({
                    "eventType": {"type":"string","maxLength":128},
                    "skillKey": {"type":"string","maxLength":256},
                    "activity": {"type":"string","enum":["reading","writing"]},
                    "occurredAfter": {"type":"string","maxLength":64},
                    "occurredBefore": {"type":"string","maxLength":64},
                    "assetId": {"type":"string","maxLength":256},
                    "attemptId": {"type":"string","maxLength":256},
                    "limit": {"type":"integer","minimum":1,"maximum":100,"default":50}
                }), &[]),
            },
            AgentToolDefinition {
                name: "get_learner_skill_state".into(),
                description: "Read a bounded learner skill-state snapshot for the current user. Returns mastery, uncertainty, trend, and review scheduling for requested skills. This tool is read-only.".into(),
                parameters: object_schema(json!({
                    "skillKeys": {"type":"array","items":{"type":"string","maxLength":256},"maxItems":100},
                    "afterSkillKey": {"type":"string","maxLength":256},
                    "limit": {"type":"integer","minimum":1,"maximum":200,"default":100}
                }), &[]),
            },
            AgentToolDefinition {
                name: "search_active_memories".into(),
                description: "Read a bounded active-memory preview for one activity. Returns only currently-active memories and explicit preferences relevant to the activity. This tool is read-only.".into(),
                parameters: object_schema(json!({
                    "activity": {"type":"string","enum":["reading","writing"]},
                    "currentInstruction": {"type":"string","maxLength":2048},
                    "limit": {"type":"integer","minimum":1,"maximum":50,"default":50}
                }), &["activity"]),
            },
            AgentToolDefinition {
                name: "get_memory_evidence".into(),
                description: "Read canonical learning-event evidence by stable IDs. Returns the upstream ledger events that ground observations and memory candidates. This tool is read-only.".into(),
                parameters: object_schema(json!({
                    "observationIds": {"type":"array","items":{"type":"string","minLength":1,"maxLength":160},"minItems":1,"maxItems":100}
                }), &["observationIds"]),
            },
        ]
    }

    fn audit_arguments(&self, call: &AgentToolCall) -> Value {
        match call.name.as_str() {
            "get_attempt_detail" => parse::<AttemptDetailArgs>(&call.arguments_json)
                .map(|args| json!({"attemptId":args.attempt_id,"valid":true}))
                .unwrap_or_else(|_| json!({"valid":false})),
            "compare_attempts_for_asset" => parse::<CompareAttemptsQuery>(&call.arguments_json)
                .map(|args| json!({"assetId":args.asset_id,"limit":args.limit,"minimumGapHours":args.minimum_gap_hours,"valid":true}))
                .unwrap_or_else(|_| json!({"valid":false})),
            "get_question_history" => parse::<QuestionHistoryQuery>(&call.arguments_json)
                .map(|args| json!({"assetId":args.asset_id,"questionId":args.question_id,"limit":args.limit,"valid":true}))
                .unwrap_or_else(|_| json!({"valid":false})),
            "search_learning_events" => parse::<SearchLearningEventsQuery>(&call.arguments_json)
                .map(|args| json!({"eventType":args.event_type,"activity":args.activity,"assetId":args.asset_id,"attemptId":args.attempt_id,"limit":args.limit,"valid":true}))
                .unwrap_or_else(|_| json!({"valid":false})),
            "get_learner_skill_state" => parse::<LearnerSkillStateArgs>(&call.arguments_json)
                .map(|args| json!({"skillKeyCount":args.skill_keys.len(),"limit":args.limit,"valid":true}))
                .unwrap_or_else(|_| json!({"valid":false})),
            "search_active_memories" => parse::<SearchActiveMemoriesArgs>(&call.arguments_json)
                .map(|args| json!({"activity":args.activity,"limit":args.limit,"valid":true}))
                .unwrap_or_else(|_| json!({"valid":false})),
            "get_memory_evidence" => parse::<MemoryEvidenceArgs>(&call.arguments_json)
                .map(|args| json!({"observationIdCount":args.observation_ids.len(),"valid":true}))
                .unwrap_or_else(|_| json!({"valid":false})),
            _ => json!({"known":false}),
        }
    }

    async fn execute(&self, call: &AgentToolCall) -> AgentToolExecution {
        match call.name.as_str() {
            "get_attempt_detail" => {
                let args: AttemptDetailArgs = match parse_or_reject(&call.arguments_json) {
                    Ok(args) => args,
                    Err(result) => return result,
                };
                let result = self
                    .db
                    .with_conn(|conn| ielts_db::get_attempt_evidence(conn, &args.attempt_id));
                encode_result(
                    "get_attempt_detail",
                    result,
                    |value| json!({"attemptId":value.attempt.attempt_id,"questionCount":value.questions.len()}),
                )
            }
            "compare_attempts_for_asset" => {
                let args: CompareAttemptsQuery = match parse_or_reject(&call.arguments_json) {
                    Ok(args) => args,
                    Err(result) => return result,
                };
                let result = self
                    .db
                    .with_conn(|conn| ielts_db::compare_attempts_for_asset(conn, &args));
                encode_result(
                    "compare_attempts_for_asset",
                    result,
                    |value| json!({"assetId":value.asset_id,"attemptCount":value.attempts.len(),"transitionCount":value.question_transitions.len()}),
                )
            }
            "get_question_history" => {
                let args: QuestionHistoryQuery = match parse_or_reject(&call.arguments_json) {
                    Ok(args) => args,
                    Err(result) => return result,
                };
                let result = self
                    .db
                    .with_conn(|conn| ielts_db::get_question_history(conn, &args));
                encode_result(
                    "get_question_history",
                    result,
                    |value| json!({"assetId":value.asset_id,"questionId":value.question_id,"observationCount":value.observations.len()}),
                )
            }
            "search_learning_events" => {
                let args: SearchLearningEventsQuery = match parse_or_reject(&call.arguments_json) {
                    Ok(args) => args,
                    Err(result) => return result,
                };
                let result = self
                    .db
                    .with_conn(|conn| ielts_db::search_learning_events(conn, &args));
                encode_result(
                    "search_learning_events",
                    result,
                    |value| json!({"eventCount":value.events.len(),"truncated":value.truncated}),
                )
            }
            "get_learner_skill_state" => {
                let args: LearnerSkillStateArgs = match parse_or_reject(&call.arguments_json) {
                    Ok(args) => args,
                    Err(result) => return result,
                };
                let store = ApplicationStore::new(self.db);
                let query = ielts_domain::LearnerStateQuery {
                    skill_keys: args.skill_keys,
                    after_skill_key: args.after_skill_key,
                    limit: args.limit,
                };
                encode_application_result(
                    "get_learner_skill_state",
                    ielts_application::LearnerModelService::new(&store).state_snapshot(&query),
                    |value| json!({"stateCount":value.states.len(),"truncated":value.truncated}),
                )
            }
            "search_active_memories" => {
                let args: SearchActiveMemoriesArgs = match parse_or_reject(&call.arguments_json) {
                    Ok(args) => args,
                    Err(result) => return result,
                };
                let store = ApplicationStore::new(self.db);
                let query = ielts_domain::MemoryContextQuery {
                    user_id: "local".into(),
                    activity: args.activity,
                    current_instruction: args.current_instruction,
                    limit: args.limit,
                };
                encode_application_result(
                    "search_active_memories",
                    ielts_application::MemoryService::new(&store).context_preview(&query),
                    |value| json!({"entryCount":value.entries.len(),"truncated":value.truncated}),
                )
            }
            "get_memory_evidence" => {
                let args: MemoryEvidenceArgs = match parse_or_reject(&call.arguments_json) {
                    Ok(args) => args,
                    Err(result) => return result,
                };
                let store = ApplicationStore::new(self.db);
                encode_application_result(
                    "get_memory_evidence",
                    ielts_application::CognitiveReadService::new(&store)
                        .learning_events_by_ids(&args.observation_ids),
                    |value| json!({"eventCount":value.events.len(),"missingCount":value.missing_ids.len()}),
                )
            }
            _ => AgentToolExecution::rejected(
                "agent.unknown_tool",
                format!("unknown AttemptReview tool: {}", call.name),
                json!({"known":false}),
            ),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AttemptDetailArgs {
    attempt_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LearnerSkillStateArgs {
    #[serde(default)]
    skill_keys: Vec<String>,
    #[serde(default)]
    after_skill_key: Option<String>,
    #[serde(default = "default_learner_limit")]
    limit: u32,
}

fn default_learner_limit() -> u32 {
    100
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SearchActiveMemoriesArgs {
    activity: ielts_domain::Activity,
    #[serde(default)]
    current_instruction: Option<String>,
    #[serde(default = "default_context_limit")]
    limit: u32,
}

fn default_context_limit() -> u32 {
    50
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MemoryEvidenceArgs {
    observation_ids: Vec<String>,
}

fn object_schema(properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false,
    })
}

fn parse<T: DeserializeOwned>(raw: &str) -> Result<T, serde_json::Error> {
    serde_json::from_str(raw)
}

fn parse_or_reject<T: DeserializeOwned>(raw: &str) -> Result<T, AgentToolExecution> {
    parse(raw).map_err(|error| {
        AgentToolExecution::rejected(
            "agent.invalid_tool_arguments",
            format!("tool arguments are invalid: {error}"),
            json!({"valid":false}),
        )
    })
}

fn encode_result<T: serde::Serialize>(
    tool_name: &str,
    result: ielts_db::DbResult<T>,
    audit: impl FnOnce(&T) -> Value,
) -> AgentToolExecution {
    let value = match result {
        Ok(value) => value,
        Err(error) => {
            return AgentToolExecution::failed(
                "agent.learning_read_failed",
                error.to_string(),
                false,
                json!({"tool":tool_name}),
            )
        }
    };
    let model_content = match serde_json::to_string(&value) {
        Ok(content) => content,
        Err(error) => {
            return AgentToolExecution::failed(
                "agent.tool_serialization_failed",
                error.to_string(),
                false,
                json!({"tool":tool_name}),
            )
        }
    };
    if model_content.len() > MAX_MODEL_RESULT_BYTES {
        return AgentToolExecution::rejected(
            "agent.tool_output_too_large",
            format!("tool output exceeds the {MAX_MODEL_RESULT_BYTES} byte limit"),
            json!({"tool":tool_name,"bytes":model_content.len(),"maxBytes":MAX_MODEL_RESULT_BYTES}),
        );
    }
    let mut audit_payload = audit(&value);
    if let Some(object) = audit_payload.as_object_mut() {
        object.insert("tool".into(), Value::String(tool_name.into()));
        object.insert("bytes".into(), json!(model_content.len()));
    }
    AgentToolExecution::succeeded(model_content, audit_payload)
}

/// M6-02: encode an `ApplicationStore`-backed result with the same bounded /
/// audit-summary / 64KiB guarantees as `encode_result`. The application-layer
/// services return `Result<T, ApplicationError>` instead of `DbResult<T>`, so
/// this helper mirrors `encode_result` over that error shape.
fn encode_application_result<T: serde::Serialize>(
    tool_name: &str,
    result: Result<T, ielts_application::ApplicationError>,
    audit: impl FnOnce(&T) -> Value,
) -> AgentToolExecution {
    let value = match result {
        Ok(value) => value,
        Err(error) => {
            return AgentToolExecution::failed(
                "agent.learning_read_failed",
                error.message,
                false,
                json!({"tool":tool_name}),
            )
        }
    };
    let model_content = match serde_json::to_string(&value) {
        Ok(content) => content,
        Err(error) => {
            return AgentToolExecution::failed(
                "agent.tool_serialization_failed",
                error.to_string(),
                false,
                json!({"tool":tool_name}),
            )
        }
    };
    if model_content.len() > MAX_MODEL_RESULT_BYTES {
        return AgentToolExecution::rejected(
            "agent.tool_output_too_large",
            format!("tool output exceeds the {MAX_MODEL_RESULT_BYTES} byte limit"),
            json!({"tool":tool_name,"bytes":model_content.len(),"maxBytes":MAX_MODEL_RESULT_BYTES}),
        );
    }
    let mut audit_payload = audit(&value);
    if let Some(object) = audit_payload.as_object_mut() {
        object.insert("tool".into(), Value::String(tool_name.into()));
        object.insert("bytes".into(), json!(model_content.len()));
    }
    AgentToolExecution::succeeded(model_content, audit_payload)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use ielts_application::AgentToolStatus;
    use ielts_db::{
        append_learning_event, migrate, open_connection, DbOpenOptions, NewLearningEvent,
    };
    use ielts_domain::LearningEventType;

    use super::*;

    fn tools() -> (tempfile::TempDir, AppDb) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("learning-tools.db");
        let mut connection = open_connection(&DbOpenOptions::create(path.clone())).unwrap();
        migrate(&mut connection).unwrap();
        (directory, AppDb::from_test_connection(connection, path))
    }

    fn call(name: &str, arguments: Value) -> AgentToolCall {
        AgentToolCall {
            id: "call-1".into(),
            name: name.into(),
            arguments_json: arguments.to_string(),
        }
    }

    #[test]
    fn registry_contains_seven_learning_reads() {
        let (_directory, db) = tools();
        let executor = LearningReadTools::new(&db);
        let names = executor
            .definitions()
            .into_iter()
            .map(|definition| definition.name)
            .collect::<BTreeSet<_>>();
        assert_eq!(
            names,
            BTreeSet::from([
                "compare_attempts_for_asset".into(),
                "get_attempt_detail".into(),
                "get_question_history".into(),
                "search_learning_events".into(),
                "get_learner_skill_state".into(),
                "search_active_memories".into(),
                "get_memory_evidence".into(),
            ])
        );
        assert!(!names.contains("write_file"));
        assert!(!names.contains("replace_in_file"));
    }

    #[tokio::test]
    async fn rejects_mutation_tools_and_unknown_arguments() {
        let (_directory, db) = tools();
        let executor = LearningReadTools::new(&db);
        let mutation = executor
            .execute(&call("write_file", json!({"path":"x","content":"y"})))
            .await;
        assert_eq!(mutation.status, AgentToolStatus::Rejected);
        assert_eq!(mutation.error.unwrap().code, "agent.unknown_tool");

        let invalid = executor
            .execute(&call(
                "get_attempt_detail",
                json!({"attemptId":"a1","extra":true}),
            ))
            .await;
        assert_eq!(invalid.status, AgentToolStatus::Rejected);
        assert_eq!(invalid.error.unwrap().code, "agent.invalid_tool_arguments");
    }

    #[tokio::test]
    async fn attempt_detail_excludes_raw_answers_and_audit_payloads_exclude_event_content() {
        let (_directory, db) = tools();
        db.with_conn(|conn| {
            conn.execute_batch(
                "INSERT INTO practice_assets(id,activity,source_kind,title,schema_version,fingerprint,pdf_only,created_at,updated_at)
                 VALUES ('asset-1','reading','imported','A',1,'fp',0,'2026-08-12T00:00:00Z','2026-08-12T00:00:00Z');
                 INSERT INTO attempts(id,activity,asset_id,mode,status,started_at,submitted_at,completed_at,duration_ms,score_value,score_scale,correct_count,question_count,schema_version,created_at,updated_at)
                 VALUES ('attempt-1','reading','asset-1','single','completed','2026-08-12T00:00:00Z','2026-08-12T00:01:00Z','2026-08-12T00:01:00Z',60000,1.0,'ratio',1,1,2,'2026-08-12T00:00:00Z','2026-08-12T00:01:00Z');
                 INSERT INTO attempt_answers(attempt_id,question_id,answer_json,is_correct,weight,change_count,visit_count,elapsed_ms,marked)
                 VALUES ('attempt-1','q1','\"RAW_ANSWER_MARKER\"',1,1,0,1,1000,0);",
            )?;
            append_learning_event(
                conn,
                NewLearningEvent {
                    event_type: LearningEventType::CoachQuestionAsked,
                    source_kind: "test".into(),
                    source_id: Some("private-marker".into()),
                    activity: None,
                    asset_id: None,
                    attempt_id: None,
                    question_id: None,
                    skill_key: None,
                    occurred_at: "2026-08-12T00:00:00Z".into(),
                    payload: json!({"marker":"PRIVATE_EVENT_MARKER"}),
                    schema_version: 1,
                    sensitivity: "private".into(),
                },
            )?;
            Ok(())
        })
        .unwrap();
        let executor = LearningReadTools::new(&db);
        let detail = executor
            .execute(&call(
                "get_attempt_detail",
                json!({"attemptId":"attempt-1"}),
            ))
            .await;
        assert_eq!(detail.status, AgentToolStatus::Succeeded);
        assert!(!detail.model_content.contains("RAW_ANSWER_MARKER"));
        assert!(!detail
            .audit_result
            .to_string()
            .contains("RAW_ANSWER_MARKER"));

        let search = executor
            .execute(&call("search_learning_events", json!({"limit":10})))
            .await;
        assert!(!search.model_content.contains("PRIVATE_EVENT_MARKER"));
        assert!(!search
            .audit_result
            .to_string()
            .contains("PRIVATE_EVENT_MARKER"));
    }

    #[tokio::test]
    async fn rejects_oversized_model_output_without_copying_it_to_audit() {
        let (_directory, db) = tools();
        let marker = "LARGE_PAYLOAD_MARKER".repeat(80);
        db.with_conn(|conn| {
            for index in 0..100 {
                append_learning_event(
                    conn,
                    NewLearningEvent {
                        event_type: LearningEventType::CoachQuestionAsked,
                        source_kind: "test".into(),
                        source_id: Some(format!("large-{index}")),
                        activity: None,
                        asset_id: None,
                        attempt_id: None,
                        question_id: None,
                        skill_key: None,
                        occurred_at: "2026-08-12T00:00:00Z".into(),
                        payload: json!({"marker":marker}),
                        schema_version: 1,
                        sensitivity: "normal".into(),
                    },
                )?;
            }
            Ok(())
        })
        .unwrap();
        let executor = LearningReadTools::new(&db);
        let result = executor
            .execute(&call("search_learning_events", json!({"limit":100})))
            .await;
        assert_eq!(result.status, AgentToolStatus::Rejected);
        assert_eq!(result.error.unwrap().code, "agent.tool_output_too_large");
        assert!(!result
            .audit_result
            .to_string()
            .contains("LARGE_PAYLOAD_MARKER"));
    }

    #[tokio::test]
    async fn m6_tools_reject_unknown_arguments_and_missing_required_fields() {
        let (_directory, db) = tools();
        let executor = LearningReadTools::new(&db);

        // get_learner_skill_state: unknown field rejected (deny_unknown_fields).
        let unknown = executor
            .execute(&call(
                "get_learner_skill_state",
                json!({"skillKeys":["reading.tfng"],"confidence":0.9}),
            ))
            .await;
        assert_eq!(unknown.status, AgentToolStatus::Rejected);
        assert_eq!(unknown.error.unwrap().code, "agent.invalid_tool_arguments");

        // search_active_memories: missing required activity.
        let missing = executor
            .execute(&call("search_active_memories", json!({"limit":10})))
            .await;
        assert_eq!(missing.status, AgentToolStatus::Rejected);
        assert_eq!(missing.error.unwrap().code, "agent.invalid_tool_arguments");

        // search_active_memories: invalid enum value.
        let invalid_enum = executor
            .execute(&call(
                "search_active_memories",
                json!({"activity":"listening"}),
            ))
            .await;
        assert_eq!(invalid_enum.status, AgentToolStatus::Rejected);
        assert_eq!(
            invalid_enum.error.unwrap().code,
            "agent.invalid_tool_arguments"
        );

        // get_memory_evidence: missing required observationIds.
        let missing_ids = executor
            .execute(&call("get_memory_evidence", json!({})))
            .await;
        assert_eq!(missing_ids.status, AgentToolStatus::Rejected);
        assert_eq!(
            missing_ids.error.unwrap().code,
            "agent.invalid_tool_arguments"
        );

        // get_memory_evidence: unknown field rejected.
        let unknown_field = executor
            .execute(&call(
                "get_memory_evidence",
                json!({"observationIds":["evt-1"],"verbose":true}),
            ))
            .await;
        assert_eq!(unknown_field.status, AgentToolStatus::Rejected);
        assert_eq!(
            unknown_field.error.unwrap().code,
            "agent.invalid_tool_arguments"
        );
    }

    #[tokio::test]
    async fn m6_tools_execute_against_empty_store_and_stay_bounded() {
        let (_directory, db) = tools();
        let executor = LearningReadTools::new(&db);

        // get_learner_skill_state on an empty learner model returns an empty snapshot.
        let skill = executor
            .execute(&call(
                "get_learner_skill_state",
                json!({"skillKeys":["reading.matching_headings"]}),
            ))
            .await;
        assert_eq!(skill.status, AgentToolStatus::Succeeded);
        let audit = skill.audit_result.as_object().unwrap();
        assert_eq!(audit["tool"], "get_learner_skill_state");
        assert_eq!(audit["stateCount"], 0);
        assert!(audit["bytes"].as_u64().unwrap() <= MAX_MODEL_RESULT_BYTES as u64);

        // search_active_memories returns an empty preview.
        let memories = executor
            .execute(&call(
                "search_active_memories",
                json!({"activity":"reading"}),
            ))
            .await;
        assert_eq!(memories.status, AgentToolStatus::Succeeded);
        let audit = memories.audit_result.as_object().unwrap();
        assert_eq!(audit["tool"], "search_active_memories");
        assert_eq!(audit["entryCount"], 0);

        // get_memory_evidence with a non-existent id returns missing_ids, not an error.
        let evidence = executor
            .execute(&call(
                "get_memory_evidence",
                json!({"observationIds":["evt-nonexistent"]}),
            ))
            .await;
        assert_eq!(evidence.status, AgentToolStatus::Succeeded);
        let audit = evidence.audit_result.as_object().unwrap();
        assert_eq!(audit["tool"], "get_memory_evidence");
        assert_eq!(audit["eventCount"], 0);
        assert_eq!(audit["missingCount"], 1);
    }
}
