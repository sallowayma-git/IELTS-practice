# ADR-M11: Prompt/Skill Eval-driven Evolution

日期：2026-08-16
状态：Accepted
基线：`IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 第 M11 章（行 9040-9200）

## Context

M3-M10 让用户级 Memory 演化成熟。M11 把用户级 Memory 演化与产品级 Prompt/Skill 演化彻底分开：线上 Agent 不修改自己的 Soul；产品 Prompt 通过受控工程流程演化。这是「安全落地 Hermes/自进化思想」——系统从 traces/failures/feedback 发现改进候选 → 生成 candidate → 评测 → 人工门禁批准 → 发布 → 可回滚；**不是生产 Agent 自己修改生产代码**。

## Decisions

### D1. Prompt Registry 是 overlay，现有硬编码 const 保留 fallback（M11-02）
现有 `AGENT_SYSTEM_PROMPT`/`ATTEMPT_REVIEW_SYSTEM_PROMPT`/`context_soul_policy.txt` 保留为 fallback。M11 引入 `prompt_templates`（10 module enum：core_soul/attempt_review/coach_reading/coach_writing/memory_extract/memory_resolve/daily_dream/weekly_dream/strategy_selector/study_planner）+ `prompt_versions`（versioned，status 状态机）。不破坏现有路径；registry active version 可 override fallback。

### D2. Skill Registry 与 user memory 分离（M11-03）
skill_definitions/skill_versions 表存可复用流程（read_attempt_evidence/compare_repeated_attempts/explain_tfng_error/build_weekly_reflection）。Skill 不是 memory 文件；versioning 与 user memory 完全分离。

### D3. Candidate lifecycle 是受控工程流程，不是 Agent 自改（M11-05/07）
`candidate_promotions` 表 + 状态机：proposed → eval_passed → holdout → shadow → approved → canary → promoted → rollback。每步是人工或门禁批准，不是线上 Agent 自己改。Rust 是 release gate；Python 是 experiment/eval orchestration。

### D4. Eval dataset 8 类 case + holdout isolation（M11-04）
eval_cases 表 + 8 类 case（memory_extraction_goldens/false_merge_split/consolidation_zero/context_selection/coach_personalization/prompt_injection/repeated_familiarity/strategy_outcome）。holdout case 标 holdout=TRUE，**never enters prompt generation context**（list_eval_cases(include_holdout=false) 供 prompt generation）。

### D5. 禁止 online self-modifying prompt（M11-06）
agent tool 黑名单：`update_system_prompt`/`edit_soul`/`install_unreviewed_skill`。Rust `tool.invoke` 当前只允许 `memory.candidate_input`（白名单模式），这些工具隐式被拒；Python `FORBIDDEN_AGENT_TOOLS` 显式黑名单（双 gate）。

### D6. Version pinned in every invocation trace（M11-08）
每次 prompt/skill invocation 记录 prompt_version + skill_version（domain `PromptVersion`/`SkillVersion` + trace）。trace graders（Python）评估 final answer/context used/irrelevant tool/memory citation/counter-evidence/oversized output/cost-latency。

### D7. Shadow no user-visible side effect；rollback exact（M11-05）
shadow_runs 表 + `no_user_visible_side_effect` 标志（M11-05 shadow 阶段不展示用户）。rollback_version 是 exact rollback（旧 version 标 active，新 version 标 rollback，不删除历史 version）。

### D8. Rust 拥有 release gate；Python 拥有 experiment/eval
Rust `prompt.list_versions`/`prompt.get_active`/`prompt.propose_candidate`/`prompt.promote_candidate`/`prompt.rollback`/`eval.run_case`/`skill.list_versions`（v1）是 authority。Python eval runner 跑 graders + candidate lifecycle orchestration（propose→eval→shadow→promote 经 host gateway），不直接写 prompt_version（no bypass）。

## 当前限制
- 现有硬编码 prompt const 未实际被 registry overlay override（registry 是 schema + service 就绪，wire-up 到 AgentService 的 prompt 注入是 future；M11 只立契约 + eval pipeline）。
- eval 是合成 dataset（8 类 case），未做 live model E2E（与 M3-M10 一致）。
- candidate promotion 的「approval」是 API gate，未做 UI 审批界面。

## Capabilities（供 Python 对齐）
- `prompt.list_versions` v1 / `prompt.get_active` v1 / `prompt.propose_candidate` v1 / `prompt.promote_candidate` v1 / `prompt.rollback` v1 / `eval.run_case` v1 / `skill.list_versions` v1。
