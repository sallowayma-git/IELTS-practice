use super::*;
use crate::jiufen::{convert::food_case, EXAM, REVIEW};

#[test]
fn session_identity_and_expiry_are_independent_of_network_errors() {
    let data = json!({"data":{"accessToken":"fixture-only","userInfo":{"userId":2017137445860642818_u64,"id":"2017137445860642818"}}});
    assert_eq!(Session::parse(&data).unwrap().owner, "2017137445860642818");
    let mut conflicting = data;
    conflicting["data"]["userInfo"]["id"] = json!("other");
    assert!(Session::parse(&conflicting).is_err());
    for code in [json!(401), json!("403"), json!(10401), json!("10403")] {
        assert!(matches!(
            classify(200, &json!({"code":code}), true),
            Err(Failure::Expired)
        ));
    }
    assert!(matches!(
        classify(403, &Value::Null, true),
        Err(Failure::Expired)
    ));
    assert!(matches!(
        classify(503, &Value::Null, true),
        Err(Failure::Message(_))
    ));
    assert!(matches!(
        classify(
            200,
            &json!({"code":400,"msg":"EMAIL_CODE_COOLDOWN","data":{"retryAfterSeconds":37}}),
            false
        ),
        Err(Failure::Cooldown(37))
    ));
}

#[test]
fn submission_business_states_are_not_treated_as_generic_network_failures() {
    for value in [json!({"code":400,"data":{"submissionState":"rejected_before_write"}}),
        json!({"code":400,"submissionState":"rejected_before_write"})] {
        assert!(matches!(classify(200,&value,true),Err(Failure::RejectedBeforeWrite)));
    }
    assert!(matches!(classify(409,&json!({"data":{"submissionState":"conflict"}}),true),Err(Failure::SubmissionConflict)));
    assert!(matches!(classify(503,&json!({"code":503}),true),Err(Failure::Message(_))));
}

#[test]
fn case_binds_real_question_ids_answers_and_receipt_before_import() {
    let mut exam: Value = serde_json::from_str(EXAM).unwrap();
    exam["data"]["id"] = json!(food_case::UNIT_ID);
    exam["data"]["parts"][0]["groups"][0]["questions"][0]["id"] = json!("upstream-q1");
    let snapshot = food_case::exam_snapshot(&exam).unwrap();
    let body = food_case::submission(&snapshot, "test-submission").unwrap();
    let groups = &body["parts"][0]["groups"];
    assert_eq!(
        groups[0]["questions"][0],
        json!({"id":"upstream-q1","qNumber":"1","userAnswer":"A","bookmarked":false})
    );
    assert_eq!(groups[1]["questions"][7]["userAnswer"], "");
    let mut review: Value = serde_json::from_str(REVIEW).unwrap();
    let data = &mut review["data"];
    data["attempt"]["unitId"] = json!(food_case::UNIT_ID);
    data["attempt"]["correctCount"] = json!(11);
    data["details"][0]["questionId"] = json!("upstream-q1");
    for (index, answer) in [(0, "A"), (12, "")] {
        let row = &mut data["details"][index];
        row["userAnswer"] = json!(answer);
        row["score"] = json!(0.0);
        row.as_object_mut().unwrap().remove("state"); // unknown until an online submission
    }
    let verify = |r: &Value, owner, id| food_case::verify(&snapshot, r, owner, id, &body);
    let imported = verify(&review, "account-01", "attempt-01").unwrap().attempt;
    assert_eq!(imported.correct_count, Some(11.0));
    assert_eq!(imported.answers[0].answer, "A");
    assert!(!imported.answers[12].is_answered());
    assert!(verify(&review, "account-01", "other-attempt").is_err());
    assert!(verify(&review, "other-owner", "attempt-01").is_err());
    review["data"]["details"][0]["userAnswer"] = json!("C");
    assert!(verify(&review, "account-01", "attempt-01").is_err());
    exam["data"]["parts"][0]["groups"][0]["questions"][0]["question"] = json!("Changed edition");
    assert!(food_case::submission(&exam.to_string(), "test-submission").is_err());
}

#[tokio::test]
#[ignore = "Explicit online read-only check, skips public CI"]
async fn live_food_exam_builds_request_without_sending_it() {
    let exam = request(
        &format!("/practice/v1/units/{}/exam", food_case::UNIT_ID),
        None,
        None,
        None,
    )
    .await
    .unwrap();
    let body = food_case::submission(&food_case::exam_snapshot(&exam).unwrap(), "read-only-check")
        .unwrap();
    assert_eq!(
        body["parts"][0]["groups"][0]["questions"][0]["userAnswer"],
        "A"
    );
    assert_eq!(
        body["parts"][0]["groups"][1]["questions"][7]["userAnswer"],
        ""
    );
}

#[test]
fn os_credential_restores_the_account_and_logout_removes_it() {
    let id = format!("atlas-fixture-{}", uuid::Uuid::new_v4());
    let mut session =
        Session::parse(&json!({"token":"ephemeral-test-value","user":{"id":"owner-a"}})).unwrap();
    session.credential = id.clone();
    save_session(&session).unwrap();
    drop(session);
    let restored = restore_saved(id.clone()).unwrap().unwrap();
    clear_saved(&id).unwrap();
    assert_eq!(restored.owner, "owner-a");
    assert!(restored.renewed.is_none());
    assert!(restore_saved(id).unwrap().is_none());
}
