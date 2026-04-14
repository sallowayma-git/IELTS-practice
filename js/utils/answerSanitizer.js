(function (global) {
    'use strict';

    function toStringSafe(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value);
    }

    function normalizeFromObject(object) {
        if (!object || typeof object !== 'object') {
            return '';
        }
        const preferKeys = ['value', 'label', 'text', 'answer', 'content'];
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
            var trimmed = value.trim();
            if (/^\[object\s/i.test(trimmed)) {
                return '';
            }
            return trimmed;
        }
        if (typeof value === 'boolean') {
            return value ? 'True' : 'False';
        }
        if (typeof value === 'number') {
            return toStringSafe(value).trim();
        }
        if (Array.isArray(value)) {
            var normalizedArray = value
                .map(function (item) { return normalizeValue(item); })
                .filter(function (item) { return item; })
                .join(', ');
            return normalizedArray.trim();
        }
        return normalizeFromObject(value).replace(/^\[object\s[^\]]+\]$/i, '').trim();
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

    function sanitizeComparisonMap(comparisonMap) {
        if (!comparisonMap || typeof comparisonMap !== 'object') {
            return {};
        }
        var sanitized = {};
        Object.keys(comparisonMap).forEach(function (key) {
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
                questionId: entry.questionId || key,
                userAnswer: normalizedUser,
                correctAnswer: normalizedCorrect,
                isCorrect: typeof entry.isCorrect === 'boolean' ? entry.isCorrect : null
            };
        });
        return sanitized;
    }

    var api = {
        normalizeValue: normalizeValue,
        hasMeaningfulValue: hasMeaningfulValue,
        sanitizeComparisonMap: sanitizeComparisonMap
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.AnswerSanitizer = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
