use super::service::{authorized, identifier, Account};
use crate::app::state::AppDb;
use ielts_db::settings;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tauri::State;

const MODES: &str = "?includeEntryModes=memory_link,spelling_recall";

#[derive(Default)]
pub(super) struct Access {
    units: HashMap<String, String>,
}

fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or_default()
}
fn list(v: &Value) -> Result<&Vec<Value>, String> {
    v["data"]["list"]
        .as_array()
        .ok_or_else(|| "题源列表格式异常".into())
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Album {
    id: String,
    title: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotlistEntry {
    album_id: String,
    slot_key: String,
    part: String,
    rank: u64,
    seven_day_report_total: Option<u64>,
    heat_band: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Entry {
    id: String,
    title: String,
    channel: String,
    parts: Vec<String>,
    available: bool,
    #[serde(default)]
    albums: Vec<Album>,
    #[serde(default)]
    hotlist: Vec<HotlistEntry>,
}

#[derive(Serialize, Deserialize)]
pub struct Catalog {
    items: Vec<Entry>,
    #[serde(default)]
    warning: Option<String>,
}

fn parts(row: &Value) -> Vec<String> {
    let mut labels = Vec::new();
    let parts = std::iter::once(&row["partNo"]).chain(
        row["parts"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| &p["partNo"]),
    );
    for part in parts {
        let raw = part
            .as_str()
            .unwrap_or_default()
            .trim_start_matches("Part ")
            .trim_start_matches('P');
        if let Ok(n @ 1..=4) = raw.parse::<u8>() {
            labels.push(format!("P{n}"));
        }
    }
    labels.sort();
    labels.dedup();
    labels
}
pub(super) async fn fetch_catalog(
    session: &mut Option<super::service::Session>,
) -> Result<Catalog, String> {
    let response = authorized(session, "/practice/v1/runtime-mode", None).await?;
    if response["data"]["effectiveMode"] != "online" {
        return Err("当前题源需要资源包".into());
    }
    let response = authorized(session, &format!("/practice/v1/albums{MODES}"), None).await?;
    let mut units = std::collections::BTreeMap::new();
    for album in list(&response)? {
        let channel = text(album, "channel");
        if album["hidden"] == true || !matches!(channel, "reading" | "listening") {
            continue;
        }
        let id = identifier(&album["id"]).ok_or("专辑标识无效")?;
        let response = authorized(
            session,
            &format!("/practice/v1/albums/{id}/units{MODES}"),
            None,
        )
        .await?;
        if response["data"]["albumId"] != id {
            return Err("专辑不匹配".into());
        }
        merge_album(&mut units, album, list(&response)?)?;
    }
    let mut warning = None;
    match fetch_hotlists(session).await {
        Ok((albums, partial_warning)) => {
            let mut enriched = units.clone();
            match merge_hotlists(&mut enriched, &albums) {
                Ok(()) => units = enriched,
                Err(error) => warning = Some(format!("热榜同步未完成：{error}")),
            }
            warning = warning.or(partial_warning);
        }
        Err(error) if session.is_none() => return Err(error),
        Err(error) => warning = Some(format!("热榜同步未完成：{error}")),
    }
    Ok(Catalog {
        items: units.into_values().collect(),
        warning,
    })
}

async fn fetch_hotlists(
    session: &mut Option<super::service::Session>,
) -> Result<(Vec<Value>, Option<String>), String> {
    let response = authorized(
        session,
        &format!("/practice/v1/high-frequency/albums{MODES}"),
        None,
    )
    .await?;
    let mut albums = list(&response)?.clone();
    let features = match authorized(session, "/practice/v1/me/feature-entitlements", None).await {
        Ok(features) => features,
        Err(error) if session.is_none() => return Err(error),
        Err(error) => return Ok((albums, Some(format!("热榜扩展范围同步未完成：{error}")))),
    };
    let mut warning = None;
    if more_hotlist_rows_enabled(&features["data"]) {
        for album in &mut albums {
            let album_id = identifier(&album["albumId"]).ok_or("热榜专辑标识无效")?;
            let slots = album["slots"].as_array_mut().ok_or("热榜分组格式异常")?;
            for slot in slots {
                if let Err(error) = fetch_hotlist_slot(session, &album_id, slot).await {
                    if session.is_none() {
                        return Err(error);
                    }
                    warning = Some(format!("热榜更多条目同步未完成：{error}"));
                }
            }
        }
    }
    Ok((albums, warning))
}

fn more_hotlist_rows_enabled(data: &Value) -> bool {
    let explicit = data["features"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|feature| {
            ["featureCode", "code", "feature", "name"]
                .iter()
                .find_map(|key| feature[key].as_str())
                == Some("high_frequency_more_rows")
        });
    explicit.map_or(
        data["entitlements"]["high_frequency_more_rows"] == true,
        |feature| feature["enabled"] == true,
    )
}

async fn fetch_hotlist_slot(
    session: &mut Option<super::service::Session>,
    album_id: &str,
    slot: &mut Value,
) -> Result<(), String> {
    let key = slot["key"].as_str().ok_or("热榜分组标识无效")?.to_owned();
    let limit = slot["maxDisplayRows"].as_u64().ok_or("热榜展示数量无效")? as usize;
    while slot["hasMore"] == true {
        let offset = slot["list"].as_array().ok_or("热榜题目格式异常")?.len();
        if offset >= limit {
            break;
        }
        let mut url = reqwest::Url::parse("https://www.9fnnn.com").unwrap();
        url.path_segments_mut().unwrap().extend([
            "practice",
            "v1",
            "high-frequency",
            "albums",
            album_id,
            "slots",
            &key,
            "rows",
        ]);
        url.query_pairs_mut()
            .append_pair("includeEntryModes", "memory_link,spelling_recall")
            .append_pair("offset", &offset.to_string())
            .append_pair("limit", &(limit - offset).min(20).to_string());
        let path = format!("{}?{}", url.path(), url.query().unwrap());
        let response = authorized(session, &path, None).await?;
        if !append_hotlist_page(slot, &response["data"], album_id, limit)? {
            break;
        }
    }
    Ok(())
}

fn append_hotlist_page(
    slot: &mut Value,
    data: &Value,
    album_id: &str,
    limit: usize,
) -> Result<bool, String> {
    let rows = data
        .as_array()
        .or_else(|| data["list"].as_array())
        .or_else(|| data["rows"].as_array())
        .ok_or("热榜分页格式异常")?;
    let channel = slot["channel"].clone();
    let stored = slot["list"].as_array_mut().ok_or("热榜题目格式异常")?;
    let offset = stored.len();
    let remaining = limit.saturating_sub(stored.len());
    let progressed = !rows.is_empty() && remaining > 0;
    // Offset counts all remote entry modes, including external memory links.
    for (index, row) in rows.iter().take(remaining).enumerate() {
        let mut row = row.clone();
        if !row.is_object() {
            return Err("热榜分页题目格式异常".into());
        }
        if row["id"].is_null() {
            row["id"] = row["unitId"].clone();
        }
        if row["albumId"].is_null() {
            row["albumId"] = Value::String(album_id.to_owned());
        }
        if row["channel"].is_null() {
            row["channel"] = channel.clone();
        }
        if row["rank"].is_null() {
            row["rank"] = serde_json::json!(offset + index + 1);
        }
        stored.push(row);
    }
    slot["hasMore"] = data["hasMore"].clone();
    Ok(progressed)
}

fn merge_hotlists(
    units: &mut std::collections::BTreeMap<(String, String), Entry>,
    albums: &[Value],
) -> Result<(), String> {
    for album in albums {
        let channel = text(album, "channel");
        if !matches!(channel, "reading" | "listening") || album["hidden"] == true {
            continue;
        }
        let album_id = identifier(&album["albumId"]).ok_or("热榜专辑标识无效")?;
        let slots = album["slots"].as_array().ok_or("热榜分组格式异常")?;
        for slot in slots {
            merge_hotlist_slot(units, &album_id, channel, slot)?;
        }
    }
    Ok(())
}

fn merge_hotlist_slot(
    units: &mut std::collections::BTreeMap<(String, String), Entry>,
    album_id: &str,
    channel: &str,
    slot: &Value,
) -> Result<(), String> {
    if slot["channel"] != channel {
        return Err("热榜科目不匹配".into());
    }
    let slot_parts = parts(slot);
    let part = slot_parts.first().ok_or("热榜 Part 无效")?;
    let slot_key = slot["key"].as_str().ok_or("热榜分组标识无效")?;
    let rows = slot["list"].as_array().ok_or("热榜题目格式异常")?;
    // Ranking identity is separate from ordinary source album labels.
    let source = serde_json::json!({"id":album_id,"channel":channel});
    merge_album(units, &source, rows)?;
    for row in rows {
        if row["entryMode"] != "exam" || row["albumId"] != album_id || row["channel"] != channel {
            continue;
        }
        let id = identifier(&row["id"]).ok_or("热榜题目标识无效")?;
        let rank = row["rank"]
            .as_u64()
            .filter(|rank| *rank > 0)
            .ok_or("热榜排名无效")?;
        if !parts(row).contains(part) {
            return Err("热榜题目 Part 不匹配".into());
        }
        let entry = units
            .get_mut(&(channel.to_owned(), id))
            .ok_or("热榜题目缺失")?;
        if entry
            .hotlist
            .iter()
            .any(|item| item.album_id == album_id && item.slot_key == slot_key)
        {
            continue;
        }
        entry.hotlist.push(HotlistEntry {
            album_id: album_id.to_owned(),
            slot_key: slot_key.to_owned(),
            part: part.clone(),
            rank,
            seven_day_report_total: row["sevenDayReportTotal"].as_u64(),
            heat_band: row["heatBand"].as_str().map(str::to_owned),
        });
    }
    Ok(())
}

fn merge_album(
    units: &mut std::collections::BTreeMap<(String, String), Entry>,
    album: &Value,
    rows: &[Value],
) -> Result<(), String> {
    let channel = text(album, "channel");
    let album_id = identifier(&album["id"]).ok_or("专辑标识无效")?;
    for u in rows {
        if u["entryMode"] != "exam" || u["albumId"] != album_id || u["channel"] != channel {
            continue;
        }
        let id = identifier(&u["id"]).ok_or("题目标识无效")?;
        let available = u["available"] == true && u["lockedForOrdinaryUsers"] == false;
        let entry = units
            .entry((channel.to_owned(), id.clone()))
            .or_insert_with(|| Entry {
                id,
                title: text(u, "title").into(),
                channel: channel.into(),
                parts: vec![],
                available: false,
                albums: vec![],
                hotlist: vec![],
            });
        entry.parts.extend(parts(u));
        entry.parts.sort();
        entry.parts.dedup();
        entry.available |= available;
        let title = text(album, "title").trim();
        if !title.is_empty() && !entry.albums.iter().any(|a| a.id == album_id) {
            entry.albums.push(Album {
                id: album_id.clone(),
                title: title.into(),
            });
            entry.albums.sort_by(|a, b| a.id.cmp(&b.id));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "../../developer/tests/rust/jiufen_catalog.rs"]
mod tests;
#[tauri::command]
pub async fn jiufen_library(
    account: State<'_, Account>,
    db: State<'_, AppDb>,
    refresh: bool,
) -> Result<Catalog, String> {
    let mut session = account.0.lock().await;
    let Some(current) = session.as_ref() else {
        return Ok(Catalog {
            items: vec![],
            warning: None,
        });
    };
    let key = format!(
        "catalog-v1-{}",
        hex::encode(Sha256::digest(current.owner.as_bytes()))
    );
    let catalog = if refresh {
        let rows = fetch_catalog(&mut session).await?;
        db.with_conn(|c| {
            settings::upsert_setting(c, super::service::NS, &key, &serde_json::json!(rows))
        })
        .map_err(|e| e.to_string())?;
        rows
    } else {
        let row = db
            .with_conn(|c| settings::get_setting(c, super::service::NS, &key))
            .map_err(|e| e.to_string())?;
        match row {
            Some(r) => decode_catalog(r.value)?,
            None => Catalog {
                items: vec![],
                warning: None,
            },
        }
    };
    if let Some(current) = session.as_mut() {
        current.catalog.units = catalog
            .items
            .iter()
            .filter(|r| r.available)
            .map(|r| (r.id.clone(), r.channel.clone()))
            .collect();
    }
    Ok(catalog)
}

fn decode_catalog(value: Value) -> Result<Catalog, String> {
    if value.is_array() {
        return serde_json::from_value(value)
            .map(|items| Catalog {
                items,
                warning: None,
            })
            .map_err(|_| "题目目录需重新同步".into());
    }
    serde_json::from_value(value).map_err(|_| "题目目录需重新同步".into())
}

pub(super) fn media_url(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw).ok()?;
    (url.scheme() == "https"
        && url.host_str() == Some("static.9fnnn.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none())
    .then(|| url.to_string())
}
pub(super) async fn fetch_unit(
    session: &mut Option<super::service::Session>,
    unit_id: &str,
) -> Result<Value, String> {
    let channel = session
        .as_ref()
        .and_then(|s| s.catalog.units.get(unit_id))
        .ok_or("请从题库选择可用的九分学长题目")?
        .clone();
    let response = authorized(session, &format!("/practice/v1/units/{unit_id}/exam"), None).await?;
    let unit = &response["data"];
    if unit["id"] != unit_id || unit["channel"] != channel {
        return Err("返回的试题与所选题目不一致".into());
    }
    Ok(unit.clone())
}
