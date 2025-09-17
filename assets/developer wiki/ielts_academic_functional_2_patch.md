# ielts_academic_functional_2 页面问题修复说明与补丁指引

本文仅针对 `.superdesign/design_iterations/ielts_academic_functional_2.html` 本题页面做最小化改动，不修改任何库脚本。你可按本指引手动修改与追加。变更均可随时回滚（删除追加的 `<script>` 或恢复按钮文案与事件即可）。

## 概述

需要解决的问题（以 index.html 和 wiki 中的既有 API 为准）：
- 清除缓存后，系统提示成功，但练习记录未清空；且返回题库浏览后题目无法打开（显示“题目不存在”）。
- 正常作答提交后，练习记录列表不更新，没有新增记录。
- 在练习记录中点击“批量删除”对单条记录删除后，列表不刷新或未被删除。
- “创建备份”应改为“备份列表”，并能弹出备份列表供选择（对齐 index.html 的 `showBackupList()`）。
- “重新加载题库”应改为“强制刷新题库”（调用 `loadLibrary(true)`）。

## 根因要点

- 本页大量直接使用 `localStorage` 读写；而系统核心模块采用统一的 `StorageManager`（全局 `storage.get/set/clear`，带前缀 `exam_system_`）。
- 练习记录的真实写入在核心记录器/ScoreStorage 中，列表若用 `localStorage` 直接读取就会「读不到/不同步」。
- 清缓存直接 `localStorage.clear()` 会清掉必要索引与配置，导致“题目不存在”；应在清理后立刻调用 `loadLibrary(true)` 重建索引，并刷新记录视图。

## 修改策略（最小化、可回滚）

仅做两处变更：
1) 引入 `DataIntegrityManager.js`（以支持“备份列表”）。
2) 在文件末尾追加一个小的覆盖脚本块：
   - 覆盖 `window.syncPracticeRecords`：优先用 `storage.get('practice_records')` 读取，兼容核心写入；统一展示字段。
   - 覆盖 `window.clearCache`：清理带前缀数据（或退回 localStorage），立刻 `loadLibrary(true)` 重建索引，并刷新记录视图（避免“题目不存在”）。
   - 包装批量删除执行段：当从选择模式回到删除执行时，对 `storage.set('practice_records', newList)` 生效，并刷新列表。
   - 运行时修正按钮文案与点击事件：将“创建备份”→“备份列表”，将“重新加载题库”→“强制刷新题库”。

> 说明：采用“运行时覆盖/包装”，不必改动现有函数定义处，便于随时回滚（仅删除末尾 `<script>` 即可）。

---

## 变更 1：引入 DataIntegrityManager（支持备份列表）

位置：在本页已有脚本引入区，紧跟 `../../js/components/PDFHandler.js` 之后，插入一行：

```html
<script src="../../js/components/DataIntegrityManager.js"></script>
```

此变更用于让 `showBackupList()` 能按 index.html 的方式弹出“备份列表”。

---

## 变更 2：在文末追加覆盖脚本

位置：在本页最后一个已有 `<script>` 之后、`</body>` 之前，直接追加以下脚本块。

```html
<script>
(function () {
  function safeGetRecords() {
    try {
      if (window.storage && typeof storage.get === 'function') {
        return storage.get('practice_records', []) || [];
      }
    } catch (_) {}
    try {
      return JSON.parse(localStorage.getItem('practice_records') || '[]');
    } catch (_) { return []; }
  }
  function safeSetRecords(list) {
    try {
      if (window.storage && typeof storage.set === 'function') {
        storage.set('practice_records', list || []);
        return;
      }
    } catch (_) {}
    try { localStorage.setItem('practice_records', JSON.stringify(list || [])); } catch(_) {}
  }
  function normalizeRecord(r) {
    var exam = (Array.isArray(window.examIndex) ? window.examIndex.find(e => String(e.id) === String(r.examId)) : null) || {};
    var percent = (typeof r.accuracy === 'number') ? Math.round(r.accuracy * 100) : (r.score || (r.realData && r.realData.percentage) || 0);
    var dur = r.duration || (r.realData && r.realData.duration) || 0;
    var when = r.endTime || r.createdAt || r.date || r.timestamp || Date.now();
    var title = (r.metadata && r.metadata.examTitle) || r.title || r.examName || exam.title || '未命名练习';
    var type = exam.type || r.type || (typeof getExamTypeFromCategory === 'function' ? getExamTypeFromCategory((r.metadata && r.metadata.category) || r.category) : 'reading');
    return {
      id: r.id || r.timestamp || Date.now(),
      examId: r.examId || '',
      title: title,
      type: type,
      score: percent,
      duration: dur,
      date: new Date(when).toISOString(),
      timestamp: when,
      realData: r.realData || null
    };
  }

  // 1) 覆盖同步：优先读取 storage（修复作答后记录不更新）
  var _oldSync = window.syncPracticeRecords;
  window.syncPracticeRecords = function () {
    try {
      var records = safeGetRecords();
      window.practiceRecords = (records || []).map(normalizeRecord);
      if (typeof updatePracticeView === 'function') updatePracticeView();
      try { if (typeof updateOverview === 'function') updateOverview(); } catch(_) {}
    } catch (e) {
      console.error('[design] syncPracticeRecords error', e);
      window.practiceRecords = [];
      if (typeof _oldSync === 'function') try { _oldSync(); } catch(_) {}
    }
  };

  // 2) 覆盖清缓存：清理带前缀存储 + 重建题库索引 + 刷新记录（修复1与4）
  var _oldClear = window.clearCache;
  window.clearCache = function () {
    if (!confirm('确定要清除所有缓存数据吗？此操作不可撤销！')) return;
    try {
      if (window.storage && typeof storage.clear === 'function') storage.clear();
      else { localStorage.clear(); }
    } catch (_) {}
    // 确保练习记录被清空
    safeSetRecords([]);
    try { if (typeof showMessage === 'function') showMessage('缓存已清除', 'success'); } catch(_) {}
    // 立刻重建题库索引，避免“题目不存在”
    try { if (typeof loadLibrary === 'function') loadLibrary(true); } catch(_) {}
    // 刷新练习记录视图
    setTimeout(function(){ try { window.syncPracticeRecords(); } catch(_) {} }, 200);
  };

  // 3) 批量删除执行段对接带前缀存储（修复3）
  var _oldBulk = window.bulkDeleteAction;
  window.bulkDeleteAction = function () {
    if (!window.bulkDeleteMode) { return _oldBulk ? _oldBulk() : null; }
    var ids = Array.from((window.selectedRecordIds || new Set())).map(String);
    if (ids.length === 0) { if (_oldBulk) return _oldBulk(); return; }
    var list = safeGetRecords();
    var setIds = new Set(ids);
    var newList = (list || []).filter(r => !setIds.has(String(r.id || r.timestamp)));
    safeSetRecords(newList);
    // 同步内存并刷新
    try { window.practiceRecords = (window.practiceRecords || []).filter(r => !setIds.has(String(r.id || r.timestamp))); } catch(_) {}
    try { if (typeof updatePracticeView === 'function') updatePracticeView(); } catch(_) {}
    try { if (typeof updateOverview === 'function') updateOverview(); } catch(_) {}
    try { (window.selectedRecordIds || new Set()).clear(); } catch(_) {}
    window.bulkDeleteMode = false;
    var btn = document.getElementById('bulk-delete-btn'); if (btn) btn.innerHTML = '<i class="fas fa-trash"></i> 批量删除';
    try { showMessage('删除成功', 'success'); } catch(_) {}
  };

  // 4) 运行时修正文案与绑定（修复5与6）
  window.addEventListener('DOMContentLoaded', function(){
    try {
      var settings = document.getElementById('settings-view');
      if (!settings) return;
      settings.querySelectorAll('button').forEach(function(btn){
        var txt = (btn.textContent || '').trim();
        if (txt.includes('创建备份')) {
          btn.innerHTML = '<i class="fas fa-list"></i> 备份列表';
          btn.onclick = function(){ if (typeof showBackupList === 'function') showBackupList(); else if (typeof createBackup === 'function') createBackup(); };
        }
        if (txt.includes('重新加载题库')) {
          btn.innerHTML = '<i class="fas fa-sync-alt"></i> 强制刷新题库';
          btn.onclick = function(){ try { loadLibrary(true); if (typeof showMessage==='function') showMessage('题库已强制刷新','success'); } catch(_) {} };
        }
      });
    } catch (_) {}
  });
})();
</script>
```

---

## 验证步骤

1) 清除缓存：
   - 点击清除缓存后，练习记录应变为空。
   - 切到“题库浏览”，题目列表可正常显示/打开（未出现“题目不存在”）。
2) 作答提交：
   - 完成作答触发 `PRACTICE_COMPLETE` 后约 1 秒，练习记录列表出现新记录。
3) 批量删除：
   - 开启批量删除→选择单条→完成选择，列表中该条被删除且刷新；刷新页面后不再出现。
4) 设置页按钮：
   - “创建备份”已显示为“备份列表”，点击弹出备份列表。
   - “重新加载题库”已显示为“强制刷新题库”，点击后提示“题库已强制刷新”。

## 回滚与注意

- 回滚：删除本文件追加的覆盖 `<script>`，以及移除 `DataIntegrityManager.js` 引入即可。
- 本指引不修改任何库脚本，仅对本题页面进行最小运行时覆盖，避免影响其他页面行为。
- 若后续将本页完全切换为统一的 `storage.*` 接口，则可逐步移除覆盖脚本中的适配分支。

