//! Weekly facts read the essay the history view shows: the newest evaluation by
//! creation, not the provider call that happened to finish last.

use chrono::{Duration, FixedOffset, Utc};
use ielts_db::weekly_report::week_facts;
use ielts_db::{
    finish_evaluation, load_evaluation_for_attempt, migrate, open_connection, prepare_evaluation,
    save_writing_draft, start_evaluation, DbOpenOptions, DeterministicProvider, StartEvaluationCommand,
};
use ielts_domain::domain::{Activity, AttemptMode, WritingTaskType};
use ielts_domain::dto::{SaveDraftCommand, WritingScoreV4};

fn command(key: &str, retry_of: Option<String>) -> StartEvaluationCommand {
    StartEvaluationCommand {
        attempt_id: "essay".into(),
        idempotency_key: key.into(),
        task_type: Some("task2".into()),
        retry_of,
    }
}

/// Review on #243: the original call finishes after its retry. Its band is the
/// newest observation, yet the retry stays the essay's score and session.
#[test]
fn a_retry_beats_the_original_call_that_finishes_after_it() {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    let draft = SaveDraftCommand {
        attempt_id: "essay".into(),
        activity: Activity::Writing,
        mode: AttemptMode::Bank,
        asset_id: None,
        content_text: Some("A retry must win over a late provider response. ".repeat(40)),
        prompt_snapshot: Some("Discuss both views.".into()),
        task_type: Some(WritingTaskType::Task2),
        idempotency_key: "draft".into(),
    };
    save_writing_draft(&conn, &draft).unwrap();

    let original = prepare_evaluation(&conn, &command("original", None), "openai-compatible", "test-model").unwrap();
    let retry = start_evaluation(&conn, &command("retry", Some(original.evaluation_id.clone())), &DeterministicProvider)
        .unwrap();
    let late = WritingScoreV4 { overall: 3.0, task_response: 3.0, coherence: 3.0, lexical: 3.0, grammar: 3.0 };
    finish_evaluation(&conn, &original, Ok(late), None, None).unwrap();

    let canonical = load_evaluation_for_attempt(&conn, "essay").unwrap().unwrap();
    assert_eq!(canonical.id, retry.session.evaluation_id);
    let score = canonical.score.unwrap();
    assert_ne!(score.overall, 3.0, "the fixture needs distinct scores");

    let now = Utc::now();
    let facts =
        week_facts(&conn, "local", now - Duration::days(1), now + Duration::days(1), FixedOffset::east_opt(0).unwrap())
            .unwrap();
    assert_eq!(facts.writing.len(), 1, "one essay, evaluated twice");
    let essay = &facts.writing[0];
    assert_eq!(essay.band, score.overall);
    assert!(essay.criteria.iter().all(|(_, value)| *value != 3.0), "no criterion of the late call: {:?}", essay.criteria);
    assert_eq!(essay.criteria.len(), 4);
    assert_eq!(essay.session_id.as_deref(), Some(retry.session.id.as_str()));
}
