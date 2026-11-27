//! A disposable, attempt-bound view of already verified evidence. No network,
//! database paths, cross-attempt lookup, or vector-model claims.
use crate::{
    AgentToolCall, AgentToolDefinition, AgentToolExecution, AgentToolExecutor, ApplicationError,
};
use async_trait::async_trait;
use ielts_db::ResolvedCoachContext;
use ielts_domain::{estimate_tokens, rendered_hash};
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{LazyLock, Mutex};

const RESULT_TOKENS: u32 = 1000;
static TAGS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]*>").unwrap());
static BREAKS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<br\s*/?>|</(?:p|div|li|h[1-6]|tr)>").unwrap());
static INPUT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)<input\b[^>]*\bname=["']([^"']+)["'][^>]*>"#).unwrap());
static SELECT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?i)<select\b[^>]*\bname=["']([^"']+)["'][^>]*>"#).unwrap());
static ENTITY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"&#(x[0-9a-fA-F]+|[0-9]+);").unwrap());
static QUESTION_REF: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(?:q(?:uestion)?\s*([0-9]{1,3})|第\s*([0-9]{1,3})\s*题)").unwrap()
});

/// Keep at most two whole recent exchanges, leaving room for new evidence.
/// The persisted conversation is unchanged; failed answers never become history.
pub(super) fn recent_history(history: &[ielts_db::CoachMessage]) -> Vec<ielts_db::CoachMessage> {
    let turns: Vec<_> = history.iter().filter(|m| {
        m.status == "completed" && matches!(m.role.as_str(), "user" | "assistant")
    }).collect();
    let rounds = super::rounds(&turns);
    let mut start = turns.len();
    let mut tokens = 0;
    for round in rounds.iter().rev().take(2) {
        if tokens + round.cost > 800 { break; }
        tokens += round.cost;
        start = round.first_turn;
    }
    if start < turns.len() { return turns[start..].iter().map(|m| (*m).clone()).collect(); }
    // Referential follow-ups still need their parent exchange. Preserve labelled
    // excerpts when that exchange alone is too long; never silently drop it all.
    let last_user = turns.iter().rposition(|m| m.role == "user").unwrap_or(turns.len());
    turns[last_user..].iter().take(2).map(|m| {
        let mut message = (*m).clone();
        if estimate_tokens(&message.content) > 320 {
            let mut chars: Vec<_> = message.content.chars().collect();
            while estimate_tokens(&chars.iter().collect::<String>()) > 280 { chars.truncate(chars.len()*3/4); }
            message.content = format!("[Prior message excerpt; remaining text omitted to bound context. Do not assume omitted details.] {}", chars.iter().collect::<String>());
        }
        message
    }).collect()
}

fn text(html: &str) -> String {
    let inputs = INPUT.replace_all(html, " [$1] ");
    let selects = SELECT.replace_all(&inputs, " [$1 options: ");
    let selects = selects
        .replace("</select>", "]")
        .replace("</option>", " | ");
    let lines = BREAKS.replace_all(&selects, "\n");
    let plain = TAGS.replace_all(&lines, " ");
    let decoded = ENTITY.replace_all(&plain, |c: &regex::Captures<'_>| {
        let raw = &c[1];
        let code = raw
            .strip_prefix('x')
            .and_then(|v| u32::from_str_radix(v, 16).ok())
            .or_else(|| raw.parse().ok());
        code.and_then(char::from_u32)
            .map(|v| v.to_string())
            .unwrap_or_else(|| c[0].to_string())
    });
    decoded
        .replace("&nbsp;", " ")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn answered(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(s) => !s.trim().is_empty(),
        Value::Array(a) => a.iter().any(answered),
        Value::Object(o) => o.values().any(answered),
        _ => true,
    }
}

#[derive(Clone)]
struct Chunk {
    id: String,
    block: String,
    text: String,
}

pub(super) struct EvidenceTools {
    identity: Value,
    source: Value,
    answers: Vec<Value>,
    chunks: Vec<Chunk>,
    delivered: Mutex<BTreeSet<String>>,
    round_used: Mutex<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Questions {
    question_ids: Vec<String>,
    #[serde(default)]
    page: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Search {
    query: String,
    #[serde(default)]
    block_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Read {
    block_id: String,
    #[serde(default)]
    offset: usize,
}

impl EvidenceTools {
    pub(super) fn new(context: &ResolvedCoachContext) -> Self {
        let source = context.evidence["source"].clone();
        let revision = rendered_hash(&context.evidence["identity"].to_string());
        let mut chunks = Vec::new();
        for (i, block) in source["passage"]["blocks"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            let block_id = format!("{}:b{}", &revision[..12], i + 1);
            let content = block["html"]
                .as_str()
                .or_else(|| block["bodyHtml"].as_str())
                .or_else(|| block["text"].as_str())
                .unwrap_or("");
            for (line_index, line) in text(content).lines().enumerate() {
                // Long paragraphs have explicit continuation chunks, never silently cut text.
                let chars: Vec<char> = line.chars().collect();
                for (segment, part) in chars.chunks(600).enumerate() {
                    chunks.push(Chunk {
                        id: format!("{block_id}:p{}:s{}", line_index + 1, segment + 1),
                        block: block_id.clone(),
                        text: part.iter().collect(),
                    });
                }
            }
        }
        Self {
            identity: context.evidence["identity"].clone(),
            source,
            answers: context.evidence["result"]["answers"]
                .as_array()
                .cloned()
                .unwrap_or_default(),
            chunks,
            delivered: Mutex::new(BTreeSet::new()),
            round_used: Mutex::new(false),
        }
    }

    pub(super) fn begin_round(&self) {
        *self.round_used.lock().unwrap_or_else(|p| p.into_inner()) = false;
    }

    fn blocks(&self) -> Vec<Value> {
        self.source["passage"]["blocks"].as_array().into_iter().flatten().enumerate().map(|(i,b)| {
            let prefix = format!("{}:b{}", &rendered_hash(&self.identity.to_string())[..12], i+1);
            json!({"blockId":prefix,"sourceBlockId":b["blockId"],"chunkCount":self.chunks.iter().filter(|c| c.block==prefix).count()})
        }).collect()
    }

    fn questions(&self, ids: &[String], page: usize) -> Result<Value, String> {
        if ids.is_empty() || ids.len() > 3 {
            return Err("request 1 to 3 question IDs".into());
        }
        if ids
            .iter()
            .any(|id| !self.answers.iter().any(|a| a["questionId"] == *id))
        {
            return Err("unknown question in this attempt".into());
        }
        let groups: Vec<Value> = self.source["questionGroups"].as_array().into_iter().flatten()
            .filter(|g| g["questionIds"].as_array().is_some_and(|a| a.iter().any(|id| ids.iter().any(|v| id==v))))
            .map(|g| json!({"groupId":g["groupId"],"kind":g["kind"],"section":g["section"],
                "questionIds":g["questionIds"],"instructions":text(g["leadHtml"].as_str().unwrap_or("")),
                "questions":text(g["bodyHtml"].as_str().unwrap_or("")),"options":g["options"]})).collect();
        let answers: Vec<Value> = self.answers.iter().filter(|a| ids.iter().any(|id| a["questionId"]==*id))
            .map(|a| json!({"questionId":a["questionId"],"displayNumber":self.source["questionDisplayMap"][a["questionId"].as_str().unwrap_or("")],
                "answer":a["answer"],"correctAnswer":a["correctAnswer"],"isCorrect":a["isCorrect"],"answered":answered(&a["answer"])})).collect();
        let explanations: serde_json::Map<String, Value> = ids
            .iter()
            .filter_map(|id| {
                self.source["reviewExplanations"]
                    .get(id)
                    .map(|v| (id.clone(), v.clone()))
            })
            .collect();
        let locations: serde_json::Map<String, Value> = ids
            .iter()
            .filter_map(|id| {
                self.source["answerLocations"]
                    .get(id)
                    .map(|v| (id.clone(), v.clone()))
            })
            .collect();
        let mut result = json!({"identity":self.identity,"groups":groups,"answers":answers,"officialExplanations":explanations,"answerLocations":locations});
        if estimate_tokens(&result.to_string()) > RESULT_TOKENS {
            // Large shared tables/option groups remain readable through explicit
            // pages. Never pretend a fragment is the complete question group.
            let body = groups
                .iter()
                .map(|g| {
                    format!(
                        "Group {} / {}\n{}\n{}\nOptions: {}",
                        g["groupId"],
                        g["kind"],
                        g["instructions"].as_str().unwrap_or(""),
                        g["questions"].as_str().unwrap_or(""),
                        g["options"]
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            let body = format!(
                "{body}\nOfficial explanations: {}\nAnswer locations: {}",
                json!(explanations),
                json!(locations)
            );
            let chars: Vec<_> = body.chars().collect();
            let pages: Vec<_> = chars.chunks(600).collect();
            let content = pages
                .get(page)
                .ok_or("unknown question page")?
                .iter()
                .collect::<String>();
            result = json!({"identity":self.identity,"answers":answers,"groups":groups.iter().map(|g|json!({"groupId":g["groupId"],"section":g["section"],"questionIds":g["questionIds"],"kind":g["kind"]})).collect::<Vec<_>>(),
                "questionPage":{"page":page,"text":content,"nextPage":if page+1<pages.len(){Some(page+1)}else{None},"totalPages":pages.len(),"coverage":"partial; read subsequent pages before interpreting omitted options"}});
        } else if page != 0 {
            return Err("unknown question page".into());
        }
        Ok(result)
    }

    fn rank(&self, query: &str, block: Option<&str>) -> Vec<&Chunk> {
        let terms: BTreeSet<String> = query
            .split(|c: char| !c.is_alphanumeric())
            .map(str::to_lowercase)
            .filter(|s| {
                s.len() > 2
                    && ![
                        "the", "and", "for", "was", "were", "with", "that", "from", "this",
                        "their", "they", "question", "answer", "null", "true", "false",
                    ]
                    .contains(&s.as_str())
            })
            .collect();
        let mut ranked: Vec<_> = self
            .chunks
            .iter()
            .filter(|c| block.is_none_or(|b| c.block == b))
            .map(|c| {
                let lower = c.text.to_lowercase();
                let score = terms.iter().filter(|t| lower.contains(t.as_str())).count();
                (score, c)
            })
            .filter(|(score, _)| *score > 0)
            .collect();
        ranked.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.id.cmp(&b.1.id)));
        ranked.into_iter().map(|(_, c)| c).collect()
    }

    /// Best passage chunks for `ids`. Ranked on the requested items only, not on
    /// all neighbouring items in a shared group: their keywords otherwise drown
    /// out the actual question.
    fn seed_for(&self, query: &str, ids: &[String], questions: &Value, blocks: &[Value], take: usize) -> Vec<&Chunk> {
        let focused_lines: Vec<_> = questions["groups"].as_array().into_iter().flatten()
            .filter_map(|g| g["questions"].as_str())
            .flat_map(|body| {
                let lines: Vec<_> = body.lines().collect();
                let mut selected = BTreeSet::new();
                for (i,line) in lines.iter().enumerate() {
                    if line.split('[').skip(1).filter_map(|s|s.split([' ',']']).next())
                        .any(|name|name.split('_').any(|id|ids.iter().any(|f|f==id))) {
                        if i>0 && line.trim_start().starts_with('[') { selected.insert(i-1); }
                        selected.insert(i);
                    }
                }
                selected.into_iter().map(|i|lines[i]).collect::<Vec<_>>()
            })
            .collect();
        let seed_query = format!("{query} {} {}", focused_lines.join(" "), questions["answers"]);
        let section = questions["groups"]
            .as_array()
            .and_then(|g| g.first())
            .and_then(|g| g["section"].as_u64());
        let block = section
            .and_then(|n| blocks.get(n.saturating_sub(1) as usize))
            .and_then(|b| b["blockId"].as_str());
        self.rank(&seed_query, block).into_iter().take(take).collect()
    }

    /// A review judges up to three questions at once, so each one brings its own
    /// best chunk (its own group's section, its own statement). Pooling them into
    /// one ranking left some focus questions with no passage text at all, which
    /// forced the model to plan tool calls round by round just to read a quote.
    fn review_seed(&self, query: &str, focus: &[String], blocks: &[Value]) -> Vec<&Chunk> {
        let mut picked: Vec<&Chunk> = Vec::new();
        for id in focus {
            let Ok(questions) = self.questions(std::slice::from_ref(id), 0) else { continue };
            let ranked = self.seed_for(query, std::slice::from_ref(id), &questions, blocks, picked.len() + 1);
            if let Some(chunk) = ranked.into_iter().find(|c| !picked.iter().any(|p| p.id == c.id)) {
                picked.push(chunk);
            }
        }
        picked
    }

    fn passages(&self, chunks: Vec<&Chunk>, mut more: Value) -> Value {
        let mut delivered = self.delivered.lock().unwrap_or_else(|p| p.into_inner());
        let mut rows = Vec::new();
        let mut used = estimate_tokens(&self.identity.to_string()) + 160;
        for c in &chunks {
            let row = if delivered.contains(&c.id) {
                json!({"chunkId":c.id,"alreadyProvided":true})
            } else {
                json!({"chunkId":c.id,"blockId":c.block,"text":c.text})
            };
            let cost = estimate_tokens(&row.to_string());
            if used + cost > RESULT_TOKENS {
                break;
            }
            used += cost;
            rows.push(row);
        }
        if rows.len() < chunks.len() {
            let next = chunks[rows.len()];
            let offset = self
                .chunks
                .iter()
                .filter(|c| c.block == next.block)
                .position(|c| c.id == next.id)
                .unwrap_or(0);
            more = json!({"blockId":next.block,"nextOffset":offset,"limitedByBudget":true});
        }
        delivered.extend(chunks.iter().take(rows.len()).map(|c| c.id.clone()));
        json!({"identity":self.identity,"chunks":rows,"coverage":"partial; search misses do not establish Not Given", "continuation":more})
    }

    pub(super) fn project(
        &self,
        context: &ResolvedCoachContext,
        query: &str,
    ) -> Result<ResolvedCoachContext, ApplicationError> {
        let mut next = context.clone();
        let is_review = context.message_metadata["action"] == "review_set";
        let explicit: BTreeSet<String> = if context.message_metadata["action"] == "chat" {
            QUESTION_REF.captures_iter(query)
                .filter(|c| {
                    let m = c.get(0).unwrap();
                    let ascii_word = |ch: char| ch.is_ascii_alphanumeric() || ch == '_';
                    !query[..m.start()].chars().next_back().is_some_and(ascii_word)
                        && !query[m.end()..].chars().next().is_some_and(ascii_word)
                })
                .filter_map(|c| c.get(1).or_else(|| c.get(2)))
                .filter_map(|n| n.as_str().parse::<u32>().ok())
                .map(|n| n.to_string()).collect()
        } else { BTreeSet::new() };
        let review = is_review.then(|| super::review::analyse(&self.answers, &self.source["questionDisplayMap"], answered));
        let focus: Vec<String> = if let Some(review) = &review {
            review.focus.clone()
        } else if !explicit.is_empty() {
            explicit.iter().filter_map(|label| {
                let mut matches = self.answers.iter().filter_map(|a| a["questionId"].as_str())
                    .filter(|id| self.source["questionDisplayMap"][*id] == *label);
                let first = matches.next()?;
                matches.next().is_none().then(|| first.to_owned())
            }).take(3).collect()
        } else {
            context.message_metadata["focusQuestionIds"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .take(3)
                .collect()
        };
        let mut summary = context.evidence["result"].clone();
        summary.as_object_mut().unwrap().remove("answers");
        let completed = self
            .answers
            .iter()
            .filter(|a| answered(&a["answer"]))
            .count();
        summary["answeredCount"] = json!(completed);
        summary["unansweredCount"] = json!(self.answers.len() - completed);
        let mut kinds: BTreeMap<String, Value> = BTreeMap::new();
        for a in &self.answers {
            let item = kinds
                .entry(a["questionKind"].as_str().unwrap_or("unknown").into())
                .or_insert(json!({"answered":0,"unanswered":0,"correct":0}));
            let key = if answered(&a["answer"]) {
                "answered"
            } else {
                "unanswered"
            };
            item[key] = json!(item[key].as_u64().unwrap() + 1);
            if a["isCorrect"] == true {
                item["correct"] = json!(item["correct"].as_u64().unwrap() + 1);
            }
        }
        summary["byQuestionKind"] = json!(kinds);
        if let Some(review) = &review {
            summary["reviewSignals"] = review.signals.clone();
        }
        summary["questionIndexColumns"] = json!(["id","label","answered","correct"]);
        summary["questionIndex"] = json!(self
            .answers
            .iter()
            .map(|a| json!([a["questionId"],
            self.source["questionDisplayMap"][a["questionId"].as_str().unwrap_or("")],
            answered(&a["answer"]),a["isCorrect"]]))
            .collect::<Vec<_>>());
        let questions = if focus.is_empty() {
            Value::Null
        } else {
            self.questions(&focus, 0)
                .map_err(|e| ApplicationError::new("coach.evidence_budget", e, false))?
        };
        let blocks = self.blocks();
        let seed = if focus.is_empty() {
            Vec::new()
        } else if is_review {
            self.review_seed(query, &focus, &blocks)
        } else {
            self.seed_for(query, &focus, &questions, &blocks, 2)
        };
        next.evidence = json!({"identity":self.identity,"result":summary,"focus":questions,
            "source":{"blocks":blocks,"initialEvidence":self.passages(seed,Value::Null)},
            "evidenceLimitations":context.evidence["evidenceLimitations"],
            "retrievalPolicy":"Only supplied chunks are evidence. Blank answers do not diagnose a skill weakness. Use tools to resolve missing context; never infer absence from a search miss."});
        next.request["controls"]["focusQuestionIds"] = json!(focus);
        if is_review {
            next.request["reviewContract"] = json!(super::review::CONTRACT);
        }
        next.message_metadata["focusQuestionIds"] = json!(focus);
        if !explicit.is_empty() {
            next.request["explicitQuestionLabels"] = json!(explicit);
            next.request["focusResolution"] = json!("Only matched labels from this attempt are supplied, up to 3; use question tools for additional labels. Unmatched labels are not evidence.");
        }
        Ok(next)
    }
}

#[async_trait]
impl AgentToolExecutor for EvidenceTools {
    fn definitions(&self) -> Vec<AgentToolDefinition> {
        [("get_question_evidence","Read 1-3 question IDs from this attempt, question groups and official answers. Large groups return nextPage; request that page to continue.",json!({"questionIds":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":3},"page":{"type":"integer","minimum":0}}),vec!["questionIds"]),
         ("search_passage_evidence","Search only this attempt's source using English keywords/paraphrases. Returns up to three exact chunks; search misses never prove Not Given.",json!({"query":{"type":"string","minLength":1,"maxLength":240},"blockId":{"type":"string"}}),vec!["query"]),
         ("read_passage_blocks","Read up to three consecutive chunks of a listed block. Use offset/nextOffset to inspect context or check claims of absence.",json!({"blockId":{"type":"string"},"offset":{"type":"integer","minimum":0}}),vec!["blockId"])]
            .into_iter().map(|(n,d,p,r)|AgentToolDefinition{name:n.into(),description:d.into(),parameters:json!({"type":"object","properties":p,"required":r,"additionalProperties":false})}).collect()
    }
    fn audit_arguments(&self, call: &AgentToolCall) -> Value {
        json!({"argumentsHash":rendered_hash(&call.arguments_json),"assetFingerprint":self.identity["assetFingerprint"]})
    }
    async fn execute(&self, call: &AgentToolCall) -> AgentToolExecution {
        {
            let mut used = self.round_used.lock().unwrap_or_else(|p| p.into_inner());
            if *used {
                return AgentToolExecution::rejected("coach.evidence_round_limit", "Use one tool per round; additional retrieval was not performed.", json!({"roundLimited":true}));
            }
            *used = true;
        }
        let result = (|| -> Result<Value, String> {
            if call.arguments_json.len() > 2048 {
                return Err("arguments too large".into());
            }
            match call.name.as_str() {
                "get_question_evidence" => {
                    let args: Questions =
                        serde_json::from_str(&call.arguments_json).map_err(|e| e.to_string())?;
                    self.questions(&args.question_ids, args.page)
                }
                "search_passage_evidence" => {
                    let args: Search =
                        serde_json::from_str(&call.arguments_json).map_err(|e| e.to_string())?;
                    if args.query.trim().is_empty() || args.query.chars().count() > 240 {
                        return Err("query must be 1-240 characters".into());
                    }
                    if args
                        .block_id
                        .as_ref()
                        .is_some_and(|b| !self.chunks.iter().any(|c| c.block == *b))
                    {
                        return Err("unknown block for this attempt".into());
                    }
                    Ok(self.passages(
                        self.rank(&args.query, args.block_id.as_deref())
                            .into_iter()
                            .take(3)
                            .collect(),
                        json!({"searchComplete":false}),
                    ))
                }
                "read_passage_blocks" => {
                    let args: Read =
                        serde_json::from_str(&call.arguments_json).map_err(|e| e.to_string())?;
                    let all: Vec<_> = self
                        .chunks
                        .iter()
                        .filter(|c| c.block == args.block_id)
                        .collect();
                    if all.is_empty() || args.offset >= all.len() {
                        return Err("unknown block or offset".into());
                    }
                    let end = (args.offset + 3).min(all.len());
                    Ok(self.passages(all[args.offset..end].to_vec(),json!({"blockId":args.block_id,"nextOffset":if end<all.len(){Some(end)}else{None},"totalChunks":all.len()})))
                }
                _ => Err("unknown evidence tool".into()),
            }
        })();
        match result {
            Ok(value) if estimate_tokens(&value.to_string()) <= RESULT_TOKENS => {
                AgentToolExecution::succeeded(
                    value.to_string(),
                    json!({"resultHash":rendered_hash(&value.to_string()),"estimatedTokens":estimate_tokens(&value.to_string())}),
                )
            }
            Ok(_) => AgentToolExecution::rejected(
                "coach.evidence_budget",
                "evidence exceeds per-tool budget; narrow the query",
                json!({"overBudget":true}),
            ),
            Err(_) => AgentToolExecution::rejected(
                "coach.evidence_selector",
                "invalid tool or selector for this attempt; use listed question/block IDs",
                json!({"invalid":true}),
            ),
        }
    }
}

#[cfg(test)]
#[path = "../../../../developer/tests/rust/coach_evidence.rs"]
mod tests;
