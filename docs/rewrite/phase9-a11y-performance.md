# Phase 9 — A11y, Visual, Performance

> Status: implemented  
> Date: 2026-07-12

## Delivered

| Item | Location |
|---|---|
| Focus rings, 44px targets, skip link, live region | `styles/a11y-performance.css`, `App.vue` |
| `prefers-reduced-motion` kills decorative motion | CSS + route transition gate |
| Virtual window composable | `composables/useVirtualWindow.js` |
| Perf budgets constants | Rust `perf/mod.rs` + JS `PERFORMANCE_BUDGETS_MS` |
| SQLite EXPLAIN QUERY PLAN baselines | `collect_query_plan_baselines` |
| Tauri diagnostics | `get_performance_budgets`, `get_query_plan_baselines` |

## Budgets (P95 targets)

| Metric | Budget |
|---|---|
| Cold start interactive | 2500 ms |
| Warm start | 1200 ms |
| Library first paint | 500 ms |
| Answer local save | 50 ms |
| History first page | 500 ms |
| Result open | 300 ms |
| Evaluation UI latency | 100 ms |

## Verify

```bash
cargo test -p ielts-db --lib perf::
cargo test -p ielts-db
```
