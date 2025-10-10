// Main JavaScript logic for the application
// This file is the result of refactoring the inline script from improved-working-system.html

const legacyStateAdapter = window.LegacyStateAdapter ? window.LegacyStateAdapter.getInstance() : null;
const initialBrowseFilter = legacyStateAdapter ? legacyStateAdapter.getBrowseFilter() : { category: 'all', type: 'all' };

// === 关键全局状态变量 (必须保持全局可访问) ===
let examIndex = legacyStateAdapter ? legacyStateAdapter.getExamIndex() : [];
let practiceRecords = legacyStateAdapter ? legacyStateAdapter.getPracticeRecords() : [];
let filteredExams = [];
let currentCategory = initialBrowseFilter.category || 'all';
let currentExamType = initialBrowseFilter.type || 'all';
let bulkDeleteMode = false;
let selectedRecords = new Set();

function normalizeRecordId(id) {
    if (id == null) {
        return '';
    }
    return String(id);
}

if (typeof window !== 'undefined') {
    window.normalizeRecordId = normalizeRecordId;
}
let fallbackExamSessions = new Map();
let processedSessions = new Set();
let practiceListScroller = null;
let app = null;
let pdfHandler = null;
let browseStateManager = null;

let examListViewInstance = null;
let practiceDashboardViewInstance = null;
let legacyNavigationController = null;

const MESSAGE_CONTAINER_ID = 'message-container';
const MESSAGE_ICONS = {
    error: '❌',
    success: '✅',
    warning: '⚠️',
    info: 'ℹ️'
};

function syncGlobalBrowseState(category, type) {
    const browseDescriptor = Object.getOwnPropertyDescriptor(window, '__browseFilter');
    if (!browseDescriptor || typeof browseDescriptor.set !== 'function') {
        try {
            window.__browseFilter = { category, type };
        } catch (_) {}
    }

    const legacyTypeDescriptor = Object.getOwnPropertyDescriptor(window, '__legacyBrowseType');
    if (!legacyTypeDescriptor || typeof legacyTypeDescriptor.set !== 'function') {
        try { window.__legacyBrowseType = type; } catch (_) {}
    }
}

if (legacyStateAdapter) {
    legacyStateAdapter.subscribe('examIndex', (value) => {
        examIndex = Array.isArray(value) ? value : [];
    });
    legacyStateAdapter.subscribe('practiceRecords', (value) => {
        practiceRecords = Array.isArray(value) ? value : [];
    });
    legacyStateAdapter.subscribe('browseFilter', (value) => {
        const normalized = value || { category: 'all', type: 'all' };
        currentCategory = typeof normalized.category === 'string' ? normalized.category : 'all';
        currentExamType = typeof normalized.type === 'string' ? normalized.type : 'all';

        syncGlobalBrowseState(currentCategory, currentExamType);
    });
}

function ensureMessageContainer() {
    if (typeof document === 'undefined') {
        return null;
    }
    let container = document.getElementById(MESSAGE_CONTAINER_ID);
    if (!container) {
        container = document.createElement('div');
        container.id = MESSAGE_CONTAINER_ID;
        container.className = 'message-container';
        document.body.appendChild(container);
    }
    return container;
}

function createMessageNode(message, type) {
    const note = document.createElement('div');
    note.className = 'message ' + (type || 'info');
    const icon = document.createElement('strong');
    icon.textContent = MESSAGE_ICONS[type] || MESSAGE_ICONS.info;
    note.appendChild(icon);
    note.appendChild(document.createTextNode(' ' + String(message || '')));
    return note;
}
function setExamIndexState(list) {
    const normalized = Array.isArray(list) ? list : [];
    if (legacyStateAdapter) {
        const updated = legacyStateAdapter.setExamIndex(normalized);
        examIndex = Array.isArray(updated) ? updated : normalized;
        return examIndex;
    }
    examIndex = normalized;
    try { window.examIndex = normalized; } catch (_) {}
    return examIndex;
}

function setPracticeRecordsState(records) {
    const normalized = Array.isArray(records) ? records : [];
    if (legacyStateAdapter) {
        const updated = legacyStateAdapter.setPracticeRecords(normalized);
        practiceRecords = Array.isArray(updated) ? updated : normalized;
        return practiceRecords;
    }
    practiceRecords = normalized;
    try { window.practiceRecords = normalized; } catch (_) {}
    return practiceRecords;
}

function setBrowseFilterState(category = 'all', type = 'all') {
    const normalized = {
        category: typeof category === 'string' ? category : 'all',
        type: typeof type === 'string' ? type : 'all'
    };
    if (legacyStateAdapter) {
        const updated = legacyStateAdapter.setBrowseFilter(normalized);
        currentCategory = updated.category || 'all';
        currentExamType = updated.type || 'all';
        syncGlobalBrowseState(currentCategory, currentExamType);
        return updated;
    }
    currentCategory = normalized.category;
    currentExamType = normalized.type;
    syncGlobalBrowseState(currentCategory, currentExamType);
    return normalized;
}


const preferredFirstExamByCategory = {
  'P1_reading': { id: 'p1-09', title: 'Listening to the Ocean 海洋探测' },
  'P2_reading': { id: 'p2-high-12', title: 'The fascinating world of attine ants 切叶蚁' },
  'P3_reading': { id: 'p3-high-11', title: 'The Fruit Book 果实之书' },
  'P1_listening': { id: 'listening-p3-01', title: 'Julia and Bob’s science project is due' },
  'P3_listening': { id: 'listening-p3-02', title: 'Climate change and allergies' }
};


function ensureExamListView() {
    if (!examListViewInstance && window.LegacyExamListView) {
        examListViewInstance = new window.LegacyExamListView({
            domAdapter: window.DOMAdapter,
            containerId: 'exam-list-container'
        });
    }
    return examListViewInstance;
}

  function ensurePracticeDashboardView() {
      if (!practiceDashboardViewInstance && window.PracticeDashboardView) {
          practiceDashboardViewInstance = new window.PracticeDashboardView({
              domAdapter: window.DOMAdapter
          });
      }
      return practiceDashboardViewInstance;
  }

  function ensureLegacyNavigation(options) {
      if (typeof window.ensureLegacyNavigationController !== 'function') {
          return null;
      }

      var mergedOptions = Object.assign({
          containerSelector: '.main-nav',
          activeClass: 'active',
          syncOnNavigate: true,
          onNavigate: function onNavigate(viewName) {
              if (typeof window.showView === 'function') {
                  window.showView(viewName);
                  return;
              }
              if (window.app && typeof window.app.navigateToView === 'function') {
                  window.app.navigateToView(viewName);
              }
          }
      }, options || {});

      legacyNavigationController = window.ensureLegacyNavigationController(mergedOptions);
      return legacyNavigationController;
  }

  // --- Initialization ---
function initializeLegacyComponents() {
    try { showMessage('系统准备就绪', 'success'); } catch(_) {}

    try {
        ensureLegacyNavigation({ initialView: 'overview' });
    } catch (error) {
        console.warn('[Navigation] 初始化导航控制器失败:', error);
    }

    // Setup UI Listeners
    const folderPicker = document.getElementById('folder-picker');
    if (folderPicker) {
        folderPicker.addEventListener('change', handleFolderSelection);
    }

    // Initialize components
    if (window.PDFHandler) {
        pdfHandler = new PDFHandler();
        console.log('[System] PDF处理器已初始化');
    }
    if (window.BrowseStateManager) {
        browseStateManager = new BrowseStateManager();
        console.log('[System] 浏览状态管理器已初始化');
    }
    if (window.DataIntegrityManager) {
        window.dataIntegrityManager = new DataIntegrityManager();
        console.log('[System] 数据完整性管理器已初始化');
    } else {
        console.warn('[System] DataIntegrityManager类未加载');
    }

    // 初始化性能优化器 - 关键性能修复
    if (window.PerformanceOptimizer) {
        window.performanceOptimizer = new PerformanceOptimizer();
        console.log('[System] 性能优化器已初始化');
    } else {
        console.warn('[System] PerformanceOptimizer类未加载');
    }

    // Clean up old cache and configurations for v1.1.0 upgrade (one-time only)
    try {
      const done = localStorage.getItem('upgrade_v1_1_0_cleanup_done');
      if (!done) {
        cleanupOldCache().finally(() => {
          try { localStorage.setItem('upgrade_v1_1_0_cleanup_done','1'); } catch(_) {}
        });
      }
    } catch(_) {}

    // 防止索引在每次加载时被清空 - 新增修复3A
    try {
      const cleanupDone = localStorage.getItem('upgrade_v1_1_0_cleanup_done');
      if (!cleanupDone) {
        console.log('[System] 首次运行，执行升级清理...');
        cleanupOldCache().finally(() => {
          try { localStorage.setItem('upgrade_v1_1_0_cleanup_done','1'); } catch(_) {}
        });
      } else {
        console.log('[System] 升级清理已完成，跳过重复清理');
      }
    } catch(_) {}


    // Load data and setup listeners
    loadLibrary();
    syncPracticeRecords(); // Load initial records and update UI
    setupMessageListener(); // Listen for updates from child windows
    setupStorageSyncListener(); // Listen for storage changes from other tabs
}

// Clean up old cache and configurations
async function cleanupOldCache() {
    try {
        console.log('[System] 正在清理旧缓存与配置...');
        await storage.remove('exam_index');
        await storage.remove('active_exam_index_key');
        await storage.set('exam_index_configurations', []);
        console.log('[System] 旧缓存清理完成');
    } catch (error) {
        console.warn('[System] 清理旧缓存时出错:', error);
    }
}


// --- Data Loading and Management ---

async function syncPracticeRecords() {
    console.log('[System] 正在从存储中同步练习记录...');
    let records = [];
    try {
        // Prefer normalized records from ScoreStorage via PracticeRecorder
        const pr = window.app && window.app.components && window.app.components.practiceRecorder;
        if (pr && typeof pr.getPracticeRecords === 'function') {
            const maybePromise = pr.getPracticeRecords();
            const res = (typeof maybePromise?.then === 'function') ? await maybePromise : maybePromise;
            records = Array.isArray(res) ? res : [];
        } else {
            // Fallback: read raw storage and defensively normalize minimal fields
            const raw = await storage.get('practice_records', []) || [];
            const base = Array.isArray(raw) ? raw : [];
            records = base.map(r => {
                const rd = (r && r.realData) || {};
                const sInfo = r && (r.scoreInfo || rd.scoreInfo) || {};
                const correct = (typeof r.correctAnswers === 'number') ? r.correctAnswers : (typeof sInfo.correct === 'number' ? sInfo.correct : (typeof r.score === 'number' ? r.score : 0));
                const total = (typeof r.totalQuestions === 'number') ? r.totalQuestions : (typeof sInfo.total === 'number' ? sInfo.total : (rd.answers ? Object.keys(rd.answers).length : 0));
                const acc = (typeof r.accuracy === 'number') ? r.accuracy : (total > 0 ? (correct / total) : 0);
                const pct = (typeof r.percentage === 'number') ? r.percentage : Math.round(acc * 100);
                let dur = (typeof r.duration === 'number') ? r.duration : undefined;
                if (!(Number.isFinite(dur) && dur > 0)) {
                    if (typeof rd.duration === 'number' && rd.duration > 0) {
                        dur = rd.duration;
                    } else {
                        // try compute from timestamps if available
                        const s = r.startTime ? new Date(r.startTime).getTime() : NaN;
                        const e = r.endTime ? new Date(r.endTime).getTime() : NaN;
                        if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
                            dur = Math.round((e - s)/1000);
                        } else {
                            dur = 0;
                        }
                    }
                }
                return { ...r, accuracy: acc, percentage: pct, duration: dur, correctAnswers: (r.correctAnswers ?? correct), totalQuestions: (r.totalQuestions ?? total) };
            });
        }
    } catch (e) {
        console.warn('[System] 同步记录时发生错误，使用存储原始数据:', e);
        const raw = await storage.get('practice_records', []);
        records = Array.isArray(raw) ? raw : [];
    }

    // Normalize duration and percentages to avoid 0-second artifacts
    try {
        records = (records || []).map(r => {
            const rd = (r && r.realData) || {};
            let duration = (typeof r.duration === 'number') ? r.duration : undefined;
            if (!(Number.isFinite(duration) && duration > 0)) {
                const sInfo = r && (r.scoreInfo || rd.scoreInfo) || {};
                const candidates = [
                    r.duration, rd.duration, r.durationSeconds, r.duration_seconds,
                    r.elapsedSeconds, r.elapsed_seconds, r.timeSpent, r.time_spent,
                    rd.durationSeconds, rd.elapsedSeconds, rd.timeSpent,
                    sInfo.duration, sInfo.timeSpent
                ];
                for (const v of candidates) {
                    const n = Number(v);
                    if (Number.isFinite(n) && n > 0) { duration = Math.floor(n); break; }
                }
                if (!(Number.isFinite(duration) && duration > 0) && r && r.startTime && r.endTime) {
                    const s = new Date(r.startTime).getTime();
                    const e = new Date(r.endTime).getTime();
                    if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
                        duration = Math.round((e - s) / 1000);
                    }
                }
                if (!(Number.isFinite(duration) && duration > 0) && rd && Array.isArray(rd.interactions) && rd.interactions.length) {
                    try {
                        const ts = rd.interactions.map(x => x && Number(x.timestamp)).filter(n => Number.isFinite(n));
                        if (ts.length) {
                            const span = Math.max(...ts) - Math.min(...ts);
                            if (Number.isFinite(span) && span > 0) duration = Math.floor(span / 1000);
                        }
                    } catch(_) {}
                }
            }
            if (!Number.isFinite(duration)) duration = 0;

            // Coerce percentage/accuracy if only scoreInfo exists
            const sInfo = r && (r.scoreInfo || rd.scoreInfo) || {};
            const correct = (typeof r.correctAnswers === 'number') ? r.correctAnswers : (typeof sInfo.correct === 'number' ? sInfo.correct : (typeof r.score === 'number' ? r.score : undefined));
            const total = (typeof r.totalQuestions === 'number') ? r.totalQuestions : (typeof sInfo.total === 'number' ? sInfo.total : (rd.answers ? Object.keys(rd.answers).length : undefined));
            let accuracy = (typeof r.accuracy === 'number') ? r.accuracy : undefined;
            let percentage = (typeof r.percentage === 'number') ? r.percentage : undefined;
            if ((accuracy === undefined || percentage === undefined) && Number.isFinite(correct) && Number.isFinite(total) && total > 0) {
                const acc = correct / total;
                if (accuracy === undefined) accuracy = acc;
                if (percentage === undefined) percentage = Math.round(acc * 100);
            }

            return { ...r, duration, accuracy: (accuracy ?? r.accuracy), percentage: (percentage ?? r.percentage) };
        });
    } catch (e) { console.warn('[System] normalize durations failed:', e); }

    // 新增修复3D：确保全局变量是UI的单一数据源
    practiceRecords = setPracticeRecordsState(records);

    console.log(`[System] ${records.length} 条练习记录已加载到内存。`);
    updatePracticeView();
}

function setupMessageListener() {
    window.addEventListener('message', (event) => {
        // 更兼容的安全检查：允许同源或file协议下的子窗口
        try {
            if (event.origin && event.origin !== 'null' && event.origin !== window.location.origin) {
                return;
            }
        } catch (_) {}

        const data = event.data || {};
        const type = data.type;
        if (type === 'SESSION_READY') {
            // 子页未携带 sessionId，这里基于 event.source 匹配对应会话并停止握手重试
            try {
                for (const [sid, rec] of fallbackExamSessions.entries()) {
                    if (rec && rec.win === event.source) {
                        if (rec.timer) clearInterval(rec.timer);
                        console.log('[Fallback] 会话就绪(匹配到窗口):', sid);
                        break;
                    }
                }
            } catch (_) {}
        } else if (type === 'PRACTICE_COMPLETE' || type === 'practice_completed') {
            const sessionId = (data && data.sessionId) || null;
            const rec = sessionId ? fallbackExamSessions.get(sessionId) : null;
            if (rec) {
                console.log('[Fallback] 收到练习完成（降级路径），保存真实数据');
                savePracticeRecordFallback(rec.examId, data).finally(() => {
                    try { if (rec && rec.timer) clearInterval(rec.timer); } catch(_) {}
                    try { fallbackExamSessions.delete(sessionId); } catch(_) {}
                    showMessage('练习已完成，正在更新记录...', 'success');
                    setTimeout(syncPracticeRecords, 300);
                });
            } else {
                console.log('[System] 收到练习完成消息，正在同步记录...');
                showMessage('练习已完成，正在更新记录...', 'success');
                setTimeout(syncPracticeRecords, 300);
            }
        }
    });
}

function setupStorageSyncListener() {
    window.addEventListener('storage-sync', (event) => {
        console.log('[System] 收到存储同步事件，正在更新练习记录...', event.detail);
        //可以选择性地只更新受影响的key，但为了简单起见，我们直接同步所有记录
        // if (event.detail && event.detail.key === 'practice_records') {
            syncPracticeRecords();
        // }
    });
}

// 降级保存：将 PRACTICE_COMPLETE 的真实数据写入 practice_records（与旧视图字段兼容）
async function savePracticeRecordFallback(examId, realData) {
  try {
    const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
    const exam = list.find(e => e.id === examId) || {};

    const sInfo = realData && realData.scoreInfo ? realData.scoreInfo : {};
    const correct = typeof sInfo.correct === 'number' ? sInfo.correct : 0;
    const total = typeof sInfo.total === 'number' ? sInfo.total : (realData.answers ? Object.keys(realData.answers).length : 0);
    const acc = typeof sInfo.accuracy === 'number' ? sInfo.accuracy : (total > 0 ? correct / total : 0);
    const pct = typeof sInfo.percentage === 'number' ? sInfo.percentage : Math.round(acc * 100);

    const record = {
      id: Date.now(),
      examId: examId,
      title: exam.title || realData.title || '',
      category: exam.category,
      frequency: exam.frequency,
      realData: {
        score: correct,
        totalQuestions: total,
        accuracy: acc,
        percentage: pct,
        duration: realData.duration,
        answers: realData.answers || {},
        correctAnswers: realData.correctAnswers || {},
        interactions: realData.interactions || [],
        isRealData: true,
        source: sInfo.source || 'fallback'
      },
      dataSource: 'real',
      date: new Date().toISOString(),
      sessionId: realData.sessionId,
      timestamp: Date.now(),
      // 兼容旧视图字段
      score: correct,
      correctAnswers: correct,
      totalQuestions: total,
      accuracy: acc,
      percentage: pct,
      answers: realData.answers || {},
      startTime: new Date((realData.startTime ?? (Date.now() - (realData.duration || 0) * 1000))).toISOString(),
      endTime: new Date((realData.endTime ?? Date.now())).toISOString()
    };

    const records = await storage.get('practice_records', []);
    const arr = Array.isArray(records) ? records : [];
    arr.push(record);
    await storage.set('practice_records', arr);
    console.log('[Fallback] 真实数据已保存到 practice_records');
  } catch (e) {
    console.error('[Fallback] 保存练习记录失败:', e);
  }
}

async function loadLibrary(forceReload = false) {
    const startTime = performance.now();
    const activeConfigKey = await getActiveLibraryConfigurationKey();
    let cachedData = await storage.get(activeConfigKey);

    // 仅当缓存为非空数组时使用缓存
    if (!forceReload && Array.isArray(cachedData) && cachedData.length > 0) {
        examIndex = setExamIndexState(cachedData);
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

    // 新增修复3B：从脚本重建索引（阅读+听力），若两者皆无则不写入空索引
    try {
        let readingExams = [];
        if (Array.isArray(window.completeExamIndex)) {
            readingExams = window.completeExamIndex.map(exam => ({ ...exam, type: 'reading' }));
        }

        let listeningExams = [];
        if (Array.isArray(window.listeningExamIndex)) {
            listeningExams = window.listeningExamIndex; // 已含 type: 'listening'
        }

        if (readingExams.length === 0 && listeningExams.length === 0) {
            examIndex = setExamIndexState([]);
            finishLibraryLoading(startTime); // 不写入空索引，避免污染缓存
            return;
        }

        examIndex = setExamIndexState([...readingExams, ...listeningExams]);
        await storage.set(activeConfigKey, examIndex);
        await saveLibraryConfiguration('默认题库', activeConfigKey, examIndex.length);
        await setActiveLibraryConfiguration(activeConfigKey);

        finishLibraryLoading(startTime);
    } catch (error) {
        console.error('[Library] 加载题库失败:', error);
        if (typeof showMessage === 'function') {
            showMessage('题库刷新失败: ' + (error?.message || error), 'error');
        }
        window.__forceLibraryRefreshInProgress = false;
        examIndex = setExamIndexState([]);
        finishLibraryLoading(startTime);
    }
}
function finishLibraryLoading(startTime) {
    const loadTime = performance.now() - startTime;
    if (!legacyStateAdapter) {
        try { window.examIndex = examIndex; } catch (_) {}
    }
    // 修复题库索引加载链路问题：顺序为设置window.examIndex → updateOverview() → dispatchEvent('examIndexLoaded')
    updateOverview();
    window.dispatchEvent(new CustomEvent('examIndexLoaded'));
}

// --- UI Update Functions ---

let overviewViewInstance = null;

function getOverviewView() {
    if (!overviewViewInstance) {
        const OverviewView = window.AppViews && window.AppViews.OverviewView;
        if (typeof OverviewView !== 'function') {
            console.warn('[Overview] 未加载 OverviewView 模块，使用回退渲染逻辑');
            return null;
        }
        overviewViewInstance = new OverviewView({});
    }
    return overviewViewInstance;
}

function updateOverview() {
    const categoryContainer = document.getElementById('category-overview');
    if (!categoryContainer) {
        console.warn('[Overview] 找不到 category-overview 容器');
        return;
    }

    const statsService = window.AppServices && window.AppServices.overviewStats;
    const stats = statsService ?
        statsService.calculate(window.examIndex || []) :
        {
            reading: [],
            listening: [],
            meta: {
                readingUnknown: 0,
                listeningUnknown: 0,
                total: Array.isArray(window.examIndex) ? window.examIndex.length : 0,
                readingUnknownEntries: [],
                listeningUnknownEntries: []
            }
        };

    const view = getOverviewView();
    if (view && window.DOM && window.DOM.builder) {
        view.render(stats, {
            container: categoryContainer,
            actions: {
                onBrowseCategory: (category, type) => {
                    if (typeof browseCategory === 'function') {
                        browseCategory(category, type);
                    }
                },
                onRandomPractice: (category, type) => {
                    if (typeof startRandomPractice === 'function') {
                        startRandomPractice(category, type);
                    }
                }
            }
        });

        if (stats.meta?.readingUnknownEntries?.length) {
            console.warn('[Overview] 未知阅读类别:', stats.meta.readingUnknownEntries);
        }
        if (stats.meta?.listeningUnknownEntries?.length) {
            console.warn('[Overview] 未知听力类别:', stats.meta.listeningUnknownEntries);
        }
        return;
    }

    renderOverviewLegacy(categoryContainer, stats);
    setupOverviewInteractions();
}

function renderOverviewLegacy(container, stats) {
    if (!container) return;

    const adapter = window.DOMAdapter;
    if (!adapter) {
        console.warn('[Overview] DOMAdapter 未加载，跳过渲染');
        return;
    }

    const sections = [];

    const appendSection = (title, entries, icon) => {
        if (!entries || entries.length === 0) {
            return;
        }

        sections.push(adapter.create('h3', {
            className: 'overview-section-title',
            dataset: { overviewSection: title }
        }, [
            adapter.create('span', { className: 'overview-section-icon', ariaHidden: 'true' }, icon),
            adapter.create('span', { className: 'overview-section-label' }, title)
        ]));

        entries.forEach((entry) => {
            sections.push(adapter.create('div', {
                className: 'category-card',
                dataset: {
                    category: entry.category,
                    examType: entry.type
                }
            }, [
                adapter.create('div', { className: 'category-header' }, [
                    adapter.create('div', {
                        className: 'category-icon',
                        ariaHidden: 'true'
                    }, entry.type === 'reading' ? '📖' : '🎧'),
                    adapter.create('div', { className: 'category-details' }, [
                        adapter.create('div', { className: 'category-title' }, [
                            entry.category,
                            ' ',
                            entry.type === 'reading' ? '阅读' : '听力'
                        ]),
                        adapter.create('div', { className: 'category-meta' }, `${entry.total} 篇`)
                    ])
                ]),
                adapter.create('div', { className: 'category-card-actions' }, [
                    adapter.create('button', {
                        type: 'button',
                        className: 'btn category-action-button',
                        dataset: {
                            overviewAction: 'browse',
                            category: entry.category,
                            examType: entry.type
                        }
                    }, [
                        adapter.create('span', { className: 'category-action-icon', ariaHidden: 'true' }, '📚'),
                        adapter.create('span', { className: 'category-action-label' }, '浏览题库')
                    ]),
                    adapter.create('button', {
                        type: 'button',
                        className: 'btn btn-secondary category-action-button',
                        dataset: {
                            overviewAction: 'random',
                            category: entry.category,
                            examType: entry.type
                        }
                    }, [
                        adapter.create('span', { className: 'category-action-icon', ariaHidden: 'true' }, '🎲'),
                        adapter.create('span', { className: 'category-action-label' }, '随机练习')
                    ])
                ])
            ]));
        });
    };

    const readingEntries = (stats && stats.reading) || [];
    const listeningEntries = (stats && stats.listening ? stats.listening.filter((entry) => entry.total > 0) : []);

    appendSection('阅读', readingEntries, '📖');
    appendSection('听力', listeningEntries, '🎧');

    if (sections.length === 0) {
        sections.push(adapter.create('p', { className: 'overview-empty' }, '暂无题库数据'));
    }

    adapter.replaceContent(container, sections);
}

let overviewDelegatesConfigured = false;

function setupOverviewInteractions() {
    if (overviewDelegatesConfigured) {
        return;
    }

    const container = document.getElementById('category-overview');
    if (!container) {
        return;
    }

    const invokeAction = (target, event) => {
        const category = target.dataset.category;
        const type = target.dataset.examType || 'reading';
        const action = target.dataset.overviewAction;

        if (!action || !category) {
            return;
        }

        event.preventDefault();

        if (action === 'browse') {
            if (typeof browseCategory === 'function') {
                browseCategory(category, type);
            } else {
                try { applyBrowseFilter(category, type); } catch (_) {}
            }
            return;
        }

        if (action === 'random' && typeof startRandomPractice === 'function') {
            startRandomPractice(category, type);
        }
    };

    const hasDomDelegate = typeof window !== 'undefined'
        && window.DOM
        && typeof window.DOM.delegate === 'function';

    if (hasDomDelegate) {
        window.DOM.delegate('click', '#category-overview [data-overview-action]', function(event) {
            invokeAction(this, event);
        });
    } else {
        container.addEventListener('click', (event) => {
            const target = event.target.closest('[data-overview-action]');
            if (!target || !container.contains(target)) {
                return;
            }
            invokeAction(target, event);
        });
    }

    overviewDelegatesConfigured = true;
}

function getScoreColor(percentage) {
    if (window.PracticeHistoryRenderer && window.PracticeHistoryRenderer.helpers && typeof window.PracticeHistoryRenderer.helpers.getScoreColor === 'function') {
        return window.PracticeHistoryRenderer.helpers.getScoreColor(percentage);
    }
    const pct = Number(percentage) || 0;
    if (pct >= 90) return '#10b981';
    if (pct >= 75) return '#f59e0b';
    if (pct >= 60) return '#f97316';
    return '#ef4444';
}

function renderPracticeRecordItem(record) {
    if (!window.PracticeHistoryRenderer) {
        console.warn('[PracticeHistory] Renderer 未就绪，返回空节点');
        return null;
    }

    return window.PracticeHistoryRenderer.createRecordNode(record, {
        bulkDeleteMode,
        selectedRecords
    });
}

function renderPracticeHistoryEmptyState(container) {
    if (window.PracticeHistoryRenderer) {
        window.PracticeHistoryRenderer.renderEmptyState(container);
        return;
    }

    if (!container) return;
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }
    const placeholder = document.createElement('div');
    placeholder.textContent = '暂无任何练习记录';
    container.appendChild(placeholder);
}

let practiceHistoryDelegatesConfigured = false;

function setupPracticeHistoryInteractions() {
    if (practiceHistoryDelegatesConfigured) {
        return;
    }

    const container = document.getElementById('practice-history-list');
    if (!container) {
        return;
    }

    const handleDetails = (recordId, event) => {
        if (!recordId) return;
        if (event) event.preventDefault();
        if (typeof showRecordDetails === 'function') {
            showRecordDetails(recordId);
        }
    };

    const handleDelete = (recordId, event) => {
        if (!recordId) return;
        if (event) event.preventDefault();
        if (typeof deleteRecord === 'function') {
            deleteRecord(recordId);
        }
    };

    const handleSelection = (recordId, event) => {
        if (!bulkDeleteMode || !recordId) return;
        if (event) event.preventDefault();
        toggleRecordSelection(recordId);
    };

    const hasDomDelegate = typeof window !== 'undefined' && window.DOM && typeof window.DOM.delegate === 'function';

    if (hasDomDelegate) {
        window.DOM.delegate('click', '#practice-history-list [data-record-action="details"]', function(event) {
            handleDetails(this.dataset.recordId, event);
        });

        window.DOM.delegate('click', '#practice-history-list [data-record-action="delete"]', function(event) {
            handleDelete(this.dataset.recordId, event);
        });

        window.DOM.delegate('click', '#practice-history-list .history-item', function(event) {
            const actionTarget = event.target.closest('[data-record-action]');
            if (actionTarget) return;
            handleSelection(this.dataset.recordId, event);
        });
    } else {
        container.addEventListener('click', (event) => {
            const detailsTarget = event.target.closest('[data-record-action="details"]');
            if (detailsTarget && container.contains(detailsTarget)) {
                handleDetails(detailsTarget.dataset.recordId, event);
                return;
            }

            const deleteTarget = event.target.closest('[data-record-action="delete"]');
            if (deleteTarget && container.contains(deleteTarget)) {
                handleDelete(deleteTarget.dataset.recordId, event);
                return;
            }

            const item = event.target.closest('.history-item');
            if (item && container.contains(item)) {
                const actionTarget = event.target.closest('[data-record-action]');
                if (actionTarget) {
                    return;
                }
                handleSelection(item.dataset.recordId, event);
            }
        });
    }

    practiceHistoryDelegatesConfigured = true;
}

function updatePracticeView() {
    const rawRecords = Array.isArray(window.practiceRecords) ? window.practiceRecords : [];
    const records = rawRecords.filter((record) => record && (record.dataSource === 'real' || record.dataSource === undefined));

    const stats = window.PracticeStats;
    const summary = stats && typeof stats.calculateSummary === 'function'
        ? stats.calculateSummary(records)
        : computePracticeSummaryFallback(records);

    const dashboard = ensurePracticeDashboardView();
    if (dashboard) {
        dashboard.updateSummary(summary);
    } else {
        applyPracticeSummaryFallback(summary);
    }

    // --- 3. Filter and Render History List ---
    const historyContainer = document.getElementById('practice-history-list');
    if (!historyContainer) {
        return;
    }

    setupPracticeHistoryInteractions();

    let recordsToShow = stats && typeof stats.sortByDateDesc === 'function'
        ? stats.sortByDateDesc(records)
        : records.slice().sort((a, b) => new Date(b.date) - new Date(a.date));

    if (currentExamType !== 'all') {
        if (stats && typeof stats.filterByExamType === 'function') {
            recordsToShow = stats.filterByExamType(recordsToShow, examIndex, currentExamType);
        } else {
            recordsToShow = recordsToShow.filter((record) => {
                const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
                const exam = list.find((e) => e.id === record.examId || e.title === record.title);
                return exam && exam.type === currentExamType;
            });
        }
    }

    // --- 4. Render history list ---
    const renderer = window.PracticeHistoryRenderer;
    if (!renderer) {
        console.warn('[PracticeHistory] Renderer 未加载，渲染空状态');
        renderPracticeHistoryEmptyState(historyContainer);
        return;
    }

    renderer.destroyScroller(practiceListScroller);
    practiceListScroller = null;

    if (recordsToShow.length === 0) {
        renderPracticeHistoryEmptyState(historyContainer);
        return;
    }

    practiceListScroller = renderer.renderList(historyContainer, recordsToShow, {
        bulkDeleteMode,
        selectedRecords,
        scrollerOptions: { itemHeight: 100, containerHeight: 650 },
        itemFactory: renderPracticeRecordItem
    });
}

function computePracticeSummaryFallback(records) {
    const normalized = Array.isArray(records) ? records : [];
    const totalPracticed = normalized.length;
    let totalScore = 0;
    let totalDuration = 0;
    const dateStrings = [];

    normalized.forEach((record) => {
        if (!record) {
            return;
        }
        const percentage = typeof record.percentage === 'number' ? record.percentage : 0;
        const duration = typeof record.duration === 'number' ? record.duration : 0;
        totalScore += percentage;
        totalDuration += duration;

        if (record.date) {
            const time = new Date(record.date);
            if (!Number.isNaN(time.getTime())) {
                dateStrings.push(time.toDateString());
            }
        }
    });

    const uniqueDates = Array.from(new Set(dateStrings)).sort((a, b) => new Date(b) - new Date(a));
    let streak = 0;
    if (uniqueDates.length > 0) {
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        const firstDate = new Date(uniqueDates[0]);
        if (firstDate.toDateString() === today.toDateString() || firstDate.toDateString() === yesterday.toDateString()) {
            streak = 1;
            for (let i = 0; i < uniqueDates.length - 1; i += 1) {
                const currentDay = new Date(uniqueDates[i]);
                const nextDay = new Date(uniqueDates[i + 1]);
                const diffTime = currentDay - nextDay;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays === 1) {
                    streak += 1;
                } else {
                    break;
                }
            }
        }
    }

    return {
        totalPracticed,
        averageScore: totalPracticed > 0 ? totalScore / totalPracticed : 0,
        totalStudyMinutes: totalDuration / 60,
        streak
    };
}

function applyPracticeSummaryFallback(summary) {
    if (!summary || typeof document === 'undefined') {
        return;
    }

    const totalEl = document.getElementById('total-practiced');
    if (totalEl) {
        totalEl.textContent = typeof summary.totalPracticed === 'number' ? summary.totalPracticed : 0;
    }

    const avgEl = document.getElementById('avg-score');
    if (avgEl) {
        const avg = typeof summary.averageScore === 'number' ? summary.averageScore : 0;
        avgEl.textContent = `${avg.toFixed(1)}%`;
    }

    const timeEl = document.getElementById('study-time');
    if (timeEl) {
        const minutes = typeof summary.totalStudyMinutes === 'number' ? summary.totalStudyMinutes : 0;
        timeEl.textContent = Math.round(minutes).toString();
    }

    const streakEl = document.getElementById('streak-days');
    if (streakEl) {
        streakEl.textContent = typeof summary.streak === 'number' ? summary.streak : 0;
    }
}


// --- Event Handlers & Navigation ---


function browseCategory(category, type = 'reading') {

    // 先设置筛选器，确保 App 路径也能获取到筛选参数
    try {
        setBrowseFilterState(category, type);

        // 设置待处理筛选器，确保组件未初始化时筛选不会丢失
        try {
            window.__pendingBrowseFilter = { category, type };
        } catch (_) {
            // 如果全局变量设置失败，继续执行
        }
    } catch (error) {
        console.warn('[browseCategory] 设置筛选器失败:', error);
    }

    // 优先调用 window.app.browseCategory(category, type)
    if (window.app && typeof window.app.browseCategory === 'function') {
        try {
            window.app.browseCategory(category, type);
            console.log('[browseCategory] Called app.browseCategory');
            // 确保过滤应用，即使 app 处理
            setTimeout(() => loadExamList(), 100);
            return;
        } catch (error) {
            console.warn('[browseCategory] window.app.browseCategory 调用失败，使用降级路径:', error);
        }
    }

    // 降级路径：手动处理浏览筛选
    try {
        // 正确更新标题使用中文字符串
        const typeText = type === 'listening' ? '听力' : '阅读';
        const titleEl = document.getElementById('browse-title');
        if (titleEl) {
            titleEl.textContent = `📚 ${category} ${typeText}题库浏览`;
        }

        // 导航到浏览视图
        if (window.app && typeof window.app.navigateToView === 'function') {
            window.app.navigateToView('browse');
        } else if (typeof window.showView === 'function') {
            showView('browse', false);
        } else {
            try {
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                const target = document.getElementById('browse-view');
                if (target) target.classList.add('active');
            } catch(_) {}
        }

        // 确保题目列表被加载
        loadExamList();

    } catch (error) {
        console.error('[browseCategory] 处理浏览类别时出错:', error);
        showMessage('浏览类别时出现错误', 'error');
    }
}

function filterByType(type) {
    setBrowseFilterState('all', type);
    document.getElementById('browse-title').textContent = '📚 题库浏览';
    loadExamList();
}

// 应用分类筛选（供 App/总览调用）
function applyBrowseFilter(category = 'all', type = null) {
    try {
        // 归一化输入：兼容 "P1 阅读"/"P2 听力" 这类文案
        const raw = String(category || 'all');
        let normalizedCategory = 'all';
        const m = raw.match(/\bP[1-4]\b/i);
        if (m) normalizedCategory = m[0].toUpperCase();

        // 若未显式给出类型，从文案或题库推断
        if (!type || type === 'all') {
            if (/阅读/.test(raw)) type = 'reading';
            else if (/听力/.test(raw)) type = 'listening';
        }
        // 若未显式给出类型，则根据当前题库推断（同时存在时不限定类型）
        if (!type || type === 'all') {
            try {
                const hasReading = (examIndex || []).some(e => e.category === normalizedCategory && e.type === 'reading');
                const hasListening = (examIndex || []).some(e => e.category === normalizedCategory && e.type === 'listening');
                if (hasReading && !hasListening) type = 'reading';
                else if (!hasReading && hasListening) type = 'listening';
                else type = 'all';
            } catch (_) { type = 'all'; }
        }

        setBrowseFilterState(normalizedCategory, type);

        // 保持标题简洁
        const titleEl = document.getElementById('browse-title');
        if (titleEl) titleEl.textContent = '📚 题库浏览';

        // 若未在浏览视图，则尽力切换
        if (typeof window.showView === 'function' && !document.getElementById('browse-view')?.classList.contains('active')) {
            window.showView('browse', false);
        }

        loadExamList();
    } catch (e) {
        console.warn('[Browse] 应用筛选失败，回退到默认列表:', e);
        setBrowseFilterState('all', 'all');
        loadExamList();
    }
}

// Initialize browse view when it's activated
function initializeBrowseView() {
    console.log('[System] Initializing browse view...');
    setBrowseFilterState('all', 'all');
    document.getElementById('browse-title').textContent = '📚 题库浏览';
    loadExamList();
}

// 全局桥接：HTML 按钮 onclick="browseCategory('P1','reading')"
if (typeof window.browseCategory !== 'function') {
    window.browseCategory = function(category, type) {
        try {
            if (window.app && typeof window.app.browseCategory === 'function') {
                window.app.browseCategory(category, type);
                return;
            }
        } catch (_) {}
        // 回退：直接应用筛选
        try { applyBrowseFilter(category, type); } catch (_) {}
    };
}

function filterRecordsByType(type) {
    setBrowseFilterState(currentCategory, type);
    updatePracticeView();
}


function loadExamList() {
    // 使用 Array.from() 创建副本，避免污染全局 examIndex
    let examsToShow = Array.from(examIndex);

    // 先过滤
    if (currentExamType !== 'all') {
        examsToShow = examsToShow.filter(exam => exam.type === currentExamType);
    }
    if (currentCategory !== 'all') {
        examsToShow = examsToShow.filter(exam => exam.category === currentCategory);
    }

    // 然后置顶过滤后的数组
    if (currentCategory !== 'all' && currentExamType !== 'all') {
        const key = `${currentCategory}_${currentExamType}`;
        const preferred = preferredFirstExamByCategory[key];

        if (preferred) {
            // 优先通过 preferred.id 在过滤后的 examsToShow 中查找
            let preferredIndex = examsToShow.findIndex(exam => exam.id === preferred.id);

            // 如果失败，fallback 到 preferred.title + currentCategory + currentExamType 匹配
            if (preferredIndex === -1) {
                preferredIndex = examsToShow.findIndex(exam =>
                    exam.title === preferred.title &&
                    exam.category === currentCategory &&
                    exam.type === currentExamType
                );
            }

            if (preferredIndex > -1) {
                const [item] = examsToShow.splice(preferredIndex, 1);
                examsToShow.unshift(item);
            } else {
                console.warn('[PinTop] No match found in filtered examsToShow for preferred:', preferred);
            }
        }
    }

    filteredExams = examsToShow;
    displayExams(filteredExams);
}

function displayExams(exams) {
    const view = ensureExamListView();
    if (view) {
        view.render(exams, { loadingSelector: '#browse-view .loading' });
        setupExamActionHandlers();
        return;
    }

    const container = document.getElementById('exam-list-container');
    if (!container) {
        return;
    }

    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }

    const normalizedExams = Array.isArray(exams) ? exams : [];
    if (normalizedExams.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'exam-list-empty';
        empty.setAttribute('role', 'status');

        const icon = document.createElement('div');
        icon.className = 'exam-list-empty-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '🔍';

        const text = document.createElement('p');
        text.className = 'exam-list-empty-text';
        text.textContent = '未找到匹配的题目';

        const hint = document.createElement('p');
        hint.className = 'exam-list-empty-hint';
        hint.textContent = '请调整筛选条件或搜索词后再试';

        empty.appendChild(icon);
        empty.appendChild(text);
        empty.appendChild(hint);
        container.appendChild(empty);
        return;
    }

    const list = document.createElement('div');
    list.className = 'exam-list';

    normalizedExams.forEach((exam) => {
        if (!exam) {
            return;
        }
        const item = document.createElement('div');
        item.className = 'exam-item';
        if (exam.id) {
            item.dataset.examId = exam.id;
        }

        const info = document.createElement('div');
        info.className = 'exam-info';
        const infoContent = document.createElement('div');
        const title = document.createElement('h4');
        title.textContent = exam.title || '';
        const meta = document.createElement('div');
        meta.className = 'exam-meta';
        meta.textContent = `${exam.category || ''} | ${exam.type || ''}`;
        infoContent.appendChild(title);
        infoContent.appendChild(meta);
        info.appendChild(infoContent);

        const actions = document.createElement('div');
        actions.className = 'exam-actions';

        const startBtn = document.createElement('button');
        startBtn.className = 'btn exam-item-action-btn';
        startBtn.type = 'button';
        startBtn.dataset.action = 'start';
        if (exam.id) {
            startBtn.dataset.examId = exam.id;
        }
        startBtn.textContent = '开始';

        const pdfBtn = document.createElement('button');
        pdfBtn.className = 'btn btn-secondary exam-item-action-btn';
        pdfBtn.type = 'button';
        pdfBtn.dataset.action = 'pdf';
        if (exam.id) {
            pdfBtn.dataset.examId = exam.id;
        }
        pdfBtn.textContent = 'PDF';

        actions.appendChild(startBtn);
        actions.appendChild(pdfBtn);

        item.appendChild(info);
        item.appendChild(actions);
        list.appendChild(item);
    });

    container.appendChild(list);

    const loadingIndicator = document.querySelector('#browse-view .loading');
    if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
    }

    setupExamActionHandlers();
}

function resolveExamBasePath(exam) {
  let basePath = (exam && exam.path) ? String(exam.path) : "";
  try {
    const pathMap = getPathMap();
    const type = exam && exam.type;
    const root = type && pathMap[type] && pathMap[type].root ? String(pathMap[type].root) : "";
    if (root) {
      // 避免重复前缀（如 ListeningPractice/ 已在 path 中）
      const normalizedBase = basePath.replace(/\\/g, '/');
      const normalizedRoot = root.replace(/\\/g, '/');
      if (!normalizedBase.startsWith(normalizedRoot)) {
        basePath = normalizedRoot + basePath;
      }
    }
  } catch (_) {}
  if (!basePath.endsWith('/')) basePath += '/';
  basePath = basePath.replace(/\\/g, '/').replace(/\/+\//g, '/');
  return basePath;
}

function getPathMap() {
  try {
    // Try to load from JSON file first
    if (window.pathMap) {
      return window.pathMap;
    }

    // 新增修复3F：路径映射修复 - 将reading.root置为''
    // Fallback to embedded path map
    return {
      reading: {
        // 将阅读题目根路径指向实际数据所在目录
        // 说明：数据脚本中的 exam.path 仅为子目录名（如 "1. P1 - A Brief History.../"），
        // 需要在运行时拼接到真实根目录下
        root: '睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/',
        exceptions: {}
      },
      listening: {
        // 如本地不存在 ListeningPractice 目录，则 PDF/HTML 将无法打开（请确认资源已就位）
        root: 'ListeningPractice/',
        exceptions: {}
      }
    };
  } catch (error) {
    console.warn('[PathNormalization] Failed to load path map:', error);
    return {};
  }
}

function buildResourcePath(exam, kind = 'html') {
    const basePath = resolveExamBasePath(exam);
    const rawName = kind === 'pdf' ? exam.pdfFilename : exam.filename;
    const file = sanitizeFilename(rawName, kind);
    return './' + encodeURI(basePath + file);
}
function sanitizeFilename(name, kind) {
    if (!name) return '';
    const s = String(name);
    if (/\.html?$/i.test(s) || /\.pdf$/i.test(s)) return s;
    // html 情况下，如果误给了 .pdf 结尾，优先尝试 pdf.html 包装页
    if (kind === 'html' && /\.pdf$/i.test(s)) return s.replace(/\.pdf$/i, '.pdf.html');
    if (/html$/i.test(s)) return s.replace(/html$/i, '.html');
    if (/pdf$/i.test(s)) return s.replace(/pdf$/i, '.pdf');
    // 若未包含扩展名，按 kind 追加
    if (kind === 'pdf') return s + '.pdf';
    return s + '.html';
}
// expose helpers globally for other modules (e.g., app.js)
window.resolveExamBasePath = resolveExamBasePath;
window.buildResourcePath = buildResourcePath;

function openExam(examId) {
  // 优先使用App流程（带会话与通信）
  if (window.app && typeof window.app.openExam === 'function') {
    try {
      window.app.openExam(examId);
      return;
    } catch (e) {
      console.warn('[Main] app.openExam 调用失败，启用降级握手路径:', e);
    }
  }

  // 降级：本地完成打开 + 握手重试，确保 sessionId 下发
  const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
  const exam = list.find(e => e.id === examId);
  if (!exam) return showMessage('未找到题目', 'error');
  if (!exam.hasHtml) return viewPDF(examId);

  const fullPath = buildResourcePath(exam, 'html');
  const examWindow = window.open(fullPath, `exam_${exam.id}`, 'width=1200,height=800,scrollbars=yes,resizable=yes');
  if (!examWindow) {
    return showMessage('无法打开窗口，请检查弹窗设置', 'error');
  }
  showMessage('正在打开: ' + exam.title, 'success');

  startHandshakeFallback(examWindow, examId);
}

// 降级握手：循环发送 INIT_SESSION，直至收到 SESSION_READY
function startHandshakeFallback(examWindow, examId) {
  try {
    const sessionId = `${examId}_${Date.now()}`;
    const initPayload = { examId, parentOrigin: window.location.origin, sessionId };
    fallbackExamSessions.set(sessionId, { examId, timer: null, win: examWindow });

    let attempts = 0;
    const maxAttempts = 30; // ~9s
    const tick = () => {
      if (examWindow && !examWindow.closed) {
        try {
          if (attempts === 0) {
            console.log('[Fallback] 发送初始化消息到练习页面:', { type: 'INIT_SESSION', data: initPayload });
          }
          examWindow.postMessage({ type: 'INIT_SESSION', data: initPayload }, '*');
          examWindow.postMessage({ type: 'init_exam_session', data: initPayload }, '*');
        } catch (_) {}
      }
      attempts++;
      if (attempts >= maxAttempts) {
        const rec = fallbackExamSessions.get(sessionId);
        if (rec && rec.timer) clearInterval(rec.timer);
        fallbackExamSessions.delete(sessionId);
        console.warn('[Fallback] 握手超时，练习页可能未加载增强器');
      }
    };
    const timer = setInterval(tick, 300);
    const rec = fallbackExamSessions.get(sessionId);
    if (rec) rec.timer = timer;
    tick();
  } catch (e) {
    console.warn('[Fallback] 启动握手失败:', e);
  }
}

function viewPDF(examId) {
    // 增加数组化防御
    const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
    const exam = list.find(e => e.id === examId);
    if (!exam || !exam.pdfFilename) return showMessage('未找到PDF文件', 'error');
    
    const fullPath = buildResourcePath(exam, 'pdf');
    openPDFSafely(fullPath, exam.title);
}

// Bridge for record details to existing enhancer/modal if present
function showRecordDetails(recordId) {
    if (window.practiceHistoryEnhancer && typeof window.practiceHistoryEnhancer.showRecordDetails === 'function') {
        window.practiceHistoryEnhancer.showRecordDetails(recordId);
    } else if (window.practiceRecordModal && typeof window.practiceRecordModal.showById === 'function') {
        window.practiceRecordModal.showById(recordId);
    } else {
        alert('无法显示记录详情：组件未加载');
    }
}

// Provide a local implementation to avoid dependency on legacy js/script.js
function openPDFSafely(pdfPath, examTitle = 'PDF') {
    try {
        if (pdfHandler && typeof pdfHandler.openPDF === 'function') {
            return pdfHandler.openPDF(pdfPath, examTitle, { width: 1000, height: 800 });
        }
        let pdfWindow = null;
        try {
            pdfWindow = window.open(pdfPath, `pdf_${Date.now()}`, 'width=1000,height=800,scrollbars=yes,resizable=yes,status=yes,toolbar=yes');
        } catch (_) {}
        if (!pdfWindow) {
            try {
                // 降级：当前窗口打开
                window.location.href = pdfPath;
                return window;
            } catch (e) {
                showMessage('无法打开PDF窗口，请检查弹窗设置', 'error');
                return null;
            }
        }
        showMessage('正在打开PDF...', 'info');
        return pdfWindow;
    } catch (error) {
        console.error('[PDF] 打开失败:', error);
        showMessage('打开PDF失败', 'error');
        return null;
    }
}

// Export current exam index to a timestamped script file under assets/scripts (download)
function exportExamIndexToScriptFile(fullIndex, noteLabel = '') {
    try {
        const reading = (fullIndex || []).filter(e => e.type === 'reading').map(e => {
            const { type, ...rest } = e || {};
            return rest;
        });
        const listening = (fullIndex || []).filter(e => e.type === 'listening');

        const pad = (n) => String(n).padStart(2, '0');
        const d = new Date();
        const ts = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        const header = `// 题库配置导出 ${d.toLocaleString()}\n// 说明: 保存此文件到 assets/scripts/ 并在需要时手动在 index.html 引入以覆盖内置数据\n`;
        const content = `${header}window.completeExamIndex = ${JSON.stringify(reading, null, 2)};\n\nwindow.listeningExamIndex = ${JSON.stringify(listening, null, 2)};\n`;

        const blob = new Blob([content], { type: 'application/javascript; charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `exam-index-${ts}.js`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        try { showMessage(`题库配置已导出: exam-index-${ts}.js（请移动到 assets/scripts/）`, 'success'); } catch(_) {}
    } catch (e) {
        console.error('[LibraryExport] 题库配置导出失败:', e);
        try { showMessage('题库配置导出失败: ' + (e && e.message || e), 'error'); } catch(_) {}
    }
}

// --- Helper Functions ---
function getViewName(viewName) {
    switch (viewName) {
        case 'overview': return '总览';
        case 'browse': return '题库浏览';
        case 'practice': return '练习记录';
        case 'settings': return '设置';
        default: return '';
    }
}

function updateSystemInfo() {
    if (!examIndex) return;
    const readingExams = examIndex.filter(e => e.type === 'reading');
    const listeningExams = examIndex.filter(e => e.type === 'listening');

    document.getElementById('total-exams').textContent = examIndex.length;
    // These IDs might not exist anymore, but we'll add them for robustness
    const htmlExamsEl = document.getElementById('html-exams');
    const pdfExamsEl = document.getElementById('pdf-exams');
    const lastUpdateEl = document.getElementById('last-update');

    if (htmlExamsEl) htmlExamsEl.textContent = readingExams.length + listeningExams.length; // Simplified
    if (pdfExamsEl) pdfExamsEl.textContent = examIndex.filter(e => e.pdfFilename).length;
    if (lastUpdateEl) lastUpdateEl.textContent = new Date().toLocaleString();
}

function showMessage(message, type = 'info', duration = 4000) {
    if (typeof document === 'undefined') {
        if (typeof console !== 'undefined') {
            const logMethod = type === 'error' ? 'error' : 'log';
            console[logMethod](`[Message:${type}]`, message);
        }
        return;
    }

    const container = ensureMessageContainer();
    if (!container) {
        return;
    }

    const note = createMessageNode(message, type);
    container.appendChild(note);

    while (container.children.length > 3) {
        container.removeChild(container.firstChild);
    }

    const timeout = typeof duration === 'number' && duration > 0 ? duration : 4000;
    window.setTimeout(() => {
        note.classList.add('message-leaving');
        window.setTimeout(() => {
            if (note.parentNode) {
                note.parentNode.removeChild(note);
            }
        }, 320);
    }, timeout);
}

if (typeof window !== 'undefined' && typeof window.showMessage !== 'function') {
    window.showMessage = showMessage;
}

// Other functions from the original file (simplified or kept as is)
async function getActiveLibraryConfigurationKey() {
    return await storage.get('active_exam_index_key', 'exam_index');
}
async function getLibraryConfigurations() {
    return await storage.get('exam_index_configurations', []);
}
async function saveLibraryConfiguration(name, key, examCount) {
    // Persist a record of available exam index configurations
    try {
        const configs = await storage.get('exam_index_configurations', []);
        const newEntry = { name, key, examCount, timestamp: Date.now() };
        const idx = configs.findIndex(c => c.key === key);
        if (idx >= 0) {
            configs[idx] = newEntry;
        } else {
            configs.push(newEntry);
        }
        await storage.set('exam_index_configurations', configs);
    } catch (e) {
        console.error('[LibraryConfig] 保存题库配置失败:', e);
    }
}
async function setActiveLibraryConfiguration(key) {
    try {
        await storage.set('active_exam_index_key', key);
    } catch (e) {
        console.error('[LibraryConfig] 设置活动题库配置失败:', e);
    }
}
function triggerFolderPicker() { document.getElementById('folder-picker').click(); }
function handleFolderSelection(event) { /* legacy stub - replaced by modal-specific inputs */ }

// --- Library Loader Modal and Index Management ---
function showLibraryLoaderModal() {
    const domApi = typeof window.DOM !== 'undefined' ? window.DOM : null;
    const fallbackCreate = (tag, attributes = {}, children = []) => {
        const element = document.createElement(tag);
        Object.entries(attributes || {}).forEach(([key, value]) => {
            if (value == null || value === false) return;
            if (key === 'className') {
                element.className = value;
            } else if (key === 'dataset' && typeof value === 'object') {
                Object.entries(value).forEach(([dataKey, dataValue]) => {
                    if (dataValue != null) element.dataset[dataKey] = String(dataValue);
                });
            } else if (key === 'style' && typeof value === 'object') {
                Object.assign(element.style, value);
            } else {
                element.setAttribute(key, value === true ? '' : value);
            }
        });

        const items = Array.isArray(children) ? children : [children];
        for (const child of items) {
            if (child == null) continue;
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                element.appendChild(child);
            }
        }
        return element;
    };

    const create = domApi && typeof domApi.create === 'function' ? domApi.create : fallbackCreate;
    const ensureArray = (value) => (Array.isArray(value) ? value : [value]);

    const createLoaderCard = (type, title, description, hint) => {
        const prefix = type === 'reading' ? 'reading' : 'listening';
        return create('div', {
            className: `library-loader-card library-loader-card--${type}`
        }, [
            create('h3', { className: 'library-loader-card-title' }, title),
            create('p', { className: 'library-loader-card-description' }, description),
            create('div', { className: 'library-loader-actions' }, [
                create('button', {
                    type: 'button',
                    className: 'btn library-loader-primary',
                    id: `${prefix}-full-btn`,
                    dataset: {
                        libraryAction: 'trigger-input',
                        libraryTarget: `${prefix}-full-input`
                    }
                }, '全量重载'),
                create('button', {
                    type: 'button',
                    className: 'btn btn-secondary library-loader-secondary',
                    id: `${prefix}-inc-btn`,
                    dataset: {
                        libraryAction: 'trigger-input',
                        libraryTarget: `${prefix}-inc-input`
                    }
                }, '增量更新')
            ]),
            create('input', {
                type: 'file',
                id: `${prefix}-full-input`,
                className: 'library-loader-input',
                multiple: '',
                webkitdirectory: '',
                dataset: {
                    libraryType: type,
                    libraryMode: 'full'
                }
            }),
            create('input', {
                type: 'file',
                id: `${prefix}-inc-input`,
                className: 'library-loader-input',
                multiple: '',
                webkitdirectory: '',
                dataset: {
                    libraryType: type,
                    libraryMode: 'incremental'
                }
            }),
            create('p', { className: 'library-loader-hint' }, hint)
        ]);
    };

    const overlay = create('div', {
        className: 'modal-overlay show library-loader-overlay',
        id: 'library-loader-overlay',
        role: 'dialog',
        ariaModal: 'true',
        ariaLabelledby: 'library-loader-title'
    });

    const modal = create('div', {
        className: 'modal library-loader-modal',
        role: 'document'
    });

    const header = create('div', {
        className: 'modal-header library-loader-header'
    }, [
        create('h2', { className: 'modal-title', id: 'library-loader-title' }, '📚 加载题库'),
        create('button', {
            type: 'button',
            className: 'modal-close library-loader-close',
            ariaLabel: '关闭',
            dataset: { libraryAction: 'close' }
        }, '×')
    ]);

    const body = create('div', { className: 'modal-body library-loader-body' }, [
        create('div', { className: 'library-loader-grid' }, [
            createLoaderCard('reading', '📖 阅读题库加载', '支持全量重载与增量更新。请上传包含题目HTML/PDF的根文件夹。', '💡 建议路径：.../3. 所有文章(9.4)[134篇]/...'),
            createLoaderCard('listening', '🎧 听力题库加载', '支持全量重载与增量更新。请上传包含题目HTML/PDF/音频的根文件夹。', '💡 建议路径：ListeningPractice/P3 或 ListeningPractice/P4')
        ]),
        create('div', { className: 'library-loader-instructions' }, [
            create('div', { className: 'library-loader-instructions-title' }, '📋 操作说明'),
            create('ul', { className: 'library-loader-instructions-list' }, [
                create('li', null, '全量重载会替换当前配置中对应类型（阅读/听力）的全部索引，并保留另一类型原有数据。'),
                create('li', null, '增量更新会将新文件生成的新索引追加到当前配置。若当前为默认配置，则会自动复制为新配置后再追加，确保默认配置不被影响。')
            ])
        ])
    ]);

    const footer = create('div', { className: 'modal-footer library-loader-footer' }, [
        create('button', {
            type: 'button',
            className: 'btn btn-secondary library-loader-close-btn',
            id: 'close-loader',
            dataset: { libraryAction: 'close' }
        }, '关闭')
    ]);

    ensureArray([header, body, footer]).forEach((section) => {
        if (section) modal.appendChild(section);
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const cleanup = () => {
        delegates.forEach((token) => {
            if (token && typeof token.remove === 'function') {
                token.remove();
            }
        });
        delegates.length = 0;
        overlay.remove();
    };

    const handleAction = function(event) {
        if (!overlay.contains(this)) return;
        const action = this.dataset.libraryAction;
        if (action === 'close') {
            event.preventDefault();
            cleanup();
            return;
        }

        if (action === 'trigger-input') {
            event.preventDefault();
            const targetId = this.dataset.libraryTarget;
            const input = targetId ? overlay.querySelector(`#${targetId}`) : null;
            if (input) {
                input.click();
            }
        }
    };

    const handleChange = async function(event) {
        if (!overlay.contains(this)) return;
        const files = Array.from(this.files || []);
        if (files.length === 0) return;

        const type = this.dataset.libraryType;
        const mode = this.dataset.libraryMode;
        if (!type || !mode) return;

        await handleLibraryUpload({ type, mode }, files);
        cleanup();
    };

    const delegates = [];
    if (domApi && typeof domApi.delegate === 'function') {
        delegates.push(domApi.delegate('click', '.library-loader-overlay [data-library-action]', handleAction));
        delegates.push(domApi.delegate('change', '.library-loader-overlay .library-loader-input', handleChange));
    } else {
        overlay.addEventListener('click', (event) => {
            const target = event.target.closest('[data-library-action]');
            if (!target || !overlay.contains(target)) return;
            handleAction.call(target, event);
        });

        overlay.addEventListener('change', (event) => {
            const target = event.target.closest('.library-loader-input');
            if (!target || !overlay.contains(target)) return;
            handleChange.call(target, event);
        });
    }
}

// expose modal launcher globally for SettingsPanel button
try { window.showLibraryLoaderModal = showLibraryLoaderModal; } catch(_) {}

async function handleLibraryUpload(options, files) {
    const { type, mode } = options;
    try {
        let label = '';
        if (mode === 'incremental') {
            label = prompt('为此次增量更新输入一个文件夹标签', '增量-' + new Date().toISOString().slice(0,10)) || '';
            if (label) {
                showMessage('使用标签: ' + label, 'info');
            }
            if (!detectFolderPlacement(files, type)) {
                const proceed = confirm('检测到文件夹不在推荐的结构中。\n阅读: ...\n听力: ListeningPractice/P3 or P4\n是否继续?');
                if (!proceed) return;
            }
        }

        showMessage('正在解析文件并构建索引...', 'info');
        const additions = await buildIndexFromFiles(files, type, label);
        if (additions.length === 0) {
            showMessage('从所选文件中未检测到任何题目', 'warning');
            return;
        }

        const activeKey = await getActiveLibraryConfigurationKey();
        const currentIndex = await storage.get(activeKey, examIndex) || [];

        let newIndex;
        if (mode === 'full') {
            // Replace the part of this type and keep the other type
            const others = currentIndex.filter(e => e.type !== type);
            newIndex = [...others, ...additions];
        } else {
            // incremental: append unique by path/title
            const existingKeys = new Set(currentIndex.map(e => (e.path || '') + '|' + (e.filename || '') + '|' + e.title));
            const dedupAdd = additions.filter(e => !existingKeys.has((e.path || '') + '|' + (e.filename || '') + '|' + e.title));
            newIndex = [...currentIndex, ...dedupAdd];
        }

        // 对于全量重载，创建一个新的题库配置并自动切换
        if (mode === 'full') {
            const targetKey = `exam_index_${Date.now()}`;
            const configName = `${type === 'reading' ? '阅读' : '听力'}全量-${new Date().toLocaleString()}`;
            // 确保另一类型存在，如不存在则补齐默认嵌入数据
            const otherType = type === 'reading' ? 'listening' : 'reading';
            const hasOther = newIndex.some(e => e.type === otherType);
            if (!hasOther) {
                let fallback = [];
                if (otherType === 'reading' && window.completeExamIndex) fallback = window.completeExamIndex.map(e => ({...e, type:'reading'}));
                if (otherType === 'listening' && window.listeningExamIndex) fallback = window.listeningExamIndex;
                newIndex = [...newIndex, ...fallback];
            }
            await storage.set(targetKey, newIndex);
            await saveLibraryConfiguration(configName, targetKey, newIndex.length);
            await setActiveLibraryConfiguration(targetKey);
            // 导出为时间命名脚本，便于统一管理
            try { exportExamIndexToScriptFile(newIndex, configName); } catch(_) {}
            showMessage('新的题库配置已创建并激活；正在重新加载...', 'success');
            setTimeout(() => { location.reload(); }, 800);
            return;
        }

        const isDefault = activeKey === 'exam_index';
        let targetKey = activeKey;
        let configName = '';
        if (mode === 'incremental' && isDefault) {
            // Create a new configuration so as not to affect default
            targetKey = `exam_index_${Date.now()}`;
            configName = `${type === 'reading' ? '阅读' : '听力'}增量-${new Date().toLocaleString()}`;
            await storage.set(targetKey, newIndex);
            await saveLibraryConfiguration(configName, targetKey, newIndex.length);
            await setActiveLibraryConfiguration(targetKey);
            showMessage('新的题库配置已创建并激活；正在重新加载...', 'success');
            setTimeout(() => { location.reload(); }, 800);
            return;
        }

        // Save to the current active key（非默认配置下的增量更新）
        await storage.set(targetKey, newIndex);
        const incName = `${type === 'reading' ? '阅读' : '听力'}增量-${new Date().toLocaleString()}`;
        await saveLibraryConfiguration(incName, targetKey, newIndex.length);
        showMessage('索引已更新；正在刷新界面...', 'success');
        examIndex = setExamIndexState(newIndex);
        // 也导出一次，便于归档
        try { exportExamIndexToScriptFile(newIndex, incName); } catch(_) {}
        updateOverview();
        if (document.getElementById('browse-view')?.classList.contains('active')) {
            loadExamList();
        }
    } catch (error) {
        console.error('[LibraryLoader] 处理题库上传失败:', error);
        showMessage('题库处理失败: ' + error.message, 'error');
    }
}

function detectFolderPlacement(files, type) {
    const paths = files.map(f => f.webkitRelativePath || f.name);
    if (type === 'reading') {
        return paths.some(p => /睡着过项目组\(9\.4\)\[134篇\]\/3\. 所有文章\(9\.4\)\[134篇\]\//.test(p));
    } else {
        return paths.some(p => /^ListeningPractice\/(P3|P4)\//.test(p));
    }
}

async function buildIndexFromFiles(files, type, label = '') {
    // Group by folder
    const byDir = new Map();
    for (const f of files) {
        const rel = f.webkitRelativePath || f.name;
        const parts = rel.split('/');
        if (parts.length < 2) continue; // skip root files
        const dir = parts.slice(0, parts.length - 1).join('/');
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir).push(f);
    }

    const entries = [];
    let idx = 0;
    for (const [dir, fs] of byDir.entries()) {
        // Identify HTML/PDF files
        const html = fs.find(x => x.name.toLowerCase().endsWith('.html'));
        const pdf = fs.find(x => x.name.toLowerCase().endsWith('.pdf'));
        if (!html && !pdf) continue;
        // Deduce title and category
        const dirName = dir.split('/').pop();
        const title = dirName.replace(/^\d+\.\s*/, '');
        let category = 'P1';
        const pathStr = dir;
        const m = pathStr.match(/\b(P1|P2|P3|P4)\b/);
        if (m) category = m[1];
        // Build base path and filenames to align with existing buildResourcePath
        let basePath = dir + '/';
        // Normalize listening base to ListeningPractice root in runtime
        if (type === 'listening') {
            basePath = basePath.replace(/^.*?(ListeningPractice\/)/, '$1');
        } else {
            // For reading, ensure it is under the mega folder prefix at runtime by resolveExamBasePath
        }
        const id = `custom_${type}_${Date.now()}_${idx++}`;
        entries.push({
            id,
            title: label ? `[${label}] ${title}` : title,
            category,
            type,
            path: basePath,
            filename: html ? html.name : undefined,
            pdfFilename: pdf ? pdf.name : undefined,
            hasHtml: !!html
        });
    }
    return entries;
}

// ... other utility and management functions can be moved here ...
// --- Functions Restored from Backup ---

// 兼容导入：支持多种旧格式（records/practice_records 顶层/嵌套），自动归一化并合并
async function importData() {
    try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const text = await file.text();
            let json;
            try { json = JSON.parse(text); } catch (err) {
                showMessage('导入失败：JSON 解析错误', 'error');
                return;
            }

            // 提取记录数组（尽可能兼容）
            let imported = [];
            if (Array.isArray(json)) {
                imported = json;
            } else if (Array.isArray(json.records)) {
                imported = json.records;
            } else if (Array.isArray(json.practice_records)) {
                imported = json.practice_records;
            } else if (json.data && (Array.isArray(json.data.practice_records) || (json.data.practice_records && Array.isArray(json.data.practice_records.data)))) {
                imported = Array.isArray(json.data.practice_records) ? json.data.practice_records : (json.data.practice_records.data || []);
            } else if (json.data && Array.isArray(json.data.records)) {
                imported = json.data.records;
            }

            if (!Array.isArray(imported)) imported = [];

            // 归一化每条记录，保留字段以适配当前 UI/统计
            const normalized = imported.map((r) => {
                try {
                    const base = { ...r };
                    // 统一 id 类型
                    if (base.id == null) base.id = Date.now() + Math.random().toString(36).slice(2,9);
                    // 时间与时长
                    if (!base.startTime && base.date) base.startTime = base.date;
                    if (!base.endTime && base.startTime && typeof base.duration === 'number') {
                        base.endTime = new Date(new Date(base.startTime).getTime() + (base.duration*1000)).toISOString();
                    }
                    // 统计字段
                    const rd = base.realData || {};
                    const sInfo = base.scoreInfo || rd.scoreInfo || {};
                    const correct = typeof base.correctAnswers === 'number' ? base.correctAnswers : (typeof base.score === 'number' ? base.score : (typeof sInfo.correct === 'number' ? sInfo.correct : 0));
                    const total = typeof base.totalQuestions === 'number' ? base.totalQuestions : (typeof sInfo.total === 'number' ? sInfo.total : (rd.answers ? Object.keys(rd.answers).length : 0));
                    const acc = typeof base.accuracy === 'number' ? base.accuracy : (total > 0 ? (correct/total) : 0);
                    const pct = typeof base.percentage === 'number' ? base.percentage : Math.round(acc*100);
                    base.score = correct;
                    base.correctAnswers = correct;
                    base.totalQuestions = total;
                    base.accuracy = acc;
                    base.percentage = pct;
                    // 确保 answers/answerComparison 结构存在
                    if (!base.answers && rd.answers) base.answers = rd.answers;
                    if (!base.answerComparison && rd.answerComparison) base.answerComparison = rd.answerComparison;
                    // 最终保证必要字段
                    if (!base.date && base.startTime) base.date = base.startTime;
                    return base;
                } catch (_) {
                    return r;
                }
            });

            // 合并入库（去重：按 id/sessionId）
            let existing = await storage.get('practice_records', []);
            existing = Array.isArray(existing) ? existing : [];
            const byId = new Map(existing.map(x => [String(x.id), true]));
            const bySession = new Map(existing.map(x => [String(x.sessionId||''), true]));
            const merged = existing.slice();
            for (const r of normalized) {
                const idKey = String(r.id);
                const sidKey = String(r.sessionId||'');
                if (byId.has(idKey) || (sidKey && bySession.has(sidKey))) continue;
                merged.push(r);
            }

            await storage.set('practice_records', merged);
            showMessage(`导入完成：新增 ${merged.length - existing.length} 条记录`, 'success');
            syncPracticeRecords();
        };
        input.click();
    } catch (e) {
        console.error('导入失败:', e);
        showMessage('导入失败: ' + e.message, 'error');
    }
}

function searchExams(query) {
    if (window.performanceOptimizer && typeof window.performanceOptimizer.debounce === 'function') {
        const debouncedSearch = window.performanceOptimizer.debounce(performSearch, 300, 'exam_search');
        debouncedSearch(query);
    } else {
        // Fallback: direct call if optimizer not available
        performSearch(query);
    }
}

function performSearch(query) {
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) {
        displayExams(filteredExams || examIndex);
        return;
    }
    
    // 调试日志
    console.log('[Search] 执行搜索，查询词:', normalizedQuery);
    console.log('[Search] 当前 filteredExams 数量:', (filteredExams || []).length);
    
    const searchResults = (filteredExams || examIndex).filter(exam => {
        if (exam.searchText) {
            return exam.searchText.includes(normalizedQuery);
        }
        // Fallback 匹配
        return (exam.title && exam.title.toLowerCase().includes(normalizedQuery)) ||
               (exam.category && exam.category.toLowerCase().includes(normalizedQuery));
    });
    
    console.log('[Search] 搜索结果数量:', searchResults.length);
    displayExams(searchResults);
}

/* Replaced by robust exporter below */
async function exportPracticeData() {
    try {
        const records = window.storage ? (await window.storage.get('practice_records', [])) : (window.practiceRecords || []);
        const stats = window.app && window.app.userStats ? window.app.userStats : (window.practiceStats || {});

        if (!records || records.length === 0) {
            showMessage('没有练习数据可导出', 'info');
            return;
        }

        showMessage('正在准备导出...', 'info');
        setTimeout(() => {
            try {
                const data = {
                    exportDate: new Date().toISOString(),
                    stats: stats,
                    records: records
                };

                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json; charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `practice-records-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                showMessage('导出完成', 'success');
            } catch (error) {
                console.error('导出失败:', error);
                showMessage('导出失败: ' + error.message, 'error');
            }
        }, 100);
    } catch (e) {
        console.error('导出失败:', e);
        showMessage('导出失败: ' + e.message, 'error');
    }
}
function toggleBulkDelete() {
    bulkDeleteMode = !bulkDeleteMode;
    const btn = document.getElementById('bulk-delete-btn');

    if (bulkDeleteMode) {
        btn.textContent = '✓ 完成选择';
        btn.classList.remove('btn-info');
        btn.classList.add('btn-success');
        selectedRecords.clear();
        showMessage('批量管理模式已开启，点击记录进行选择', 'info');
    } else {
        btn.textContent = '📝 批量删除';
        btn.classList.remove('btn-success');
        btn.classList.add('btn-info');

        if (selectedRecords.size > 0) {
            const confirmMessage = `确定要删除选中的 ${selectedRecords.size} 条记录吗？此操作不可恢复。`;
            if (confirm(confirmMessage)) {
                bulkDeleteRecords();
            }
        }
        selectedRecords.clear();
    }

    updatePracticeView();
}

async function bulkDeleteRecords() {
    const records = await storage.get('practice_records', []);
    const recordsToKeep = records.filter(record => !selectedRecords.has(normalizeRecordId(record && record.id)));

    const deletedCount = records.length - recordsToKeep.length;

    await storage.set('practice_records', recordsToKeep);
    practiceRecords = setPracticeRecordsState(recordsToKeep);

    syncPracticeRecords(); // Re-sync and update UI

    showMessage(`已删除 ${deletedCount} 条记录`, 'success');
    console.log(`[System] 批量删除了 ${deletedCount} 条练习记录`);
}

function toggleRecordSelection(recordId) {
    if (!bulkDeleteMode) return;

    const normalizedId = normalizeRecordId(recordId);
    if (!normalizedId) {
        return;
    }

    if (selectedRecords.has(normalizedId)) {
        selectedRecords.delete(normalizedId);
    } else {
        selectedRecords.add(normalizedId);
    }
    updatePracticeView(); // Re-render to show selection state
}


async function deleteRecord(recordId) {
    if (!recordId) {
        showMessage('记录ID无效', 'error');
        return;
    }

    const records = await storage.get('practice_records', []);
    const recordIndex = records.findIndex(record => String(record.id) === String(recordId));

    if (recordIndex === -1) {
        showMessage('未找到记录', 'error');
        return;
    }

    const record = records[recordIndex];
    const confirmMessage = `确定要删除这条练习记录吗？\n\n题目: ${record.title}\n时间: ${new Date(record.date).toLocaleString()}\n\n此操作不可恢复。`;

    if (confirm(confirmMessage)) {
        const historyItem = document.querySelector(`[data-record-id="${recordId}"]`);
        if (historyItem) {
            historyItem.classList.add('deleting');
            setTimeout(async () => {
                historyItem.classList.add('deleted');
                setTimeout(async () => {
                    records.splice(recordIndex, 1);
                    await storage.set('practice_records', records);
                    syncPracticeRecords(); // Re-sync and update UI
                    showMessage('记录已删除', 'success');
                }, 300);
            }, 200);
        } else {
            // Fallback if element not found
            records.splice(recordIndex, 1);
            await storage.set('practice_records', records);
            syncPracticeRecords();
            showMessage('记录已删除', 'success');
        }
    }
}

async function clearPracticeData() {
    if (confirm('确定要清除所有练习记录吗？此操作不可恢复。')) {
        practiceRecords = setPracticeRecordsState([]);
        await storage.set('practice_records', []); // Use storage helper
        processedSessions.clear();
        updatePracticeView();
        showMessage('练习记录已清除', 'success');
    }
}

async function clearCache() {
    if (confirm('确定要清除所有缓存数据并清空练习记录吗？')) {
        try {
            // 清空命名空间下的练习记录
            if (window.storage && typeof storage.set === 'function') {
                await storage.set('practice_records', []);
            } else {
                try { localStorage.removeItem('exam_system_practice_records'); } catch(_) {}
            }
        } catch (e) { console.warn('[clearCache] failed to clear practice_records:', e); }

        try { localStorage.clear(); } catch(_) {}
        try { sessionStorage.clear(); } catch(_) {}

        setPracticeRecordsState([]);
        if (window.performanceOptimizer) {
            // optional cleanup hook
            // window.performanceOptimizer.cleanup();
        }
        showMessage('缓存与练习记录已清除', 'success');
        setTimeout(() => { location.reload(); }, 1000);
    }
}

let libraryConfigViewInstance = null;

function ensureLibraryConfigView() {
    if (libraryConfigViewInstance || typeof window === 'undefined') {
        return libraryConfigViewInstance;
    }
    if (typeof window.LibraryConfigView === 'function') {
        libraryConfigViewInstance = new window.LibraryConfigView();
    }
    return libraryConfigViewInstance;
}

async function resolveLibraryConfigurations() {
    let configs = await getLibraryConfigurations();
    if (!Array.isArray(configs)) {
        configs = [];
    }

    if (configs.length === 0) {
        try {
            const count = Array.isArray(window.examIndex) ? window.examIndex.length : 0;
            configs = [{
                name: '默认题库',
                key: 'exam_index',
                examCount: count,
                timestamp: Date.now()
            }];
            await storage.set('exam_index_configurations', configs);
            const activeKey = await storage.get('active_exam_index_key');
            if (!activeKey) {
                await storage.set('active_exam_index_key', 'exam_index');
            }
        } catch (error) {
            console.warn('[LibraryConfig] 无法初始化默认题库配置', error);
        }
    }
    return configs;
}

function renderLibraryConfigFallback(container, configs, options) {
    const hostClass = 'library-config-list';
    let host = container.querySelector('.' + hostClass);
    if (!host) {
        host = document.createElement('div');
        host.className = hostClass;
        container.appendChild(host);
    }

    while (host.firstChild) {
        host.removeChild(host.firstChild);
    }

    const panel = document.createElement('div');
    panel.className = 'library-config-panel';

    const header = document.createElement('div');
    header.className = 'library-config-panel__header';
    const title = document.createElement('h3');
    title.className = 'library-config-panel__title';
    title.textContent = '📚 题库配置列表';
    header.appendChild(title);
    panel.appendChild(header);

    const list = document.createElement('div');
    list.className = 'library-config-panel__list';
    const activeKey = options && options.activeKey;

    configs.forEach((config) => {
        if (!config) {
            return;
        }
        const item = document.createElement('div');
        item.className = 'library-config-panel__item' + (activeKey === config.key ? ' library-config-panel__item--active' : '');

        const info = document.createElement('div');
        info.className = 'library-config-panel__info';

        const titleLine = document.createElement('div');
        titleLine.textContent = config.name || config.key || '未命名题库';
        info.appendChild(titleLine);

        const meta = document.createElement('div');
        meta.className = 'library-config-panel__meta';
        try {
            meta.textContent = new Date(config.timestamp).toLocaleString() + ' · ' + (config.examCount || 0) + ' 个题目';
        } catch (_) {
            meta.textContent = (config.examCount || 0) + ' 个题目';
        }
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'library-config-panel__actions';

        const switchBtn = document.createElement('button');
        switchBtn.type = 'button';
        switchBtn.className = 'btn btn-secondary';
        switchBtn.dataset.configAction = 'switch';
        switchBtn.dataset.configKey = config.key;
        if (activeKey === config.key) {
            switchBtn.disabled = true;
        }
        switchBtn.textContent = '切换';
        actions.appendChild(switchBtn);

        if (config.key !== 'exam_index') {
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'btn btn-warning';
            deleteBtn.dataset.configAction = 'delete';
            deleteBtn.dataset.configKey = config.key;
            if (activeKey === config.key) {
                deleteBtn.disabled = true;
            }
            deleteBtn.textContent = '删除';
            actions.appendChild(deleteBtn);
        }

        item.appendChild(info);
        item.appendChild(actions);
        list.appendChild(item);
    });

    if (!list.childElementCount) {
        const empty = document.createElement('div');
        empty.className = 'library-config-panel__empty';
        empty.textContent = options && options.emptyMessage ? options.emptyMessage : '暂无题库配置记录';
        panel.appendChild(empty);
    } else {
        panel.appendChild(list);
    }

    const footer = document.createElement('div');
    footer.className = 'library-config-panel__footer';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-secondary library-config-panel__close';
    close.dataset.configAction = 'close';
    close.textContent = '关闭';
    footer.appendChild(close);
    panel.appendChild(footer);

    host.appendChild(panel);

    const handler = (event) => {
        const target = event.target && event.target.closest('[data-config-action]');
        if (!target || !host.contains(target)) {
            return;
        }
        const action = target.dataset.configAction;
        if (action === 'close') {
            host.remove();
            return;
        }
        if (action === 'switch' && typeof switchLibraryConfig === 'function') {
            switchLibraryConfig(target.dataset.configKey);
        }
        if (action === 'delete' && typeof deleteLibraryConfig === 'function') {
            deleteLibraryConfig(target.dataset.configKey);
        }
    };

    host.onclick = handler;
    return host;
}

async function renderLibraryConfigList(options = {}) {
    const containerId = options.containerId || 'settings-view';
    const container = document.getElementById(containerId);
    if (!container) {
        return null;
    }

    let configs = Array.isArray(options.configs) ? options.configs : await resolveLibraryConfigurations();
    if (!configs.length) {
        if (options.silentEmpty) {
            const existingHost = container.querySelector('.library-config-list');
            if (existingHost) {
                existingHost.remove();
            }
        } else if (typeof showMessage === 'function') {
            showMessage('暂无题库配置记录', 'info');
        }
        return null;
    }

    const activeKey = options.activeKey || await getActiveLibraryConfigurationKey();
    const view = ensureLibraryConfigView();
    if (view) {
        return view.mount(container, configs, {
            activeKey,
            allowDelete: options.allowDelete !== false,
            emptyMessage: options.emptyMessage,
            handlers: Object.assign({
                switch: (configKey) => switchLibraryConfig(configKey),
                delete: (configKey) => deleteLibraryConfig(configKey)
            }, options.handlers || {})
        });
    }

    return renderLibraryConfigFallback(container, configs, { activeKey, emptyMessage: options.emptyMessage });
}

async function showLibraryConfigList(options) {
    return renderLibraryConfigList(Object.assign({ allowDelete: true }, options || {}));
}

async function showLibraryConfigListV2(options) {
    return renderLibraryConfigList(Object.assign({ allowDelete: true }, options || {}));
}

// 切换题库配置
async function switchLibraryConfig(configKey) {
    if (!configKey) {
        return;
    }
    if (confirm('确定要切换到这个题库配置吗？页面将会刷新。')) {
        await setActiveLibraryConfiguration(configKey);
        showMessage('正在切换题库配置，页面将刷新...', 'info');
        setTimeout(() => {
            location.reload();
        }, 1000);
    }
}

// 删除题库配置
async function deleteLibraryConfig(configKey) {
    if (!configKey) {
        return;
    }
    if (configKey === 'exam_index') {
        showMessage('默认题库不可删除', 'warning');
        return;
    }
    if (confirm('确定要删除这个题库配置吗？此操作不可恢复。')) {
        let configs = await getLibraryConfigurations();
        configs = Array.isArray(configs) ? configs.filter(config => config && config.key !== configKey) : [];
        await storage.set('exam_index_configurations', configs);
        try {
            await storage.remove(configKey);
        } catch (error) {
            console.warn('[LibraryConfig] 删除题库数据失败', error);
        }

        showMessage('题库配置已删除', 'success');
        await renderLibraryConfigList({ silentEmpty: true });
    }
}

function createManualBackup() {
    if (!window.dataIntegrityManager) {
        showMessage('数据管理模块未初始化', 'error');
        return;
    }
    (async () => {
        try {
            const backup = await window.dataIntegrityManager.createBackup(null, 'manual');
            if (backup && backup.external) {
                showMessage('本地存储空间不足，已将备份下载为文件', 'warning');
            } else {
                showMessage(`备份创建成功: ${backup.id}`, 'success');
            }
            // 刷新备份列表（如果用户打开了设置页）
            try { showBackupList(); } catch (_) {}
        } catch (error) {
            if (isQuotaExceeded(error)) {
                try {
                    window.dataIntegrityManager.exportData();
                    showMessage('存储空间不足：已将数据导出为文件', 'warning');
                } catch (e2) {
                    showMessage('备份失败且导出失败: ' + (e2 && e2.message ? e2.message : e2), 'error');
                }
            } else {
                
                showMessage('备份创建失败: ' + (error && error.message ? error.message : error), 'error');
            }
        }
    })();
}

function isQuotaExceeded(error) {
    return !!(error && (
        error.name === 'QuotaExceededError' ||
        (typeof error.message === 'string' && error.message.includes('exceeded the quota')) ||
        error.code === 22 || error.code === 1014
    ));
}

async function showBackupList() {
    if (!window.dataIntegrityManager) {
        showMessage('数据完整性管理器未初始化', 'error');
        return;
    }

    setupBackupListInteractions();

    const backups = await window.dataIntegrityManager.getBackupList();
    const settingsView = document.getElementById('settings-view');
    const domApi = (typeof window !== 'undefined' && window.DOM) ? window.DOM : null;

    const fallbackCreate = (tag, attributes = {}, children = []) => {
        const element = document.createElement(tag);
        Object.entries(attributes || {}).forEach(([key, value]) => {
            if (value == null || value === false) return;
            if (key === 'className') {
                element.className = value;
            } else if (key === 'dataset' && typeof value === 'object') {
                Object.entries(value).forEach(([dataKey, dataValue]) => {
                    if (dataValue != null) element.dataset[dataKey] = String(dataValue);
                });
            } else if (key === 'style' && typeof value === 'object') {
                Object.assign(element.style, value);
            } else {
                element.setAttribute(key, value === true ? '' : value);
            }
        });

        const normalizedChildren = Array.isArray(children) ? children : [children];
        normalizedChildren.forEach((child) => {
            if (child == null) return;
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                element.appendChild(child);
            }
        });
        return element;
    };

    const create = domApi && typeof domApi.create === 'function'
        ? (...args) => domApi.create(...args)
        : fallbackCreate;

    const buildEntries = () => {
        if (!Array.isArray(backups) || backups.length === 0) {
            return [
                create('div', { className: 'backup-list-empty' }, [
                    create('div', { className: 'backup-list-empty-icon', ariaHidden: 'true' }, '📂'),
                    create('p', { className: 'backup-list-empty-text' }, '暂无备份记录。'),
                    create('p', { className: 'backup-list-empty-hint' }, '创建手动备份后将显示在此列表中。')
                ])
            ];
        }

        return backups.map((backup) => create('div', {
            className: 'backup-entry',
            dataset: { backupId: backup.id }
        }, [
            create('div', { className: 'backup-entry-info' }, [
                create('strong', { className: 'backup-entry-id' }, backup.id),
                create('div', { className: 'backup-entry-meta' }, new Date(backup.timestamp).toLocaleString()),
                create('div', { className: 'backup-entry-meta' }, `类型: ${backup.type} | 版本: ${backup.version}`)
            ]),
            create('div', { className: 'backup-entry-actions' }, [
                create('button', {
                    type: 'button',
                    className: 'btn btn-success backup-entry-restore',
                    dataset: {
                        backupAction: 'restore',
                        backupId: backup.id
                    }
                }, '恢复')
            ])
        ]));
    };

    const existingContainer = settingsView?.querySelector('.backup-list-container');
    if (existingContainer) {
        existingContainer.remove();
    }

    const existingOverlay = document.querySelector('.backup-modal-overlay');
    if (existingOverlay) {
        existingOverlay.remove();
    }

    const card = create('div', { className: 'backup-list-card' }, [
        create('div', { className: 'backup-list-header' }, [
            create('h3', { className: 'backup-list-title' }, [
                create('span', { className: 'backup-list-title-icon', ariaHidden: 'true' }, '📋'),
                create('span', { className: 'backup-list-title-text' }, '备份列表')
            ])
        ]),
        create('div', { className: 'backup-list-scroll' }, buildEntries())
    ]);

    if (settingsView) {
        const container = create('div', { className: 'backup-list-container' }, card);
        const mainCard = settingsView.querySelector(':scope > div');
        if (mainCard) {
            mainCard.appendChild(container);
        } else {
            settingsView.appendChild(container);
        }

        if (!Array.isArray(backups) || backups.length === 0) {
            showMessage('暂无备份记录', 'info');
        }
        return;
    }

    const overlay = create('div', { className: 'backup-modal-overlay' }, [
        create('div', { className: 'backup-modal' }, [
            create('div', { className: 'backup-modal-header' }, [
                create('h3', { className: 'backup-modal-title' }, [
                    create('span', { className: 'backup-list-title-icon', ariaHidden: 'true' }, '📋'),
                    create('span', { className: 'backup-list-title-text' }, '备份列表')
                ]),
                create('button', {
                    type: 'button',
                    className: 'btn btn-secondary backup-modal-close',
                    dataset: { backupAction: 'close-modal' },
                    ariaLabel: '关闭备份列表'
                }, '关闭')
            ]),
            create('div', { className: 'backup-modal-body' }, buildEntries()),
            create('div', { className: 'backup-modal-footer' }, [
                create('button', {
                    type: 'button',
                    className: 'btn btn-secondary backup-modal-close',
                    dataset: { backupAction: 'close-modal' }
                }, '关闭')
            ])
        ])
    ]);

    document.body.appendChild(overlay);

    if (!Array.isArray(backups) || backups.length === 0) {
        showMessage('暂无备份记录', 'info');
    }
}

let backupListDelegatesConfigured = false;

function setupBackupListInteractions() {
    if (backupListDelegatesConfigured) {
        return;
    }

    const handle = async (target, event) => {
        const action = target.dataset.backupAction;
        if (!action) {
            return;
        }

        if (action === 'restore') {
            const backupId = target.dataset.backupId;
            if (!backupId) {
                return;
            }

            event.preventDefault();

            if (!window.dataIntegrityManager) {
                showMessage('数据完整性管理器未初始化', 'error');
                return;
            }

            if (!confirm(`确定要恢复备份 ${backupId} 吗？当前数据将被覆盖。`)) {
                return;
            }

            try {
                showMessage('正在恢复备份...', 'info');
                await window.dataIntegrityManager.restoreBackup(backupId);
                showMessage('备份恢复成功', 'success');
                setTimeout(() => showBackupList(), 1000);
            } catch (error) {
                console.error('[DataManagement] 恢复备份失败:', error);
                showMessage('备份恢复失败: ' + (error?.message || error), 'error');
            }
            return;
        }

        if (action === 'close-modal') {
            event.preventDefault();
            const overlay = document.querySelector('.backup-modal-overlay');
            if (overlay) {
                overlay.remove();
            }
        }
    };

    const hasDomDelegate = typeof window !== 'undefined'
        && window.DOM
        && typeof window.DOM.delegate === 'function';

    if (hasDomDelegate) {
        window.DOM.delegate('click', '[data-backup-action]', function(event) {
            handle(this, event);
        });
    } else {
        document.addEventListener('click', (event) => {
            const target = event.target.closest('[data-backup-action]');
            if (!target) {
                return;
            }
            handle(target, event);
        });
    }

    backupListDelegatesConfigured = true;
}

function exportAllData() {
    if (window.dataIntegrityManager) {
        window.dataIntegrityManager.exportData();
        showMessage('数据导出成功', 'success');
    } else {
        showMessage('数据管理模块未初始化', 'error');
    }
}

function importData() {
    if (window.dataIntegrityManager) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (event) => {
            const file = event.target.files[0];
            if (!file) return;
            if (confirm('导入数据将覆盖当前数据，确定继续吗？')) {
                try {
                    const result = await window.dataIntegrityManager.importData(file);
                    showMessage(`数据导入成功: ${result.importedCount} 个项目`, 'success');
                    // The page will now sync automatically without a reload.
                } catch (error) {
                    showMessage('数据导入失败: ' + error.message, 'error');
                }
            }
        };
        input.click();
    } else {
        showMessage('数据管理模块未初始化', 'error');
    }
}

function showDeveloperTeam() {
    const modal = document.getElementById('developer-modal');
    if (modal) modal.classList.add('show');
}

function hideDeveloperTeam() {
    const modal = document.getElementById('developer-modal');
    if (modal) modal.classList.remove('show');
}

function startRandomPractice(category, type = 'reading') {
    // 增加数组化防御
    const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
    const categoryExams = list.filter(exam => exam.category === category && exam.type === type);
    if (categoryExams.length === 0) {
        showMessage(`${category} ${type === 'reading' ? '阅读' : '听力'} 分类暂无可用题目`, 'error');
        return;
    }
    const randomExam = categoryExams[Math.floor(Math.random() * categoryExams.length)];
    showMessage(`随机选择: ${randomExam.title}`, 'info');

    // 确保弹出新窗口加载题目（HTML或PDF）
    setTimeout(() => {
        if (randomExam.hasHtml) {
            // 有HTML文件，弹出新窗口
            openExam(randomExam.id);
        } else {
            // 只有PDF文件，也要弹出新窗口
            const fullPath = buildResourcePath(randomExam, 'pdf');
            const pdfWindow = window.open(fullPath, `exam_${randomExam.id}`, 'width=1200,height=800,scrollbars=yes,resizable=yes');
            if (pdfWindow) {
                showMessage('正在打开: ' + randomExam.title, 'success');
            } else {
                showMessage('无法打开窗口，请检查弹窗设置', 'error');
            }
        }
    }, 1000);
}

// Safe exporter (compat with old UI)
async function exportPracticeData() {
    try {
        if (window.dataIntegrityManager && typeof window.dataIntegrityManager.exportData === 'function') {
            window.dataIntegrityManager.exportData();
            try { showMessage('导出完成', 'success'); } catch(_) {}
            return;
        }
    } catch(_) {}
    try {
        var records = (window.storage && storage.get) ? (await storage.get('practice_records', [])) : (window.practiceRecords || []);
        var blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json; charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = 'practice-records.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        try { showMessage('导出完成', 'success'); } catch(_) {}
    } catch(e) {
        try { showMessage('导出失败: ' + (e && e.message || e), 'error'); } catch(_) {}
        console.error('[Export] failed', e);
    }
}

function setupIndexSettingsButtons() {
    const bindings = [
        ['clear-cache-btn', () => typeof clearCache === 'function' && clearCache()],
        ['load-library-btn', () => {
            if (typeof showLibraryLoaderModal === 'function') {
                showLibraryLoaderModal();
            } else if (typeof loadLibrary === 'function') {
                loadLibrary(false);
            }
        }],
        ['library-config-btn', () => typeof showLibraryConfigListV2 === 'function' && showLibraryConfigListV2()],
        ['force-refresh-btn', () => {
            const notify = (type, msg) => {
                if (typeof showMessage === 'function') {
                    showMessage(msg, type);
                }
            };

            notify('info', '正在强制刷新题库...');

            if (typeof loadLibrary === 'function') {
                try {
                    window.__forceLibraryRefreshInProgress = true;
                    const result = loadLibrary(true);
                    if (result && typeof result.then === 'function') {
                        result.then(() => {
                            if (window.__forceLibraryRefreshInProgress) {
                                notify('success', '题库刷新完成');
                                window.__forceLibraryRefreshInProgress = false;
                            }
                        }).catch((error) => {
                            notify('error', '题库刷新失败: ' + (error?.message || error));
                            window.__forceLibraryRefreshInProgress = false;
                        });
                    } else {
                        setTimeout(() => {
                            if (window.__forceLibraryRefreshInProgress) {
                                notify('success', '题库刷新完成');
                                window.__forceLibraryRefreshInProgress = false;
                            }
                        }, 800);
                    }
                } catch (error) {
                    notify('error', '题库刷新失败: ' + (error?.message || error));
                    window.__forceLibraryRefreshInProgress = false;
                }
            }
        }],
        ['create-backup-btn', () => typeof createManualBackup === 'function' && createManualBackup()],
        ['backup-list-btn', () => typeof showBackupList === 'function' && showBackupList()],
        ['export-data-btn', () => typeof exportAllData === 'function' && exportAllData()],
        ['import-data-btn', () => typeof importData === 'function' && importData()]
    ];

    bindings.forEach(([id, handler]) => {
        const button = document.getElementById(id);
        if (button && typeof handler === 'function') {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                handler();
            });
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupIndexSettingsButtons);
} else {
    setupIndexSettingsButtons();
}

// 新增修复3C：在js/main.js末尾添加监听examIndexLoaded事件，调用loadExamList()并隐藏浏览页spinner
window.addEventListener('examIndexLoaded', () => {
    try {
        if (window.__forceLibraryRefreshInProgress) {
            if (typeof showMessage === 'function') {
                showMessage('题库刷新完成', 'success');
            }
            window.__forceLibraryRefreshInProgress = false;
        }
        if (typeof loadExamList === 'function') loadExamList();
        const loading = document.querySelector('#browse-view .loading');
        if (loading) loading.style.display = 'none';
    } catch (_) {}
});

let examActionHandlersConfigured = false;

function setupExamActionHandlers() {
    if (examActionHandlersConfigured) {
        return;
    }

    const invoke = (target, event) => {
        const action = target.dataset.action;
        const examId = target.dataset.examId;
        if (!action || !examId) {
            return;
        }

        event.preventDefault();

        if (action === 'start' && typeof openExam === 'function') {
            openExam(examId);
            return;
        }

        if (action === 'pdf' && typeof viewPDF === 'function') {
            viewPDF(examId);
            return;
        }

        if (action === 'generate' && typeof generateHTML === 'function') {
            generateHTML(examId);
        }
    };

    const hasDomDelegate = typeof window !== 'undefined'
        && window.DOM
        && typeof window.DOM.delegate === 'function';

    if (hasDomDelegate) {
        window.DOM.delegate('click', '[data-action="start"]', function(event) {
            invoke(this, event);
        });
        window.DOM.delegate('click', '[data-action="pdf"]', function(event) {
            invoke(this, event);
        });
        window.DOM.delegate('click', '[data-action="generate"]', function(event) {
            invoke(this, event);
        });
    } else {
        document.addEventListener('click', (event) => {
            const target = event.target.closest('[data-action]');
            if (!target) {
                return;
            }

            const container = document.getElementById('exam-list-container');
            if (container && !container.contains(target)) {
                return;
            }

            invoke(target, event);
        });
    }

    examActionHandlersConfigured = true;
    console.log('[Main] 考试操作按钮事件委托已设置');
}

setupExamActionHandlers();
