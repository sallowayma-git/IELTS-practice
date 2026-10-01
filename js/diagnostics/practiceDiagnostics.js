(function definePracticeDiagnostics(global) {
    'use strict';
    if (global.AppPracticeDiagnostics) return;
    let stylesheet;
    try { stylesheet = new URL('../../css/incident-center.css', global.document.currentScript.src).href; } catch (_) { }

    // Only semantic state and aliases enter this adapter. Business payloads and
    // retry snapshots remain owned by the listening bridge / legacy enhancer.
    function create(module) {
        const reporter = global.AppDiagnostics;
        let transport, binding, aliases, handshake;
        const pending = new Map();
        try { transport = global.AppDiagnosticChannel?.createChild({ reporter, store: global.AppDiagnosticStore }); } catch (_) { }
        function correlation(submission) {
            try {
                const local = reporter?.correlate({ session: binding?.sessionId, suite: binding?.suiteSessionId,
                    submission, operation: submission });
                return aliases ? { ...local, scopeId: aliases.scopeId, session: aliases.session, suite: aliases.suite } : local;
            } catch (_) { return undefined; }
        }
        function step(action, outcome, submission) {
            try { global.AppOperationDiagnostics?.breadcrumb(module, action, outcome, correlation(submission)); } catch (_) { }
        }
        function failure(code, action, operation = 'unconfirmed', submission, retry, error, resource) {
            try { return global.AppOperationDiagnostics?.failure({ code, module, action, operation,
                correlation: correlation(submission), error, resource }, retry); } catch (_) { return null; }
        }
        function clear(id) {
            const item = pending.get(id);
            if (item) {
                global.clearTimeout(item.timer);
                item.finish?.({ verified: item.committed === true, operation: item.committed ? 'committed' : 'unconfirmed' });
            }
            pending.delete(id);
            return item;
        }
        function connect(state, data) {
            try {
                const next = { window: state.parentWindow, origin: state.parentOrigin,
                    allowOpaqueOrigin: state.parentOriginIsOpaque, sessionId: state.sessionId,
                    suiteSessionId: state.suiteSessionId, windowSessionToken: state.windowSessionToken };
                if (!binding || Object.keys(next).some(key => next[key] !== binding[key])) {
                    pending.forEach((_, id) => clear(id));
                    binding = next;
                }
                const candidate = reporter?.correlate(undefined, data?.diagnosticCorrelation);
                aliases = candidate?.scopeId !== 'unknown' && candidate?.session !== 'unknown' ? candidate : null;
                global.clearTimeout(handshake);
                transport?.connect(binding);
                step('handshake', 'succeeded');
            } catch (_) { }
        }
        function watch(id, retry) {
            try {
                if (!id || pending.has(id)) return;
                if (pending.size >= 200) clear(pending.keys().next().value);
                const owner = binding;
                const item = { retry: typeof retry === 'function' ? () => {
                    if (binding !== owner) return { verified: false, operation: 'unconfirmed' };
                    if (item.committed) return { verified: true, operation: 'committed' };
                    if (pending.get(id) !== item) return { verified: false, operation: 'unconfirmed' };
                    if (item.waiting) return item.waiting;
                    step('retry', 'started', id);
                    item.waiting = new Promise(resolve => {
                        const timer = global.setTimeout(() => item.finish({ verified: false, operation: 'unconfirmed' }), 10000);
                        item.finish = result => { global.clearTimeout(timer); item.waiting = null; resolve(result); };
                    });
                    const waiting = item.waiting;
                    try { retry(); } catch (_) { item.finish({ verified: false, operation: 'unconfirmed' }); }
                    return waiting;
                } : undefined };
                item.timer = global.setTimeout(() => {
                    if (pending.get(id) !== item) return;
                    failure('PRACTICE_CHANNEL_TIMEOUT', 'submit', 'unconfirmed', id, item.retry);
                }, 10000);
                pending.set(id, item);
                step('submit', 'unconfirmed', id);
            } catch (_) { }
        }
        function outcome(id, committed, operation, causeCode) {
            try {
                const item = pending.get(id);
                if (!item) return;
                if (committed) { item.committed = true; clear(id); step('acknowledgement', 'succeeded', id); step('storage-confirmed', 'succeeded', id); }
                else {
                    global.clearTimeout(item.timer);
                    item.finish?.({ verified: false, operation: 'unconfirmed' });
                    // A negative reply after replay cannot disprove an earlier write.
                    const error = new Error('Practice persistence was not confirmed');
                    if (global.AppDiagnosticContract?.CAUSE_CODES.includes(causeCode)) {
                        error.name = 'AppDataError'; error.code = causeCode;
                    }
                    failure('PRACTICE_SAVE_FAILED', 'submit', operation === 'not-committed' ? 'not-committed' : 'unconfirmed', id, item.retry, error);
                }
            } catch (_) { }
        }
        function ready(parent) {
            try {
                reporter?.markReady();
                step('initialize', 'succeeded');
                if (parent && parent !== global && !binding && !handshake) handshake = global.setTimeout(() => {
                    if (!binding) failure('PRACTICE_CHANNEL_TIMEOUT', 'handshake', 'not-committed');
                }, 10000);
                installAccess();
            } catch (_) { }
        }
        return Object.freeze({ connect, correlation, step, failure, watch, outcome, ready,
            access() { try { installAccess(); } catch (_) { } },
            dispose() {
                pending.forEach((_, id) => clear(id)); global.clearTimeout(handshake);
                try { transport?.dispose(); } catch (_) { }
            } });
    }

    function installAccess() {
        const doc = global.document;
        if (!doc?.body || doc.getElementById('practice-diagnostics-access')) return;
        if (stylesheet && !doc.querySelector('link[href$="css/incident-center.css"]')) {
            const link = doc.createElement('link');
            link.rel = 'stylesheet';
            global.AppDiagnostics?.declareResource(link, { url: stylesheet, optional: false });
            link.href = stylesheet;
            (doc.head || doc.body).appendChild(link);
        }
        // The wrapper may not receive this frame's memory-only evidence. Keep
        // local access independent of persistence and relay availability.
        let wrapped = false;
        try {
            wrapped = global.parent !== global && global.parent?.document?.documentElement?.dataset.listeningWrapper === 'true';
        } catch (_) { }
        const button = doc.createElement('button');
        button.id = 'practice-diagnostics-access';
        button.type = 'button';
        button.textContent = wrapped ? 'Errors and diagnostics (this frame)' : 'Errors and diagnostics';
        // Place frame access below the wrapper's fixed control so both are usable.
        button.style.cssText = `position:fixed;top:${wrapped ? 48 : 8}px;right:8px;z-index:10001;padding:6px 10px;background:#fff;color:#172033;border:1px solid #667085;border-radius:6px;font:13px system-ui`;
        button.addEventListener('click', async () => {
            try {
                const center = global.getMessageCenter?.();
                if (center?.showIncidentHistory) { center.showIncidentHistory(); return; }
            } catch (_) { }
            // Passive, selectable fallback remains usable without the shared UI.
            try {
                const result = await global.AppDiagnosticExport?.exportJSON();
                let area = doc.getElementById('practice-diagnostic-text');
                if (!area) {
                    area = doc.createElement('textarea');
                    area.id = 'practice-diagnostic-text';
                    area.setAttribute('aria-label', 'Local diagnostic report');
                    area.style.cssText = 'position:fixed;inset:50px 5% 5%;width:90%;z-index:10002;background:white;color:black';
                    doc.body.appendChild(area);
                }
                area.value = result?.json || result?.text || global.AppDiagnostics.exportText();
                area.focus(); area.select();
            } catch (_) { }
        });
        doc.body.appendChild(button);
    }
    global.AppPracticeDiagnostics = Object.freeze({ create });
})(typeof globalThis !== 'undefined' ? globalThis : this);
