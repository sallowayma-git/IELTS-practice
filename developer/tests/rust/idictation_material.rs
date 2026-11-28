use super::*;

fn observed() -> Value {
    serde_json::from_str(include_str!(
        "../fixtures/idictation/observed-materials.json"
    ))
    .unwrap()
}

fn article_response() -> Value {
    // Synthetic complete page using the two actual, unmodified sentence rows.
    // This is not a claim that the sampled 2 rows are the full remote chapter.
    let mut value = observed()["article"].clone();
    value["total"] = json!(2);
    value["sentence_mode"] = json!("short");
    value
}

fn reader_response() -> Value {
    // Synthetic 3-block document using the observed block/offset fixtures.
    let mut value = observed()["reader"].clone();
    value["version"]["sentence_count"] = json!(5);
    value["media"] = json!([]);
    value
}

#[test]
fn article_collection_has_its_own_row_identity_and_no_exam_or_owner_data() {
    let raw = json!({"current_page":2,"per_page":50,"last_page":2,"total":52,"data":[
        {"id":7,"user_id":"123456","notes":"private note","article_content":{
            "id":17,"content":"Example sentence","translate":"示例句","start_time":"1000","end_time":"2000",
            "phonetic":"https://audio-1-cdn.idictation.cn/sample.mp3"
        }},
        {"id":8,"user_id":"123456","article_content":null}
    ]});
    let result = article_collection("123456", 2, &raw).unwrap();
    let p = &result.payload;
    assert_eq!(p["collectionPage"], json!({"page":2,"pages":2,"total":52,"unavailable":1}));
    assert_eq!(p["questionCount"], 0);
    assert_eq!(p["capabilities"]["remoteSubmit"], false);
    assert_eq!(p["studyMaterial"]["parts"][0]["paragraphs"][0]["sentences"][0]["id"], "idictation-collection-7");
    assert_eq!(p["studyMaterial"]["media"][0]["startSeconds"], 1.0);
    assert_eq!(p["studyMaterial"]["media"][0]["endSeconds"], 2.0);
    assert!(!p.to_string().contains("123456"));
    assert!(!p.to_string().contains("private note"));
    assert!(article_collection("123",2,&raw).is_err());
    assert!(article_collection("123456",1,&raw).is_err());
}

#[test]
fn empty_article_collection_remains_a_valid_read_only_page() {
    let empty = json!({"current_page":1,"per_page":50,"last_page":1,"total":0,"data":[]});
    let result = article_collection("7", 1, &empty).unwrap();
    assert_eq!(result.payload["collectionPage"]["total"],0);
    assert_eq!(result.payload["studyMaterial"]["media"],json!([]));
    assert!(article_collection("7",0,&empty).is_err());
}

#[test]
fn article_preserves_shared_content_identity_and_has_no_exam_score() {
    let result = article("1197472", "short", "Observed sample", &article_response()).unwrap();
    let payload = result.payload;
    assert_eq!(payload["practiceKind"], "material");
    assert_eq!(payload["questionCount"], 0);
    assert_eq!(payload["capabilities"]["localScoring"], false);
    assert_eq!(payload["idictation"]["chapterId"], "1197472");
    assert_eq!(payload["idictation"]["canonicalChapterId"], "1197472");
    assert_eq!(payload["idictation"]["sentences"][0]["c_id"], 1949109);
    let first = &payload["studyMaterial"]["parts"][0]["paragraphs"][0]["sentences"][0];
    assert_eq!(first["id"], "idictation-article-short-902864");
    assert_eq!(first["text"], "Hello, Oyster Bay Sailing Club.");
    assert!((first["startSeconds"].as_f64().unwrap() - 117.526).abs() < 1e-9);
    assert_eq!(first["words"][0]["text"], "Hello");
    assert_eq!(first["words"][0]["startSeconds"], 0.03);
    assert!(first["grammarAnalysis"].is_object());
}

#[test]
fn rejects_partial_or_duplicate_article_and_mode_mismatch() {
    let mut partial = observed()["article"].clone();
    partial["sentence_mode"] = json!("short");
    assert!(article("1197472", "short", "sample", &partial)
        .unwrap_err()
        .contains("完整"));
    let mut duplicate = article_response();
    duplicate["data"][1]["id"] = duplicate["data"][0]["id"].clone();
    assert!(article("1197472", "short", "sample", &duplicate).is_err());
    assert!(article("1197472", "long", "sample", &article_response()).is_err());
}

#[test]
fn original_playback_and_alignment_have_distinct_time_rules() {
    let row = json!({"start_time":"10","end_time":"12","end_time_new":90000,
        "subtitle_alignment_details":{"words":[{"text":"word","start":10.5,"end":11.0}]}});
    assert_eq!(timing::playback(&row).unwrap(), (0.01, 0.012));
    assert_eq!(timing::alignment_sentence(&row).unwrap(), (10.0, 12.0));
    assert_eq!(
        timing::words(&row, 10.0, 12.0)[0],
        json!({"text":"word","startSeconds":0.5,"endSeconds":1.0})
    );
    let relative = json!({"subtitle_alignment_details":"{\"details\":[{\"word\":\"relative\",\"startTime\":0.1,\"endTime\":0.4}]}"});
    assert_eq!(
        timing::words(&relative, 117.526, 119.753)[0]["endSeconds"],
        0.4
    );
    // Do not divide/multiply the raw endpoints before the <=120 boundary.
    assert_eq!(
        timing::alignment_sentence(&json!({"start_time":1001,"end_time":1121})).unwrap(),
        (1001.0, 1121.0)
    );
}

#[test]
fn media_selection_rejects_unknown_hosts_and_does_not_shorten_clips() {
    let mut row = article_response()["data"][0].clone();
    row["split_audio_url_new"] = json!("https://itx-jingting.oss-cn-beijing.aliyuncs.com/clip.mp3");
    let clip = article_audio(&row, "sentence").unwrap();
    assert_eq!(clip["kind"], "clip");
    assert_eq!(clip["startSeconds"], 0.0);
    assert!(clip["endSeconds"].is_null()); // Source plays the complete slice.
    row["split_audio_url_new"] = json!("https://untrusted.invalid/clip.mp3");
    row["phonetic"] = json!("https://itx-jingting.oss-cn-beijing.aliyuncs.com/track.mp3");
    assert!(article_audio(&row, "sentence").is_none());
    assert!(media_url("https://user@itx-jingting.oss-cn-beijing.aliyuncs.com/a.mp3").is_none());
    assert!(media_url("http://itx-jingting.oss-cn-beijing.aliyuncs.com/a.mp3").is_none());
}

#[test]
fn reader_extracts_source_sentences_without_losing_heading_or_whitespace() {
    let source = reader_response();
    let result = reader("2", &source).unwrap();
    let payload = result.payload;
    let paragraphs = &payload["studyMaterial"]["parts"][0]["paragraphs"];
    assert_eq!(paragraphs[0]["sentences"], json!([]));
    assert_eq!(paragraphs[1]["sentences"].as_array().unwrap().len(), 3);
    assert!(payload["passage"]["blocks"][0]["html"]
        .as_str()
        .unwrap()
        .starts_with("<h2"));
    let first = &source["blocks"][1]["sentences"][0];
    let raw = source["blocks"][1]["text"].as_str().unwrap();
    let end = utf16_bytes(raw, first["end_offset"].as_u64().unwrap()).unwrap();
    assert_eq!(paragraphs[1]["sentences"][0]["text"], &raw[..end]);
    assert!(payload["studyMaterial"]["media"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(payload["idictation"].get("annotations").is_none());
}

#[test]
fn reader_uses_utf16_and_escapes_source_markup() {
    let mut response = reader_response();
    let block = &mut response["blocks"][1];
    block["text"] = json!(" A😀<b>  ");
    block["sentences"] = json!([{"id":42,"document_version_id":block["document_version_id"],
        "block_id":block["id"],"start_offset":2,"end_offset":7,"translation":"test"}]);
    let document = "2";
    let version = id(&response["version"]["id"]).unwrap();
    let (rendered, paragraph, _) =
        reader_block(&response["blocks"][1], document, &version).unwrap();
    assert_eq!(paragraph["sentences"][0]["text"], "😀<b>");
    let html = rendered["html"].as_str().unwrap();
    assert!(html.contains("😀&lt;b&gt;"));
    assert!(html.ends_with("</span>  </p>"));
    assert!(utf16_bytes("😀", 1).is_err());
    assert_eq!(utf16_bytes("😀", 2).unwrap(), 4);
}

#[test]
fn reader_rejects_mixed_versions_partial_text_and_duplicate_identity() {
    let mut value = reader_response();
    value["blocks"][1]["sentences"][0]["document_version_id"] = json!(999999);
    assert!(reader("2", &value).is_err());
    let mut partial = observed()["reader"].clone();
    partial["media"] = json!([]);
    assert!(reader("2", &partial).unwrap_err().contains("完整"));
    let mut duplicate = reader_response();
    duplicate["blocks"][1]["block_key"] = duplicate["blocks"][0]["block_key"].clone();
    assert!(reader("2", &duplicate).is_err());
    assert!(reader("3", &reader_response()).is_err());
    let mut image = reader_response();
    image["blocks"][0]["type"] = json!("image");
    image["blocks"][0]["payload"] = json!({"url":"https://media.invalid/image.png"});
    assert!(reader("2", &image).unwrap_err().contains("尚未适配"));
}

#[test]
fn fingerprints_ignore_user_state_and_signed_media_but_track_content() {
    let original = article_response();
    let first = article("1197472", "short", "sample", &original).unwrap();
    let mut changed = original.clone();
    changed["last_key"] = json!("not-material-identity");
    changed["data"][0]["error_article"] = json!("private input");
    changed["data"][0]["split_audio_url_new"] =
        json!("https://itx-jingting.oss-cn-beijing.aliyuncs.com/clip.mp3?expires=1");
    assert_eq!(
        first.fingerprint,
        article("1197472", "short", "sample", &changed)
            .unwrap()
            .fingerprint
    );
    changed["data"][0]["content"] = json!("Edited source");
    assert_ne!(
        first.fingerprint,
        article("1197472", "short", "sample", &changed)
            .unwrap()
            .fingerprint
    );
    let mut reader_changed = reader_response();
    let before = reader("2", &reader_changed).unwrap();
    reader_changed["annotations"] = json!([{"note":"private"}]);
    reader_changed["progress"] = json!({"text_offset":4});
    reader_changed["blocks"][0]["sort"] = json!(9999);
    let after = reader("2", &reader_changed).unwrap();
    assert_eq!(
        before.payload["passage"]["blocks"],
        after.payload["passage"]["blocks"]
    );
}

#[test]
#[ignore = "requires the optional local, sanitized live capture"]
fn full_observed_materials_convert_without_losing_sentences() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../developer/tests/e2e/reports/idictation-research/material-conversion-input.json");
    let captured: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let article = article(
        "1197472",
        "short",
        "Observed full chapter",
        &captured["article"],
    )
    .unwrap();
    let reader = reader("2", &captured["reader"]).unwrap();
    assert_eq!(
        article.payload["studyMaterial"]["parts"][0]["paragraphs"][0]["sentences"]
            .as_array()
            .unwrap()
            .len(),
        84
    );
    assert_eq!(
        reader.payload["passage"]["blocks"]
            .as_array()
            .unwrap()
            .len(),
        12
    );
    let paragraphs = reader.payload["studyMaterial"]["parts"][0]["paragraphs"]
        .as_array()
        .unwrap();
    assert_eq!(
        paragraphs
            .iter()
            .map(|p| p["sentences"].as_array().unwrap().len())
            .sum::<usize>(),
        37
    );
    // Optional visual harness uses the actual converter output, never a second
    // handwritten conversion. Generated output stays in ignored QA reports.
    if let Some(path) = std::env::var_os("IDICTATION_READER_PREVIEW_OUTPUT") {
        std::fs::write(path, serde_json::to_vec_pretty(&reader.payload).unwrap()).unwrap();
    }
    if let Some(path) = std::env::var_os("IDICTATION_ARTICLE_PREVIEW_OUTPUT") {
        std::fs::write(path, serde_json::to_vec_pretty(&article.payload).unwrap()).unwrap();
    }
}
