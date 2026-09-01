# ADR-M2.1: Cognitive Read Gateway

状态：Implemented  
日期：2026-08-14  
范围：M2 学习事件 ledger → observation projection 的只读出口，供 M3/M4 及 Tauri 命令消费

## 决策

Rust 拥有 canonical freshness：任何 cognitive read 都先 `learning_observations_verify` → 需要时 `learning_observations_rebuild` → 再 `verify`，读取路径绝不把半成品或陈旧投影暴露给消费者。修复发生在调用方业务事务之外（`ensure_fresh` 注释明确“cognitive read may repair derived state, but never blocks a submit”），因此读路径自动修复投影时不会阻塞任何提交事务。

读结果只有两种：`ProjectionFreshness::Fresh` 的完整快照，或 `DbError::Validation`（rebuild 后仍不一致）。不会返回 `Stale`/`Rebuilding` 的半成品。

## 数据与所有权

- read-only DTO 由 domain 层定义（`crates/ielts-domain/src/cognitive_read.rs`）：`ObservationSnapshot`、`ObservationBatch`、`LearningEventEvidenceBatch`，以及查询 `ObservationSnapshotQuery`。
- application 层 `CognitiveReadStore`/`CognitiveReadService`（`crates/ielts-application/src/cognitive_read.rs`）是 bounded read port，只回传 DTO，绝不外泄 DB 连接或文件路径。
- 出站 observation 强制 `sensitivity="normal"`、`trust="deterministic_projection"`（`materialize_observation` 硬编码）；learning event evidence 强制 `sensitivity="normal"`、`trust="canonical_learning_truth"`。
- 快照身份由三元组构成：`ledger_input_hash`、`observation_output_hash`、`generated_at`。

## generatedAt 语义

`generated_at` 取自 `learning_projection_runs` 中最新一条 `status='completed'` 且 `projector_version` 为当前版本的 run 的 `finished_at`（`projection_generated_at`）。rebuild 在单个事务内写入该 run 的 `started_at`/`finished_at`，因此 `generated_at` 是投影完成时刻，不是逐 event 的精确时间。

## unscored 不覆盖 last-scored

`project_reading_repeats` 对每条 reading question 按 attempt ordinal 排序后维护 `last_scored`：`is_correct=None` 的 unscored observation 保留在基础流（不丢数据），但 transition 计算对 `is_correct` 为 `None` 的事件直接 `continue`，`last_scored` 只在有分数时更新。因此一个 unscored 事件既不会产生 repeat transition，也不会把 last-scored 基线重置或写坏。

## 投影 run 保留策略

`prune_projection_runs` 在每次 rebuild 后裁剪 `learning_projection_runs`：成功 run 保留最近 `PROJECTION_SUCCESS_RETENTION = 20` 条，失败 run 保留最近 `PROJECTION_ERROR_RETENTION = 5` 条，保证 run 表有界、不随 rebuild 次数线性膨胀（benchmark 的 `projectionRunGrowth` 已验证 rebuild 后 DB 文件大小不增长）。

## 边界

- `MAX_COGNITIVE_READ_LIMIT = 200`（snapshot `limit` clamp 到 `1..=200`，默认 100）；
- `MAX_EVENT_IDS = 200`、`MAX_EVIDENCE_REFS = 128`、`MAX_PAYLOAD_BYTES = 16 KiB`、`MAX_RESPONSE_BYTES = 1 MiB`；
- 超出边界返回 `DbError::Validation`，不静默截断（truncation 只发生在合法的分页 `continuation` 路径）。

## 热路径选择（benchmark-driven）

- 读热路径只 verify（in-memory 输入/输出 hash 比对），不重建；只在 `projection_run_matches` 为 false 时才 rebuild，且 rebuild 后有二次 verify 兜底。
- `build_projection` 用 `BTreeMap` 去重（`records.entry(id).or_insert`）避免 O(n²) 扫描；verify 通过 `input_hash`/`output_hash` 的整表比对替代逐行回读。
- benchmark（`developer/tests/benchmarks/m2_1_projection`，release，Windows/x86_64/24 核）10k events / 48,961 observations：基线 rebuild ~4.75s、verify ~2.00s → 优化后 rebuild p50 ~4.27s、verify p50 ~1.71s；rebuild 后 DB 文件大小不变。

## 验证与限制

已覆盖：stale 行自动 rebuild + 版本化合同（`cargo test -p ielts-db --test cognitive_read`）、replay idempotency 与 reading transition golden（`--test learning_observations`）、>200 IDs 拒绝。

限制：`generated_at` 是投影完成时刻的单调近似，不承载逐 event 时间语义；重建是单连接内的全量重算，尚未做增量投影；benchmark 为单机 baseline 数据，无硬性 pass/fail 阈值。
