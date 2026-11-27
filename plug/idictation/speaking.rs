//! Speaking topic material is isolated from practice results and recordings.
use super::{
    article,
    service::{verify, Account},
    training, transport, vocabulary,
};
use crate::app::state::AppDb;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, State};

#[derive(Default)]
pub(super) struct SpeakingSession {
    grants: HashMap<String, u8>,
}

#[derive(Serialize)]
pub struct Card {
    id: String,
    title: String,
    available: bool,
}

fn open_to_account(value: &Value) -> bool {
    fn clear(flag: &Value) -> bool {
        flag == false || flag.as_u64() == Some(0) || flag.as_str() == Some("0")
    }
    clear(&value["locked"]) && clear(&value["offline"])
}

fn part(value: &Value) -> Option<u8> {
    match value.as_u64().or_else(|| value.as_str()?.parse().ok()) {
        Some(number @ 1..=3) => Some(number as u8),
        _ => None,
    }
}

fn title(value: &Value) -> Result<&str, String> {
    value.as_str().map(str::trim)
        .filter(|text| !text.is_empty() && text.len() <= 24 * 1024)
        .ok_or_else(|| "爱听写口语题目缺少标题".into())
}

fn catalog(source: &Value, selection: u8, session: &mut SpeakingSession) -> Result<Vec<Vec<Card>>, String> {
    let lists = source.as_array().filter(|lists| lists.len() == 3).ok_or("爱听写口语目录格式异常")?;
    let mut grants = HashMap::new();
    let mut restricted = HashSet::new();
    let mut groups = Vec::new();
    for list in lists {
        let rows = list.as_array().filter(|rows| rows.len() <= 500).ok_or("爱听写口语目录分组异常")?;
        let mut cards = Vec::new();
        let mut seen = HashSet::new();
        for row in rows {
            let id = vocabulary::id(&row["id"])?;
            let source_part = part(&row["part"]).ok_or("爱听写口语 Part 无效")?;
            if (selection == 1) != (source_part == 1) {
                return Err("爱听写口语话题与目录分组不一致".into());
            }
            let previous = grants.insert(id.clone(), source_part);
            if previous.is_some_and(|previous| previous != source_part) {
                return Err("爱听写口语话题身份冲突".into());
            }
            if !open_to_account(row) {
                restricted.insert(id.clone());
            }
            if seen.insert(id.clone()) {
                cards.push(Card { id, title: title(&row["title"])?.into(), available: true });
            }
        }
        groups.push(cards);
    }
    grants.retain(|id, _| !restricted.contains(id));
    for card in groups.iter_mut().flatten() {
        card.available = grants.contains_key(&card.id);
    }
    session.grants = grants;
    Ok(groups)
}

#[derive(Deserialize, Serialize)]
struct Bilingual {
    en: String,
    zh: String,
}

#[derive(Deserialize, Serialize)]
struct Idea {
    title: Bilingual,
    points: Vec<Bilingual>,
    samples: [Bilingual; 2],
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Question {
    #[serde(skip_deserializing)]
    id: String,
    title: String,
    part: u8,
    cues: Vec<String>,
    ideas: Vec<Idea>,
    #[serde(skip_deserializing)]
    media_id: Option<String>,
}

fn convert(source: &Value, topic_id: &str, expected_part: u8) -> Result<(Value, Value), String> {
    if vocabulary::id(&source["id"])? != topic_id || part(&source["part"]) != Some(expected_part) {
        return Err("爱听写口语话题与目录身份不一致".into());
    }
    if !open_to_account(source) {
        return Err("原站口语话题当前不可用".into());
    }
    let name = title(&source["title"])?;
    let questions = source["questions"].as_array()
        .filter(|rows| !rows.is_empty() && rows.len() <= 100).ok_or("原站未返回可用口语题目")?;
    let mut output = Vec::with_capacity(questions.len());
    let mut media = Vec::new();
    let mut seen = HashSet::new();
    for row in questions {
        let id = vocabulary::id(&row["id"])?;
        if vocabulary::id(&row["owner"])? != topic_id || !seen.insert(id.clone()) {
            return Err("爱听写口语题目身份冲突".into());
        }
        let mut question: Question = serde_json::from_value(row.clone()).map_err(|_| "爱听写口语题目格式异常")?;
        if question.part != expected_part && !(expected_part == 2 && question.part == 3) {
            return Err("爱听写口语题目 Part 不一致".into());
        }
        title(&row["title"])?;
        question.id = id.clone();
        if let Some(url) = row["audio"].as_str().and_then(|url| training::validated_audio(url).ok()) {
            media.push(json!({"id":id,"url":url,"startSeconds":0,"endSeconds":null}));
            question.media_id = Some(id);
        }
        output.push(question);
    }
    if !output.iter().any(|question| question.part == expected_part) {
        return Err("爱听写口语主话题缺失".into());
    }
    Ok((json!({"title":name,"questions":output}), json!({"studyMaterial":{"media":media}})))
}

#[tauri::command]
pub async fn idictation_speaking_catalog(app: AppHandle, account: State<'_, Account>, selection: u8)
    -> Result<Vec<Vec<Card>>, String>
{
    let operation = match selection {
        1 => "speakingPart1",
        2 => "speakingPart2",
        _ => return Err("请选择有效的口语分组".into()),
    };
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    session.speaking.grants.clear();
    let source = transport::read(&app, operation, json!({})).await?;
    verify(&app, &mut session).await?;
    catalog(&source, selection, &mut session.speaking)
}

#[tauri::command]
pub async fn idictation_speaking_open(app: AppHandle, account: State<'_, Account>, db: State<'_, AppDb>, topic_id: String)
    -> Result<Value, String>
{
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let expected_part = *session.speaking.grants.get(&topic_id).ok_or("请从当前口语目录选择可用话题")?;
    let source = transport::read(&app, "speakingTopic", json!({"topicId":topic_id})).await?;
    verify(&app, &mut session).await?;
    let (mut topic, media) = convert(&source, &topic_id, expected_part)?;
    let asset_id = format!("idictation-speaking-{}", uuid::Uuid::new_v4());
    db.with_conn(|conn| ielts_db::transient_assets::put(conn, "idictation", &asset_id, media))
        .map_err(|error| error.to_string())?;
    topic["sessionId"] = json!(article::open_playback(&app, &mut session.article, asset_id));
    Ok(topic)
}

#[cfg(test)]
#[path = "../../developer/tests/rust/idictation_speaking.rs"]
mod tests;
