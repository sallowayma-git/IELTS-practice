//! Explicit GET audit using Atlas's own session. Exports shapes and selected non-personal facts.
use super::*;

#[tokio::test]
#[ignore = "Explicit authenticated GET validation of native study material"]
async fn live_study_material_contract() {
    assert_eq!(
        std::env::var("ATLAS_JIUFEN_READONLY_AUDIT").as_deref(),
        Ok("1")
    );
    let conn = rusqlite::Connection::open_with_flags(
        crate::app::state::AppPaths::discover().v2_db_path(),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let install = settings::get_setting(&conn, NS, "installId")
        .unwrap()
        .unwrap();
    let session = restore_saved(identifier(&install.value).unwrap())
        .unwrap()
        .unwrap();
    let mut rows = Vec::new();
    for (channel, unit_id) in [
        ("reading", "2017137445860642818"),
        ("listening", "2021830170447020033"),
    ] {
        let unit = request(
            &format!("/practice/v1/units/{unit_id}/exam"),
            None,
            Some(&session),
            None,
        )
        .await
        .unwrap();
        let payload = crate::jiufen::native::exam(&unit["data"]).unwrap();
        let mut material = payload["studyMaterial"].clone();
        let part = &unit["data"]["parts"][0];
        let part_id = identifier(&part["id"]).unwrap();
        let translations = request(
            &format!("/practice/v1/parts/{part_id}/sentence-translations?locale=zh-CN"),
            None,
            Some(&session),
            None,
        )
        .await
        .unwrap();
        crate::jiufen::material::translations(&mut material, &part_id, &translations["data"]);
        let group = &part["groups"][0];
        let question_id = identifier(&group["questions"][0]["id"]).unwrap();
        let group_id = identifier(&group["id"]).unwrap();
        let analysis = request(&format!("/practice/v1/question-analysis?questionId={question_id}&partId={part_id}&groupId={group_id}"), None, Some(&session), None).await.unwrap();
        let question =
            crate::jiufen::material::question(&material, &part_id, &analysis["data"]["question"]);
        let sentences: Vec<_> = material["parts"][0]["paragraphs"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|p| p["sentences"].as_array().unwrap())
            .collect();
        let hashes_match = sentences
            .iter()
            .filter(|s| {
                use sha2::Digest;
                let hash =
                    hex::encode(sha2::Sha256::digest(s["text"].as_str().unwrap().as_bytes()));
                s["sourceTextHash"] == hash
            })
            .count();
        assert!(sentences
            .iter()
            .all(|s| s["translation"].as_str().is_some_and(|s| !s.is_empty())));
        assert!(!question["sentenceIds"].as_array().unwrap().is_empty());
        if channel == "listening" {
            assert!(sentences
                .iter()
                .all(|s| s["startSeconds"].is_number() && s["endSeconds"].is_number()));
        }
        rows.push(json!({"channel":channel,"sentences":sentences.len(),"translated":sentences.iter().filter(|s| s["translation"].is_string()).count(),
            "sourceTextHashMatches":hashes_match,"locatedSentences":question["sentenceIds"].as_array().unwrap().len(),"analysisLevels":question["analyses"].as_array().unwrap().len()}));
    }
    let report = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../developer/tests/e2e/reports/jiufen-material-contract.json");
    std::fs::write(report, serde_json::to_vec_pretty(&rows).unwrap()).unwrap();
    println!("{}", json!(rows));
}

fn shape(value: &Value, depth: usize) -> Value {
    match value {
        Value::Null => json!("null"),
        Value::Bool(_) => json!("boolean"),
        Value::Number(_) => json!("number"),
        Value::String(s) => json!({"type":"string","chars":s.chars().count()}),
        Value::Array(rows) => json!({"type":"array","count":rows.len(),
            "first": rows.first().map(|row| shape(row, depth.saturating_sub(1)))}),
        Value::Object(fields) if fields.len() > 64 => json!({"type":"map","count":fields.len(),
            "valueShape": fields.values().next().map(|value| shape(value, depth.saturating_sub(1)))}),
        Value::Object(fields) if depth > 0 => Value::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), shape(value, depth - 1)))
                .collect(),
        ),
        Value::Object(fields) => {
            json!({"type":"object","fields":fields.keys().collect::<Vec<_>>()})
        }
    }
}

async fn get(
    client: &Client,
    session: &Session,
    path: &str,
    label: &str,
    report: &mut Vec<Value>,
) -> Value {
    let response = client
        .get(format!("{BASE}{path}"))
        .header("token", session.token.clone())
        .send()
        .await;
    let Ok(response) = response else {
        report.push(json!({"label":label,"status":"transport_error"}));
        return Value::Null;
    };
    let status = response.status().as_u16();
    let envelope: Value = response.json().await.unwrap_or(Value::Null);
    report.push(json!({"label":label,"method":"GET","httpStatus":status,
        "businessCode":envelope["code"],"data":shape(&envelope["data"], 7)}));
    if status == 200 && identifier(&envelope["code"]).as_deref() == Some("200") {
        envelope["data"].clone()
    } else {
        Value::Null
    }
}

#[tokio::test]
#[ignore = "Explicit authenticated GET audit against the user's Jiufen account"]
async fn live_readonly_api_inventory() {
    assert_eq!(
        std::env::var("ATLAS_JIUFEN_READONLY_AUDIT").as_deref(),
        Ok("1")
    );
    let db_path = crate::app::state::AppPaths::discover().v2_db_path();
    let conn =
        rusqlite::Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .unwrap();
    let install = settings::get_setting(&conn, NS, "installId")
        .unwrap()
        .unwrap();
    let session = restore_saved(identifier(&install.value).unwrap())
        .unwrap()
        .expect("Sign in through Atlas first");
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .timeout(Duration::from_secs(25))
        .build()
        .unwrap();
    let mut report = Vec::new();
    let mut findings = json!({});
    let endpoints = [
        ("features", "/practice/v1/me/feature-entitlements"),
        ("statistics", "/practice/v1/me/practice-stats"),
        ("calendar", "/practice/v1/me/practice-history/calendar-window?endMonth=2026-11&monthCount=1&historyMode=regular&includeEntryModes=memory_link,spelling_recall"),
        ("records", "/practice/v1/me/practice-history/records?date=2026-11-18&pageNo=1&pageSize=20&historyMode=regular&includeEntryModes=memory_link,spelling_recall"),
        ("vocabulary_availability", "/practice/v1/listening/vocabulary/availability"),
        ("vocabulary", "/practice/v1/listening/vocabulary?limit=3"),
        ("dictation_groups", "/practice/v1/listening/vocabulary-dictation/groups"),
        ("spelling_catalog", "/practice/v1/spelling-recall/catalog"),
        ("spelling_wrong_words", "/practice/v1/spelling-recall/wrong-words?offset=0&limit=3"),
        ("guidance_audio", "/practice/v1/listening/guidance-audios"),
        ("keyword_manifest", "/practice/v1/part-keyword-search/manifest"),
        ("title_directory", "/practice/v1/unit-title-directory"),
        ("high_frequency_albums", "/practice/v1/high-frequency/albums?includeEntryModes=memory_link,spelling_recall"),
        ("writing_albums", "/practice/v1/units/writing/albums"),
        ("reading_tags", "/practice/v1/question-tags?mode=reading"),
        ("listening_tags", "/practice/v1/question-tags?mode=listening"),
        ("knowledge_albums", "/practice/v1/kepu/albums"),
    ];
    let mut responses = std::collections::HashMap::new();
    for (label, path) in endpoints {
        let data = get(&client, &session, path, label, &mut report).await;
        responses.insert(label, data);
    }
    findings["vocabularyCounts"] = responses["vocabulary"]["counts"].clone();
    findings["spellingUnitTotal"] = responses["spelling_catalog"]["unitTotal"].clone();
    findings["keywordItemCount"] = responses["keyword_manifest"]["itemCount"].clone();
    findings["featureAccess"] = responses["features"]["entitlements"].clone();
    let keyword = get(
        &client,
        &session,
        "/practice/v1/part-keyword-search/package",
        "keyword_package",
        &mut report,
    )
    .await;
    findings["keywordPackageFields"] = shape(&keyword, 3);
    if let Some(word) = responses["vocabulary"]["words"]
        .as_array()
        .and_then(|rows| rows.first())
    {
        if let Some(key) = word["keyDigest"].as_str() {
            let mut url = reqwest::Url::parse(BASE).unwrap();
            url.path_segments_mut().unwrap().extend([
                "practice",
                "v1",
                "listening",
                "vocabulary",
                "entries",
                key,
            ]);
            let path = url.path().strip_prefix("/api").unwrap();
            get(&client, &session, path, "vocabulary_entry", &mut report).await;
        }
    }
    if let Some(albums) = responses["writing_albums"]["list"].as_array() {
        let mut summaries = Vec::new();
        for album in albums.iter().take(2) {
            let id = identifier(&album["id"]).unwrap();
            summaries.push(json!({"title":album["title"],"unitCount":album["unitCount"]}));
            let units = get(
                &client,
                &session,
                &format!("/practice/v1/units/writing/albums/{id}/units"),
                "writing_units",
                &mut report,
            )
            .await;
            if let Some(unit_id) = identifier(&units["list"][0]["id"]) {
                let unit = get(
                    &client,
                    &session,
                    &format!("/practice/v1/units/writing/{unit_id}"),
                    "writing_unit",
                    &mut report,
                )
                .await;
                summaries.last_mut().unwrap()["unitFields"] = shape(&unit, 5);
            }
        }
        findings["writingAlbums"] = json!(summaries);
    }
    if let Some(groups) = responses["spelling_catalog"]["groups"].as_array() {
        let first = groups
            .iter()
            .filter_map(|g| g["items"].as_array())
            .flatten()
            .find(|item| item["available"] == true && item["lockedForOrdinaryUsers"] == false);
        if let Some(unit_id) = first.and_then(|item| identifier(&item["unitId"])) {
            get(
                &client,
                &session,
                &format!("/practice/v1/spelling-recall/units/{unit_id}"),
                "spelling_unit",
                &mut report,
            )
            .await;
            for mode in ["study", "exam"] {
                get(
                    &client,
                    &session,
                    &format!("/practice/v1/spelling-recall/units/{unit_id}/view?mode={mode}"),
                    &format!("spelling_view_{mode}"),
                    &mut report,
                )
                .await;
            }
        }
    }
    for (label, unit_id) in [
        ("reading", "2017137445860642818"),
        ("listening", "2021830170447020033"),
    ] {
        let unit = get(
            &client,
            &session,
            &format!("/practice/v1/units/{unit_id}/exam"),
            &format!("{label}_exam"),
            &mut report,
        )
        .await;
        let part = &unit["parts"][0];
        let article: Value = serde_json::from_str(part["articleJson"].as_str().unwrap_or("{}"))
            .unwrap_or(Value::Null);
        report.push(json!({"label":format!("{label}_article_json"),"data":shape(&article, 9)}));
        if let Some(segments) = article["segments"].as_array() {
            let sentences: Vec<_> = segments
                .iter()
                .filter_map(|s| s["sentences"].as_array())
                .flatten()
                .collect();
            let words: Vec<_> = segments
                .iter()
                .filter_map(|s| s["words"].as_array())
                .flatten()
                .collect();
            findings[format!("{label}Transcript")] = json!({"segments":segments.len(),"sentences":sentences.len(),"words":words.len(),
                "timedSentences":sentences.iter().filter(|s| s["start_time"].is_number() && s["end_time"].is_number()).count(),
                "start":segments.first().map(|s| &s["start_time"]),"end":segments.last().map(|s| &s["end_time"])});
        }
        if let Some(groups) = part["groups"].as_array() {
            findings[format!("{label}QuestionTypes")] = json!(groups
                .iter()
                .map(|g| json!({"type":g["type"],"subtype":g["questionSubtype"]}))
                .collect::<Vec<_>>());
        }
        if let Some(part_id) = identifier(&part["id"]) {
            get(
                &client,
                &session,
                &format!("/practice/v1/parts/{part_id}/sentence-translations?locale=zh-CN"),
                &format!("{label}_translations"),
                &mut report,
            )
            .await;
        }
        let group = &part["groups"][0];
        if let Some(question_id) = identifier(&group["questions"][0]["id"]) {
            if let (Some(part_id), Some(group_id)) =
                (identifier(&part["id"]), identifier(&group["id"]))
            {
                let analysis = get(&client, &session, &format!("/practice/v1/question-analysis?questionId={question_id}&partId={part_id}&groupId={group_id}"),
                    &format!("{label}_question_analysis"), &mut report).await;
                findings[format!("{label}AnalysisLocation")] = json!({
                    "sentenceIndex": analysis["question"]["sentenceIndex"],
                    "startTimeMillis": analysis["question"]["startTimeMillis"],
                    "endTimeMillis": analysis["question"]["endTimeMillis"]
                });
            }
            get(
                &client,
                &session,
                &format!("/practice/v1/question-notes?questionIds={question_id}"),
                &format!("{label}_notes"),
                &mut report,
            )
            .await;
            get(
                &client,
                &session,
                &format!("/practice/v1/question-tags/selections?questionIds={question_id}"),
                &format!("{label}_tag_selections"),
                &mut report,
            )
            .await;
        }
        get(
            &client,
            &session,
            &format!("/practice/v1/highlights?unitId={unit_id}"),
            &format!("{label}_highlights"),
            &mut report,
        )
        .await;
        get(
            &client,
            &session,
            &format!("/practice/v1/unit-status?unitIds={unit_id}"),
            &format!("{label}_status"),
            &mut report,
        )
        .await;
    }
    if let Some(records) = responses["records"]["records"].as_array() {
        if let Some(record) = records.iter().find(|r| {
            r["channel"] == "reading"
                && r["canOpenReview"] == true
                && identifier(&r["unitId"]).as_deref() == Some("2017137445860642818")
        }) {
            let target = &record["reviewTarget"];
            let result_id =
                identifier(&target["resultId"]).or_else(|| identifier(&target["attemptId"]));
            if let Some(result_id) = result_id {
                let review = get(
                    &client,
                    &session,
                    &format!("/practice/v1/results/{result_id}/review"),
                    "existing_reading_review",
                    &mut report,
                )
                .await;
                assert_eq!(
                    identifier(&review["attempt"]["unitId"]).as_deref(),
                    Some("2017137445860642818")
                );
                findings["existingReadingReview"] = json!({"correctCount":review["attempt"]["correctCount"],"totalCount":review["attempt"]["totalCount"],
                    "elapsedSeconds":review["attempt"]["elapsedSeconds"]});
                findings["existingReadingReview"]["selectedQuestions"] = json!(review["details"].as_array().into_iter().flatten()
                    .filter(|row| matches!(row["qNumber"].as_str(), Some("1" | "13")))
                    .map(|row| json!({"qNumber":row["qNumber"],"userAnswer":row["userAnswer"],"rightAnswer":row["rightAnswer"],"score":row["score"],"state":row["state"]})).collect::<Vec<_>>());
            }
        }
    }
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../developer/tests/e2e/reports/jiufen-api-audit.json");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(
        path,
        serde_json::to_vec_pretty(
            &json!({"date":"2026-11-19","responses":report,"findings":findings}),
        )
        .unwrap(),
    )
    .unwrap();
    for row in &report {
        println!(
            "{} HTTP={} code={}",
            row["label"], row["httpStatus"], row["businessCode"]
        );
    }
    let failures: Vec<_> = report
        .iter()
        .filter(|row| {
            row["status"] == "transport_error"
                || (row["method"] == "GET"
                    && (row["httpStatus"] != 200
                        || identifier(&row["businessCode"]).as_deref() != Some("200")))
        })
        .map(|row| row["label"].clone())
        .collect();
    assert!(
        failures.is_empty(),
        "GET audit failures (see the redacted report): {failures:?}"
    );
}
