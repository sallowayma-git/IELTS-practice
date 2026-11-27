use super::*;

fn suite() -> Suite {
    Suite {
        book_id: 21,
        task1: Some(11),
        task2: Some(12),
    }
}

#[test]
fn writing_topics_keep_real_task_identity_and_safe_prompt_paragraphs() {
    let source = json!({"testId":2101,"bookId":21,"paperId":12,"prompt":"First paragraph.\n\nSecond paragraph.","image":null});
    let converted = topic("owner", "2101", WritingTaskType::Task2, &suite(), &source).unwrap();
    let document: Value = serde_json::from_str(&converted.title_json).unwrap();
    assert_eq!(document["content"].as_array().unwrap().len(), 2);
    assert_eq!(
        document["content"][1]["content"][0]["text"],
        "Second paragraph."
    );
    assert_eq!(
        converted.id,
        topic("owner", "2101", WritingTaskType::Task2, &suite(), &source)
            .unwrap()
            .id
    );
    assert_ne!(
        converted.id,
        topic(
            "another-owner",
            "2101",
            WritingTaskType::Task2,
            &suite(),
            &source
        )
        .unwrap()
        .id
    );
    assert!(topic("owner", "2101", WritingTaskType::Task1, &suite(), &source).is_err());
}

#[test]
fn task1_requires_a_local_raster_data_url() {
    let mut source =
        json!({"testId":2101,"bookId":21,"paperId":11,"prompt":"Review the chart.","image":null});
    assert!(topic("owner", "2101", WritingTaskType::Task1, &suite(), &source).is_err());
    source["image"] = json!("https://www.idictation.cn/sample.png");
    assert!(topic("owner", "2101", WritingTaskType::Task1, &suite(), &source).is_err());
    source["image"] = json!("data:image/png;base64,iVBORw0KGgo=");
    assert!(topic("owner", "2101", WritingTaskType::Task1, &suite(), &source).is_ok());
}

#[test]
fn supplemental_grants_keep_task_and_source_and_require_an_openable_paper() {
    let mut session = WritingSession::default();
    let cards = supplemental_catalog(&json!([
        {"paperId":17,"testId":3,"title":"The topic","inline":null},
        {"paperId":18,"testId":null,"title":"Inline","inline":{"content":"An essay prompt.","image":""}},
        {"paperId":19,"testId":null,"title":"Missing","inline":null}
    ]), Bank::General, WritingTaskType::Task2, &mut session).unwrap();
    assert_eq!(cards.len(), 2);
    assert!(!cards[0].has_task1);
    assert!(cards[0].has_task2);
    let grant = &session.supplemental["17"];
    assert_eq!(grant.test_id, Some(3));
    assert!(grant.bank == Bank::General);
    let document = make_topic(
        &json!({"prompt":"An essay prompt."}),
        grant.task,
        "idictation_general",
        &[json!("owner"), json!("general"), json!(17)],
    )
    .unwrap();
    assert_eq!(document.category, "idictation_general");
}

#[test]
fn imported_topic_reopens_through_native_bank_and_reimport_preserves_local_edits() {
    use ielts_db::writing::{get_writing_topic, upsert_writing_topic};
    let folder = tempfile::tempdir().unwrap();
    let options = ielts_db::DbOpenOptions::create(folder.path().join("topics.sqlite"));
    let source =
        json!({"testId":2101,"bookId":21,"paperId":12,"prompt":"An essay prompt.","image":null});
    let original = topic("owner", "2101", WritingTaskType::Task2, &suite(), &source).unwrap();
    let id = {
        let mut conn = ielts_db::open_connection(&options).unwrap();
        ielts_db::migrate(&mut conn).unwrap();
        let id = store_topic(&conn, &original).unwrap();
        let mut edited = original.clone();
        edited.title_json = "My edited prompt.".into();
        upsert_writing_topic(&conn, &edited).unwrap();
        id
    };
    let conn = ielts_db::open_connection(&options).unwrap();
    assert_eq!(store_topic(&conn, &original).unwrap(), id);
    let saved = get_writing_topic(&conn, &id).unwrap().unwrap();
    assert_eq!(saved.task_type, WritingTaskType::Task2);
    assert!(saved.title_json.contains("My edited prompt."));
}
