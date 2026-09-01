//! Resolve active writing prompts + temperature for evaluation (product path).

use rusqlite::Connection;
use serde_json::Value;

use ielts_domain::domain::WritingTaskType;

use crate::settings::get_setting;
use crate::sqlite::DbResult;
use crate::writing::active_writing_prompt;

/// The Settings product facade writes user preferences to `app`.
/// `model` is read-only compatibility for pre-cutover databases.
const NS_APP: &str = "app";
const NS_LEGACY_MODEL: &str = "model";

#[derive(Debug, Clone)]
pub struct ResolvedWritingEvalPolicy {
    pub system_prompt: String,
    pub temperature: f32,
    pub prompt_id: Option<String>,
    pub prompt_version: String,
}

/// Default schema instruction when no active prompt template is configured.
pub const DEFAULT_SYSTEM_PROMPT: &str = "Return JSON only with this shape: {\"score\":{\"overall\":0,\"taskResponse\":0,\"coherence\":0,\"lexical\":0,\"grammar\":0},\"feedback\":{\"overall\":\"\",\"plan\":[],\"paragraphs\":[],\"sentences\":[],\"rewrites\":[]}}. Scores must be IELTS bands from 0 to 9.";

pub fn resolve_writing_eval_policy(
    conn: &Connection,
    task_type: Option<WritingTaskType>,
) -> DbResult<ResolvedWritingEvalPolicy> {
    let prompt = resolve_active_prompt(conn, task_type)?;
    let temperature = resolve_temperature(conn, task_type)?;
    let (system_prompt, prompt_id, prompt_version) = match prompt {
        Some(p) => (p.body, Some(p.id), p.version),
        None => (DEFAULT_SYSTEM_PROMPT.to_string(), None, "prompt-v1".into()),
    };
    Ok(ResolvedWritingEvalPolicy {
        system_prompt,
        temperature,
        prompt_id,
        prompt_version,
    })
}

fn resolve_active_prompt(
    conn: &Connection,
    task_type: Option<WritingTaskType>,
) -> DbResult<Option<ielts_domain::dto::WritingPromptDto>> {
    // A custom evaluation prompt is task-specific policy.  If the caller has no
    // task type, there is no safe way to select one, so use the built-in schema
    // instruction instead of arbitrarily applying a Task 1/2 prompt.
    let Some(task_type) = task_type else {
        return Ok(None);
    };

    active_writing_prompt(conn, task_type)
}

fn resolve_temperature(conn: &Connection, task_type: Option<WritingTaskType>) -> DbResult<f32> {
    let mode = read_compatible_string_setting(conn, "temperature_mode")?
        .unwrap_or_else(|| "balanced".into())
        .to_ascii_lowercase();
    let (t1, t2) = match mode.as_str() {
        "precise" => (0.3, 0.3),
        "creative" => (0.8, 0.8),
        "custom" => (
            read_compatible_f32_setting(conn, "temperature_task1")?.unwrap_or(0.3),
            read_compatible_f32_setting(conn, "temperature_task2")?.unwrap_or(0.5),
        ),
        // balanced + unknown
        _ => (0.5, 0.5),
    };
    let temp = match task_type {
        Some(WritingTaskType::Task1) => t1,
        Some(WritingTaskType::Task2) => t2,
        None => t2,
    };
    Ok(temp.clamp(0.0, 2.0))
}

fn read_compatible_string_setting(conn: &Connection, key: &str) -> DbResult<Option<String>> {
    if let Some(value) = read_string_setting(conn, NS_APP, key)? {
        return Ok(Some(value));
    }
    read_string_setting(conn, NS_LEGACY_MODEL, key)
}

fn read_compatible_f32_setting(conn: &Connection, key: &str) -> DbResult<Option<f32>> {
    if let Some(value) = read_f32_setting(conn, NS_APP, key)? {
        return Ok(Some(value));
    }
    read_f32_setting(conn, NS_LEGACY_MODEL, key)
}

fn read_string_setting(conn: &Connection, namespace: &str, key: &str) -> DbResult<Option<String>> {
    let Some(entry) = get_setting(conn, namespace, key)? else {
        return Ok(None);
    };
    Ok(match entry.value {
        Value::String(s) => Some(s),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Null | Value::Array(_) | Value::Object(_) => None,
    })
}

fn read_f32_setting(conn: &Connection, namespace: &str, key: &str) -> DbResult<Option<f32>> {
    let Some(entry) = get_setting(conn, namespace, key)? else {
        return Ok(None);
    };
    Ok(match entry.value {
        Value::Number(n) => n.as_f64().map(|v| v as f32),
        Value::String(s) => s.parse().ok(),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::upsert_setting;
    use rusqlite::Connection;

    const LEGACY_PROMPTS_NAMESPACE: &str = "prompts";

    fn connection() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::migrate::migrate(&mut conn).unwrap();
        // These unit fixtures model an existing v8 database where prompt
        // settings predate the v9 projection migration.
        conn.execute(
            "DELETE FROM migration_meta WHERE key = 'writing_prompts.settings_v1_imported'",
            [],
        )
        .unwrap();
        conn
    }

    #[test]
    fn resolves_custom_temperature_and_active_prompt() {
        let conn = connection();
        upsert_setting(
            &conn,
            NS_APP,
            "temperature_mode",
            &Value::String("custom".into()),
        )
        .unwrap();
        upsert_setting(&conn, NS_APP, "temperature_task1", &Value::from(0.25)).unwrap();
        upsert_setting(&conn, NS_APP, "temperature_task2", &Value::from(0.75)).unwrap();
        upsert_setting(
            &conn,
            LEGACY_PROMPTS_NAMESPACE,
            "p1",
            &serde_json::json!({
                "id": "p1",
                "active": true,
                "taskType": "task2",
                "body": "You are a strict IELTS examiner."
            }),
        )
        .unwrap();

        let policy = resolve_writing_eval_policy(&conn, Some(WritingTaskType::Task2)).unwrap();
        assert!((policy.temperature - 0.75).abs() < f32::EPSILON);
        assert!(policy.system_prompt.contains("strict IELTS"));
        assert_eq!(policy.prompt_id.as_deref(), Some("p1"));
    }

    #[test]
    fn app_namespace_wins_with_legacy_model_fallback() {
        let conn = connection();
        upsert_setting(
            &conn,
            NS_LEGACY_MODEL,
            "temperature_mode",
            &Value::String("creative".into()),
        )
        .unwrap();
        let legacy = resolve_writing_eval_policy(&conn, Some(WritingTaskType::Task2)).unwrap();
        assert!((legacy.temperature - 0.8).abs() < f32::EPSILON);

        upsert_setting(
            &conn,
            NS_APP,
            "temperature_mode",
            &Value::String("precise".into()),
        )
        .unwrap();
        let canonical = resolve_writing_eval_policy(&conn, Some(WritingTaskType::Task2)).unwrap();
        assert!((canonical.temperature - 0.3).abs() < f32::EPSILON);
    }

    #[test]
    fn active_prompts_are_isolated_by_task_type() {
        let conn = connection();
        upsert_setting(
            &conn,
            LEGACY_PROMPTS_NAMESPACE,
            "task1-active",
            &serde_json::json!({
                "id": "task1-active",
                "is_active": true,
                "task_type": "task_1",
                "body": "TASK 1 POLICY"
            }),
        )
        .unwrap();
        upsert_setting(
            &conn,
            LEGACY_PROMPTS_NAMESPACE,
            "task2-active",
            &serde_json::json!({
                "id": "task2-active",
                "active": true,
                "taskType": "task2",
                "body": "TASK 2 POLICY"
            }),
        )
        .unwrap();

        let task1 = resolve_writing_eval_policy(&conn, Some(WritingTaskType::Task1)).unwrap();
        let task2 = resolve_writing_eval_policy(&conn, Some(WritingTaskType::Task2)).unwrap();

        assert_eq!(task1.prompt_id.as_deref(), Some("task1-active"));
        assert_eq!(task1.system_prompt, "TASK 1 POLICY");
        assert_eq!(task2.prompt_id.as_deref(), Some("task2-active"));
        assert_eq!(task2.system_prompt, "TASK 2 POLICY");
    }

    #[test]
    fn resolver_never_falls_back_to_another_tasks_active_prompt() {
        let conn = connection();
        upsert_setting(
            &conn,
            LEGACY_PROMPTS_NAMESPACE,
            "task1-inactive",
            &serde_json::json!({
                "id": "task1-inactive",
                "is_active": false,
                "task_type": "task1",
                "body": "INACTIVE TASK 1 POLICY"
            }),
        )
        .unwrap();
        upsert_setting(
            &conn,
            LEGACY_PROMPTS_NAMESPACE,
            "task2-active",
            &serde_json::json!({
                "id": "task2-active",
                "is_active": true,
                "task_type": "task2",
                "body": "TASK 2 POLICY"
            }),
        )
        .unwrap();

        let task1 = resolve_writing_eval_policy(&conn, Some(WritingTaskType::Task1)).unwrap();
        assert_eq!(task1.prompt_id, None);
        assert_eq!(task1.system_prompt, DEFAULT_SYSTEM_PROMPT);

        let unknown = resolve_writing_eval_policy(&conn, None).unwrap();
        assert_eq!(unknown.prompt_id, None);
        assert_eq!(unknown.system_prompt, DEFAULT_SYSTEM_PROMPT);
    }

    #[test]
    fn canonical_is_active_wins_over_a_stale_legacy_active_alias() {
        let conn = connection();
        upsert_setting(
            &conn,
            LEGACY_PROMPTS_NAMESPACE,
            "conflicting-aliases",
            &serde_json::json!({
                "id": "conflicting-aliases",
                "is_active": false,
                "active": true,
                "task_type": "task1",
                "body": "MUST NOT RUN"
            }),
        )
        .unwrap();

        let policy = resolve_writing_eval_policy(&conn, Some(WritingTaskType::Task1)).unwrap();
        assert_eq!(policy.prompt_id, None);
        assert_eq!(policy.system_prompt, DEFAULT_SYSTEM_PROMPT);
    }
}
