use super::*;
use serde_json::json;

#[test]
fn catalog_keeps_all_album_memberships_without_duplicate_cards() {
    let mut units = std::collections::BTreeMap::new();
    for album_id in ["z", "other", "z"] {
        let title = if album_id == "z" {
            "Z家阅读11月高频"
        } else {
            "阅读精选"
        };
        let album = json!({"id":album_id,"title":title,"channel":"reading"});
        let row = json!({"id":"unit-1","albumId":album_id,"channel":"reading",
            "entryMode":"exam","title":"Article","partNo":"P1",
            "available":true,"lockedForOrdinaryUsers":false});
        merge_album(&mut units, &album, &[row]).unwrap();
    }
    assert_eq!(units.len(), 1);
    let entry = units.values().next().unwrap();
    assert_eq!(entry.albums.len(), 2);
    assert!(entry
        .albums
        .iter()
        .any(|album| album.title == "Z家阅读11月高频"));
    assert_eq!(entry.parts, vec!["P1"]);
    assert!(entry.available);
}

#[test]
fn catalog_loads_previously_saved_entries_without_albums() {
    let entry: Entry = serde_json::from_value(json!({"id":"unit-1","title":"Article",
        "channel":"reading","parts":["P1"],"available":true}))
    .unwrap();
    assert!(entry.albums.is_empty());
}
