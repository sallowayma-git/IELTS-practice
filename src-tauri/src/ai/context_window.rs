//! Per-model context windows and output ceilings, and the pre-send budget the
//! gateway checks before any HTTP call.
//!
//! The window table is advisory knowledge about public model cards, not a
//! provider query. Where the published figure varies by release or was not
//! checked, the smaller value is used and the row is marked `UNSURE`. A wrong
//! small value refuses a prompt the provider would have accepted; a wrong
//! large value lets an oversized prompt through to fail at the provider. The
//! first is the safer error, so the table leans small.
use ielts_application::{AgentMessage, AgentToolDefinition, ChatMessage, ModelError};
use ielts_domain::estimate_tokens;

/// Smallest output room worth sending. Below this the request is refused
/// instead of clamped to a ceiling too small to hold an answer.
pub(crate) const MIN_CLAMPED_OUTPUT: u32 = 256;

/// Framing cost per message (role and separators). Small on purpose: the
/// estimator is a chars/4 approximation and already covers the text itself.
const PER_MESSAGE_OVERHEAD: u32 = 4;

/// Used for model ids the table does not recognise. Smaller than most current
/// models on purpose, so an unknown model is never over-trusted.
const DEFAULT_WINDOW: u32 = 32_768;
const DEFAULT_MAX_OUTPUT: u32 = 4_096;

/// `(name pattern, context window, max output)`, in tokens.
///
/// Matching is on the model name after `model_name` (last `/` segment, no
/// `:variant` suffix, lowercase). A pattern matches the whole name or a prefix
/// that ends at a non-alphanumeric boundary, so `o1` matches `o1-mini` but not
/// `o1x`. The longest matching pattern wins, so specific rows sit under broad
/// fallbacks such as `qwen` or `gemini`.
const WINDOW_RULES: &[(&str, u32, u32)] = &[
    // OpenAI. gpt-4o and gpt-4o-mini: 128k context, 16,384 output. High confidence.
    ("gpt-4o", 128_000, 16_384),
    // gpt-4.1 family: 1,047,576 context, rounded down; 32,768 output. Medium-high.
    ("gpt-4.1", 1_000_000, 32_768),
    // gpt-5: published 400k total, of which 272k is input. The input figure is
    // used as the whole window. UNSURE, verify against the current model card.
    ("gpt-5", 272_000, 128_000),
    // o1 is 200k, but o1-mini and o1-preview are 128k. UNSURE: the smaller
    // figure is used for the family, so o1 full is under-claimed.
    ("o1", 128_000, 32_768),
    // o3 and o4 (including o3-mini, o4-mini): 200k context, 100k output. High.
    ("o3", 200_000, 100_000),
    ("o4", 200_000, 100_000),
    // DeepSeek. The API documents 128k context. chat: 8k output here (default
    // 4k). reasoner: up to 64k output, reasoning included. Medium.
    ("deepseek-chat", 128_000, 8_192),
    ("deepseek-reasoner", 128_000, 65_536),
    // Other DeepSeek ids (v3 and similar): the smaller historical window. UNSURE.
    ("deepseek", 64_000, 8_192),
    // Qwen. Windows differ by release and by DashScope tier. UNSURE throughout.
    ("qwen-max", 32_768, 8_192),
    ("qwen-plus", 131_072, 8_192),
    ("qwen-turbo", 131_072, 8_192),
    // Qwen3 is 32k native (131k with YaRN extension). Native figure used. UNSURE.
    ("qwen3", 32_768, 8_192),
    ("qwen", 32_768, 8_192),
    // Moonshot / Kimi. The moonshot-v1 sizes are in their names. Kimi K2 is 128k
    // (some later variants 256k). UNSURE for the generic Moonshot fallback.
    ("moonshot-v1-8k", 8_192, 4_096),
    ("moonshot-v1-32k", 32_768, 4_096),
    ("moonshot-v1-128k", 131_072, 4_096),
    ("moonshot", 8_192, 4_096),
    ("kimi-k2", 131_072, 8_192),
    ("kimi", 131_072, 8_192),
    // GLM (Zhipu). The GLM-4 line is 128k. Later GLM-4.6 is larger, so 128k is
    // the conservative figure. UNSURE.
    ("glm", 128_000, 8_192),
    // Claude through OpenRouter. Claude 2 and Instant are 100k. Claude 3 and 4
    // are 200k; the 1M beta is not assumed. Output 8k is the conservative
    // ceiling for the family. Medium.
    ("claude-2", 100_000, 4_096),
    ("claude-instant", 100_000, 4_096),
    ("claude", 200_000, 8_192),
    // Gemini through OpenRouter. Gemini 1.0 Pro is 32k. Gemini 1.5 Pro is 2M,
    // so the 1.5-named Pro id gets the smaller 1M figure. Gemini 2.x is about
    // 1,048,576, so 1M is used for the family. UNSURE on the exact numbers.
    ("gemini-1.0", 32_768, 8_192),
    ("gemini-pro-1.5", 1_000_000, 8_192),
    ("gemini-pro", 32_768, 8_192),
    ("gemini", 1_000_000, 8_192),
];

/// What the table knows about one model id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ModelWindow {
    pub window: u32,
    pub max_output: u32,
    /// False when the id matched no row and the default was used.
    pub matched: bool,
}

/// Lowercased model name with routing prefixes and `:variant` suffixes removed:
/// `openrouter/anthropic/claude-sonnet-4.5` and `deepseek/deepseek-chat:free`
/// both reduce to the bare model name.
fn model_name(model_id: &str) -> String {
    let lowered = model_id.trim().to_ascii_lowercase();
    let last_segment = lowered.rsplit('/').next().unwrap_or("");
    last_segment.split(':').next().unwrap_or("").to_string()
}

/// Whether `pattern` matches `name` as a whole name or as a prefix that ends at
/// a boundary. A pattern ending in a letter or digit must not be followed by
/// another letter or digit.
fn rule_matches(name: &str, pattern: &str) -> bool {
    let Some(rest) = name.strip_prefix(pattern) else {
        return false;
    };
    let ends_on_word = pattern.chars().last().is_some_and(|c| c.is_ascii_alphanumeric());
    rest.is_empty() || !ends_on_word || !rest.starts_with(|c: char| c.is_ascii_alphanumeric())
}

/// Window and output ceiling for a model id. Unknown ids get the conservative
/// default with `matched: false`.
pub(crate) fn model_window(model_id: &str) -> ModelWindow {
    let name = model_name(model_id);
    WINDOW_RULES
        .iter()
        .filter(|(pattern, _, _)| rule_matches(&name, pattern))
        .max_by_key(|(pattern, _, _)| pattern.len())
        .map_or(
            ModelWindow { window: DEFAULT_WINDOW, max_output: DEFAULT_MAX_OUTPUT, matched: false },
            |&(_, window, max_output)| ModelWindow { window, max_output, matched: true },
        )
}

/// The pre-send budget for one call: what the input is estimated to take and
/// what is left for the output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Budget {
    pub window: u32,
    /// The table's published output ceiling. Advisory only: the gateway does not
    /// clamp to it, so a wrong table row cannot cut a working answer short.
    pub max_output: u32,
    pub estimated_input: u32,
    /// `window - estimated_input`, floored at zero.
    pub output_room: u32,
    /// The output ceiling the caller asked for.
    pub requested: u32,
}

impl Budget {
    /// The decision for the request. `Ok(None)` sends the requested ceiling as
    /// it is. `Ok(Some(room))` clamps the ceiling to the room left after the
    /// input. `Err` is the typed, non-retryable refusal: the input does not
    /// leave the floor of output room, so nothing is sent.
    pub(crate) fn admit(&self) -> Result<Option<u32>, ModelError> {
        if self.requested <= self.output_room {
            return Ok(None);
        }
        if self.output_room >= MIN_CLAMPED_OUTPUT {
            return Ok(Some(self.output_room));
        }
        Err(ModelError::prompt_exceeds_context(
            self.estimated_input.saturating_add(self.requested),
            self.window,
        ))
    }
}

/// Budget for an already-estimated input size.
pub(crate) fn budget_for(model: &str, estimated_input: u32, max_tokens: u32) -> Budget {
    let known = model_window(model);
    Budget {
        window: known.window,
        max_output: known.max_output,
        estimated_input,
        output_room: known.window.saturating_sub(estimated_input),
        requested: max_tokens,
    }
}

/// Budget for a plain completion: `estimate_tokens` over every message's
/// content, plus a fixed overhead per message.
pub(crate) fn context_budget(model: &str, messages: &[ChatMessage], max_tokens: u32) -> Budget {
    let estimated_input = messages.iter().fold(0u32, |total, message| {
        total
            .saturating_add(PER_MESSAGE_OVERHEAD)
            .saturating_add(estimate_tokens(&message.content))
    });
    budget_for(model, estimated_input, max_tokens)
}

/// Input estimate for an agent request: every message (text, tool-call names and
/// arguments, tool results, and any reasoning echo that is sent back), plus the
/// tool definitions, which are also sent as input.
pub(crate) fn agent_input_tokens(messages: &[AgentMessage], tools: &[AgentToolDefinition]) -> u32 {
    let messages_total = messages.iter().fold(0u32, |total, message| {
        total
            .saturating_add(PER_MESSAGE_OVERHEAD)
            .saturating_add(agent_message_tokens(message))
    });
    let tools_total = tools.iter().fold(0u32, |total, tool| {
        total
            .saturating_add(PER_MESSAGE_OVERHEAD)
            .saturating_add(estimate_tokens(&tool.name))
            .saturating_add(estimate_tokens(&tool.description))
            .saturating_add(estimate_tokens(&tool.parameters.to_string()))
    });
    messages_total.saturating_add(tools_total)
}

fn agent_message_tokens(message: &AgentMessage) -> u32 {
    match message {
        AgentMessage::System { content } | AgentMessage::User { content } => estimate_tokens(content),
        AgentMessage::ToolResult { content, .. } => estimate_tokens(content),
        AgentMessage::Assistant { content, tool_calls, reasoning } => {
            let mut total = content.as_deref().map_or(0, estimate_tokens);
            for call in tool_calls {
                total = total
                    .saturating_add(estimate_tokens(&call.name))
                    .saturating_add(estimate_tokens(&call.arguments_json));
            }
            if let Some(echo) = reasoning {
                for value in echo.0.values() {
                    total = total.saturating_add(estimate_tokens(&value.to_string()));
                }
            }
            total
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ielts_application::{AgentToolCall, ReasoningEcho};
    use serde_json::json;

    fn window_of(model: &str) -> u32 {
        model_window(model).window
    }

    #[test]
    fn exact_model_ids_match_their_row() {
        assert_eq!(window_of("gpt-4o"), 128_000);
        assert_eq!(model_window("gpt-4o").max_output, 16_384);
        assert!(model_window("gpt-4o").matched);
        assert_eq!(window_of("deepseek-reasoner"), 128_000);
        assert_eq!(model_window("deepseek-reasoner").max_output, 65_536);
    }

    #[test]
    fn dated_and_suffixed_ids_match_by_prefix_at_a_boundary() {
        assert_eq!(window_of("gpt-4o-2024-08-06"), 128_000);
        assert_eq!(window_of("gpt-4.1-mini"), 1_000_000);
        assert_eq!(window_of("o1-mini"), 128_000);
        assert_eq!(window_of("o3-mini"), 200_000);
        // A letter directly after the pattern is a different name, not a prefix match.
        assert!(!model_window("gpt-4omni").matched);
        assert!(!model_window("o3x").matched);
    }

    #[test]
    fn longest_pattern_wins_over_a_broad_fallback() {
        assert_eq!(window_of("gemini-pro-1.5"), 1_000_000);
        assert_eq!(window_of("gemini-pro"), 32_768);
        assert_eq!(window_of("gemini-1.5-pro"), 1_000_000);
        assert_eq!(window_of("moonshot-v1-8k"), 8_192);
        assert_eq!(window_of("moonshot-v1-128k"), 131_072);
        assert_eq!(window_of("claude-2.1"), 100_000);
        assert_eq!(window_of("claude-3-5-sonnet-20241022"), 200_000);
        assert_eq!(window_of("deepseek-chat"), 128_000);
        assert_eq!(window_of("deepseek-v3"), 64_000);
    }

    #[test]
    fn provider_prefixed_ids_reduce_to_the_bare_model_name() {
        assert_eq!(window_of("openrouter/anthropic/claude-sonnet-4.5"), 200_000);
        assert_eq!(window_of("anthropic/claude-3.5-haiku"), 200_000);
        assert_eq!(window_of("deepseek/deepseek-chat"), 128_000);
        assert_eq!(model_window("deepseek/deepseek-chat").max_output, 8_192);
        assert_eq!(window_of("deepseek/deepseek-chat:free"), 128_000);
        assert_eq!(window_of("openrouter/google/gemini-2.5-pro"), 1_000_000);
        assert_eq!(window_of("openai/o3-mini"), 200_000);
        assert_eq!(window_of("  GPT-4O  "), 128_000);
    }

    #[test]
    fn unknown_models_get_the_conservative_default() {
        let unknown = model_window("some-local-model:7b");
        assert_eq!(unknown.window, DEFAULT_WINDOW);
        assert_eq!(unknown.window, 32_768);
        assert_eq!(unknown.max_output, DEFAULT_MAX_OUTPUT);
        assert!(!unknown.matched);
        assert_eq!(model_window("").window, DEFAULT_WINDOW);
    }

    #[test]
    fn cjk_text_is_estimated_one_token_per_character() {
        let text = "阅读训练".repeat(250); // 1000 CJK characters
        assert_eq!(estimate_tokens(&text), 1000);
        let messages = vec![ChatMessage::new("user", text)];
        let budget = context_budget("unknown-model", &messages, 256);
        assert_eq!(budget.estimated_input, 1000 + PER_MESSAGE_OVERHEAD);
        assert_eq!(budget.output_room, 32_768 - 1004);
    }

    #[test]
    fn cjk_prompt_is_budgeted_at_its_real_size_not_at_chars_over_four() {
        // 30k CJK characters would be 7.5k tokens under chars/4 and nearly fill a
        // 32k window at one token per character, so the output room is small.
        let cjk = "中".repeat(30_000);
        let budget = context_budget("unknown-model", &[ChatMessage::new("user", cjk)], 2_000);
        assert_eq!(budget.estimated_input, 30_004);
        assert_eq!(budget.output_room, 2_764);
        assert_eq!(budget.admit(), Ok(None));

        let ascii = "a".repeat(120_000);
        let budget = context_budget("unknown-model", &[ChatMessage::new("user", ascii)], 2_000);
        assert_eq!(budget.estimated_input, 30_004);
    }

    #[test]
    fn budget_passes_a_request_that_fits_unchanged() {
        let budget = budget_for("gpt-4o", 1_000, 2_000);
        assert_eq!(budget.output_room, 127_000);
        assert_eq!(budget.admit(), Ok(None));
    }

    #[test]
    fn budget_clamps_output_to_the_room_when_the_input_fits() {
        // Room 1,764 against a 2,000 request, above the 256 floor.
        let budget = budget_for("unknown-model", 31_004, 2_000);
        assert_eq!(budget.output_room, 1_764);
        assert_eq!(budget.admit(), Ok(Some(1_764)));
    }

    #[test]
    fn budget_refuses_when_the_room_is_below_the_floor() {
        let budget = budget_for("unknown-model", 32_600, 2_000);
        assert_eq!(budget.output_room, 168);
        let error = budget.admit().unwrap_err();
        assert!(error.context_exceeded);
        assert!(!error.retryable);
        assert!(!error.truncated);
        assert_eq!(error.message, "prompt exceeds model context: ~34600 tokens of 32768");
    }

    #[test]
    fn budget_refuses_an_input_that_is_itself_larger_than_the_window() {
        let budget = budget_for("unknown-model", 40_000, 2_000);
        assert_eq!(budget.output_room, 0);
        let error = budget.admit().unwrap_err();
        assert!(error.context_exceeded);
        assert_eq!(error.message, "prompt exceeds model context: ~42000 tokens of 32768");
    }

    #[test]
    fn exactly_the_floor_of_room_is_still_clamped_not_refused() {
        let budget = budget_for("unknown-model", 32_768 - 256 - 1_000, 2_000);
        assert_eq!(budget.output_room, 1_256);
        assert_eq!(budget.admit(), Ok(Some(1_256)));
        let budget = budget_for("unknown-model", 32_768 - 255, 2_000);
        assert!(budget.admit().is_err());
    }

    #[test]
    fn agent_estimate_counts_tools_tool_calls_and_echoed_reasoning() {
        let messages = vec![
            AgentMessage::System { content: "abcd".into() },
            AgentMessage::Assistant {
                content: None,
                tool_calls: vec![AgentToolCall {
                    id: "c1".into(),
                    name: "read".into(),
                    arguments_json: "{}".into(),
                }],
                reasoning: Some(ReasoningEcho(
                    [("reasoning_content".to_string(), json!("abcdefgh"))].into_iter().collect(),
                )),
            },
            AgentMessage::ToolResult { tool_call_id: "c1".into(), content: "abcd".into(), is_error: false },
        ];
        let tools = vec![AgentToolDefinition {
            name: "read".into(),
            description: "abcd".into(),
            parameters: json!({}),
        }];
        let with_tools = agent_input_tokens(&messages, &tools);
        let without_tools = agent_input_tokens(&messages, &[]);
        assert!(with_tools > without_tools);
        // 3 messages x 4 overhead, plus: system (1), call name (1), call args (1),
        // echo JSON "\"abcdefgh\"" (10 chars, 3 tokens), tool result (1).
        assert_eq!(without_tools, 12 + 1 + 1 + 1 + 3 + 1);
    }
}
