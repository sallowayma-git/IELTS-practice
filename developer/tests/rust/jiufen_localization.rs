use super::*;
use crate::app::application_store::ApplicationStore;
use crate::app::state::{AppDb, AppPaths};
use ielts_application::{
    CoachService, CompletionRequest, CompletionResponse, LanguageModel, ModelError,
};

struct EvidenceProbe;

#[test]
fn completed_provider_attempt_is_atomic_and_keeps_grade_evidence() {
    let temp = tempfile::tempdir().unwrap();
    let conn = ielts_db::open_and_migrate(temp.path().join("test.db")).unwrap();
    let converted =
        crate::jiufen::convert::convert(crate::jiufen::EXAM, crate::jiufen::REVIEW).unwrap();
    let mut attempt = converted.attempt;
    let id = "jiufen-native-transaction-fixture";
    attempt.asset_id = Some(id.into());
    let mut payload = converted.payload;
    payload["examId"] = json!(id);
    payload["reviewExplanations"] = json!({"questionExplanations":[{"items":[{"questionId":"q1","text":"verified official explanation"}]}]});
    let asset: ielts_domain::PracticeAssetV2 = serde_json::from_value(json!({
        "schemaVersion":2,"id":id,"activity":"reading","sourceKind":"imported",
        "title":"fixture","fingerprint":"submitted-revision","pdfOnly":false,
        "metadata":{"remoteProvider":"jiufen"}
    }))
    .unwrap();
    ielts_db::upsert_practice_asset(&conn, &asset).unwrap();
    assert!(ielts_db::persist_completed_attempt(&conn, &attempt, &asset.fingerprint).is_err());
    {
        let tx = conn.unchecked_transaction().unwrap();
        ielts_db::persist_completed_attempt(&tx, &attempt, &asset.fingerprint).unwrap();
        tx.rollback().unwrap();
    }
    let count: i64 = conn
        .query_row("SELECT count(*) FROM attempts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
    for _ in 0..2 {
        let tx = conn.unchecked_transaction().unwrap();
        ielts_db::persist_completed_attempt(&tx, &attempt, &asset.fingerprint).unwrap();
        tx.commit().unwrap();
    }
    assert_eq!(
        conn.query_row("SELECT count(*) FROM learning_events", [], |r| r
            .get::<_, usize>(0))
            .unwrap(),
        attempt.answers.len() + 1
    );
    let thread = ielts_db::ensure_coach_thread(
        &conn,
        &ielts_db::EnsureCoachThreadCommand {
            thread_id: None,
            attempt_id: Some(attempt.id.clone()),
            asset_id: Some(id.into()),
            kind: "chat".into(),
        },
    )
    .unwrap();
    let context = ielts_db::resolve_provider_coach_context(
        &conn,
        &thread.id,
        None,
        &payload,
        &asset.fingerprint,
    )
    .unwrap();
    assert!(context.evidence["result"]["answers"]
        .as_array()
        .unwrap()
        .iter()
        .all(|a| !a["correctAnswer"].is_null()));
    assert!(ielts_db::resolve_provider_coach_context(
        &conn,
        &thread.id,
        Some(&json!({"sessionId":"other"})),
        &payload,
        &asset.fingerprint
    )
    .is_err());
    assert!(ielts_db::resolve_provider_coach_context(
        &conn,
        &thread.id,
        None,
        &payload,
        "different-revision"
    )
    .is_err());
    payload["answerKey"] = json!({});
    assert!(ielts_db::resolve_provider_coach_context(
        &conn,
        &thread.id,
        None,
        &payload,
        &asset.fingerprint
    )
    .is_err());
}

#[async_trait::async_trait]
impl LanguageModel for EvidenceProbe {
    async fn complete(&self, request: CompletionRequest) -> Result<CompletionResponse, ModelError> {
        let text = &request
            .messages
            .iter()
            .find(|m| m.content.starts_with("Host-resolved IELTS evidence"))
            .unwrap()
            .content;
        let evidence: Value = serde_json::from_str(text.split_once('\n').unwrap().1).unwrap();
        let answers = evidence["result"]["answers"].as_array().unwrap();
        assert!(answers.iter().all(|a| !a["correctAnswer"].is_null()));
        assert!(!evidence["source"]["reviewExplanations"].is_null());
        Ok(CompletionResponse {
            content: json!({"answer":"Evidence contract verified"}).to_string(),
            model: "local-contract-probe".into(),
            latency_ms: 0,
            usage: None,
            provider_request_id: None,
        })
    }
}

#[tokio::test]
#[ignore = "Explicit migration of real Atlas records and authenticated read-only official review"]
async fn live_localization_records_and_coach_evidence() {
    assert_eq!(
        std::env::var("ATLAS_JIUFEN_LOCALIZATION_AUDIT").as_deref(),
        Ok("1")
    );
    let paths = AppPaths::discover();
    let db = AppDb::open(&paths).unwrap();
    db.snapshot_before(&paths, "jiufen-remote-records").unwrap();
    let install = install_id(&db).unwrap();
    let session = restore_saved(install)
        .unwrap()
        .expect("Sign in through Atlas first");
    let account = Account(Mutex::new(Some(session)));
    crate::jiufen::practice::migrate_local_records(&db).unwrap();
    crate::jiufen::practice::migrate_local_records(&db).unwrap();
    let records=db.with_conn(|conn| {
        let mut stmt=conn.prepare("SELECT id,asset_id,activity FROM attempts WHERE asset_id LIKE 'jiufen-native-%' AND status='completed' ORDER BY activity")?;
        let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))?;
        Ok(rows.collect::<Result<Vec<_>,_>>()?)
    }).unwrap();
    assert!(records.len() >= 2);
    let mut report = json!({"verification":"official GET + existing scores + local Coach transport probe","records":[]});
    for (attempt_id, asset_id, activity) in records {
        let thread = db
            .with_conn(|conn| {
                ielts_db::ensure_coach_thread(
                    conn,
                    &ielts_db::EnsureCoachThreadCommand {
                        thread_id: None,
                        attempt_id: Some(attempt_id.clone()),
                        asset_id: Some(asset_id.clone()),
                        kind: "chat".into(),
                    },
                )
            })
            .unwrap();
        let cmd = ielts_db::RunCoachCommand {
            thread_id: thread.id.clone(),
            content: "解释第一题的标准答案和依据".into(),
            question_context: Some(
                json!({"activity":activity,"assetId":asset_id,"sessionId":attempt_id,"focusQuestionIds":["q1"]}),
            ),
        };
        let context = crate::jiufen::practice::prepare_coach_context(&account, &db, &cmd)
            .await
            .unwrap()
            .unwrap();
        let answers = context.evidence["result"]["answers"].as_array().unwrap();
        assert!(answers.iter().all(|a| !a["correctAnswer"].is_null()));
        let explanations = &context.evidence["source"]["reviewExplanations"];
        let explanation_count = if activity == "reading" {
            explanations["questionExplanations"][0]["items"]
                .as_array()
                .unwrap()
                .len()
        } else {
            explanations.as_object().unwrap().len()
        };
        assert_eq!(explanation_count, answers.len());
        let events = db
            .with_conn(|conn| {
                Ok(conn.query_row(
                    "SELECT count(*) FROM learning_events WHERE attempt_id=?1 AND event_type IN ('attempt_completed','reading_question_outcome','listening_question_outcome')",
                    [&attempt_id],
                    |r| r.get::<_, u64>(0),
                )?)
            })
            .unwrap();
        assert_eq!(events, answers.len() as u64 + 1);
        if activity == "reading" {
            assert_eq!(context.evidence["result"]["correctCount"], 11.0);
            assert_eq!(answers[0]["correctAnswer"], "B");
            assert_eq!(
                answers.iter().find(|a| a["questionId"] == "q13").unwrap()["correctAnswer"],
                "meat"
            );
        }
        // Verify the ordinary Coach service and trace against a database copy.
        // The model transport is replaced so the contract test adds no synthetic chat to the user's data.
        let temp = tempfile::tempdir().unwrap();
        let snapshot = temp.path().join("probe.db");
        db.with_conn(|conn| {
            conn.execute("VACUUM INTO ?1", [snapshot.to_str().unwrap()])?;
            Ok(())
        })
        .unwrap();
        let copy = AppDb::from_test_connection(
            ielts_db::open_connection(&ielts_db::DbOpenOptions::create(&snapshot)).unwrap(),
            snapshot,
        );
        let store = ApplicationStore::with_coach_context(&copy, Some(context.clone()));
        let result = CoachService::run(&store, cmd, || Ok(EvidenceProbe))
            .await
            .unwrap();
        assert_eq!(
            result.assistant_message.content,
            "Evidence contract verified"
        );
        copy.with_conn(|conn| {
            let trace:String=conn.query_row("SELECT rendered_context FROM agent_context_snapshots ORDER BY created_at DESC LIMIT 1",[],|r|r.get(0))?;
            assert!(trace.contains("remote_evidence_digest"));
            assert!(!trace.contains("questionGroups"));
            assert!(!trace.contains("correctAnswer"));
            Ok(())
        }).unwrap();
        report["records"].as_array_mut().unwrap().push(json!({"activity":activity,"correctCount":context.evidence["result"]["correctCount"],
            "questionCount":answers.len(),"learningEvents":events,"coachAnswers":answers.len(),"coachExplanations":explanation_count,
            "sourceBytes":context.evidence["source"].to_string().len(),"coachTransport":"local probe passed"}));
    }
    db.with_conn(|conn| {
        ielts_db::learner_projections_refresh(conn)?;
        assert!(ielts_db::learning_events_verify(conn)?.consistent);
        let counts: (u64,u64)=conn.query_row("SELECT (SELECT count(*) FROM learner_skill_observations WHERE skill_key LIKE 'reading.%'),(SELECT count(*) FROM learner_skill_observations WHERE skill_key LIKE 'listening.%')",[],|r|Ok((r.get(0)?,r.get(1)?)))?;
        assert!(counts.0>=12 && counts.1>=1);
        report["skillObservations"]=json!({"reading":counts.0,"listening":counts.1});
        let cached:u64=conn.query_row("SELECT count(*) FROM settings WHERE namespace='jiufen.online' AND (key LIKE 'review-v1-%' OR key LIKE 'material-v1-%')",[],|r|r.get(0))?;
        assert_eq!(cached,0);
        report["persistedMaterialSnapshots"]=json!(cached);
        Ok(())
    }).unwrap();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    std::fs::write(
        root.join("developer/tests/e2e/reports/jiufen-localization-live.json"),
        serde_json::to_vec_pretty(&report).unwrap(),
    )
    .unwrap();
    println!("{}", report);
}
