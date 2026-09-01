use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

use chrono::{Duration, TimeZone, Utc};
use ielts_db::{
    checkpoint_wal, delete_attempt, ensure_asset_stub, learning_observations_rebuild,
    learning_observations_verify, migrate, open_connection, project_reading_attempt_events,
    set_history_retention_policy, upsert_attempt, DbOpenOptions,
};
use ielts_domain::{
    Activity, AttemptAnswer, AttemptMode, AttemptRecord, AttemptStatus, ScoreScale,
};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::json;
use tempfile::TempDir;

const EVENTS_PER_ATTEMPT: usize = 40;
const QUESTIONS_PER_ATTEMPT: usize = EVENTS_PER_ATTEMPT - 1;
const RETENTION_LIMIT: u32 = 50;

#[derive(Debug)]
struct Args {
    sizes: Vec<usize>,
    warmups: usize,
    samples: usize,
    output: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    schema_version: u32,
    generated_at: String,
    git_revision: String,
    profile: &'static str,
    environment: Environment,
    datasets: Vec<DatasetReport>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Environment {
    os: String,
    arch: String,
    cpu_parallelism: usize,
    sqlite_version: String,
    journal_mode: String,
    synchronous: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DatasetReport {
    learning_event_count: usize,
    attempt_count: usize,
    observation_count: i64,
    evidence_count: i64,
    rebuild: DurationReport,
    verify: DurationReport,
    history_single_delete: DurationReport,
    retention_batch_delete: DurationReport,
    database_size: DatabaseSize,
    projection_run_growth: ProjectionRunGrowth,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DurationReport {
    samples_ms: Vec<f64>,
    p50_ms: f64,
    p95_ms: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseSize {
    file_bytes: u64,
    wal_bytes: u64,
    allocated_bytes: u64,
    live_page_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectionRunGrowth {
    attempted_rebuilds: usize,
    completed_runs_before: i64,
    completed_runs_after: i64,
    failed_runs_after: i64,
    retained_completed_runs: i64,
    db_file_bytes_before: u64,
    db_file_bytes_after: u64,
}

fn main() -> Result<(), Box<dyn Error>> {
    if cfg!(debug_assertions) {
        return Err("M2.1 benchmark must run with --release".into());
    }
    let args = parse_args()?;
    let mut datasets = Vec::new();
    let mut environment = None;
    for size in args.sizes.iter().copied() {
        if size % EVENTS_PER_ATTEMPT != 0 {
            return Err(format!("event size {size} must be divisible by {EVENTS_PER_ATTEMPT}").into());
        }
        let (dataset, current_environment) = run_dataset(size, args.warmups, args.samples)?;
        environment.get_or_insert(current_environment);
        datasets.push(dataset);
    }
    let report = Report {
        schema_version: 1,
        generated_at: Utc::now().to_rfc3339(),
        git_revision: git_revision(),
        profile: "release",
        environment: environment.ok_or("no benchmark sizes were provided")?,
        datasets,
    };
    let output = resolve_output(&args.output);
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&output, serde_json::to_vec_pretty(&report)?)?;
    println!("wrote {}", output.display());
    Ok(())
}

fn run_dataset(
    event_count: usize,
    warmups: usize,
    samples: usize,
) -> Result<(DatasetReport, Environment), Box<dyn Error>> {
    let attempt_count = event_count / EVENTS_PER_ATTEMPT;
    eprintln!("m2.1 benchmark: seeding {event_count} events ({attempt_count} attempts)");
    let temp = tempfile::tempdir()?;
    let db_path = temp.path().join(format!("m2-1-{event_count}.db"));
    let mut conn = open_connection(&DbOpenOptions::create(&db_path))?;
    migrate(&mut conn)?;
    seed_fixture(&conn, attempt_count)?;
    assert_eq!(count(&conn, "learning_events")?, event_count as i64);
    let initial = learning_observations_rebuild(&conn)?;
    eprintln!("m2.1 benchmark: initial rebuild complete for {event_count}");
    assert_eq!(initial.input_count, event_count as u64);
    checkpoint_wal(&conn)?;
    let environment = environment(&conn)?;
    let database_size = database_size(&conn, &db_path)?;
    let baseline_path = temp.path().join("baseline.db");
    fs::copy(&db_path, &baseline_path)?;
    let completed_runs_before = run_count(&conn, "completed")?;

    for _ in 0..warmups {
        let report = learning_observations_rebuild(&conn)?;
        assert_eq!(report.input_count, event_count as u64);
    }
    let rebuild = duration_report(samples, || {
        let report = learning_observations_rebuild(&conn)?;
        if report.input_count != event_count as u64 {
            return Err("rebuild input count changed".into());
        }
        Ok(())
    })?;
    eprintln!("m2.1 benchmark: rebuild samples complete for {event_count}");
    let verify = duration_report(samples, || {
        let report = learning_observations_verify(&conn)?;
        if !report.consistent {
            return Err("verify reported inconsistent projection".into());
        }
        Ok(())
    })?;
    eprintln!("m2.1 benchmark: verify samples complete for {event_count}");
    let history_single_delete = destructive_duration_report(
        samples,
        &temp,
        &baseline_path,
        "delete",
        |sample_conn| {
            let middle = format!("bench-attempt-{:06}", attempt_count / 2);
            if !delete_attempt(sample_conn, &middle)? {
                return Err("single-delete fixture was not found".into());
            }
            Ok(())
        },
    )?;
    eprintln!("m2.1 benchmark: delete samples complete for {event_count}");
    let retention_batch_delete = destructive_duration_report(
        samples,
        &temp,
        &baseline_path,
        "retention",
        |sample_conn| {
            let result = set_history_retention_policy(sample_conn, Some(RETENTION_LIMIT))?;
            let expected = attempt_count.saturating_sub(RETENTION_LIMIT as usize) as u32;
            if result.pruned_attempt_count != expected {
                return Err(format!(
                    "retention pruned {}, expected {expected}",
                    result.pruned_attempt_count
                )
                .into());
            }
            Ok(())
        },
    )?;
    eprintln!("m2.1 benchmark: retention samples complete for {event_count}");

    checkpoint_wal(&conn)?;
    let completed_runs_after = run_count(&conn, "completed")?;
    let failed_runs_after = run_count(&conn, "failed")?;
    let db_file_bytes_after = file_len(&db_path)?;
    let dataset = DatasetReport {
        learning_event_count: event_count,
        attempt_count,
        observation_count: count(&conn, "learner_observations")?,
        evidence_count: count(&conn, "learner_observation_evidence")?,
        rebuild,
        verify,
        history_single_delete,
        retention_batch_delete,
        projection_run_growth: ProjectionRunGrowth {
            attempted_rebuilds: warmups + samples,
            completed_runs_before,
            completed_runs_after,
            failed_runs_after,
            retained_completed_runs: completed_runs_after,
            db_file_bytes_before: database_size.file_bytes,
            db_file_bytes_after,
        },
        database_size,
    };
    Ok((dataset, environment))
}

fn seed_fixture(conn: &Connection, attempts: usize) -> Result<(), Box<dyn Error>> {
    ensure_asset_stub(
        conn,
        "m2-1-benchmark-reading",
        Activity::Reading,
        "M2.1 projection benchmark",
        Some("developer-benchmark"),
    )?;
    let base = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).single().unwrap();
    let tx = conn.unchecked_transaction()?;
    for index in 0..attempts {
        let timestamp = (base + Duration::minutes(index as i64)).to_rfc3339();
        let id = format!("bench-attempt-{index:06}");
        let answers = (0..QUESTIONS_PER_ATTEMPT)
            .map(|question| AttemptAnswer {
                question_id: format!("q-{question:02}"),
                answer: json!((index + question) % 4),
                is_correct: Some((index + question) % 3 != 0),
                weight: 1.0,
                question_kind: Some("mcq".into()),
                change_count: ((index + question) % 3) as u32,
                visit_count: 1 + ((index + question) % 2) as u32,
                elapsed_ms: 20_000 + question as u64 * 250,
                marked: question % 11 == 0,
                answered_at: Some(timestamp.clone()),
            })
            .collect::<Vec<_>>();
        let correct_count = answers.iter().filter(|answer| answer.is_correct == Some(true)).count();
        let attempt = AttemptRecord {
            schema_version: AttemptRecord::SCHEMA_VERSION,
            id,
            activity: Activity::Reading,
            asset_id: Some("m2-1-benchmark-reading".into()),
            mode: AttemptMode::Single,
            suite_id: None,
            status: AttemptStatus::Completed,
            started_at: timestamp.clone(),
            submitted_at: Some(timestamp.clone()),
            completed_at: Some(timestamp),
            duration_ms: 900_000,
            score_value: Some(correct_count as f64 / QUESTIONS_PER_ATTEMPT as f64),
            score_scale: Some(ScoreScale::Ratio),
            correct_count: Some(correct_count as f64),
            question_count: Some(QUESTIONS_PER_ATTEMPT as u32),
            title_snapshot: Some("M2.1 benchmark".into()),
            prompt_snapshot: None,
            content_text: None,
            task_type: None,
            answers,
            annotations: Vec::new(),
        };
        upsert_attempt(&tx, &attempt)?;
        let projected = project_reading_attempt_events(&tx, &attempt)?;
        if projected.inserted as usize != EVENTS_PER_ATTEMPT {
            return Err(format!("fixture projected {} events", projected.inserted).into());
        }
    }
    tx.commit()?;
    Ok(())
}

fn duration_report<F>(samples: usize, mut operation: F) -> Result<DurationReport, Box<dyn Error>>
where
    F: FnMut() -> Result<(), Box<dyn Error>>,
{
    if samples == 0 {
        return Err("samples must be positive".into());
    }
    let mut values = Vec::with_capacity(samples);
    for _ in 0..samples {
        let started = Instant::now();
        operation()?;
        values.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    let mut ordered = values.clone();
    ordered.sort_by(f64::total_cmp);
    Ok(DurationReport {
        p50_ms: percentile(&ordered, 0.50),
        p95_ms: percentile(&ordered, 0.95),
        samples_ms: values,
    })
}

fn destructive_duration_report<F>(
    samples: usize,
    temp: &TempDir,
    baseline: &Path,
    prefix: &str,
    mut operation: F,
) -> Result<DurationReport, Box<dyn Error>>
where
    F: FnMut(&Connection) -> Result<(), Box<dyn Error>>,
{
    if samples == 0 {
        return Err("samples must be positive".into());
    }
    let mut values = Vec::with_capacity(samples);
    for sample in 0..samples {
        let sample_path = temp.path().join(format!("{prefix}-{sample}.db"));
        fs::copy(baseline, &sample_path)?;
        let sample_conn = open_connection(&DbOpenOptions::create(&sample_path))?;
        let started = Instant::now();
        operation(&sample_conn)?;
        values.push(started.elapsed().as_secs_f64() * 1000.0);
        let verify = learning_observations_verify(&sample_conn)?;
        if !verify.consistent {
            return Err("destructive transaction left projection inconsistent".into());
        }
        drop(sample_conn);
        fs::remove_file(&sample_path)?;
    }
    let mut ordered = values.clone();
    ordered.sort_by(f64::total_cmp);
    Ok(DurationReport {
        p50_ms: percentile(&ordered, 0.50),
        p95_ms: percentile(&ordered, 0.95),
        samples_ms: values,
    })
}

fn percentile(ordered: &[f64], percentile: f64) -> f64 {
    let rank = ((ordered.len() as f64 * percentile).ceil() as usize).saturating_sub(1);
    ordered[rank.min(ordered.len() - 1)]
}

fn database_size(conn: &Connection, path: &Path) -> Result<DatabaseSize, Box<dyn Error>> {
    let page_size: u64 = conn.query_row("PRAGMA page_size", [], |row| row.get(0))?;
    let page_count: u64 = conn.query_row("PRAGMA page_count", [], |row| row.get(0))?;
    let freelist_count: u64 = conn.query_row("PRAGMA freelist_count", [], |row| row.get(0))?;
    Ok(DatabaseSize {
        file_bytes: file_len(path)?,
        wal_bytes: file_len(&PathBuf::from(format!("{}-wal", path.display())))?,
        allocated_bytes: page_size * page_count,
        live_page_bytes: page_size * page_count.saturating_sub(freelist_count),
    })
}

fn environment(conn: &Connection) -> Result<Environment, Box<dyn Error>> {
    Ok(Environment {
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        cpu_parallelism: std::thread::available_parallelism()?.get(),
        sqlite_version: conn.query_row("SELECT sqlite_version()", [], |row| row.get(0))?,
        journal_mode: conn.query_row("PRAGMA journal_mode", [], |row| row.get(0))?,
        synchronous: conn.query_row("PRAGMA synchronous", [], |row| row.get(0))?,
    })
}

fn count(conn: &Connection, table: &str) -> Result<i64, Box<dyn Error>> {
    if !matches!(
        table,
        "learning_events" | "learner_observations" | "learner_observation_evidence"
    ) {
        return Err("unsupported benchmark count table".into());
    }
    Ok(conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))?)
}

fn run_count(conn: &Connection, status: &str) -> Result<i64, Box<dyn Error>> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM learning_projection_runs
         WHERE projector_key='learning_observation_v1' AND status=?1",
        [status],
        |row| row.get(0),
    )?)
}

fn file_len(path: &Path) -> Result<u64, Box<dyn Error>> {
    Ok(match fs::metadata(path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
        Err(error) => return Err(error.into()),
    })
}

fn git_revision() -> String {
    Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .unwrap_or_else(|| "unknown".into())
}

fn resolve_output(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_owned();
    }
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path)
}

fn parse_args() -> Result<Args, Box<dyn Error>> {
    let mut args = Args {
        sizes: vec![10_000, 50_000, 100_000],
        warmups: 1,
        samples: 5,
        output: PathBuf::from("developer/tests/benchmarks/reports/m2_1_projection.json"),
    };
    let mut values = std::env::args().skip(1);
    while let Some(argument) = values.next() {
        match argument.as_str() {
            "--bench" => {}
            "--sizes" => {
                args.sizes = values
                    .next()
                    .ok_or("--sizes requires a value")?
                    .split(',')
                    .map(str::parse)
                    .collect::<Result<Vec<_>, _>>()?;
            }
            "--warmups" => args.warmups = values.next().ok_or("--warmups requires a value")?.parse()?,
            "--samples" => args.samples = values.next().ok_or("--samples requires a value")?.parse()?,
            "--output" => args.output = values.next().ok_or("--output requires a value")?.into(),
            other => return Err(format!("unknown argument: {other}").into()),
        }
    }
    Ok(args)
}
