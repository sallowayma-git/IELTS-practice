use super::*;
use ielts_domain::Activity;

fn context() -> ResolvedCoachContext {
    let answers:Vec<_>=(1..=40).map(|i|json!({"questionId":format!("q{i}"),"questionKind":"sentence_completion",
        "answer":if i==1{json!("mining")}else{Value::Null},"isCorrect":i==1,"correctAnswer":if i==2{"education"}else{"official"}})).collect();
    ResolvedCoachContext {
        activity: Activity::Reading,
        evidence: json!({"identity":{"attemptId":"attempt-1","assetId":"asset-1","assetFingerprint":"version-1"},
            "result":{"status":"completed","correctCount":1,"questionCount":40,"score":0.025,"answers":answers},
            "source":{"questionDisplayMap":{"q1":"1","q2":"2"},"questionGroups":[{"groupId":"g1","section":1,"kind":"sentence_completion","questionIds":["q1","q2"],"leadHtml":"ONE WORD ONLY","bodyHtml":"Their <input name='q2'> was designed to give them an interest in collecting art."}],
            "passage":{"blocks":[{"blockId":"part-1","html":"<h2>The sisters</h2><p>The sisters&#39; education was rigorously geared toward such pursuits.</p><p>Another paragraph about art galleries.</p>"},{"blockId":"part-2","html":"<p>UNRELATED_PART_TWO_SECRET</p>"}]}},"evidenceLimitations":[]}),
        request: json!({"controls":{"focusQuestionIds":["q2"]}}),
        message_metadata: json!({"action":"chat","focusQuestionIds":["q2"]}),
    }
}

#[test]
fn single_question_seed_omits_other_parts_and_grades_but_preserves_official_evidence() {
    let full = context();
    let tools = EvidenceTools::new(&full);
    let small = tools.project(&full, "Explain Q2").unwrap();
    assert_eq!(small.evidence["result"]["answeredCount"], 1);
    assert_eq!(small.evidence["result"]["unansweredCount"], 39);
    assert!(small.evidence["result"].get("answers").is_none());
    assert_eq!(
        small.evidence["focus"]["answers"][0]["correctAnswer"],
        "education"
    );
    assert!(small
        .evidence
        .to_string()
        .contains("education was rigorously"));
    assert!(!small
        .evidence
        .to_string()
        .contains("UNRELATED_PART_TWO_SECRET"));
    assert_eq!(
        small.evidence["focus"]["answers"].as_array().unwrap().len(),
        1
    );
    assert!(small.evidence.to_string().len() < full.evidence.to_string().len());
}

#[test]
fn whole_review_starts_from_completion_summary_not_forty_blank_failures() {
    let mut full = context();
    full.message_metadata["action"] = json!("review_set");
    let small = EvidenceTools::new(&full).project(&full, "review").unwrap();
    assert!(small.evidence["focus"].is_null());
    assert_eq!(
        small.evidence["result"]["byQuestionKind"]["sentence_completion"]["unanswered"],
        39
    );
    assert!(!small
        .evidence
        .to_string()
        .contains("education was rigorously"));
}

#[test]
fn typed_question_resolves_within_attempt_and_replaces_stale_ui_focus() {
    let mut full = context();
    full.evidence["source"]["questionDisplayMap"]["q27"] = json!("27");
    full.evidence["source"]["questionGroups"].as_array_mut().unwrap().push(json!({
        "groupId":"g27","questionIds":["q27"],"section":2,"kind":"sentence_completion",
        "bodyHtml":"Question 27 <input name='q27'> second passage secret."
    }));
    for query in ["只解释 Q27", "解释第 27 题", "Explain question 27", "解释Q27", "Q27题怎么做"] {
        let small = EvidenceTools::new(&full).project(&full, query).unwrap();
        assert_eq!(small.evidence["focus"]["answers"][0]["questionId"], "q27");
        assert_eq!(small.request["controls"]["focusQuestionIds"], json!(["q27"]));
        assert_eq!(small.message_metadata["focusQuestionIds"], json!(["q27"]));
        assert!(!small.evidence.to_string().contains("education was rigorously"));
    }
    let unknown = EvidenceTools::new(&full).project(&full, "Explain Q999").unwrap();
    assert!(unknown.evidence["focus"].is_null());
    assert_eq!(unknown.request["controls"]["focusQuestionIds"], json!([]));
    let unchanged = EvidenceTools::new(&full).project(&full, "2027 or FAQ27 or Q1234 is not a question reference").unwrap();
    assert_eq!(unchanged.evidence["focus"]["answers"][0]["questionId"], "q2");
}

#[test]
fn seed_ranking_uses_requested_blank_not_neighbouring_group_keywords() {
    let mut full = context();
    full.evidence["source"]["questionGroups"][0]["bodyHtml"] = json!(
        "<p>Family mining transport galleries buying impressionism France <input name='q1'></p><p>Their <input name='q2'> was designed to cultivate interests.</p>"
    );
    full.evidence["source"]["passage"]["blocks"][0]["html"] = json!(
        "<p>Family mining transport galleries buying impressionism France.</p><p>France impressionism galleries transport mining.</p><p>The sisters' education was designed to cultivate interests.</p>"
    );
    let small = EvidenceTools::new(&full).project(&full, "Explain Q2").unwrap();
    assert!(small.evidence["source"]["initialEvidence"]["chunks"][0]["text"].as_str().unwrap().contains("education"));
}

#[test]
fn history_keeps_complete_exchanges_within_small_budget() {
    let history: Vec<ielts_db::CoachMessage> = (1..=6).map(|n| serde_json::from_value(json!({
        "id":format!("m{n}"),"threadId":"thread","role":if n%2==1{"user"}else{"assistant"},
        "content":if n<=4{"older ".repeat(900)}else{"latest ".repeat(20)},"status":"completed","createdAt":"now","sequence":n
    })).unwrap()).collect();
    let kept = recent_history(&history);
    assert_eq!(kept.iter().map(|m|m.id.as_str()).collect::<Vec<_>>(), vec!["m5","m6"]);
    assert!(kept.iter().map(|m|estimate_tokens(&m.content)).sum::<u32>() <= 800);
    let large = recent_history(&history[..4]);
    assert_eq!(large.len(), 2);
    assert_eq!(large[0].id, "m3");
    assert_eq!(large[1].id, "m4");
    assert!(large.iter().all(|m|m.content.contains("Prior message excerpt")));
    assert!(large.iter().map(|m|estimate_tokens(&m.content)).sum::<u32>() <= 800);
}

#[tokio::test]
async fn tools_reject_cross_attempt_ids_and_bound_incremental_reads() {
    let full = context();
    let tools = EvidenceTools::new(&full);
    let call = |name: &str, args: Value| AgentToolCall {
        id: "c1".into(),
        name: name.into(),
        arguments_json: args.to_string(),
    };
    for c in [
        call("get_question_evidence", json!({"questionIds":["q99"]})),
        call("read_passage_blocks", json!({"blockId":"other-attempt"})),
        call(
            "search_passage_evidence",
            json!({"query":"education","assetId":"other"}),
        ),
    ] {
        tools.begin_round();
        assert_eq!(
            tools.execute(&c).await.status,
            crate::AgentToolStatus::Rejected
        );
    }
    let c = call("search_passage_evidence", json!({"query":"education"}));
    tools.begin_round();
    let found = tools.execute(&c).await;
    assert!(found.model_content.contains("education was rigorously"));
    assert!(!found.audit_result.to_string().contains("education"));
    assert_eq!(tools.execute(&c).await.status, crate::AgentToolStatus::Rejected);
    tools.begin_round();
    let repeat = tools.execute(&c).await;
    assert!(repeat.model_content.contains("alreadyProvided"));
    assert!(!repeat.model_content.contains("education was rigorously"));
    let mut revised = context();
    revised.evidence["identity"]["assetFingerprint"] = json!("version-2");
    assert_ne!(
        tools.blocks()[0]["blockId"],
        EvidenceTools::new(&revised).blocks()[0]["blockId"]
    );
}

#[tokio::test]
async fn long_unicode_passages_and_large_question_groups_remain_pageable() {
    let mut full = context();
    full.evidence["source"]["passage"]["blocks"][0] =
        json!({"blockId":"part-1","bodyHtml":format!("<p>{}</p>","证据".repeat(1800))});
    full.evidence["source"]["questionGroups"][0]["bodyHtml"] = json!(format!(
        "<select name='q2'><option value='A'>A. education</option></select>{}",
        "很长的题组".repeat(700)
    ));
    let tools = EvidenceTools::new(&full);
    let block = tools.blocks()[0]["blockId"].as_str().unwrap().to_owned();
    let call = |offset| AgentToolCall {
        id: "page".into(),
        name: "read_passage_blocks".into(),
        arguments_json: json!({"blockId":block,"offset":offset}).to_string(),
    };
    let first = tools.execute(&call(0)).await;
    assert_eq!(first.status, crate::AgentToolStatus::Succeeded);
    let value: Value = serde_json::from_str(&first.model_content).unwrap();
    let next = value["continuation"]["nextOffset"].as_u64().unwrap();
    assert!(next > 0);
    tools.begin_round();
    let second = tools.execute(&call(next)).await;
    assert_eq!(second.status, crate::AgentToolStatus::Succeeded);
    assert!(second.model_content.contains("证据"));
    let q = tools.questions(&["q2".into()], 0).unwrap();
    assert_eq!(q["questionPage"]["nextPage"], 1);
    assert!(q["questionPage"]["text"]
        .as_str()
        .unwrap()
        .contains("[q2 options:"));
    assert!(tools.questions(&["q2".into()], 1).is_ok());
}

fn two_section_review() -> ResolvedCoachContext {
    let answers = vec![
        json!({"questionId":"q1","questionKind":"sentence_completion","answer":"mining","isCorrect":false,"correctAnswer":"education"}),
        json!({"questionId":"q2","questionKind":"sentence_completion","answer":"lava","isCorrect":false,"correctAnswer":"volcano"}),
    ];
    ResolvedCoachContext {
        activity: Activity::Reading,
        evidence: json!({"identity":{"attemptId":"attempt-2","assetId":"asset-2","assetFingerprint":"version-1"},
            "result":{"status":"completed","correctCount":0,"questionCount":2,"score":0.0,"answers":answers},
            "source":{"questionDisplayMap":{"q1":"1","q2":"2"},"questionGroups":[
                {"groupId":"g1","section":1,"kind":"sentence_completion","questionIds":["q1"],"leadHtml":"ONE WORD ONLY","bodyHtml":"Their <input name='q1'> was designed to give them an interest in art."},
                {"groupId":"g2","section":2,"kind":"sentence_completion","questionIds":["q2"],"leadHtml":"ONE WORD ONLY","bodyHtml":"The island was formed by a <input name='q2'> eruption."}],
            "passage":{"blocks":[
                {"blockId":"part-1","html":"<p>The sisters' education was designed to cultivate an interest in art.</p>"},
                {"blockId":"part-2","html":"<p>The island was formed when a volcano erupted beneath the sea.</p>"}]}},"evidenceLimitations":[]}),
        request: json!({"controls":{"action":"review_set"}}),
        message_metadata: json!({"action":"review_set"}),
    }
}

#[test]
fn a_review_seeds_one_chunk_per_focus_question_even_across_sections() {
    let full = two_section_review();
    let small = EvidenceTools::new(&full).project(&full, "review").unwrap();
    assert_eq!(small.request["controls"]["focusQuestionIds"], json!(["q1", "q2"]));
    let seed = small.evidence["source"]["initialEvidence"]["chunks"].to_string();
    assert!(seed.contains("education"), "q1's own passage chunk is supplied: {seed}");
    assert!(seed.contains("volcano"), "q2 sits in another section and still gets its chunk: {seed}");
}

#[test]
fn a_chat_about_two_questions_still_seeds_from_the_first_section_only() {
    let mut full = two_section_review();
    full.message_metadata["action"] = json!("chat");
    full.request["controls"]["action"] = json!("chat");
    full.message_metadata["focusQuestionIds"] = json!(["q1", "q2"]);
    let small = EvidenceTools::new(&full).project(&full, "explain").unwrap();
    let seed = small.evidence["source"]["initialEvidence"]["chunks"].to_string();
    assert!(seed.contains("education") && !seed.contains("volcano"), "chat seeding is unchanged: {seed}");
}
