# ADR 0001: Local-First Agent Runtime

状态：Accepted（M0）
日期：2026-08-11

## Context

IELTS Atlas is a desktop learning product. Practice truth, workspace grants, model credentials, and run audit must remain useful when the network or provider is unavailable. A hosted Agent framework would add a second authority and make rollback harder.

## Decision

Keep the Agent runtime as a Rust modular monolith hosted by Tauri. Vue is an interaction surface; `ielts-application` owns the bounded run loop; `ielts-db` owns local persistence; `src-tauri` owns OS, Keyring, provider HTTP, and workspace capabilities. Provider calls are ports behind the application boundary.

## Consequences

The app can enforce limits, minimize audit data, and recover runs locally. Network provider latency and availability remain visible failure modes. Introducing a remote orchestrator later requires an explicit trust and data-minimization decision; it is not an implementation detail.
