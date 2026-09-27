(function attachDiagnosticReporter(global) {
    'use strict';
    if (global.AppDiagnostics) return;
    // Handoff keeps the normalizer, identities, buffer and listeners in the same owner.
    // A3 attaches its asynchronous sink here without waiting for AppData.ready.
    global.AppDiagnostics = global.AppDiagnosticBootstrap.install({ context: 'main' }).handoff();
})(typeof globalThis !== 'undefined' ? globalThis : this);
