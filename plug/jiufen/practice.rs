use crate::app::state::AppDb;
use ielts_db::{settings, DbError};
use ielts_domain::{
    domain::{Activity, AssetSourceKind, AttemptMode, AttemptStatus, ScoreScale},
    dto::{AttemptAnswer, AttemptRecord, PracticeAssetV2, PracticeAssetV2Payload},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tauri::State;

use super::{
    catalog::{fetch_unit, media_url},
    native::{array, exam, plain, section, string, SourceQuestion},
    service::{authorized, identifier, question_analyses, Account, NS},
};

#[path = "remote.rs"]
mod remote;
pub(crate) use remote::{migrate_local_records, prepare_coach_context};

const PREFIX: &str = "jiufen-native-";

#[tauri::command]
pub async fn jiufen_study_material(
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    asset_id: String,
    channel: String,
    attempt_id: Option<String>,
) -> Result<Value, String> {
    let loaded = load(&db, &asset_id, &channel)?;
    if let Some(attempt) = &attempt_id {
        db.with_conn(|conn| {
            let detail = ielts_db::get_history_detail(conn, attempt)?;
            if detail.attempt.asset_id.as_deref() != Some(asset_id.as_str())
                || detail.attempt.status != AttemptStatus::Completed
            {
                return Err(DbError::Validation("复盘与题目不匹配".into()));
            }
            Ok(())
        })
        .map_err(|e| e.to_string())?;
    }
    let mut session = account.0.lock().await;
    check_owner(
        &loaded.asset,
        &session.as_ref().ok_or("请先登录九分学长")?.owner,
    )?;
    let key = format!("{asset_id}:{}", attempt_id.as_deref().unwrap_or("practice"));
    let mut material = session
        .as_ref()
        .unwrap()
        .materials
        .get(&key)
        .cloned()
        .unwrap_or_else(|| loaded.payload["studyMaterial"].clone());
    let complete = |value: &Value| {
        value["version"] == 1
            && !array(value, "parts").is_empty()
            && array(value, "parts")
                .iter()
                .all(|p| p["translationStatus"] == "ready")
            && (attempt_id.is_none() || value["analysesComplete"] == true)
    };
    if complete(&material) {
        return Ok(material);
    }
    let requests = array(&material, "parts")
        .iter()
        .filter(|p| p["translationStatus"] != "ready")
        .filter_map(|p| identifier(&p["id"]))
        .map(|id| {
            (
                id.clone(),
                format!("/practice/v1/parts/{id}/sentence-translations?locale=zh-CN"),
            )
        })
        .collect();
    let translations =
        question_analyses(session.as_ref().ok_or("请先登录九分学长")?, requests).await;
    for (id, response) in translations {
        super::material::translations(&mut material, &id, &response);
    }
    if attempt_id.is_some() && material["analysesComplete"] != true {
        let questions: Vec<SourceQuestion> =
            serde_json::from_value(loaded.payload["jiufen"]["questions"].clone())
                .map_err(|_| "本机题源映射损坏")?;
        let requests = analysis_requests(&questions);
        let analyses = question_analyses(
            session.as_ref().ok_or("请先登录九分学长")?,
            requests.clone(),
        )
        .await;
        material["analysesComplete"] = json!(analyses.len() == requests.len());
        for q in &questions {
            if let Some(response) = analyses.get(&q.key) {
                let row = response.get("question").unwrap_or(response);
                material["questions"][&q.key] =
                    super::material::question(&material, &q.part_id, row);
            }
        }
    }
    let ready = complete(&material);
    let cache = &mut session.as_mut().ok_or("请先登录九分学长")?.materials;
    if cache.len() >= 16 {
        cache.clear();
    }
    cache.insert(key, material.clone());
    if !ready {
        return Err("部分原文翻译或解析加载失败，请重试".into());
    }
    if attempt_id.is_none() {
        material["questions"] = json!({});
    }
    Ok(material)
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn owner_scope(owner: &str) -> String {
    digest(owner.as_bytes())
}

fn activity(value: &str) -> Result<Activity, String> {
    match value {
        "reading" => Ok(Activity::Reading),
        "listening" => Ok(Activity::Listening),
        _ => Err("不支持该科目".into()),
    }
}

fn load(db: &AppDb, asset_id: &str, channel: &str) -> Result<PracticeAssetV2Payload, String> {
    if !asset_id.starts_with(PREFIX) {
        return Err("题目不属于九分学长".into());
    }
    let activity = activity(channel)?;
    db.with_conn(|conn| {
        if activity == Activity::Listening {
            ielts_db::listening::assets::load_listening_payload(conn, asset_id)
        } else {
            ielts_db::reading::load_practice_asset_payload(conn, asset_id)
        }
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn jiufen_open_unit(
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    unit_id: String,
    channel: String,
) -> Result<String, String> {
    let mut session = account.0.lock().await;
    let owner = owner_scope(&session.as_ref().ok_or("请先登录九分学长")?.owner);
    let activity = activity(&channel)?;
    let unit = fetch_unit(&mut session, &unit_id).await?;
    if unit["channel"] != channel {
        return Err("题目科目不匹配".into());
    }
    let mut payload = exam(&unit)?;
    let core = remote::source_fingerprint(&payload);
    let existing = db.with_conn(|conn| {
        use rusqlite::OptionalExtension;
        Ok(conn.query_row("SELECT id FROM practice_assets WHERE source_key=?1 AND json_extract(metadata_json,'$.jiufenOwner')=?2 AND json_extract(metadata_json,'$.sourceFingerprint')=?3 ORDER BY created_at,id LIMIT 1",
            (&unit_id,&owner,&core),|row|row.get::<_,String>(0)).optional()?)
    }).map_err(|e|e.to_string())?;
    let asset_id = existing.unwrap_or_else(|| {
        format!(
            "{PREFIX}{}",
            digest(json!([owner, core]).to_string().as_bytes())
        )
    });
    payload["examId"] = json!(asset_id);
    let mut asset = PracticeAssetV2 {
        schema_version: PracticeAssetV2::SCHEMA_VERSION,
        id: asset_id.clone(),
        activity,
        source_kind: AssetSourceKind::Imported,
        source_key: Some(unit_id),
        title: string(&unit, "title").into(),
        category: payload["meta"]["category"].as_str().map(str::to_owned),
        difficulty: None,
        frequency: None,
        content_ref: None,
        fingerprint: ielts_db::reading::fingerprint_payload(&payload),
        pdf_only: false,
        metadata: Some(remote::metadata(&payload, &owner)),
    };
    db.with_conn(|conn| {
        if let Ok(previous) = ielts_db::get_practice_asset(conn, &asset_id) {
            asset.fingerprint = previous.fingerprint;
        }
        ielts_db::transient_assets::put(conn, "jiufen", &asset_id, payload.clone())?;
        ielts_db::reading::upsert_practice_asset(conn, &asset)
    })
    .map_err(|e| e.to_string())?;
    Ok(asset_id)
}

fn check_owner(asset: &PracticeAssetV2, owner: &str) -> Result<(), String> {
    if asset
        .metadata
        .as_ref()
        .and_then(|m| m["jiufenOwner"].as_str())
        != Some(owner_scope(owner).as_str())
    {
        return Err("请使用打开这道题时的九分学长账号".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn jiufen_listening_audio(
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    asset_id: String,
) -> Result<Map<String, Value>, String> {
    let loaded = load(&db, &asset_id, "listening")?;
    let mut session = account.0.lock().await;
    check_owner(
        &loaded.asset,
        &session.as_ref().ok_or("请先登录九分学长")?.owner,
    )?;
    let unit_id = loaded.asset.source_key.as_deref().ok_or("缺少题源标识")?;
    // Refresh URLs on open because the media service may issue temporary URLs.
    let unit = fetch_unit(&mut session, unit_id).await?;
    let mut urls = Map::new();
    for (index, part) in array(&unit, "parts").iter().enumerate() {
        if let Some(url) = media_url(string(part, "audioUrl")) {
            urls.insert(section(part, index).to_string(), json!(url));
        }
    }
    Ok(urls)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Submit {
    asset_id: String,
    attempt_id: String,
    channel: String,
    answers: Map<String, Value>,
    marked_questions: Vec<String>,
    duration_ms: Option<u64>,
    #[serde(default)]
    question_timeline: Vec<ielts_db::reading::ReadingQuestionProgress>,
}

#[derive(Deserialize, Serialize)]
struct Pending {
    asset_id: String,
    body: Value,
    receipt: Option<String>,
}

fn submission(unit: &str, questions: &[SourceQuestion], cmd: &Submit) -> Result<Value, String> {
    let mut parts: Vec<Value> = Vec::new();
    for q in questions {
        let answer = match cmd.answers.get(&q.key) {
            None | Some(Value::Null) => String::new(),
            Some(Value::String(value)) => value.trim().to_owned(),
            Some(Value::Array(values)) if q.group_type == "multiple-choice" => values
                .iter()
                .map(|v| v.as_str().ok_or("多选答案格式错误"))
                .collect::<Result<Vec<_>, _>>()?
                .join(","),
            _ => return Err(format!("第 {} 题的作答格式不受支持", q.number)),
        };
        if !answer.is_empty()
            && !q.choices.is_empty()
            && answer.split(',').any(|v| !q.choices.iter().any(|c| c == v))
        {
            return Err(format!("第 {} 题的选项无效", q.number));
        }
        if parts.last().is_none_or(|p| p["id"] != q.part_id) {
            parts.push(json!({"id":q.part_id,"groups":[]}));
        }
        let groups = parts.last_mut().unwrap()["groups"].as_array_mut().unwrap();
        if groups.last().is_none_or(|g| g["id"] != q.group_id) {
            groups.push(json!({"id":q.group_id,"type":q.group_type,"questions":[]}));
        }
        groups.last_mut().unwrap()["questions"].as_array_mut().unwrap().push(json!({
            "id":q.question_id,"qNumber":q.number,"userAnswer":answer,"bookmarked":cmd.marked_questions.contains(&q.key)
        }));
    }
    Ok(json!({"unitId":unit,"channel":cmd.channel,"parts":parts,
        "annotationSnapshot":{"version":1,"annotations":[]},"clientSubmissionId":uuid::Uuid::new_v4()}))
}

fn same_identifier(v: &Value, expected: &str) -> bool {
    identifier(v).as_deref() == Some(expected)
}

fn scoped_key(prefix: &str, attempt: &str) -> Result<String, String> {
    if identifier(&json!(attempt)).is_none() {
        return Err("本机作答编号无效".into());
    }
    Ok(format!("{prefix}-{attempt}"))
}

fn load_setting(db: &AppDb, key: &str) -> Result<Option<Value>, String> {
    db.with_conn(|conn| settings::get_setting(conn, NS, key))
        .map(|entry| entry.map(|e| e.value))
        .map_err(|e| e.to_string())
}

fn save_setting(db: &AppDb, key: &str, value: &Value) -> Result<(), String> {
    db.with_conn(|conn| settings::upsert_setting(conn, NS, key, value).map(|_| ()))
        .map_err(|e| e.to_string())
}

fn official_result(
    loaded: &PracticeAssetV2Payload,
    cmd: &Submit,
    questions: &[SourceQuestion],
    pending: &Pending,
    owner: &str,
    data: &Value,
    analyses: &HashMap<String, Value>,
) -> Result<(AttemptRecord, Value, Value), String> {
    let meta = &data["attempt"];
    let unit = string(&pending.body, "unitId");
    let receipt = pending.receipt.as_deref().ok_or("缺少交卷回执")?;
    if !same_identifier(&meta["id"], receipt)
        || !same_identifier(&meta["unitId"], unit)
        || !same_identifier(&meta["userId"], owner)
        || meta["status"] != "submitted"
    {
        return Err("官方复盘与本次交卷不匹配".into());
    }
    let mut expected = HashMap::new();
    for part in array(&pending.body, "parts") {
        for group in array(part, "groups") {
            for q in array(group, "questions") {
                expected.insert(
                    (
                        string(part, "id"),
                        string(group, "id"),
                        string(q, "qNumber"),
                    ),
                    string(q, "userAnswer"),
                );
            }
        }
    }
    let mut rows = HashMap::new();
    for row in array(data, "details") {
        let key = (
            string(row, "partId"),
            string(row, "questionGroupId"),
            string(row, "qNumber"),
        );
        if rows.insert(key, row).is_some() {
            return Err("官方复盘包含重复题目".into());
        }
    }
    let mut keys = Map::new();
    let mut explanations = Map::new();
    let mut reading_notes = Vec::new();
    let mut comparisons = Vec::new();
    let mut answers = Vec::new();
    let mut correct = 0u64;
    for q in questions {
        let key = (q.part_id.as_str(), q.group_id.as_str(), q.number.as_str());
        let row = rows.remove(&key).ok_or("官方复盘缺少逐题结果")?;
        if !q.question_id.is_empty() && !same_identifier(&row["questionId"], &q.question_id) {
            return Err("官方复盘题目标识不匹配".into());
        }
        let answer = match &row["userAnswer"] {
            Value::Null => "",
            Value::String(answer) => answer,
            _ => return Err("官方作答值不受支持".into()),
        };
        if expected.get(&key).copied() != Some(answer) {
            return Err("官方复盘答案与交卷不匹配".into());
        }
        let score = row["score"].as_f64().ok_or("官方复盘缺少逐题分数")?;
        if !matches!(score, 0.0 | 1.0) {
            return Err("暂不支持该题的官方计分方式".into());
        }
        let is_correct = score == 1.0;
        correct += u64::from(is_correct);
        let right = row["rightAnswer"].clone();
        if !right.is_null() {
            keys.insert(q.key.clone(), right.clone());
        }
        let remote = analyses
            .get(&q.key)
            .map(|entry| entry.get("question").unwrap_or(entry));
        let explanation = remote
            .map(explanation)
            .filter(|text| !text.is_empty())
            .unwrap_or_else(|| explanation(row));
        if !explanation.is_empty() {
            explanations.insert(q.key.clone(), json!(explanation));
            reading_notes.push(json!({"questionId":q.key,"questionNumber":q.number.parse::<u32>().ok(),"text":explanation}));
        }
        comparisons.push(json!({"questionId":q.key,"userAnswer":answer,"correctAnswer":right,"isCorrect":is_correct,"weight":1.0,"matchMode":"single"}));
        answers.push(AttemptAnswer {
            question_id: q.key.clone(),
            answer: json!(answer),
            is_correct: Some(is_correct),
            marked: row["bookmarked"].as_bool().unwrap_or(false),
            question_kind: Some(q.kind.clone()),
            weight: 1.0,
            change_count: 0,
            visit_count: 0,
            elapsed_ms: 0,
            answered_at: None,
        });
    }
    let total = questions.len() as u64;
    if !rows.is_empty()
        || meta["totalCount"].as_u64() != Some(total)
        || meta["correctCount"].as_u64() != Some(correct)
    {
        return Err("官方逐题得分与汇总不匹配".into());
    }
    let review_explanations = if loaded.asset.activity == Activity::Reading {
        json!({"questionExplanations":[{"sectionTitle":"官方解析","items":reading_notes}]})
    } else {
        json!(explanations)
    };
    let review = json!({"answerKey":keys,"reviewExplanations":review_explanations});
    let submitted_at = meta["submittedAt"]
        .as_str()
        .ok_or("官方复盘缺少交卷时间")?
        .to_string();
    let ratio = correct as f64 / total as f64;
    let record = AttemptRecord {
        schema_version: AttemptRecord::SCHEMA_VERSION,
        id: cmd.attempt_id.clone(),
        activity: loaded.asset.activity,
        asset_id: Some(loaded.asset.id.clone()),
        mode: AttemptMode::Single,
        suite_id: None,
        status: AttemptStatus::Completed,
        started_at: meta["createdAt"].as_str().unwrap_or(&submitted_at).into(),
        submitted_at: Some(submitted_at.clone()),
        completed_at: Some(submitted_at),
        duration_ms: meta["elapsedSeconds"]
            .as_u64()
            .and_then(|n| n.checked_mul(1000))
            .or(cmd.duration_ms)
            .unwrap_or(0),
        score_value: Some(ratio),
        score_scale: Some(ScoreScale::Ratio),
        correct_count: Some(correct as f64),
        question_count: Some(total as u32),
        title_snapshot: Some(loaded.asset.title.clone()),
        prompt_snapshot: None,
        content_text: None,
        task_type: None,
        answers,
        annotations: vec![],
    };
    let result = json!({"attempt":record,"score":{"correct":correct,"total":total,"accuracy":ratio,"percentage":(ratio*1000.0).round()/10.0},
        "comparisons":comparisons,"review":review});
    Ok((record, review, result))
}

fn explanation(row: &Value) -> String {
    let structured = ["analysisList", "analyses"]
        .iter()
        .flat_map(|key| array(row, key))
        .filter_map(|entry| {
            let text = entry.as_str().map(plain).or_else(|| {
                ["analysisText", "analysis", "content", "text"]
                    .iter()
                    .map(|key| plain(string(entry, key)))
                    .find(|s| !s.is_empty())
            })?;
            if text.is_empty() {
                return None;
            }
            let label = ["labelsOne", "labelsTwo"]
                .iter()
                .map(|key| plain(string(entry, key)))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
            Some(if label.is_empty() {
                text
            } else {
                format!("{label}　{text}")
            })
        })
        .collect::<Vec<_>>();
    if !structured.is_empty() {
        return structured.join("\n");
    }
    ["analysisText", "analysis", "explanation"]
        .iter()
        .map(|k| plain(string(row, k)))
        .find(|s| !s.is_empty())
        .unwrap_or_default()
}

fn analysis_requests(questions: &[SourceQuestion]) -> Vec<(String, String)> {
    questions
        .iter()
        .filter(|q| !q.question_id.is_empty())
        .map(|q| {
            (
                q.key.clone(),
                format!(
                    "/practice/v1/question-analysis?questionId={}&partId={}&groupId={}",
                    q.question_id, q.part_id, q.group_id
                ),
            )
        })
        .collect()
}

#[tauri::command]
pub async fn jiufen_submit(
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    cmd: Submit,
) -> Result<Value, String> {
    let loaded = load(&db, &cmd.asset_id, &cmd.channel)?;
    let mut session = account.0.lock().await;
    let owner = session.as_ref().ok_or("请先登录九分学长")?.owner.clone();
    check_owner(&loaded.asset, &owner)?;
    let pending_key = scoped_key("submit-v1", &cmd.attempt_id)?;

    db.with_conn(|conn| {
        let clash:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM attempts WHERE id=?1 AND (asset_id IS NOT ?2 OR activity IS NOT ?3 OR mode != 'single'))",
            (&cmd.attempt_id,&cmd.asset_id,&cmd.channel),|r|r.get(0))?;
        if clash {return Err(DbError::Validation("作答编号已用于另一条记录".into()));}
        Ok(())
    }).map_err(|e|e.to_string())?;
    if remote::completed(&db, &cmd.attempt_id)? {
        let mut result = remote::review(&db, &mut session, &loaded, &cmd.attempt_id).await?;
        result["idempotentReplay"] = json!(true);
        return Ok(result);
    }
    let unit = loaded.asset.source_key.as_deref().ok_or("缺少题源标识")?;
    let questions: Vec<SourceQuestion> =
        serde_json::from_value(loaded.payload["jiufen"]["questions"].clone())
            .map_err(|_| "本机题源映射损坏")?;
    let frozen: Pending = match load_setting(&db, &pending_key)? {
        Some(value) => serde_json::from_value(value).map_err(|_| "本机交卷状态损坏")?,
        None => {
            let mut frozen = Pending {
                asset_id: cmd.asset_id.clone(),
                body: submission(unit, &questions, &cmd)?,
                receipt: None,
            };
            let draft = ielts_db::reading::ReadingDraftCommand {
                attempt_id: cmd.attempt_id.clone(),
                asset_id: cmd.asset_id.clone(),
                answers: json!(cmd.answers),
                marked_questions: cmd.marked_questions.clone(),
                question_timeline: cmd.question_timeline.clone(),
                asset_revision: Some(loaded.asset.schema_version),
                asset_fingerprint: Some(loaded.asset.fingerprint.clone()),
                title_snapshot: Some(loaded.asset.title.clone()),
                timer_snapshot: None,
                idempotency_key: format!("jiufen-draft-{}", cmd.attempt_id),
            };
            db.with_conn(|conn| {
                if loaded.asset.activity == Activity::Listening {
                    ielts_db::save_listening_draft(conn, &draft)?;
                } else {
                    ielts_db::reading::save_reading_draft(conn, &draft)?;
                }
                Ok(())
            })
            .map_err(|e| e.to_string())?;
            save_setting(&db, &pending_key, &json!(frozen))?;
            let response = authorized(&mut session, "/practice/v1/attempts", Some(&frozen.body))
                .await
                .map_err(|e| {
                    format!(
                        "{e}。请核对交卷状态，提交编号 {}",
                        frozen.body["clientSubmissionId"]
                    )
                })?;
            frozen.receipt = ["resultId", "attemptId", "id"]
                .iter()
                .find_map(|field| identifier(&response["data"][field]));
            save_setting(&db, &pending_key, &json!(frozen))?;
            frozen
        }
    };
    if frozen.asset_id != cmd.asset_id {
        return Err("该作答编号已被使用".into());
    }
    let receipt = frozen.receipt.as_deref().ok_or_else(|| {
        format!(
            "交卷状态待确认，提交编号 {}",
            frozen.body["clientSubmissionId"]
        )
    })?;
    if identifier(&json!(receipt)).is_none() {
        return Err("本机回执损坏".into());
    }
    let response = authorized(
        &mut session,
        &format!("/practice/v1/results/{receipt}/review"),
        None,
    )
    .await?;
    // Validate the receipt and every answer before asking for any explanations.
    let (mut record, _, mut result) = official_result(
        &loaded,
        &cmd,
        &questions,
        &frozen,
        &owner,
        &response["data"],
        &HashMap::new(),
    )?;
    let analyses = question_analyses(
        session.as_ref().ok_or("请先登录九分学长")?,
        analysis_requests(&questions),
    )
    .await;
    if !analyses.is_empty() {
        (record, _, result) = official_result(
            &loaded,
            &cmd,
            &questions,
            &frozen,
            &owner,
            &response["data"],
            &analyses,
        )?;
    }
    db.with_conn(|conn| {
        let tx = conn.unchecked_transaction()?;
        let draft = ielts_db::get_history_detail(&tx, &cmd.attempt_id)?.attempt;
        for answer in &mut record.answers {
            if let Some(saved) = draft
                .answers
                .iter()
                .find(|a| a.question_id == answer.question_id)
            {
                answer.elapsed_ms = saved.elapsed_ms;
                answer.visit_count = saved.visit_count;
                answer.change_count = saved.change_count;
                answer.answered_at = saved.answered_at.clone();
            }
        }
        result["attempt"] = json!(record);
        ielts_db::persist_completed_attempt(&tx, &record, &loaded.asset.fingerprint)?;
        settings::upsert_setting(
            &tx,
            NS,
            &scoped_key("receipt-v2", &cmd.attempt_id).map_err(DbError::Validation)?,
            &json!({"assetId":cmd.asset_id,"receipt":receipt,"owner":owner_scope(&owner)}),
        )?;
        settings::delete_setting(&tx, NS, &pending_key)?;
        ielts_db::history::prune_terminal_attempts_in_transaction(&tx)?;
        tx.commit()?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub async fn jiufen_asset_payload(
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    asset_id: String,
) -> Result<PracticeAssetV2Payload, String> {
    let mut session = account.0.lock().await;
    remote::payload(&db, &mut session, &asset_id).await
}

#[tauri::command]
pub async fn jiufen_review(
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    asset_id: String,
    attempt_id: String,
) -> Result<Value, String> {
    let mut session = account.0.lock().await;
    let loaded = remote::payload(&db, &mut session, &asset_id).await?;
    let result = remote::review(&db, &mut session, &loaded, &attempt_id).await?;
    Ok(result["review"].clone())
}

#[cfg(test)]
#[path = "../../developer/tests/rust/jiufen_native.rs"]
mod tests;
