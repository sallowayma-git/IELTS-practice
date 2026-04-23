# Verification Guide

当前项目已经切到 `Electron 壳 + 本地 Fastify API + 前端 fetch/SSE` 架构。
旧的 `window.writingAPI` / 业务 IPC 手工验证脚本已删除，不再作为有效测试入口。

## 必跑自动回归

每次改动阅读、写作、主进程、本地 API 相关逻辑后，先跑：

```bash
python3 developer/tests/ci/run_static_suite.py
python3 developer/tests/e2e/suite_practice_flow.py
```

## 写作专项

写作主链路现在应验证：

- `npm run build:writing`
- `node developer/tests/ci/writing_contract_probe.cjs`
- `node developer/tests/ci/writing_ipc_serialize_contract.cjs`
- `python3 developer/tests/ci/writing_backend_contract.py`
- `python3 developer/tests/e2e/writing_compose_draft_restore_e2e.py`

关注点：

- Compose / Evaluating / Result 全链路通过本地 HTTP API 工作
- 评测事件通过 SSE 推送，不再依赖 preload 暴露业务事件 API
- `electron/services/*.js` 中的包装器正确指向 `server/src/lib/**` 内核

## 阅读专项

阅读主链路现在应验证：

- `node developer/tests/js/readingAnalysisService.test.js`
- `node developer/tests/js/unifiedReadingPage.test.js`

关注点：

- 阅读教练请求走 `/api/reading/assistant/query` 与 `/stream`
- 错题复盘必须带上题干、用户答案、标准答案、解析/证据
- `file://` 打开的 legacy 页面能通过 `app:getLocalApiInfo` 找到本地 API

## 手工排查

如果需要手工调试，不要再找旧 IPC 页面。
直接检查：

- Electron 主进程是否成功返回 `app:getLocalApiInfo`
- 本地 API 是否能访问 `GET /health`
- 写作 SSE：`GET /api/writing/evaluations/:sessionId/stream`
- 阅读 SSE：`POST /api/reading/assistant/query/stream`
