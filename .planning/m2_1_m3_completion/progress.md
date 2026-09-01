# Progress

## 2026-08-13

- Added `AgentRunKind::MemoryManager` and parser support.
- Implemented Rust routing for Python reverse RPC with protocol/trace/deadline validation.
- Restricted host tools to `memory.candidate_input`; routed model calls through existing Rust `AiRuntime`.
- Added bounded Rust-owned `MemoryCandidateInput` construction from fresh observations, active memory, and explicit preferences.
- Replaced direct candidate submission implementation with a host-owned generation command, run audit, inferred source assignment, and runtime diagnostics commands.
- `cargo check -p ielts-practice-tauri` passes; warning cleanup and runtime registration finalization remain.
