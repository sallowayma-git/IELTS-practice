//! Convert writing evaluation v3 / alias-heavy envelopes into canonical v4.

use serde_json::Value;

use ielts_domain::domain::{EvaluationStage, EvaluationStatus, WritingTaskType};
use ielts_domain::dto::{
    EvaluationDegradation, ParagraphFeedback, SentenceFeedback, WritingDiagnosisV4,
    WritingEvaluationV4, WritingFeedbackV4, WritingScoreV4,
};
use ielts_domain::error::{DomainError, DomainResult, ErrorEnvelope};

/// Convert a loose v3 evaluation JSON object into WritingEvaluationV4.
///
/// Accepts the alias surface documented in the rewrite task book:
/// score / scorecard / total_score / task_achievement / ...
/// feedback / overall_feedback / review_blocks / paragraph_reviews / ...
pub fn evaluation_v3_to_v4(raw: &Value) -> DomainResult<WritingEvaluationV4> {
    if !raw.is_object() {
        return Err(DomainError::InvalidPayload(
            "evaluation payload must be an object".into(),
        ));
    }

    let failed = matches_str(raw.get("status"), &["failed", "error"])
        || raw.get("error").map(|e| !e.is_null()).unwrap_or(false) && raw_score_missing(raw);

    let degraded = bool_flag(raw, "review_degraded")
        || bool_flag_path(raw, &["review", "review_degraded"])
        || bool_flag_path(raw, &["review_status", "degraded"]);

    let task_type = raw
        .get("task_type")
        .or_else(|| raw.get("taskType"))
        .and_then(|v| v.as_str())
        .and_then(WritingTaskType::parse_loose);

    if failed {
        let error = raw
            .get("error")
            .and_then(|e| {
                if e.is_null() {
                    None
                } else {
                    Some(ErrorEnvelope {
                        code: e
                            .get("code")
                            .and_then(|c| c.as_str())
                            .unwrap_or("evaluation.failed")
                            .to_string(),
                        message: e
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("evaluation failed")
                            .to_string(),
                        retryable: e.get("retryable").and_then(|r| r.as_bool()).unwrap_or(true),
                        context: None,
                        cause_id: None,
                    })
                }
            })
            .unwrap_or_else(|| ErrorEnvelope::new("evaluation.failed", "evaluation failed", true));

        return Ok(WritingEvaluationV4 {
            schema_version: WritingEvaluationV4::SCHEMA_VERSION,
            id: String::new(),
            status: EvaluationStatus::Failed,
            stage: EvaluationStage::Scoring,
            task_type,
            score: None,
            diagnosis: None,
            feedback: None,
            degradation: None,
            error: Some(error),
        });
    }

    let score = extract_score(raw)?;
    let diagnosis = extract_diagnosis(raw);
    let feedback = extract_feedback(raw, degraded);

    let status = if degraded {
        EvaluationStatus::Degraded
    } else {
        EvaluationStatus::Completed
    };
    let stage = if degraded {
        EvaluationStage::Reviewing
    } else {
        EvaluationStage::Finalizing
    };

    let degradation = if degraded {
        Some(EvaluationDegradation {
            stage: EvaluationStage::Reviewing,
            reason: "stage-2 review degraded; scores and plan retained".into(),
            missing: vec!["feedback.paragraphs".into(), "feedback.sentences".into()],
        })
    } else {
        None
    };

    Ok(WritingEvaluationV4 {
        schema_version: WritingEvaluationV4::SCHEMA_VERSION,
        id: String::new(),
        status,
        stage,
        task_type,
        score: Some(score),
        diagnosis,
        feedback: Some(feedback),
        degradation,
        error: None,
    })
}

fn raw_score_missing(raw: &Value) -> bool {
    extract_score(raw).is_err()
}

fn extract_score(raw: &Value) -> DomainResult<WritingScoreV4> {
    // Prefer nested score object with modern keys.
    if let Some(score) = raw.get("score") {
        if let (Some(overall), Some(tr), Some(cc), Some(lr), Some(gra)) = (
            num(score.get("overall")),
            num(score.get("taskResponse")).or_else(|| num(score.get("task_response"))),
            num(score.get("coherence")),
            num(score.get("lexical")),
            num(score.get("grammar")),
        ) {
            return Ok(WritingScoreV4 {
                overall,
                task_response: tr,
                coherence: cc,
                lexical: lr,
                grammar: gra,
            });
        }
    }

    // scorecard aliases
    if let Some(sc) = raw.get("scorecard") {
        if let (Some(overall), Some(tr), Some(cc), Some(lr), Some(gra)) = (
            num(sc.get("overall")),
            num(sc.get("TR")).or_else(|| num(sc.get("taskResponse"))),
            num(sc.get("CC")).or_else(|| num(sc.get("coherence"))),
            num(sc.get("LR")).or_else(|| num(sc.get("lexical"))),
            num(sc.get("GRA")).or_else(|| num(sc.get("grammar"))),
        ) {
            return Ok(WritingScoreV4 {
                overall,
                task_response: tr,
                coherence: cc,
                lexical: lr,
                grammar: gra,
            });
        }
    }

    // top-level legacy fields
    if let (Some(overall), Some(tr), Some(cc), Some(lr), Some(gra)) = (
        num(raw.get("total_score")).or_else(|| num(raw.get("totalScore"))),
        num(raw.get("task_achievement")).or_else(|| num(raw.get("taskAchievement"))),
        num(raw.get("coherence_cohesion")).or_else(|| num(raw.get("coherenceCohesion"))),
        num(raw.get("lexical_resource")).or_else(|| num(raw.get("lexicalResource"))),
        num(raw.get("grammatical_range")).or_else(|| num(raw.get("grammaticalRange"))),
    ) {
        return Ok(WritingScoreV4 {
            overall,
            task_response: tr,
            coherence: cc,
            lexical: lr,
            grammar: gra,
        });
    }

    Err(DomainError::InvalidPayload(
        "unable to resolve writing score from legacy evaluation".into(),
    ))
}

fn extract_diagnosis(raw: &Value) -> Option<WritingDiagnosisV4> {
    let task = raw
        .get("task_analysis")
        .cloned()
        .or_else(|| {
            raw.get("analysis")
                .and_then(|a| a.get("task_analysis"))
                .cloned()
        })
        .filter(|v| !v.is_null());

    let rationale = raw
        .get("band_rationale")
        .cloned()
        .or_else(|| raw.get("bandRationale").cloned())
        .filter(|v| !v.is_null());

    if task.is_none() && rationale.is_none() {
        return None;
    }
    Some(WritingDiagnosisV4 { task, rationale })
}

fn extract_feedback(raw: &Value, degraded: bool) -> WritingFeedbackV4 {
    let overall = first_string(raw, &["feedback", "overall_feedback", "overallFeedback"]);

    let plan = raw
        .get("improvement_plan")
        .or_else(|| raw.get("improvementPlan"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let paragraphs = if degraded {
        Vec::new()
    } else {
        raw.get("review_blocks")
            .or_else(|| raw.get("paragraph_reviews"))
            .or_else(|| raw.get("paragraphReviews"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        Some(ParagraphFeedback {
                            paragraph_index: item
                                .get("paragraph_index")
                                .or_else(|| item.get("paragraphIndex"))
                                .and_then(|x| x.as_u64())
                                .unwrap_or(0) as u32,
                            summary: item
                                .get("summary")
                                .and_then(|x| x.as_str())
                                .map(|s| s.to_string()),
                            issues: item
                                .get("issues")
                                .and_then(|x| x.as_array())
                                .map(|issues| {
                                    issues
                                        .iter()
                                        .filter_map(|i| i.as_str().map(|s| s.to_string()))
                                        .collect()
                                })
                                .unwrap_or_default(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    };

    let sentences = if degraded {
        Vec::new()
    } else {
        raw.get("sentence_errors")
            .or_else(|| raw.get("sentenceErrors"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let sentence = item.get("sentence")?.as_str()?.to_string();
                        Some(SentenceFeedback {
                            sentence,
                            correction: item
                                .get("correction")
                                .and_then(|x| x.as_str())
                                .map(|s| s.to_string()),
                            kind: item
                                .get("type")
                                .or_else(|| item.get("kind"))
                                .and_then(|x| x.as_str())
                                .map(|s| s.to_string()),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    };

    WritingFeedbackV4 {
        overall,
        plan,
        paragraphs,
        sentences,
        rewrites: Vec::new(),
    }
}

fn num(value: Option<&Value>) -> Option<f64> {
    value.and_then(|v| {
        v.as_f64()
            .or_else(|| v.as_i64().map(|i| i as f64))
            .or_else(|| v.as_u64().map(|u| u as f64))
            .or_else(|| v.as_str()?.parse().ok())
    })
}

fn first_string(raw: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(s) = raw.get(*key).and_then(|v| v.as_str()) {
            if !s.is_empty() {
                return Some(s.to_string());
            }
        }
    }
    None
}

fn bool_flag(raw: &Value, key: &str) -> bool {
    raw.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn bool_flag_path(raw: &Value, path: &[&str]) -> bool {
    let mut cur = raw;
    for key in path {
        match cur.get(*key) {
            Some(next) => cur = next,
            None => return false,
        }
    }
    cur.as_bool().unwrap_or(false)
}

fn matches_str(value: Option<&Value>, options: &[&str]) -> bool {
    value
        .and_then(|v| v.as_str())
        .map(|s| options.iter().any(|o| s.eq_ignore_ascii_case(o)))
        .unwrap_or(false)
}

/// Guard: v4 JSON must not contain known legacy alias keys at the top level.
pub fn assert_no_legacy_aliases(v4: &WritingEvaluationV4) -> DomainResult<()> {
    let value = serde_json::to_value(v4).map_err(|e| DomainError::InvalidPayload(e.to_string()))?;
    let obj = value
        .as_object()
        .ok_or_else(|| DomainError::InvalidPayload("v4 must serialize to object".into()))?;

    const FORBIDDEN: &[&str] = &[
        "total_score",
        "task_achievement",
        "coherence_cohesion",
        "lexical_resource",
        "grammatical_range",
        "scorecard",
        "overall_feedback",
        "review_blocks",
        "paragraph_reviews",
        "task_analysis",
        "band_rationale",
        "review_degraded",
        "improvement_plan",
        "sentence_errors",
    ];

    for key in FORBIDDEN {
        if obj.contains_key(*key) {
            return Err(DomainError::InvalidPayload(format!(
                "legacy alias `{key}` must not appear in v4 writes"
            )));
        }
    }
    Ok(())
}
