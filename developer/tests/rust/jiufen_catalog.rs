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
    assert!(entry.hotlist.is_empty());
    let cached = decode_catalog(json!([entry])).unwrap();
    assert_eq!(cached.items.len(), 1);
    assert!(cached.warning.is_none());
    let partial = decode_catalog(json!({"items":cached.items,"warning":"热榜同步未完成"})).unwrap();
    assert_eq!(partial.items.len(), 1);
    assert_eq!(partial.warning.as_deref(), Some("热榜同步未完成"));
}

fn hot_row(id: &str, channel: &str, mode: &str, rank: u64) -> Value {
    json!({"id":id,"albumId":"hot","channel":channel,"entryMode":mode,
        "title":"Hot article","partNo":"Part 2","rank":rank,
        "sevenDayReportTotal":155,"heatBand":"gt150","available":true,"lockedForOrdinaryUsers":false})
}

fn hot_album(channel: &str, rows: Vec<Value>) -> Value {
    json!({"albumId":"hot","channel":channel,"title":"7天热榜","slots":[{
        "key":"part:Part 2","partNo":"Part 2","channel":channel,"list":rows
    }]})
}

#[test]
fn hotlist_merges_by_channel_and_id_and_preserves_official_rank_gaps() {
    let mut units = std::collections::BTreeMap::new();
    let album = json!({"id":"z","channel":"reading","title":"Z家高频"});
    let mut normal = hot_row("shared", "reading", "exam", 1);
    normal["albumId"] = json!("z");
    merge_album(&mut units, &album, &[normal]).unwrap();
    let rows = vec![
        hot_row("shared", "reading", "exam", 2),
        hot_row("external", "reading", "memory_link", 1),
    ];
    let albums = vec![
        hot_album("reading", rows),
        hot_album("listening", vec![hot_row("shared", "listening", "exam", 5)]),
    ];
    merge_hotlists(&mut units, &albums).unwrap();
    merge_hotlists(&mut units, &albums).unwrap();
    assert_eq!(units.len(), 2);
    let reading = &units[&("reading".into(), "shared".into())];
    assert_eq!(reading.albums.len(), 1);
    assert_eq!(reading.hotlist.len(), 1);
    assert_eq!(reading.hotlist[0].rank, 2);
    assert_eq!(reading.hotlist[0].part, "P2");
    assert_eq!(reading.hotlist[0].seven_day_report_total, Some(155));
    let listening = &units[&("listening".into(), "shared".into())];
    assert_eq!(listening.hotlist[0].rank, 5);
    assert!(listening.available);
    assert_eq!(listening.parts, ["P2"]);
}

#[test]
fn hotlist_never_infers_membership_from_titles_or_unlocks_locked_rows() {
    let mut units = std::collections::BTreeMap::new();
    let mut locked = hot_row("locked", "reading", "exam", 3);
    locked["lockedForOrdinaryUsers"] = json!(true);
    merge_hotlists(&mut units, &[hot_album("reading", vec![locked])]).unwrap();
    assert!(!units.values().next().unwrap().available);
    let normal = hot_row("regular", "reading", "exam", 1);
    merge_album(
        &mut units,
        &json!({"id":"hot","title":"7天热榜高频","channel":"reading"}),
        &[normal],
    )
    .unwrap();
    assert!(units[&("reading".into(), "regular".into())]
        .hotlist
        .is_empty());
    let saved = serde_json::to_value(units.values().cloned().collect::<Vec<_>>()).unwrap();
    let restored: Vec<Entry> = serde_json::from_value(saved).unwrap();
    assert_eq!(
        restored
            .iter()
            .filter(|entry| !entry.hotlist.is_empty())
            .count(),
        1
    );
}

#[test]
fn hotlist_rejects_wrong_part_and_uses_explicit_more_rows_entitlement() {
    let mut units = std::collections::BTreeMap::new();
    let mut row = hot_row("bad-part", "reading", "exam", 1);
    row["partNo"] = json!("Part 3");
    assert!(merge_hotlists(&mut units, &[hot_album("reading", vec![row])]).is_err());
    assert!(!more_hotlist_rows_enabled(&json!({})));
    assert!(!more_hotlist_rows_enabled(
        &json!({"entitlements":{"high_frequency_more_rows":"true"}})
    ));
    assert!(more_hotlist_rows_enabled(
        &json!({"entitlements":{"high_frequency_more_rows":true}})
    ));
    assert!(!more_hotlist_rows_enabled(
        &json!({"entitlements":{"high_frequency_more_rows":true},
        "features":[{"featureCode":"high_frequency_more_rows","enabled":false}]})
    ));
}

#[test]
fn hotlist_pages_count_all_entry_modes_and_stop_at_the_server_limit() {
    let mut slot = json!({"list":[hot_row("exam1","listening","exam",1),hot_row("link2","listening","memory_link",2)],"hasMore":true});
    let page = json!({"rows":[hot_row("link3","listening","memory_link",3),hot_row("exam4","listening","exam",4)],"hasMore":true});
    assert!(append_hotlist_page(&mut slot, &page, "hot", 4).unwrap());
    assert_eq!(slot["list"].as_array().unwrap().len(), 4);
    assert_eq!(slot["list"][3]["rank"], 4);
    assert!(!append_hotlist_page(&mut slot, &page, "hot", 4).unwrap());
    assert!(
        !append_hotlist_page(&mut slot, &json!({"list":[],"hasMore":false}), "hot", 5).unwrap()
    );
    assert_eq!(slot["hasMore"], false);
    assert!(append_hotlist_page(&mut slot, &json!({}), "hot", 5).is_err());
    slot["channel"] = json!("listening");
    assert!(append_hotlist_page(
        &mut slot,
        &json!({"rows":[{"unitId":"unit5"}],"hasMore":false}),
        "hot",
        5
    )
    .unwrap());
    assert_eq!(
        slot["list"][4],
        json!({"unitId":"unit5","id":"unit5","albumId":"hot","channel":"listening","rank":5})
    );
}
