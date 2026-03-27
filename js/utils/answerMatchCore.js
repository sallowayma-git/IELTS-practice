(function initAnswerMatchCore(global) {
    'use strict';

    const BOOLEAN_SYNONYMS = new Map([
        ['true', 'true'],
        ['t', 'true'],
        ['yes', 'true'],
        ['y', 'true'],
        ['false', 'false'],
        ['f', 'false'],
        ['no', 'false'],
        ['n', 'false']
    ]);

    const NOT_GIVEN_SYNONYMS = new Map([
        ['ng', 'not given'],
        ['notgiven', 'not given'],
        ['not-given', 'not given']
    ]);

    function normalizeToken(value) {
        if (value == null) {
            return '';
        }
        const cleaned = String(value)
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .replace(/[‐‑‒–—]/g, '-')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^[\s"'`()[\]{}<>.,;:!?]+|[\s"'`()[\]{}<>.,;:!?]+$/g, '');
        if (!cleaned) {
            return '';
        }

        const lowered = cleaned.toLowerCase();
        if (BOOLEAN_SYNONYMS.has(lowered)) {
            return BOOLEAN_SYNONYMS.get(lowered);
        }
        if (NOT_GIVEN_SYNONYMS.has(lowered)) {
            return NOT_GIVEN_SYNONYMS.get(lowered);
        }
        if (/^[a-z]$/i.test(cleaned)) {
            return cleaned.toUpperCase();
        }
        const leadingOption = cleaned.match(/^([A-Za-z])(?:[.)])?\s+/);
        if (leadingOption && cleaned.length > 2) {
            return leadingOption[1].toUpperCase();
        }
        return cleaned;
    }

    function normalizeLooseToken(value) {
        return String(value == null ? '' : value)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
    }

    function splitAnswerTokens(value) {
        if (Array.isArray(value)) {
            return value
                .map((entry) => normalizeToken(entry))
                .filter(Boolean);
        }

        const raw = String(value == null ? '' : value)
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .replace(/[‐‑‒–—]/g, '-')
            .replace(/\s+/g, ' ')
            .trim();
        if (!raw) {
            return [];
        }

        if (/^[A-Za-z](?:\s*[,/;，、]\s*[A-Za-z])+$/.test(raw)) {
            return raw
                .split(/[,/;，、]/)
                .map((entry) => normalizeToken(entry))
                .filter(Boolean);
        }

        if (/^[A-Za-z](?:\s+[A-Za-z])+$/.test(raw)) {
            return raw
                .split(/\s+/)
                .map((entry) => normalizeToken(entry))
                .filter(Boolean);
        }

        const normalized = normalizeToken(raw);
        if (!normalized) {
            return [];
        }
        return [normalized];
    }

    function areTokensEquivalent(left, right) {
        const normalizedLeft = normalizeToken(left);
        const normalizedRight = normalizeToken(right);
        if (!normalizedLeft || !normalizedRight) {
            return false;
        }
        if (normalizedLeft === normalizedRight) {
            return true;
        }
        if (/^[A-Z]$/.test(normalizedLeft) || /^[A-Z]$/.test(normalizedRight)) {
            return false;
        }
        return normalizeLooseToken(normalizedLeft) === normalizeLooseToken(normalizedRight);
    }

    function compareTokenSets(leftValues, rightValues) {
        const left = Array.from(new Set((leftValues || []).map((entry) => normalizeToken(entry)).filter(Boolean)));
        const right = Array.from(new Set((rightValues || []).map((entry) => normalizeToken(entry)).filter(Boolean)));
        if (left.length !== right.length) {
            return false;
        }
        return left.every((leftItem) => right.some((rightItem) => areTokensEquivalent(leftItem, rightItem)));
    }

    function compareAnswers(userAnswer, correctAnswer) {
        const expected = splitAnswerTokens(correctAnswer);
        const actual = splitAnswerTokens(userAnswer);

        if (expected.length === 0 && actual.length === 0) {
            return null;
        }
        if (expected.length === 0 || actual.length === 0) {
            return false;
        }

        if (Array.isArray(correctAnswer)) {
            if (actual.length === 1) {
                return expected.some((token) => areTokensEquivalent(token, actual[0]));
            }
            return compareTokenSets(expected, actual);
        }

        if (expected.length > 1 || actual.length > 1) {
            return compareTokenSets(expected, actual);
        }
        return areTokensEquivalent(expected[0], actual[0]);
    }

    function ensureAnswerMatchCoreReady(options = {}) {
        const targetGlobal = options && options.global && typeof options.global === 'object'
            ? options.global
            : global;
        const timeoutMs = Number.isFinite(Number(options.timeoutMs))
            ? Math.max(0, Number(options.timeoutMs))
            : 4500;
        const pollMs = Number.isFinite(Number(options.pollMs))
            ? Math.max(10, Number(options.pollMs))
            : 40;

        return new Promise((resolve) => {
            const isReady = () => !!(
                targetGlobal
                && targetGlobal.AnswerMatchCore
                && typeof targetGlobal.AnswerMatchCore.compareAnswers === 'function'
            );
            if (isReady()) {
                resolve(true);
                return;
            }
            let settled = false;
            const finish = (ready) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearInterval(intervalId);
                clearTimeout(timeoutId);
                resolve(Boolean(ready));
            };
            const intervalId = setInterval(() => {
                if (isReady()) {
                    finish(true);
                }
            }, pollMs);
            const timeoutId = setTimeout(() => {
                finish(isReady());
            }, timeoutMs);
        });
    }

    const api = {
        normalizeToken,
        splitAnswerTokens,
        areTokensEquivalent,
        compareTokenSets,
        compareAnswers,
        ensureReady: ensureAnswerMatchCoreReady
    };

    global.AnswerMatchCore = api;
    global.ensureAnswerMatchCoreReady = ensureAnswerMatchCoreReady;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
