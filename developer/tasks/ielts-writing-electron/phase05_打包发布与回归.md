# Phase 05：打包发布与回归（electron-builder、崩溃诊断、跨平台）

Based on current information, my understanding is: 本 Phase 把“能跑的应用”变成“用户能安装/升级、出现问题能定位、跨平台不炸”的可交付产品；并把回归做成固定门禁。

---

## 【需求文档定位】（对应章节，便于对照）
- 文档路径：`developer/docs/雅思AI作文评判应用完整需求文档.md`
- 关联章节：
  - 2.1 技术栈选型（Electron Builder）
  - 7. 文件存储结构（userData/db/images/logs）
  - 10. 开发优先级建议（Phase 5）
  - 11. 技术风险与应对策略（跨平台/SQLite/备份）

---

## 【核心判断】✅ 必做
不打包、不回归、不诊断，前面做的功能只是自嗨。

---

## 【边界】
- 自动更新/代码签名可按实际资源决定，但必须在文档里明确“做/不做”的理由。
- 先保证 macOS（你的开发机）闭环，再扩到 Windows/Linux。

---

## 【任务清单】

### P05-001：electron-builder 配置与产物验证
- [ ] 配置打包（appId、产物目录、图标、文件包含规则）
- [ ] 验证构建产物能启动并完成关键路径（Legacy→写作→返回）
- [ ] 原生依赖（若使用 better-sqlite3 等）在打包环境可用

### P05-002：崩溃/日志/诊断导出
- [ ] 主进程崩溃捕获与提示（防止静默退出）
- [ ] 诊断导出：打包一份（版本、平台、最近日志、DB schema 版本，不含明文 key）

### P05-003：发布流程与版本策略
- [ ] 版本号策略：与仓库版本一致
- [ ] Release checklist（人工也行，先把步骤写死）

---

## 【回归门禁（交付前必须全部通过）】

### 现有套件（必须）
```bash
python3 developer/tests/ci/run_static_suite.py
python3 developer/tests/e2e/suite_practice_flow.py
```

### Electron 冒烟（必须）
- [ ] 新装启动：默认进入 Legacy
- [ ] 切到写作：可评分一次（或 mock 评分）并看到结果
- [ ] 取消评分：不崩，回编辑页
- [ ] 返回 Legacy：重载正常
- [ ] 断网/坏 key：错误码与提示正确，不崩

---

## 【风险点与对策】
- Windows 路径/权限：所有路径必须来自 `app.getPath('userData')`，不要手拼。
- 原生模块：越晚验证越痛苦；Phase 02 选型后就应该尽快跑一次打包试验。
