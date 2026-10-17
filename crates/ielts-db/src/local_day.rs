//! The one notion of "a day" the journal uses: a calendar day in the machine's
//! local time zone. A `YYYY-MM-DD` journal date names the local day; its bounds
//! are the UTC instants of that day's local midnights. Imports keep the source
//! RFC3339 offset, so SQL must compare bounds as instants (`julianday(col) >=
//! julianday(?)`), never as text.
//! Each function has a `*_in(tz)` core so tests can pin a zone; production
//! passes `chrono::Local`.

use chrono::{DateTime, Local, NaiveDate, NaiveTime, TimeZone, Utc};

use crate::sqlite::{DbError, DbResult};

/// `[start, end)` of local day `day` (`YYYY-MM-DD`) in the machine's zone.
pub fn day_bounds(day: &str) -> DbResult<(String, String)> {
    day_bounds_in(day, &Local)
}

/// `[start, end)` of calendar day `day` in `tz`, as UTC RFC3339 strings.
pub fn day_bounds_in<Tz: TimeZone>(day: &str, tz: &Tz) -> DbResult<(String, String)> {
    let date = NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .map_err(|error| DbError::Validation(format!("journalDate is not a valid date: {error}")))?;
    let next = date
        .succ_opt()
        .ok_or_else(|| DbError::Validation("journalDate has no successor".into()))?;
    Ok((midnight_utc(date, tz)?.to_rfc3339(), midnight_utc(next, tz)?.to_rfc3339()))
}

/// Local calendar day (`YYYY-MM-DD`) of `instant` in the machine's zone.
pub fn local_day_of<Z: TimeZone>(instant: &DateTime<Z>) -> String {
    day_of_in(instant, &Local)
}

/// Calendar day of `instant` as seen in `tz`.
pub fn day_of_in<Z: TimeZone, Tz: TimeZone>(instant: &DateTime<Z>, tz: &Tz) -> String {
    instant.with_timezone(tz).date_naive().format("%Y-%m-%d").to_string()
}

/// Register `ielts_local_day(ts)` on `conn`: the calendar day in `tz` of an
/// RFC3339 timestamp, or NULL when malformed. Lets SQLite group by local day so
/// only distinct days, not every event, leave the database.
pub(crate) fn register_local_day_fn<Tz>(conn: &rusqlite::Connection, tz: Tz) -> DbResult<()>
where
    Tz: TimeZone + Send + 'static,
{
    conn.create_scalar_function(
        "ielts_local_day",
        1,
        rusqlite::functions::FunctionFlags::SQLITE_UTF8 | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
        move |ctx| Ok(ctx.get::<Option<String>>(0)?.and_then(|at| day_of_timestamp_in(&at, &tz))),
    )?;
    Ok(())
}

/// Calendar day in `tz` of a stored RFC3339 timestamp; `None` when malformed.
pub(crate) fn day_of_timestamp_in<Tz: TimeZone>(timestamp: &str, tz: &Tz) -> Option<String> {
    DateTime::parse_from_rfc3339(timestamp.trim()).ok().map(|instant| day_of_in(&instant, tz))
}

/// Start of `date` in `tz`. A midnight skipped by a DST gap starts at the first
/// instant that does exist (the earliest mapping of the following hours).
fn midnight_utc<Tz: TimeZone>(date: NaiveDate, tz: &Tz) -> DbResult<DateTime<Utc>> {
    (0..=3)
        .find_map(|hour| {
            let time = NaiveTime::from_hms_opt(hour, 0, 0)?;
            tz.from_local_datetime(&date.and_time(time)).earliest()
        })
        .map(|start| start.with_timezone(&Utc))
        .ok_or_else(|| DbError::Validation(format!("{date} has no local midnight")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;

    #[test]
    fn a_beijing_day_spans_the_previous_utc_evening() {
        let beijing = FixedOffset::east_opt(8 * 3600).unwrap();
        let (start, end) = day_bounds_in("2026-10-13", &beijing).unwrap();
        assert_eq!(start, "2026-10-12T16:00:00+00:00");
        assert_eq!(end, "2026-10-13T16:00:00+00:00");
        // 02:00 Beijing on the 13th is 18:00Z on the 12th: same local day.
        let early = "2026-10-12T18:00:00.123Z";
        assert_eq!(day_of_timestamp_in(early, &beijing).as_deref(), Some("2026-10-13"));
        assert!(start.as_str() <= early && early < end.as_str());
    }

    #[test]
    fn utc_bounds_and_stored_formats_compare_correctly() {
        let (start, end) = day_bounds_in("2026-10-13", &Utc).unwrap();
        assert_eq!((start.as_str(), end.as_str()), ("2026-10-13T00:00:00+00:00", "2026-10-14T00:00:00+00:00"));
        // Both "Z" and "+00:00" spellings at exactly the bounds land on the right side.
        for inside in ["2026-10-13T00:00:00Z", "2026-10-13T00:00:00.5+00:00", "2026-10-13T23:59:59.999Z"] {
            assert!(start.as_str() <= inside && inside < end.as_str(), "{inside}");
        }
        for outside in ["2026-10-12T23:59:59.999Z", "2026-10-14T00:00:00Z", "2026-10-14T00:00:00+00:00"] {
            assert!(!(start.as_str() <= outside && outside < end.as_str()), "{outside}");
        }
        assert!(day_bounds_in("2026-13-01", &Utc).is_err());
        assert_eq!(day_of_timestamp_in("garbage", &Utc), None);
    }
}
