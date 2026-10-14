//! Weekly facts and the weekly model pack read the essay the history view
//! shows: the newest evaluation by creation, not the provider call that
//! happened to finish last.

use chrono::{Duration, FixedOffset, Utc};
use ielts_db::weekly_report::week_facts;
use ielts_db::{
    finish_evaluation, load_evaluation_for_attempt, migrate, open_connection, prepare_evaluation,
    save_writing_draft, start_evaluation, weekly_observation_count, weekly_pack, DbOpenOptions,
    DeterministicProvider, StartEvaluationCommand,
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

    // The model pack sees the same single essay: one line, one scored
    // observation, and the stale call's band is not a citable id.
    let stale: Vec<String> = {
        let mut statement = conn
            .prepare("SELECT id FROM learner_observations WHERE observation_type LIKE 'writing.evaluation.%' AND value_num = 3.0")
            .unwrap();
        statement.query_map([], |row| row.get(0)).unwrap().map(Result::unwrap).collect()
    };
    assert_eq!(stale.len(), 5, "the late call's band and four criteria were projected");
    let (start, end) = (now - Duration::days(1), now + Duration::days(1));
    let pack = weekly_pack(&conn, "local", start, end).unwrap();
    let writing: Vec<_> = pack.lines.iter().filter(|line| line.kind == "writing").collect();
    assert_eq!(writing.len(), 1, "{writing:?}");
    assert!(writing[0].text.contains(&format!("band {}", score.overall)), "{}", writing[0].text);
    assert_eq!(writing[0].ids, vec![essay.obs_id.clone()]);
    assert!(stale.iter().all(|id| !pack.evidence_ids().contains(id)));
    assert_eq!(pack.observation_count, 1);
    assert_eq!(weekly_observation_count(&conn, "local", start, end).unwrap(), 1);
}
