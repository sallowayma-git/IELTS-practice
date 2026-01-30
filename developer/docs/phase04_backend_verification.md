# Phase 04 Backend Verification Checklist

## Purpose

验证后端数据层、服务层、IPC 层的核心路径，确保协议正确性和边界条件处理，避免问题延迟到 UI 层才暴露。

---

## 1. Topics (题目管理) 核心路径

### 1.1 基础 CRUD
- [ ] **创建题目** (`topics:create`)
  - 测试数据：`{ type: 'task1', category: 'bar_chart', difficulty: 3, title_json: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Test topic"}]}]}' }`
  - 验证：返回 topic_id，数据库中可查到
  
- [ ] **查询单个题目** (`topics:getById`)
  - 验证：返回完整 topic 数据，JSON 字段正确

- [ ] **更新题目** (`topics:update`)
  - 测试：修改 difficulty 为 5
  - 验证：updated_at 更新，字段生效

- [ ] **删除题目** (`topics:delete`)
  - 验证：数据库中记录消失

### 1.2 筛选与分页
- [ ] **按类型筛选** (`topics:list` with `filters.type = 'task2'`)
- [ ] **按难度筛选** (`filters.difficulty = 3`)
- [ ] **分页查询** (`pagination: { page: 2, limit: 5 }`)
  - 验证：返回正确的 total/page/limit/data

### 1.3 批量导入
- [ ] **合法 JSON 导入**
  - 测试数据：`[{ type: 'task1', category: 'pie_chart', difficulty: 2, title_json: '...' }, ...]`
  - 验证：返回 `{ success: X, failed: Y, errors: [...] }`

- [ ] **非法数据导入**（边界测试）
  - 缺少 type
  - 缺少 category
  - 非法 category（如 task1 用了 'education'）
  - 非法 difficulty（< 1 或 > 5）
  - 验证：errors 数组包含详细错误信息

### 1.4 统计
- [ ] **获取统计** (`topics:getStatistics`)
  - 验证：返回 `{ total, byType, byCategory }`

---

## 2. Essays (作文/历史记录) 核心路径

### 2.1 基础 CRUD
- [ ] **创建作文记录** (`essays:create`)
  - 测试数据：包含 topic_id, task_type, content, word_count, scores, evaluation_json
  - 验证：返回 essay_id，自动触发 cleanupOldRecords（根据 history_limit）

- [ ] **查询单个记录** (`essays:getById`)
  - 验证：返回完整 essay 数据，包含 topic_title（JOIN topics）

- [ ] **删除记录** (`essays:delete`)
  - 验证：数据库中记录消失

- [ ] **批量删除** (`essays:batchDelete`)
  - 测试：传入 `[id1, id2, id3]`
  - 验证：返回删除数量，数据库中确认删除

- [ ] **清空所有** (`essays:deleteAll`)
  - 验证：返回删除数量，essays 表为空

### 2.2 筛选与分页
- [ ] **按任务类型筛选** (`filters.task_type = 'task1'`)
- [ ] **按日期范围筛选** (`filters.start_date`, `filters.end_date`)
- [ ] **按分数范围筛选** (`filters.min_score = 5`, `filters.max_score = 7`)
- [ ] **分页** (`pagination: { page: 1, limit: 10 }`)

### 2.3 统计数据
- [ ] **全部历史** (`essays:getStatistics` with `range='all'`)
- [ ] **最近10次** (`range='recent10'`)
- [ ] **本月** (`range='monthly'`)
- [ ] **Task 专项** (`range='all', taskType='task1'`)
  - 验证：返回 `{ average_total_score, average_task_achievement, ..., count }`

### 2.4 CSV 导出
- [ ] **导出 CSV** (`essays:exportCSV`)
  - 测试：有历史记录时导出
  - 验证：返回 CSV 字符串，包含正确的 headers 和 rows
  - 边界测试：topic_title 为 null（自由写作）、JSON 解析失败

- [ ] **空数据导出**
  - 验证：返回仅包含 headers 的 CSV

---

## 3. Settings (应用设置) 核心路径

### 3.1 基础操作
- [ ] **获取所有设置** (`settings:getAll`)
  - 验证：返回完整设置对象，JSON 自动反序列化

- [ ] **获取单个设置** (`settings:get` with `key='language'`)
  - 验证：返回正确的值（如 "zh-CN"）

- [ ] **更新设置** (`settings:update`)
  - 测试数据：`{ temperature_mode: 'creative', history_limit: 200 }`
  - 验证：数据库更新，再次 getAll 确认

### 3.2 验证逻辑（边界测试）
- [ ] **非法 language**（如 `'fr'`）
  - 验证：返回错误 "Invalid language: must be zh-CN or en"

- [ ] **非法 temperature_mode**（如 `'extreme'`）
  - 验证：返回错误

- [ ] **非法 temperature 值**（如 `2.5`，超出 0-2 范围）
  - 验证：返回错误

- [ ] **非法 history_limit**（如 `-1` 或 `20000`）
  - 验证：返回错误

### 3.3 重置
- [ ] **重置为默认** (`settings:reset`)
  - 验证：所有设置恢复到 schema.sql 中的预置值

---

## 4. Upload (图片上传) 核心路径

### 4.1 基础上传
- [ ] **上传合法图片** (`upload:uploadImage`)
  - 测试数据：`{ name: 'test.png', data: Buffer, type: 'image/png' }`
  - 验证：返回 `{ image_path: 'xxx.png', size: 12345 }`，文件存在于 `userData/images/`

- [ ] **获取图片路径** (`upload:getImagePath`)
  - 验证：返回完整的绝对路径

- [ ] **删除图片** (`upload:deleteImage`)
  - 验证：文件从 `userData/images/` 删除

### 4.2 验证逻辑（边界测试）
- [ ] **非法文件类型**（如 `type: 'application/pdf'`）
  - 验证：返回错误 "Invalid file type"

- [ ] **非法扩展名**（如 `.txt`）
  - 验证：返回错误 "Invalid file extension"

- [ ] **超大文件**（> 5MB）
  - 验证：返回错误 "File size exceeds limit"

- [ ] **缺少文件名**
  - 验证：返回错误 "File name is required"

- [ ] **缺少文件数据**
  - 验证：返回错误 "Invalid file data"

---

## 5. Draft (草稿机制) localStorage 测试

### 5.1 基础功能
- [ ] **保存草稿** (`useDraft` composable)
  - 调用 `setContent('Test content', 100)`
  - 等待 10 秒
  - 验证：localStorage 中存在 key `ielts_writing_draft_task1`

- [ ] **加载草稿** (`loadDraft()`)
  - 验证：返回之前保存的数据

- [ ] **清除草稿** (`clearDraft()`)
  - 验证：localStorage key 被删除

### 5.2 边界/风险测试
- [ ] **file:// 协议下的 localStorage**
  - 在 Electron 环境中测试是否正常工作
  - 验证：跨页面刷新后草稿仍存在

- [ ] **QuotaExceededError**
  - 模拟超大内容（如10MB文本），验证错误处理
  - 验证：console 输出警告，不崩溃

- [ ] **beforeunload 事件**
  - 写入草稿，关闭窗口前检查是否触发保存
  - 验证：重新打开后草稿存在

---

## 6. IPC 协议一致性测试

### 6.1 成功响应格式
- [ ] 所有 IPC 调用返回格式统一：`{ success: true, data: <result> }`

### 6.2 失败响应格式
- [ ] 所有错误返回格式统一：`{ success: false, error: { code, message } }`
- [ ] 错误码映射正确（如 `invalid_api_key`、`unauthorized`）

### 6.3 权限校验
- [ ] 从非白名单页面调用 IPC
  - 验证：返回 `{ success: false, error: { code: 'unauthorized' } }`

---

## 7. 数据库迁移测试

### 7.1 Schema 执行
- [ ] 删除 `ielts-writing.db`，重新启动应用
  - 验证：数据库自动创建，所有表和索引存在

### 7.2 默认设置初始化
- [ ] 新数据库中 `app_settings` 表包含 8 条默认记录
  - 验证：language, temperature_mode, max_tokens 等

---

## 验证方式

### 手动测试（推荐）
创建一个简单的测试页面或 Node.js 脚本：

```javascript
// test-backend.js
const { ipcRenderer } = require('electron');

async function testTopics() {
    console.log('Testing topics:create...');
    const result = await ipcRenderer.invoke('topics:create', {
        type: 'task1',
        category: 'bar_chart',
        difficulty: 3,
        title_json: JSON.stringify({ type: 'doc', content: [...] })
    });
    console.log('Result:', result);
}

testTopics();
```

### 使用 Electron DevTools Console
在写作页面打开 DevTools，直接调用 `window.writingAPI.*` 方法测试。

---

## 通过标准

- [ ] **核心路径 100% 通过**（CRUD、筛选、统计、导出）
- [ ] **边界条件有错误处理**（非法输入返回明确错误信息）
- [ ] **IPC 协议一致**（success/error 格式统一）
- [ ] **文档与实现一致**（walkthrough.md 链接正确）
- [ ] **无 console.error 泄露**（除预期的验证失败）

通过后再进入 UI 开发，避免问题延迟暴露。
