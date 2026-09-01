//! Optional one-shot legacy data import (cold path).
//!
//! Product runtime must not call converters on submit/evaluate hot paths.

mod browser_export;
pub mod convert;
mod reading_archive;
mod repository;
mod sqlite_legacy;

pub use browser_export::*;
pub use convert::{
    assert_no_legacy_aliases, evaluation_v3_to_v4, reading_archive_to_attempts,
    reading_submission_to_attempt,
};
pub use reading_archive::*;
pub use repository::*;
pub use sqlite_legacy::*;
