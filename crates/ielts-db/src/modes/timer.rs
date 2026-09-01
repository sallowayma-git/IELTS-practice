//! Pure timer state machine (Phase 7).
//! Display values are computed on the frontend; Rust stores anchors and policy only.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::sqlite::{DbError, DbResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimerMode {
    Elapsed,
    Countdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimerOwnerScope {
    Attempt,
    Endless,
}

impl TimerOwnerScope {
    fn as_str(self) -> &'static str {
        match self {
            Self::Attempt => "attempt",
            Self::Endless => "endless",
        }
    }

    fn source(self) -> &'static str {
        match self {
            Self::Attempt => "single",
            Self::Endless => "endless",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimerState {
    pub source: String,
    pub anchor_ms: i64,
    pub effective_start_time_ms: i64,
    pub mode: TimerMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit_seconds: Option<u64>,
    pub paused_offset_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paused_at_ms: Option<i64>,
    pub running: bool,
}

impl TimerState {
    pub fn new_suite(now_ms: i64) -> Self {
        Self {
            source: "suite".into(),
            anchor_ms: now_ms.max(1),
            effective_start_time_ms: now_ms.max(1),
            mode: TimerMode::Elapsed,
            limit_seconds: None,
            paused_offset_ms: 0,
            paused_at_ms: None,
            running: true,
        }
    }

    pub fn normalize(mut self, fallback_anchor_ms: i64) -> Self {
        if self.anchor_ms <= 0 {
            self.anchor_ms = fallback_anchor_ms.max(1);
        }
        self.effective_start_time_ms = self.anchor_ms;
        if self.source.trim().is_empty() {
            self.source = "suite".into();
        }
        self
    }

    /// Elapsed wall time accounting for pause offset / current pause.
    pub fn elapsed_ms(&self, now_ms: i64) -> u64 {
        let mut elapsed = (now_ms - self.anchor_ms).max(0) as u64;
        elapsed = elapsed.saturating_sub(self.paused_offset_ms);
        if !self.running {
            if let Some(paused_at) = self.paused_at_ms {
                if now_ms > paused_at {
                    elapsed = elapsed.saturating_sub((now_ms - paused_at) as u64);
                }
            }
        }
        elapsed
    }

    pub fn elapsed_seconds(&self, now_ms: i64) -> u64 {
        self.elapsed_ms(now_ms) / 1000
    }

    pub fn display_seconds(&self, now_ms: i64) -> u64 {
        let elapsed = self.elapsed_seconds(now_ms);
        match (self.mode, self.limit_seconds) {
            (TimerMode::Countdown, Some(limit)) => limit.saturating_sub(elapsed),
            _ => elapsed,
        }
    }

    pub fn pause(&mut self, now_ms: i64) {
        if !self.running {
            return;
        }
        self.running = false;
        self.paused_at_ms = Some(now_ms);
    }

    pub fn resume(&mut self, now_ms: i64) {
        if self.running {
            return;
        }
        if let Some(paused_at) = self.paused_at_ms {
            if now_ms > paused_at {
                self.paused_offset_ms = self
                    .paused_offset_ms
                    .saturating_add((now_ms - paused_at) as u64);
            }
        }
        self.paused_at_ms = None;
        self.running = true;
    }

    pub fn merge_snapshot(&self, snapshot: Option<&TimerState>) -> Self {
        let Some(input) = snapshot else {
            return self.clone().normalize(self.anchor_ms);
        };
        let anchor = if self.anchor_ms > 0 {
            self.anchor_ms
        } else if input.anchor_ms > 0 {
            input.anchor_ms
        } else {
            input.effective_start_time_ms
        };
        Self {
            source: "suite".into(),
            anchor_ms: anchor.max(1),
            effective_start_time_ms: anchor.max(1),
            mode: input.mode,
            limit_seconds: input.limit_seconds.or(self.limit_seconds),
            paused_offset_ms: input.paused_offset_ms,
            paused_at_ms: input.paused_at_ms,
            running: input.running,
        }
    }

    /// True when countdown limit has been reached (auto-submit trigger).
    pub fn should_auto_submit(&self, now_ms: i64) -> bool {
        matches!(self.mode, TimerMode::Countdown)
            && self
                .limit_seconds
                .map(|limit| self.elapsed_seconds(now_ms) >= limit)
                .unwrap_or(false)
    }
}

pub fn save_reading_timer_state(
    conn: &Connection,
    scope: TimerOwnerScope,
    owner_id: &str,
    snapshot: &TimerState,
) -> DbResult<TimerState> {
    let owner_id = owner_id.trim();
    if owner_id.is_empty() || owner_id.len() > 200 {
        return Err(DbError::Validation("invalid reading timer owner".into()));
    }
    ensure_timer_owner(conn, scope, owner_id)?;
    let fallback = chrono::Utc::now().timestamp_millis();
    let mut state = snapshot.clone().normalize(fallback);
    state.source = scope.source().into();
    let json =
        serde_json::to_string(&state).map_err(|error| DbError::Message(error.to_string()))?;
    conn.execute(
        "INSERT INTO reading_timer_states(scope, owner_id, state_json, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(scope, owner_id) DO UPDATE SET
           state_json = excluded.state_json,
           updated_at = excluded.updated_at",
        params![
            scope.as_str(),
            owner_id,
            json,
            chrono::Utc::now().to_rfc3339()
        ],
    )?;
    Ok(state)
}

pub fn load_reading_timer_state(
    conn: &Connection,
    scope: TimerOwnerScope,
    owner_id: &str,
) -> DbResult<Option<TimerState>> {
    let json: Option<String> = conn
        .query_row(
            "SELECT state_json FROM reading_timer_states WHERE scope = ?1 AND owner_id = ?2",
            params![scope.as_str(), owner_id],
            |row| row.get(0),
        )
        .optional()?;
    json.map(|raw| {
        serde_json::from_str::<TimerState>(&raw).map_err(|error| {
            DbError::Message(format!(
                "reading timer state is invalid for {}:{owner_id}: {error}",
                scope.as_str()
            ))
        })
    })
    .transpose()
}

pub fn delete_reading_timer_state(
    conn: &Connection,
    scope: TimerOwnerScope,
    owner_id: &str,
) -> DbResult<()> {
    conn.execute(
        "DELETE FROM reading_timer_states WHERE scope = ?1 AND owner_id = ?2",
        params![scope.as_str(), owner_id],
    )?;
    Ok(())
}

fn ensure_timer_owner(conn: &Connection, scope: TimerOwnerScope, owner_id: &str) -> DbResult<()> {
    let valid = match scope {
        TimerOwnerScope::Attempt => conn
            .query_row(
                "SELECT 1 FROM attempts
                 WHERE id = ?1 AND activity = 'reading'
                   AND lower(status) IN ('draft', 'active')",
                params![owner_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some(),
        TimerOwnerScope::Endless => conn
            .query_row(
                "SELECT 1 FROM endless_sessions WHERE id = ?1 AND status = 'active'",
                params![owner_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some(),
    };
    if !valid {
        return Err(DbError::Validation(format!(
            "reading timer owner is not active: {}:{owner_id}",
            scope.as_str()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pause_resume_preserves_elapsed() {
        let mut t = TimerState::new_suite(1_000);
        assert_eq!(t.elapsed_seconds(6_000), 5);
        t.pause(6_000);
        assert_eq!(t.elapsed_seconds(10_000), 5);
        t.resume(10_000);
        assert_eq!(t.elapsed_seconds(12_000), 7);
    }

    #[test]
    fn countdown_auto_submit() {
        let mut t = TimerState::new_suite(0);
        // new_suite max(1) so anchor is 1
        t.mode = TimerMode::Countdown;
        t.limit_seconds = Some(60);
        assert!(!t.should_auto_submit(30_000));
        assert!(t.should_auto_submit(61_001));
        // elapsed from anchor 1 to 45001 => 45s, display 15
        assert_eq!(t.display_seconds(45_001), 15);
    }
}
