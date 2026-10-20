//! SQLite v2 persistence for the IELTS Practice rewrite.
//!
//! Product hot path: history, settings, writing, reading, modes, enrichment, attempts.

pub mod agent;
pub mod agent_thread;
pub mod annotations;
pub mod attempts;
pub mod background_jobs;
pub mod backup;
pub mod coach;
pub mod coach_feedback;
pub mod cognitive_read;
pub mod consolidation;
pub mod context;
pub mod dictionary;
pub mod dream;
pub mod history;
pub mod journal;
pub mod learning_events;
pub mod learning_observations;
pub mod learning_tools;
pub mod local_day;
pub mod memory;
pub mod learner;
pub mod migrate;
pub mod modes;
pub mod perf;
pub mod reading;
pub mod safety;
pub mod secrets;
pub mod settings;
pub mod soul;
pub mod sqlite;
pub mod vocab;
pub mod weekly_pack;
pub mod weekly_report;
pub mod writing;

pub use agent::*;
pub use agent_thread::*;
pub use annotations::*;
pub use attempts::{count_attempts, ensure_asset_stub, upsert_attempt};
pub use background_jobs::*;
pub use backup::*;
pub use coach::*;
pub use coach_feedback::*;
pub use cognitive_read::*;
pub use consolidation::*;
pub use context::*;
pub use dictionary::*;
pub use dream::*;
pub use history::*;
pub use journal::*;
pub use learning_events::*;
pub use learning_observations::*;
pub use learning_tools::*;
pub use memory::*;
pub use learner::*;
pub use migrate::*;
pub use modes::*;
pub use perf::*;
pub use reading::*;
pub use safety::*;
pub use secrets::*;
pub use settings::*;
pub use sqlite::*;
pub use vocab::*;
pub use weekly_pack::*;
pub use weekly_report::{
    build_blocks, build_weekly_report, has_usable_body, list_legacy_weekly_digests, list_weekly_reports,
    previous_weekly_digest, project_weekly_facts, put_weekly_report, validate_narrative, LegacyWeeklyDigest,
    NarrativeOutcome, SkillContext, WeekFacts, week_facts, weekly_memory_changes, weekly_mutation_request_id,
};
pub use writing::*;
