(function attachDiagnosticReporter(global) {
    'use strict';
    if (global.AppDiagnostics) return;
    // Handoff keeps the normalizer, identities, buffer and listeners in the same owner.
    global.AppDiagnostics = global.AppDiagnosticBootstrap.install({
        context: global.document?.documentElement?.dataset?.diagnosticContext || 'main'
    }).handoff();
    if (global.AppDiagnosticStore) global.AppDiagnostics.attachSink(global.AppDiagnosticStore);
})(typeof globalThis !== 'undefined' ? globalThis : this);
