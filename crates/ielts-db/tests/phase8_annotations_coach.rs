//! Phase 8: annotations, dictionary, vocabulary, coach threads.

use serde_json::json;
use tempfile::tempdir;

use ielts_db::{
    append_coach_message, attempt_score_snapshot, delete_annotation, ensure_coach_thread,
    import_asset_payload_file, import_dictionary, list_annotations, list_coach_messages,
    list_learning_events, list_vocab, lookup_term, migrate, open_connection, record_coach_failure,
    resolve_anchor, revalidate_annotations, review_vocab, submit_reading_attempt,
    upsert_annotation, upsert_vocab, AppendCoachMessageCommand, DbOpenOptions, DictionaryEntry,
    EnsureCoachThreadCommand, ImportDictionaryCommand, ReadingSubmitCommand,
    RecordCoachFailureCommand, ReviewVocabCommand, TextAnchor, UpsertAnnotationCommand,
    UpsertVocabCommand,
};

fn open_db() -> (tempfile::TempDir, rusqlite::Connection) {
    let dir = tempdir().unwrap();
    let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("v2.db"))).unwrap();
    migrate(&mut conn).unwrap();
    (dir, conn)
}

#[test]
fn annotation_stable_anchor_and_mismatch() {
    let (_dir, conn) = open_db();
    let ann = upsert_annotation(
        &conn,
        &UpsertAnnotationCommand {
            id: None,
            attempt_id: None,
            asset_id: "asset-1".into(),
            scope: "passage".into(),
            question_id: None,
            kind: "highlight".into(),
            anchor: TextAnchor {
                text: "climate change".into(),
                before: Some("about".into()),
                after: Some("is".into()),
                occurrence: 0,
                start_offset: None,
                end_offset: None,
                content_fingerprint: Some("fp1".into()),
            },
            note_text: Some("key phrase".into()),
        },
    )
    .unwrap();
    assert!(!ann.id.is_empty());

    let doc = "Scientists talk about climate change is urgent.";
    let (s, e) = resolve_anchor(doc, &ann.anchor).unwrap();
    assert!(e > s);

    let list = list_annotations(&conn, "asset-1", None).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].note_text.as_deref(), Some("key phrase"));

    let checked =
        revalidate_annotations(&conn, "asset-1", None, "passage", "totally different text")
            .unwrap();
    assert_eq!(checked[0].mismatch.as_deref(), Some("text_not_found"));
}

fn seed_annotation_attempts(conn: &rusqlite::Connection) {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO practice_assets (
            id, activity, source_kind, title, schema_version, fingerprint, created_at, updated_at
         ) VALUES (?1, 'reading', 'builtin', 'Attempt isolation asset', 1, 'asset-fingerprint', ?2, ?2)",
        rusqlite::params!["asset-isolated", now],
    )
    .unwrap();
    for attempt_id in ["attempt-a", "attempt-b"] {
        conn.execute(
            "INSERT INTO attempts (
                id, activity, asset_id, mode, status, started_at, duration_ms, schema_version,
                created_at, updated_at
             ) VALUES (?1, 'reading', 'asset-isolated', 'single', 'in_progress', ?2, 0, 1, ?2, ?2)",
            rusqlite::params![attempt_id, now],
        )
        .unwrap();
    }
}

fn annotation_command(
    id: &str,
    attempt_id: Option<&str>,
    scope: &str,
    kind: &str,
    text: &str,
) -> UpsertAnnotationCommand {
    UpsertAnnotationCommand {
        id: Some(id.into()),
        attempt_id: attempt_id.map(str::to_owned),
        asset_id: "asset-isolated".into(),
        scope: scope.into(),
        question_id: None,
        kind: kind.into(),
        anchor: TextAnchor {
            text: text.into(),
            before: None,
            after: None,
            occurrence: 0,
            start_offset: None,
            end_offset: None,
            content_fingerprint: None,
        },
        note_text: (kind == "note").then(|| "shared reading note".into()),
    }
}

#[test]
fn annotation_attempt_scope_isolates_highlights_without_hiding_global_notes() {
    let (_dir, conn) = open_db();
    seed_annotation_attempts(&conn);
    let attempt_a = upsert_annotation(
        &conn,
        &annotation_command(
            "ann-attempt-a",
            Some("attempt-a"),
            "passage",
            "highlight",
            "alpha",
        ),
    )
    .unwrap();
    let attempt_b = upsert_annotation(
        &conn,
        &annotation_command(
            "ann-attempt-b",
            Some("attempt-b"),
            "passage",
            "highlight",
            "beta",
        ),
    )
    .unwrap();
    let global_note = upsert_annotation(
        &conn,
        &annotation_command("ann-global-note", None, "note", "note", "reading-note"),
    )
    .unwrap();

    let visible_to_a = list_annotations(&conn, "asset-isolated", Some("attempt-a")).unwrap();
    let visible_to_a_ids = visible_to_a
        .iter()
        .map(|annotation| annotation.id.as_str())
        .collect::<Vec<_>>();
    assert!(visible_to_a_ids.contains(&attempt_a.id.as_str()));
    assert!(visible_to_a_ids.contains(&global_note.id.as_str()));
    assert!(!visible_to_a_ids.contains(&attempt_b.id.as_str()));

    let revalidated_a = revalidate_annotations(
        &conn,
        "asset-isolated",
        Some("attempt-a"),
        "passage",
        "alpha",
    )
    .unwrap();
    let revalidated_a_ids = revalidated_a
        .iter()
        .map(|annotation| annotation.id.as_str())
        .collect::<Vec<_>>();
    assert!(revalidated_a_ids.contains(&attempt_a.id.as_str()));
    assert!(revalidated_a_ids.contains(&global_note.id.as_str()));
    assert!(!revalidated_a_ids.contains(&attempt_b.id.as_str()));
    assert!(revalidated_a
        .iter()
        .find(|annotation| annotation.id == attempt_a.id)
        .is_some_and(|annotation| annotation.mismatch.is_none()));

    let revalidated_b = revalidate_annotations(
        &conn,
        "asset-isolated",
        Some("attempt-b"),
        "passage",
        "beta",
    )
    .unwrap();
    let revalidated_b_ids = revalidated_b
        .iter()
        .map(|annotation| annotation.id.as_str())
        .collect::<Vec<_>>();
    assert!(revalidated_b_ids.contains(&attempt_b.id.as_str()));
    assert!(revalidated_b_ids.contains(&global_note.id.as_str()));
    assert!(!revalidated_b_ids.contains(&attempt_a.id.as_str()));

    assert!(
        !delete_annotation(&conn, &attempt_b.id, "asset-isolated", Some("attempt-a"),).unwrap()
    );
    assert!(
        !delete_annotation(&conn, &global_note.id, "asset-isolated", Some("attempt-a"),).unwrap()
    );
    assert!(delete_annotation(&conn, &global_note.id, "asset-isolated", None,).unwrap());
    assert!(delete_annotation(&conn, &attempt_a.id, "asset-isolated", Some("attempt-a"),).unwrap());
    assert!(list_annotations(&conn, "asset-isolated", Some("attempt-b"))
        .unwrap()
        .iter()
        .any(|annotation| annotation.id == attempt_b.id));
}

#[test]
fn dictionary_and_vocab_review() {
    let (_dir, conn) = open_db();
    import_dictionary(
        &conn,
        &ImportDictionaryCommand {
            entries: vec![DictionaryEntry {
                term: "ephemeral".into(),
                normalized_term: "ephemeral".into(),
                definition: "lasting a very short time".into(),
                phonetic: Some("/ɪˈfem.ər.əl/".into()),
                part_of_speech: Some("adj".into()),
                example: Some("Fame can be ephemeral.".into()),
                source_label: Some("builtin".into()),
                license: Some("CC".into()),
                payload: None,
                found: true,
            }],
        },
    )
    .unwrap();
    let hit = lookup_term(&conn, "Ephemeral").unwrap();
    assert!(hit.found);
    assert!(hit.definition.contains("short"));

    let miss = lookup_term(&conn, "zzzz-not-a-word").unwrap();
    assert!(!miss.found);

    let item = upsert_vocab(
        &conn,
        &UpsertVocabCommand {
            id: None,
            term: "ephemeral".into(),
            definition: Some(hit.definition.clone()),
            phonetic: hit.phonetic.clone(),
            part_of_speech: hit.part_of_speech.clone(),
            example: hit.example.clone(),
            source_asset_id: Some("a1".into()),
            source_attempt_id: None,
            tags: vec!["reading".into()],
        },
    )
    .unwrap();
    let reviewed = review_vocab(
        &conn,
        &ReviewVocabCommand {
            item_id: item.id.clone(),
            grade: 2,
        },
    )
    .unwrap();
    assert!(reviewed.review.unwrap().repetitions >= 1);
    assert_eq!(list_vocab(&conn, 20, 0).unwrap().len(), 1);
}

#[test]
fn coach_incremental_messages_failure_preserves_score() {
    let (dir, conn) = open_db();
    let asset_payload = json!({
        "examId": "asset-c",
        "answerKey": { "q1": "TRUE" },
        "interactionModel": {},
        "questionGroups": []
    });
    let path = dir.path().join("asset-c.json");
    std::fs::write(&path, serde_json::to_vec(&asset_payload).unwrap()).unwrap();
    import_asset_payload_file(&conn, &path).unwrap();
    // scored attempt first
    let sub = submit_reading_attempt(
        &conn,
        &ReadingSubmitCommand {
            attempt_id: "att-coach-1".into(),
            asset_id: "asset-c".into(),
            asset_revision: None,
            asset_fingerprint: None,
            answers: json!({ "q1": "TRUE" }),
            marked_questions: vec![],
            question_timeline: vec![],
            duration_ms: Some(1000),
            title_snapshot: Some("T".into()),
            idempotency_key: "c-sub".into(),
        },
    )
    .unwrap();
    let before = attempt_score_snapshot(&conn, "att-coach-1").unwrap();
    assert!(before.0.is_some());

    let thread = ensure_coach_thread(
        &conn,
        &EnsureCoachThreadCommand {
            thread_id: None,
            attempt_id: Some("att-coach-1".into()),
            asset_id: Some("asset-c".into()),
            kind: "review".into(),
        },
    )
    .unwrap();
    append_coach_message(
        &conn,
        &AppendCoachMessageCommand {
            thread_id: thread.id.clone(),
            role: "user".into(),
            content: "Please review my mistakes".into(),
            structured_payload: None,
            status: "completed".into(),
        },
    )
    .unwrap();
    append_coach_message(
        &conn,
        &AppendCoachMessageCommand {
            thread_id: thread.id.clone(),
            role: "assistant".into(),
            content: "Focus on TRUE/FALSE traps.".into(),
            structured_payload: Some(json!({ "kind": "review" })),
            status: "completed".into(),
        },
    )
    .unwrap();
    let msgs = list_coach_messages(&conn, &thread.id, Some(0), 50).unwrap();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0].sequence, 1);
    assert_eq!(msgs[1].sequence, 2);
    let learning = list_learning_events(&conn, Some("asset-c"), Some("att-coach-1"), 20).unwrap();
    assert_eq!(learning.len(), 4); // reading completion + outcome + coach question + response
    assert!(learning
        .iter()
        .any(|event| event.event_type == ielts_domain::LearningEventType::CoachQuestionAsked));
    assert!(learning
        .iter()
        .any(|event| event.event_type == ielts_domain::LearningEventType::CoachResponseGenerated));
    assert!(!learning.iter().any(|event| event
        .payload
        .to_string()
        .contains("Please review my mistakes")));
    assert!(!learning
        .iter()
        .any(|event| event.payload.to_string().contains("TRUE/FALSE traps")));

    record_coach_failure(
        &conn,
        &RecordCoachFailureCommand {
            thread_id: thread.id.clone(),
            error: json!({ "code": "provider_timeout", "message": "timeout" }),
            preserve_scores: true,
        },
    )
    .unwrap();

    let failed_thread = ielts_db::get_thread(&conn, &thread.id).unwrap();
    assert_eq!(failed_thread.status, "degraded");
    assert_eq!(
        failed_thread
            .last_error
            .as_ref()
            .and_then(|v| v.get("code"))
            .and_then(|v| v.as_str()),
        Some("provider_timeout")
    );

    let after = attempt_score_snapshot(&conn, "att-coach-1").unwrap();
    assert_eq!(before, after);
    assert_eq!(sub.attempt.id, "att-coach-1");

    let more = list_coach_messages(&conn, &thread.id, Some(2), 50).unwrap();
    assert_eq!(more.len(), 1); // failure system message
    assert_eq!(more[0].status, "failed");

    // Round-3 audit (7.8): the coach prompt needs the NEWEST turns. The ASC
    // pagination cursor above returns the OLDEST n for a bare limit, which
    // silently dropped the user's current question once a thread grew past it.
    let oldest = list_coach_messages(&conn, &thread.id, None, 2).unwrap();
    assert_eq!(
        oldest.iter().map(|m| m.sequence).collect::<Vec<_>>(),
        vec![1, 2],
        "the pagination cursor keeps its ASC contract"
    );
    let recent = ielts_db::list_recent_coach_messages(&conn, &thread.id, 2).unwrap();
    assert_eq!(
        recent.iter().map(|m| m.sequence).collect::<Vec<_>>(),
        vec![2, 3],
        "newest-n must return the tail, in chronological order"
    );
    let all = ielts_db::list_recent_coach_messages(&conn, &thread.id, 50).unwrap();
    assert_eq!(
        all.iter().map(|m| m.sequence).collect::<Vec<_>>(),
        vec![1, 2, 3],
        "asking for more than exists returns everything, still chronological"
    );
}
