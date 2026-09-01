//! Reading suite state machine (Phase 7).

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use ielts_domain::domain::{AttemptMode, SuiteFlowMode, SuiteStatus};
use ielts_domain::dto::AttemptRecord;

use crate::history::prune_terminal_attempts_in_transaction;
use crate::modes::timer::{TimerMode, TimerState};
use crate::reading::assets::{
    list_assets, load_answer_key, load_practice_asset_payload, AssetIndexEntry,
};
use crate::reading::attempt::{
    save_reading_draft_in_scope, submit_reading_attempt_in_scope, ReadingDraftCommand,
    ReadingQuestionProgress, ReadingSubmitCommand, ReadingSubmitResult,
};
use crate::sqlite::{DbError, DbResult};
use ielts_domain::domain::Activity;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PassageStatus {
    Pending,
    Active,
    Submitted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrequencyScope {
    High,
    HighMedium,
    All,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SuitePassageEntry {
    pub index: u32,
    pub asset_id: String,
    pub exam_id: String,
    pub title: String,
    pub category: String,
    pub status: PassageStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    /// Review routes historically used sessionId; keep both equal to attempt id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submitted_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score_info: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SuiteAggregate {
    pub submitted_passages: u32,
    pub total_passages: u32,
    pub correct: f64,
    pub total_questions: f64,
    pub accuracy: f64,
    pub percentage: f64,
    pub duration: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingSuiteSession {
    pub session_id: String,
    pub activity: String,
    pub practice_mode: String,
    pub status: SuiteStatus,
    pub flow_mode: SuiteFlowMode,
    pub frequency_scope: FrequencyScope,
    pub timer: TimerState,
    pub current_index: u32,
    pub total_passages: u32,
    pub sequence: Vec<SuitePassageEntry>,
    pub aggregate: SuiteAggregate,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSuiteCommand {
    #[serde(default)]
    pub flow_mode: Option<String>,
    #[serde(default)]
    pub frequency_scope: Option<String>,
    #[serde(default)]
    pub seed: Option<String>,
    /// Ordered asset ids for custom sequence (must be length 3: P1/P2/P3).
    #[serde(default)]
    pub sequence: Vec<SuiteAssetSeed>,
    #[serde(default)]
    pub timer: Option<TimerState>,
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

/// Request a single answerable Reading asset without creating a mode session.
/// Selection policy belongs to Rust even though the resulting single practice
/// has no durable session of its own.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct PickReadingPracticeAssetCommand {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PickedReadingPracticeAsset {
    pub asset_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SuiteAssetSeed {
    pub asset_id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct SubmitSuitePassageCommand {
    pub suite_id: String,
    pub asset_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_revision: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_fingerprint: Option<String>,
    #[serde(default)]
    pub answers: Value,
    #[serde(default)]
    pub marked_questions: Vec<String>,
    #[serde(default)]
    pub question_timeline: Vec<ReadingQuestionProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timer_snapshot: Option<TimerState>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitSuitePassageResult {
    pub suite_session: ReadingSuiteSession,
    pub submission: ReadingSubmitResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct SaveSuitePassageDraftCommand {
    pub suite_id: String,
    pub asset_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_revision: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_fingerprint: Option<String>,
    #[serde(default)]
    pub answers: Value,
    #[serde(default)]
    pub marked_questions: Vec<String>,
    #[serde(default)]
    pub question_timeline: Vec<ReadingQuestionProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timer_snapshot: Option<TimerState>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSuitePassageDraftResult {
    pub suite_session: ReadingSuiteSession,
    pub attempt: AttemptRecord,
}

fn normalize_flow(raw: Option<&str>) -> SuiteFlowMode {
    match raw.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("classic") => SuiteFlowMode::Classic,
        Some("stationary") => SuiteFlowMode::Stationary,
        _ => SuiteFlowMode::Simulation,
    }
}

fn flow_str(m: SuiteFlowMode) -> &'static str {
    match m {
        SuiteFlowMode::Classic => "classic",
        SuiteFlowMode::Stationary => "stationary",
        SuiteFlowMode::Simulation => "simulation",
    }
}

fn parse_flow(raw: &str) -> SuiteFlowMode {
    normalize_flow(Some(raw))
}

fn normalize_freq(raw: Option<&str>) -> FrequencyScope {
    match raw.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("high") => FrequencyScope::High,
        Some("high_medium") | Some("high-medium") => FrequencyScope::HighMedium,
        Some("custom") => FrequencyScope::Custom,
        _ => FrequencyScope::All,
    }
}

fn freq_str(f: FrequencyScope) -> &'static str {
    match f {
        FrequencyScope::High => "high",
        FrequencyScope::HighMedium => "high_medium",
        FrequencyScope::All => "all",
        FrequencyScope::Custom => "custom",
    }
}

fn parse_freq(raw: &str) -> FrequencyScope {
    normalize_freq(Some(raw))
}

fn status_str(s: SuiteStatus) -> &'static str {
    match s {
        SuiteStatus::Active => "active",
        SuiteStatus::Completed => "completed",
        SuiteStatus::Cancelled => "cancelled",
        SuiteStatus::Interrupted => "interrupted",
    }
}

fn parse_status(raw: &str) -> SuiteStatus {
    match raw {
        "completed" => SuiteStatus::Completed,
        "cancelled" => SuiteStatus::Cancelled,
        "interrupted" => SuiteStatus::Interrupted,
        _ => SuiteStatus::Active,
    }
}

fn passage_status_str(s: PassageStatus) -> &'static str {
    match s {
        PassageStatus::Pending => "pending",
        PassageStatus::Active => "active",
        PassageStatus::Submitted => "submitted",
    }
}

fn parse_passage_status(raw: &str) -> PassageStatus {
    match raw {
        "active" => PassageStatus::Active,
        "submitted" => PassageStatus::Submitted,
        _ => PassageStatus::Pending,
    }
}

fn empty_aggregate(total: u32) -> SuiteAggregate {
    SuiteAggregate {
        submitted_passages: 0,
        total_passages: total,
        correct: 0.0,
        total_questions: 0.0,
        accuracy: 0.0,
        percentage: 0.0,
        duration: 0,
    }
}

fn recompute_aggregate(sequence: &[SuitePassageEntry]) -> SuiteAggregate {
    let mut correct = 0.0;
    let mut total_q = 0.0;
    let mut duration = 0u64;
    let mut submitted = 0u32;
    for entry in sequence {
        if entry.status != PassageStatus::Submitted {
            continue;
        }
        submitted += 1;
        if let Some(score) = &entry.score_info {
            correct += score.get("correct").and_then(|v| v.as_f64()).unwrap_or(0.0);
            total_q += score
                .get("totalQuestions")
                .or_else(|| score.get("total"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            duration += score.get("duration").and_then(|v| v.as_u64()).unwrap_or(0);
        }
    }
    let accuracy = if total_q > 0.0 {
        correct / total_q
    } else {
        0.0
    };
    SuiteAggregate {
        submitted_passages: submitted,
        total_passages: sequence.len() as u32,
        correct,
        total_questions: total_q,
        accuracy,
        percentage: (accuracy * 100.0).round(),
        duration,
    }
}

/// Classic: free navigation after create (all pending except first active).
/// Simulation: sequential only (enforced on submit).
/// Stationary: same sequential submit; UI may freeze navigation (policy flag only).
pub fn create_suite_session(
    conn: &Connection,
    cmd: &CreateSuiteCommand,
) -> DbResult<ReadingSuiteSession> {
    if let Some(key) = cmd.idempotency_key.as_deref() {
        if !key.trim().is_empty() {
            if let Some(prev) = load_idempotent(conn, "suite.create", key)? {
                return Ok(prev);
            }
        }
    }

    let now_ms = chrono::Utc::now().timestamp_millis();
    let now = chrono::Utc::now().to_rfc3339();
    let session_id = format!("suite-{}", Uuid::new_v4());
    let flow = normalize_flow(cmd.flow_mode.as_deref());
    let freq = normalize_freq(cmd.frequency_scope.as_deref());
    let timer = cmd
        .timer
        .clone()
        .unwrap_or_else(|| TimerState::new_suite(now_ms))
        .normalize(now_ms);

    // Auto-pick P1/P2/P3 when sequence is empty (non-custom scopes). Custom must pass seeds.
    let seeds = if cmd.sequence.is_empty() {
        if matches!(freq, FrequencyScope::Custom) {
            return Err(DbError::Validation(
                "custom suite requires an explicit P1/P2/P3 sequence".into(),
            ));
        }
        let assets = list_answerable_reading_assets(conn)?;
        let picker_seed = cmd.seed.as_deref().unwrap_or(session_id.as_str());
        pick_suite_sequence(&assets, freq, Some(picker_seed))?
    } else {
        if cmd.sequence.len() != 3 {
            return Err(DbError::Validation(
                "suite sequence must contain exactly 3 passages (P1/P2/P3)".into(),
            ));
        }
        validate_suite_sequence(conn, &cmd.sequence)?
    };

    let sequence: Vec<SuitePassageEntry> = seeds
        .iter()
        .enumerate()
        .map(|(i, seed)| {
            let cat = seed
                .category
                .clone()
                .unwrap_or_else(|| format!("P{}", i + 1));
            SuitePassageEntry {
                index: i as u32,
                asset_id: seed.asset_id.clone(),
                exam_id: seed.asset_id.clone(),
                title: seed.title.clone().unwrap_or_else(|| seed.asset_id.clone()),
                category: cat,
                status: if i == 0 {
                    PassageStatus::Active
                } else {
                    PassageStatus::Pending
                },
                attempt_id: None,
                session_id: None,
                submitted_at: None,
                score_info: None,
            }
        })
        .collect();

    let session = ReadingSuiteSession {
        session_id: session_id.clone(),
        activity: "reading".into(),
        practice_mode: "suite".into(),
        status: SuiteStatus::Active,
        flow_mode: flow,
        frequency_scope: freq,
        timer,
        current_index: 0,
        total_passages: sequence.len() as u32,
        sequence,
        aggregate: empty_aggregate(seeds.len() as u32),
        created_at: now.clone(),
        updated_at: now.clone(),
        completed_at: None,
    };

    persist_suite(conn, &session)?;
    if let Some(key) = cmd.idempotency_key.as_deref() {
        if !key.trim().is_empty() {
            store_idempotent(conn, "suite.create", key, &session_id, &session)?;
        }
    }
    Ok(session)
}

pub(crate) fn list_answerable_reading_assets(conn: &Connection) -> DbResult<Vec<AssetIndexEntry>> {
    let mut answerable = Vec::new();
    for asset in list_assets(conn, Some(Activity::Reading))? {
        let Ok(loaded) = load_practice_asset_payload(conn, &asset.id) else {
            continue;
        };
        if loaded.asset.pdf_only || load_answer_key(&loaded.payload).is_empty() {
            continue;
        }
        answerable.push(asset);
    }
    Ok(answerable)
}

/// Pick from the indexed, answerable resource set. A caller may provide a seed
/// for a repeatable selection (tests/replay); normal UI requests receive a
/// server-generated seed and never make a frontend random choice.
pub fn pick_reading_practice_asset(
    conn: &Connection,
    cmd: &PickReadingPracticeAssetCommand,
) -> DbResult<PickedReadingPracticeAsset> {
    let requested_category = cmd
        .category
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("all"));
    let category = requested_category.map(|value| normalize_category(Some(value)));
    if let Some(value) = category.as_deref() {
        if !matches!(value, "P1" | "P2" | "P3") {
            return Err(DbError::Validation(format!(
                "unsupported reading practice category: {value}"
            )));
        }
    }

    let mut candidates = list_answerable_reading_assets(conn)?;
    if let Some(category) = category.as_deref() {
        candidates.retain(|asset| normalize_category(asset.category.as_deref()) == category);
    }
    if candidates.is_empty() {
        let scope = category.as_deref().unwrap_or("all categories");
        return Err(DbError::Validation(format!(
            "no answerable reading assets available for {scope}"
        )));
    }

    candidates.sort_by(|left, right| {
        left.id
            .cmp(&right.id)
            .then_with(|| left.title.cmp(&right.title))
    });
    let generated_seed;
    let seed = match cmd
        .seed
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => value,
        None => {
            generated_seed = Uuid::new_v4().to_string();
            &generated_seed
        }
    };
    let index = stable_pick_index(
        Some(seed),
        category.as_deref().unwrap_or("all"),
        candidates.len(),
    );
    Ok(PickedReadingPracticeAsset {
        asset_id: candidates[index].id.clone(),
    })
}

fn validate_suite_sequence(
    conn: &Connection,
    requested: &[SuiteAssetSeed],
) -> DbResult<Vec<SuiteAssetSeed>> {
    if requested.len() != 3 {
        return Err(DbError::Validation(
            "suite sequence must contain exactly 3 passages (P1/P2/P3)".into(),
        ));
    }
    let answerable = list_answerable_reading_assets(conn)?;
    let mut seen = std::collections::HashSet::new();
    let mut canonical = Vec::with_capacity(3);
    for (index, seed) in requested.iter().enumerate() {
        if !seen.insert(seed.asset_id.as_str()) {
            return Err(DbError::Validation(
                "suite sequence cannot contain duplicate assets".into(),
            ));
        }
        let asset = answerable
            .iter()
            .find(|asset| asset.id == seed.asset_id)
            .ok_or_else(|| {
                DbError::Validation(format!(
                    "suite asset is missing or not answerable: {}",
                    seed.asset_id
                ))
            })?;
        let expected = format!("P{}", index + 1);
        let actual = normalize_category(asset.category.as_deref());
        if actual != expected {
            return Err(DbError::Validation(format!(
                "suite passage {} must be {}, got {}",
                index + 1,
                expected,
                actual
            )));
        }
        canonical.push(SuiteAssetSeed {
            asset_id: asset.id.clone(),
            title: Some(asset.title.clone()),
            category: Some(expected),
        });
    }
    Ok(canonical)
}

/// Pure suite picker: one asset each for P1/P2/P3 under the frequency scope.
pub fn pick_suite_sequence(
    assets: &[AssetIndexEntry],
    scope: FrequencyScope,
    seed: Option<&str>,
) -> DbResult<Vec<SuiteAssetSeed>> {
    let mut picks = Vec::with_capacity(3);
    for category in ["P1", "P2", "P3"] {
        let mut candidates: Vec<&AssetIndexEntry> = assets
            .iter()
            .filter(|a| normalize_category(a.category.as_deref()) == category)
            .filter(|a| frequency_matches(scope, a))
            .collect();
        if candidates.is_empty() {
            return Err(DbError::Validation(format!(
                "no reading assets available for {category} under frequency scope"
            )));
        }
        candidates.sort_by(|a, b| a.id.cmp(&b.id).then_with(|| a.title.cmp(&b.title)));
        let index = stable_pick_index(seed, category, candidates.len());
        let chosen = candidates[index];
        picks.push(SuiteAssetSeed {
            asset_id: chosen.id.clone(),
            title: Some(chosen.title.clone()),
            category: Some(category.to_string()),
        });
    }
    Ok(picks)
}

pub(crate) fn normalize_category(raw: Option<&str>) -> String {
    let value = raw.unwrap_or("").trim().to_ascii_uppercase();
    if value.contains("P1") {
        "P1".into()
    } else if value.contains("P2") {
        "P2".into()
    } else if value.contains("P3") {
        "P3".into()
    } else if value.is_empty() {
        "P1".into()
    } else {
        value
    }
}

fn normalize_asset_frequency(asset: &AssetIndexEntry) -> &'static str {
    let blob = [
        asset.frequency.as_deref(),
        asset.difficulty.as_deref(),
        Some(asset.title.as_str()),
        Some(asset.id.as_str()),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ")
    .to_ascii_lowercase();
    if blob.contains("medium")
        || blob.contains("次高频")
        || blob.contains("中频")
        || blob.contains("-medium")
    {
        "medium"
    } else if blob.contains("high")
        || blob.contains("超高频")
        || blob.contains("高频")
        || blob.contains("-high")
    {
        "high"
    } else if blob.contains("low") || blob.contains("低频") || blob.contains("-low") {
        "low"
    } else {
        "unknown"
    }
}

pub(crate) fn frequency_matches(scope: FrequencyScope, asset: &AssetIndexEntry) -> bool {
    let freq = normalize_asset_frequency(asset);
    match scope {
        FrequencyScope::All | FrequencyScope::Custom => true,
        FrequencyScope::High => freq == "high",
        FrequencyScope::HighMedium => freq == "high" || freq == "medium",
    }
}

fn stable_pick_index(seed: Option<&str>, category: &str, len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    let material = format!("{}::{}", seed.unwrap_or("suite-default"), category);
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in material.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    (hash as usize) % len
}

#[cfg(test)]
mod pick_tests {
    use super::*;

    fn asset(id: &str, category: &str, frequency: &str) -> AssetIndexEntry {
        AssetIndexEntry {
            id: id.into(),
            title: id.into(),
            category: Some(category.into()),
            difficulty: None,
            frequency: Some(frequency.into()),
            fingerprint: "fp".into(),
            schema_version: 1,
            content_ref: None,
            payload_ref: None,
            activity: "reading".into(),
            pdf_only: false,
        }
    }

    #[test]
    fn pick_suite_sequence_one_per_category() {
        let assets = vec![
            asset("p1-a", "P1", "high"),
            asset("p1-b", "P1", "low"),
            asset("p2-a", "P2", "high"),
            asset("p3-a", "P3", "medium"),
        ];
        let picks = pick_suite_sequence(&assets, FrequencyScope::All, Some("seed-1")).unwrap();
        assert_eq!(picks.len(), 3);
        assert_eq!(picks[0].category.as_deref(), Some("P1"));
        assert_eq!(picks[1].category.as_deref(), Some("P2"));
        assert_eq!(picks[2].category.as_deref(), Some("P3"));
        // Same seed is stable.
        let again = pick_suite_sequence(&assets, FrequencyScope::All, Some("seed-1")).unwrap();
        assert_eq!(picks, again);
    }

    #[test]
    fn pick_suite_high_scope_prefers_high() {
        let assets = vec![
            asset("p1-high", "P1", "high"),
            asset("p1-low", "P1", "low"),
            asset("p2-high", "P2", "high"),
            asset("p3-high", "P3", "high"),
        ];
        let picks = pick_suite_sequence(&assets, FrequencyScope::High, Some("x")).unwrap();
        assert_eq!(picks[0].asset_id, "p1-high");
    }
}

pub fn get_suite_session(conn: &Connection, suite_id: &str) -> DbResult<ReadingSuiteSession> {
    load_suite(conn, suite_id)
}

pub fn save_suite_passage_draft(
    conn: &Connection,
    cmd: &SaveSuitePassageDraftCommand,
) -> DbResult<SaveSuitePassageDraftResult> {
    if cmd.idempotency_key.trim().is_empty() {
        return Err(DbError::Validation("idempotency_key required".into()));
    }
    let tx = conn.unchecked_transaction()?;
    let mut session = load_suite(&tx, &cmd.suite_id)?;
    if session.status != SuiteStatus::Active {
        return Err(DbError::Validation("suite is not active".into()));
    }
    let passage_index = session
        .sequence
        .iter()
        .position(|entry| entry.asset_id == cmd.asset_id)
        .ok_or_else(|| DbError::Validation(format!("asset not in suite: {}", cmd.asset_id)))?;
    if session.sequence[passage_index].status == PassageStatus::Submitted {
        return Err(DbError::Validation("passage already submitted".into()));
    }
    if session.flow_mode != SuiteFlowMode::Classic && passage_index as u32 != session.current_index
    {
        return Err(DbError::Validation(
            "save the active suite passage before moving on".into(),
        ));
    }
    let attempt_id = format!("reading-{}-p{}", session.session_id, passage_index + 1);
    let attempt = save_reading_draft_in_scope(
        &tx,
        &ReadingDraftCommand {
            attempt_id: attempt_id.clone(),
            asset_id: cmd.asset_id.clone(),
            answers: cmd.answers.clone(),
            marked_questions: cmd.marked_questions.clone(),
            question_timeline: cmd.question_timeline.clone(),
            asset_revision: cmd.asset_revision,
            asset_fingerprint: cmd.asset_fingerprint.clone(),
            title_snapshot: cmd.title_snapshot.clone(),
            timer_snapshot: None,
            idempotency_key: format!("suite-draft-{}", cmd.idempotency_key),
        },
        AttemptMode::Suite,
        Some(&session.session_id),
    )?;
    session.timer = session.timer.merge_snapshot(cmd.timer_snapshot.as_ref());
    {
        let passage = &mut session.sequence[passage_index];
        passage.status = PassageStatus::Active;
        passage.attempt_id = Some(attempt_id.clone());
        passage.session_id = Some(attempt_id);
    }
    session.updated_at = chrono::Utc::now().to_rfc3339();
    persist_suite(&tx, &session)?;
    tx.commit()?;
    Ok(SaveSuitePassageDraftResult {
        suite_session: session,
        attempt,
    })
}

pub fn submit_suite_passage(
    conn: &Connection,
    cmd: &SubmitSuitePassageCommand,
) -> DbResult<SubmitSuitePassageResult> {
    let tx = conn.unchecked_transaction()?;
    let result = submit_suite_passage_in_transaction(&tx, cmd)?;
    tx.commit()?;
    Ok(result)
}

fn submit_suite_passage_in_transaction(
    conn: &Connection,
    cmd: &SubmitSuitePassageCommand,
) -> DbResult<SubmitSuitePassageResult> {
    if cmd.idempotency_key.trim().is_empty() {
        return Err(DbError::Validation("idempotency_key required".into()));
    }
    if let Some(mut prev) = load_idempotent_submit(conn, &cmd.idempotency_key)? {
        if prev.suite_session.session_id != cmd.suite_id
            || prev.submission.attempt.asset_id.as_deref() != Some(cmd.asset_id.as_str())
        {
            return Err(DbError::Validation(
                "idempotency key belongs to another suite submission".into(),
            ));
        }
        prev.submission.idempotent_replay = true;
        return Ok(prev);
    }

    let mut session = load_suite(conn, &cmd.suite_id)?;
    if session.status != SuiteStatus::Active {
        return Err(DbError::Validation("suite is not active".into()));
    }

    let passage_index = session
        .sequence
        .iter()
        .position(|e| e.asset_id == cmd.asset_id || e.exam_id == cmd.asset_id)
        .ok_or_else(|| DbError::Validation(format!("asset not in suite: {}", cmd.asset_id)))?;

    // Simulation/stationary: must submit current index only.
    // Classic still advances from current_index for aggregate correctness.
    if session.flow_mode != SuiteFlowMode::Classic && passage_index as u32 != session.current_index
    {
        return Err(DbError::Validation(
            "submit the active suite passage before moving on".into(),
        ));
    }
    if session.flow_mode == SuiteFlowMode::Classic {
        // allow any pending/active that is not yet submitted
        if session.sequence[passage_index].status == PassageStatus::Submitted {
            return Err(DbError::Validation("passage already submitted".into()));
        }
    } else if session.sequence[passage_index].status == PassageStatus::Submitted {
        return Err(DbError::Validation("passage already submitted".into()));
    }

    let attempt_id = format!("reading-{}-p{}", session.session_id, passage_index + 1);
    let submit = submit_reading_attempt_in_scope(
        conn,
        &ReadingSubmitCommand {
            attempt_id: attempt_id.clone(),
            asset_id: cmd.asset_id.clone(),
            asset_revision: cmd.asset_revision,
            asset_fingerprint: cmd.asset_fingerprint.clone(),
            answers: cmd.answers.clone(),
            marked_questions: cmd.marked_questions.clone(),
            question_timeline: cmd.question_timeline.clone(),
            duration_ms: cmd.duration_ms,
            title_snapshot: cmd.title_snapshot.clone(),
            idempotency_key: format!("suite-pass-{}", cmd.idempotency_key),
        },
        AttemptMode::Suite,
        Some(&session.session_id),
    )?;

    session.timer = session.timer.merge_snapshot(cmd.timer_snapshot.as_ref());

    let score_info = json!({
        "correct": submit.score.correct,
        "total": submit.score.total,
        "totalQuestions": submit.score.total,
        "accuracy": submit.score.accuracy,
        "percentage": submit.score.percentage,
        "duration": submit.attempt.duration_ms / 1000,
    });

    {
        let passage = &mut session.sequence[passage_index];
        passage.status = PassageStatus::Submitted;
        passage.attempt_id = Some(attempt_id.clone());
        passage.session_id = Some(attempt_id);
        passage.submitted_at = submit.attempt.submitted_at.clone();
        passage.score_info = Some(score_info);
    }

    let next = (passage_index + 1) as u32;
    if next < session.sequence.len() as u32 {
        session.sequence[next as usize].status = PassageStatus::Active;
        session.current_index = next;
    } else {
        session.current_index = passage_index as u32;
        session.status = SuiteStatus::Completed;
        session.completed_at = submit.attempt.submitted_at.clone();
    }
    session.aggregate = recompute_aggregate(&session.sequence);
    session.updated_at = chrono::Utc::now().to_rfc3339();

    persist_suite(conn, &session)?;

    let result = SubmitSuitePassageResult {
        suite_session: session.clone(),
        submission: submit,
    };
    store_idempotent_submit(conn, &cmd.idempotency_key, &session.session_id, &result)?;
    // Keep the terminal attempt, suite state and replay record atomic with
    // retention. This runs after the suite pointer is durable, so pruning an
    // older passage cannot be overwritten by a later session persist.
    prune_terminal_attempts_in_transaction(conn)?;
    Ok(result)
}

pub fn cancel_suite(conn: &Connection, suite_id: &str) -> DbResult<ReadingSuiteSession> {
    let mut session = load_suite(conn, suite_id)?;
    if session.status == SuiteStatus::Active {
        session.status = SuiteStatus::Cancelled;
        session.updated_at = chrono::Utc::now().to_rfc3339();
        persist_suite(conn, &session)?;
    }
    Ok(session)
}

fn persist_suite(conn: &Connection, session: &ReadingSuiteSession) -> DbResult<()> {
    let timer_json =
        serde_json::to_string(&session.timer).map_err(|e| DbError::Message(e.to_string()))?;
    let agg_json =
        serde_json::to_string(&session.aggregate).map_err(|e| DbError::Message(e.to_string()))?;
    conn.execute(
        "INSERT INTO reading_suites (
            id, mode, flow_mode, status, current_index, timer_policy_json, created_at, updated_at,
            frequency_scope, seed, aggregate_json, completed_at, timer_state_json
         ) VALUES (?1, 'suite', ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, ?5)
         ON CONFLICT(id) DO UPDATE SET
            flow_mode = excluded.flow_mode,
            status = excluded.status,
            current_index = excluded.current_index,
            timer_policy_json = excluded.timer_policy_json,
            timer_state_json = excluded.timer_state_json,
            updated_at = excluded.updated_at,
            frequency_scope = excluded.frequency_scope,
            aggregate_json = excluded.aggregate_json,
            completed_at = excluded.completed_at",
        params![
            session.session_id,
            flow_str(session.flow_mode),
            status_str(session.status),
            session.current_index as i64,
            timer_json,
            session.created_at,
            session.updated_at,
            freq_str(session.frequency_scope),
            agg_json,
            session.completed_at,
        ],
    )?;

    conn.execute(
        "DELETE FROM reading_suite_items WHERE suite_id = ?1",
        params![session.session_id],
    )?;
    for entry in &session.sequence {
        let score_json = entry.score_info.as_ref().map(|v| v.to_string());
        conn.execute(
            "INSERT INTO reading_suite_items (
                suite_id, item_index, asset_id, attempt_id, status, title, category, submitted_at, score_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                session.session_id,
                entry.index as i64,
                entry.asset_id,
                entry.attempt_id,
                passage_status_str(entry.status),
                entry.title,
                entry.category,
                entry.submitted_at,
                score_json,
            ],
        )?;
    }
    Ok(())
}

fn load_suite(conn: &Connection, suite_id: &str) -> DbResult<ReadingSuiteSession> {
    let row = conn.query_row(
        "SELECT id, flow_mode, status, current_index, created_at, updated_at,
                frequency_scope, aggregate_json, completed_at,
                COALESCE(timer_state_json, timer_policy_json)
         FROM reading_suites WHERE id = ?1",
        params![suite_id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, Option<String>>(7)?,
                r.get::<_, Option<String>>(8)?,
                r.get::<_, Option<String>>(9)?,
            ))
        },
    );
    let (
        id,
        flow_mode,
        status,
        current_index,
        created_at,
        updated_at,
        frequency_scope,
        aggregate_json,
        completed_at,
        timer_json,
    ) = row.map_err(|_| DbError::Message(format!("suite not found: {suite_id}")))?;

    let timer: TimerState = match timer_json.as_deref() {
        Some(json) => serde_json::from_str(json).map_err(|error| {
            DbError::Message(format!(
                "suite timer state is invalid for {suite_id}: {error}"
            ))
        })?,
        None => {
            let fallback = chrono::DateTime::parse_from_rfc3339(&created_at)
                .map(|d| d.timestamp_millis())
                .unwrap_or_else(|_| chrono::Utc::now().timestamp_millis());
            TimerState::new_suite(fallback)
        }
    };

    let mut stmt = conn.prepare(
        "SELECT item_index, asset_id, attempt_id, status, title, category, submitted_at, score_json
         FROM reading_suite_items WHERE suite_id = ?1 ORDER BY item_index ASC",
    )?;
    let rows = stmt.query_map(params![suite_id], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, Option<String>>(5)?,
            r.get::<_, Option<String>>(6)?,
            r.get::<_, Option<String>>(7)?,
        ))
    })?;

    let mut sequence = Vec::new();
    for row in rows {
        let (idx, asset_id, attempt_id, st, title, category, submitted_at, score_json) = row?;
        sequence.push(SuitePassageEntry {
            index: idx as u32,
            exam_id: asset_id.clone(),
            asset_id,
            title: title.unwrap_or_default(),
            category: category.unwrap_or_default(),
            status: parse_passage_status(&st),
            session_id: attempt_id.clone(),
            attempt_id,
            submitted_at,
            score_info: score_json.and_then(|s| serde_json::from_str(&s).ok()),
        });
    }

    let aggregate = aggregate_json
        .as_deref()
        .and_then(|j| serde_json::from_str(j).ok())
        .unwrap_or_else(|| recompute_aggregate(&sequence));

    Ok(ReadingSuiteSession {
        session_id: id,
        activity: "reading".into(),
        practice_mode: "suite".into(),
        status: parse_status(&status),
        flow_mode: parse_flow(&flow_mode),
        frequency_scope: parse_freq(&frequency_scope),
        timer,
        current_index: current_index as u32,
        total_passages: sequence.len() as u32,
        sequence,
        aggregate,
        created_at,
        updated_at,
        completed_at,
    })
}

fn store_idempotent(
    conn: &Connection,
    scope: &str,
    key: &str,
    entity_id: &str,
    session: &ReadingSuiteSession,
) -> DbResult<()> {
    let json = serde_json::to_string(session).map_err(|e| DbError::Message(e.to_string()))?;
    conn.execute(
        "INSERT INTO mode_idempotency (scope, idempotency_key, entity_id, response_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(scope, idempotency_key) DO UPDATE SET response_json = excluded.response_json",
        params![
            scope,
            key,
            entity_id,
            json,
            chrono::Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

fn load_idempotent(
    conn: &Connection,
    scope: &str,
    key: &str,
) -> DbResult<Option<ReadingSuiteSession>> {
    let mut stmt = conn.prepare(
        "SELECT response_json FROM mode_idempotency WHERE scope = ?1 AND idempotency_key = ?2",
    )?;
    let mut rows = stmt.query(params![scope, key])?;
    if let Some(row) = rows.next()? {
        let json: String = row.get(0)?;
        let s = serde_json::from_str(&json).map_err(|e| DbError::Message(e.to_string()))?;
        Ok(Some(s))
    } else {
        Ok(None)
    }
}

fn store_idempotent_submit(
    conn: &Connection,
    key: &str,
    entity_id: &str,
    result: &SubmitSuitePassageResult,
) -> DbResult<()> {
    let json = serde_json::to_string(result).map_err(|e| DbError::Message(e.to_string()))?;
    conn.execute(
        "INSERT INTO mode_idempotency (scope, idempotency_key, entity_id, response_json, created_at)
         VALUES ('suite.submit', ?1, ?2, ?3, ?4)
         ON CONFLICT(scope, idempotency_key) DO UPDATE SET response_json = excluded.response_json",
        params![key, entity_id, json, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

fn load_idempotent_submit(
    conn: &Connection,
    key: &str,
) -> DbResult<Option<SubmitSuitePassageResult>> {
    let mut stmt = conn.prepare(
        "SELECT response_json FROM mode_idempotency WHERE scope = 'suite.submit' AND idempotency_key = ?1",
    )?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        let json: String = row.get(0)?;
        let s = serde_json::from_str(&json).map_err(|e| DbError::Message(e.to_string()))?;
        Ok(Some(s))
    } else {
        Ok(None)
    }
}

// silence unused import warning if TimerMode only used in tests elsewhere
#[allow(dead_code)]
fn _timer_mode_link() -> TimerMode {
    TimerMode::Elapsed
}
