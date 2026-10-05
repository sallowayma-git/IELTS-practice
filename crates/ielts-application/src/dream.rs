//! Dream-run application use cases.
//!
//! Thin persistence-backed service over the `dream_runs` ledger, which today
//! records the weekly consolidation only (the daily journal is deterministic and
//! has no run). Fail-closed: a failed run never blocks the practice loop.

use ielts_domain::{DailyDreamQuery, DreamRun};

use crate::ApplicationError;

/// Persistence port for the dream-run ledger.
pub trait DreamStore {
    /// Insert a new dream run in `queued` status.
    fn insert_dream_run(
        &self,
        query: &DailyDreamQuery,
        input_hash: Option<&str>,
    ) -> Result<DreamRun, ApplicationError>;

    /// Claim a `queued` dream run (status → running, attempts + 1).
    fn start_dream_run(&self, run_id: &str, now: &str) -> Result<DreamRun, ApplicationError>;

    /// Mark a dream run completed.
    fn finish_dream_run(
        &self,
        run_id: &str,
        output_hash: &str,
        now: &str,
    ) -> Result<DreamRun, ApplicationError>;

    /// Mark a dream run failed (fail-closed).
    fn fail_dream_run(
        &self,
        run_id: &str,
        error: &serde_json::Value,
        now: &str,
    ) -> Result<DreamRun, ApplicationError>;
}

pub struct DreamService<'a> {
    store: &'a dyn DreamStore,
}

impl<'a> DreamService<'a> {
    pub fn new(store: &'a dyn DreamStore) -> Self {
        Self { store }
    }

    /// M7-07: claim a `queued` dream run (status → running).
    pub fn start_dream_run(&self, run_id: &str, now: &str) -> Result<DreamRun, ApplicationError> {
        self.store.start_dream_run(run_id, now)
    }

    /// M7-07: insert a new dream run in `queued` status.
    pub fn insert_dream_run(
        &self,
        query: &DailyDreamQuery,
        input_hash: Option<&str>,
    ) -> Result<DreamRun, ApplicationError> {
        self.store.insert_dream_run(query, input_hash)
    }

    /// M7-07: mark a dream run completed.
    pub fn finish_dream_run(
        &self,
        run_id: &str,
        output_hash: &str,
        now: &str,
    ) -> Result<DreamRun, ApplicationError> {
        self.store.finish_dream_run(run_id, output_hash, now)
    }

    /// M7-08: fail-closed dream run. The deterministic journal is already
    /// complete; this records the dream failure so the practice loop is never
    /// blocked.
    pub fn fail_run(
        &self,
        run_id: &str,
        error: &serde_json::Value,
        now: &str,
    ) -> Result<DreamRun, ApplicationError> {
        self.store.fail_dream_run(run_id, error, now)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use ielts_domain::{DailyDreamQuery, DreamRun, DreamRunStatus};

    use super::*;

    #[derive(Default)]
    struct FakeStore {
        runs: Mutex<Vec<DreamRun>>,
    }

    impl FakeStore {
        fn update(&self, run_id: &str, change: impl FnOnce(&mut DreamRun)) -> DreamRun {
            let mut runs = self.runs.lock().unwrap();
            let run = runs.iter_mut().find(|r| r.id == run_id).unwrap();
            change(run);
            run.clone()
        }
    }

    impl DreamStore for FakeStore {
        fn insert_dream_run(
            &self,
            query: &DailyDreamQuery,
            input_hash: Option<&str>,
        ) -> Result<DreamRun, ApplicationError> {
            let run = DreamRun {
                id: format!("drmrun-{}", self.runs.lock().unwrap().len()),
                user_id: query.user_id.clone(),
                journal_id: query.journal_id.clone(),
                status: DreamRunStatus::Queued,
                input_hash: input_hash.map(str::to_owned),
                output_hash: None,
                started_at: None,
                finished_at: None,
                error: None,
                attempts: 0,
                created_at: "2026-08-16T00:00:00Z".into(),
                updated_at: "2026-08-16T00:00:00Z".into(),
            };
            self.runs.lock().unwrap().push(run.clone());
            Ok(run)
        }

        fn start_dream_run(&self, run_id: &str, _now: &str) -> Result<DreamRun, ApplicationError> {
            Ok(self.update(run_id, |run| {
                run.status = DreamRunStatus::Running;
                run.attempts += 1;
            }))
        }

        fn finish_dream_run(
            &self,
            run_id: &str,
            output_hash: &str,
            _now: &str,
        ) -> Result<DreamRun, ApplicationError> {
            Ok(self.update(run_id, |run| {
                run.status = DreamRunStatus::Completed;
                run.output_hash = Some(output_hash.into());
            }))
        }

        fn fail_dream_run(
            &self,
            run_id: &str,
            error: &serde_json::Value,
            _now: &str,
        ) -> Result<DreamRun, ApplicationError> {
            Ok(self.update(run_id, |run| {
                run.status = DreamRunStatus::Failed;
                run.error = Some(error.clone());
            }))
        }
    }

    fn query() -> DailyDreamQuery {
        DailyDreamQuery { user_id: "local".into(), journal_id: "djnl-1".into() }
    }

    #[test]
    fn run_lifecycle_transitions_queued_to_completed() {
        let store = FakeStore::default();
        let service = DreamService::new(&store);
        let run = service.insert_dream_run(&query(), None).unwrap();
        assert_eq!(run.status, DreamRunStatus::Queued);
        let claimed = service.start_dream_run(&run.id, "now").unwrap();
        assert_eq!(claimed.status, DreamRunStatus::Running);
        let finished = service.finish_dream_run(&run.id, "hash", "now").unwrap();
        assert_eq!(finished.status, DreamRunStatus::Completed);
    }

    #[test]
    fn fail_run_records_failure_without_blocking() {
        let store = FakeStore::default();
        let service = DreamService::new(&store);
        let run = service.insert_dream_run(&query(), None).unwrap();
        let run = service
            .fail_run(&run.id, &serde_json::json!({"error": "llm timeout"}), "now")
            .unwrap();
        assert_eq!(run.status, DreamRunStatus::Failed);
        assert!(run.error.is_some());
    }
}
