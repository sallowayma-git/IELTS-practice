//! Original product timing rules (index-fabf838e.js Zt/jo); output seconds.
use serde_json::{json, Value};

fn number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|n| n.is_finite())
}

fn raw_range(row: &Value) -> Result<(f64, f64), String> {
    let start = number(&row["start_time"]).ok_or("精听句子缺少起始时间")?;
    let end = number(&row["end_time"]).ok_or("精听句子缺少结束时间")?;
    if start < 0.0 || end <= start {
        return Err("精听句子时间无效".into());
    }
    Ok((start, end))
}

pub(super) fn playback(row: &Value) -> Result<(f64, f64), String> {
    let (start, end) = raw_range(row)?;
    Ok((start / 1000.0, end / 1000.0))
}

pub(super) fn alignment_sentence(row: &Value) -> Result<(f64, f64), String> {
    let (start, end) = raw_range(row)?;
    let is_seconds = end - start <= 120.0 && start.abs().max(end.abs()) <= 7200.0;
    let scale = if is_seconds { 1.0 } else { 0.001 };
    Ok((start * scale, end * scale))
}

fn edge(row: &Value, start: bool) -> Option<f64> {
    let fields = if start {
        ["start_time", "startTime", "start", "begin_time", "begin"]
    } else {
        ["end_time", "endTime", "end", "stop_time", "stop"]
    };
    fields
        .into_iter()
        .filter_map(|k| row.get(k))
        .find(|v| !v.is_null())
        .and_then(number)
}

fn nearby(rows: &[Value], index: usize) -> f64 {
    rows[..index]
        .iter()
        .rev()
        .find_map(|r| edge(r, false).or_else(|| edge(r, true)))
        .or_else(|| {
            rows[index + 1..]
                .iter()
                .find_map(|r| edge(r, true).or_else(|| edge(r, false)))
        })
        .unwrap_or(0.0)
}

pub(super) fn words(row: &Value, start: f64, end: f64) -> Vec<Value> {
    let raw = &row["subtitle_alignment_details"];
    let value = raw
        .as_str()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| raw.clone());
    let rows = value.as_array().or_else(|| {
        ["words", "details", "alignment_details"]
            .iter()
            .find_map(|k| value[k].as_array())
    });
    let Some(rows) = rows else { return vec![] };
    let times = rows
        .iter()
        .flat_map(|r| [edge(r, true), edge(r, false)])
        .flatten()
        .collect::<Vec<_>>();
    if times.is_empty() {
        return vec![];
    }
    let min = times.iter().copied().fold(f64::INFINITY, f64::min);
    let max = times.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let relative_seconds = min >= -0.1 && max <= end - start + 2.0;
    let absolute_seconds = end > 0.0 && min >= start - 2.0 && max <= end + 2.0 && max <= 7200.0;
    let scale = if relative_seconds || absolute_seconds {
        1.0
    } else {
        0.001
    };
    rows.iter()
        .enumerate()
        .filter_map(|(index, word)| {
            let text = ["text", "word", "content", "value"]
                .iter()
                .filter_map(|k| word.get(k))
                .find(|v| !v.is_null())?
                .as_str()?
                .trim();
            if text.is_empty() {
                return None;
            }
            let mut from = edge(word, true).unwrap_or_else(|| nearby(rows, index)) * scale;
            let mut to = edge(word, false).map(|t| t * scale).unwrap_or(from);
            let absolute = absolute_seconds
                || (end > 0.0 && from >= start - 1.0 && from <= end + 1.0 && to >= start - 1.0);
            if absolute {
                from -= start;
                to -= start;
            }
            if to <= from {
                to = rows
                    .get(index + 1)
                    .and_then(|r| edge(r, true))
                    .map(|n| n * scale)
                    .unwrap_or(from + 0.2);
                if absolute {
                    to -= start;
                }
                if to <= from {
                    to = from + 0.001;
                }
            }
            from = from.max(0.0);
            to = to.max(0.0);
            (to > from).then(|| json!({"text":text,"startSeconds":from,"endSeconds":to}))
        })
        .collect()
}
