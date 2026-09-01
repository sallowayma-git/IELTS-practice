//! SQLite v2 persistence for the IELTS Practice rewrite.
//!
//! Product hot path: history, settings, writing, reading, modes, enrichment, attempts.
//! Cold path only: `import` (optional legacy one-shot migration).

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
pub mod corpus;
pub mod dictionary;
pub mod dream;
pub mod history;
pub mod import;
pub mod journal;
pub mod learning_events;
pub mod learning_observations;
pub mod learning_tools;
pub mod memory;
pub mod learner;
pub mod migrate;
pub mod modes;
pub mod perf;
pub mod prompt_skill;
pub mod reading;
pub mod secrets;
pub mod settings;
pub mod shadow;
pub mod sqlite;
pub mod teaching_strategy;
pub mod vocab;
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
pub use corpus::*;
pub use dictionary::*;
pub use dream::*;
pub use history::*;
pub use import::{
    find_legacy_db_candidates, import_browser_export_file, import_browser_export_value,
    import_reading_archive_file, list_history_view_models, migrate_legacy_sqlite_to_v2,
    scan_legacy_sqlite, LegacyDbScan, LegacyMigrationReport,
};
pub use journal::*;
pub use learning_events::*;
pub use learning_observations::*;
pub use learning_tools::*;
pub use memory::*;
pub use learner::*;
pub use migrate::*;
pub use modes::*;
pub use perf::*;
pub use prompt_skill::*;
pub use reading::*;
pub use secrets::*;
pub use settings::*;
pub use shadow::*;
pub use sqlite::*;
pub use teaching_strategy::*;
pub use vocab::*;
pub use writing::*;
