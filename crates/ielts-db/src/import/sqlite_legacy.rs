//! Read-only scanner for legacy Electron `ielts-writing.db` style databases.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;

use crate::sqlite::{open_connection, DbOpenOptions, DbResult};

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LegacyDbScan {
    pub path: String,
    pub tables: Vec<String>,
    pub essays: i64,
    pub practice_history_records: i64,
    pub evaluation_sessions: i64,
    pub topics: i64,
    pub readable: bool,
    pub notes: Vec<String>,
}

pub fn scan_legacy_sqlite(path: &Path) -> DbResult<LegacyDbScan> {
    let conn = open_connection(&DbOpenOptions::read_only(path.to_path_buf()))?;
    let mut scan = LegacyDbScan {
        path: path.display().to_string(),
        readable: true,
        ..Default::default()
    };

    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    scan.tables = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    scan.essays = count_if_exists(&conn, "essays")?;
    scan.practice_history_records = count_if_exists(&conn, "practice_history_records")?;
    scan.evaluation_sessions = count_if_exists(&conn, "evaluation_sessions")?;
    scan.topics = count_if_exists(&conn, "topics")?;

    if scan.essays == 0 && scan.practice_history_records == 0 {
        scan.notes.push("no essay/history rows found".into());
    }
    Ok(scan)
}

pub fn migrate_legacy_sqlite_to_v2(
    legacy_path: &Path,
    v2_path: &Path,
    backup_dir: Option<&Path>,
) -> DbResult<LegacyMigrationReport> {
    if let Some(dir) = backup_dir {
        let backup_path = dir.join(format!(
            "legacy-backup-{}.db",
            chrono::Utc::now().format("%Y%m%d%H%M%S")
        ));
        crate::sqlite::backup_file(legacy_path, &backup_path)?;
    }

    // Keep old DB untouched: open read-only.
    let legacy = open_connection(&DbOpenOptions::read_only(legacy_path.to_path_buf()))?;
    let mut v2 = crate::migrate::open_and_migrate(v2_path)?;

    let mut report = LegacyMigrationReport {
        source: legacy_path.display().to_string(),
        target: v2_path.display().to_string(),
        ..Default::default()
    };

    // practice_history_records
    if table_exists(&legacy, "practice_history_records")? {
        let mut stmt = legacy.prepare(
            "SELECT id, activity, asset_id, exam_id, title, status, score, total_questions,
                    correct_answers, accuracy, duration, submitted_at, started_at, ended_at,
                    submission_json
             FROM practice_history_records",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(LegacyHistoryRow {
                id: row.get(0)?,
                activity: row.get(1)?,
                asset_id: row.get(2)?,
                exam_id: row.get(3)?,
                title: row.get(4)?,
                status: row.get(5)?,
                score: row.get(6)?,
                total_questions: row.get(7)?,
                correct_answers: row.get(8)?,
                accuracy: row.get(9)?,
                duration: row.get(10)?,
                submitted_at: row.get(11)?,
                started_at: row.get(12)?,
                ended_at: row.get(13)?,
                submission_json: row.get(14)?,
            })
        })?;
        for row in rows {
            let row = row?;
            match import_history_row(&v2, &row) {
                Ok(()) => report.history_imported += 1,
                Err(err) => report.errors.push(err.to_string()),
            }
        }
    }

    // essays -> writing attempts + evaluations
    if table_exists(&legacy, "essays")? {
        let mut stmt = legacy.prepare(
            "SELECT id, topic_id, topic_text, task_type, content, word_count,
                    total_score, task_achievement, coherence_cohesion, lexical_resource,
                    grammatical_range, evaluation_json, submitted_at
             FROM essays",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(LegacyEssayRow {
                id: row.get::<_, i64>(0)?,
                topic_id: row.get(1)?,
                topic_text: row.get(2)?,
                task_type: row.get(3)?,
                content: row.get(4)?,
                word_count: row.get(5)?,
                total_score: row.get(6)?,
                task_achievement: row.get(7)?,
                coherence_cohesion: row.get(8)?,
                lexical_resource: row.get(9)?,
                grammatical_range: row.get(10)?,
                evaluation_json: row.get(11)?,
                submitted_at: row.get(12)?,
            })
        })?;
        for row in rows {
            let row = row?;
            match import_essay_row(&v2, &row) {
                Ok(()) => report.essays_imported += 1,
                Err(err) => report.errors.push(err.to_string()),
            }
        }
    }

    crate::sqlite::checkpoint_wal(&v2)?;
    report.target_attempts = crate::attempts::count_attempts(&v2)?;
    let _ = &mut v2;
    Ok(report)
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyMigrationReport {
    pub source: String,
    pub target: String,
    pub history_imported: usize,
    pub essays_imported: usize,
    pub target_attempts: i64,
    pub errors: Vec<String>,
}

#[derive(Debug)]
struct LegacyHistoryRow {
    id: String,
    activity: String,
    asset_id: Option<String>,
    exam_id: Option<String>,
    title: String,
    status: String,
    score: f64,
    total_questions: i64,
    correct_answers: f64,
    accuracy: f64,
    duration: i64,
    submitted_at: String,
    started_at: Option<String>,
    ended_at: String,
    submission_json: Option<String>,
}

#[derive(Debug)]
struct LegacyEssayRow {
    id: i64,
    topic_id: Option<i64>,
    topic_text: Option<String>,
    task_type: String,
    content: String,
    word_count: i64,
    total_score: Option<f64>,
    task_achievement: Option<f64>,
    coherence_cohesion: Option<f64>,
    lexical_resource: Option<f64>,
    grammatical_range: Option<f64>,
    evaluation_json: String,
    submitted_at: String,
}

fn import_history_row(conn: &Connection, row: &LegacyHistoryRow) -> DbResult<()> {
    if let Some(submission) = row.submission_json.as_deref() {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(submission) {
            if value.is_object() {
                crate::import::repository::import_reading_submission_json(conn, &value)?;
                return Ok(());
            }
        }
    }

    use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale};
    use ielts_domain::dto::AttemptRecord;

    let activity = if row.activity == "writing" {
        Activity::Writing
    } else {
        Activity::Reading
    };
    let asset_id = row.asset_id.clone().or_else(|| row.exam_id.clone());
    if let Some(asset) = asset_id.as_deref() {
        crate::attempts::ensure_asset_stub(
            conn,
            asset,
            activity,
            &row.title,
            row.exam_id.as_deref(),
        )?;
    }

    let attempt = AttemptRecord {
        schema_version: 1,
        id: row.id.clone(),
        activity,
        asset_id,
        mode: AttemptMode::Single,
        suite_id: None,
        status: if row.status == "completed" {
            AttemptStatus::Completed
        } else {
            AttemptStatus::Submitted
        },
        started_at: row
            .started_at
            .clone()
            .unwrap_or_else(|| row.submitted_at.clone()),
        submitted_at: Some(row.submitted_at.clone()),
        completed_at: Some(row.ended_at.clone()),
        duration_ms: row.duration as u64,
        score_value: if activity == Activity::Reading {
            Some(if row.accuracy > 1.0 {
                row.accuracy / 100.0
            } else {
                row.accuracy
            })
        } else {
            Some(row.score)
        },
        score_scale: Some(if activity == Activity::Reading {
            ScoreScale::Ratio
        } else {
            ScoreScale::Band9
        }),
        correct_count: Some(row.correct_answers),
        question_count: Some(row.total_questions as u32),
        title_snapshot: Some(row.title.clone()),
        prompt_snapshot: None,
        content_text: None,
        task_type: None,
        answers: vec![],
        annotations: vec![],
    };
    crate::attempts::upsert_attempt(conn, &attempt)
}

fn import_essay_row(conn: &Connection, row: &LegacyEssayRow) -> DbResult<()> {
    use ielts_domain::domain::{Activity, AttemptMode, AttemptStatus, ScoreScale, WritingTaskType};
    use ielts_domain::dto::AttemptRecord;

    let attempt_id = format!("essay-{}", row.id);
    let title = row
        .topic_text
        .clone()
        .unwrap_or_else(|| format!("Essay {}", row.id));
    let asset_id = row.topic_id.map(|id| format!("topic-{id}"));
    if let Some(asset) = asset_id.as_deref() {
        crate::attempts::ensure_asset_stub(
            conn,
            asset,
            Activity::Writing,
            &title,
            asset_id.as_deref(),
        )?;
    }

    let attempt = AttemptRecord {
        schema_version: 1,
        id: attempt_id.clone(),
        activity: Activity::Writing,
        asset_id,
        mode: if row.topic_id.is_some() {
            AttemptMode::Bank
        } else {
            AttemptMode::Freeform
        },
        suite_id: None,
        status: AttemptStatus::Completed,
        started_at: row.submitted_at.clone(),
        submitted_at: Some(row.submitted_at.clone()),
        completed_at: Some(row.submitted_at.clone()),
        duration_ms: 0,
        score_value: row.total_score,
        score_scale: Some(ScoreScale::Band9),
        correct_count: None,
        question_count: None,
        title_snapshot: Some(title),
        prompt_snapshot: row.topic_text.clone(),
        content_text: Some(row.content.clone()),
        task_type: WritingTaskType::parse_loose(&row.task_type),
        answers: vec![],
        annotations: vec![],
    };
    crate::attempts::upsert_attempt(conn, &attempt)?;

    // Prefer evaluation_json; fall back to column scores.
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&row.evaluation_json) {
        let mut obj = value;
        if obj.get("total_score").is_none() {
            if let Some(score) = row.total_score {
                obj.as_object_mut()
                    .map(|m| m.insert("total_score".into(), serde_json::json!(score)));
            }
        }
        if obj.get("task_achievement").is_none() {
            if let Some(score) = row.task_achievement {
                obj.as_object_mut()
                    .map(|m| m.insert("task_achievement".into(), serde_json::json!(score)));
            }
        }
        if obj.get("coherence_cohesion").is_none() {
            if let Some(score) = row.coherence_cohesion {
                obj.as_object_mut()
                    .map(|m| m.insert("coherence_cohesion".into(), serde_json::json!(score)));
            }
        }
        if obj.get("lexical_resource").is_none() {
            if let Some(score) = row.lexical_resource {
                obj.as_object_mut()
                    .map(|m| m.insert("lexical_resource".into(), serde_json::json!(score)));
            }
        }
        if obj.get("grammatical_range").is_none() {
            if let Some(score) = row.grammatical_range {
                obj.as_object_mut()
                    .map(|m| m.insert("grammatical_range".into(), serde_json::json!(score)));
            }
        }
        if obj.get("task_type").is_none() {
            obj.as_object_mut()
                .map(|m| m.insert("task_type".into(), serde_json::json!(row.task_type)));
        }
        if obj.get("status").is_none() {
            obj.as_object_mut()
                .map(|m| m.insert("status".into(), serde_json::json!("completed")));
        }
        let _ = row.word_count;
        crate::import::repository::import_evaluation_json(conn, &attempt_id, &obj)?;
    }
    Ok(())
}

fn table_exists(conn: &Connection, name: &str) -> DbResult<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [name],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

fn count_if_exists(conn: &Connection, table: &str) -> DbResult<i64> {
    if !table_exists(conn, table)? {
        return Ok(0);
    }
    // table name from controlled set only
    let sql = format!("SELECT COUNT(*) FROM {table}");
    let n: i64 = conn.query_row(&sql, [], |r| r.get(0))?;
    Ok(n)
}

pub fn find_legacy_db_candidates(roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for root in roots {
        for name in [
            "ielts-writing.db",
            "ielts-practice.db",
            "practice.db",
            "app.db",
        ] {
            let candidate = root.join(name);
            if candidate.exists() {
                out.push(candidate);
            }
        }
    }
    out
}
