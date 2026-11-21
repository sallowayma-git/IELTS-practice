use super::*;
use serde_json::json;

fn entry(database: &str, provider: &str, asset_id: &str, value: u32) -> Entry {
    Entry {
        database: database.into(), provider: provider.into(),
        asset_id: asset_id.into(), payload: json!({"revision":value}),
    }
}

#[test]
fn provider_disconnect_preserves_other_sources_and_database_isolation() {
    let mut cache = PayloadCache::default();
    cache.put(entry("db-a", "jiufen", "first", 1));
    cache.put(entry("db-a", "idictation", "second", 2));
    cache.put(entry("db-b", "idictation", "second", 3));
    cache.clear_provider("jiufen");
    assert!(cache.get("db-a", "first").is_none());
    assert_eq!(cache.get("db-a", "second"), Some(&json!({"revision":2})));
    assert_eq!(cache.get("db-b", "second"), Some(&json!({"revision":3})));
    assert!(cache.get("db-c", "second").is_none());
    cache.clear_provider("jiufen");
    assert_eq!(cache.0.len(), 2);
}

#[test]
fn updates_replace_one_entry_and_capacity_remains_bounded() {
    let mut cache = PayloadCache::default();
    cache.put(entry("db", "fixture", "first", 1));
    cache.put(entry("db", "fixture", "first", 2));
    assert_eq!(cache.0.len(), 1);
    assert_eq!(cache.get("db", "first"), Some(&json!({"revision":2})));
    for i in 0..16 {
        cache.put(entry("db", "fixture", &format!("asset-{i}"), i));
    }
    assert_eq!(cache.0.len(), 16);
    assert!(cache.get("db", "first").is_none());
    assert_eq!(cache.get("db", "asset-15"), Some(&json!({"revision":15})));
}

#[test]
fn public_cache_retains_material_when_an_unrelated_provider_expires() {
    let folder = tempfile::tempdir().unwrap();
    let conn = Connection::open(folder.path().join("cache.db")).unwrap();
    let provider = "cache-test-source";
    put(&conn, provider, "fixture", json!({"text":"material"})).unwrap();
    clear_provider("cache-test-other-source");
    assert_eq!(get(&conn, "fixture").unwrap(), json!({"text":"material"}));
    clear_provider(provider);
    assert!(get(&conn, "fixture").is_err());
}
