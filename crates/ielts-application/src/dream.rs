//! Dream-run application use cases.
//!
//! Thin persistence-backed service over the `dream_runs` ledger, which today
//! records the weekly consolidation only (the daily journal is deterministic and
//! has no run). Fail-closed: a failed run never blocks the practice loop.

use std::collections::BTreeSet;

use ielts_domain::{DailyDreamQuery, DreamRun, MemoryMutationProposal};

use crate::ApplicationError;

/// At most this many memory mutations are considered from one weekly pass.
pub const WEEKLY_MAX_MUTATIONS: usize = 8;

/// The ids the weekly pack offered the model: the only ids a mutation may cite
/// or target. Anything else is the model inventing evidence.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WeeklyEvidence {
    pub observation_ids: BTreeSet<String>,
    pub memory_ids: BTreeSet<String>,
    /// The observations of the learner messages behind any coach signal of the
    /// pack, and those among them behind a signal that earns long-term memory
    /// (said by the learner as "remember this", or repeated in several answers on
    /// several passages). Empty when the pack carried no signal.
    pub signal_ids: BTreeSet<String>,
    pub promoted_signal_ids: BTreeSet<String>,
}

impl WeeklyEvidence {
    /// A weekly mutation is one of the lifecycle actions the weekly pass owns
    /// (new, reinforce, refine, improve, regress, contradict, supersede, archive),
    /// cites only observations of the pack, targets only memories of the pack, and
    /// rests on enough evidence: a claim made or strengthened from coach signals
    /// must cite at least one signal that earns promotion. One remark on one
    /// passage, not asked to be remembered, is not evidence for a lasting memory.
    pub fn admits(&self, proposal: &MemoryMutationProposal) -> bool {
        let action_allowed = !matches!(proposal, MemoryMutationProposal::Noop {});
        action_allowed
            && proposal.evidence_observation_ids().iter().all(|id| self.observation_ids.contains(id))
            && proposal.target_memory_id().is_none_or(|id| self.memory_ids.contains(id))
            && self.rests_on_enough_evidence(proposal)
    }

    /// Adding or strengthening a claim (`ADD`, `REINFORCE`, `REFINE`, `SUPERSEDE`)
    /// that cites coach signals needs a promoted one among them. Retiring or
    /// re-grading a memory cites practice evidence, not signals, and is not gated.
    fn rests_on_enough_evidence(&self, proposal: &MemoryMutationProposal) -> bool {
        let makes_a_claim = matches!(
            proposal,
            MemoryMutationProposal::Add { .. }
                | MemoryMutationProposal::Reinforce { .. }
                | MemoryMutationProposal::Refine { .. }
                | MemoryMutationProposal::Supersede { .. }
        );
        let cited = proposal.evidence_observation_ids();
        let on_signals = cited.iter().any(|id| self.signal_ids.contains(id));
        !makes_a_claim || !on_signals || cited.iter().any(|id| self.promoted_signal_ids.contains(id))
    }

    /// Split a model's mutations into those the pack supports and a count of
    /// those it does not. Over-long batches keep only their first
    /// `WEEKLY_MAX_MUTATIONS` entries; the excess counts as rejected.
    pub fn admitted(&self, proposals: Vec<MemoryMutationProposal>) -> (Vec<MemoryMutationProposal>, usize) {
        let total = proposals.len();
        let admitted: Vec<_> = proposals
            .into_iter()
            .filter(|proposal| self.admits(proposal))
            .take(WEEKLY_MAX_MUTATIONS)
            .collect();
        let rejected = total - admitted.len();
        (admitted, rejected)
    }
}

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

    fn evidence() -> WeeklyEvidence {
        WeeklyEvidence {
            observation_ids: ["obs-1", "obs-2"].map(String::from).into_iter().collect(),
            memory_ids: ["mem-1"].map(String::from).into_iter().collect(),
            ..WeeklyEvidence::default()
        }
    }

    fn add(ids: &[&str]) -> MemoryMutationProposal {
        serde_json::from_value(serde_json::json!({
            "action": "ADD", "namespace": "strategy", "canonicalKey": "strategy.reading.stem_first",
            "scope": {"type": "activity", "key": "reading"}, "statement": "Reads the stem first.",
            "evidenceObservationIds": ids,
        }))
        .unwrap()
    }

    fn targeted(action: &str, target: &str, ids: &[&str]) -> MemoryMutationProposal {
        serde_json::from_value(serde_json::json!({
            "action": action, "targetMemoryId": target, "evidenceObservationIds": ids,
        }))
        .unwrap()
    }

    #[test]
    fn a_mutation_must_cite_pack_observations_and_target_pack_memories() {
        let pack = evidence();
        assert!(pack.admits(&add(&["obs-1"])));
        assert!(pack.admits(&targeted("REINFORCE", "mem-1", &["obs-2"])));
        assert!(pack.admits(&targeted("ARCHIVE", "mem-1", &["obs-1", "obs-2"])));
        // An id the pack never offered is invented evidence; so is a foreign target.
        assert!(!pack.admits(&add(&["obs-1", "obs-9"])));
        assert!(!pack.admits(&targeted("REINFORCE", "mem-9", &["obs-1"])));
        assert!(!pack.admits(&MemoryMutationProposal::Noop {}));
    }

    #[test]
    fn the_weekly_pass_owns_the_whole_memory_lifecycle() {
        let pack = evidence();
        for action in ["IMPROVE", "REGRESS", "CONTRADICT"] {
            assert!(pack.admits(&targeted(action, "mem-1", &["obs-1"])), "{action}");
            assert!(!pack.admits(&targeted(action, "mem-9", &["obs-1"])), "{action}: foreign target");
            assert!(!pack.admits(&targeted(action, "mem-1", &["obs-9"])), "{action}: invented evidence");
        }
        let refine = serde_json::from_value::<MemoryMutationProposal>(serde_json::json!({
            "action": "REFINE", "targetMemoryId": "mem-1", "proposedStatement": "Reads the stem and options first.",
            "evidenceObservationIds": ["obs-1"],
        }))
        .unwrap();
        assert!(pack.admits(&refine));
    }

    fn with_signals() -> WeeklyEvidence {
        WeeklyEvidence {
            observation_ids: ["obs-1", "obs-2", "obs-3", "obs-4"].map(String::from).into_iter().collect(),
            memory_ids: ["mem-1"].map(String::from).into_iter().collect(),
            // obs-2 stands behind a one-off remark, obs-3 behind a repeated signal.
            signal_ids: ["obs-2", "obs-3"].map(String::from).into_iter().collect(),
            promoted_signal_ids: ["obs-3"].map(String::from).into_iter().collect(),
        }
    }

    #[test]
    fn a_claim_resting_only_on_a_one_off_signal_is_not_admitted() {
        let pack = with_signals();
        // Practice evidence alone is not a signal claim.
        assert!(pack.admits(&add(&["obs-1"])));
        // A one-off remark alone is not enough, for any claim-making action...
        assert!(!pack.admits(&add(&["obs-2"])));
        assert!(!pack.admits(&targeted("REINFORCE", "mem-1", &["obs-2"])));
        assert!(!pack.admits(&add(&["obs-1", "obs-2"])), "practice lines do not launder a weak signal");
        // ...a promoted signal is, alone or beside a weak one...
        assert!(pack.admits(&add(&["obs-3"])));
        assert!(pack.admits(&add(&["obs-2", "obs-3"])));
        assert!(pack.admits(&targeted("REINFORCE", "mem-1", &["obs-3"])));
        // ...and retiring or re-grading a memory is not a claim from a signal.
        assert!(pack.admits(&targeted("ARCHIVE", "mem-1", &["obs-2"])));
        assert!(pack.admits(&targeted("IMPROVE", "mem-1", &["obs-2"])));
    }

    #[test]
    fn admitted_counts_what_it_refuses_and_caps_the_batch() {
        let pack = evidence();
        let mut batch = vec![add(&["obs-9"]), add(&["obs-1"])];
        batch.extend((0..WEEKLY_MAX_MUTATIONS + 2).map(|_| targeted("REINFORCE", "mem-1", &["obs-2"])));
        let total = batch.len();
        let (kept, rejected) = pack.admitted(batch);
        assert_eq!(kept.len(), WEEKLY_MAX_MUTATIONS);
        assert_eq!(kept.len() + rejected, total);
    }

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
