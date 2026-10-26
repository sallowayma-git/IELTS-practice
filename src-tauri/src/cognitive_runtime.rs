//! M3 host-owned Python sidecar lifecycle and framed protocol boundary.

use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::{oneshot, Mutex, Notify, OwnedMutexGuard};

use ielts_application::{ChatMessage, CompletionRequest};
use ielts_db::{
    BeginAgentToolCallCommand, FinishAgentToolCallCommand, StoredAgentToolStatus,
};

use crate::ai::{load_runtime, PartialCompletion};
use crate::app::state::{AppDb, AppVault};

pub(crate) const PROTOCOL_VERSION: u32 = 1;
pub(crate) const MAX_FRAME_BYTES: usize = 1024 * 1024;
/// Round-3 audit (7.8): upper bound on a sidecar-requested output ceiling. The
/// sidecar's model calls are short structured extractions, so this is generous
/// without letting Python ask for an unbounded completion.
const SIDECAR_MAX_OUTPUT_TOKENS: u32 = 8_000;
const SIDECAR_NAME: &str = "ielts-agent-runtime";
const SIDECAR_BUILD_ID: &str = env!("IELTS_AGENT_RUNTIME_BUILD_ID");
/// `build.rs` emits this instead of a SHA-256 when a development build was
/// compiled without a frozen sidecar; such a build never starts the runtime.
const SIDECAR_UNAVAILABLE_BUILD_ID: &str = "sidecar-unavailable";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const COGNITIVE_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
/// The weekly run makes up to `MODEL_MAX_ATTEMPTS` (3) model calls with backoff;
/// each may take as long as the provider timeout (5..=300 s, default 60 s). The
/// sidecar bounds itself by `WEEKLY_RUN_DEADLINE_MS` (400 s), slightly below this.
#[cfg(feature = "daily-dream-v1")]
const WEEKLY_REQUEST_TIMEOUT: Duration = Duration::from_secs(420);
const START_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
/// Delay before the first automatic restart after a sidecar failure; doubled
/// for every further consecutive failure, up to `RESTART_BACKOFF_MAX`.
const RESTART_BACKOFF_BASE: Duration = Duration::from_secs(1);
const RESTART_BACKOFF_MAX: Duration = Duration::from_secs(60);
/// Consecutive failures (no successful handshake in between) after which the
/// host stops restarting the sidecar on its own.
const RESTART_MAX_CONSECUTIVE_FAILURES: u32 = 5;
/// Sidecar stderr is logged locally, line by line, within these bounds.
const STDERR_LINE_CAP: usize = 2 * 1024;
const STDERR_LOG_BUDGET: usize = 64 * 1024;
const STDERR_TAIL_LINES: usize = 20;
/// Methods the HOST calls ON the sidecar. Every entry must be a method the host
/// actually sends, and every method the host sends must be listed here —
/// otherwise the handshake succeeds against a sidecar that cannot serve the
/// call, and the failure surfaces later as `method_not_found` mid-run.
///
/// Round-3 audit (item 8): `dream.weekly` and `planner.study_plan` were sent in
/// production (`run_weekly_dream` / `run_study_planner`) but appeared in neither
/// this list nor `requestedCapabilities`, so a sidecar build without them
/// negotiated cleanly and then failed on first use. The sidecar has always
/// declared both in `SUPPORTED_CAPABILITIES` (protocol.py), so only this side
/// was stale.
///
/// Note this is the OPPOSITE direction from `PROVIDED_HOST_CAPABILITIES` below.
/// The audit item conflated the two and asked for `retrieval.*` / `prompt.*` /
/// `eval.run_case` to be added to the sidecar's inbound dispatch; those are
/// reverse-RPC methods the host SERVES, and they must never appear here.
const REQUIRED_RUNTIME_CAPABILITIES: &[(&str, &str)] = &[
    ("runtime.health", "1"),
    ("runtime.shutdown", "1"),
    ("memory.candidates.generate", "1"),
    ("dream.weekly", "1"),
    ("planner.study_plan", "1"),
];
/// Reverse-RPC surface the HOST provides TO the sidecar (the opposite direction
/// from `REQUIRED_RUNTIME_CAPABILITIES` above, which is what the host calls ON
/// the sidecar — do not conflate the two).
///
/// This array is ADVISORY: it is the handshake advertisement plus the subset
/// check in `validate_handshake`. The actual enforcement point is the method
/// match in `handle_host_request`. Removing an entry here without removing its
/// dispatch arm does NOT close a hole.
const PROVIDED_HOST_CAPABILITIES: &[(&str, &str)] = &[
    ("model.invoke", "1"),
    ("tool.invoke", "1"),
    #[cfg(feature = "context-compiler-v1")]
    ("learning.learner_skill_state", "1"),
    #[cfg(feature = "context-compiler-v1")]
    ("memory.search_active", "1"),
    #[cfg(feature = "context-compiler-v1")]
    ("learning.evidence_by_ids", "1"),
    #[cfg(feature = "daily-dream-v1")]
    ("dream.run_weekly", "1"),
    #[cfg(feature = "daily-dream-v1")]
    ("learning.weekly_pack", "1"),
    #[cfg(feature = "agent-threads-v1")]
    ("study_plan.create", "1"),
];
/// Saturday or Sunday, in `now`'s own zone.
#[cfg(feature = "daily-dream-v1")]
pub(crate) fn is_weekend<Tz: chrono::TimeZone>(now: &chrono::DateTime<Tz>) -> bool {
    use chrono::{Datelike, Weekday};
    matches!(now.weekday(), Weekday::Sat | Weekday::Sun)
}

/// The weekly window the host would consolidate at `now`. A pure function of the
/// clock and of where the last COMPLETED consolidation ended: whether it is due
/// is the caller's one predicate (`weekly_window_due`).
///
/// The window runs from the end of the last completed consolidation (exclusive)
/// to `now`, never more than `WEEKLY_MAX_LOOKBACK_DAYS` back, so a missed weekend
/// is folded into the next one with no separate catch-up path. Its key names the
/// latest weekend at or before `now` (`weekend_key`): Saturday and Sunday share
/// it, and so does every weekday after, so a retry on Monday belongs to the
/// weekend it is retrying.
#[cfg(feature = "daily-dream-v1")]
pub(crate) fn plan_weekly_window<Tz: chrono::TimeZone>(
    now: &chrono::DateTime<Tz>,
    last_completed_end: Option<chrono::DateTime<chrono::Utc>>,
) -> Option<ielts_db::WeeklyWindow> {
    use chrono::{Duration, Utc};
    let end = chrono::DateTime::<Utc>::from_timestamp(now.timestamp(), 0)?;
    let floor = end - Duration::days(ielts_db::WEEKLY_MAX_LOOKBACK_DAYS);
    let start = last_completed_end.map_or(floor, |last| last.max(floor));
    (start < end).then(|| ielts_db::WeeklyWindow::new(weekend_key(now), start, end))
}

/// ISO week (`YYYY-Www`) of the latest Saturday or Sunday at or before `now`, in
/// `now`'s own zone.
#[cfg(feature = "daily-dream-v1")]
pub(crate) fn weekend_key<Tz: chrono::TimeZone>(now: &chrono::DateTime<Tz>) -> String {
    use chrono::{Datelike, Duration, Weekday};
    // Monday..Friday step back to the Sunday before; Saturday and Sunday stay.
    let back = match now.weekday() {
        Weekday::Sat | Weekday::Sun => 0,
        weekday => i64::from(weekday.num_days_from_monday()) + 1,
    };
    let week = (now.date_naive() - Duration::days(back)).iso_week();
    format!("{}-W{:02}", week.year(), week.week())
}

/// ISO week of the first weekend at or after `now`: the weekend whose run will
/// close what is practised now. Saturday and Sunday are their own weekend.
#[cfg(feature = "daily-dream-v1")]
pub(crate) fn upcoming_weekend_key<Tz: chrono::TimeZone>(now: &chrono::DateTime<Tz>) -> String {
    use chrono::{Datelike, Duration, Weekday};
    let ahead = match now.weekday() {
        Weekday::Sat | Weekday::Sun => 0,
        weekday => 5 - i64::from(weekday.num_days_from_monday()),
    };
    weekend_key(&(now.clone() + Duration::days(ahead)))
}

/// Start of `now`'s calendar day in `now`'s zone, as a UTC instant: the retry
/// bound is one weekly attempt per local day.
#[cfg(feature = "daily-dream-v1")]
pub(crate) fn local_day_start_utc<Tz: chrono::TimeZone>(now: &chrono::DateTime<Tz>) -> chrono::DateTime<chrono::Utc> {
    use chrono::{Duration, NaiveTime, Utc};
    now.timezone()
        .from_local_datetime(&now.date_naive().and_time(NaiveTime::MIN))
        .earliest()
        .map_or_else(|| now.with_timezone(&Utc) - Duration::hours(24), |start| start.with_timezone(&Utc))
}

/// The report of one host-owned window, built exactly as the weekly write path
/// builds it. Read-only: both the pack and the validate-only preflight must see
/// the same blocks and facts the submission will be validated against, so the
/// construction lives here once.
#[cfg(feature = "daily-dream-v1")]
fn weekly_window_report(
    conn: &rusqlite::Connection,
    window: &ielts_db::WeeklyWindow,
) -> Result<ielts_domain::WeeklyReport, ielts_db::DbError> {
    let now = crate::app::clock::now();
    ielts_db::build_weekly_report(
        conn,
        "local",
        window,
        *now.offset(),
        ielts_domain::WeeklyReportState::Live,
        now.with_timezone(&chrono::Utc),
    )
}

/// The weekly pack of one window, as the sidecar receives it: the learner's real
/// practice records, bounded (see `ielts_db::weekly_pack`).
#[cfg(feature = "daily-dream-v1")]
pub(crate) fn weekly_pack_value(
    db: &AppDb,
    window: &ielts_db::WeeklyWindow,
) -> Result<Value, RuntimeHostError> {
    db.with_conn(|conn| {
        let mut pack = ielts_db::weekly_pack(conn, "local", window.start, window.end)?.to_value();
        // The report built for the same window is the single source of every
        // number the model may cite: blocks for layout, facts for prose.
        let report = weekly_window_report(conn, window)?;
        let blocks: Vec<Value> = report
            .blocks
            .iter()
            .map(|block| json!({"id": block.id, "kind": block.kind, "data": block.data}))
            .collect();
        pack["blocks"] = Value::Array(blocks);
        pack["facts"] = serde_json::to_value(&report.facts)
            .map_err(|error| ielts_db::DbError::Message(error.to_string()))?;
        pack["soul"] = Value::Object(ielts_db::soul::soul_profile(conn, "local")?);
        pack["persona"] = json!(ielts_db::soul::SOUL_PERSONA);
        pack["previousDigest"] =
            ielts_db::previous_weekly_digest(conn, "local", window.start)?.unwrap_or(Value::Null);
        Ok(pack)
    })
    .map_err(|error: ielts_db::DbError| RuntimeHostError::InvalidResponse(error.to_string()))
}

/// The sidecar's write-free preflight: validate a submitted digest against the
/// same facts and Soul profile the real `dream.run_weekly` write would use.
///
/// This is read-only by construction — it opens no journal, creates no run and
/// persists no report — and it never returns prose, only the validator's
/// metrics so the sidecar can repair once before submitting.
#[cfg(feature = "daily-dream-v1")]
fn weekly_validate_only(
    db: &AppDb,
    window: &ielts_db::WeeklyWindow,
    params: &serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let digest = params.get("digest").cloned().unwrap_or(Value::Null);
    let today = crate::app::clock::now().date_naive();
    db.with_conn(|conn| {
        let report = weekly_window_report(conn, window)?;
        let profile = ielts_db::soul::soul_profile(conn, "local")?;
        let outcome = ielts_db::validate_narrative(&digest, &report.facts, &profile, today);
        let report = outcome.narrative.validation.final_report;
        Ok(json!({
            "usable": outcome.usable,
            "needsRepair": report.needs_repair,
            "droppedSentences": report.dropped_sentences,
            "violations": report.violations,
        }))
    })
    .map_err(|error: ielts_db::DbError| error.to_string())
}

static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// Serialize an `ApplicationError`-bearing service result into a JSON value
/// with a `String` error channel, so the reverse-RPC dispatcher can map it to
/// a single `RuntimeHostError::InvalidResponse`.
#[cfg(any(feature = "context-compiler-v1", feature = "agent-threads-v1"))]
fn serialize_result<T: serde::Serialize>(
    result: Result<T, ielts_application::ApplicationError>,
) -> Result<Value, String> {
    match result {
        Ok(value) => serde_json::to_value(value).map_err(|error| error.to_string()),
        Err(error) => Err(error.message),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeState {
    Stopped,
    Starting,
    Ready,
    Stopping,
    Crashed,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RuntimeHandshake {
    pub selected_protocol: u32,
    pub runtime_version: String,
    pub build_id: String,
    pub capabilities: BTreeMap<String, String>,
    pub required_host_capabilities: BTreeMap<String, String>,
    pub max_frame_bytes: usize,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub(crate) enum RuntimeHostError {
    #[error("runtime frame is larger than {0} bytes")]
    FrameTooLarge(usize),
    #[error("runtime frame has an invalid length")]
    InvalidFrameLength,
    #[error("runtime frame contains invalid JSON: {0}")]
    InvalidJson(String),
    #[error("runtime protocol version mismatch: expected {expected}, got {actual}")]
    ProtocolVersionMismatch { expected: u32, actual: u32 },
    #[error("runtime build identity mismatch")]
    BuildIdentityMismatch,
    #[error(
        "AI features are unavailable: this app was built without its agent runtime. \
         Run developer/tests/ci/build_agent_runtime_sidecar.py and rebuild the app."
    )]
    SidecarNotBundled,
    #[error("runtime is missing capability {0}")]
    MissingCapability(String),
    #[error("runtime capability version mismatch for {capability}: expected {expected}, got {actual}")]
    CapabilityVersionMismatch {
        capability: String,
        expected: String,
        actual: String,
    },
    #[error("runtime is busy")]
    Busy,
    #[error("runtime request was cancelled")]
    Cancelled,
    #[error("invalid runtime lifecycle transition from {0:?}")]
    InvalidState(RuntimeState),
    #[error("runtime process error: {0}")]
    Process(String),
    #[error("runtime request timed out")]
    Timeout,
    #[error("The study assistant stopped unexpectedly and is restarting; try again after {retry_after_secs}s.")]
    RestartBackoff { retry_after_secs: u64 },
    #[error("The study assistant stopped unexpectedly {failures} times in a row and will not restart automatically. Restart the app to try again.")]
    RestartGaveUp { failures: u32 },
    /// The model provider failed; `retryable` is the gateway's own verdict
    /// (5xx / 429 / timeout / connect), which the sidecar's retry loop honours.
    #[error("{message}")]
    Provider { message: String, retryable: bool },
    #[error("runtime response is invalid: {0}")]
    InvalidResponse(String),
}

#[derive(Debug)]
pub(crate) struct RuntimeLifecycle {
    state: RuntimeState,
    handshake: Option<RuntimeHandshake>,
}

impl Default for RuntimeLifecycle {
    fn default() -> Self {
        Self {
            state: RuntimeState::Stopped,
            handshake: None,
        }
    }
}

impl RuntimeLifecycle {
    pub(crate) fn state(&self) -> RuntimeState {
        self.state
    }

    pub(crate) fn handshake(&self) -> Option<&RuntimeHandshake> {
        self.handshake.as_ref()
    }

    pub(crate) fn begin_start(&mut self) -> Result<(), RuntimeHostError> {
        match self.state {
            RuntimeState::Stopped | RuntimeState::Crashed | RuntimeState::Unavailable => {
                self.state = RuntimeState::Starting;
                self.handshake = None;
                Ok(())
            }
            state => Err(RuntimeHostError::InvalidState(state)),
        }
    }

    pub(crate) fn accept_handshake(
        &mut self,
        handshake: RuntimeHandshake,
        expected_build_id: Option<&str>,
        required_capabilities: &[(&str, &str)],
    ) -> Result<(), RuntimeHostError> {
        if self.state != RuntimeState::Starting {
            return Err(RuntimeHostError::InvalidState(self.state));
        }
        validate_handshake(&handshake, expected_build_id, required_capabilities)?;
        self.handshake = Some(handshake);
        Ok(())
    }

    pub(crate) fn mark_ready(&mut self) -> Result<(), RuntimeHostError> {
        if self.state != RuntimeState::Starting || self.handshake.is_none() {
            return Err(RuntimeHostError::InvalidState(self.state));
        }
        self.state = RuntimeState::Ready;
        Ok(())
    }

    pub(crate) fn begin_shutdown(&mut self) -> Result<(), RuntimeHostError> {
        match self.state {
            RuntimeState::Stopped => Ok(()),
            RuntimeState::Starting | RuntimeState::Ready | RuntimeState::Crashed | RuntimeState::Unavailable => {
                self.state = RuntimeState::Stopping;
                Ok(())
            }
            state => Err(RuntimeHostError::InvalidState(state)),
        }
    }

    pub(crate) fn mark_unavailable(&mut self) {
        self.state = RuntimeState::Unavailable;
        self.handshake = None;
    }

    pub(crate) fn mark_crashed(&mut self) {
        self.state = RuntimeState::Crashed;
        self.handshake = None;
    }

    pub(crate) fn shutdown(&mut self) {
        self.state = RuntimeState::Stopped;
        self.handshake = None;
    }
}

/// Crash-loop guard for automatic sidecar restarts. Every failed run (crash,
/// process error, failed startup) of a distinct generation counts once; a
/// successful handshake or an explicit shutdown/restart clears the history.
#[derive(Debug, Default)]
struct RestartBackoff {
    consecutive_failures: u32,
    last_failure_at: Option<Instant>,
    last_failed_generation: Option<u64>,
}

impl RestartBackoff {
    fn record_failure(&mut self, generation: u64, now: Instant) {
        if self.last_failed_generation == Some(generation) {
            return;
        }
        self.last_failed_generation = Some(generation);
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        self.last_failure_at = Some(now);
    }

    fn reset(&mut self) {
        *self = Self::default();
    }

    fn check(&self, now: Instant) -> Result<(), RuntimeHostError> {
        restart_decision(self.consecutive_failures, self.last_failure_at, now)
    }
}

/// Backoff before the restart that follows `failures` consecutive failures:
/// 1 s, 2 s, 4 s, ... capped at `RESTART_BACKOFF_MAX`.
fn restart_delay(failures: u32) -> Duration {
    let doublings = failures.saturating_sub(1).min(16);
    RESTART_BACKOFF_BASE
        .saturating_mul(1u32 << doublings)
        .min(RESTART_BACKOFF_MAX)
}

/// Pure restart gate (the clock is the caller's `now`). Never sleeps: a start
/// inside the backoff window is rejected with the time left, and after
/// `RESTART_MAX_CONSECUTIVE_FAILURES` it is rejected until an explicit restart.
fn restart_decision(
    failures: u32,
    last_failure_at: Option<Instant>,
    now: Instant,
) -> Result<(), RuntimeHostError> {
    if failures == 0 {
        return Ok(());
    }
    if failures >= RESTART_MAX_CONSECUTIVE_FAILURES {
        return Err(RuntimeHostError::RestartGaveUp { failures });
    }
    let Some(last) = last_failure_at else {
        return Ok(());
    };
    let elapsed = now.saturating_duration_since(last);
    let delay = restart_delay(failures);
    if elapsed >= delay {
        return Ok(());
    }
    let remaining = delay - elapsed;
    // Round up so the message never says "after 0s" while still blocked.
    let retry_after_secs = remaining.as_secs() + u64::from(remaining.subsec_nanos() > 0);
    Err(RuntimeHostError::RestartBackoff { retry_after_secs })
}

/// What one chunk of sidecar stderr turns into for the local log.
#[derive(Debug, PartialEq, Eq)]
enum StderrOutput {
    Line(String),
    /// Emitted once, when the per-process log budget is spent.
    BudgetExhausted,
}

/// Line-splits raw sidecar stderr with bounds: each line is capped at
/// `STDERR_LINE_CAP` bytes, at most `STDERR_LOG_BUDGET` bytes are logged per
/// process, and the last `STDERR_TAIL_LINES` lines are kept (even past the
/// budget) for the termination log event. Logs stay local.
#[derive(Debug, Default)]
struct StderrCapture {
    partial: Vec<u8>,
    partial_truncated: bool,
    logged_bytes: usize,
    budget_exhausted: bool,
    tail: VecDeque<String>,
}

impl StderrCapture {
    fn push(&mut self, bytes: &[u8]) -> Vec<StderrOutput> {
        let mut out = Vec::new();
        for chunk in bytes.split_inclusive(|byte| *byte == b'\n') {
            let (body, complete) = match chunk.split_last() {
                Some((b'\n', body)) => (body, true),
                _ => (chunk, false),
            };
            let room = STDERR_LINE_CAP.saturating_sub(self.partial.len());
            if body.len() > room {
                self.partial.extend_from_slice(&body[..room]);
                self.partial_truncated = true;
            } else {
                self.partial.extend_from_slice(body);
            }
            if complete {
                self.complete_line(&mut out);
            }
        }
        out
    }

    /// Flush an unterminated last line (the process has exited).
    fn finish(&mut self) -> Vec<StderrOutput> {
        let mut out = Vec::new();
        if !self.partial.is_empty() || self.partial_truncated {
            self.complete_line(&mut out);
        }
        out
    }

    fn complete_line(&mut self, out: &mut Vec<StderrOutput>) {
        let raw = std::mem::take(&mut self.partial);
        let raw = raw.strip_suffix(b"\r").unwrap_or(&raw);
        let mut line = String::from_utf8_lossy(raw).into_owned();
        if std::mem::take(&mut self.partial_truncated) {
            line.push_str(" [line truncated]");
        }
        if self.tail.len() == STDERR_TAIL_LINES {
            self.tail.pop_front();
        }
        self.tail.push_back(line.clone());
        if self.logged_bytes + line.len() <= STDERR_LOG_BUDGET {
            self.logged_bytes += line.len();
            out.push(StderrOutput::Line(line));
        } else if !self.budget_exhausted {
            self.budget_exhausted = true;
            out.push(StderrOutput::BudgetExhausted);
        }
    }

    fn tail(&self) -> String {
        self.tail.iter().map(String::as_str).collect::<Vec<_>>().join("\n")
    }
}

fn log_stderr(outputs: Vec<StderrOutput>) {
    for output in outputs {
        match output {
            StderrOutput::Line(line) => {
                tracing::warn!(target: "ielts_agent_runtime::stderr", "{line}");
            }
            StderrOutput::BudgetExhausted => tracing::warn!(
                target: "ielts_agent_runtime::stderr",
                budget_bytes = STDERR_LOG_BUDGET,
                "Python cognitive runtime stderr exceeded its log budget; further lines are not logged",
            ),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMetrics {
    starts: u64,
    crashes: u64,
    unavailable: u64,
    forced_shutdowns: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub state: RuntimeState,
    pub build_id: Option<String>,
    pub runtime_version: Option<String>,
    pub capabilities: BTreeMap<String, String>,
    pub metrics: RuntimeMetrics,
}

#[derive(Default)]
struct RuntimeProcess {
    lifecycle: RuntimeLifecycle,
    child: Option<CommandChild>,
    pending: BTreeMap<String, PendingRequest>,
    active_run: Option<Arc<ActiveRun>>,
    generation: u64,
    termination: Option<Arc<Notify>>,
    metrics: RuntimeMetrics,
    restart: RestartBackoff,
}

#[derive(Clone)]
pub struct RuntimeManager {
    inner: Arc<Mutex<RuntimeProcess>>,
    lifecycle_operation: Arc<Mutex<()>>,
    request_operation: Arc<Mutex<()>>,
}

impl Default for RuntimeManager {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(RuntimeProcess::default())),
            lifecycle_operation: Arc::new(Mutex::new(())),
            request_operation: Arc::new(Mutex::new(())),
        }
    }
}

fn validate_local_rpc_user(value: &Value) -> Result<(), RuntimeHostError> {
    match value {
        Value::Object(fields) => {
            for (key, value) in fields {
                if matches!(key.as_str(), "userId" | "user_id") && value.as_str() != Some("local") {
                    return Err(RuntimeHostError::InvalidResponse("RPC user differs from host-owned local user".into()));
                }
                validate_local_rpc_user(value)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                validate_local_rpc_user(value)?;
            }
        }
        _ => {},
    }
    Ok(())
}

#[cfg(feature = "context-compiler-v1")]
fn local_learning_evidence(
    conn: &rusqlite::Connection,
    ids: &[String],
) -> ielts_db::DbResult<ielts_domain::LearningEventEvidenceBatch> {
    if ids.len() > 200 {
        return Err(ielts_db::DbError::Validation("too many evidence ids".into()));
    }
    for id in ids {
        let foreign: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM learning_events WHERE id=?1 AND user_id!='local')",
            [id], |row| row.get(0),
        )?;
        if foreign {
            return Err(ielts_db::DbError::Validation("evidence differs from host-owned local user".into()));
        }
    }
    ielts_db::learning_events_by_ids(conn, ids)
}

struct PendingRequest {
    trace_id: String,
    sender: oneshot::Sender<Result<Value, RuntimeHostError>>,
}

struct ActiveRun {
    kind: RunKind,
    trace_id: String,
    candidate_input: Value,
    generation: u64,
    deadline: Instant,
}

/// Selected exclusively from the method sent by the host, never sidecar params.
/// `WeeklyDream` is only ever started by the host's weekly worker; it may
/// read the weekly pack, call the model and submit its digest and memory
/// mutations for host validation, and nothing else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RunKind {
    MemoryCandidate,
    #[cfg(feature = "daily-dream-v1")]
    WeeklyDream,
    #[cfg(feature = "agent-threads-v1")]
    StudyPlanner,
}

impl RunKind {
    /// Fixed label of this run's prompt-cache key (see `sidecar_cache_key`).
    fn cache_purpose(self) -> &'static str {
        match self {
            Self::MemoryCandidate => "memory-candidate",
            #[cfg(feature = "daily-dream-v1")]
            Self::WeeklyDream => "dream-weekly",
            #[cfg(feature = "agent-threads-v1")]
            Self::StudyPlanner => "study-planner",
        }
    }

    fn from_host_method(method: &str) -> Result<Self, RuntimeHostError> {
        match method {
            "memory.candidates.generate" => Ok(Self::MemoryCandidate),
            #[cfg(feature = "daily-dream-v1")]
            "dream.weekly" => Ok(Self::WeeklyDream),
            #[cfg(feature = "agent-threads-v1")]
            "planner.study_plan" => Ok(Self::StudyPlanner),
            _ => Err(RuntimeHostError::InvalidResponse(format!(
                "unsupported cognitive host method: {method}"
            ))),
        }
    }

    fn allows(self, method: &str) -> bool {
        // Feature-disabled routes and unknown methods also fail closed.
        if is_host_only_method(method)
            || !PROVIDED_HOST_CAPABILITIES.iter().any(|(name, _)| *name == method)
        {
            return false;
        }
        match self {
            Self::MemoryCandidate => matches!(method,
                "tool.invoke" | "model.invoke" | "learning.learner_skill_state"
                | "memory.search_active" | "learning.evidence_by_ids"),
            #[cfg(feature = "daily-dream-v1")]
            Self::WeeklyDream => matches!(method,
                "learning.weekly_pack" | "model.invoke" | "dream.run_weekly"),
            #[cfg(feature = "agent-threads-v1")]
            Self::StudyPlanner => matches!(method,
                "learning.learner_skill_state" | "memory.search_active" | "study_plan.create"),
        }
    }
}

impl RunKind {
    /// Wall-clock budget of one run of this kind.
    fn budget(self) -> Duration {
        match self {
            #[cfg(feature = "daily-dream-v1")]
            Self::WeeklyDream => WEEKLY_REQUEST_TIMEOUT,
            _ => COGNITIVE_REQUEST_TIMEOUT,
        }
    }

    /// Transport retries the model gateway may spend inside ONE `model.invoke`.
    /// A run that owns a semantic retry loop (the weekly orchestrator retries on
    /// provider errors and on malformed output) takes none here, so the two
    /// layers never multiply: the weekly run makes at most 3 provider requests.
    fn model_transport_retries(self) -> u32 {
        match self {
            #[cfg(feature = "daily-dream-v1")]
            Self::WeeklyDream => 0,
            _ => crate::ai::MAX_RETRIES,
        }
    }
}

impl ActiveRun {
    fn new(host_method: &str, trace_id: &str, candidate_input: Value, generation: u64)
        -> Result<Self, RuntimeHostError>
    {
        let kind = RunKind::from_host_method(host_method)?;
        Ok(Self {
            kind,
            trace_id: trace_id.to_owned(),
            candidate_input,
            generation,
            deadline: Instant::now() + kind.budget(),
        })
    }
}

pub(crate) struct RuntimeReservation {
    manager: RuntimeManager,
    _guard: OwnedMutexGuard<()>,
    active: bool,
}

impl RuntimeReservation {
    fn arm(&mut self) {
        self.active = true;
    }

    fn complete(&mut self) {
        self.active = false;
    }
}

impl Drop for RuntimeReservation {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        let manager = self.manager.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = manager.force_stop_inner().await {
                tracing::warn!(%error, "failed to cancel dropped Python cognitive run");
            }
        });
    }
}

impl RuntimeManager {
    pub(crate) async fn start(&self, app: &AppHandle) -> Result<(), RuntimeHostError> {
        let _operation = self.lifecycle_operation.lock().await;
        if self.inner.lock().await.lifecycle.state() == RuntimeState::Ready {
            return Ok(());
        }
        self.inner.lock().await.restart.check(Instant::now())?;
        verify_sidecar_hash()?;
        let generation = {
            let mut process = self.inner.lock().await;
            process.lifecycle.begin_start()?;
            process.generation += 1;
            process.metrics.starts += 1;
            process.generation
        };
        let mut command = app
            .shell()
            .sidecar(SIDECAR_NAME)
            .map_err(|error| RuntimeHostError::Process(error.to_string()))?
            .env_clear()
            .env("IELTS_AGENT_BUILD_ID", SIDECAR_BUILD_ID);
        for key in ["SystemRoot", "WINDIR", "TEMP", "TMP"] {
            if let Some(value) = std::env::var_os(key) {
                command = command.env(key, value);
            }
        }
        let spawned = command.set_raw_out(true).spawn();
        let (mut events, child) = match spawned {
            Ok(value) => value,
            Err(error) => {
                self.mark_unavailable().await;
                return Err(RuntimeHostError::Process(error.to_string()));
            }
        };
        {
            let mut process = self.inner.lock().await;
            process.child = Some(child);
            process.termination = Some(Arc::new(Notify::new()));
        }
        let manager = self.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut stdout = Vec::new();
            let mut stderr = StderrCapture::default();
            while let Some(event) = events.recv().await {
                manager.handle_event(&app, generation, event, &mut stdout, &mut stderr).await;
            }
        });

        let startup = async {
            let handshake = tokio::time::timeout(
            START_TIMEOUT,
            self.request_internal(
                "runtime.handshake",
                {
                    let mut host_capabilities = json!({
                        "model.invoke": "1",
                        "tool.invoke": "1"
                    });
                    #[cfg(feature = "context-compiler-v1")]
                    {
                        let caps = host_capabilities.as_object_mut().expect("object");
                        for (capability, version) in PROVIDED_HOST_CAPABILITIES {
                            caps.insert((*capability).to_string(), json!(version));
                        }
                    }
                    json!({
                        "hostProtocolVersion": PROTOCOL_VERSION,
                        "requestedCapabilities": REQUIRED_RUNTIME_CAPABILITIES
                            .iter()
                            .map(|(name, _)| *name)
                            .collect::<Vec<_>>(),
                        "hostCapabilities": host_capabilities,
                    })
                },
                None,
                &[RuntimeState::Starting],
                START_TIMEOUT,
            ),
        )
        .await
        .map_err(|_| RuntimeHostError::Timeout)??;
            let handshake: RuntimeHandshake = serde_json::from_value(handshake)
                .map_err(|error| RuntimeHostError::InvalidResponse(error.to_string()))?;
            {
                let mut process = self.inner.lock().await;
                if process.generation != generation {
                    return Err(RuntimeHostError::Process("sidecar generation changed during startup".into()));
                }
                process.lifecycle.accept_handshake(
                    handshake,
                    Some(SIDECAR_BUILD_ID),
                    REQUIRED_RUNTIME_CAPABILITIES,
                )?;
            }
            let health = self
                .request_internal(
                    "runtime.health",
                    json!({}),
                    None,
                    &[RuntimeState::Starting],
                    REQUEST_TIMEOUT,
                )
                .await?;
            if health.get("state").and_then(Value::as_str) != Some("ready") {
                return Err(RuntimeHostError::InvalidResponse(
                    "health response did not report ready".into(),
                ));
            }
            let mut process = self.inner.lock().await;
            if process.generation != generation {
                return Err(RuntimeHostError::Process("sidecar generation changed during startup".into()));
            }
            process.lifecycle.mark_ready()?;
            process.restart.reset();
            Ok(())
        }
        .await;
        if let Err(error) = startup {
            self.fail_start(generation).await;
            return Err(error);
        }
        Ok(())
    }

    pub(crate) async fn health(&self) -> Result<RuntimeStatus, RuntimeHostError> {
        let state = self.inner.lock().await.lifecycle.state();
        if state != RuntimeState::Ready {
            return Ok(self.status().await);
        }
        let response = self.request("runtime.health", json!({})).await?;
        if response.get("state").and_then(Value::as_str) != Some("ready") {
            return Err(RuntimeHostError::InvalidResponse(
                "health response did not report ready".into(),
            ));
        }
        Ok(self.status().await)
    }

    pub(crate) async fn request(
        &self,
        method: &str,
        params: Value,
    ) -> Result<Value, RuntimeHostError> {
        let _request = self
            .request_operation
            .clone()
            .try_lock_owned()
            .map_err(|_| RuntimeHostError::Busy)?;
        self.request_internal(
            method,
            params,
            None,
            &[RuntimeState::Ready],
            REQUEST_TIMEOUT,
        )
        .await
    }

    pub(crate) async fn reserve_generation(
        &self,
        app: &AppHandle,
    ) -> Result<RuntimeReservation, RuntimeHostError> {
        self.start(app).await?;
        let guard = self
            .request_operation
            .clone()
            .try_lock_owned()
            .map_err(|_| RuntimeHostError::Busy)?;
        Ok(RuntimeReservation {
            manager: self.clone(),
            _guard: guard,
            active: false,
        })
    }

    #[cfg(feature = "developer-tools")]
    pub(crate) async fn generate_memory_candidates(
        &self,
        reservation: &mut RuntimeReservation,
        trace_id: &str,
        candidate_input: Value,
        max_candidates: u32,
    ) -> Result<Value, RuntimeHostError> {
        let host_method = "memory.candidates.generate";
        let active = {
            let mut process = self.inner.lock().await;
            if process.active_run.is_some() {
                return Err(RuntimeHostError::Busy);
            }
            let active = Arc::new(ActiveRun::new(
                host_method, trace_id, candidate_input, process.generation,
            )?);
            process.active_run = Some(active.clone());
            active
        };
        reservation.arm();
        let result = self
            .request_internal(
                host_method,
                json!({"maxCandidates": max_candidates}),
                Some(trace_id),
                &[RuntimeState::Ready],
                COGNITIVE_REQUEST_TIMEOUT,
            )
            .await;
        drop(active);
        self.inner.lock().await.active_run = None;
        reservation.complete();
        if matches!(result, Err(RuntimeHostError::Timeout)) {
            self.force_stop_inner().await?;
        }
        result
    }

    /// The single weekly consolidation call: the sidecar reads the host-bounded
    /// candidate pool, makes one model call (retried by the sidecar, at most 3
    /// calls) and submits patterns that the host re-validates by stable memory
    /// id. `binding` carries the host-owned window token and the worker identity.
    #[cfg(feature = "daily-dream-v1")]
    pub(crate) async fn run_weekly_dream(
        &self,
        reservation: &mut RuntimeReservation,
        trace_id: &str,
        window: &ielts_db::WeeklyWindow,
        binding: Value,
    ) -> Result<Value, RuntimeHostError> {
        self.run_bound_dream(reservation, "dream.weekly", trace_id, json!({ "window": window.token() }), binding).await
    }

    #[cfg(feature = "daily-dream-v1")]
    async fn run_bound_dream(
        &self,
        reservation: &mut RuntimeReservation,
        host_method: &str,
        trace_id: &str,
        params: Value,
        binding: Value,
    ) -> Result<Value, RuntimeHostError> {
        let active = {
            let mut process = self.inner.lock().await;
            if process.active_run.is_some() {
                return Err(RuntimeHostError::Busy);
            }
            let active = Arc::new(ActiveRun::new(
                host_method, trace_id, binding, process.generation,
            )?);
            process.active_run = Some(active.clone());
            active
        };
        reservation.arm();
        let result = self
            .request_internal(
                host_method,
                params,
                Some(trace_id),
                &[RuntimeState::Ready],
                active.kind.budget(),
            )
            .await;
        drop(active);
        self.inner.lock().await.active_run = None;
        reservation.complete();
        if matches!(result, Err(RuntimeHostError::Timeout)) {
            self.force_stop_inner().await?;
        }
        result
    }

    /// M12-04: drive one deterministic study-planner pass in the Python
    /// sidecar. The orchestrator submits its proposal via the
    /// ``study_plan.create`` reverse-RPC (Rust persists); the reply carries
    /// the host-assigned planId inside the proposal wire.
    #[cfg(feature = "agent-threads-v1")]
    pub(crate) async fn run_study_planner(
        &self,
        reservation: &mut RuntimeReservation,
        trace_id: &str,
        planner_input: Value,
    ) -> Result<Value, RuntimeHostError> {
        let host_method = "planner.study_plan";
        let active = {
            let mut process = self.inner.lock().await;
            if process.active_run.is_some() {
                return Err(RuntimeHostError::Busy);
            }
            let active = Arc::new(ActiveRun::new(
                host_method, trace_id, planner_input.clone(), process.generation,
            )?);
            process.active_run = Some(active.clone());
            active
        };
        reservation.arm();
        let result = self
            .request_internal(
                host_method,
                json!({ "plannerInput": planner_input }),
                Some(trace_id),
                &[RuntimeState::Ready],
                COGNITIVE_REQUEST_TIMEOUT,
            )
            .await;
        drop(active);
        self.inner.lock().await.active_run = None;
        reservation.complete();
        if matches!(result, Err(RuntimeHostError::Timeout)) {
            self.force_stop_inner().await?;
        }
        result
    }

    async fn request_internal(
        &self,
        method: &str,
        params: Value,
        trace_id: Option<&str>,
        allowed_states: &[RuntimeState],
        timeout: Duration,
    ) -> Result<Value, RuntimeHostError> {
        let request_id = format!(
            "host-{}",
            REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let trace_id = trace_id.unwrap_or(&request_id).to_owned();
        let request = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "requestId": request_id,
            "traceId": trace_id,
            "deadlineMs": timeout.as_millis() as u64,
            "method": method,
            "params": params,
        });
        let frame = encode_frame(&request)?;
        let (sender, receiver) = oneshot::channel();
        {
            let mut process = self.inner.lock().await;
            let state = process.lifecycle.state();
            if !allowed_states.contains(&state) {
                return Err(RuntimeHostError::InvalidState(state));
            }
            process.pending.insert(
                request_id.clone(),
                PendingRequest {
                    trace_id,
                    sender,
                },
            );
            let child = process
                .child
                .as_mut()
                .ok_or_else(|| RuntimeHostError::Process("sidecar is not running".into()))?;
            if let Err(error) = child.write(&frame) {
                process.pending.remove(&request_id);
                return Err(RuntimeHostError::Process(error.to_string()));
            }
        }
        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => Err(RuntimeHostError::Process("sidecar response channel closed".into())),
            Err(_) => {
                self.inner.lock().await.pending.remove(&request_id);
                Err(RuntimeHostError::Timeout)
            }
        }
    }

    /// Explicit stop (developer restart command, app exit). Clears the
    /// crash-loop guard so the next start is not held back by old failures.
    pub(crate) async fn shutdown(&self) -> Result<(), RuntimeHostError> {
        self.inner.lock().await.restart.reset();
        let request_guard = match self.request_operation.clone().try_lock_owned() {
            Ok(guard) => guard,
            Err(_) => return self.force_stop_inner().await,
        };
        let _operation = self.lifecycle_operation.lock().await;
        let termination = {
            let mut process = self.inner.lock().await;
            if process.child.is_none() {
                process.lifecycle.shutdown();
                return Ok(());
            }
            process.lifecycle.begin_shutdown()?;
            process.termination.clone()
        };
        let response = self
            .request_internal(
                "runtime.shutdown",
                json!({}),
                None,
                &[RuntimeState::Stopping],
                SHUTDOWN_TIMEOUT,
            )
            .await;
        if response.is_err() {
            self.force_stop_inner().await?;
            return response.map(|_| ());
        }
        if let Some(termination) = termination {
            if tokio::time::timeout(SHUTDOWN_TIMEOUT, termination.notified())
                .await
                .is_err()
            {
                self.force_stop_inner().await?;
            }
        }
        drop(request_guard);
        Ok(())
    }

    pub(crate) async fn status(&self) -> RuntimeStatus {
        let process = self.inner.lock().await;
        let handshake = process.lifecycle.handshake();
        RuntimeStatus {
            state: process.lifecycle.state(),
            build_id: handshake.map(|item| item.build_id.clone()),
            runtime_version: handshake.map(|item| item.runtime_version.clone()),
            capabilities: handshake
                .map(|item| item.capabilities.clone())
                .unwrap_or_default(),
            metrics: process.metrics.clone(),
        }
    }

    pub(crate) async fn cancel(&self) -> Result<(), RuntimeHostError> {
        let child = {
            let mut process = self.inner.lock().await;
            if process.active_run.is_none() {
                return Err(RuntimeHostError::InvalidResponse(
                    "no cognitive run is active".into(),
                ));
            }
            process.generation = process.generation.saturating_add(1);
            let child = process.child.take();
            if child.is_some() {
                process.metrics.forced_shutdowns += 1;
            }
            process.lifecycle.shutdown();
            process.termination = None;
            process.active_run = None;
            for (_, pending) in std::mem::take(&mut process.pending) {
                let _ = pending.sender.send(Err(RuntimeHostError::Cancelled));
            }
            child
        };
        child
            .map(|child| child.kill().map_err(|error| RuntimeHostError::Process(error.to_string())))
            .unwrap_or(Ok(()))
    }

    async fn handle_event(
        &self,
        app: &AppHandle,
        generation: u64,
        event: CommandEvent,
        stdout: &mut Vec<u8>,
        stderr: &mut StderrCapture,
    ) {
        match event {
            CommandEvent::Stdout(bytes) => {
                stdout.extend_from_slice(&bytes);
                loop {
                    match decode_frame(stdout) {
                        Ok(Some((value, consumed))) => {
                            stdout.drain(..consumed);
                            self.route_message(app, generation, value).await;
                        }
                        Ok(None) => break,
                        Err(error) => {
                            tracing::error!(%error, "invalid frame from Python cognitive runtime");
                            self.mark_crashed(generation).await;
                            return;
                        }
                    }
                }
            }
            CommandEvent::Stderr(bytes) => log_stderr(stderr.push(&bytes)),
            CommandEvent::Error(error) => {
                tracing::error!(%error, "Python cognitive runtime process error");
                self.mark_crashed(generation).await;
            }
            CommandEvent::Terminated(payload) => {
                log_stderr(stderr.finish());
                let stderr_tail = stderr.tail();
                let mut process = self.inner.lock().await;
                if process.generation != generation {
                    tracing::info!(code = ?payload.code, signal = ?payload.signal, %stderr_tail, "stopped Python cognitive runtime exited");
                    return;
                }
                process.child = None;
                process.active_run = None;
                fail_pending(&mut process, "sidecar terminated");
                let termination = process.termination.take();
                if process.lifecycle.state() == RuntimeState::Stopping {
                    process.lifecycle.shutdown();
                    tracing::info!(code = ?payload.code, signal = ?payload.signal, %stderr_tail, "Python cognitive runtime exited");
                } else {
                    if !matches!(
                        process.lifecycle.state(),
                        RuntimeState::Crashed | RuntimeState::Unavailable
                    ) {
                        process.lifecycle.mark_crashed();
                        process.metrics.crashes += 1;
                    }
                    process.restart.record_failure(generation, Instant::now());
                    tracing::error!(
                        code = ?payload.code,
                        signal = ?payload.signal,
                        consecutive_failures = process.restart.consecutive_failures,
                        %stderr_tail,
                        "Python cognitive runtime crashed",
                    );
                }
                drop(process);
                if let Some(termination) = termination {
                    termination.notify_one();
                }
            }
            _ => {}
        }
    }

    async fn route_message(&self, app: &AppHandle, generation: u64, value: Value) {
        if value.get("method").and_then(Value::as_str).is_some() {
            let response = self.handle_host_request(app, generation, &value).await;
            if let Err(error) = self.write_to_child(generation, &response).await {
                tracing::error!(%error, "failed to respond to Python host request");
                self.mark_crashed(generation).await;
            }
            return;
        }
        self.route_response(generation, value).await;
    }

    async fn route_response(&self, generation: u64, value: Value) {
        let Some(request_id) = value.get("requestId").and_then(Value::as_str) else {
            self.mark_crashed(generation).await;
            return;
        };
        let pending = {
            let mut process = self.inner.lock().await;
            if process.generation != generation {
                return;
            }
            process.pending.remove(request_id)
        };
        let Some(pending) = pending else {
            return;
        };
        let identity_valid = value.get("protocolVersion").and_then(Value::as_u64)
            == Some(PROTOCOL_VERSION.into())
            && value.get("traceId").and_then(Value::as_str) == Some(&pending.trace_id);
        let response = if !identity_valid {
            Err(RuntimeHostError::InvalidResponse(
                "response protocol or trace identity mismatch".into(),
            ))
        } else if value.get("ok").and_then(Value::as_bool) == Some(true) {
            value
                .get("result")
                .cloned()
                .ok_or_else(|| RuntimeHostError::InvalidResponse("missing result".into()))
        } else {
            Err(RuntimeHostError::InvalidResponse(
                value
                    .get("error")
                    .map(Value::to_string)
                    .unwrap_or_else(|| "missing error envelope".into()),
            ))
        };
        let _ = pending.sender.send(response);
    }

    async fn handle_host_request(
        &self,
        app: &AppHandle,
        generation: u64,
        value: &Value,
    ) -> Value {
        let request_id = value.get("requestId").and_then(Value::as_str).unwrap_or("");
        let trace_id = value.get("traceId").and_then(Value::as_str).unwrap_or("");
        let response = self
            .dispatch_host_request(app, generation, trace_id, value)
            .await;
        match response {
            Ok(result) => json!({
                "protocolVersion": PROTOCOL_VERSION,
                "requestId": request_id,
                "traceId": trace_id,
                "ok": true,
                "result": result,
            }),
            Err(error) => json!({
                "protocolVersion": PROTOCOL_VERSION,
                "requestId": request_id,
                "traceId": trace_id,
                "ok": false,
                "error": {
                    "code": "host_request_failed",
                    "message": error.to_string(),
                    "retryable": matches!(
                        error,
                        RuntimeHostError::Timeout | RuntimeHostError::Provider { retryable: true, .. }
                    ),
                    "details": {}
                }
            }),
        }
    }

    /// Pure pre-routing gate: no AppHandle, DB access, tool audit, or provider.
    /// All reverse-RPC routes must pass this host-owned run authorization first.
    async fn authorize_host_request(
        &self,
        generation: u64,
        trace_id: &str,
        value: &Value,
    ) -> Result<(Arc<ActiveRun>, Duration), RuntimeHostError> {
        if value.get("protocolVersion").and_then(Value::as_u64)
            != Some(PROTOCOL_VERSION.into())
        {
            return Err(RuntimeHostError::ProtocolVersionMismatch {
                expected: PROTOCOL_VERSION,
                actual: value
                    .get("protocolVersion")
                    .and_then(Value::as_u64)
                    .unwrap_or_default() as u32,
            });
        }
        let deadline_ms = value
            .get("deadlineMs")
            .and_then(Value::as_u64)
            .filter(|value| *value > 0)
            .ok_or(RuntimeHostError::Timeout)?;
        let active = {
            let process = self.inner.lock().await;
            if process.generation != generation {
                return Err(RuntimeHostError::Process("stale sidecar generation".into()));
            }
            process.active_run.clone()
        }
        .ok_or_else(|| RuntimeHostError::InvalidResponse("no active cognitive run".into()))?;
        if active.trace_id != trace_id {
            return Err(RuntimeHostError::InvalidResponse(
                "host request trace does not match active run".into(),
            ));
        }
        if active.generation != generation {
            return Err(RuntimeHostError::Process("active run generation mismatch".into()));
        }
        let remaining = active
            .deadline
            .checked_duration_since(Instant::now())
            .ok_or(RuntimeHostError::Timeout)?;
        let request_budget = remaining.min(Duration::from_millis(deadline_ms));
        let method = value.get("method").and_then(Value::as_str)
            .ok_or_else(|| RuntimeHostError::InvalidResponse("host method is missing".into()))?;
        if !active.kind.allows(method) {
            return Err(RuntimeHostError::InvalidResponse(format!(
                "host method is not allowed for {:?}: {method}", active.kind
            )));
        }
        let params = value
            .get("params")
            .and_then(Value::as_object)
            .ok_or_else(|| RuntimeHostError::InvalidResponse("host params must be an object".into()))?;
        validate_local_rpc_user(&Value::Object(params.clone()))?;
        // The weekly window is host-owned: the sidecar cannot widen the pool or
        // attribute a run to another week.
        #[cfg(feature = "daily-dream-v1")]
        if matches!(active.kind, RunKind::WeeklyDream) && method != "model.invoke" {
            let window = params.get("window").and_then(Value::as_str);
            let user = params.get("userId").and_then(Value::as_str).unwrap_or("local");
            if window.is_none() || window != active.candidate_input.get("window").and_then(Value::as_str) || user != "local" {
                return Err(RuntimeHostError::InvalidResponse("weekly RPC user/window differs from host-owned run".into()));
            }
        }
        Ok((active, request_budget))
    }

    async fn dispatch_host_request(
        &self,
        app: &AppHandle,
        generation: u64,
        trace_id: &str,
        value: &Value,
    ) -> Result<Value, RuntimeHostError> {
        let (active, request_budget) = self.authorize_host_request(generation, trace_id, value).await?;
        let params = value.get("params").and_then(Value::as_object)
            .expect("params validated by pre-routing authorization");
        match value.get("method").and_then(Value::as_str) {
            Some("tool.invoke") => self.invoke_candidate_input_tool(app, trace_id, params, &active).await,
            Some("model.invoke") => {
                self.invoke_model(app, params, request_budget, active.kind).await
            }
            #[cfg(feature = "context-compiler-v1")]
            Some(method @ ("learning.learner_skill_state"
                | "memory.search_active"
                | "learning.evidence_by_ids")) => {
                self.invoke_learner_memory_reads(app, method, params).await
            }
            #[cfg(feature = "daily-dream-v1")]
            Some(method @ ("dream.run_weekly" | "learning.weekly_pack")) => {
                self.invoke_journal_dream(app, method, params, &active).await
            }
            #[cfg(feature = "agent-threads-v1")]
            Some("study_plan.create") => self.invoke_study_plan_create(app, params).await,
            Some(method) => Err(RuntimeHostError::InvalidResponse(format!(
                "unsupported host method: {method}"
            ))),
            None => Err(RuntimeHostError::InvalidResponse("host method is missing".into())),
        }
    }

    /// M6-02: serve the three bounded read-only learning/memory tools.
    ///
    /// Python asks Rust for a bounded learner-skill snapshot, active memory
    /// preview, or learning-event evidence by IDs. Rust is the authority: each
    /// tool delegates to an existing bounded store method, applies a 64 KiB
    /// response ceiling, and never exposes a DB handle. Audit summaries do not
    /// copy canonical body text — only derived DTOs leave the host.
    #[cfg(feature = "context-compiler-v1")]
    async fn invoke_learner_memory_reads(
        &self,
        app: &AppHandle,
        method: &str,
        params: &serde_json::Map<String, Value>,
    ) -> Result<Value, RuntimeHostError> {
        use ielts_application::MemoryService;
        use ielts_domain::{LearnerStateQuery, MemoryContextQuery};

        const READ_TOOL_RESPONSE_BYTES: usize = 64 * 1024;

        let db = app.state::<AppDb>();
        let store = crate::app::application_store::ApplicationStore::new(db.inner());
        let result: Result<Value, String> = match method {
            "learning.learner_skill_state" => {
                match serde_json::from_value::<LearnerStateQuery>(
                    params.get("query").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(query) => {
                        // State and review needs share one fresh transaction,
                        // one user and one skill page. Projection errors are
                        // failures, not a fabricated "nothing needs review".
                        db.with_conn(|conn| ielts_db::learner_skill_snapshot(conn, &query))
                            .map_err(|error| error.to_string())
                            .and_then(|snapshot| {
                                serde_json::to_value(snapshot).map_err(|error| error.to_string())
                            })
                    }
                    Err(error) => Err(error.to_string()),
                }
            }
            "memory.search_active" => {
                match serde_json::from_value::<MemoryContextQuery>(
                    params.get("query").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(query) => serialize_result(
                        MemoryService::new(&store).context_preview(&query),
                    ),
                    Err(error) => Err(error.to_string()),
                }
            }
            "learning.evidence_by_ids" => {
                (|| -> Result<Value, String> { match params.get("ids").and_then(Value::as_array) {
                    Some(array) => {
                        let ids = array
                            .iter()
                            .map(|id| id.as_str().map(str::to_owned).ok_or_else(|| "evidence ids must be strings".to_string()))
                            .collect::<Result<Vec<_>, _>>()?;
                        db.with_conn(|conn| local_learning_evidence(conn, &ids))
                            .map_err(|error| error.to_string())
                            .and_then(|batch| serde_json::to_value(batch).map_err(|error| error.to_string()))
                    }
                    None => Err("evidence ids must be an array".to_string()),
                } })()
            }
            other => Err(format!("unsupported learner/memory read method: {other}")),
        };
        let value = result.map_err(RuntimeHostError::InvalidResponse)?;
        let size = serde_json::to_vec(&value)
            .map_err(|error| RuntimeHostError::InvalidResponse(error.to_string()))?
            .len();
        if size > READ_TOOL_RESPONSE_BYTES {
            return Err(RuntimeHostError::InvalidResponse(format!(
                "read tool response exceeds {READ_TOOL_RESPONSE_BYTES} bytes"
            )));
        }
        Ok(value)
    }

    /// Serve the weekly-dream reverse-RPC: the weekly pack and the submission of
    /// the digest and memory mutations.
    ///
    /// Rust is the authority. The window is the host-issued token of the active
    /// run (`authorize_host_request` already pinned the sidecar's `window` to it);
    /// mutations are admitted only if they cite the pack's own observation ids and
    /// target the pack's own memories, then pass the cognitive-proposal gate and are
    /// applied without any delete. The daily journal is deterministic and has no
    /// sidecar involvement.
    #[cfg(feature = "daily-dream-v1")]
    async fn invoke_journal_dream<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        method: &str,
        params: &serde_json::Map<String, Value>,
        active: &ActiveRun,
    ) -> Result<Value, RuntimeHostError> {
        use ielts_application::JournalService;
        use ielts_domain::{DailyJournalQuery, WeeklyDreamQuery};

        const JOURNAL_DREAM_RESPONSE_BYTES: usize = 256 * 1024;

        let db = app.state::<AppDb>();
        let store = crate::app::application_store::ApplicationStore::new(db.inner());
        if active.candidate_input.get("workerId").and_then(Value::as_str)
            .is_some_and(|worker| worker.starts_with("daily-worker-"))
            && !db.with_conn(ielts_db::background_jobs::automatic_learning_enabled)
                .map_err(|error| RuntimeHostError::InvalidResponse(error.to_string()))? {
            return Err(RuntimeHostError::Cancelled);
        }
        let window = active.candidate_input.get("window").and_then(Value::as_str)
            .and_then(ielts_db::WeeklyWindow::parse)
            .ok_or_else(|| RuntimeHostError::InvalidResponse("weekly run has no valid host-owned window".into()))?;
        let result: Result<Value, String> = match method {
            // The preflight validates the digest against the facts of the
            // host-owned window without creating anything: no journal, no run,
            // no report. It must be answered before the write path touches the
            // database, so the sidecar's one repair pass cannot cause a run.
            "dream.run_weekly" if params.get("validateOnly").and_then(Value::as_bool) == Some(true) => {
                weekly_validate_only(db.inner(), &window, params)
            }
            "dream.run_weekly" => {
                // The run row is FK-anchored on the journal of the window's end
                // day, resolved the same way the daily worker does.
                let journal_service = JournalService::new(&store);
                (|| -> Result<Value, String> {
                    let user_id = params
                        .get("userId")
                        .and_then(Value::as_str)
                        .unwrap_or("local")
                        .to_string();
                    let journal_query = DailyJournalQuery {
                        user_id: user_id.clone(),
                        journal_date: window.anchor_day(),
                    };
                    let journal = journal_service
                        .ensure_journal(&journal_query)
                        .map_err(|error| error.to_string())?;
                    let query = WeeklyDreamQuery {
                        user_id,
                        journal_id: journal.id,
                    };
                    let submission = crate::commands::journal::WeeklySubmission::from_params(params);
                    let outcome =
                        crate::commands::journal::run_weekly_consolidation(db.inner(), &query, submission, &window)
                            .map_err(|error| error.to_string())?;
                    Ok(json!({
                        "runId": outcome.run_id,
                        "validated": outcome.validated,
                        "rejected": outcome.rejected,
                        "accepted": outcome.accepted,
                    }))
                })()
            }
            "learning.weekly_pack" => {
                weekly_pack_value(db.inner(), &window).map_err(|error| error.to_string())
            }
            other => Err(format!("unsupported weekly dream method: {other}")),
        };
        let value = result.map_err(RuntimeHostError::InvalidResponse)?;
        let size = serde_json::to_vec(&value)
            .map_err(|error| RuntimeHostError::InvalidResponse(error.to_string()))?
            .len();
        if size > JOURNAL_DREAM_RESPONSE_BYTES {
            return Err(RuntimeHostError::InvalidResponse(format!(
                "journal/dream response exceeds {JOURNAL_DREAM_RESPONSE_BYTES} bytes"
            )));
        }
        Ok(value)
    }

    /// M12-04: serve `study_plan.create`, the only agent-thread reverse-RPC a
    /// run kind is allowed to reach. Rust is the controlled-action authority:
    /// the study plan is persisted here; Python owns planner orchestration.
    /// Forbidden action kinds are rejected by the `tool.invoke` dispatcher.
    #[cfg(feature = "agent-threads-v1")]
    async fn invoke_study_plan_create(
        &self,
        app: &AppHandle,
        params: &serde_json::Map<String, Value>,
    ) -> Result<Value, RuntimeHostError> {
        use ielts_application::AgentThreadService;
        use ielts_domain::CreateStudyPlanCommand;

        let db = app.state::<AppDb>();
        let store = crate::app::application_store::ApplicationStore::new(db.inner());
        // Preserve the full probe JSON in the existing TEXT column.
        // Return the envelope required by the Python orchestrator.
        let command = params
            .get("proposal")
            .ok_or_else(|| "study_plan.create requires proposal".to_string())
            .and_then(CreateStudyPlanCommand::from_planner_proposal)
            .map_err(RuntimeHostError::InvalidResponse)?;
        let plan = AgentThreadService::new(&store)
            .create_study_plan(&command)
            .map_err(|error| RuntimeHostError::InvalidResponse(error.message))?;
        Ok(json!({
            "planId": plan.id,
            "accepted": command.items.len(),
            "rejected": 0,
        }))
    }

    async fn invoke_candidate_input_tool(
        &self,
        app: &AppHandle,
        trace_id: &str,
        params: &serde_json::Map<String, Value>,
        active: &ActiveRun,
    ) -> Result<Value, RuntimeHostError> {
        // M11-06: online self-modifying prompt tools are explicitly denied.
        // The online Agent never edits its own Soul, system prompt, or
        // installs an unreviewed skill. This is the deny-list guard; the
        // allow-list below additionally restricts tool.invoke to the single
        // trusted `memory.candidate_input` tool.
        if let Some(name) = params.get("name").and_then(Value::as_str) {
            if ielts_domain::is_denied_self_modifying_tool(name) {
                return Err(RuntimeHostError::InvalidResponse(format!(
                    "online self-modifying tool is denied by Rust policy (M11-06): {name}"
                )));
            }
            // M12-06: forbidden controlled actions are never offered to the
            // agent. The reverse-RPC tool.invoke dispatcher rejects them
            // before any side effect, regardless of the allow-list below.
            if ielts_domain::is_forbidden_action_kind(name) {
                return Err(RuntimeHostError::InvalidResponse(format!(
                    "forbidden controlled action is denied by Rust policy (M12-06): {name}"
                )));
            }
        }
        if params.get("name").and_then(Value::as_str) != Some("memory.candidate_input") {
            return Err(RuntimeHostError::InvalidResponse(
                "tool is not allowed by Rust policy".into(),
            ));
        }
        if params.len() != 2 || !params.contains_key("arguments") || !params.contains_key("name") {
            return Err(RuntimeHostError::InvalidResponse(
                "tool request fields do not match policy schema".into(),
            ));
        }
        let expected_max = active
            .candidate_input
            .get("maxCandidates")
            .and_then(Value::as_u64)
            .ok_or_else(|| RuntimeHostError::InvalidResponse("trusted candidate limit is missing".into()))?;
        let arguments = params
            .get("arguments")
            .and_then(Value::as_object)
            .filter(|arguments| {
                arguments.len() == 1
                    && arguments.get("maxCandidates").and_then(Value::as_u64)
                        == Some(expected_max)
            })
            .ok_or_else(|| RuntimeHostError::InvalidResponse("tool arguments do not match trusted input".into()))?;
        let audited_arguments = json!({"maxCandidates": expected_max});
        debug_assert_eq!(arguments.len(), 1);
        let db = app.state::<AppDb>();
        let call_id = format!("{trace_id}:tool:1");
        db.with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            ielts_db::begin_agent_tool_call(
                &tx,
                &BeginAgentToolCallCommand {
                    run_id: trace_id.to_owned(),
                    call_id: call_id.clone(),
                    sequence: 1,
                    round: 1,
                    tool_name: "memory.candidate_input".into(),
                    arguments: audited_arguments,
                },
            )?;
            let observation_count = active
                .candidate_input
                .get("observations")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            ielts_db::finish_agent_tool_call(
                &tx,
                &FinishAgentToolCallCommand {
                    run_id: trace_id.to_owned(),
                    call_id,
                    sequence: 1,
                    status: StoredAgentToolStatus::Succeeded,
                    result: json!({"observationCount": observation_count}),
                    error: None,
                },
            )?;
            Ok(tx.commit()?)
        })
        .map_err(|error| RuntimeHostError::Process(error.to_string()))?;
        Ok(json!({"input": active.candidate_input}))
    }

    async fn invoke_model(
        &self,
        app: &AppHandle,
        params: &serde_json::Map<String, Value>,
        timeout: Duration,
        kind: RunKind,
    ) -> Result<Value, RuntimeHostError> {
        let request = params
            .get("request")
            .cloned()
            .ok_or_else(|| RuntimeHostError::InvalidResponse("model request is missing".into()))?;
        let mut request = parse_model_request(request, kind)?;
        apply_host_cache_key(kind, &mut request);
        let db = app.state::<AppDb>();
        let vault = app.state::<AppVault>();
        let runtime = load_runtime(&db, &vault)
            .map_err(|error| RuntimeHostError::Process(error.to_string()))?
            .with_transport_retries(kind.model_transport_retries());
        // The gateway already returns final content only (no reasoning), so the
        // sidecar can never receive chain-of-thought.
        let completion = tokio::time::timeout(timeout, runtime.complete_partial(request))
            .await
            .map_err(|_| RuntimeHostError::Timeout)?
            .map_err(|error| RuntimeHostError::Provider {
                message: error.message,
                retryable: error.retryable,
            })?;
        sidecar_completion_result(completion)
    }

    async fn write_to_child(
        &self,
        generation: u64,
        value: &Value,
    ) -> Result<(), RuntimeHostError> {
        let frame = encode_frame(value)?;
        let mut process = self.inner.lock().await;
        if process.generation != generation {
            return Err(RuntimeHostError::Process("stale sidecar generation".into()));
        }
        process
            .child
            .as_mut()
            .ok_or_else(|| RuntimeHostError::Process("sidecar is not running".into()))?
            .write(&frame)
            .map_err(|error| RuntimeHostError::Process(error.to_string()))
    }

    async fn mark_unavailable(&self) {
        let mut process = self.inner.lock().await;
        let generation = process.generation;
        process.restart.record_failure(generation, Instant::now());
        process.lifecycle.mark_unavailable();
        process.active_run = None;
        process.metrics.unavailable += 1;
        fail_pending(&mut process, "sidecar unavailable");
    }

    async fn mark_crashed(&self, generation: u64) {
        let mut process = self.inner.lock().await;
        if process.generation != generation {
            return;
        }
        if process.lifecycle.state() != RuntimeState::Crashed {
            process.lifecycle.mark_crashed();
            process.metrics.crashes += 1;
        }
        process.restart.record_failure(generation, Instant::now());
        process.active_run = None;
        fail_pending(&mut process, "sidecar crashed");
        if let Some(child) = process.child.take() {
            let _ = child.kill();
        }
    }

    async fn fail_start(&self, generation: u64) {
        let mut process = self.inner.lock().await;
        if process.generation != generation {
            return;
        }
        if let Some(child) = process.child.take() {
            let _ = child.kill();
        }
        process.termination = None;
        process.active_run = None;
        process.lifecycle.mark_unavailable();
        process.metrics.unavailable += 1;
        process.restart.record_failure(generation, Instant::now());
        fail_pending(&mut process, "sidecar startup failed");
    }

    async fn force_stop_inner(&self) -> Result<(), RuntimeHostError> {
        let child = {
            let mut process = self.inner.lock().await;
            process.generation = process.generation.saturating_add(1);
            let child = process.child.take();
            if child.is_some() {
                process.metrics.forced_shutdowns += 1;
            }
            process.lifecycle.shutdown();
            process.termination = None;
            process.active_run = None;
            fail_pending(&mut process, "sidecar stopped");
            child
        };
        child
            .map(|child| child.kill().map_err(|error| RuntimeHostError::Process(error.to_string())))
            .unwrap_or(Ok(()))
    }
}

fn fail_pending(process: &mut RuntimeProcess, message: &str) {
    for (_, pending) in std::mem::take(&mut process.pending) {
        let _ = pending
            .sender
            .send(Err(RuntimeHostError::Process(message.into())));
    }
}

/// Round-3 audit (A2): reverse-RPC methods the sidecar must never reach,
/// regardless of what the dispatch match happens to look like.
///
/// Each one is an authority operation: promotion and rollback activate or
/// reverse a live prompt version; `eval.run_case` persists caller-supplied
/// `passed` gradings and advances a candidate to `eval_passed`, which is the
/// sole precondition for approval; `approval.decide` is the human decision
/// itself, and its `approvedBy` is only checked for non-emptiness. The sidecar
/// is a derived runtime and may not grant any of them.
pub(crate) const HOST_ONLY_METHODS: &[&str] = &[
    "prompt.promote_candidate",
    "prompt.rollback",
    "eval.run_case",
    "approval.decide",
];

pub(crate) fn is_host_only_method(method: &str) -> bool {
    HOST_ONLY_METHODS.contains(&method)
}

/// Longest prompt-cache key the host will send for a sidecar call.
const MAX_SIDECAR_CACHE_KEY_LEN: usize = 64;

/// Prompt-cache routing key for a sidecar model call: the run kind plus its
/// system prompt. The sidecar builds that prompt from constants and persona
/// only, so repeated calls of one run kind share a key. The user payload (the
/// pack, the repair list) never enters it.
fn sidecar_cache_key(kind: RunKind, request: &CompletionRequest) -> Option<String> {
    let system = request.messages.first().filter(|message| message.role == "system")?;
    let key = ielts_application::prompt_cache_key(kind.cache_purpose(), &system.content);
    Some(key.chars().take(MAX_SIDECAR_CACHE_KEY_LEN).collect())
}

/// The host always decides the routing key of a sidecar call. A key the sidecar
/// supplied is overwritten, never kept.
fn apply_host_cache_key(kind: RunKind, request: &mut CompletionRequest) {
    request.cache_key = sidecar_cache_key(kind, request);
}

/// The sidecar's view of one completion. A cut-off reply is a normal result with
/// `truncated: true` and whatever text arrived, so the sidecar's own
/// malformed-output handling decides what it means. It is not a host error.
fn sidecar_completion_result(completion: PartialCompletion) -> Result<Value, RuntimeHostError> {
    let mut value = serde_json::to_value(completion.response)
        .map_err(|error| RuntimeHostError::InvalidResponse(error.to_string()))?;
    value["truncated"] = json!(completion.truncated);
    Ok(value)
}

/// A sidecar completion must declare `maxTokens` (serde rejects a missing
/// field), and the declared ceiling must pass `validate_model_request`.
fn parse_model_request(request: Value, kind: RunKind) -> Result<CompletionRequest, RuntimeHostError> {
    let request: CompletionRequest = serde_json::from_value(request)
        .map_err(|error| RuntimeHostError::InvalidResponse(format!("invalid model request: {error}")))?;
    validate_model_request(&request, kind)?;
    Ok(request)
}

fn validate_model_request(request: &CompletionRequest, kind: RunKind) -> Result<(), RuntimeHostError> {
    if request.messages.is_empty() || request.messages.len() > 4 {
        return Err(RuntimeHostError::InvalidResponse(
            "model request requires one to four messages".into(),
        ));
    }
    let bytes = request
        .messages
        .iter()
        .try_fold(0usize, |total, ChatMessage { role, content }| {
            if !matches!(role.as_str(), "system" | "user") {
                return Err(RuntimeHostError::InvalidResponse(
                    "model request role is not allowed".into(),
                ));
            }
            Ok(total.saturating_add(content.len()))
        })?;
    if bytes > MAX_FRAME_BYTES {
        return Err(RuntimeHostError::FrameTooLarge(bytes));
    }
    // The weekly narrative samples at the snapshot's 0.6; every other sidecar
    // call (memory candidates) stays deterministic at zero.
    #[cfg(feature = "daily-dream-v1")]
    if matches!(kind, RunKind::WeeklyDream) {
        if !(0.0..=1.0).contains(&request.temperature) {
            return Err(RuntimeHostError::InvalidResponse(
                "weekly model temperature must be between zero and one".into(),
            ));
        }
    } else if request.temperature != 0.0 {
        return Err(RuntimeHostError::InvalidResponse(
            "memory model temperature must be zero".into(),
        ));
    }
    #[cfg(not(feature = "daily-dream-v1"))]
    if request.temperature != 0.0 {
        return Err(RuntimeHostError::InvalidResponse(
            "memory model temperature must be zero".into(),
        ));
    }
    // `maxTokens` is required on the wire. Bound it here — an unbounded ceiling
    // defeats the point and a zero ceiling would make every sidecar completion
    // return empty.
    if request.max_tokens == 0 || request.max_tokens > SIDECAR_MAX_OUTPUT_TOKENS {
        return Err(RuntimeHostError::InvalidResponse(format!(
            "model request maxTokens must be between 1 and {SIDECAR_MAX_OUTPUT_TOKENS}"
        )));
    }
    Ok(())
}

pub(crate) fn verify_sidecar_hash() -> Result<(), RuntimeHostError> {
    verify_sidecar_bundled(SIDECAR_BUILD_ID)?;
    let path = sidecar_hash_path()?;
    let bytes = std::fs::read(&path)
        .map_err(|error| RuntimeHostError::Process(format!("cannot read {}: {error}", path.display())))?;
    let actual = hex::encode(Sha256::digest(bytes));
    if actual != SIDECAR_BUILD_ID {
        return Err(RuntimeHostError::BuildIdentityMismatch);
    }
    Ok(())
}

fn verify_sidecar_bundled(build_id: &str) -> Result<(), RuntimeHostError> {
    if build_id == SIDECAR_UNAVAILABLE_BUILD_ID {
        return Err(RuntimeHostError::SidecarNotBundled);
    }
    Ok(())
}

fn sidecar_hash_path() -> Result<PathBuf, RuntimeHostError> {
    let executable = std::env::current_exe()
        .map_err(|error| RuntimeHostError::Process(error.to_string()))?;
    let executable_dir = executable
        .parent()
        .ok_or_else(|| RuntimeHostError::Process("application executable has no parent".into()))?;
    let base_dir = if executable_dir.ends_with("deps") {
        executable_dir.parent().unwrap_or(executable_dir)
    } else {
        executable_dir
    };
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut path = base_dir.join(SIDECAR_NAME);
    #[cfg(windows)]
    path.as_mut_os_string().push(".exe");
    Ok(path)
}

pub(crate) fn validate_handshake(
    handshake: &RuntimeHandshake,
    expected_build_id: Option<&str>,
    required_capabilities: &[(&str, &str)],
) -> Result<(), RuntimeHostError> {
    if handshake.selected_protocol != PROTOCOL_VERSION {
        return Err(RuntimeHostError::ProtocolVersionMismatch {
            expected: PROTOCOL_VERSION,
            actual: handshake.selected_protocol,
        });
    }
    if expected_build_id.is_some_and(|expected| expected != handshake.build_id) {
        return Err(RuntimeHostError::BuildIdentityMismatch);
    }
    for (capability, expected_version) in required_capabilities {
        match handshake.capabilities.get(*capability) {
            None => return Err(RuntimeHostError::MissingCapability((*capability).into())),
            Some(actual) if actual != expected_version => {
                return Err(RuntimeHostError::CapabilityVersionMismatch {
                    capability: (*capability).into(),
                    expected: (*expected_version).into(),
                    actual: actual.clone(),
                })
            }
            Some(_) => {}
        }
    }
    let provided_host_capabilities = PROVIDED_HOST_CAPABILITIES
        .iter()
        .map(|(name, version)| ((*name).to_owned(), (*version).to_owned()))
        .collect::<BTreeMap<_, _>>();
    // Python's requiredHostCapabilities must be a subset of what Rust provides,
    // with matching versions. Retrieval/context capabilities are optional from
    // Python's side: Rust advertises them, Python may or may not require them.
    for (name, version) in &handshake.required_host_capabilities {
        match provided_host_capabilities.get(name) {
            None => {
                return Err(RuntimeHostError::MissingCapability(name.clone()));
            }
            Some(expected_version) if expected_version != version => {
                return Err(RuntimeHostError::CapabilityVersionMismatch {
                    capability: name.clone(),
                    expected: expected_version.clone(),
                    actual: version.clone(),
                });
            }
            _ => {}
        }
    }
    if handshake.max_frame_bytes == 0 || handshake.max_frame_bytes > MAX_FRAME_BYTES {
        return Err(RuntimeHostError::FrameTooLarge(handshake.max_frame_bytes));
    }
    Ok(())
}

pub(crate) fn encode_frame(value: &Value) -> Result<Vec<u8>, RuntimeHostError> {
    let payload = serde_json::to_vec(value)
        .map_err(|error| RuntimeHostError::InvalidJson(error.to_string()))?;
    if payload.len() > MAX_FRAME_BYTES {
        return Err(RuntimeHostError::FrameTooLarge(payload.len()));
    }
    let length = u32::try_from(payload.len()).map_err(|_| RuntimeHostError::FrameTooLarge(payload.len()))?;
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&length.to_be_bytes());
    frame.extend_from_slice(&payload);
    Ok(frame)
}

pub(crate) fn decode_frame(
    buffer: &[u8],
) -> Result<Option<(Value, usize)>, RuntimeHostError> {
    if buffer.len() < 4 {
        return Ok(None);
    }
    let length = u32::from_be_bytes([buffer[0], buffer[1], buffer[2], buffer[3]]) as usize;
    if length == 0 {
        return Err(RuntimeHostError::InvalidFrameLength);
    }
    if length > MAX_FRAME_BYTES {
        return Err(RuntimeHostError::FrameTooLarge(length));
    }
    let frame_size = 4 + length;
    if buffer.len() < frame_size {
        return Ok(None);
    }
    let value = serde_json::from_slice(&buffer[4..frame_size])
        .map_err(|error| RuntimeHostError::InvalidJson(error.to_string()))?;
    Ok(Some((value, frame_size)))
}

#[cfg(test)]
#[path = "../../developer/tests/rust/runtime_capability_contract.rs"]
mod capability_contract_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_sidecar_supplied_cache_key_is_overwritten_and_capped() {
        let mut request = CompletionRequest {
            messages: vec![ChatMessage::new("system", "sys"), ChatMessage::new("user", "pack")],
            temperature: 0.0,
            max_tokens: 100,
            cache_key: Some("x".repeat(500)),
        };
        apply_host_cache_key(RunKind::WeeklyDream, &mut request);
        let key = request.cache_key.clone().unwrap();
        assert!(key.starts_with("dream-weekly-") && key.len() <= MAX_SIDECAR_CACHE_KEY_LEN);
        assert_ne!(key, "x".repeat(500));
        request.messages = vec![ChatMessage::new("user", "no system")];
        apply_host_cache_key(RunKind::WeeklyDream, &mut request);
        assert!(request.cache_key.is_none(), "no stable system prefix, so no routing key");
    }

    #[test]
    fn a_truncated_sidecar_completion_is_a_normal_result_with_truncated_true() {
        let partial = PartialCompletion {
            response: ielts_application::CompletionResponse {
                content: r#"{"digest":"#.into(),
                model: "m".into(),
                latency_ms: 4,
                usage: None,
                provider_request_id: None,
            },
            truncated: true,
        };
        let value = sidecar_completion_result(partial).unwrap();
        assert_eq!(value["content"], json!(r#"{"digest":"#));
        assert_eq!(value["truncated"], json!(true));
        let whole = PartialCompletion {
            response: ielts_application::CompletionResponse {
                content: "{}".into(),
                model: "m".into(),
                latency_ms: 4,
                usage: None,
                provider_request_id: None,
            },
            truncated: false,
        };
        assert_eq!(sidecar_completion_result(whole).unwrap()["truncated"], json!(false));
    }

    #[test]
    fn sidecar_calls_share_a_cache_key_per_system_prefix_and_never_hash_the_payload() {
        let call = |system: &str, user: &str| CompletionRequest {
            messages: vec![ChatMessage::new("system", system), ChatMessage::new("user", user)],
            temperature: 0.0,
            max_tokens: 100,
            cache_key: None,
        };
        let key = sidecar_cache_key(RunKind::WeeklyDream, &call("sys", "pack A")).unwrap();
        assert!(key.starts_with("dream-weekly-"), "{key}");
        assert_eq!(key, sidecar_cache_key(RunKind::WeeklyDream, &call("sys", "pack B")).unwrap());
        assert_ne!(key, sidecar_cache_key(RunKind::WeeklyDream, &call("other", "pack A")).unwrap());
        assert_ne!(key, sidecar_cache_key(RunKind::MemoryCandidate, &call("sys", "pack A")).unwrap());
        let no_system = CompletionRequest {
            messages: vec![ChatMessage::new("user", "pack A")],
            ..call("", "")
        };
        assert!(sidecar_cache_key(RunKind::WeeklyDream, &no_system).is_none());
    }

    fn framed_reverse_request(method: &str) -> Value {
        let frame = encode_frame(&json!({
            "protocolVersion": PROTOCOL_VERSION, "requestId": "fake-sidecar-1",
            "traceId": "trusted-run", "deadlineMs": 1_000, "method": method,
            "params": {"runKind": "weekly", "capabilities": ["dream.run_weekly"],
                "window": "2026-W33", "patterns": []}
        })).unwrap();
        let (request, consumed) = decode_frame(&frame).unwrap().unwrap();
        assert_eq!(consumed, frame.len());
        request
    }

    async fn manager_for_host_method(method: &str) -> RuntimeManager {
        let manager = RuntimeManager::default();
        {
            let mut process = manager.inner.lock().await;
            process.generation = 7;
            process.active_run = Some(Arc::new(ActiveRun::new(
                method, "trusted-run", json!({"maxCandidates": 3,"day":"2026-10-01","window":"2026-W40"}), 7,
            ).unwrap()));
        }
        manager
    }

    // Uses the same production pre-routing gate as dispatch_host_request.
    // Framed requests can forge runKind/capabilities, but cannot pick authority.
    #[tokio::test]
    async fn run_capability_memory_candidate_rejects_writes_before_db_access() {
        let manager = manager_for_host_method("memory.candidates.generate").await;
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE memory_items (id TEXT, status TEXT);
            CREATE TABLE memory_supports (id TEXT, status TEXT);
            INSERT INTO memory_items VALUES ('memory-1', 'active');
            INSERT INTO memory_supports VALUES ('support-1', 'active');").unwrap();
        let before = conn.total_changes();
        for method in [
            "dream.run_weekly", "dream.run_daily", "journal.build_daily",
            "memory.apply", "memory.apply_consolidations", "memory.promote_candidate",
            "approval.decide", "approval.record", "prompt.promote_candidate",
            "prompt.rollback", "eval.run_case", "strategy.record_assignment",
            "strategy.record_feedback", "strategy.record_outcome", "strategy.promote",
            "study_plan.create", "thread.create", "unknown.method",
        ] {
            let request = framed_reverse_request(method);
            let result = manager.authorize_host_request(7, "trusted-run", &request).await;
            assert!(matches!(result, Err(RuntimeHostError::InvalidResponse(ref message))
                if message.contains("not allowed for MemoryCandidate")), "{method}");
        }
        assert_eq!(conn.total_changes(), before);
        for table in ["memory_items", "memory_supports"] {
            let status: String = conn.query_row(&format!("SELECT status FROM {table}"), [],
                |row| row.get(0)).unwrap();
            assert_eq!(status, "active");
        }
    }

    #[tokio::test]
    async fn run_capability_memory_candidate_preserves_legal_model_tool_and_reads() {
        let manager = manager_for_host_method("memory.candidates.generate").await;
        for method in ["tool.invoke", "model.invoke", "learning.learner_skill_state",
                       "memory.search_active", "learning.evidence_by_ids"] {
            let request = framed_reverse_request(method);
            let result = manager.authorize_host_request(7, "trusted-run", &request).await;
            let enabled = PROVIDED_HOST_CAPABILITIES.iter().any(|(name, _)| *name == method);
            assert_eq!(result.is_ok(), enabled, "{method}");
        }
    }

    #[tokio::test]
    async fn run_capability_all_advertised_routes_have_minimal_run_permissions() {
        let mut runs = vec![("memory.candidates.generate", vec!["tool.invoke", "model.invoke",
            "learning.learner_skill_state", "memory.search_active", "learning.evidence_by_ids"])];
        #[cfg(feature = "daily-dream-v1")]
        runs.push(("dream.weekly", vec!["learning.weekly_pack", "model.invoke", "dream.run_weekly"]));
        #[cfg(feature = "agent-threads-v1")]
        runs.push(("planner.study_plan", vec!["learning.learner_skill_state",
            "memory.search_active", "study_plan.create"]));
        for (host_method, allowed) in runs {
            let manager = manager_for_host_method(host_method).await;
            for (method, _) in PROVIDED_HOST_CAPABILITIES {
                let mut request = framed_reverse_request(method);
                if host_method == "dream.weekly" { request["params"]["window"] = json!("2026-W40"); }
                assert_eq!(manager.authorize_host_request(7, "trusted-run", &request).await.is_ok(),
                    allowed.contains(method), "{host_method} -> {method}");
            }
            // `dream.run_weekly` is a legal weekly-run method only; every other
            // run kind still fails closed on it.
            let denied: &[&str] = if host_method == "dream.weekly" {
                &["approval.decide", "prompt.promote_candidate", "strategy.promote", "unknown.method"]
            } else {
                &["dream.run_weekly", "approval.decide", "prompt.promote_candidate", "strategy.promote", "unknown.method"]
            };
            for method in denied.iter().copied() {
                assert!(manager.authorize_host_request(7, "trusted-run",
                    &framed_reverse_request(method)).await.is_err(), "{host_method} -> {method}");
            }
        }
    }

    #[test]
    fn run_capability_unknown_host_methods_fail_closed() {
        // `dream.daily` is gone: the daily journal has no sidecar run.
        for method in ["dream.run_weekly", "dream.daily", "memory.candidates.extract",
                       "unknown", "", "runtime.health"] {
            assert!(ActiveRun::new(method, "trusted-run", json!({}), 7).is_err(), "{method}");
        }
    }

    /// Weekly is reachable only through the host-selected `dream.weekly` run
    /// kind, and that kind grants exactly the pack read, the model call and the
    /// host-validated submission of digest and mutations.
    #[cfg(feature = "daily-dream-v1")]
    #[tokio::test]
    async fn weekly_run_kind_is_host_selected_and_minimal() {
        assert!(ActiveRun::new("dream.weekly", "trusted-run", json!({"window":"2026-W40"}), 7).is_ok());
        assert!(PROVIDED_HOST_CAPABILITIES.iter().any(|(name, _)| *name == "dream.run_weekly"));
        assert!(REQUIRED_RUNTIME_CAPABILITIES.iter().any(|(name, _)| *name == "dream.weekly"));
        let manager = RuntimeManager::default();
        {
            let mut process = manager.inner.lock().await;
            process.generation = 7;
            process.active_run = Some(Arc::new(ActiveRun::new(
                "dream.weekly", "trusted-run", json!({"window": "2026-W40"}), 7).unwrap()));
        }
        let mut request = framed_reverse_request("learning.weekly_pack");
        request["params"]["window"] = json!("2026-W40");
        assert!(manager.authorize_host_request(7, "trusted-run", &request).await.is_ok());
        // The sidecar cannot widen or move the host-owned window...
        for window in ["2026-W39", "2026-08-10", ""] {
            for method in ["learning.weekly_pack", "dream.run_weekly"] {
                let mut forged = framed_reverse_request(method);
                forged["params"]["window"] = json!(window);
                assert!(manager.authorize_host_request(7, "trusted-run", &forged).await.is_err(), "{method} {window}");
            }
        }
        // ...nor act for another user.
        request["params"]["userId"] = json!("other-user");
        assert!(manager.authorize_host_request(7, "trusted-run", &request).await.is_err());
        // The model call carries no window and is allowed.
        assert!(manager.authorize_host_request(7, "trusted-run", &framed_reverse_request("model.invoke")).await.is_ok());
        // Daily-only methods stay denied to a weekly run.
        for method in ["journal.build_daily", "dream.run_daily", "tool.invoke"] {
            assert!(manager.authorize_host_request(7, "trusted-run", &framed_reverse_request(method)).await.is_err(), "{method}");
        }
    }

    /// Drive the `dream.run_weekly` reverse-RPC exactly as the sidecar does.
    #[cfg(feature = "daily-dream-v1")]
    async fn weekly_preflight<R: tauri::Runtime>(
        app: &tauri::AppHandle<R>,
        window: &ielts_db::WeeklyWindow,
        digest: Value,
    ) -> Value {
        let params = json!({
            "userId": "local",
            "window": window.token(),
            "digest": digest,
            "validateOnly": true,
        });
        let active = ActiveRun::new(
            "dream.weekly",
            "trusted-run",
            json!({"window": window.token()}),
            7,
        )
        .unwrap();
        RuntimeManager::default()
            .invoke_journal_dream(app, "dream.run_weekly", params.as_object().unwrap(), &active)
            .await
            .unwrap()
    }

    /// The validate-only preflight answers with the validator's metrics against
    /// the same facts the real write builds, and writes nothing: no journal, no
    /// dream run, no report. It runs before `ensure_journal`, so the sidecar's
    /// repair pass can never be the attempt that creates a run.
    #[cfg(feature = "daily-dream-v1")]
    #[tokio::test]
    async fn weekly_validate_only_returns_metrics_and_writes_nothing() {
        let directory = tempfile::tempdir().unwrap();
        let app = tauri::test::mock_builder()
            .manage(crate::app::state::test_support::test_db(directory.path()))
            .build(tauri::generate_context!())
            .expect("mock app owns the migrated database");
        let window = ielts_db::WeeklyWindow::new(
            "2026-W40",
            utc("2026-09-26T00:00:00Z"),
            utc("2026-10-03T00:00:00Z"),
        );

        // A literal Chinese count in the body is exactly what the validator
        // refuses: one dropped sentence, and the first body sentence is lost.
        let rejected = weekly_preflight(
            app.handle(),
            &window,
            json!({
                "title": "本周回顾",
                "body": ["这周做了三次练习。"],
                "changes": [],
                "nextSteps": [],
                "strengths": [],
                "weaknesses": [],
            }),
        )
        .await;
        assert_eq!(rejected["usable"], false);
        assert_eq!(rejected["needsRepair"], true);
        assert_eq!(rejected["droppedSentences"], 1);
        assert_eq!(rejected["violations"][0]["path"], "body/0");
        assert_eq!(rejected["violations"][0]["sentence"], 0);
        assert_eq!(rejected["violations"][0]["code"], "literal_chinese_count");

        // Numbers pass only as facts the write path projected: a placeholder
        // the window's facts do not contain is refused, not resolved.
        let unknown = weekly_preflight(
            app.handle(),
            &window,
            json!({
                "title": "本周回顾",
                "body": ["这周共读了 {{f:volume.reading}} 篇。"],
                "changes": [],
                "nextSteps": [],
                "strengths": [],
                "weaknesses": [],
            }),
        )
        .await;
        assert_eq!(unknown["usable"], false);
        assert_eq!(unknown["needsRepair"], true);
        assert_eq!(unknown["violations"][0]["path"], "body/0");
        assert_eq!(unknown["violations"][0]["code"], "unknown_reference");

        // A Chinese count is allowed in nextSteps with no fact behind it.
        let accepted = weekly_preflight(
            app.handle(),
            &window,
            json!({
                "title": "本周回顾",
                "body": ["这周练习还算顺利。"],
                "changes": [],
                "nextSteps": [{"text": "再做两套题。"}],
                "strengths": [],
                "weaknesses": [],
            }),
        )
        .await;
        assert_eq!(accepted["usable"], true);
        assert_eq!(accepted["needsRepair"], false);
        assert_eq!(accepted["droppedSentences"], 0);
        assert_eq!(accepted["violations"], json!([]));
        // Metrics only: the preflight never returns a narrative.
        let mut keys: Vec<&str> = accepted
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(keys, ["droppedSentences", "needsRepair", "usable", "violations"]);

        let db = app.state::<AppDb>();
        for table in ["daily_journals", "dream_runs", "weekly_digests"] {
            let count: i64 = db
                .with_conn(|conn| {
                    Ok(conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))?)
                })
                .unwrap();
            assert_eq!(count, 0, "{table} was written by the validate-only preflight");
        }
    }

    /// The model gateway's transport retries and the weekly sidecar's own retry
    /// loop must never multiply, and the weekly budget must fit its three calls.
    #[cfg(feature = "daily-dream-v1")]
    #[test]
    fn weekly_owns_its_retries_and_has_a_budget_for_three_model_calls() {
        assert_eq!(RunKind::WeeklyDream.model_transport_retries(), 0);
        assert_eq!(RunKind::MemoryCandidate.model_transport_retries(), crate::ai::MAX_RETRIES);
        assert!(RunKind::WeeklyDream.budget() > RunKind::MemoryCandidate.budget());
        assert_eq!(RunKind::MemoryCandidate.budget(), COGNITIVE_REQUEST_TIMEOUT);
        let weekly = ActiveRun::new("dream.weekly", "trusted-run", json!({}), 7).unwrap();
        assert!(weekly.deadline > Instant::now() + Duration::from_secs(400));
    }

    #[tokio::test]
    async fn run_capability_preserves_trace_generation_deadline_and_envelope_checks() {
        let manager = manager_for_host_method("memory.candidates.generate").await;
        let request = framed_reverse_request("model.invoke");
        assert!(manager.authorize_host_request(8, "trusted-run", &request).await.is_err());
        assert!(manager.authorize_host_request(7, "forged-trace", &request).await.is_err());
        for (key, value) in [("protocolVersion", json!(2)), ("deadlineMs", json!(0)),
                             ("params", Value::Null), ("method", Value::Null)] {
            let mut invalid = request.clone();
            invalid[key] = value;
            assert!(manager.authorize_host_request(7, "trusted-run", &invalid).await.is_err(), "{key}");
        }
        {
            let mut process = manager.inner.lock().await;
            let active = Arc::get_mut(process.active_run.as_mut().unwrap()).unwrap();
            active.generation = 6;
        }
        assert!(manager.authorize_host_request(7, "trusted-run", &request).await.is_err());
        {
            let mut process = manager.inner.lock().await;
            let active = Arc::get_mut(process.active_run.as_mut().unwrap()).unwrap();
            active.generation = 7;
            active.deadline = Instant::now() - Duration::from_secs(1);
        }
        assert!(matches!(manager.authorize_host_request(7, "trusted-run", &request).await,
            Err(RuntimeHostError::Timeout)));
        manager.inner.lock().await.active_run = None;
        assert!(manager.authorize_host_request(7, "trusted-run", &request).await.is_err());
    }

    #[cfg(feature = "context-compiler-v1")]
    #[tokio::test]
    async fn non_daily_rpc_rejects_foreign_nested_query_user() {
        let mut runs = vec!["memory.candidates.generate"];
        #[cfg(feature = "agent-threads-v1")]
        runs.push("planner.study_plan");
        for host_method in runs {
            let manager = manager_for_host_method(host_method).await;
            for method in ["learning.learner_skill_state", "memory.search_active"] {
                let mut request = framed_reverse_request(method);
                request["params"]["query"] = json!({"userId":"u2"});
                assert!(manager.authorize_host_request(7, "trusted-run", &request).await.is_err());
                request["params"]["query"]["userId"] = json!("local");
                assert!(manager.authorize_host_request(7, "trusted-run", &request).await.is_ok());
                request["params"]["query"]["userId"] = Value::Null;
                assert!(manager.authorize_host_request(7, "trusted-run", &request).await.is_err());
            }
        }
    }

    #[cfg(feature = "context-compiler-v1")]
    #[test]
    fn evidence_by_ids_rejects_foreign_user_in_real_sqlite_before_projection() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = ielts_db::open_connection(&ielts_db::DbOpenOptions::create(dir.path().join("evidence.db"))).unwrap();
        ielts_db::migrate(&mut conn).unwrap();
        conn.execute("INSERT INTO learning_events
            (id,user_id,event_type,source_kind,source_id,idempotency_key,occurred_at,payload_json,
             content_hash,schema_version,consolidation_state,sensitivity,created_at,updated_at)
            VALUES ('foreign','u2','reading.question.outcome','reading_question','source','idem',
             '2026-08-16T00:00:00Z','{}','hash',1,'pending','normal','2026-08-16T00:00:00Z','2026-08-16T00:00:00Z')", []).unwrap();
        assert!(matches!(local_learning_evidence(&conn, &["foreign".into()]),
            Err(ielts_db::DbError::Validation(message)) if message.contains("host-owned local user")));
        let missing = local_learning_evidence(&conn, &["missing".into()]).unwrap();
        assert!(missing.events.is_empty());
        assert_eq!(missing.missing_ids, vec!["missing"]);
    }

    #[cfg(feature = "daily-dream-v1")]
    fn local(offset_hours: i32, utc: &str) -> chrono::DateTime<chrono::FixedOffset> {
        use chrono::TimeZone;
        chrono::FixedOffset::east_opt(offset_hours * 3600).unwrap()
            .from_utc_datetime(&chrono::DateTime::parse_from_rfc3339(utc).unwrap().naive_utc())
    }

    #[cfg(feature = "daily-dream-v1")]
    fn utc(value: &str) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339(value).unwrap().with_timezone(&chrono::Utc)
    }

    /// The window is a pure function of the clock; its key names the latest
    /// weekend at or before now, by the LOCAL day. Saturday, Sunday and every
    /// weekday after share it, so a weekday retry belongs to the weekend it retries.
    /// Whether a window is due is the worker's one predicate, not decided here.
    #[cfg(feature = "daily-dream-v1")]
    #[test]
    fn weekly_window_keys_the_latest_weekend_by_the_local_day() {
        // 2026-10-03/04 is the weekend of W40; 10/10 and 10/11 that of W41.
        for (now, key) in [
            (local(0, "2026-10-09T23:59:00Z"), "2026-W40"), // Friday: still W40's weekend
            (local(0, "2026-10-10T00:00:00Z"), "2026-W41"), // Saturday
            (local(0, "2026-10-11T23:59:00Z"), "2026-W41"), // Sunday
            (local(0, "2026-10-12T00:00:00Z"), "2026-W41"), // Monday retries W41
            (local(0, "2026-10-16T12:00:00Z"), "2026-W41"), // Friday
            (local(0, "2026-10-17T12:00:00Z"), "2026-W42"), // next Saturday
            // Local day, not UTC day: Friday 16:30Z is already Saturday 00:30 at UTC+8...
            (local(8, "2026-10-09T16:30:00Z"), "2026-W41"),
            // ...and Sunday 22:00Z is already Monday 06:00 at UTC+8, still W41's weekend.
            (local(8, "2026-10-11T22:00:00Z"), "2026-W41"),
            // The ISO year, not the calendar year, names the weekend: 2027-01-02 is 2026-W53,
            // and so is the Monday after it.
            (local(0, "2027-01-02T12:00:00Z"), "2026-W53"),
            (local(0, "2027-01-04T12:00:00Z"), "2026-W53"),
        ] {
            assert_eq!(plan_weekly_window(&now, None).unwrap().key, key, "{now}");
            assert_eq!(weekend_key(&now), key, "{now}");
        }
    }

    /// The window starts where the last COMPLETED one ended (exclusive), never
    /// further back than 28 days; a missed weekend folds into the next one.
    #[cfg(feature = "daily-dream-v1")]
    #[test]
    fn weekly_window_runs_from_the_last_completed_end_capped_at_28_days() {
        let now = local(0, "2026-10-10T09:30:45Z");
        let end = utc("2026-10-10T09:30:45Z");
        // First run ever: the cap.
        assert_eq!(plan_weekly_window(&now, None).unwrap().start, end - chrono::Duration::days(28));
        // Normal weekly cadence.
        let last = utc("2026-10-03T09:00:00Z");
        let window = plan_weekly_window(&now, Some(last)).unwrap();
        assert_eq!((window.start, window.end), (last, end));
        // A missed weekend is folded in: two weeks, no catch-up path.
        let folded = plan_weekly_window(&now, Some(utc("2026-09-26T09:00:00Z"))).unwrap();
        assert_eq!(folded.start, utc("2026-09-26T09:00:00Z"));
        // A long absence never reaches past the cap.
        let capped = plan_weekly_window(&now, Some(utc("2026-06-01T00:00:00Z"))).unwrap();
        assert_eq!(capped.start, end - chrono::Duration::days(28));
        // Nothing new since a run that ended at (or after) now.
        assert!(plan_weekly_window(&now, Some(end)).is_none());
        // Sub-second noise never leaks into the window: the end is whole seconds.
        let noisy = chrono::DateTime::parse_from_rfc3339("2026-10-10T09:30:45.987Z").unwrap();
        assert_eq!(plan_weekly_window(&noisy, None).unwrap().end, end);
    }

    #[cfg(feature = "daily-dream-v1")]
    #[test]
    fn the_retry_bound_is_one_attempt_per_local_day() {
        // Saturday 11:00 at UTC+8: the local day began Friday 16:00Z.
        assert_eq!(local_day_start_utc(&local(8, "2026-10-10T03:00:00Z")), utc("2026-10-09T16:00:00Z"));
        assert_eq!(local_day_start_utc(&local(0, "2026-10-10T03:00:00Z")), utc("2026-10-10T00:00:00Z"));
    }

    #[cfg(feature = "agent-threads-v1")]
    #[test]
    fn study_plan_create_uses_lossless_proposal_adapter() {
        let probe = json!({"skillKey": "reading.tfng", "probeKind": "contrastive_pair",
                           "avoidAssetIds": ["asset-1"], "reasonCodes": ["review_due"]});
        let command = ielts_domain::CreateStudyPlanCommand::from_planner_proposal(&json!({
            "userGoal": "review", "totalEstimatedMinutes": 15, "targetDate": "2026-10-20",
            "items": [{"skillProbe": probe, "whyText": "review due", "estimatedMinutes": 15}]
        })).unwrap();
        assert_eq!(command.target_date.as_deref(), Some("2026-10-20"));
        let dir = tempfile::tempdir().unwrap();
        let options = ielts_db::DbOpenOptions::create(dir.path().join("plan.db"));
        let mut conn = ielts_db::open_connection(&options).unwrap();
        ielts_db::migrate(&mut conn).unwrap();
        ielts_db::create_study_plan(&conn, &command).unwrap();
        drop(conn);
        let conn = ielts_db::open_connection(&options).unwrap();
        let snapshot = ielts_db::load_latest_study_plan(&conn, "local").unwrap().unwrap();
        let wire = serde_json::to_value(snapshot).unwrap();
        assert_eq!(wire["plan"]["targetDate"], "2026-10-20");
        assert_eq!(wire["items"][0]["skillProbe"], probe);
    }

    /// Round-3 audit (item 8): every method the host actually sends to the
    /// sidecar must be negotiated in the handshake. `dream.weekly` and
    /// `planner.study_plan` were sent in production while absent from the
    /// requested set, so a sidecar without them negotiated cleanly and then
    /// failed mid-run with `method_not_found`.
    ///
    /// This scans this module's own source for the method names passed to
    /// `self.request(...)` / `self.cognitive_request(...)`, so a newly wired
    /// call fails here until it is negotiated.
    #[test]
    fn every_method_the_host_sends_is_negotiated() {
        let source = include_str!("cognitive_runtime.rs");
        let negotiated: Vec<&str> = REQUIRED_RUNTIME_CAPABILITIES
            .iter()
            .map(|(name, _)| *name)
            .collect();
        // `runtime.handshake` is the negotiation itself, so it is never a member
        // of the set being negotiated.
        for method in [
            "runtime.health",
            "runtime.shutdown",
            "memory.candidates.generate",
            "dream.weekly",
            "planner.study_plan",
        ] {
            assert!(
                source.contains(&format!("\"{method}\"")),
                "{method} is negotiated but no longer sent — drop it from                  REQUIRED_RUNTIME_CAPABILITIES rather than over-requiring"
            );
            assert!(
                negotiated.contains(&method),
                "{method} is sent to the sidecar but not negotiated in the                  handshake; a sidecar lacking it would fail mid-run"
            );
        }
        // The handshake advertisement is derived from the same constant, so the
        // two can no longer drift apart.
        assert!(
            source.contains("\"requestedCapabilities\": REQUIRED_RUNTIME_CAPABILITIES"),
            "requestedCapabilities must be derived from REQUIRED_RUNTIME_CAPABILITIES"
        );
    }

    /// Round-3 audit (A3): weekly consolidation writes active memory and
    /// supersedes supports, so it must never be reachable from the webview.
    /// `capabilities/main.json` grants blanket `core:*` with no per-command
    /// ACL, so registration IS the authorization.
    #[test]
    fn weekly_consolidation_is_not_a_registered_tauri_command() {
        let lib_source = include_str!("lib.rs");
        let handler_start = lib_source
            .find("tauri::generate_handler![")
            .expect("generate_handler! block must exist");
        let handler = &lib_source[handler_start..];
        // Match the registration form, not the bare name: the block carries a
        // comment naming the command to explain why it is absent. This is the
        // same shape `developer/tests/ci/check_doc_drift.py` extracts.
        assert!(
            !handler.contains("commands::journal::dream_run_weekly"),
            "dream_run_weekly was re-registered in generate_handler!; the              webview must not be able to supply consolidation patterns"
        );
        // The daily path is a legitimate command and must stay registered, so
        // this test fails on an over-broad deletion too.
        assert!(handler.contains("commands::journal::dream_run_daily"));
    }

    /// Round-3 audit (A2): the sidecar must not reach any authority operation.
    /// This asserts the real gate (`is_host_only_method`, checked before routing)
    /// rather than the advisory capability array.
    #[test]
    fn authority_methods_are_denied_to_the_sidecar() {
        for method in [
            "prompt.promote_candidate",
            "prompt.rollback",
            "eval.run_case",
            "approval.decide",
        ] {
            assert!(
                is_host_only_method(method),
                "{method} must stay host-only"
            );
            assert!(
                !PROVIDED_HOST_CAPABILITIES
                    .iter()
                    .any(|(name, _)| *name == method),
                "{method} must not be advertised to the sidecar"
            );
        }
    }

    /// The legitimate run surface must stay reachable, so the fix above
    /// cannot be "solved" by over-trimming.
    #[test]
    fn propose_and_request_methods_stay_available() {
        for method in [
            "study_plan.create",
            "model.invoke",
            "tool.invoke",
        ] {
            assert!(
                !is_host_only_method(method),
                "{method} must remain available to the runtime"
            );
        }
    }

    #[test]
    fn sidecar_output_ceiling_is_required_and_bounded() {
        let message = ChatMessage::new("user", "hello");
        let request = |max_tokens| CompletionRequest {
            messages: vec![message.clone()],
            temperature: 0.0,
            max_tokens,
            cache_key: None,
        };
        assert!(validate_model_request(&request(1), RunKind::MemoryCandidate).is_ok());
        assert!(validate_model_request(&request(SIDECAR_MAX_OUTPUT_TOKENS), RunKind::MemoryCandidate).is_ok());
        assert!(
            validate_model_request(&request(0), RunKind::MemoryCandidate).is_err(),
            "a zero ceiling would make every completion return empty"
        );
        assert!(
            validate_model_request(&request(SIDECAR_MAX_OUTPUT_TOKENS + 1), RunKind::MemoryCandidate).is_err(),
            "the sidecar must not request an unbounded completion"
        );
        let wire = |extra: Value| {
            let mut body = json!({"messages":[{"role":"user","content":"hi"}],"temperature":0.0});
            body.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            body
        };
        assert!(parse_model_request(wire(json!({"maxTokens": 1500})), RunKind::MemoryCandidate).is_ok());
        let missing = parse_model_request(wire(json!({})), RunKind::MemoryCandidate).unwrap_err().to_string();
        assert!(missing.contains("maxTokens"), "{missing}");
    }

    #[test]
    fn the_weekly_narrative_samples_but_memory_candidates_stay_deterministic() {
        let message = ChatMessage::new("user", "hello");
        let at = |temperature| CompletionRequest {
            messages: vec![message.clone()],
            temperature,
            max_tokens: 2_500,
            cache_key: None,
        };
        #[cfg(feature = "daily-dream-v1")]
        {
            assert!(validate_model_request(&at(0.6), RunKind::WeeklyDream).is_ok());
            assert!(validate_model_request(&at(1.0), RunKind::WeeklyDream).is_ok());
            let too_hot = validate_model_request(&at(1.5), RunKind::WeeklyDream).unwrap_err().to_string();
            assert!(too_hot.contains("temperature"), "{too_hot}");
        }
        let sampled = validate_model_request(&at(0.6), RunKind::MemoryCandidate).unwrap_err().to_string();
        assert!(sampled.contains("temperature must be zero"), "{sampled}");
    }

    fn handshake() -> RuntimeHandshake {
        RuntimeHandshake {
            selected_protocol: PROTOCOL_VERSION,
            runtime_version: "0.1.0".into(),
            build_id: "build-1".into(),
            capabilities: BTreeMap::from([
                ("runtime.health".into(), "1".into()),
                ("runtime.shutdown".into(), "1".into()),
                ("memory.candidates.extract".into(), "1".into()),
                ("memory.candidates.generate".into(), "1".into()),
            ]),
            required_host_capabilities: BTreeMap::from([
                ("model.invoke".into(), "1".into()),
                ("tool.invoke".into(), "1".into()),
            ]),
            max_frame_bytes: MAX_FRAME_BYTES,
        }
    }

    #[test]
    fn framing_handles_partial_and_coalesced_payloads() {
        let first = encode_frame(&json!({"requestId": "one"})).unwrap();
        let second = encode_frame(&json!({"requestId": "two"})).unwrap();
        let mut buffer = first.clone();
        buffer.extend_from_slice(&second);
        assert!(decode_frame(&buffer[..2]).unwrap().is_none());
        let (value, consumed) = decode_frame(&buffer).unwrap().unwrap();
        assert_eq!(value["requestId"], "one");
        let (value, _) = decode_frame(&buffer[consumed..]).unwrap().unwrap();
        assert_eq!(value["requestId"], "two");
    }

    #[test]
    fn framing_rejects_empty_oversize_and_malformed_payloads() {
        assert_eq!(
            decode_frame(&[0, 0, 0, 0]).unwrap_err(),
            RuntimeHostError::InvalidFrameLength
        );
        let oversize = (MAX_FRAME_BYTES as u32 + 1).to_be_bytes();
        assert!(matches!(
            decode_frame(&oversize),
            Err(RuntimeHostError::FrameTooLarge(_))
        ));
        let malformed = [0, 0, 0, 1, b'{'];
        assert!(matches!(
            decode_frame(&malformed),
            Err(RuntimeHostError::InvalidJson(_))
        ));
    }

    #[test]
    fn lifecycle_is_single_state_and_restart_requires_a_new_handshake() {
        let mut lifecycle = RuntimeLifecycle::default();
        assert_eq!(lifecycle.state(), RuntimeState::Stopped);
        lifecycle.begin_start().unwrap();
        lifecycle
                .accept_handshake(handshake(), Some("build-1"), &[("runtime.health", "1")])
            .unwrap();
        assert_eq!(lifecycle.state(), RuntimeState::Starting);
        lifecycle.mark_ready().unwrap();
        assert_eq!(lifecycle.state(), RuntimeState::Ready);
        assert!(lifecycle.handshake().is_some());
        lifecycle.mark_crashed();
        assert_eq!(lifecycle.state(), RuntimeState::Crashed);
        lifecycle.begin_start().unwrap();
        assert_eq!(lifecycle.state(), RuntimeState::Starting);
        assert!(lifecycle.handshake().is_none());
    }

    #[test]
    fn restart_backoff_doubles_and_caps() {
        assert_eq!(restart_delay(1), Duration::from_secs(1));
        assert_eq!(restart_delay(2), Duration::from_secs(2));
        assert_eq!(restart_delay(3), Duration::from_secs(4));
        assert_eq!(restart_delay(7), Duration::from_secs(60));
        assert_eq!(restart_delay(u32::MAX), Duration::from_secs(60));
    }

    #[test]
    fn restart_decision_rejects_inside_the_window_without_sleeping() {
        let t0 = Instant::now();
        assert_eq!(restart_decision(0, None, t0), Ok(()));
        assert_eq!(
            restart_decision(1, Some(t0), t0 + Duration::from_millis(200)),
            Err(RuntimeHostError::RestartBackoff { retry_after_secs: 1 })
        );
        assert_eq!(restart_decision(1, Some(t0), t0 + Duration::from_secs(1)), Ok(()));
        assert_eq!(
            restart_decision(3, Some(t0), t0 + Duration::from_secs(1)),
            Err(RuntimeHostError::RestartBackoff { retry_after_secs: 3 })
        );
        assert_eq!(restart_decision(3, Some(t0), t0 + Duration::from_secs(4)), Ok(()));
        let message = restart_decision(2, Some(t0), t0).unwrap_err().to_string();
        assert!(message.contains("try again after 2s"), "{message}");
    }

    #[test]
    fn restart_gives_up_after_consecutive_failures_until_reset() {
        let t0 = Instant::now();
        let mut backoff = RestartBackoff::default();
        for generation in 1..=u64::from(RESTART_MAX_CONSECUTIVE_FAILURES) {
            backoff.record_failure(generation, t0);
            // The same generation failing through several paths counts once.
            backoff.record_failure(generation, t0);
        }
        assert_eq!(backoff.consecutive_failures, RESTART_MAX_CONSECUTIVE_FAILURES);
        let error = backoff.check(t0 + Duration::from_secs(3600)).unwrap_err();
        assert_eq!(error, RuntimeHostError::RestartGaveUp { failures: 5 });
        assert!(error.to_string().contains("will not restart automatically"));
        backoff.reset();
        assert_eq!(backoff.check(t0), Ok(()));
    }

    #[test]
    fn stderr_capture_splits_lines_and_keeps_a_tail() {
        let mut capture = StderrCapture::default();
        assert_eq!(capture.push(b"Traceback (most"), vec![]);
        assert_eq!(
            capture.push(b" recent call last):\r\n  File x\nValueError"),
            vec![
                StderrOutput::Line("Traceback (most recent call last):".into()),
                StderrOutput::Line("  File x".into()),
            ]
        );
        assert_eq!(capture.finish(), vec![StderrOutput::Line("ValueError".into())]);
        assert_eq!(capture.tail(), "Traceback (most recent call last):\n  File x\nValueError");
        for index in 0..STDERR_TAIL_LINES + 5 {
            capture.push(format!("line {index}\n").as_bytes());
        }
        assert_eq!(capture.tail.len(), STDERR_TAIL_LINES);
        let last = format!("line {}", STDERR_TAIL_LINES + 4);
        assert_eq!(capture.tail.back(), Some(&last));
    }

    #[test]
    fn stderr_capture_caps_lines_and_total_budget() {
        let mut capture = StderrCapture::default();
        let long = vec![b'x'; STDERR_LINE_CAP * 3];
        assert_eq!(capture.push(&long[..STDERR_LINE_CAP]), vec![]);
        let out = capture.push(&[&long[STDERR_LINE_CAP..], b"\n".as_slice()].concat());
        let [StderrOutput::Line(line)] = out.as_slice() else { panic!("{out:?}") };
        assert_eq!(line.len(), STDERR_LINE_CAP + " [line truncated]".len());
        assert!(line.ends_with(" [line truncated]"));

        let mut capture = StderrCapture::default();
        let mut line = vec![b'y'; 1023];
        line.push(b'\n');
        let mut emitted = Vec::new();
        for _ in 0..200 {
            emitted.extend(capture.push(&line));
        }
        let logged: usize = emitted
            .iter()
            .map(|item| match item {
                StderrOutput::Line(line) => line.len(),
                StderrOutput::BudgetExhausted => 0,
            })
            .sum();
        assert!(logged <= STDERR_LOG_BUDGET);
        assert_eq!(emitted.iter().filter(|item| **item == StderrOutput::BudgetExhausted).count(), 1);
        assert_eq!(emitted.last(), Some(&StderrOutput::BudgetExhausted));
        assert_eq!(capture.tail.len(), STDERR_TAIL_LINES);
    }

    #[test]
    fn build_without_frozen_sidecar_refuses_to_start_runtime() {
        let error = verify_sidecar_bundled(SIDECAR_UNAVAILABLE_BUILD_ID).unwrap_err();
        assert_eq!(error, RuntimeHostError::SidecarNotBundled);
        assert!(error.to_string().contains("build_agent_runtime_sidecar.py"));
        assert!(verify_sidecar_bundled(&"a".repeat(64)).is_ok());
        if SIDECAR_BUILD_ID == SIDECAR_UNAVAILABLE_BUILD_ID {
            assert_eq!(verify_sidecar_hash().unwrap_err(), RuntimeHostError::SidecarNotBundled);
        }
    }

    #[test]
    fn handshake_fails_closed_on_identity_or_capability_mismatch() {
        let mut lifecycle = RuntimeLifecycle::default();
        lifecycle.begin_start().unwrap();
        assert_eq!(
            lifecycle
                .accept_handshake(handshake(), Some("different-build"), &[])
                .unwrap_err(),
            RuntimeHostError::BuildIdentityMismatch
        );
        lifecycle.mark_unavailable();
        lifecycle.begin_start().unwrap();
        assert_eq!(
            lifecycle
                .accept_handshake(handshake(), Some("build-1"), &[("model.invoke", "1")])
                .unwrap_err(),
            RuntimeHostError::MissingCapability("model.invoke".into())
        );

        lifecycle.mark_unavailable();
        lifecycle.begin_start().unwrap();
        let mut wrong_version = handshake();
        wrong_version
            .capabilities
            .insert("runtime.health".into(), "2".into());
        assert!(matches!(
            lifecycle.accept_handshake(
                wrong_version,
                Some("build-1"),
                &[("runtime.health", "1")]
            ),
            Err(RuntimeHostError::CapabilityVersionMismatch { .. })
        ));
    }
}
