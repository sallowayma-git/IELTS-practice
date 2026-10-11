//! The raw-data delete gate (migration 0030).
//!
//! `delete_gate` is a one-row switch read by a `BEFORE DELETE` trigger on every
//! table in [`RAW_TRUTH_TABLES`]. It is closed unless [`with_delete_gate`] is
//! running, and `with_delete_gate` restores it on every exit.
//!
//! The switch is flipped inside a SAVEPOINT. That is what makes "always closed
//! again" a property of the database rather than of the caller's discipline:
//!
//! * success: the previous value is written back, then the savepoint is
//!   released, so the open state never reaches a commit;
//! * error or panic: the savepoint is rolled back, which undoes both the flip
//!   and whatever the gated work had already done, then released;
//! * crash: nothing was committed open.
//!
//! The previous value (not a hard-coded 0) is restored so gated calls nest.

use rusqlite::{Connection, OptionalExtension};

use crate::sqlite::{DbError, DbResult};

/// Tables whose rows are raw truth. Pinned to the triggers in 0030 by a test.
pub const RAW_TRUTH_TABLES: &[&str] = &[
    "attempts",
    "attempt_answers",
    "attempt_annotations",
    "writing_evaluations",
    "writing_drafts",
    "coach_threads",
    "coach_messages",
    "explicit_user_preferences",
    "vocabulary_items",
    "vocabulary_review_state",
];

const SAVEPOINT: &str = "delete_gate";

/// An open delete gate. Dropping it without [`DeleteGate::finish`] rolls back
/// everything done since it was opened.
#[must_use = "dropping an open gate rolls its work back; call finish()"]
pub struct DeleteGate<'a> {
    conn: &'a Connection,
    previous: i64,
    released: bool,
}

impl<'a> DeleteGate<'a> {
    pub fn open(conn: &'a Connection) -> DbResult<Self> {
        conn.execute_batch(&format!("SAVEPOINT {SAVEPOINT}"))?;
        // From here on `Drop` owns the savepoint, including on the error paths
        // below.
        let mut gate = Self {
            conn,
            previous: 0,
            released: false,
        };
        gate.previous = conn
            .query_row(
                "SELECT open FROM delete_gate WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| DbError::Message("delete gate row is missing".into()))?;
        conn.execute("UPDATE delete_gate SET open = 1 WHERE singleton = 1", [])?;
        Ok(gate)
    }

    /// Restore the gate to the state it had when opened and keep the work.
    pub fn finish(mut self) -> DbResult<()> {
        self.conn.execute(
            "UPDATE delete_gate SET open = ?1 WHERE singleton = 1",
            [self.previous],
        )?;
        self.conn.execute_batch(&format!("RELEASE {SAVEPOINT}"))?;
        self.released = true;
        Ok(())
    }
}

impl Drop for DeleteGate<'_> {
    fn drop(&mut self) {
        if !self.released {
            // Best effort: if the surrounding transaction is already gone (an
            // automatic rollback), there is no savepoint left to undo.
            let _ = self
                .conn
                .execute_batch(&format!("ROLLBACK TO {SAVEPOINT}; RELEASE {SAVEPOINT}"));
        }
    }
}

/// Run `work` with the raw-data delete gate open.
///
/// If `work` fails, everything it did under the gate is rolled back and the
/// error is returned: gated work is all-or-nothing. Use only on an explicit user
/// path; every call site is a statement that this deletion was asked for.
pub fn with_delete_gate<T>(conn: &Connection, work: impl FnOnce() -> DbResult<T>) -> DbResult<T> {
    let gate = DeleteGate::open(conn)?;
    let value = work()?;
    gate.finish()?;
    Ok(value)
}

/// Force the gate closed. The gate is never persisted open; this is the
/// startup belt-and-braces and the first thing a test of "closed after an
/// error" would otherwise have to assume.
pub fn close_delete_gate(conn: &Connection) -> DbResult<()> {
    conn.execute("UPDATE delete_gate SET open = 0 WHERE open != 0", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_truth_list_matches_the_installed_triggers() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::migrate::migrate(&mut conn).unwrap();
        let mut stmt = conn
            .prepare("SELECT tbl_name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_delete_gate_%' ORDER BY tbl_name")
            .unwrap();
        let installed: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        let mut declared: Vec<&str> = RAW_TRUTH_TABLES.to_vec();
        declared.sort_unstable();
        assert_eq!(installed, declared);
    }
}
