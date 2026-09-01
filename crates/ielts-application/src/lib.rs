//! Vertical application use cases shared by the desktop adapters.
//!
//! This crate deliberately depends on the existing persistence contracts while
//! the migration is in progress. It never depends on Tauri, HTTP, Keyring, or
//! raw SQLite connections.

pub mod agent;
pub mod agent_thread;
pub mod coach;
pub mod coach_feedback;
pub mod cognitive_read;
pub mod consolidation;
pub mod context;
pub mod corpus;
pub mod dream;
pub mod error;
pub mod journal;
pub mod learning_observations;
pub mod learner;
pub mod memory;
pub mod ports;
pub mod prompt_skill;
pub mod teaching_strategy;
pub mod writing_evaluation;

pub use agent::*;
pub use agent_thread::{AgentThreadService, AgentThreadStore};
pub use coach::CoachService;
pub use coach_feedback::{CoachFeedbackService, CoachFeedbackStore};
pub use cognitive_read::{CognitiveReadService, CognitiveReadStore};
pub use consolidation::{
    ConsolidationService, ConsolidationStore, PartialConsolidation, WeeklyDreamResult,
};
pub use context::{ContextMaterializerService, ContextSnapshotStore};
pub use corpus::{CorpusExportService, CorpusExportStore};
pub use dream::{DreamService, DreamStore};
pub use error::ApplicationError;
pub use journal::{JournalService, JournalStore};
pub use learning_observations::{LearningObservationService, LearningObservationStore};
pub use learner::{
    LearnerModelAdminService, LearnerModelAdminStore, LearnerModelService, LearnerModelStore,
};
pub use memory::*;
pub use ports::*;
pub use prompt_skill::{PromptSkillService, PromptSkillStore};
pub use teaching_strategy::{TeachingStrategyService, TeachingStrategyStore};
pub use writing_evaluation::{EvaluationBackend, StartEvaluationOutcome, WritingEvaluationService};
