use super::*;
use crate::app::state::test_support::test_db;
use crate::jiufen::{catalog, practice, EXAM, REVIEW};
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Notify;

// Restart/expiry scenarios intentionally clear the process-wide provider cache.
// Isolate independent fixtures while retaining concurrency inside each scenario.
static PROVIDER_CACHE: Mutex<()> = Mutex::const_new(());

#[derive(Default)]
struct Server {
    submissions: Vec<Value>,
    accepted: Option<Value>,
    fail_post: Option<Failure>,
    lose_receipt: bool,
    fail_review: bool,
    posts: usize,
    listening: bool,
    changed_exam: bool,
    exam_offline: bool,
    official_elapsed_seconds: Option<u64>,
}

fn session(owner: &str, transport: test_transport::Transport) -> Session {
    let mut session = Session::parse(&json!({"user":{"id":owner},"token":"fixture-only"})).unwrap();
    session.transport = Some(transport);
    session
}

fn account(transport: test_transport::Transport) -> Account {
    Account(
        Mutex::new(Some(session("account-01", transport))),
        Mutex::new(()),
    )
}

fn transport(server: Arc<StdMutex<Server>>) -> test_transport::Transport {
    test_transport::Transport::new(move |path, body| {
        let server = server.clone();
        async move {
            let mut server = server.lock().unwrap();
            if path == "/practice/v1/attempts" {
                let body = body.unwrap();
                server.posts += 1;
                server.submissions.push(body.clone());
                if let Some(failure) = server.fail_post.take() {
                    return Err(failure);
                }
                if let Some(accepted) = &server.accepted {
                    assert_eq!(
                        &body, accepted,
                        "retries must preserve the entire frozen request"
                    );
                } else {
                    server.accepted = Some(body);
                }
                if std::mem::take(&mut server.lose_receipt) {
                    return Err(Failure::Message("injected lost response".into()));
                }
                return Ok(json!({"code":200,"data":{"resultId":"attempt-01"}}));
            }
            if path == "/practice/v1/results/attempt-01/review" {
                if std::mem::take(&mut server.fail_review) {
                    return Err(Failure::Message("injected review timeout".into()));
                }
                let mut review: Value = serde_json::from_str(REVIEW).unwrap();
                let accepted = server.accepted.as_ref().unwrap();
                let mut correct = 0;
                for row in review["data"]["details"].as_array_mut().unwrap() {
                    let answer = accepted["parts"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .flat_map(|p| p["groups"].as_array().unwrap())
                        .flat_map(|g| g["questions"].as_array().unwrap())
                        .find(|q| q["qNumber"] == row["qNumber"])
                        .unwrap();
                    row["userAnswer"] = answer["userAnswer"].clone();
                    let right = row["userAnswer"] == row["rightAnswer"];
                    row["score"] = json!(u8::from(right));
                    correct += u64::from(right);
                }
                review["data"]["attempt"]["correctCount"] = json!(correct);
                review["data"]["attempt"]["elapsedSeconds"] = json!(server.official_elapsed_seconds);
                return Ok(review);
            }
            if path.starts_with("/practice/v1/question-analysis?") {
                return Ok(
                    json!({"code":200,"data":{"question":{"analysisText":"fixture explanation"}}}),
                );
            }
            if path == "/practice/v1/units/unit-01/exam" {
                if server.exam_offline {
                    return Err(Failure::Message("injected offline".into()));
                }
                let mut exam: Value = serde_json::from_str(EXAM).unwrap();
                if server.listening {
                    exam["data"]["channel"] = json!("listening");
                }
                if server.changed_exam {
                    exam["data"]["parts"][0]["groups"][0]["description"] =
                        json!("<p>Updated instructions</p>");
                }
                return Ok(exam);
            }
            panic!("unexpected remote request: {path}");
        }
    })
}

#[tokio::test]
async fn listening_review_reuses_submit_material_and_retries_only_missing_items() {
    let _cache = PROVIDER_CACHE.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let db = test_db(temp.path());
    let cmd = fixture_for(&db, "listening");
    let asset_id = cmd["assetId"].as_str().unwrap();
    let attempt_id = cmd["attemptId"].as_str().unwrap();
    let (question, question_count) = db.with_conn(|conn| {
        let mut payload = ielts_db::transient_assets::get(conn, asset_id)?;
        let questions = payload["jiufen"]["questions"].as_array().unwrap();
        let first = questions[0]["questionId"].as_str().unwrap().to_owned();
        let count = questions.len();
        payload["studyMaterial"] = crate::jiufen::material::from_unit(&json!({"parts":[
            {"id":"part-01","partNum":1,"articleJson":{"segments":[{"sentences":[
                {"sentence_index":0,"text":"First original."},
                {"sentence_index":1,"text":"Second original."}
            ]}]}},
            {"id":"part-02","partNum":2,"articleJson":{"segments":[{"sentences":[
                {"sentence_index":0,"text":"Another original."}
            ]}]}},
            {"id":"part-03","partNum":3,"articleJson":{"segments":[{"sentences":[
                {"sentence_index":0,"text":"Third part original."}
            ]}]}}
        ]}));
        ielts_db::transient_assets::put(conn, "jiufen", asset_id, payload)?;
        Ok((first, count))
    }).unwrap();
    let base = transport(Arc::new(StdMutex::new(Server { listening: true, ..Default::default() })));
    let calls = Arc::new(StdMutex::new(std::collections::HashMap::<String, usize>::new()));
    let log = calls.clone();
    let missing_path = format!("questionId={question}&");
    let missing_path_for_transport = missing_path.clone();
    let api = test_transport::Transport::new(move |path, body| {
        let log = log.clone();
        let base = base.clone();
        let missing_path = missing_path_for_transport.clone();
        async move {
            let number = {
                let mut calls = log.lock().unwrap();
                let count = calls.entry(path.clone()).or_default();
                *count += 1;
                *count
            };
            if path.starts_with("/practice/v1/question-analysis?") && path.contains(&missing_path) && number == 1 {
                return Ok(json!({"code":200,"data":{"question":{}}}));
            }
            if path.ends_with("/sentence-translations?locale=zh-CN") {
                let translations = if path.contains("/part-01/") {
                    if number == 1 {
                        json!([{"sentenceIndex":0,"zhText":"第一句"}])
                    } else {
                        json!([{"sentenceIndex":0,"zhText":"不应覆盖"},{"sentenceIndex":1,"zhText":"第二句"}])
                    }
                } else if path.contains("/part-03/") && number == 1 {
                    return Err(Failure::Message("injected missing translation".into()));
                } else {
                    json!([{"sentenceIndex":0,"zhText":"其他原文译文"}])
                };
                return Ok(json!({"code":200,"data":{"translations":translations}}));
            }
            base.request(&path, body.as_ref()).await
        }
    });
    let current = account(api);
    let completed = submit(&current, &db, &cmd).await.unwrap();
    assert_eq!(completed["review"]["reviewExplanations"]["q2"], "fixture explanation");
    let reopened = submit(&current, &db, &cmd).await.unwrap();
    assert_eq!(reopened["studyMaterial"]["missing"]["analysisQuestions"], json!(["q1"]));
    let initial = practice::study_material(&current, &db, asset_id, "listening", Some(attempt_id), false)
        .await.unwrap();
    assert_eq!(initial["parts"][0]["paragraphs"][0]["sentences"][0]["text"], "First original.");
    assert_eq!(initial["parts"][0]["paragraphs"][0]["sentences"][0]["translation"], "第一句");
    assert_eq!(initial["parts"][2]["paragraphs"][0]["sentences"][0]["text"], "Third part original.");
    assert_eq!(initial["questions"]["q2"]["analyses"][0]["text"], "fixture explanation");
    assert_eq!(initial["missing"], json!({"translationParts":[1,3],"analysisQuestions":["q1"]}));
    {
        let counts = calls.lock().unwrap();
        assert_eq!(counts.iter().filter(|(path, _)| path.contains("question-analysis?"))
            .map(|(_, count)| *count).sum::<usize>(), question_count);
        assert_eq!(counts["/practice/v1/results/attempt-01/review"], 1);
    }

    let recovered = practice::study_material(&current, &db, asset_id, "listening", Some(attempt_id), true)
        .await.unwrap();
    assert_eq!(recovered["missing"], json!({"translationParts":[],"analysisQuestions":[]}));
    assert_eq!(recovered["parts"][0]["paragraphs"][0]["sentences"][0]["translation"], "第一句");
    assert_eq!(recovered["parts"][0]["paragraphs"][0]["sentences"][1]["translation"], "第二句");
    assert_eq!(recovered["questions"]["q1"]["analyses"][0]["text"], "fixture explanation");
    let cached = submit(&current, &db, &cmd).await.unwrap();
    assert_eq!(cached["analysesComplete"], true);
    assert_eq!(cached["review"]["reviewExplanations"]["q1"], "fixture explanation");
    practice::study_material(&current, &db, asset_id, "listening", Some(attempt_id), true).await.unwrap();
    let counts = calls.lock().unwrap();
    assert_eq!(counts["/practice/v1/results/attempt-01/review"], 1);
    assert_eq!(counts["/practice/v1/parts/part-01/sentence-translations?locale=zh-CN"], 2);
    assert_eq!(counts["/practice/v1/parts/part-02/sentence-translations?locale=zh-CN"], 1);
    assert_eq!(counts["/practice/v1/parts/part-03/sentence-translations?locale=zh-CN"], 2);
    for (path, count) in counts.iter().filter(|(path, _)| path.contains("question-analysis?")) {
        assert_eq!(*count, if path.contains(&missing_path) { 2 } else { 1 }, "{path}");
    }
}

#[tokio::test]
async fn cold_offline_and_updated_exam_keep_original_draft_discoverable() {
    let _cache = PROVIDER_CACHE.lock().await;
    for channel in ["reading", "listening"] {
        let temp = tempfile::tempdir().unwrap();
        let db = test_db(temp.path());
        let cmd = fixture_for(&db, channel);
        let old_asset = cmd["assetId"].as_str().unwrap();
        let server = Arc::new(StdMutex::new(Server {
            listening: channel == "listening",
            fail_post: Some(Failure::Message("injected offline".into())),
            ..Default::default()
        }));
        let api = transport(server.clone());
        // This leaves a genuine local draft and a pending submission, without a remote result.
        assert!(submit(&account(api.clone()), &db, &cmd).await.is_err());
        let db_path = db.path.clone();
        drop(db);
        let db = AppDb::from_test_connection(ielts_db::open_and_migrate(&db_path).unwrap(), db_path);
        ielts_db::transient_assets::clear_provider("jiufen");
        let listed = || serde_json::to_value(practice::draft_assets(&db, channel).unwrap()).unwrap();
        assert_eq!(listed()[0]["assetId"], old_asset);
        server.lock().unwrap().exam_offline = true;
        let current = account(api);
        assert!(submit(&current, &db, &cmd).await.unwrap_err().contains("injected offline"));

        {
            let mut server = server.lock().unwrap();
            server.exam_offline = false;
            server.changed_exam = true;
        }
        assert!(submit(&current, &db, &cmd).await.unwrap_err().contains("题面已更新"));
        let key = format!("catalog-v1-{}", hex::encode(sha2::Sha256::digest(b"account-01")));
        db.with_conn(|c| settings::upsert_setting(c, NS, &key,
            &json!([{"id":"unit-01","title":"fixture","channel":channel,"parts":["P1"],"available":true}]))).unwrap();
        catalog::library(&current, &db, false).await.unwrap();
        let new_asset = practice::open_unit(&current, &db, "unit-01".into(), channel.into()).await.unwrap();
        assert_ne!(old_asset, new_asset);
        assert_eq!(listed().as_array().unwrap().len(), 1);
        assert_eq!(listed()[0]["assetId"], old_asset);
        db.with_conn(|c| {
            let open = |asset: &str| {
                if channel == "reading" { ielts_db::reading::get_open_reading_draft(c, asset) }
                else { ielts_db::get_open_listening_draft(c, asset) }
            };
            let old = open(old_asset)?.unwrap();
            assert_eq!(old.id, cmd["attemptId"].as_str().unwrap());
            assert_eq!(old.answers.iter().find(|a| a.question_id == "q1").unwrap().answer, cmd["answers"]["q1"]);
            assert!(open(&new_asset)?.is_none());
            Ok(())
        }).unwrap();
    }
}

fn fixture(db: &AppDb) -> Value {
    fixture_for(db, "reading")
}

fn fixture_for(db: &AppDb, channel: &str) -> Value {
    let id = format!("jiufen-native-{}", uuid::Uuid::new_v4());
    let converted = crate::jiufen::convert::convert(EXAM, REVIEW).unwrap();
    let mut asset: ielts_domain::PracticeAssetV2 = serde_json::from_value(json!({
        "schemaVersion":2,"id":id,"activity":channel,"sourceKind":"imported",
        "sourceKey":"unit-01","title":"fixture","fingerprint":"fixture","pdfOnly":false,
        "metadata":{"remoteProvider":"jiufen","jiufenOwner":hex::encode(sha2::Sha256::digest(b"account-01"))}
    })).unwrap();
    // Use the native converter's mapping, not the legacy sample importer mapping.
    let mut unit: Value = serde_json::from_str(EXAM).unwrap();
    unit["data"]["channel"] = json!(channel);
    let mut payload = crate::jiufen::native::exam(&unit["data"]).unwrap();
    asset.metadata.as_mut().unwrap()["sourceFingerprint"] =
        json!(hex::encode(sha2::Sha256::digest(
            json!([
                payload["passage"],
                payload["questionGroups"],
                payload["jiufen"]
            ])
            .to_string()
            .as_bytes()
        )));
    payload["examId"] = json!(id);
    db.with_conn(|c| {
        ielts_db::upsert_practice_asset(c, &asset)?;
        ielts_db::transient_assets::put(c, "jiufen", &id, payload)
    })
    .unwrap();
    let answers: serde_json::Map<String, Value> = converted
        .attempt
        .answers
        .into_iter()
        .map(|a| (a.question_id, a.answer))
        .collect();
    json!({"assetId":id,"attemptId":format!("attempt-{}",uuid::Uuid::new_v4()),"channel":channel,
        "answers":answers,"markedQuestions":[],"durationMs":1234,
        "questionTimeline":[{"questionId":"q1","elapsedMs":321,"visitCount":2,"changeCount":1}]})
}

#[tokio::test]
async fn listening_draft_reopens_with_position_and_paused_time_after_process_restart() {
    use ielts_db::listening::attempt::{
        get_open_listening_draft_with_position, save_listening_draft_with_position,
        ListeningDraftPosition,
    };
    let _cache = PROVIDER_CACHE.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let db = test_db(temp.path());
    let cmd = fixture_for(&db, "listening");
    let asset_id = cmd["assetId"].as_str().unwrap();
    let position = ListeningDraftPosition {
        part: 1,
        question_id: Some("q1".into()),
        audio_position_ms: 8_420,
    };
    let mut draft = json!({
        "attemptId":cmd["attemptId"], "assetId":asset_id, "answers":cmd["answers"],
        "timerSnapshot":{"source":"single","anchorMs":1_700_000_000_000_i64,
            "effectiveStartTimeMs":1_700_000_000_000_i64,"mode":"elapsed","pausedOffsetMs":0,
            "pausedAtMs":1_700_000_001_234_i64,"running":false},
        "idempotencyKey":"listening-position-draft"
    });
    db.with_conn(|conn| {
        let first = serde_json::from_value(draft.clone()).unwrap();
        save_listening_draft_with_position(conn, &first, Some(&position))?;
        let invalid = ListeningDraftPosition { question_id: Some("unknown".into()), ..position.clone() };
        draft["answers"]["q1"] = json!("C");
        let change = serde_json::from_value(draft.clone()).unwrap();
        assert!(save_listening_draft_with_position(conn, &change, Some(&invalid)).is_err());
        Ok(())
    }).unwrap();
    let path = db.path.clone();
    drop(db);
    let db = AppDb::from_test_connection(ielts_db::open_and_migrate(&path).unwrap(), path);
    ielts_db::transient_assets::clear_provider("jiufen");
    let reopened = db.with_conn(|conn| get_open_listening_draft_with_position(conn, asset_id)).unwrap().unwrap();
    assert_eq!(reopened.resume_position, Some(position));
    assert_eq!(reopened.attempt.duration_ms, 1234);
    assert_eq!(reopened.attempt.answers.iter().find(|a| a.question_id == "q1").unwrap().answer, cmd["answers"]["q1"]);

    let server = Arc::new(StdMutex::new(Server {
        listening: true,
        official_elapsed_seconds: Some(86_400),
        ..Default::default()
    }));
    let completed = submit(&account(transport(server)), &db, &cmd).await.unwrap();
    assert_eq!(completed["attempt"]["durationMs"], 1234);
    db.with_conn(|conn| {
        assert!(get_open_listening_draft_with_position(conn, asset_id)?.is_none());
        assert!(settings::get_setting(conn, "listening_draft", cmd["attemptId"].as_str().unwrap())?.is_none());
        Ok(())
    }).unwrap();
}

#[tokio::test]
async fn listening_retry_keeps_official_attempt_and_preserves_later_edits_as_a_draft() {
    let _cache = PROVIDER_CACHE.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let db = test_db(temp.path());
    let mut cmd = fixture_for(&db, "listening");
    let server = Arc::new(StdMutex::new(Server {
        lose_receipt: true,
        listening: true,
        ..Default::default()
    }));
    let current = account(transport(server.clone()));
    assert!(submit(&current, &db, &cmd).await.is_err());
    cmd["answers"]["q1"] = json!("C");
    let result = submit(&current, &db, &cmd).await.unwrap();
    assert_eq!(result["attempt"]["activity"], "listening");
    assert_eq!(result["attempt"]["durationMs"], 1234);
    let draft = db
        .with_conn(|c| ielts_db::get_open_listening_draft(c, cmd["assetId"].as_str().unwrap()))
        .unwrap()
        .unwrap();
    assert_eq!(draft.id, result["recoveredDraftId"].as_str().unwrap());
    assert_eq!(
        draft
            .answers
            .iter()
            .find(|a| a.question_id == "q1")
            .unwrap()
            .answer,
        "C"
    );
    let replay = submit(&current, &db, &cmd).await.unwrap();
    assert_eq!(replay["idempotentReplay"], true);
    assert_eq!(server.lock().unwrap().posts, 2);
}

fn pending(db: &AppDb, cmd: &Value) -> Value {
    db.with_conn(|c| {
        Ok(settings::get_setting(
            c,
            NS,
            &format!("submit-v1-{}", cmd["attemptId"].as_str().unwrap()),
        )?
        .map(|r| r.value)
        .unwrap_or(Value::Null))
    })
    .unwrap()
}

async fn submit(account: &Account, db: &AppDb, cmd: &Value) -> Result<Value, String> {
    practice::submit(account, db, serde_json::from_value(cmd.clone()).unwrap()).await
}

use sha2::Digest;

#[tokio::test]
async fn retry_after_lost_response_and_restart_reuses_frozen_answers_and_completes_once() {
    let _cache = PROVIDER_CACHE.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let db = test_db(temp.path());
    let mut cmd = fixture(&db);
    let server = Arc::new(StdMutex::new(Server {
        lose_receipt: true,
        ..Default::default()
    }));
    let api = transport(server.clone());
    let first = account(api.clone());
    assert!(submit(&first, &db, &cmd)
        .await
        .unwrap_err()
        .contains("再次点击提交"));
    let original = pending(&db, &cmd);
    drop(first);
    let path = db.path.clone();
    drop(db);
    let db = AppDb::from_test_connection(ielts_db::open_and_migrate(&path).unwrap(), path);
    ielts_db::transient_assets::clear_provider("jiufen");
    cmd["answers"]["q1"] = json!("C");
    cmd["durationMs"] = json!(99999);
    let restored = account(api);
    let result = submit(&restored, &db, &cmd).await.unwrap();
    assert_eq!(result["attempt"]["durationMs"], 1234);
    assert_eq!(result["attempt"]["answers"][0]["elapsedMs"], 321);
    let draft_id = result["recoveredDraftId"].as_str().unwrap();
    let recovered = db
        .with_conn(|c| Ok(ielts_db::get_history_detail(c, draft_id)?.attempt))
        .unwrap();
    assert_eq!(recovered.status, ielts_domain::AttemptStatus::Draft);
    let timer = db
        .with_conn(|c| {
            ielts_db::modes::timer::load_reading_timer_state(
                c,
                ielts_db::modes::timer::TimerOwnerScope::Attempt,
                draft_id,
            )
        })
        .unwrap()
        .unwrap();
    assert!(!timer.running);
    assert_eq!(
        timer.elapsed_ms(chrono::Utc::now().timestamp_millis()),
        99999
    );
    assert_eq!(
        recovered
            .answers
            .iter()
            .find(|a| a.question_id == "q1")
            .unwrap()
            .answer,
        "C"
    );
    assert_eq!(server.lock().unwrap().submissions[1], original["body"]);
    assert!(pending(&db, &cmd).is_null());
    let repeated = submit(&restored, &db, &cmd).await.unwrap();
    assert_eq!(repeated["idempotentReplay"], true);
    assert_eq!(repeated["recoveredDraftId"], result["recoveredDraftId"]);
    assert_eq!(server.lock().unwrap().posts, 2);
    db.with_conn(|c| {
        let count: i64 = c.query_row(
            "SELECT count(*) FROM attempts WHERE status='completed'",
            [],
            |r| r.get(0),
        )?;
        let events: i64 = c.query_row(
            "SELECT count(*) FROM learning_events WHERE attempt_id=?1",
            [cmd["attemptId"].as_str().unwrap()],
            |r| r.get(0),
        )?;
        assert_eq!(count, 1);
        assert_eq!(events, 14);
        Ok(())
    })
    .unwrap();
}

#[tokio::test]
async fn unreceived_post_auth_expiry_and_review_failure_keep_recoverable_submission() {
    let _cache = PROVIDER_CACHE.lock().await;
    for failure in [
        Failure::Message("injected offline".into()),
        Failure::Expired,
    ] {
        let temp = tempfile::tempdir().unwrap();
        let db = test_db(temp.path());
        let cmd = fixture(&db);
        let server = Arc::new(StdMutex::new(Server {
            fail_post: Some(failure),
            fail_review: true,
            ..Default::default()
        }));
        let api = transport(server.clone());
        let current = account(api.clone());
        assert!(submit(&current, &db, &cmd).await.is_err());
        let frozen = pending(&db, &cmd)["body"].clone();
        *current.0.lock().await = Some(session("wrong-owner", api.clone()));
        assert!(submit(&current, &db, &cmd)
            .await
            .unwrap_err()
            .contains("账号"));
        assert_eq!(server.lock().unwrap().posts, 1);
        *current.0.lock().await = Some(session("account-01", api));
        ielts_db::transient_assets::clear_provider("jiufen");
        assert!(submit(&current, &db, &cmd)
            .await
            .unwrap_err()
            .contains("review timeout"));
        assert_eq!(pending(&db, &cmd)["receipt"], "attempt-01");
        assert_eq!(server.lock().unwrap().submissions[1], frozen);
        submit(&current, &db, &cmd).await.unwrap();
        assert_eq!(
            server.lock().unwrap().posts,
            2,
            "a saved receipt skips further POSTs"
        );
    }
}

#[tokio::test]
async fn changed_autosaved_answers_survive_completion_and_failed_transaction_rolls_back() {
    let _cache = PROVIDER_CACHE.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let db = test_db(temp.path());
    let cmd = fixture(&db);
    let server = Arc::new(StdMutex::new(Server {
        lose_receipt: true,
        ..Default::default()
    }));
    let current = account(transport(server.clone()));
    assert!(submit(&current, &db, &cmd).await.is_err());
    let mut draft = db
        .with_conn(|c| {
            Ok(ielts_db::get_history_detail(c, cmd["attemptId"].as_str().unwrap())?.attempt)
        })
        .unwrap();
    draft
        .answers
        .iter_mut()
        .find(|a| a.question_id == "q1")
        .unwrap()
        .answer = json!("C");
    db.with_conn(|c| {
        ielts_db::upsert_attempt(c,&draft)?;
        c.execute_batch("CREATE TEMP TRIGGER reject_completion BEFORE UPDATE OF status ON attempts WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'injected storage failure'); END")?;
        Ok(())
    }).unwrap();
    assert!(submit(&current, &db, &cmd)
        .await
        .unwrap_err()
        .contains("injected storage failure"));
    db.with_conn(|c| {
        let count: i64 = c.query_row(
            "SELECT count(*) FROM attempts WHERE id LIKE 'jiufen-recovered-%'",
            [],
            |r| r.get(0),
        )?;
        assert_eq!(
            count, 0,
            "failed completion must roll back the recovery draft too"
        );
        c.execute_batch("DROP TRIGGER reject_completion")?;
        Ok(())
    })
    .unwrap();
    let result = submit(&current, &db, &cmd).await.unwrap();
    db.with_conn(|c| {
        let preserved =
            ielts_db::get_history_detail(c, result["recoveredDraftId"].as_str().unwrap())?.attempt;
        assert_eq!(
            preserved
                .answers
                .iter()
                .find(|a| a.question_id == "q1")
                .unwrap()
                .answer,
            "C"
        );
        Ok(())
    })
    .unwrap();
    assert_eq!(server.lock().unwrap().posts, 2);
}

#[tokio::test]
async fn explicit_rejection_allows_correction_with_same_identity_and_legacy_pending_replays() {
    let _cache = PROVIDER_CACHE.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let db = test_db(temp.path());
    let mut cmd = fixture(&db);
    let server = Arc::new(StdMutex::new(Server {
        fail_post: Some(Failure::RejectedBeforeWrite),
        ..Default::default()
    }));
    let current = account(transport(server.clone()));
    assert!(submit(&current, &db, &cmd)
        .await
        .unwrap_err()
        .contains("修正"));
    let id = pending(&db, &cmd)["body"]["clientSubmissionId"].clone();
    cmd["answers"]["q1"] = json!("C");
    submit(&current, &db, &cmd).await.unwrap();
    assert_eq!(
        server.lock().unwrap().submissions[1]["clientSubmissionId"],
        id
    );
    {
        let server = server.lock().unwrap();
        assert_ne!(
            server.submissions[0]["parts"],
            server.submissions[1]["parts"]
        );
    }

    let cmd = fixture(&db);
    server.lock().unwrap().accepted = None;
    server.lock().unwrap().lose_receipt = true;
    assert!(submit(&current, &db, &cmd).await.is_err());
    let mut old = pending(&db, &cmd);
    old.as_object_mut().unwrap().remove("command");
    old.as_object_mut().unwrap().remove("rejected_before_write");
    db.with_conn(|c| {
        settings::upsert_setting(
            c,
            NS,
            &format!("submit-v1-{}", cmd["attemptId"].as_str().unwrap()),
            &old,
        )
    })
    .unwrap();
    submit(&current, &db, &cmd).await.unwrap();
}

#[tokio::test]
async fn background_catalog_does_not_block_open_or_submit_and_discards_stale_results() {
    let _cache = PROVIDER_CACHE.lock().await;
    for expire_background in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let db = test_db(temp.path());
        let cmd = fixture(&db);
        let server = Arc::new(StdMutex::new(Server::default()));
        let foreground = transport(server);
        let entered = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let (seen, gate) = (entered.clone(), release.clone());
        let api = test_transport::Transport::new(move |path, body| {
            let (seen, gate, foreground) = (seen.clone(), gate.clone(), foreground.clone());
            async move {
                if path == "/practice/v1/runtime-mode" {
                    seen.notify_one();
                    gate.notified().await;
                    if expire_background {
                        return Err(Failure::Expired);
                    }
                    return Ok(json!({"code":200,"data":{"effectiveMode":"online"}}));
                }
                if path.contains("albums") {
                    return Ok(json!({"code":200,"data":{"list":[]}}));
                }
                if path.ends_with("feature-entitlements") {
                    return Ok(json!({"code":200,"data":{}}));
                }
                foreground.request(&path, body.as_ref()).await
            }
        });
        let current = account(api.clone());
        let key = format!(
            "catalog-v1-{}",
            hex::encode(sha2::Sha256::digest(b"account-01"))
        );
        db.with_conn(|c|settings::upsert_setting(c,NS,&key,&json!([{"id":"unit-01","title":"fixture","channel":"reading","parts":["P1"],"available":true}]))).unwrap();
        catalog::library(&current, &db, false).await.unwrap();
        let background = catalog::library(&current, &db, true);
        let interaction = async {
            entered.notified().await;
            tokio::time::timeout(
                Duration::from_secs(2),
                practice::open_unit(&current, &db, "unit-01".into(), "reading".into()),
            )
            .await
            .unwrap()
            .unwrap();
            tokio::time::timeout(Duration::from_secs(2), submit(&current, &db, &cmd))
                .await
                .unwrap()
                .unwrap();
            // Even re-login to the SAME owner must reject the previous generation.
            *current.0.lock().await = Some(session("account-01", api));
            release.notify_one();
        };
        let (result, ()) = tokio::join!(background, interaction);
        assert!(result.err().unwrap().contains("登录状态已变化"));
        assert!(current.0.lock().await.is_some());
        assert!(db
            .with_conn(|c| Ok(settings::get_setting(c, NS, &key)?
                .unwrap()
                .value
                .is_array()))
            .unwrap());
    }
}

#[tokio::test]
async fn delayed_renewal_cannot_block_foreground_or_restore_a_logged_out_session() {
    let _cache = PROVIDER_CACHE.lock().await;
    let temp = tempfile::tempdir().unwrap();
    let db = test_db(temp.path());
    let cmd = fixture(&db);
    let foreground = transport(Arc::new(StdMutex::new(Server::default())));
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let (seen, gate) = (entered.clone(), release.clone());
    let api = test_transport::Transport::new(move |path, body| {
        let (seen, gate, foreground) = (seen.clone(), gate.clone(), foreground.clone());
        async move {
            if path.ends_with("/renew") {
                seen.notify_one();
                gate.notified().await;
                return Ok(json!({"data":{"user":{"id":"account-01"},"token":"new"}}));
            }
            foreground.request(&path, body.as_ref()).await
        }
    });
    let current = account(api);
    let renewal = restore(&db, &current);
    let interaction = async {
        entered.notified().await;
        tokio::time::timeout(Duration::from_secs(2), submit(&current, &db, &cmd))
            .await
            .unwrap()
            .unwrap();
        *current.0.lock().await = None;
        release.notify_one();
    };
    let (result, ()) = tokio::join!(renewal, interaction);
    assert!(result.err().unwrap().contains("登录状态已变化"));
    assert!(current.0.lock().await.is_none());
}
