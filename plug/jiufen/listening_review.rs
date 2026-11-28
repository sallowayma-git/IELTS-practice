use super::*;
use crate::jiufen::service::Session;

pub(in crate::jiufen) struct Entry {
    document: Value,
    analyses: HashMap<String, Value>,
    analyses_requested: bool,
    translations_requested: bool,
    review: Option<Value>,
    last_used: std::time::Instant,
}

fn entry<'a>(
    session: &'a mut Session,
    loaded: &PracticeAssetV2Payload,
    attempt: &str,
) -> &'a mut Entry {
    let key = format!("{}:{attempt}", loaded.asset.id);
    let cache = &mut session.listening_reviews;
    if cache.len() >= 16 && !cache.contains_key(&key) {
        if let Some(oldest) = cache.iter().min_by_key(|(_, item)| item.last_used).map(|(key, _)| key.clone()) {
            cache.remove(&oldest);
        }
    }
    let now = std::time::Instant::now();
    let cached = cache.entry(key).or_insert_with(|| Entry {
        document: loaded.payload["studyMaterial"].clone(),
        analyses: HashMap::new(),
        analyses_requested: false,
        translations_requested: false,
        review: None,
        last_used: now,
    });
    cached.last_used = now;
    cached
}

fn analysis_row(data: &Value) -> &Value {
    data.get("question").filter(|value| value.is_object()).unwrap_or(data)
}

fn valid_analysis(data: &Value) -> bool {
    let row = analysis_row(data);
    ["analysisList", "analyses"].iter().any(|field| row[*field].is_array())
        || ["analysisText", "analysis", "explanation", "sentenceIndex"]
        .iter()
        .any(|field| row[*field].is_string())
        || row["sentenceIndex"].is_u64()
}

pub(super) async fn analyses(
    session: &mut Session,
    loaded: &PracticeAssetV2Payload,
    attempt: &str,
    questions: &[SourceQuestion],
    retry_missing: bool,
) -> HashMap<String, Value> {
    let cached = entry(session, loaded, attempt);
    if cached.analyses_requested && !retry_missing {
        return cached.analyses.clone();
    }
    let requests = analysis_requests(questions)
        .into_iter()
        .filter(|(id, _)| !cached.analyses.contains_key(id))
        .collect();
    cached.analyses_requested = true;
    let responses = question_analyses(session, requests).await;
    let cached = entry(session, loaded, attempt);
    cached.analyses.extend(responses.into_iter().filter(|(_, data)| valid_analysis(data)));
    cached.analyses.clone()
}

fn untranslated_parts(document: &Value) -> impl Iterator<Item = &Value> {
    array(document, "parts").iter().filter(|part| {
        part["translationStatus"] != "ready"
            && array(part, "paragraphs").iter().any(|p| !array(p, "sentences").is_empty())
    })
}

fn project(cached: &Entry, questions: &[SourceQuestion]) -> Value {
    let mut view = cached.document.clone();
    let mut missing = Vec::new();
    for q in questions {
        if let Some(data) = cached.analyses.get(&q.key) {
            let row = analysis_row(data);
            let mut projected = super::super::material::question(&view, &q.part_id, row);
            if array(&projected, "analyses").is_empty() {
                let text = explanation(row);
                if !text.is_empty() {
                    projected["analyses"] = json!([{"text":text}]);
                }
            }
            view["questions"][&q.key] = projected;
        } else if !q.question_id.is_empty() {
            missing.push(q.key.as_str());
        }
    }
    let parts: Vec<_> = untranslated_parts(&view)
        .filter_map(|part| part["section"].as_u64())
        .collect();
    view["analysesComplete"] = json!(missing.is_empty());
    view["missing"] = json!({"translationParts":parts,"analysisQuestions":missing});
    view
}

pub(super) async fn study(
    session: &mut Session,
    loaded: &PracticeAssetV2Payload,
    attempt: &str,
    questions: &[SourceQuestion],
    retry_missing: bool,
) -> Value {
    analyses(session, loaded, attempt, questions, retry_missing).await;
    let cached = entry(session, loaded, attempt);
    if !cached.translations_requested || retry_missing {
        let requests = untranslated_parts(&cached.document)
            .filter_map(|part| identifier(&part["id"]))
            .map(|id| {
                let path = format!("/practice/v1/parts/{id}/sentence-translations?locale=zh-CN");
                (id, path)
            })
            .collect();
        cached.translations_requested = true;
        let responses = question_analyses(session, requests).await;
        let cached = entry(session, loaded, attempt);
        for (id, response) in responses {
            super::super::material::fill_listening_translations(&mut cached.document, &id, &response);
        }
    }
    project(entry(session, loaded, attempt), questions)
}

pub(super) fn remember(
    session: &mut Session,
    loaded: &PracticeAssetV2Payload,
    attempt: &str,
    result: &Value,
) {
    entry(session, loaded, attempt).review = Some(result.clone());
}

pub(super) fn result(
    session: &mut Session,
    loaded: &PracticeAssetV2Payload,
    attempt: &str,
    questions: &[SourceQuestion],
) -> Option<Value> {
    let cached = entry(session, loaded, attempt);
    let mut result = cached.review.clone()?;
    for (key, data) in &cached.analyses {
        let text = explanation(analysis_row(data));
        if !text.is_empty() {
            result["review"]["reviewExplanations"][key] = json!(text);
        }
    }
    let material = project(cached, questions);
    result["analysesComplete"] = material["analysesComplete"].clone();
    result["studyMaterial"] = material;
    Some(result)
}
