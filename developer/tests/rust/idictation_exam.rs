use super::*;
fn fixture(subject: Subject) -> Value {
    let data: Value =
        serde_json::from_str(include_str!("../fixtures/idictation/observed-exams.json")).unwrap();
    data[if subject == Subject::Reading {
        "reading"
    } else {
        "listening"
    }]
    .clone()
}
#[test]
fn complete_observed_exams_keep_all_questions_and_no_source_ai_or_answers_in_practice_dom() {
    for subject in [Subject::Reading, Subject::Listening] {
        let exam = convert(subject, "2101", &fixture(subject)).unwrap();
        assert_eq!(exam.questions.len(), 40);
        assert_eq!(exam.official_answers.len(), 40);
        assert_eq!(exam.payload["questionCount"], 40);
        assert!(exam.payload["answerKey"].as_object().unwrap().is_empty());
        let text = exam.payload.to_string();
        for forbidden in [
            "ai_analyze",
            "wrong_reasons",
            "reviewExplanations",
            "ai_central_sentences",
            "onerror=",
            "display_answer",
        ] {
            assert!(!text.contains(forbidden), "{forbidden}")
        }
        for q in &exam.questions {
            assert_eq!(
                exam.payload["questionDisplayMap"][&q.key],
                q.number.to_string()
            )
        }
        assert_eq!(
            exam.payload["passage"]["blocks"].as_array().unwrap().len(),
            if subject == Subject::Reading { 3 } else { 0 }
        );
    }
}
#[test]
fn reading_observed_draft_body_and_judgement_mapping_are_exact() {
    let exam = convert(Subject::Reading, "2101", &fixture(Subject::Reading)).unwrap();
    let answers = serde_json::from_value(json!({"q1":"mining","q8":"T","q37":"Y"})).unwrap();
    let body = submission(&exam, &answers, &HashSet::from(["q8".into()]), 1, 58, false).unwrap();
    assert_eq!(body["jianya_test_id"], "2101");
    assert!(body.get("action").is_none());
    assert_eq!(body["answer"].as_array().unwrap().len(), 40);
    assert_eq!(
        body["answer"][0],
        json!({"type":8,"id":40193,"group_id":581,"answer":"mining","mark":false})
    );
    assert_eq!(body["answer"][7]["answer"], "T");
    assert_eq!(body["answer"][7]["mark"], true);
    assert_eq!(body["answer"][36]["answer"], "Y");
    assert!(body["answer"][1]["answer"].is_null());
    assert_eq!(
        submission(&exam, &answers, &HashSet::new(), 1, 58, true).unwrap()["action"],
        "手动提交"
    );
    assert!(submission(
        &exam,
        &serde_json::from_value(json!({"q8":"TRUE"})).unwrap(),
        &HashSet::new(),
        1,
        58,
        false
    )
    .is_err());
}
#[test]
fn grouped_answers_keep_member_identity_and_use_one_sorted_submission() {
    let exam = convert(Subject::Listening, "2101", &fixture(Subject::Listening)).unwrap();
    let answers = serde_json::from_value(json!({"q21":"D","q22":"B"})).unwrap();
    let body = submission(&exam, &answers, &HashSet::new(), 1, 2, false).unwrap();
    assert_eq!(body["answer"].as_array().unwrap().len(), 38);
    assert_eq!(
        body["answer"][20],
        json!({"type":2,"id":0,"group_id":539,"answer":["B","D"],"mark":false})
    );
    assert_eq!(exam.questions[20].source_id, 22167);
    assert_eq!(exam.questions[21].source_id, 22168);
    assert!(submission(
        &exam,
        &serde_json::from_value(json!({"q21":"B","q22":"B"})).unwrap(),
        &HashSet::new(),
        1,
        2,
        false
    )
    .is_err());
}
#[test]
fn unknown_partial_and_ambiguous_content_is_rejected_before_practice() {
    let source = fixture(Subject::Reading);
    assert!(convert(Subject::Reading, "999", &source).is_err());
    let mut changed = source.clone();
    changed["parts"].as_array_mut().unwrap().pop();
    assert!(convert(Subject::Reading, "2101", &changed).is_err());
    let mut changed = source.clone();
    changed["parts"][0]["question"][0]["type"] = json!(99);
    assert!(convert(Subject::Reading, "2101", &changed).is_err());
    let mut changed = source.clone();
    changed["parts"][0]["question"][0]["list"][1]["id"] = json!(40193);
    assert!(convert(Subject::Reading, "2101", &changed).is_err());
    let mut changed = source.clone();
    changed["parts"][1]["content"]["order_ary"] = Value::Null;
    assert!(convert(Subject::Reading, "2101", &changed).is_err());
    let mut changed = source.clone();
    changed["parts"][0]["question"][0]["collect"] = json!("$40193$ and $40193$");
    assert!(convert(Subject::Reading, "2101", &changed)
        .unwrap_err_string()
        .contains("重复"));
    let mut changed = source;
    changed["parts"][0]["question"][0]["collect"] = json!("<img src=x onerror=alert(1)>");
    assert!(convert(Subject::Reading, "2101", &changed).is_err());
}
trait ErrorText {
    fn unwrap_err_string(self) -> String;
}
impl<T> ErrorText for std::result::Result<T, String> {
    fn unwrap_err_string(self) -> String {
        match self {
            Err(e) => e,
            Ok(_) => panic!("expected failure"),
        }
    }
}
#[test]
fn fingerprint_tracks_canonical_content_and_answers_but_ignores_analysis_and_user_state() {
    let mut source = fixture(Subject::Reading);
    let fingerprint = convert(Subject::Reading, "2101", &source)
        .unwrap()
        .fingerprint;
    source["practice_result"] = json!({"id":999,"highlights":[],"notes":[]});
    source["parts"][0]["question"][0]["list"][0]["ai_analyze"] = json!("untrusted analysis");
    assert_eq!(
        fingerprint,
        convert(Subject::Reading, "2101", &source)
            .unwrap()
            .fingerprint
    );
    source["parts"][0]["question"][0]["list"][0]["display_answer"] = json!("changed");
    assert_ne!(
        fingerprint,
        convert(Subject::Reading, "2101", &source)
            .unwrap()
            .fingerprint
    );
}

#[test]
fn source_result_receipt_matches_observed_manual_request_and_never_invents_a_band_score() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../fixtures/idictation/observed-reading-result.json"
    ))
    .unwrap();
    let exam = convert(Subject::Reading, "2101", &fixture_subject()).unwrap();
    let input = serde_json::from_value(json!({"q1":"mining","q8":"T"})).unwrap();
    let built = submission(&exam, &input, &HashSet::new(), 9, 329, true).unwrap();
    let by_id = |v: &Value| {
        let mut rows = v["answer"].as_array().unwrap().clone();
        rows.sort_by_key(|r| r["id"].as_u64());
        rows
    };
    assert_eq!(by_id(&built), by_id(&fixture["request"]));
    let verified =
        result::verify_reading(&exam, "7", "test-asset", &built, &fixture["result"]).unwrap();
    assert_eq!(verified.attempt.answers.len(), 40);
    assert_eq!(verified.attempt.correct_count, Some(2.0));
    assert_eq!(verified.attempt.score_value, Some(0.05));
    assert_eq!(verified.official_answers.len(), 40);
    assert_eq!(
        verified.attempt.score_scale,
        Some(ielts_domain::ScoreScale::Ratio)
    );
    assert_eq!(verified.attempt.mode, ielts_domain::AttemptMode::Single);
    assert!(verified.attempt.suite_id.is_none());
    assert!(!verified.evidence_limitations.is_empty());
    let mut rounded = fixture["result"].clone();
    rounded["zhengquelv"] = json!(4.99);
    let verified = result::verify_reading(&exam, "7", "test-asset", &built, &rounded).unwrap();
    assert_eq!(verified.attempt.score_value, Some(0.05));
    assert!(
        result::verify_reading(&exam, "another-owner", "asset", &built, &fixture["result"])
            .is_err()
    );
    for (field, value) in [
        ("key", json!("10")),
        ("duration", json!(1)),
        ("zhengquegeshu", json!(3)),
        ("jianya_part_id", json!(1)),
    ] {
        let mut changed = fixture["result"].clone();
        changed[field] = value;
        assert!(
            result::verify_reading(&exam, "7", "asset", &built, &changed).is_err(),
            "{field}"
        );
    }
    let mut changed = fixture["result"].clone();
    let mut blanks: Value =
        serde_json::from_str(changed["result_blanks"].as_str().unwrap()).unwrap();
    blanks[0]["blank_id"] = json!(99999);
    changed["result_blanks"] = json!(blanks.to_string());
    assert!(result::verify_reading(&exam, "7", "asset", &built, &changed).is_err());
    let mut changed = fixture["result"].clone();
    changed["answer"][1]
        .as_object_mut()
        .unwrap()
        .remove("answer");
    assert!(result::verify_reading(&exam, "7", "asset", &built, &changed).is_err());
    let mut changed = fixture["result"].clone();
    let mut blanks: Value =
        serde_json::from_str(changed["result_blanks"].as_str().unwrap()).unwrap();
    blanks[1].as_object_mut().unwrap().remove("answer");
    changed["result_blanks"] = json!(blanks.to_string());
    assert!(result::verify_reading(&exam, "7", "asset", &built, &changed).is_err());
    let mut changed = fixture["result"].clone();
    changed["created_at"] = json!("invalid");
    assert!(result::verify_reading(&exam, "7", "asset", &built, &changed).is_err());
}
fn fixture_subject() -> Value {
    fixture(Subject::Reading)
}

#[test]
fn option_labels_and_images_are_not_silently_dropped() {
    let exam = convert(Subject::Listening, "2101", &fixture(Subject::Listening)).unwrap();
    assert!(exam.payload["questionGroups"][1]["bodyHtml"]
        .as_str()
        .unwrap()
        .contains("A. travel expenses"));
    assert!(exam.payload["questionGroups"][3]["bodyHtml"]
        .as_str()
        .unwrap()
        .contains("data-max-selections=\"2\""));
    for (at, key, value) in [
        (0, "paragraph_img", json!("[{\"img_url\":\"example\"}]")),
        (1, "paragraph_img", json!([{"img_url":"example"}])),
    ] {
        let mut source = fixture(Subject::Reading);
        source["parts"][at][key] = value;
        assert!(convert(Subject::Reading, "2101", &source).is_err());
    }
    let mut source = fixture(Subject::Reading);
    source["parts"][0]["content"]["paragraph_img"] = json!("[{\"img_url\":\"example\"}]");
    assert!(convert(Subject::Reading, "2101", &source).is_err());
    let mut source = fixture(Subject::Listening);
    source["parts"][1]["question"][1]["question_title"] = json!("Required task heading");
    let converted = convert(Subject::Listening, "2101", &source).unwrap();
    assert!(converted
        .payload
        .to_string()
        .contains("Required task heading"));
    assert_ne!(converted.fingerprint, exam.fingerprint);
}

#[test]
fn resumed_annotations_remain_private_and_are_preserved_in_submission() {
    let mut source = fixture(Subject::Reading);
    let notes = json!([{"note":"existing private note","scope_key":"article"}]);
    source["practice_result"] = json!({"highlights":[],"notes":notes});
    let exam = convert(Subject::Reading, "2101", &source).unwrap();
    assert!(!exam.payload.to_string().contains("private note"));
    let body = submission(
        &exam,
        &serde_json::from_value(json!({"q1":" mining  ore．\u{feff}"})).unwrap(),
        &HashSet::new(),
        1,
        2,
        false,
    )
    .unwrap();
    assert_eq!(body["notes"], notes);
    assert_eq!(body["answer"][0]["answer"], "mining ore.");
    source["practice_result"]["notes"] = json!("unverified string");
    assert!(convert(Subject::Reading, "2101", &source).is_err());
}
