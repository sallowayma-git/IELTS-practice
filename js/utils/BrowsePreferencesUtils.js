// Browse Preferences and View Management Utilities
// Extracted from main.js to modularize browse view logic

(function (global) {
    'use strict';

    const BROWSE_VIEW_PREFERENCE_KEY = 'browse_view_preferences_v2';
    const BROWSE_PREFERENCE_UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    const MAX_BROWSE_PREFERENCE_ENTRIES = 200;
    const MAX_BROWSE_PREFERENCE_KEY_LENGTH = 160;
    const MAX_BROWSE_PREFERENCE_TEXT_LENGTH = 300;
    const MAX_BROWSE_SCROLL_TOP = 10000000;
    let browsePreferencesCache = null;
    let currentBrowseScrollElement = null;
    let removeBrowseScrollListener = null;
    let pendingBrowseAutoScroll = null;
    let browsePreferenceUiInitialized = false;
    let pendingBrowseScrollSnapshot = null;

    // --- Helper Functions ---

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

    function escapeCssIdentifier(value) {
        if (typeof value !== 'string') {
            return '';
        }
        if (global.CSS && typeof global.CSS.escape === 'function') {
            return global.CSS.escape(value);
        }
        return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }

    // --- Normalization Functions ---

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
        // 处理 "Part 1", "Part 2" 等格式
        const partMatch = trimmed.match(/^Part\s+([1-4])$/i);
        if (partMatch) {
            return 'P' + partMatch[1];
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

    function createPreferenceMap() {
        return Object.create(null);
    }

    function isUnsafePreferenceKey(key) {
        return BROWSE_PREFERENCE_UNSAFE_KEYS.has(key);
    }

    function normalizePreferenceKey(key) {
        if (typeof key !== 'string') {
            return '';
        }
        const trimmed = key.trim();
        if (!trimmed || trimmed.length > MAX_BROWSE_PREFERENCE_KEY_LENGTH) {
            return '';
        }
        if (isUnsafePreferenceKey(trimmed) || /[\u0000-\u001F\u007F]/.test(trimmed)) {
            return '';
        }
        return trimmed;
    }

    function normalizePreferenceText(value) {
        if (typeof value !== 'string') {
            return '';
        }
        return value
            .replace(/[\u0000-\u001F\u007F]/g, ' ')
            .trim()
            .slice(0, MAX_BROWSE_PREFERENCE_TEXT_LENGTH);
    }

    function normalizeScrollTop(value) {
        const scrollTop = Number(value);
        if (!Number.isFinite(scrollTop) || scrollTop < 0) {
            return null;
        }
        return Math.min(MAX_BROWSE_SCROLL_TOP, Math.round(scrollTop));
    }

    function normalizeBrowseScrollPositions(value) {
        const next = createPreferenceMap();
        if (!value || typeof value !== 'object') {
            return next;
        }

        let copied = 0;
        for (const [rawKey, rawValue] of Object.entries(value)) {
            if (copied >= MAX_BROWSE_PREFERENCE_ENTRIES) {
                break;
            }
            const key = normalizePreferenceKey(rawKey);
            const scrollTop = normalizeScrollTop(rawValue);
            if (!key || scrollTop === null) {
                continue;
            }
            next[key] = scrollTop;
            copied += 1;
        }
        return next;
    }

    function mergeBrowseScrollPositions(currentPositions, updates) {
        const next = normalizeBrowseScrollPositions(currentPositions);
        const normalizedUpdates = normalizeBrowseScrollPositions(updates);
        let copied = Object.keys(next).length;
        for (const [key, value] of Object.entries(normalizedUpdates)) {
            if (!Object.prototype.hasOwnProperty.call(next, key) && copied >= MAX_BROWSE_PREFERENCE_ENTRIES) {
                break;
            }
            if (!Object.prototype.hasOwnProperty.call(next, key)) {
                copied += 1;
            }
            next[key] = value;
        }
        return next;
    }

    function normalizeBrowseLastFilter(value) {
        if (!value || typeof value !== 'object') {
            return null;
        }
        return {
            category: normalizeCategoryKey(value.category),
            type: normalizeExamType(value.type)
        };
    }

    // --- Preference Management ---

    function getDefaultBrowsePreferences() {
        return {
            scrollPositions: createPreferenceMap(),
            listAnchors: createPreferenceMap(),
            autoScrollEnabled: true,
            lastFilter: null
        };
    }

    function copyBrowseAnchorEntries(target, source, allowDelete) {
        if (!source || typeof source !== 'object') {
            return;
        }

        let copied = Object.keys(target).length;
        for (const [rawKey, value] of Object.entries(source)) {
            const key = normalizePreferenceKey(rawKey);
            if (!key) {
                continue;
            }
            if (value === null) {
                if (allowDelete) {
                    delete target[key];
                }
                continue;
            }
            if (!value || typeof value !== 'object') {
                continue;
            }

            const normalized = {};
            const examId = normalizePreferenceText(value.examId);
            const title = normalizePreferenceText(value.title);
            const scrollTop = normalizeScrollTop(value.scrollTop);
            if (examId) {
                normalized.examId = examId;
            }
            if (title) {
                normalized.title = title;
            }
            if (scrollTop !== null) {
                normalized.scrollTop = scrollTop;
            }
            const ts = Number(value.timestamp);
            normalized.timestamp = Number.isFinite(ts) && ts > 0 ? Math.round(ts) : Date.now();

            if (!normalized.examId && !normalized.title && typeof normalized.scrollTop !== 'number') {
                if (allowDelete) {
                    delete target[key];
                }
                continue;
            }

            if (!Object.prototype.hasOwnProperty.call(target, key) && copied >= MAX_BROWSE_PREFERENCE_ENTRIES) {
                continue;
            }
            if (!Object.prototype.hasOwnProperty.call(target, key)) {
                copied += 1;
            }
            target[key] = normalized;
        }
    }

    function mergeBrowseAnchors(currentAnchors = {}, updates) {
        const next = createPreferenceMap();
        copyBrowseAnchorEntries(next, currentAnchors, false);
        copyBrowseAnchorEntries(next, updates, true);
        return next;
    }

    function loadBrowsePreferencesFromStorage() {
        try {
            const raw = localStorage.getItem(BROWSE_VIEW_PREFERENCE_KEY);
            if (!raw) {
                return getDefaultBrowsePreferences();
            }
            const parsed = JSON.parse(raw);
            const defaults = getDefaultBrowsePreferences();
            const source = parsed && typeof parsed === 'object' ? parsed : {};
            return {
                scrollPositions: normalizeBrowseScrollPositions(source.scrollPositions),
                listAnchors: mergeBrowseAnchors(createPreferenceMap(), source.listAnchors),
                autoScrollEnabled: typeof source.autoScrollEnabled === 'boolean'
                    ? source.autoScrollEnabled
                    : defaults.autoScrollEnabled,
                lastFilter: normalizeBrowseLastFilter(source.lastFilter)
            };
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
            scrollPositions: mergeBrowseScrollPositions(current.scrollPositions, partial.scrollPositions),
            listAnchors: mergeBrowseAnchors(current.listAnchors, partial.listAnchors),
            autoScrollEnabled: Object.prototype.hasOwnProperty.call(partial, 'autoScrollEnabled')
                ? !!partial.autoScrollEnabled
                : current.autoScrollEnabled,
            lastFilter: Object.prototype.hasOwnProperty.call(partial, 'lastFilter')
                ? normalizeBrowseLastFilter(partial.lastFilter)
                : normalizeBrowseLastFilter(current.lastFilter)
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

    // --- Scroll Management ---

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

    function recordBrowseScrollPosition(category, type, scrollTop) {
        const snapshot = captureBrowseScrollSnapshot(category, type, scrollTop);
        persistBrowseScrollSnapshot(snapshot);
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
            const category = global.getCurrentCategory ? global.getCurrentCategory() : 'all';
            const type = global.getCurrentExamType ? global.getCurrentExamType() : 'all';
            captureBrowseScrollSnapshot(category, type, scrollEl.scrollTop);
            persist();
        };

        const initialCategory = global.getCurrentCategory ? global.getCurrentCategory() : 'all';
        const initialType = global.getCurrentExamType ? global.getCurrentExamType() : 'all';
        captureBrowseScrollSnapshot(initialCategory, initialType, scrollEl.scrollTop);

        scrollEl.addEventListener('scroll', handleScroll, { passive: true });
        currentBrowseScrollElement = scrollEl;
        removeBrowseScrollListener = () => {
            try { scrollEl.removeEventListener('scroll', handleScroll); } catch (_) { }
            currentBrowseScrollElement = null;
            flushPendingBrowseScrollPosition();
        };
    }

    // --- Auto Scroll Logic ---

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

    // --- Data Helpers ---

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
        const metadata = record.metadata || {};
        const examId = record.examId || metadata.examId || metadata.originalExamId || null;
        let category = normalizeCategoryKey(record.category || record.examCategory || metadata.category);
        let type = normalizeExamType(record.type || record.examType || metadata.examType);
        let title = record.title || record.examTitle || metadata.examTitle || metadata.title || null;

        if ((!category || category === 'all' || category === 'Unknown') && title) {
            const embedded = normalizeCategoryKey(title);
            if (embedded !== 'all') {
                category = embedded;
            }
        }

        if (type === 'all') {
            const sourceText = [
                record.type,
                record.examType,
                metadata.type,
                metadata.examType,
                record.source,
                metadata.source,
                record.practiceType,
                metadata.practiceType
            ].filter(Boolean).join(' ');
            const inferredType = normalizeExamType(sourceText);
            if (inferredType !== 'all') {
                type = inferredType;
            }
        }

        if (category === 'all' || category === 'Unknown' || !title || type === 'all') {
            const list = Array.isArray(examIndex) ? examIndex : [];
            let entry = null;
            if (examId) {
                entry = list.find((exam) => exam && exam.id === examId);
            }
            if (!entry && title) {
                entry = list.find((exam) => exam && exam.title === title);
            }
            if (entry) {
                if ((category === 'all' || category === 'Unknown') && entry.category) {
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
        const records = global.getPracticeRecordsState ? global.getPracticeRecordsState() : [];
        if (!Array.isArray(records) || records.length === 0) {
            return null;
        }

        const examIndex = global.getExamIndexState ? global.getExamIndexState() : [];
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

    // --- UI Logic ---

    function updateBrowsePreferenceIndicator(enabled) {
        const trigger = document.getElementById('browse-title-trigger');
        if (!trigger) {
            return;
        }
        const isEnabled = !!enabled;
        trigger.classList.toggle('active', isEnabled);
        trigger.setAttribute('aria-pressed', isEnabled ? 'true' : 'false');
        trigger.setAttribute('title', isEnabled ? '列表位置记录：已开启' : '列表位置记录：已关闭');
    }

    function setBrowseTitle(text) {
        const titleEl = document.getElementById('browse-title');
        if (titleEl) {
            titleEl.textContent = text;
        }
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
            if (panel) {
                panel.hidden = true;
            }
            trigger.setAttribute('aria-expanded', 'false');
        };

        const applyAutoScrollPreference = (enabled, showMessage = false) => {
            const next = saveBrowseViewPreferences({ autoScrollEnabled: !!enabled });
            checkbox.checked = !!next.autoScrollEnabled;
            updateBrowsePreferenceIndicator(next.autoScrollEnabled);
            if (showMessage && typeof global.showMessage === 'function') {
                const message = next.autoScrollEnabled
                    ? '已开启列表位置记录，将自动恢复到上次答题的位置'
                    : '已关闭列表位置记录';
                global.showMessage(message, 'info');
            }
            closePanel();
        };

        // 兼容原始交互：📚 按钮直接作为开关入口
        trigger.addEventListener('click', (event) => {
            event.preventDefault();
            applyAutoScrollPreference(!checkbox.checked, true);
        });

        trigger.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                applyAutoScrollPreference(!checkbox.checked, true);
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
            applyAutoScrollPreference(!!event.target.checked, true);
        });
    }

    function handlePostExamListRender(exams, { category, type } = {}) {
        const scrollEl = document.querySelector('#exam-list-container .exam-list');
        if (!scrollEl) {
            return;
        }

        ensureBrowseScrollListener(scrollEl);

        const normalizedCategory = normalizeCategoryKey(category || (global.getCurrentCategory ? global.getCurrentCategory() : 'all'));
        const normalizedType = normalizeExamType(type || (global.getCurrentExamType ? global.getCurrentExamType() : 'all'));
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

            if (prefs.autoScrollEnabled && (normalizedCategory !== 'all' || normalizedType !== 'all')) {
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

    function updateBrowseAnchorsFromRecords(records) {
        const list = Array.isArray(records) ? records : [];
        const examIndex = global.getExamIndexState ? global.getExamIndexState() : [];
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

    // --- Global Event Listeners ---

    if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', flushPendingBrowseScrollPosition);
        window.addEventListener('beforeunload', flushPendingBrowseScrollPosition);

        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') {
                    flushPendingBrowseScrollPosition();
                }
            });
        }
    }

    // --- Exports ---

    global.normalizeCategoryKey = normalizeCategoryKey;
    global.normalizeExamType = normalizeExamType;
    global.buildBrowseFilterKey = buildBrowseFilterKey;
    global.getBrowseViewPreferences = getBrowseViewPreferences;
    global.saveBrowseViewPreferences = saveBrowseViewPreferences;
    global.persistBrowseFilter = persistBrowseFilter;
    global.getPersistedBrowseFilter = getPersistedBrowseFilter;
    global.updateBrowseAnchorsFromRecords = updateBrowseAnchorsFromRecords;

    global.setBrowseTitle = setBrowseTitle;
    global.formatBrowseTitle = formatBrowseTitle;
    global.handlePostExamListRender = handlePostExamListRender;
    global.requestBrowseAutoScroll = requestBrowseAutoScroll;
    global.clearPendingBrowseAutoScroll = clearPendingBrowseAutoScroll;
    global.setupBrowsePreferenceUI = setupBrowsePreferenceUI;
    global.deriveRecordTimestamp = deriveRecordTimestamp;
    global.resolveRecordExamInfo = resolveRecordExamInfo;

})(typeof window !== "undefined" ? window : globalThis);
