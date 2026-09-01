//! One-shot legacy payload converters (cold path only).
//!
//! Product submit/evaluate must build AttemptRecord / WritingEvaluationV4 natively.

mod evaluation_v3;
mod reading_archive;

pub use evaluation_v3::*;
pub use reading_archive::*;
