use ielts_db::{
    ensure_asset_stub, list_writing_topics, migrate, open_connection, seed_builtin_writing_catalog,
    upsert_setting, upsert_writing_topic, DbOpenOptions,
};
use ielts_domain::domain::{Activity, WritingTaskType};
use ielts_domain::dto::{ListWritingTopicsQuery, UpsertWritingTopicCommand};
use rusqlite::Connection;
use serde_json::json;
use std::fs;
use tempfile::tempdir;

struct TestDb {
    _dir: tempfile::TempDir,
    conn: Connection,
}

fn open_db() -> TestDb {
    let dir = tempdir().unwrap();
    let path = dir.path().join("topics.db");
    let mut conn = open_connection(&DbOpenOptions::create(path)).unwrap();
    migrate(&mut conn).unwrap();
    TestDb { _dir: dir, conn }
}

fn list_all(conn: &Connection) -> ielts_domain::dto::WritingTopicPage {
    list_writing_topics(
        conn,
        &ListWritingTopicsQuery {
            task_type: None,
            category: None,
            difficulty: None,
            search: None,
            limit: 100,
            offset: 0,
        },
    )
    .unwrap()
}

fn command(id: &str) -> UpsertWritingTopicCommand {
    UpsertWritingTopicCommand {
        id: Some(id.to_string()),
        task_type: WritingTaskType::Task2,
        category: "Education".into(),
        difficulty: 3,
        title_json: "Discuss whether schools should teach practical skills.".into(),
        image_path: None,
        is_official: Some(false),
    }
}

#[test]
fn legacy_catalog_reimports_only_when_the_source_changes() {
    let db = open_db();
    let conn = &db.conn;
    upsert_setting(
        &conn,
        "topics",
        "bc-task2",
        &json!({
            "topics": [{
                "source_id": "bc-task2-education-1",
                "type": "task2",
                "category": "Education",
                "difficulty": 3,
                "prompt": "Schools should teach practical skills. Discuss."
            }]
        }),
    )
    .unwrap();

    let first = list_all(&conn);
    assert_eq!(first.total, 1);
    assert_eq!(first.items[0].id, "bc-task2-education-1");
    assert_eq!(
        list_all(&conn).total,
        1,
        "unchanged settings must not duplicate topics"
    );

    upsert_setting(
        &conn,
        "topics",
        "bc-task2",
        &json!({
            "topics": [
                {
                    "source_id": "bc-task2-education-1",
                    "type": "task2",
                    "category": "Education",
                    "difficulty": 3,
                    "prompt": "Schools should teach practical skills. Discuss."
                },
                {
                    "source_id": "bc-task2-environment-1",
                    "type": "task2",
                    "category": "Environment",
                    "difficulty": 4,
                    "prompt": "Governments should prioritise the environment. Discuss."
                }
            ]
        }),
    )
    .unwrap();

    let changed = list_all(&conn);
    assert_eq!(changed.total, 2);
    assert!(changed
        .items
        .iter()
        .any(|topic| topic.id == "bc-task2-environment-1"));
}

#[test]
fn topic_upsert_never_overwrites_an_unrelated_writing_asset() {
    let db = open_db();
    let conn = &db.conn;
    conn.execute(
        "INSERT INTO practice_assets (
            id, activity, source_kind, source_key, title, category, difficulty, frequency,
            content_ref, schema_version, fingerprint, pdf_only, metadata_json, created_at, updated_at
         ) VALUES (
            'external-writing', 'writing', 'imported', 'external:file', 'External writing asset',
            NULL, NULL, NULL, NULL, 2, 'external-fingerprint', 0, NULL,
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
         )",
        [],
    )
    .unwrap();

    let error = upsert_writing_topic(&conn, &command("external-writing")).unwrap_err();
    assert!(error
        .to_string()
        .contains("collides with an existing writing asset"));
}

#[test]
fn legacy_essay_stub_can_be_promoted_to_a_topic_without_losing_history_identity() {
    let db = open_db();
    let conn = &db.conn;
    ensure_asset_stub(
        &conn,
        "topic-9",
        Activity::Writing,
        "Legacy topic",
        Some("topic-9"),
    )
    .unwrap();

    let topic = upsert_writing_topic(&conn, &command("topic-9")).unwrap();
    assert_eq!(topic.id, "topic-9");
    assert_eq!(list_all(&conn).total, 1);
}

#[test]
fn embedded_task1_image_is_validated_and_persisted_with_the_topic() {
    let db = open_db();
    let conn = &db.conn;
    let mut task1 = command("task1-image");
    task1.task_type = WritingTaskType::Task1;
    task1.image_path = Some("data:image/png;base64,AA==".into());
    let saved = upsert_writing_topic(conn, &task1).unwrap();
    assert_eq!(
        saved.image_path.as_deref(),
        Some("data:image/png;base64,AA==")
    );

    task1.id = Some("task1-invalid-image".into());
    task1.image_path = Some("data:text/plain;base64,AA==".into());
    let error = upsert_writing_topic(conn, &task1).unwrap_err();
    assert!(error.to_string().contains("PNG, JPEG, or WebP"));
}

#[test]
fn builtin_catalog_seed_is_idempotent_and_preserves_user_owned_collisions() {
    let db = open_db();
    let conn = &db.conn;
    let user_topic = upsert_writing_topic(conn, &command("catalog-collision")).unwrap();
    let catalog_path = db._dir.path().join("official.catalog.json");
    fs::write(
        &catalog_path,
        json!({
            "version": 1,
            "topics": [
                {
                    "source_id": "official-task2-1",
                    "type": "task2",
                    "prompt": "Discuss whether public libraries should remain free.",
                    "category": "society",
                    "difficulty": 3
                },
                {
                    "source_id": "catalog-collision",
                    "type": "task2",
                    "prompt": "The official catalog must not overwrite this user topic.",
                    "category": "government",
                    "difficulty": 4
                }
            ]
        })
        .to_string(),
    )
    .unwrap();

    let first = seed_builtin_writing_catalog(conn, &catalog_path).unwrap();
    assert_eq!(first.declared, 2);
    assert_eq!(first.created, 1);
    assert_eq!(first.updated, 0);
    assert_eq!(first.unchanged, 0);
    assert_eq!(first.preserved, 1);

    let topics = list_all(conn);
    assert_eq!(topics.total, 2);
    let official = topics
        .items
        .iter()
        .find(|topic| topic.id == "official-task2-1")
        .unwrap();
    assert!(official.is_official);
    let collision = topics
        .items
        .iter()
        .find(|topic| topic.id == "catalog-collision")
        .unwrap();
    assert!(!collision.is_official);
    assert_eq!(collision.title_json, user_topic.title_json);

    let second = seed_builtin_writing_catalog(conn, &catalog_path).unwrap();
    assert_eq!(second.created, 0);
    assert_eq!(second.updated, 0);
    assert_eq!(second.unchanged, 1);
    assert_eq!(second.preserved, 1);
    assert_eq!(
        list_all(conn).total,
        2,
        "repeat seed must not duplicate rows"
    );
}

#[test]
fn shipped_official_catalog_seeds_a_fresh_database() {
    let db = open_db();
    let catalog_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../assets/generated/writing-topics/bc-task2-2024-12_2025-01.catalog.json");
    let report = seed_builtin_writing_catalog(&db.conn, &catalog_path).unwrap();
    assert!(report.declared > 0);
    assert_eq!(report.created as usize, report.declared);
    assert_eq!(report.preserved, 0);
    let topics = list_all(&db.conn);
    assert_eq!(topics.total as usize, report.declared);
    assert!(topics.items.iter().all(|topic| topic.is_official));
}
