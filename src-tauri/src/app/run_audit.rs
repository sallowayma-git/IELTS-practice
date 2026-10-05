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
            "SELECT COALESCE(MAX(round_index),0),COUNT(*) FROM agent_tool_calls WHERE run_id=?1",
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_db() -> (tempfile::TempDir, AppDb) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("run-audit.db");
        let mut conn = ielts_db::open_connection(&ielts_db::DbOpenOptions::create(&path)).unwrap();
        ielts_db::migrate(&mut conn).unwrap();
        let db = AppDb::from_test_connection(conn, path);
        (dir, db)
    }

    fn begin_run(db: &AppDb, run_id: &str) {
        db.with_conn(|conn| {
            ielts_db::begin_agent_run(
                conn,
                &ielts_db::BeginAgentRunCommand {
                    id: run_id.into(),
                    provider_id: "test-provider".into(),
                    model: "test-model".into(),
                    run_kind: Default::default(),
                },
            )
        })
        .unwrap();
    }

    fn load_run(db: &AppDb, run_id: &str) -> ielts_db::AgentRunRecord {
        db.with_conn(|conn| ielts_db::load_agent_run(conn, run_id))
            .unwrap()
            .unwrap()
    }

    #[test]
    fn finish_completes_run_with_tool_call_and_disarms_drop() {
        let (_dir, db) = test_db();
        let run_id = "completed-run";
        begin_run(&db, run_id);
        db.with_conn(|conn| {
            ielts_db::begin_agent_tool_call(
                conn,
                &ielts_db::BeginAgentToolCallCommand {
                    run_id: run_id.into(),
                    call_id: "call-1".into(),
                    sequence: 1,
                    round: 3,
                    tool_name: "test-tool".into(),
                    arguments: json!({}),
                },
            )?;
            ielts_db::finish_agent_tool_call(
                conn,
                &ielts_db::FinishAgentToolCallCommand {
                    run_id: run_id.into(),
                    call_id: "call-1".into(),
                    sequence: 1,
                    status: ielts_db::StoredAgentToolStatus::Succeeded,
                    result: json!({"ok": true}),
                    error: None,
                },
            )
        })
        .unwrap();
        let result = json!({"answer": "done"});
        let mut guard = RunAuditGuard::new(
            &db,
            run_id.into(),
            StoredAgentRunStatus::Failed,
            json!({"code": "unexpected-drop"}),
        );
        guard
            .finish(StoredAgentRunStatus::Completed, Some(result.clone()), None)
            .unwrap();
        assert!(!guard.armed);
        let completed = load_run(&db, run_id);
        assert_eq!(completed.status, StoredAgentRunStatus::Completed);
        assert_eq!(completed.rounds, 3);
        assert_eq!(completed.tool_call_count, 1);
        assert_eq!(
            completed.result,
            Some(json!({"answer": "done", "runKind": "workspace"}))
        );
        assert_eq!(completed.error, None);
        assert!(completed.completed_at.is_some());
        assert_eq!(completed.tool_calls.len(), 1);
        assert_eq!(completed.tool_calls[0].round, 3);
        drop(guard);
        assert_eq!(load_run(&db, run_id), completed);
    }

    #[test]
    fn drop_terminates_unfinished_run_as_failed() {
        let (_dir, db) = test_db();
        let run_id = "dropped-run";
        begin_run(&db, run_id);
        let error = json!({"code": "command-aborted"});
        {
            let _guard = RunAuditGuard::new(
                &db,
                run_id.into(),
                StoredAgentRunStatus::Failed,
                error.clone(),
            );
            let running = load_run(&db, run_id);
            assert_eq!(running.status, StoredAgentRunStatus::Running);
            assert!(running.completed_at.is_none());
        }
        let failed = load_run(&db, run_id);
        assert_eq!(failed.status, StoredAgentRunStatus::Failed);
        assert_eq!(failed.rounds, 0);
        assert_eq!(failed.tool_call_count, 0);
        assert_eq!(failed.result, Some(json!({"runKind": "workspace"})));
        assert_eq!(failed.error, Some(error));
        assert!(failed.completed_at.is_some());
        assert!(failed.tool_calls.is_empty());
    }
}
