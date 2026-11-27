use super::*;

fn suite() -> Value {
    serde_json::from_str::<Value>(include_str!("../fixtures/idictation/observed-exams.json"))
        .unwrap()["listening"]
        .clone()
}

#[test]
fn authenticated_fixture_previews_forty_questions_without_answers_or_part_audio_fallback() {
    let mut source = suite();
    source["parts"][0]["file_url"] = json!("https://audio-1-cdn.idictation.cn/part.mp3");
    let (id, payload) = convert("owner", "2101", &source).unwrap();
    assert!(id.starts_with(PREVIEW_PREFIX));
    assert_eq!(payload["examId"], id);
    assert_eq!(payload["questionOrder"].as_array().unwrap().len(), 40);
    assert_eq!(payload["capabilities"]["remoteSubmit"], false);
    assert_eq!(payload["answerKey"], json!({}));
    assert!(payload.get("idictation").is_none());
    assert_eq!(payload["studyMaterial"]["media"], json!([]));
    assert_ne!(convert("other", "2101", &source).unwrap().0, id);
    assert!(convert("owner", "2102", &source).is_err());
}

#[test]
fn uses_first_whole_track_and_rejects_unknown_origin() {
    let mut source = suite();
    source["parts"][1]["full_audio"] = json!("https://audio-1-cdn.idictation.cn/full.mp3");
    source["parts"][2]["full_audio"] = json!("https://audio-1-cdn.idictation.cn/other.mp3");
    let (_, payload) = convert("owner", "2101", &source).unwrap();
    assert_eq!(
        payload["studyMaterial"]["media"],
        json!([{
            "id":TRACK_ID, "url":"https://audio-1-cdn.idictation.cn/full.mp3", "startSeconds":0, "endSeconds":null
        }])
    );
    source["parts"][1]["full_audio"] =
        json!("https://audio-1-cdn.idictation.cn.example.test/full.mp3");
    assert!(convert("owner", "2101", &source).is_err());
}

#[test]
fn jijing_full_preview_binds_all_papers_and_keeps_audio_by_part() {
    let mut source = suite();
    let papers = source["parts"].as_array().unwrap().iter()
        .map(|part| json!({"paper_id":part["paper_id"]})).collect::<Vec<_>>();
    let directory = jijing_catalog(&json!([
        {"id":2101,"title":"机经样例","parts":papers},
        {"id":99,"title":"机经单篇","parts":[{"paper_id":17,"title":"Part 3"}]}
    ])).unwrap();
    assert_eq!(directory.suites.len(), 1);
    assert_eq!(directory.parts.len(), 5);
    assert_eq!(directory.cards.len(), 6);
    source["test_id"] = Value::Null;
    source["parts"][2]["file_url"] = json!("https://audio-1-cdn.idictation.cn/part.mp3");
    let (asset_id, payload) = convert_jijing("owner", "2101", &directory.suites["2101"], source.clone()).unwrap();
    assert_ne!(convert("owner", "2101", &suite()).unwrap().0, asset_id);
    assert_eq!(payload["questionCount"], 40);
    assert_eq!(payload["studyMaterial"]["media"][0]["id"], "jijing-part-3");
    assert_eq!(payload["studyMaterial"]["media"][0]["section"], 3);
    source["parts"][2]["paper_id"] = json!(999);
    assert!(convert_jijing("owner", "2101", &directory.suites["2101"], source).is_err());
}

#[test]
fn jijing_single_part_preserves_question_labels_and_never_accepts_the_wrong_part() {
    let mut part = suite()["parts"][2].clone();
    let paper = exam::number(&part, "paper_id").unwrap();
    part["title"] = json!("Part 3");
    part["file_url"] = json!("https://audio-1-cdn.idictation.cn/part.mp3");
    let grant = JijingPartGrant { title: "机经样例 Part 3".into(), section: Some(3) };
    let (_, payload) = convert_jijing_part("owner", "2101", paper, &grant, part.clone()).unwrap();
    assert_eq!(payload["questionCount"], 10);
    assert_eq!(payload["questionDisplayMap"]["q1"], "21");
    assert_eq!(payload["questionGroups"][0]["section"], 3);
    assert_eq!(payload["studyMaterial"]["media"][0]["section"], 3);
    assert!(convert_jijing_part("owner", "2101", paper + 1, &grant, part.clone()).is_err());
    part["title"] = json!("Part 2");
    assert!(convert_jijing_part("owner", "2101", paper, &grant, part).is_err());
}
