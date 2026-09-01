# ADR-M3-01：M3 Memory Proposal Contract 与 Rust Validator

- 状态：Implemented（proposal 合同与 validator 不变；persistence/promotion/audit/Tauri command 已在此边界内落地）
- 日期：2026-08-14
- 范围：严格遵循 `IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 的 M3-01 至 M3-07 边界

## 决策

M3 的 Memory 合同仍是“Python 生成不可信 proposal、Rust 做确定性校验”。validator 合同（namespace、scope wire shape、九种操作、source class 规则、disposition 枚举）保持不变。

Rust domain 暴露固定的七个一级 namespace：`knowledge`、`language`、`strategy`、`behavior`、`metacognition`、`preference`、`goal`。leaf key 可以演化，但必须使用对应 namespace 前缀和小写 ASCII 段。scope 当前只允许显式的 activity scope，线上 wire shape 固定为：

```json
{"type":"activity","key":"reading"}
```

proposal 只能引用稳定的 `obs-*` observation ID 或 `mem-*` target ID；禁止使用 array index mutation。支持任务书规定的九种操作：`ADD`、`REINFORCE`、`REFINE`、`IMPROVE`、`REGRESS`、`CONTRADICT`、`SUPERSEDE`、`ARCHIVE`、`NOOP`。

source class 不由模型输入控制。来自 Cognitive Runtime 的 proposal 只能标记为 `inferred`、`predicted` 或 `consolidated`；`user_explicit`、`observed` 和 `system_policy` 必须由 Rust trusted path 提供。`predicted` 不会自动 promotion：`promote_memory_candidate` 永远要求显式 actor 命令，且 `load_candidate_context` 把 predicted 标为 `PredictedHypothesis` 待验证。

validator 在落库前执行：schema/version 与数量边界、namespace/key、稳定 ID、证据存在性、同用户、scope 一致性、Active target、敏感证据、确定性投影 trust、prompt-injection/secret marker、重复 identity 检查。结果只能是 `pending`、`duplicate`、`rejected`、`quarantined` 或 `noop`；validator 不执行 mutation。

## 已在此 authority 边界内补齐

M3-01 原稿把 persistence/promotion/migration 列为“非目标”，现已全部落地且与 validator 同一边界：

- `0014_memory_profile_core.sql` 已创建（`memory_items`、`memory_candidate_batches`、`memory_candidates`、`memory_evidence`、`memory_mutations`、`explicit_user_preferences`），注册于 `0013_learning_observation_projection.sql` 之后；
- `persist_memory_candidate_batch` 落候选并支持 `request_id` + `payload_hash` 幂等重放；`promote_memory_candidate` 用 CAS + `MAX_ACTIVE_MEMORY_PER_SCOPE` 容量上限；`memory_mutations` 全量审计；`forget_memory` 写 redacted tombstone；`memory_context_preview` 按 priority 组装 explicit/active/candidate context；
- feature flag：`memory-core-v1` Cargo feature + `features/memory_auto_candidates_v1` 设置（默认 `proposal_only`）；Tauri commands 已接通（`memory_generate_candidates` 及 cognitive_runtime 生命周期命令、`memory_promote_candidate`、`memory_put_explicit_preference`、`memory_context_preview`、`memory_forget`）；
- Python candidate extractor 通过 reverse RPC（`tool.invoke` + `model.invoke`）接入；Python 仍无 sqlite/keyring/DB 路径。

## 取舍与非目标（现状）

- 不在 Rust 添加第二套 extractor、RAG backend、vector store 或 semantic reranker；这些仍属 Python-first derived path。
- 不引入 embedding/Dream/自动 promotion；候选必须经显式 promotion 才进入 Active Memory。
- 证据与 observation 复用 M2.1 cognitive read 的 bounded snapshot；validator 只接受 `normal + deterministic_projection` 的证据进入自动 proposal，敏感或含安全标记的内容直接 quarantine。

## 可验证性

- wire schema：`schemas/memory_proposal/proposal.schema.json`
- fixtures：`schemas/memory_proposal/fixtures/v1/`
- domain contract：`crates/ielts-domain/src/memory.rs`
- Rust authority：`crates/ielts-application/src/memory/validator.rs`
- persistence：`crates/ielts-db/src/memory.rs`，migration `crates/ielts-db/migrations/0014_memory_profile_core.sql`
- gates：
  - `cargo test -p ielts-application --lib memory`
  - `cargo test -p ielts-application --test memory_proposal_contract`
  - `cargo test -p ielts-application --test memory_service_contract`
  - `cargo test -p ielts-db --test memory_profile_core`
  - `python developer/tests/ci/check_m3_contracts.py`
