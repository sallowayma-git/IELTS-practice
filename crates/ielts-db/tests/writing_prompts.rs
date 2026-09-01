use ielts_db::{
    activate_writing_prompt, active_writing_prompt, delete_writing_prompt, import_writing_prompts,
    list_writing_prompts, migrate, open_connection, upsert_setting, upsert_writing_prompt,
    DbOpenOptions,
};
use ielts_domain::domain::WritingTaskType;
use ielts_domain::dto::{ImportWritingPromptsCommand, UpsertWritingPromptCommand};
use rusqlite::Connection;
use serde_json::json;
use tempfile::tempdir;

fn open_db() -> (tempfile::TempDir, Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("prompts.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn prompt(
    id: &str,
    task_type: WritingTaskType,
    body: &str,
    is_active: Option<bool>,
) -> UpsertWritingPromptCommand {
    UpsertWritingPromptCommand {
        id: Some(id.into()),
        task_type,
        version: Some(format!("v-{id}")),
        body: body.into(),
        is_active,
    }
}

#[test]
fn activation_is_unique_per_task_and_update_preserves_omitted_state() {
    let (_dir, conn) = open_db();
    upsert_writing_prompt(
        &conn,
        &prompt(
            "task1-a",
            WritingTaskType::Task1,
            "FIRST TASK 1",
            Some(true),
        ),
    )
    .unwrap();
    upsert_writing_prompt(
        &conn,
        &prompt(
            "task1-b",
            WritingTaskType::Task1,
            "SECOND TASK 1",
            Some(true),
        ),
    )
    .unwrap();
    upsert_writing_prompt(
        &conn,
        &prompt("task2-a", WritingTaskType::Task2, "TASK 2", Some(true)),
    )
    .unwrap();

    let task1 = list_writing_prompts(&conn, Some(WritingTaskType::Task1)).unwrap();
    assert_eq!(task1.iter().filter(|item| item.is_active).count(), 1);
    assert_eq!(
        task1
            .iter()
            .find(|item| item.is_active)
            .map(|item| item.id.as_str()),
        Some("task1-b")
    );
    assert_eq!(
        active_writing_prompt(&conn, WritingTaskType::Task2)
            .unwrap()
            .as_ref()
            .map(|item| item.id.as_str()),
        Some("task2-a")
    );

    let updated = upsert_writing_prompt(
        &conn,
        &prompt("task1-b", WritingTaskType::Task1, "UPDATED TASK 1", None),
    )
    .unwrap();
    assert!(
        updated.is_active,
        "an omitted update must not silently deactivate"
    );

    let activated = activate_writing_prompt(&conn, "task1-a").unwrap();
    assert!(activated.is_active);
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM writing_prompts WHERE task_type = 'task1' AND is_active = 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap(),
        1
    );
    assert!(
        conn.execute(
            "UPDATE writing_prompts SET is_active = 1 WHERE id = 'task1-b'",
            []
        )
        .is_err(),
        "the SQLite partial unique index, not the Vue adapter, is the last line of defence"
    );
}

#[test]
fn invalid_multi_active_import_rolls_back_without_partial_prompt_bank() {
    let (_dir, conn) = open_db();
    let result = import_writing_prompts(
        &conn,
        &ImportWritingPromptsCommand {
            prompts: vec![
                prompt("one", WritingTaskType::Task1, "ONE", Some(true)),
                prompt("two", WritingTaskType::Task1, "TWO", Some(true)),
            ],
        },
    );
    assert!(result.is_err());
    assert!(list_writing_prompts(&conn, None).unwrap().is_empty());
}

#[test]
fn legacy_settings_are_projected_once_without_erasing_or_resurrecting_data() {
    let (_dir, conn) = open_db();
    // Model a v8 database upgraded in place: settings existed before the v9
    // projection checkpoint was written.
    conn.execute(
        "DELETE FROM migration_meta WHERE key = 'writing_prompts.settings_v1_imported'",
        [],
    )
    .unwrap();
    upsert_setting(
        &conn,
        "prompts",
        "legacy-settings-key",
        &json!({
            "id": "legacy-task1-id",
            "taskType": "t1",
            "version": "legacy-task1",
            "body": "LEGACY TASK 1",
            "isActive": true,
        }),
    )
    .unwrap();
    upsert_setting(
        &conn,
        "prompts",
        "legacy-task2-key",
        &json!({
            "task_type": "task2",
            "version": "legacy-task2",
            "content": "LEGACY TASK 2",
            "active": true,
        }),
    )
    .unwrap();
    upsert_setting(
        &conn,
        "prompts",
        "unparseable",
        &json!("this old payload must remain recoverable"),
    )
    .unwrap();

    let prompts = list_writing_prompts(&conn, None).unwrap();
    assert_eq!(prompts.len(), 2);
    assert!(prompts.iter().any(|item| item.id == "legacy-task1-id"));
    assert!(prompts.iter().any(|item| item.id == "legacy-task2-key"));
    assert_eq!(
        prompts
            .iter()
            .filter(|item| item.task_type == WritingTaskType::Task1 && item.is_active)
            .count(),
        1
    );
    assert_eq!(
        prompts
            .iter()
            .filter(|item| item.task_type == WritingTaskType::Task2 && item.is_active)
            .count(),
        1
    );
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM settings WHERE namespace = 'prompts'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap(),
        3,
        "legacy settings are preserved instead of silently deleted"
    );

    assert!(delete_writing_prompt(&conn, "legacy-task1-id").unwrap());
    upsert_setting(
        &conn,
        "prompts",
        "late-legacy-row",
        &json!({
            "id": "late-legacy-row",
            "task_type": "task1",
            "body": "MUST NOT RESURRECT",
            "is_active": true,
        }),
    )
    .unwrap();
    let after_delete = list_writing_prompts(&conn, None).unwrap();
    assert!(!after_delete.iter().any(|item| item.id == "legacy-task1-id"));
    assert!(!after_delete.iter().any(|item| item.id == "late-legacy-row"));
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM settings WHERE namespace = 'prompts'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap(),
        4,
        "the migration marker prevents replay, but never discards legacy bytes"
    );
}
