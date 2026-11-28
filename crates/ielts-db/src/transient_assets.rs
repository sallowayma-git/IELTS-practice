//! Bounded process-only payloads for remote providers. SQLite retains their index.
use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

use rusqlite::Connection;
use serde_json::Value;

use crate::{DbError, DbResult};

struct Entry {
    database: String,
    provider: String,
    asset_id: String,
    payload: Value,
}

#[derive(Default)]
struct PayloadCache(VecDeque<Entry>);

impl PayloadCache {
    fn put(&mut self, entry: Entry) {
        self.0.retain(|old| old.database != entry.database || old.asset_id != entry.asset_id);
        self.0.push_back(entry);
        while self.0.len() > 16 {
            self.0.pop_front();
        }
    }

    fn get(&self, database: &str, asset_id: &str) -> Option<&Value> {
        self.0.iter()
            .find(|entry| entry.database == database && entry.asset_id == asset_id)
            .map(|entry| &entry.payload)
    }

    fn clear_provider(&mut self, provider: &str) {
        self.0.retain(|entry| entry.provider != provider);
    }
}

static PAYLOADS: OnceLock<Mutex<PayloadCache>> = OnceLock::new();

fn database_key(conn: &Connection) -> String {
    conn.path().unwrap_or("").to_owned()
}

/// The host supplies the owning provider; it is never inferred from remote JSON.
pub fn put(conn: &Connection, provider: &str, asset_id: &str, payload: Value) -> DbResult<()> {
    let mut cache = PAYLOADS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| DbError::Message("remote payload cache unavailable".into()))?;
    cache.put(Entry {
        database: database_key(conn), provider: provider.into(),
        asset_id: asset_id.into(), payload,
    });
    Ok(())
}

pub fn get(conn: &Connection, asset_id: &str) -> DbResult<Value> {
    let cache = PAYLOADS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| DbError::Message("remote payload cache unavailable".into()))?;
    cache
        .get(&database_key(conn), asset_id)
        .cloned()
        .ok_or_else(|| DbError::Validation("请联网重新打开这道题，加载题源内容".into()))
}

/// One provider's logout or expiry must not evict another provider's material.
pub fn clear_provider(provider: &str) {
    if let Ok(mut cache) = PAYLOADS.get_or_init(Default::default).lock() {
        cache.clear_provider(provider);
    }
}

#[cfg(test)]
#[path = "../../../developer/tests/rust/remote_payload_cache.rs"]
mod tests;
