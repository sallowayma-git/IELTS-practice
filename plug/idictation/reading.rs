//! Authenticated Academic reading, with Atlas-owned history and review.
use super::{
    exam::{self, Exam, Subject},
    service::{verify, Account, Session},
    transport,
};
use crate::app::state::{AppDb, AppPaths};
use ielts_db::{
    reading::{self, ReadingDraftCommand, ReadingSubmitCommand},
    settings, DbError,
};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use tauri::{AppHandle, Manager, State};

const PREFIX: &str = "idictation-reading-";
const PENDING: &str = "idictation.reading.pending";

#[derive(Default)]
pub(super) struct ReadingSession {
    catalog: HashSet<String>,
    active: Option<Active>,
}

struct Active {
    asset_id: String,
    exam: Exam,
    round: u64,
    revision: Value,
}

fn digest(value: &Value) -> String {
    hex::encode(Sha256::digest(value.to_string().as_bytes()))
}

fn pending_key(owner: &str, test: &str) -> String {
    digest(&json!([owner, test]))
}

fn owner(session: &Session) -> Result<&str, String> {
    session
        .owner
        .as_deref()
        .ok_or_else(|| "请先连接爱听写账号".into())
}

async fn fetch(app: &AppHandle, session: &mut Session, id: &str) -> Result<Value, String> {
    let raw = transport::read(app, "readingExam", json!({"testId":id})).await?;
    verify(app, session).await?;
    Ok(raw)
}

fn revision(raw: &Value) -> Value {
    json!([raw["practice_result"], raw["practice_result_shoudong"]])
}

fn draft_key(asset_id: &str) -> String {
    format!("draft:{asset_id}")
}

fn answer_digest(answers: &Value) -> Option<String> {
    let mut rows: Vec<_> = answers
        .as_array()?
        .iter()
        .map(|row| {
            let value = row["answer"].as_str().filter(|value| !value.is_empty());
            json!([row["id"], row["type"], row["group_id"], value, row["mark"]])
        })
        .collect();
    rows.sort_by_key(|row| row[0].as_u64().unwrap_or_default());
    Some(digest(&json!(rows)))
}

#[tauri::command]
pub async fn idictation_reading_catalog(
    app: AppHandle,
    account: State<'_, Account>,
) -> Result<Value, String> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let rows = transport::read(&app, "readingCatalog", json!({})).await?;
    verify(&app, &mut session).await?;
    let rows = rows
        .as_array()
        .filter(|r| r.len() <= 200)
        .ok_or("爱听写阅读目录格式异常")?;
    let mut grants = HashSet::new();
    let mut cards = Vec::new();
    for row in rows {
        let id = exam::number(row, "id")?.to_string();
        let title = row["title"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .ok_or("爱听写真题缺少标题")?;
        if !grants.insert(id.clone()) {
            return Err("爱听写目录存在重复套卷".into());
        }
        cards.push(json!({"testId":id,"title":title}));
    }
    session.reading.catalog = grants;
    Ok(json!(cards))
}

#[tauri::command]
pub async fn idictation_reading_open(
    app: AppHandle,
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    test_id: String,
) -> Result<String, String> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    if !session.reading.catalog.contains(&test_id) {
        return Err("请先从当前账号的爱听写目录选择套卷".into());
    }
    let raw = fetch(&app, &mut session, &test_id).await?;
    let exam = exam::convert(Subject::Reading, &test_id, &raw)?;
    let owner = owner(&session)?;
    let asset_id = format!(
        "{PREFIX}{}",
        digest(&json!([owner, test_id, exam.fingerprint]))
    );
    let mut payload = exam.payload.clone();
    payload["examId"] = json!(asset_id);
    payload["answerKey"] = json!(exam.official_answers);
    let paths = app.state::<AppPaths>();
    let dir = paths
        .app_data
        .join("providers")
        .join("idictation-reading-assets");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{asset_id}.json"));
    let bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    if !path.exists() {
        let staged = dir.join(format!("{}.tmp", uuid::Uuid::new_v4()));
        std::fs::write(&staged, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&staged, &path).map_err(|e| e.to_string())?;
    }
    db.with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let asset = reading::import_asset_payload(
            &tx,
            &payload,
            Some(path.to_string_lossy().into_owned()),
        )?;
        let draft = &raw["practice_result"];
        let current = reading::get_open_reading_draft(&tx, &asset.id)?;
        let saved_revision = settings::get_setting(&tx, PENDING, &draft_key(&asset.id))?;
        let local_matches_source = saved_revision.as_ref().is_some_and(|entry| {
            entry.value["revision"] == digest(&revision(&raw))
                || (draft["action"] == "自动保存"
                    && entry.value["round"] == draft["key"]
                    && answer_digest(&draft["answer"])
                        .is_some_and(|hash| entry.value["answers"] == hash))
        });
        if current.is_some()
            && !local_matches_source
            && saved_revision
                .as_ref()
                .is_some_and(|entry| entry.value["unconfirmed"] == true)
            && settings::get_setting(&tx, PENDING, &pending_key(owner, &test_id))?.is_none()
        {
            return Err(DbError::Validation(
                "本机草稿尚未同步，原站记录也已变化。本机草稿已保留".into(),
            ));
        }
        if draft["action"] == "自动保存"
            && !(current.is_some() && local_matches_source)
            && settings::get_setting(&tx, PENDING, &pending_key(owner, &test_id))?.is_none()
        {
            let (answers, marks) =
                resume_answers(&exam, owner, draft).map_err(DbError::Validation)?;
            let attempt_id = current
                .map(|a| a.id)
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let now = chrono::Utc::now().timestamp_millis();
            let elapsed = draft["duration"]
                .as_u64()
                .filter(|n| *n <= 604800)
                .ok_or_else(|| DbError::Validation("爱听写草稿计时无效".into()))?;
            let mut timer =
                ielts_db::modes::timer::TimerState::new_suite(now - elapsed as i64 * 1000);
            timer.source = "idictation".into();
            timer.running = false;
            timer.paused_at_ms = Some(now);
            reading::save_reading_draft_in_transaction(
                &tx,
                &ReadingDraftCommand {
                    attempt_id,
                    asset_id: asset.id,
                    asset_revision: Some(asset.schema_version),
                    asset_fingerprint: Some(asset.fingerprint),
                    answers: Value::Object(answers),
                    marked_questions: marks,
                    question_timeline: vec![],
                    title_snapshot: None,
                    timer_snapshot: Some(timer),
                    idempotency_key: uuid::Uuid::new_v4().to_string(),
                },
            )?;
        }
        tx.commit()?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    session.reading.active = Some(Active {
        asset_id: asset_id.clone(),
        exam,
        revision: revision(&raw),
        round: chrono::Utc::now().timestamp_millis() as u64,
    });
    Ok(asset_id)
}

fn resume_answers(
    exam: &Exam,
    owner: &str,
    draft: &Value,
) -> Result<(Map<String, Value>, Vec<String>), String> {
    check_result_identity(exam, owner, draft)?;
    let rows = exam::rows(draft, "answer")?;
    if rows.len() != exam.questions.len() {
        return Err("爱听写草稿题数不完整".into());
    }
    let mut answers = Map::new();
    let mut marks = Vec::new();
    for row in rows {
        let q = exam
            .questions
            .iter()
            .find(|q| {
                row["id"] == q.source_id
                    && row["group_id"] == q.group_id
                    && row["type"] == q.source_type
            })
            .ok_or("爱听写草稿题目身份不一致")?;
        let answer = row
            .get("answer")
            .filter(|v| v.is_null() || v.is_string())
            .ok_or("爱听写草稿答案格式无效")?;
        let answer = if answer.as_str() == Some("") {
            Value::Null
        } else {
            answer.clone()
        };
        if answers.insert(q.key.clone(), answer).is_some() {
            return Err("爱听写草稿含重复题目".into());
        }
        if row["mark"].as_bool().ok_or("爱听写草稿标记格式无效")? {
            marks.push(q.key.clone());
        }
    }
    Ok((answers, marks))
}

fn check_result_identity(exam: &Exam, owner: &str, record: &Value) -> Result<(), String> {
    if !record.is_object() {
        return Err("原站暂未返回本次作答记录，本机草稿已保留".into());
    }
    if super::vocabulary::id(&record["user_id"]).as_deref() != Ok(owner) {
        return Err("爱听写回读记录的账号不一致或缺失".into());
    }
    if super::vocabulary::id(&record["jianya_test_id"]).as_deref() != Ok(exam.test_id.as_str()) {
        return Err("爱听写回读记录的套卷身份不一致或缺失".into());
    }
    Ok(())
}

async fn checked(app: &AppHandle, session: &mut Session, asset_id: &str) -> Result<Value, String> {
    verify(app, session).await?;
    let test = session
        .reading
        .active
        .as_ref()
        .filter(|a| a.asset_id == asset_id)
        .ok_or("请从爱听写题库重新打开这套题")?
        .exam
        .test_id
        .clone();
    fetch(app, session, &test).await
}

#[tauri::command]
pub async fn idictation_reading_save(
    app: AppHandle,
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    cmd: ReadingDraftCommand,
) -> Result<ielts_domain::dto::AttemptRecord, String> {
    let mut session = account.0.lock().await;
    let raw = checked(&app, &mut session, &cmd.asset_id).await?;
    let account_owner = owner(&session)?.to_owned();
    let active = session.reading.active.as_mut().ok_or("爱听写会话已失效")?;
    if exam::convert(Subject::Reading, &active.exam.test_id, &raw)?.fingerprint
        != active.exam.fingerprint
    {
        return Err("原站题目已变化，请重新打开".into());
    }
    let duration = cmd
        .timer_snapshot
        .as_ref()
        .map(|t| t.elapsed_seconds(chrono::Utc::now().timestamp_millis()))
        .unwrap_or(0);
    let request = build(active, &cmd.answers, &cmd.marked_questions, duration, false)?;
    let submitted = json!({"user_id":account_owner,"jianya_test_id":active.exam.test_id.parse::<u64>().ok(),"answer":request["answer"]});
    let expected = resume_answers(&active.exam, &account_owner, &submitted)?;
    let record = db
        .with_conn(|conn| {
            if settings::get_setting(
                conn,
                PENDING,
                &pending_key(&account_owner, &active.exam.test_id),
            )?
            .is_some()
            {
                return Err(DbError::Validation(
                    "存在待核对的交卷，请先核对官方结果".into(),
                ));
            }
            if revision(&raw) != active.revision {
                return Err(DbError::Validation(
                    "原站草稿已变化，请返回题库重新打开".into(),
                ));
            }
            let tx = conn.unchecked_transaction()?;
            let record = reading::save_reading_draft_in_transaction(&tx, &cmd)?;
            settings::upsert_setting(
                &tx,
                PENDING,
                &draft_key(&active.asset_id),
                &json!({
                    "revision": digest(&active.revision),
                    "round":request["key"].to_string(),
                "answers":answer_digest(&request["answer"]),
                    "unconfirmed":true
                }),
            )?;
            tx.commit()?;
            Ok(record)
        })
        .map_err(|e| e.to_string())?;
    transport::read(
        &app,
        "readingSubmit",
        json!({"expectedOwner":account_owner,"request":request}),
    )
    .await?;
    let latest = checked(&app, &mut session, &cmd.asset_id).await?;
    let saved = &latest["practice_result"];
    let active = session.reading.active.as_mut().ok_or("爱听写会话已失效")?;
    tracing::debug!(
        record_present = saved.is_object(),
        owner_matches = super::vocabulary::id(&saved["user_id"]).as_deref() == Ok(account_owner.as_str()),
        test_matches = super::vocabulary::id(&saved["jianya_test_id"]).as_deref() == Ok(active.exam.test_id.as_str()),
        draft_action = saved["action"] == "自动保存",
        round_matches = saved["key"] == request["key"].to_string(),
        "idictation reading draft readback"
    );
    let (answers, marks) = resume_answers(&active.exam, &account_owner, saved)?;
    if saved["action"] != "自动保存"
        || saved["key"] != request["key"].to_string()
        || answers != expected.0
        || marks.into_iter().collect::<HashSet<_>>() != expected.1.into_iter().collect()
    {
        return Err("爱听写草稿回读未确认，请重新打开检查进度".into());
    }
    active.revision = revision(&latest);
    db.with_conn(|conn| {
        settings::upsert_setting(
            conn,
            PENDING,
            &draft_key(&cmd.asset_id),
            &json!({"revision":digest(&active.revision),"unconfirmed":false}),
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    Ok(record)
}

fn build(
    active: &Active,
    answers: &Value,
    marks: &[String],
    duration: u64,
    finish: bool,
) -> Result<Value, String> {
    exam::submission(
        &active.exam,
        answers.as_object().ok_or("作答格式无效")?,
        &marks.iter().cloned().collect(),
        active.round,
        duration,
        finish,
    )
}

#[tauri::command]
pub async fn idictation_reading_submit(
    app: AppHandle,
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    cmd: ReadingSubmitCommand,
) -> Result<Value, String> {
    let mut session = account.0.lock().await;
    let raw = checked(&app, &mut session, &cmd.asset_id).await?;
    let account_owner = owner(&session)?.to_owned();
    let active = session.reading.active.as_ref().ok_or("爱听写会话已失效")?;
    if exam::convert(Subject::Reading, &active.exam.test_id, &raw)?.fingerprint
        != active.exam.fingerprint
    {
        return Err("原站题目已变化，请重新打开".into());
    }
    let pending = pending_key(&account_owner, &active.exam.test_id);
    let (request, send) = db
        .with_conn(|conn| {
            let tx = conn.unchecked_transaction()?;
            if let Some(entry) = settings::get_setting(&tx, PENDING, &pending)? {
                if entry.value["attemptId"] != cmd.attempt_id
                    || entry.value["assetId"] != cmd.asset_id
                {
                    return Err(DbError::Validation("请从原草稿恢复待核对的交卷".into()));
                }
                return Ok((entry.value["request"].clone(), false));
            }
            let asset = ielts_db::get_practice_asset(&tx, &cmd.asset_id)?;
            if cmd.asset_fingerprint.as_deref() != Some(&asset.fingerprint)
                || revision(&raw) != active.revision
            {
                return Err(DbError::Validation(
                    "题目或原站草稿已变化，请返回题库重新打开".into(),
                ));
            }
            let request = build(
                active,
                &cmd.answers,
                &cmd.marked_questions,
                cmd.duration_ms.unwrap_or(0) / 1000,
                true,
            )
            .map_err(DbError::Validation)?;
            reading::save_reading_draft_in_transaction(
                &tx,
                &ReadingDraftCommand {
                    attempt_id: cmd.attempt_id.clone(),
                    asset_id: cmd.asset_id.clone(),
                    answers: cmd.answers.clone(),
                    marked_questions: cmd.marked_questions.clone(),
                    question_timeline: cmd.question_timeline.clone(),
                    asset_revision: cmd.asset_revision,
                    asset_fingerprint: cmd.asset_fingerprint.clone(),
                    title_snapshot: cmd.title_snapshot.clone(),
                    timer_snapshot: None,
                    idempotency_key: uuid::Uuid::new_v4().to_string(),
                },
            )?;
            settings::upsert_setting(
                &tx,
                PENDING,
                &pending,
                &json!({"assetId":cmd.asset_id,"attemptId":cmd.attempt_id,"request":request}),
            )?;
            tx.commit()?;
            Ok((request, true))
        })
        .map_err(|e| e.to_string())?;
    let result = if send {
        // The remote write is never replayed. Even if its reply is lost,
        // the authoritative result can still be read and reconciled.
        let _ = transport::read(
            &app,
            "readingSubmit",
            json!({"expectedOwner":account_owner,"request":request}),
        )
        .await;
        checked(&app, &mut session, &cmd.asset_id).await?
    } else {
        raw
    };
    let active = session.reading.active.as_ref().ok_or("爱听写会话已失效")?;
    let current = exam::convert(Subject::Reading, &active.exam.test_id, &result)?;
    if current.fingerprint != active.exam.fingerprint {
        return Err("原站题目已变化，待核对交卷已保留".into());
    }
    let mut verified = exam::result::verify_reading(
        &active.exam,
        &account_owner,
        &cmd.asset_id,
        &request,
        &result["practice_result_shoudong"],
    )
    .map_err(|e| format!("爱听写交卷待核对，未重复发送。{e}"))?;
    let comparisons:Vec<_> = verified.attempt.answers.iter().map(|answer| json!({
        "questionId":answer.question_id,"userAnswer":answer.answer,"correctAnswer":verified.official_answers[&answer.question_id],
        "isCorrect":answer.is_correct,"weight":answer.weight,"questionKind":answer.question_kind
    })).collect();
    let correct = verified.attempt.correct_count.unwrap_or(0.0);
    let total = verified.attempt.question_count.unwrap_or(0);
    let ratio = verified.attempt.score_value.unwrap_or(0.0);
    db.with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let asset = ielts_db::get_practice_asset(&tx, &cmd.asset_id)?;
        let draft = reading::get_open_reading_draft(&tx, &cmd.asset_id)?;
        if let Some(draft) = draft.filter(|d| d.id == cmd.attempt_id) {
            verified.attempt.id = draft.id;
            verified.attempt.started_at = draft.started_at;
            for answer in &mut verified.attempt.answers {
                if let Some(row) = draft
                    .answers
                    .iter()
                    .find(|a| a.question_id == answer.question_id && a.answer == answer.answer)
                {
                    answer.visit_count = row.visit_count;
                    answer.change_count = row.change_count;
                    answer.elapsed_ms = row.elapsed_ms;
                    answer.answered_at = row.answered_at.clone();
                }
            }
        }
        ielts_db::persist_completed_attempt(&tx, &verified.attempt, &asset.fingerprint)?;
        settings::delete_setting(&tx, PENDING, &pending)?;
        settings::delete_setting(&tx, PENDING, &draft_key(&cmd.asset_id))?;
        ielts_db::history::prune_terminal_attempts_in_transaction(&tx)?;
        tx.commit()?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    session.reading.active = None;
    Ok(
        json!({"attempt":verified.attempt,"score":{"correct":correct,"total":total,"accuracy":ratio,"percentage":ratio*100.0},
        "comparisons":comparisons,"review":{"answerKey":verified.official_answers}}),
    )
}

#[tauri::command]
pub fn idictation_reading_review(
    db: State<'_, AppDb>,
    asset_id: String,
    attempt_id: String,
) -> Result<Value, String> {
    db.with_conn(|conn| {
        let detail = ielts_db::get_history_detail(conn, &attempt_id)?;
        if !asset_id.starts_with(PREFIX)
            || detail.attempt.asset_id.as_deref() != Some(&asset_id)
            || detail.attempt.status != ielts_domain::AttemptStatus::Completed
        {
            return Err(DbError::Validation("练习记录与爱听写真题不一致".into()));
        }
        let loaded = reading::load_practice_asset_payload(conn, &asset_id)?;
        Ok(json!({"answerKey":loaded.payload["answerKey"]}))
    })
    .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "../../developer/tests/rust/idictation_reading_flow.rs"]
mod tests;
