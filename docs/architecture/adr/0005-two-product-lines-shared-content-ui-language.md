# ADR 0005: Two Product Lines, Shared Content and UI Language

状态：Accepted（M0）
日期：2026-08-11

## Context

`opensource` and `IELTS-WRITING-FEAT` are separate products, not a branch convergence problem. Their runtime and feature sets may diverge, while learners should still recognize the same IELTS content vocabulary and interaction language.

## Decision

Do not merge product histories, interfaces, or data migrations. Share content resources and a visual/UI language contract. The Tauri Agent workspace remains an advanced entry surface; reading, writing, history, and future Coach surfaces can call scoped application use cases independently.

## Consequences

Each product can evolve without branch coupling. Shared content packages and design tokens need explicit versioning and compatibility tests; visual consistency is a product contract, not a shared runtime dependency.
