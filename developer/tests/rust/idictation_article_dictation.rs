use super::*;

fn payload() -> Value {
    json!({"idictation":{"kind":"article","sentenceMode":"short","sentences":[
        {"id":17,"content":"Hello there.","cloze_details":{"schema_version":1}}
    ]}})
}

#[test]
fn check_uses_the_selected_chapters_source_text_and_never_a_frontend_reference() {
    let payload = payload();
    let row = sentence(&payload, "idictation-article-short-17").unwrap();
    let (operation, input) = request(row, Action::Check { answer: "Hello, there".into() }).unwrap();
    assert_eq!(operation, "articleSentenceScore");
    assert_eq!(input, json!({"reference":"Hello there.","answer":"Hello, there"}));
    assert!(sentence(&payload, "idictation-article-long-17").is_err());
    assert!(sentence(&payload, "idictation-article-short-99").is_err());
    assert!(serde_json::from_value::<Action>(json!({
        "kind":"check","answer":"cheat","reference":"cheat"
    })).is_err());
}

#[test]
fn prepare_accepts_only_source_categories_and_blocks_collection_scope() {
    let mut payload = payload();
    let row = sentence(&payload, "idictation-article-short-17").unwrap();
    assert_eq!(request(row, Action::Prepare { categories: vec!["answer_expression".into()] }).unwrap().0, "articleCloze");
    assert!(request(row, Action::Prepare { categories: vec!["unsupported".into()] }).is_err());
    assert!(request(row, Action::Check { answer: " ".into() }).is_err());
    payload["idictation"]["kind"] = json!("article-collection");
    assert!(sentence(&payload, "idictation-article-short-17").is_err());
}

#[test]
fn restore_uses_source_round_and_resume_sentence_and_pending_keeps_no_answer_text() {
    let value = snapshot(&json!({"last_key":"42","resume_article_id":17,"data":[
        {"id":16,"dictation":{"answer":"Previous answer","accuracy":"0.75"}},
        {"id":17}
    ]}), "short");
    assert_eq!(value["round"], "42");
    assert_eq!(value["resumeId"], "idictation-article-short-17");
    assert_eq!(value["states"]["idictation-article-short-16"]["accuracy"], 0.75);
    assert!(value["states"]["idictation-article-short-17"].is_null());
    let pending = receipt(&json!("42"), "Previous answer");
    assert!(!pending.to_string().contains("Previous answer"));
    assert_eq!(pending, receipt(&json!(42), "Previous answer"));
    assert_ne!(pending, receipt(&json!(42), "Different answer"));
}
