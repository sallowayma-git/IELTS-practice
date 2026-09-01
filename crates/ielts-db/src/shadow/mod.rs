//! Shadow dual-read helpers.
//!
//! Phase 10: production path is SQLite v2 single-source. These helpers remain for
//! migration/import tests only — they must not drive user-facing read/write flows.

use serde::Serialize;

use ielts_domain::HistoryListItemVm;
use rusqlite::Connection;

use crate::import::list_history_view_models;
use crate::sqlite::DbResult;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShadowDiff {
    pub id: String,
    pub field: String,
    pub left: String,
    pub right: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShadowReport {
    pub left_count: usize,
    pub right_count: usize,
    pub matched: usize,
    pub diffs: Vec<ShadowDiff>,
}

/// Compare two history view-model lists (old service vs new DB projection).
/// Differences are recorded only; callers must not affect user flows.
pub fn compare_history_views(
    left: &[HistoryListItemVm],
    right: &[HistoryListItemVm],
) -> ShadowReport {
    let mut report = ShadowReport {
        left_count: left.len(),
        right_count: right.len(),
        ..Default::default()
    };

    use std::collections::BTreeMap;
    let right_map: BTreeMap<_, _> = right.iter().map(|item| (item.id.clone(), item)).collect();

    for item in left {
        match right_map.get(&item.id) {
            None => report.diffs.push(ShadowDiff {
                id: item.id.clone(),
                field: "presence".into(),
                left: "present".into(),
                right: "missing".into(),
            }),
            Some(other) => {
                let mut item_diffs = Vec::new();
                if item.title != other.title {
                    item_diffs.push(("title", item.title.clone(), other.title.clone()));
                }
                if item.score_display != other.score_display {
                    item_diffs.push((
                        "scoreDisplay",
                        item.score_display.clone(),
                        other.score_display.clone(),
                    ));
                }
                if item.duration_ms != other.duration_ms {
                    item_diffs.push((
                        "durationMs",
                        item.duration_ms.to_string(),
                        other.duration_ms.to_string(),
                    ));
                }
                if item.activity != other.activity {
                    item_diffs.push((
                        "activity",
                        format!("{:?}", item.activity),
                        format!("{:?}", other.activity),
                    ));
                }
                if item_diffs.is_empty() {
                    report.matched += 1;
                } else {
                    for (field, l, r) in item_diffs {
                        report.diffs.push(ShadowDiff {
                            id: item.id.clone(),
                            field: field.into(),
                            left: l,
                            right: r,
                        });
                    }
                }
            }
        }
    }

    for item in right {
        if !left.iter().any(|l| l.id == item.id) {
            report.diffs.push(ShadowDiff {
                id: item.id.clone(),
                field: "presence".into(),
                left: "missing".into(),
                right: "present".into(),
            });
        }
    }

    report
}

pub fn shadow_read_from_db(
    conn: &Connection,
    expected: &[HistoryListItemVm],
) -> DbResult<ShadowReport> {
    let actual = list_history_view_models(conn)?;
    Ok(compare_history_views(expected, &actual))
}
