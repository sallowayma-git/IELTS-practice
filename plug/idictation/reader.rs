//! Reader uses the existing reading DTO without persisting an exam index. This
//! keeps material out of random exams, suites, draft creation and local scoring.
use super::{material, service::{verify, Account}, transport, vocabulary::id};
use super::reader_collections::{self, CollectionPage, Grant};
use crate::app::state::AppDb;
use ielts_domain::{domain::{Activity, AssetSourceKind}, dto::{PracticeAssetV2, PracticeAssetV2Payload}};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use tauri::{AppHandle, State};

#[derive(Default)]
pub(super) struct ReaderSession {
    grants: HashMap<String, ReaderDocument>,
    collection_grants: HashMap<String, Grant>,
    assets: VecDeque<PracticeAssetV2>,
}

impl ReaderSession {
    pub(super) fn has_asset(&self, asset_id: &str) -> bool {
        self.assets.iter().any(|asset| asset.id == asset_id)
    }

    pub(super) fn clear_collection_grants(&mut self) {
        self.collection_grants.clear();
    }
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
    converted.payload["readerBookmarks"] = json!(value["bookmarked"].as_array().into_iter().flatten()
        .filter_map(|value| id(value).ok())
        .map(|sid| format!("idictation-reader-{}-v{}-s{sid}", grant.id, grant.version_id))
        .collect::<std::collections::BTreeSet<_>>());
    let progress = &value["progress"];
    let block = progress["block_key"].as_str();
    let offset = progress["text_offset"].as_u64();
    let position = block.zip(offset).filter(|(block, offset)| position_exists(&converted.payload, block, *offset))
        .map(|(block, offset)| json!({"blockKey":block,"textOffset":offset}));
    converted.payload["readerState"] = json!({
        "position":position,
        "lockVersion":if progress.is_null() { Some(0) } else { progress["lock_version"].as_u64() },
        "completedAt": completion_time(&value["completedAt"])
    });
    converted.payload["readerAnnotations"] = super::reader_annotations::snapshot(&converted.payload, &value["sentenceAnnotations"]);
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
    store(&db, &mut session.reader, loaded)
}

fn store(db: &AppDb, session: &mut ReaderSession, loaded: PracticeAssetV2Payload) -> Result<String, String> {
    let asset_id = loaded.asset.id.clone();
    db.with_conn(|conn| ielts_db::transient_assets::put(conn, "idictation", &asset_id, loaded.payload))
        .map_err(|e| e.to_string())?;
    session.assets.retain(|asset| asset.id != asset_id);
    session.assets.push_back(loaded.asset);
    while session.assets.len() > 16 { session.assets.pop_front(); }
    Ok(asset_id)
}

#[tauri::command]
pub async fn idictation_reader_collections(app: AppHandle, account: State<'_, Account>, kind: String, page: u64) -> Result<CollectionPage, String> {
    if !matches!(kind.as_str(), "all" | "bookmark" | "highlight" | "note") || !(1..=10_000).contains(&page) {
        return Err("请选择有效的精读收藏类别和页码".into());
    }
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    session.reader.collection_grants.clear();
    let value = transport::read(&app, "readerCollections",
        json!({"subject":"reading","kind":kind,"page":page,"page_size":reader_collections::PAGE_SIZE})).await?;
    verify(&app, &mut session).await?;
    let (items, grants) = reader_collections::page(&value, page)?;
    session.reader.collection_grants = grants;
    Ok(items)
}

fn resolve_collected(owner: &str, grant: &Grant, value: &Value) -> Result<(PracticeAssetV2Payload, String), String> {
    let doc = &value["document"];
    let track = doc["track"].as_str().filter(|s| matches!(*s, "a" | "g"))
        .ok_or("精读收藏的文章类别未知")?;
    let model = ReaderDocument {
        id: grant.document.clone(), version_id: grant.version.clone(), track: track.into(),
        title: value["version"]["title"].as_str().unwrap_or("爱听写精读").into(),
        book: integer(doc, "book_number", 4, 21)?,
        test: integer(doc, "test_number", 1, 4)?,
        part: integer(doc, "part_number", 1, 3)?, word_count: 0,
    };
    let loaded = convert(owner, &model, value)?;
    let focus = format!("idictation-reader-{}-v{}-s{}", grant.document, grant.version, grant.sentence);
    let found = loaded.payload["studyMaterial"]["parts"].as_array().into_iter().flatten()
        .flat_map(|part| part["paragraphs"].as_array().into_iter().flatten())
        .flat_map(|paragraph| paragraph["sentences"].as_array().into_iter().flatten())
        .any(|sentence| sentence["id"] == focus && sentence["text"] == grant.text);
    if !found { return Err("收藏句已变化，请重新加载收藏列表".into()); }
    Ok((loaded, focus))
}

#[tauri::command]
pub async fn idictation_open_reader_collection(app: AppHandle, account: State<'_, Account>, db: State<'_, AppDb>, key: String) -> Result<Value, String> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let grant = session.reader.collection_grants.get(&key).cloned().ok_or("请先从当前收藏列表选择可用的句子")?;
    let value = transport::read(&app, "readerDocument", json!({"id":grant.document})).await?;
    verify(&app, &mut session).await?;
    let (loaded, focus) = resolve_collected(session.owner.as_deref().ok_or("尚未连接账号")?, &grant, &value)?;
    let asset_id = store(&db, &mut session.reader, loaded)?;
    Ok(json!({"assetId":asset_id,"sentenceId":focus}))
}

#[tauri::command]
pub async fn idictation_reader_payload(app: AppHandle, account: State<'_, Account>, db: State<'_, AppDb>, asset_id: String) -> Result<PracticeAssetV2Payload, String> {
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    let asset = session.reader.assets.iter().find(|asset| asset.id == asset_id).cloned().ok_or("请从当前账号的精读目录重新打开文章")?;
    let payload = db.with_conn(|conn| ielts_db::transient_assets::get(conn, &asset_id)).map_err(|e| e.to_string())?;
    Ok(PracticeAssetV2Payload { asset, payload })
}

fn bookmark_request(payload: &Value, sentence_id: &str, collected: bool, owner: &str) -> Result<Value, String> {
    let (_, sentence) = source_sentence(payload, sentence_id)?;
    let source = &payload["idictation"];
    Ok(json!({"expectedOwner":owner,"document_id":source["document"]["id"],
        "version_id":source["version"]["id"],"sentence_id":sentence["id"],"collected":collected}))
}

pub(super) fn source_sentence<'a>(payload: &'a Value, sentence_id: &str) -> Result<(&'a Value, &'a Value), String> {
    let source = &payload["idictation"];
    let document = id(&source["document"]["id"])?;
    let version = id(&source["version"]["id"])?;
    let prefix = format!("idictation-reader-{document}-v{version}-s");
    let sid = sentence_id.strip_prefix(&prefix).ok_or("精读收藏句版本不一致")?;
    id(&json!(sid))?;
    source["blocks"].as_array().into_iter().flatten()
        .flat_map(|block| block["sentences"].as_array().into_iter().flatten().map(move |row| (block, row)))
        .find(|(_, row)| id(&row["id"]).ok().as_deref() == Some(sid))
        .ok_or_else(|| "精读句子不属于当前文章".into())
}

#[tauri::command]
pub async fn idictation_reader_bookmark(app: AppHandle, account: State<'_, Account>, db: State<'_, AppDb>,
    asset_id: String, sentence_id: String, collected: bool) -> Result<bool, String>
{
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    if !session.reader.assets.iter().any(|asset| asset.id == asset_id) {
        return Err("请从当前账号的精读目录重新打开文章".into());
    }
    let owner = session.owner.as_deref().ok_or("请先连接爱听写账号")?;
    let mut payload = db.with_conn(|conn| ielts_db::transient_assets::get(conn, &asset_id))
        .map_err(|error| error.to_string())?;
    let request = bookmark_request(&payload, &sentence_id, collected, owner)?;
    let receipt = transport::read(&app, "readerBookmark", request).await
        .map_err(|error| format!("收藏状态尚未确认：{error}"))?;
    if receipt.as_bool() != Some(collected) {
        return Err("原站收藏状态无法确认，请重新打开文章核对".into());
    }
    let bookmarks = payload["readerBookmarks"].as_array_mut().ok_or("精读书签记录缺失")?;
    bookmarks.retain(|value| value.as_str() != Some(sentence_id.as_str()));
    if collected { bookmarks.push(json!(sentence_id)); }
    db.with_conn(|conn| ielts_db::transient_assets::put(conn, "idictation", &asset_id, payload))
        .map_err(|_| "原站已确认，请重新打开文章刷新书签")?;
    session.reader.collection_grants.clear();
    Ok(collected)
}

fn position_exists(payload: &Value, key: &str, offset: u64) -> bool {
    payload["idictation"]["blocks"].as_array().into_iter().flatten()
        .find(|block| block["block_key"] == key)
        .and_then(|block| block["text"].as_str())
        .is_some_and(|text| offset <= text.encode_utf16().count() as u64)
}

fn completion_time(value: &Value) -> Option<&str> {
    value.as_str().filter(|time| !time.trim().is_empty() && time.len() <= 100)
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum ProgressAction {
    Save { block_key: String, text_offset: u64 },
    Complete,
}

#[tauri::command]
pub async fn idictation_reader_progress(app: AppHandle, account: State<'_, Account>, db: State<'_, AppDb>,
    asset_id: String, action: ProgressAction) -> Result<Value, String>
{
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    if !session.reader.assets.iter().any(|asset| asset.id == asset_id) {
        return Err("请从当前账号的精读目录重新打开文章".into());
    }
    let owner = session.owner.as_deref().ok_or("请先连接爱听写账号")?;
    let mut payload = db.with_conn(|conn| ielts_db::transient_assets::get(conn, &asset_id))
        .map_err(|error| error.to_string())?;
    let document = payload["idictation"]["document"]["id"].clone();
    let document_id = id(&document)?;
    let mut state = payload["readerState"].clone();
    match action {
        ProgressAction::Save { block_key, text_offset } => {
            if !position_exists(&payload, &block_key, text_offset) { return Err("该位置不属于当前精读文章".into()); }
            let lock = state["lockVersion"].as_u64().ok_or("原站位置版本无效，请重新打开文章")?;
            let position = json!({"blockKey":block_key,"textOffset":text_offset});
            if state["position"] == position { return Ok(state); }
            let receipt = transport::read(&app, "readerProgress", json!({
                "expectedOwner":owner,"document_id":document,"block_key":block_key,
                "text_offset":text_offset,"lock_version":lock
            })).await?;
            let updated = receipt["lock_version"].as_u64().filter(|version| *version >= lock)
                .ok_or("原站阅读位置回执无效，请重新打开文章")?;
            state["lockVersion"] = json!(updated);
            state["position"] = position;
        }
        ProgressAction::Complete => {
            if completion_time(&state["completedAt"]).is_some() { return Ok(state); }
            let receipt = transport::read(&app, "readerCompletion", json!({
                "expectedOwner":owner,"document_id":document
            })).await?;
            if id(&receipt["document_id"])? != document_id || receipt["completed"] != true {
                return Err("原站读完状态无法确认，请重新打开文章".into());
            }
            let completed_at = completion_time(&receipt["completed_at"]).ok_or("原站读完时间缺失")?;
            state["completedAt"] = json!(completed_at);
        }
    }
    payload["readerState"] = state.clone();
    db.with_conn(|conn| ielts_db::transient_assets::put(conn, "idictation", &asset_id, payload))
        .map_err(|_| "原站已确认，请重新打开文章刷新阅读状态")?;
    Ok(state)
}

#[cfg(test)]
#[path = "../../developer/tests/rust/idictation_reader.rs"]
mod tests;
