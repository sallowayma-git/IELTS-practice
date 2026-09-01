# M2.1 + M3 Completion Plan

## Goal

严格依据 `developer/docs/IELTS_Atlas_Agent_Self_Evolution_Engineering_Plan_v1.3_Post_M2_Python_First_RAG.md` 完成 M2.1 与 M3，不扩展到 M4+。

## Status

- [x] 任务书与仓库差距审计
- [x] M3 schema/domain/application/validator/persistence
- [ ] Python sidecar ↔ Rust HostModel/tool.invoke ↔ AgentRun 生产链路
- [ ] M2.1 10k/50k/100k benchmark 与失败运行 retention
- [ ] sidecar 打包 hash/smoke、ADR、rollback/privacy/metrics/gate
- [ ] 定向测试、static suite、packaged E2E

## Guardrails

- Rust owns SQLite、OS vault、model provider、policy、validation、promotion。
- Python only receives bounded DTOs and returns proposals.
- Preserve concurrent M4 migration `0015` and learner files.
- Required final order: static suite, then packaged practice-flow E2E.
