// Self-contained so the browser harness can inject the same capacity boundary.
export function prepareStartupEnrichmentAtCapacity(collector) {
    const error = Object.assign(new Error('PRIVATE_INITIALIZATION_DETAIL'), {
        name: 'AppDataError', code: 'BACKEND_UNAVAILABLE', stack: ''
    });
    collector.captureConsole('error', [error]);
    const first = collector.snapshot().events.at(-1);
    // Leave less room than the startup observation's new breadcrumb evidence needs.
    // Explicit filler breadcrumbs exercise the byte cap before the event-count cap.
    for (let i = 0; i < 200 && collector.status().bytes < 256 * 1024 - 4096; i += 1) {
        collector.report({ code: 'PRACTICE_SAVE_FAILED', notification: { kind: 'persistent' },
            breadcrumbs: [{ action: 'save', module: 'practice', outcome: 'failed' }] });
    }
    for (let i = 0; i < 50; i += 1) {
        collector.breadcrumb({ action: 'initialize', module: 'main', outcome: 'started' });
    }
    return { error, first, before: collector.status() };
}
