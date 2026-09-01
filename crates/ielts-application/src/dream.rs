//! M7-07 Daily Dream application use cases.
//!
//! Thin persistence-backed service that records dream runs and pending
//! candidates. Dreams only produce pending candidates that must still go through
//! M3 `promote_memory_candidate` before touching active memory (no bypass). The
//! service is fail-closed: a failed dream never blocks the deterministic
//! journal or the practice loop (M7-08). Capacity is bounded by M7-08
//! constants.

use ielts_domain::{
    DailyDreamQuery, DailyDreamResult, DreamProposal, DreamRun,
};

use crate::ApplicationError;

/// Persistence port for the M7 Daily Dream ledger.
pub trait DreamStore {
    /// Insert a new dream run in `queued` status.
    fn insert_dream_run(
        &self,
        query: &DailyDreamQuery,
        input_hash: Option<&str>,
    ) -> Result<DreamRun, ApplicationError>;

    /// Insert a pending dream candidate. Capacity is bounded by the caller.
    fn insert_dream_candidate(
        &self,
        run_id: &str,
        proposal: &DreamProposal,
    ) -> Result<ielts_domain::DreamCandidate, ApplicationError>;

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

    /// Load the full daily dream result (run + candidates).
    fn load_daily_dream_result(&self, run_id: &str) -> Result<Option<DailyDreamResult>, ApplicationError>;
}

pub struct DreamService<'a> {
    store: &'a dyn DreamStore,
}

impl<'a> DreamService<'a> {
    pub fn new(store: &'a dyn DreamStore) -> Self {
        Self { store }
    }

    /// M7-07: record Python-supplied proposals as pending dream candidates.
    ///
    /// The proposals come from the Python LLM pass; Rust is the authority for
    /// persistence and capacity. Capacity is bounded by
    /// `MAX_OUTPUT_CANDIDATES`; proposals beyond the limit are dropped and
    /// reported in the returned rejected count (the run still completes with
    /// the bounded set). Dreams never write active memory directly — all
    /// candidates are `pending` and must go through M3
    /// `promote_memory_candidate`.
    pub fn record_proposals(
        &self,
        run_id: &str,
        proposals: &[DreamProposal],
    ) -> Result<(Vec<ielts_domain::DreamCandidate>, usize), ApplicationError> {
        let bounded: Vec<&DreamProposal> = proposals
            .iter()
            .take(ielts_domain::MAX_OUTPUT_CANDIDATES)
            .collect();
        let rejected = proposals.len().saturating_sub(bounded.len());
        let mut candidates = Vec::with_capacity(bounded.len());
        for proposal in bounded {
            candidates.push(self.store.insert_dream_candidate(run_id, proposal)?);
        }
        Ok((candidates, rejected))
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

    /// Load the full daily dream result.
    pub fn load_result(&self, run_id: &str) -> Result<Option<DailyDreamResult>, ApplicationError> {
        self.store.load_daily_dream_result(run_id)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use ielts_domain::{
        DailyDreamQuery, DailyDreamResult, DreamCandidate, DreamCandidateDisposition, DreamProposal,
        DreamProposalKind, DreamRun, DreamRunStatus, MAX_OUTPUT_CANDIDATES,
    };

    use super::*;

    #[derive(Default)]
    struct FakeStore {
        runs: Mutex<Vec<DreamRun>>,
        candidates: Mutex<Vec<DreamCandidate>>,
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

        fn insert_dream_candidate(
            &self,
            run_id: &str,
            proposal: &DreamProposal,
        ) -> Result<DreamCandidate, ApplicationError> {
            let candidate = DreamCandidate {
                id: format!("dcand-{}", self.candidates.lock().unwrap().len()),
                run_id: run_id.into(),
                kind: proposal.kind,
                target_memory_id: proposal.target_memory_id.clone(),
                evidence_observation_ids: proposal.evidence_observation_ids.clone(),
                disposition: DreamCandidateDisposition::Pending,
                created_at: "2026-08-16T00:00:00Z".into(),
                proposal: proposal.clone(),
            };
            self.candidates.lock().unwrap().push(candidate.clone());
            Ok(candidate)
        }

        fn start_dream_run(&self, run_id: &str, _now: &str) -> Result<DreamRun, ApplicationError> {
            let mut runs = self.runs.lock().unwrap();
            let run = runs.iter_mut().find(|r| r.id == run_id).unwrap();
            run.status = DreamRunStatus::Running;
            run.attempts += 1;
            Ok(run.clone())
        }

        fn finish_dream_run(
            &self,
            run_id: &str,
            output_hash: &str,
            _now: &str,
        ) -> Result<DreamRun, ApplicationError> {
            let mut runs = self.runs.lock().unwrap();
            let run = runs.iter_mut().find(|r| r.id == run_id).unwrap();
            run.status = DreamRunStatus::Completed;
            run.output_hash = Some(output_hash.into());
            Ok(run.clone())
        }

        fn fail_dream_run(
            &self,
            run_id: &str,
            error: &serde_json::Value,
            _now: &str,
        ) -> Result<DreamRun, ApplicationError> {
            let mut runs = self.runs.lock().unwrap();
            let run = runs.iter_mut().find(|r| r.id == run_id).unwrap();
            run.status = DreamRunStatus::Failed;
            run.error = Some(error.clone());
            Ok(run.clone())
        }

        fn load_daily_dream_result(
            &self,
            run_id: &str,
        ) -> Result<Option<DailyDreamResult>, ApplicationError> {
            let runs = self.runs.lock().unwrap();
            let run = runs.iter().find(|r| r.id == run_id).cloned();
            if run.is_none() {
                return Ok(None);
            }
            let candidates = self
                .candidates
                .lock()
                .unwrap()
                .iter()
                .filter(|c| c.run_id == run_id)
                .cloned()
                .collect();
            Ok(Some(DailyDreamResult {
                run: run.unwrap(),
                candidates,
            }))
        }
    }

    fn proposal(kind: DreamProposalKind) -> DreamProposal {
        DreamProposal {
            kind,
            target_memory_id: Some("mem-1".into()),
            evidence_observation_ids: vec!["obs-1".into()],
            proposed_statement: "test".into(),
            proposal_json: serde_json::json!({"kind": kind.as_str()}),
        }
    }

    #[test]
    fn record_proposals_bounds_output_capacity() {
        let store = FakeStore::default();
        let service = DreamService::new(&store);
        // Insert more than MAX_OUTPUT_CANDIDATES proposals.
        let proposals: Vec<DreamProposal> = (0..(MAX_OUTPUT_CANDIDATES + 5))
            .map(|_| proposal(DreamProposalKind::Reinforce))
            .collect();
        let (candidates, rejected) = service.record_proposals("drmrun-0", &proposals).unwrap();
        assert_eq!(candidates.len(), MAX_OUTPUT_CANDIDATES);
        assert_eq!(rejected, 5);
    }

    #[test]
    fn run_lifecycle_transitions_queued_to_completed() {
        let store = FakeStore::default();
        let service = DreamService::new(&store);
        let run = service
            .insert_dream_run(
                &DailyDreamQuery {
                    user_id: "local".into(),
                    journal_id: "djnl-1".into(),
                },
                None,
            )
            .unwrap();
        assert_eq!(run.status, DreamRunStatus::Queued);
        let claimed = service.start_dream_run(&run.id, "now").unwrap();
        assert_eq!(claimed.status, DreamRunStatus::Running);
        let finished = service.finish_dream_run(&run.id, "hash", "now").unwrap();
        assert_eq!(finished.status, DreamRunStatus::Completed);
    }

    #[test]
    fn candidates_are_pending_not_promoted() {
        let store = FakeStore::default();
        let service = DreamService::new(&store);
        let (candidates, rejected) = service
            .record_proposals("drmrun-0", &[proposal(DreamProposalKind::Improve)])
            .unwrap();
        assert_eq!(rejected, 0);
        assert_eq!(candidates.len(), 1);
        assert_eq!(
            candidates[0].disposition,
            DreamCandidateDisposition::Pending
        );
    }

    #[test]
    fn fail_run_records_failure_without_blocking() {
        let store = FakeStore::default();
        let service = DreamService::new(&store);
        store
            .insert_dream_run(
                &DailyDreamQuery {
                    user_id: "local".into(),
                    journal_id: "djnl-1".into(),
                },
                None,
            )
            .unwrap();
        let run = service
            .fail_run("drmrun-0", &serde_json::json!({"error": "llm timeout"}), "now")
            .unwrap();
        assert_eq!(run.status, DreamRunStatus::Failed);
        assert!(run.error.is_some());
    }
}
