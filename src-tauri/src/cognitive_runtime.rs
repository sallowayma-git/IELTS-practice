//! M3 host-owned Python sidecar lifecycle and framed protocol boundary.

use std::collections::BTreeMap;
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

use ielts_application::{ChatMessage, CompletionRequest, LanguageModel};
use ielts_db::{
    BeginAgentToolCallCommand, FinishAgentToolCallCommand, StoredAgentToolStatus,
};

use crate::ai::load_runtime;
use crate::app::state::{AppDb, AppVault};

pub(crate) const PROTOCOL_VERSION: u32 = 1;
pub(crate) const MAX_FRAME_BYTES: usize = 1024 * 1024;
/// Round-3 audit (7.8): upper bound on a sidecar-requested output ceiling. The
/// sidecar's model calls are short structured extractions, so this is generous
/// without letting Python ask for an unbounded completion.
const SIDECAR_MAX_OUTPUT_TOKENS: u32 = 8_000;
const SIDECAR_NAME: &str = "ielts-agent-runtime";
const SIDECAR_BUILD_ID: &str = env!("IELTS_AGENT_RUNTIME_BUILD_ID");
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const COGNITIVE_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const START_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
/// Methods the HOST calls ON the sidecar. Every entry must be a method the host
/// actually sends, and every method the host sends must be listed here —
/// otherwise the handshake succeeds against a sidecar that cannot serve the
/// call, and the failure surfaces later as `method_not_found` mid-run.
///
/// Round-3 audit (item 8): `dream.daily` and `planner.study_plan` were sent in
/// production (`run_daily_dream` / `run_study_planner`) but appeared in neither
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
    ("memory.candidates.extract", "1"),
    ("memory.candidates.generate", "1"),
    ("dream.daily", "1"),
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
    ("retrieval.corpus_manifest", "1"),
    #[cfg(feature = "context-compiler-v1")]
    ("retrieval.export_chunks", "1"),
    #[cfg(feature = "context-compiler-v1")]
    ("retrieval.fetch_chunks", "1"),
    #[cfg(feature = "context-compiler-v1")]
    ("context.materialize", "1"),
    #[cfg(feature = "context-compiler-v1")]
    ("model.embed.batch", "1"),
    #[cfg(feature = "context-compiler-v1")]
    ("learning.learner_skill_state", "1"),
    #[cfg(feature = "context-compiler-v1")]
    ("memory.search_active", "1"),
    #[cfg(feature = "context-compiler-v1")]
    ("learning.evidence_by_ids", "1"),
    #[cfg(feature = "daily-dream-v1")]
    ("journal.build_daily", "1"),
    #[cfg(feature = "daily-dream-v1")]
    ("dream.run_daily", "1"),
    #[cfg(feature = "daily-dream-v1")]
    ("dream.run_weekly", "1"),
    #[cfg(feature = "daily-dream-v1")]
    ("memory.candidate_pool", "1"),
    #[cfg(feature = "daily-dream-v1")]
    ("strategy.select", "1"),
    #[cfg(feature = "daily-dream-v1")]
    ("strategy.record_assignment", "1"),
    #[cfg(feature = "daily-dream-v1")]
    ("strategy.record_feedback", "1"),
    #[cfg(feature = "daily-dream-v1")]
    ("strategy.record_outcome", "1"),
    #[cfg(feature = "daily-dream-v1")]
    ("strategy.user_state", "1"),
    #[cfg(feature = "daily-dream-v1")]
    ("prompt.list_versions", "1"),
    #[cfg(feature = "daily-dream-v1")]
    ("prompt.get_active", "1"),
    #[cfg(feature = "daily-dream-v1")]
    ("prompt.propose_candidate", "1"),
    #[cfg(feature = "daily-dream-v1")]
    ("skill.list_versions", "1"),
    #[cfg(feature = "agent-threads-v1")]
    ("thread.create", "1"),
    #[cfg(feature = "agent-threads-v1")]
    ("thread.append_message", "1"),
    #[cfg(feature = "agent-threads-v1")]
    ("thread.list", "1"),
    #[cfg(feature = "agent-threads-v1")]
    ("thread.save_checkpoint", "1"),
    #[cfg(feature = "agent-threads-v1")]
    ("thread.request_cancel", "1"),
    #[cfg(feature = "agent-threads-v1")]
    ("approval.list", "1"),
    // `approval.record` only inserts a PENDING row: it is the sidecar's
    // legitimate way to REQUEST a human decision. `approval.decide` is
    // deliberately absent (Round-3 audit A2) — deciding is the human's.
    #[cfg(feature = "agent-threads-v1")]
    ("approval.record", "1"),
    #[cfg(feature = "agent-threads-v1")]
    ("study_plan.create", "1"),
    #[cfg(feature = "agent-threads-v1")]
    ("study_plan.list_items", "1"),
    #[cfg(feature = "agent-threads-v1")]
    ("study_plan.mark_done", "1"),
];
/// Wire DTO for the Python planner proposal (M12-04). Mirrors
/// ``StudyPlanItem.to_wire()``: each item carries a structured skillProbe —
/// the persistence schema stores only the probe string (the skill key).
/// Unknown proposal fields (itemId/questionKind/schemaVersion) are ignored
/// here; Python's strict model is the producer-side guard.
#[cfg(feature = "agent-threads-v1")]
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PlannerProposalWire {
    user_id: String,
    user_goal: String,
    total_estimated_minutes: u32,
    items: Vec<PlannerItemWire>,
}

#[cfg(feature = "agent-threads-v1")]
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PlannerItemWire {
    skill_probe: PlannerProbeWire,
    why_text: String,
    estimated_minutes: u32,
}

#[cfg(feature = "agent-threads-v1")]
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PlannerProbeWire {
    skill_key: String,
}

#[cfg(feature = "agent-threads-v1")]
impl Default for PlannerProposalWire {
    fn default() -> Self {
        Self {
            user_id: "local".into(),
            user_goal: String::new(),
            total_estimated_minutes: 0,
            items: Vec::new(),
        }
    }
}

#[cfg(feature = "agent-threads-v1")]
impl Default for PlannerItemWire {
    fn default() -> Self {
        Self {
            skill_probe: PlannerProbeWire::default(),
            why_text: String::new(),
            estimated_minutes: 0,
        }
    }
}

#[cfg(feature = "agent-threads-v1")]
impl Default for PlannerProbeWire {
    fn default() -> Self {
        Self {
            skill_key: String::new(),
        }
    }
}

/// Strict YYYY-MM-DD day key for journal/dream day params. Junk day strings
/// would otherwise be published as journal rows and dedupe keys.
/// Resolve the weekly `window` the sidecar sends into the ISO day whose journal
/// anchors the run's `dream_runs` row.
///
/// `WeeklyDreamInput.window` is documented as "ISO date or week identifier", and
/// the sidecar sends an ISO week (`2026-W33`). Both forms are accepted; anything
/// else is a hard error rather than a guess, because the resolved day decides
/// which journal the run is attributed to.
fn resolve_weekly_window_day(window: &str) -> Result<String, String> {
    if is_iso_day(window) {
        return Ok(window.to_string());
    }
    // ISO week form: YYYY-Www -> the Monday of that week.
    let (year_part, week_part) = window
        .split_once("-W")
        .ok_or_else(|| format!("dream.run_weekly window must be YYYY-MM-DD or YYYY-Www: {window}"))?;
    let year: i32 = year_part
        .parse()
        .map_err(|_| format!("dream.run_weekly window has a non-numeric year: {window}"))?;
    let week: u32 = week_part
        .parse()
        .map_err(|_| format!("dream.run_weekly window has a non-numeric week: {window}"))?;
    chrono::NaiveDate::from_isoywd_opt(year, week, chrono::Weekday::Mon)
        .map(|date| date.format("%Y-%m-%d").to_string())
        .ok_or_else(|| format!("dream.run_weekly window is not a real ISO week: {window}"))
}

fn is_iso_day(day: &str) -> bool {
    let bytes = day.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
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

struct PendingRequest {
    trace_id: String,
    sender: oneshot::Sender<Result<Value, RuntimeHostError>>,
}

struct ActiveRun {
    trace_id: String,
    candidate_input: Value,
    generation: u64,
    deadline: Instant,
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
            while let Some(event) = events.recv().await {
                manager.handle_event(&app, generation, event, &mut stdout).await;
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
            process.lifecycle.mark_ready()
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

    pub(crate) async fn generate_memory_candidates(
        &self,
        reservation: &mut RuntimeReservation,
        trace_id: &str,
        candidate_input: Value,
        max_candidates: u32,
    ) -> Result<Value, RuntimeHostError> {
        let active = {
            let mut process = self.inner.lock().await;
            if process.active_run.is_some() {
                return Err(RuntimeHostError::Busy);
            }
            let active = Arc::new(ActiveRun {
                trace_id: trace_id.to_owned(),
                candidate_input,
                generation: process.generation,
                deadline: Instant::now() + COGNITIVE_REQUEST_TIMEOUT,
            });
            process.active_run = Some(active.clone());
            active
        };
        reservation.arm();
        let result = self
            .request_internal(
                "memory.candidates.generate",
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

    /// M7-06: drive one bounded daily-dream consolidation pass in the Python
    /// sidecar. The orchestrator fetches today's facts via ``journal.build_daily``
    /// and submits proposals via ``dream.run_daily`` (reverse-RPC); a fallback
    /// result comes back as an ok payload with ``fallbackReason`` set, so the
    /// caller can mark the run failed without treating it as a transport error.
    #[cfg(feature = "daily-dream-v1")]
    pub(crate) async fn run_daily_dream(
        &self,
        reservation: &mut RuntimeReservation,
        trace_id: &str,
        day: &str,
    ) -> Result<Value, RuntimeHostError> {
        let active = {
            let mut process = self.inner.lock().await;
            if process.active_run.is_some() {
                return Err(RuntimeHostError::Busy);
            }
            let active = Arc::new(ActiveRun {
                trace_id: trace_id.to_owned(),
                candidate_input: json!({ "day": day }),
                generation: process.generation,
                deadline: Instant::now() + COGNITIVE_REQUEST_TIMEOUT,
            });
            process.active_run = Some(active.clone());
            active
        };
        reservation.arm();
        let result = self
            .request_internal(
                "dream.daily",
                json!({ "day": day }),
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
        let active = {
            let mut process = self.inner.lock().await;
            if process.active_run.is_some() {
                return Err(RuntimeHostError::Busy);
            }
            let active = Arc::new(ActiveRun {
                trace_id: trace_id.to_owned(),
                candidate_input: planner_input.clone(),
                generation: process.generation,
                deadline: Instant::now() + COGNITIVE_REQUEST_TIMEOUT,
            });
            process.active_run = Some(active.clone());
            active
        };
        reservation.arm();
        let result = self
            .request_internal(
                "planner.study_plan",
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

    pub(crate) async fn shutdown(&self) -> Result<(), RuntimeHostError> {
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
            CommandEvent::Stderr(bytes) => {
                let digest = hex::encode(Sha256::digest(&bytes));
                tracing::warn!(stderr_bytes = bytes.len(), stderr_sha256 = %digest, "Python cognitive runtime stderr");
            }
            CommandEvent::Error(error) => {
                tracing::error!(%error, "Python cognitive runtime process error");
                self.mark_crashed(generation).await;
            }
            CommandEvent::Terminated(payload) => {
                let mut process = self.inner.lock().await;
                if process.generation != generation {
                    return;
                }
                process.child = None;
                process.active_run = None;
                fail_pending(&mut process, "sidecar terminated");
                let termination = process.termination.take();
                if process.lifecycle.state() == RuntimeState::Stopping {
                    process.lifecycle.shutdown();
                } else if !matches!(
                    process.lifecycle.state(),
                    RuntimeState::Crashed | RuntimeState::Unavailable
                ) {
                    process.lifecycle.mark_crashed();
                    process.metrics.crashes += 1;
                    tracing::error!(code = ?payload.code, signal = ?payload.signal, "Python cognitive runtime crashed");
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
                    "retryable": matches!(error, RuntimeHostError::Timeout),
                    "details": {}
                }
            }),
        }
    }

    async fn dispatch_host_request(
        &self,
        app: &AppHandle,
        generation: u64,
        trace_id: &str,
        value: &Value,
    ) -> Result<Value, RuntimeHostError> {
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
        let params = value
            .get("params")
            .and_then(Value::as_object)
            .ok_or_else(|| RuntimeHostError::InvalidResponse("host params must be an object".into()))?;
        // Round-3 audit (A2): explicit deny-list checked BEFORE routing, so a
        // future edit to the match arms below cannot silently re-expose an
        // authority operation to the sidecar.
        if let Some(method) = value.get("method").and_then(Value::as_str) {
            if is_host_only_method(method) {
                return Err(RuntimeHostError::InvalidResponse(format!(
                    "host method is not available to the runtime: {method}"
                )));
            }
        }
        match value.get("method").and_then(Value::as_str) {
            Some("tool.invoke") => self.invoke_candidate_input_tool(app, trace_id, params, &active).await,
            Some("model.invoke") => self.invoke_model(app, params, request_budget).await,
            #[cfg(feature = "context-compiler-v1")]
            Some("model.embed.batch") => self.invoke_embed(app, params, request_budget).await,
            #[cfg(feature = "context-compiler-v1")]
            Some(method @ ("retrieval.corpus_manifest"
                | "retrieval.export_chunks"
                | "retrieval.fetch_chunks"
                | "context.materialize")) => {
                self.invoke_retrieval_context(app, method, params).await
            }
            #[cfg(feature = "context-compiler-v1")]
            Some(method @ ("learning.learner_skill_state"
                | "memory.search_active"
                | "learning.evidence_by_ids")) => {
                self.invoke_learner_memory_reads(app, method, params).await
            }
            #[cfg(feature = "daily-dream-v1")]
            Some(method @ ("journal.build_daily"
                | "dream.run_daily"
                | "dream.run_weekly"
                | "memory.candidate_pool")) => {
                self.invoke_journal_dream(app, method, params).await
            }
            #[cfg(feature = "daily-dream-v1")]
            Some(method @ ("strategy.select"
                | "strategy.record_assignment"
                | "strategy.record_feedback"
                | "strategy.record_outcome"
                | "strategy.user_state")) => {
                self.invoke_teaching_strategy(app, method, params).await
            }
            // Round-3 audit (A2): `prompt.promote_candidate`, `prompt.rollback`,
            // `eval.run_case` and `approval.decide` are deliberately absent.
            // They activate a version, reverse one, author the eval verdict that
            // gates approval, or decide an approval outright — the sidecar is a
            // derived runtime and must not hold that authority. They now fall
            // through to the `unsupported host method` arm below. The UI reaches
            // them through the Tauri commands, which keep the approval path.
            #[cfg(feature = "daily-dream-v1")]
            Some(method @ ("prompt.list_versions"
                | "prompt.get_active"
                | "prompt.propose_candidate"
                | "skill.list_versions")) => {
                self.invoke_prompt_skill(app, method, params).await
            }
            #[cfg(feature = "agent-threads-v1")]
            Some(method @ ("thread.create"
                | "thread.append_message"
                | "thread.list"
                | "thread.save_checkpoint"
                | "thread.request_cancel"
                | "approval.list"
                | "approval.record"
                | "study_plan.create"
                | "study_plan.list_items"
                | "study_plan.mark_done")) => {
                self.invoke_agent_thread(app, method, params).await
            }
            Some(method) => Err(RuntimeHostError::InvalidResponse(format!(
                "unsupported host method: {method}"
            ))),
            None => Err(RuntimeHostError::InvalidResponse("host method is missing".into())),
        }
    }

    /// M5-01/M5-08: serve the corpus export + context materialization reverse-RPC.
    ///
    /// Python asks for bounded corpus views or asks Rust to materialize a
    /// ContextPlan. Rust is the authority: it never exposes a DB handle, and
    /// materialization re-fetches canonical text + re-authorizes before
    /// returning a ContextPack. Python only ever receives derived DTOs.
    #[cfg(feature = "context-compiler-v1")]
    async fn invoke_retrieval_context(
        &self,
        app: &AppHandle,
        method: &str,
        params: &serde_json::Map<String, Value>,
    ) -> Result<Value, RuntimeHostError> {
        use ielts_application::{ContextMaterializerService, CorpusExportService};
        use ielts_domain::{ContextPlan, CorpusExportQuery, CorpusFetchQuery};

        let db = app.state::<AppDb>();
        let store = crate::app::application_store::ApplicationStore::new(db.inner());
        let result: Result<Value, String> = match method {
            "retrieval.corpus_manifest" => serialize_result(
                CorpusExportService::new(&store).corpus_manifest(),
            ),
            "retrieval.export_chunks" => {
                match serde_json::from_value::<CorpusExportQuery>(
                    params.get("query").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(query) => serialize_result(
                        CorpusExportService::new(&store).export_chunks(&query),
                    ),
                    Err(error) => Err(error.to_string()),
                }
            }
            "retrieval.fetch_chunks" => {
                match serde_json::from_value::<CorpusFetchQuery>(
                    params.get("query").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(query) => serialize_result(
                        CorpusExportService::new(&store).fetch_chunks(&query),
                    ),
                    Err(error) => Err(error.to_string()),
                }
            }
            "context.materialize" => {
                match serde_json::from_value::<ContextPlan>(
                    params.get("plan").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(plan) => {
                        let scope = params
                            .get("scope")
                            .and_then(Value::as_str)
                            .unwrap_or("internal")
                            .to_string();
                        serialize_result(
                            ContextMaterializerService::new(&store, &store)
                                .materialize(&plan, &scope),
                        )
                    }
                    Err(error) => Err(error.to_string()),
                }
            }
            other => Err(format!("unsupported retrieval/context method: {other}")),
        };
        result.map_err(RuntimeHostError::InvalidResponse)
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
        use ielts_application::{
            CognitiveReadService, LearnerModelService, MemoryService,
        };
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
                        // Merged envelope: the state snapshot carries `states`
                        // (skill views/uncertainty) while the planner's
                        // enrichment reads `needs` (M4 scheduler review rows).
                        // Needs are best-effort: a scheduler miss degrades to
                        // an empty list, never a failed snapshot.
                        let needs_result = db.with_conn(|conn| {
                            ielts_db::skill_review_needs_snapshot(
                                conn,
                                &ielts_domain::SkillReviewNeedsQuery {
                                    due_before: None,
                                    after_skill_key: query.after_skill_key.clone(),
                                    limit: query.limit,
                                },
                            )
                        });
                        // Degrading to an empty list is deliberate (above), but the
                        // failure must not be invisible: an empty `needs` is
                        // otherwise indistinguishable from "nothing is due", so a
                        // scheduler read error silently yields a study plan built
                        // from no review needs at all, and the plan looks fine.
                        // Log it, and tell the consumer which of the two happened.
                        let needs_available = needs_result.is_ok();
                        if let Err(error) = &needs_result {
                            tracing::warn!(
                                error = %error,
                                "skill review needs unavailable; the planner will                                  see an empty review list for this snapshot"
                            );
                        }
                        let needs = needs_result
                            .map(|snapshot| snapshot.needs)
                            .unwrap_or_default();
                        let merged = serialize_result(
                            LearnerModelService::new(&store).state_snapshot(&query),
                        )
                        .map(|mut value| {
                            if let Some(object) = value.as_object_mut() {
                                object.insert(
                                    "needs".to_string(),
                                    serde_json::to_value(needs).unwrap_or(Value::Array(vec![])),
                                );
                                // Lets the sidecar separate "no reviews due" from
                                // "the scheduler read failed" instead of guessing
                                // from an empty list.
                                object.insert(
                                    "needsAvailable".to_string(),
                                    Value::Bool(needs_available),
                                );
                            }
                            value
                        });
                        merged
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
                match params.get("ids").and_then(Value::as_array) {
                    Some(array) => {
                        let ids = array
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_owned)
                            .collect::<Vec<_>>();
                        serialize_result(
                            CognitiveReadService::new(&store).learning_events_by_ids(&ids),
                        )
                    }
                    None => Err("evidence ids must be an array".to_string()),
                }
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

    /// M7-03/M7-07: serve the Daily Journal build + Daily Dream run reverse-RPC.
    ///
    /// Python asks Rust to build the deterministic daily facts (no LLM) or to
    /// record dream proposals as pending candidates. Rust is the authority: the
    /// journal is a deterministic derived projection, and dreams only produce
    /// pending candidates that must still go through M3
    /// `promote_memory_candidate` before touching active memory.
    #[cfg(feature = "daily-dream-v1")]
    async fn invoke_journal_dream(
        &self,
        app: &AppHandle,
        method: &str,
        params: &serde_json::Map<String, Value>,
    ) -> Result<Value, RuntimeHostError> {
        use ielts_application::{DreamService, JournalService};
        use ielts_domain::{DailyDreamQuery, DailyJournalQuery, PatternProposal, WeeklyDreamQuery};

        const JOURNAL_DREAM_RESPONSE_BYTES: usize = 256 * 1024;

        let db = app.state::<AppDb>();
        let store = crate::app::application_store::ApplicationStore::new(db.inner());
        let result: Result<Value, String> = match method {
            "journal.build_daily" => {
                // Python sends {day, userId?} (dream daily orchestrator);
                // mirror the dream.run_daily envelope.
                let outcome = (|| -> Result<Value, String> {
                    let day = params
                        .get("day")
                        .and_then(Value::as_str)
                        .ok_or_else(|| "journal.build_daily requires day".to_string())?;
                    let user_id = params
                        .get("userId")
                        .and_then(Value::as_str)
                        .unwrap_or("local");
                    if !is_iso_day(day) {
                        return Err(format!(
                            "journal.build_daily day must be YYYY-MM-DD: {day}"
                        ));
                    }
                    serialize_result(
                        JournalService::new(&store).build_facts(&DailyJournalQuery {
                            user_id: user_id.to_string(),
                            journal_date: day.to_string(),
                        }),
                    )
                })();
                outcome
            }
            "dream.run_daily" => {
                // M7-07/M7-08: Rust is the authority. Proposals are parsed
                // strictly (a malformed proposal is a visible rejection, never
                // a silent drop), the run drives queued→running→completed,
                // and the reply matches the Python dream contract:
                // {runId, accepted, rejected, failed}.
                let dream_service = DreamService::new(&store);
                let journal_service = JournalService::new(&store);
                let now = chrono::Utc::now().to_rfc3339();
                let outcome = (|| -> Result<Value, String> {
                    // Python sends {day, userId?, inputHash?, proposals}. The
                    // dream run row references the day's journal (FK), so
                    // resolve the published journal or build+insert the
                    // deterministic one before claiming a run.
                    let day = params
                        .get("day")
                        .and_then(Value::as_str)
                        .ok_or_else(|| "dream.run_daily requires day".to_string())?
                        .to_string();
                    if !is_iso_day(&day) {
                        return Err(format!("dream.run_daily day must be YYYY-MM-DD: {day}"));
                    }
                    let user_id = params
                        .get("userId")
                        .and_then(Value::as_str)
                        .unwrap_or("local")
                        .to_string();
                    let journal_query = DailyJournalQuery {
                        user_id: user_id.clone(),
                        journal_date: day.clone(),
                    };
                    let journal = match journal_service
                        .load_latest_journal(&journal_query)
                        .map_err(|error| error.to_string())?
                    {
                        Some(journal) => journal,
                        None => journal_service
                            .build_facts(&journal_query)
                            .and_then(|facts| journal_service.insert_journal(&facts, None))
                            .map_err(|error| error.to_string())?,
                    };
                    let query = DailyDreamQuery {
                        user_id: user_id.clone(),
                        journal_id: journal.id,
                    };
                    let mut proposals = Vec::new();
                    let mut parse_rejected = 0usize;
                    if let Some(array) = params.get("proposals").and_then(Value::as_array) {
                        for item in array {
                            match serde_json::from_value::<ielts_domain::DreamProposal>(item.clone())
                            {
                                Ok(proposal) => proposals.push(proposal),
                                Err(_) => parse_rejected += 1,
                            }
                        }
                    }
                    let run = dream_service
                        .insert_dream_run(
                            &query,
                            params.get("inputHash").and_then(Value::as_str),
                        )
                        .map_err(|error| error.to_string())?;
                    let result = (|| -> Result<Value, String> {
                        dream_service
                            .start_dream_run(&run.id, &now)
                            .map_err(|error| error.to_string())?;
                        let (candidates, capacity_rejected) = dream_service
                            .record_proposals(&run.id, &proposals)
                            .map_err(|error| error.to_string())?;
                        let output_hash = Self::dream_output_hash(&candidates);
                        dream_service
                            .finish_dream_run(&run.id, &output_hash, &now)
                            .map_err(|error| error.to_string())?;
                        Ok(json!({
                            "runId": run.id,
                            "accepted": candidates.len(),
                            "rejected": parse_rejected + capacity_rejected,
                            "failed": 0,
                        }))
                    })();
                    if let Err(error) = &result {
                        // Fail-closed: record the run failure before surfacing
                        // the error channel back to Python.
                        let _ = dream_service.fail_run(&run.id, &json!({"error": error}), &now);
                    }
                    result
                })();
                outcome
            }
            "dream.run_weekly" => {
                // M8-02: Rust re-validates sidecar-proposed cross-scope patterns
                // by stable memory ID (never trusting the LLM index), applies
                // consolidation as relations + supersede (never deletes), and
                // returns a report. Empty validated is success (M8-01).
                //
                // Round-3 audit (A3): this arm previously read
                // `params["query"]` as a `WeeklyDreamQuery`. The sidecar sends
                // `{window, patterns}` and has never sent `query`, so the
                // deserialize saw `Null` against a struct with two required
                // fields and the arm returned an error on every real call —
                // the whole weekly path was dead on arrival. It also returned
                // `WeeklyDreamResult`, whose counts are arrays nested under
                // `report`, while the sidecar reads TOP-LEVEL ints
                // (`validated`/`rejected`/`accepted`) and silently defaults
                // them to 0. Both halves are on record as a dormant P1 in
                // .planning/agent_backend_audit_20260824/findings.md:132.
                //
                // The window resolves to a journal the same way the daily arm
                // does, so the run gets a real FK-checked `dream_runs` row, and
                // the reply now matches the flat contract the sidecar parses.
                let journal_service = JournalService::new(&store);
                (|| -> Result<Value, String> {
                    let window = params
                        .get("window")
                        .and_then(Value::as_str)
                        .ok_or_else(|| "dream.run_weekly requires window".to_string())?;
                    let day = resolve_weekly_window_day(window)?;
                    let user_id = params
                        .get("userId")
                        .and_then(Value::as_str)
                        .unwrap_or("local")
                        .to_string();
                    let journal_query = DailyJournalQuery {
                        user_id: user_id.clone(),
                        journal_date: day,
                    };
                    let journal = match journal_service
                        .load_latest_journal(&journal_query)
                        .map_err(|error| error.to_string())?
                    {
                        Some(journal) => journal,
                        None => journal_service
                            .build_facts(&journal_query)
                            .and_then(|facts| journal_service.insert_journal(&facts, None))
                            .map_err(|error| error.to_string())?,
                    };
                    // A malformed proposal is a visible rejection, never a
                    // silent drop — same rule the daily arm follows.
                    let mut proposals = Vec::new();
                    let mut parse_rejected = 0usize;
                    if let Some(array) = params.get("patterns").and_then(Value::as_array) {
                        for item in array {
                            match serde_json::from_value::<PatternProposal>(item.clone()) {
                                Ok(proposal) => proposals.push(proposal),
                                Err(_) => parse_rejected += 1,
                            }
                        }
                    }
                    let query = WeeklyDreamQuery {
                        user_id,
                        journal_id: journal.id,
                    };
                    let result =
                        crate::commands::journal::run_weekly_consolidation(db.inner(), &query, &proposals)
                            .map_err(|error| error.to_string())?;
                    Ok(json!({
                        "runId": result.run_id,
                        "validated": result.report.validated.len(),
                        "rejected": result.report.rejected.len() + parse_rejected,
                        "accepted": result.receipts.len(),
                    }))
                })()
            }
            "memory.candidate_pool" => {
                // M8-02: bounded active + pending observed candidate memories.
                // Rust is the authority; predicted-only memories are excluded
                // (M8-10). Returns stable IDs + summaries only (no full bodies).
                let window = params
                    .get("window")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                match self.load_candidate_pool(app, &window).await {
                    Ok(value) => Ok(value),
                    Err(error) => Err(error.to_string()),
                }
            }
            other => Err(format!("unsupported journal/dream method: {other}")),
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

    /// Stable output hash for a completed dream run: SHA-256 over the recorded
    /// candidate ids + dispositions, so the dream_runs ledger is auditable
    /// without re-reading candidate bodies.
    #[cfg(feature = "daily-dream-v1")]
    fn dream_output_hash(candidates: &[ielts_domain::DreamCandidate]) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        for candidate in candidates {
            hasher.update(candidate.id.as_bytes());
            hasher.update(candidate.disposition.as_str().as_bytes());
        }
        format!("{:x}", hasher.finalize())
    }

    /// M10: serve the teaching-strategy evolution reverse-RPC. Rust is the
    /// evolution authority: selection (M10-06), assignment recording (M10-02),
    /// the two reward channels (M10-03: satisfaction vs learning on separate
    /// tables), the delayed outcome window (M10-04), per-user state (M10-05),
    /// and the candidate promotion gate (M10-08). Python only receives derived
    /// DTOs + stable strategy ids.
    #[cfg(feature = "daily-dream-v1")]
    async fn invoke_teaching_strategy(
        &self,
        app: &AppHandle,
        method: &str,
        params: &serde_json::Map<String, Value>,
    ) -> Result<Value, RuntimeHostError> {
        use ielts_application::TeachingStrategyService;
        use ielts_domain::{
            RecordStrategyAssignmentCommand, RecordStrategyFeedbackCommand,
            RecordStrategyOutcomeCommand, SelectStrategyCommand, TeachingStrategyId,
        };

        const STRATEGY_RESPONSE_BYTES: usize = 256 * 1024;

        let db = app.state::<AppDb>();
        let store = crate::app::application_store::ApplicationStore::new(db.inner());
        let service = TeachingStrategyService::new(&store);
        let result: Result<Value, String> = match method {
            "strategy.select" => {
                match serde_json::from_value::<SelectStrategyCommand>(
                    params.get("query").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(query) => serialize_result(service.select_strategy(&query)),
                    Err(error) => Err(error.to_string()),
                }
            }
            "strategy.record_assignment" => {
                match serde_json::from_value::<RecordStrategyAssignmentCommand>(
                    params.get("command").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(command) => serialize_result(service.record_assignment(&command)),
                    Err(error) => Err(error.to_string()),
                }
            }
            "strategy.record_feedback" => {
                match serde_json::from_value::<RecordStrategyFeedbackCommand>(
                    params.get("command").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(command) => serialize_result(service.record_feedback(&command)),
                    Err(error) => Err(error.to_string()),
                }
            }
            "strategy.record_outcome" => {
                match serde_json::from_value::<RecordStrategyOutcomeCommand>(
                    params.get("command").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(command) => serialize_result(service.record_outcome(&command)),
                    Err(error) => Err(error.to_string()),
                }
            }
            "strategy.user_state" => {
                let user_id = params
                    .get("userId")
                    .and_then(Value::as_str)
                    .unwrap_or("local")
                    .to_string();
                let strategy_id_str = params
                    .get("strategyId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let scope = params
                    .get("scope")
                    .and_then(Value::as_str)
                    .unwrap_or("general")
                    .to_string();
                match TeachingStrategyId::parse(strategy_id_str) {
                    Some(strategy_id) => {
                        serialize_result(service.user_state(&user_id, strategy_id, &scope))
                    }
                    None => Err(format!("unknown strategy id: {strategy_id_str}")),
                }
            }
            other => Err(format!("unsupported strategy method: {other}")),
        };
        let value = result.map_err(RuntimeHostError::InvalidResponse)?;
        let size = serde_json::to_vec(&value)
            .map_err(|error| RuntimeHostError::InvalidResponse(error.to_string()))?
            .len();
        if size > STRATEGY_RESPONSE_BYTES {
            return Err(RuntimeHostError::InvalidResponse(format!(
                "strategy response exceeds {STRATEGY_RESPONSE_BYTES} bytes"
            )));
        }
        Ok(value)
    }

    /// M11: prompt/skill registry + eval-driven evolution reverse-RPC. Rust is
    /// the release gate (M11-05 lifecycle: propose→eval→holdout→shadow→approval
    ///→canary→promote→rollback). Online self-modifying prompt is forbidden
    /// (M11-06); candidate cannot skip eval.
    #[cfg(feature = "daily-dream-v1")]
    async fn invoke_prompt_skill(
        &self,
        app: &AppHandle,
        method: &str,
        params: &serde_json::Map<String, Value>,
    ) -> Result<Value, RuntimeHostError> {
        use ielts_application::PromptSkillService;
        // PromoteCandidateCommand / RollbackCommand / RunEvalCommand are
        // deliberately absent: those methods are not served on this path.
        use ielts_domain::{ProposeCandidateCommand, PromptModule, SkillName};

        let db = app.state::<AppDb>();
        let store = crate::app::application_store::ApplicationStore::new(db.inner());
        let service = PromptSkillService::new(&store);
        let result: Result<Value, String> = match method {
            "prompt.list_versions" => {
                let module = serde_json::from_value::<PromptModule>(
                    params.get("module").cloned().unwrap_or(Value::Null),
                );
                match module {
                    Ok(module) => serialize_result(
                        service.list_prompt_versions(module).map(|versions| {
                            serde_json::to_value(versions).unwrap_or(Value::Null)
                        }),
                    ),
                    Err(error) => Err(error.to_string()),
                }
            }
            "prompt.get_active" => {
                let module = serde_json::from_value::<PromptModule>(
                    params.get("module").cloned().unwrap_or(Value::Null),
                );
                match module {
                    Ok(module) => serialize_result(
                        service.get_active_prompt_version(module).map(|maybe| {
                            serde_json::to_value(maybe).unwrap_or(Value::Null)
                        }),
                    ),
                    Err(error) => Err(error.to_string()),
                }
            }
            "prompt.propose_candidate" => {
                let command = serde_json::from_value::<ProposeCandidateCommand>(
                    params.get("command").cloned().unwrap_or(Value::Null),
                );
                match command {
                    Ok(command) => serialize_result(
                        service.propose_candidate(&command).map(|promotion| {
                            serde_json::to_value(promotion).unwrap_or(Value::Null)
                        }),
                    ),
                    Err(error) => Err(error.to_string()),
                }
            }
            // Round-3 audit (A2): `prompt.promote_candidate`, `prompt.rollback`
            // and `eval.run_case` are intentionally NOT served here. Promotion
            // and rollback activate or reverse a live version; `eval.run_case`
            // persists caller-supplied `passed` gradings and advances a candidate
            // to `eval_passed`, which is the sole precondition for approval — so
            // serving it to the sidecar would let the runtime author the very
            // evidence the human gate reviews. All three stay UI-only.
            "skill.list_versions" => {
                let skill = serde_json::from_value::<SkillName>(
                    params.get("skill").cloned().unwrap_or(Value::Null),
                );
                match skill {
                    Ok(skill) => serialize_result(
                        service.list_skill_versions(skill).map(|versions| {
                            serde_json::to_value(versions).unwrap_or(Value::Null)
                        }),
                    ),
                    Err(error) => Err(error.to_string()),
                }
            }
            other => Err(format!("unsupported prompt/skill method: {other}")),
        };
        result.map_err(RuntimeHostError::InvalidResponse)
    }

    /// M12-01/02/04/06: serve the General Agent Thread reverse-RPC. Rust is
    /// the controlled-action authority: threads, checkpoints, study plans,
    /// and approvals are persisted here; Python owns planner orchestration
    /// and calls back through these methods. Forbidden action kinds are
    /// rejected by the `tool.invoke` dispatcher before reaching this method.
    #[cfg(feature = "agent-threads-v1")]
    async fn invoke_agent_thread(
        &self,
        app: &AppHandle,
        method: &str,
        params: &serde_json::Map<String, Value>,
    ) -> Result<Value, RuntimeHostError> {
        use ielts_application::AgentThreadService;
        // DecideApprovalCommand is deliberately absent: `approval.decide` is not
        // served on this path.
        use ielts_domain::{
            CreateStudyPlanCommand, CreateStudyPlanItemCommand, CreateThreadCommand,
            MarkPlanItemDoneCommand, RecordApprovalCommand, RequestCancelCommand,
            SaveCheckpointCommand,
        };

        const THREAD_RESPONSE_BYTES: usize = 512 * 1024;

        let db = app.state::<AppDb>();
        let store = crate::app::application_store::ApplicationStore::new(db.inner());
        let service = AgentThreadService::new(&store);
        let result: Result<Value, String> = match method {
            "thread.create" => {
                match serde_json::from_value::<CreateThreadCommand>(
                    params.get("command").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(command) => serialize_result(service.create_thread(&command)),
                    Err(error) => Err(error.to_string()),
                }
            }
            "thread.append_message" => {
                match serde_json::from_value::<ielts_domain::AppendMessageCommand>(
                    params.get("command").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(command) => serialize_result(service.append_message(&command)),
                    Err(error) => Err(error.to_string()),
                }
            }
            "thread.list" => {
                let user_id = params
                    .get("userId")
                    .and_then(Value::as_str)
                    .unwrap_or("local")
                    .to_string();
                let limit = params
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(50) as u32;
                serialize_result(service.list_threads(&user_id, limit))
            }
            "thread.save_checkpoint" => {
                match serde_json::from_value::<SaveCheckpointCommand>(
                    params.get("command").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(command) => serialize_result(service.save_checkpoint(&command)),
                    Err(error) => Err(error.to_string()),
                }
            }
            "thread.request_cancel" => {
                match serde_json::from_value::<RequestCancelCommand>(
                    params.get("command").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(command) => serialize_result(service.request_cancel(&command)),
                    Err(error) => Err(error.to_string()),
                }
            }
            "approval.list" => {
                let limit = params
                    .get("limit")
                    .and_then(Value::as_u64)
                    .unwrap_or(50) as u32;
                serialize_result(service.list_pending_approvals(limit))
            }
            // Round-3 audit (A2): `approval.decide` is intentionally NOT served
            // here. `decide_approval` validates `approvedBy` only as non-empty
            // text, so serving it to the sidecar let the runtime approve its own
            // pending actions and record a fabricated approver. Deciding is a
            // human action and stays on the Tauri command path.
            "approval.record" => {
                // M12-06: record an approval-gated action as pending. Allow-
                // listed kinds are rejected by the service; forbidden kinds
                // never reach here (rejected by tool.invoke).
                match serde_json::from_value::<RecordApprovalCommand>(
                    params.get("command").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(command) => serialize_result(service.record_action_approval(&command)),
                    Err(error) => Err(error.to_string()),
                }
            }
            "study_plan.create" => {
                // Python sends {proposal: {userGoal, items: [...]}} where each
                // item carries a structured skillProbe. The persistence schema
                // stores the skill key as the probe string; reply with the
                // {planId} envelope Python's orchestrator contract requires.
                let parsed = params
                    .get("proposal")
                    .cloned()
                    .ok_or_else(|| "study_plan.create requires proposal".to_string())
                    .and_then(|value| serde_json::from_value::<PlannerProposalWire>(value).map_err(|error| error.to_string()));
                match parsed {
                    Ok(proposal) => {
                        let command = CreateStudyPlanCommand {
                            user_id: proposal.user_id,
                            goal: proposal.user_goal,
                            available_minutes: proposal.total_estimated_minutes,
                            target_date: None,
                            items: proposal
                                .items
                                .iter()
                                .map(|item| CreateStudyPlanItemCommand {
                                    skill_probe: item.skill_probe.skill_key.clone(),
                                    why_text: item.why_text.clone(),
                                    estimated_minutes: item.estimated_minutes,
                                })
                                .collect(),
                        };
                        match service.create_study_plan(&command) {
                            Ok(plan) => Ok(json!({
                                "planId": plan.id,
                                "accepted": proposal.items.len(),
                                "rejected": 0,
                            })),
                            Err(error) => Err(error.message),
                        }
                    }
                    Err(error) => Err(error),
                }
            }
            "study_plan.list_items" => {
                let plan_id = params
                    .get("planId")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                serialize_result(service.list_study_plan_items(&plan_id))
            }
            "study_plan.mark_done" => {
                match serde_json::from_value::<MarkPlanItemDoneCommand>(
                    params.get("command").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(command) => serialize_result(service.mark_plan_item_done(&command)),
                    Err(error) => Err(error.to_string()),
                }
            }
            other => Err(format!("unsupported agent thread method: {other}")),
        };
        let value = result.map_err(RuntimeHostError::InvalidResponse)?;
        let size = serde_json::to_vec(&value)
            .map_err(|error| RuntimeHostError::InvalidResponse(error.to_string()))?
            .len();
        if size > THREAD_RESPONSE_BYTES {
            return Err(RuntimeHostError::InvalidResponse(format!(
                "agent thread response exceeds {THREAD_RESPONSE_BYTES} bytes"
            )));
        }
        Ok(value)
    }

    /// M8-02: load a bounded candidate memory pool for the Weekly Dream. Rust
    /// returns stable `mem-*` IDs + summaries; predicted-only memories are
    /// excluded (M8-10). The pool reuses `MemoryStore::context_preview`, which
    /// already applies sensitivity filtering + bounded counts.
    #[cfg(feature = "daily-dream-v1")]
    async fn load_candidate_pool(
        &self,
        app: &AppHandle,
        _window: &str,
    ) -> Result<Value, RuntimeHostError> {
        use ielts_application::MemoryService;
        use ielts_domain::{Activity, MemoryContextQuery};
        let db = app.state::<AppDb>();
        let store = crate::app::application_store::ApplicationStore::new(db.inner());
        let service = MemoryService::new(&store);
        // Activity-scoped pool: the Weekly Dream operates over the user's active
        // memory across the recent window. We sample the reading activity slice
        // as the bounded pool (the full cross-activity pool is an M9 diagnostic
        // surface; M8 keeps the reverse-RPC bounded + simple).
        let query = MemoryContextQuery {
            user_id: "local".into(),
            activity: Activity::Reading,
            current_instruction: None,
            limit: 50,
        };
        let preview = service
            .context_preview(&query)
            .map_err(|error| RuntimeHostError::InvalidResponse(error.message))?;
        let candidates: Vec<Value> = preview
            .entries
            .into_iter()
            .filter(|entry| entry.id.is_some())
            .map(|entry| {
                json!({
                    "memoryId": entry.id,
                    "key": entry.key,
                    "pendingVerification": entry.pending_verification,
                })
            })
            .collect();
        Ok(json!({
            "candidates": candidates,
            "truncated": preview.truncated,
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
    ) -> Result<Value, RuntimeHostError> {
        let request = params
            .get("request")
            .cloned()
            .ok_or_else(|| RuntimeHostError::InvalidResponse("model request is missing".into()))?;
        let request: CompletionRequest = serde_json::from_value(request)
            .map_err(|error| RuntimeHostError::InvalidResponse(error.to_string()))?;
        validate_model_request(&request)?;
        let db = app.state::<AppDb>();
        let vault = app.state::<AppVault>();
        let runtime = load_runtime(&db, &vault)
            .map_err(|error| RuntimeHostError::Process(error.to_string()))?;
        let response = tokio::time::timeout(timeout, runtime.complete(request))
            .await
            .map_err(|_| RuntimeHostError::Timeout)?
            .map_err(|error| RuntimeHostError::Process(error.to_string()))?;
        serde_json::to_value(response)
            .map_err(|error| RuntimeHostError::InvalidResponse(error.to_string()))
    }

    /// M5-04: serve the `model.embed.batch` reverse-RPC.
    ///
    /// Python asks for an embedding batch; Rust resolves the provider through
    /// the same `load_runtime` + `AppVault` path as `model.invoke`, then delegates
    /// to `LanguageModel::embed`. Slice 4 only stands up the contract — the
    /// `AiRuntime` impl keeps the default `embedding_not_supported` error until
    /// the M5-11 eval gate proves embeddings add value and a real provider
    /// endpoint is wired. The capability is advertised so Python can probe
    /// readiness and persist the signature contract; a not_supported error is
    /// surfaced to the caller rather than silently degrading to lexical.
    #[cfg(feature = "context-compiler-v1")]
    async fn invoke_embed(
        &self,
        app: &AppHandle,
        params: &serde_json::Map<String, Value>,
        timeout: Duration,
    ) -> Result<Value, RuntimeHostError> {
        let request = params
            .get("request")
            .cloned()
            .ok_or_else(|| RuntimeHostError::InvalidResponse("embedding request is missing".into()))?;
        let request: ielts_domain::EmbeddingRequest = serde_json::from_value(request)
            .map_err(|error| RuntimeHostError::InvalidResponse(error.to_string()))?;
        validate_embed_request(&request)?;
        let db = app.state::<AppDb>();
        let vault = app.state::<AppVault>();
        let runtime = load_runtime(&db, &vault)
            .map_err(|error| RuntimeHostError::Process(error.to_string()))?;
        let response = tokio::time::timeout(timeout, runtime.embed(request))
            .await
            .map_err(|_| RuntimeHostError::Timeout)?
            .map_err(|error| RuntimeHostError::Process(error.to_string()))?;
        serde_json::to_value(response)
            .map_err(|error| RuntimeHostError::InvalidResponse(error.to_string()))
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
/// is a derived runtime — it may PROPOSE (`prompt.propose_candidate`) and it may
/// REQUEST a decision (`approval.record`), but it may not grant one.
///
/// All of these remain available to the UI through their Tauri commands.
pub(crate) const HOST_ONLY_METHODS: &[&str] = &[
    "prompt.promote_candidate",
    "prompt.rollback",
    "eval.run_case",
    "approval.decide",
];

pub(crate) fn is_host_only_method(method: &str) -> bool {
    HOST_ONLY_METHODS.contains(&method)
}

fn validate_model_request(request: &CompletionRequest) -> Result<(), RuntimeHostError> {
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
    if request.temperature != 0.0 {
        return Err(RuntimeHostError::InvalidResponse(
            "memory model temperature must be zero".into(),
        ));
    }
    // Round-3 audit (7.8): `maxTokens` is now part of the wire contract, so the
    // sidecar can set it. Bound it here — an unbounded ceiling defeats the point
    // and a zero ceiling would make every sidecar completion return empty.
    if let Some(max_tokens) = request.max_tokens {
        if max_tokens == 0 || max_tokens > SIDECAR_MAX_OUTPUT_TOKENS {
            return Err(RuntimeHostError::InvalidResponse(format!(
                "model request maxTokens must be between 1 and {SIDECAR_MAX_OUTPUT_TOKENS}"
            )));
        }
    }
    Ok(())
}

/// M5-04: bound the embedding batch so Python can never probe the gateway with
/// an oversized or empty batch. Empty batches are rejected (no-cost probes);
/// the per-text byte cap matches the frame ceiling so a batch cannot exceed the
/// framed protocol budget.
fn validate_embed_request(request: &ielts_domain::EmbeddingRequest) -> Result<(), RuntimeHostError> {
    if request.texts.is_empty() {
        return Err(RuntimeHostError::InvalidResponse(
            "embedding request must contain at least one text".into(),
        ));
    }
    if request.texts.len() > ielts_domain::MAX_CORPUS_FETCH_IDS {
        return Err(RuntimeHostError::FrameTooLarge(request.texts.len()));
    }
    let bytes = request
        .texts
        .iter()
        .try_fold(0usize, |total, text| {
            Ok(total.saturating_add(text.len()))
        })?;
    if bytes > MAX_FRAME_BYTES {
        return Err(RuntimeHostError::FrameTooLarge(bytes));
    }
    Ok(())
}

fn verify_sidecar_hash() -> Result<(), RuntimeHostError> {
    let path = sidecar_hash_path()?;
    let bytes = std::fs::read(&path)
        .map_err(|error| RuntimeHostError::Process(format!("cannot read {}: {error}", path.display())))?;
    let actual = hex::encode(Sha256::digest(bytes));
    if actual != SIDECAR_BUILD_ID {
        return Err(RuntimeHostError::BuildIdentityMismatch);
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
mod tests {
    use super::*;
    use serde_json::json;

    /// Round-3 audit (item 8): every method the host actually sends to the
    /// sidecar must be negotiated in the handshake. `dream.daily` and
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
            "dream.daily",
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

    /// Round-3 audit (A3): the sidecar sends an ISO week (`2026-W33`) as the
    /// weekly `window`. The arm used to read a `query` key the sidecar never
    /// sends, so it errored on every real call before validating anything.
    #[test]
    fn weekly_window_resolves_iso_week_to_its_monday() {
        assert_eq!(
            resolve_weekly_window_day("2026-W33").unwrap(),
            "2026-08-10"
        );
        // A plain ISO day is also documented as accepted, and passes through.
        assert_eq!(
            resolve_weekly_window_day("2026-08-16").unwrap(),
            "2026-08-16"
        );
    }

    #[test]
    fn weekly_window_fails_closed_on_garbage() {
        for window in ["", "nonsense", "2026-W99", "2026-Wxx", "20260810", "2026/08/10"] {
            assert!(
                resolve_weekly_window_day(window).is_err(),
                "{window} must not resolve to a journal day"
            );
        }
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

    /// The legitimate propose/request surface must stay reachable, so the fix
    /// above cannot be "solved" by over-trimming.
    #[test]
    fn propose_and_request_methods_stay_available() {
        for method in [
            "prompt.propose_candidate",
            "approval.record",
            "approval.list",
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
    fn sidecar_output_ceiling_is_bounded() {
        let message = ChatMessage::new("user", "hello");
        let request = |max_tokens| CompletionRequest {
            messages: vec![message.clone()],
            temperature: 0.0,
            max_tokens,
        };
        assert!(validate_model_request(&request(None)).is_ok());
        assert!(validate_model_request(&request(Some(1))).is_ok());
        assert!(validate_model_request(&request(Some(SIDECAR_MAX_OUTPUT_TOKENS))).is_ok());
        assert!(
            validate_model_request(&request(Some(0))).is_err(),
            "a zero ceiling would make every completion return empty"
        );
        assert!(
            validate_model_request(&request(Some(SIDECAR_MAX_OUTPUT_TOKENS + 1))).is_err(),
            "the sidecar must not request an unbounded completion"
        );
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
