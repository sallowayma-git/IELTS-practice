(function installPracticeDiagnosticBootstrap(global) {
    'use strict';
    // Controlled entries already installed their inline collector. A dynamically
    // injected bundle can only observe failures from this point onwards.
    if (global.AppDiagnosticBootstrap.current()) return;
    const src = global.document?.currentScript?.src || '';
    const entry = /listening-wrapper/.test(src) ? 'listening-wrapper'
        : /listening-record-bridge/.test(src) ? 'listening-bridge' : 'legacy-enhancer';
    global.AppDiagnosticBootstrap.install({ context: entry === 'legacy-enhancer' ? 'legacy' : 'listening',
        entryCoverage: { entry, capture: 'late-injection' }, optionalMedia: true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
