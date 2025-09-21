# v1.1.5 Recovery Task Log (English, sequential and minimal)

Read first, then execute strictly in order. Do not skip ahead. Verify after each task before moving on. This guide fixes:
- Overview renders but Browse view stays on “Loading…”.
- Exams list does not render until “Force refresh” is clicked.
- No handshake between parent and practice page; results not written back.
- Console shows errors like “filter is not a function”, “Assignment to const variable”, or header garbage (e.g. `xu is not defined`).

This guide changes no data formats and adds no new scripts; it only fixes syntax, load order, and async usage.

---

## 1) Disable cache and hard‑reload

- Open DevTools → Network → check “Disable cache”.
- Hard reload (Ctrl+Shift+R).
- Console quick check:
```js
typeof storage, typeof ExamSystemApp
```

---

## 2) Fix header garbage (Uncaught ReferenceError at line 1)

Symptom: `Uncaught ReferenceError: xu is not defined` (often `js/app.js:1`) or any stray identifier.

Action:
1) Open the reported file (e.g., `js/app.js`).
2) Remove any stray characters at the very top (e.g., `xu`, BOM/garbage). The file should start with a comment block (`/** ... */`) or `class ...` — nothing before that.
3) Save as UTF‑8 (no BOM). Reload and confirm the error is gone:
```js
typeof ExamSystemApp === 'function'
```

---

## 3) Validate data scripts are loaded (must pass)

Run in Console on the overview page:
```js
Array.isArray(window.completeExamIndex), window.completeExamIndex?.length
Array.isArray(window.listeningExamIndex), window.listeningExamIndex?.length
```
Expected: both are arrays with length > 0.

If not, fix syntax in:
- `assets/scripts/complete-exam-data.js`
- `assets/scripts/listening-exam-data.js`

Top-level must be valid JS assignment:
```js
window.completeExamIndex = [ { id: '...', title: '...', category: 'P1', frequency: 'high', path: '...', filename: '...', hasHtml: true, hasPdf: true, pdfFilename: '...' }, ... ];
```
- Every string is closed; items separated by commas.
- Do not add `type` for reading items (main injects it).

---

## 4) main.js → loadLibrary: cache, rebuild, DO NOT write empty

In `js/main.js`, inside `async function loadLibrary(forceReload = false)`:

4.1 Read active key and cache with `await` (top lines):
```js
const activeConfigKey = await getActiveLibraryConfigurationKey();
let cachedData = await storage.get(activeConfigKey);
```

4.2 Use cache only when it is a non‑empty array:
```js
if (!forceReload && Array.isArray(cachedData) && cachedData.length > 0) {
  examIndex = cachedData;
  try {
    const configs = await storage.get('exam_index_configurations', []);
    if (!configs.some(c => c.key === 'exam_index')) {
      configs.push({ name: '默认题库', key: 'exam_index', examCount: examIndex.length || 0, timestamp: Date.now() });
      await storage.set('exam_index_configurations', configs);
    }
    const activeKey = await storage.get('active_exam_index_key');
    if (!activeKey) await storage.set('active_exam_index_key', 'exam_index');
  } catch (_) {}
  finishLibraryLoading(startTime);
  return;
}
```

4.3 Rebuild from scripts — DO NOT write empty index:
```js
let readingExams = Array.isArray(window.completeExamIndex)
  ? window.completeExamIndex.map(e => ({ ...e, type: 'reading' }))
  : [];
let listeningExams = Array.isArray(window.listeningExamIndex)
  ? window.listeningExamIndex
  : [];

if (readingExams.length === 0 && listeningExams.length === 0) {
  examIndex = [];
  finishLibraryLoading(startTime); // no empty writeback
  return;
}

examIndex = [...readingExams, ...listeningExams];
await storage.set(activeConfigKey, examIndex);
await saveLibraryConfiguration('默认题库', activeConfigKey, examIndex.length);
await setActiveLibraryConfiguration(activeConfigKey);
finishLibraryLoading(startTime);
```

4.4 Split any two awaits on a single commented line (critical):
```js
// WRONG: second await is swallowed by the comment
await storage.set(activeConfigKey, examIndex); // cache        await saveLibraryConfiguration(...)

// RIGHT:
await storage.set(activeConfigKey, examIndex); // cache
await saveLibraryConfiguration('默认题库', activeConfigKey, examIndex.length);
```

4.5 Fix corrupted strings (if present):
- Replace any `将使用空索引继…` with `将使用空索引继续` and ensure quotes/parentheses close properly.

---

## 5) main.js → finishLibraryLoading: expose index globally

At the start of `finishLibraryLoading(startTime)` (before UI updates):
```js
try { window.examIndex = examIndex; } catch(_) {}
updateOverview();
updateSystemInfo();
window.dispatchEvent(new CustomEvent('examIndexLoaded'));
```

---

## 6) index.html → script order

Ensure the following order to satisfy dependencies:
1) Data scripts (must be first):
   - `assets/scripts/complete-exam-data.js`
   - `assets/scripts/listening-exam-data.js`
2) Utils & storage:
   - `js/utils/helpers.js`
   - `js/utils/storage.js`
   - (optional) `js/utils/asyncExportHandler.js`
3) Core & components:
   - `js/core/scoreStorage.js`
   - `js/core/practiceRecorder.js`
   - `js/components/*` (PDFHandler, IndexValidator, etc.)
4) Business entry (load last):
   - `js/utils/dataConsistencyManager.js`
   - `js/utils/markdownExporter.js`
   - `js/components/practiceRecordModal.js`
   - `js/components/practiceHistoryEnhancer.js`
   - `js/utils/componentChecker.js`
   - `js/theme-switcher.js`
   - `js/main.js`
   - `js/boot-fallbacks.js`
   - `js/app.js`  ← LAST

Reload and check Network has no 404, Console has no Uncaught ReferenceError/SyntaxError.

---

## 7) Browse view stuck on “Loading…” — bind and hide

In `js/main.js`, add once:
```js
window.addEventListener('examIndexLoaded', () => {
  try {
    if (typeof loadExamList === 'function') loadExamList();
    const loading = document.querySelector('#browse-view .loading');
    if (loading) loading.style.display = 'none';
  } catch(_) {}
});

// Optional fallback (fires once more in case the event was missed)
setTimeout(() => {
  try {
    if (Array.isArray(window.examIndex) && window.examIndex.length > 0) {
      if (typeof loadExamList === 'function') loadExamList();
      const loading = document.querySelector('#browse-view .loading');
      if (loading) loading.style.display = 'none';
    }
  } catch(_) {}
}, 600);
```

Also verify `displayExams` hides the spinner after rendering:
```js
function displayExams(exams) {
  const container = document.getElementById('exam-list-container');
  const loadingIndicator = document.querySelector('#browse-view .loading');
  if (exams.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 40px;"><p>未找到匹配的题目</p></div>`;
  } else {
    container.innerHTML = `<div class="exam-list">${exams.map(renderExamItem).join('')}</div>`;
  }
  if (loadingIndicator) loadingIndicator.style.display = 'none';
}
```

Ensure the HTML structure contains `#exam-list-container` and `.loading` under `#browse-view`.

---

## 8) Practice records: coerce to arrays before filtering

Fix “filter is not a function” by always coercing to arrays.

In `js/main.js` → `syncPracticeRecords()` after computing `records`:
```js
const safe = Array.isArray(records) ? records : [];
window.practiceRecords = safe;
practiceRecords = safe;
if (typeof updatePracticeView === 'function') updatePracticeView();
```

In `updatePracticeView()` and any similar usage, replace:
```js
const records = (window.practiceRecords || []).filter(...)
```
with:
```js
const list = Array.isArray(window.practiceRecords) ? window.practiceRecords : [];
const records = list.filter(r => r.dataSource === 'real' || r.dataSource === undefined);
```

---

## 9) app.js: await storage everywhere; async openExam

Make sure:
- `openExam` is `async` and awaits:
  - `storage.get('active_exam_index_key', 'exam_index')`
  - `storage.get(activeKey, [])` and fallback to `storage.get('exam_index', [])`
  - `this.startPracticeSession(examId)`
- Use `await storage.get/set` in:
  - `loadUserStats`, `updateOverviewStats`, `saveRealPracticeData`
  - notifications showing exam info (read `exam_index` with await)
  - session cleanup and error loggers (`active_sessions`, `injection_errors`, `collection_errors`)

---

## 10) PracticeRecorder: “Assignment to const variable” (fallback used)

Symptom from logs: `PracticeRecorder 初始化失败: TypeError: Assignment to constant variable` at `restoreActiveSessions`.

Fix in `js/core/practiceRecorder.js`:
- Do not reassign a `const`. Use `let` or a new variable:
```js
// WRONG
const storedSessions = ...; storedSessions = Array.isArray(storedSessions) ? storedSessions : [];

// RIGHT
let storedSessions = ...; storedSessions = Array.isArray(storedSessions) ? storedSessions : [];
// or
const raw = ...; const storedSessions = Array.isArray(raw) ? raw : [];
```

Reload; the recorder should initialize without falling back.

---

## 11) Clear index cache and retest

Run in Console:
```js
await storage.remove('exam_index');
await storage.remove('active_exam_index_key');
await storage.set('exam_index_configurations', []);
```

Reload (cache disabled). This forces `loadLibrary` to rebuild from scripts.

---

## 12) Handshake and write‑back: expected signals

Open any exam and look for these in the parent Console:
- `[System] 发送初始化消息到练习页 ...`
- `[App] 收到练习页面消息: SESSION_READY ...`

Complete a practice; expect PRACTICE_COMPLETE, records refreshed in UI.

Storage sanity check:
```js
await storage.get('practice_records', []).then(r => ({ count: r.length, last: r[0] }))
```

If any step fails, fix that step first before proceeding. Share the exact Console output for the failing step to extend this guide with the smallest possible patch block for that function only.

