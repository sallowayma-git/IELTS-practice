//! Per-model context windows and output ceilings, and the pre-send budget the
//! gateway checks before any HTTP call.
//!
//! The window table is advisory knowledge about public model cards, not a
//! provider query. Each row says whether its figure is confident. Only a
//! confident row can refuse a request or clamp its output ceiling. A
//! non-confident row, and any unmatched id, is advisory: the request is sent
//! unchanged and an oversized estimate only produces a warning. A table that
//! is wrong must never block or shorten a request that works today.
use ielts_application::{AgentMessage, AgentToolDefinition, ChatMessage, ModelError};
use ielts_domain::estimate_tokens;

use super::runtime::output_floor;

/// Framing cost per message (role and separators). Small on purpose: the
/// estimator is a chars/4 approximation and already covers the text itself.
const PER_MESSAGE_OVERHEAD: u32 = 4;

/// The least output room a confident request is given. A clamp below this would
/// leave an answer too short to be useful, so the request is refused instead.
const MIN_OUTPUT_ROOM: u32 = 256;

/// Used for model ids the table does not recognise. Smaller than most current
/// models on purpose, so an unknown model is never over-trusted. Advisory only.
const DEFAULT_WINDOW: u32 = 32_768;
const DEFAULT_MAX_OUTPUT: u32 = 4_096;

/// One table row: a name pattern and its published figures, in tokens.
#[derive(Debug, Clone, Copy)]
struct Rule {
    pattern: &'static str,
    window: u32,
    max_output: u32,
    /// False when the figure varies by release, tier or was not checked. Such a
    /// row never refuses or clamps; it only warns.
    confident: bool,
}

const fn sure(pattern: &'static str, window: u32, max_output: u32) -> Rule {
    Rule { pattern, window, max_output, confident: true }
}

const fn unsure(pattern: &'static str, window: u32, max_output: u32) -> Rule {
    Rule { pattern, window, max_output, confident: false }
}

/// Matching is on the model name after `model_name` (last `/` segment, no
/// `:variant` suffix, lowercase). A pattern matches the whole name or a prefix
/// that ends at a non-alphanumeric boundary, so `o1` matches `o1-mini` but not
/// `o1x`. The longest matching pattern wins, so specific rows sit under broad
/// fallbacks such as `qwen` or `gemini`.
const WINDOW_RULES: &[Rule] = &[
    // OpenAI. gpt-4o and gpt-4o-mini: 128k context, 16,384 output.
    sure("gpt-4o", 128_000, 16_384),
    // chatgpt-4o-latest tracks the gpt-4o chat model: 128k context.
    sure("chatgpt-4o", 128_000, 16_384),
    // gpt-4-turbo: 128k context, 4,096 output.
    sure("gpt-4-turbo", 128_000, 4_096),
    // gpt-4.1 family: 1,047,576 context, rounded down; 32,768 output.
    sure("gpt-4.1", 1_000_000, 32_768),
    // gpt-5: published 400k total, of which 272k is input. The input figure is
    // used as the whole window. UNSURE, verify against the current model card.
    unsure("gpt-5", 272_000, 128_000),
    // o1 is 200k, but o1-mini and o1-preview are 128k. UNSURE: the smaller
    // figure is used for the family, so o1 full is under-claimed.
    unsure("o1", 128_000, 32_768),
    // o3 and o4 (including o3-mini, o4-mini): 200k context, 100k output.
    sure("o3", 200_000, 100_000),
    sure("o4", 200_000, 100_000),
    // DeepSeek. The API documents 128k context. chat: 8k output here (default
    // 4k). reasoner: up to 64k output, reasoning included.
    sure("deepseek-chat", 128_000, 8_192),
    sure("deepseek-reasoner", 128_000, 65_536),
    // Other DeepSeek ids (v3 and similar): the smaller historical window. UNSURE.
    unsure("deepseek", 64_000, 8_192),
    // Qwen. Windows differ by release and by DashScope tier. UNSURE throughout.
    unsure("qwen-max", 32_768, 8_192),
    unsure("qwen-plus", 131_072, 8_192),
    unsure("qwen-turbo", 131_072, 8_192),
    // Qwen3 is 32k native (131k with YaRN extension). Native figure used.
    unsure("qwen3", 32_768, 8_192),
    unsure("qwen", 32_768, 8_192),
    // Moonshot / Kimi. The moonshot-v1 sizes are in their names; the 8k id is
    // the one true 8k model. moonshot-v1-auto routes up to 128k, so it takes
    // the 128k figure. The generic fallback takes the same figure. UNSURE.
    sure("moonshot-v1-8k", 8_192, 4_096),
    sure("moonshot-v1-32k", 32_768, 4_096),
    sure("moonshot-v1-128k", 131_072, 4_096),
    unsure("moonshot-v1-auto", 131_072, 4_096),
    unsure("moonshot", 131_072, 4_096),
    // Kimi K2 is 128k (some later variants 256k). UNSURE.
    unsure("kimi-k2", 131_072, 8_192),
    unsure("kimi", 131_072, 8_192),
    // GLM (Zhipu). The GLM-4 line is 128k. Later GLM-4.6 is larger, so 128k is
    // the conservative figure. UNSURE.
    unsure("glm", 128_000, 8_192),
    // Claude through OpenRouter. Claude Instant is 100k in every version, so
    // its row is confident. Claude 2 is 100k for 2.0 but 200k for 2.1, so the
    // family takes the larger figure and stays advisory: it only warns.
    // Claude 3 and 4 families are 200k, but Sonnet 4.6 and Opus 4.6 have 1M
    // windows, so the broad `claude` row must never refuse or clamp a request
    // that a newer model would accept. Advisory on purpose.
    unsure("claude-2", 200_000, 4_096),
    sure("claude-instant", 100_000, 4_096),
    unsure("claude", 200_000, 8_192),
    // Claude Sonnet 4.6 and Opus 4.6: 1M windows (OpenRouter and native ids).
    // Advisory until checked against the model card; never refuse or clamp.
    unsure("claude-sonnet-4.6", 1_000_000, 8_192),
    unsure("claude-sonnet-4-6", 1_000_000, 8_192),
    unsure("claude-opus-4.6", 1_000_000, 8_192),
    unsure("claude-opus-4-6", 1_000_000, 8_192),
    // Gemini through OpenRouter. Gemini 1.0 Pro is 32k. Gemini 1.5 Pro is 2M,
    // so the 1.5-named Pro id gets the smaller 1M figure. Gemini 2.x is about
    // 1,048,576, so 1M is used for the family. UNSURE on the exact numbers.
    unsure("gemini-1.0", 32_768, 8_192),
    unsure("gemini-pro-1.5", 1_000_000, 8_192),
    unsure("gemini-pro", 32_768, 8_192),
    unsure("gemini", 1_000_000, 8_192),
];

/// What the table knows about one model id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ModelWindow {
    pub window: u32,
    pub max_output: u32,
    /// False when the id matched no row and the default was used.
    pub matched: bool,
    /// True only for a matched row marked confident.
    pub confident: bool,
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

/// Window and output ceiling for a model id. Unknown ids get the advisory
/// default with `matched: false`.
pub(crate) fn model_window(model_id: &str) -> ModelWindow {
    let name = model_name(model_id);
    WINDOW_RULES
        .iter()
        .filter(|rule| rule_matches(&name, rule.pattern))
        .max_by_key(|rule| rule.pattern.len())
        .map_or(
            ModelWindow {
                window: DEFAULT_WINDOW,
                max_output: DEFAULT_MAX_OUTPUT,
                matched: false,
                confident: false,
            },
            |rule| ModelWindow {
                window: rule.window,
                max_output: rule.max_output,
                matched: true,
                confident: rule.confident,
            },
        )
}

/// What the pre-send guard decided for one call.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Admission {
    /// The output ceiling the guard lowered the request to, if it did. Only a
    /// confident row ever clamps.
    pub clamped: Option<u32>,
    /// The estimate says the request may not fit. Advisory: the request was
    /// still sent unchanged or clamped as above. Recorded in the ledger.
    pub context_warning: bool,
}

/// The pre-send budget for one call: what the input is estimated to take and
/// what is left for the output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Budget {
    pub window: u32,
    /// The table's published output ceiling. Advisory only.
    pub max_output: u32,
    pub estimated_input: u32,
    /// `window - estimated_input`, floored at zero.
    pub output_room: u32,
    /// The output ceiling the caller asked for.
    pub requested: u32,
    /// The smallest ceiling the request is sent with: the larger of
    /// `MIN_OUTPUT_ROOM` and the model's own output floor. A clamp must leave at
    /// least this much room, or the provider would be sent a higher value.
    pub min_output: u32,
    /// The model's own output floor (0 when it has none): a smaller ceiling is
    /// raised to this on the wire.
    pub wire_floor: u32,
    /// Whether the window came from a confident row. Only then may the guard
    /// refuse or clamp.
    pub confident: bool,
}

impl Budget {
    /// The decision for the request. Refuses (typed, non-retryable, nothing
    /// sent) when a confident row's window is full of input, or leaves less room
    /// than `min_output`. A confident row clamps the ceiling to the room left.
    /// Any other case is sent as asked, with a warning when the estimate says it
    /// may overflow.
    pub(crate) fn admit(&self) -> Result<Admission, ModelError> {
        if !self.confident {
            let may_overflow = self.estimated_input.saturating_add(self.requested) > self.window;
            if may_overflow {
                tracing::warn!(
                    window = self.window,
                    estimated_input = self.estimated_input,
                    requested = self.requested,
                    "estimated prompt may exceed the model context window (advisory, sent unchanged)"
                );
            }
            return Ok(Admission { clamped: None, context_warning: may_overflow });
        }
        if self.estimated_input >= self.window {
            return Err(ModelError::prompt_exceeds_context(self.estimated_input, self.window));
        }
        if self.requested.max(self.wire_floor) <= self.output_room {
            // Sent as asked: the value that reaches the provider already fits.
            return Ok(Admission { clamped: None, context_warning: false });
        }
        if self.output_room < self.min_output {
            // The room cannot hold the smallest ceiling this model is sent with.
            // Clamping to it would send a value above the room and overflow.
            return Err(ModelError::prompt_exceeds_context(
                self.estimated_input.saturating_add(self.min_output),
                self.window,
            ));
        }
        Ok(Admission { clamped: Some(self.output_room), context_warning: false })
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
        min_output: MIN_OUTPUT_ROOM.max(output_floor(model)),
        wire_floor: output_floor(model),
        confident: known.confident,
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

    fn admit(model: &str, input: u32, requested: u32) -> Result<Admission, ModelError> {
        budget_for(model, input, requested).admit()
    }

    #[test]
    fn a_small_ceiling_that_fits_is_sent_unchanged_below_the_floor() {
        // 16 output tokens fit in 100 tokens of room: no refusal, no clamp.
        let ok = admit("gpt-4o", 128_000 - 100, 16).expect("fits");
        assert_eq!(ok.clamped, None);
        // o3 raises 16 to its 1024 floor on the wire; 2000 room holds that.
        let ok = admit("o3", 200_000 - 2_000, 16).expect("fits");
        assert_eq!(ok.clamped, None);
        // 800 room cannot hold o3's 1024 floor even for a tiny request.
        assert!(admit("o3", 200_000 - 800, 16).unwrap_err().context_exceeded);
    }

    #[test]
    fn exact_model_ids_match_their_row() {
        assert_eq!(window_of("gpt-4o"), 128_000);
        assert_eq!(model_window("gpt-4o").max_output, 16_384);
        assert!(model_window("gpt-4o").matched);
        assert!(model_window("gpt-4o").confident);
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
        assert_eq!(window_of("claude-2.1"), 200_000);
        assert_eq!(window_of("claude-3-5-sonnet-20241022"), 200_000);
        assert_eq!(window_of("deepseek-chat"), 128_000);
        assert_eq!(window_of("deepseek-v3"), 64_000);
    }

    #[test]
    fn newly_added_rows_have_their_published_windows() {
        assert_eq!(window_of("chatgpt-4o-latest"), 128_000);
        assert_eq!(window_of("gpt-4-turbo-2024-04-09"), 128_000);
        assert_eq!(model_window("gpt-4-turbo").max_output, 4_096);
        assert_eq!(window_of("moonshot-v1-auto"), 131_072);
        assert!(!model_window("moonshot-v1-auto").confident);
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
    fn unknown_models_get_the_advisory_default() {
        let unknown = model_window("some-local-model:7b");
        assert_eq!(unknown.window, DEFAULT_WINDOW);
        assert_eq!(unknown.window, 32_768);
        assert_eq!(unknown.max_output, DEFAULT_MAX_OUTPUT);
        assert!(!unknown.matched);
        assert!(!unknown.confident);
        assert_eq!(model_window("").window, DEFAULT_WINDOW);
    }

    #[test]
    fn uncertain_rows_are_marked_and_confident_rows_are_not() {
        for model in [
            "qwen3-235b", "moonshot", "kimi-k2", "glm-4.6", "o1", "gpt-5", "deepseek-v3",
            "claude-3-5-sonnet", "claude-2.1", "claude-sonnet-4.6", "claude-opus-4-6",
        ] {
            assert!(!model_window(model).confident, "{model} must be advisory");
        }
        for model in ["gpt-4o", "o3-mini", "deepseek-chat", "claude-instant-1.2", "moonshot-v1-8k"] {
            assert!(model_window(model).confident, "{model} must be confident");
        }
    }

    #[test]
    fn a_250k_sonnet_46_request_is_admitted() {
        // Sonnet 4.6 has a 1M window. The broad claude row is 200k, so before this
        // the request was refused as if it were over the window.
        assert_eq!(window_of("anthropic/claude-sonnet-4.6"), 1_000_000);
        assert_eq!(window_of("openrouter/anthropic/claude-sonnet-4.6:beta"), 1_000_000);
        assert_eq!(admit("anthropic/claude-sonnet-4.6", 250_000, 2_000), Ok(Admission::default()));
        assert_eq!(admit("claude-sonnet-4-6", 250_000, 2_000), Ok(Admission::default()));
        assert_eq!(admit("anthropic/claude-opus-4.6", 250_000, 2_000), Ok(Admission::default()));
        // The broad family is advisory: an oversized estimate warns but is not refused.
        let broad = admit("anthropic/claude-3.5-sonnet", 250_000, 2_000).unwrap();
        assert_eq!(broad, Admission { clamped: None, context_warning: true });
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
        let cjk = "中".repeat(30_000);
        let budget = context_budget("unknown-model", &[ChatMessage::new("user", cjk)], 2_000);
        assert_eq!(budget.estimated_input, 30_004);
        assert_eq!(budget.output_room, 2_764);
        assert_eq!(budget.admit(), Ok(Admission::default()));

        let ascii = "a".repeat(120_000);
        let budget = context_budget("unknown-model", &[ChatMessage::new("user", ascii)], 2_000);
        assert_eq!(budget.estimated_input, 30_004);
    }

    #[test]
    fn a_request_that_fits_is_sent_unchanged() {
        assert_eq!(admit("gpt-4o", 1_000, 2_000), Ok(Admission::default()));
    }

    #[test]
    fn a_confident_row_clamps_output_to_the_room_left_after_the_input() {
        // gpt-4o: 128,000 window, 127,000 input, 2,000 requested: room 1,000.
        assert_eq!(
            admit("gpt-4o", 127_000, 2_000),
            Ok(Admission { clamped: Some(1_000), context_warning: false })
        );
    }

    #[test]
    fn a_confident_row_refuses_only_when_the_input_alone_fills_the_window() {
        let error = admit("gpt-4o", 128_000, 2_000).unwrap_err();
        assert!(error.context_exceeded);
        assert!(!error.retryable);
        assert!(!error.truncated);
        assert_eq!(error.class, "context_exceeded");
        assert_eq!(error.message, "prompt exceeds model context: ~128000 tokens of 128000");
        // Room below the 256-token minimum is refused too, not clamped to a stub.
        assert!(admit("gpt-4o", 127_999, 2_000).unwrap_err().context_exceeded);
        // Exactly the minimum is still a send, clamped to it.
        assert_eq!(admit("gpt-4o", 127_744, 2_000), Ok(Admission { clamped: Some(256), context_warning: false }));
    }

    #[test]
    fn an_o_series_floor_is_the_least_room_a_confident_clamp_may_leave() {
        // o3: 200,000 window, floor 1,024. 500 tokens of room cannot hold the floor.
        let refused = admit("o3", 199_500, 4_000).unwrap_err();
        assert!(refused.context_exceeded && !refused.retryable);
        assert_eq!(refused.message, "prompt exceeds model context: ~200524 tokens of 200000");
        // 1,500 tokens of room holds the floor, so the clamp lands on the room.
        assert_eq!(admit("o3", 198_500, 4_000), Ok(Admission { clamped: Some(1_500), context_warning: false }));
        // The same room is enough for a request that already fits under the floor.
        assert_eq!(admit("o3", 198_500, 1_000), Ok(Admission::default()));
    }

    #[test]
    fn an_uncertain_row_keeps_its_floor_advisory() {
        // gpt-5 is an uncertain row: 500 tokens of room warns and is sent as asked.
        assert_eq!(admit("gpt-5", 271_500, 4_000), Ok(Admission { clamped: None, context_warning: true }));
    }

    #[test]
    fn an_unknown_model_with_a_60k_prompt_is_admitted_with_a_warning_only() {
        let admitted = admit("some-unknown-model", 60_000, 2_000).unwrap();
        assert_eq!(admitted, Admission { clamped: None, context_warning: true });
    }

    #[test]
    fn an_uncertain_row_is_never_refused_or_clamped() {
        // qwen3-235b: 32,768 advisory window, 40k input.
        let admitted = admit("qwen3-235b", 40_000, 2_000).unwrap();
        assert_eq!(admitted, Admission { clamped: None, context_warning: true });
        // Input above the window still goes out, unchanged.
        assert!(admit("kimi-k2", 200_000, 8_000).is_ok());
    }

    #[test]
    fn a_worst_case_weekly_dream_request_is_admitted_for_every_row_but_true_8k_models() {
        // About 10k input (with the repair list) and the 2,500-token weekly output.
        for rule in WINDOW_RULES {
            let result = admit(rule.pattern, 10_000, 2_500);
            if rule.window == 8_192 && rule.confident {
                assert!(result.is_err(), "{} is a true 8k model and must refuse", rule.pattern);
            } else {
                assert!(result.is_ok(), "{} must admit a weekly dream request", rule.pattern);
            }
        }
    }

    #[test]
    fn moonshot_auto_kimi_glm_and_qwen_cases_never_refuse_a_working_prompt() {
        assert_eq!(window_of("moonshot-v1-auto"), 131_072);
        assert!(admit("moonshot-v1-auto", 60_000, 4_000).is_ok());
        assert!(admit("kimi-k2", 60_000, 8_000).is_ok());
        assert!(admit("glm-4.6", 60_000, 8_000).is_ok());
        assert!(admit("qwen3-235b", 60_000, 8_000).is_ok());
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
