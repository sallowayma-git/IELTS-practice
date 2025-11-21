// Browse Preferences Utilities
// Extracted from main.js to fix dependency order issues

(function (global) {
    'use strict';

    const BROWSE_VIEW_PREFERENCE_KEY = 'browse_view_preferences_v2';
    let browsePreferencesCache = null;

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

    function persistBrowseFilter(category, type) {
        const normalizedCategory = normalizeCategoryKey(category);
        const normalizedType = normalizeExamType(type);
        saveBrowseViewPreferences({
            lastFilter: { category: normalizedCategory, type: normalizedType }
        });
    }

    function updateBrowseAnchorsFromRecords(records) {
        const list = Array.isArray(records) ? records : [];
        const examIndex = global.getExamIndexState ? global.getExamIndexState() : [];
        const updates = {};
        const seenKeys = new Set();

        list.forEach((record) => {
            const info = global.resolveRecordExamInfo ? global.resolveRecordExamInfo(record, examIndex) : null;
            if (!info) {
                return;
            }
            const key = buildBrowseFilterKey(info.category, info.type);
            const timestamp = global.deriveRecordTimestamp ? global.deriveRecordTimestamp(record) : Date.now();
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

    // Exports
    global.normalizeCategoryKey = normalizeCategoryKey;
    global.normalizeExamType = normalizeExamType;
    global.buildBrowseFilterKey = buildBrowseFilterKey;
    global.getBrowseViewPreferences = getBrowseViewPreferences;
    global.saveBrowseViewPreferences = saveBrowseViewPreferences;
    global.persistBrowseFilter = persistBrowseFilter;
    global.updateBrowseAnchorsFromRecords = updateBrowseAnchorsFromRecords;

})(typeof window !== "undefined" ? window : globalThis);
