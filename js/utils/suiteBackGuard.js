(function initSuiteBackGuard(global) {
    'use strict';

    function createSuiteBackGuard(options = {}) {
        const context = options.context || global;
        const historyRef = options.history || context.history;
        const locationRef = options.location || context.location;
        const documentRef = options.document || context.document;
        const getSuiteSessionId = typeof options.getSuiteSessionId === 'function'
            ? options.getSuiteSessionId
            : () => options.suiteSessionId || null;
        const onBlocked = typeof options.onBlocked === 'function'
            ? options.onBlocked
            : () => { };
        const tokenPrefix = String(options.tokenPrefix || 'suite_guard');

        let installed = false;
        let token = null;
        let pushed = false;
        let bypass = false;
        let popstateHandler = null;

        function currentSessionId() {
            const raw = getSuiteSessionId();
            const normalized = raw == null ? '' : String(raw).trim();
            return normalized || null;
        }

        function buildMarker(baseState) {
            const marker = Object.assign(
                {},
                (baseState && typeof baseState === 'object') ? baseState : {},
                {
                    __suiteGuard: true,
                    __suiteGuardToken: token,
                    suiteSessionId: currentSessionId(),
                    timestamp: Date.now()
                }
            );
            return marker;
        }

        function pushMarker(baseState) {
            if (!historyRef || typeof historyRef.pushState !== 'function') {
                return false;
            }
            try {
                historyRef.pushState(
                    buildMarker(baseState),
                    documentRef && documentRef.title ? documentRef.title : '',
                    locationRef && locationRef.href ? locationRef.href : undefined
                );
                return true;
            } catch (_) {
                return false;
            }
        }

        function activate() {
            if (installed) {
                return true;
            }
            if (!context || !historyRef || !locationRef || !documentRef || typeof context.addEventListener !== 'function') {
                return false;
            }
            const suiteSessionId = currentSessionId();
            if (!suiteSessionId) {
                return false;
            }

            installed = true;
            pushed = false;
            bypass = false;
            token = `${tokenPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

            popstateHandler = (event) => {
                if (bypass || !installed) {
                    return;
                }
                const activeSessionId = currentSessionId();
                if (!activeSessionId) {
                    return;
                }
                const currentToken = event && event.state && event.state.__suiteGuardToken;
                if (currentToken && currentToken === token) {
                    return;
                }
                try {
                    bypass = true;
                    pushMarker(event && event.state);
                    onBlocked({
                        reason: 'history_back_blocked',
                        suiteSessionId: activeSessionId,
                        token
                    });
                } finally {
                    context.setTimeout(() => {
                        bypass = false;
                    }, 0);
                }
            };

            pushed = pushMarker(historyRef.state);
            context.addEventListener('popstate', popstateHandler);
            return true;
        }

        function deactivate() {
            if (!installed) {
                return;
            }
            installed = false;

            if (popstateHandler && context && typeof context.removeEventListener === 'function') {
                try {
                    context.removeEventListener('popstate', popstateHandler);
                } catch (_) {
                    // ignore remove failures
                }
            }

            if (pushed && historyRef && typeof historyRef.replaceState === 'function') {
                try {
                    const state = historyRef.state;
                    const currentToken = state && state.__suiteGuardToken;
                    if (currentToken && currentToken === token) {
                        const restored = Object.assign({}, state);
                        delete restored.__suiteGuard;
                        delete restored.__suiteGuardToken;
                        delete restored.suiteSessionId;
                        delete restored.timestamp;
                        historyRef.replaceState(
                            restored,
                            documentRef && documentRef.title ? documentRef.title : '',
                            locationRef && locationRef.href ? locationRef.href : undefined
                        );
                    }
                } catch (_) {
                    // ignore restore failures
                }
            }

            popstateHandler = null;
            pushed = false;
            bypass = false;
            token = null;
        }

        function isInstalled() {
            return installed;
        }

        return {
            activate,
            deactivate,
            isInstalled
        };
    }

    const api = {
        create: createSuiteBackGuard
    };

    global.createSuiteBackGuard = createSuiteBackGuard;
    global.SuiteBackGuard = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
