use super::{service::{verify, Account}, transport, vocabulary};
use crate::app::state::AppDb;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tauri::{AppHandle, State};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Action {
    Prepare { categories: Vec<String> },
    Check { answer: String },
    Save { answer: String },
}

const PENDING: &str = "idictation.article-dictation.pending";
const CATEGORIES: [&str; 4] = ["answer_expression", "logic_signal", "question_paraphrase", "key_constraint"];
const MAX_SENTENCE_BYTES: usize = 4096;

pub(super) fn snapshot(value: &Value, mode: &str) -> Value {
    let round = super::article::practice_round(&value["last_key"]);
    if round.is_null() { return Value::Null; }
    let resume = vocabulary::id(&value["resume_article_id"]).ok()
        .map(|id| format!("idictation-article-{mode}-{id}"));
    let states: HashMap<_, _> = value["data"].as_array().into_iter().flatten().filter_map(|row| {
        let id = vocabulary::id(&row["id"]).ok()?;
        let saved = row["dictation"].as_object()?;
        let answer = saved.get("answer")?.as_str().filter(|answer| answer.len() <= MAX_SENTENCE_BYTES)?;
        let score = saved.get("accuracy").and_then(|value| value.as_f64().or_else(|| value.as_str()?.parse().ok()))
            .filter(|score| (0.0..=1.0).contains(score));
        Some((format!("idictation-article-{mode}-{id}"), json!({"answer":answer,"accuracy":score})))
    }).collect();
    json!({"round":round,"resumeId":resume,"states":states})
}

pub(super) fn sentence<'a>(payload: &'a Value, sentence_id: &str) -> Result<&'a Value, String> {
    let source = &payload["idictation"];
    let mode = source["sentenceMode"].as_str().filter(|mode| matches!(*mode, "short" | "long"));
    if source["kind"] != "article" || mode.is_none() {
        return Err("请打开词书目录中的精听章节".into());
    }
    let prefix = format!("idictation-article-{}-", mode.unwrap());
    let source_id = sentence_id.strip_prefix(&prefix).ok_or("精听句子身份无效")?;
    vocabulary::id(&json!(source_id))?;
    source["sentences"].as_array().and_then(|rows| {
        rows.iter().find(|row| vocabulary::id(&row["id"]).ok().as_deref() == Some(source_id))
    }).ok_or_else(|| "精听句子不属于当前章节".into())
}

fn request(row: &Value, action: Action) -> Result<(&'static str, Value), String> {
    let reference = row["content"].as_str().filter(|text| !text.trim().is_empty() && text.len() <= MAX_SENTENCE_BYTES)
        .ok_or("精听原文为空或过长，请选择其他句子")?;
    match action {
        Action::Check { answer } | Action::Save { answer } => {
            if answer.trim().is_empty() || answer.len() > MAX_SENTENCE_BYTES {
                return Err("请输入有效的听写内容".into());
            }
            Ok(("articleSentenceScore", json!({"reference":reference,"answer":answer})))
        }
        Action::Prepare { categories } => {
            if categories.is_empty() || categories.len() > CATEGORIES.len()
                || categories.iter().any(|category| !CATEGORIES.contains(&category.as_str()))
            {
                return Err("请选择有效的挖空类别".into());
            }
            if row["cloze_details"].to_string().len() > 512_000 {
                return Err("精听挖空材料过长，请切换整句听写".into());
            }
            Ok(("articleCloze", json!({"sentence":{"content":reference,"cloze_details":row["cloze_details"]},
                "categories":categories})))
        }
    }
}

fn receipt(round: &Value, answer: &str) -> Value {
    json!({"round":vocabulary::id(round).ok(),"answerDigest":hex::encode(Sha256::digest(answer))})
}

async fn save(app: &AppHandle, db: &AppDb, owner: &str, asset: &str, mut payload: Value,
    sentence_id: &str, answer: String) -> Result<Value, String>
{
    let row = sentence(&payload, sentence_id)?;
    let article_id = row["id"].clone();
    let (_, mut input) = request(row, Action::Check { answer: answer.clone() })?;
    let dictation = &mut payload["articleDictation"];
    let key = dictation["round"].clone();
    vocabulary::id(&key).map_err(|_| "原站听写轮次无效，请重新打开章节")?;
    let scope = hex::encode(Sha256::digest(json!([owner, vocabulary::id(&article_id)?]).to_string()));
    let state = &mut dictation["states"][sentence_id];
    let pending = db.with_conn(|conn| ielts_db::settings::get_setting(conn, PENDING, &scope))
        .map_err(|_| "无法读取听写确认状态")?;
    if let Some(pending) = pending {
        let confirmed = state["answer"].as_str().is_some_and(|prior| receipt(&key, prior) == pending.value);
        if !confirmed {
            return Err("上次听写结果尚未确认。请重新打开章节核对，或到爱听写查看该句".into());
        }
        clear_pending(db, &scope)?;
    }
    if state["answer"] == answer { return Ok(state.clone()); }
    db.with_conn(|conn| ielts_db::settings::upsert_setting(conn, PENDING, &scope, &receipt(&key, &answer)))
        .map_err(|_| "无法保存本机确认状态，本次未提交")?;
    input["articleId"] = article_id;
    input["expectedOwner"] = json!(owner);
    input["key"] = key;
    let score = transport::read(app, "articleDictationSave", input).await
        .map_err(|error| format!("听写保存尚未确认：{error}。请重新打开章节核对"))?;
    let accuracy = score.as_str().and_then(|score| score.parse::<f64>().ok())
        .filter(|score| (0.0..=1.0).contains(score)).ok_or("原站听写保存结果无法确认")?;
    let result = json!({"answer":answer,"accuracy":accuracy});
    *state = result.clone();
    db.with_conn(|conn| ielts_db::transient_assets::put(conn, "idictation", asset, payload))
        .map_err(|_| "原站已确认，请重新打开章节刷新听写记录")?;
    clear_pending(db, &scope)?;
    Ok(result)
}

fn clear_pending(db: &AppDb, scope: &str) -> Result<(), String> {
    db.with_conn(|conn| ielts_db::settings::delete_setting(conn, PENDING, scope))
        .map(|_|()).map_err(|_| "无法更新本机听写确认状态".into())
}

#[tauri::command]
pub async fn idictation_article_dictation(app: AppHandle, account: State<'_, Account>, db: State<'_, AppDb>,
    session_id: String, sentence_id: String, action: Action) -> Result<Value, String>
{
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let asset = session.article.playback_asset(&session_id).ok_or("请重新打开当前精听章节")?;
    let payload = db.with_conn(|conn| ielts_db::transient_assets::get(conn, asset))
        .map_err(|error| error.to_string())?;
    if let Action::Save { answer } = action {
        let owner = session.owner.as_deref().ok_or("请先连接爱听写账号")?;
        return save(&app, &db, owner, asset, payload, &sentence_id, answer).await;
    }
    let (operation, input) = request(sentence(&payload, &sentence_id)?, action)?;
    transport::read(&app, operation, input).await
}

#[cfg(test)]
#[path = "../../developer/tests/rust/idictation_article_dictation.rs"]
mod tests;
