# Phase 04 交接检查清单

> **使用说明**: 接手人员请按顺序执行此清单，确保所有功能正常

---

## ✅ 快速验收流程 (5分钟)

### 1. 启动应用
```bash
cd /Users/maziheng/Downloads/0.3.1\ working
npx electron electron/main.js
```

### 2. 导航测试
- [ ] 主界面 → 更多 → 看到紫色"✍️ 写作评分"卡片
- [ ] 点击写作卡片 → 成功进入写作模块
- [ ] 写作模块 → 历史 → 看到历史记录列表
- [ ] 主界面 → 浏览 → 打开任意题目
- [ ] 题目页面底部 → 看到"🏠 返回主页"按钮（紫色）
- [ ] 点击返回按钮 → 成功返回主界面

### 3. 核心功能快速检查
- [ ] 写作模块 → 题库 → 看到题目列表
- [ ] 写作模块 → 历史 → 看到"📊 历史统计与对比"区域
- [ ] 切换统计范围（全部/最近10次/本月/Task1/Task2）→ 雷达图更新
- [ ] 写作模块 → 设置 → 看到三个标签页（API配置/提示词/数据管理）

---

## 📋 详细功能检查清单

### 题库管理 (TopicsPage)

**基础功能**:
- [ ] 列表展示正常（Task 1/Task 2 题目）
- [ ] 筛选功能：类型下拉框工作
- [ ] 筛选功能：分类下拉框工作
- [ ] 筛选功能：难度下拉框工作
- [ ] 搜索框输入 → 列表过滤

**CRUD 操作**:
- [ ] 点击"新建题目" → 弹出表单
- [ ] 填写题目信息 → 保存成功
- [ ] 点击题目卡片 → 查看详情
- [ ] 点击"编辑" → 修改题目
- [ ] 点击"删除" → 确认后删除

**批量导入**:
- [ ] 点击"批量导入" → 上传 JSON 文件
- [ ] 预览导入数据
- [ ] 确认导入 → 显示成功/失败报告

**空状态**:
- [ ] 无题目时显示空状态提示
- [ ] 筛选无结果时显示提示

---

### 历史记录 (HistoryPage)

**列表与筛选**:
- [ ] 历史记录列表展示正常
- [ ] 日期范围筛选工作
- [ ] 分数范围筛选工作（0.5步长）
- [ ] 任务类型筛选（Task 1/Task 2）
- [ ] 搜索功能（题目标题/内容）
- [ ] 分页加载正常

**详情查看**:
- [ ] 点击记录 → 进入详情页（只读模式）
- [ ] 详情页显示完整评分
- [ ] 详情页显示反馈内容
- [ ] 详情页"返回"按钮工作

**批量操作**:
- [ ] 勾选多条记录
- [ ] 点击"批量删除" → 二次确认 → 删除成功
- [ ] 点击"导出" → 下载 CSV 文件
- [ ] 点击"清空历史" → 二次确认（文本："确认删除"）→ 清空成功

---

### 历史统计与雷达图

**统计范围切换**:
- [ ] 选择"全部历史" → 雷达图更新
- [ ] 选择"最近10次" → 雷达图更新（最多10条）
- [ ] 选择"本月" → 雷达图更新
- [ ] 选择"Task 1专项" → 雷达图更新
- [ ] 选择"Task 2专项" → 雷达图更新

**雷达图显示**:
- [ ] 显示四项评分（TR/TA, CC, LR, GRA）
- [ ] 蓝色线：最新成绩
- [ ] 绿色线：平均成绩
- [ ] 图例正确

**对比表格**:
- [ ] 显示最新 vs 平均对比
- [ ] 显示差值（+/-）
- [ ] 显示趋势图标（↑/↓/→）
- [ ] 颜色编码正确（绿色上升/红色下降）

**空状态**:
- [ ] 无历史数据时显示空状态
- [ ] 筛选范围无数据时显示提示

**协议验证** (开发者工具 Console):
```javascript
// 打开 DevTools (Cmd+Option+I)
// 在 Console 执行：
window.writingAPI.essays.getStatistics('all', null).then(console.log)

// 检查返回格式：
// ✅ 必须有 latest.tr_ta（不是 task_response 或 task_achievement）
// ✅ 必须有 average.avg_tr_ta（不是 average_task_achievement）
```

---

### 设置管理 (SettingsPage)

**API 配置**:
- [ ] 列表显示已配置的 API
- [ ] 点击"新建配置" → 表单弹出
- [ ] 填写配置信息 → 保存成功
- [ ] 点击"测试连接" → 显示测试结果
- [ ] 设置默认配置 → 标记更新
- [ ] 启用/禁用配置 → 状态切换
- [ ] 删除配置 → 确认后删除

**提示词管理**:
- [ ] 显示当前提示词版本
- [ ] 点击"查看" → 显示提示词内容
- [ ] 点击"导出" → 下载 JSON 文件
- [ ] 点击"导入" → 上传 JSON → 更新成功
- [ ] 点击"编辑" → 二次确认 → 允许编辑

**数据管理**:
- [ ] 显示数据库统计信息（题目数/历史数）
- [ ] 设置保留条数 → 保存成功
- [ ] 点击"清空历史" → 二次确认 → 清空成功
- [ ] 显示数据库路径

---

### 图片上传 (Task 1)

**上传功能**:
- [ ] 写作页面 → 选择 Task 1
- [ ] 点击图片上传区域
- [ ] 选择图片文件（jpg/png/webp）
- [ ] 图片上传成功 → 显示预览
- [ ] 缩略图生成成功

**图片管理**:
- [ ] 点击预览图 → 放大查看
- [ ] 点击"删除" → 图片移除
- [ ] 重新上传 → 替换图片

**校验**:
- [ ] 上传非图片文件 → 显示错误
- [ ] 上传超大文件（>5MB）→ 显示错误

---

### 导航优化

**写作模块入口**:
- [ ] 主界面 → 更多
- [ ] 看到紫色高亮的"✍️ 写作评分"卡片
- [ ] 卡片有顶部紫色渐变条
- [ ] 鼠标悬停 → 卡片上浮 + 阴影增强
- [ ] 点击卡片 → 进入写作模块

**题目页面返回按钮**:
- [ ] 打开任意阅读/听力题目
- [ ] 底部导航栏左侧看到"🏠 返回主页"按钮
- [ ] 按钮为紫色渐变背景
- [ ] 鼠标悬停 → 按钮上浮 + 阴影
- [ ] 有未提交答案时点击 → 弹出确认框
- [ ] 无未提交答案时点击 → 直接返回主界面
- [ ] 返回后主界面正常显示

**导航安全**:
- [ ] 题目页面可以正常打开本地 HTML 文件
- [ ] 点击题目内链接不会跳转到外部网站

---

## 📁 文件修改清单

### 新增文件 (~30个)

**前端组件**:
- `apps/writing-vue/src/views/TopicsPage.vue`
- `apps/writing-vue/src/views/HistoryPage.vue`
- `apps/writing-vue/src/views/SettingsPage.vue`
- `apps/writing-vue/src/components/RadarChart.vue`

**后端 DAO**:
- `electron/db/dao/topics.dao.js`
- `electron/db/dao/essays.dao.js`
- `electron/db/dao/settings.dao.js`
- `electron/db/dao/api-configs.dao.js`
- `electron/db/dao/prompts.dao.js`

**后端 Service**:
- `electron/services/topic.service.js`
- `electron/services/essay.service.js`
- `electron/services/upload.service.js`
- `electron/services/settings.service.js`

**IPC 事件**:
- `electron/ipc/topics.ipc.js`
- `electron/ipc/essays.ipc.js`
- `electron/ipc/upload.ipc.js`
- `electron/ipc/configs.ipc.js`
- `electron/ipc/prompts.ipc.js`
- `electron/ipc/settings.ipc.js`

### 修改文件 (~15个)

**核心修改**:
- ✅ `electron/services/essay.service.js` - 统计协议锁定
- ✅ `apps/writing-vue/src/views/HistoryPage.vue` - 移除 fallback 逻辑
- ✅ `apps/writing-vue/src/api/client.js` - 修正 API 调用
- ✅ `js/practice-page-enhancer.js` - 注入返回按钮
- ✅ `electron/main.js` - 导航安全修复
- ✅ `index.html` - 写作入口卡片
- ✅ `js/presentation/indexInteractions.js` - 事件处理
- ✅ `css/main.css` - featured 卡片样式

**文档更新**:
- ✅ `developer/tests/smoke_test_guide.md`
- ✅ Artifact: `walkthrough.md`
- ✅ Artifact: `task.md`

---

## 🐛 已知问题确认

### 已修复 ✅
- [x] 统计协议不一致 → 已锁定 tr_ta/avg_tr_ta
- [x] API 客户端调用错误端点 → 已修正
- [x] 前端 fallback 逻辑 → 已移除
- [x] 导航限制过严 → 已放宽本地文件
- [x] CSS 渲染错误 → 已修复
- [x] 缺少写作入口 → 已添加
- [x] 缺少返回按钮 → 已注入

### 已知限制 ⚠️
- [ ] 历史搜索功能未实现（后端需 LIKE 查询）
- [ ] 草稿存储使用 localStorage（大内容可能需 SQLite）
- [ ] 应用版本号硬编码（需构建时注入）
- [ ] 评分结果页面依赖 sessionStorage，缺少稳定落库链路
- [ ] 设置页缺少 API 配置/提示词完整管理面板
- [ ] 供应商调用缺少主备编排、重试与冷却机制

---

## 🚀 下一步行动

### 立即执行
1. [ ] 按此清单完整测试所有功能
2. [ ] 记录发现的任何问题
3. [ ] 验证性能（100+ 题目/历史记录）
4. [ ] 检查控制台是否有错误

### Phase 05 准备
1. [ ] 备份与恢复功能
2. [ ] 数据导入导出增强
3. [ ] 性能优化（虚拟滚动）
4. [ ] 高级筛选与搜索

---

## 📞 紧急联系

### 关键文件快速索引

**统计协议相关**:
- 后端: `electron/services/essay.service.js:L41-L95`
- 前端: `apps/writing-vue/src/views/HistoryPage.vue:L669-L721`
- API: `apps/writing-vue/src/api/client.js:L152-L156`

**导航相关**:
- 写作入口: `index.html:L204-L229`
- 返回按钮: `js/practice-page-enhancer.js:L1338-L1420`
- 安全控制: `electron/main.js:L72-L77`

**数据库**:
- Schema: `electron/db/schema.sql`
- 初始化: `electron/db/database.js`

### 文档
- 完整交接: `phase04_handover.md`
- 进度记录: `walkthrough.md`
- 测试指南: `developer/tests/smoke_test_guide.md`
- 需求文档: `developer/docs/雅思AI作文评判应用完整需求文档.md`

---

---

## ⚠️ Phase 05A/05B 验收状态 (2026-02-10)

> **评审结论**: ❌ **未通过 - 需返工后重提**
> **评审时间**: 2026-02-09 22:15
> **评审来源**: 评审 AI (Codex + Antigravity)

### Phase 05 验收项状态

| 验收项 | 状态 | 备注 |
|--------|------|------|
| 05A 评分流程 E2E 测试 | ❌ 未通过 | Mock 测试，非真实链路 |
| 05A 失败分支落库验证 | ❌ 未通过 | 无真实 DB 验证 |
| 05A 取消分支无脏数据 | ❌ 未通过 | 无真实 DB 验证 |
| 05B 上传流程 E2E 测试 | ❌ 未通过 | Mock 测试，非真实链路 |
| 05B 删除清理验证 | ❌ 未通过 | 存在吞错风险 |
| 05B 路径安全测试 | ❌ 未通过 | `except Exception` 吞断言 |
| 测试接入 CI 链路 | ❌ 未完成 | 未加入强制执行清单 |

### 评审 AI 要求的硬证据清单

返工后必须提供以下证据（手工验收不计入通过条件）：

- [ ] **真实 session_id** - 从 `evaluation_sessions` 表获取的实际 ID
- [ ] **真实 essay_id** - 从 `essays` 表获取的实际 ID
- [ ] **真实文件路径删除前后断言** - 文件系统级别的验证（删除前存在，删除后不存在）
- [ ] **真实 DB 状态验证** - 直接查询 SQLite 数据库，验证字段值
- [ ] **真实 IPC/HTTP 调用链路** - 必须调用实际接口（IPC 或 `127.0.0.1` 本地 HTTP/SSE）

### 返工检查清单

- [ ] 删除 Mock 测试，改为真实链路测试
- [ ] 修复路径安全测试的异常捕获（禁止 `except Exception` 吞断言）
- [ ] 将 Phase05 脚本接入 `run_static_suite.py` 强制执行
- [ ] 产出真实测试报告，包含上述 5 项硬证据
- [ ] 重新提交评审

### 相关文件

- 测试脚本: `developer/tests/e2e/phase05_eval_flow.py` (需返工)
- 测试脚本: `developer/tests/e2e/phase05_upload_flow.py` (需返工)
- 测试报告: `developer/tests/e2e/reports/phase05-eval-flow-report.json` (无效)
- 测试报告: `developer/tests/e2e/reports/phase05-upload-flow-report.json` (无效)
- 评审记录: `developer/docs/chat.md` (2026-02-09 22:15)

---

**检查清单版本**: v1.1
**最后更新**: 2026-02-10 19:25
**状态**: ⚠️ Phase 04 核心功能完成，Phase 05A/05B 需返工
