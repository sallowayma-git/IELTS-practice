//! Reader uses the existing reading DTO without persisting an exam index. This
//! keeps material out of random exams, suites, draft creation and local scoring.
use super::{material, service::{verify, Account}, transport, vocabulary::id};
use crate::app::state::AppDb;
use ielts_domain::{domain::{Activity, AssetSourceKind}, dto::{PracticeAssetV2, PracticeAssetV2Payload}};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use tauri::{AppHandle, State};

#[derive(Default)]
pub(super) struct ReaderSession {
    grants: HashMap<String, ReaderDocument>,
    assets: VecDeque<PracticeAssetV2>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderDocument {
    id: String,
    version_id: String,
    title: String,
    track: String,
    book: u64,
    test: u64,
    part: u64,
    word_count: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderCatalog {
    items: Vec<ReaderDocument>,
    page: u64,
    total: u64,
    page_size: u64,
}

fn integer(value: &Value, field: &str, min: u64, max: u64) -> Result<u64, String> {
    value[field].as_u64().filter(|v| (min..=max).contains(v))
        .ok_or_else(|| format!("精读目录的 {field} 无效"))
}

fn catalog(session: &mut ReaderSession, value: Value, track: &str, book: u64, page: u64) -> Result<ReaderCatalog, String> {
    let total = integer(&value, "total", 0, 100000)?;
    let page_size = integer(&value, "page_size", 1, 100)?;
    if value["page"].as_u64() != Some(page) { return Err("精读目录页码不一致".into()); }
    let rows = value["items"].as_array().ok_or("精读目录缺少列表")?;
    let expected = total.saturating_sub((page - 1) * page_size).min(page_size);
    if rows.len() as u64 != expected { return Err("精读目录未完整返回".into()); }
    let mut grants = HashMap::new();
    let mut items = Vec::new();
    for row in rows {
        if row["subject"] != "reading" || row["track"] != track || row["book_number"] != book {
            return Err("精读目录与选择的科目或书册不一致".into());
        }
        let title = row["title"].as_str().filter(|s| !s.trim().is_empty()).ok_or("精读标题为空")?;
        let doc = ReaderDocument { id: id(&row["id"])?, version_id: id(&row["version_id"])?,
            title: title.to_owned(), track: track.into(), book,
            test: integer(row, "test_number", 1, 4)?, part: integer(row, "part_number", 1, 3)?,
            word_count: integer(row, "word_count", 0, 100000)? };
        if grants.insert(doc.id.clone(), doc.clone()).is_some() { return Err("精读目录身份重复".into()); }
        items.push(doc);
    }
    session.grants = grants;
    Ok(ReaderCatalog { items, page, total, page_size })
}

fn convert(owner: &str, grant: &ReaderDocument, value: &Value) -> Result<PracticeAssetV2Payload, String> {
    let doc = &value["document"];
    if id(&value["version"]["id"])? != grant.version_id {
        return Err("精读版本已更新，请重新加载目录".into());
    }
    if doc["subject"] != "reading" || doc["track"] != grant.track || doc["book_number"] != grant.book
        || doc["test_number"] != grant.test || doc["part_number"] != grant.part {
        return Err("精读正文与当前目录不一致".into());
    }
    let mut converted = material::reader(&grant.id, value)?;
    let scope = hex::encode(Sha256::digest(json!([owner, grant.id, grant.version_id, converted.fingerprint]).to_string().as_bytes()));
    let asset_id = format!("idictation-material-{scope}");
    converted.payload["examId"] = json!(asset_id);
    let asset = PracticeAssetV2 {
        schema_version: PracticeAssetV2::SCHEMA_VERSION, id: asset_id, activity: Activity::Reading,
        source_kind: AssetSourceKind::Imported, source_key: Some(grant.id.clone()),
        title: converted.payload["meta"]["title"].as_str().unwrap_or(&grant.title).into(),
        category: Some(format!("P{}", grant.part)), difficulty: None, frequency: None,
        content_ref: None, fingerprint: converted.fingerprint, pdf_only: false,
        metadata: Some(json!({"remoteProvider":"idictation","practiceKind":"material","materialKind":"reader"})),
    };
    Ok(PracticeAssetV2Payload { asset, payload: converted.payload })
}

#[tauri::command]
pub async fn idictation_reader_catalog(app: AppHandle, account: State<'_, Account>, track: String, book: u64, page: u64) -> Result<ReaderCatalog, String> {
    if !matches!(track.as_str(), "a" | "g") || !(4..=21).contains(&book) || !(1..=10000).contains(&page) {
        return Err("请选择有效的精读书册和页码".into());
    }
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    session.reader.grants.clear();
    let value = transport::read(&app, "readerCatalog", json!({"subject":"reading","track":track,"book":book,"page":page})).await?;
    verify(&app, &mut session).await?;
    catalog(&mut session.reader, value, &track, book, page)
}

#[tauri::command]
pub async fn idictation_open_reader(app: AppHandle, account: State<'_, Account>, db: State<'_, AppDb>, document_id: String) -> Result<String, String> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let grant = session.reader.grants.get(&document_id).cloned().ok_or("请从当前账号的精读目录选择文章")?;
    let value = transport::read(&app, "readerDocument", json!({"id":document_id})).await?;
    verify(&app, &mut session).await?;
    let loaded = convert(session.owner.as_deref().ok_or("尚未连接账号")?, &grant, &value)?;
    let asset_id = loaded.asset.id.clone();
    db.with_conn(|conn| ielts_db::transient_assets::put(conn, "idictation", &asset_id, loaded.payload))
        .map_err(|e| e.to_string())?;
    session.reader.assets.retain(|asset| asset.id != asset_id);
    session.reader.assets.push_back(loaded.asset);
    while session.reader.assets.len() > 16 { session.reader.assets.pop_front(); }
    Ok(asset_id)
}

#[tauri::command]
pub async fn idictation_reader_payload(app: AppHandle, account: State<'_, Account>, db: State<'_, AppDb>, asset_id: String) -> Result<PracticeAssetV2Payload, String> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let asset = session.reader.assets.iter().find(|asset| asset.id == asset_id).cloned().ok_or("请从当前账号的精读目录重新打开文章")?;
    let payload = db.with_conn(|conn| ielts_db::transient_assets::get(conn, &asset_id)).map_err(|e| e.to_string())?;
    Ok(PracticeAssetV2Payload { asset, payload })
}

#[cfg(test)]
#[path = "../../developer/tests/rust/idictation_reader.rs"]
mod tests;
