//! Rule-based SM-2 vocabulary scheduler.
//!
//! Pure port of `js/core/vocabScheduler.js` (origin/main). No I/O and no clock:
//! every time-dependent function takes `now` as Unix epoch milliseconds.
//! Intervals are in days (`f64`, as in the JS). Deviations from the JS are
//! documented on the items they affect.

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

/// SM2_CONSTANTS
pub const MIN_EASE_FACTOR: f64 = 1.3;
pub const MAX_EASE_FACTOR: f64 = 3.0;
pub const DEFAULT_EASE_FACTOR: f64 = 2.5;
pub const INITIAL_INTERVAL_DAYS: f64 = 1.0;
pub const SECOND_INTERVAL_DAYS: f64 = 6.0;
/// Declared in the JS but never read there; kept for parity and not enforced.
pub const MAX_INTRA_CYCLES: u32 = 12;
/// JS `Date` arithmetic is in milliseconds; one day in ms.
pub const DAY_MS: i64 = 86_400_000;

const DEFAULT_REVIEW_LIMIT: usize = 100;
const DEFAULT_NEW_LIMIT: usize = 20;

/// Review rating. Accepts exactly the JS strings `wrong|hard|good|easy`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sm2Rating {
    Wrong,
    Hard,
    Good,
    Easy,
}

impl Sm2Rating {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "wrong" => Some(Self::Wrong),
            "hard" => Some(Self::Hard),
            "good" => Some(Self::Good),
            "easy" => Some(Self::Easy),
            _ => None,
        }
    }

    /// QUALITY_RATINGS in the JS.
    fn quality(self) -> f64 {
        match self {
            Self::Wrong => 0.0,
            Self::Hard => 3.0,
            Self::Good => 4.0,
            Self::Easy => 5.0,
        }
    }
}

/// SM-2 fields of a word.
///
/// Deviation: `ease_factor` is `Option<f64>` because JS uses `null` for a
/// new word that has no ease factor yet. `None` = new word.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sm2State {
    pub ease_factor: Option<f64>,
    pub interval: f64,
    pub repetitions: u32,
    pub intra_cycles: u32,
    /// Not in the original JS; counts Wrong ratings so chronically failed words can be identified.
    pub lapses: u32,
}

impl Default for Sm2State {
    /// JS `normalizeWord({})`.
    fn default() -> Self {
        Self {
            ease_factor: None,
            interval: INITIAL_INTERVAL_DAYS,
            repetitions: 0,
            intra_cycles: 0,
            lapses: 0,
        }
    }
}

/// Raw SM-2 fields as they may arrive from storage. `None` = missing (JS: not a number).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Sm2Raw {
    pub ease_factor: Option<f64>,
    pub interval: Option<f64>,
    pub repetitions: Option<f64>,
    pub intra_cycles: Option<f64>,
    pub lapses: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sm2Outcome {
    pub state: Sm2State,
    /// `None` only for the first review of a new word (JS sets no nextReview there).
    pub next_review: Option<i64>,
}

/// One candidate for `pick_daily_task`, carrying only the fields its ordering reads.
#[derive(Debug, Clone)]
pub struct DailyItem<T> {
    pub item: T,
    /// New-word tie-break. JS uses `localeCompare`; here plain byte order.
    pub word: String,
    pub next_review: Option<i64>,
    pub last_reviewed: Option<i64>,
    pub correct_count: u32,
    pub freq: Option<f64>,
}

// ---- JS semantics helpers -------------------------------------------------

/// JS `x || fallback` for numbers: `0` and `NaN` are falsy.
fn js_or(x: f64, fallback: f64) -> f64 {
    if x == 0.0 || x.is_nan() {
        fallback
    } else {
        x
    }
}

/// JS `Math.min(hi, x)`; NaN propagates.
fn at_most(x: f64, hi: f64) -> f64 {
    if x > hi {
        hi
    } else {
        x
    }
}

/// JS `Math.max(lo, x)`; NaN propagates.
fn at_least(x: f64, lo: f64) -> f64 {
    if x < lo {
        lo
    } else {
        x
    }
}

/// JS `Math.round`: ties go toward +infinity (`-2.5` -> `-2`).
fn js_round(x: f64) -> f64 {
    let floor = x.floor();
    if x - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

/// Count fields. `as` saturates: NaN and negatives become 0, fractions truncate.
/// Deviation: JS would keep -3 or 2.7 as-is; u32 cannot represent them.
fn to_count(raw: Option<f64>) -> u32 {
    raw.map_or(0, |v| v as u32)
}

fn initial_ease_factor(rating: Sm2Rating) -> f64 {
    match rating {
        Sm2Rating::Easy => 2.8,
        Sm2Rating::Hard => 1.8,
        // JS has no `wrong` key and falls back to `good`.
        Sm2Rating::Good | Sm2Rating::Wrong => DEFAULT_EASE_FACTOR,
    }
}

fn intra_ef_adjustment(rating: Sm2Rating) -> f64 {
    match rating {
        Sm2Rating::Easy => 0.15,
        Sm2Rating::Good => 0.05,
        Sm2Rating::Hard => -0.10,
        // JS has no `wrong` key and uses 0.
        Sm2Rating::Wrong => 0.0,
    }
}

// ---- SM-2 core ------------------------------------------------------------

/// JS `normalizeWord`, SM-2 fields only. Missing fields get JS defaults.
/// Deviation: JS does NOT clamp EF, interval or counts; neither does this
/// (except the u32 conversion of counts, see `to_count`).
pub fn normalize(raw: &Sm2Raw) -> Sm2State {
    Sm2State {
        ease_factor: raw.ease_factor,
        interval: raw.interval.unwrap_or(INITIAL_INTERVAL_DAYS),
        repetitions: to_count(raw.repetitions),
        intra_cycles: to_count(raw.intra_cycles),
        lapses: raw.lapses.unwrap_or(0),
    }
}

/// JS `calculateEaseFactor`. Quality is clamped to 0..=5; a zero or NaN old EF
/// falls back to the default (JS `oldEF || 2.5`); the result is clamped to [MIN, MAX].
pub fn next_ease_factor(old_ef: f64, quality: f64) -> f64 {
    let q = at_least(at_most(js_or(quality, 0.0), 5.0), 0.0);
    let ef = js_or(old_ef, DEFAULT_EASE_FACTOR);
    let miss = 5.0 - q;
    let raw = ef + (0.1 - miss * (0.08 + miss * 0.02));
    at_least(at_most(raw, MAX_EASE_FACTOR), MIN_EASE_FACTOR)
}

/// JS `calculateInterval`. Zero or NaN old interval and EF fall back as in JS.
pub fn next_interval(repetitions: u32, old_interval: f64, ease_factor: f64) -> f64 {
    match repetitions {
        0 => INITIAL_INTERVAL_DAYS,
        1 => SECOND_INTERVAL_DAYS,
        _ => js_round(js_or(old_interval, 0.0) * js_or(ease_factor, DEFAULT_EASE_FACTOR)),
    }
}

/// JS `calculateNextReview`. Deviation: JS adds calendar days in local time
/// via `setDate` (DST and TZ dependent); this adds fixed 24h multiples.
/// Negative, NaN and fractional days behave as in JS (clamped to 0, truncated).
pub fn next_review_at(now: i64, days: f64) -> i64 {
    let whole = at_least(js_or(days, 0.0), 0.0).trunc();
    now.saturating_add((whole * DAY_MS as f64) as i64)
}

/// JS `setInitialEaseFactor`: only EF and intraCycles change. No nextReview or
/// lastReviewed is set, so the word stays "new" until its second review.
pub fn set_initial_ease_factor(state: &Sm2State, rating: Sm2Rating) -> Sm2State {
    Sm2State {
        ease_factor: Some(initial_ease_factor(rating)),
        intra_cycles: if rating == Sm2Rating::Easy { 0 } else { 1 },
        ..*state
    }
}

/// JS `adjustIntraCycleEF`. A missing EF counts as 0 (JS `null + x`), so the
/// result clamps to MIN_EASE_FACTOR. Every call increments intraCycles.
pub fn adjust_intra_cycle_ef(state: &Sm2State, rating: Sm2Rating) -> Sm2State {
    let base = state.ease_factor.unwrap_or(0.0);
    let raw = base + intra_ef_adjustment(rating);
    let ef = at_least(at_most(raw, MAX_EASE_FACTOR), MIN_EASE_FACTOR);
    Sm2State {
        ease_factor: Some(ef),
        intra_cycles: state.intra_cycles.saturating_add(1),
        ..*state
    }
}

/// Failure branch of `scheduleAfterResult` (quality < 3, i.e. Wrong).
/// Note: only the MIN clamp applies here, as in JS.
fn fail_review(state: &Sm2State, ef: f64, now: i64) -> Sm2Outcome {
    Sm2Outcome {
        state: Sm2State {
            ease_factor: Some(at_least(ef - 0.2, MIN_EASE_FACTOR)),
            interval: INITIAL_INTERVAL_DAYS,
            repetitions: 0,
            intra_cycles: 1,
            ..*state
        },
        next_review: Some(next_review_at(now, INITIAL_INTERVAL_DAYS)),
    }
}

/// Success branch of `scheduleAfterResult` (quality >= 3: Hard, Good, Easy).
fn pass_review(state: &Sm2State, ef: f64, rating: Sm2Rating, now: i64) -> Sm2Outcome {
    let new_ef = next_ease_factor(ef, rating.quality());
    let repetitions = state.repetitions.saturating_add(1);
    let interval = next_interval(repetitions, state.interval, new_ef);
    Sm2Outcome {
        state: Sm2State {
            ease_factor: Some(new_ef),
            interval,
            repetitions,
            intra_cycles: 0,
            ..*state
        },
        next_review: Some(next_review_at(now, interval)),
    }
}

/// JS `scheduleAfterResult`. `now` is always passed in; the clock is never read.
pub fn schedule_after_result(state: &Sm2State, rating: Sm2Rating, now: i64) -> Sm2Outcome {
    let mut outcome = match state.ease_factor {
        None => Sm2Outcome {
            state: set_initial_ease_factor(state, rating),
            next_review: None,
        },
        Some(ef) if rating.quality() < 3.0 => fail_review(state, ef, now),
        Some(ef) => pass_review(state, ef, rating, now),
    };
    if rating == Sm2Rating::Wrong {
        outcome.state.lapses = state.lapses.saturating_add(1);
    }
    outcome
}

/// JS `calculateNextReview`-based due check: `nextReview <= now`.
pub fn is_due(next_review: Option<i64>, now: i64) -> bool {
    matches!(next_review, Some(at) if at <= now)
}

// ---- Daily task selection (JS `pickDailyTask`) ----------------------------

/// Due words sort by nextReview, then correctCount.
fn due_order<T>(a: &DailyItem<T>, b: &DailyItem<T>) -> Ordering {
    a.next_review
        .unwrap_or(0)
        .cmp(&b.next_review.unwrap_or(0))
        .then(a.correct_count.cmp(&b.correct_count))
}

/// New words sort by freq descending, then word ascending.
fn new_order<T>(a: &DailyItem<T>, b: &DailyItem<T>) -> Ordering {
    b.freq
        .unwrap_or(0.0)
        .partial_cmp(&a.freq.unwrap_or(0.0))
        .unwrap_or(Ordering::Equal)
        .then_with(|| a.word.cmp(&b.word))
}

/// A word is due when it has `nextReview <= now`. A word with no
/// `lastReviewed` and not due is new. Anything else is in neither group.
fn split_due_and_new<T>(
    items: Vec<DailyItem<T>>,
    now: i64,
) -> (Vec<DailyItem<T>>, Vec<DailyItem<T>>) {
    let mut due = Vec::new();
    let mut fresh = Vec::new();
    for item in items {
        if is_due(item.next_review, now) {
            due.push(item);
        } else if item.last_reviewed.is_none() {
            fresh.push(item);
        }
    }
    (due, fresh)
}

/// JS `pickDailyTask`. Deviations:
/// - `limit <= 0` (or missing) means the default 100, so 0 does not mean "none".
/// - `new_limit` of `None` or negative means the default 20.
/// - `limit` is `i64`, so JS fractional limits are not representable.
/// The JS `getDueWords` does not exist in this file; this is its counterpart.
pub fn pick_daily_task<T>(
    items: Vec<DailyItem<T>>,
    limit: i64,
    new_limit: Option<i64>,
    now: i64,
) -> Vec<T> {
    let review_limit = usize::try_from(limit)
        .ok()
        .filter(|n| *n > 0)
        .unwrap_or(DEFAULT_REVIEW_LIMIT);
    let new_limit = new_limit
        .and_then(|n| usize::try_from(n).ok())
        .unwrap_or(DEFAULT_NEW_LIMIT);
    let (mut due, mut fresh) = split_due_and_new(items, now);
    due.sort_by(due_order);
    fresh.sort_by(new_order);
    let mut tasks: Vec<T> = due
        .into_iter()
        .take(review_limit)
        .map(|d| d.item)
        .collect();
    let room = review_limit.saturating_sub(tasks.len()).min(new_limit);
    tasks.extend(fresh.into_iter().take(room).map(|d| d.item));
    tasks
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_700_000_000_000;

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    fn ef(s: &Sm2State) -> f64 {
        s.ease_factor.unwrap_or(f64::NAN)
    }

    fn mid(ef: f64, interval: f64, repetitions: u32, lapses: u32) -> Sm2State {
        Sm2State {
            ease_factor: Some(ef),
            interval,
            repetitions,
            intra_cycles: 0,
            lapses,
        }
    }

    fn days(n: i64) -> i64 {
        n * DAY_MS
    }

    fn schedule(s: &Sm2State, r: Sm2Rating) -> Sm2Outcome {
        schedule_after_result(s, r, NOW)
    }

    #[test]
    fn defaults_match_js_normalize_of_empty_word() {
        // JS normalizeWord({}): easeFactor null, interval 1, repetitions 0, intraCycles 0.
        let d = Sm2State::default();
        assert_eq!(d.ease_factor, None);
        assert_eq!(d.interval, 1.0);
        assert_eq!(d.repetitions, 0);
        assert_eq!(d.intra_cycles, 0);
        assert_eq!(d.lapses, 0);
        assert_eq!(normalize(&Sm2Raw::default()), d);
    }

    #[test]
    fn good_progression_new_word_then_1_6_then_ef_based() {
        // Review 1 (new word): EF = 2.5 (good), intraCycles = 1, no nextReview.
        let first = schedule(&Sm2State::default(), Sm2Rating::Good);
        assert_eq!(first.state.ease_factor, Some(2.5));
        assert_eq!(first.state.intra_cycles, 1);
        assert_eq!(first.state.repetitions, 0);
        assert_eq!(first.state.interval, 1.0);
        assert_eq!(first.next_review, None);

        // Review 2: q=4 -> EF' = 2.5 + (0.1 - 1*(0.08+0.02)) = 2.5; reps 1 -> interval 6.
        let second = schedule(&first.state, Sm2Rating::Good);
        assert!(approx(ef(&second.state), 2.5));
        assert_eq!(second.state.repetitions, 1);
        assert_eq!(second.state.interval, 6.0);
        assert_eq!(second.state.intra_cycles, 0);
        assert_eq!(second.next_review, Some(NOW + days(6)));

        // Review 3: reps 2 -> interval round(6 * 2.5) = 15.
        let third = schedule_after_result(&second.state, Sm2Rating::Good, NOW + days(6));
        assert_eq!(third.state.repetitions, 2);
        assert_eq!(third.state.interval, 15.0);
        assert_eq!(third.next_review, Some(NOW + days(6) + days(15)));
    }

    #[test]
    fn first_review_per_rating_sets_initial_ef_and_cycles() {
        // easy: EF 2.8, cycles 0. hard: EF 1.8, cycles 1. wrong: EF falls back to 2.5, cycles 1.
        let easy = schedule(&Sm2State::default(), Sm2Rating::Easy).state;
        assert_eq!(easy.ease_factor, Some(2.8));
        assert_eq!(easy.intra_cycles, 0);
        let hard = schedule(&Sm2State::default(), Sm2Rating::Hard).state;
        assert_eq!(hard.ease_factor, Some(1.8));
        assert_eq!(hard.intra_cycles, 1);
        let wrong = schedule(&Sm2State::default(), Sm2Rating::Wrong);
        assert_eq!(wrong.state.ease_factor, Some(2.5));
        assert_eq!(wrong.state.intra_cycles, 1);
        // Deviation-by-spec: lapses count every Wrong, including on new words.
        assert_eq!(wrong.state.lapses, 1);
        assert_eq!(wrong.next_review, None);
    }

    #[test]
    fn easy_and_hard_from_mid_progress() {
        let s = mid(2.5, 15.0, 2, 0);
        // Easy q=5: EF' = 2.5 + 0.1 = 2.6; reps 3; interval round(15 * 2.6) = 39.
        let easy = schedule(&s, Sm2Rating::Easy);
        assert!(approx(ef(&easy.state), 2.6));
        assert_eq!(easy.state.repetitions, 3);
        assert_eq!(easy.state.interval, 39.0);
        assert_eq!(easy.state.intra_cycles, 0);
        assert_eq!(easy.next_review, Some(NOW + days(39)));

        // Hard q=3: EF' = 2.5 + (0.1 - 2*(0.08+0.04)) = 2.36; reps 3; round(15 * 2.36) = round(35.4) = 35.
        let hard = schedule(&s, Sm2Rating::Hard);
        assert!(approx(ef(&hard.state), 2.36));
        assert_eq!(hard.state.repetitions, 3);
        assert_eq!(hard.state.interval, 35.0);
        assert_eq!(hard.next_review, Some(NOW + days(35)));
    }

    #[test]
    fn wrong_from_mid_progress_resets_and_counts_lapse() {
        let s = mid(2.5, 15.0, 2, 3);
        // Wrong: EF' = max(1.3, 2.5 - 0.2) = 2.3; reps 0; interval 1; cycles 1; next = now + 1 day.
        let w = schedule(&s, Sm2Rating::Wrong);
        assert!(approx(ef(&w.state), 2.3));
        assert_eq!(w.state.repetitions, 0);
        assert_eq!(w.state.interval, 1.0);
        assert_eq!(w.state.intra_cycles, 1);
        assert_eq!(w.state.lapses, 4);
        assert_eq!(w.next_review, Some(NOW + days(1)));
    }

    #[test]
    fn non_wrong_ratings_do_not_change_lapses() {
        let s = mid(2.5, 15.0, 2, 3);
        for rating in [Sm2Rating::Hard, Sm2Rating::Good, Sm2Rating::Easy] {
            assert_eq!(schedule(&s, rating).state.lapses, 3);
        }
    }

    #[test]
    fn ease_factor_stays_within_bounds() {
        // Repeated Wrong from the floor: 1.4 -> 1.2 -> clamped to 1.3, then 1.1 -> 1.3.
        let mut low = mid(1.4, 1.0, 0, 0);
        for _ in 0..5 {
            low = schedule(&low, Sm2Rating::Wrong).state;
        }
        assert!(approx(ef(&low), MIN_EASE_FACTOR));

        // Hard from 1.4: 1.4 - 0.14 = 1.26 -> clamped to 1.3.
        assert!(approx(ef(&schedule(&mid(1.4, 1.0, 0, 0), Sm2Rating::Hard).state), MIN_EASE_FACTOR));

        // Repeated Easy from 2.95: 3.05 -> clamped to 3.0, then stays 3.0.
        let mut high = mid(2.95, 1.0, 0, 0);
        for _ in 0..3 {
            high = schedule(&high, Sm2Rating::Easy).state;
        }
        assert!(approx(ef(&high), MAX_EASE_FACTOR));
    }

    #[test]
    fn normalize_defaults_and_does_not_clamp() {
        // Missing fields take JS defaults. EF 9.0 is kept (JS does not clamp in normalizeWord).
        let raw = Sm2Raw {
            ease_factor: Some(9.0),
            interval: None,
            repetitions: None,
            intra_cycles: Some(2.0),
            lapses: None,
        };
        let n = normalize(&raw);
        assert_eq!(n.ease_factor, Some(9.0));
        assert_eq!(n.interval, 1.0);
        assert_eq!(n.repetitions, 0);
        assert_eq!(n.intra_cycles, 2);
        assert_eq!(n.lapses, 0);
        // Deviation: JS keeps repetitions -3 as-is; u32 saturates it to 0.
        let neg = Sm2Raw { repetitions: Some(-3.0), ..Sm2Raw::default() };
        assert_eq!(normalize(&neg).repetitions, 0);
    }

    #[test]
    fn js_helpers_match_js_semantics() {
        // JS: Math.round(2.5)=3, Math.round(-2.5)=-2, Math.round(2.4)=2.
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(2.4), 2.0);
        // JS: oldEF || 2.5 treats 0 as missing in the EF calculation.
        assert!(approx(next_ease_factor(0.0, 4.0), 2.5));
        // JS: quality 5 adds 0.1.
        assert!(approx(next_ease_factor(2.5, 5.0), 2.6));
    }

    #[test]
    fn adjust_intra_cycle_ef_clamps_and_counts_cycles() {
        // Easy: 2.5 + 0.15 = 2.65; cycles 0 -> 1.
        let a = adjust_intra_cycle_ef(&mid(2.5, 1.0, 0, 0), Sm2Rating::Easy);
        assert!(approx(ef(&a), 2.65));
        assert_eq!(a.intra_cycles, 1);
        // Hard from 1.35: 1.35 - 0.10 = 1.25 -> clamped to 1.3.
        let b = adjust_intra_cycle_ef(&mid(1.35, 1.0, 0, 0), Sm2Rating::Hard);
        assert!(approx(ef(&b), MIN_EASE_FACTOR));
        // Missing EF: JS null + 0.05 = 0.05 -> clamped to 1.3.
        let c = adjust_intra_cycle_ef(&Sm2State::default(), Sm2Rating::Good);
        assert!(approx(ef(&c), MIN_EASE_FACTOR));
    }

    #[test]
    fn pick_daily_task_orders_and_limits() {
        // Due: C (-5000, correct 9), B (-1000, correct 1), A (-1000, correct 2).
        // D is not due and already reviewed, so excluded.
        // New: F (freq 50), E (freq 10), Z (freq 10, word "Z" after "E"), G (freq none).
        let items = || {
            vec![
                due("C", NOW - 5000, 9),
                due("B", NOW - 1000, 1),
                due("A", NOW - 1000, 2),
                DailyItem {
                    item: "D",
                    word: "D".into(),
                    next_review: Some(NOW + 1),
                    last_reviewed: Some(NOW - days(1)),
                    correct_count: 0,
                    freq: None,
                },
                fresh("E", Some(10.0)),
                fresh("F", Some(50.0)),
                fresh("Z", Some(10.0)),
                fresh("G", None),
            ]
        };
        assert_eq!(pick_daily_task(items(), 100, None, NOW), vec!["C", "B", "A", "F", "E", "Z", "G"]);
        // Limit 0 means the default 100.
        assert_eq!(pick_daily_task(items(), 0, None, NOW), vec!["C", "B", "A", "F", "E", "Z", "G"]);
        // Limit 4 with new cap 1: 3 due, then 1 new (highest freq).
        assert_eq!(pick_daily_task(items(), 4, Some(1), NOW), vec!["C", "B", "A", "F"]);
        // Limit 2 truncates the due list; no new words.
        assert_eq!(pick_daily_task(items(), 2, Some(5), NOW), vec!["C", "B"]);
        // New cap 0: due only.
        assert_eq!(pick_daily_task(items(), 100, Some(0), NOW), vec!["C", "B", "A"]);
        // Negative new cap means the default 20, so new words are included.
        assert_eq!(pick_daily_task(items(), 100, Some(-1), NOW), vec!["C", "B", "A", "F", "E", "Z", "G"]);
    }

    fn due(label: &'static str, next: i64, correct: u32) -> DailyItem<&'static str> {
        DailyItem {
            item: label,
            word: label.into(),
            next_review: Some(next),
            last_reviewed: Some(NOW - days(1)),
            correct_count: correct,
            freq: None,
        }
    }

    fn fresh(label: &'static str, freq: Option<f64>) -> DailyItem<&'static str> {
        DailyItem {
            item: label,
            word: label.into(),
            next_review: None,
            last_reviewed: None,
            correct_count: 0,
            freq,
        }
    }

    #[test]
    fn is_due_is_inclusive_and_false_without_time() {
        assert!(is_due(Some(NOW), NOW));
        assert!(!is_due(Some(NOW + 1), NOW));
        assert!(!is_due(None, NOW));
    }

    #[test]
    fn rating_parse_accepts_exact_js_strings_only() {
        assert_eq!(Sm2Rating::parse("wrong"), Some(Sm2Rating::Wrong));
        assert_eq!(Sm2Rating::parse("hard"), Some(Sm2Rating::Hard));
        assert_eq!(Sm2Rating::parse("good"), Some(Sm2Rating::Good));
        assert_eq!(Sm2Rating::parse("easy"), Some(Sm2Rating::Easy));
        assert_eq!(Sm2Rating::parse("Good"), None);
        assert_eq!(Sm2Rating::parse(""), None);
        assert_eq!(Sm2Rating::parse("correct"), None);
    }
}
