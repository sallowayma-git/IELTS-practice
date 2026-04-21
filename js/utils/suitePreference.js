(function initSuitePreferenceUtils(global) {
    'use strict';

    const FLOW_MODE_STORAGE_KEY = 'suite_flow_mode';
    const FREQUENCY_SCOPE_STORAGE_KEY = 'suite_frequency_scope';
    const AUTO_ADVANCE_STORAGE_KEY = 'suite_auto_advance_after_submit';

    const FLOW_MODES = ['classic', 'simulation', 'stationary'];
    const FREQUENCY_SCOPES = ['high', 'high_medium', 'all', 'custom'];

    const FREQUENCY_ALIASES = new Map([
        ['high', 'high'],
        ['高频', 'high'],
        ['ultrahigh', 'high'],
        ['ultra-high', 'high'],
        ['超高频', 'high'],
        ['medium', 'medium'],
        ['mid', 'medium'],
        ['中频', 'medium'],
        ['veryhigh', 'medium'],
        ['very-high', 'medium'],
        ['次高频', 'medium'],
        ['low', 'low'],
        ['低频', 'low']
    ]);

    function ensurePracticeConfig() {
        if (!global.practiceConfig || typeof global.practiceConfig !== 'object') {
            global.practiceConfig = {};
        }
        if (!global.practiceConfig.suite || typeof global.practiceConfig.suite !== 'object') {
            global.practiceConfig.suite = {};
        }
        return global.practiceConfig;
    }

    function normalizeFlowMode(value) {
        const normalized = String(value == null ? '' : value).trim().toLowerCase();
        if (FLOW_MODES.includes(normalized)) {
            return normalized;
        }
        return '';
    }

    function normalizeFrequencyScope(value) {
        const normalized = String(value == null ? '' : value).trim().toLowerCase();
        if (!normalized) {
            return '';
        }
        if (normalized === 'high' || normalized === 'only_high') {
            return 'high';
        }
        if (
            normalized === 'high_medium'
            || normalized === 'high-medium'
            || normalized === 'highmedium'
            || normalized === 'high+medium'
        ) {
            return 'high_medium';
        }
        if (normalized === 'all' || normalized === 'default') {
            return 'all';
        }
        if (normalized === 'custom' || normalized === 'self_select' || normalized === 'self-select') {
            return 'custom';
        }
        if (normalized === '高频' || normalized === '仅高频') {
            return 'high';
        }
        if (normalized === '高频+次高频' || normalized === '高频次高频') {
            return 'high_medium';
        }
        if (normalized === '全部' || normalized === '全部频率') {
            return 'all';
        }
        return '';
    }

    function normalizeFrequency(value) {
        const raw = String(value == null ? '' : value).trim().toLowerCase();
        if (!raw) {
            return '';
        }
        const key = raw
            .replace(/\s+/g, '')
            .replace(/_/g, '-');
        return FREQUENCY_ALIASES.get(key) || '';
    }

    function isFrequencyIncluded(value, scope) {
        const normalizedScope = normalizeFrequencyScope(scope) || 'all';
        const normalizedFrequency = normalizeFrequency(value);
        if (!normalizedFrequency) {
            return true;
        }
        if (normalizedScope === 'high') {
            return normalizedFrequency === 'high';
        }
        if (normalizedScope === 'high_medium') {
            return normalizedFrequency === 'high' || normalizedFrequency === 'medium';
        }
        if (normalizedScope === 'custom') {
            return true;
        }
        return true;
    }

    function parseBoolean(value) {
        if (value === true || value === false) {
            return value;
        }
        const normalized = String(value == null ? '' : value).trim().toLowerCase();
        if (normalized === 'true') {
            return true;
        }
        if (normalized === 'false') {
            return false;
        }
        return null;
    }

    function readStorageValue(key) {
        try {
            if (global.localStorage && typeof global.localStorage.getItem === 'function') {
                return global.localStorage.getItem(key);
            }
        } catch (_) {
            // ignore read failures
        }
        return null;
    }

    function writeStorageValue(key, value) {
        try {
            if (global.localStorage && typeof global.localStorage.setItem === 'function') {
                global.localStorage.setItem(key, String(value));
            }
        } catch (_) {
            // ignore write failures
        }
    }

    function resolveSuitePreference(overrides = {}) {
        const config = ensurePracticeConfig();
        const suiteConfig = config.suite || {};

        const flowMode = normalizeFlowMode(overrides.flowMode)
            || normalizeFlowMode(suiteConfig.flowMode)
            || normalizeFlowMode(readStorageValue(FLOW_MODE_STORAGE_KEY))
            || 'classic';

        const frequencyScope = normalizeFrequencyScope(overrides.frequencyScope)
            || normalizeFrequencyScope(suiteConfig.frequencyScope)
            || normalizeFrequencyScope(readStorageValue(FREQUENCY_SCOPE_STORAGE_KEY))
            || 'all';

        const overrideAutoAdvance = parseBoolean(overrides.autoAdvanceAfterSubmit);
        const configAutoAdvance = parseBoolean(suiteConfig.autoAdvanceAfterSubmit);
        const storedAutoAdvance = parseBoolean(readStorageValue(AUTO_ADVANCE_STORAGE_KEY));
        const fallbackAutoAdvance = flowMode !== 'stationary';
        const autoAdvanceAfterSubmit = overrideAutoAdvance != null
            ? overrideAutoAdvance
            : (configAutoAdvance != null
                ? configAutoAdvance
                : (storedAutoAdvance != null ? storedAutoAdvance : fallbackAutoAdvance));

        config.suite.flowMode = flowMode;
        config.suite.frequencyScope = frequencyScope;
        config.suite.autoAdvanceAfterSubmit = autoAdvanceAfterSubmit;

        return {
            flowMode,
            frequencyScope,
            autoAdvanceAfterSubmit
        };
    }

    function persistSuitePreference(partial = {}) {
        const current = resolveSuitePreference();

        const flowMode = normalizeFlowMode(partial.flowMode) || current.flowMode;
        const frequencyScope = normalizeFrequencyScope(partial.frequencyScope) || current.frequencyScope;

        const partialAutoAdvance = parseBoolean(partial.autoAdvanceAfterSubmit);
        const autoAdvanceAfterSubmit = partialAutoAdvance != null
            ? partialAutoAdvance
            : (flowMode === 'stationary' ? false : true);

        const config = ensurePracticeConfig();
        config.suite.flowMode = flowMode;
        config.suite.frequencyScope = frequencyScope;
        config.suite.autoAdvanceAfterSubmit = autoAdvanceAfterSubmit;

        writeStorageValue(FLOW_MODE_STORAGE_KEY, flowMode);
        writeStorageValue(FREQUENCY_SCOPE_STORAGE_KEY, frequencyScope);
        writeStorageValue(AUTO_ADVANCE_STORAGE_KEY, autoAdvanceAfterSubmit ? 'true' : 'false');

        return {
            flowMode,
            frequencyScope,
            autoAdvanceAfterSubmit
        };
    }

    const api = {
        FLOW_MODES: FLOW_MODES.slice(),
        FREQUENCY_SCOPES: FREQUENCY_SCOPES.slice(),
        ensurePracticeConfig,
        normalizeFlowMode,
        normalizeFrequencyScope,
        normalizeFrequency,
        isFrequencyIncluded,
        resolveSuitePreference,
        persistSuitePreference
    };

    global.SuitePreferenceUtils = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
