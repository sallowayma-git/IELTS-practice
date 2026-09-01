//! Phase 4 integration tests: unified history, settings, backup, secrets.

use std::path::PathBuf;

use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale, WritingTaskType};
use ielts_domain::dto::{
    AttemptRecord, HistoryExportFormat, ListHistoryQuery, UpsertSettingCommand,
};
use serde_json::json;
use tempfile::tempdir;

use ielts_db::{
    create_backup_package, export_history, get_history_detail, import_backup, list_history,
    list_secret_refs, list_settings, migrate, migrate_local_storage_prefs, open_connection,
    put_secret_ref, upsert_attempt, upsert_setting, write_backup_file, DbOpenOptions, SecretVault,
    NS_UI,
};

fn open_v2(path: PathBuf) -> rusqlite::Connection {
    let mut conn = open_connection(&DbOpenOptions::create(path)).expect("open");
    migrate(&mut conn).expect("migrate");
    conn
}

fn sample_attempt(
    id: &str,
    activity: Activity,
    title: &str,
    score: f64,
    submitted: &str,
) -> AttemptRecord {
    AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id: id.into(),
        activity,
        asset_id: None,
        mode: if activity == Activity::Writing {
            AttemptMode::Bank
        } else {
            AttemptMode::Single
        },
        suite_id: None,
        status: AttemptStatus::Completed,
        started_at: submitted.into(),
        submitted_at: Some(submitted.into()),
        completed_at: Some(submitted.into()),
        duration_ms: 120_000,
        score_value: Some(score),
        score_scale: Some(if activity == Activity::Writing {
            ScoreScale::Band9
        } else {
            ScoreScale::Ratio
        }),
        correct_count: if activity == Activity::Reading {
            Some(10.0)
        } else {
            None
        },
        question_count: if activity == Activity::Reading {
            Some(13)
        } else {
            None
        },
        title_snapshot: Some(title.into()),
        prompt_snapshot: None,
        content_text: Some("body".into()),
        task_type: (activity == Activity::Writing).then_some(WritingTaskType::Task2),
        answers: vec![],
        annotations: vec![],
    }
}

fn score_query(
    activity: Option<Activity>,
    min_score: Option<f64>,
    max_score: Option<f64>,
    score_scale: Option<ScoreScale>,
) -> ListHistoryQuery {
    ListHistoryQuery {
        activity,
        limit: 50,
        offset: 0,
        cursor: None,
        search: None,
        start_date: None,
        end_date: None,
        min_score,
        max_score,
        score_scale,
        task_type: None,
    }
}

#[test]
fn unified_history_pagination_and_filters() {
    let dir = tempdir().unwrap();
    let conn = open_v2(dir.path().join("v2.db"));

    upsert_attempt(
        &conn,
        &sample_attempt(
            "r1",
            Activity::Reading,
            "Tea History",
            0.85,
            "2025-01-10T10:00:00Z",
        ),
    )
    .unwrap();
    upsert_attempt(
        &conn,
        &sample_attempt(
            "w1",
            Activity::Writing,
            "University Skills",
            6.5,
            "2025-01-11T10:00:00Z",
        ),
    )
    .unwrap();
    upsert_attempt(
        &conn,
        &sample_attempt(
            "r2",
            Activity::Reading,
            "Ocean Currents",
            0.6,
            "2025-01-12T10:00:00Z",
        ),
    )
    .unwrap();

    let all = list_history(
        &conn,
        &ListHistoryQuery {
            activity: None,
            limit: 10,
            offset: 0,
            cursor: None,
            search: None,
            start_date: None,
            end_date: None,
            min_score: None,
            max_score: None,
            score_scale: None,
            task_type: None,
        },
    )
    .unwrap();
    assert_eq!(all.total, 3);
    assert_eq!(all.items.len(), 3);
    // newest first
    assert_eq!(all.items[0].id, "r2");

    let writing = list_history(
        &conn,
        &ListHistoryQuery {
            activity: Some(Activity::Writing),
            limit: 10,
            offset: 0,
            cursor: None,
            search: None,
            start_date: None,
            end_date: None,
            min_score: None,
            max_score: None,
            score_scale: None,
            task_type: None,
        },
    )
    .unwrap();
    assert_eq!(writing.total, 1);
    assert_eq!(writing.items[0].activity, Activity::Writing);

    let search = list_history(
        &conn,
        &ListHistoryQuery {
            activity: None,
            limit: 10,
            offset: 0,
            cursor: None,
            search: Some("Ocean".into()),
            start_date: None,
            end_date: None,
            min_score: None,
            max_score: None,
            score_scale: None,
            task_type: None,
        },
    )
    .unwrap();
    assert_eq!(search.total, 1);
    assert_eq!(search.items[0].id, "r2");

    let page = list_history(
        &conn,
        &ListHistoryQuery {
            activity: None,
            limit: 2,
            offset: 0,
            cursor: None,
            search: None,
            start_date: None,
            end_date: None,
            min_score: None,
            max_score: None,
            score_scale: None,
            task_type: None,
        },
    )
    .unwrap();
    assert_eq!(page.items.len(), 2);
    assert_eq!(page.next_cursor.as_deref(), Some("2"));

    let detail = get_history_detail(&conn, "w1").unwrap();
    assert_eq!(detail.summary.id, "w1");
    assert_eq!(
        detail.attempt.title_snapshot.as_deref(),
        Some("University Skills")
    );

    let csv = export_history(&conn, HistoryExportFormat::Csv, None).unwrap();
    assert!(csv.body.contains("id,activity,task_type,title"));
    assert!(csv.record_count >= 3);

    let md = export_history(
        &conn,
        HistoryExportFormat::Markdown,
        Some(&ListHistoryQuery {
            activity: Some(Activity::Reading),
            limit: 100,
            offset: 0,
            cursor: None,
            search: None,
            start_date: None,
            end_date: None,
            min_score: None,
            max_score: None,
            score_scale: None,
            task_type: None,
        }),
    )
    .unwrap();
    assert!(md.body.contains("# IELTS Practice History"));
    assert_eq!(md.record_count, 2);
}

#[test]
fn score_range_never_compares_reading_ratios_with_writing_bands() {
    let dir = tempdir().unwrap();
    let conn = open_v2(dir.path().join("score-scale.db"));

    for (id, activity, score) in [
        ("reading-high", Activity::Reading, 0.85),
        ("reading-low", Activity::Reading, 0.6),
        ("writing-band", Activity::Writing, 6.5),
    ] {
        upsert_attempt(
            &conn,
            &sample_attempt(id, activity, id, score, "2025-02-01T00:00:00Z"),
        )
        .unwrap();
    }

    let ratio = list_history(
        &conn,
        &score_query(None, Some(0.7), Some(0.9), Some(ScoreScale::Ratio)),
    )
    .unwrap();
    assert_eq!(ratio.items.len(), 1);
    assert_eq!(ratio.items[0].id, "reading-high");

    let bands = list_history(
        &conn,
        &score_query(None, Some(6.0), Some(7.0), Some(ScoreScale::Band9)),
    )
    .unwrap();
    assert_eq!(bands.items.len(), 1);
    assert_eq!(bands.items[0].id, "writing-band");

    // Existing explicit-activity callers keep their unambiguous behavior.
    let inferred_ratio = list_history(
        &conn,
        &score_query(Some(Activity::Reading), Some(0.7), Some(0.9), None),
    )
    .unwrap();
    assert_eq!(inferred_ratio.items.len(), 1);
    assert_eq!(inferred_ratio.items[0].id, "reading-high");

    let ambiguous = list_history(&conn, &score_query(None, Some(0.7), None, None)).unwrap_err();
    assert!(ambiguous.to_string().contains("scoreScale"));
    assert!(list_history(
        &conn,
        &score_query(
            Some(Activity::Reading),
            Some(0.7),
            None,
            Some(ScoreScale::Band9),
        ),
    )
    .is_err());
    assert!(list_history(
        &conn,
        &score_query(Some(Activity::Reading), Some(0.7), Some(9.0), None),
    )
    .is_err());
}

#[test]
fn settings_layers_and_reject_secrets() {
    let dir = tempdir().unwrap();
    let conn = open_v2(dir.path().join("v2.db"));

    upsert_setting(&conn, NS_UI, "theme", &json!("dark")).unwrap();
    let listed = list_settings(&conn, Some(NS_UI)).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].value, json!("dark"));

    let err = upsert_setting(&conn, "ai", "api_key", &json!("sk-secret-should-fail")).unwrap_err();
    assert!(err.to_string().contains("secret") || err.to_string().contains("API key"));

    let mut prefs = serde_json::Map::new();
    prefs.insert("theme".into(), json!("academic"));
    prefs.insert("api_key".into(), json!("sk-leak"));
    prefs.insert("practice_timer_default".into(), json!(3600));
    let n = migrate_local_storage_prefs(&conn, &prefs).unwrap();
    assert_eq!(n, 2); // api_key skipped
    let theme = list_settings(&conn, Some(NS_UI)).unwrap();
    assert!(theme
        .iter()
        .any(|s| s.key == "theme" && s.value == json!("academic")));
}

#[test]
fn secret_vault_and_sqlite_refs_only() {
    let dir = tempdir().unwrap();
    let conn = open_v2(dir.path().join("v2.db"));
    let vault = SecretVault::open(dir.path().join("secrets.vault")).unwrap();

    let ref_id = vault
        .set_secret("writing.openai.api_key", "sk-test-1234567890")
        .unwrap();
    put_secret_ref(&conn, "writing.openai.api_key", &ref_id).unwrap();

    let refs = list_secret_refs(&conn).unwrap();
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].ref_id, ref_id);
    // settings dump must not contain plaintext
    let all_settings = list_settings(&conn, None).unwrap();
    let blob = serde_json::to_string(&all_settings).unwrap();
    assert!(!blob.contains("sk-test-1234567890"));

    let loaded = vault.get_secret_by_ref(&ref_id).unwrap().unwrap();
    assert_eq!(loaded, "sk-test-1234567890");
    let metadata = std::fs::read_to_string(vault.path()).unwrap();
    assert!(!metadata.contains("sk-test-1234567890"));
    assert!(!metadata.contains("c2stdGVzdC0xMjM0NTY3ODkw"));
    assert!(vault.delete_secret("writing.openai.api_key").unwrap());
}

#[test]
fn backup_roundtrip_dry_run_and_restore() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("source.db");
    let conn = open_v2(db_path);
    upsert_attempt(
        &conn,
        &sample_attempt("r1", Activity::Reading, "Tea", 0.9, "2025-02-01T00:00:00Z"),
    )
    .unwrap();
    upsert_setting(&conn, NS_UI, "locale", &json!("zh-CN")).unwrap();
    put_secret_ref(&conn, "writing.key", "kv:demo:1").unwrap();

    let package = create_backup_package(&conn, "0.1.0-test").unwrap();
    assert!(!package.manifest.includes_secrets);
    assert_eq!(package.manifest.attempt_count, 1);
    assert!(!package.manifest.checksum_sha256.is_empty());

    let backup_path = dir.path().join("backup.json");
    write_backup_file(&package, &backup_path).unwrap();

    // dry-run on empty db
    let empty = open_v2(dir.path().join("empty.db"));
    let dry = import_backup(&empty, &package, true).unwrap();
    assert!(dry.ok);
    assert!(dry.dry_run);
    assert_eq!(dry.attempt_imported, 1);
    assert_eq!(
        list_history(
            &empty,
            &ListHistoryQuery {
                activity: None,
                limit: 10,
                offset: 0,
                cursor: None,
                search: None,
                start_date: None,
                end_date: None,
                min_score: None,
                max_score: None,
                score_scale: None,
                task_type: None,
            }
        )
        .unwrap()
        .total,
        0
    );

    let applied = import_backup(&empty, &package, false).unwrap();
    assert!(applied.ok, "{:?}", applied.errors);
    assert_eq!(applied.attempt_imported, 1);
    assert_eq!(applied.settings_imported, 1);
    assert_eq!(applied.secret_refs_imported, 1);

    let restored = list_history(
        &empty,
        &ListHistoryQuery {
            activity: None,
            limit: 10,
            offset: 0,
            cursor: None,
            search: None,
            start_date: None,
            end_date: None,
            min_score: None,
            max_score: None,
            score_scale: None,
            task_type: None,
        },
    )
    .unwrap();
    assert_eq!(restored.total, 1);
    assert_eq!(restored.items[0].id, "r1");
}

#[allow(dead_code)]
fn _unused_upsert_cmd(_: UpsertSettingCommand) {}
