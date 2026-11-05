//! Forgetting: what the weekly consolidation lets go of.
//!
//! Long-term memory that only grows turns into noise, and a memory about a
//! difficulty the learner has since overcome is worse than none: it makes the coach
//! teach yesterday's learner. Promotion (the model's weekly mutations) and
//! forgetting (this sweep) are the two halves of one weekly pass, and the sweep is
//! its deterministic half: no model call, no judgement, only three rules over the
//! timestamps and counters memories already carry.
//!
//! * `expired`: a memory whose `valid_to` has come (a `recent` memory is written
//!   with an expiry 30 days out; see `MemoryHorizon`).
//! * `improved`: an inferred memory the weekly pass marked `improved` and nothing
//!   has observed for [`IMPROVED_FORGET_DAYS`] days. The learner got past it.
//! * `stale`: an inferred preference, strategy, behavior or metacognition memory
//!   that was neither observed nor recalled for [`STALE_FORGET_DAYS`] days and was
//!   recalled fewer than [`STALE_RECALL_FLOOR`] times in all. Nobody needed it.
//!
//! The learner's own memories (`user_explicit`) and policy memories are never
//! touched, and `goal` memories are never forgotten for being quiet. Forgetting
//! archives, never deletes: the row, its evidence and its audit trail stay, and
//! the reason is written to `memory_mutations` through the same archive path as a
//! capacity eviction.
//!
//! The sweep is idempotent (an archived memory matches no rule), takes `now` from
//! the caller, and runs in one transaction: it archives everything or nothing.

use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection, TransactionBehavior};

use crate::sqlite::DbResult;

/// An `improved` memory is forgotten once it was last observed longer ago than this.
pub const IMPROVED_FORGET_DAYS: i64 = 21;
/// A quiet memory is forgotten once it was last observed or recalled longer ago than this...
pub const STALE_FORGET_DAYS: i64 = 90;
/// ...and was recalled fewer than this many times in its life.
pub const STALE_RECALL_FLOOR: i64 = 3;

/// The audit actor of every forgetting archive: the weekly pass, not the model.
const ACTOR_TYPE: &str = "dream";
const ACTOR_ID: &str = "weekly_dream";

/// A memory the learner or policy owns. Expiry never touches these either, even
/// if a row somehow carries a `valid_to`.
const NOT_OWNED: &str = "source_class NOT IN ('user_explicit','system_policy')";
/// What the model inferred. Only these can be outgrown or go stale.
const INFERRED: &str = "source_class IN ('inferred','consolidated','observed')";
/// Namespaces that can go stale for being quiet. `goal` never does.
const QUIET_NAMESPACES: &str = "namespace IN ('preference','strategy','behavior','metacognition')";

/// What one sweep archived, by reason, memory ids in ascending order.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ForgetReport {
    pub expired: Vec<String>,
    pub improved: Vec<String>,
    pub stale: Vec<String>,
}

impl ForgetReport {
    pub fn total(&self) -> usize {
        self.expired.len() + self.improved.len() + self.stale.len()
    }
}

/// Archive every active memory of `user_id` the three rules above let go of, as of
/// `now`. All or nothing; a second run at the same `now` archives nothing more.
///
/// The transaction takes the write lock up front, so what a rule selected cannot
/// change before it is archived, and each archive is still checked against the
/// version that was selected (a compare-and-set, as for every other archive).
pub fn sweep_forgotten_memories(conn: &Connection, user_id: &str, now: DateTime<Utc>) -> DbResult<ForgetReport> {
    let tx = rusqlite::Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let at = now.to_rfc3339();
    let improved_before = (now - Duration::days(IMPROVED_FORGET_DAYS)).to_rfc3339();
    let stale_before = (now - Duration::days(STALE_FORGET_DAYS)).to_rfc3339();
    let report = ForgetReport {
        expired: forget(
            &tx,
            user_id,
            &at,
            "expired",
            &format!("{NOT_OWNED} AND valid_to IS NOT NULL AND julianday(valid_to) <= julianday(?2)"),
            &at,
        )?,
        improved: forget(
            &tx,
            user_id,
            &at,
            "improved",
            &format!(
                "{INFERRED} AND improvement_state = 'improved'
                 AND julianday(COALESCE(last_observed_at, updated_at)) < julianday(?2)"
            ),
            &improved_before,
        )?,
        stale: forget(
            &tx,
            user_id,
            &at,
            "stale",
            &format!(
                "{INFERRED} AND {QUIET_NAMESPACES} AND recall_count < {STALE_RECALL_FLOOR}
                 AND MAX(julianday(COALESCE(last_observed_at, updated_at)), COALESCE(julianday(last_recalled_at), 0))
                     < julianday(?2)"
            ),
            &stale_before,
        )?,
    };
    tx.commit()?;
    Ok(report)
}

/// Archive the active memories of `user_id` that match `rule` (a fixed SQL
/// condition; `?2` is its time bound) under `reason`.
fn forget(
    conn: &Connection,
    user_id: &str,
    now: &str,
    reason: &str,
    rule: &str,
    bound: &str,
) -> DbResult<Vec<String>> {
    let mut select = conn.prepare(&format!(
        "SELECT id, version FROM memory_items WHERE user_id = ?1 AND status = 'active' AND {rule} ORDER BY id"
    ))?;
    let found = select
        .query_map(params![user_id, bound], |row| Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut archived = Vec::with_capacity(found.len());
    for (id, version) in found {
        if crate::memory::archive_memory_record_at(conn, &id, version, ACTOR_TYPE, Some(ACTOR_ID), reason, now)? {
            crate::consolidation::propagate_support_change_in_transaction(conn, &id, "archived", now)?;
            archived.push(id);
        }
    }
    Ok(archived)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrate::migrate;
    use crate::sqlite::{open_connection, DbOpenOptions};

    #[test]
    fn an_archive_for_a_version_the_memory_has_left_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = open_connection(&DbOpenOptions::create(dir.path().join("cas.db"))).unwrap();
        migrate(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO memory_items (id,user_id,namespace,scope,memory_type,canonical_key,normalized_label,content,status,
                source_class,created_by,content_hash,created_at,updated_at,version)
             VALUES ('mem-1','local','strategy','activity:reading','procedural','k','l','c','active','inferred','t','h','2026-01-01','2026-01-01',2)",
            [],
        )
        .unwrap();
        let archive = |version| crate::memory::archive_memory_record_at(&conn, "mem-1", version, ACTOR_TYPE, None, "stale", "2026-11-04T00:00:00Z").unwrap();
        assert!(!archive(1), "an older version than the memory's is stale");
        assert!(!archive(3), "so is a newer one");
        let (status, mutations): (String, i64) = conn
            .query_row("SELECT status, (SELECT COUNT(*) FROM memory_mutations) FROM memory_items", [], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap();
        assert_eq!((status.as_str(), mutations), ("active", 0));
        assert!(archive(2));
        assert!(!archive(3), "an archived memory is not archived twice");
    }
}
