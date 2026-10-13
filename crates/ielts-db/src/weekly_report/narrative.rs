//! The model's narrative, applied to a report under the number whitelist.

use ielts_domain::{WeeklyNarrative, WeeklyReport};

/// Apply the model's title and per-block sentences to `report`. Returns how many
/// sentences were refused.
pub fn apply_narrative(_report: &mut WeeklyReport, _narrative: WeeklyNarrative) -> usize {
    0
}
