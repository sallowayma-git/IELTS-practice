use ielts_db::{LearningObservationsRebuildReport, LearningObservationsVerifyReport};

use crate::ApplicationError;

/// Persistence port for the developer-only M2 projection controls.
///
/// The application layer owns the use-case boundary; the Tauri adapter only
/// supplies this port and maps the result to an IPC envelope.
pub trait LearningObservationStore {
    fn rebuild_learning_observations(
        &self,
    ) -> Result<LearningObservationsRebuildReport, ApplicationError>;

    fn verify_learning_observations(
        &self,
    ) -> Result<LearningObservationsVerifyReport, ApplicationError>;
}

pub struct LearningObservationService<'a> {
    store: &'a dyn LearningObservationStore,
}

impl<'a> LearningObservationService<'a> {
    pub fn new(store: &'a dyn LearningObservationStore) -> Self {
        Self { store }
    }

    pub fn rebuild(&self) -> Result<LearningObservationsRebuildReport, ApplicationError> {
        self.store.rebuild_learning_observations()
    }

    pub fn verify(&self) -> Result<LearningObservationsVerifyReport, ApplicationError> {
        self.store.verify_learning_observations()
    }
}
