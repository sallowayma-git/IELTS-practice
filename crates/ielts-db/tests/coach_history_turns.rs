//! The prompt-history read: completed user/assistant turns only, newest `limit`.
use ielts_db::*;
use rusqlite::Connection;

fn thread() -> (tempfile::TempDir, Connection, String) {
    let dir = tempfile::tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("turns.db"))).unwrap();
    migrate(&mut conn).unwrap();
    let thread = ensure_coach_thread(
        &conn,
        &EnsureCoachThreadCommand { thread_id: None, attempt_id: None, asset_id: None, kind: "chat".into() },
    )
    .unwrap();
    (dir, conn, thread.id)
}

fn append(conn: &Connection, thread: &str, role: &str, status: &str, content: &str) {
    append_coach_message(
        conn,
        &AppendCoachMessageCommand {
            thread_id: thread.into(),
            role: role.into(),
            content: content.into(),
            structured_payload: None,
            status: status.into(),
        },
    )
    .unwrap();
}

#[test]
fn failure_notes_and_unfinished_rows_never_use_up_the_history_limit() {
    let (_dir, conn, thread) = thread();
    append(&conn, &thread, "user", "completed", "q1");
    append(&conn, &thread, "assistant", "completed", "a1");
    for _ in 0..10 {
        append(&conn, &thread, "user", "completed", "retry");
        append(&conn, &thread, "system", "failed", "provider timeout");
    }
    append(&conn, &thread, "assistant", "running", "half an answer");
    append(&conn, &thread, "user", "completed", "q2");
    append(&conn, &thread, "assistant", "completed", "a2");

    // The unfiltered read spends its limit on failure rows...
    let raw = list_recent_coach_messages(&conn, &thread, 3).unwrap();
    assert!(raw.iter().any(|m| m.status != "completed"));
    // ...the prompt read does not: the same limit reaches the real turns.
    let turns = list_recent_coach_turns(&conn, &thread, 4).unwrap();
    let seen: Vec<(&str, &str)> = turns.iter().map(|m| (m.role.as_str(), m.content.as_str())).collect();
    assert_eq!(seen, vec![("user", "retry"), ("user", "retry"), ("user", "q2"), ("assistant", "a2")]);
    assert!(turns.windows(2).all(|pair| pair[0].sequence < pair[1].sequence), "chronological");

    let everything = list_recent_coach_turns(&conn, &thread, 500).unwrap();
    assert_eq!(everything.len(), 2 + 10 + 2);
    assert!(everything.iter().all(|m| m.status == "completed" && m.role != "system"));
}
