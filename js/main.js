// Main JavaScript logic for the application
// This file is the result of refactoring the inline script from improved-working-system.html

const legacyStateAdapter = window.LegacyStateAdapter ? window.LegacyStateAdapter.getInstance() : null;

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

function reportBootStage(message, progress) {
    if (window.AppBootScreen && typeof window.AppBootScreen.setStage === 'function') {
        try {
            window.AppBootScreen.setStage(message, progress);
        } catch (error) {
            console.warn('[BootStage] 更新失败:', error);
        }
    }
}

function ensureExamDataScripts() {
    if (window.AppLazyLoader && typeof window.AppLazyLoader.ensureGroup === 'function') {
        return window.AppLazyLoader.ensureGroup('exam-data');
    }
    return Promise.resolve();
}

function ensurePracticeSuiteReady() {
    if (window.AppActions && typeof window.AppActions.ensurePracticeSuite === 'function') {
        return window.AppActions.ensurePracticeSuite();
    }
    if (window.AppLazyLoader && typeof window.AppLazyLoader.ensureGroup === 'function') {
        return window.AppLazyLoader.ensureGroup('practice-suite');
    }
    return Promise.resolve();
}

function ensureBrowseGroup() {
    if (window.AppLazyLoader && typeof window.AppLazyLoader.ensureGroup === 'function') {
        return window.AppLazyLoader.ensureGroup('browse-view');
    }
    return Promise.resolve();
}

function getLibraryManager() {
    if (window.LibraryManager && typeof window.LibraryManager.getInstance === 'function') {
        return window.LibraryManager.getInstance();
    }
    return null;
}

async function ensureLibraryManagerReady() {
    let manager = getLibraryManager();
    if (manager) {
        return manager;
    }
    await ensureBrowseGroup();
    manager = getLibraryManager();
    return manager;
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
    var mergedOptions = Object.assign({
        containerSelector: '.main-nav',
        activeClass: 'active',
        syncOnNavigate: true,
        onRepeatNavigate: function onRepeatNavigate(viewName) {
            if (viewName === 'browse') {
                resetBrowseViewToAll();
            }
        },
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
        ensureLegacyNavigation({ initialView: 'overview' });
    } catch (error) {
        console.warn('[Navigation] 初始化导航控制器失败:', error);
    }

    setupBrowsePreferenceUI();

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
    let needsCleanup = false;
    try {
        needsCleanup = !localStorage.getItem('upgrade_v1_1_0_cleanup_done');
    } catch (error) {
        console.warn('[System] 检查升级标记失败，将继续执行清理流程', error);
        needsCleanup = true;
    }

    if (needsCleanup) {
        console.log('[System] 首次运行，执行升级清理...');
        try {
            await cleanupOldCache();
        } finally {
            try { localStorage.setItem('upgrade_v1_1_0_cleanup_done', '1'); } catch (_) { }
        }
    } else {
        console.log('[System] 升级清理已完成，跳过重复清理');
    }

    // Load data and setup listeners
    await loadLibrary();
    startPracticeRecordsSyncInBackground('boot'); // 后台静默加载练习记录，避免阻塞首页
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
                            dur = Math.round((e - s) / 1000);
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
                    } catch (_) { }
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

    // 若数据未变则跳过 UI 刷新，避免无意义的列表重置
    try {
        const prev = typeof getPracticeRecordsState === 'function'
            ? getPracticeRecordsState()
            : (Array.isArray(window.practiceRecords) ? window.practiceRecords : []);
        const renderer = window.PracticeHistoryRenderer;
        if (renderer && renderer.helpers && typeof renderer.helpers.computeRecordsSignature === 'function') {
            const prevSig = renderer.helpers.computeRecordsSignature(prev);
            const nextSig = renderer.helpers.computeRecordsSignature(records);
            if (prevSig === nextSig) {
                console.log('[System] 练习记录未变化，跳过UI刷新');
                return;
            }
        }
    } catch (_) { /* 保底不中断同步流程 */ }

    // 新增修复3D：确保全局变量是UI的单一数据源
    setPracticeRecordsState(records);
    refreshBrowseProgressFromRecords(records);

    console.log(`[System] ${records.length} 条练习记录已加载到内存。`);
    updatePracticeView();
}

let practiceRecordsLoadPromise = null;
function ensurePracticeRecordsSync(trigger = 'default') {
    if (practiceRecordsLoadPromise) {
        return practiceRecordsLoadPromise;
    }
    practiceRecordsLoadPromise = (async () => {
        await syncPracticeRecords();
        return true;
    })().catch((error) => {
        console.warn(`[System] 练习记录同步失败(${trigger}):`, error);
        practiceRecordsLoadPromise = null;
        return false;
    });
    return practiceRecordsLoadPromise;
}

function startPracticeRecordsSyncInBackground(trigger = 'default') {
    try {
        ensurePracticeRecordsSync(trigger);
    } catch (error) {
        console.warn(`[System] 后台同步练习记录失败(${trigger}):`, error);
    }
}

const completionNoticeState = {
    lastSessionId: null,
    lastShownAt: 0
};

function extractCompletionPayload(envelope) {
    if (!envelope || typeof envelope !== 'object') {
        return null;
    }
    const candidates = [envelope.data, envelope.payload, envelope.results, envelope.detail, envelope];
    for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        if (candidate && typeof candidate === 'object') {
            if (
                candidate.scoreInfo ||
                typeof candidate.correctAnswers !== 'undefined' ||
                typeof candidate.totalQuestions !== 'undefined' ||
                (candidate.answers && typeof candidate.answers === 'object')
            ) {
                return candidate;
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

function setupMessageListener() {
    window.addEventListener('message', (event) => {
        // 更兼容的安全检查：允许同源或file协议下的子窗口
        try {
            if (event.origin && event.origin !== 'null' && event.origin !== window.location.origin) {
                return;
            }
        } catch (_) { }

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
            } catch (_) { }
        } else if (type === 'PRACTICE_COMPLETE' || type === 'practice_completed') {
            const payload = extractCompletionPayload(data) || {};
            const sessionId = extractCompletionSessionId(data);
            const rec = sessionId ? fallbackExamSessions.get(sessionId) : null;
            const shouldNotify = shouldAnnounceCompletion(sessionId);
            if (rec) {
                console.log('[Fallback] 收到练习完成（降级路径），保存真实数据');
                savePracticeRecordFallback(rec.examId, payload).finally(() => {
                    try { if (rec && rec.timer) clearInterval(rec.timer); } catch (_) { }
                    try { fallbackExamSessions.delete(sessionId); } catch (_) { }
                    if (shouldNotify) {
                        showMessage('练习已完成，正在更新记录...', 'success');
                        showCompletionSummary(payload);
                    }
                    setTimeout(syncPracticeRecords, 300);
                });
            } else {
                console.log('[System] 收到练习完成消息，正在同步记录...');
                if (shouldNotify) {
                    showMessage('练习已完成，正在更新记录...', 'success');
                    showCompletionSummary(payload);
                }
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

// 降级保存：将 PRACTICE_COMPLETE 的真实数据写入 practice_records（与旧视图字段兼容）
async function savePracticeRecordFallback(examId, realData) {
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
            console.log('[Fallback] 检测到套题模式子结果，降级路径跳过单篇保存:', {
                examId,
                suiteSessionId: suiteSessionId || null
            });
            return null;
        }

        const list = getExamIndexState();
        let exam = list.find(e => e.id === examId) || {};

        // 如果通过 examId 找不到，尝试通过 URL 或标题匹配
        if (!exam.id && realData) {
            // 尝试通过 URL 匹配
            if (realData.url) {
                const urlPath = realData.url.toLowerCase();
                const urlMatch = list.find(e => {
                    if (!e.path) return false;
                    const itemPath = e.path.toLowerCase();
                    const urlParts = urlPath.split('/').filter(Boolean);
                    const pathParts = itemPath.split('/').filter(Boolean);

                    // 检查最后几个路径段是否匹配
                    for (let i = 0; i < Math.min(urlParts.length, pathParts.length); i++) {
                        if (urlParts[urlParts.length - 1 - i] === pathParts[pathParts.length - 1 - i]) {
                            return true;
                        }
                    }
                    return false;
                });
                if (urlMatch) {
                    exam = urlMatch;
                    console.log('[Fallback] 通过 URL 匹配到题目:', exam.id, exam.title);
                }
            }

            // 尝试通过标题匹配
            if (!exam.id && realData.title) {
                const normalizeTitle = (str) => {
                    if (!str) return '';
                    return String(str).trim().toLowerCase()
                        .replace(/^\[.*?\]\s*/, '')  // 移除标签前缀
                        .replace(/[^\w\s]/g, '')
                        .replace(/\s+/g, ' ');
                };
                const targetTitle = normalizeTitle(realData.title);
                const titleMatch = list.find(e => {
                    if (!e.title) return false;
                    const itemTitle = normalizeTitle(e.title);
                    return itemTitle === targetTitle ||
                        (targetTitle.length > 5 && itemTitle.includes(targetTitle)) ||
                        (itemTitle.length > 5 && targetTitle.includes(itemTitle));
                });
                if (titleMatch) {
                    exam = titleMatch;
                    console.log('[Fallback] 通过标题匹配到题目:', exam.id, exam.title);
                }
            }
        }

        const sInfo = realData && realData.scoreInfo ? realData.scoreInfo : {};
        const correct = typeof sInfo.correct === 'number' ? sInfo.correct : 0;
        const normalizedAnswers = normalizeFallbackAnswerMap(realData.answers);
        const normalizedCorrectMap = normalizeFallbackAnswerMap(realData.correctAnswers);
        const total = typeof sInfo.total === 'number' ? sInfo.total : Object.keys(normalizedCorrectMap).length || Object.keys(normalizedAnswers).length;
        const acc = typeof sInfo.accuracy === 'number' ? sInfo.accuracy : (total > 0 ? correct / total : 0);
        const pct = typeof sInfo.percentage === 'number' ? sInfo.percentage : Math.round(acc * 100);

        const answerDetails = buildFallbackAnswerDetails(normalizedAnswers, normalizedCorrectMap);
        const answerComparison = normalizeFallbackAnswerComparison(realData.answerComparison, normalizedAnswers, normalizedCorrectMap);
        const scoreInfo = {
            correct,
            total,
            accuracy: acc,
            percentage: pct,
            details: answerDetails,
            source: sInfo.source || realData.source || 'fallback'
        };

        // 从多个来源提取 category
        let category = exam.category;
        if (!category && realData.pageType) {
            category = realData.pageType;  // 如 "P4"
        }
        if (!category && realData.url) {
            const match = realData.url.match(/\b(P[1-4])\b/i);
            if (match) category = match[1].toUpperCase();
        }
        if (!category && realData.title) {
            const match = realData.title.match(/\b(P[1-4])\b/i);
            if (match) category = match[1].toUpperCase();
        }
        if (!category) {
            category = 'Unknown';
        }

        const record = {
            id: Date.now(),
            examId: examId,
            title: exam.title || realData.title || '',
            category: category,
            frequency: exam.frequency || 'unknown',
            realData: {
                score: correct,
                totalQuestions: total,
                accuracy: acc,
                percentage: pct,
                duration: realData.duration,
                answers: normalizedAnswers,
                correctAnswers: normalizedCorrectMap,
                interactions: realData.interactions || [],
                answerComparison,
                scoreInfo,
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
            answers: normalizedAnswers,
            answerDetails,
            correctAnswerMap: normalizedCorrectMap,
            answerComparison,
            scoreInfo,
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
    const manager = await ensureLibraryManagerReady();
    if (!manager || typeof manager.loadActiveLibrary !== 'function') {
        console.warn('[Library] LibraryManager 未就绪，跳过加载');
        return;
    }
    await manager.loadActiveLibrary(forceReload);
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

function updateOverview() {
    const categoryContainer = document.getElementById('category-overview');
    if (!categoryContainer) {
        console.warn('[Overview] 找不到 category-overview 容器');
        return;
    }

    const currentExamIndex = getExamIndexState();
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

function updatePracticeView() {
    const rawRecords = getPracticeRecordsState();
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
            recordsToShow = stats.filterByExamType(recordsToShow, getExamIndexState(), examType);
        } else {
            const examIndexSnapshot = getExamIndexState();
            recordsToShow = recordsToShow.filter((record) => recordMatchesExamType(record, examType, examIndexSnapshot));
        }
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

function refreshBrowseProgressFromRecords(recordsOverride = null) {
    try {
        const records = Array.isArray(recordsOverride)
            ? recordsOverride
            : (typeof getPracticeRecordsState === 'function'
                ? getPracticeRecordsState()
                : (Array.isArray(window.practiceRecords) ? window.practiceRecords : []));
        if (typeof updateBrowseAnchorsFromRecords === 'function') {
            updateBrowseAnchorsFromRecords(records);
        }
        const browseView = document.getElementById('browse-view');
        const isBrowseActive = browseView && browseView.classList.contains('active');
        if (isBrowseActive && typeof loadExamList === 'function') {
            loadExamList();
        }
    } catch (error) {
        console.warn('[Browse] 刷新浏览进度失败:', error);
    }
}

let practiceSessionEventBound = false;
function ensurePracticeSessionSyncListener() {
    if (practiceSessionEventBound) {
        return;
    }
    practiceSessionEventBound = true;
    document.addEventListener('practiceSessionCompleted', (event) => {
        try {
            const detail = event && event.detail ? event.detail : {};
            let record = detail.practiceRecord;
            if (record && typeof record === 'object') {
                record = enrichPracticeRecordForUI(record);
                const current = getPracticeRecordsState();
                const filtered = Array.isArray(current)
                    ? current.filter((item) => item && item.id !== record.id)
                    : [];
                setPracticeRecordsState([record, ...filtered]);
                updatePracticeView();
                refreshBrowseProgressFromRecords([record, ...filtered]);
            }
        } catch (syncError) {
            console.warn('[PracticeView] practiceSessionCompleted 事件处理失败:', syncError);
        } finally {
            // 仍然执行一次全面同步，确保 ScoreStorage/StorageRepo 状态一致
            setTimeout(() => {
                try { syncPracticeRecords(); } catch (_) { }
            }, 200);
        }
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
            // 常规模式仍需刷新题库；频率模式由 browseController 接管
            if (!filterMode) {
                setTimeout(() => loadExamList(), 100);
            }
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

function filterByType(type) {
    // 重置筛选器状态
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
        window.browseController.resetToDefault();
    }

    // 刷新题库列表
    loadExamList();
}

// 应用分类筛选（供 App/总览调用）
function applyBrowseFilter(category = 'all', type = null, filterMode = null, path = null) {
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
                const indexSnapshot = getExamIndexState();
                const hasReading = indexSnapshot.some(e => e.category === normalizedCategory && e.type === 'reading');
                const hasListening = indexSnapshot.some(e => e.category === normalizedCategory && e.type === 'listening');
                if (hasReading && !hasListening) type = 'reading';
                else if (!hasReading && hasListening) type = 'listening';
                else type = 'all';
            } catch (_) { type = 'all'; }
        }

        const normalizedType = normalizeExamType(type);
        const normalizedPath = (typeof path === 'string' && path.trim()) ? path.trim() : null;

        // 1. 先处理模式切换/重置
        if (filterMode) {
            const modeConfig = window.BROWSE_MODES && window.BROWSE_MODES[filterMode];
            const basePath = normalizedPath || (modeConfig && modeConfig.basePath) || null;
            window.__browsePath = basePath;
            window.__browseFilterMode = filterMode;
            if (window.browseController) {
                try {
                    if (!window.browseController.buttonContainer) {
                        window.browseController.initialize('type-filter-buttons');
                    }
                    window.browseController.setMode(filterMode);
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
                window.browseController.resetToDefault();
            }
        }

        // 2. 再应用具体的分类和类型筛选（确保不被重置覆盖）
        setBrowseFilterState(normalizedCategory, normalizedType);


        setBrowseTitle(formatBrowseTitle(normalizedCategory, normalizedType));

        // 3. 刷新题库列表
        // 如果是频率模式，setMode 已经处理了刷新，不需要再次调用 loadExamList
        // 只有在默认模式下才显式调用
        if (!filterMode) {
            loadExamList();
        }

        // 若未在浏览视图，则尽力切换
        if (typeof window.showView === 'function' && !document.getElementById('browse-view')?.classList.contains('active')) {
            window.showView('browse', false);
        }
    } catch (e) {
        console.warn('[Browse] 应用筛选失败，回退到默认列表:', e);
        setBrowseFilterState('all', 'all');
        if (window.browseController && typeof window.browseController.resetToDefault === 'function') {
            window.browseController.resetToDefault();
        }
        // 避免在错误处理中再次同步调用可能导致错误的 loadExamList，使用 setTimeout 打断调用栈
        setTimeout(() => {
            try { loadExamList(); } catch (_) { }
        }, 0);
    }
}

// Initialize browse view when it's activated
function initializeBrowseView() {
    console.log('[System] Initializing browse view...');
    startPracticeRecordsSyncInBackground('browse-view');

    // 初始化 browseController
    if (window.browseController && !window.browseController.buttonContainer) {
        window.browseController.initialize('type-filter-buttons');
    }

    const persisted = getPersistedBrowseFilter();
    if (persisted) {
        setBrowseFilterState(persisted.category, persisted.type);
        setBrowseTitle(formatBrowseTitle(persisted.category, persisted.type));
    } else {
        setBrowseFilterState('all', 'all');
        setBrowseTitle(formatBrowseTitle('all', 'all'));
    }

    ensurePracticeRecordsSync('browse-view').then(() => {
        refreshBrowseProgressFromRecords();
    });
    loadExamList();
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
    updatePracticeView();
}


function loadExamList() {
    if (window.__browseFilterMode && window.__browseFilterMode !== 'default' && window.browseController) {
        try {
            if (!window.browseController.buttonContainer) {
                window.browseController.initialize('type-filter-buttons');
            }
            if (window.browseController.currentMode !== window.__browseFilterMode) {
                window.browseController.setMode(window.__browseFilterMode);
            } else {
                const activeFilter = window.browseController.activeFilter || 'all';
                window.browseController.applyFilter(activeFilter);
            }
            return;
        } catch (error) {
            console.warn('[Browse] 频率模式刷新失败，回退到默认逻辑:', error);
        }
    }

    // 使用 Array.from() 创建副本，避免污染全局 examIndex
    const examIndexSnapshot = getExamIndexState();
    let examsToShow = Array.from(examIndexSnapshot);

    // 先过滤
    const activeExamType = getCurrentExamType();
    const activeCategory = getCurrentCategory();

    // 仅在频率模式下使用 basePath 过滤
    const isFrequencyMode = window.__browseFilterMode && window.__browseFilterMode !== 'default';
    const basePathFilter = isFrequencyMode && (typeof window.__browsePath === 'string' && window.__browsePath.trim())
        ? window.__browsePath.trim()
        : null;

    if (activeExamType !== 'all') {
        examsToShow = examsToShow.filter(exam => exam.type === activeExamType);
    }
    if (activeCategory !== 'all') {
        const filteredByCategory = examsToShow.filter(exam => exam.category === activeCategory);
        // 只有在有筛选结果或不是频率模式时才应用分类过滤
        if (filteredByCategory.length > 0 || !basePathFilter) {
            examsToShow = filteredByCategory;
        }
    }
    // 只有在频率模式下才应用路径过滤
    if (basePathFilter) {
        examsToShow = examsToShow.filter((exam) => {
            return typeof exam?.path === 'string' && exam.path.includes(basePathFilter);
        });
    }

    // 然后置顶过滤后的数组
    if (activeCategory !== 'all' && activeExamType !== 'all') {
        const key = `${activeCategory}_${activeExamType}`;
        const preferred = preferredFirstExamByCategory[key];

        if (preferred) {
            // 优先通过 preferred.id 在过滤后的 examsToShow 中查找
            let preferredIndex = examsToShow.findIndex(exam => exam.id === preferred.id);

            // 如果失败，fallback 到 preferred.title + currentCategory + currentExamType 匹配
            if (preferredIndex === -1) {
                preferredIndex = examsToShow.findIndex(exam =>
                    exam.title === preferred.title &&
                    exam.category === activeCategory &&
                    exam.type === activeExamType
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

    const activeList = setFilteredExamsState(examsToShow);
    displayExams(activeList);
    handlePostExamListRender(activeList, { category: activeCategory, type: activeExamType });
    return activeList;
}

function resetBrowseViewToAll() {
    clearPendingBrowseAutoScroll();
    const currentCategory = getCurrentCategory();
    const currentType = getCurrentExamType();

    if (currentCategory === 'all' && currentType === 'all') {
        setBrowseTitle(formatBrowseTitle('all', 'all'));
        loadExamList();
        return;
    }

    setBrowseFilterState('all', 'all');
    setBrowseTitle(formatBrowseTitle('all', 'all'));
    loadExamList();
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
        const metaText = formatExamMetaText(exam);
        meta.textContent = metaText || `${exam.category || ''} | ${exam.type || ''}`;
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

const ABSOLUTE_URL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

function isAbsolutePath(value) {
    if (!value) {
        return false;
    }
    const normalized = String(value).trim();
    return ABSOLUTE_URL_RE.test(normalized)
        || WINDOWS_ABSOLUTE_RE.test(normalized)
        || normalized.startsWith('\\\\')
        || normalized.startsWith('//')
        || normalized.startsWith('/');
}

function ensureTrailingSlash(value) {
    if (!value) {
        return '';
    }
    return value.endsWith('/') ? value : value + '/';
}

function joinAbsoluteResource(base, file) {
    const basePart = base ? String(base).replace(/\\/g, '/') : '';
    const filePart = file ? String(file).replace(/\\/g, '/').replace(/^\/+/, '') : '';
    if (!basePart) {
        return encodeURI(filePart);
    }
    if (!filePart) {
        return encodeURI(basePart);
    }
    const baseWithSlash = basePart.endsWith('/') ? basePart : basePart + '/';
    return encodeURI(baseWithSlash + filePart);
}

function encodePathSegments(path) {
    if (!path) {
        return '';
    }

    const segments = String(path).split('/');
    return segments.map((segment) => {
        if (!segment) {
            return segment;
        }
        try {
            return encodeURIComponent(decodeURIComponent(segment));
        } catch (error) {
            return encodeURIComponent(segment);
        }
    }).join('/');
}

function resolveExamBasePath(exam) {
    const relativePath = exam && exam.path ? String(exam.path) : "";
    const normalizedRelative = relativePath.replace(/\\/g, '/').trim();
    if (normalizedRelative && isAbsolutePath(normalizedRelative)) {
        return ensureTrailingSlash(normalizedRelative);
    }

    let combined = normalizedRelative;
    try {
        const pathMap = getPathMap() || {};
        const type = exam && exam.type;
        const mapped = type && pathMap[type] ? pathMap[type] : {};
        const fallback = type && DEFAULT_PATH_MAP[type] ? DEFAULT_PATH_MAP[type] : {};
        const root = mergeRootWithFallback(mapped.root, fallback.root);
        const normalizedRoot = root.replace(/\\/g, '/');
        if (normalizedRoot) {
            if (normalizedRelative && normalizedRelative.startsWith(normalizedRoot)) {
                combined = normalizedRelative;
            } else {
                combined = normalizedRoot + normalizedRelative;
            }
        } else {
            combined = normalizedRelative;
        }

        const fallbackTopRoot = extractTopLevelRootSegment(fallback.root);
        if (fallbackTopRoot && !combined.replace(/\\/g, '/').startsWith(fallbackTopRoot)) {
            const normalizedCombined = combined.replace(/\\/g, '/').replace(/^\/+/, '');
            combined = fallbackTopRoot + normalizedCombined;
        }
    } catch (_) { }

    combined = combined.replace(/\\/g, '/');
    combined = combined.replace(/\/{2,}/g, '/');
    return ensureTrailingSlash(combined);
}

function extractTopLevelRootSegment(root) {
    if (!root) {
        return '';
    }
    const normalized = normalizePathRoot(root).replace(/^\/+/, '');
    const segments = normalized.split('/').filter(Boolean);
    if (!segments.length) {
        return '';
    }
    return segments[0] + '/';
}

// Path map definitions moved to LibraryManager; keep thin proxies for legacy callers
const RAW_DEFAULT_PATH_MAP = (getLibraryManager && getLibraryManager() && getLibraryManager().RAW_DEFAULT_PATH_MAP) || {
    reading: { root: '睡着过项目组/2. 所有文章(11.20)[192篇]/', exceptions: {} },
    listening: { root: 'ListeningPractice/', exceptions: {} }
};

function clonePathMap(map, fallback = RAW_DEFAULT_PATH_MAP) {
    const source = map && typeof map === 'object' ? map : fallback;
    const cloneCategory = (category) => {
        const segment = source[category] && typeof source[category] === 'object' ? source[category] : {};
        return {
            root: typeof segment.root === 'string' ? segment.root : '',
            exceptions: segment.exceptions && typeof segment.exceptions === 'object'
                ? Object.assign({}, segment.exceptions)
                : {}
        };
    };
    return {
        reading: cloneCategory('reading'),
        listening: cloneCategory('listening')
    };
}

function normalizePathRoot(value) {
    if (!value) {
        return '';
    }
    let root = String(value).replace(/\\/g, '/');
    root = root.replace(/\/+$/, '') + '/';
    if (root.startsWith('./')) {
        root = root.slice(2);
    }
    return root;
}

function mergeRootWithFallback(root, fallbackRoot) {
    const normalizedPrimary = normalizePathRoot(root || '');
    if (normalizedPrimary) {
        return normalizedPrimary;
    }
    return normalizePathRoot(fallbackRoot || '');
}

function buildOverridePathMap(metadata, fallback = RAW_DEFAULT_PATH_MAP) {
    const lm = getLibraryManager && getLibraryManager();
    if (lm && typeof lm.buildOverridePathMap === 'function') {
        return lm.buildOverridePathMap(metadata, fallback);
    }
    return fallback;
}

let DEFAULT_PATH_MAP = (getLibraryManager && getLibraryManager() && getLibraryManager().DEFAULT_PATH_MAP)
    || buildOverridePathMap(typeof window !== 'undefined' ? window.examIndexMetadata : null, RAW_DEFAULT_PATH_MAP);

const PATH_MAP_STORAGE_PREFIX = 'exam_path_map__';

function derivePathMapFromIndex(exams, fallbackMap = DEFAULT_PATH_MAP) {
    const manager = getLibraryManager && getLibraryManager();
    if (manager && typeof manager.derivePathMapFromIndex === 'function') {
        return manager.derivePathMapFromIndex(exams, fallbackMap);
    }
    return fallbackMap;
}

async function loadPathMapForConfiguration(key) {
    const manager = await ensureLibraryManagerReady();
    if (manager && typeof manager.loadPathMapForConfiguration === 'function') {
        return await manager.loadPathMapForConfiguration(key);
    }
    return DEFAULT_PATH_MAP;
}

function setActivePathMap(map) {
    const normalized = map || DEFAULT_PATH_MAP;
    window.__activeLibraryPathMap = normalized;
    window.pathMap = normalized;
}

async function savePathMapForConfiguration(key, examIndex, options = {}) {
    const manager = await ensureLibraryManagerReady();
    if (manager && typeof manager.savePathMapForConfiguration === 'function') {
        return await manager.savePathMapForConfiguration(key, examIndex, options);
    }
    if (options.setActive) {
        setActivePathMap(options.overrideMap || DEFAULT_PATH_MAP);
    }
    return null;
}

function getPathMap() {
    try {
        const manager = getLibraryManager && getLibraryManager();
        if (manager && typeof manager.getPathMap === 'function') {
            return manager.getPathMap();
        }
        if (window.__activeLibraryPathMap) {
            return window.__activeLibraryPathMap;
        }
        if (window.pathMap) {
            return window.pathMap;
        }
        return DEFAULT_PATH_MAP;
    } catch (error) {
        console.warn('[PathNormalization] Failed to load path map:', error);
        return DEFAULT_PATH_MAP;
    }
}

function normalizeThemeBasePrefix(prefix) {
    if (prefix == null) {
        return './';
    }
    const normalized = String(prefix)
        .trim()
        .replace(/\\/g, '/');
    if (!normalized || normalized === '.' || normalized === './') {
        return './';
    }
    return normalized.replace(/\/+$/g, '');
}

function stripQueryAndHash(url) {
    if (!url) {
        return '';
    }
    const withoutHash = String(url).split('#', 1)[0];
    return withoutHash.split('?', 1)[0];
}

function detectScriptBasePrefix() {
    if (typeof document === 'undefined') {
        return null;
    }

    try {
        const scripts = document.getElementsByTagName('script');
        const candidates = ['js/main.js', 'js/app.js', 'js/boot-fallbacks.js'];

        for (let i = scripts.length - 1; i >= 0; i -= 1) {
            const script = scripts[i];
            if (!script) {
                continue;
            }

            const rawSrc = stripQueryAndHash(script.getAttribute('src'));
            if (!rawSrc) {
                continue;
            }

            const normalized = rawSrc.replace(/\\/g, '/').trim();
            if (!normalized || /^(?:[a-z]+:)?\/\//i.test(normalized)) {
                continue;
            }

            for (const candidate of candidates) {
                const idx = normalized.lastIndexOf(candidate);
                if (idx === -1) {
                    continue;
                }

                const prefix = normalized.slice(0, idx);
                return prefix || './';
            }
        }
    } catch (error) {
        try {
            console.warn('[PathDetection] detectScriptBasePrefix failed:', error);
        } catch (_) { }
    }

    return null;
}

function resolveThemeBasePrefix() {
    const hint = normalizeThemeBasePrefix(typeof window !== 'undefined' ? window.HP_BASE_PREFIX : null);
    if (hint && hint !== './') {
        return hint;
    }

    const detected = normalizeThemeBasePrefix(detectScriptBasePrefix());
    if (detected && detected !== './') {
        try {
            window.HP_BASE_PREFIX = detected;
        } catch (_) { }
        return detected;
    }

    return hint || './';
}

function buildResourcePath(exam, kind = 'html') {
    const basePath = resolveExamBasePath(exam);
    const rawName = kind === 'pdf' ? exam.pdfFilename : exam.filename;
    const file = sanitizeFilename(rawName, kind);
    const prefix = resolveThemeBasePrefix();

    const normalizedFile = file ? String(file).replace(/\\/g, '/') : '';
    if (isAbsolutePath(normalizedFile)) {
        return joinAbsoluteResource(normalizedFile, '');
    }

    const normalizedBasePath = basePath ? String(basePath).replace(/\\/g, '/') : '';
    if (isAbsolutePath(normalizedBasePath)) {
        return joinAbsoluteResource(normalizedBasePath, normalizedFile);
    }

    const baseSegment = normalizedBasePath.replace(/^\.+\//, '').replace(/^\/+/, '');
    const normalizedBase = baseSegment && !baseSegment.endsWith('/') ? baseSegment + '/' : baseSegment;
    const relativePath = (normalizedBase || '') + normalizedFile;
    const encodedRelative = encodePathSegments(relativePath);

    if (prefix === './') {
        return encodedRelative ? './' + encodedRelative : './';
    }

    const trimmedPrefix = prefix ? prefix.replace(/\/+$/g, '') : '';
    return trimmedPrefix ? `${trimmedPrefix}/${encodedRelative}` : encodedRelative;
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
    const list = getExamIndexState();
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
                } catch (_) { }
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
    const list = getExamIndexState();
    const exam = list.find(e => e.id === examId);
    if (!exam || !exam.pdfFilename) return showMessage('未找到PDF文件', 'error');

    const fullPath = buildResourcePath(exam, 'pdf');
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

function updateSystemInfo() {
    const examIndexSnapshot = getExamIndexState();
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

// Other functions from the original file (simplified or kept as is)
async function getActiveLibraryConfigurationKey() {
    const manager = await ensureLibraryManagerReady();
    if (manager && typeof manager.getActiveLibraryConfigurationKey === 'function') {
        return await manager.getActiveLibraryConfigurationKey();
    }
    return await storage.get('active_exam_index_key', 'exam_index');
}
async function getLibraryConfigurations() {
    const manager = await ensureLibraryManagerReady();
    if (manager && typeof manager.getLibraryConfigurations === 'function') {
        return await manager.getLibraryConfigurations();
    }
    return await storage.get('exam_index_configurations', []);
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
function triggerFolderPicker() { document.getElementById('folder-picker').click(); }
function handleFolderSelection(event) { /* legacy stub - replaced by modal-specific inputs */ }

// --- Library Loader Modal and Index Management ---
// ... other utility and management functions can be moved here ...
// --- Functions Restored from Backup ---


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
        const currentFiltered = getFilteredExamsState();
        const baseList = currentFiltered.length ? currentFiltered : getExamIndexState();
        displayExams(baseList);
        return;
    }

    // 调试日志
    console.log('[Search] 执行搜索，查询词:', normalizedQuery);
    const activeList = getFilteredExamsState();
    console.log('[Search] 当前 filteredExams 数量:', activeList.length);

    const searchBase = activeList.length ? activeList : getExamIndexState();
    const searchResults = searchBase.filter(exam => {
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

async function toggleBulkDelete() {
    const nextMode = !getBulkDeleteModeState();
    setBulkDeleteModeState(nextMode);
    if (nextMode) {
        clearSelectedRecordsState();
        refreshBulkDeleteButton();
        if (typeof showMessage === 'function') {
            showMessage('批量管理模式已开启，点击记录进行选择', 'info');
        }
        updatePracticeView();
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
    updatePracticeView();
}

async function bulkDeleteRecords(selectedSnapshot = getSelectedRecordsState()) {
    const store = window.storage;
    if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
        console.error('[System] storage 管理器不可用，无法执行批量删除');
        showMessage('存储未就绪，暂时无法删除记录', 'error');
        return;
    }

    const normalizedIds = Array.from(selectedSnapshot, (id) => normalizeRecordId(id)).filter(Boolean);
    if (normalizedIds.length === 0) {
        showMessage('请选择要删除的记录', 'warning');
        return;
    }

    const records = await store.get('practice_records', []);
    const baseList = Array.isArray(records) ? records : [];
    const recordsToKeep = baseList.filter(record => !normalizedIds.includes(normalizeRecordId(record && record.id)));

    const deletedCount = baseList.length - recordsToKeep.length;

    await store.set('practice_records', recordsToKeep);
    setPracticeRecordsState(recordsToKeep);

    if (typeof syncPracticeRecords === 'function') {
        await syncPracticeRecords();
    }

    showMessage(`已删除 ${deletedCount} 条记录`, 'success');
    console.log(`[System] 批量删除了 ${deletedCount} 条练习记录`);
}

function toggleRecordSelection(recordId) {
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
        setPracticeRecordsState([]);
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
                try { localStorage.removeItem('exam_system_practice_records'); } catch (_) { }
            }
        } catch (e) { console.warn('[clearCache] failed to clear practice_records:', e); }

        try { localStorage.clear(); } catch (_) { }
        try { sessionStorage.clear(); } catch (_) { }

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
                name: key === 'exam_index' ? '默认题库' : key,
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

        if (!key && typeof record.name === 'string') {
            const nameKey = normalizeKey(record.name);
            if (/^exam_index(_\d+)?$/.test(nameKey)) {
                key = nameKey;
                record.key = key;
                mutated = true;
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
            record.name = key === 'exam_index' ? '默认题库' : key;
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
    let configs = Array.isArray(rawConfigs) ? rawConfigs : [];
    let mutated = false;

    const normalizedResult = normalizeLibraryConfigurationRecords(configs);
    configs = normalizedResult.normalized;
    mutated = normalizedResult.mutated;

    if (configs.length === 0) {
        try {
            const count = getExamIndexState().length;
            configs = [{
                name: '默认题库',
                key: 'exam_index',
                examCount: count,
                timestamp: Date.now()
            }];
            mutated = true;
            const activeKey = await storage.get('active_exam_index_key');
            if (!activeKey) {
                await storage.set('active_exam_index_key', 'exam_index');
            }
        } catch (error) {
            console.warn('[LibraryConfig] 无法初始化默认题库配置', error);
        }
    }

    if (mutated) {
        try {
            await storage.set('exam_index_configurations', configs);
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

async function debugCompareActiveIndexWithDefault() {
    try {
        const activeKey = await getActiveLibraryConfigurationKey();
        const activeIndex = Array.isArray(getExamIndexState()) ? getExamIndexState() : [];
        const defaultIndex = Array.isArray(window.completeExamIndex)
            ? window.completeExamIndex.map((exam) => Object.assign({}, exam, { type: 'reading' }))
            : [];
        const defaultListening = Array.isArray(window.listeningExamIndex) ? window.listeningExamIndex : [];
        const storedDefault = await storage.get('exam_index', []);
        const combinedDefault = storedDefault.length ? storedDefault : [...defaultIndex, ...defaultListening];

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
        const isActive = activeKey === config.key;
        const isDefault = config.key === 'exam_index';

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
    const key = typeof configKey === 'string' ? configKey.trim() : '';
    if (!key) {
        return;
    }
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
    if (key === 'exam_index') {
        showMessage('默认题库不可删除', 'warning');
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
    if (confirm('确定要删除这个题库配置吗？此操作不可恢复。')) {
        let configs = await getLibraryConfigurations();
        configs = Array.isArray(configs)
            ? configs.filter((config) => {
                if (!config) {
                    return false;
                }
                if (typeof config === 'string') {
                    return config.trim() !== key;
                }
                const cfgKey = typeof config.key === 'string' ? config.key.trim() : '';
                return cfgKey && cfgKey !== key;
            })
            : [];
        await storage.set('exam_index_configurations', configs);
        try {
            await storage.remove(key);
        } catch (error) {
            console.warn('[LibraryConfig] 删除题库数据失败', error);
        }

        showMessage('题库配置已删除', 'success');
        await renderLibraryConfigList({ silentEmpty: true });
    }
}

if (typeof window !== 'undefined') {
    window.switchLibraryConfig = switchLibraryConfig;
    window.deleteLibraryConfig = deleteLibraryConfig;
}


function showDeveloperTeam() {
    const modal = document.getElementById('developer-modal');
    if (modal) modal.classList.add('show');
}

function hideDeveloperTeam() {
    const modal = document.getElementById('developer-modal');
    if (modal) modal.classList.remove('show');
}

function startSuitePractice() {
    const appInstance = window.app;
    if (appInstance && typeof appInstance.startSuitePractice === 'function') {
        try {
            return appInstance.startSuitePractice();
        } catch (error) {
            console.error('[SuitePractice] 启动失败', error);
            if (typeof showMessage === 'function') {
                showMessage('套题模式启动失败，请稍后重试', 'error');
            }
            return;
        }
    }

    const fallbackNotice = '套题模式尚未初始化，请完成加载后再试。';
    if (typeof showMessage === 'function') {
        showMessage(fallbackNotice, 'warning');
    } else if (typeof alert === 'function') {
        alert(fallbackNotice);
    }
}

function openExamWithFallback(exam, delay = 600) {
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
            console.error('[QuickLane] 启动题目失败:', error);
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

function startRandomPractice(category, type = 'reading', filterMode = null, path = null) {
    const list = getExamIndexState();
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
            const typeLabel = normalizedType === 'listening'
                ? '听力'
                : (normalizedType === 'reading' ? '阅读' : '题库');
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

// 已迁移至 js/presentation/indexInteractions.js

if (typeof setupExamActionHandlers === 'function') {
    setupExamActionHandlers();
}
ensurePracticeSessionSyncListener();
