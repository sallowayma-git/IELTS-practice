//! M4 learner-model application contracts.
//!
//! Production callers only receive bounded, read-only snapshots. Rebuild and
//! verification are kept on a separate admin port so a UI command cannot
//! accidentally mutate the learner model.

use ielts_domain::{
    LearnerRebuildReport, LearnerStateQuery, LearnerStateSnapshot, LearnerVerifyReport,
    SkillReviewNeedsQuery, SkillReviewNeedsSnapshot,
};

use crate::ApplicationError;

pub trait LearnerModelStore {
    fn learner_state_snapshot(
        &self,
        query: &LearnerStateQuery,
    ) -> Result<LearnerStateSnapshot, ApplicationError>;

    fn skill_review_needs_snapshot(
        &self,
        query: &SkillReviewNeedsQuery,
    ) -> Result<SkillReviewNeedsSnapshot, ApplicationError>;
}

pub trait LearnerModelAdminStore {
    fn learner_model_rebuild(&self) -> Result<LearnerRebuildReport, ApplicationError>;

    fn learner_model_verify(&self) -> Result<LearnerVerifyReport, ApplicationError>;
}

pub struct LearnerModelService<'a, S> {
    store: &'a S,
}

impl<'a, S> LearnerModelService<'a, S>
where
    S: LearnerModelStore,
{
    pub fn new(store: &'a S) -> Self {
        Self { store }
    }

    pub fn state_snapshot(
        &self,
        query: &LearnerStateQuery,
    ) -> Result<LearnerStateSnapshot, ApplicationError> {
        self.store.learner_state_snapshot(query)
    }

    pub fn review_needs(
        &self,
        query: &SkillReviewNeedsQuery,
    ) -> Result<SkillReviewNeedsSnapshot, ApplicationError> {
        self.store.skill_review_needs_snapshot(query)
    }
}

pub struct LearnerModelAdminService<'a, S> {
    store: &'a S,
}

impl<'a, S> LearnerModelAdminService<'a, S>
where
    S: LearnerModelAdminStore,
{
    pub fn new(store: &'a S) -> Self {
        Self { store }
    }

    pub fn rebuild(&self) -> Result<LearnerRebuildReport, ApplicationError> {
        self.store.learner_model_rebuild()
    }

    pub fn verify(&self) -> Result<LearnerVerifyReport, ApplicationError> {
        self.store.learner_model_verify()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeStore;

    impl LearnerModelStore for FakeStore {
        fn learner_state_snapshot(
            &self,
            _query: &LearnerStateQuery,
        ) -> Result<LearnerStateSnapshot, ApplicationError> {
            Ok(LearnerStateSnapshot {
                schema_version: 1,
                taxonomy_version: 1,
                model_version: "weighted_beta_v1".into(),
                generated_at: "1970-01-01T00:00:00Z".into(),
                state_hash: "empty".into(),
                states: Vec::new(),
                truncated: false,
                continuation: None,
            })
        }

        fn skill_review_needs_snapshot(
            &self,
            _query: &SkillReviewNeedsQuery,
        ) -> Result<SkillReviewNeedsSnapshot, ApplicationError> {
            Ok(SkillReviewNeedsSnapshot {
                schema_version: 1,
                scheduler_version: "skill_review_v1".into(),
                generated_at: "1970-01-01T00:00:00Z".into(),
                needs: Vec::new(),
                truncated: false,
                continuation: None,
            })
        }
    }

    #[test]
    fn read_service_delegates_to_bounded_store() {
        let service = LearnerModelService::new(&FakeStore);
        let snapshot = service
            .state_snapshot(&LearnerStateQuery::default())
            .expect("fake store should answer");
        assert_eq!(snapshot.schema_version, 1);
        assert!(snapshot.states.is_empty());
    }
}
