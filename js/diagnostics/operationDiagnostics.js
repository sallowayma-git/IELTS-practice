(function installOperationDiagnostics(global) {
    'use strict';
    if (global.AppOperationDiagnostics) return;

    // These adapters observe business decisions. They never execute a business
    // operation, interpret an Error as a commit receipt, or retain its payload.
    function field(value, key) {
        try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch (_) { return undefined; }
    }
    function reporter() {
        return global.AppDiagnostics || global.AppDiagnosticBootstrap?.current();
    }
    function breadcrumb(module, action, outcome, correlation) {
        try { reporter()?.breadcrumb({ module, action, outcome, ...correlationInput(correlation) }); } catch (_) { }
    }
    function correlationInput(correlation) {
        return field(correlation, 'scopeId') ? { correlationAliases: correlation } : { correlation };
    }
    function businessOutcome(input) {
        const explicit = field(input, 'operation');
        if (explicit) return explicit;
        try { return global.AppData?.getOperationFailureState?.(field(input, 'error')) || 'unconfirmed'; }
        catch (_) { return 'unconfirmed'; }
    }
    function failure(input, retry) {
        let id = null;
        try {
            const code = field(input, 'code');
            const module = field(input, 'module');
            // Diagnostic export has its own bounded fallback, never this path.
            if (module === 'diagnostics') return null;
            const operation = businessOutcome(input);
            const action = field(input, 'action');
            const expected = field(input, 'expected') === true || field(input, 'cancelled') === true
                || field(field(input, 'resource'), 'optional') === true;
            const save = ['PRACTICE_SAVE_FAILED', 'RECOVERY_SAVE_FAILED'].includes(code)
                || ['submit', 'save', 'save-draft', 'save-recovery'].includes(action);
            const kind = expected ? 'none' : code === 'APP_BOOT_FAILED' ? 'startup'
                : save && operation === 'unconfirmed' ? 'dialog' : 'persistent';
            const capture = reporter();
            breadcrumb(module, action, field(input, 'cancelled') === true ? 'cancelled' : 'failed', field(input, 'correlation'));
            id = capture?.report({ code, module, action, error: field(input, 'error'),
                ...correlationInput(field(input, 'correlation')), resource: field(input, 'resource'),
                cancelled: field(input, 'cancelled'),
                persistence: { operation }, notification: { kind },
                retry: { available: !expected && operation === 'unconfirmed' && typeof retry === 'function',
                    action: field(input, 'retryAction') || action },
                collection: { source: 'business', coverage: 'partial', aggregation: 'local' } }) || null;
            if (!id || expected) return id;
            const event = capture.getIncident(id);
            const presentation = event?.retry.available && typeof retry === 'function' ? { retry: {
                action: event.retry.action, operationAlias: event.retry.operationAlias,
                submissionAlias: event.retry.submissionAlias, run: retry
            } } : undefined;
            // Capture precedes presentation; failure in either surface is isolated.
            global.getMessageCenter?.()?.showIncident(id, presentation);
        } catch (_) { }
        return id;
    }
    global.AppOperationDiagnostics = Object.freeze({ failure, breadcrumb });
})(typeof globalThis !== 'undefined' ? globalThis : this);
