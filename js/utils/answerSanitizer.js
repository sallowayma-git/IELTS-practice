(function (global) {
    'use strict';

    var ANSWER_MAP_UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    var MAX_ANSWER_MAP_KEY_LENGTH = 160;
    var MAX_ANSWER_MAP_ENTRIES = 1000;
    var MAX_NORMALIZED_ANSWER_TEXT_LENGTH = 4000;
    var MAX_NORMALIZED_ANSWER_LIST_ITEMS = 200;

    function toStringSafe(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value);
    }

    function truncateAnswerText(value) {
        var text = String(value == null ? '' : value);
        if (text.length <= MAX_NORMALIZED_ANSWER_TEXT_LENGTH) {
            return text;
        }
        var truncated = text.slice(0, MAX_NORMALIZED_ANSWER_TEXT_LENGTH);
        if (/[\uD800-\uDBFF]$/.test(truncated)) {
            truncated = truncated.slice(0, -1);
        }
        return truncated;
    }

    function createSafeAnswerMap() {
        return Object.create(null);
    }

    function isUnsafeAnswerMapKey(key) {
        var text = String(key || '');
        return !text || text.length > MAX_ANSWER_MAP_KEY_LENGTH || ANSWER_MAP_UNSAFE_KEYS.has(text);
    }

    function normalizeFromObject(object) {
        if (!object || typeof object !== 'object') {
            return '';
        }
        const preferKeys = [
            'value',
            'answerValue',
            'key',
            'option',
            'heading',
            'word',
            'label',
            'answerLabel',
            'text',
            'answer',
            'content'
        ];
        for (var i = 0; i < preferKeys.length; i += 1) {
            var key = preferKeys[i];
            if (typeof object[key] === 'string' && object[key].trim()) {
                return object[key].trim();
            }
        }
        if (typeof object.innerText === 'string' && object.innerText.trim()) {
            return object.innerText.trim();
        }
        if (typeof object.textContent === 'string' && object.textContent.trim()) {
            return object.textContent.trim();
        }
        try {
            var serialized = JSON.stringify(object);
            if (serialized && serialized !== '{}' && serialized !== '[]') {
                return serialized;
            }
        } catch (_) {}
        return toStringSafe(object);
    }

    function normalizeValue(value) {
        if (value === null || value === undefined) {
            return '';
        }
        if (typeof value === 'string') {
            var trimmed = truncateAnswerText(value.trim());
            if (/^\[object\s/i.test(trimmed)) {
                return '';
            }
            return trimmed;
        }
        if (typeof value === 'boolean') {
            return value ? 'True' : 'False';
        }
        if (typeof value === 'number') {
            return truncateAnswerText(toStringSafe(value).trim());
        }
        if (Array.isArray(value)) {
            var normalizedArray = value
                .slice(0, MAX_NORMALIZED_ANSWER_LIST_ITEMS)
                .map(function (item) { return normalizeValue(item); })
                .filter(function (item) { return item !== null && item !== undefined && item !== ''; })
                .join(', ');
            return normalizedArray.trim();
        }
        return truncateAnswerText(normalizeFromObject(value).replace(/^\[object\s[^\]]+\]$/i, '').trim());
    }

    function hasMeaningfulValue(value) {
        var normalized = normalizeValue(value);
        if (!normalized) {
            return false;
        }
        var lowered = normalized.toLowerCase();
        if (lowered === 'n/a' || lowered === 'no answer' || lowered === '未作答' || lowered === '无' || lowered === 'none') {
            return false;
        }
        return true;
    }

    function normalizeValueList(value) {
        var values = Array.isArray(value) ? value.slice(0, MAX_NORMALIZED_ANSWER_LIST_ITEMS) : (value === null || value === undefined ? [] : [value]);
        var normalized = [];
        values.forEach(function (item) {
            var text = normalizeValue(item);
            if (!hasMeaningfulValue(text)) {
                return;
            }
            if (!normalized.some(function (existing) { return existing.toLowerCase() === text.toLowerCase(); })) {
                normalized.push(text);
            }
        });
        return normalized;
    }

    function sanitizeComparisonMap(comparisonMap) {
        if (!comparisonMap || typeof comparisonMap !== 'object') {
            return createSafeAnswerMap();
        }
        var sanitized = createSafeAnswerMap();
        Object.keys(comparisonMap).slice(0, MAX_ANSWER_MAP_ENTRIES).forEach(function (key) {
            if (isUnsafeAnswerMapKey(key)) {
                return;
            }
            var entry = comparisonMap[key];
            if (!entry || typeof entry !== 'object') {
                return;
            }
            var normalizedUser = normalizeValue(entry.userAnswer ?? entry.user ?? entry.answer);
            var normalizedCorrect = normalizeValue(entry.correctAnswer ?? entry.correct);
            var hasUser = hasMeaningfulValue(normalizedUser);
            var hasCorrect = hasMeaningfulValue(normalizedCorrect);
            if (!hasUser && !hasCorrect) {
                return;
            }
            sanitized[key] = {
                questionId: isUnsafeAnswerMapKey(entry.questionId) ? key : (entry.questionId || key),
                userAnswer: normalizedUser,
                correctAnswer: normalizedCorrect,
                isCorrect: typeof entry.isCorrect === 'boolean' ? entry.isCorrect : null
            };
            var acceptedAnswers = normalizeValueList(entry.acceptedAnswers);
            if (acceptedAnswers.length) {
                sanitized[key].acceptedAnswers = acceptedAnswers;
            }
            var canonicalAnswer = normalizeValue(entry.canonicalAnswer);
            if (hasMeaningfulValue(canonicalAnswer)) {
                sanitized[key].canonicalAnswer = canonicalAnswer;
            }
        });
        return sanitized;
    }

    var api = {
        normalizeValue: normalizeValue,
        hasMeaningfulValue: hasMeaningfulValue,
        normalizeValueList: normalizeValueList,
        sanitizeComparisonMap: sanitizeComparisonMap
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.AnswerSanitizer = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
