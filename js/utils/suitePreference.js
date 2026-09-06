(function initSuitePreferenceUtils(global) {
    'use strict';

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

    let hydrationPromise = null;
    function hydrateSuitePreference() {
        if (hydrationPromise) return hydrationPromise;
        // runtime-entry.bundle.js is intentionally loaded before the data
        // foundation.  Do not memoize that early miss: a cached `false` would
        // make every later resolver skip the persisted AppData preference.
        if (!global.AppData || !global.AppData.preferences) {
            return Promise.resolve(false);
        }
        hydrationPromise = Promise.resolve().then(async () => {
            await global.AppData.ready;
            const stored = await global.AppData.preferences.getSuite();
            if (stored && typeof stored === 'object') Object.assign(ensurePracticeConfig().suite, stored);
            return true;
        }).catch((error) => {
            console.warn('[SuitePreference] 加载失败:', error);
            return false;
        });
        // A transient AppData initialization failure should be retryable on the
        // next read, just like the pre-foundation early miss above.
        hydrationPromise = hydrationPromise.then((hydrated) => {
            if (!hydrated) hydrationPromise = null;
            return hydrated;
        });
        return hydrationPromise;
    }

    async function resolveSuitePreference(overrides = {}) {
        await hydrateSuitePreference();
        const config = ensurePracticeConfig();
        const suiteConfig = config.suite || {};

        const flowMode = normalizeFlowMode(overrides.flowMode)
            || normalizeFlowMode(suiteConfig.flowMode)
            || 'classic';

        const frequencyScope = normalizeFrequencyScope(overrides.frequencyScope)
            || normalizeFrequencyScope(suiteConfig.frequencyScope)
            || 'all';

        const overrideAutoAdvance = parseBoolean(overrides.autoAdvanceAfterSubmit);
        const configAutoAdvance = parseBoolean(suiteConfig.autoAdvanceAfterSubmit);
        const fallbackAutoAdvance = flowMode !== 'stationary';
        const autoAdvanceAfterSubmit = overrideAutoAdvance != null
            ? overrideAutoAdvance
            : (configAutoAdvance != null
                ? configAutoAdvance
                : fallbackAutoAdvance);

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
        const config = ensurePracticeConfig();
        const suiteConfig = config.suite || {};
        const fallbackCurrent = {
            flowMode: normalizeFlowMode(suiteConfig.flowMode) || 'classic',
            frequencyScope: normalizeFrequencyScope(suiteConfig.frequencyScope) || 'all',
            autoAdvanceAfterSubmit: parseBoolean(suiteConfig.autoAdvanceAfterSubmit)
        };

        const flowMode = normalizeFlowMode(partial.flowMode) || fallbackCurrent.flowMode;
        const frequencyScope = normalizeFrequencyScope(partial.frequencyScope) || fallbackCurrent.frequencyScope;

        const partialAutoAdvance = parseBoolean(partial.autoAdvanceAfterSubmit);
        const autoAdvanceAfterSubmit = partialAutoAdvance != null
            ? partialAutoAdvance
            : (flowMode === 'stationary' ? false : true);

        config.suite.flowMode = flowMode;
        config.suite.frequencyScope = frequencyScope;
        config.suite.autoAdvanceAfterSubmit = autoAdvanceAfterSubmit;

        hydrateSuitePreference().then((hydrated) => {
            if (!hydrated || !global.AppData || !global.AppData.preferences) return;
            return global.AppData.preferences.patchSuite({
                flowMode,
                frequencyScope,
                autoAdvanceAfterSubmit
            });
        }).catch((error) => console.warn('[SuitePreference] 保存失败:', error));

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
        ready: hydrateSuitePreference,
        resolveSuitePreference,
        persistSuitePreference
    };

    global.SuitePreferenceUtils = api;

    // Kick hydration off eagerly so any later resolver (including the
    // synchronous readers inside suitePracticeMixin) does not race the very
    // first AppData.preferences.getSuite() lookup.  If the data foundation is
    // not installed yet, hydrateSuitePreference deliberately retries later.
    hydrateSuitePreference();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
