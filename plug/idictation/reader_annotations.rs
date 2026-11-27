use super::{material::utf16_bytes, reader::source_sentence, service::{verify, Account}, transport, vocabulary::id};
use crate::app::state::AppDb;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tauri::{AppHandle, State};

const PENDING: &str = "idictation.reader-annotation.pending";

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Action {
    Highlight { enabled: bool },
    Note { text: String },
    DeleteNote,
}

fn anchor(block: &Value, sentence: &Value) -> Option<Value> {
    let text = block["text"].as_str()?;
    let start = sentence["start_offset"].as_u64()?;
    let end = sentence["end_offset"].as_u64()?;
    let quote = text.get(utf16_bytes(text, start).ok()?..utf16_bytes(text, end).ok()?)?;
    Some(json!({"block_key":block["block_key"].as_str()?,"start":start,"end":end,"quote":quote}))
}

fn record(value: &Value) -> Option<Value> {
    let kind = value["kind"].as_str().filter(|kind| matches!(*kind, "highlight" | "note"))?;
    let key = value["client_key"].as_str().filter(|key| !key.is_empty() && key.len() <= 128)?;
    let lock = value["lock_version"].as_u64()?;
    let note = value["note"].as_str().unwrap_or_default();
    let identity = &value["id"];
    if (!identity.as_u64().is_some_and(|id| id > 0)
        && !identity.as_str().is_some_and(|id| !id.is_empty() && id.len() <= 128)) || note.len() > 4096 {
        return None;
    }
    Some(json!({"kind":kind,"id":identity,"client_key":key,"lock_version":lock,"note":note}))
}

pub(super) fn snapshot(payload: &Value, raw: &Value) -> Value {
    let source = &payload["idictation"];
    let document = id(&source["document"]["id"]).unwrap_or_default();
    let version = id(&source["version"]["id"]).unwrap_or_default();
    let mut by_anchor = HashMap::new();
    for block in source["blocks"].as_array().into_iter().flatten() {
        for sentence in block["sentences"].as_array().into_iter().flatten() {
            if let (Some(anchor), Ok(sid)) = (anchor(block, sentence), id(&sentence["id"])) {
                by_anchor.insert(anchor.to_string(), format!("idictation-reader-{document}-v{version}-s{sid}"));
            }
        }
    }
    let mut rows: HashMap<_, Vec<_>> = HashMap::new();
    for row in raw.as_array().into_iter().flatten() {
        if let (Some(sentence), Some(annotation)) = (by_anchor.get(&row["anchor"].to_string()), record(row)) {
            rows.entry(sentence.clone()).or_default().push(annotation);
        }
    }
    json!(rows)
}

fn draft_key(db: &AppDb, scope: &str) -> Result<String, String> {
    db.with_conn(|conn| {
        if let Some(previous) = ielts_db::settings::get_setting(conn, PENDING, scope)? {
            return previous.value.as_str().map(str::to_owned)
                .ok_or_else(|| ielts_db::DbError::Validation("精读批注确认状态无效".into()));
        }
        let key = uuid::Uuid::new_v4().to_string();
        ielts_db::settings::upsert_setting(conn, PENDING, scope, &json!(key))?;
        Ok(key)
    }).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn idictation_reader_annotation(app: AppHandle, account: State<'_, Account>, db: State<'_, AppDb>,
    asset_id: String, sentence_id: String, action: Action) -> Result<Vec<Value>, String>
{
    let (kind, replacement) = match action {
        Action::Highlight { enabled } => ("highlight", enabled.then(String::new)),
        Action::Note { text } if !text.trim().is_empty() && text.len() <= 4096 => ("note", Some(text)),
        Action::Note { .. } => return Err("请输入笔记，长度不能超过 4096 字节".into()),
        Action::DeleteNote => ("note", None),
    };
    let mut session = account.0.lock().await;
    verify(&app, &mut session).await?;
    if !session.reader.has_asset(&asset_id) { return Err("请从当前账号的精读目录重新打开文章".into()); }
    let owner = session.owner.as_deref().ok_or("请先连接爱听写账号")?;
    let mut payload = db.with_conn(|conn| ielts_db::transient_assets::get(conn, &asset_id))
        .map_err(|error| error.to_string())?;
    let (block, sentence) = source_sentence(&payload, &sentence_id)?;
    let anchor = anchor(block, sentence).ok_or("精读句子位置无效")?;
    let source = &payload["idictation"];
    let mut rows = payload["readerAnnotations"][&sentence_id].as_array().cloned().unwrap_or_default();
    let previous = rows.iter().position(|row| row["kind"] == kind);
    let scope = hex::encode(Sha256::digest(json!([owner, sentence_id, kind]).to_string()));
    if let Some(note) = replacement {
        if previous.is_some_and(|index| rows[index]["note"] == note) { return Ok(rows); }
        let (key, lock) = match previous {
            Some(index) => (rows[index]["client_key"].as_str().unwrap_or_default().to_owned(), rows[index]["lock_version"].clone()),
            None => (draft_key(&db, &scope)?, json!(0)),
        };
        let receipt = transport::read(&app, "readerAnnotationSave", json!({"expectedOwner":owner,"request":{
            "document_id":source["document"]["id"],"version_id":source["version"]["id"],
            "client_key":key,"kind":kind,"quote":anchor["quote"],"anchor_segments":[anchor],
            "note":note,"lock_version":lock,"sentence_ids":[sentence["id"]]
        }})).await?;
        let saved = record(&receipt).filter(|row| row["client_key"] == key && row["kind"] == kind
            && row["note"] == note && receipt["anchor_segments"] == json!([anchor]))
            .ok_or("原站批注回执无法确认，请重新打开文章核对")?;
        if let Some(index) = previous { rows[index] = saved; } else { rows.push(saved); }
    } else if let Some(index) = previous {
        transport::read(&app, "readerAnnotationDelete", json!({"expectedOwner":owner,"request":{
            "id":rows[index]["id"],"lock_version":rows[index]["lock_version"]
        }})).await?;
        rows.remove(index);
    } else {
        return Ok(rows);
    }
    payload["readerAnnotations"][&sentence_id] = json!(rows);
    db.with_conn(|conn| ielts_db::transient_assets::put(conn, "idictation", &asset_id, payload))
        .map_err(|error| error.to_string())?;
    db.with_conn(|conn| ielts_db::settings::delete_setting(conn, PENDING, &scope))
        .map_err(|error| error.to_string())?;
    session.reader.clear_collection_grants();
    Ok(rows)
}
