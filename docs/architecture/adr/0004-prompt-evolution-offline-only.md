# ADR 0004: Prompt Evolution Is Offline Only

状态：Accepted（M0）
日期：2026-08-11

## Context

An online Agent must not rewrite the Prompt, Skill, tool description, or safety policy that governs its current run. Self-modification without holdout evaluation and rollback would make behavior non-reproducible and unsafe.

## Decision

Production runs read only an active, versioned Prompt/Skill bundle. Candidate changes are generated and evaluated offline with train/validation/holdout, deterministic safety gates, red-team cases, shadow/canary evidence, human release authority, and rollback. M0 records only the system Prompt hash; it does not implement evolution.

## Consequences

Every run can be tied to a stable Prompt identity. Product adaptation is slower than hot-swapping text, but failures are attributable and reversible.
