//! Recent signals: what the learner told the coach lately, sliced from the
//! coach's own teaching notes at the moment a profile is built.
//!
//! Long-term memory is written by the weekly consolidation only, so what the
//! learner says today would otherwise reach no other thread for days. This is
//! the working layer in front of that. It is the top of
//! [`crate::coach_signal_digest`] (which owns what a note is, which notes count,
//! how they are merged and ranked) cut to [`RECENT_SIGNAL_MAX`] statements. It
//! writes nothing, calls no model, and its output is frozen on the new thread
//! with the rest of the profile, so a thread's prompt prefix stays byte-stable.
//!
//! A note stays a signal for `RECENT_SIGNAL_RECENT_DAYS` days, or for
//! `RECENT_SIGNAL_DURABLE_DAYS` when it declared `horizon = durable`
//! (see [`crate::coach_signal_digest`]).

use chrono::{DateTime, Utc};

use crate::coach::ProfileStatement;
use crate::coach_signal_digest::{coach_signal_digest, COACH_SIGNAL_WINDOWS};
use crate::sqlite::DbResult;

/// Most signals one profile carries.
pub const RECENT_SIGNAL_MAX: usize = 4;

/// The strongest signals of the windows ending at `now`, at most
/// [`RECENT_SIGNAL_MAX`]. Ids are `signal:<messageId>:<noteIndex>` of the signal's
/// newest note, which never starts with `mem-`, so a signal is not a recalled
/// memory; the statement is that note's text.
pub fn recent_signals(conn: &rusqlite::Connection, now: DateTime<Utc>) -> DbResult<Vec<ProfileStatement>> {
    let digest = coach_signal_digest(conn, now, COACH_SIGNAL_WINDOWS)?;
    Ok(digest
        .into_iter()
        .take(RECENT_SIGNAL_MAX)
        .map(|signal| ProfileStatement {
            id: format!("signal:{}:{}", signal.best_message_id, signal.best_note_index),
            statement: signal.text,
        })
        .collect())
}
