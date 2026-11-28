use super::native::{array, plain, section, string};
use super::service::identifier;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn index(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}

fn timing(row: &Value) -> (Option<f64>, Option<f64>) {
    match (row["start_time"].as_f64(), row["end_time"].as_f64()) {
        (Some(start), Some(end)) if start >= 0.0 && end > start => (Some(start), Some(end)),
        _ => (None, None),
    }
}

pub(super) fn from_unit(unit: &Value) -> Value {
    let mut parts = Vec::new();
    for (position, part) in array(unit, "parts").iter().enumerate() {
        let article = match &part["articleJson"] {
            Value::String(raw) => serde_json::from_str(raw).unwrap_or(Value::Null),
            value => value.clone(),
        };
        let part_id = identifier(&part["id"]).unwrap_or_default();
        let mut seen = std::collections::HashSet::new();
        let mut paragraphs = Vec::new();
        for (paragraph, segment) in array(&article, "segments").iter().enumerate() {
            let sentences: Vec<_> = array(segment, "sentences")
                .iter()
                .filter_map(|sentence| convert_sentence(sentence, segment, &part_id))
                .filter(|sentence| seen.insert(sentence["index"].as_u64().unwrap()))
                .collect();
            paragraphs.push(json!({
                "id": format!("{part_id}-p{paragraph}"),
                "speaker": string(&segment["speaker"], "name"),
                "sentences": sentences,
            }));
        }
        parts.push(json!({
            "id": part_id, "section": section(part, position), "title": string(part, "title"),
            "paragraphs": paragraphs, "translationStatus": "pending",
        }));
    }
    json!({"version":1,"parts":parts,"questions":{}})
}

fn convert_sentence(sentence: &Value, segment: &Value, part_id: &str) -> Option<Value> {
    let number = index(&sentence["sentence_index"])?;
    let text = string(sentence, "text");
    if text.trim().is_empty() {
        return None;
    }
    let (start, end) = timing(sentence);
    let words: Vec<_> = array(segment, "words")
        .iter()
        .filter(|word| index(&word["sentence_index"]) == Some(number))
        .map(|word| {
            let (start, end) = timing(word);
            json!({"text":string(word,"text"),"startSeconds":start,"endSeconds":end})
        })
        .collect();
    Some(json!({
        "id": format!("{part_id}-s{number}"), "index": number, "text": text,
        "startSeconds": start, "endSeconds": end, "words": words,
    }))
}

pub(super) fn translations(material: &mut Value, part_id: &str, response: &Value) {
    apply_translations(material, part_id, response, false);
}

pub(super) fn fill_listening_translations(material: &mut Value, part_id: &str, response: &Value) {
    if response["translations"].is_array() {
        apply_translations(material, part_id, response, true);
    }
}

fn apply_translations(material: &mut Value, part_id: &str, response: &Value, fill_missing: bool) {
    let Some(part) = material["parts"]
        .as_array_mut()
        .and_then(|parts| parts.iter_mut().find(|p| p["id"] == part_id))
    else {
        return;
    };
    part["sourceArticleHash"] = response["sourceArticleHash"].clone();
    part["translationStatus"] = json!("ready");
    let mut stale = false;
    let mut missing = false;
    for paragraph in part["paragraphs"].as_array_mut().into_iter().flatten() {
        for sentence in paragraph["sentences"].as_array_mut().into_iter().flatten() {
            if fill_missing && !string(sentence, "translation").trim().is_empty() {
                continue;
            }
            let translated = array(response, "translations").iter().find(|row| {
                index(&row["sentenceIndex"]).or_else(|| {
                    string(row, "sentenceKey")
                        .rsplit(['-', ':', '_'])
                        .next()?
                        .parse()
                        .ok()
                }) == sentence["index"].as_u64()
            });
            if let Some(row) = translated {
                let hash = string(row, "sourceTextHash");
                let expected = hex::encode(Sha256::digest(string(sentence, "text").as_bytes()));
                if !hash.is_empty() && hash != expected {
                    stale = true;
                    continue;
                }
                sentence["translation"] = json!(string(row, "zhText"));
                sentence["sourceTextHash"] = row["sourceTextHash"].clone();
            }
            missing |= string(sentence, "translation").trim().is_empty();
        }
    }
    if stale {
        part["translationStatus"] = json!("stale");
    } else if fill_missing && missing {
        part["translationStatus"] = json!("partial");
    }
}

pub(super) fn question(material: &Value, part_id: &str, row: &Value) -> Value {
    let raw = row["sentenceIndex"]
        .as_str()
        .map(str::to_owned)
        .or_else(|| row["sentenceIndex"].as_u64().map(|n| n.to_string()))
        .unwrap_or_default();
    let mut numbers = std::collections::BTreeSet::new();
    for token in raw.split([',', '，', ';', ' ']).filter(|s| !s.is_empty()) {
        let bounds: Vec<_> = token
            .split(['-', '–'])
            .filter_map(|s| s.parse::<u64>().ok())
            .collect();
        match bounds.as_slice() {
            [n] => {
                numbers.insert(*n);
            }
            [start, end] if end >= start && end - start < 1000 => {
                numbers.extend(*start..=*end);
            }
            _ => {}
        }
    }
    let sentence_ids: Vec<_> = array(material, "parts")
        .iter()
        .filter(|p| p["id"] == part_id)
        .flat_map(|p| array(p, "paragraphs"))
        .flat_map(|p| array(p, "sentences"))
        .filter(|s| s["index"].as_u64().is_some_and(|n| numbers.contains(&n)))
        .map(|s| s["id"].clone())
        .collect();
    let analyses: Vec<_> = ["analysisList", "analyses"]
        .iter()
        .flat_map(|key| array(row, key))
        .filter_map(|entry| {
            let text = entry.as_str().map(plain).or_else(|| {
                ["content", "analysisText", "analysis", "text"]
                    .iter()
                    .map(|key| plain(string(entry, key)))
                    .find(|s| !s.is_empty())
            })?;
            if text.is_empty() {
                return None;
            }
            let label = ["labelsOne", "labelsTwo"]
                .iter()
                .map(|key| plain(string(entry, key)))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" · ");
            Some(json!({"text":text,"label":label,"level":entry["level"]}))
        })
        .collect();
    json!({"partId":part_id,"sentenceIds":sentence_ids,"analyses":analyses})
}
