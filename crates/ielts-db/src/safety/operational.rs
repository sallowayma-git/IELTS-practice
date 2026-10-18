//! Age-based retention for class D (operational) records.
//!
//! Run traces, context snapshots (which hold rendered prompts, answers
//! included), LLM invocation logs and finished jobs grow on
//! every model call and are never read again once the run is over. They are
//! pruned by age. Nothing else is: no raw truth, no ledger, no memory, no
//! journal, no digest. The raw tables are additionally protected by the delete
//! gate, which this module never opens, so a mistake in the statements below
//! fails with an error instead of deleting a learner's data.
//!
//! Provenance is not operational: an agent run that created a memory, a memory
//! candidate batch or a memory mutation is the audit trail of that memory and is
//! kept. Only the run rows nothing durable points at are removed.

use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection};

use crate::sqlite::DbResult;

/// Operational records older than this are pruned.
pub const OPERATIONAL_RETENTION_DAYS: i64 = 90;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OperationalPruneReport {
    pub agent_runs: usize,
    pub context_snapshots: usize,
    pub llm_invocations: usize,
    pub finished_jobs: usize,
}

impl OperationalPruneReport {
    pub fn total(&self) -> usize {
        self.agent_runs
            + self.context_snapshots
            + self.llm_invocations
            + self.finished_jobs
    }
}

/// Delete operational records older than `keep_days` before `now`, in one
/// transaction. `julianday()` compares instants, so the mixed `Z` / `+00:00`
/// timestamp spellings in these tables order correctly; an unparsable stamp
/// yields NULL and is kept.
pub fn prune_operational_records(
    conn: &Connection,
    now: DateTime<Utc>,
    keep_days: i64,
) -> DbResult<OperationalPruneReport> {
    let cutoff = (now - Duration::days(keep_days)).to_rfc3339();
    let tx = conn.unchecked_transaction()?;
    let mut report = OperationalPruneReport::default();
    // Finished runs that no memory, candidate batch or mutation cites. Their
    // tool calls go with them (cascade); the traces that point at a run are
    // detached (SET NULL) and pruned by their own age below.
    report.agent_runs = tx.execute(
        "DELETE FROM agent_runs
         WHERE status != 'running'
           AND julianday(COALESCE(completed_at, updated_at)) < julianday(?1)
           AND NOT EXISTS (SELECT 1 FROM memory_items WHERE created_run_id = agent_runs.id)
           AND NOT EXISTS (SELECT 1 FROM memory_candidate_batches WHERE run_id = agent_runs.id)
           AND NOT EXISTS (SELECT 1 FROM memory_mutations WHERE run_id = agent_runs.id)",
        params![cutoff],
    )?;
    report.context_snapshots = tx.execute(
        "DELETE FROM agent_context_snapshots WHERE julianday(created_at) < julianday(?1)",
        params![cutoff],
    )?;
    report.llm_invocations = tx.execute(
        "DELETE FROM llm_invocations WHERE julianday(created_at) < julianday(?1)",
        params![cutoff],
    )?;
    // Only completed jobs: a failed daily job is the receipt that stops startup
    // catch-up from re-enqueuing that day on every launch.
    report.finished_jobs = tx.execute(
        "DELETE FROM background_jobs
         WHERE status = 'completed' AND julianday(updated_at) < julianday(?1)",
        params![cutoff],
    )?;
    tx.commit()?;
    Ok(report)
}
