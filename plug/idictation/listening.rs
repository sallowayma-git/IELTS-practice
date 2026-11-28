//! Academic listening uses Atlas's exam controls and product-window audio.
//! Preview work is transient until official listening receipts are verified.
use super::{
    article,
    exam::{self, Subject},
    material,
    service::{verify, Account},
    transport,
};
use crate::app::state::AppDb;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use tauri::{AppHandle, State};

pub const PREVIEW_PREFIX: &str = "idictation-listening-preview-";
const TRACK_ID: &str = "academic-full-track";

#[derive(Default)]
pub(super) struct ListeningSession {
    catalog: HashSet<String>,
    jijing: HashMap<String, JijingGrant>,
    jijing_parts: HashMap<(String, u64), JijingPartGrant>,
    previews: VecDeque<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCard {
    test_id: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    paper_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    section: Option<usize>,
}

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Bank {
    #[default]
    Academic,
    Jijing,
}

#[derive(Clone)]
struct JijingGrant {
    title: String,
    papers: Vec<u64>,
}

#[derive(Clone)]
struct JijingPartGrant {
    title: String,
    section: Option<usize>,
}

#[derive(Default)]
struct JijingDirectory {
    suites: HashMap<String, JijingGrant>,
    parts: HashMap<(String, u64), JijingPartGrant>,
    cards: Vec<CatalogCard>,
}

fn section_number(value: &Value) -> Option<usize> {
    let value = value.as_str()?.trim().to_ascii_lowercase();
    let index = value.strip_prefix("part").or_else(|| value.strip_prefix("section")).or_else(|| value.strip_prefix('p'))?
        .trim().parse::<usize>().ok()?;
    (1..=4).contains(&index).then_some(index)
}

fn jijing_catalog(value: &Value) -> Result<JijingDirectory, String> {
    let rows = value.as_array().filter(|rows| rows.len() <= 1000).ok_or("爱听写机经听力目录格式异常")?;
    let mut directory = JijingDirectory::default();
    let mut seen_tests = HashSet::new();
    for row in rows {
        let parts = exam::rows(row, "parts")?;
        if parts.is_empty() || parts.len() > 4 { continue; }
        let papers = parts.iter().map(|part| exam::number(part, "paper_id")).collect::<Result<Vec<_>, _>>()?;
        if papers.iter().collect::<HashSet<_>>().len() != parts.len() { continue; }
        let test_id = exam::number(row, "id")?.to_string();
        let title = row["title"].as_str().map(str::trim).filter(|title| !title.is_empty() && title.len() <= 300)
            .ok_or("爱听写机经听力目录缺少标题")?.to_owned();
        if !seen_tests.insert(test_id.clone()) {
            return Err("爱听写机经听力目录存在重复套卷".into());
        }
        if parts.len() == 4 {
            directory.suites.insert(test_id.clone(), JijingGrant { title: title.clone(), papers: papers.clone() });
            directory.cards.push(CatalogCard { test_id: test_id.clone(), title: title.clone(), paper_id: None, section: None });
        }
        for (index, (part, paper_id)) in parts.iter().zip(papers).enumerate() {
            let section = section_number(&part["title"]).or_else(|| (parts.len() == 4).then_some(index + 1));
            let label = section.map(|section| format!("Part {section}")).unwrap_or_else(|| "单 Part".into());
            let name = part["question_name"].as_str().map(str::trim)
                .filter(|name| !name.is_empty() && name.len() <= 300);
            let part_title = match name {
                Some(name) => format!("{title} · {label} · {name}"),
                None => format!("{title} · {label}"),
            };
            directory.parts.insert((test_id.clone(), paper_id), JijingPartGrant { title: part_title.clone(), section });
            directory.cards.push(CatalogCard { test_id: test_id.clone(), title: part_title, paper_id: Some(paper_id), section });
        }
    }
    Ok(directory)
}

fn catalog(value: &Value) -> Result<(HashSet<String>, Vec<CatalogCard>), String> {
    let rows = value
        .as_array()
        .filter(|rows| rows.len() <= 200)
        .ok_or("爱听写听力目录格式异常")?;
    let mut grants = HashSet::new();
    let mut cards = Vec::new();
    for row in rows {
        let test_id = exam::number(row, "id")?.to_string();
        let title = row["title"]
            .as_str()
            .map(str::trim)
            .filter(|title| !title.is_empty() && title.len() <= 300)
            .ok_or("爱听写听力目录缺少有效标题")?;
        if !grants.insert(test_id.clone()) {
            return Err("爱听写听力目录存在重复套卷".into());
        }
        cards.push(CatalogCard {
            test_id,
            title: title.into(),
            paper_id: None,
            section: None,
        });
    }
    Ok((grants, cards))
}

fn convert(owner: &str, test_id: &str, source: &Value) -> Result<(String, Value), String> {
    let exam = exam::convert(Subject::Listening, test_id, source)?;
    let full_track = exam::rows(source, "parts")?
        .iter()
        .filter_map(|part| part["full_audio"].as_str())
        .find(|url| !url.is_empty());
    let media = match full_track {
        Some(url) => json!([{
            "id":TRACK_ID, "url":material::media_url(url).ok_or("爱听写整卷音轨来源未经核验")?,
            "startSeconds":0, "endSeconds":null
        }]),
        None => json!([]),
    };
    let scope = hex::encode(Sha256::digest(
        json!([owner, test_id, exam.fingerprint]).to_string(),
    ));
    let id = format!("{PREVIEW_PREFIX}{scope}");
    let mut payload = exam.payload;
    if let Some(object) = payload.as_object_mut() {
        object.remove("idictation");
    }
    payload["examId"] = json!(id);
    payload["studyMaterial"] = json!({"media":media});
    Ok((id, payload))
}

fn convert_jijing(owner: &str, test_id: &str, grant: &JijingGrant, mut source: Value) -> Result<(String, Value), String> {
    let parts = exam::rows(&source, "parts")?;
    let papers = parts.iter().map(|part| exam::number(part, "paper_id")).collect::<Result<Vec<_>, _>>()?;
    if papers != grant.papers || (!source["test_id"].is_null() && exam::number(&source, "test_id")?.to_string() != test_id) {
        return Err("机经听力详情与目录的套卷或 Part 不一致".into());
    }
    let media = parts.iter().enumerate().filter_map(|(index, part)| jijing_media(part, index + 1)).collect();
    // The original detail page also uses the route's test ID and matches the papers from the catalog.
    source["test_id"] = json!(test_id.parse::<u64>().map_err(|_| "机经套卷编号无效")?);
    source["jianya_name"] = json!("机经");
    source["test_name"] = json!(grant.title);
    let exam = exam::convert(Subject::Listening, test_id, &source)?;
    Ok(jijing_preview(owner, json!([test_id]), exam, media))
}

fn jijing_media(part: &Value, section: usize) -> Option<Value> {
    let url = material::media_url(part["file_url"].as_str()?)?;
    Some(json!({"id":format!("jijing-part-{section}"),"url":url,"startSeconds":0,"endSeconds":null,"section":section}))
}

fn convert_jijing_part(owner: &str, test_id: &str, paper_id: u64, grant: &JijingPartGrant, part: Value)
    -> Result<(String, Value), String>
{
    if exam::number(&part, "paper_id")? != paper_id {
        return Err("机经听力单 Part 与目录不一致".into());
    }
    let section = section_number(&part["title"]);
    if grant.section.zip(section).is_some_and(|(expected, actual)| expected != actual) {
        return Err("机经听力 Part 分类与目录不一致".into());
    }
    let section = section.or(grant.section).or_else(|| {
        let first = part["question_number"].as_array()?.iter().filter_map(Value::as_u64).min()?;
        matches!(first, 11 | 21 | 31).then_some((first as usize - 1) / 10 + 1)
    }).ok_or("原站未返回可核验的 Part 编号")?;
    let media = jijing_media(&part, section).into_iter().collect();
    let source = json!({"test_id":paper_id,"jianya_name":"机经","test_name":grant.title,"parts":[part]});
    let exam = exam::convert_listening_part(&paper_id.to_string(), &source, section)?;
    Ok(jijing_preview(owner, json!([test_id,paper_id]), exam, media))
}

fn jijing_preview(owner: &str, scope: Value, exam: exam::Exam, media: Vec<Value>) -> (String, Value) {
    let scope = hex::encode(Sha256::digest(json!([owner,"jijing",scope,exam.fingerprint]).to_string()));
    let id = format!("{PREVIEW_PREFIX}{scope}");
    let mut payload = exam.payload;
    payload.as_object_mut().unwrap().remove("idictation");
    payload["examId"] = json!(id);
    payload["studyMaterial"] = json!({"media":media});
    payload["idictationJijing"] = json!(true);
    (id, payload)
}

#[tauri::command]
pub async fn idictation_listening_catalog(
    app: AppHandle,
    account: State<'_, Account>,
    bank: Option<Bank>,
) -> Result<Vec<CatalogCard>, String> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    if matches!(bank, Some(Bank::Jijing)) {
        session.listening.jijing.clear();
        session.listening.jijing_parts.clear();
        let value = transport::read(&app, "listeningJijingCatalog", json!({})).await?;
        verify(&app, &mut session).await?;
        let directory = jijing_catalog(&value)?;
        session.listening.jijing = directory.suites;
        session.listening.jijing_parts = directory.parts;
        return Ok(directory.cards);
    }
    session.listening.catalog.clear();
    let value = transport::read(&app, "listeningCatalog", json!({})).await?;
    verify(&app, &mut session).await?;
    let (grants, cards) = catalog(&value)?;
    session.listening.catalog = grants;
    Ok(cards)
}

#[tauri::command]
pub async fn idictation_listening_open(
    app: AppHandle,
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    test_id: String,
    bank: Option<Bank>,
    paper_id: Option<u64>,
) -> Result<String, String> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let (id, payload) = if let Some(paper_id) = paper_id {
        if !matches!(bank, Some(Bank::Jijing)) { return Err("单 Part 仅适用于机经听力".into()); }
        let grant = session.listening.jijing_parts.get(&(test_id.clone(), paper_id)).cloned()
            .ok_or("请从当前账号的机经目录选择 Part")?;
        let value = transport::read(&app, "listeningJijingPart", json!({"testId":paper_id.to_string()})).await?;
        verify(&app, &mut session).await?;
        convert_jijing_part(session.owner.as_deref().ok_or("尚未连接账号")?, &test_id, paper_id, &grant, value)?
    } else if matches!(bank, Some(Bank::Jijing)) {
        let grant = session.listening.jijing.get(&test_id).cloned().ok_or("请从当前账号的机经目录选择听力套卷")?;
        let value = transport::read(&app, "listeningJijingExam", json!({"testId":test_id})).await?;
        verify(&app, &mut session).await?;
        convert_jijing(session.owner.as_deref().ok_or("尚未连接账号")?, &test_id, &grant, value)?
    } else {
        if !session.listening.catalog.contains(&test_id) {
            return Err("请从当前账号的爱听写听力目录选择套卷".into());
        }
        let value = transport::read(&app, "listeningExam", json!({"testId":test_id})).await?;
        verify(&app, &mut session).await?;
        convert(session.owner.as_deref().ok_or("尚未连接账号")?, &test_id, &value)?
    };
    db.with_conn(|conn| ielts_db::transient_assets::put(conn, "idictation", &id, payload))
        .map_err(|e| e.to_string())?;
    session
        .listening
        .previews
        .retain(|previous| previous != &id);
    session.listening.previews.push_back(id.clone());
    while session.listening.previews.len() > 16 {
        session.listening.previews.pop_front();
    }
    Ok(id)
}

#[tauri::command]
pub async fn idictation_listening_payload(
    app: AppHandle,
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    asset_id: String,
) -> Result<Value, String> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    if !session.listening.previews.contains(&asset_id) {
        return Err("请从当前账号的爱听写听力目录重新打开".into());
    }
    let mut payload = db
        .with_conn(|conn| ielts_db::transient_assets::get(conn, &asset_id))
        .map_err(|e| e.to_string())?;
    let media = payload
        .as_object_mut()
        .and_then(|object| object.remove("studyMaterial"));
    if payload["idictationJijing"] == true {
        let track_ids: HashMap<_, _> = media.as_ref().and_then(|value| value["media"].as_array())
            .into_iter().flatten().filter_map(|row| Some((row["section"].as_u64()?.to_string(), row["id"].as_str()?))).collect();
        let session_id = article::open_playback(&app, &mut session.article, asset_id);
        payload["idictationPlayback"] = json!({"sessionId":session_id, "trackIds":track_ids});
        return Ok(payload);
    }
    if media
        .as_ref()
        .is_some_and(|value| value["media"][0]["id"] == TRACK_ID)
    {
        let session_id = article::open_playback(&app, &mut session.article, asset_id);
        payload["idictationPlayback"] = json!({"sessionId":session_id, "trackId":TRACK_ID});
    }
    Ok(payload)
}

#[cfg(test)]
#[path = "../../developer/tests/rust/idictation_listening.rs"]
mod tests;
