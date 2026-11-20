//! Bounded process-only payloads for remote providers. SQLite retains their index.
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

use rusqlite::Connection;
use serde_json::Value;

use crate::{DbError, DbResult};

type Entry = (String, String, Value);
static PAYLOADS: OnceLock<Mutex<VecDeque<Entry>>> = OnceLock::new();

fn database_key(conn: &Connection) -> String {
    conn.path().unwrap_or("").to_owned()
}

pub fn put(conn: &Connection, asset_id: &str, payload: Value) -> DbResult<()> {
    let mut cache = PAYLOADS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| DbError::Message("remote payload cache unavailable".into()))?;
    let key = database_key(conn);
    cache.retain(|(db, id, _)| db != &key || id != asset_id);
    cache.push_back((key, asset_id.into(), payload));
    while cache.len() > 16 {
        cache.pop_front();
    }
    Ok(())
}

pub fn get(conn: &Connection, asset_id: &str) -> DbResult<Value> {
    let cache = PAYLOADS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| DbError::Message("remote payload cache unavailable".into()))?;
    let key = database_key(conn);
    cache
        .iter()
        .find(|(db, id, _)| db == &key && id == asset_id)
        .map(|(_, _, payload)| payload.clone())
        .ok_or_else(|| DbError::Validation("请联网重新打开这道题，加载九分学长题面".into()))
}

/// Account changes discard every provider payload in this desktop process.
pub fn clear() {
    if let Ok(mut cache) = PAYLOADS.get_or_init(Default::default).lock() {
        cache.clear();
    }
}
