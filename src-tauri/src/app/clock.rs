//! The wall clock the weekly report reads.
//!
//! `IELTS_ATLAS_FAKE_NOW` (an RFC3339 instant with its offset, such as
//! `2026-10-18T10:00:00+08:00`) replaces "now" for the weekly scheduler and the
//! live weekly report, so the packaged E2E can reach a weekend on any day. It
//! moves nothing else: practice, journals and audit rows keep the real clock.

use chrono::{DateTime, FixedOffset, Local};

pub const FAKE_NOW_ENV: &str = "IELTS_ATLAS_FAKE_NOW";

/// Local now, with its offset; the override when it is set and valid.
pub fn now() -> DateTime<FixedOffset> {
    std::env::var(FAKE_NOW_ENV)
        .ok()
        .and_then(|value| parse(&value))
        .unwrap_or_else(|| Local::now().fixed_offset())
}

fn parse(value: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(value.trim()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_override_keeps_its_offset_and_garbage_is_ignored() {
        let parsed = parse("2026-10-18T10:00:00+08:00").unwrap();
        assert_eq!(parsed.offset().local_minus_utc(), 8 * 3600);
        assert_eq!(parse("next sunday"), None);
    }
}
