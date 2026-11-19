use super::*;

#[test]
fn native_reading_preserves_controls_and_official_review() {
    let unit: Value = serde_json::from_str(crate::jiufen::EXAM).unwrap();
    let mut payload = exam(&unit["data"]).unwrap();
    payload["examId"] = json!("jiufen-native-fixture");
    assert_eq!(payload["questionOrder"].as_array().unwrap().len(), 13);
    assert_eq!(payload["answerKey"], json!({}));
    assert!(
        string(&payload["questionGroups"][0], "bodyHtml").contains("type=\"radio\" name=\"q1\"")
    );
    assert!(string(&payload["questionGroups"][1], "bodyHtml").contains("name=\"q13\""));
    let questions =
        serde_json::from_value::<Vec<SourceQuestion>>(payload["jiufen"]["questions"].clone())
            .unwrap();
    let mut response: Value = serde_json::from_str(crate::jiufen::REVIEW).unwrap();
    let mut answers = Map::new();
    for row in response["data"]["details"].as_array_mut().unwrap() {
        let number = row["qNumber"].as_str().unwrap();
        let key = format!("q{number}");
        match number {
            "1" => {
                row["userAnswer"] = json!("A");
                row["score"] = json!(0);
                row["analysisText"] = json!("<p>Test explanation</p>");
            }
            "13" => {
                row["userAnswer"] = Value::Null;
                row["score"] = json!(0);
            }
            _ => {}
        }
        answers.insert(key, row["userAnswer"].clone());
    }
    response["data"]["attempt"]["correctCount"] = json!(11);
    response["data"]["attempt"]["elapsedSeconds"] = Value::Null;
    let cmd = Submit {
        asset_id: "jiufen-native-fixture".into(),
        attempt_id: "local-attempt".into(),
        channel: "reading".into(),
        answers,
        marked_questions: vec![],
        duration_ms: Some(1234),
        question_timeline: vec![],
    };
    let body = submission("unit-01", &questions, &cmd).unwrap();
    assert_eq!(
        body["parts"][0]["groups"][0]["questions"][0]["userAnswer"],
        "A"
    );
    assert_eq!(
        body["parts"][0]["groups"][1]["questions"][7]["userAnswer"],
        ""
    );
    let mut pending = Pending {
        asset_id: cmd.asset_id.clone(),
        body,
        receipt: Some("attempt-01".into()),
    };
    let asset = serde_json::from_value(
        json!({"schemaVersion":2,"id":cmd.asset_id,"activity":"reading","sourceKind":"imported",
        "title":"Fixture","fingerprint":"fixture","pdfOnly":false}),
    )
    .unwrap();
    let loaded = PracticeAssetV2Payload { asset, payload };
    let (attempt, review, result) = official_result(
        &loaded,
        &cmd,
        &questions,
        &pending,
        "account-01",
        &response["data"],
        &HashMap::from([(
            "q1".into(),
            json!({"question":{"analysisList":[{"content":"Test explanation"}]}}),
        )]),
    )
    .unwrap();
    assert_eq!(attempt.correct_count, Some(11.0));
    assert_eq!(attempt.duration_ms, 1234);
    assert_eq!(result["comparisons"][0]["isCorrect"], false);
    assert!(!attempt.answers[12].is_answered());
    assert_eq!(review["answerKey"]["q1"], "B");
    assert_eq!(
        review["reviewExplanations"]["questionExplanations"][0]["items"][0]["text"],
        "Test explanation"
    );
    pending.receipt = Some("wrong-attempt".into());
    assert!(official_result(
        &loaded,
        &cmd,
        &questions,
        &pending,
        "account-01",
        &response["data"],
        &HashMap::new()
    )
    .is_err());
}

#[test]
fn native_listening_uses_real_part_and_display_number_and_sanitizes_html() {
    let unit = json!({"id":"unit-01","channel":"listening","title":"Listening fixture","parts":[
        {"id":"part-01","partNum":"Part 4","groups":[{"id":"group-01","type":"fill-in-the-blank",
            "description":"<p onclick='unsafe()'>Write one word</p><script>unsafe()</script>",
            "contentHtml":"<p>Question <input placeholder='31' value='hidden-answer'></p>",
            "questions":[{"id":"item-01","qNumber":"31","rightAnswer":"hidden-answer"}]}]}]});
    let payload = exam(&unit).unwrap();
    assert_eq!(payload["schemaVersion"], 1);
    assert_eq!(payload["questionGroups"][0]["section"], 4);
    assert_eq!(payload["questionDisplayMap"]["q1"], "31");
    assert!(string(&payload["questionGroups"][0], "bodyHtml").contains("name=\"q1\""));
    let serialized = payload.to_string();
    assert!(!serialized.contains("unsafe"));
    assert!(!serialized.contains("hidden-answer"));
}

#[test]
fn native_material_keeps_sentence_identity_translation_timing_and_location() {
    let unit = json!({"parts":[{"id":"p1","partNum":"Part 4","articleJson":{"segments":[{
        "speaker":{"name":"Speaker"},"sentences":[
            {"sentence_index":0,"text":"First sentence.","start_time":3.4,"end_time":5.2},
            {"sentence_index":1,"text":"Second sentence.","start_time":0,"end_time":0}],
        "words":[{"sentence_index":0,"text":"First","start_time":3.4,"end_time":3.8}]}]}}]});
    let mut material = crate::jiufen::material::from_unit(&unit);
    crate::jiufen::material::translations(
        &mut material,
        "p1",
        &json!({"translations":[
        {"sentenceIndex":0,"zhText":"第一句。"},{"sentenceIndex":1,"zhText":"第二句。"}]}),
    );
    let sentences = &material["parts"][0]["paragraphs"][0]["sentences"];
    assert_eq!(sentences[0]["startSeconds"], 3.4);
    assert_eq!(sentences[0]["translation"], "第一句。");
    assert_eq!(sentences[0]["words"][0]["endSeconds"], 3.8);
    assert!(sentences[1]["startSeconds"].is_null());
    let question = crate::jiufen::material::question(
        &material,
        "p1",
        &json!({"sentenceIndex":"0-1","analysisList":[{"labelsOne":"定位","content":"<b>第一句</b>"}]}),
    );
    assert_eq!(question["sentenceIds"], json!(["p1-s0", "p1-s1"]));
    assert_eq!(question["analyses"][0]["text"], "第一句");
    crate::jiufen::material::translations(
        &mut material,
        "p1",
        &json!({"translations":[
        {"sentenceIndex":0,"sourceTextHash":"stale","zhText":"错误版本译文"}]}),
    );
    assert_eq!(
        material["parts"][0]["paragraphs"][0]["sentences"][0]["translation"],
        "第一句。"
    );
    assert_eq!(material["parts"][0]["translationStatus"], "stale");
}

#[test]
fn native_preserves_supported_question_subtypes() {
    for (channel, base, subtype, expected) in [
        (
            "reading",
            "matching",
            "reading_heading",
            "matching_headings",
        ),
        (
            "reading",
            "matching",
            "reading_person_match",
            "matching_features",
        ),
        (
            "reading",
            "fill-in-the-blank",
            "flowchart_fill",
            "flow_chart_completion",
        ),
        (
            "listening",
            "fill-in-the-blank",
            "diagram_fill",
            "diagram_completion",
        ),
    ] {
        let unit = json!({"id":"u1","title":"Fixture","channel":channel,"parts":[{"id":"p1","article":"<p>Passage</p>","groups":[
            {"id":"g1","type":base,"questionSubtype":subtype,"questions":[{"id":"q1","qNumber":"1"}]}]}]});
        let payload = exam(&unit).unwrap();
        assert_eq!(payload["questionGroups"][0]["kind"], expected);
        assert_eq!(payload["questionGroups"][0]["sourceSubtype"], subtype);
    }
}
