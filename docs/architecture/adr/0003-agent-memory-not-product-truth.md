# ADR 0003: Agent Memory Is Not Product Truth

状态：Accepted（M0）
日期：2026-08-11

## Context

Model text and future long-term Memory can be stale, wrong, poisoned, or overconfident. IELTS scores, answers, prompts, and practice history have stronger provenance than an Agent inference.

## Decision

Agent Memory is derived, provenance-bearing, user-visible state. It cannot mutate canonical practice truth, Soul, global product policy, or active Prompt versions. Future Memory promotion must be proposal-first, deterministic-validator-gated, conflict-aware, and reversible.

## Consequences

The Agent can personalize explanations without rewriting the evidence it learned from. UI and context compilation must show source and confidence; deletion and supersession must prevent a later Dream from silently recreating a user-deleted conclusion.
