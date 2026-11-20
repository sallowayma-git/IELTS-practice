//! Prompt-budget primitives shared by every host-assembled model request.
//!
//! The old M5-07/M5-08 `ContextPlan` orchestration (sections, materialized
//! packs, manifests) had no production caller: coach requests are assembled in
//! one place (`ielts-application::coach::build_request`). Only the token
//! estimate, the hard ceiling and the rendered-context hash remain.

use sha2::{Digest, Sha256};

/// Hard upper bound on rendered context tokens. Exceeding this fails closed.
pub const CONTEXT_HARD_TOKEN_CEILING: u32 = 32_000;

/// Deterministic estimate: four Unicode scalars per unit. This is not a
/// provider tokenizer and does not guarantee a provider-specific token limit.
const TOKEN_CHARS_PER_UNIT: u32 = 4;

/// Deterministic SHA-256 of the rendered context. Stable for identical input
/// across runs because every contributor is canonicalized before hashing.
pub fn rendered_hash(rendered_context: &str) -> String {
    let digest = Sha256::digest(rendered_context.as_bytes());
    hex::encode(digest)
}

/// CJK scalars (Han, kana, Hangul, CJK/fullwidth punctuation) tokenize at
/// roughly one token each, not four scalars per token.
fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x3000..=0x303F | 0x3040..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF
        | 0xAC00..=0xD7AF | 0xF900..=0xFAFF | 0xFF00..=0xFFEF | 0x20000..=0x2FA1F)
}

/// Deterministic token estimate: one token per CJK scalar, plus 4 other
/// scalars per token (rounded up).
pub fn estimate_tokens(text: &str) -> u32 {
    let (cjk, other) = text.chars().fold((0u32, 0u32), |(cjk, other), c| {
        if is_cjk(c) { (cjk + 1, other) } else { (cjk, other + 1) }
    });
    cjk + other.div_ceil(TOKEN_CHARS_PER_UNIT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rendered_hash_is_stable_for_identical_input() {
        let a = rendered_hash("hello context");
        let b = rendered_hash("hello context");
        assert_eq!(a, b);
        assert_ne!(a, rendered_hash("hello context "));
    }

    #[test]
    fn estimate_tokens_uses_four_chars_per_token_rounded_up() {
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("abcde"), 2);
        assert_eq!(estimate_tokens(""), 0);
        // ASCII and other non-CJK scalars keep the 4-per-token rule.
        assert_eq!(estimate_tokens("🙂ab"), 1);
    }

    #[test]
    fn estimate_tokens_counts_cjk_scalars_as_one_token_each() {
        assert_eq!(estimate_tokens("中文"), 2);
        assert_eq!(estimate_tokens("中文🙂ab"), 3);
        assert_eq!(estimate_tokens("请复盘我本次错题，按优先级给出训练建议"), 19);
        assert_eq!(estimate_tokens("かな한글"), 4);
    }
}
