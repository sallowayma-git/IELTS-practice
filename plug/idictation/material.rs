//! Pure article / Reader conversion. Authorization and persistence stay in the
//! provider service. Material has no exam questions, answer key or local score.
use super::vocabulary::id;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[path = "material_timing.rs"]
mod timing;

#[derive(Debug)]
pub struct Material {
    pub payload: Value,
    pub fingerprint: String,
}

fn rows<'a>(value: &'a Value, key: &str) -> Result<&'a [Value], String> {
    value[key]
        .as_array()
        .map(Vec::as_slice)
        .ok_or_else(|| format!("爱听写材料缺少 {key}"))
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}

fn pick(value: &Value, fields: &[&str]) -> Value {
    Value::Object(
        fields
            .iter()
            .filter_map(|key| value.get(*key).map(|v| ((*key).into(), v.clone())))
            .collect(),
    )
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Only media origins observed in normal playback. No fetching or redirects.
pub(super) fn media_url(value: &str) -> Option<String> {
    let url = tauri::Url::parse(value).ok()?;
    let allowed = [
        "idictation-article.oss-cn-beijing.aliyuncs.com",
        "lbxl-audio.oss-cn-beijing.aliyuncs.com",
        "itx-jingting.oss-cn-beijing.aliyuncs.com",
        "audio-1-cdn.idictation.cn",
    ];
    if url.scheme() != "https"
        || !allowed.contains(&url.host_str()?)
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    Some(url.into())
}

fn complete(
    kind: &str,
    title: &str,
    source: Value,
    parts: Vec<Value>,
    blocks: Vec<Value>,
    media: Vec<Value>,
) -> Material {
    // Source content has no URLs, account state, annotations or practice rounds.
    // The transient media list can change without invalidating text anchors.
    let fingerprint = hex::encode(Sha256::digest(serde_json::to_vec(&source).unwrap()));
    Material {
        fingerprint,
        payload: json!({
            "schemaVersion":1,"practiceKind":"material","materialKind":kind,
            "meta":{"title":title,"category":"爱听写"},
            "capabilities":{"localDraft":false,"localScoring":false,"remoteSubmit":false,"review":false},
            "passage":{"blocks":blocks},"questionGroups":[],"questionOrder":[],
            "questionCount":0,"answerKey":{},"idictation":source,
            "studyMaterial":{"version":1,"parts":parts,"questions":{},"media":media}
        }),
    }
}

fn article_audio(row: &Value, sentence_id: &str) -> Option<Value> {
    // The source picks the first present URL, not the first allowed URL. If it
    // deploys a new host, do not silently switch to a different recording.
    let (field, kind) = [
        ("split_audio_url_new", "clip"),
        ("split_audio_url", "clip"),
        ("phonetic", "track"),
    ]
    .into_iter()
    .find(|(field, _)| !text(row, field).is_empty())?;
    let url = media_url(text(row, field))?;
    // Original whole-sentence playback divides raw times by 1000. The Zt
    // heuristic is only used by word alignment, never by this playback path.
    let (start, end) = timing::playback(row).ok()?;
    Some(
        json!({"id":format!("{sentence_id}-audio"),"url":url,"kind":kind,
        "startSeconds":if kind=="clip" {0.0} else {start},
        "endSeconds":if kind=="clip" {None} else {Some(end)}}),
    )
}

fn article_sentence(
    row: &Value,
    mode: &str,
    index: usize,
) -> Result<(Value, Option<Value>, Value), String> {
    let source_id = id(&row["id"])?;
    let sentence_id = format!("idictation-article-{mode}-{source_id}");
    if text(row, "content").trim().is_empty() {
        return Err("精听句子缺少原文".into());
    }
    let (start, end) = timing::playback(row)?;
    let (alignment_start, alignment_end) = timing::alignment_sentence(row)?;
    let audio = article_audio(row, &sentence_id);
    let sentence = json!({"id":sentence_id,"index":index,"text":text(row,"content"),
        "translation":text(row,"translate"),"grammarAnalysis":row["grammar_analysis"],
        "startSeconds":start,"endSeconds":end,"words":timing::words(row,alignment_start,alignment_end),
        "alignmentRange":{"startSeconds":alignment_start,"endSeconds":alignment_end},
        "audio":audio.as_ref().map(|a|json!({"mediaId":a["id"],"kind":a["kind"],
            "startSeconds":a["startSeconds"],"endSeconds":a["endSeconds"]}))});
    let source = pick(
        row,
        &[
            "id",
            "g_id",
            "c_id",
            "ac_id",
            "content",
            "translate",
            "grammar_analysis",
            "start_time",
            "end_time",
            "end_time_new",
            "subtitle_alignment_details",
            "long_article_id",
            "short_article_ids",
            "is_answer_sentence",
            "cloze_details",
        ],
    );
    // Row g_id/c_id may differ from the request and canonical chapter, as in
    // the observed shared-content chapter. Preserve them, do not rewrite them.
    id(&row["g_id"])?;
    id(&row["c_id"])?;
    Ok((sentence, audio, source))
}

pub fn article(
    chapter_id: &str,
    mode: &str,
    title: &str,
    response: &Value,
) -> Result<Material, String> {
    id(&json!(chapter_id))?;
    if !matches!(mode, "short" | "long") || text(response, "sentence_mode") != mode {
        return Err("精听切句模式与请求不一致".into());
    }
    let data = rows(response, "data")?;
    if data.is_empty() || data.len() > 9999 || response["total"].as_u64() != Some(data.len() as u64)
    {
        return Err("精听章节未完整返回".into());
    }
    let canonical_book = id(&response["canonical_g_id"])?;
    let canonical_chapter = id(&response["canonical_c_id"])?;
    let mut seen = HashSet::new();
    let mut sentences = Vec::new();
    let mut media = Vec::new();
    let mut sources = Vec::new();
    for (index, row) in data.iter().enumerate() {
        let (sentence, audio, source) = article_sentence(row, mode, index)?;
        if !seen.insert(sentence["id"].as_str().unwrap().to_owned()) {
            return Err("精听句子ID重复".into());
        }
        sentences.push(sentence);
        media.extend(audio);
        sources.push(source);
    }
    let part = json!({"id":format!("idictation-article-{chapter_id}-{mode}"),"section":1,"title":title,
        "paragraphs":[{"id":format!("idictation-article-{chapter_id}-{mode}-text"),"sentences":sentences}]});
    let source = json!({"kind":"article","chapterId":chapter_id,"sentenceMode":mode,
        "canonicalBookId":canonical_book,"canonicalChapterId":canonical_chapter,"sentences":sources});
    Ok(complete(
        "article",
        title,
        source,
        vec![part],
        vec![],
        media,
    ))
}

pub(super) const COLLECTION_PAGE_SIZE: u64 = 50;

pub(super) fn article_collection(owner: &str, page: u64, response: &Value) -> Result<Material, String> {
    let title = "爱听写精听收藏";
    if !(1..=10_000).contains(&page) { return Err("精听收藏页码无效".into()); }
    let total = response["total"].as_u64().filter(|total| *total <= 500_000)
        .ok_or("精听收藏总数无效")?;
    let pages = total.div_ceil(COLLECTION_PAGE_SIZE).max(1);
    let expected = total.saturating_sub((page - 1) * COLLECTION_PAGE_SIZE).min(COLLECTION_PAGE_SIZE);
    let data = rows(response, "data")?;
    if response["current_page"].as_u64() != Some(page)
        || response["per_page"].as_u64() != Some(COLLECTION_PAGE_SIZE)
        || response["last_page"].as_u64() != Some(pages)
        || page > pages
        || data.len() as u64 != expected {
        return Err("精听收藏页未完整返回，请重新打开收藏列表".into());
    }
    let mut seen = HashSet::new();
    let mut sentences = Vec::new();
    let mut media = Vec::new();
    let mut source_rows = Vec::new();
    for row in data {
        let collection_id = id(&row["id"])?;
        if id(&row["user_id"])? != owner || !seen.insert(collection_id.clone()) {
            return Err("精听收藏账号或记录身份不一致".into());
        }
        let content = &row["article_content"];
        if content.is_null() {
            continue;
        }
        let article_id = id(&content["id"])?;
        // A collection ID identifies one row; a source article may be
        // collected in more than one context. Keep both IDs distinct.
        let sentence_id = format!("idictation-collection-{collection_id}");
        let original = text(content, "content").trim();
        if original.is_empty() || original.len() > 32_768 {
            return Err("精听收藏缺少可用原文".into());
        }
        let translation = text(content, "translate");
        if translation.len() > 32_768 { return Err("精听收藏译文过长".into()); }
        let audio = article_audio(content, &sentence_id);
        sentences.push(json!({
            "id":sentence_id, "index":sentences.len(), "text":original, "translation":translation,
            "words":[], "audio": audio.as_ref().map(|track| json!({
                "mediaId":track["id"], "kind":track["kind"],
                "startSeconds":track["startSeconds"], "endSeconds":track["endSeconds"]
            }))
        }));
        media.extend(audio);
        source_rows.push(json!([collection_id,article_id,original,translation]));
    }
    let unavailable = data.len() - sentences.len();
    let part = json!({"id":"article-collection","section":1,"title":title,
        "paragraphs":[{"id":"collected-sentences","sentences":sentences}]});
    let source = json!({"kind":"articleCollection","page":page,"total":total,"sentences":source_rows});
    let mut result = complete("article", title, source, vec![part], vec![], media);
    result.payload["collectionPage"] = json!({"page":page,"pages":pages,"total":total,"unavailable":unavailable});
    Ok(result)
}

/// Convert JS UTF-16 code-unit offsets without trimming or normalizing text.
pub(super) fn utf16_bytes(value: &str, offset: u64) -> Result<usize, String> {
    let mut units = 0;
    for (byte, ch) in value.char_indices() {
        if units == offset {
            return Ok(byte);
        }
        units += ch.len_utf16() as u64;
        if units > offset {
            return Err("精读句子偏移切断了Unicode字符".into());
        }
    }
    if units == offset {
        Ok(value.len())
    } else {
        Err("精读句子偏移超出正文".into())
    }
}

fn offset(row: &Value, field: &str) -> Result<u64, String> {
    row[field]
        .as_u64()
        .ok_or_else(|| "精读句子缺少有效偏移".into())
}

fn reader_block(
    block: &Value,
    document: &str,
    version: &str,
) -> Result<(Value, Value, Value), String> {
    let block_id = id(&block["id"])?;
    if id(&block["document_version_id"])? != version {
        return Err("精读块版本不匹配".into());
    }
    let key = text(block, "block_key");
    if key.is_empty() || key.len() > 256 {
        return Err("精读块标识无效".into());
    }
    let original = block["text"].as_str().ok_or("精读块缺少正文")?;
    if !matches!(text(block, "type"), "heading" | "paragraph") {
        return Err("精读包含尚未适配的块类型，无法保证内容完整".into());
    }
    let mut ordered = rows(block, "sentences")?.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|s| s["start_offset"].as_u64());
    let mut sentences = Vec::new();
    let mut source_sentences = Vec::new();
    let mut html = String::new();
    let mut cursor = 0;
    for row in ordered {
        if id(&row["document_version_id"])? != version || id(&row["block_id"])? != block_id {
            return Err("精读句子版本或块归属不匹配".into());
        }
        let sid = id(&row["id"])?;
        let start = utf16_bytes(original, offset(row, "start_offset")?)?;
        let end = utf16_bytes(original, offset(row, "end_offset")?)?;
        if start < cursor || end <= start {
            return Err("精读句子偏移重叠或倒置".into());
        }
        let sentence_id = format!("idictation-reader-{document}-v{version}-s{sid}");
        html.push_str(&escape(&original[cursor..start]));
        html.push_str(&format!(
            "<span data-study-sentence=\"{sentence_id}\">{}</span>",
            escape(&original[start..end])
        ));
        cursor = end;
        sentences.push(json!({"id":sentence_id,"index":sentences.len(),"text":&original[start..end],
            "translation":text(row,"translation"),"grammarAnalysis":row["grammar_analysis"],"words":[]}));
        source_sentences.push(pick(
            row,
            &[
                "id",
                "document_version_id",
                "block_id",
                "sentence_key",
                "sort",
                "start_offset",
                "end_offset",
                "translation",
                "grammar_analysis",
                "cues",
            ],
        ));
    }
    html.push_str(&escape(&original[cursor..]));
    let tag = if text(block, "type") == "heading" {
        "h2"
    } else {
        "p"
    };
    let label = if text(block, "label").is_empty() {
        String::new()
    } else {
        format!(
            "<div class=\"reader-block-label\">{}</div>",
            escape(text(block, "label"))
        )
    };
    let block_html=format!("{label}<{tag} data-reader-text data-block-key=\"{}\" style=\"white-space:pre-wrap\">{html}</{tag}>",escape(key));
    let mut source = pick(
        block,
        &[
            "id",
            "document_version_id",
            "block_key",
            "type",
            "sort",
            "label",
            "text",
        ],
    );
    source["sentences"] = json!(source_sentences);
    Ok((
        json!({"blockId":key,"html":block_html}),
        json!({"id":key,"sentences":sentences}),
        source,
    ))
}

pub fn reader(document_id: &str, response: &Value) -> Result<Material, String> {
    if id(&response["document"]["id"])? != document_id
        || id(&response["version"]["document_id"])? != document_id
    {
        return Err("精读文档身份与请求不匹配".into());
    }
    let version = id(&response["version"]["id"])?;
    let data = rows(response, "blocks")?;
    if data.is_empty() || data.len() > 10000 {
        return Err("精读正文为空或过大".into());
    }
    // Reader renders blocks in response order, regardless of the sort field.
    let mut seen_blocks = HashSet::new();
    let mut seen_sentences = HashSet::new();
    let mut blocks = Vec::new();
    let mut paragraphs = Vec::new();
    let mut sources = Vec::new();
    for block in data {
        let (rendered, paragraph, source) = reader_block(block, document_id, &version)?;
        if !seen_blocks.insert(rendered["blockId"].as_str().unwrap().to_owned()) {
            return Err("精读块标识重复".into());
        }
        for sentence in rows(&paragraph, "sentences")? {
            if !seen_sentences.insert(sentence["id"].as_str().unwrap().to_owned()) {
                return Err("精读句子ID重复".into());
            }
        }
        blocks.push(rendered);
        paragraphs.push(paragraph);
        sources.push(source);
    }
    if response["version"]["sentence_count"].as_u64() != Some(seen_sentences.len() as u64) {
        return Err("精读文档句子未完整返回".into());
    }
    // This sample has no media. Preserve explicit source cues but never invent
    // another provider's audio track. Each future cue binds a validated media ID.
    let mut media = Vec::new();
    for row in rows(response, "media")? {
        if let Some(url) = media_url(text(row, "url")) {
            media.push(json!({"id":id(&row["id"])?,"kind":row["kind"],"url":url}));
        }
    }
    let title = text(&response["version"], "title");
    let source = json!({"kind":"reader","document":pick(&response["document"],&["id","provider","subject",
        "source_type","source_id","book_number","test_number","part_number","track"]),
        "version":pick(&response["version"],&["id","document_id","version_no","title","language",
            "word_count","reading_seconds","sentence_count","content_hash","formatter_version"]),"blocks":sources});
    let part = json!({"id":format!("idictation-reader-{document_id}-v{version}"),"section":1,
        "title":title,"paragraphs":paragraphs});
    Ok(complete("reader", title, source, vec![part], blocks, media))
}

#[cfg(test)]
#[path = "../../developer/tests/rust/idictation_material.rs"]
mod tests;
