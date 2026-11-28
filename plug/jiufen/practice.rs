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
    service::{authorized, authorized_result, identifier, question_analyses, Account, Failure, NS},
};

#[path = "remote.rs"]
mod remote;
#[path = "listening_review.rs"]
mod listening_review;
pub(super) use listening_review::Entry as ListeningReviewEntry;
pub(crate) use remote::{migrate_local_records, prepare_coach_context};

const PREFIX: &str = "jiufen-native-";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftAsset {
    asset_id: String,
    title: String,
    updated_at: String,
}

#[tauri::command]
pub fn jiufen_draft_assets(db: State<'_, AppDb>, channel: String) -> Result<Vec<DraftAsset>, String> {
    draft_assets(&db, &channel)
}

pub(super) fn draft_assets(db: &AppDb, channel: &str) -> Result<Vec<DraftAsset>, String> {
    activity(channel)?;
    db.with_conn(|conn| {
        let mut query = conn.prepare(
            "SELECT p.id, p.title, MAX(a.updated_at) AS last_saved
             FROM attempts a JOIN practice_assets p ON p.id = a.asset_id
             WHERE a.activity = ?1 AND a.mode = 'single' AND a.suite_id IS NULL
               AND lower(a.status) IN ('draft', 'active')
               AND p.id LIKE 'jiufen-native-%'
               AND json_extract(p.metadata_json, '$.remoteProvider') = 'jiufen'
             GROUP BY p.id, p.title ORDER BY last_saved DESC, p.id",
        )?;
        let rows = query.query_map([channel], |row| Ok(DraftAsset {
            asset_id: row.get(0)?,
            title: row.get(1)?,
            updated_at: row.get(2)?,
        }))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn jiufen_study_material(
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    asset_id: String,
    channel: String,
    attempt_id: Option<String>,
    retry_missing: Option<bool>,
) -> Result<Value, String> {
    study_material(&account, &db, &asset_id, &channel, attempt_id.as_deref(), retry_missing.unwrap_or(false)).await
}

pub(super) async fn study_material(
    account: &Account,
    db: &AppDb,
    asset_id: &str,
    channel: &str,
    attempt_id: Option<&str>,
    retry_missing: bool,
) -> Result<Value, String> {
    let loaded = load(db, asset_id, channel)?;
    if let Some(attempt) = attempt_id {
        db.with_conn(|conn| {
            let detail = ielts_db::get_history_detail(conn, attempt)?;
            if detail.attempt.asset_id.as_deref() != Some(asset_id)
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
    if channel == "listening" {
        if let Some(attempt) = attempt_id {
            let questions = source_questions(&loaded)?;
            return Ok(listening_review::study(
                session.as_mut().unwrap(), &loaded, attempt, &questions, retry_missing,
            ).await);
        }
    }
    let key = format!("{asset_id}:{}", attempt_id.unwrap_or("practice"));
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
        let questions = source_questions(&loaded)?;
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
    open_unit(&account, &db, unit_id, channel).await
}

pub(super) async fn open_unit(
    account: &Account,
    db: &AppDb,
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
    // Refresh URLs on open because the media service may issue temporary URLs.
    let (unit, _) = remote::bound_unit(&mut session, &loaded.asset).await?;
    let mut urls = Map::new();
    for (index, part) in array(&unit, "parts").iter().enumerate() {
        if let Some(url) = media_url(string(part, "audioUrl")) {
            urls.insert(section(part, index).to_string(), json!(url));
        }
    }
    Ok(urls)
}

#[derive(Clone, Deserialize, Serialize)]
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

#[derive(Default, Deserialize, Serialize)]
struct Pending {
    asset_id: String,
    body: Value,
    receipt: Option<String>,
    #[serde(default)]
    command: Option<Submit>,
    #[serde(default)]
    rejected_before_write: bool,
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
        duration_ms: (loaded.asset.activity == Activity::Listening)
            .then_some(cmd.duration_ms)
            .flatten()
            .or_else(|| meta["elapsedSeconds"].as_u64().and_then(|n| n.checked_mul(1000)))
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

fn source_questions(loaded: &PracticeAssetV2Payload) -> Result<Vec<SourceQuestion>, String> {
    serde_json::from_value(loaded.payload["jiufen"]["questions"].clone())
        .map_err(|_| "本机题源映射损坏".into())
}

fn prepare_pending(
    db: &AppDb,
    loaded: &PracticeAssetV2Payload,
    cmd: &Submit,
    questions: &[SourceQuestion],
    unit: &str,
    pending_key: &str,
) -> Result<Pending, String> {
    let mut frozen: Pending = match load_setting(&db, &pending_key)? {
        Some(value) => serde_json::from_value(value).map_err(|_| "本机交卷状态损坏")?,
        None => Pending {
            asset_id: cmd.asset_id.clone(),
            body: submission(unit, &questions, &cmd)?,
            rejected_before_write: true,
            ..Default::default()
        },
    };
    if frozen.asset_id != cmd.asset_id
        || frozen.body["unitId"] != unit
        || frozen.body["channel"] != cmd.channel
    {
        return Err("该作答编号已被使用".into());
    }
    if identifier(&frozen.body["clientSubmissionId"]).is_none() {
        return Err("本机提交身份损坏，请保留作答并核对首次结果".into());
    }
    if frozen.rejected_before_write {
        let mut body = submission(unit, &questions, &cmd)?;
        body["clientSubmissionId"] = frozen.body["clientSubmissionId"].clone();
        frozen.body = body;
        frozen.command = Some(cmd.clone());
        frozen.rejected_before_write = false;
        frozen.receipt = None;
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
            idempotency_key: format!("jiufen-draft-{}", uuid::Uuid::new_v4()),
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
    }
    Ok(frozen)
}

async fn recover_receipt(
    db: &AppDb,
    session: &mut Option<super::service::Session>,
    frozen: &mut Pending,
    pending_key: &str,
) -> Result<(), String> {
    // The official client retries exactly this frozen body and submission ID.
    // Unknown outcomes (including lost responses) must never mint a new ID.
    if frozen.receipt.is_none() {
        let response = match authorized_result(session, "/practice/v1/attempts", Some(&frozen.body))
            .await
        {
            Ok(response) => response,
            Err(failure) => {
                if matches!(failure, Failure::RejectedBeforeWrite) {
                    frozen.rejected_before_write = true;
                    save_setting(db, &pending_key, &json!(frozen))?;
                    return Err(failure.message());
                }
                return Err(format!("{}。首次作答已保留，请恢复网络或登录原账号后再次点击提交，以核对同一次提交（{}）",
                        failure.message(), frozen.body["clientSubmissionId"]));
            }
        };
        frozen.receipt = ["resultId", "attemptId", "id"]
            .iter()
            .find_map(|field| identifier(&response["data"][field]));
        save_setting(&db, &pending_key, &json!(frozen))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn jiufen_submit(
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    cmd: Submit,
) -> Result<Value, String> {
    submit(&account, &db, cmd).await
}

pub(super) async fn submit(account: &Account, db: &AppDb, cmd: Submit) -> Result<Value, String> {
    let mut session = account.0.lock().await;
    let loaded = remote::payload(db, &mut session, &cmd.asset_id).await?;
    if loaded.asset.activity != activity(&cmd.channel)? {
        return Err("题目科目不匹配".into());
    }
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
        let mut result = remote::review(db, &mut session, &loaded, &cmd.attempt_id, false).await?;
        result["idempotentReplay"] = json!(true);
        return Ok(result);
    }
    let unit = loaded.asset.source_key.as_deref().ok_or("缺少题源标识")?;
    let questions = source_questions(&loaded)?;
    let mut frozen = prepare_pending(db, &loaded, &cmd, &questions, unit, &pending_key)?;
    recover_receipt(db, &mut session, &mut frozen, &pending_key).await?;
    let receipt = frozen.receipt.as_deref().ok_or_else(|| {
        format!(
            "交卷回执尚未取得，首次作答已保留，请再次点击提交核对（{}）",
            frozen.body["clientSubmissionId"]
        )
    })?;
    if identifier(&json!(receipt)).is_none() {
        return Err("本机回执损坏".into());
    }
    let latest_cmd = &cmd;
    let cmd = frozen.command.as_ref().unwrap_or(latest_cmd);
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
    let current = session.as_mut().ok_or("请先登录九分学长")?;
    let analyses = if loaded.asset.activity == Activity::Listening {
        listening_review::analyses(current, &loaded, &cmd.attempt_id, &questions, false).await
    } else {
        question_analyses(current, analysis_requests(&questions)).await
    };
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
        let recovered_draft = preserve_changed_draft(&tx, draft.clone(), latest_cmd, &questions, &frozen)
            .map_err(DbError::Validation)?;
        for answer in &mut record.answers {
            if let Some(saved) = frozen.command.as_ref().and_then(|cmd| {
                cmd.question_timeline
                    .iter()
                    .find(|q| q.question_id == answer.question_id)
            }) {
                answer.elapsed_ms = saved.elapsed_ms;
                answer.visit_count = saved.visit_count;
                answer.change_count = saved.change_count;
                answer.answered_at = saved.answered_at.clone();
            } else if let Some(saved) = draft
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
        result["recoveredDraftId"] = json!(recovered_draft);
        ielts_db::persist_completed_attempt(&tx, &record, &loaded.asset.fingerprint)?;
        if loaded.asset.activity == Activity::Listening {
            ielts_db::listening::attempt::finish_listening_draft(
                &tx, &record.id, recovered_draft.as_deref(),
            )?;
        }
        settings::upsert_setting(
            &tx,
            NS,
            &scoped_key("receipt-v2", &cmd.attempt_id).map_err(DbError::Validation)?,
            &json!({"assetId":cmd.asset_id,"receipt":receipt,"owner":owner_scope(&owner),"recoveredDraftId":recovered_draft}),
        )?;
        settings::delete_setting(&tx, NS, &pending_key)?;
        ielts_db::history::prune_terminal_attempts_in_transaction(&tx)?;
        tx.commit()?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;
    if loaded.asset.activity == Activity::Listening {
        listening_review::remember(current, &loaded, &cmd.attempt_id, &result);
    }
    Ok(result)
}

fn preserve_changed_draft(
    conn: &rusqlite::Connection,
    mut draft: AttemptRecord,
    latest: &Submit,
    questions: &[SourceQuestion],
    frozen: &Pending,
) -> Result<Option<String>, String> {
    let unit = string(&frozen.body, "unitId");
    let latest_body = submission(unit, questions, latest)?;
    let saved = remote::command(&draft);
    let saved_body = submission(unit, questions, &saved)?;
    if latest_body["parts"] == frozen.body["parts"] && saved_body["parts"] == frozen.body["parts"] {
        return Ok(None);
    }
    // Keep edits made while the first submission was unresolved as an ordinary
    // local draft. They must neither overwrite that result nor be sent silently.
    if latest_body["parts"] != frozen.body["parts"] {
        draft.answers = questions
            .iter()
            .map(|q| {
                let progress = latest
                    .question_timeline
                    .iter()
                    .find(|p| p.question_id == q.key);
                AttemptAnswer {
                    question_id: q.key.clone(),
                    answer: latest.answers.get(&q.key).cloned().unwrap_or(Value::Null),
                    marked: latest.marked_questions.contains(&q.key),
                    question_kind: Some(q.kind.clone()),
                    is_correct: None,
                    weight: 1.0,
                    elapsed_ms: progress.map_or(0, |p| p.elapsed_ms),
                    visit_count: progress.map_or(0, |p| p.visit_count),
                    change_count: progress.map_or(0, |p| p.change_count),
                    answered_at: progress.and_then(|p| p.answered_at.clone()),
                }
            })
            .collect();
        draft.duration_ms = latest.duration_ms.unwrap_or(draft.duration_ms);
    }
    draft.id = format!("jiufen-recovered-{}", uuid::Uuid::new_v4());
    ielts_db::upsert_attempt(conn, &draft).map_err(|e| e.to_string())?;
    if draft.activity == Activity::Reading {
        use ielts_db::modes::timer::{
            load_reading_timer_state, save_reading_timer_state, TimerOwnerScope, TimerState,
        };
        let now = chrono::Utc::now().timestamp_millis();
        let mut timer =
            load_reading_timer_state(conn, TimerOwnerScope::Attempt, &latest.attempt_id)
                .map_err(|e| e.to_string())?
                .unwrap_or_else(|| {
                    TimerState::new_suite(
                        now.saturating_sub(draft.duration_ms.min(i64::MAX as u64) as i64),
                    )
                });
        timer.pause(now);
        save_reading_timer_state(conn, TimerOwnerScope::Attempt, &draft.id, &timer)
            .map_err(|e| e.to_string())?;
    }
    Ok(Some(draft.id))
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
    let result = remote::review(&db, &mut session, &loaded, &attempt_id, false).await?;
    let mut review = result["review"].clone();
    if loaded.asset.activity == Activity::Listening {
        review["studyMaterial"] = result["studyMaterial"].clone();
    }
    Ok(review)
}

#[cfg(test)]
#[path = "../../developer/tests/rust/jiufen_native.rs"]
mod tests;
