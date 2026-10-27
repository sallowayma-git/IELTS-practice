use ielts_db::{
    DeterministicProvider, EvaluationHandle, EvaluationRunResult, PreparedEvaluation,
    ProviderError, StartEvaluationCommand, WritingProvider,
};
use ielts_domain::domain::WritingTaskType;
use ielts_domain::dto::{
    WritingDiagnosisV4, WritingFeedbackV4, WritingScoreConfidenceV4, WritingScoreV4,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::{
    ApplicationError, ChatMessage, CompletionRequest, EventSink, LanguageModel, ModelError,
    WritingEvaluationStore,
};

#[derive(Debug)]
pub struct StartEvaluationOutcome {
    pub handle: EvaluationHandle,
    pub pending: Option<PreparedEvaluation>,
}

pub enum EvaluationBackend<M> {
    Deterministic,
    Language(M),
    Unavailable(ModelError),
}

/// Scoring ignores the user's creativity setting. Samples run at a modest
/// temperature so that genuine ambiguity shows up as disagreement.
const SCORING_TEMPERATURE: f32 = 0.3;
/// A scoring sample carries rationale and bands only, never the review.
const SCORING_MAX_TOKENS: u32 = 2_048;
/// Two samples this far apart on any criterion trigger a tie-breaking third.
const DISAGREEMENT_BANDS: f64 = 1.0;

/// Output contract for one scoring sample, appended to the examiner policy.
const SCORING_CONTRACT: &str = r#"Output contract (overrides any format instructions above):
Return one JSON object only, no markdown fence, with keys in this order so evidence comes before bands:
{"diagnosis":{"task":{"task_fulfillment":""},"rationale":{"task_achievement":"","coherence_cohesion":"","lexical_resource":"","grammatical_range":""}},
 "checks":{"relevance":"on_topic","memorised":false,"overviewPresent":true,"unaddressedParts":"none"},
 "score":{"taskResponse":0,"coherence":0,"lexical":0,"grammar":0}}
Rules:
- checks records observations only; the application turns them into official band ceilings, so report them honestly and do not lower bands for them yourself. relevance is on_topic, barely_related or unrelated. memorised is true only when large stretches are memorised or lifted from the prompt. overviewPresent applies to Task 1 (false when there is no attempt at an overview). unaddressedParts applies to Task 2: none, some (a main part of the prompt is not addressed) or all.
- diagnosis.task keys for Task 1: task_fulfillment, overview_quality, key_features_coverage, data_support_quality. For Task 2: task_fulfillment, prompt_response_quality, position_clarity, argument_development, conclusion_effectiveness.
- Each rationale cites concrete evidence from the essay and names the band it supports.
- Each criterion band is a number from 0 to 9 in steps of 0.5. The overall band is computed by the application; do not return it.
- Trust the measured facts in the user message (word count, paragraph count) instead of counting yourself.
- Write the diagnosis in Simplified Chinese."#;

/// System prompt for the review call, which explains bands already fixed.
const REVIEW_SYSTEM_PROMPT: &str = r#"You are an IELTS writing tutor. The examiner's bands and rationale in the user message are final: do not re-score, and make every point consistent with them.
Return one JSON object only, no markdown fence:
{"feedback":{"overall":"","plan":[],"paragraphs":[{"paragraphIndex":0,"summary":"","issues":[]}],"sentences":[{"sentence":"","correction":"","kind":"grammar"}],"rewrites":[]}}
Rules:
- plan lists the 2-4 changes most likely to raise the lowest criterion, most valuable first.
- paragraphIndex counts from 0 in the essay's order.
- sentences quote the original sentence exactly; kind is one of grammar, spelling, word_choice, sentence_structure, coherence. Prefer errors that cost bands over cosmetic ones.
- rewrites are improved versions of weak sentences or a model paragraph, in English.
- Write overall, plan, summaries and issues in Simplified Chinese; keep quoted sentences, corrections and rewrites in English."#;

#[derive(Debug)]
struct ProviderOutput {
    score: WritingScoreV4,
    diagnosis: Option<WritingDiagnosisV4>,
    feedback: Result<WritingFeedbackV4, ProviderError>,
}

/// One independent scoring pass. `score` has the ceilings applied; `raw` is
/// what the model returned, so aggregation can tell which ceilings bit.
#[derive(Debug, Clone)]
struct ScoringSample {
    score: WritingScoreV4,
    raw: WritingScoreV4,
    diagnosis: Option<WritingDiagnosisV4>,
    ceilings: Vec<Ceiling>,
}

/// A band limit from the public IELTS Writing band descriptors (May 2023).
/// Where the descriptors give no number, the limit is the highest band whose
/// positive features the observation rules out, and the reason says so.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Ceiling {
    criteria: &'static [usize],
    limit: f64,
    reason: &'static str,
}

const TASK: usize = 0;
const LEXICAL: usize = 2;

const TOO_SHORT: Ceiling = Ceiling {
    criteria: &[0, 1, 2, 3],
    limit: 1.0,
    reason: "全文不超过 20 词，官方规则四项均为 1 分",
};
const UNRELATED: Ceiling = Ceiling {
    criteria: &[TASK],
    limit: 1.0,
    reason: "内容与题目完全无关，任务项按官方规则封顶 1 分",
};
const BARELY_RELATED: Ceiling = Ceiling {
    criteria: &[TASK],
    limit: 2.0,
    reason: "内容与题目几乎无关，任务项按官方规则封顶 2 分",
};
const MEMORISED: Ceiling = Ceiling {
    criteria: &[LEXICAL],
    limit: 4.0,
    reason: "大段背诵或照搬题目，词汇项封顶 4 分（依据 4 分档描述）",
};
const NO_OVERVIEW: Ceiling = Ceiling {
    criteria: &[TASK],
    limit: 5.0,
    reason: "没有 overview，任务项封顶 5 分（6 分档要求有相关的 overview 尝试）",
};
const PART_UNADDRESSED: Ceiling = Ceiling {
    criteria: &[TASK],
    limit: 5.0,
    reason: "题目有主要部分没有回应，任务项封顶 5 分（6 分档要求回应所有部分）",
};
const NOTHING_ADDRESSED: Ceiling = Ceiling {
    criteria: &[TASK],
    limit: 3.0,
    reason: "题目各部分都没有充分回应，任务项封顶 3 分",
};

/// Rationale keys, in criteria order.
const RATIONALE_KEYS: [&str; 4] = [
    "task_achievement",
    "coherence_cohesion",
    "lexical_resource",
    "grammatical_range",
];

/// Observations the model reports; the ceilings they imply are ours to apply.
#[derive(Debug, Default)]
struct ScoringChecks {
    relevance: Relevance,
    memorised: bool,
    overview_present: Option<bool>,
    unaddressed_parts: UnaddressedParts,
}

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum Relevance {
    #[default]
    OnTopic,
    BarelyRelated,
    Unrelated,
}

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum UnaddressedParts {
    #[default]
    None,
    Some,
    All,
}

/// Criterion bands as the model returns them; the overall band is ours.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CriterionBands {
    task_response: f64,
    coherence: f64,
    lexical: f64,
    grammar: f64,
}

/// Facts measured locally so the model never has to count.
#[derive(Debug, PartialEq)]
struct EssayFacts {
    words: usize,
    paragraphs: usize,
    minimum_words: usize,
}

pub struct WritingEvaluationService;

impl WritingEvaluationService {
    pub fn start<S: WritingEvaluationStore, E: EventSink + ?Sized>(
        store: &S,
        command: &StartEvaluationCommand,
        provider_id: &str,
        model: &str,
        events: &E,
    ) -> Result<StartEvaluationOutcome, ApplicationError> {
        let prepared = store.prepare(command, provider_id, model)?;
        let handle = prepared.handle.clone();

        if let Some(existing) = prepared.existing.as_ref() {
            emit_all(events, existing.events.iter().cloned());
            return Ok(StartEvaluationOutcome {
                handle,
                pending: None,
            });
        }

        if let Ok(initial_events) = store.list_events(&handle.evaluation_id, 0) {
            emit_all(events, initial_events);
        }

        Ok(StartEvaluationOutcome {
            handle,
            pending: Some(prepared),
        })
    }

    pub async fn execute<S: WritingEvaluationStore, M: LanguageModel, E: EventSink + ?Sized>(
        store: &S,
        prepared: PreparedEvaluation,
        backend: EvaluationBackend<M>,
        events: &E,
    ) -> Result<EvaluationRunResult, ApplicationError> {
        let sequence = prepared.handle.sequence;
        let provider_result = match backend {
            EvaluationBackend::Deterministic => run_deterministic(&prepared),
            EvaluationBackend::Language(model) => {
                // A failed lookup must not keep a cancelled run spending.
                let cancelled = || {
                    store
                        .cancel_requested(&prepared.evaluation_id)
                        .unwrap_or(true)
                };
                evaluate_language_model(&model, &prepared, &cancelled).await
            }
            EvaluationBackend::Unavailable(error) => Err(error.into()),
        };

        let (score, diagnosis, feedback, review_error) = match provider_result {
            Ok(output) => match output.feedback {
                Ok(feedback) => (Ok(output.score), output.diagnosis, Some(feedback), None),
                Err(error) => (Ok(output.score), output.diagnosis, None, Some(error)),
            },
            Err(error) => (Err(error), None, None, None),
        };

        let result = store.finish(&prepared, score, diagnosis, feedback, review_error)?;
        emit_all(
            events,
            result
                .events
                .iter()
                .filter(|event| event.sequence > sequence)
                .cloned(),
        );
        Ok(result)
    }
}

fn run_deterministic(prepared: &PreparedEvaluation) -> Result<ProviderOutput, ProviderError> {
    let provider = DeterministicProvider;
    let score = provider.score(
        &prepared.essay,
        prepared.prompt.as_deref(),
        prepared.task_type,
    )?;
    let feedback = provider.review(&prepared.essay, &score);
    Ok(ProviderOutput {
        score,
        diagnosis: None,
        feedback,
    })
}

/// Polled before every follow-up model call, so a cancelled run starts no new
/// paid request. Calls already in flight finish and are discarded by `finish`.
type CancelCheck<'a> = dyn Fn() -> bool + Sync + 'a;

async fn evaluate_language_model<M: LanguageModel>(
    model: &M,
    prepared: &PreparedEvaluation,
    cancelled: &CancelCheck<'_>,
) -> Result<ProviderOutput, ProviderError> {
    if cancelled() {
        return Err(provider_error("evaluation cancelled before scoring", false));
    }
    let samples = collect_samples(model, prepared, cancelled).await?;
    let (score, diagnosis) = aggregate_samples(&samples)?;
    let feedback = if cancelled() {
        Err(provider_error("evaluation cancelled before review", false))
    } else {
        review(model, prepared, &score, diagnosis.as_ref()).await
    };
    Ok(ProviderOutput {
        score,
        diagnosis,
        feedback,
    })
}

/// Two samples always; a third only when they disagree. A sample that fails
/// is dropped as long as another one survives.
async fn collect_samples<M: LanguageModel>(
    model: &M,
    prepared: &PreparedEvaluation,
    cancelled: &CancelCheck<'_>,
) -> Result<Vec<ScoringSample>, ProviderError> {
    let (first, second) =
        tokio::join!(score_sample(model, prepared), score_sample(model, prepared));
    let mut first_error = None;
    let mut samples = Vec::new();
    for result in [first, second] {
        match result {
            Ok(sample) => samples.push(sample),
            Err(error) => {
                first_error.get_or_insert(error);
            }
        }
    }
    if samples.len() == 2 && max_spread(&samples) >= DISAGREEMENT_BANDS && !cancelled() {
        if let Ok(sample) = score_sample(model, prepared).await {
            samples.push(sample);
        }
    }
    match (samples.is_empty(), first_error) {
        (true, Some(error)) => Err(error),
        _ => Ok(samples),
    }
}

async fn score_sample<M: LanguageModel>(
    model: &M,
    prepared: &PreparedEvaluation,
) -> Result<ScoringSample, ProviderError> {
    let system = format!("{}\n\n{SCORING_CONTRACT}", prepared.system_prompt.trim());
    let response = model
        .complete(CompletionRequest {
            cache_key: Some(evaluation_cache_key(&system)),
            messages: vec![
                ChatMessage::new("system", system),
                ChatMessage::new("user", user_message(prepared)),
            ],
            temperature: SCORING_TEMPERATURE,
            max_tokens: SCORING_MAX_TOKENS,
        })
        .await?;
    let facts = measure_essay(&prepared.essay, prepared.task_type);
    parse_scoring(&response.content, prepared.task_type, &facts)
}

async fn review<M: LanguageModel>(
    model: &M,
    prepared: &PreparedEvaluation,
    score: &WritingScoreV4,
    diagnosis: Option<&WritingDiagnosisV4>,
) -> Result<WritingFeedbackV4, ProviderError> {
    let rationale = diagnosis
        .and_then(|diagnosis| diagnosis.rationale.as_ref())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "not provided".into());
    let message = format!(
        "{}\n\nFinal bands: Task {:.1}, Coherence and Cohesion {:.1}, Lexical Resource {:.1}, Grammatical Range and Accuracy {:.1}, overall {:.1}.\nExaminer rationale: {rationale}",
        user_message(prepared),
        score.task_response,
        score.coherence,
        score.lexical,
        score.grammar,
        score.overall,
    );
    let response = model
        .complete(CompletionRequest {
            messages: vec![
                ChatMessage::new("system", REVIEW_SYSTEM_PROMPT),
                ChatMessage::new("user", message),
            ],
            temperature: prepared.temperature,
            max_tokens: crate::WRITING_EVALUATION_MAX_TOKENS,
            cache_key: Some(evaluation_cache_key(REVIEW_SYSTEM_PROMPT)),
        })
        .await
        .map_err(ProviderError::from)?;
    parse_review(&response.content)
}

/// Median per criterion, snapped and re-derived like any single score. Each
/// explanation must support the final band, including any enforced ceiling.
fn aggregate_samples(
    samples: &[ScoringSample],
) -> Result<(WritingScoreV4, Option<WritingDiagnosisV4>), ProviderError> {
    if samples.is_empty() {
        return Err(provider_error("AI evaluation returned no score", false));
    }
    let columns = [0, 1, 2, 3].map(|index| {
        samples
            .iter()
            .map(|sample| criteria(&sample.score)[index])
            .collect::<Vec<_>>()
    });
    let bands_by = |reduce: fn(&[f64]) -> f64| {
        let [task_response, coherence, lexical, grammar] =
            [0, 1, 2, 3].map(|index| reduce(&columns[index]));
        score_from_bands(&CriterionBands {
            task_response,
            coherence,
            lexical,
            grammar,
        })
    };
    let score = bands_by(median)?;
    let mut diagnosis = diagnosis_for_bands(samples, &score);
    diagnosis.confidence = Some(WritingScoreConfidenceV4 {
        samples: samples.len() as u32,
        agreed: samples.len() >= 2 && max_spread(samples) < DISAGREEMENT_BANDS,
        low: bands_by(|values| values.iter().copied().fold(f64::INFINITY, f64::min))?,
        high: bands_by(|values| values.iter().copied().fold(f64::NEG_INFINITY, f64::max))?,
    });
    Ok((score, Some(diagnosis)))
}

/// Per criterion, one supporting sample with the exact final band supplies the
/// rationale, the task analysis and any ceiling notice, so they never disagree.
/// A ceiling is reported only when it lowered that supporting sample on that
/// criterion; an outlier's observation is never presented as an enforced fact.
fn diagnosis_for_bands(samples: &[ScoringSample], score: &WritingScoreV4) -> WritingDiagnosisV4 {
    let mut diagnosis = WritingDiagnosisV4 {
        task: None,
        rationale: None,
        confidence: None,
        ceilings: Vec::new(),
    };
    let mut rationale = serde_json::Map::new();
    for (index, key) in RATIONALE_KEYS.into_iter().enumerate() {
        let band = criteria(score)[index];
        let source = samples
            .iter()
            .filter(|sample| criteria(&sample.score)[index] == band)
            .min_by(|a, b| distance(&a.score, score).total_cmp(&distance(&b.score, score)));
        let Some(source) = source else {
            let bands = samples
                .iter()
                .map(|sample| format!("{:.1}", criteria(&sample.score)[index]))
                .collect::<Vec<_>>()
                .join("、");
            rationale.insert(
                key.into(),
                format!("本项独立评分为 {bands} 分，按中位数并取最近的半分档，最终评分为 {band:.1} 分。").into(),
            );
            continue;
        };
        let supporting = source
            .ceilings
            .iter()
            .filter(|ceiling| {
                ceiling.criteria.contains(&index)
                    && criteria(&source.raw)[index] > ceiling.limit
                    && ceiling
                        .criteria
                        .iter()
                        .all(|&i| criteria(score)[i] <= ceiling.limit)
            })
            .collect::<Vec<_>>();
        let uncapped_band = criteria(&source.raw)[index];
        if uncapped_band != band {
            for ceiling in &supporting {
                if !diagnosis
                    .ceilings
                    .iter()
                    .any(|reason| reason == ceiling.reason)
                {
                    diagnosis.ceilings.push(ceiling.reason.to_string());
                }
            }
            let reasons = supporting
                .iter()
                .map(|ceiling| ceiling.reason)
                .collect::<Vec<_>>()
                .join("；");
            rationale.insert(
                key.into(),
                format!(
                    "本项原始评分为 {uncapped_band:.1} 分，{reasons}，最终评分为 {band:.1} 分。"
                )
                .into(),
            );
        } else if let Some(value) = source
            .diagnosis
            .as_ref()
            .and_then(|d| d.rationale.as_ref())
            .and_then(|r| r.get(key))
        {
            rationale.insert(key.into(), value.clone());
        }
        if index == 0 && uncapped_band == band {
            diagnosis.task = source.diagnosis.as_ref().and_then(|d| d.task.clone());
        }
    }
    if !rationale.is_empty() {
        diagnosis.rationale = Some(rationale.into());
    }
    diagnosis
}

fn median(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let middle = sorted.len() / 2;
    if sorted.len() % 2 == 0 {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    } else {
        sorted[middle]
    }
}

fn criteria(score: &WritingScoreV4) -> [f64; 4] {
    [
        score.task_response,
        score.coherence,
        score.lexical,
        score.grammar,
    ]
}

fn distance(a: &WritingScoreV4, b: &WritingScoreV4) -> f64 {
    criteria(a)
        .iter()
        .zip(criteria(b))
        .map(|(x, y)| (x - y).abs())
        .sum()
}

/// Widest gap between any two samples on any single criterion.
fn max_spread(samples: &[ScoringSample]) -> f64 {
    (0..4)
        .map(|index| {
            let values = samples.iter().map(|sample| criteria(&sample.score)[index]);
            let high = values.clone().fold(f64::NEG_INFINITY, f64::max);
            let low = values.fold(f64::INFINITY, f64::min);
            high - low
        })
        .fold(0.0, f64::max)
}

fn user_message(prepared: &PreparedEvaluation) -> String {
    let facts = measure_essay(&prepared.essay, prepared.task_type);
    let length = if facts.words < facts.minimum_words {
        "below the minimum, so the task criterion is limited"
    } else {
        "meets the minimum"
    };
    format!(
        "Task type: {}\nTask prompt: {}\nMeasured facts: {} words (minimum {}; {length}), {} paragraphs.\n\nEssay:\n{}",
        task_label(prepared.task_type),
        prepared.prompt.as_deref().unwrap_or("not provided"),
        facts.words,
        facts.minimum_words,
        facts.paragraphs,
        prepared.essay
    )
}

fn task_label(task_type: Option<WritingTaskType>) -> &'static str {
    match task_type {
        Some(WritingTaskType::Task1) => "IELTS Academic Writing Task 1",
        Some(WritingTaskType::Task2) => "IELTS Writing Task 2",
        None => "IELTS Writing (task not specified; assess as Task 2)",
    }
}

fn measure_essay(essay: &str, task_type: Option<WritingTaskType>) -> EssayFacts {
    let blocks = essay
        .split("\n\n")
        .filter(|block| !block.trim().is_empty())
        .count();
    let lines = essay.lines().filter(|line| !line.trim().is_empty()).count();
    EssayFacts {
        words: essay.split_whitespace().count(),
        // Many learners separate paragraphs with a single newline.
        paragraphs: if blocks > 1 { blocks } else { lines },
        minimum_words: match task_type {
            Some(WritingTaskType::Task1) => 150,
            _ => 250,
        },
    }
}

/// Same system prompt, same key: the rubric prefix is what the cache can reuse.
fn evaluation_cache_key(system_prompt: &str) -> String {
    let digest = Sha256::digest(system_prompt.as_bytes());
    let hex: String = digest
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("writing-eval-{hex}")
}

fn strip_fence(content: &str) -> &str {
    let trimmed = content.trim();
    trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed)
        .strip_suffix("```")
        .unwrap_or(trimmed)
        .trim()
}

fn parse_scoring(
    content: &str,
    task_type: Option<WritingTaskType>,
    facts: &EssayFacts,
) -> Result<ScoringSample, ProviderError> {
    let value: serde_json::Value = serde_json::from_str(strip_fence(content))
        .map_err(|error| provider_error(format!("AI evaluation JSON invalid: {error}"), false))?;
    let bands: CriterionBands = serde_json::from_value(
        value
            .get("score")
            .cloned()
            .ok_or_else(|| provider_error("AI evaluation score is missing", false))?,
    )
    .map_err(|error| provider_error(format!("AI evaluation score invalid: {error}"), false))?;
    // A malformed diagnosis only loses explanation, so it is dropped.
    let diagnosis = value
        .get("diagnosis")
        .cloned()
        .and_then(|diagnosis| serde_json::from_value(diagnosis).ok());
    let checks = parse_checks(value.get("checks"), task_type)?;
    let raw = score_from_bands(&bands)?;
    let ceilings = triggered_ceilings(&checks, task_type, facts);
    Ok(ScoringSample {
        score: apply_ceilings(&raw, &ceilings),
        raw,
        diagnosis,
        ceilings,
    })
}

/// Each observation is read on its own. A malformed observation that applies
/// to this task rejects the sample (the other sample stands in), because
/// reading it as "no problem" would silently lift a ceiling. A malformed
/// observation for the other task type is irrelevant and ignored.
fn parse_checks(
    value: Option<&serde_json::Value>,
    task_type: Option<WritingTaskType>,
) -> Result<ScoringChecks, ProviderError> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(ScoringChecks::default());
    };
    let object = value
        .as_object()
        .ok_or_else(|| provider_error("AI evaluation checks are not an object", false))?;
    let is_task1 = task_type == Some(WritingTaskType::Task1);
    fn field<T: serde::de::DeserializeOwned + Default>(
        object: &serde_json::Map<String, serde_json::Value>,
        name: &str,
        applies: bool,
    ) -> Result<T, ProviderError> {
        match object.get(name).filter(|value| !value.is_null()) {
            None => Ok(T::default()),
            Some(value) => match serde_json::from_value(value.clone()) {
                Ok(parsed) => Ok(parsed),
                Err(_) if !applies => Ok(T::default()),
                Err(error) => Err(provider_error(
                    format!("AI evaluation check {name} invalid: {error}"),
                    false,
                )),
            },
        }
    }
    Ok(ScoringChecks {
        relevance: field(object, "relevance", true)?,
        memorised: field(object, "memorised", true)?,
        overview_present: field(object, "overviewPresent", is_task1)?,
        unaddressed_parts: field(object, "unaddressedParts", !is_task1)?,
    })
}

fn triggered_ceilings(
    checks: &ScoringChecks,
    task_type: Option<WritingTaskType>,
    facts: &EssayFacts,
) -> Vec<Ceiling> {
    let mut ceilings = Vec::new();
    if facts.words <= 20 {
        ceilings.push(TOO_SHORT);
    }
    match checks.relevance {
        Relevance::Unrelated => ceilings.push(UNRELATED),
        Relevance::BarelyRelated => ceilings.push(BARELY_RELATED),
        Relevance::OnTopic => {}
    }
    if checks.memorised {
        ceilings.push(MEMORISED);
    }
    match task_type {
        Some(WritingTaskType::Task1) => {
            if checks.overview_present == Some(false) {
                ceilings.push(NO_OVERVIEW);
            }
        }
        _ => match checks.unaddressed_parts {
            UnaddressedParts::Some => ceilings.push(PART_UNADDRESSED),
            UnaddressedParts::All => ceilings.push(NOTHING_ADDRESSED),
            UnaddressedParts::None => {}
        },
    }
    ceilings
}

fn apply_ceilings(score: &WritingScoreV4, ceilings: &[Ceiling]) -> WritingScoreV4 {
    let mut bands = criteria(score);
    for ceiling in ceilings {
        for &index in ceiling.criteria {
            bands[index] = bands[index].min(ceiling.limit);
        }
    }
    let [task_response, coherence, lexical, grammar] = bands;
    score_from_bands(&CriterionBands {
        task_response,
        coherence,
        lexical,
        grammar,
    })
    .unwrap_or_else(|_| score.clone())
}

fn parse_review(content: &str) -> Result<WritingFeedbackV4, ProviderError> {
    let value: serde_json::Value = serde_json::from_str(strip_fence(content)).map_err(|error| {
        provider_error(
            format!("AI evaluation feedback JSON invalid: {error}"),
            true,
        )
    })?;
    let feedback = value
        .get("feedback")
        .cloned()
        .ok_or_else(|| provider_error("AI evaluation feedback is missing", true))?;
    serde_json::from_value(feedback)
        .map_err(|error| provider_error(format!("AI evaluation feedback invalid: {error}"), true))
}

/// Snap each criterion to a half band and derive the overall band from them,
/// so the overall can never disagree with the criteria the learner sees.
fn score_from_bands(bands: &CriterionBands) -> Result<WritingScoreV4, ProviderError> {
    let criteria = [
        bands.task_response,
        bands.coherence,
        bands.lexical,
        bands.grammar,
    ];
    if !criteria
        .iter()
        .all(|value| value.is_finite() && (0.0..=9.0).contains(value))
    {
        return Err(provider_error(
            "AI evaluation contains an invalid band score",
            false,
        ));
    }
    let [task_response, coherence, lexical, grammar] =
        criteria.map(|value| (value * 2.0).round() / 2.0);
    let mean = (task_response + coherence + lexical + grammar) / 4.0;
    Ok(WritingScoreV4 {
        // IELTS rounds a mean ending in .25 or .75 up to the next half band.
        overall: (mean * 2.0 + 0.5 + 1e-9).floor() / 2.0,
        task_response,
        coherence,
        lexical,
        grammar,
    })
}

fn provider_error(message: impl Into<String>, retryable: bool) -> ProviderError {
    ProviderError {
        message: message.into(),
        retryable,
    }
}

fn emit_all<E: EventSink + ?Sized>(
    sink: &E,
    events: impl IntoIterator<Item = ielts_db::EvaluationEvent>,
) {
    for event in events {
        sink.emit(event);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use ielts_db::{EvaluationRunResult, EvaluationSession};
    use ielts_domain::domain::{EvaluationStage, EvaluationStatus};
    use ielts_domain::dto::WritingEvaluationV4;

    use super::*;

    #[derive(Debug, Clone)]
    struct FinishCapture {
        score: Result<WritingScoreV4, (String, bool)>,
        feedback: Option<WritingFeedbackV4>,
        review_error: Option<(String, bool)>,
    }

    struct WritingState {
        prepared: PreparedEvaluation,
        events: Vec<ielts_db::EvaluationEvent>,
        finish: Option<FinishCapture>,
        prepared_provider: Option<(String, String)>,
        cancel_requested: bool,
    }

    #[derive(Clone)]
    struct FakeWritingStore {
        state: Arc<Mutex<WritingState>>,
    }

    impl FakeWritingStore {
        fn fresh() -> Self {
            let prepared = prepared_evaluation(None);
            Self {
                state: Arc::new(Mutex::new(WritingState {
                    events: vec![event(1, EvaluationStage::Preparing)],
                    prepared,
                    finish: None,
                    prepared_provider: None,
                    cancel_requested: false,
                })),
            }
        }

        fn resumed() -> Self {
            let events = vec![
                event(1, EvaluationStage::Preparing),
                event(2, EvaluationStage::Scoring),
                event(3, EvaluationStage::Reviewing),
                event(4, EvaluationStage::Finalizing),
            ];
            let existing = completed_result(events.clone(), None, None);
            Self {
                state: Arc::new(Mutex::new(WritingState {
                    events,
                    prepared: prepared_evaluation(Some(existing)),
                    finish: None,
                    prepared_provider: None,
                    cancel_requested: false,
                })),
            }
        }
    }

    impl WritingEvaluationStore for FakeWritingStore {
        fn prepare(
            &self,
            _command: &StartEvaluationCommand,
            provider_id: &str,
            model: &str,
        ) -> Result<PreparedEvaluation, ApplicationError> {
            self.state.lock().unwrap().prepared_provider =
                Some((provider_id.to_string(), model.to_string()));
            Ok(self.state.lock().unwrap().prepared.clone())
        }

        fn list_events(
            &self,
            _evaluation_id: &str,
            after_sequence: u32,
        ) -> Result<Vec<ielts_db::EvaluationEvent>, ApplicationError> {
            Ok(self
                .state
                .lock()
                .unwrap()
                .events
                .iter()
                .filter(|event| event.sequence > after_sequence)
                .cloned()
                .collect())
        }

        fn finish(
            &self,
            prepared: &PreparedEvaluation,
            score: Result<WritingScoreV4, ProviderError>,
            _diagnosis: Option<WritingDiagnosisV4>,
            feedback: Option<WritingFeedbackV4>,
            review_error: Option<ProviderError>,
        ) -> Result<EvaluationRunResult, ApplicationError> {
            let score_capture = score
                .as_ref()
                .map(Clone::clone)
                .map_err(|error| (error.message.clone(), error.retryable));
            let review_capture = review_error
                .as_ref()
                .map(|error| (error.message.clone(), error.retryable));
            let result_score = score.ok();
            let mut result = completed_result(
                vec![
                    event(1, EvaluationStage::Preparing),
                    event(2, EvaluationStage::Scoring),
                    event(3, EvaluationStage::Reviewing),
                    event(4, EvaluationStage::Finalizing),
                ],
                result_score,
                feedback.clone(),
            );
            if self.state.lock().unwrap().cancel_requested {
                result.session.cancel_requested = true;
                result.session.status = EvaluationStatus::Interrupted;
                result.evaluation.status = EvaluationStatus::Interrupted;
                result.evaluation.score = None;
                result.evaluation.feedback = None;
            }
            assert_eq!(prepared.evaluation_id, "evaluation-1");
            self.state.lock().unwrap().finish = Some(FinishCapture {
                score: score_capture,
                feedback,
                review_error: review_capture,
            });
            Ok(result)
        }

        fn request_cancel(&self, evaluation_id: &str) -> Result<bool, ApplicationError> {
            assert_eq!(evaluation_id, "evaluation-1");
            self.state.lock().unwrap().cancel_requested = true;
            Ok(true)
        }

        fn cancel_requested(&self, evaluation_id: &str) -> Result<bool, ApplicationError> {
            assert_eq!(evaluation_id, "evaluation-1");
            Ok(self.state.lock().unwrap().cancel_requested)
        }
    }

    #[derive(Default)]
    struct RecordingSink(Mutex<Vec<ielts_db::EvaluationEvent>>);

    impl EventSink for RecordingSink {
        fn emit(&self, event: ielts_db::EvaluationEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    #[derive(Clone)]
    struct FakeModel {
        response: Result<String, ModelError>,
        store_state: Option<Arc<Mutex<WritingState>>>,
    }

    #[async_trait]
    impl LanguageModel for FakeModel {
        async fn complete(
            &self,
            _request: CompletionRequest,
        ) -> Result<crate::CompletionResponse, ModelError> {
            if let Some(state) = &self.store_state {
                assert!(
                    state.try_lock().is_ok(),
                    "store lock was held during model I/O"
                );
            }
            self.response
                .clone()
                .map(|content| crate::CompletionResponse {
                    content,
                    model: "fake-model".into(),
                    latency_ms: 1,
                    usage: None,
                    provider_request_id: None,
                })
        }
    }

    #[test]
    fn replays_existing_evaluation_without_starting_another_run() {
        let store = FakeWritingStore::resumed();
        let sink = RecordingSink::default();
        let outcome = WritingEvaluationService::start(
            &store,
            &start_command(),
            "openai-compatible",
            "fake-model",
            &sink,
        )
        .unwrap();

        assert!(outcome.pending.is_none());
        assert_eq!(outcome.handle.evaluation_id, "evaluation-1");
        let sequences = sink
            .0
            .lock()
            .unwrap()
            .iter()
            .map(|event| event.sequence)
            .collect::<Vec<_>>();
        assert_eq!(sequences, vec![1, 2, 3, 4]);
    }

    #[test]
    fn prepare_keeps_the_selected_provider_snapshot() {
        let store = FakeWritingStore::fresh();
        let sink = RecordingSink::default();

        WritingEvaluationService::start(
            &store,
            &start_command(),
            "openai-compatible",
            "gpt-snapshot",
            &sink,
        )
        .unwrap();

        let snapshot = store.state.lock().unwrap().prepared_provider.clone();
        assert_eq!(
            snapshot,
            Some(("openai-compatible".to_string(), "gpt-snapshot".to_string()))
        );
    }

    #[tokio::test]
    async fn releases_store_lock_during_model_io_and_preserves_event_order() {
        let store = FakeWritingStore::fresh();
        let sink = RecordingSink::default();
        let model = FakeModel {
            response: Ok(valid_evaluation_json()),
            store_state: Some(store.state.clone()),
        };

        WritingEvaluationService::execute(
            &store,
            prepared_evaluation(None),
            EvaluationBackend::Language(model),
            &sink,
        )
        .await
        .unwrap();

        let sequences = sink
            .0
            .lock()
            .unwrap()
            .iter()
            .map(|event| event.sequence)
            .collect::<Vec<_>>();
        assert_eq!(sequences, vec![2, 3, 4]);
        assert!(store
            .state
            .lock()
            .unwrap()
            .finish
            .as_ref()
            .unwrap()
            .score
            .is_ok());
    }

    #[tokio::test]
    async fn keeps_score_when_feedback_is_invalid() {
        let store = FakeWritingStore::fresh();
        let model = FakeModel {
            response: Ok(valid_score_with_invalid_feedback()),
            store_state: None,
        };

        WritingEvaluationService::execute(
            &store,
            prepared_evaluation(None),
            EvaluationBackend::Language(model),
            &RecordingSink::default(),
        )
        .await
        .unwrap();

        let state = store.state.lock().unwrap();
        let finish = state.finish.as_ref().unwrap();
        assert!(finish.score.is_ok());
        assert!(finish.feedback.is_none());
        assert!(finish.review_error.is_some());
        assert!(finish.review_error.as_ref().unwrap().1);
    }

    #[tokio::test]
    async fn persists_model_and_json_failures() {
        for response in [
            Err(ModelError::new("request timed out", true)),
            Ok("not-json".to_string()),
        ] {
            let store = FakeWritingStore::fresh();
            let model = FakeModel {
                response,
                store_state: None,
            };
            WritingEvaluationService::execute(
                &store,
                prepared_evaluation(None),
                EvaluationBackend::Language(model),
                &RecordingSink::default(),
            )
            .await
            .unwrap();
            assert!(store
                .state
                .lock()
                .unwrap()
                .finish
                .as_ref()
                .unwrap()
                .score
                .is_err());
        }
    }

    #[tokio::test]
    async fn persists_unavailable_backend_as_provider_failure() {
        let store = FakeWritingStore::fresh();
        WritingEvaluationService::execute(
            &store,
            prepared_evaluation(None),
            EvaluationBackend::<FakeModel>::Unavailable(ModelError::new(
                "AI is not configured",
                false,
            )),
            &RecordingSink::default(),
        )
        .await
        .unwrap();

        let state = store.state.lock().unwrap();
        let error = state.finish.as_ref().unwrap().score.as_ref().unwrap_err();
        assert_eq!(error.0, "AI is not configured");
        assert!(!error.1);
    }

    fn parse(content: &str) -> Result<ScoringSample, ProviderError> {
        let facts = EssayFacts {
            words: 300,
            paragraphs: 4,
            minimum_words: 250,
        };
        parse_scoring(content, Some(WritingTaskType::Task2), &facts)
    }

    fn score_json(tr: f64, cc: f64, lr: f64, gra: f64) -> String {
        format!(
            r#"{{"score":{{"taskResponse":{tr},"coherence":{cc},"lexical":{lr},"grammar":{gra}}}}}"#
        )
    }

    #[test]
    fn parses_fenced_scoring_and_review_json() {
        let sample = parse("```json\n{\"score\":{\"overall\":7.0,\"taskResponse\":7.0,\"coherence\":6.5,\"lexical\":7.0,\"grammar\":6.5}}\n```").unwrap();
        // mean 6.75 rounds up to 7.0
        assert_eq!(sample.score.overall, 7.0);
        let feedback =
            parse_review("```json\n{\"feedback\":{\"overall\":\"Clear\",\"plan\":[]}}\n```")
                .unwrap();
        assert_eq!(feedback.overall.as_deref(), Some("Clear"));
    }

    #[test]
    fn rejects_invalid_scores_and_malformed_json() {
        assert!(parse("not-json").is_err());
        assert!(parse(&score_json(10.0, 7.0, 7.0, 7.0)).is_err());
        let review_error = parse_review("{\"feedback\":false}").unwrap_err();
        assert!(review_error.retryable);
    }

    #[test]
    fn overall_band_is_derived_from_snapped_criteria() {
        // Model claims 8.0 overall; the criteria say otherwise.
        let claimed = parse("{\"score\":{\"overall\":8.0,\"taskResponse\":7.0,\"coherence\":6.5,\"lexical\":6.5,\"grammar\":6.0}}").unwrap();
        assert_eq!(claimed.score.overall, 6.5);

        let snapped = parse(&score_json(6.3, 6.0, 6.0, 6.0)).unwrap();
        assert_eq!(snapped.score.task_response, 6.5);
        // mean 6.125 rounds to the nearest half band, 6.0
        assert_eq!(snapped.score.overall, 6.0);

        assert_eq!(
            parse(&score_json(7.0, 7.0, 7.0, 6.0))
                .unwrap()
                .score
                .overall,
            7.0
        );
        assert_eq!(
            parse(&score_json(6.0, 6.0, 6.0, 7.0))
                .unwrap()
                .score
                .overall,
            6.5
        );
    }

    #[test]
    fn diagnosis_is_kept_and_malformed_diagnosis_is_dropped() {
        let sample = parse("{\"diagnosis\":{\"task\":{\"position_clarity\":\"清晰\"},\"rationale\":{\"task_achievement\":\"论点展开充分\"}},\"score\":{\"taskResponse\":7.0,\"coherence\":7.0,\"lexical\":7.0,\"grammar\":7.0}}").unwrap();
        assert_eq!(
            sample.diagnosis.unwrap().rationale.unwrap()["task_achievement"],
            "论点展开充分"
        );

        let malformed = parse("{\"diagnosis\":\"oops\",\"score\":{\"taskResponse\":7.0,\"coherence\":7.0,\"lexical\":7.0,\"grammar\":7.0}}").unwrap();
        assert!(malformed.diagnosis.is_none());
        assert_eq!(malformed.score.overall, 7.0);
    }

    fn sample(tr: f64, cc: f64, lr: f64, gra: f64) -> ScoringSample {
        parse(&score_json(tr, cc, lr, gra)).unwrap()
    }

    #[test]
    fn agreeing_samples_average_and_report_their_range() {
        let (score, diagnosis) =
            aggregate_samples(&[sample(6.0, 6.5, 6.0, 6.0), sample(6.5, 6.5, 6.0, 5.5)]).unwrap();
        // 6.25 -> 6.5, 6.5, 6.0, 5.75 -> 6.0
        assert_eq!(criteria(&score), [6.5, 6.5, 6.0, 6.0]);
        let confidence = diagnosis.unwrap().confidence.unwrap();
        assert!(confidence.agreed);
        assert_eq!(confidence.samples, 2);
        assert_eq!(criteria(&confidence.low), [6.0, 6.5, 6.0, 5.5]);
        assert_eq!(criteria(&confidence.high), [6.5, 6.5, 6.0, 6.0]);
    }

    #[test]
    fn three_samples_take_the_median_and_flag_disagreement() {
        let samples = [
            sample(5.0, 6.0, 6.0, 6.0),
            sample(7.0, 6.0, 6.0, 6.0),
            sample(6.5, 6.0, 6.0, 6.0),
        ];
        let (score, diagnosis) = aggregate_samples(&samples).unwrap();
        assert_eq!(score.task_response, 6.5);
        let confidence = diagnosis.unwrap().confidence.unwrap();
        assert!(!confidence.agreed);
        assert_eq!(confidence.low.task_response, 5.0);
        assert_eq!(confidence.high.task_response, 7.0);
    }

    #[test]
    fn a_single_surviving_sample_is_not_called_agreed() {
        let (_, diagnosis) = aggregate_samples(&[sample(6.0, 6.0, 6.0, 6.0)]).unwrap();
        assert!(!diagnosis.unwrap().confidence.unwrap().agreed);
    }

    fn diagnosed_task1_sample(bands: [f64; 4], overview_present: bool) -> ScoringSample {
        let [tr, cc, lr, gra] = bands;
        let content = serde_json::json!({
            "score": {"taskResponse": tr, "coherence": cc, "lexical": lr, "grammar": gra},
            "checks": {"overviewPresent": overview_present},
            "diagnosis": {
                "task": {"overview_quality": format!("overview present: {overview_present}")},
                "rationale": {
                    "task_achievement": format!("Task band {tr}"),
                    "coherence_cohesion": format!("Coherence band {cc}"),
                    "lexical_resource": format!("Lexical band {lr}"),
                    "grammatical_range": format!("Grammar band {gra}")
                }
            }
        });
        parse_scoring(
            &content.to_string(),
            Some(WritingTaskType::Task1),
            &EssayFacts {
                words: 180,
                paragraphs: 3,
                minimum_words: 150,
            },
        )
        .unwrap()
    }

    #[test]
    fn aggregation_reconciles_mixed_criterion_ceilings_and_rationales() {
        let samples = [
            diagnosed_task1_sample([7.0, 7.0, 7.0, 7.0], false),
            diagnosed_task1_sample([6.0, 6.0, 6.0, 6.0], true),
            diagnosed_task1_sample([6.0, 8.0, 8.0, 8.0], true),
        ];
        assert_eq!(criteria(&samples[0].score), [5.0, 7.0, 7.0, 7.0]);
        assert_eq!(samples[0].ceilings.len(), 1);
        let (score, diagnosis) = aggregate_samples(&samples).unwrap();
        assert_eq!(criteria(&score), [6.0, 7.0, 7.0, 7.0]);
        let diagnosis = diagnosis.unwrap();
        assert!(diagnosis.ceilings.is_empty());
        assert_eq!(
            diagnosis.task.unwrap()["overview_quality"],
            "overview present: true"
        );
        let rationale = diagnosis.rationale.unwrap();
        assert_eq!(rationale["task_achievement"], "Task band 6");
        assert_eq!(rationale["coherence_cohesion"], "Coherence band 7");
        assert_eq!(rationale["lexical_resource"], "Lexical band 7");
        assert_eq!(rationale["grammatical_range"], "Grammar band 7");
    }

    #[test]
    fn an_outlier_ceiling_is_not_reported_when_the_final_band_falls_below_it() {
        let samples = [
            diagnosed_task1_sample([7.0, 7.0, 7.0, 7.0], false),
            diagnosed_task1_sample([4.0, 7.0, 7.0, 7.0], true),
            diagnosed_task1_sample([4.0, 7.0, 7.0, 7.0], true),
        ];
        let (score, diagnosis) = aggregate_samples(&samples).unwrap();
        assert_eq!(criteria(&score), [4.0, 7.0, 7.0, 7.0]);
        let diagnosis = diagnosis.unwrap();
        // TA 4 is supported by samples that saw an overview, so the outlier's
        // no-overview cap did not decide it and must not be shown beside them.
        assert!(diagnosis.ceilings.is_empty());
        assert_eq!(
            diagnosis.task.unwrap()["overview_quality"],
            "overview present: true"
        );
        assert_eq!(
            diagnosis.rationale.unwrap()["task_achievement"],
            "Task band 4"
        );
    }

    #[test]
    fn aggregation_explains_an_enforced_ceiling_instead_of_the_uncapped_band() {
        let samples = [
            diagnosed_task1_sample([7.0; 4], false),
            diagnosed_task1_sample([7.0; 4], false),
        ];
        let (score, diagnosis) = aggregate_samples(&samples).unwrap();
        assert_eq!(score.task_response, 5.0);
        let diagnosis = diagnosis.unwrap();
        assert_eq!(diagnosis.ceilings.len(), 1);
        assert!(diagnosis.ceilings[0].contains("封顶 5 分"));
        assert!(diagnosis.task.is_none());
        let rationale = diagnosis.rationale.unwrap();
        let task = rationale["task_achievement"].as_str().unwrap();
        assert!(task.contains("原始评分为 7.0 分"));
        assert!(task.contains("最终评分为 5.0 分"));
        assert_eq!(rationale["coherence_cohesion"], "Coherence band 7");
    }

    #[test]
    fn aggregation_explains_a_median_without_an_exact_supporting_sample() {
        let samples = [
            diagnosed_task1_sample([6.0; 4], true),
            diagnosed_task1_sample([7.0; 4], true),
        ];
        let (score, diagnosis) = aggregate_samples(&samples).unwrap();
        assert_eq!(criteria(&score), [6.5; 4]);
        let diagnosis = diagnosis.unwrap();
        assert!(diagnosis.task.is_none());
        assert!(diagnosis.ceilings.is_empty());
        for rationale in diagnosis.rationale.unwrap().as_object().unwrap().values() {
            assert!(rationale.as_str().unwrap().contains("最终评分为 6.5 分"));
        }
    }

    /// Parses one scoring reply with the given checks and returns the capped
    /// score plus the reasons of the ceilings that actually lowered a band.
    fn capped(
        bands: [f64; 4],
        checks: &str,
        task_type: WritingTaskType,
        words: usize,
    ) -> (WritingScoreV4, Vec<String>) {
        let sample = parse_with(bands, checks, task_type, words).unwrap();
        let (score, diagnosis) = aggregate_samples(std::slice::from_ref(&sample)).unwrap();
        (score, diagnosis.unwrap().ceilings)
    }

    fn parse_with(
        bands: [f64; 4],
        checks: &str,
        task_type: WritingTaskType,
        words: usize,
    ) -> Result<ScoringSample, ProviderError> {
        let [tr, cc, lr, gra] = bands;
        let facts = EssayFacts {
            words,
            paragraphs: 4,
            minimum_words: 250,
        };
        let content = format!(
            r#"{{"checks":{checks},"score":{{"taskResponse":{tr},"coherence":{cc},"lexical":{lr},"grammar":{gra}}}}}"#
        );
        parse_scoring(&content, Some(task_type), &facts)
    }

    #[test]
    fn official_ceilings_cap_bands_and_explain_themselves() {
        let (score, ceilings) = capped(
            [7.0, 7.0, 7.0, 7.0],
            r#"{"unaddressedParts":"some"}"#,
            WritingTaskType::Task2,
            300,
        );
        assert_eq!(score.task_response, 5.0);
        // 5 + 7 + 7 + 7 = 6.5 mean
        assert_eq!(score.overall, 6.5);
        assert_eq!(ceilings.len(), 1);

        let (score, _) = capped(
            [7.0, 7.0, 7.0, 7.0],
            r#"{"overviewPresent":false}"#,
            WritingTaskType::Task1,
            180,
        );
        assert_eq!(score.task_response, 5.0);

        let (score, ceilings) = capped(
            [6.0, 6.0, 6.0, 6.0],
            r#"{"relevance":"unrelated","memorised":true}"#,
            WritingTaskType::Task2,
            300,
        );
        assert_eq!(criteria(&score), [1.0, 6.0, 4.0, 6.0]);
        assert_eq!(ceilings.len(), 2);

        let (score, ceilings) = capped([5.0, 5.0, 5.0, 5.0], "{}", WritingTaskType::Task2, 18);
        assert_eq!(score.overall, 1.0);
        assert_eq!(ceilings.len(), 1);
    }

    #[test]
    fn ceilings_never_raise_a_band_and_bad_checks_reject_the_sample() {
        let (score, ceilings) = capped(
            [4.0, 5.0, 5.0, 5.0],
            r#"{"unaddressedParts":"some"}"#,
            WritingTaskType::Task2,
            300,
        );
        assert_eq!(score.task_response, 4.0);
        assert!(ceilings.is_empty());

        // A malformed observation that applies to the task must not read as
        // "no problem"; the sample is rejected and the other sample stands in.
        assert!(parse_with(
            [7.0; 4],
            r#"{"relevance":"maybe"}"#,
            WritingTaskType::Task2,
            300
        )
        .is_err());
        assert!(parse_with(
            [7.0; 4],
            r#"{"overviewPresent":false}"#,
            WritingTaskType::Task1,
            180
        )
        .is_ok());
        assert!(parse_with([7.0; 4], r#""none""#, WritingTaskType::Task2, 300).is_err());
    }

    #[test]
    fn a_malformed_check_for_the_other_task_keeps_valid_ceilings() {
        let (score, ceilings) = capped(
            [7.0; 4],
            r#"{"relevance":"unrelated","memorised":true,"overviewPresent":"n/a","unaddressedParts":"none"}"#,
            WritingTaskType::Task2,
            300,
        );
        assert_eq!(score.task_response, 1.0);
        assert_eq!(score.lexical, 4.0);
        assert_eq!(ceilings.len(), 2);
    }

    #[test]
    fn ceilings_are_reported_only_when_the_final_band_obeys_them() {
        let task1 = |bands: [f64; 4], checks: &str| {
            parse_with(bands, checks, WritingTaskType::Task1, 180).unwrap()
        };
        let samples = [
            // Missing overview caps TA 7 -> 5.
            task1([7.0, 7.0, 7.0, 7.0], r#"{"overviewPresent":false}"#),
            task1([6.0, 6.0, 6.0, 6.0], "{}"),
            task1([6.0, 8.0, 8.0, 8.0], "{}"),
        ];
        let (score, diagnosis) = aggregate_samples(&samples).unwrap();
        assert_eq!(criteria(&score), [6.0, 7.0, 7.0, 7.0]);
        // The median TA of 6 is above the TA <= 5 cap, so the cap did not decide it.
        assert!(diagnosis.unwrap().ceilings.is_empty());

        let (score, diagnosis) = aggregate_samples(&samples[..1]).unwrap();
        assert_eq!(score.task_response, 5.0);
        assert_eq!(diagnosis.unwrap().ceilings.len(), 1);
    }

    #[test]
    fn measures_words_paragraphs_and_task_minimum() {
        let facts = measure_essay(
            "One two three.\nFour five.\n\n",
            Some(WritingTaskType::Task1),
        );
        assert_eq!(
            facts,
            EssayFacts {
                words: 5,
                paragraphs: 2,
                minimum_words: 150
            }
        );
        let blocks = measure_essay("A b.\nc d.\n\nE f.", Some(WritingTaskType::Task2));
        assert_eq!(blocks.paragraphs, 2);
        assert_eq!(blocks.minimum_words, 250);
    }

    #[test]
    fn user_message_carries_measured_facts() {
        let message = user_message(&prepared_evaluation(None));
        assert!(message.contains("5 words (minimum 250; below the minimum"));
        assert!(message.contains("Discuss both views."));
    }

    /// Replays scripted replies in order and records every request.
    #[derive(Clone, Default)]
    struct ScriptedModel {
        replies: Arc<Mutex<Vec<Result<String, ModelError>>>>,
        requests: Arc<Mutex<Vec<CompletionRequest>>>,
    }

    impl ScriptedModel {
        fn new(replies: Vec<Result<String, ModelError>>) -> Self {
            Self {
                replies: Arc::new(Mutex::new(replies)),
                requests: Arc::default(),
            }
        }
    }

    #[async_trait]
    impl LanguageModel for ScriptedModel {
        async fn complete(
            &self,
            request: CompletionRequest,
        ) -> Result<crate::CompletionResponse, ModelError> {
            self.requests.lock().unwrap().push(request);
            self.replies
                .lock()
                .unwrap()
                .remove(0)
                .map(|content| crate::CompletionResponse {
                    content,
                    model: "fake-model".into(),
                    latency_ms: 1,
                    usage: None,
                    provider_request_id: None,
                })
        }
    }

    /// Long enough to stay clear of the 20-word ceiling.
    fn long_essay() -> PreparedEvaluation {
        let mut prepared = prepared_evaluation(None);
        prepared.essay = "Cities should invest in public transport. ".repeat(40);
        prepared
    }

    fn review_json() -> String {
        r#"{"feedback":{"overall":"Clear","plan":[]}}"#.into()
    }

    #[tokio::test]
    async fn agreeing_samples_cost_two_scoring_calls_and_one_review() {
        let model = ScriptedModel::new(vec![
            Ok(score_json(7.0, 7.0, 6.5, 6.5)),
            Ok(score_json(7.0, 6.5, 6.5, 6.5)),
            Ok(review_json()),
        ]);
        let mut prepared = prepared_evaluation(None);
        prepared.temperature = 0.8;
        let output = evaluate_language_model(&model, &prepared, &|| false)
            .await
            .unwrap();
        assert!(output.feedback.is_ok());

        let requests = model.requests.lock().unwrap();
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[0].temperature, SCORING_TEMPERATURE);
        assert_eq!(requests[0].max_tokens, SCORING_MAX_TOKENS);
        assert_eq!(requests[0].cache_key, requests[1].cache_key);
        assert!(requests[0].messages[0].content.contains("Output contract"));
        // The review keeps the user's temperature and sees the final bands.
        assert_eq!(requests[2].temperature, 0.8);
        assert_ne!(requests[2].cache_key, requests[0].cache_key);
        assert!(requests[2].messages[1].content.contains("Final bands"));
    }

    #[tokio::test]
    async fn disagreement_buys_a_third_sample() {
        let model = ScriptedModel::new(vec![
            Ok(score_json(5.0, 6.0, 6.0, 6.0)),
            Ok(score_json(7.0, 6.0, 6.0, 6.0)),
            Ok(score_json(6.0, 6.0, 6.0, 6.0)),
            Ok(review_json()),
        ]);
        let output = evaluate_language_model(&model, &long_essay(), &|| false)
            .await
            .unwrap();
        assert_eq!(output.score.task_response, 6.0);
        assert_eq!(model.requests.lock().unwrap().len(), 4);
        assert_eq!(output.diagnosis.unwrap().confidence.unwrap().samples, 3);
    }

    #[tokio::test]
    async fn one_failed_sample_still_scores_and_a_failed_review_keeps_the_score() {
        let model = ScriptedModel::new(vec![
            Ok("not-json".into()),
            Ok(score_json(6.0, 6.0, 6.0, 6.0)),
            Err(ModelError::new("request timed out", true)),
        ]);
        let output = evaluate_language_model(&model, &long_essay(), &|| false)
            .await
            .unwrap();
        assert_eq!(output.score.overall, 6.0);
        assert!(output.feedback.unwrap_err().retryable);
    }

    #[tokio::test]
    async fn cancellation_stops_follow_up_requests() {
        let model = ScriptedModel::new(vec![
            Ok(score_json(5.0, 6.0, 6.0, 6.0)),
            Ok(score_json(7.0, 6.0, 6.0, 6.0)),
            Ok(score_json(6.0, 6.0, 6.0, 6.0)),
            Ok(review_json()),
        ]);
        // Cancelled while the first two samples were in flight.
        let requests = model.requests.clone();
        let cancelled = move || requests.lock().unwrap().len() >= 2;
        let output = evaluate_language_model(&model, &long_essay(), &cancelled)
            .await
            .unwrap();
        assert_eq!(model.requests.lock().unwrap().len(), 2);
        assert!(output.feedback.is_err());
    }

    #[tokio::test]
    async fn invalid_checks_use_the_surviving_sample_fallback() {
        let model = ScriptedModel::new(vec![
            Ok(r#"{"checks":{"relevance":"unrelated","memorised":true,"unaddressedParts":"n/a"},"score":{"taskResponse":7,"coherence":7,"lexical":7,"grammar":7}}"#.into()),
            Ok(score_json(6.0, 6.0, 6.0, 6.0)),
            Ok(review_json()),
        ]);
        let output = evaluate_language_model(&model, &long_essay(), &|| false)
            .await
            .unwrap();
        assert_eq!(output.score.overall, 6.0);
        let confidence = output.diagnosis.unwrap().confidence.unwrap();
        assert_eq!(confidence.samples, 1);
        assert!(!confidence.agreed);
        assert_eq!(model.requests.lock().unwrap().len(), 3);
    }

    #[derive(Clone)]
    struct BlockingModel {
        inner: ScriptedModel,
        started: Arc<tokio::sync::Semaphore>,
        release: Arc<tokio::sync::Semaphore>,
    }

    #[async_trait]
    impl LanguageModel for BlockingModel {
        async fn complete(
            &self,
            request: CompletionRequest,
        ) -> Result<crate::CompletionResponse, ModelError> {
            let response = self.inner.complete(request).await;
            self.started.add_permits(1);
            self.release.acquire().await.unwrap().forget();
            response
        }
    }

    #[tokio::test]
    async fn cancellation_during_initial_samples_prevents_third_sample_and_review() {
        // Exercise both the disagreement branch and the direct-to-review path.
        for second_band in [6.0, 8.0] {
            let store = FakeWritingStore::fresh();
            let model = BlockingModel {
                inner: ScriptedModel::new(vec![
                    Ok(score_json(6.0, 6.0, 6.0, 6.0)),
                    Ok(score_json(
                        second_band,
                        second_band,
                        second_band,
                        second_band,
                    )),
                ]),
                started: Arc::new(tokio::sync::Semaphore::new(0)),
                release: Arc::new(tokio::sync::Semaphore::new(0)),
            };
            let sink = RecordingSink::default();
            let execution = WritingEvaluationService::execute(
                &store,
                long_essay(),
                EvaluationBackend::Language(model.clone()),
                &sink,
            );
            let cancellation = async {
                model.started.acquire_many(2).await.unwrap().forget();
                assert!(store.request_cancel("evaluation-1").unwrap());
                model.release.add_permits(2);
            };
            let (result, ()) = tokio::join!(execution, cancellation);
            let result = result.unwrap();
            assert_eq!(model.inner.requests.lock().unwrap().len(), 2);
            assert!(result.session.cancel_requested);
            assert_eq!(result.evaluation.status, EvaluationStatus::Interrupted);
            assert!(result.evaluation.score.is_none());
            assert!(result.evaluation.feedback.is_none());
        }
    }

    #[tokio::test]
    async fn cancellation_during_third_sample_prevents_review() {
        let store = FakeWritingStore::fresh();
        let model = BlockingModel {
            inner: ScriptedModel::new(vec![
                Ok(score_json(6.0, 6.0, 6.0, 6.0)),
                Ok(score_json(8.0, 8.0, 8.0, 8.0)),
                Ok(score_json(7.0, 7.0, 7.0, 7.0)),
            ]),
            started: Arc::new(tokio::sync::Semaphore::new(0)),
            release: Arc::new(tokio::sync::Semaphore::new(2)),
        };
        let sink = RecordingSink::default();
        let execution = WritingEvaluationService::execute(
            &store,
            long_essay(),
            EvaluationBackend::Language(model.clone()),
            &sink,
        );
        let cancellation = async {
            model.started.acquire_many(3).await.unwrap().forget();
            assert!(store.request_cancel("evaluation-1").unwrap());
            model.release.add_permits(1);
        };
        let (result, ()) = tokio::join!(execution, cancellation);
        assert_eq!(
            result.unwrap().evaluation.status,
            EvaluationStatus::Interrupted
        );
        assert_eq!(model.inner.requests.lock().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn cancellation_before_execution_prevents_all_model_requests() {
        let store = FakeWritingStore::fresh();
        let model = ScriptedModel::new(vec![]);
        store.request_cancel("evaluation-1").unwrap();
        let result = WritingEvaluationService::execute(
            &store,
            long_essay(),
            EvaluationBackend::Language(model.clone()),
            &RecordingSink::default(),
        )
        .await
        .unwrap();
        assert_eq!(result.evaluation.status, EvaluationStatus::Interrupted);
        assert!(model.requests.lock().unwrap().is_empty());
    }

    fn start_command() -> StartEvaluationCommand {
        StartEvaluationCommand {
            attempt_id: "attempt-1".into(),
            idempotency_key: "idempotency-1".into(),
            task_type: Some("task2".into()),
            retry_of: None,
        }
    }

    fn prepared_evaluation(existing: Option<EvaluationRunResult>) -> PreparedEvaluation {
        PreparedEvaluation {
            evaluation_id: "evaluation-1".into(),
            session_id: "session-1".into(),
            essay: "A sufficiently detailed IELTS essay.".into(),
            prompt: Some("Discuss both views.".into()),
            task_type: None,
            system_prompt: "Return the required JSON schema.".into(),
            temperature: 0.2,
            prompt_id: None,
            prompt_version: "prompt-v1".into(),
            handle: ielts_db::EvaluationHandle {
                attempt_id: "attempt-1".into(),
                session_id: "session-1".into(),
                evaluation_id: "evaluation-1".into(),
                status: EvaluationStatus::Queued,
                stage: EvaluationStage::Preparing,
                retry_of: None,
                sequence: 1,
            },
            existing,
        }
    }

    fn completed_result(
        events: Vec<ielts_db::EvaluationEvent>,
        score: Option<WritingScoreV4>,
        feedback: Option<WritingFeedbackV4>,
    ) -> EvaluationRunResult {
        EvaluationRunResult {
            session: EvaluationSession {
                id: "session-1".into(),
                attempt_id: "attempt-1".into(),
                evaluation_id: "evaluation-1".into(),
                status: EvaluationStatus::Completed,
                stage: EvaluationStage::Finalizing,
                revision: 1,
                sequence: 4,
                retry_of: None,
                cancel_requested: false,
                provider_id: Some("openai-compatible".into()),
                model: Some("fake-model".into()),
                started_at: "2026-08-07T00:00:00Z".into(),
                updated_at: "2026-08-07T00:00:01Z".into(),
                completed_at: Some("2026-08-07T00:00:01Z".into()),
            },
            evaluation: WritingEvaluationV4 {
                schema_version: WritingEvaluationV4::SCHEMA_VERSION,
                id: "evaluation-1".into(),
                status: EvaluationStatus::Completed,
                stage: EvaluationStage::Finalizing,
                task_type: None,
                score,
                diagnosis: None,
                feedback,
                degradation: None,
                error: None,
            },
            events,
        }
    }

    fn event(sequence: u32, stage: EvaluationStage) -> ielts_db::EvaluationEvent {
        ielts_db::EvaluationEvent {
            evaluation_id: "evaluation-1".into(),
            sequence,
            revision: 1,
            event_type: "stage".into(),
            stage: Some(stage),
            payload: serde_json::json!({ "sequence": sequence }),
            created_at: "2026-08-07T00:00:00Z".into(),
        }
    }

    fn valid_evaluation_json() -> String {
        r#"{"score":{"overall":7.0,"taskResponse":7.0,"coherence":6.5,"lexical":7.0,"grammar":6.5},"feedback":{"overall":"Clear","plan":[],"paragraphs":[],"sentences":[],"rewrites":[]}}"#.into()
    }

    fn valid_score_with_invalid_feedback() -> String {
        r#"{"score":{"overall":7.0,"taskResponse":7.0,"coherence":6.5,"lexical":7.0,"grammar":6.5},"feedback":false}"#.into()
    }
}
