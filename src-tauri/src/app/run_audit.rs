//! Shared agent-run audit guard for commands that drive one cognitive run.
//!
//! A run that starts via `begin_agent_run` must ALWAYS land a terminal row
//! (completed / failed / interrupted) — the guard closes it on drop as a
//! failed run if the command forgot, so `agent_runs` never accumulates
//! zombie `running` rows.

use serde_json::Value;

use crate::app::state::AppDb;
use ielts_db::{FinishAgentRunCommand, StoredAgentRunStatus};

pub(crate) fn finish_run(
    db: &AppDb,
    run_id: &str,
    status: StoredAgentRunStatus,
    result: Option<Value>,
    error: Option<Value>,
) -> ielts_db::DbResult<()> {
    db.with_conn(|conn| {
        let (rounds, tool_call_count): (u32, u32) = conn.query_row(
            "SELECT COALESCE(MAX(round),0),COUNT(*) FROM agent_tool_calls WHERE run_id=?1",
            [run_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        ielts_db::finish_agent_run(
            conn,
            &FinishAgentRunCommand {
                id: run_id.to_owned(),
                status,
                rounds,
                tool_call_count,
                result,
                error,
            },
        )
    })
}

pub(crate) struct RunAuditGuard<'a> {
    db: &'a AppDb,
    run_id: String,
    armed: bool,
    drop_status: StoredAgentRunStatus,
    drop_error: Value,
}

impl<'a> RunAuditGuard<'a> {
    pub(crate) fn new(
        db: &'a AppDb,
        run_id: String,
        drop_status: StoredAgentRunStatus,
        drop_error: Value,
    ) -> Self {
        Self {
            db,
            run_id,
            armed: true,
            drop_status,
            drop_error,
        }
    }

    pub(crate) fn finish(
        &mut self,
        status: StoredAgentRunStatus,
        result: Option<Value>,
        error: Option<Value>,
    ) -> ielts_db::DbResult<()> {
        finish_run(self.db, &self.run_id, status, result, error)?;
        self.armed = false;
        Ok(())
    }
}

impl Drop for RunAuditGuard<'_> {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let _ = finish_run(
            self.db,
            &self.run_id,
            self.drop_status,
            None,
            Some(self.drop_error.clone()),
        );
    }
}
