//! The eight block skills. One file per skill; each is a pure function of the
//! [`SkillContext`](super::SkillContext) that returns `None` when the week's
//! data gives it nothing to show.

pub mod accuracy;
pub mod coach_signals;
pub mod next_week_plan;
pub mod question_types;
pub mod redo_progress;
pub mod repeated_misses;
pub mod volume;
pub mod writing_bands;
