// Main JavaScript logic for the application
// This file is the result of refactoring the inline script from improved-working-system.html

// ============================================================================
// Phase 2/3: 路径与状态由 ResourceCore / AppStateService 统一提供
// ============================================================================

// 其他全局变量保留在 main.js（暂未迁移）
let practiceListScroller = null;
let app = null;
let pdfHandler = null;
let browseStateManager = null;
let browseInitialFilterHydrationConsumed = false;

function normalizeRecordId(id) {
    if (id == null) {
        return '';
    }
    return String(id);
}

if (typeof window !== 'undefined') {
    window.normalizeRecordId = normalizeRecordId;
}

// examListViewInstance - 迁移到 browseController
Object.defineProperty(window, 'examListViewInstance', {
    get: function () {
        if (window.browseController && typeof window.browseController.getExamListView === 'function') {
            return window.browseController.getExamListView();
        }
        return null;
    },
    set: function (value) {
        if (window.browseController && typeof window.browseController.setExamListView === 'function') {
            window.browseController.setExamListView(value);
        }
    },
    configurable: true
});

let practiceDashboardViewInstance = null;
let practiceTrendRendererInstance = null;
let practicePriorityRendererInstance = null;
let legacyNavigationController = null;

// ============================================================================
// Phase 1: Boot/Ensure 函数 Shim 层（实际实现在 main-entry.js）
// ============================================================================

// reportBootStage - 已在 main-entry.js 实现
// 保留此处为兼容性注释，实际由 main-entry.js 提供
if (typeof window.reportBootStage !== 'function') {
    window.reportBootStage = function reportBootStage(message, progress) {
        console.warn('[main.js shim] reportBootStage 应由 main-entry.js 提供');
    };
}

// ensureExamDataScripts - 已在 main-entry.js 实现
if (typeof window.ensureExamDataScripts !== 'function') {
    window.ensureExamDataScripts = function ensureExamDataScripts() {
        console.warn('[main.js shim] ensureExamDataScripts 应由 main-entry.js 提供');
        return Promise.resolve();
    };
}

// ensurePracticeSuiteReady - 已在 main-entry.js 实现
if (typeof window.ensurePracticeSuiteReady !== 'function') {
    window.ensurePracticeSuiteReady = function ensurePracticeSuiteReady() {
        console.warn('[main.js shim] ensurePracticeSuiteReady 应由 main-entry.js 提供');
        return Promise.resolve();
    };
}

// ensureBrowseGroup - 已在 main-entry.js 实现
if (typeof window.ensureBrowseGroup !== 'function') {
    window.ensureBrowseGroup = function ensureBrowseGroup() {
        console.warn('[main.js shim] ensureBrowseGroup 应由 main-entry.js 提供');
        return Promise.resolve();
    };
}

// getLibraryManager - 保留在 main.js（依赖 browse-view 组加载后的全局对象）
function getLibraryManager() {
    if (window.LibraryManager && typeof window.LibraryManager.getInstance === 'function') {
        return window.LibraryManager.getInstance();
    }
    return null;
}

// ensureLibraryManagerReady - 转发到 getLibraryManager + ensureBrowseGroup
async function ensureLibraryManagerReady() {
    let manager = getLibraryManager();
    if (manager) {
        return manager;
    }
    // 确保 browse-view 组加载（LibraryManager 在该组中）
    if (typeof window.ensureBrowseGroup === 'function') {
        await window.ensureBrowseGroup();
    }
    manager = getLibraryManager();
    return manager;
}

// ============================================================================
// Phase 2: 浏览/筛选函数 Shim 层（实际实现在 browseController.js）
// ============================================================================

// setBrowseFilterState
if (typeof window.setBrowseFilterState !== 'function') {
    window.setBrowseFilterState = function (category, type) {
        if (window.browseController && typeof window.browseController.setBrowseFilterState === 'function') {
            window.browseController.setBrowseFilterState(category, type);
        }
    };
}

// getCurrentCategory
if (typeof window.getCurrentCategory !== 'function') {
    window.getCurrentCategory = function () {
        if (window.browseController && typeof window.browseController.getCurrentCategory === 'function') {
            return window.browseController.getCurrentCategory();
        }
        return 'all';
    };
}

// getCurrentExamType
if (typeof window.getCurrentExamType !== 'function') {
    window.getCurrentExamType = function () {
        if (window.browseController && typeof window.browseController.getCurrentExamType === 'function') {
            return window.browseController.getCurrentExamType();
        }
        return 'all';
    };
}

// updateBrowseTitle
if (typeof window.updateBrowseTitle !== 'function') {
    window.updateBrowseTitle = function () {
        if (window.browseController && typeof window.browseController.updateBrowseTitle === 'function') {
            window.browseController.updateBrowseTitle();
        }
    };
}

// clearPendingBrowseAutoScroll
if (typeof window.clearPendingBrowseAutoScroll !== 'function') {
    window.clearPendingBrowseAutoScroll = function () {
        if (window.browseController && typeof window.browseController.clearPendingBrowseAutoScroll === 'function') {
            window.browseController.clearPendingBrowseAutoScroll();
        }
    };
}

// switchLibraryConfig
if (typeof window.switchLibraryConfig !== 'function') {
    window.switchLibraryConfig = function (key) {
        if (window.LibraryManager && typeof window.LibraryManager.switchLibraryConfig === 'function') {
            return window.LibraryManager.switchLibraryConfig(key);
        }
    };
}

// loadLibrary - 始终转发到 LibraryManager 实现，支持字符串 key
window.loadLibrary = function (keyOrForceReload) {
    return loadLibraryInternal(keyOrForceReload);
};


const preferredFirstExamByCategory = {
    'P1_reading': { id: 'p1-09', title: 'Listening to the Ocean 海洋探测' },
    'P2_reading': { id: 'p2-high-12', title: 'The fascinating world of attine ants 切叶蚁' },
    'P3_reading': { id: 'p3-high-11', title: 'The Fruit Book 果实之书' },
    'P1_listening': { id: 'listening-p3-01', title: 'Julia and Bob’s science project is due' },
    'P3_listening': { id: 'listening-p3-02', title: 'Climate change and allergies' }
};


function ensureExamListView() {
    // 通过 browseController getter 访问，避免直接引用已移除的变量
    let instance = null;
    if (window.browseController && typeof window.browseController.getExamListView === 'function') {
        instance = window.browseController.getExamListView();
    }
    
    if (!instance && window.LegacyExamListView) {
        instance = new window.LegacyExamListView({
            domAdapter: window.DOMAdapter,
            containerId: 'exam-list-container'
        });
        // 保存到 browseController
        if (window.browseController && typeof window.browseController.setExamListView === 'function') {
            window.browseController.setExamListView(instance);
        }
    }
    return instance;
}

function ensurePracticeDashboardView() {
    if (!practiceDashboardViewInstance && window.PracticeDashboardView) {
        practiceDashboardViewInstance = new window.PracticeDashboardView({
            domAdapter: window.DOMAdapter
        });
    }
    return practiceDashboardViewInstance;
}

function ensurePracticeTrendRenderer() {
    if (!practiceTrendRendererInstance && window.PracticeTrendRenderer) {
        practiceTrendRendererInstance = new window.PracticeTrendRenderer();
    }
    return practiceTrendRendererInstance;
}

function ensurePracticePriorityRenderer() {
    if (!practicePriorityRendererInstance && window.PracticePriorityRenderer) {
        practicePriorityRendererInstance = new window.PracticePriorityRenderer();
    }
    return practicePriorityRendererInstance;
}

function ensureLegacyNavigation(options) {
    var mergedOptions = Object.assign({
        containerSelector: '.main-nav',
        activeClass: 'active',
        syncOnNavigate: true,
        onRepeatNavigate: function onRepeatNavigate(viewName) {
            if (viewName === 'browse') {
                if (window.ExamActions && typeof window.ExamActions.resetBrowseViewToAll === 'function') {
                    return window.ExamActions.resetBrowseViewToAll();
                } else if (typeof window.resetBrowseViewToAll === 'function') {
                    return window.resetBrowseViewToAll();
                }
            }
            return false;
        },
        onNavigate: function onNavigate(viewName) {
            if (typeof window.showView === 'function') {
                window.showView(viewName, false);
                return;
            }
            if (window.app && typeof window.app.navigateToView === 'function') {
                window.app.navigateToView(viewName);
            }
        }
    }, options || {});

    if (window.NavigationController && typeof window.NavigationController.ensure === 'function') {
        legacyNavigationController = window.NavigationController.ensure(mergedOptions);
        return legacyNavigationController;
    }

    if (typeof window.ensureLegacyNavigationController === 'function') {
        legacyNavigationController = window.ensureLegacyNavigationController(mergedOptions);
        return legacyNavigationController;
    }

    return null;
}

// --- Initialization ---
async function initializeLegacyComponents() {
    try { showMessage('系统准备就绪', 'success'); } catch (_) { }

    try {
        const activeView = document.querySelector('.view.active');
        const activeViewName = activeView && activeView.id
            ? activeView.id.replace(/-view$/, '')
            : 'overview';
        ensureLegacyNavigation({ initialView: activeViewName });
    } catch (error) {
        console.warn('[Navigation] 初始化导航控制器失败:', error);
    }

    setupBrowsePreferenceUI();

    // Initialize components
    if (window.PDFHandler) {
        pdfHandler = new PDFHandler();
        console.log('[System] PDF处理器已初始化');
    }
    if (window.BrowseStateManager) {
        browseStateManager = window.browseStateManager || new window.BrowseStateManager();
        console.log('[System] 浏览状态管理器已就绪');
    }
    // 性能优化器已拆到 diagnostics-tools；浏览页保留无依赖降级路径。
    if (window.PerformanceOptimizer) {
        window.performanceOptimizer = new PerformanceOptimizer();
        console.log('[System] 性能优化器已初始化');
    } else {
        console.info('[System] PerformanceOptimizer 按需加载，跳过启动初始化');
    }

    // Load data and setup listeners
    await loadLibraryInternal();
    // 首页/题库浏览只使用摘要记录；完整 answers/realData 在进入练习历史页时再加载。
    setupMessageListener(); // Listen for updates from child windows
}

// --- Data Loading and Management ---

// Practice history is read from AppData for each refresh. Only its signature is
// retained as runtime UI state; record arrays never become a second authority.
let lastPracticeRecordsSignature = null;
// Browse progress is a derived projection. Invocation order and the accepted
// projection watermark are intentionally separate: a newer sync that merely
// starts must not invalidate an already successful projection if it later
// fails. Neither counter changes syncPracticeRecords' public return value or
// the Practice-history single-flight contract below.
let browsePracticeProjectionInvocationSequence = 0;
let browsePracticeProjectionGeneration = 0;
async function syncPracticeRecords(options = {}) {
    const { forceRender = false, mode = 'summary' } = options || {};
    const loadMode = mode === 'full' ? 'full' : 'summary';
    const practiceProjectionInvocation = ++browsePracticeProjectionInvocationSequence;
    const browseProgressSourceEpoch = {
        activeLibraryGeneration: readBrowseProgressGeneration('__getActiveLibraryGeneration')
    };
    let recordsUnchanged = false;
    console.log(`[System] 正在从存储中同步练习记录... (mode=${loadMode})`);
    let [records, insightRecords, examIndex] = await Promise.all([
        listCanonicalPracticeRecordSummaries(),
        window.AppData.practice.listInsights({ limit: 10 }),
        resolveActiveExamIndex()
    ]);
    const insightsById = new Map((Array.isArray(insightRecords) ? insightRecords : [])
        .filter((record) => record && record.id)
        .map((record) => [String(record.id), record]));
    records = (Array.isArray(records) ? records : []).map((record) =>
        record && insightsById.has(String(record.id))
            ? Object.assign({}, record, insightsById.get(String(record.id)))
            : record);
    if (loadMode === 'full') {
        console.log('[System] mode=full 请求已限定为 light 视图刷新；完整记录请直接调用 AppData.practice.list()');
    }

    // Normalize duration and percentages to avoid 0-second artifacts（summary 无 realData/interactions）
    try {
        records = (records || []).map(r => {
            let duration = (typeof r.duration === 'number') ? r.duration : undefined;
            if (!(Number.isFinite(duration) && duration > 0)) {
                const sInfo = r && r.scoreInfo || {};
                const candidates = [
                    r.duration, r.durationSeconds, r.duration_seconds,
                    r.elapsedSeconds, r.elapsed_seconds, r.timeSpent, r.time_spent,
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
            }
            if (!Number.isFinite(duration)) duration = 0;

            const sInfo = r && r.scoreInfo || {};
            const correct = (typeof r.correctAnswers === 'number') ? r.correctAnswers : (typeof sInfo.correct === 'number' ? sInfo.correct : (typeof r.score === 'number' ? r.score : undefined));
            const total = (typeof r.totalQuestions === 'number') ? r.totalQuestions : (typeof sInfo.total === 'number' ? sInfo.total : undefined);
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

    // Avoid resetting the list when the authoritative light projection is unchanged.
    try {
        const renderer = window.PracticeHistoryRenderer;
        if (renderer && renderer.helpers && typeof renderer.helpers.computeRecordsSignature === 'function') {
            const nextSignature = renderer.helpers.computeRecordsSignature(records);
            if (!forceRender && lastPracticeRecordsSignature === nextSignature) {
                console.log('[System] 练习记录未变化，跳过UI刷新');
                recordsUnchanged = true;
            }
            lastPracticeRecordsSignature = nextSignature;
        }
    } catch (_) { /* 保底不中断同步流程 */ }

    // Publish Browse ownership only after the derived completion state,
    // anchors, and any active-view repaint have accepted this snapshot. A
    // newer invocation that reads successfully but fails publication must not
    // invalidate an older repaint already queued behind a foreground request.
    if (practiceProjectionInvocation > browsePracticeProjectionGeneration) {
        const projectionAccepted = refreshBrowseProgressFromRecords(
            records,
            examIndex,
            browseProgressSourceEpoch,
            { practiceProjectionGeneration: practiceProjectionInvocation }
        );
        if (projectionAccepted) {
            browsePracticeProjectionGeneration = practiceProjectionInvocation;
            Promise.resolve().then(() => {
                flushPendingBrowseProgressRefresh();
            }).catch((error) => {
                console.warn('[Browse] 刷新浏览进度列表失败:', error);
            });
        }
    }

    console.log(`[System] 已从 AppData 加载 ${records.length} 条练习摘要。`);
    if (!recordsUnchanged) {
        updatePracticeView(records, examIndex);
    }
    return records;
}

let practiceRecordsLoadPromise = null;
let activeBrowseProgressSyncLibraryGeneration = null;
let pendingBrowseProgressLibrarySync = null;

function mergeBrowseProgressLibrarySyncRequest(trigger, options, libraryGeneration) {
    const previous = pendingBrowseProgressLibrarySync;
    const previousOptions = previous && previous.options ? previous.options : {};
    const incomingOptions = options || {};
    pendingBrowseProgressLibrarySync = {
        trigger,
        libraryGeneration,
        options: {
            forceRender: !!(previousOptions.forceRender || incomingOptions.forceRender),
            mode: previousOptions.mode === 'full' || incomingOptions.mode === 'full'
                ? 'full'
                : 'summary'
        }
    };
}

async function drainBrowseProgressLibrarySync(initialRequest) {
    let request = initialRequest;
    let result = null;
    try {
        while (request) {
            activeBrowseProgressSyncLibraryGeneration = readBrowseProgressGeneration(
                '__getActiveLibraryGeneration'
            );
            let syncError = null;
            try {
                result = await syncPracticeRecords(Object.assign(
                    { mode: 'summary' },
                    request.options || {}
                ));
            } catch (error) {
                syncError = error;
            }
            request = pendingBrowseProgressLibrarySync;
            pendingBrowseProgressLibrarySync = null;
            if (syncError && !request) {
                throw syncError;
            }
            if (syncError) {
                console.warn(
                    `[System] 练习记录同步失败(${initialRequest.trigger})，继续刷新最新题库进度:`,
                    syncError
                );
            }
        }
        return result;
    } finally {
        activeBrowseProgressSyncLibraryGeneration = null;
        pendingBrowseProgressLibrarySync = null;
        practiceRecordsLoadPromise = null;
    }
}

function ensurePracticeRecordsSync(trigger = 'default', options = {}) {
    const requestedLibraryGeneration = readBrowseProgressGeneration(
        '__getActiveLibraryGeneration'
    );
    if (practiceRecordsLoadPromise) {
        // Keep the baseline single-flight contract for same-library calls. Only
        // a newer active library earns one coalesced Browse-progress tail; this
        // is not a generic Practice-data replacement scheduler.
        if (requestedLibraryGeneration != null
            && requestedLibraryGeneration !== activeBrowseProgressSyncLibraryGeneration) {
            mergeBrowseProgressLibrarySyncRequest(
                trigger,
                options,
                requestedLibraryGeneration
            );
        }
        return practiceRecordsLoadPromise;
    }
    practiceRecordsLoadPromise = drainBrowseProgressLibrarySync({
        trigger,
        options: Object.assign({}, options || {}),
        libraryGeneration: requestedLibraryGeneration
    });
    return practiceRecordsLoadPromise;
}

function startPracticeRecordsSyncInBackground(trigger = 'default', options = {}) {
    ensurePracticeRecordsSync(trigger, options).catch((error) => {
        console.warn(`[System] 后台同步练习记录失败(${trigger}):`, error);
    });
}

async function listCanonicalPracticeRecords() {
    // 两个调用方（bulkDeleteRecords / deleteRecord）只用 id、title、date 做存在性校验与确认文案，
    // light 投影已覆盖；删除本身走 AppData.practice.delete/deleteMany，不需要全量答题详情。
    const records = await window.AppData.practice.list({ projection: 'light' });
    return Array.isArray(records) ? records : [];
}

async function listCanonicalPracticeRecordSummaries() {
    const summaries = await window.AppData.practice.list({ projection: 'light' });
    return Array.isArray(summaries) ? summaries : [];
}

async function resolveActiveExamIndex() {
    if (typeof window.resolveActiveLibraryIndex === 'function') {
        const index = await window.resolveActiveLibraryIndex();
        return Array.isArray(index) ? index : [];
    }
    const manager = await ensureLibraryManagerReady();
    if (manager && typeof manager.resolveActiveIndex === 'function') {
        const index = await manager.resolveActiveIndex();
        return Array.isArray(index) ? index : [];
    }
    throw new Error('LibraryManager.resolveActiveIndex is unavailable');
}

const completionNoticeState = {
    lastSessionId: null,
    lastShownAt: 0
};

function extractCompletionPayload(envelope) {
    if (!envelope || typeof envelope !== 'object') {
        return null;
    }
    const isCompletionPayload = (candidate) => {
        if (!candidate || typeof candidate !== 'object') {
            return false;
        }
        return Boolean(
            candidate.scoreInfo
            || Array.isArray(candidate.spellingErrors)
            || typeof candidate.correctAnswers !== 'undefined'
            || typeof candidate.totalQuestions !== 'undefined'
            || (candidate.answers && typeof candidate.answers === 'object')
        );
    };
    const candidates = [
        envelope.data,
        envelope.payload,
        envelope.results,
        envelope.detail,
        envelope.realData,
        envelope
    ];
    for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        if (candidate && typeof candidate === 'object') {
            if (isCompletionPayload(candidate)) {
                return candidate;
            }
            if (isCompletionPayload(candidate.realData)) {
                if (typeof candidate.sessionId === 'string' && candidate.sessionId.trim() && !candidate.realData.sessionId) {
                    candidate.realData.sessionId = candidate.sessionId.trim();
                }
                return candidate.realData;
            }
        }
    }
    return null;
}

function extractCompletionSessionId(envelope) {
    if (!envelope || typeof envelope !== 'object') {
        return null;
    }
    if (typeof envelope.sessionId === 'string' && envelope.sessionId.trim()) {
        return envelope.sessionId.trim();
    }
    const payload = extractCompletionPayload(envelope);
    if (payload && typeof payload.sessionId === 'string' && payload.sessionId.trim()) {
        return payload.sessionId.trim();
    }
    return null;
}

// fallbackExamSessions 是纯内存 Map（js/app.js:50），主页刷新后会话映射即丢失。
// 完成消息本身携带 examId（unifiedReadingPage.buildEnvelope / practicePageEnhancer.buildResultsPayload /
// listeningRecordBridge.buildBridgePayload 都会写入），据此仍可走同一条持久化路径。
function resolveCompletionExamId(envelope, payload) {
    const sources = [payload, envelope, envelope && envelope.data];
    for (const source of sources) {
        if (!source || typeof source !== 'object') {
            continue;
        }
        const candidates = [
            source.examId,
            source.derivedExamId,
            source.metadata && typeof source.metadata === 'object' ? source.metadata.examId : null
        ];
        for (const candidate of candidates) {
            const normalized = candidate == null ? '' : String(candidate).trim();
            if (normalized) {
                return normalized;
            }
        }
    }
    return null;
}

function shouldAnnounceCompletion(sessionId) {
    const now = Date.now();
    if (sessionId && completionNoticeState.lastSessionId === sessionId) {
        return false;
    }
    if (!sessionId && (now - completionNoticeState.lastShownAt) < 1500) {
        return false;
    }
    completionNoticeState.lastSessionId = sessionId || null;
    completionNoticeState.lastShownAt = now;
    return true;
}

function pickNumericValue(values) {
    for (let i = 0; i < values.length; i += 1) {
        const value = values[i];
        if (value === undefined || value === null) {
            continue;
        }
        const num = Number(value);
        if (Number.isFinite(num)) {
            return num;
        }
    }
    return null;
}

function extractCompletionStats(payload) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }
    const scoreInfo = payload.scoreInfo || (payload.realData && payload.realData.scoreInfo) || {};
    const correct = pickNumericValue([
        scoreInfo.correct,
        payload.correctAnswers,
        payload.score,
        payload.realData && payload.realData.correctAnswers
    ]);
    const total = pickNumericValue([
        scoreInfo.total,
        payload.totalQuestions,
        payload.questionCount,
        payload.realData && payload.realData.totalQuestions,
        payload.answerComparison && typeof payload.answerComparison === 'object'
            ? Object.keys(payload.answerComparison).length
            : null,
        payload.answers && typeof payload.answers === 'object'
            ? Object.keys(payload.answers).length
            : null
    ]);
    let percentage = pickNumericValue([
        scoreInfo.percentage,
        payload.percentage,
        typeof scoreInfo.accuracy === 'number' ? scoreInfo.accuracy * 100 : null,
        typeof payload.accuracy === 'number' ? payload.accuracy * 100 : null
    ]);
    if (!Number.isFinite(percentage) && Number.isFinite(correct) && Number.isFinite(total) && total > 0) {
        percentage = (correct / total) * 100;
    }

    const hasScore = Number.isFinite(correct) && Number.isFinite(total) && total > 0;
    const hasPercentage = Number.isFinite(percentage);
    if (!hasPercentage && !hasScore) {
        return null;
    }

    return {
        percentage: hasPercentage ? percentage : null,
        correct: hasScore ? correct : null,
        total: hasScore ? total : null
    };
}

function formatPercentageDisplay(value) {
    if (!Number.isFinite(value)) {
        return null;
    }
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function showCompletionSummary(envelope) {
    const payload = extractCompletionPayload(envelope);
    const stats = extractCompletionStats(payload);
    if (!stats) {
        return;
    }
    const parts = [];
    const pctText = formatPercentageDisplay(stats.percentage);
    if (pctText) {
        parts.push(`本次正确率 ${pctText}`);
    }
    if (Number.isFinite(stats.correct) && Number.isFinite(stats.total)) {
        parts.push(`得分 ${stats.correct}/${stats.total}`);
    }
    if (parts.length === 0) {
        return;
    }
    showMessage(`📊 ${parts.join('，')}`, 'info');
}

async function saveReadingHighlightVocab(payload) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }
    try {
        if (!window.VocabStore && window.AppLazyLoader && typeof window.AppLazyLoader.ensureGroup === 'function') {
            await window.AppLazyLoader.ensureGroup('more-tools');
        }
        if (!window.VocabStore || typeof window.VocabStore.upsertReadingHighlightWord !== 'function') {
            throw new Error('VocabStore 未就绪');
        }
        const saved = await window.VocabStore.upsertReadingHighlightWord(payload);
        if (saved && typeof showMessage === 'function') {
            showMessage(`已加入阅读高亮生词：${saved.word}`, 'success');
        }
        return saved;
    } catch (error) {
        console.warn('[VocabStore] 阅读高亮生词保存失败:', error);
        if (typeof showMessage === 'function') {
            showMessage('高亮生词已在阅读页本地缓存，主词表稍后同步', 'warning');
        }
        return null;
    }
}

if (typeof window !== 'undefined') {
    window.saveReadingHighlightVocab = saveReadingHighlightVocab;
}

function setupMessageListener() {
    const resolveFallbackMessageOrigin = () => {
        const location = window.location || {};
        const rawOrigin = typeof location.origin === 'string' ? location.origin : '';
        const isOpaqueFile = location.protocol === 'file:'
            || rawOrigin === 'null'
            || rawOrigin === 'file://'
            || rawOrigin.startsWith('file:');
        return isOpaqueFile
            ? { declaredOrigin: 'null', targetOrigin: '*' }
            : { declaredOrigin: rawOrigin, targetOrigin: rawOrigin };
    };
    const findFallbackSessionByWindow = (sourceWindow) => {
        if (!sourceWindow || !window.fallbackExamSessions || typeof fallbackExamSessions.entries !== 'function') {
            return null;
        }
        try {
            for (const [sid, rec] of fallbackExamSessions.entries()) {
                if (rec && rec.win === sourceWindow) {
                    return { sid, rec };
                }
            }
        } catch (_) { }
        return null;
    };

    const sendFallbackInit = (entry) => {
        if (!entry || !entry.rec || !entry.rec.win || entry.rec.win.closed) {
            return;
        }
        const messageOrigin = resolveFallbackMessageOrigin();
        const targetOrigin = messageOrigin.targetOrigin;
        if (!targetOrigin) return;
        if (!entry.rec.windowSessionToken) {
            const cryptoApi = window.crypto;
            if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') return;
            const bytes = new Uint8Array(24);
            cryptoApi.getRandomValues(bytes);
            entry.rec.windowSessionToken = Array.from(bytes)
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('');
        }
        const payload = Object.assign({}, entry.rec.initPayload || {
            examId: entry.rec.examId,
            parentOrigin: messageOrigin.declaredOrigin,
            sessionId: entry.rec.sessionId || entry.sid
        }, {
            parentOrigin: messageOrigin.declaredOrigin,
            windowSessionToken: entry.rec.windowSessionToken
        });
        entry.rec.initPayload = payload;
        try {
            entry.rec.win.postMessage({ type: 'INIT_SESSION', data: payload, source: 'exam_host' }, targetOrigin);
            entry.rec.win.postMessage({ type: 'init_exam_session', data: payload, source: 'exam_host' }, targetOrigin);
        } catch (_) { }
    };

    const sendFallbackSubmitOutcome = (rec, payload, succeeded, errorCode = '') => {
        const submissionId = payload && payload.submissionId != null ? String(payload.submissionId).trim() : '';
        const sessionId = payload && payload.sessionId != null ? String(payload.sessionId).trim() : '';
        if (!rec || !rec.win || rec.win.closed || !submissionId || !sessionId) return false;
        const targetOrigin = resolveFallbackMessageOrigin().targetOrigin;
        if (!targetOrigin || !rec.windowSessionToken) return false;
        try {
            rec.win.postMessage({
                type: succeeded ? 'PRACTICE_SUBMIT_ACK' : 'PRACTICE_SUBMIT_FAILED',
                data: {
                    examId: payload.examId || rec.examId || null,
                    sessionId,
                    suiteSessionId: payload.suiteSessionId || null,
                    submissionId,
                    errorCode: succeeded ? null : (errorCode || 'save_failed'),
                    windowSessionToken: rec.windowSessionToken
                },
                source: 'exam_host',
                timestamp: Date.now()
            }, targetOrigin);
            return true;
        } catch (_) {
            return false;
        }
    };

    const sendFallbackVocabOutcome = (rec, payload, succeeded, errorCode = '') => {
        const requestId = payload && payload.requestId != null ? String(payload.requestId).trim() : '';
        const sessionId = payload && payload.sessionId != null
            ? String(payload.sessionId).trim()
            : String(rec && rec.sessionId || '');
        if (!rec || !rec.win || rec.win.closed || !requestId || !sessionId || !rec.windowSessionToken) return false;
        const targetOrigin = resolveFallbackMessageOrigin().targetOrigin;
        if (!targetOrigin) return false;
        try {
            rec.win.postMessage({
                type: succeeded ? 'VOCAB_HIGHLIGHT_SAVE_ACK' : 'VOCAB_HIGHLIGHT_SAVE_FAILED',
                data: {
                    requestId,
                    examId: payload.examId || rec.examId || null,
                    sessionId,
                    errorCode: succeeded ? null : (errorCode || 'save_failed'),
                    windowSessionToken: rec.windowSessionToken
                },
                source: 'exam_host',
                timestamp: Date.now()
            }, targetOrigin);
            return true;
        } catch (_) {
            return false;
        }
    };

    const verifyFallbackPracticeCompletionRecord = async (record) => {
        if (!record || typeof record !== 'object' || !record.id || !record.examId || !record.sessionId) {
            return null;
        }
        if (!window.AppData || !window.AppData.practice || typeof window.AppData.practice.get !== 'function') {
            return null;
        }
        const persisted = await window.AppData.practice.get(String(record.id), { projection: 'light' });
        if (!persisted || typeof persisted !== 'object') {
            return null;
        }
        return String(persisted.id || '') === String(record.id)
            && String(persisted.examId || '') === String(record.examId)
            && String(persisted.sessionId || '') === String(record.sessionId)
            ? persisted
            : null;
    };

    window.addEventListener('message', (event) => {
        const data = event.data || {};
        const type = data.type;
        const payload = data && typeof data.data === 'object' ? data.data : data;
        const matched = findFallbackSessionByWindow(event.source);
        if (!matched || !matched.rec) return;
        const isLocalFile = window.location && window.location.protocol === 'file:';
        if (isLocalFile ? event.origin !== 'null' : event.origin !== window.location.origin) return;
        const allowedSources = new Set(['practice_page', 'inline_collector', 'listening_record_bridge', 'suite_placeholder']);
        if (!allowedSources.has(data.source || payload.source)) return;
        const permitsPreInit = type === 'REQUEST_INIT'
            || (type === 'SESSION_READY' && payload.initialized !== true);
        if (!permitsPreInit && (
            !matched.rec.windowSessionToken
            || payload.windowSessionToken !== matched.rec.windowSessionToken
        )) {
            return;
        }
        if (type === 'SESSION_READY') {
            if (payload && payload.initialized === false) {
                sendFallbackInit(matched);
                return;
            }

            // 子页未携带 sessionId，这里基于 event.source 匹配对应会话并停止握手重试
            try {
                if (matched && matched.rec) {
                    if (matched.rec.timer) clearInterval(matched.rec.timer);
                    console.log('[Fallback] 会话就绪(匹配到窗口):', matched.sid);
                }
            } catch (_) { }
        } else if (type === 'REQUEST_INIT') {
            sendFallbackInit(matched);
        } else if (type === 'VOCAB_HIGHLIGHT_SAVE') {
            const payload = data.data && typeof data.data === 'object' ? data.data : data;
            const requestId = payload && payload.requestId != null ? String(payload.requestId).trim() : '';
            if (!requestId) return;
            saveReadingHighlightVocab(payload).then((saved) => {
                sendFallbackVocabOutcome(matched.rec, payload, Boolean(saved), saved ? '' : 'save_failed');
            }).catch((error) => {
                console.warn('[VocabStore] 阅读高亮生词保存异常:', error);
                sendFallbackVocabOutcome(matched.rec, payload, false, 'save_failed');
            });
        } else if (type === 'PRACTICE_COMPLETE' || type === 'practice_completed') {
            const payload = extractCompletionPayload(data) || {};
            const sessionId = extractCompletionSessionId(data);
            const matchedByWindow = matched;
            const rec = sessionId ? (fallbackExamSessions.get(sessionId) || (matchedByWindow && matchedByWindow.rec)) : (matchedByWindow && matchedByWindow.rec);
            const recSessionId = rec && (rec.sessionId || (matchedByWindow && matchedByWindow.sid) || sessionId);
            if (recSessionId && payload && typeof payload === 'object') {
                payload.sessionId = recSessionId;
            }
            if (!payload.submissionId || !recSessionId) return;
            const receiptKey = payload.submissionId && recSessionId
                ? `${recSessionId}:${String(payload.submissionId)}`
                : '';
            if (rec && receiptKey && rec.practiceSubmitReceipt === receiptKey) {
                sendFallbackSubmitOutcome(rec, payload, true);
                return;
            }
            const shouldNotify = shouldAnnounceCompletion(recSessionId || sessionId);
            const cleanupAfterCompletion = () => {
                try { if (rec && rec.timer) clearInterval(rec.timer); } catch (_) { }
                if (rec && receiptKey) {
                    try { if (rec.submitCleanupTimer) clearTimeout(rec.submitCleanupTimer); } catch (_) { }
                    rec.submitCleanupTimer = setTimeout(() => {
                        try { fallbackExamSessions.delete(recSessionId || sessionId); } catch (_) { }
                    }, 120000);
                    if (rec.submitCleanupTimer && typeof rec.submitCleanupTimer.unref === 'function') {
                        rec.submitCleanupTimer.unref();
                    }
                    return;
                }
                try { fallbackExamSessions.delete(recSessionId || sessionId); } catch (_) { }
            };
            const onCompletionSaved = async (savedRecord) => {
                const persistedRecord = await verifyFallbackPracticeCompletionRecord(savedRecord);
                if (!persistedRecord) {
                    throw new Error('canonical_completion_readback_failed');
                }
                if (rec && receiptKey) rec.practiceSubmitReceipt = receiptKey;
                sendFallbackSubmitOutcome(rec, payload, true);
                // 保存成功：提示完成、展示摘要、同步记录。
                cleanupAfterCompletion();
                if (shouldNotify) {
                    showMessage('练习已完成，正在更新记录...', 'success');
                    showCompletionSummary(payload);
                }
                setTimeout(() => ensurePracticeRecordsSync('completion-saved'), 300);
            };
            const onCompletionSaveFailed = (saveError) => {
                sendFallbackSubmitOutcome(rec, payload, false, 'save_failed');
                // 保存失败：仍清理 timer/session，但不展示“已完成”成功横幅与摘要，
                // 避免在记录未落库时误导用户；同步一次以反映真实状态。
                console.error('[System] 练习完成记录保存失败:', saveError);
                cleanupAfterCompletion();
                if (shouldNotify) {
                    showMessage('练习已完成，但记录保存失败，请重试或检查数据。', 'error');
                }
                setTimeout(() => ensurePracticeRecordsSync('completion-save-failed'), 300);
            };
            if (rec) {
                console.log('[System] 收到练习完成，保存 canonical 记录');
                savePracticeCompletionRecord(rec.examId, payload).then(onCompletionSaved).catch(onCompletionSaveFailed);
            } else {
                // 会话映射缺失（例如主页刷新后 fallbackExamSessions 已被清空）。此前这里只做只读同步，
                // 记录一个字都不写却提示“练习已完成”。改为用消息自带的 examId 走同一条持久化路径。
                const payloadExamId = resolveCompletionExamId(data, payload);
                if (payloadExamId) {
                    console.log('[System] 会话映射缺失，改用消息自带 examId 保存 canonical 记录:', payloadExamId);
                    savePracticeCompletionRecord(payloadExamId, payload).then(onCompletionSaved).catch(onCompletionSaveFailed);
                } else {
                    // 连 examId 都没有就无法归属到任何题目，必须明确报错，绝不能报成功。
                    console.error('[System] 练习完成消息缺少 examId，无法保存记录');
                    sendFallbackSubmitOutcome(rec, payload, false, 'missing_exam_id');
                    if (shouldNotify) {
                        showMessage('练习已完成，但记录保存失败：缺少题目标识，无法归档本次练习。', 'error');
                    }
                    setTimeout(() => ensurePracticeRecordsSync('completion-missing-exam-id'), 300);
                }
            }
        }
    });
}

function normalizeFallbackAnswerValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'boolean') {
        return value ? 'True' : 'False';
    }
    if (Array.isArray(value)) {
        return value
            .map((item) => normalizeFallbackAnswerValue(item))
            .filter(Boolean)
            .join(', ');
    }
    if (typeof value === 'object') {
        const preferKeys = ['value', 'label', 'text', 'answer', 'content'];
        for (const key of preferKeys) {
            if (typeof value[key] === 'string' && value[key].trim()) {
                return value[key].trim();
            }
        }
        if (typeof value.innerText === 'string' && value.innerText.trim()) {
            return value.innerText.trim();
        }
        if (typeof value.textContent === 'string' && value.textContent.trim()) {
            return value.textContent.trim();
        }
        try {
            const json = JSON.stringify(value);
            if (json && json !== '{}' && json !== '[]') {
                return json;
            }
        } catch (_) { }
        return String(value);
    }
    return String(value).trim();
}

function normalizeFallbackAnswerMap(rawAnswers) {
    const map = {};
    if (!rawAnswers) {
        return map;
    }
    if (Array.isArray(rawAnswers)) {
        rawAnswers.forEach((entry, index) => {
            if (!entry) return;
            const key = entry.questionId || `q${index + 1}`;
            map[key] = normalizeFallbackAnswerValue(entry.answer ?? entry.userAnswer ?? entry.value ?? entry);
        });
        return map;
    }
    Object.entries(rawAnswers).forEach(([rawKey, rawValue]) => {
        if (!rawKey) return;
        const key = rawKey.startsWith('q') ? rawKey : `q${rawKey}`;
        map[key] = normalizeFallbackAnswerValue(
            rawValue && typeof rawValue === 'object' && 'answer' in rawValue
                ? rawValue.answer
                : rawValue
        );
    });
    return map;
}

function buildFallbackAnswerDetails(answerMap = {}, correctMap = {}) {
    const details = {};
    const keys = new Set([
        ...Object.keys(answerMap || {}),
        ...Object.keys(correctMap || {})
    ]);
    keys.forEach((key) => {
        const userAnswer = normalizeFallbackAnswerValue(answerMap[key]);
        const correctAnswer = normalizeFallbackAnswerValue(correctMap[key]);
        let isCorrect = null;
        if (correctAnswer) {
            isCorrect = userAnswer && userAnswer.toLowerCase() === correctAnswer.toLowerCase();
        }
        details[key] = {
            userAnswer: userAnswer || '-',
            correctAnswer: correctAnswer || '-',
            isCorrect
        };
    });
    return details;
}

function normalizeFallbackAnswerComparison(existingComparison, answerMap, correctMap) {
    const normalized = {};
    const source = existingComparison && typeof existingComparison === 'object' ? existingComparison : {};
    Object.entries(source).forEach(([questionId, entry]) => {
        if (!entry || typeof entry !== 'object') return;
        normalized[questionId] = {
            questionId,
            userAnswer: normalizeFallbackAnswerValue(entry.userAnswer ?? entry.user ?? entry.answer),
            correctAnswer: normalizeFallbackAnswerValue(entry.correctAnswer ?? entry.correct),
            isCorrect: typeof entry.isCorrect === 'boolean' ? entry.isCorrect : null
        };
    });

    const mergedKeys = new Set([
        ...Object.keys(answerMap || {}),
        ...Object.keys(correctMap || {})
    ]);
    mergedKeys.forEach((key) => {
        if (normalized[key]) return;
        const userAnswer = normalizeFallbackAnswerValue(answerMap[key]);
        const correctAnswer = normalizeFallbackAnswerValue(correctMap[key]);
        let isCorrect = null;
        if (correctAnswer) {
            isCorrect = userAnswer && userAnswer.toLowerCase() === correctAnswer.toLowerCase();
        }
        normalized[key] = {
            questionId: key,
            userAnswer: userAnswer || '',
            correctAnswer: correctAnswer || '',
            isCorrect
        };
    });

    return normalized;
}

function normalizeFallbackSpellingErrors(examId, realData, exam = {}) {
    const rawErrors = Array.isArray(realData?.spellingErrors)
        ? realData.spellingErrors
        : (Array.isArray(realData?.realData?.spellingErrors) ? realData.realData.spellingErrors : []);
    if (!rawErrors.length) {
        return [];
    }

    const resolvedExamId = exam?.id || realData?.examId || examId;
    const collector = window.spellingErrorCollector;
    const sourceProbe = [
        resolvedExamId,
        exam?.path,
        exam?.category,
        exam?.title,
        realData?.source,
        realData?.pageType,
        realData?.type
    ].filter(Boolean).join(' ');
    const detectedSource = collector && typeof collector.detectSource === 'function'
        ? collector.detectSource(sourceProbe)
        : '';
    const resolvedSessionId = realData?.sessionId || realData?.realData?.sessionId || '';
    const suiteId = realData?.suiteId || realData?.suiteSessionId || realData?.realData?.suiteId || realData?.realData?.suiteSessionId || '';

    return rawErrors.map((error) => {
        if (!error || typeof error !== 'object') {
            return null;
        }
        const normalized = Object.assign({}, error, { examId: resolvedExamId });
        if (resolvedSessionId) {
            normalized.sessionId = resolvedSessionId;
        }
        if (suiteId && !normalized.suiteId) {
            normalized.suiteId = suiteId;
        }
        if ((detectedSource === 'p1' || detectedSource === 'p4') && (!normalized.source || normalized.source === 'other')) {
            normalized.source = detectedSource;
        }
        return normalized;
    }).filter(Boolean);
}

async function saveFallbackSpellingErrors(examId, realData, exam = {}) {
    const collector = window.spellingErrorCollector;
    if (!collector || typeof collector.saveErrors !== 'function') {
        return;
    }
    const spellingErrors = normalizeFallbackSpellingErrors(examId, realData, exam);
    if (!spellingErrors.length) {
        return;
    }
    try {
        await collector.saveErrors(spellingErrors);
    } catch (error) {
        console.warn('[Fallback] 保存拼写错误词表失败（不影响主流程）:', error);
    }
}

function findExamForCompletion(examId, realData = {}, examIndex = []) {
    const list = Array.isArray(examIndex) ? examIndex : [];
    let exam = list.find(e => e.id === examId) || {};

    if (exam.id || !realData) {
        return exam;
    }

    if (realData.url) {
        const urlPath = String(realData.url).toLowerCase();
        const urlMatch = list.find(e => {
            if (!e.path) return false;
            const itemPath = String(e.path).toLowerCase();
            const urlParts = urlPath.split('/').filter(Boolean);
            const pathParts = itemPath.split('/').filter(Boolean);
            for (let i = 0; i < Math.min(urlParts.length, pathParts.length); i += 1) {
                if (urlParts[urlParts.length - 1 - i] === pathParts[pathParts.length - 1 - i]) {
                    return true;
                }
            }
            return false;
        });
        if (urlMatch) {
            return urlMatch;
        }
    }

    if (realData.title) {
        const normalizeTitle = (str) => String(str || '').trim().toLowerCase()
            .replace(/^\[.*?\]\s*/, '')
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ');
        const targetTitle = normalizeTitle(realData.title);
        const titleMatch = list.find(e => {
            if (!e.title) return false;
            const itemTitle = normalizeTitle(e.title);
            return itemTitle === targetTitle
                || (targetTitle.length > 5 && itemTitle.includes(targetTitle))
                || (itemTitle.length > 5 && targetTitle.includes(itemTitle));
        });
        if (titleMatch) {
            return titleMatch;
        }
    }

    return exam;
}

function resolveCompletionCategory(exam = {}, realData = {}) {
    if (exam.category) {
        return exam.category;
    }
    if (realData.pageType) {
        return realData.pageType;
    }
    const probes = [realData.url, realData.title].filter(Boolean);
    for (const probe of probes) {
        const match = String(probe).match(/\b(P[1-4])\b/i);
        if (match) {
            return match[1].toUpperCase();
        }
    }
    return 'Unknown';
}

async function savePracticeCompletionRecord(examId, realData) {
    try {
        const suiteSessionId = realData?.suiteSessionId
            || realData?.metadata?.suiteSessionId
            || realData?.scoreInfo?.suiteSessionId
            || null;
        const normalizedPracticeMode = String(realData?.practiceMode || realData?.metadata?.practiceMode || '').toLowerCase();
        const normalizedFrequency = String(realData?.frequency || realData?.metadata?.frequency || '').toLowerCase();
        const hasSuiteEntries = Array.isArray(realData?.suiteEntries) && realData.suiteEntries.length > 0;
        const isSuiteAggregatePayload = hasSuiteEntries
            || Array.isArray(realData?.metadata?.suiteEntries);
        const isSuiteFlow = Boolean(
            suiteSessionId
            || realData?.suiteMode
            || normalizedPracticeMode === 'suite'
            || normalizedFrequency === 'suite'
        );
        if (isSuiteFlow && !isSuiteAggregatePayload) {
            console.log('[PracticeRecord] 检测到套题模式子结果，跳过单篇保存:', {
                examId,
                suiteSessionId: suiteSessionId || null
            });
            return null;
        }

        const examIndex = await resolveActiveExamIndex();
        const exam = findExamForCompletion(examId, realData, examIndex);
        const category = resolveCompletionCategory(exam, realData);
        // 启动时捕获的题库配置 ID：优先取 PRACTICE_COMPLETE 消息或 realData 已显式透传的值，
        // 否则显式写入 null（保留 key），让 AppData provenance 不再回退到当前激活题库，
        // 避免用户在考试过程中切换题库导致记录来源不一致。
        const launchLibraryConfigurationId = (realData && realData.libraryConfigurationId != null
                && realData.libraryConfigurationId !== '')
            ? realData.libraryConfigurationId
            : (realData && realData.metadata && realData.metadata.libraryConfigurationId != null
                && realData.metadata.libraryConfigurationId !== '')
                ? realData.metadata.libraryConfigurationId
                : null;
        const receipt = await window.AppData.practice.completeAttempt({
            record: Object.assign({}, realData, {
                examId,
                title: realData.title || exam.title || '',
                category,
                frequency: exam.frequency || realData.frequency || 'unknown',
                type: exam.type || realData.type || null,
                metadata: Object.assign({}, realData.metadata || {}, {
                examId,
                examTitle: exam.title || realData.title || '',
                category,
                frequency: exam.frequency || realData.frequency || 'unknown',
                type: exam.type || realData.type || null,
                libraryConfigurationId: launchLibraryConfigurationId
                })
            }),
            operationId: realData.operationId
                || realData.messageId
                || (realData.submissionId
                    ? `practice-complete:${examId}:${realData.sessionId || 'session'}:${realData.submissionId}`
                    : undefined)
        });

        await saveFallbackSpellingErrors(examId, realData, exam);
        console.log('[PracticeRecord] 练习完成数据已保存到 canonical store');
        return receipt.record;
    } catch (e) {
        console.error('[PracticeRecord] 保存练习记录失败:', e);
        throw e;
    }
}

async function loadLibraryInternal(keyOrForceReload = false) {
    const manager = await ensureLibraryManagerReady();
    if (!manager) {
        console.warn('[Library] LibraryManager 未就绪，跳过加载');
        return;
    }

    const supportsManagerLoad = typeof manager.loadLibrary === 'function';
    const supportsApplyConfig = typeof manager.applyLibraryConfiguration === 'function';
    const supportsLoadActive = typeof manager.loadActiveLibrary === 'function';

    if (typeof keyOrForceReload === 'string') {
        if (supportsManagerLoad) {
            return manager.loadLibrary(keyOrForceReload);
        }
        if (supportsApplyConfig) {
            return manager.applyLibraryConfiguration(keyOrForceReload);
        }
    }

    const forceReload = !!keyOrForceReload;
    if (supportsLoadActive) {
        return manager.loadActiveLibrary(forceReload);
    }
    if (supportsManagerLoad) {
        return manager.loadLibrary(forceReload ? 'default' : undefined);
    }
}

function resolveScriptPathRoot(type) {
    const manager = getLibraryManager();
    if (manager && typeof manager.resolveScriptPathRoot === 'function') {
        return manager.resolveScriptPathRoot(type);
    }
    return type === 'reading'
        ? '睡着过项目组/2. 所有文章(11.20)[192篇]/'
        : 'ListeningPractice/';
}

function finishLibraryLoading(startTime) {
    const manager = getLibraryManager();
    if (manager && typeof manager.finishLibraryLoading === 'function') {
        return manager.finishLibraryLoading(startTime);
    }
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

function updateOverview(examIndex = []) {
    const categoryContainer = document.getElementById('category-overview');
    if (!categoryContainer) {
        console.warn('[Overview] 找不到 category-overview 容器');
        return;
    }

    const currentExamIndex = Array.isArray(examIndex) ? examIndex : [];
    const statsService = window.AppServices && window.AppServices.overviewStats;
    const stats = statsService ?
        statsService.calculate(currentExamIndex) :
        {
            reading: [],
            listening: [],
            meta: {
                readingUnknown: 0,
                listeningUnknown: 0,
                total: currentExamIndex.length,
                readingUnknownEntries: [],
                listeningUnknownEntries: []
            }
        };

    const view = getOverviewView();
    if (view && window.DOM && window.DOM.builder) {
        view.render(stats, {
            container: categoryContainer,
            actions: {
                onBrowseCategory: (category, type, filterMode, path) => {
                    if (typeof browseCategory === 'function') {
                        browseCategory(category, type, filterMode, path);
                    }
                },
                onRandomPractice: (category, type, filterMode, path) => {
                    if (typeof startRandomPractice === 'function') {
                        startRandomPractice(category, type, filterMode, path);
                    }
                },
                onStartSuite: () => {
                    startSuitePractice();
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

    const suiteCard = adapter.create('div', {
        className: 'category-card'
    }, [
        adapter.create('div', { className: 'category-header' }, [
            adapter.create('div', { className: 'category-icon', ariaHidden: 'true' }, '🚀'),
            adapter.create('div', {}, [
                adapter.create('div', { className: 'category-title' }, '套题模式'),
                adapter.create('div', { className: 'category-meta' }, '三篇阅读一键串联')
            ])
        ]),
        adapter.create('div', {
            className: 'category-actions',
            style: {
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center'
            }
        }, [
            adapter.create('button', {
                type: 'button',
                className: 'btn btn-primary',
                dataset: {
                    action: 'start-suite-mode',
                    overviewAction: 'suite'
                }
            }, [
                adapter.create('span', { className: 'category-action-icon', ariaHidden: 'true' }, '🚀'),
                adapter.create('span', { className: 'category-action-label' }, '开启套题模式')
            ])
        ])
    ]);

    sections.push(suiteCard);

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
        const action = target.dataset.overviewAction;
        if (!action) {
            return;
        }

        event.preventDefault();

        if (action === 'suite') {
            startSuitePractice();
            return;
        }

        const category = target.dataset.category;
        const type = target.dataset.examType || 'reading';
        const filterMode = target.dataset.filterMode || null;
        const path = target.dataset.path || null;

        if (!category) {
            return;
        }

        if (action === 'browse') {
            if (typeof browseCategory === 'function') {
                browseCategory(category, type, filterMode, path);
            } else {
                try { applyBrowseFilter(category, type, filterMode, path); } catch (_) { }
            }
            return;
        }

        if (action === 'random' && typeof startRandomPractice === 'function') {
            startRandomPractice(category, type, filterMode, path);
        }
    };

    const hasDomDelegate = typeof window !== 'undefined'
        && window.DOM
        && typeof window.DOM.delegate === 'function';

    if (hasDomDelegate) {
        window.DOM.delegate('click', '#category-overview [data-overview-action]', function (event) {
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

function refreshBulkDeleteButton() {
    const btn = document.getElementById('bulk-delete-btn');
    if (!btn) {
        return;
    }

    const mode = getBulkDeleteModeState();
    const selected = getSelectedRecordsState();
    const count = selected.size;

    if (mode) {
        btn.classList.remove('btn-info');
        btn.classList.add('btn-success');
        btn.textContent = count > 0 ? `✓ 完成选择 (${count})` : '✓ 完成选择';
    } else {
        btn.classList.remove('btn-success');
        btn.classList.add('btn-info');
        btn.textContent = count > 0 ? `📝 批量删除 (${count})` : '📝 批量删除';
    }
}

function ensureBulkDeleteMode(options = {}) {
    const { silent = false } = options || {};
    if (getBulkDeleteModeState()) {
        return false;
    }

    setBulkDeleteModeState(true);
    if (!silent && typeof showMessage === 'function') {
        showMessage('批量管理模式已开启，点击记录进行选择', 'info');
    }
    refreshBulkDeleteButton();
    return true;
}

// Phase 3: 练习历史交互设置 - 保留在 main.js（依赖 DOM 事件委托，暂不迁移）
let practiceHistoryDelegatesConfigured = false;

function setupPracticeHistoryInteractions() {
    if (practiceHistoryDelegatesConfigured) {
        return;
    }

    const container = document.getElementById('practice-history-list') || document.getElementById('history-list');
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
        if (!getBulkDeleteModeState() || !recordId) return;
        if (event) event.preventDefault();
        toggleRecordSelection(recordId);
    };

    const handleCheckbox = (recordId, event) => {
        if (!recordId) {
            return;
        }
        ensureBulkDeleteMode({ silent: true });
        if (event && typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }
        toggleRecordSelection(recordId);
    };

    const hasDomDelegate = typeof window !== 'undefined' && window.DOM && typeof window.DOM.delegate === 'function';

    if (hasDomDelegate) {
        window.DOM.delegate('click', '.practice-history-list [data-record-action="details"], #history-list [data-record-action="details"]', function (event) {
            handleDetails(this.dataset.recordId, event);
        });

        window.DOM.delegate('click', '.practice-history-list [data-record-action="delete"], #history-list [data-record-action="delete"]', function (event) {
            handleDelete(this.dataset.recordId, event);
        });

        window.DOM.delegate('click', '.practice-history-list .history-item, #history-list .history-item', function (event) {
            const actionTarget = event.target.closest('[data-record-action]');
            if (actionTarget) return;
            if (event.target && event.target.matches('input[data-record-id]')) {
                return;
            }
            handleSelection(this.dataset.recordId, event);
        });

        window.DOM.delegate('change', '.practice-history-list input[data-record-id], #history-list input[data-record-id]', function (event) {
            handleCheckbox(this.dataset.recordId, event);
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
                if (actionTarget || (event.target && event.target.matches('input[data-record-id]'))) {
                    return;
                }
                handleSelection(item.dataset.recordId, event);
            }
        });

        container.addEventListener('change', (event) => {
            const checkbox = event.target.closest('input[data-record-id]');
            if (!checkbox || !container.contains(checkbox)) {
                return;
            }
            handleCheckbox(checkbox.dataset.recordId, event);
        });
    }

    practiceHistoryDelegatesConfigured = true;
}

function normalizeRecordType(value) {
    if (!value) {
        return '';
    }
    const normalized = String(value).toLowerCase();
    if (normalized.includes('read') || normalized.includes('阅读')) {
        return 'reading';
    }
    if (normalized.includes('listen') || normalized.includes('听力')) {
        return 'listening';
    }
    return normalized;
}

function recordMatchesExamType(record, targetType, examIndex) {
    const normalizedTarget = normalizeRecordType(targetType);
    if (!normalizedTarget || normalizedTarget === 'all') {
        return true;
    }
    if (!record) {
        return false;
    }

    const recordType = normalizeRecordType(
        record.type ||
        record.examType ||
        record.metadata?.type ||
        record.realData?.type
    );
    if (recordType) {
        return recordType === normalizedTarget;
    }

    const list = Array.isArray(examIndex) ? examIndex : [];
    const exam = list.find((e) => e && (e.id === record.examId || e.title === record.title));
    const examType = normalizeRecordType(exam && exam.type);
    if (examType) {
        return examType === normalizedTarget;
    }

    // 保底保留，避免题库切换导致无法映射类型时练习记录消失
    return true;
}

// 练习记录渲染前的来源过滤。判定本身不在这里实现，而是复用
// js/data/practiceRecordSource.js（与 practice.stats / achievements.progress 投影器同源），
// 因为“列表看不见但计入统计”的 bug 正是由两处各写一套判定造成的。
//
// 用 filterRecordsForHistoryView 而不是 filterRealPracticeRecords：两者对"真实记录"的
// 判定完全相同，前者额外放行新手引导显式登记的演示记录 id（引导需要用户看见那一行）。
// 该例外只存在于视图层，投影器读不到，因此统计与成就仍严格排除演示数据。
function filterRealPracticeRecordsForView(records) {
    const list = Array.isArray(records) ? records : [];
    const classifier = window.PracticeRecordSource;
    if (!classifier || typeof classifier.filterRecordsForHistoryView !== 'function') {
        // core-foundation 里的 appData.js 缺少该模块会直接抛错、应用根本起不来，
        // 所以走到这里只能是加载顺序被破坏。此时绝不本地复刻判定：显式报错并保留全部记录，
        // 宁可多显示演示记录，也不能重演"真实记录被吃掉、练习记录页整页空白"。
        console.error('[PracticeHistory] PracticeRecordSource 未加载，已跳过演示记录过滤（判定必须与统计/成就同源）');
        return list;
    }
    return classifier.filterRecordsForHistoryView(list);
}

// Phase 3: 练习记录视图更新 - 保留在 main.js（依赖多个组件，暂不迁移）
function updatePracticeView(recordsSnapshot = [], examIndexSnapshot = []) {
    const rawRecords = Array.isArray(recordsSnapshot) ? recordsSnapshot : [];
    const examIndex = Array.isArray(examIndexSnapshot) ? examIndexSnapshot : [];
    // 排除演示/种子记录。判定必须与 practice.stats / achievements.progress 两个投影器
    // 完全一致，否则会重演“演示记录在列表里看不见，却计入成绩统计和成就解锁”。
    // 唯一权威定义在 js/data/practiceRecordSource.js（含“dataSource 缺失即真实记录”，
    // 该语义曾因被收窄导致练习记录页整页空白，不得回退）。
    const records = filterRealPracticeRecordsForView(rawRecords);

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
    const historyContainer = document.getElementById('practice-history-list') || document.getElementById('history-list');
    if (!historyContainer) {
        return;
    }

    setupPracticeHistoryInteractions();

    let recordsToShow = stats && typeof stats.sortByDateDesc === 'function'
        ? stats.sortByDateDesc(records)
        : records.slice().sort((a, b) => new Date(b.date) - new Date(a.date));

    const examType = getCurrentExamType();
    if (examType !== 'all') {
        if (stats && typeof stats.filterByExamType === 'function') {
            recordsToShow = stats.filterByExamType(recordsToShow, examIndex, examType);
        } else {
            recordsToShow = recordsToShow.filter((record) => recordMatchesExamType(record, examType, examIndex));
        }
    }

    const recordsForInsights = recordsToShow.slice();

    const historyQuery = String(window.__practiceHistoryQuery || '').trim().toLowerCase();
    if (historyQuery) {
        recordsToShow = recordsToShow.filter((record) => {
            if (!record) {
                return false;
            }
            const fields = [
                record.title,
                record.examId,
                record.category,
                record.frequency,
                record.metadata && record.metadata.examTitle,
                record.metadata && record.metadata.category,
                record.date
            ];
            return fields.some((field) => String(field || '').toLowerCase().includes(historyQuery));
        });
    }

    const trendRenderer = ensurePracticeTrendRenderer();
    if (trendRenderer && typeof trendRenderer.update === 'function') {
        trendRenderer.update(recordsToShow);
    }

    const priorityRenderer = ensurePracticePriorityRenderer();
    if (priorityRenderer && typeof priorityRenderer.update === 'function') {
        priorityRenderer.update(recordsForInsights, examIndex, { examType });
    }

    // --- 4. Render history list ---
    const renderer = window.PracticeHistoryRenderer;
    if (!renderer) {
        console.warn('[PracticeHistory] Renderer 未加载，跳过渲染');
        return;
    }

    const renderResult = typeof renderer.renderView === 'function'
        ? renderer.renderView({
            container: historyContainer,
            records: recordsToShow,
            bulkDeleteMode: getBulkDeleteModeState(),
            selectedRecords: getSelectedRecordsState(),
            scrollerOptions: { itemHeight: 100, containerHeight: 650 },
            scroller: practiceListScroller
        })
        : null;
    if (renderResult && renderResult.scroller !== undefined) {
        practiceListScroller = renderResult.scroller;
    }
    refreshBulkDeleteButton();
}

function searchPracticeHistory(query) {
    window.__practiceHistoryQuery = String(query || '').trim();
    const clearButton = document.getElementById('history-search-clear-btn');
    if (clearButton) {
        clearButton.hidden = window.__practiceHistoryQuery.length === 0;
    }
    startPracticeRecordsSyncInBackground('history-search', { forceRender: true });
}

function clearPracticeHistorySearch() {
    const input = document.getElementById('history-search-input');
    if (input) {
        input.value = '';
        try {
            input.focus();
        } catch (_) { }
    }
    searchPracticeHistory('');
}

let pendingBrowseProgressRefresh = null;
let browseProgressRefreshRetryTimer = null;

function readBrowseProgressGeneration(getterName) {
    const getter = window && typeof window[getterName] === 'function'
        ? window[getterName]
        : null;
    if (!getter) {
        return null;
    }
    try {
        const value = Number(getter());
        return Number.isFinite(value) ? value : null;
    } catch (_) {
        return null;
    }
}

function readBrowseFunctionalResetState() {
    const getter = window && typeof window.__getBrowseFunctionalResetState === 'function'
        ? window.__getBrowseFunctionalResetState
        : null;
    if (!getter) {
        return { generation: null, status: 'idle', outcome: null };
    }
    try {
        const state = getter();
        const generation = Number(state && state.generation);
        return {
            generation: Number.isFinite(generation) ? generation : null,
            status: state && typeof state.status === 'string' ? state.status : 'idle',
            outcome: state && typeof state.outcome === 'boolean' ? state.outcome : null
        };
    } catch (_) {
        return { generation: null, status: 'idle', outcome: null };
    }
}

function captureBrowseProgressRefreshEpoch(sourceEpoch = null) {
    const source = sourceEpoch && typeof sourceEpoch === 'object' ? sourceEpoch : {};
    const hasSourceLibraryGeneration = Object.prototype.hasOwnProperty.call(
        source,
        'activeLibraryGeneration'
    );
    const functionalResetState = readBrowseFunctionalResetState();
    return {
        navigationGeneration: readBrowseProgressGeneration('__getAppNavigationIntentGeneration'),
        activeLibraryGeneration: hasSourceLibraryGeneration
            ? source.activeLibraryGeneration
            : readBrowseProgressGeneration('__getActiveLibraryGeneration'),
        practiceProjectionGeneration: Number.isFinite(Number(source.practiceProjectionGeneration))
            ? Number(source.practiceProjectionGeneration)
            : browsePracticeProjectionGeneration,
        resetGeneration: readBrowseProgressGeneration('__getBrowseResetIntentGeneration'),
        functionalResetGeneration: functionalResetState.generation,
        functionalResetWasPending: functionalResetState.status === 'pending'
    };
}

function isBrowseProgressRefreshEpochCurrent(epoch) {
    const captured = epoch && typeof epoch === 'object' ? epoch : {};
    const generationGetters = {
        navigationGeneration: '__getAppNavigationIntentGeneration',
        activeLibraryGeneration: '__getActiveLibraryGeneration',
        resetGeneration: '__getBrowseResetIntentGeneration'
    };
    const ordinaryGenerationsAreCurrent = Object.keys(generationGetters).every((key) => {
        if (captured[key] == null) {
            return true;
        }
        return readBrowseProgressGeneration(generationGetters[key]) === captured[key];
    });
    if (!ordinaryGenerationsAreCurrent) {
        return false;
    }
    if (captured.practiceProjectionGeneration != null
        && captured.practiceProjectionGeneration !== browsePracticeProjectionGeneration) {
        return false;
    }
    if (captured.functionalResetGeneration == null) {
        return true;
    }
    return readBrowseFunctionalResetState().generation === captured.functionalResetGeneration;
}

function clearPendingBrowseProgressRefresh() {
    pendingBrowseProgressRefresh = null;
    if (browseProgressRefreshRetryTimer != null) {
        clearTimeout(browseProgressRefreshRetryTimer);
        browseProgressRefreshRetryTimer = null;
    }
}

function retryPendingBrowseProgressRefresh() {
    if (browseProgressRefreshRetryTimer != null) {
        return;
    }
    browseProgressRefreshRetryTimer = setTimeout(() => {
        browseProgressRefreshRetryTimer = null;
        flushPendingBrowseProgressRefresh();
    }, 50);
}

function flushPendingBrowseProgressRefresh() {
    const pending = pendingBrowseProgressRefresh;
    if (!pending || !Array.isArray(pending.index)) {
        return;
    }
    if (!isBrowseProgressRefreshEpochCurrent(pending.epoch)) {
        clearPendingBrowseProgressRefresh();
        return;
    }
    const functionalResetState = readBrowseFunctionalResetState();
    if (functionalResetState.status === 'failed') {
        clearPendingBrowseProgressRefresh();
        return;
    }
    if (functionalResetState.status === 'pending') {
        retryPendingBrowseProgressRefresh();
        return;
    }
    if (pending.epoch && pending.epoch.functionalResetWasPending) {
        // The post-reset activation owns the canonical render. A progress
        // snapshot observed during the barrier must never replay afterward.
        clearPendingBrowseProgressRefresh();
        return;
    }
    const browseView = document.getElementById('browse-view');
    const isBrowseActive = browseView && browseView.classList.contains('active');
    if (!isBrowseActive) {
        clearPendingBrowseProgressRefresh();
        return;
    }
    const resetInFlight = typeof window.__isBrowseResetIntentInFlight === 'function'
        && window.__isBrowseResetIntentInFlight();
    if (resetInFlight) {
        retryPendingBrowseProgressRefresh();
        return;
    }
    if (isBrowseUserResultsRequestInFlight(browseResultsRequestId)) {
        return;
    }
    const indexSnapshot = pending.index;
    clearPendingBrowseProgressRefresh();
    Promise.resolve(renderBrowseResultsForState(indexSnapshot)).catch((error) => {
        console.warn('[Browse] 刷新浏览进度列表失败:', error);
    });
}

function refreshBrowseProgressFromRecords(
    records,
    examIndex,
    refreshEpoch = null,
    publication = null
) {
    try {
        const recordSnapshot = Array.isArray(records) ? records : [];
        const indexSnapshot = Array.isArray(examIndex) ? examIndex : [];
        const candidateValue = publication && publication.practiceProjectionGeneration;
        const candidatePracticeProjectionGeneration = candidateValue != null
            && Number.isFinite(Number(candidateValue))
            ? Number(candidateValue)
            : null;
        if (candidatePracticeProjectionGeneration != null
            && candidatePracticeProjectionGeneration <= browsePracticeProjectionGeneration) {
            return false;
        }
        const pendingEpoch = captureBrowseProgressRefreshEpoch(refreshEpoch);
        if (!isBrowseProgressRefreshEpochCurrent(pendingEpoch)) {
            return false;
        }
        const browseView = document.getElementById('browse-view');
        const isBrowseActive = browseView && browseView.classList.contains('active');
        if (isBrowseActive && typeof renderBrowseResultsForState !== 'function') {
            return false;
        }
        if (typeof rebuildBrowseCompletionIndex === 'function') {
            rebuildBrowseCompletionIndex(recordSnapshot);
        }
        if (typeof updateBrowseAnchorsFromRecords === 'function') {
            updateBrowseAnchorsFromRecords(recordSnapshot, indexSnapshot);
        }
        if (isBrowseActive) {
            if (candidatePracticeProjectionGeneration != null) {
                pendingEpoch.practiceProjectionGeneration =
                    candidatePracticeProjectionGeneration;
            }
            pendingBrowseProgressRefresh = {
                index: indexSnapshot,
                epoch: pendingEpoch
            };
            // Candidate projections are flushed by syncPracticeRecords only
            // after their accepted generation becomes the public watermark.
            if (candidatePracticeProjectionGeneration == null) {
                flushPendingBrowseProgressRefresh();
            }
        }
        return true;
    } catch (error) {
        console.warn('[Browse] 刷新浏览进度失败:', error);
        return false;
    }
}

let practiceSessionEventBound = false;
function ensurePracticeSessionSyncListener() {
    if (practiceSessionEventBound) {
        return;
    }
    practiceSessionEventBound = true;
    document.addEventListener('practiceSessionCompleted', () => {
        startPracticeRecordsSyncInBackground('session-completed', {
            mode: 'summary',
            forceRender: true
        });
    });
}

// Phase 3: 练习统计计算 - 保留在 main.js（数据处理逻辑，暂不迁移）
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
        const percentage = typeof record.percentage === 'number' ? record.percentage : (typeof record.accuracy === 'number' ? Math.round(record.accuracy * 100) : 0);
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

// Phase 3: 应用练习统计 - 保留在 main.js（DOM 操作，暂不迁移）
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


function browseCategory(category, type = 'reading', filterMode = null, path = null) {

    requestBrowseAutoScroll(category, type);
    // 先设置筛选器，确保 App 路径也能获取到筛选参数
    try {
        setBrowseFilterState(category, type);

        // 设置待处理筛选器，确保组件未初始化时筛选不会丢失
        // 新增：包含 filterMode 和 path 参数
        try {
            window.__pendingBrowseFilter = { category, type, filterMode, path };
        } catch (_) {
            // 如果全局变量设置失败，继续执行
        }
    } catch (error) {
        console.warn('[browseCategory] 设置筛选器失败:', error);
    }

    // 优先调用 window.app.browseCategory(category, type, filterMode, path)
    if (window.app && typeof window.app.browseCategory === 'function') {
        try {
            window.app.browseCategory(category, type, filterMode, path);
            console.log('[browseCategory] Called app.browseCategory with filterMode:', filterMode);
            return;
        } catch (error) {
            console.warn('[browseCategory] window.app.browseCategory 调用失败，使用降级路径:', error);
        }
    }

    // 降级路径：手动处理浏览筛选
    try {
        // 正确更新标题使用中文字符串
        setBrowseTitle(formatBrowseTitle(category, type));

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
            } catch (_) { }
        }

        // 尽量沿用统一筛选逻辑
        if (typeof applyBrowseFilter === 'function') {
            applyBrowseFilter(category, type, filterMode, path);
        } else {
            loadExamList();
        }

    } catch (error) {
        console.error('[browseCategory] 处理浏览类别时出错:', error);
        showMessage('浏览类别时出现错误', 'error');
    }
}

let browseResultsRequestId = 0;
const browseUserResultsRequestRetains = new Map();
let lastBrowseUserResultsRequestId = null;

function beginBrowseResultsRequest() {
    browseResultsRequestId += 1;
    return browseResultsRequestId;
}

function isBrowseResultsRequestCurrent(requestId) {
    return requestId == null || requestId === browseResultsRequestId;
}

function retainBrowseUserResultsRequest(requestId) {
    if (requestId == null || !isBrowseResultsRequestCurrent(requestId)) {
        return null;
    }
    const retainCount = browseUserResultsRequestRetains.get(requestId) || 0;
    browseUserResultsRequestRetains.set(requestId, retainCount + 1);
    lastBrowseUserResultsRequestId = requestId;
    return requestId;
}

function beginBrowseUserResultsRequest() {
    return retainBrowseUserResultsRequest(beginBrowseResultsRequest());
}

function endBrowseUserResultsRequest(requestId) {
    if (requestId == null) {
        return;
    }
    const retainCount = browseUserResultsRequestRetains.get(requestId) || 0;
    if (retainCount <= 1) {
        browseUserResultsRequestRetains.delete(requestId);
        if (retainCount === 1
            && typeof window.dispatchEvent === 'function'
            && typeof window.CustomEvent === 'function') {
            try {
                window.dispatchEvent(new window.CustomEvent('browseUserResultsRequestSettled', {
                    detail: { requestId }
                }));
            } catch (_) { }
        }
        if (retainCount === 1) {
            flushPendingBrowseProgressRefresh();
        }
        return;
    }
    browseUserResultsRequestRetains.set(requestId, retainCount - 1);
}

function isBrowseUserResultsRequestInFlight(requestId) {
    return requestId != null && (browseUserResultsRequestRetains.get(requestId) || 0) > 0;
}

function isBrowseUserResultsRequest(requestId) {
    return requestId != null && requestId === lastBrowseUserResultsRequestId;
}

function captureBrowseForegroundRenderEpoch(sourceEpoch = null) {
    const source = sourceEpoch && typeof sourceEpoch === 'object' ? sourceEpoch : {};
    const functionalResetState = readBrowseFunctionalResetState();
    const readSourceOrGeneration = (key, getterName) => Object.prototype.hasOwnProperty.call(source, key)
        ? source[key]
        : readBrowseProgressGeneration(getterName);
    return {
        navigationGeneration: readSourceOrGeneration(
            'navigationGeneration',
            '__getAppNavigationIntentGeneration'
        ),
        activeLibraryGeneration: readSourceOrGeneration(
            'activeLibraryGeneration',
            '__getActiveLibraryGeneration'
        ),
        resetGeneration: readSourceOrGeneration(
            'resetGeneration',
            '__getBrowseResetIntentGeneration'
        ),
        functionalResetGeneration: Object.prototype.hasOwnProperty.call(
            source,
            'functionalResetGeneration'
        )
            ? source.functionalResetGeneration
            : functionalResetState.generation
    };
}

function isBrowseForegroundRenderEpochCurrent(epoch) {
    if (!epoch || typeof epoch !== 'object') {
        return true;
    }
    const generations = {
        navigationGeneration: '__getAppNavigationIntentGeneration',
        activeLibraryGeneration: '__getActiveLibraryGeneration',
        resetGeneration: '__getBrowseResetIntentGeneration'
    };
    const ordinaryGenerationsAreCurrent = Object.keys(generations).every((key) => {
        if (epoch[key] == null) {
            return true;
        }
        return readBrowseProgressGeneration(generations[key]) === epoch[key];
    });
    if (!ordinaryGenerationsAreCurrent || epoch.functionalResetGeneration == null) {
        return ordinaryGenerationsAreCurrent;
    }
    return readBrowseFunctionalResetState().generation === epoch.functionalResetGeneration;
}

function captureCurrentForegroundBrowseRecovery(requestId, explicitlyForeground = false) {
    const isForeground = explicitlyForeground
        || isBrowseUserResultsRequestInFlight(requestId);
    if (!isForeground || !isBrowseResultsRequestCurrent(requestId)) {
        return null;
    }
    const appEntry = window.AppEntry;
    if (appEntry
        && typeof appEntry.prepareBrowseFunctionalResetRecoveryForForeground === 'function') {
        const prepared = appEntry.prepareBrowseFunctionalResetRecoveryForForeground(requestId);
        return prepared && prepared.recovery ? prepared.recovery : prepared;
    }
    if (!appEntry
        || typeof appEntry.captureBrowseFunctionalResetRecovery !== 'function') {
        return null;
    }
    const recovery = appEntry.captureBrowseFunctionalResetRecovery();
    if (recovery
        && typeof appEntry.updateBrowseFunctionalResetRecoveryResultsRequest === 'function') {
        appEntry.updateBrowseFunctionalResetRecoveryResultsRequest(recovery, requestId);
    }
    return recovery;
}

function completeCurrentForegroundBrowseRecovery(recovery, succeeded) {
    const appEntry = window.AppEntry;
    if (!recovery
        || !appEntry
        || typeof appEntry.completeBrowseFunctionalResetRecovery !== 'function') {
        return false;
    }
    return appEntry.completeBrowseFunctionalResetRecovery(recovery, succeeded === true);
}

const browseRenderCommitReceiptMarker = {};

function createBrowseRenderCommitReceipt(requestId, foregroundEpoch) {
    return {
        marker: browseRenderCommitReceiptMarker,
        requestId,
        foregroundEpoch,
        committed: false
    };
}

function markBrowseRenderCommitReceipt(receipt) {
    if (!receipt || receipt.marker !== browseRenderCommitReceiptMarker) {
        return false;
    }
    receipt.committed = true;
    return true;
}

function commitForegroundBrowseResults(
    renderRequestId,
    sourceEpoch,
    commit
) {
    const foregroundEpoch = captureBrowseForegroundRenderEpoch(sourceEpoch);
    if (!isBrowseResultsRequestCurrent(renderRequestId)
        || !isBrowseForegroundRenderEpochCurrent(foregroundEpoch)
        || typeof commit !== 'function') {
        return false;
    }
    const foregroundRecovery = captureCurrentForegroundBrowseRecovery(renderRequestId, false);
    const preparedFunctionalResetState = readBrowseFunctionalResetState();
    foregroundEpoch.functionalResetGeneration = preparedFunctionalResetState.generation;
    const receipt = createBrowseRenderCommitReceipt(renderRequestId, foregroundEpoch);
    let committed = false;
    try {
        if (!isBrowseResultsRequestCurrent(renderRequestId)
            || !isBrowseForegroundRenderEpochCurrent(foregroundEpoch)) {
            return false;
        }
        const result = commit(receipt);
        committed = receipt.committed === true
            && isBrowseResultsRequestCurrent(renderRequestId)
            && isBrowseForegroundRenderEpochCurrent(foregroundEpoch);
        return committed ? result : false;
    } finally {
        completeCurrentForegroundBrowseRecovery(foregroundRecovery, committed);
    }
}

window.__beginBrowseResultsRequest = beginBrowseResultsRequest;
window.__isBrowseResultsRequestCurrent = isBrowseResultsRequestCurrent;
window.__getBrowseResultsRequestId = function getBrowseResultsRequestId() {
    return browseResultsRequestId;
};
window.__beginBrowseUserResultsRequest = beginBrowseUserResultsRequest;
window.__retainBrowseUserResultsRequest = retainBrowseUserResultsRequest;
window.__endBrowseUserResultsRequest = endBrowseUserResultsRequest;
window.__isBrowseUserResultsRequestInFlight = isBrowseUserResultsRequestInFlight;
window.__isBrowseUserResultsRequest = isBrowseUserResultsRequest;
window.__captureBrowseForegroundRenderEpoch = captureBrowseForegroundRenderEpoch;
window.__markBrowseRenderCommitReceipt = markBrowseRenderCommitReceipt;
window.__commitForegroundBrowseResults = commitForegroundBrowseResults;

async function filterByType(type, examIndexOverride = null, renderRequestId = null, options = {}) {
    const userRequestId = renderRequestId == null
        ? beginBrowseUserResultsRequest()
        : retainBrowseUserResultsRequest(renderRequestId);
    const activeRequestId = renderRequestId == null ? userRequestId : renderRequestId;
    const foregroundEpoch = captureBrowseForegroundRenderEpoch(options.foregroundEpoch);
    try {
        const requestedType = type;
        let listeningUnavailable = false;
        let examIndex = Array.isArray(examIndexOverride) ? examIndexOverride : [];
        try {
            if (!Array.isArray(examIndexOverride)) {
                examIndex = await resolveActiveExamIndex();
            }
            const listeningAvailable = typeof window.hasActiveListeningLibrary === 'function'
                ? window.hasActiveListeningLibrary(examIndex)
                : examIndex.some((exam) => exam && exam.type === 'listening');
            if (requestedType === 'listening' && !listeningAvailable) {
                type = 'all';
                listeningUnavailable = true;
            }
        } catch (error) {
            console.warn('[Browse] 读取活动题库失败，已取消类型筛选提交:', error);
            return false;
        }

        if (!isBrowseResultsRequestCurrent(activeRequestId)
            || !isBrowseForegroundRenderEpochCurrent(foregroundEpoch)) {
            return false;
        }
        if (listeningUnavailable && typeof window.showMessage === 'function') {
            window.showMessage('听力题库尚未加载', 'warning');
        }

        // 重置筛选器状态
        browseInitialFilterHydrationConsumed = true;
        setBrowseFilterState('all', type);
        setBrowseTitle(formatBrowseTitle('all', type));

        // 重置浏览模式和路径（清除频率模式残留）
        window.__browseFilterMode = 'default';
        window.__browsePath = null;

        // 重置 browseController 到默认模式
        // 关键修复：仅在当前不是默认模式时才调用 resetToDefault，防止死循环
        // (resetToDefault -> setMode -> applyFilter -> filterByType -> global.filterByType)
        if (window.browseController &&
            window.browseController.currentMode !== 'default' &&
            typeof window.browseController.resetToDefault === 'function') {
            window.browseController.resetToDefault(examIndex, activeRequestId, { skipApply: true });
        }

        // 更新题库浏览筛选按钮的 active 状态
        var container = document.getElementById('type-filter-buttons');
        if (container) {
            var buttons = container.querySelectorAll('.shui-segmented-btn');
            for (var i = 0; i < buttons.length; i++) {
                var btn = buttons[i];
                if (btn.dataset.filterType === type || btn.dataset.filterId === type) {
                    btn.classList.add('active');
                    btn.setAttribute('aria-pressed', 'true');
                } else {
                    btn.classList.remove('active');
                    btn.setAttribute('aria-pressed', 'false');
                }
            }
        }

        // 触发滑块指示器同步
        if (typeof window.updateSegmentedIndicators === 'function') {
            setTimeout(window.updateSegmentedIndicators, 10);
        }

        // 保留活动搜索与新类型筛选的交集。
        return await renderBrowseResultsForState(examIndex, activeRequestId, {
            foregroundEpoch
        });
    } finally {
        endBrowseUserResultsRequest(userRequestId);
    }
}

// 应用分类筛选（供 App/总览调用）
async function applyBrowseFilter(
    category = 'all',
    type = null,
    filterMode = null,
    path = null,
    renderRequestId = null,
    navigationIntentGeneration = null
) {
    const getActiveViewId = () => {
        const activeView = typeof document.querySelector === 'function'
            ? document.querySelector('.view.active')
            : null;
        return activeView ? activeView.id : null;
    };
    const activeViewIdAtRequest = getActiveViewId();
    const capturedNavigationIntentGeneration = navigationIntentGeneration == null
        && typeof window.__getAppNavigationIntentGeneration === 'function'
        ? window.__getAppNavigationIntentGeneration()
        : navigationIntentGeneration;
    const isNavigationIntentCurrent = () => {
        if (capturedNavigationIntentGeneration != null
            && typeof window.__getAppNavigationIntentGeneration === 'function'
            && window.__getAppNavigationIntentGeneration() !== capturedNavigationIntentGeneration) {
            return false;
        }
        return getActiveViewId() === activeViewIdAtRequest;
    };
    const userRequestId = renderRequestId == null
        ? beginBrowseUserResultsRequest()
        : retainBrowseUserResultsRequest(renderRequestId);
    const activeRequestId = renderRequestId == null ? userRequestId : renderRequestId;
    const foregroundEpoch = captureBrowseForegroundRenderEpoch();
    try {
        const indexSnapshot = await resolveActiveExamIndex();
        if (!isBrowseResultsRequestCurrent(activeRequestId)
            || !isNavigationIntentCurrent()
            || !isBrowseForegroundRenderEpochCurrent(foregroundEpoch)) {
            return false;
        }
        const memorizeSelectionActive = isReadingMemorizeBrowseMode();
        if (memorizeSelectionActive) {
            category = 'all';
            type = 'reading';
            filterMode = null;
            path = null;
        }
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
                const hasReading = indexSnapshot.some(e => e.category === normalizedCategory && e.type === 'reading');
                const hasListening = indexSnapshot.some(e => e.category === normalizedCategory && e.type === 'listening');
                if (hasReading && !hasListening) type = 'reading';
                else if (!hasReading && hasListening) type = 'listening';
                else type = 'all';
            } catch (_) { type = 'all'; }
        }

        const normalizedType = normalizeExamType(type);
        const normalizedPath = (typeof path === 'string' && path.trim()) ? path.trim() : null;
        const listeningAvailable = typeof window.hasActiveListeningLibrary === 'function'
            ? window.hasActiveListeningLibrary(indexSnapshot)
            : indexSnapshot.some((exam) => exam && exam.type === 'listening');
        const effectiveFilterMode = listeningAvailable ? filterMode : null;
        const effectiveType = (!listeningAvailable && normalizedType === 'listening') ? 'all' : normalizedType;

        // 1. 先处理模式切换/重置
        if (effectiveFilterMode) {
            const modeConfig = window.BROWSE_MODES && window.BROWSE_MODES[effectiveFilterMode];
            const basePath = normalizedPath || (modeConfig && modeConfig.basePath) || null;
            window.__browsePath = basePath;
            window.__browseFilterMode = effectiveFilterMode;
            if (window.browseController) {
                try {
                    if (!window.browseController.buttonContainer) {
                        window.browseController.initialize('type-filter-buttons', indexSnapshot);
                    }
                    window.browseController.setMode(
                        effectiveFilterMode,
                        indexSnapshot,
                        activeRequestId,
                        { skipApply: true }
                    );
                } catch (error) {
                    console.warn('[Browse] 切换浏览模式失败:', error);
                }
            }
        } else {
            // 默认模式：清除频率模式状态
            window.__browseFilterMode = 'default';
            window.__browsePath = normalizedPath;
            if (window.browseController &&
                window.browseController.currentMode !== 'default' &&
                typeof window.browseController.resetToDefault === 'function') {
                window.browseController.resetToDefault(
                    indexSnapshot,
                    activeRequestId,
                    { skipApply: true }
                );
            }
        }

        if (!isBrowseResultsRequestCurrent(activeRequestId)
            || !isNavigationIntentCurrent()
            || !isBrowseForegroundRenderEpochCurrent(foregroundEpoch)) {
            return false;
        }

        // 2. 再应用具体的分类和类型筛选（确保不被重置覆盖）
        browseInitialFilterHydrationConsumed = true;
        setBrowseFilterState(normalizedCategory, effectiveType);


        setBrowseTitle(memorizeSelectionActive ? '阅读背题选题' : formatBrowseTitle(normalizedCategory, effectiveType));

        // 3. 统一刷新，确保活动搜索继续约束分类/路径结果。
        const renderResult = await renderBrowseResultsForState(indexSnapshot, activeRequestId, {
            foregroundEpoch
        });

        if (renderResult === false
            || !isBrowseResultsRequestCurrent(activeRequestId)
            || !isNavigationIntentCurrent()) {
            return false;
        }

        // 若未在浏览视图，则尽力切换
        if (typeof window.showView === 'function' && !document.getElementById('browse-view')?.classList.contains('active')) {
            window.showView('browse', false);
        }
        return true;
    } catch (e) {
        if (!isBrowseResultsRequestCurrent(activeRequestId)
            || !isNavigationIntentCurrent()
            || !isBrowseForegroundRenderEpochCurrent(foregroundEpoch)) {
            return false;
        }
        console.warn('[Browse] 应用筛选失败，回退到默认列表:', e);
        browseInitialFilterHydrationConsumed = true;
        setBrowseFilterState('all', 'all');
        if (window.browseController && typeof window.browseController.resetToDefault === 'function') {
            window.browseController.resetToDefault(null, activeRequestId, { skipApply: true });
        }
        // Break the failing call stack while retaining this foreground lease.
        // The original epoch must still be current before the fallback may write.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!isBrowseResultsRequestCurrent(activeRequestId)
            || !isNavigationIntentCurrent()
            || !isBrowseForegroundRenderEpochCurrent(foregroundEpoch)) {
            return false;
        }
        try {
            await renderBrowseResultsForState(null, activeRequestId, { foregroundEpoch });
        } catch (_) { }
        return false;
    } finally {
        endBrowseUserResultsRequest(userRequestId);
    }
}

function getLiveBrowseFilterSnapshot() {
    let filter = null;
    if (typeof window.getBrowseFilterState === 'function') {
        try {
            filter = window.getBrowseFilterState();
        } catch (_) { }
    }
    const rawCategory = filter && typeof filter.category === 'string'
        ? filter.category
        : (typeof window.getCurrentCategory === 'function' ? window.getCurrentCategory() : 'all');
    const rawType = filter && typeof filter.type === 'string'
        ? filter.type
        : (typeof window.getCurrentExamType === 'function' ? window.getCurrentExamType() : 'all');
    const category = typeof window.normalizeCategoryKey === 'function'
        ? window.normalizeCategoryKey(rawCategory)
        : (typeof rawCategory === 'string' && rawCategory.trim() ? rawCategory.trim() : 'all');
    const type = typeof window.normalizeExamType === 'function'
        ? window.normalizeExamType(rawType)
        : (rawType === 'reading' || rawType === 'listening' ? rawType : 'all');
    return { category, type };
}

function browseFiltersMatch(left, right) {
    return !!left && !!right
        && left.category === right.category
        && left.type === right.type;
}

async function persistAuthoritativeBrowseFilterBeforeHydration(activeRequestId) {
    if (typeof window.persistBrowseFilter !== 'function'
        || typeof window.flushBrowsePreferenceWrites !== 'function'
        || !window.AppData
        || !window.AppData.preferences
        || typeof window.AppData.preferences.getBrowse !== 'function') {
        return false;
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
        if (!isBrowseResultsRequestCurrent(activeRequestId)) {
            return false;
        }
        const revisionBefore = typeof window.getBrowseFilterMutationRevision === 'function'
            ? Number(window.getBrowseFilterMutationRevision()) || 0
            : 0;
        const filterSnapshot = getLiveBrowseFilterSnapshot();
        let durablePreferences;
        try {
            window.persistBrowseFilter(filterSnapshot.category, filterSnapshot.type);
            await window.flushBrowsePreferenceWrites();
            durablePreferences = await window.AppData.preferences.getBrowse();
        } catch (error) {
            console.warn('[Browse] 持久化权威筛选失败:', error);
            return false;
        }
        if (!isBrowseResultsRequestCurrent(activeRequestId)) {
            return false;
        }
        const revisionAfter = typeof window.getBrowseFilterMutationRevision === 'function'
            ? Number(window.getBrowseFilterMutationRevision()) || 0
            : revisionBefore;
        const currentFilter = getLiveBrowseFilterSnapshot();
        if (revisionAfter !== revisionBefore || !browseFiltersMatch(currentFilter, filterSnapshot)) {
            continue;
        }
        return browseFiltersMatch(
            durablePreferences && durablePreferences.lastFilter,
            filterSnapshot
        );
    }
    return false;
}

// Initialize browse view when it's activated
async function initializeBrowseView(options = {}) {
    const userRequestId = options.renderRequestId == null
        ? beginBrowseUserResultsRequest()
        : retainBrowseUserResultsRequest(options.renderRequestId);
    const activeRequestId = options.renderRequestId == null
        ? userRequestId
        : options.renderRequestId;
    const foregroundEpoch = options.foregroundEpoch
        ? captureBrowseForegroundRenderEpoch(options.foregroundEpoch)
        : captureBrowseForegroundRenderEpoch();
    try {
        console.log('[System] Initializing browse view...');
        const [examIndex] = await Promise.all([
            resolveActiveExamIndex(),
            typeof window.whenBrowseViewPreferencesReady === 'function'
                ? window.whenBrowseViewPreferencesReady()
                : Promise.resolve()
        ]);

        if (!isBrowseResultsRequestCurrent(activeRequestId)
            || !isBrowseForegroundRenderEpochCurrent(foregroundEpoch)) {
            return null;
        }

        // 初始化 browseController
        if (window.browseController && !window.browseController.buttonContainer) {
            window.browseController.initialize('type-filter-buttons', examIndex);
        }
        if (typeof window.refreshListeningAvailabilityUI === 'function') {
            window.refreshListeningAvailabilityUI(examIndex);
        }

        const browseFilterMutationRevision = typeof window.getBrowseFilterMutationRevision === 'function'
            ? Number(window.getBrowseFilterMutationRevision()) || 0
            : 0;
        if (!browseInitialFilterHydrationConsumed && browseFilterMutationRevision > 0) {
            const persistedAuthoritativeFilter = await persistAuthoritativeBrowseFilterBeforeHydration(
                activeRequestId
            );
            if (!persistedAuthoritativeFilter
                || !isBrowseResultsRequestCurrent(activeRequestId)
                || !isBrowseForegroundRenderEpochCurrent(foregroundEpoch)) {
                console.warn('[Browse] 权威筛选尚未持久化，已推迟首次 hydration');
                return null;
            }
            browseInitialFilterHydrationConsumed = true;
        } else if (!browseInitialFilterHydrationConsumed) {
            const persisted = getPersistedBrowseFilter();
            browseInitialFilterHydrationConsumed = true;
            if (persisted) {
                setBrowseFilterState(persisted.category, persisted.type);
                setBrowseTitle(formatBrowseTitle(persisted.category, persisted.type));
            } else {
                setBrowseFilterState('all', 'all');
                setBrowseTitle(formatBrowseTitle('all', 'all'));
            }
        }

        setupBrowseSortControl();
        setupBrowseFrequencyFilterControl();
        if (!isBrowseResultsRequestCurrent(activeRequestId)
            || !isBrowseForegroundRenderEpochCurrent(foregroundEpoch)) {
            return null;
        }
        if (!options.skipLoad) {
            const renderResult = await renderBrowseResultsForState(examIndex, activeRequestId, {
                foregroundEpoch
            });
            if (renderResult === false || !isBrowseResultsRequestCurrent(activeRequestId)) {
                return null;
            }
        }
        return examIndex;
    } finally {
        endBrowseUserResultsRequest(userRequestId);
    }
}

async function activateBrowseView(options = {}) {
    const userRequestId = options.renderRequestId == null
        ? beginBrowseUserResultsRequest()
        : retainBrowseUserResultsRequest(options.renderRequestId);
    const activeRequestId = options.renderRequestId == null
        ? userRequestId
        : options.renderRequestId;
    const foregroundEpoch = options.foregroundEpoch
        ? captureBrowseForegroundRenderEpoch(options.foregroundEpoch)
        : captureBrowseForegroundRenderEpoch();
    try {
        const examIndex = await initializeBrowseView({
            skipLoad: true,
            renderRequestId: activeRequestId,
            foregroundEpoch
        });
        if (!Array.isArray(examIndex)
            || !isBrowseResultsRequestCurrent(activeRequestId)
            || !isBrowseForegroundRenderEpochCurrent(foregroundEpoch)) {
            return false;
        }
        const result = await renderBrowseResultsForState(examIndex, activeRequestId, {
            foregroundEpoch
        });
        return result;
    } finally {
        endBrowseUserResultsRequest(userRequestId);
    }
}

window.activateBrowseView = activateBrowseView;

function normalizeBrowseFrequencyFilter(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'high' || raw === 'medium' || raw === 'low' ? raw : 'all';
}

function getBrowseSearchQuery() {
    const input = document.getElementById('exam-search-input') || document.querySelector('.search-input');
    return input && typeof input.value === 'string' ? input.value.trim() : '';
}

async function renderBrowseResultsForState(
    examIndexOverride = null,
    renderRequestId = null,
    options = {}
) {
    const hasQueryOverride = Object.prototype.hasOwnProperty.call(options || {}, 'query');
    const query = hasQueryOverride ? String(options.query || '').trim() : getBrowseSearchQuery();
    const explicitlyForeground = options && options.foreground === true;
    const foregroundRetainId = explicitlyForeground
        ? (renderRequestId == null
            ? beginBrowseUserResultsRequest()
            : retainBrowseUserResultsRequest(renderRequestId))
        : null;
    const activeRequestId = renderRequestId == null
        ? (explicitlyForeground ? foregroundRetainId : beginBrowseResultsRequest())
        : renderRequestId;
    if (explicitlyForeground && foregroundRetainId == null) {
        return false;
    }
    const isForeground = explicitlyForeground
        || isBrowseUserResultsRequestInFlight(activeRequestId);
    const foregroundEpoch = isForeground
        ? captureBrowseForegroundRenderEpoch(options && options.foregroundEpoch)
        : null;
    let foregroundRecovery = null;
    let renderSucceeded = false;
    let commitReceipt = null;
    try {
        if (!isBrowseForegroundRenderEpochCurrent(foregroundEpoch)) {
            return false;
        }
        foregroundRecovery = captureCurrentForegroundBrowseRecovery(
            activeRequestId,
            explicitlyForeground
        );
        if (foregroundEpoch) {
            // Atomic preparation may neutrally cancel a stale retry barrier and
            // restore its durable failure debt (or idle state). Adopt only that
            // synchronous internal generation; navigation/library/reset
            // ownership remains the foreground intent captured by the caller.
            const preparedFunctionalResetState = readBrowseFunctionalResetState();
            foregroundEpoch.functionalResetGeneration = preparedFunctionalResetState.generation;
        }
        const isRenderCurrent = () => isBrowseResultsRequestCurrent(activeRequestId)
            && isBrowseForegroundRenderEpochCurrent(foregroundEpoch);
        commitReceipt = createBrowseRenderCommitReceipt(activeRequestId, foregroundEpoch);
        const result = query
            ? await performSearch(query, activeRequestId, examIndexOverride, {
                isCurrent: isRenderCurrent,
                commitReceipt,
                foregroundEpoch
            })
            : await loadExamList(examIndexOverride, activeRequestId, {
                isCurrent: isRenderCurrent,
                commitReceipt,
                foregroundEpoch
            });
        if (result === false
            || !commitReceipt
            || commitReceipt.committed !== true
            || !isBrowseResultsRequestCurrent(activeRequestId)
            || !isBrowseForegroundRenderEpochCurrent(foregroundEpoch)) {
            return false;
        }
        renderSucceeded = true;
        return result;
    } finally {
        completeCurrentForegroundBrowseRecovery(foregroundRecovery, renderSucceeded);
        endBrowseUserResultsRequest(foregroundRetainId);
    }
}

window.__renderBrowseResultsForState = renderBrowseResultsForState;

function refreshBrowseResults(options = {}) {
    return renderBrowseResultsForState(null, null, options);
}

let browseControlsSeeded = false;
let browseControlsSeedPromise = null;
let browseControlsSeedReadRevision = null;
let browseControlsMutationRevision = 0;

function isBrowseControlsSetupCurrent(options = {}) {
    if (!options || typeof options.isCurrent !== 'function') {
        return true;
    }
    try {
        return options.isCurrent() !== false;
    } catch (_) {
        return false;
    }
}

async function setupBrowseControls(options = {}) {
    if (!isBrowseControlsSetupCurrent(options)) {
        return false;
    }
    if (!browseControlsSeeded) {
        if (!browseControlsSeedPromise) {
            browseControlsSeedReadRevision = browseControlsMutationRevision;
            browseControlsSeedPromise = (async () => {
                try {
                    return await window.AppData.preferences.getBrowse();
                } catch (_) { /* defaults remain active */ }
                return null;
            })();
        }
        const seedPromise = browseControlsSeedPromise;
        const browse = await seedPromise;
        if (!isBrowseControlsSetupCurrent(options)) {
            // Caller cancellation is local. The promise and its immutable
            // mutation fence belong to the shared hydration transaction; a
            // stale waiter must not force a current waiter to reread storage.
            return false;
        }
        if (browseControlsSeedPromise !== seedPromise) {
            return setupBrowseControls(options);
        }
        if (!browseControlsSeeded) {
            // A user frequency/sort intent that happened while storage was being
            // read owns the controls. The older preference snapshot must not
            // overwrite it when the await settles.
            if (browseControlsSeedReadRevision === browseControlsMutationRevision && browse) {
                window.__browseSortMode = browse.sortMode || window.__browseSortMode;
                updateBrowseFrequencyButtons(
                    browse.frequencyFilter || window.__browseFrequencyFilter || 'all'
                );
            }
            browseControlsSeeded = true;
            browseControlsSeedPromise = null;
            browseControlsSeedReadRevision = null;
        }
    }
    if (!isBrowseControlsSetupCurrent(options)) {
        return false;
    }
    setupBrowseSortControl();
    setupBrowseFrequencyFilterControl();
    return true;
}

async function persistBrowsePreference(patch) {
    if (window.AppData && window.AppData.preferences
        && typeof window.AppData.preferences.patchBrowse === 'function') {
        await window.AppData.preferences.patchBrowse(patch);
        return;
    }
    const current = await window.AppData.preferences.getBrowse() || {};
    await window.AppData.preferences.setBrowse(Object.assign({}, current, patch));
}

function setupBrowseSortControl() {
    const sortSelect = document.getElementById('browse-sort-select');
    if (!sortSelect || sortSelect.dataset.bound === 'true') {
        return;
    }
    const normalizeSortMode = (value) => {
        const mode = String(value || 'default').trim().toLowerCase();
        return mode === 'frequency-desc' || mode === 'difficulty-desc' ? mode : 'default';
    };
    let savedMode = String(window.__browseSortMode || '').trim().toLowerCase();
    if (!savedMode) savedMode = 'default';
    sortSelect.value = normalizeSortMode(savedMode);
    window.__browseSortMode = sortSelect.value;
    sortSelect.addEventListener('change', () => {
        browseControlsMutationRevision += 1;
        window.__browseSortMode = normalizeSortMode(sortSelect.value);
        persistBrowsePreference({ sortMode: window.__browseSortMode }).catch(console.warn);
        refreshBrowseResults({ foreground: true });
    });
    sortSelect.dataset.bound = 'true';
}

function updateBrowseFrequencyButtons(filter) {
    const activeFilter = normalizeBrowseFrequencyFilter(filter || window.__browseFrequencyFilter || 'all');
    if (window.ExamActions && typeof window.ExamActions.setBrowseFrequencyFilter === 'function') {
        return window.ExamActions.setBrowseFrequencyFilter(activeFilter);
    }
    const stateOwner = window.ExamActions && window.ExamActions.browseFilterStateOwner;
    if (stateOwner && typeof stateOwner.setFrequencyFilter === 'function') {
        return stateOwner.setFrequencyFilter(activeFilter);
    }
    const container = document.getElementById('browse-frequency-filter-buttons');
    if (!container) {
        return activeFilter;
    }
    container.querySelectorAll('[data-frequency-filter]').forEach((button) => {
        const isActive = button.dataset.frequencyFilter === activeFilter;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    return activeFilter;
}

function resetBrowseFilterStateToAll() {
    if (window.ExamActions && typeof window.ExamActions.resetBrowseFilterStateToAll === 'function') {
        return window.ExamActions.resetBrowseFilterStateToAll();
    }
    const stateOwner = window.ExamActions && window.ExamActions.browseFilterStateOwner;
    if (stateOwner && typeof stateOwner.resetToAll === 'function') {
        return stateOwner.resetToAll();
    }
    return false;
}

function setupBrowseFrequencyFilterControl() {
    const container = document.getElementById('browse-frequency-filter-buttons');
    if (!container) {
        return;
    }
    let savedFilter = normalizeBrowseFrequencyFilter(window.__browseFrequencyFilter || 'all');
    updateBrowseFrequencyButtons(savedFilter);
}

function filterByFrequency(filter) {
    const requested = normalizeBrowseFrequencyFilter(filter);
    const current = normalizeBrowseFrequencyFilter(window.__browseFrequencyFilter || 'all');
    const next = requested !== 'all' && requested === current ? 'all' : requested;
    browseControlsMutationRevision += 1;
    // Record the live intent before any async preference write or lazy owner
    // delegation so an older control-seed read cannot become authoritative.
    persistBrowsePreference({ frequencyFilter: next }).catch(console.warn);
    updateBrowseFrequencyButtons(next);
    refreshBrowseResults({ foreground: true });
}

// 全局桥接：HTML 按钮 onclick="browseCategory('P1','reading')"
if (typeof window.browseCategory !== 'function') {
    window.browseCategory = function (category, type, filterMode, path) {
        try {
            if (window.app && typeof window.app.browseCategory === 'function') {
                window.app.browseCategory(category, type, filterMode, path);
                return;
            }
        } catch (_) { }
        // 回退：直接应用筛选（保持 filterMode/path 兼容）
        try {
            applyBrowseFilter(category, type, filterMode, path);
        } catch (_) { }
    };
}

function filterRecordsByType(type) {
    setBrowseFilterState(getCurrentCategory(), type);

    // 更新练习历史筛选按钮的 active 状态
    var container = document.getElementById('record-type-filter-buttons');
    if (container) {
        var buttons = container.querySelectorAll('.shui-segmented-btn');
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            if (btn.dataset.filterType === type) {
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
            } else {
                btn.classList.remove('active');
                btn.setAttribute('aria-pressed', 'false');
            }
        }
    }

    // 触发滑块指示器同步
    if (typeof window.updateSegmentedIndicators === 'function') {
        setTimeout(window.updateSegmentedIndicators, 10);
    }

    startPracticeRecordsSyncInBackground('record-type-filter', { forceRender: true });
}


async function loadExamList(examIndexOverride = null, renderRequestId = null, options = {}) {
    const activeRequestId = renderRequestId == null
        ? beginBrowseResultsRequest()
        : renderRequestId;
    const isCurrent = () => {
        if (!isBrowseResultsRequestCurrent(activeRequestId)) {
            return false;
        }
        if (!options || typeof options.isCurrent !== 'function') {
            return true;
        }
        try {
            return options.isCurrent() !== false;
        } catch (_) {
            return false;
        }
    };
    const controlsReady = await setupBrowseControls({ isCurrent });
    if (controlsReady === false || !isCurrent()) {
        return false;
    }
    const examIndex = Array.isArray(examIndexOverride)
        ? examIndexOverride
        : await resolveActiveExamIndex();

    if (!isCurrent()) {
        return false;
    }

    if (window.ExamActions && typeof window.ExamActions.loadExamList === 'function') {
        return window.ExamActions.loadExamList(examIndex, {
            commitReceipt: options.commitReceipt,
            renderRequestId: activeRequestId,
            foregroundEpoch: options.foregroundEpoch,
            recoveryManaged: true
        });
    }
    console.warn('[main.js] ExamActions.loadExamList 未就绪，尝试加载 browse-view 组');
    if (window.AppLazyLoader && typeof window.AppLazyLoader.ensureGroup === 'function') {
        return window.AppLazyLoader.ensureGroup('browse-view').then(async function () {
            if (!isCurrent()) {
                return false;
            }
            const lazyControlsReady = await setupBrowseControls({ isCurrent });
            if (lazyControlsReady === false || !isCurrent()) {
                return false;
            }
            if (window.ExamActions && typeof window.ExamActions.loadExamList === 'function') {
                return window.ExamActions.loadExamList(examIndex, {
                    commitReceipt: options.commitReceipt,
                    renderRequestId: activeRequestId,
                    foregroundEpoch: options.foregroundEpoch,
                    recoveryManaged: true
                });
            } else {
                // 最终降级：直接 DOM 渲染
                return loadExamListFallback(examIndex, options);
            }
        }).catch(function (err) {
            if (!isCurrent()) {
                return false;
            }
            console.error('[main.js] browse-view 组加载失败:', err);
            return loadExamListFallback(examIndex, options);
        });
    } else {
        // 无懒加载器，直接降级
        return loadExamListFallback(examIndex, options);
    }
}

function isReadingMemorizeBrowseMode() {
    return window.__readingMemorizeBrowseMode === true
        || String(window.__browseMemorizeFilterMode || '') === 'reading-memorize';
}

function isReadingMemorizeCandidateFallback(exam) {
    if (typeof window.isReadingMemorizeCandidate === 'function') {
        try {
            return window.isReadingMemorizeCandidate(exam) === true;
        } catch (_) {
            // Fall back to local checks below.
        }
    }
    if (!exam || !exam.id) {
        return false;
    }
    if (exam.type && String(exam.type).toLowerCase() === 'listening') {
        return false;
    }
    if (String(exam.id).toLowerCase().indexOf('listening-') === 0) {
        return false;
    }
    if (exam.hasHtml === false) {
        return false;
    }
    const manifestEntry = window.__READING_EXAM_MANIFEST__ && window.__READING_EXAM_MANIFEST__[exam.id];
    return !!(manifestEntry && manifestEntry.script);
}

function filterReadingMemorizeExamsFallback(exams) {
    return (Array.isArray(exams) ? exams : []).filter(isReadingMemorizeCandidateFallback);
}

function clearReadingMemorizeBrowseMode() {
    if (typeof window.setReadingMemorizeBrowseMode === 'function') {
        window.setReadingMemorizeBrowseMode(false);
    } else {
        window.__readingMemorizeBrowseMode = false;
    }
    window.__browseMemorizeFilterMode = null;
    if (typeof window.syncReadingMemorizeBrowseModeUI === 'function') {
        window.syncReadingMemorizeBrowseModeUI();
    }
}

async function selectReadingMemorizeExam(examId) {
    if (window.ExamActions && typeof window.ExamActions.launchReadingMemorizeExam === 'function') {
        return window.ExamActions.launchReadingMemorizeExam(examId);
    }
    const list = await resolveActiveExamIndex();
    const exam = Array.isArray(list)
        ? list.find(function (item) { return item && String(item.id) === String(examId); })
        : null;
    if (!isReadingMemorizeCandidateFallback(exam)) {
        if (typeof showMessage === 'function') {
            showMessage('该题目无法使用统一阅读页背题，请选择有 HTML 数据的阅读题。', 'warning');
        }
        return null;
    }
    if (typeof window.syncReadingMemorizeBrowseModeUI === 'function') {
        window.syncReadingMemorizeBrowseModeUI();
    }
    return openExam(examId, {
        practiceMode: 'memorize',
        target: 'tab',
        windowName: 'ielts-reading-memorize'
    });
}

window.selectReadingMemorizeExam = selectReadingMemorizeExam;

function createFallbackExamCard(exam, options = {}) {
    const item = document.createElement('div');
    const memorizeSelectionActive = options.selectionMode === 'reading-memorize';
    item.className = 'exam-item' + (memorizeSelectionActive ? ' exam-item--memorize-selecting' : '');
    if (exam && exam.id) {
        item.dataset.examId = exam.id;
    }

    const info = document.createElement('div');
    info.className = 'exam-info';
    const title = document.createElement('h4');
    title.textContent = (exam && exam.title) || '';
    info.appendChild(title);

    if (options.showMeta) {
        const meta = document.createElement('div');
        meta.className = 'exam-meta';
        meta.textContent = typeof window.formatExamMetaText === 'function'
            ? window.formatExamMetaText(exam)
            : [exam.category || '', exam.type || '', Number.isFinite(Number(exam.difficultyScore)) ? '难度 ' + Number(exam.difficultyScore) : '']
                .filter(Boolean)
                .join(' | ');
        info.appendChild(meta);
    }

    if (memorizeSelectionActive) {
        const badge = document.createElement('div');
        badge.className = 'suite-custom-selection-badge';
        badge.textContent = '背题模式';
        info.appendChild(badge);
    }

    const actions = document.createElement('div');
    actions.className = 'exam-actions';

    if (memorizeSelectionActive) {
        const selectBtn = document.createElement('button');
        selectBtn.className = 'btn exam-item-action-btn';
        selectBtn.type = 'button';
        selectBtn.dataset.action = 'reading-memorize-select';
        if (exam && exam.id) {
            selectBtn.dataset.examId = exam.id;
        }
        selectBtn.textContent = '选择背题';
        selectBtn.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            selectReadingMemorizeExam(exam.id);
        });
        actions.appendChild(selectBtn);
    } else {
        const startBtn = document.createElement('button');
        startBtn.className = 'btn exam-item-action-btn';
        startBtn.type = 'button';
        startBtn.textContent = '开始练习';
        startBtn.addEventListener('click', function () {
            openExam(exam.id);
        });
        actions.appendChild(startBtn);

        const pdfBtn = document.createElement('button');
        pdfBtn.className = 'btn btn-outline exam-item-action-btn';
        pdfBtn.type = 'button';
        pdfBtn.textContent = 'PDF';
        pdfBtn.addEventListener('click', function () {
            viewPDF(exam.id);
        });
        actions.appendChild(pdfBtn);
    }

    item.appendChild(info);
    item.appendChild(actions);
    return item;
}

function loadExamListFallback(examIndexSnapshot = [], options = {}) {
    console.warn('[main.js] 使用降级渲染逻辑');
    try {
        let examIndex = Array.isArray(examIndexSnapshot) ? examIndexSnapshot : [];
        const container = document.getElementById('exam-list-container');
        if (!container) return false;

        // 清除 loading 指示器
        const loadingEl = document.querySelector('#browse-view .loading');
        if (loadingEl) {
            loadingEl.style.display = 'none';
        }

        container.innerHTML = '<div class="exam-list-empty"><p>题库加载中...</p></div>';

        if (examIndex.length === 0) {
            container.innerHTML = '<div class="exam-list-empty"><p>暂无题目</p></div>';
            markBrowseRenderCommitReceipt(options.commitReceipt);
            return [];
        }

        // 应用当前筛选状态（修复 P2 bug）
        let currentCategory = typeof getCurrentCategory === 'function' ? getCurrentCategory() : 'all';
        let currentType = typeof getCurrentExamType === 'function' ? getCurrentExamType() : 'all';
        const memorizeSelectionActive = isReadingMemorizeBrowseMode();
        if (typeof window.syncReadingMemorizeBrowseModeUI === 'function') {
            window.syncReadingMemorizeBrowseModeUI();
        }
        if (memorizeSelectionActive) {
            currentCategory = 'all';
            currentType = 'reading';
            window.__browseFilterMode = 'default';
            window.__browsePath = null;
            if (typeof setBrowseFilterState === 'function') {
                setBrowseFilterState('all', 'reading');
            }
            if (typeof setBrowseTitle === 'function') {
                setBrowseTitle('阅读背题选题');
            }
        }
        const hasListening = examIndex.some(function (exam) { return exam && exam.type === 'listening'; });
        if (!hasListening && currentType === 'listening') {
            currentType = 'all';
            if (typeof setBrowseFilterState === 'function') {
                setBrowseFilterState('all', 'all');
            }
        }
        const isFrequencyMode = window.__browseFilterMode && window.__browseFilterMode !== 'default';
        if (!hasListening && isFrequencyMode) {
            window.__browseFilterMode = 'default';
            window.__browsePath = null;
        }
        const effectiveFrequencyMode = window.__browseFilterMode && window.__browseFilterMode !== 'default';
        const basePathFilter = effectiveFrequencyMode && typeof window.__browsePath === 'string' && window.__browsePath.trim()
            ? window.__browsePath.trim()
            : null;

        let filtered = Array.from(examIndex);
        if (currentType !== 'all') {
            filtered = filtered.filter(function (exam) { return exam.type === currentType; });
        }
        if (currentCategory !== 'all') {
            filtered = filtered.filter(function (exam) { return exam.category === currentCategory; });
        }
        if (basePathFilter) {
            filtered = filtered.filter(function (exam) {
                return typeof exam?.path === 'string' && exam.path.includes(basePathFilter);
            });
        }
        if (memorizeSelectionActive) {
            filtered = filterReadingMemorizeExamsFallback(filtered);
        }

        if (window.ExamActions && typeof window.ExamActions.applyBrowsePostFilters === 'function') {
            filtered = window.ExamActions.applyBrowsePostFilters(filtered);
        } else {
            if (window.ExamActions && typeof window.ExamActions.deduplicateExams === 'function') {
                filtered = window.ExamActions.deduplicateExams(filtered);
            }
            if (window.ExamActions && typeof window.ExamActions.applyExamSort === 'function') {
                filtered = window.ExamActions.applyExamSort(filtered);
            }
        }

        if (filtered.length === 0) {
            container.innerHTML = '<div class="exam-list-empty"><p>未找到匹配的题目</p></div>';
            markBrowseRenderCommitReceipt(options.commitReceipt);
            return filtered;
        }
        
        const list = document.createElement('div');
        list.className = 'exam-list';
        filtered.forEach(function (exam) {
            if (!exam) return;
            list.appendChild(createFallbackExamCard(exam, {
                selectionMode: memorizeSelectionActive ? 'reading-memorize' : '',
                showMeta: false
            }));
        });
        container.innerHTML = '';
        container.appendChild(list);
        markBrowseRenderCommitReceipt(options.commitReceipt);
        return filtered;
    } catch (err) {
        console.error('[main.js] 降级渲染失败:', err);
        return false;
    }
}

// resetBrowseViewToAll / displayExams 的唯一实现在 js/app/examActions.js，
// 由其 IIFE 导出到 window.ExamActions 与 window 上。此处不再重复定义：
// 两个文件同处 browse.bundle.js，重名的顶层声明会与 examActions 的全局写入
// 静默互相覆盖（历史上 loadExamList 就因此渲染空白）。
// 调用方请走 window.ExamActions.*（未加载时有 main-entry.js 的懒加载代理兜底）。

function getResourceCore() {
    return window.ResourceCore || null;
}

window.resolveExamBasePath = function (exam) {
    const resourceCore = getResourceCore();
    if (resourceCore && typeof resourceCore.resolveExamBasePath === 'function') {
        return resourceCore.resolveExamBasePath(exam);
    }
    return '';
};

window.buildResourcePath = function (exam, kind) {
    const resourceCore = getResourceCore();
    if (resourceCore && typeof resourceCore.buildResourcePath === 'function') {
        return resourceCore.buildResourcePath(exam, kind);
    }
    return '';
};

window.derivePathMapFromIndex = function (exams, fallbackMap) {
    const resourceCore = getResourceCore();
    if (resourceCore && typeof resourceCore.derivePathMapFromIndex === 'function') {
        return resourceCore.derivePathMapFromIndex(exams, fallbackMap);
    }
    return fallbackMap || null;
};

window.loadPathMapForConfiguration = async function (key) {
    const resourceCore = getResourceCore();
    if (resourceCore && typeof resourceCore.loadPathMapForConfiguration === 'function') {
        return resourceCore.loadPathMapForConfiguration(key);
    }
    return null;
};

window.savePathMapForConfiguration = async function (key, examIndex, options) {
    const resourceCore = getResourceCore();
    if (resourceCore && typeof resourceCore.savePathMapForConfiguration === 'function') {
        return resourceCore.savePathMapForConfiguration(key, examIndex, options || {});
    }
    return null;
};

window.getPathMap = function () {
    const resourceCore = getResourceCore();
    if (resourceCore && typeof resourceCore.getPathMap === 'function') {
        return resourceCore.getPathMap();
    }
    return null;
};

window.setActivePathMap = function (map) {
    const resourceCore = getResourceCore();
    if (resourceCore && typeof resourceCore.setActivePathMap === 'function') {
        return resourceCore.setActivePathMap(map);
    }
    return map || null;
};

function openExam(examId, options = {}) {
    if (window.app && typeof window.app.openExam === 'function') {
        try {
            return window.app.openExam(examId, options || {});
        } catch (error) {
            console.error('[Main] app.openExam 调用失败，已停止原始 HTML 兜底:', error);
            return showMessage('统一练习入口启动失败：app.openExam 抛出异常，已阻止打开原始题源 HTML。', 'error');
        }
    }

    console.error('[Main] 统一练习入口未就绪，已阻止打开原始题源 HTML:', { examId });
    return showMessage('统一练习入口未就绪：app.openExam 不可用，已阻止打开原始题源 HTML。', 'error');
}

async function viewPDF(examId) {
    const list = await resolveActiveExamIndex();
    const exam = list.find(e => e.id === examId);
    if (!exam || !exam.pdfFilename) return showMessage('未找到PDF文件', 'error');

    const fullPath = window.buildResourcePath(exam, 'pdf');
    openPDFSafely(fullPath, exam.title);
}

// Bridge for record details to existing enhancer/modal if present
function showRecordDetails(recordId) {
    ensurePracticeSuiteReady().then(() => {
        if (window.practiceHistoryEnhancer && typeof window.practiceHistoryEnhancer.showRecordDetails === 'function') {
            window.practiceHistoryEnhancer.showRecordDetails(recordId);
            return;
        }
        if (window.practiceRecordModal && typeof window.practiceRecordModal.showById === 'function') {
            window.practiceRecordModal.showById(recordId);
            return;
        }
        alert('无法显示记录详情：组件未加载');
    }).catch((error) => {
        console.error('[Practice] 记录详情组件加载失败:', error);
        if (typeof showMessage === 'function') {
            showMessage('记录详情模块加载失败', 'error');
        } else {
            alert('记录详情模块加载失败');
        }
    });
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
        } catch (_) { }
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

function updateSystemInfo(examIndex = []) {
    const examIndexSnapshot = Array.isArray(examIndex) ? examIndex : [];
    if (!examIndexSnapshot || examIndexSnapshot.length === 0) return;
    const readingExams = examIndexSnapshot.filter(e => e.type === 'reading');
    const listeningExams = examIndexSnapshot.filter(e => e.type === 'listening');

    const totalEl = document.getElementById('total-exams');
    if (totalEl) totalEl.textContent = examIndexSnapshot.length;
    // These IDs might not exist anymore, but we'll add them for robustness
    const htmlExamsEl = document.getElementById('html-exams');
    const pdfExamsEl = document.getElementById('pdf-exams');
    const lastUpdateEl = document.getElementById('last-update');

    if (htmlExamsEl) htmlExamsEl.textContent = readingExams.length + listeningExams.length; // Simplified
    if (pdfExamsEl) pdfExamsEl.textContent = examIndexSnapshot.filter(e => e.pdfFilename).length;
    if (lastUpdateEl) lastUpdateEl.textContent = new Date().toLocaleString();
}

function showMessage(message, type = 'info', duration = 4000) {
    if (typeof window !== 'undefined' && window.getMessageCenter) {
        return window.getMessageCenter().show(message, type, duration);
    }
    if (typeof window !== 'undefined' && window.MessageCenter && typeof window.MessageCenter.getInstance === 'function') {
        return window.MessageCenter.getInstance().show(message, type, duration);
    }
    if (typeof console !== 'undefined') {
        const logMethod = type === 'error' ? 'error' : 'log';
        console[logMethod](`[Message:${type}]`, message);
    }
    return null;
}

if (typeof window !== 'undefined') {
    window.showMessage = showMessage;
}

function requestLibraryConfigDeleteConfirmation(configLabel) {
    if (typeof document === 'undefined' || !document.body) {
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        const existing = document.querySelector('.library-config-confirm-overlay');
        if (existing) {
            existing.remove();
        }

        const overlay = document.createElement('div');
        overlay.className = 'library-config-confirm-overlay';
        overlay.setAttribute('role', 'presentation');

        const dialog = document.createElement('div');
        dialog.className = 'library-config-confirm-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'library-config-confirm-title');

        const title = document.createElement('h3');
        title.id = 'library-config-confirm-title';
        title.className = 'library-config-confirm-title';
        title.textContent = '删除题库配置';

        const body = document.createElement('p');
        body.className = 'library-config-confirm-body';
        body.textContent = `将删除配置“${configLabel || '未命名题库'}”及其题库路径映射。练习记录不会被删除。`;

        const actions = document.createElement('div');
        actions.className = 'library-config-confirm-actions';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn-secondary';
        cancel.dataset.confirmAction = 'cancel';
        cancel.textContent = '取消';

        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'btn btn-warning';
        confirm.dataset.confirmAction = 'confirm';
        confirm.textContent = '删除';

        actions.appendChild(cancel);
        actions.appendChild(confirm);
        dialog.appendChild(title);
        dialog.appendChild(body);
        dialog.appendChild(actions);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        let settled = false;
        const finish = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            overlay.removeEventListener('click', onClick);
            document.removeEventListener('keydown', onKeydown);
            overlay.remove();
            resolve(value);
        };
        const onClick = (event) => {
            const target = event.target && event.target.closest ? event.target.closest('[data-confirm-action]') : null;
            if (target) {
                finish(target.dataset.confirmAction === 'confirm');
                return;
            }
            if (event.target === overlay) {
                finish(false);
            }
        };
        const onKeydown = (event) => {
            if (event.key === 'Escape') {
                finish(false);
            }
        };

        overlay.addEventListener('click', onClick);
        document.addEventListener('keydown', onKeydown);
        setTimeout(() => {
            try { cancel.focus(); } catch (_) { }
        }, 0);
    });
}

// Other functions from the original file (simplified or kept as is)
async function getActiveLibraryConfigurationKey() {
    const manager = await ensureLibraryManagerReady();
    if (manager && typeof manager.getActiveLibraryConfigurationKey === 'function') {
        return await manager.getActiveLibraryConfigurationKey();
    }
    return window.AppData.library.getActive();
}
async function getLibraryConfigurations() {
    const manager = await ensureLibraryManagerReady();
    if (manager && typeof manager.getLibraryConfigurations === 'function') {
        return await manager.getLibraryConfigurations();
    }
    return await window.AppData.library.listConfigurations();
}
async function saveLibraryConfiguration(name, key, examCount) {
    const manager = await ensureLibraryManagerReady();
    if (manager && typeof manager.saveLibraryConfiguration === 'function') {
        return await manager.saveLibraryConfiguration(name, key, examCount);
    }
}
async function setActiveLibraryConfiguration(key) {
    const manager = await ensureLibraryManagerReady();
    if (manager && typeof manager.setActiveLibraryConfiguration === 'function') {
        return await manager.setActiveLibraryConfiguration(key);
    }
}
// --- Library Loader Modal and Index Management ---
// ... other utility and management functions can be moved here ...
// --- Functions Restored from Backup ---


let debouncedExamSearch = null;
let pendingDebouncedExamSearchRequestId = null;

function searchExams(query, renderRequestId = null) {
    const explicitRequestIsForeground = renderRequestId != null
        && isBrowseUserResultsRequestInFlight(renderRequestId);
    const isForegroundIntent = renderRequestId == null || explicitRequestIsForeground;
    const userRequestId = renderRequestId == null
        ? beginBrowseUserResultsRequest()
        : (explicitRequestIsForeground
            ? retainBrowseUserResultsRequest(renderRequestId)
            : null);
    const activeRequestId = renderRequestId == null ? userRequestId : renderRequestId;
    if (activeRequestId == null
        || !isBrowseResultsRequestCurrent(activeRequestId)
        || (isForegroundIntent && userRequestId == null)) {
        endBrowseUserResultsRequest(userRequestId);
        return false;
    }
    // Capture navigation/reset/library ownership at input time, before the
    // debounce delay. A later callback must not adopt an intervening intent.
    const foregroundEpoch = captureBrowseForegroundRenderEpoch();
    toggleSearchClearButton(query);
    if (window.performanceOptimizer && typeof window.performanceOptimizer.debounce === 'function') {
        // 跨 input 事件复用同一个 debounce 闭包，避免每个字符都排队一次搜索。
        if (!debouncedExamSearch) {
            debouncedExamSearch = window.performanceOptimizer.debounce((
                nextQuery,
                nextRequestId,
                retainedRequestId,
                intentEpoch,
                foregroundIntent
            ) => {
                if (pendingDebouncedExamSearchRequestId === retainedRequestId) {
                    pendingDebouncedExamSearchRequestId = null;
                }
                Promise.resolve(renderBrowseResultsForState(null, nextRequestId, {
                    foreground: foregroundIntent,
                    foregroundEpoch: intentEpoch,
                    query: nextQuery
                })).catch((error) => {
                    console.warn('[Search] 搜索结果刷新失败:', error);
                }).finally(() => {
                    endBrowseUserResultsRequest(retainedRequestId);
                });
            }, 300, 'exam_search');
        }
        if (pendingDebouncedExamSearchRequestId != null) {
            endBrowseUserResultsRequest(pendingDebouncedExamSearchRequestId);
        }
        pendingDebouncedExamSearchRequestId = userRequestId;
        debouncedExamSearch(
            query,
            activeRequestId,
            userRequestId,
            foregroundEpoch,
            isForegroundIntent
        );
    } else {
        // Fallback: direct call if optimizer not available
        Promise.resolve(renderBrowseResultsForState(null, activeRequestId, {
            foreground: isForegroundIntent,
            foregroundEpoch,
            query
        })).catch((error) => {
            console.warn('[Search] 搜索结果刷新失败:', error);
        }).finally(() => {
            endBrowseUserResultsRequest(userRequestId);
        });
    }
    return true;
}

function toggleSearchClearButton(query) {
    const clearButton = document.getElementById('search-clear-btn');
    if (!clearButton) {
        return;
    }
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    clearButton.hidden = normalizedQuery.length === 0;
}

function clearSearch() {
    const searchInput = document.getElementById('exam-search-input') || document.querySelector('.search-input');
    if (searchInput) {
        searchInput.value = '';
        try {
            searchInput.focus();
        } catch (_) { }
    }
    if (window.browseStateManager && typeof window.browseStateManager.clearSearchState === 'function') {
        try { window.browseStateManager.clearSearchState(); } catch (_) { }
    }
    toggleSearchClearButton('');
    searchExams('');
}

function getBrowseFilteredExamBase(examIndexSnapshot = []) {
    const examIndex = Array.isArray(examIndexSnapshot) ? examIndexSnapshot : [];
    const folderScopedExamIndex = applyActiveBrowseFolderFilter(examIndex);
    const activeCategory = typeof getCurrentCategory === 'function' ? getCurrentCategory() : 'all';
    const activeExamType = typeof getCurrentExamType === 'function' ? getCurrentExamType() : 'all';
    const isFrequencyMode = window.__browseFilterMode && window.__browseFilterMode !== 'default';
    const basePathFilter = isFrequencyMode && typeof window.__browsePath === 'string' && window.__browsePath.trim()
        ? window.__browsePath.trim()
        : null;

    if (window.ExamFilterService && typeof window.ExamFilterService.filterExams === 'function') {
        return window.ExamFilterService.filterExams(folderScopedExamIndex, {
            activeCategory,
            activeExamType,
            browseFilterMode: window.__browseFilterMode,
            basePathFilter,
            browsePath: window.__browsePath,
            sortMode: window.__browseSortMode,
            frequencyFilter: window.__browseFrequencyFilter
        });
    }

    let list = folderScopedExamIndex.slice();
    if (activeExamType !== 'all') {
        list = list.filter((exam) => exam && exam.type === activeExamType);
    }
    if (activeCategory !== 'all') {
        list = list.filter((exam) => exam && exam.category === activeCategory);
    }
    if (basePathFilter) {
        list = list.filter((exam) => typeof exam?.path === 'string' && exam.path.includes(basePathFilter));
    }
    if (window.ExamActions && typeof window.ExamActions.applyBrowsePostFilters === 'function') {
        list = window.ExamActions.applyBrowsePostFilters(
            list,
            window.__browseSortMode,
            window.__browseFrequencyFilter
        );
    }
    return list;
}

function applyActiveBrowseFolderFilter(exams) {
    const list = Array.isArray(exams) ? exams : [];
    const controller = window.browseController;
    if (!controller
        || typeof controller.getCurrentModeConfig !== 'function'
        || typeof controller.filterExamsByFolder !== 'function') {
        return list;
    }
    const config = controller.getCurrentModeConfig();
    if (!config || config.filterLogic !== 'folder-based') {
        return list;
    }
    const folderFiltered = controller.filterExamsByFolder(
        list,
        controller.activeFilter || 'all'
    );
    return Array.isArray(folderFiltered) ? folderFiltered : list;
}

async function performSearch(
    query,
    renderRequestId = null,
    examIndexOverride = null,
    options = {}
) {
    const activeRequestId = renderRequestId == null
        ? beginBrowseResultsRequest()
        : renderRequestId;
    const isCurrent = () => {
        if (!isBrowseResultsRequestCurrent(activeRequestId)) {
            return false;
        }
        if (!options || typeof options.isCurrent !== 'function') {
            return true;
        }
        try {
            return options.isCurrent() !== false;
        } catch (_) {
            return false;
        }
    };
    const normalizedQuery = String(query || '').toLowerCase().trim();
    if (!normalizedQuery) {
        return loadExamList(examIndexOverride, activeRequestId, { isCurrent });
    }

    // 调试日志
    console.log('[Search] 执行搜索，查询词:', normalizedQuery);
    const examIndexSnapshot = Array.isArray(examIndexOverride)
        ? examIndexOverride
        : await resolveActiveExamIndex();
    if (!isCurrent()) {
        return false;
    }
    const searchBase = getBrowseFilteredExamBase(examIndexSnapshot);
    console.log('[Search] 当前筛选后索引数量:', searchBase.length);
    const searchResults = searchBase.filter(exam => {
        if (exam.searchText) {
            return exam.searchText.includes(normalizedQuery);
        }
        // Fallback 匹配
        return (exam.title && exam.title.toLowerCase().includes(normalizedQuery)) ||
            (exam.category && exam.category.toLowerCase().includes(normalizedQuery));
    });

    console.log('[Search] 搜索结果数量:', searchResults.length);
    if (!isCurrent()) {
        return false;
    }
    let committed = false;
    if (window.ExamActions && typeof window.ExamActions.displayExams === 'function') {
        committed = window.ExamActions.displayExams(searchResults, {
            commitReceipt: options.commitReceipt
        }) === true;
    } else if (typeof window.displayExams === 'function') {
        committed = window.displayExams(searchResults, {
            commitReceipt: options.commitReceipt
        }) === true;
    }
    return committed ? searchResults : false;
}

async function toggleBulkDelete() {
    const nextMode = !getBulkDeleteModeState();
    setBulkDeleteModeState(nextMode);
    if (nextMode) {
        clearSelectedRecordsState();
        refreshBulkDeleteButton();
        if (typeof showMessage === 'function') {
            showMessage('批量管理模式已开启，点击记录进行选择', 'info');
        }
        await syncPracticeRecords({ forceRender: true });
        return;
    }

    refreshBulkDeleteButton();
    const selected = getSelectedRecordsState();
    if (selected.size > 0) {
        const confirmMessage = `确定要删除选中的 ${selected.size} 条记录吗？此操作不可恢复。`;
        if (confirm(confirmMessage)) {
            try {
                await bulkDeleteRecords(selected);
            } catch (error) {
                console.error('[System] 批量删除失败:', error);
                showMessage('批量删除失败：' + (error && error.message ? error.message : '未知错误'), 'error');
            }
        }
    }

    clearSelectedRecordsState();
    refreshBulkDeleteButton();
    await syncPracticeRecords({ forceRender: true });
}

async function bulkDeleteRecords(selectedSnapshot = getSelectedRecordsState()) {
    const normalizedIds = Array.from(selectedSnapshot, (id) => normalizeRecordId(id)).filter(Boolean);
    if (normalizedIds.length === 0) {
        showMessage('请选择要删除的记录', 'warning');
        return;
    }

    const records = await listCanonicalPracticeRecords();
    const baseList = Array.isArray(records) ? records : [];
    const recordIds = new Set(baseList.map((record) => normalizeRecordId(record && record.id)).filter(Boolean));
    const deletedCount = normalizedIds.filter((id) => recordIds.has(id)).length;
    if (deletedCount === 0) {
        showMessage('未找到可删除的记录', 'warning');
        return;
    }

    await window.AppData.practice.deleteMany({ recordIds: normalizedIds });
    await syncPracticeRecords({ forceRender: true, trigger: 'bulk-delete' });

    showMessage(`已删除 ${deletedCount} 条记录`, 'success');
    console.log(`[System] 批量删除了 ${deletedCount} 条练习记录`);
}

async function toggleRecordSelection(recordId) {
    if (!getBulkDeleteModeState()) return;

    const normalizedId = normalizeRecordId(recordId);
    if (!normalizedId) {
        return;
    }

    const selected = getSelectedRecordsState();
    if (selected.has(normalizedId)) {
        removeSelectedRecordState(normalizedId);
    } else {
        addSelectedRecordState(normalizedId);
    }
    await syncPracticeRecords({ forceRender: true });
}


async function deleteRecord(recordId) {
    if (!recordId) {
        showMessage('记录ID无效', 'error');
        return;
    }

    const records = await listCanonicalPracticeRecords();
    const recordIndex = records.findIndex(record => String(record.id) === String(recordId));

    if (recordIndex === -1) {
        showMessage('未找到记录', 'error');
        return;
    }

    const record = records[recordIndex];
    const confirmMessage = `确定要删除这条练习记录吗？\n\n题目: ${record.title}\n时间: ${new Date(record.date).toLocaleString()}\n\n此操作不可恢复。`;

    if (confirm(confirmMessage)) {
        await window.AppData.practice.delete({ recordId });
        await syncPracticeRecords({ forceRender: true, trigger: 'single-delete' });
        showMessage('记录已删除', 'success');
    }
}

async function clearPracticeData() {
    if (confirm('确定要清除所有练习记录吗？此操作不可恢复。')) {
        await window.AppData.practice.clear();
        await syncPracticeRecords({ forceRender: true, trigger: 'clear-all' });
        if (window.AppData && window.AppData.recovery && typeof window.AppData.recovery.clear === 'function') {
            await window.AppData.recovery.clear();
        }
        processedSessions.clear();
        clearSelectedRecordsState();
        setBulkDeleteModeState(false);
        refreshBulkDeleteButton();
        showMessage('练习记录已清除', 'success');
    }
}

async function clearCache() {
    if (!window.SiteDataReset || typeof window.SiteDataReset.request !== 'function') {
        showMessage('清除失败：全量重置服务未就绪', 'error');
        return false;
    }
    return window.SiteDataReset.request();
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

function normalizeLibraryConfigurationRecords(rawConfigs) {
    const configs = Array.isArray(rawConfigs) ? rawConfigs : [];
    const normalized = [];
    const seenKeys = new Set();
    let mutated = false;
    const now = Date.now();

    const normalizeKey = (value) => {
        if (typeof value !== 'string') {
            return '';
        }
        return value.trim();
    };

    for (const config of configs) {
        if (!config) {
            mutated = true;
            continue;
        }

        if (typeof config === 'string') {
            const key = normalizeKey(config);
            if (!key) {
                mutated = true;
                continue;
            }
            if (seenKeys.has(key)) {
                mutated = true;
                continue;
            }
            seenKeys.add(key);
            normalized.push({
                name: key,
                key,
                examCount: 0,
                timestamp: now
            });
            mutated = true;
            continue;
        }

        if (typeof config !== 'object') {
            mutated = true;
            continue;
        }

        const record = Object.assign({}, config);

        let key = normalizeKey(record.key);
        if (!key) {
            const fallbackFields = ['storageKey', 'storage_key', 'id'];
            for (const field of fallbackFields) {
                key = normalizeKey(record[field]);
                if (key) {
                    record.key = key;
                    mutated = true;
                    break;
                }
            }
        }

        if (!key) {
            mutated = true;
            continue;
        }

        if (seenKeys.has(key)) {
            const existingIndex = normalized.findIndex(item => item.key === key);
            if (existingIndex !== -1) {
                const existing = normalized[existingIndex];
                const merged = Object.assign({}, existing);
                if ((!existing.name || existing.name === existing.key) && typeof record.name === 'string' && record.name.trim()) {
                    merged.name = record.name.trim();
                }
                if (!Number.isFinite(existing.examCount) || existing.examCount === 0) {
                    const fallbackCount = Number(record.examCount);
                    if (Number.isFinite(fallbackCount) && fallbackCount >= 0) {
                        merged.examCount = fallbackCount;
                    } else if (Array.isArray(record.exams)) {
                        merged.examCount = record.exams.length;
                    }
                }
                const mergedTimestamp = Number(record.timestamp || record.updatedAt || record.createdAt);
                if (Number.isFinite(mergedTimestamp) && mergedTimestamp > 0 && (!Number.isFinite(existing.timestamp) || mergedTimestamp > existing.timestamp)) {
                    merged.timestamp = mergedTimestamp;
                }
                normalized[existingIndex] = merged;
            }
            mutated = true;
            continue;
        }

        seenKeys.add(key);

        if (typeof record.name !== 'string' || !record.name.trim()) {
            record.name = key;
            mutated = true;
        } else {
            record.name = record.name.trim();
        }

        const count = Number(record.examCount);
        if (!Number.isFinite(count) || count < 0) {
            if (Array.isArray(record.exams)) {
                record.examCount = record.exams.length;
            } else if (Number.isFinite(Number(record.count)) && Number(record.count) >= 0) {
                record.examCount = Number(record.count);
            } else {
                record.examCount = 0;
            }
            mutated = true;
        } else {
            record.examCount = count;
        }

        const ts = Number(record.timestamp || record.updatedAt || record.createdAt);
        if (!Number.isFinite(ts) || ts <= 0) {
            record.timestamp = now;
            mutated = true;
        } else {
            record.timestamp = ts;
        }

        normalized.push(record);
    }

    return { normalized, mutated };
}

async function resolveLibraryConfigurations() {
    const rawConfigs = await getLibraryConfigurations();
    const activeIndex = await resolveActiveExamIndex();
    let configs = Array.isArray(rawConfigs) ? rawConfigs : [];
    let mutated = false;

    const normalizedResult = normalizeLibraryConfigurationRecords(configs);
    configs = normalizedResult.normalized;
    mutated = normalizedResult.mutated;

    if (!configs.some(config => config && config.builtIn === true)) {
        configs.unshift({
            name: '默认题库',
            key: '',
            id: null,
            builtIn: true,
            sourceType: 'built-in-manifest',
            examCount: activeIndex.length
        });
    }

    if (mutated) {
        try {
            for (const config of configs) {
                if (config && config.key && config.builtIn !== true) await window.AppData.library.updateConfiguration(config);
            }
        } catch (error) {
            console.warn('[LibraryConfig] 无法同步题库配置记录', error);
        }
    }

    return configs;
}

async function fetchLibraryDataset(key) {
    const manager = await ensureLibraryManagerReady();
    if (manager && typeof manager.fetchLibraryDataset === 'function') {
        return await manager.fetchLibraryDataset(key);
    }
    return [];
}

async function updateLibraryConfigurationMetadata(key, examCount) {
    const manager = await ensureLibraryManagerReady();
    if (manager && typeof manager.updateLibraryConfigurationMetadata === 'function') {
        return await manager.updateLibraryConfigurationMetadata(key, examCount);
    }
}

function resetBrowseStateAfterLibrarySwitch() {
    try {
        if (window.browseStateManager && typeof window.browseStateManager.resetToAllExams === 'function') {
            window.browseStateManager.resetToAllExams();
            return;
        }
    } catch (error) {
        console.warn('[LibraryConfig] 重置 BrowseStateManager 失败:', error);
    }
    setBrowseFilterState('all', 'all');
    setFilteredExamsState([]);
}

async function applyLibraryConfiguration(key, dataset, options = {}) {
    const manager = await ensureLibraryManagerReady();
    if (manager && typeof manager.applyLibraryConfiguration === 'function') {
        return await manager.applyLibraryConfiguration(key, dataset, options);
    }
    return false;
}

async function deleteLibraryConfiguration(key) {
    const manager = await ensureLibraryManagerReady();
    if (manager && typeof manager.deleteLibraryConfiguration === 'function') {
        return await manager.deleteLibraryConfiguration(key);
    }
    return { deleted: false, reason: 'manager-unavailable' };
}

async function debugCompareActiveIndexWithDefault() {
    try {
        const activeKey = await getActiveLibraryConfigurationKey();
        const activeIndex = await resolveActiveExamIndex();
        const defaultIndex = typeof window.getReadingExamIndex === 'function'
            ? window.getReadingExamIndex().map((exam) => Object.assign({}, exam, { type: 'reading' }))
            : (Array.isArray(window.__READING_EXAM_INDEX__)
                ? window.__READING_EXAM_INDEX__.map((exam) => Object.assign({}, exam, { type: 'reading' }))
                : []);
        const defaultListening = Array.isArray(window.listeningExamIndex) ? window.listeningExamIndex : [];
        const combinedDefault = [...defaultIndex, ...defaultListening];

        const normalizeTail = (path) => {
            const p = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean);
            if (p.length === 0) return '';
            if (p.length === 1) return p[0].toLowerCase();
            return (p[p.length - 2] + '/' + p[p.length - 1]).toLowerCase();
        };
        const makeKey = (exam) => {
            const title = (exam.title || '').toLowerCase();
            const tail = normalizeTail(exam.path || exam.resourcePath || exam.basePath);
            const file = (exam.filename || exam.pdfFilename || '').toLowerCase();
            return [title, tail, file].join('|');
        };

        const defaultMap = new Map();
        combinedDefault.forEach((exam) => {
            defaultMap.set(makeKey(exam), exam);
        });

        let hit = 0;
        let miss = 0;
        const misses = [];
        activeIndex.forEach((exam) => {
            const key = makeKey(exam);
            if (defaultMap.has(key)) {
                hit += 1;
            } else {
                miss += 1;
                misses.push({ title: exam.title, path: exam.path, file: exam.filename || exam.pdfFilename });
            }
        });

        console.log('[LibraryDebug] Active key:', activeKey, '命中/总', hit, '/', activeIndex.length, '未命中示例前5:', misses.slice(0, 5));
        return { activeKey, hit, miss, sampleMisses: misses.slice(0, 10) };
    } catch (error) {
        console.warn('[LibraryDebug] 比对索引失败:', error);
        return null;
    }
}

function renderLibraryConfigFallback(container, configs, options) {
    const formatConfigMeta = (config) => {
        const counts = config && config.counts && typeof config.counts === 'object' ? config.counts : {};
        const total = Number.isFinite(Number(config && config.examCount)) ? Number(config.examCount) : (Number(counts.total) || 0);
        const parts = [];
        try {
            parts.push(new Date(config.timestamp).toLocaleString());
        } catch (_) {
            parts.push('未知时间');
        }
        parts.push(total + ' 个题目');
        if (Number.isFinite(Number(counts.reading)) || Number.isFinite(Number(counts.listening))) {
            parts.push('阅读 ' + (Number(counts.reading) || 0));
            parts.push('听力 ' + (Number(counts.listening) || 0));
        }
        const lastImport = config && config.lastImport && typeof config.lastImport === 'object' ? config.lastImport : null;
        if (lastImport && (lastImport.type || lastImport.mode)) {
            const typeLabel = lastImport.type === 'reading' ? '阅读' : (lastImport.type === 'listening' ? '听力' : '题库');
            const modeLabel = lastImport.mode === 'incremental' ? '增量' : (lastImport.mode === 'full' ? '全量' : '导入');
            parts.push(typeLabel + modeLabel);
        }
        return parts.join(' · ');
    };

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
        const isDefault = config.builtIn === true;
        const isActive = isDefault ? activeKey == null : activeKey === config.key;

        const item = document.createElement('div');
        item.className = 'library-config-panel__item' + (activeKey === config.key ? ' library-config-panel__item--active' : '');

        const info = document.createElement('div');
        info.className = 'library-config-panel__info';

        const titleLine = document.createElement('div');
        titleLine.textContent = config.name || config.key || '未命名题库';
        info.appendChild(titleLine);

        const meta = document.createElement('div');
        meta.className = 'library-config-panel__meta';
        meta.textContent = formatConfigMeta(config);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'library-config-panel__actions';

        const switchBtn = document.createElement('button');
        switchBtn.type = 'button';
        switchBtn.className = 'btn btn-secondary';
        switchBtn.dataset.configAction = 'switch';
        switchBtn.dataset.configKey = config.key || '';
        if (isActive) {
            switchBtn.dataset.configActive = '1';
        }
        switchBtn.textContent = '切换';
        actions.appendChild(switchBtn);

        if (!isDefault) {
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'btn btn-warning';
            deleteBtn.dataset.configAction = 'delete';
            deleteBtn.dataset.configKey = config.key;
            if (isActive) {
                deleteBtn.dataset.configActive = '1';
            }
            deleteBtn.textContent = '删除';
            actions.appendChild(deleteBtn);

            if (typeof deleteBtn.addEventListener === 'function') {
                deleteBtn.addEventListener('click', (event) => {
                    if (event && typeof event.preventDefault === 'function') {
                        event.preventDefault();
                    }
                    if (event && typeof event.stopPropagation === 'function') {
                        event.stopPropagation();
                    }
                    if (typeof deleteLibraryConfig === 'function') {
                        deleteLibraryConfig(config.key);
                    }
                });
            }
        }

        item.appendChild(info);
        item.appendChild(actions);
        list.appendChild(item);

        if (typeof switchBtn.addEventListener === 'function') {
            switchBtn.addEventListener('click', (event) => {
                if (event && typeof event.preventDefault === 'function') {
                    event.preventDefault();
                }
                if (event && typeof event.stopPropagation === 'function') {
                    event.stopPropagation();
                }
                if (typeof switchLibraryConfig === 'function') {
                    switchLibraryConfig(config.key);
                }
            });
        }
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

    const findActionTarget = (node) => {
        let current = node;
        while (current && current !== host) {
            if (current.dataset && current.dataset.configAction) {
                return current;
            }
            current = current.parentNode || (current.host && current.host instanceof Node ? current.host : null);
        }
        return null;
    };

    const handler = (event) => {
        const target = findActionTarget(event.target);
        if (!target) {
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

// Resolve the container for the library config list. The config list now lives
// inside the library manager modal (#library-manager-modal-body); when the
// modal is open we mount there, otherwise we fall back to #settings-view so
// non-modal callers (e.g. silent refreshes) still find a valid container.
function resolveLibraryConfigContainer(options) {
    const requestedId = options && typeof options.containerId === 'string' ? options.containerId : null;
    if (requestedId) {
        const requested = document.getElementById(requestedId);
        if (requested) {
            return requested;
        }
    }
    const modalHost = document.getElementById('library-manager-modal-body');
    if (modalHost) {
        return modalHost;
    }
    return document.getElementById('settings-view');
}

async function renderLibraryConfigList(options = {}) {
    const container = resolveLibraryConfigContainer(options);
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
    const key = typeof configKey === 'string' && configKey.trim() ? configKey.trim() : null;
    try {
        const activeKey = await getActiveLibraryConfigurationKey();
        if (activeKey === key) {
            showMessage('当前题库已激活', 'info');
            return;
        }
    } catch (error) {
        console.warn('[LibraryConfig] 无法读取当前题库配置', error);
    }
    const dataset = await fetchLibraryDataset(key);
    if (!Array.isArray(dataset) || dataset.length === 0) {
        showMessage('目标题库没有题目，请先加载该题库数据', 'warning');
        return;
    }
    showMessage('正在切换题库配置...', 'info');
    const applied = await applyLibraryConfiguration(key, dataset, { skipConfigRefresh: false });
    if (applied) {
        showMessage('题库配置已切换', 'success');
    }
}

// 删除题库配置
async function deleteLibraryConfig(configKey) {
    const key = typeof configKey === 'string' ? configKey.trim() : '';
    if (!key) {
        return;
    }
    try {
        const activeKey = await getActiveLibraryConfigurationKey();
        if (activeKey === key) {
            showMessage('当前正在使用此题库，请先切换到其他配置', 'warning');
            return;
        }
    } catch (error) {
        console.warn('[LibraryConfig] 无法读取当前题库配置', error);
    }

    let configLabel = key;
    try {
        const configs = await getLibraryConfigurations();
        const config = Array.isArray(configs)
            ? configs.find((item) => {
                if (!item) {
                    return false;
                }
                if (typeof item === 'string') {
                    return item.trim() === key;
                }
                return typeof item.key === 'string' && item.key.trim() === key;
            })
            : null;
        if (config && typeof config === 'object' && config.name) {
            configLabel = config.name;
        }
    } catch (error) {
        console.warn('[LibraryConfig] 无法读取题库配置名称', error);
    }

    const confirmed = await requestLibraryConfigDeleteConfirmation(configLabel);
    if (!confirmed) {
        return;
    }

    try {
        const result = await deleteLibraryConfiguration(key);
        if (result && result.deleted) {
            showMessage('题库配置已删除，练习记录已保留', 'success');
            await renderLibraryConfigList({ silentEmpty: true });
            return;
        }

        const reason = result && result.reason;
        if (reason === 'default-config') {
            showMessage('默认题库不可删除', 'warning');
        } else if (reason === 'active-config') {
            showMessage('当前正在使用此题库，请先切换到其他配置', 'warning');
        } else if (reason === 'not-found') {
            showMessage('未找到这个题库配置', 'warning');
        } else {
            showMessage('题库配置删除失败', 'error');
        }
    } catch (error) {
        console.warn('[LibraryConfig] 删除题库配置失败', error);
        showMessage('题库配置删除失败：' + (error && error.message ? error.message : '未知错误'), 'error');
    }
}

if (typeof window !== 'undefined') {
    window.switchLibraryConfig = switchLibraryConfig;
    window.deleteLibraryConfig = deleteLibraryConfig;
    window.setupBrowseControls = setupBrowseControls;
}


function showDeveloperTeam() {
    const modal = document.getElementById('developer-modal');
    if (modal) modal.classList.add('show');
}

function hideDeveloperTeam() {
    const modal = document.getElementById('developer-modal');
    if (modal) modal.classList.remove('show');
}

// Phase 3: 套题模式 - 已迁移到 app-actions.js
function startSuitePractice() {
    if (window.AppActions && typeof window.AppActions.startSuitePractice === 'function') {
        return window.AppActions.startSuitePractice();
    }
    // 降级：直接调用 app
    const appInstance = window.app;
    if (appInstance && typeof appInstance.startSuitePractice === 'function') {
        try {
            return appInstance.startSuitePractice();
        } catch (error) {
            console.error('[main.js] 套题模式启动失败', error);
            if (typeof showMessage === 'function') {
                showMessage('套题模式启动失败，请稍后重试', 'error');
            }
        }
    } else {
        if (typeof showMessage === 'function') {
            showMessage('套题模式尚未初始化', 'warning');
        }
    }
}

// Phase 3: 打开题目 - 已迁移到 app-actions.js
function openExamWithFallback(exam, delay = 600) {
    if (window.AppActions && typeof window.AppActions.openExamWithFallback === 'function') {
        return window.AppActions.openExamWithFallback(exam, delay);
    }
    // 降级：直接执行
    if (!exam) {
        if (typeof showMessage === 'function') {
            showMessage('未找到可用题目', 'error');
        }
        return;
    }
    const launch = () => {
        try {
            if (exam.hasHtml) {
                openExam(exam.id);
            } else {
                viewPDF(exam.id);
            }
        } catch (error) {
            console.error('[main.js] 启动题目失败:', error);
            if (typeof showMessage === 'function') {
                showMessage('无法打开题目，请检查题库路径', 'error');
            }
        }
    };
    if (delay > 0) {
        setTimeout(launch, delay);
    } else {
        launch();
    }
}

// Phase 3: 随机练习 - 已迁移到 app-actions.js
async function startRandomPractice(category, type = 'reading', filterMode = null, path = null) {
    if (window.AppActions && typeof window.AppActions.startRandomPractice === 'function') {
        return window.AppActions.startRandomPractice(category, type, filterMode, path);
    }
    // 降级：直接执行
    const list = await resolveActiveExamIndex();
    const normalizedType = (!type || type === 'all') ? null : type;
    const normalizedPath = (typeof path === 'string' && path.trim()) ? path.trim() : null;

    let pool = Array.from(list);
    if (normalizedType) {
        pool = pool.filter((exam) => exam.type === normalizedType);
    }
    if (category && category !== 'all') {
        const filteredByCategory = pool.filter((exam) => exam.category === category);
        if (filteredByCategory.length > 0 || !normalizedPath) {
            pool = filteredByCategory;
        }
    }
    if (normalizedPath) {
        pool = pool.filter((exam) => typeof exam?.path === 'string' && exam.path.includes(normalizedPath));
    } else if (filterMode && window.BROWSE_MODES && window.BROWSE_MODES[filterMode]) {
        const modeConfig = window.BROWSE_MODES[filterMode];
        if (modeConfig?.basePath) {
            pool = pool.filter((exam) => typeof exam?.path === 'string' && exam.path.includes(modeConfig.basePath));
        }
    }
    if (pool.length === 0) {
        if (typeof showMessage === 'function') {
            const typeLabel = normalizedType === 'listening' ? '听力' : (normalizedType === 'reading' ? '阅读' : '题库');
            showMessage(`${category} ${typeLabel} 分类暂无可用题目`, 'error');
        }
        return;
    }
    const randomExam = pool[Math.floor(Math.random() * pool.length)];
    if (typeof showMessage === 'function') {
        showMessage(`随机选择: ${randomExam.title}`, 'info');
    }
    openExamWithFallback(randomExam);
}

// Phase 4: 清理重复事件绑定
// setupExamActionHandlers 已在 examActions.js 的 displayExams 中调用，此处移除重复调用
ensurePracticeSessionSyncListener();
