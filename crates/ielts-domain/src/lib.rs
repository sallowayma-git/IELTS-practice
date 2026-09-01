//! IELTS Practice domain contracts for the Rust + Tauri rewrite.
//!
//! Canonical enums, DTOs, error envelope, view models.
//! Legacy converters live in `ielts-db::import::convert` (optional one-shot import only).

pub mod cognitive_read;
pub mod coach_feedback;
pub mod consolidation;
pub mod context;
pub mod corpus;
pub mod domain;
pub mod dream;
pub mod dto;
pub mod embedding;
pub mod error;
pub mod journal;
pub mod agent_thread;
pub mod learner;
pub mod learning_events;
pub mod learning_tools;
pub mod memory;
pub mod prompt_skill;
pub mod teaching_strategy;
pub mod text_guard;
pub mod view;

pub use agent_thread::*;
pub use cognitive_read::*;
pub use coach_feedback::*;
pub use consolidation::*;
pub use context::*;
pub use corpus::*;
pub use domain::*;
pub use dream::*;
pub use dto::*;
pub use embedding::*;
pub use error::*;
pub use journal::*;
pub use learner::*;
pub use learning_events::*;
pub use learning_tools::*;
pub use memory::*;
pub use prompt_skill::*;
pub use teaching_strategy::*;
pub use text_guard::*;
pub use view::*;
