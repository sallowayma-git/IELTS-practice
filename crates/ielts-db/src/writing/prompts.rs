//! Rust-owned writing evaluation prompt policy.
//!
//! Generic settings were an expedient migration bridge, but they cannot
//! enforce the one-active-prompt-per-task invariant. This aggregate owns that
//! rule in SQLite. Legacy settings remain untouched as recoverable source data;
//! a committed marker makes the bridge one-shot, so a user deletion cannot be
//! resurrected from the old namespace later.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use ielts_domain::domain::WritingTaskType;
use ielts_domain::dto::{
    ImportWritingPromptsCommand, UpsertWritingPromptCommand, WritingPromptDto,
    WritingPromptImportReport,
};

use crate::attempts::writing_task_type_str;
use crate::sqlite::{DbError, DbResult};

const LEGACY_MIGRATION_KEY: &str = "writing_prompts.settings_v1_imported";
const LEGACY_PROMPTS_NAMESPACE: &str = "prompts";
const MAX_PROMPT_ID_LEN: usize = 160;
const MAX_PROMPT_VERSION_LEN: usize = 160;
const MAX_PROMPT_BODY_LEN: usize = 256 * 1024;
const MAX_IMPORT_PROMPTS: usize = 500;

#[derive(Debug)]
struct LegacyPromptRow {
    key: String,
    value_json: String,
    updated_at: String,
}

#[derive(Debug)]
struct LegacyPrompt {
    id: String,
    task_type: WritingTaskType,
    version: String,
    body: String,
    is_active: bool,
    updated_at: String,
}

#[derive(Debug)]
struct PreparedPrompt {
    id: String,
    task_type: WritingTaskType,
    version: String,
    body: String,
    requested_active: Option<bool>,
}

/// Project historic `settings/prompts` rows into `writing_prompts` once.
///
/// The migration happens after schema v9 exists and is transactional. It does
/// not delete, rewrite, or use legacy settings after the marker commits. That
/// is both lossless (old backups remain byte-for-byte recoverable) and stops
/// a later canonical delete from being silently undone by stale KV data.
pub fn migrate_legacy_writing_prompts(conn: &Connection) -> DbResult<()> {
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    migrate_legacy_writing_prompts_in_transaction(&tx)?;
    tx.commit()?;
    Ok(())
}

/// Transaction-aware form used by snapshot restore. The backup layer already
/// owns the atomic restore transaction, so opening another one here would
/// either fail or split an otherwise all-or-nothing import.
pub fn migrate_legacy_writing_prompts_in_transaction(tx: &Transaction<'_>) -> DbResult<()> {
    let marker: Option<String> = tx
        .query_row(
            "SELECT value FROM migration_meta WHERE key = ?1",
            params![LEGACY_MIGRATION_KEY],
            |row| row.get(0),
        )
        .optional()?;
    if marker.is_some() {
        return Ok(());
    }

    let rows = load_legacy_rows(tx)?;
    if rows.is_empty() {
        tx.execute(
            "INSERT INTO migration_meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![
                LEGACY_MIGRATION_KEY,
                json!({ "version": 1, "legacyRows": 0, "imported": 0, "skipped": 0 }).to_string()
            ],
        )?;
        return Ok(());
    }

    let mut imported = 0u32;
    let mut skipped = 0u32;
    let mut active_tasks = active_task_types(tx)?;
    let prompts = rows
        .iter()
        .flat_map(legacy_prompt_candidates)
        .collect::<Vec<_>>();
    let active_winners = active_winner_ids(&prompts);

    for prompt in prompts {
        if prompt_exists(tx, &prompt.id)? {
            // A canonical row already owns this ID. Keep the old record in
            // settings rather than overwrite a newer Rust-owned decision.
            skipped += 1;
            continue;
        }
        let should_activate = prompt.is_active
            && active_winners
                .get(&prompt.task_type)
                .is_some_and(|id| id == &prompt.id)
            && !active_tasks.contains(&prompt.task_type);
        tx.execute(
            "INSERT INTO writing_prompts (
                id, task_type, version, body, is_active, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![
                prompt.id,
                writing_task_type_str(prompt.task_type),
                prompt.version,
                prompt.body,
                should_activate as i64,
                prompt.updated_at,
            ],
        )?;
        if should_activate {
            active_tasks.insert(prompt.task_type);
        }
        imported += 1;
    }

    let marker = json!({
        "version": 1,
        "legacyRows": rows.len(),
        "imported": imported,
        "skipped": skipped,
    })
    .to_string();
    tx.execute(
        "INSERT INTO migration_meta(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![LEGACY_MIGRATION_KEY, marker],
    )?;
    Ok(())
}

pub fn list_writing_prompts(
    conn: &Connection,
    task_type: Option<WritingTaskType>,
) -> DbResult<Vec<WritingPromptDto>> {
    migrate_legacy_writing_prompts(conn)?;
    let mut prompts = Vec::new();
    if let Some(task_type) = task_type {
        let mut stmt = conn.prepare(
            "SELECT id, task_type, version, body, is_active, created_at, updated_at
             FROM writing_prompts WHERE task_type = ?1
             ORDER BY is_active DESC, updated_at DESC, id ASC",
        )?;
        let rows = stmt.query_map(params![writing_task_type_str(task_type)], map_prompt_row)?;
        for row in rows {
            prompts.push(row?);
        }
    } else {
        let mut stmt = conn.prepare(
            "SELECT id, task_type, version, body, is_active, created_at, updated_at
             FROM writing_prompts ORDER BY task_type ASC, is_active DESC, updated_at DESC, id ASC",
        )?;
        let rows = stmt.query_map([], map_prompt_row)?;
        for row in rows {
            prompts.push(row?);
        }
    }
    Ok(prompts)
}

pub fn get_writing_prompt(conn: &Connection, id: &str) -> DbResult<Option<WritingPromptDto>> {
    migrate_legacy_writing_prompts(conn)?;
    load_prompt_by_id(conn, validate_id(id)?)
}

pub fn active_writing_prompt(
    conn: &Connection,
    task_type: WritingTaskType,
) -> DbResult<Option<WritingPromptDto>> {
    migrate_legacy_writing_prompts(conn)?;
    conn.query_row(
        "SELECT id, task_type, version, body, is_active, created_at, updated_at
         FROM writing_prompts WHERE task_type = ?1 AND is_active = 1",
        params![writing_task_type_str(task_type)],
        map_prompt_row,
    )
    .optional()
    .map_err(Into::into)
}

pub fn upsert_writing_prompt(
    conn: &Connection,
    command: &UpsertWritingPromptCommand,
) -> DbResult<WritingPromptDto> {
    let report = import_writing_prompts(
        conn,
        &ImportWritingPromptsCommand {
            prompts: vec![command.clone()],
        },
    )?;
    report
        .items
        .into_iter()
        .next()
        .ok_or_else(|| DbError::Message("writing prompt upsert returned no item".into()))
}

pub fn import_writing_prompts(
    conn: &Connection,
    cmd: &ImportWritingPromptsCommand,
) -> DbResult<WritingPromptImportReport> {
    migrate_legacy_writing_prompts(conn)?;
    let prepared = prepare_prompts(&cmd.prompts)?;
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let now = chrono::Utc::now().to_rfc3339();
    let mut created = 0u32;
    let mut updated = 0u32;
    let mut items = Vec::with_capacity(prepared.len());

    for prompt in &prepared {
        let existing: Option<(String, String, i64)> = tx
            .query_row(
                "SELECT task_type, version, is_active FROM writing_prompts WHERE id = ?1",
                params![prompt.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        if let Some((task_type, _, _)) = existing.as_ref() {
            if task_type != writing_task_type_str(prompt.task_type) {
                return Err(DbError::Validation(
                    "writing prompt task type cannot change after creation".into(),
                ));
            }
            updated += 1;
        } else {
            created += 1;
        }

        let is_active = prompt
            .requested_active
            .unwrap_or_else(|| existing.as_ref().is_some_and(|(_, _, active)| *active != 0));
        if is_active {
            tx.execute(
                "UPDATE writing_prompts SET is_active = 0, updated_at = ?1
                 WHERE task_type = ?2 AND id != ?3 AND is_active = 1",
                params![now, writing_task_type_str(prompt.task_type), prompt.id],
            )?;
        }

        tx.execute(
            "INSERT INTO writing_prompts (
                id, task_type, version, body, is_active, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT(id) DO UPDATE SET
               version = excluded.version,
               body = excluded.body,
               is_active = excluded.is_active,
               updated_at = excluded.updated_at",
            params![
                prompt.id,
                writing_task_type_str(prompt.task_type),
                prompt.version,
                prompt.body,
                is_active as i64,
                now,
            ],
        )?;
        items.push(
            load_prompt_by_id(&tx, &prompt.id)?.ok_or_else(|| {
                DbError::Message("writing prompt disappeared during import".into())
            })?,
        );
    }

    tx.commit()?;
    Ok(WritingPromptImportReport {
        created,
        updated,
        items,
    })
}

pub fn activate_writing_prompt(conn: &Connection, id: &str) -> DbResult<WritingPromptDto> {
    migrate_legacy_writing_prompts(conn)?;
    let id = validate_id(id)?;
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let task_type: String = tx
        .query_row(
            "SELECT task_type FROM writing_prompts WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| DbError::Validation(format!("writing prompt not found: {id}")))?;
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "UPDATE writing_prompts SET is_active = 0, updated_at = ?1
         WHERE task_type = ?2 AND is_active = 1",
        params![now, task_type],
    )?;
    tx.execute(
        "UPDATE writing_prompts SET is_active = 1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )?;
    let prompt = load_prompt_by_id(&tx, id)?
        .ok_or_else(|| DbError::Message("writing prompt disappeared during activation".into()))?;
    tx.commit()?;
    Ok(prompt)
}

pub fn delete_writing_prompt(conn: &Connection, id: &str) -> DbResult<bool> {
    migrate_legacy_writing_prompts(conn)?;
    let id = validate_id(id)?;
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let deleted = tx.execute("DELETE FROM writing_prompts WHERE id = ?1", params![id])?;
    tx.commit()?;
    Ok(deleted > 0)
}

fn load_legacy_rows(conn: &Connection) -> DbResult<Vec<LegacyPromptRow>> {
    let mut stmt = conn.prepare(
        "SELECT key, value_json, updated_at FROM settings
         WHERE namespace = ?1 ORDER BY updated_at DESC, key ASC",
    )?;
    let rows = stmt.query_map(params![LEGACY_PROMPTS_NAMESPACE], |row| {
        Ok(LegacyPromptRow {
            key: row.get(0)?,
            value_json: row.get(1)?,
            updated_at: row.get(2)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

fn legacy_prompt_candidates(row: &LegacyPromptRow) -> Vec<LegacyPrompt> {
    let value = serde_json::from_str::<Value>(&row.value_json).unwrap_or(Value::Null);
    let value = match value {
        Value::String(raw) => serde_json::from_str::<Value>(&raw).unwrap_or(Value::String(raw)),
        other => other,
    };
    let candidates = match value {
        Value::Array(values) => values
            .into_iter()
            .enumerate()
            .map(|(index, value)| (legacy_fallback_id(&row.key, index, &value), value))
            .collect(),
        Value::Object(mut object) if object.get("prompts").is_some_and(Value::is_array) => object
            .remove("prompts")
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            .enumerate()
            .map(|(index, value)| (legacy_fallback_id(&row.key, index, &value), value))
            .collect(),
        other => vec![(legacy_fallback_id(&row.key, 0, &other), other)],
    };
    candidates
        .into_iter()
        .filter_map(|(fallback_id, value)| {
            parse_legacy_prompt(&fallback_id, &value, &row.updated_at)
        })
        .collect()
}

fn parse_legacy_prompt(fallback_id: &str, value: &Value, updated_at: &str) -> Option<LegacyPrompt> {
    let object = value.as_object()?;
    let requested_id = object
        .get("id")
        .or_else(|| object.get("promptId"))
        .and_then(value_text)
        .unwrap_or_else(|| fallback_id.to_string());
    let id = validate_id(&requested_id)
        .map(str::to_owned)
        .unwrap_or_else(|_| fallback_id.to_string());
    let task_type = ["task_type", "taskType", "type"]
        .into_iter()
        .find_map(|key| object.get(key).and_then(value_text))
        .and_then(|value| WritingTaskType::parse_loose(&value))?;
    let body = prompt_body(value)?;
    let requested_version = ["version", "promptVersion", "prompt_version"]
        .into_iter()
        .find_map(|key| object.get(key).and_then(value_text));
    let version = normalize_version(requested_version.as_deref(), &id)
        .unwrap_or_else(|_| format!("prompt-{id}"));
    let is_active = object
        .get("is_active")
        .and_then(Value::as_bool)
        .or_else(|| object.get("isActive").and_then(Value::as_bool))
        .or_else(|| object.get("active").and_then(Value::as_bool))
        .unwrap_or(false);
    Some(LegacyPrompt {
        id,
        task_type,
        version,
        body,
        is_active,
        updated_at: updated_at.to_string(),
    })
}

fn active_winner_ids(prompts: &[LegacyPrompt]) -> HashMap<WritingTaskType, String> {
    let mut winners: HashMap<WritingTaskType, &LegacyPrompt> = HashMap::new();
    for prompt in prompts.iter().filter(|prompt| prompt.is_active) {
        let replace = match winners.get(&prompt.task_type) {
            None => true,
            Some(current) => {
                prompt.updated_at > current.updated_at
                    || (prompt.updated_at == current.updated_at && prompt.id < current.id)
            }
        };
        if replace {
            winners.insert(prompt.task_type, prompt);
        }
    }
    winners
        .into_iter()
        .map(|(task_type, prompt)| (task_type, prompt.id.clone()))
        .collect()
}

fn prepare_prompts(commands: &[UpsertWritingPromptCommand]) -> DbResult<Vec<PreparedPrompt>> {
    if commands.is_empty() {
        return Err(DbError::Validation("writing prompt import is empty".into()));
    }
    if commands.len() > MAX_IMPORT_PROMPTS {
        return Err(DbError::Validation(format!(
            "at most {MAX_IMPORT_PROMPTS} writing prompts may be imported at once"
        )));
    }
    let mut ids = HashSet::new();
    let mut active_tasks = HashSet::new();
    let mut prepared = Vec::with_capacity(commands.len());
    for command in commands {
        let id = match command.id.as_deref() {
            Some(id) => validate_id(id)?.to_string(),
            None => format!("prompt-{}", Uuid::new_v4()),
        };
        if !ids.insert(id.clone()) {
            return Err(DbError::Validation(format!(
                "duplicate writing prompt id: {id}"
            )));
        }
        if command.is_active == Some(true) && !active_tasks.insert(command.task_type) {
            return Err(DbError::Validation(format!(
                "only one active writing prompt may be imported for {}",
                writing_task_type_str(command.task_type)
            )));
        }
        prepared.push(PreparedPrompt {
            id: id.clone(),
            task_type: command.task_type,
            version: normalize_version(command.version.as_deref(), &id)?,
            body: normalize_body(&command.body)?,
            requested_active: command.is_active,
        });
    }
    Ok(prepared)
}

fn active_task_types(conn: &Connection) -> DbResult<HashSet<WritingTaskType>> {
    let mut stmt = conn.prepare("SELECT task_type FROM writing_prompts WHERE is_active = 1")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut active = HashSet::new();
    for row in rows {
        if let Some(task_type) = WritingTaskType::parse_loose(&row?) {
            active.insert(task_type);
        }
    }
    Ok(active)
}

fn prompt_exists(conn: &Connection, id: &str) -> DbResult<bool> {
    let found: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM writing_prompts WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(found.is_some())
}

fn validate_id(raw: &str) -> DbResult<&str> {
    let id = raw.trim();
    if id.is_empty() || id.chars().count() > MAX_PROMPT_ID_LEN || id.chars().any(char::is_control) {
        return Err(DbError::Validation("invalid writing prompt id".into()));
    }
    Ok(id)
}

fn normalize_version(value: Option<&str>, id: &str) -> DbResult<String> {
    let version = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("prompt-{id}"));
    if version.chars().count() > MAX_PROMPT_VERSION_LEN || version.chars().any(char::is_control) {
        return Err(DbError::Validation("invalid writing prompt version".into()));
    }
    Ok(version)
}

fn normalize_body(value: &str) -> DbResult<String> {
    let body = value.trim();
    if body.is_empty() || body.chars().count() > MAX_PROMPT_BODY_LEN {
        return Err(DbError::Validation(
            "writing prompt body cannot be empty or oversized".into(),
        ));
    }
    Ok(body.to_string())
}

fn prompt_body(value: &Value) -> Option<String> {
    [
        "body",
        "content",
        "system",
        "systemPrompt",
        "prompt",
        "text",
    ]
    .into_iter()
    .find_map(|key| value.get(key).and_then(Value::as_str))
    .and_then(|body| normalize_body(body).ok())
}

fn legacy_fallback_id(key: &str, index: usize, value: &Value) -> String {
    if index == 0 {
        if let Ok(id) = validate_id(key) {
            return id.to_string();
        }
    }
    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    hasher.update(index.to_le_bytes());
    hasher.update(serde_json::to_vec(value).unwrap_or_default());
    let digest = hex::encode(hasher.finalize());
    format!("legacy-prompt-{}", &digest[..24])
}

fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn load_prompt_by_id(conn: &Connection, id: &str) -> DbResult<Option<WritingPromptDto>> {
    conn.query_row(
        "SELECT id, task_type, version, body, is_active, created_at, updated_at
         FROM writing_prompts WHERE id = ?1",
        params![id],
        map_prompt_row,
    )
    .optional()
    .map_err(Into::into)
}

fn map_prompt_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WritingPromptDto> {
    let task_type: String = row.get(1)?;
    let task_type = WritingTaskType::parse_loose(&task_type).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(1, "task_type".into(), rusqlite::types::Type::Text)
    })?;
    Ok(WritingPromptDto {
        id: row.get(0)?,
        task_type,
        version: row.get(2)?,
        body: row.get(3)?,
        is_active: row.get::<_, i64>(4)? != 0,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}
