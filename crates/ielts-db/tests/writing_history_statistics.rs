//! Native writing-history statistics must derive from completed evaluation rows,
//! never from a frontend page scan or an obsolete HTTP response shape.

use ielts_domain::domain::{Activity, AttemptMode, WritingTaskType};
use ielts_domain::dto::{
    SaveDraftCommand, SubmitAttemptCommand, WritingHistoryStatisticsQuery,
    WritingHistoryStatisticsRange,
};
use tempfile::tempdir;

use ielts_db::{
    migrate, open_connection, save_writing_draft, start_evaluation, submit_writing_attempt,
    writing_history_statistics, DbOpenOptions, DeterministicProvider, StartEvaluationCommand,
};

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn =
        open_connection(&DbOpenOptions::create(dir.path().join("history-stats.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

fn complete(conn: &rusqlite::Connection, id: &str, task_type: WritingTaskType, essay: &str) {
    save_writing_draft(
        conn,
        &SaveDraftCommand {
            attempt_id: id.into(),
            activity: Activity::Writing,
            mode: AttemptMode::Freeform,
            asset_id: None,
            content_text: Some(essay.into()),
            prompt_snapshot: Some("Discuss both views and give your opinion.".into()),
            task_type: Some(task_type),
            idempotency_key: format!("draft-{id}"),
        },
    )
    .unwrap();
    submit_writing_attempt(
        conn,
        &SubmitAttemptCommand {
            attempt_id: id.into(),
            idempotency_key: format!("submit-{id}"),
        },
    )
    .unwrap();
    start_evaluation(
        conn,
        &StartEvaluationCommand {
            attempt_id: id.into(),
            idempotency_key: format!("evaluate-{id}"),
            task_type: Some(
                match task_type {
                    WritingTaskType::Task1 => "task1",
                    WritingTaskType::Task2 => "task2",
                }
                .into(),
            ),
            retry_of: None,
        },
        &DeterministicProvider,
    )
    .unwrap();
}

#[test]
fn statistics_return_native_criterion_totals_and_latest_snapshot() {
    let (_dir, conn) = open_db();
    complete(
        &conn,
        "stats-task1",
        WritingTaskType::Task1,
        &"Task 1 data overview. ".repeat(80),
    );
    complete(
        &conn,
        "stats-task2",
        WritingTaskType::Task2,
        &"Task 2 argument development. ".repeat(100),
    );

    let all = writing_history_statistics(
        &conn,
        &WritingHistoryStatisticsQuery {
            range: WritingHistoryStatisticsRange::All,
        },
    )
    .unwrap();
    assert_eq!(all.count, 2);
    assert!(all.latest.is_some());
    assert!(all.average.is_some());
    assert!(all
        .average
        .as_ref()
        .is_some_and(|score| score.task_response > 0.0 && score.grammar > 0.0));

    let task1 = writing_history_statistics(
        &conn,
        &WritingHistoryStatisticsQuery {
            range: WritingHistoryStatisticsRange::Task1,
        },
    )
    .unwrap();
    assert_eq!(task1.count, 1);
    assert_eq!(task1.latest.unwrap().task_type, WritingTaskType::Task1);

    let monthly = writing_history_statistics(
        &conn,
        &WritingHistoryStatisticsQuery {
            range: WritingHistoryStatisticsRange::Monthly,
        },
    )
    .unwrap();
    assert_eq!(monthly.count, 2);
}
