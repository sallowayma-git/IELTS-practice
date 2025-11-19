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

const localFallbackState = {
    filteredExams: [],
    selectedRecords: new Set(),
    bulkDeleteMode: false
};

const stateService = (function resolveStateService() {
    if (window.appStateService && typeof window.appStateService.getExamIndex === 'function') {
        return window.appStateService;
    }
    if (window.AppStateService && typeof window.AppStateService.getInstance === 'function') {
        return window.AppStateService.getInstance({
            legacyAdapter: legacyStateAdapter,
            onBrowseFilterChange: syncGlobalBrowseState
        });
    }
    return null;
})();

const initialBrowseFilter = stateService
    ? stateService.getBrowseFilter()
    : (legacyStateAdapter ? legacyStateAdapter.getBrowseFilter() : { category: 'all', type: 'all' });

function getExamIndexState() {
    if (stateService) {
        return stateService.getExamIndex();
    }
    return Array.isArray(window.examIndex) ? window.examIndex : [];
}

function setExamIndexState(list) {
    const normalized = Array.isArray(list) ? list.slice() : [];
    assignExamSequenceNumbers(normalized);
    if (stateService) {
        return stateService.setExamIndex(normalized);
    }
    try { window.examIndex = normalized; } catch (_) {}
    return normalized;
}

function getPracticeRecordsState() {
    if (stateService) {
        return stateService.getPracticeRecords();
    }
    return Array.isArray(window.practiceRecords) ? window.practiceRecords : [];
}

function enrichPracticeRecordForUI(record) {
    if (!record || typeof record !== 'object') {
        return record;
    }
    if (typeof window !== 'undefined' && window.DataConsistencyManager) {
        try {
            const manager = new DataConsistencyManager();
            return manager.enrichRecordData(record);
        } catch (error) {
            console.warn('[PracticeRecords] enrichRecordData 失败，返回原始记录:', error);
        }
    }
    return record;
}

function setPracticeRecordsState(records) {
    let normalized;
    if (stateService) {
        const enriched = Array.isArray(records) ? records.map(enrichPracticeRecordForUI) : [];
        normalized = stateService.setPracticeRecords(enriched);
    } else {
        normalized = Array.isArray(records) ? records.map(enrichPracticeRecordForUI) : [];
        try { window.practiceRecords = normalized; } catch (_) {}
    }
    const finalRecords = Array.isArray(normalized) ? normalized : [];
    updateBrowseAnchorsFromRecords(finalRecords);
    return finalRecords;
}

function assignExamSequenceNumbers(exams) {
    if (!Array.isArray(exams)) {
        return exams;
    }
    exams.forEach((exam, index) => {
        if (!exam || typeof exam !== 'object') {
            return;
        }
        exam.sequenceNumber = index + 1;
    });
    return exams;
}

function formatExamMetaText(exam) {
    if (!exam || typeof exam !== 'object') {
        return '';
    }
    const parts = [];
    if (Number.isFinite(exam.sequenceNumber)) {
        parts.push(String(exam.sequenceNumber));
    }
    if (exam.category) {
        parts.push(exam.category);
    }
    if (exam.type) {
        parts.push(exam.type);
    }
    return parts.join(' | ');
}

try {
    if (typeof window !== 'undefined') {
        window.formatExamMetaText = formatExamMetaText;
    }
} catch (_) {}

function updateBrowseAnchorsFromRecords(records) {
    const list = Array.isArray(records) ? records : [];
    const examIndex = getExamIndexState();
    const updates = {};
    const seenKeys = new Set();

    list.forEach((record) => {
        const info = resolveRecordExamInfo(record, examIndex);
        if (!info) {
            return;
        }
        const key = buildBrowseFilterKey(info.category, info.type);
        const timestamp = deriveRecordTimestamp(record);
        if (!Number.isFinite(timestamp)) {
            return;
        }
        const anchor = {
            examId: info.examId || null,
            title: info.title || null,
            timestamp
        };
        const existing = updates[key];
        if (!existing || timestamp > existing.timestamp) {
            updates[key] = anchor;
        }
        seenKeys.add(key);
    });

    const currentAnchors = getBrowseViewPreferences().listAnchors || {};
    Object.keys(currentAnchors || {}).forEach((key) => {
        if (!seenKeys.has(key)) {
            updates[key] = null;
        }
    });

    if (Object.keys(updates).length === 0) {
        return;
    }

    saveBrowseViewPreferences({ listAnchors: updates });
}

function getFilteredExamsState() {
    if (stateService) {
        return stateService.getFilteredExams();
    }
    return localFallbackState.filteredExams.slice();
}

function setFilteredExamsState(exams) {
    if (stateService) {
        return stateService.setFilteredExams(exams);
    }
    localFallbackState.filteredExams = Array.isArray(exams) ? exams.slice() : [];
    return localFallbackState.filteredExams.slice();
}

function getBrowseFilterState() {
    if (stateService) {
        return stateService.getBrowseFilter();
    }
    const category = typeof window.__browseFilter?.category === 'string' ? window.__browseFilter.category : 'all';
    const type = typeof window.__browseFilter?.type === 'string' ? window.__browseFilter.type : 'all';
    return { category, type };
}

function setBrowseFilterState(category = 'all', type = 'all') {
    const normalized = {
        category: typeof category === 'string' ? category : 'all',
        type: typeof type === 'string' ? type : 'all'
    };
    if (stateService) {
        stateService.setBrowseFilter(normalized);
        const latest = stateService.getBrowseFilter();
        const nextCategory = typeof latest?.category === 'string' ? latest.category : normalized.category;
        const nextType = typeof latest?.type === 'string' ? latest.type : normalized.type;
        persistBrowseFilter(nextCategory, nextType);
        return { category: nextCategory, type: nextType };
    }
    syncGlobalBrowseState(normalized.category, normalized.type);
    persistBrowseFilter(normalized.category, normalized.type);
    return normalized;
}

function getCurrentCategory() {
    return getBrowseFilterState().category || 'all';
}

function getCurrentExamType() {
    return getBrowseFilterState().type || 'all';
}

function getBulkDeleteModeState() {
    if (stateService) {
        return stateService.getBulkDeleteMode();
    }
    return !!localFallbackState.bulkDeleteMode;
}

function setBulkDeleteModeState(value) {
    if (stateService) {
        return stateService.setBulkDeleteMode(value);
    }
    localFallbackState.bulkDeleteMode = !!value;
    return localFallbackState.bulkDeleteMode;
}

function clearBulkDeleteModeState() {
    return setBulkDeleteModeState(false);
}

function getSelectedRecordsState() {
    if (stateService) {
        return stateService.getSelectedRecords();
    }
    return new Set(localFallbackState.selectedRecords);
}

function addSelectedRecordState(id) {
    if (stateService) {
        return stateService.addSelectedRecord(id);
    }
    if (id != null) {
        localFallbackState.selectedRecords.add(String(id));
    }
    return getSelectedRecordsState();
}

function removeSelectedRecordState(id) {
    if (stateService) {
        return stateService.removeSelectedRecord(id);
    }
    if (id != null) {
        localFallbackState.selectedRecords.delete(String(id));
    }
    return getSelectedRecordsState();
}

function clearSelectedRecordsState() {
    if (stateService) {
        return stateService.clearSelectedRecords();
    }
    localFallbackState.selectedRecords.clear();
    return getSelectedRecordsState();
}




const BROWSE_VIEW_PREFERENCE_KEY = 'browse_view_preferences_v2';
let browsePreferencesCache = null;
let currentBrowseScrollElement = null;
let removeBrowseScrollListener = null;
let pendingBrowseAutoScroll = null;
let browsePreferenceUiInitialized = false;
let pendingBrowseScrollSnapshot = null;

function normalizeCategoryKey(category) {
    if (!category || typeof category !== 'string') {
        return 'all';
    }
    const trimmed = category.trim();
    if (!trimmed) {
        return 'all';
    }
    const match = trimmed.match(/^(P\d)$/i);
    if (match) {
        return match[1].toUpperCase();
    }
    const embedded = trimmed.match(/\b(P[1-4])\b/i);
    if (embedded) {
        return embedded[1].toUpperCase();
    }
    return trimmed;
}

function normalizeExamType(type) {
    if (!type || typeof type !== 'string') {
        return 'all';
    }
    const lower = type.toLowerCase();
    if (lower === 'reading' || lower === 'listening') {
        return lower;
    }
    if (lower.includes('阅读')) {
        return 'reading';
    }
    if (lower.includes('听力')) {
        return 'listening';
    }
    return 'all';
}

function buildBrowseFilterKey(category, type) {
    return `${normalizeCategoryKey(category)}|${normalizeExamType(type)}`;
}

function getDefaultBrowsePreferences() {
    return {
        scrollPositions: {},
        listAnchors: {},
        autoScrollEnabled: true,
        lastFilter: null
    };
}

function loadBrowsePreferencesFromStorage() {
    try {
        const raw = localStorage.getItem(BROWSE_VIEW_PREFERENCE_KEY);
        if (!raw) {
            return getDefaultBrowsePreferences();
        }
        const parsed = JSON.parse(raw);
        const defaults = getDefaultBrowsePreferences();
        const next = Object.assign({}, defaults, parsed || {});
        if (!next.scrollPositions || typeof next.scrollPositions !== 'object') {
            next.scrollPositions = {};
        }
        next.listAnchors = mergeBrowseAnchors({}, next.listAnchors);
        return next;
    } catch (error) {
        console.warn('[BrowsePreferences] 无法读取浏览偏好，使用默认值', error);
        return getDefaultBrowsePreferences();
    }
}

function getBrowseViewPreferences() {
    if (!browsePreferencesCache) {
        browsePreferencesCache = loadBrowsePreferencesFromStorage();
    }
    return browsePreferencesCache;
}

function saveBrowseViewPreferences(partial = {}) {
    const current = getBrowseViewPreferences();
    const next = {
        scrollPositions: Object.assign({}, current.scrollPositions, partial.scrollPositions || {}),
        listAnchors: mergeBrowseAnchors(current.listAnchors, partial.listAnchors),
        autoScrollEnabled: Object.prototype.hasOwnProperty.call(partial, 'autoScrollEnabled')
            ? !!partial.autoScrollEnabled
            : current.autoScrollEnabled,
        lastFilter: Object.prototype.hasOwnProperty.call(partial, 'lastFilter')
            ? (partial.lastFilter || null)
            : current.lastFilter
    };

    try {
        localStorage.setItem(BROWSE_VIEW_PREFERENCE_KEY, JSON.stringify(next));
        browsePreferencesCache = next;
    } catch (error) {
        console.warn('[BrowsePreferences] 保存浏览偏好失败', error);
        browsePreferencesCache = next;
    }
    return browsePreferencesCache;
}

function captureBrowseScrollSnapshot(category, type, scrollTop) {
    const normalizedCategory = normalizeCategoryKey(category);
    const normalizedType = normalizeExamType(type);
    const sanitizedScrollTop = Math.max(0, Math.round(scrollTop || 0));
    pendingBrowseScrollSnapshot = {
        category: normalizedCategory,
        type: normalizedType,
        scrollTop: sanitizedScrollTop
    };
    return pendingBrowseScrollSnapshot;
}

function persistBrowseScrollSnapshot(snapshot) {
    if (!snapshot) {
        return;
    }
    const key = buildBrowseFilterKey(snapshot.category, snapshot.type);
    saveBrowseViewPreferences({
        scrollPositions: { [key]: snapshot.scrollTop }
    });
}

function flushPendingBrowseScrollPosition() {
    persistBrowseScrollSnapshot(pendingBrowseScrollSnapshot);
}

function updateBrowsePreferenceIndicator(enabled) {
    const trigger = document.getElementById('browse-title-trigger');
    if (!trigger) {
        return;
    }
    const isEnabled = !!enabled;
    trigger.classList.toggle('active', isEnabled);
    trigger.setAttribute('aria-pressed', isEnabled ? 'true' : 'false');
}

function sanitizeScrollPositionMap(map) {
    if (!map || typeof map !== 'object') {
        return {};
    }
    const sanitized = {};
    for (const [key, value] of Object.entries(map)) {
        if (typeof key !== 'string' || !key) {
            continue;
        }
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric >= 0) {
            sanitized[key] = Math.round(numeric);
        }
    }
    return sanitized;
}

function mergeBrowseAnchors(currentAnchors = {}, updates) {
    const next = Object.assign({}, currentAnchors);
    if (!updates || typeof updates !== 'object') {
        return next;
    }

    for (const [key, value] of Object.entries(updates)) {
        if (typeof key !== 'string' || !key) {
            continue;
        }
        if (value === null) {
            delete next[key];
            continue;
        }
        if (!value || typeof value !== 'object') {
            continue;
        }

        const normalized = {};
        if (typeof value.examId === 'string' && value.examId.trim()) {
            normalized.examId = value.examId.trim();
        }
        if (typeof value.title === 'string' && value.title.trim()) {
            normalized.title = value.title.trim();
        }
        if (Number.isFinite(value.scrollTop) && value.scrollTop >= 0) {
            normalized.scrollTop = Math.round(value.scrollTop);
        }
        const ts = Number(value.timestamp);
        normalized.timestamp = Number.isFinite(ts) && ts > 0 ? Math.round(ts) : Date.now();

        if (!normalized.examId && !normalized.title && typeof normalized.scrollTop !== 'number') {
            delete next[key];
            continue;
        }

        next[key] = normalized;
    }

    return next;
}

function getBrowseListAnchor(category, type) {
    const prefs = getBrowseViewPreferences();
    const key = buildBrowseFilterKey(category, type);
    const anchor = prefs.listAnchors && prefs.listAnchors[key];
    if (!anchor || typeof anchor !== 'object') {
        return null;
    }
    const result = {};
    if (typeof anchor.examId === 'string' && anchor.examId.trim()) {
        result.examId = anchor.examId.trim();
    }
    if (typeof anchor.title === 'string' && anchor.title.trim()) {
        result.title = anchor.title.trim();
    }
    if (Number.isFinite(anchor.timestamp) && anchor.timestamp > 0) {
        result.timestamp = Math.round(anchor.timestamp);
    }
    if (!result.examId && !result.title) {
        return null;
    }
    return result;
}

function persistBrowseFilter(category, type) {
    const normalizedCategory = normalizeCategoryKey(category);
    const normalizedType = normalizeExamType(type);
    saveBrowseViewPreferences({
        lastFilter: { category: normalizedCategory, type: normalizedType }
    });
}

function getPersistedBrowseFilter() {
    const prefs = getBrowseViewPreferences();
    if (!prefs.lastFilter) {
        return null;
    }
    return {
        category: normalizeCategoryKey(prefs.lastFilter.category),
        type: normalizeExamType(prefs.lastFilter.type)
    };
}

function setBrowseTitle(text) {
    const titleEl = document.getElementById('browse-title');
    if (titleEl) {
        titleEl.textContent = text;
    }
}

if (typeof window !== 'undefined') {
    window.setBrowseTitle = setBrowseTitle;
}

function formatBrowseTitle(category = 'all', type = 'all') {
    const normalizedCategory = normalizeCategoryKey(category);
    const normalizedType = normalizeExamType(type);
    if (normalizedCategory === 'all' && normalizedType === 'all') {
        return '题库浏览';
    }

    const parts = [];
    if (normalizedCategory !== 'all') {
        parts.push(normalizedCategory);
    }
    if (normalizedType !== 'all') {
        parts.push(normalizedType === 'reading' ? '阅读' : '听力');
    }
    parts.push('题库浏览');
    return parts.join(' ');
}

function debounce(fn, wait) {
    let timer = null;
    return function debounced(...args) {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            fn.apply(this, args);
        }, wait);
    };
}

function recordBrowseScrollPosition(category, type, scrollTop) {
    const snapshot = captureBrowseScrollSnapshot(category, type, scrollTop);
    persistBrowseScrollSnapshot(snapshot);
}

function ensureBrowseScrollListener(scrollEl) {
    if (!scrollEl) {
        return;
    }
    if (currentBrowseScrollElement === scrollEl) {
        return;
    }
    if (typeof removeBrowseScrollListener === 'function') {
        removeBrowseScrollListener();
        removeBrowseScrollListener = null;
    }

    const persist = debounce(() => {
        flushPendingBrowseScrollPosition();
    }, 150);

    const handleScroll = () => {
        const category = getCurrentCategory();
        const type = getCurrentExamType();
        captureBrowseScrollSnapshot(category, type, scrollEl.scrollTop);
        persist();
    };

    const initialCategory = getCurrentCategory();
    const initialType = getCurrentExamType();
    captureBrowseScrollSnapshot(initialCategory, initialType, scrollEl.scrollTop);

    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    currentBrowseScrollElement = scrollEl;
    removeBrowseScrollListener = () => {
        try { scrollEl.removeEventListener('scroll', handleScroll); } catch (_) {}
        currentBrowseScrollElement = null;
        flushPendingBrowseScrollPosition();
    };
}

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushPendingBrowseScrollPosition);
    window.addEventListener('beforeunload', flushPendingBrowseScrollPosition);
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushPendingBrowseScrollPosition();
        }
    });
}

function requestBrowseAutoScroll(category, type, source = 'category-card') {
    pendingBrowseAutoScroll = {
        category: normalizeCategoryKey(category),
        type: normalizeExamType(type),
        source,
        timestamp: Date.now()
    };
}

function clearPendingBrowseAutoScroll() {
    pendingBrowseAutoScroll = null;
}

if (typeof window !== 'undefined') {
    window.clearPendingBrowseAutoScroll = clearPendingBrowseAutoScroll;
}

function consumeBrowseAutoScroll(category, type) {
    if (!pendingBrowseAutoScroll) {
        return null;
    }
    const now = Date.now();
    if (now - pendingBrowseAutoScroll.timestamp > 5000) {
        pendingBrowseAutoScroll = null;
        return null;
    }
    const normalizedCategory = normalizeCategoryKey(category);
    const normalizedType = normalizeExamType(type);
    const categoryMatch = pendingBrowseAutoScroll.category === normalizedCategory;
    const typeMatch = pendingBrowseAutoScroll.type === 'all'
        || pendingBrowseAutoScroll.type === normalizedType;
    if (categoryMatch && typeMatch) {
        const context = pendingBrowseAutoScroll;
        pendingBrowseAutoScroll = null;
        return context;
    }
    return null;
}

function escapeCssIdentifier(value) {
    if (typeof value !== 'string') {
        return '';
    }
    if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, '\$&');
}

function deriveRecordTimestamp(record) {
    if (!record || typeof record !== 'object') {
        return Number.NaN;
    }
    const candidates = [];
    if (record.date) candidates.push(record.date);
    if (record.endTime) candidates.push(record.endTime);
    if (record.completedAt) candidates.push(record.completedAt);
    if (record.timestamp) candidates.push(record.timestamp);
    if (record.startTime) candidates.push(record.startTime);
    const realData = record.realData || {};
    if (realData.completedAt) candidates.push(realData.completedAt);
    if (realData.endTime) candidates.push(realData.endTime);
    if (realData.date) candidates.push(realData.date);

    for (const value of candidates) {
        if (value == null) {
            continue;
        }
        if (typeof value === 'number') {
            if (Number.isFinite(value)) {
                return value;
            }
            continue;
        }
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    return Number.NaN;
}

function resolveRecordExamInfo(record, examIndex) {
    if (!record || typeof record !== 'object') {
        return null;
    }
    const examId = record.examId || record.id || null;
    let category = normalizeCategoryKey(record.category || record.examCategory);
    let type = normalizeExamType(record.type || record.examType);
    let title = record.title || record.examTitle || null;

    if (category === 'all' || !title || type === 'all') {
        const list = Array.isArray(examIndex) ? examIndex : [];
        let entry = null;
        if (examId) {
            entry = list.find((exam) => exam && exam.id === examId);
        }
        if (!entry && title) {
            entry = list.find((exam) => exam && exam.title === title);
        }
        if (entry) {
            if (category === 'all' && entry.category) {
                category = normalizeCategoryKey(entry.category);
            }
            if (type === 'all' && entry.type) {
                type = normalizeExamType(entry.type);
            }
            if (!title && entry.title) {
                title = entry.title;
            }
        }
    }

    if (!examId && !title) {
        return null;
    }

    return {
        examId,
        category,
        type,
        title: title || examId
    };
}

function findLastPracticeExamEntry(exams, category, type) {
    const normalizedCategory = normalizeCategoryKey(category);
    const normalizedType = normalizeExamType(type);
    const records = getPracticeRecordsState();
    if (!Array.isArray(records) || records.length === 0) {
        return null;
    }

    const examIndex = getExamIndexState();
    let latest = null;
    let latestTimestamp = Number.NEGATIVE_INFINITY;

    records.forEach((record) => {
        const info = resolveRecordExamInfo(record, examIndex);
        if (!info) {
            return;
        }
        if (normalizedCategory !== 'all' && info.category !== normalizedCategory) {
            return;
        }
        if (normalizedType !== 'all' && info.type !== normalizedType) {
            return;
        }
        const timestamp = deriveRecordTimestamp(record);
        if (!Number.isFinite(timestamp)) {
            return;
        }
        if (timestamp > latestTimestamp) {
            latestTimestamp = timestamp;
            latest = info;
        }
    });

    if (!latest) {
        return null;
    }

    const list = Array.isArray(exams) ? exams : [];
    const index = list.findIndex((exam) => {
        if (!exam) {
            return false;
        }
        if (latest.examId && exam.id === latest.examId) {
            return true;
        }
        if (latest.title && exam.title === latest.title) {
            return true;
        }
        return false;
    });

    if (index === -1) {
        return null;
    }

    return { index, exam: list[index] };
}

function findExamEntryByAnchor(exams, anchor) {
    if (!anchor || typeof anchor !== 'object') {
        return null;
    }
    const list = Array.isArray(exams) ? exams : [];
    let index = -1;
    if (anchor.examId) {
        index = list.findIndex((exam) => exam && exam.id === anchor.examId);
    }
    if (index === -1 && anchor.title) {
        index = list.findIndex((exam) => exam && exam.title === anchor.title);
    }
    if (index === -1) {
        return null;
    }
    return { index, exam: list[index] };
}

function scrollExamListToEntry(scrollEl, entry) {
    if (!scrollEl || !entry || entry.index == null || entry.index < 0) {
        return false;
    }
    const exam = entry.exam || {};
    let selector = null;
    if (exam.id) {
        selector = `[data-exam-id="${escapeCssIdentifier(exam.id)}"]`;
    }

    let element = selector ? scrollEl.querySelector(selector) : null;
    if (!element) {
        const items = scrollEl.querySelectorAll('.exam-item');
        element = Array.from(items).find((item) => {
            const titleNode = item.querySelector('h4');
            return titleNode && titleNode.textContent && exam.title && titleNode.textContent.trim() === exam.title.trim();
        }) || null;
    }

    if (!element) {
        return false;
    }

    const targetTop = element.offsetTop - (scrollEl.clientHeight / 2) + (element.offsetHeight / 2);
    scrollEl.scrollTop = Math.max(0, targetTop);
    return true;
}

function restoreBrowseScrollPosition(scrollEl, category, type) {
    const prefs = getBrowseViewPreferences();
    const key = buildBrowseFilterKey(category, type);
    const stored = prefs.scrollPositions[key];
    if (typeof stored === 'number' && stored >= 0) {
        scrollEl.scrollTop = stored;
        return true;
    }
    return false;
}

function handlePostExamListRender(exams, { category, type } = {}) {
    const scrollEl = document.querySelector('#exam-list-container .exam-list');
    if (!scrollEl) {
        return;
    }

    ensureBrowseScrollListener(scrollEl);

    const normalizedCategory = normalizeCategoryKey(category || getCurrentCategory());
    const normalizedType = normalizeExamType(type || getCurrentExamType());
    const autoScrollContext = consumeBrowseAutoScroll(normalizedCategory, normalizedType);
    const prefs = getBrowseViewPreferences();

    const applyScroll = () => {
        const performFallback = () => {
            if (!restoreBrowseScrollPosition(scrollEl, normalizedCategory, normalizedType)) {
                if (prefs.autoScrollEnabled) {
                    scrollEl.scrollTop = 0;
                }
            }
        };

        const attemptScrollToEntry = (entry, remaining, onFail) => {
            if (scrollExamListToEntry(scrollEl, entry)) {
                recordBrowseScrollPosition(normalizedCategory, normalizedType, scrollEl.scrollTop);
                return;
            }
            if (remaining > 0) {
                setTimeout(() => attemptScrollToEntry(entry, remaining - 1, onFail), 80);
                return;
            }
            if (typeof onFail === 'function') {
                onFail();
            }
        };

        if (prefs.autoScrollEnabled && normalizedCategory !== 'all') {
            const entry = findLastPracticeExamEntry(exams, normalizedCategory, normalizedType);
            if (entry) {
                const retries = autoScrollContext ? 7 : 4;
                attemptScrollToEntry(entry, retries, performFallback);
                return;
            }
            const anchor = getBrowseListAnchor(normalizedCategory, normalizedType);
            if (anchor) {
                const entryFromAnchor = findExamEntryByAnchor(exams, anchor);
                if (entryFromAnchor) {
                    attemptScrollToEntry(entryFromAnchor, 3, performFallback);
                    return;
                }
            }
        }

        performFallback();
    };

    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(applyScroll);
    } else {
        applyScroll();
    }
}

function setupBrowsePreferenceUI() {
    const trigger = document.getElementById('browse-title-trigger');
    const panel = document.getElementById('browse-preference-panel');
    const checkbox = document.getElementById('browse-remember-position');

    if (!trigger || !panel || !checkbox) {
        return;
    }

    const prefs = getBrowseViewPreferences();
    checkbox.checked = !!prefs.autoScrollEnabled;
    updateBrowsePreferenceIndicator(prefs.autoScrollEnabled);

    if (browsePreferenceUiInitialized) {
        return;
    }

    browsePreferenceUiInitialized = true;

    const closePanel = () => {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
    };

    const togglePanel = () => {
        const willOpen = panel.hidden;
        panel.hidden = !willOpen;
        trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    };

    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        togglePanel();
    });

    trigger.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            togglePanel();
        }
    });

    document.addEventListener('click', (event) => {
        if (panel.hidden) {
            return;
        }
        if (event.target === trigger || trigger.contains(event.target)) {
            return;
        }
        if (panel.contains(event.target)) {
            return;
        }
        closePanel();
    });

    checkbox.addEventListener('change', (event) => {
        const enabled = !!event.target.checked;
        const next = saveBrowseViewPreferences({ autoScrollEnabled: enabled });
        updateBrowsePreferenceIndicator(next.autoScrollEnabled);
        if (typeof showMessage === 'function') {
            const message = enabled ? '已开启列表位置记录，将自动恢复到上次答题的位置' : '已关闭列表位置记录';
            showMessage(message, 'info');
        }
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
    });
}

if (typeof window !== 'undefined') {
    window.handlePostExamListRender = handlePostExamListRender;
    window.requestBrowseAutoScroll = requestBrowseAutoScroll;
    window.setupBrowsePreferenceUI = setupBrowsePreferenceUI;
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
    try { showMessage('系统准备就绪', 'success'); } catch(_) {}

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
            try { localStorage.setItem('upgrade_v1_1_0_cleanup_done','1'); } catch(_) {}
        }
    } else {
        console.log('[System] 升级清理已完成，跳过重复清理');
    }

    // Load data and setup listeners
    await loadLibrary();
    await syncPracticeRecords(); // Load initial records and update UI
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
    setPracticeRecordsState(records);

    console.log(`[System] ${records.length} 条练习记录已加载到内存。`);
    updatePracticeView();
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
            const payload = extractCompletionPayload(data) || {};
            const sessionId = extractCompletionSessionId(data);
            const rec = sessionId ? fallbackExamSessions.get(sessionId) : null;
            const shouldNotify = shouldAnnounceCompletion(sessionId);
            if (rec) {
                console.log('[Fallback] 收到练习完成（降级路径），保存真实数据');
                savePracticeRecordFallback(rec.examId, payload).finally(() => {
                    try { if (rec && rec.timer) clearInterval(rec.timer); } catch(_) {}
                    try { fallbackExamSessions.delete(sessionId); } catch(_) {}
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
    } catch (_) {}
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
    const startTime = performance.now();
    const rawKey = await getActiveLibraryConfigurationKey();
    const activeConfigKey = typeof rawKey === 'string' && rawKey.trim()
        ? rawKey.trim()
        : 'exam_index';
    const isDefaultConfig = activeConfigKey === 'exam_index';

    let cachedData = null;
    try {
        if (!isDefaultConfig) {
            cachedData = await storage.get(activeConfigKey);
        } else {
            await storage.set('active_exam_index_key', 'exam_index');
        }
    } catch (error) {
        console.warn('[Library] 读取题库缓存失败:', error);
    }

    if (!forceReload && !isDefaultConfig && Array.isArray(cachedData) && cachedData.length > 0) {
        const updatedIndex = setExamIndexState(cachedData);
        try {
            await savePathMapForConfiguration(activeConfigKey, updatedIndex, { setActive: true });
        } catch (error) {
            console.warn('[Library] 应用路径映射失败:', error);
        }
        finishLibraryLoading(startTime);
        return;
    }

    if (!isDefaultConfig) {
        const normalized = Array.isArray(cachedData) ? cachedData : [];
        setExamIndexState(normalized);
        if (!normalized.length) {
            console.warn('[Library] 当前题库配置中没有找到可用数据');
            if (typeof showMessage === 'function') {
                showMessage('当前题库配置没有数据，请重新导入或切换至默认题库。', 'warning');
            }
        }
        finishLibraryLoading(startTime);
        return;
    }

    try {
        const readingExams = Array.isArray(window.completeExamIndex)
            ? window.completeExamIndex.map((exam) => Object.assign({}, exam, { type: 'reading' }))
            : [];
        const listeningExams = Array.isArray(window.listeningExamIndex)
            ? window.listeningExamIndex.map((exam) => Object.assign({}, exam, { type: 'listening' }))
            : [];

        if (!readingExams.length && !listeningExams.length) {
            setExamIndexState([]);
            console.warn('[Library] 未检测到默认题库脚本中的题源数据');
            finishLibraryLoading(startTime);
            return;
        }

        const combined = [...readingExams, ...listeningExams];
        assignExamSequenceNumbers(combined);
        const updatedIndex = setExamIndexState(combined);

        const metadata = {
            source: 'default-script',
            generatedAt: Date.now(),
            counts: {
                total: combined.length,
                reading: readingExams.length,
                listening: listeningExams.length
            },
            pathRoot: {
                reading: resolveScriptPathRoot('reading'),
                listening: resolveScriptPathRoot('listening')
            }
        };
        try { window.examIndexMetadata = metadata; } catch (_) {}

        const overrideMap = {
            reading: {
                root: metadata.pathRoot.reading,
                exceptions: {}
            },
            listening: {
                root: metadata.pathRoot.listening,
                exceptions: {}
            }
        };

        await storage.set('exam_index', updatedIndex);
        await saveLibraryConfiguration('默认题库', 'exam_index', updatedIndex.length);
        await setActiveLibraryConfiguration('exam_index');
        await savePathMapForConfiguration('exam_index', updatedIndex, { setActive: true, overrideMap });

        finishLibraryLoading(startTime);
    } catch (error) {
        console.error('[Library] 加载默认题库失败:', error);
        if (typeof showMessage === 'function') {
            showMessage('题库刷新失败: ' + (error?.message || error), 'error');
        }
        window.__forceLibraryRefreshInProgress = false;
        setExamIndexState([]);
        finishLibraryLoading(startTime);
    }
}

function resolveScriptPathRoot(type) {
    const defaultRoot = type === 'reading'
        ? '睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/'
        : 'ListeningPractice/';
    try {
        if (type === 'reading') {
            const rootMeta = window.completeExamIndex && window.completeExamIndex.pathRoot;
            if (typeof rootMeta === 'string' && rootMeta.trim()) {
                return rootMeta.trim();
            }
            if (rootMeta && typeof rootMeta === 'object' && typeof rootMeta.reading === 'string') {
                return rootMeta.reading.trim();
            }
        } else if (type === 'listening') {
            const listeningRoot = window.listeningExamIndex && window.listeningExamIndex.pathRoot;
            if (typeof listeningRoot === 'string' && listeningRoot.trim()) {
                return listeningRoot.trim();
            }
            const completeRoot = window.completeExamIndex && window.completeExamIndex.pathRoot;
            if (completeRoot && typeof completeRoot === 'object' && typeof completeRoot.listening === 'string') {
                return completeRoot.listening.trim();
            }
        }
    } catch (_) {}
    return defaultRoot;
}

function finishLibraryLoading(startTime) {
    const loadTime = performance.now() - startTime;
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

        if (!category) {
            return;
        }

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
        bulkDeleteMode: getBulkDeleteModeState(),
        selectedRecords: getSelectedRecordsState()
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
        window.DOM.delegate('click', '.practice-history-list [data-record-action="details"], #history-list [data-record-action="details"]', function(event) {
            handleDetails(this.dataset.recordId, event);
        });

        window.DOM.delegate('click', '.practice-history-list [data-record-action="delete"], #history-list [data-record-action="delete"]', function(event) {
            handleDelete(this.dataset.recordId, event);
        });

        window.DOM.delegate('click', '.practice-history-list .history-item, #history-list .history-item', function(event) {
            const actionTarget = event.target.closest('[data-record-action]');
            if (actionTarget) return;
            if (event.target && event.target.matches('input[data-record-id]')) {
                return;
            }
            handleSelection(this.dataset.recordId, event);
        });

        window.DOM.delegate('change', '.practice-history-list input[data-record-id], #history-list input[data-record-id]', function(event) {
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
            recordsToShow = recordsToShow.filter((record) => {
                const list = getExamIndexState();
                const exam = list.find((e) => e.id === record.examId || e.title === record.title);
                return exam && exam.type === examType;
            });
        }
    }

    // --- 4. Render history list ---
    const renderer = window.PracticeHistoryRenderer;
    if (!renderer) {
        console.warn('[PracticeHistory] Renderer 未加载，渲染空状态');
        renderPracticeHistoryEmptyState(historyContainer);
        refreshBulkDeleteButton();
        return;
    }

    renderer.destroyScroller(practiceListScroller);
    practiceListScroller = null;

    if (recordsToShow.length === 0) {
        renderPracticeHistoryEmptyState(historyContainer);
        refreshBulkDeleteButton();
        return;
    }

    practiceListScroller = renderer.renderList(historyContainer, recordsToShow, {
        bulkDeleteMode: getBulkDeleteModeState(),
        selectedRecords: getSelectedRecordsState(),
        scrollerOptions: { itemHeight: 100, containerHeight: 650 },
        itemFactory: renderPracticeRecordItem
    });
    refreshBulkDeleteButton();
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
            }
        } catch (syncError) {
            console.warn('[PracticeView] practiceSessionCompleted 事件处理失败:', syncError);
        } finally {
            // 仍然执行一次全面同步，确保 ScoreStorage/StorageRepo 状态一致
            setTimeout(() => {
                try { syncPracticeRecords(); } catch (_) {}
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
    setBrowseTitle(formatBrowseTitle('all', type));
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
        setBrowseFilterState(normalizedCategory, normalizedType);
        
        // 新增：如果有 filterMode，切换到对应的浏览模式
        if (filterMode && window.browseController) {
            try {
                window.__browseFilterMode = filterMode;
                window.__browsePath = path;
                window.browseController.setMode(filterMode);
            } catch (error) {
                console.warn('[Browse] 切换浏览模式失败:', error);
            }
        } else if (!filterMode && window.browseController) {
            // 没有 filterMode，重置为默认模式
            window.browseController.resetToDefault();
        }
        
        setBrowseTitle(formatBrowseTitle(normalizedCategory, normalizedType));

        // 若未在浏览视图，则尽力切换
        if (typeof window.showView === 'function' && !document.getElementById('browse-view')?.classList.contains('active')) {
            window.showView('browse', false);
        }

        // 如果是频率模式，不调用 loadExamList，让 browseController 处理
        if (!filterMode) {
            loadExamList();
        }
    } catch (e) {
        console.warn('[Browse] 应用筛选失败，回退到默认列表:', e);
        setBrowseFilterState('all', 'all');
        if (window.browseController) {
            window.browseController.resetToDefault();
        }
        loadExamList();
    }
}

// Initialize browse view when it's activated
function initializeBrowseView() {
    console.log('[System] Initializing browse view...');
    
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
    loadExamList();
}

// 全局桥接：HTML 按钮 onclick="browseCategory('P1','reading')"
if (typeof window.browseCategory !== 'function') {
    window.browseCategory = function(category, type, filterMode, path) {
        try {
            if (window.app && typeof window.app.browseCategory === 'function') {
                window.app.browseCategory(category, type, filterMode, path);
                return;
            }
        } catch (_) {}
        // 回退：直接应用筛选
        try { applyBrowseFilter(category, type); } catch (_) {}
    };
}

function filterRecordsByType(type) {
    setBrowseFilterState(getCurrentCategory(), type);
    updatePracticeView();
}


function loadExamList() {
    // 使用 Array.from() 创建副本，避免污染全局 examIndex
    const examIndexSnapshot = getExamIndexState();
    let examsToShow = Array.from(examIndexSnapshot);

    // 先过滤
    const activeExamType = getCurrentExamType();
    const activeCategory = getCurrentCategory();

    if (activeExamType !== 'all') {
        examsToShow = examsToShow.filter(exam => exam.type === activeExamType);
    }
    if (activeCategory !== 'all') {
        examsToShow = examsToShow.filter(exam => exam.category === activeCategory);
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
  } catch (_) {}

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

const RAW_DEFAULT_PATH_MAP = {
  reading: {
    root: '睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/',
    exceptions: {}
  },
  listening: {
    root: 'ListeningPractice/',
    exceptions: {}
  }
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
  const base = clonePathMap(fallback);
  if (!metadata || typeof metadata !== 'object') {
    return base;
  }

  const rootMeta = metadata.pathRoot;
  if (rootMeta && typeof rootMeta === 'object') {
    if (rootMeta.reading) {
      base.reading.root = normalizePathRoot(rootMeta.reading);
    }
    if (rootMeta.listening) {
      base.listening.root = normalizePathRoot(rootMeta.listening);
    }
  }

  return base;
}

const DEFAULT_PATH_MAP = buildOverridePathMap(
  typeof window !== 'undefined' ? window.examIndexMetadata : null,
  RAW_DEFAULT_PATH_MAP
);

const PATH_MAP_STORAGE_PREFIX = 'exam_path_map__';

function normalizePathMap(map, fallback = DEFAULT_PATH_MAP) {
  const base = clonePathMap(fallback);
  const incoming = clonePathMap(map);
  if (incoming.reading.root) {
    base.reading.root = normalizePathRoot(incoming.reading.root);
  }
  if (incoming.listening.root) {
    base.listening.root = normalizePathRoot(incoming.listening.root);
  }
  if (Object.keys(incoming.reading.exceptions).length) {
    base.reading.exceptions = incoming.reading.exceptions;
  }
  if (Object.keys(incoming.listening.exceptions).length) {
    base.listening.exceptions = incoming.listening.exceptions;
  }
  return base;
}

function getPathMapStorageKey(key) {
  return PATH_MAP_STORAGE_PREFIX + key;
}

function computeCommonRoot(paths) {
  if (!paths || !paths.length) {
    return '';
  }
  const segmentsList = paths.map((rawPath) => {
    if (typeof rawPath !== 'string') {
      return [];
    }
    const normalized = rawPath.replace(/\\/g, '/').replace(/\/+$/g, '');
    return normalized ? normalized.split('/') : [];
  }).filter((segments) => segments.length);

  if (!segmentsList.length) {
    return '';
  }

  let prefix = segmentsList[0].slice();
  for (let i = 1; i < segmentsList.length; i += 1) {
    const segments = segmentsList[i];
    let j = 0;
    while (j < prefix.length && j < segments.length && prefix[j] === segments[j]) {
      j += 1;
    }
    if (j === 0) {
      return '';
    }
    prefix = prefix.slice(0, j);
  }

  return prefix.length ? prefix.join('/') + '/' : '';
}

function derivePathMapFromIndex(exams, fallbackMap = DEFAULT_PATH_MAP) {
  const fallback = normalizePathMap(fallbackMap);
  const result = clonePathMap(fallback);

  if (!Array.isArray(exams)) {
    return result;
  }

  const pathsByType = { reading: [], listening: [] };

  exams.forEach((exam) => {
    if (!exam || typeof exam.path !== 'string' || !exam.type) {
      return;
    }
    const normalized = exam.path.replace(/\\/g, '/');
    if (exam.type === 'reading') {
      pathsByType.reading.push(normalized);
    } else if (exam.type === 'listening') {
      pathsByType.listening.push(normalized);
    }
  });

  const readingRoot = computeCommonRoot(pathsByType.reading);
  if (pathsByType.reading.length && readingRoot) {
    result.reading.root = normalizePathRoot(readingRoot);
  }

  const listeningRoot = computeCommonRoot(pathsByType.listening);
  if (pathsByType.listening.length && listeningRoot) {
    result.listening.root = normalizePathRoot(listeningRoot);
  }

  return result;
}

async function loadPathMapForConfiguration(key) {
  if (!key) {
    return clonePathMap(DEFAULT_PATH_MAP);
  }
  try {
    const stored = await storage.get(getPathMapStorageKey(key));
    if (stored && typeof stored === 'object') {
      return normalizePathMap(stored);
    }
  } catch (error) {
    console.warn('[LibraryConfig] 读取路径映射失败:', error);
  }
  return clonePathMap(DEFAULT_PATH_MAP);
}

function setActivePathMap(map) {
  const normalized = normalizePathMap(map);
  window.__activeLibraryPathMap = normalized;
  window.pathMap = normalized;
}

async function savePathMapForConfiguration(key, examIndex, options = {}) {
  if (!key || !Array.isArray(examIndex)) {
    return null;
  }
  const fallback = options.fallbackMap || DEFAULT_PATH_MAP;
  const overrideMap = options.overrideMap;
  const derived = overrideMap ? normalizePathMap(overrideMap, fallback) : derivePathMapFromIndex(examIndex, fallback);
  try {
    await storage.set(getPathMapStorageKey(key), derived);
  } catch (error) {
    console.warn('[LibraryConfig] 写入路径映射失败:', error);
  }
  if (options.setActive) {
    setActivePathMap(derived);
  }
  return derived;
}

function getPathMap() {
  try {
    if (window.__activeLibraryPathMap) {
      return window.__activeLibraryPathMap;
    }
    if (window.pathMap) {
      return window.pathMap;
    }
    return DEFAULT_PATH_MAP;
  } catch (error) {
    console.warn('[PathNormalization] Failed to load path map:', error);
    return {};
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
        } catch (_) {}
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
        } catch (_) {}
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
    const list = getExamIndexState();
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
        const currentIndex = await storage.get(activeKey, getExamIndexState()) || [];

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
        assignExamSequenceNumbers(newIndex);

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
            const fallbackPathMap = await loadPathMapForConfiguration(targetKey);
            const derivedPathMap = derivePathMapFromIndex(newIndex, fallbackPathMap);
            await savePathMapForConfiguration(targetKey, newIndex, { overrideMap: derivedPathMap, setActive: true });
            await saveLibraryConfiguration(configName, targetKey, newIndex.length);
            await setActiveLibraryConfiguration(targetKey);
            try {
                await applyLibraryConfiguration(targetKey, newIndex, { skipConfigRefresh: false });
                showMessage('新的题库配置已创建并激活', 'success');
            } catch (applyError) {
                console.warn('[LibraryLoader] 自动应用新题库失败，回退为整页刷新', applyError);
                showMessage('新的题库已保存，正在刷新界面...', 'warning');
                setTimeout(() => { location.reload(); }, 500);
            }
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
            const fallbackPathMap = await loadPathMapForConfiguration(targetKey);
            const derivedPathMap = derivePathMapFromIndex(newIndex, fallbackPathMap);
            await savePathMapForConfiguration(targetKey, newIndex, { overrideMap: derivedPathMap, setActive: true });
            await saveLibraryConfiguration(configName, targetKey, newIndex.length);
            await setActiveLibraryConfiguration(targetKey);
            showMessage('新的题库配置已创建并激活；正在重新加载...', 'success');
            setTimeout(() => { location.reload(); }, 800);
            return;
        }

        // Save to the current active key（非默认配置下的增量更新）
        await storage.set(targetKey, newIndex);
        const targetPathFallback = await loadPathMapForConfiguration(targetKey);
        const incrementalPathMap = derivePathMapFromIndex(newIndex, targetPathFallback);
        await savePathMapForConfiguration(targetKey, newIndex, { overrideMap: incrementalPathMap, setActive: true });
        const incName = `${type === 'reading' ? '阅读' : '听力'}增量-${new Date().toLocaleString()}`;
        await saveLibraryConfiguration(incName, targetKey, newIndex.length);
        showMessage('索引已更新；正在刷新界面...', 'success');
        setExamIndexState(newIndex);
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

/* Replaced by robust exporter below */
async function exportPracticeData() {
    try {
        const records = window.storage ? (await window.storage.get('practice_records', [])) : getPracticeRecordsState();
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
    if (!key) {
        return [];
    }
    try {
        const dataset = await storage.get(key);
        return Array.isArray(dataset) ? dataset : [];
    } catch (error) {
        console.warn('[LibraryConfig] 无法读取题库数据:', key, error);
        return [];
    }
}

async function updateLibraryConfigurationMetadata(key, examCount) {
    if (!key) {
        return;
    }
    try {
        let configs = await getLibraryConfigurations();
        if (!Array.isArray(configs)) {
            configs = [];
        }
        const now = Date.now();
        let mutated = false;

        const updatedConfigs = configs.map((entry) => {
            if (!entry) {
                return entry;
            }
            if (typeof entry === 'string') {
                const trimmed = entry.trim();
                if (trimmed === key) {
                    mutated = true;
                    return {
                        name: key === 'exam_index' ? '默认题库' : key,
                        key,
                        examCount,
                        timestamp: now
                    };
                }
                return entry;
            }
            if (entry && entry.key === key) {
                const next = Object.assign({}, entry);
                if (Number(next.examCount) !== examCount) {
                    next.examCount = examCount;
                }
                next.timestamp = now;
                mutated = true;
                return next;
            }
            return entry;
        });

        if (mutated) {
            const normalized = normalizeLibraryConfigurationRecords(updatedConfigs);
            await storage.set('exam_index_configurations', normalized.normalized);
        }
    } catch (error) {
        console.warn('[LibraryConfig] 无法刷新题库配置元数据', error);
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
    const exams = Array.isArray(dataset) ? dataset.slice() : await fetchLibraryDataset(key);
    if (!Array.isArray(exams) || exams.length === 0) {
        showMessage('目标题库没有题目，请先加载数据', 'warning');
        return false;
    }

    let pathMap = await loadPathMapForConfiguration(key);
    pathMap = derivePathMapFromIndex(exams, pathMap);
    setActivePathMap(pathMap);

    setExamIndexState(exams);
    resetBrowseStateAfterLibrarySwitch();

    try {
        await setActiveLibraryConfiguration(key);
    } catch (error) {
        console.warn('[LibraryConfig] 无法写入当前题库配置:', error);
    }

    await updateLibraryConfigurationMetadata(key, exams.length);
    await savePathMapForConfiguration(key, exams, {
        overrideMap: pathMap,
        setActive: true
    });

    try { updateSystemInfo(); } catch (error) { console.warn('[LibraryConfig] 更新系统信息失败', error); }
    try { updateOverview(); } catch (error) { console.warn('[LibraryConfig] 更新概览失败', error); }
    try { loadExamList(); } catch (error) { console.warn('[LibraryConfig] 刷新题库列表失败', error); }

    try {
        window.dispatchEvent(new CustomEvent('examIndexLoaded', {
            detail: { key }
        }));
    } catch (error) {
        console.warn('[LibraryConfig] 题库切换事件派发失败', error);
    }

    if (!options.skipConfigRefresh) {
        setTimeout(() => {
            try {
                renderLibraryConfigList({
                    allowDelete: true,
                    activeKey: key
                });
            } catch (error) {
                console.warn('[LibraryConfig] 重渲染题库配置列表失败', error);
            }
        }, 0);
    }

    return true;
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

function startRandomPractice(category, type = 'reading') {
    const list = getExamIndexState();
    const categoryExams = list.filter((exam) => exam.category === category && exam.type === type);
    if (categoryExams.length === 0) {
        if (typeof showMessage === 'function') {
            showMessage(`${category} ${type === 'reading' ? '阅读' : '听力'} 分类暂无可用题目`, 'error');
        }
        return;
    }

    const randomExam = categoryExams[Math.floor(Math.random() * categoryExams.length)];
    if (typeof showMessage === 'function') {
        showMessage(`随机选择: ${randomExam.title}`, 'info');
    }

    openExamWithFallback(randomExam);
}

function startListeningSprint() {
    const list = getExamIndexState();
    const listeningExams = list.filter((exam) => exam.type === 'listening');
    if (!listeningExams.length) {
        if (typeof showMessage === 'function') {
            showMessage('听力题库尚未加载', 'error');
        }
        return;
    }

    const selected = listeningExams[Math.floor(Math.random() * listeningExams.length)];
    if (typeof showMessage === 'function') {
        showMessage(`🎧 听力随机冲刺: ${selected.title}`, 'info');
    }

    openExamWithFallback(selected);
}

function startInstantLaunch() {
    const list = getExamIndexState();
    if (!list.length) {
        if (typeof showMessage === 'function') {
            showMessage('题库尚未加载', 'error');
        }
        return;
    }

    const htmlPreferred = list.filter((exam) => exam.hasHtml);
    const pool = htmlPreferred.length ? htmlPreferred : list;
    const selected = pool[Math.floor(Math.random() * pool.length)];

    if (typeof showMessage === 'function') {
        showMessage(`⚡ 即刻开局: ${selected.title}`, 'info');
    }

    openExamWithFallback(selected);
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
        var records = (window.storage && storage.get) ? (await storage.get('practice_records', [])) : getPracticeRecordsState();
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

const DEFAULT_VOCAB_SPARK_WORDS = [
    { word: 'meticulous', meaning: '一丝不苟的' },
    { word: 'resilient', meaning: '有韧性的' },
    { word: 'articulate', meaning: '善于表达的' },
    { word: 'pragmatic', meaning: '务实的' },
    { word: 'immerse', meaning: '沉浸' },
    { word: 'synthesize', meaning: '综合' },
    { word: 'discern', meaning: '辨别' },
    { word: 'alleviate', meaning: '缓解' },
    { word: 'coherent', meaning: '连贯的' },
    { word: 'scrutinize', meaning: '仔细审查' },
    { word: 'fortify', meaning: '强化' },
    { word: 'contemplate', meaning: '深思' },
    { word: 'mitigate', meaning: '减轻' },
    { word: 'propel', meaning: '推动' },
    { word: 'elaborate', meaning: '详尽阐述' },
    { word: 'culminate', meaning: '达到顶点' },
    { word: 'bolster', meaning: '支撑' },
    { word: 'artistry', meaning: '艺术技巧' },
    { word: 'vigilant', meaning: '警觉的' },
    { word: 'versatile', meaning: '多才多艺的' }
];

let vocabSparkLexicon = null;
let vocabSparkLoadingPromise = null;
let vocabSparkState = null;
let vocabSparkFallbackNoticeShown = false;
let vocabSparkInputBound = false;
let vocabSparkDeck = [];

function normalizeVocabEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    const word = typeof entry.word === 'string' ? entry.word.trim() : '';
    const meaning = typeof entry.meaning === 'string' ? entry.meaning.trim() : '';
    if (!word || !meaning) {
        return null;
    }
    return { word, meaning };
}

function ensureVocabSparkInputBindings() {
    if (vocabSparkInputBound) {
        return;
    }
    const input = document.getElementById('mini-game-answer');
    if (!input) {
        return;
    }
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            handleMiniGameNext('next');
        }
    });
    vocabSparkInputBound = true;
}

function clearVocabSparkRevealTimer() {
    if (vocabSparkState && vocabSparkState.revealTimer) {
        clearTimeout(vocabSparkState.revealTimer);
        vocabSparkState.revealTimer = null;
    }
}

function resetVocabSparkDeck() {
    vocabSparkDeck = [];
}

async function ensureVocabSparkLexicon() {
    if (Array.isArray(vocabSparkLexicon) && vocabSparkLexicon.length) {
        return vocabSparkLexicon.slice();
    }

    if (vocabSparkLoadingPromise) {
        return vocabSparkLoadingPromise.then((list) => list.slice());
    }

    const loader = async () => {
        try {
            const response = await fetch('assets/data/vocabulary.json', { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const payload = await response.json();
            const normalized = Array.isArray(payload)
                ? payload.map(normalizeVocabEntry).filter(Boolean)
                : [];

            if (!normalized.length) {
                throw new Error('词汇表为空');
            }

            vocabSparkLexicon = normalized;
            resetVocabSparkDeck();
            return vocabSparkLexicon.slice();
        } catch (error) {
            console.warn('[VocabSpark] 词汇表加载失败，使用内置词库:', error);
            vocabSparkLexicon = DEFAULT_VOCAB_SPARK_WORDS.map(normalizeVocabEntry).filter(Boolean);
            if (!vocabSparkLexicon.length) {
                throw error;
            }
            if (!vocabSparkFallbackNoticeShown && typeof showMessage === 'function') {
                showMessage('词汇表加载失败，已使用内置词库', 'warning');
                vocabSparkFallbackNoticeShown = true;
            }
            resetVocabSparkDeck();
            return vocabSparkLexicon.slice();
        }
    };

    vocabSparkLoadingPromise = loader().finally(() => {
        vocabSparkLoadingPromise = null;
    });

    return vocabSparkLoadingPromise.then((list) => list.slice());
}

function drawVocabSparkQueue(lexicon, desiredCount = 10) {
    if (!Array.isArray(lexicon) || !lexicon.length) {
        return [];
    }

    const total = Math.min(Math.max(1, desiredCount), lexicon.length);

    if (!Array.isArray(vocabSparkDeck)) {
        vocabSparkDeck = [];
    }

    const normalizeKey = (entry) => String(entry.word || '').toLowerCase();

    const ensureDeck = () => {
        const base = shuffleArray(lexicon);
        vocabSparkDeck = base.slice();
    };

    if (!vocabSparkDeck.length) {
        ensureDeck();
    }

    if (vocabSparkDeck.length < total) {
        const carry = vocabSparkDeck.slice();
        ensureDeck();

        if (carry.length) {
            const used = new Set(carry.map(normalizeKey));
            for (const entry of vocabSparkDeck) {
                const key = normalizeKey(entry);
                if (!used.has(key)) {
                    carry.push(entry);
                    used.add(key);
                }
                if (carry.length >= total) {
                    break;
                }
            }
            vocabSparkDeck = carry;
        }
    }

    if (vocabSparkDeck.length < total) {
        const filler = shuffleArray(lexicon);
        for (let i = 0; i < filler.length && vocabSparkDeck.length < total; i += 1) {
            vocabSparkDeck.push(filler[i]);
        }
    }

    const queue = vocabSparkDeck.splice(0, total).map((entry) => ({ ...entry }));
    return queue;
}

async function startVocabSparkGame() {
    const modal = document.getElementById('mini-game-modal');
    const questionEl = document.getElementById('mini-game-question');
    const feedbackEl = document.getElementById('mini-game-feedback');
    const progressEl = document.getElementById('mini-game-progress');
    const inputWrapper = document.getElementById('mini-game-input-wrapper');
    const answerInput = document.getElementById('mini-game-answer');
    const nextBtn = document.querySelector('.mini-game-next');

    if (!modal || !questionEl || !feedbackEl || !progressEl || !inputWrapper || !answerInput || !nextBtn) {
        if (typeof showMessage === 'function') {
            showMessage('小游戏容器缺失', 'error');
        }
        return;
    }

    ensureVocabSparkInputBindings();
    clearVocabSparkRevealTimer();

    modal.removeAttribute('hidden');
    modal.classList.add('active');

    questionEl.textContent = '词库加载中，请稍候...';
    questionEl.classList.remove('reveal');
    inputWrapper.classList.remove('hidden');
    answerInput.value = '';
    answerInput.disabled = true;
    answerInput.classList.remove('is-error');
    feedbackEl.textContent = '';
    progressEl.textContent = '';
    nextBtn.textContent = '下一题';
    nextBtn.disabled = true;
    nextBtn.dataset.gameAction = 'next';

    try {
        const lexicon = await ensureVocabSparkLexicon();
        if (!lexicon.length) {
            throw new Error('词汇表为空');
        }

        const queue = drawVocabSparkQueue(lexicon, 10);
        if (!queue.length) {
            throw new Error('词汇表为空');
        }

        vocabSparkState = {
            queue,
            total: queue.length,
            completed: 0,
            score: 0,
            current: null,
            phase: 'answering',
            revealTimer: null
        };

        renderVocabSparkQuestion(true);
    } catch (error) {
        console.error('[VocabSpark] 初始化失败:', error);
        if (typeof showMessage === 'function') {
            showMessage('词汇挑战初始化失败，请稍后重试', 'error');
        }
        closeMiniGame();
    }
}

function renderVocabSparkQuestion(initial = false) {
    if (!vocabSparkState || !Array.isArray(vocabSparkState.queue)) {
        return;
    }

    const questionEl = document.getElementById('mini-game-question');
    const feedbackEl = document.getElementById('mini-game-feedback');
    const progressEl = document.getElementById('mini-game-progress');
    const nextBtn = document.querySelector('.mini-game-next');
    const inputWrapper = document.getElementById('mini-game-input-wrapper');
    const answerInput = document.getElementById('mini-game-answer');

    if (!questionEl || !feedbackEl || !progressEl || !nextBtn || !inputWrapper || !answerInput) {
        return;
    }

    if (!vocabSparkState.queue.length) {
        renderVocabSparkSummary();
        return;
    }

    clearVocabSparkRevealTimer();

    vocabSparkState.current = vocabSparkState.queue[0];
    vocabSparkState.phase = 'answering';

    questionEl.textContent = vocabSparkState.current.meaning;
    questionEl.classList.remove('reveal');
    inputWrapper.classList.remove('hidden');
    answerInput.disabled = false;
    answerInput.value = '';
    answerInput.classList.remove('is-error');
    answerInput.focus();

    feedbackEl.textContent = initial
        ? '请根据中文释义输入英文单词'
        : '继续输入下一题的英文拼写';

    progressEl.textContent = `第 ${vocabSparkState.completed + 1} / ${vocabSparkState.total} 题`;
    nextBtn.textContent = '下一题';
    nextBtn.disabled = false;
    nextBtn.dataset.gameAction = 'next';
}

function renderVocabSparkSummary() {
    const questionEl = document.getElementById('mini-game-question');
    const feedbackEl = document.getElementById('mini-game-feedback');
    const progressEl = document.getElementById('mini-game-progress');
    const nextBtn = document.querySelector('.mini-game-next');
    const inputWrapper = document.getElementById('mini-game-input-wrapper');
    const answerInput = document.getElementById('mini-game-answer');

    if (!questionEl || !feedbackEl || !progressEl || !nextBtn || !inputWrapper || !answerInput || !vocabSparkState) {
        return;
    }

    clearVocabSparkRevealTimer();

    questionEl.textContent = '🎉 恭喜完成词汇火花挑战！';
    questionEl.classList.remove('reveal');
    inputWrapper.classList.add('hidden');
    answerInput.disabled = true;
    answerInput.value = '';
    answerInput.classList.remove('is-error');

    feedbackEl.textContent = `本轮共答对 ${vocabSparkState.score} / ${vocabSparkState.total} 题`;
    progressEl.textContent = '';
    nextBtn.textContent = '再来一局';
    nextBtn.disabled = false;
    nextBtn.dataset.gameAction = 'restart';
    vocabSparkState.phase = 'summary';
}

function evaluateVocabSparkAnswer() {
    if (!vocabSparkState || !vocabSparkState.current) {
        return;
    }

    const questionEl = document.getElementById('mini-game-question');
    const feedbackEl = document.getElementById('mini-game-feedback');
    const nextBtn = document.querySelector('.mini-game-next');
    const answerInput = document.getElementById('mini-game-answer');

    if (!questionEl || !feedbackEl || !nextBtn || !answerInput) {
        return;
    }

    const raw = answerInput.value || '';
    const normalized = raw.trim();
    if (!normalized) {
        feedbackEl.textContent = '请先输入与释义对应的英文单词。';
        answerInput.focus();
        return;
    }

    const expected = String(vocabSparkState.current.word || '').trim();
    if (normalized.toLowerCase() === expected.toLowerCase()) {
        vocabSparkState.queue.shift();
        vocabSparkState.completed += 1;
        vocabSparkState.score += 1;
        feedbackEl.textContent = '✅ 正确，继续下一题！';
        answerInput.value = '';
        answerInput.classList.remove('is-error');

        if (!vocabSparkState.queue.length) {
            renderVocabSparkSummary();
            return;
        }

        setTimeout(() => {
            renderVocabSparkQuestion();
        }, 360);
        return;
    }

    feedbackEl.textContent = `❌ 正确拼写：${expected}`;
    answerInput.classList.add('is-error');
    answerInput.disabled = true;
    nextBtn.disabled = true;
    questionEl.classList.add('reveal');
    questionEl.textContent = `正确拼写：${expected}`;
    vocabSparkState.phase = 'revealing';

    clearVocabSparkRevealTimer();
    vocabSparkState.revealTimer = setTimeout(() => {
        if (!vocabSparkState || vocabSparkState.phase === 'summary') {
            return;
        }

        questionEl.textContent = vocabSparkState.current.meaning;
        questionEl.classList.remove('reveal');
        answerInput.disabled = false;
        answerInput.value = '';
        answerInput.classList.remove('is-error');
        answerInput.focus();
        feedbackEl.textContent = '再试一次，把拼写牢记于心。';
        nextBtn.disabled = false;
        vocabSparkState.phase = 'answering';
    }, 3000);
}

function handleMiniGameNext(action) {
    if (action === 'restart') {
        startVocabSparkGame();
        return;
    }

    if (!vocabSparkState) {
        return;
    }

    if (vocabSparkState.phase === 'summary') {
        startVocabSparkGame();
        return;
    }

    if (vocabSparkState.phase === 'revealing') {
        return;
    }

    evaluateVocabSparkAnswer();
}

function closeMiniGame() {
    const modal = document.getElementById('mini-game-modal');
    if (!modal) {
        return;
    }

    clearVocabSparkRevealTimer();
    modal.classList.remove('active');
    modal.setAttribute('hidden', 'hidden');

    const questionEl = document.getElementById('mini-game-question');
    const feedbackEl = document.getElementById('mini-game-feedback');
    const progressEl = document.getElementById('mini-game-progress');
    const inputWrapper = document.getElementById('mini-game-input-wrapper');
    const answerInput = document.getElementById('mini-game-answer');

    if (questionEl) {
        questionEl.textContent = '准备好点燃词汇力了吗？';
        questionEl.classList.remove('reveal');
    }
    if (feedbackEl) {
        feedbackEl.textContent = '';
    }
    if (progressEl) {
        progressEl.textContent = '';
    }
    if (inputWrapper) {
        inputWrapper.classList.remove('hidden');
    }
    if (answerInput) {
        answerInput.value = '';
        answerInput.disabled = false;
        answerInput.classList.remove('is-error');
    }

    vocabSparkState = null;
}

function handleQuickLaneAction(target) {
    if (!target || !target.dataset) {
        return;
    }

    const action = target.dataset.laneAction;
    if (!action) {
        return;
    }

    switch (action) {
        case 'browse':
            {
                const laneCategory = target.dataset.laneCategory || 'all';
                const laneType = target.dataset.laneType || 'all';

                if (typeof browseCategory === 'function') {
                    browseCategory(laneCategory, laneType);
                    break;
                }

                if (window.app && typeof window.app.navigateToView === 'function') {
                    window.app.navigateToView('browse');
                } else if (typeof window.showView === 'function') {
                    window.showView('browse', false);
                }

                if (typeof applyBrowseFilter === 'function') {
                    applyBrowseFilter(laneCategory, laneType);
                } else if (laneType !== 'all' && typeof filterByType === 'function') {
                    setTimeout(() => filterByType(laneType), 0);
                }
            }
            break;
        case 'listening-sprint':
            startListeningSprint();
            break;
        case 'instant-start':
            startInstantLaunch();
            break;
        case 'sync-library':
            if (typeof loadLibrary === 'function') {
                loadLibrary();
            } else if (typeof showMessage === 'function') {
                showMessage('题库加载模块未就绪', 'error');
            }
            break;
        case 'vocab-spark':
            launchMiniGame('vocab-spark');
            break;
        default:
            break;
    }
}

function setupQuickLaneInteractions() {
    document.addEventListener('click', (event) => {
        const laneButton = event.target.closest('[data-lane-action]');
        if (laneButton) {
            event.preventDefault();
            handleQuickLaneAction(laneButton);
            return;
        }

        const laneTrigger = event.target.closest('[data-action="launch-mini-game"]');
        if (laneTrigger) {
            event.preventDefault();
            launchMiniGame(laneTrigger.dataset.game);
        }
    });

    const modal = document.getElementById('mini-game-modal');
    if (!modal) {
        return;
    }

    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeMiniGame();
            return;
        }

        const control = event.target.closest('[data-game-action]');
        if (control) {
            event.preventDefault();
            const action = control.dataset.gameAction;
            if (action === 'close') {
                closeMiniGame();
                return;
            }
            handleMiniGameNext(action);
        }
    });

    ensureVocabSparkInputBindings();
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

function shuffleArray(list) {
    const array = Array.isArray(list) ? list.slice() : [];
    for (let i = array.length - 1; i > 0; i -= 1) {
        const j = getSecureRandomInt(i + 1);
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function getSecureRandomInt(maxExclusive) {
    const max = typeof maxExclusive === 'number' && maxExclusive > 0 ? Math.floor(maxExclusive) : 0;
    if (!max) {
        return 0;
    }

    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const buffer = new Uint32Array(1);
        crypto.getRandomValues(buffer);
        return buffer[0] % max;
    }

    return Math.floor(Math.random() * max);
}

async function launchMiniGame(gameId) {
    if (gameId === 'vocab-spark') {
        await startVocabSparkGame();
        return;
    }

    if (typeof showMessage === 'function') {
        showMessage('小游戏即将上线，敬请期待', 'info');
    }
}

function initializeIndexInteractions() {
    setupIndexSettingsButtons();
    setupQuickLaneInteractions();
    setupMoreViewInteractions();
}

try { window.launchMiniGame = launchMiniGame; } catch (_) {}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeIndexInteractions);
} else {
    initializeIndexInteractions();
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
let moreViewInteractionsConfigured = false;

const analogClockState = {
    overlay: null,
    canvas: null,
    ctx: null,
    frameId: null,
    running: false,
    cssSize: 0,
    ratio: typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1
};

const CLOCK_VIEWS = ['analog', 'flip', 'digital', 'ambient'];

const clockUIState = {
    overlayInner: null,
    viewStack: null,
    dots: [],
    activeView: 'analog',
    hideControlsTimer: null,
    pointerHandlersBound: false,
    fullscreenBtn: null,
    fullscreenEventsBound: false
};

const flipClockState = {
    container: null,
    digits: [],
    timerId: null,
    initialized: false
};

const digitalClockState = {
    container: null,
    timerId: null,
    lastRendered: '',
    renderOptions: {
        colonClass: 'digital-pulse'
    }
};

const ambientClockState = {
    container: null,
    timerId: null,
    lastRendered: '',
    renderOptions: {
        colonClass: 'ambient-clock__colon'
    }
};

function setupMoreViewInteractions() {
    if (moreViewInteractionsConfigured) {
        return;
    }

    const moreView = document.getElementById('more-view');
    const overlay = document.getElementById('fullscreen-clock-overlay');
    const canvas = document.getElementById('analog-clock-canvas');

    if (!moreView || !overlay || !canvas) {
        return;
    }

    const clockTrigger = moreView.querySelector('[data-action="open-clock"]');
    const vocabTrigger = moreView.querySelector('[data-action="open-vocab"]');
    const closeTrigger = overlay.querySelector('[data-action="close-clock"]');
    const overlayInner = overlay.querySelector('[data-clock-role="overlay-inner"]');
    const viewStack = overlay.querySelector('[data-clock-role="view-stack"]');
    const pagination = overlay.querySelector('[data-clock-role="pagination"]');
    const flipContainer = overlay.querySelector('#flip-clock');
    const digitalContainer = overlay.querySelector('#digital-clock');
    const ambientContainer = overlay.querySelector('#ambient-clock');
    const dots = pagination ? Array.from(pagination.querySelectorAll('.clock-dot')) : [];
    const fullscreenTrigger = overlay.querySelector('[data-action="toggle-clock-fullscreen"]');

    analogClockState.overlay = overlay;
    analogClockState.canvas = canvas;
    analogClockState.ratio = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;

    clockUIState.overlayInner = overlayInner;
    clockUIState.viewStack = viewStack;
    clockUIState.dots = dots;
    clockUIState.activeView = 'analog';
    clockUIState.fullscreenBtn = fullscreenTrigger;
    updateClockFullscreenButtonState(isClockFullscreenActive());

    flipClockState.container = flipContainer;
    digitalClockState.container = digitalContainer;
    ambientClockState.container = ambientContainer;

    initializeFlipClock(flipContainer);

    if (clockTrigger) {
        clockTrigger.addEventListener('click', openClockOverlay);
    }

    if (closeTrigger) {
        closeTrigger.addEventListener('click', closeClockOverlay);
    }

    if (fullscreenTrigger) {
        fullscreenTrigger.addEventListener('click', handleClockFullscreenToggle);
    }

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closeClockOverlay();
        }
    });

    if (dots.length) {
        dots.forEach((dot) => {
            dot.addEventListener('click', () => handleClockPagination(dot.dataset.targetView));
            dot.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleClockPagination(dot.dataset.targetView);
                }
            });
        });
    }

    if (!clockUIState.pointerHandlersBound) {
        overlay.addEventListener('mousemove', handleClockPointerActivity, { passive: true });
        overlay.addEventListener('touchstart', handleClockPointerActivity, { passive: true });
        clockUIState.pointerHandlersBound = true;
    }

    bindClockFullscreenEvents();

    document.addEventListener('keydown', handleClockKeydown);
    window.addEventListener('resize', handleClockResize);

    if (vocabTrigger) {
        vocabTrigger.addEventListener('click', handleVocabEntry);
    }

    moreViewInteractionsConfigured = true;
}

function handleVocabEntry(event) {
    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    }
    const mountView = () => {
        if (window.VocabSessionView && typeof window.VocabSessionView.mount === 'function') {
            window.VocabSessionView.mount('#vocab-view');
        }
    };

    const vocabView = document.getElementById('vocab-view');
    if (vocabView) {
        vocabView.removeAttribute('hidden');
    }

    if (app && typeof app.navigateToView === 'function') {
        app.navigateToView('vocab');
        const moreNavBtn = document.querySelector('.nav-btn[data-view="more"]');
        if (moreNavBtn) {
            moreNavBtn.classList.add('active');
        }
        mountView();
        return;
    }

    const moreView = document.getElementById('more-view');
    if (vocabView && moreView) {
        moreView.classList.remove('active');
        vocabView.classList.add('active');
        const moreNavBtn = document.querySelector('.nav-btn[data-view="more"]');
        if (moreNavBtn) {
            moreNavBtn.classList.add('active');
        }
        mountView();
        return;
    }

    if (typeof window.showMessage === 'function') {
        window.showMessage('未能打开词汇视图，请检查页面结构。', 'warning');
    } else {
        window.alert('未能打开词汇视图，请检查页面结构。');
    }
}

function handleClockPagination(targetView) {
    if (!targetView) {
        return;
    }

    const normalized = String(targetView).toLowerCase();
    if (!CLOCK_VIEWS.includes(normalized)) {
        return;
    }

    setActiveClockView(normalized);
    showClockControlsTemporarily();
}

function handleClockPointerActivity() {
    if (!analogClockState.overlay || analogClockState.overlay.classList.contains('is-hidden')) {
        return;
    }
    showClockControlsTemporarily();
}

function showClockControlsTemporarily() {
    if (!clockUIState.overlayInner) {
        return;
    }

    clockUIState.overlayInner.classList.remove('controls-hidden');

    if (clockUIState.hideControlsTimer) {
        window.clearTimeout(clockUIState.hideControlsTimer);
    }

    clockUIState.hideControlsTimer = window.setTimeout(() => {
        if (analogClockState.overlay && !analogClockState.overlay.classList.contains('is-hidden')) {
            if (clockUIState.overlayInner) {
                clockUIState.overlayInner.classList.add('controls-hidden');
            }
        }
    }, 2400);
}

function hideClockControlsImmediately() {
    if (clockUIState.hideControlsTimer) {
        window.clearTimeout(clockUIState.hideControlsTimer);
        clockUIState.hideControlsTimer = null;
    }

    if (clockUIState.overlayInner) {
        clockUIState.overlayInner.classList.add('controls-hidden');
    }
}

function resetClockViewsToAnalog() {
    if (clockUIState.viewStack) {
        const panels = clockUIState.viewStack.querySelectorAll('.clock-view');
        panels.forEach((panel) => {
            if (panel.dataset.clockView === 'analog') {
                panel.classList.add('is-active');
            } else {
                panel.classList.remove('is-active');
            }
        });
    }

    if (clockUIState.dots.length) {
        clockUIState.dots.forEach((dot) => {
            if (dot.dataset.targetView === 'analog') {
                dot.classList.add('is-active');
            } else {
                dot.classList.remove('is-active');
            }
        });
    }

    clockUIState.activeView = 'analog';
}

function setActiveClockView(viewName, options = {}) {
    const normalized = viewName ? String(viewName).toLowerCase() : '';
    if (!CLOCK_VIEWS.includes(normalized)) {
        return;
    }

    const force = Boolean(options.force);
    if (!force && clockUIState.activeView === normalized) {
        return;
    }

    stopClockView(clockUIState.activeView);

    if (clockUIState.viewStack) {
        const panels = clockUIState.viewStack.querySelectorAll('.clock-view');
        panels.forEach((panel) => {
            if (panel.dataset.clockView === normalized) {
                panel.classList.add('is-active');
            } else {
                panel.classList.remove('is-active');
            }
        });
    }

    if (clockUIState.dots.length) {
        clockUIState.dots.forEach((dot) => {
            if (dot.dataset.targetView === normalized) {
                dot.classList.add('is-active');
            } else {
                dot.classList.remove('is-active');
            }
        });
    }

    clockUIState.activeView = normalized;
    startClockView(normalized);
}

function startClockView(viewName) {
    if (viewName === 'analog') {
        startAnalogClock();
        return;
    }

    if (viewName === 'flip') {
        startFlipClock();
        return;
    }

    if (viewName === 'digital') {
        startDigitalClock();
        return;
    }

    if (viewName === 'ambient') {
        startAmbientClock();
    }
}

function stopClockView(viewName) {
    if (viewName === 'analog') {
        stopAnalogClock();
        return;
    }

    if (viewName === 'flip') {
        stopFlipClock();
        return;
    }

    if (viewName === 'digital') {
        stopDigitalClock();
        return;
    }

    if (viewName === 'ambient') {
        stopAmbientClock();
    }
}

function initializeFlipClock(container) {
    if (!container || flipClockState.initialized) {
        return;
    }

    const template = [
        { type: 'digit', slot: 'hours-ten' },
        { type: 'digit', slot: 'hours-one' },
        { type: 'separator', label: ':' },
        { type: 'digit', slot: 'minutes-ten' },
        { type: 'digit', slot: 'minutes-one' },
        { type: 'separator', label: ':' },
        { type: 'digit', slot: 'seconds-ten' },
        { type: 'digit', slot: 'seconds-one' }
    ];

    container.innerHTML = '';

    const digits = [];

    template.forEach((item) => {
        if (item.type === 'separator') {
            const separator = document.createElement('span');
            separator.className = 'flip-separator';
            separator.textContent = item.label;
            separator.setAttribute('aria-hidden', 'true');
            container.appendChild(separator);
            return;
        }

        const digit = document.createElement('div');
        digit.className = 'flip-digit';
        digit.dataset.slot = item.slot;
        digit.dataset.currentValue = '0';
        digit.dataset.nextValue = '';
        digit.dataset.isRolling = 'false';
        digit.dataset.pendingValue = '';

        const current = document.createElement('span');
        current.className = 'digit-current';
        current.textContent = '0';

        const next = document.createElement('span');
        next.className = 'digit-next';
        next.textContent = '0';

        digit.appendChild(current);
        digit.appendChild(next);

        const record = { root: digit, current, next };
        digit.__clockDigit = record;

        bindRollingDigitAnimations(digit);
        container.appendChild(digit);
        digits.push(record);
    });

    flipClockState.container = container;
    flipClockState.digits = digits;
    flipClockState.initialized = true;
    renderFlipClock(true);
}

function bindRollingDigitAnimations(digitEl) {
    if (!digitEl || digitEl.dataset.animationBound === 'true') {
        return;
    }

    digitEl.addEventListener('animationend', (event) => {
        if (!digitEl.classList.contains('is-rolling')) {
            return;
        }

        if (!event.target.classList.contains('digit-next')) {
            return;
        }

        finalizeRollingDigit(digitEl);
    });

    digitEl.dataset.animationBound = 'true';
}

function finalizeRollingDigit(digitEl) {
    const record = digitEl.__clockDigit;
    if (!record) {
        return;
    }

    const committed = digitEl.dataset.nextValue || digitEl.dataset.currentValue || '0';
    digitEl.dataset.currentValue = committed;
    digitEl.dataset.nextValue = '';
    digitEl.dataset.isRolling = 'false';
    digitEl.classList.remove('is-rolling');

    record.current.textContent = committed;
    record.next.textContent = committed;

    const pending = digitEl.dataset.pendingValue;
    if (pending && pending !== committed) {
        digitEl.dataset.pendingValue = '';
        window.requestAnimationFrame(() => {
            rollDigitToValue(record, pending);
        });
    } else {
        digitEl.dataset.pendingValue = '';
    }
}

function startFlipClock() {
    if (!flipClockState.container) {
        return;
    }

    stopFlipClock();
    renderFlipClock(true);
    scheduleFlipClockTick();
}

function scheduleFlipClockTick() {
    const now = new Date();
    const delay = Math.max(50, 1000 - now.getMilliseconds());
    flipClockState.timerId = window.setTimeout(() => {
        renderFlipClock(false);
        scheduleFlipClockTick();
    }, delay);
}

function renderFlipClock(initialRender) {
    if (!flipClockState.container || !flipClockState.digits.length) {
        return;
    }

    const now = new Date();
    const hours = formatTwoDigits(now.getHours());
    const minutes = formatTwoDigits(now.getMinutes());
    const seconds = formatTwoDigits(now.getSeconds());
    const values = [
        hours.charAt(0),
        hours.charAt(1),
        minutes.charAt(0),
        minutes.charAt(1),
        seconds.charAt(0),
        seconds.charAt(1)
    ];

    flipClockState.digits.forEach((digitRecord, index) => {
        const nextValue = values[index] || '0';
        if (initialRender) {
            setRollingDigitImmediate(digitRecord, nextValue);
        } else {
            rollDigitToValue(digitRecord, nextValue);
        }
    });
}

function setRollingDigitImmediate(digitRecord, value) {
    if (!digitRecord || !digitRecord.root) {
        return;
    }

    const digitEl = digitRecord.root;
    digitEl.dataset.currentValue = value;
    digitEl.dataset.nextValue = '';
    digitEl.dataset.isRolling = 'false';
    digitEl.dataset.pendingValue = '';
    digitEl.classList.remove('is-rolling');

    if (digitRecord.current) {
        digitRecord.current.textContent = value;
    }

    if (digitRecord.next) {
        digitRecord.next.textContent = value;
    }
}

function rollDigitToValue(digitRecord, value) {
    if (!digitRecord || !digitRecord.root) {
        return;
    }

    const digitEl = digitRecord.root;
    const currentValue = digitEl.dataset.currentValue || '0';

    if (digitEl.dataset.isRolling === 'true') {
        digitEl.dataset.pendingValue = value;
        return;
    }

    if (currentValue === value) {
        return;
    }

    digitEl.dataset.pendingValue = '';
    digitEl.dataset.nextValue = value;
    digitEl.dataset.isRolling = 'true';

    if (digitRecord.current) {
        digitRecord.current.textContent = currentValue;
    }

    if (digitRecord.next) {
        digitRecord.next.textContent = value;
    }

    digitEl.classList.remove('is-rolling');
    void digitEl.offsetWidth;
    digitEl.classList.add('is-rolling');
}

function stopFlipClock() {
    if (flipClockState.timerId) {
        window.clearTimeout(flipClockState.timerId);
        flipClockState.timerId = null;
    }

    flipClockState.digits.forEach((digitRecord) => {
        if (!digitRecord || !digitRecord.root) {
            return;
        }
        const digitEl = digitRecord.root;
        digitEl.classList.remove('is-rolling');
        digitEl.dataset.isRolling = 'false';
        digitEl.dataset.nextValue = '';
        digitEl.dataset.pendingValue = '';
        const currentValue = digitEl.dataset.currentValue || '0';
        if (digitRecord.current) {
            digitRecord.current.textContent = currentValue;
        }
        if (digitRecord.next) {
            digitRecord.next.textContent = currentValue;
        }
    });
}

function startDigitalClock() {
    startSimpleDigitalClock(digitalClockState);
}

function stopDigitalClock() {
    stopSimpleDigitalClock(digitalClockState);
}

function startAmbientClock() {
    startSimpleDigitalClock(ambientClockState);
}

function stopAmbientClock() {
    stopSimpleDigitalClock(ambientClockState);
}

function startSimpleDigitalClock(state) {
    if (!state || !state.container) {
        return;
    }

    stopSimpleDigitalClock(state);
    renderSimpleDigitalClock(state);
    scheduleSimpleDigitalClockTick(state);
}

function scheduleSimpleDigitalClockTick(state) {
    if (!state) {
        return;
    }

    const now = new Date();
    const delay = Math.max(50, 1000 - now.getMilliseconds());
    state.timerId = window.setTimeout(() => {
        renderSimpleDigitalClock(state);
        scheduleSimpleDigitalClockTick(state);
    }, delay);
}

function renderSimpleDigitalClock(state) {
    if (!state || !state.container) {
        return;
    }

    const now = new Date();
    const hours = formatTwoDigits(now.getHours());
    const minutes = formatTwoDigits(now.getMinutes());
    const seconds = formatTwoDigits(now.getSeconds());
    const timeString = `${hours}:${minutes}:${seconds}`;

    if (state.lastRendered === timeString) {
        return;
    }

    state.lastRendered = timeString;
    const colonClass = state.renderOptions && state.renderOptions.colonClass ? state.renderOptions.colonClass : '';
    const colonMarkup = colonClass ? `<span class="${colonClass}">:</span>` : ':';
    state.container.innerHTML = `${hours}${colonMarkup}${minutes}${colonMarkup}${seconds}`;
}

function stopSimpleDigitalClock(state) {
    if (!state) {
        return;
    }

    if (state.timerId) {
        window.clearTimeout(state.timerId);
        state.timerId = null;
    }

    state.lastRendered = '';
}

function formatTwoDigits(value) {
    return String(value).padStart(2, '0');
}

function openClockOverlay(event) {
    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    }
    if (!analogClockState.overlay) {
        return;
    }

    analogClockState.overlay.classList.remove('is-hidden');
    document.body.classList.add('no-scroll');
    setActiveClockView('analog', { force: true });
    showClockControlsTemporarily();
    updateClockFullscreenButtonState(isClockFullscreenActive());
}

function closeClockOverlay() {
    if (!analogClockState.overlay) {
        return;
    }

    exitClockFullscreen();
    analogClockState.overlay.classList.add('is-hidden');
    document.body.classList.remove('no-scroll');
    stopAnalogClock();
    stopFlipClock();
    stopDigitalClock();
    stopAmbientClock();
    hideClockControlsImmediately();
    resetClockViewsToAnalog();
}

function handleClockKeydown(event) {
    if (!analogClockState.overlay || !event) {
        return;
    }

    if (event.key === 'Escape' && !analogClockState.overlay.classList.contains('is-hidden')) {
        event.preventDefault();
        closeClockOverlay();
    }
}

function handleClockResize() {
    if (!analogClockState.overlay || analogClockState.overlay.classList.contains('is-hidden')) {
        return;
    }

    if (clockUIState.activeView !== 'analog') {
        return;
    }

    resizeClockCanvas(false);
    drawAnalogClock();
}

function resizeClockCanvas(force) {
    if (!analogClockState.canvas) {
        return;
    }

    const ratio = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const viewportMin = Math.min(window.innerWidth || 0, window.innerHeight || 0) || 0;
    const targetSize = viewportMin || 600;
    const cssSize = viewportMin ? Math.round(targetSize) : 600;

    if (!force && analogClockState.cssSize === cssSize && analogClockState.ratio === ratio && analogClockState.ctx) {
        return;
    }

    analogClockState.cssSize = cssSize;
    analogClockState.ratio = ratio;

    const canvas = analogClockState.canvas;
    canvas.style.width = `${cssSize}px`;
    canvas.style.height = `${cssSize}px`;
    canvas.width = Math.floor(cssSize * ratio);
    canvas.height = Math.floor(cssSize * ratio);

    const context = canvas.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.scale(ratio, ratio);
    analogClockState.ctx = context;
}

function startAnalogClock() {
    resizeClockCanvas(true);

    if (analogClockState.running) {
        return;
    }

    analogClockState.running = true;

    const tick = () => {
        if (!analogClockState.running) {
            return;
        }
        drawAnalogClock();
        analogClockState.frameId = window.requestAnimationFrame(tick);
    };

    tick();
}

function stopAnalogClock() {
    analogClockState.running = false;
    if (analogClockState.frameId) {
        window.cancelAnimationFrame(analogClockState.frameId);
        analogClockState.frameId = null;
    }
}

function drawAnalogClock() {
    const ctx = analogClockState.ctx;
    const size = analogClockState.cssSize;

    if (!ctx || !size) {
        return;
    }

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);

    const radius = size / 2;
    renderClockDial(ctx, radius);
    renderClockTicks(ctx, radius);
    renderMinuteNumerals(ctx, radius);
    renderHourNumerals(ctx, radius);
    renderClockHands(ctx, radius);

    ctx.restore();
}

function renderClockDial(ctx, radius) {
    // 外框已取消，保留函数以维持调用结构
}

function renderClockTicks(ctx, radius) {
    const outerRadius = radius * 0.9;
    const majorInner = radius * 0.68;
    const minorInner = radius * 0.76;

    for (let i = 0; i < 60; i += 1) {
        const angle = (Math.PI / 30) * i;
        ctx.save();
        ctx.rotate(angle);
        ctx.beginPath();
        if (i % 5 === 0) {
            ctx.lineWidth = Math.max(4, radius * 0.013);
            ctx.strokeStyle = '#ffffff';
            ctx.moveTo(0, -outerRadius);
            ctx.lineTo(0, -majorInner);
        } else {
            ctx.lineWidth = Math.max(2, radius * 0.006);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
            ctx.moveTo(0, -outerRadius);
            ctx.lineTo(0, -minorInner);
        }
        ctx.stroke();
        ctx.restore();
    }
}

function renderMinuteNumerals(ctx, radius) {
    const fontSize = Math.max(14, radius * 0.078);
    ctx.font = `600 ${fontSize}px "Inter", "SF Pro Display", "Segoe UI", sans-serif`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let minute = 5; minute <= 60; minute += 5) {
        const label = minute === 60 ? '60' : String(minute);
        const angle = (Math.PI / 30) * (minute - 15);
        const radialOffset = radius * 0.96;
        const x = Math.cos(angle) * radialOffset;
        const y = Math.sin(angle) * radialOffset;
        ctx.fillText(label, x, y);
    }
}

function bindClockFullscreenEvents() {
    if (clockUIState.fullscreenEventsBound) {
        return;
    }

    const handler = handleClockFullscreenChange;
    const eventNames = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
    eventNames.forEach((eventName) => {
        if (typeof document.addEventListener === 'function') {
            document.addEventListener(eventName, handler);
        }
    });

    clockUIState.fullscreenEventsBound = true;
}

function handleClockFullscreenToggle(event) {
    if (event && typeof event.preventDefault === 'function') {
        event.preventDefault();
    }

    if (isClockFullscreenActive()) {
        exitClockFullscreen();
    } else {
        requestClockFullscreen();
    }
}

function handleClockFullscreenChange() {
    updateClockFullscreenButtonState(isClockFullscreenActive());
}

function requestClockFullscreen() {
    const overlay = analogClockState.overlay;
    if (!overlay) {
        return;
    }

    const request = overlay.requestFullscreen
        || overlay.webkitRequestFullscreen
        || overlay.mozRequestFullScreen
        || overlay.msRequestFullscreen;

    if (typeof request !== 'function') {
        return;
    }

    try {
        const result = request.call(overlay, { navigationUI: 'hide' });
        if (result && typeof result.catch === 'function') {
            result.catch(() => {});
        }
    } catch (error) {
        try {
            const fallback = request.call(overlay);
            if (fallback && typeof fallback.catch === 'function') {
                fallback.catch(() => {});
            }
        } catch (_) {
            // ignore unsupported fullscreen options
        }
    }
}

function exitClockFullscreen() {
    if (!isClockFullscreenActive()) {
        updateClockFullscreenButtonState(false);
        return;
    }

    const exit = document.exitFullscreen
        || document.webkitExitFullscreen
        || document.mozCancelFullScreen
        || document.msExitFullscreen;

    if (typeof exit !== 'function') {
        return;
    }

    try {
        const result = exit.call(document);
        if (result && typeof result.catch === 'function') {
            result.catch(() => {});
        }
    } catch (_) {
        // ignore errors from exiting fullscreen
    }
}

function updateClockFullscreenButtonState(active) {
    const button = clockUIState.fullscreenBtn;
    if (!button) {
        return;
    }

    const isActive = typeof active === 'boolean' ? active : isClockFullscreenActive();
    button.classList.toggle('is-fullscreen', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    button.setAttribute('aria-label', isActive ? '退出全屏模式' : '切换全屏模式');
}

function isClockFullscreenActive() {
    const element = getFullscreenElement();
    if (!element || !analogClockState.overlay) {
        return false;
    }

    return element === analogClockState.overlay || analogClockState.overlay.contains(element);
}

function getFullscreenElement() {
    return document.fullscreenElement
        || document.webkitFullscreenElement
        || document.mozFullScreenElement
        || document.msFullscreenElement
        || null;
}

function renderHourNumerals(ctx, radius) {
    const fontSize = Math.max(28, radius * 0.18);
    ctx.font = `700 ${fontSize}px "Inter", "SF Pro Display", "Segoe UI", sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let hour = 1; hour <= 12; hour += 1) {
        const angle = (Math.PI / 6) * (hour - 3);
        const x = Math.cos(angle) * (radius * 0.52);
        const y = Math.sin(angle) * (radius * 0.52);
        ctx.fillText(String(hour), x, y);
    }
}

function renderClockHands(ctx, radius) {
    const now = new Date();
    const milliseconds = now.getMilliseconds();
    const seconds = now.getSeconds() + milliseconds / 1000;
    const minutes = now.getMinutes() + seconds / 60;
    const hours = (now.getHours() % 12) + minutes / 60;

    drawClockHand(ctx, (Math.PI / 6) * hours, radius * 0.5, Math.max(10, radius * 0.04), '#7ddad3');
    drawClockHand(ctx, (Math.PI / 30) * minutes, radius * 0.72, Math.max(8, radius * 0.028), '#ffffff');
    drawSecondHand(ctx, (Math.PI / 30) * seconds, radius * 0.82, '#f5a623');

    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.arc(0, 0, Math.max(6, radius * 0.04), 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = '#f5a623';
    ctx.arc(0, 0, Math.max(3, radius * 0.022), 0, Math.PI * 2);
    ctx.fill();
}

function drawClockHand(ctx, angle, length, width, color) {
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.moveTo(0, length * 0.12);
    ctx.lineTo(0, -length);
    ctx.stroke();
    ctx.restore();
}

function drawSecondHand(ctx, angle, length, color) {
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, length * 0.02);
    ctx.lineCap = 'round';
    ctx.moveTo(0, length * 0.18);
    ctx.lineTo(0, -length);
    ctx.stroke();
    ctx.restore();
}

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
ensurePracticeSessionSyncListener();
