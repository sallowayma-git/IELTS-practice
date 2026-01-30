# Backend Verification 使用说明

## 执行方式

### 方式 1：在 DevTools Console 中运行（推荐）

1. 启动应用并打开写作模块（writing.html）
2. 打开 DevTools Console (`Cmd+Option+I` / `F12`)
3. 加载测试脚本：

```javascript
// 方法 A: 直接复制粘贴 backend-verification.js 的全部内容到 Console

// 方法 B: 如果脚本已在项目中，通过 script 标签加载（需要修改 writing.html）
```

4. 执行测试：

```javascript
const verifier = new BackendVerifier();
await verifier.runAll();
```

5. 查看结果：
   - Console 会实时输出 ✅/❌ 测试结果
   - 最后输出汇总表格

---

### 方式 2：在 HTML 页面中自动运行

修改 `apps/writing-vue/public/writing.html`，在 `<body>` 底部添加：

```html
<script src="../../developer/tests/backend-verification.js"></script>
<script>
  window.addEventListener('load', async () => {
    // 等待 Vue 应用初始化
    setTimeout(async () => {
      const verifier = new BackendVerifier();
      await verifier.runAll();
    }, 2000);
  });
</script>
```

---

## 测试覆盖范围

### 1. IPC 协议一致性 ⚠️ **关键**
- ✅ 成功响应格式 `{ success: true, data: ... }`
- ✅ 错误响应格式 `{ success: false, error: { code, message } }`

### 2. Topics (题目管理)
- ✅ 创建题目 → 查询 → 删除
- ✅ 列表筛选与分页
- ⚠️ **边界测试**：非法 category (task1 + education)
- ✅ 批量导入

### 3. Essays (历史记录)
- ✅ 创建记录 → 查询 → 删除
- ✅ 列表筛选
- ✅ 统计数据（平均分、数量）
- ⚠️ **CSV 导出**（包含 JSON 解析测试）

### 4. Settings (应用设置)
- ✅ 获取所有设置
- ✅ 更新设置
- ⚠️ **边界测试**：非法语言值
- ✅ 重置为默认

### 5. Upload (图片上传) ⚠️ **关键**
- ✅ 上传合法图片（1x1 PNG）
- ✅ 获取图片路径
- ⚠️ **边界测试**：非法文件类型 (PDF)
- ✅ 删除图片

### 6. Draft (草稿) ⚠️ **file:// 协议关键测试**
- ✅ localStorage 可用性
- ✅ 草稿存取
- ⚠️ **QuotaExceededError** 处理（1MB 内容测试）

---

## 预期结果

**正常情况**：
- Passed: 22-24 (所有核心路径通过)
- Failed: 0

**可接受的失败**（取决于环境）：
- `Draft: QuotaExceededError` 失败（说明 localStorage 容量有限制）
- `Upload: Invalid file type` 如果错误信息不完全匹配（但应该抛出错误）

**不可接受的失败**：
- IPC 协议格式错误
- CRUD 操作失败
- 数据库查询失败

---

## 结果记录到 walkthrough

执行完成后，将结果记录到 `walkthrough.md`：

```markdown
## Backend Verification Results (2026-01-30)

✅ **Passed: 24/24**

- IPC Protocol: ✅
- Topics CRUD + Batch Import: ✅
- Essays CRUD + CSV Export: ✅
- Settings validation: ✅
- Upload with edge cases: ✅
- Draft localStorage (file://): ✅

### 发现的问题
- 无

### 边界条件验证
- 非法 category 正确拒绝 ✅
- 非法文件类型正确拒绝 ✅
- QuotaExceededError 正确处理 ✅
```

---

## 故障排查

### localStorage 不可用（file:// 协议）
**症状**：`Draft: localStorage availability` 失败  
**解决**：考虑修改 `useDraft.js` 使用 SQLite 存储

### CSV 导出编码错误
**症状**：CSV 包含乱码  
**解决**：检查 `essay.service.js` 的 `_extractTextFromTiptap()` 方法

### IPC 返回格式不一致
**症状**：某些 API 返回格式不匹配  
**解决**：检查 `ipc-handlers.js` 中的 `_handleAsync()` 包装

---

## 清理测试数据

测试完成后，手动清理：

```javascript
// 清理可能残留的测试题目
const topics = await window.writingAPI.topics.list({}, { page: 1, limit: 100 });
const testTopics = topics.data.filter(t => t.title_json.includes('Verification') || t.title_json.includes('Batch Import'));
for (const topic of testTopics) {
    await window.writingAPI.topics.delete(topic.id);
}

// 清理测试作文记录
const essays = await window.writingAPI.essays.list({}, { page: 1, limit: 100 });
const testEssays = essays.data.filter(e => e.content.includes('verification'));
for (const essay of testEssays) {
    await window.writingAPI.essays.delete(essay.id);
}
```
