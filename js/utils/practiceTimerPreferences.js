(function initPracticeTimerPreferences(global) {
    'use strict';

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

    var cache = Object.create(null);
    var hydrationPromise = null;
    function normalizeScope(scope) { return String(scope || '').toLowerCase() === 'listening' ? 'listening' : 'reading'; }
    function hydrateTimerPreferences() {
        if (cache.reading && cache.listening) return Promise.resolve(true);
        if (hydrationPromise) return hydrationPromise;
        if (!global.AppData || !global.AppData.preferences) return Promise.resolve(false);
        hydrationPromise = Promise.resolve().then(async function loadTimerPreferences() {
            await global.AppData.ready;
            var stored = await global.AppData.preferences.getTimer();
            cache.reading = normalize(stored && stored.reading);
            cache.listening = normalize(stored && stored.listening);
            return true;
        }).catch(function onTimerPreferenceLoadError(error) {
            hydrationPromise = null;
            console.warn('[PracticeTimerPreferences] 加载失败:', error);
            return false;
        });
        return hydrationPromise;
    }

    function read(scope) {
        return normalize(cache[normalizeScope(scope)]);
    }

    async function save(scope, preferences) {
        await hydrateTimerPreferences();
        if (!global.AppData || !global.AppData.preferences) throw new Error('AppData.preferences is unavailable');
        var normalizedScope = normalizeScope(scope);
        var next = normalize(preferences);
        await global.AppData.preferences.setTimer(normalizedScope, next);
        cache[normalizedScope] = next;
        return next;
    }

    function minutesToSeconds(value) {
        return clampMinutes(value, DEFAULTS.countdownMinutes) * 60;
    }

    var api = {
        VERSION: VERSION,
        DEFAULTS: Object.freeze(Object.assign({}, DEFAULTS)),
        normalize: normalize,
        read: read,
        save: save,
        minutesToSeconds: minutesToSeconds
    };
    Object.defineProperty(api, 'ready', { enumerable: true, get: hydrateTimerPreferences });
    global.PracticeTimerPreferences = api;
})(typeof window !== 'undefined' ? window : globalThis);
