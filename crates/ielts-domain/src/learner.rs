use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const LEARNER_MODEL_SCHEMA_VERSION: u32 = 1;
pub const LEARNER_TAXONOMY_VERSION: i64 = 1;
pub const LEARNER_STATE_MODEL_VERSION: &str = "weighted_beta_v1";
pub const LEARNER_SCHEDULER_VERSION: &str = "skill_review_v1";
pub const MAX_LEARNER_LIMIT: u32 = 200;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCatalogEntry {
    pub skill_key: String,
    pub activity: String,
    pub parent_key: Option<String>,
    pub label: String,
    pub description: String,
    pub taxonomy_version: i64,
    pub mapping_source: String,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionSkillMapping {
    pub asset_id: String,
    pub question_id: String,
    pub skill_key: String,
    pub weight: f64,
    pub mapping_source: String,
    pub mapping_version: i64,
    pub active: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillObservation {
    pub id: String,
    pub user_id: String,
    pub event_id: String,
    pub skill_key: String,
    pub outcome: f64,
    pub mapping_weight: f64,
    pub evidence_weight: f64,
    pub novelty_weight: f64,
    pub familiarity_weight: f64,
    pub time_weight: f64,
    pub error_type: Option<String>,
    pub context: Value,
    pub observed_at: String,
    pub asset_id: String,
    pub question_id: String,
    pub attempt_id: Option<String>,
    pub intervention_id: Option<String>,
    pub intervention_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillState {
    pub user_id: String,
    pub skill_key: String,
    pub alpha: f64,
    pub beta: f64,
    pub mastery_mean: f64,
    pub uncertainty: f64,
    pub evidence_count: u64,
    pub distinct_asset_count: u64,
    pub recent_error_rate: Option<f64>,
    pub stability_days: Option<f64>,
    pub last_practiced_at: Option<String>,
    pub next_review_at: Option<String>,
    pub model_version: String,
    pub explanation: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UncertaintyBand {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrendDirection {
    Improving,
    Stable,
    Declining,
    InsufficientEvidence,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillReviewProbe {
    NovelItem,
    SameItemRetention,
    ContrastivePair,
    CoachMicroDrill,
    WritingRewrite,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillStateView {
    pub user_id: String,
    pub skill_key: String,
    pub mastery_mean: f64,
    pub uncertainty: f64,
    pub uncertainty_band: UncertaintyBand,
    pub trend: TrendDirection,
    pub evidence_count: u64,
    pub distinct_asset_count: u64,
    pub recent_error_rate: Option<f64>,
    pub stability_days: Option<f64>,
    pub last_practiced_at: Option<String>,
    pub next_review_at: Option<String>,
    pub model_version: String,
    pub explanation: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillReviewNeed {
    pub skill_key: String,
    pub priority: f64,
    pub priority_band: String,
    pub due_at: String,
    pub preferred_probe: SkillReviewProbe,
    pub avoid_asset_ids: Vec<String>,
    pub reason_codes: Vec<String>,
    pub uncertainty_band: UncertaintyBand,
    pub mastery_mean: f64,
    pub evidence_count: u64,
    pub distinct_asset_count: u64,
    pub supporting_observation_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LearnerStateQuery {
    #[serde(default)]
    pub skill_keys: Vec<String>,
    #[serde(default)]
    pub after_skill_key: Option<String>,
    #[serde(default = "default_learner_limit")]
    pub limit: u32,
}

impl Default for LearnerStateQuery {
    fn default() -> Self {
        Self {
            skill_keys: Vec::new(),
            after_skill_key: None,
            limit: default_learner_limit(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SkillReviewNeedsQuery {
    #[serde(default)]
    pub due_before: Option<String>,
    #[serde(default)]
    pub after_skill_key: Option<String>,
    #[serde(default = "default_learner_limit")]
    pub limit: u32,
}

impl Default for SkillReviewNeedsQuery {
    fn default() -> Self {
        Self {
            due_before: None,
            after_skill_key: None,
            limit: default_learner_limit(),
        }
    }
}

fn default_learner_limit() -> u32 {
    100
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnerStateSnapshot {
    pub schema_version: u32,
    pub taxonomy_version: i64,
    pub model_version: String,
    pub generated_at: String,
    pub state_hash: String,
    pub states: Vec<SkillStateView>,
    pub truncated: bool,
    pub continuation: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillReviewNeedsSnapshot {
    pub schema_version: u32,
    pub scheduler_version: String,
    pub generated_at: String,
    pub needs: Vec<SkillReviewNeed>,
    pub truncated: bool,
    pub continuation: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnerRebuildReport {
    pub taxonomy_version: i64,
    pub model_version: String,
    pub scheduler_version: String,
    pub input_count: u64,
    pub observation_count: u64,
    pub state_count: u64,
    pub schedule_count: u64,
    pub input_hash: String,
    pub state_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnerVerifyReport {
    pub consistent: bool,
    pub input_count: u64,
    pub stored_observation_count: u64,
    pub expected_observation_count: u64,
    pub stored_state_count: u64,
    pub expected_state_count: u64,
    pub stored_schedule_count: u64,
    pub expected_schedule_count: u64,
    pub input_hash: String,
    pub stored_state_hash: String,
    pub expected_state_hash: String,
    pub mismatches: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LearnerModelConfig {
    pub half_life_days: f64,
    pub same_asset_under_12h_novelty: f64,
    pub same_asset_under_12h_familiarity: f64,
    pub same_asset_12_to_72h_novelty: f64,
    pub same_asset_12_to_72h_familiarity: f64,
    pub same_asset_over_72h_novelty: f64,
    pub same_asset_over_72h_familiarity: f64,
    pub new_asset_novelty: f64,
    pub new_asset_familiarity: f64,
}

impl Default for LearnerModelConfig {
    fn default() -> Self {
        Self {
            half_life_days: 21.0,
            same_asset_under_12h_novelty: 0.10,
            same_asset_under_12h_familiarity: 0.25,
            same_asset_12_to_72h_novelty: 0.35,
            same_asset_12_to_72h_familiarity: 0.50,
            same_asset_over_72h_novelty: 0.65,
            same_asset_over_72h_familiarity: 0.75,
            new_asset_novelty: 1.0,
            new_asset_familiarity: 1.0,
        }
    }
}

pub fn familiarity_weights(
    same_asset: bool,
    gap_hours: Option<f64>,
    config: LearnerModelConfig,
) -> (f64, f64) {
    if !same_asset {
        return (config.new_asset_novelty, config.new_asset_familiarity);
    }
    match gap_hours.unwrap_or(0.0) {
        gap if gap < 12.0 => (
            config.same_asset_under_12h_novelty,
            config.same_asset_under_12h_familiarity,
        ),
        gap if gap <= 72.0 => (
            config.same_asset_12_to_72h_novelty,
            config.same_asset_12_to_72h_familiarity,
        ),
        _ => (
            config.same_asset_over_72h_novelty,
            config.same_asset_over_72h_familiarity,
        ),
    }
}

pub fn effective_observation_weight(observation: &SkillObservation) -> f64 {
    [
        observation.mapping_weight,
        observation.evidence_weight,
        observation.novelty_weight,
        observation.familiarity_weight,
        observation.time_weight,
    ]
    .into_iter()
    .map(|value| value.clamp(0.0, 1.0))
    .product::<f64>()
    .clamp(0.0, 1.0)
}

pub fn decay_state_toward_neutral(state: &mut SkillState, elapsed_days: f64, half_life_days: f64) {
    if !elapsed_days.is_finite() || elapsed_days <= 0.0 {
        return;
    }
    let half_life_days = half_life_days.max(0.1);
    let factor = (-std::f64::consts::LN_2 * elapsed_days / half_life_days)
        .exp()
        .clamp(0.0, 1.0);
    state.alpha = 1.0 + (state.alpha.max(1.0) - 1.0) * factor;
    state.beta = 1.0 + (state.beta.max(1.0) - 1.0) * factor;
    refresh_beta_summary(state);
}

pub fn apply_skill_observation(
    state: &mut SkillState,
    observation: &SkillObservation,
    elapsed_days: f64,
    config: LearnerModelConfig,
) {
    decay_state_toward_neutral(state, elapsed_days, config.half_life_days);
    let weight = effective_observation_weight(observation);
    let outcome = observation.outcome.clamp(0.0, 1.0);
    state.alpha += weight * outcome;
    state.beta += weight * (1.0 - outcome);
    state.evidence_count += 1;
    refresh_beta_summary(state);
}

pub fn refresh_beta_summary(state: &mut SkillState) {
    let total = (state.alpha + state.beta).max(f64::EPSILON);
    state.mastery_mean = (state.alpha / total).clamp(0.0, 1.0);
    state.uncertainty = (2.0 / total).clamp(0.0, 1.0);
}

pub fn uncertainty_band(uncertainty: f64) -> UncertaintyBand {
    match uncertainty {
        value if value > 0.55 => UncertaintyBand::High,
        value if value > 0.30 => UncertaintyBand::Medium,
        _ => UncertaintyBand::Low,
    }
}

pub fn trend_direction(outcomes: &[f64]) -> TrendDirection {
    if outcomes.len() < 3 {
        return TrendDirection::InsufficientEvidence;
    }
    let split = outcomes.len() / 2;
    let first = outcomes[..split].iter().sum::<f64>() / split as f64;
    let last = outcomes[split..].iter().sum::<f64>() / (outcomes.len() - split) as f64;
    match last - first {
        delta if delta >= 0.15 => TrendDirection::Improving,
        delta if delta <= -0.15 => TrendDirection::Declining,
        _ => TrendDirection::Stable,
    }
}

pub fn review_priority(state: &SkillState, overdue_factor: f64, recency_gap_factor: f64) -> f64 {
    let weakness = 1.0 - state.mastery_mean.clamp(0.0, 1.0);
    let uncertainty = state.uncertainty.clamp(0.0, 1.0);
    (weakness * 0.40
        + uncertainty * 0.25
        + overdue_factor.clamp(0.0, 1.0) * 0.25
        + recency_gap_factor.clamp(0.0, 1.0) * 0.10)
        .clamp(0.0, 1.0)
}

pub fn priority_band(priority: f64) -> String {
    match priority {
        value if value >= 0.75 => "urgent".into(),
        value if value >= 0.50 => "high".into(),
        value if value >= 0.25 => "moderate".into(),
        _ => "watch".into(),
    }
}

pub fn preferred_probe(state: &SkillState) -> SkillReviewProbe {
    if state.distinct_asset_count < 2 {
        SkillReviewProbe::NovelItem
    } else if state.uncertainty > 0.45 {
        SkillReviewProbe::ContrastivePair
    } else if state.mastery_mean < 0.45 {
        SkillReviewProbe::CoachMicroDrill
    } else {
        SkillReviewProbe::NovelItem
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observation(outcome: f64, novelty: f64, familiarity: f64) -> SkillObservation {
        SkillObservation {
            id: "sobs-1".into(),
            user_id: "local".into(),
            event_id: "event-1".into(),
            skill_key: "reading.tfng".into(),
            outcome,
            mapping_weight: 1.0,
            evidence_weight: 1.0,
            novelty_weight: novelty,
            familiarity_weight: familiarity,
            time_weight: 1.0,
            error_type: None,
            context: Value::Null,
            observed_at: "2026-08-12T00:00:00Z".into(),
            asset_id: "asset-1".into(),
            question_id: "q1".into(),
            attempt_id: None,
            intervention_id: None,
            intervention_type: None,
        }
    }

    fn state() -> SkillState {
        SkillState {
            user_id: "local".into(),
            skill_key: "reading.tfng".into(),
            alpha: 1.0,
            beta: 1.0,
            mastery_mean: 0.5,
            uncertainty: 1.0,
            evidence_count: 0,
            distinct_asset_count: 0,
            recent_error_rate: None,
            stability_days: None,
            last_practiced_at: None,
            next_review_at: None,
            model_version: LEARNER_STATE_MODEL_VERSION.into(),
            explanation: Value::Null,
        }
    }

    #[test]
    fn same_asset_is_strictly_less_evidence_than_new_asset() {
        let config = LearnerModelConfig::default();
        let new = familiarity_weights(false, None, config);
        let same = familiarity_weights(true, Some(1.0), config);
        assert!(same.0 * same.1 < new.0 * new.1);
    }

    #[test]
    fn weighted_beta_update_is_replayable_and_uncertain_at_start() {
        let config = LearnerModelConfig::default();
        let first = observation(1.0, 1.0, 1.0);
        let mut a = state();
        let mut b = state();
        apply_skill_observation(&mut a, &first, 0.0, config);
        apply_skill_observation(&mut b, &first, 0.0, config);
        assert_eq!(a, b);
        assert!(a.uncertainty > 0.5);
        assert!(a.mastery_mean > 0.5);
    }

    #[test]
    fn declining_and_improving_trends_need_multiple_observations() {
        assert_eq!(
            trend_direction(&[0.0, 0.0, 1.0, 1.0]),
            TrendDirection::Improving
        );
        assert_eq!(
            trend_direction(&[1.0, 1.0, 0.0, 0.0]),
            TrendDirection::Declining
        );
        assert_eq!(
            trend_direction(&[1.0, 0.0]),
            TrendDirection::InsufficientEvidence
        );
    }

    #[test]
    fn time_decay_moves_posterior_toward_neutral_without_erasing_evidence() {
        let config = LearnerModelConfig::default();
        let mut state = state();
        apply_skill_observation(&mut state, &observation(1.0, 1.0, 1.0), 0.0, config);
        let before_evidence = state.evidence_count;
        let before_mastery_distance = (state.mastery_mean - 0.5).abs();
        decay_state_toward_neutral(&mut state, 42.0, config.half_life_days);
        assert_eq!(state.evidence_count, before_evidence);
        assert!((state.mastery_mean - 0.5).abs() < before_mastery_distance);
        assert!(state.uncertainty > 0.5);
    }

    #[test]
    fn familiarity_bands_preserve_taskbook_order() {
        let config = LearnerModelConfig::default();
        let very_recent = familiarity_weights(true, Some(1.0), config);
        let short_gap = familiarity_weights(true, Some(24.0), config);
        let long_gap = familiarity_weights(true, Some(96.0), config);
        let novel = familiarity_weights(false, None, config);
        assert!(very_recent.0 < short_gap.0);
        assert!(short_gap.0 < long_gap.0);
        assert!(long_gap.0 < novel.0);
    }
}
