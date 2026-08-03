(function initPracticeTimerPreferences(global) {
    'use strict';

    var READING_KEY = 'ielts_reading_timer_preferences_v2';
    var LISTENING_KEY = 'ielts_listening_timer_preferences_v1';
    var VERSION = 1;
    var DEFAULTS = {
        version: VERSION,
        mode: 'elapsed',
        countdownMinutes: 60,
        limitEnabled: false,
        limitMinutes: 60,
        expiryAction: 'warn'
    };
    var VALID_MODES = { elapsed: true, countdown: true };
    var VALID_ACTIONS = { warn: true, 'auto-submit': true, lock: true };
    var MAX_MINUTES = 240;
    var MIN_MINUTES = 1;

    function clampMinutes(value, fallback) {
        var number = Number(value);
        if (!Number.isFinite(number)) {
            number = fallback;
        }
        return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(number)));
    }

    function normalize(raw) {
        var source = raw && typeof raw === 'object' ? raw : {};
        var mode = VALID_MODES[source.mode] ? source.mode : DEFAULTS.mode;
        var expiryAction = VALID_ACTIONS[source.expiryAction] ? source.expiryAction : DEFAULTS.expiryAction;
        return {
            version: VERSION,
            mode: mode,
            countdownMinutes: clampMinutes(source.countdownMinutes, DEFAULTS.countdownMinutes),
            limitEnabled: Boolean(source.limitEnabled),
            limitMinutes: clampMinutes(source.limitMinutes, DEFAULTS.limitMinutes),
            expiryAction: expiryAction
        };
    }

    function keyFor(scope) {
        return String(scope || '').toLowerCase() === 'listening' ? LISTENING_KEY : READING_KEY;
    }

    function read(scope) {
        try {
            var raw = global.localStorage && global.localStorage.getItem(keyFor(scope));
            return normalize(raw ? JSON.parse(raw) : null);
        } catch (_) {
            return normalize(null);
        }
    }

    function save(scope, preferences) {
        var next = normalize(preferences);
        try {
            if (global.localStorage) {
                global.localStorage.setItem(keyFor(scope), JSON.stringify(next));
            }
        } catch (_) { }
        return next;
    }

    function minutesToSeconds(value) {
        return clampMinutes(value, DEFAULTS.countdownMinutes) * 60;
    }

    global.PracticeTimerPreferences = {
        VERSION: VERSION,
        READING_KEY: READING_KEY,
        LISTENING_KEY: LISTENING_KEY,
        DEFAULTS: Object.freeze(Object.assign({}, DEFAULTS)),
        normalize: normalize,
        read: read,
        save: save,
        keyFor: keyFor,
        minutesToSeconds: minutesToSeconds
    };
})(typeof window !== 'undefined' ? window : globalThis);
