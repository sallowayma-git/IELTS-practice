(function defineDiagnosticExport(global) {
    'use strict';
    if (global.AppDiagnosticExport) return;

    const LIMITS = Object.freeze({ events: 2000, bytes: 2 * 1024 * 1024, context: 50,
        summaryBytes: 8192, readTimeoutMs: 3000 });
    const NOTICE = 'Local diagnostics help investigation; they are not an answer backup.';
    const ORDERING = 'Sequence within each originating window; cross-window clocks are not synchronized.';
    const FALLBACK = NOTICE + '\nDiagnostic export generation failed. Keep this page open and use the startup text export if available.';
    const PERSISTENCE = ['persisted', 'pending', 'memory-only', 'disabled', 'failed'];
    const FAILURES = ['COORDINATION_UNAVAILABLE', 'UNAVAILABLE', 'QUOTA_EXCEEDED', 'TRANSACTION_ABORTED',
        'TRANSACTION_FAILED', 'OPEN_BLOCKED', 'OPEN_TIMEOUT', 'TRANSACTION_TIMEOUT', 'DELETE_BLOCKED'];
    const EVENT_ID = /^evt_[a-f0-9]{32}_[1-9][0-9]{0,15}$/;

    // Retained records, status objects and caller queries all cross the same
    // default-deny boundary. Never enumerate caller objects or invoke getters.
    function field(value, key) {
        try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch (_) { return undefined; }
    }
    function method(value, key) {
        try {
            for (let depth = 0; value && depth < 4; depth += 1, value = Object.getPrototypeOf(value)) {
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (descriptor) return typeof descriptor.value === 'function' ? descriptor.value : null;
            }
        } catch (_) { }
        return null;
    }
    function choice(value, values, fallback = 'unknown') { return values.includes(value) ? value : fallback; }
    function count(value) { return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, Number.MAX_SAFE_INTEGER) : 0; }
    function freeze(value) {
        if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
        return value;
    }
    function storageStatus(raw) {
        if (!raw) return null;
        const generation = field(raw, 'generation');
        const mode = field(raw, 'detailedMode');
        return { persistence: choice(field(raw, 'persistence'), PERSISTENCE),
            enabled: choice(field(raw, 'enabled'), [true, false]),
            generation: typeof generation === 'string' && /^dg-[a-f0-9]{32}$/.test(generation) ? generation : 'unknown',
            cutoff: Number.isSafeInteger(field(raw, 'cutoff')) ? Math.max(-1, field(raw, 'cutoff')) : -1,
            suspended: choice(field(raw, 'suspended'), [true, false]),
            phase: choice(field(raw, 'phase'), ['active', 'resetting', 'reset-complete']),
            failure: choice(field(raw, 'failure'), FAILURES, field(raw, 'failure') === null ? null : 'unknown'),
            coverage: choice(field(raw, 'coverage'), ['complete', 'partial']),
            pendingEvents: count(field(raw, 'pendingEvents')), pendingBytes: count(field(raw, 'pendingBytes')),
            dropped: count(field(raw, 'dropped')),
            ...(mode ? { detailedMode: { active: field(mode, 'active') === true,
                expiresAt: count(field(mode, 'expiresAt')), remainingMs: Math.min(900000, count(field(mode, 'remainingMs'))),
                coordination: choice(field(mode, 'coordination'), ['supported-windows', 'unavailable'], 'unavailable') } } : {}) };
    }
    function priority(event) {
        if (event.code !== 'UNEXPECTED_RUNTIME_ERROR') return event.collection.source === 'business' ? 3 : 2;
        return event.collection.source === 'console' ? 0 : 1;
    }
    function correlationKeys(event) {
        const keys = [];
        for (const correlation of [event.correlation, ...event.breadcrumbs.map((crumb) => crumb.correlation)]) {
            if (correlation.scopeId === 'unknown') continue;
            for (const kind of ['operation', 'submission', 'session', 'suite']) {
                if (correlation[kind] !== 'unknown') keys.push(correlation.scopeId + ':' + correlation[kind]);
            }
        }
        return keys;
    }

    function create(options = {}) {
        const requestedTimeout = field(options, 'timeoutMs');
        const timeout = Number.isSafeInteger(requestedTimeout)
            ? Math.max(1, Math.min(LIMITS.readTimeoutMs, requestedTimeout)) : LIMITS.readTimeoutMs;
        const contract = global.AppDiagnosticContract;
        const normalizer = contract.createNormalizer();

        async function bounded(action) {
            let timer;
            try {
                return await Promise.race([
                    Promise.resolve().then(action).then((value) => ({ state: 'available', value }), () => ({ state: 'failed' })),
                    new Promise((resolve) => { timer = global.setTimeout(() => resolve({ state: 'timed-out' }), timeout); })
                ]);
            } catch (_) { return { state: 'failed' }; }
            finally { try { global.clearTimeout(timer); } catch (_) { } }
        }

        function readers() {
            // current() observes an installed bootstrap without starting collection.
            return { memory: field(options, 'reporter') || global.AppDiagnostics,
                bootstrap: field(options, 'bootstrap') || global.AppDiagnosticBootstrap?.current?.(),
                persisted: field(options, 'store') || global.AppDiagnosticStore };
        }
        async function read(reader, limit) {
            const snapshot = method(reader, 'snapshot');
            if (!snapshot) return { state: 'unavailable' };
            return bounded(() => snapshot.call(reader, { limit }));
        }
        function cleanSource(result, maximum, byteLimit) {
            const raw = result.value;
            const input = field(raw, 'events');
            let array = false;
            try { array = Array.isArray(input); } catch (_) { }
            const length = array ? count(field(input, 'length')) : 0;
            const events = [];
            let bytes = 0;
            let rejected = 0;
            let truncated = field(raw, 'truncated') === true || length > maximum;
            for (let index = 0; index < Math.min(length, maximum); index += 1) {
                const event = normalizer.sanitizeEvent(field(input, String(index)));
                if (!event) { rejected += 1; continue; }
                const size = contract.utf8Bytes(JSON.stringify(event));
                if (bytes + size > byteLimit) { truncated = true; break; }
                bytes += size;
                events.push(event);
            }
            return { events, storage: storageStatus(field(raw, 'storage')),
                entryCoverage: contract.sanitizeEntryCoverage(field(raw, 'entryCoverage')),
                transport: contract.sanitizeTransportStatus(field(raw, 'transport')),
                status: { state: result.state === 'available' && !array ? 'failed' : result.state,
                    persistence: choice(field(raw, 'persistence'), PERSISTENCE),
                    coverage: choice(field(raw, 'coverage'), ['complete', 'partial']),
                    events: events.length, rejected, truncated } };
        }
        function metadata(local) {
            let runMode = 'unknown';
            const environment = { ...local?.environment };
            try {
                runMode = global.location.protocol === 'file:' ? 'file'
                    : /^https?:$/.test(global.location.protocol)
                        ? (global.location.pathname.replace(/[^/]*$/, '') === '/' ? 'http' : 'subpath') : 'unknown';
            } catch (_) { }
            try {
                const agent = global.navigator.userAgent;
                if (typeof agent === 'string' && agent.length <= 1024) {
                    const browser = /(?:Chrome|Chromium|CriOS)\/([0-9.]+)/.exec(agent)
                        || /Firefox\/([0-9.]+)/.exec(agent) || /Version\/([0-9.]+).*Safari\//.exec(agent);
                    if (browser) {
                        environment.browser = /^(?:Chrome|Chromium|CriOS)/.test(browser[0]) ? 'chromium'
                            : browser[0].startsWith('Firefox') ? 'firefox' : 'safari';
                        environment.browserVersion = browser[1];
                    }
                    environment.platform = /Android/.test(agent) ? 'android' : /iPhone|iPad|iPod/.test(agent) ? 'ios'
                        : /Windows/.test(agent) ? 'windows' : /Macintosh/.test(agent) ? 'macos' : /Linux/.test(agent) ? 'linux' : 'unknown';
                }
                environment.online = global.navigator.onLine === true ? 'online' : global.navigator.onLine === false ? 'offline' : 'unknown';
            } catch (_) { }
            const build = global.AppDiagnosticBuild;
            const event = contract.createNormalizer({ appVersion: field(build, 'appVersion'), buildId: field(build, 'buildId'),
                environment: { ...environment, runMode,
                    context: field(options, 'context') || local?.environment.context } }).normalize(null);
            return { appVersion: event.appVersion, buildId: event.buildId, environment: event.environment };
        }
        function connection(context) {
            if (context === 'main') return 'not-applicable';
            if (!['reading', 'listening', 'legacy'].includes(context)) return 'unknown';
            try { return !global.opener || global.opener.closed ? 'disconnected' : 'unverified'; }
            catch (_) { return 'unknown'; }
        }
        function failureReport() {
            return freeze({ schemaVersion: 1, reportType: 'passive-diagnostics', notice: NOTICE,
                appVersion: 'unknown', buildId: 'unknown', environment: { context: 'unknown', runMode: 'unknown' },
                selection: { kind: 'unknown', eventId: null, found: false }, persistence: 'unknown', storage: null,
                sources: {}, collection: { coverage: 'partial', aggregation: 'incomplete', connection: 'unknown',
                    limitations: contract.COVERAGE_LIMITATIONS.slice() },
                truncated: true, issues: ['export-generation-failed'], events: [], timeline: { ordering: ORDERING, windows: [] } });
        }

        async function snapshot(query = {}) {
            try {
                const inputId = field(query, 'eventId');
                const incident = inputId !== undefined;
                const eventId = typeof inputId === 'string' && inputId.length <= 64 && EVENT_ID.test(inputId) ? inputId : null;
                const issues = [];
                const selectedLimit = incident ? LIMITS.context + 1 : LIMITS.events;
                const requested = field(query, 'limit');
                const limit = Number.isSafeInteger(requested)
                    ? Math.max(incident ? 1 : 0, Math.min(selectedLimit, requested)) : selectedLimit;
                const owners = readers();
                // Capture memory before awaiting the durable read; never flush/retry the sink.
                const memoryRead = read(owners.memory, 200);
                const bootstrapRead = owners.bootstrap && owners.bootstrap === owners.memory
                    ? Promise.resolve({ state: 'shared' }) : read(owners.bootstrap, 200);
                const storedRead = read(owners.persisted, LIMITS.events);
                const results = await Promise.all([memoryRead, bootstrapRead, storedRead]);
                const memory = cleanSource(results[0], 200, 256 * 1024);
                const bootstrap = cleanSource(results[1], 200, 256 * 1024);
                const persisted = cleanSource(results[2], LIMITS.events, LIMITS.bytes);
                const sources = { memory: memory.status, bootstrap: bootstrap.status, persisted: persisted.status };
                for (const [name, status] of Object.entries(sources)) {
                    if (!['available', 'shared'].includes(status.state)) issues.push(name + '-' + status.state);
                    if (status.rejected) issues.push(name + '-records-rejected');
                }
                const storage = persisted.storage || memory.storage || bootstrap.storage;
                const transport = memory.transport || bootstrap.transport;
                const merged = new Map();
                // Prefer the latest memory classification on equal priority. An older
                // persisted revision must not acknowledge a pending enrichment.
                for (const event of [...persisted.events, ...bootstrap.events, ...memory.events]) {
                    const previous = merged.get(event.eventId);
                    if (previous && previous.timestamp !== event.timestamp && !issues.includes('identity-conflict')) issues.push('identity-conflict');
                    if (!previous || priority(event) >= priority(previous)) merged.set(event.eventId, event);
                }
                const all = Array.from(merged.values());
                const chosen = eventId ? merged.get(eventId) : null;
                let candidates;
                if (incident) {
                    if (!eventId) issues.push('invalid-incident-reference');
                    else if (!chosen) issues.push('incident-not-retained');
                    const aliases = new Set(chosen ? correlationKeys(chosen) : []);
                    const correlated = chosen ? all.filter((event) => event !== chosen
                        && correlationKeys(event).some((key) => aliases.has(key))) : [];
                    const nearby = chosen ? all.filter((event) => event !== chosen && !correlated.includes(event)
                        && event.windowId === chosen.windowId && Math.abs(event.sequence - chosen.sequence) <= 10) : [];
                    const nearest = (a, b) => Math.abs(a.timestamp - chosen.timestamp) - Math.abs(b.timestamp - chosen.timestamp)
                        || a.eventId.localeCompare(b.eventId);
                    candidates = chosen ? [chosen, ...correlated.sort(nearest), ...nearby.sort(nearest)] : [];
                } else {
                    // Timestamps select retained context, not a claimed causal order.
                    candidates = all.sort((a, b) => b.timestamp - a.timestamp || b.sequence - a.sequence || a.eventId.localeCompare(b.eventId));
                }
                const meta = metadata(memory.events[0] || bootstrap.events[0]);
                const statuses = candidates.map((event) => event.persistence.diagnostics);
                const persistence = storage?.enabled === false ? 'disabled'
                    : storage?.failure || statuses.includes('failed') || persisted.status.state !== 'available' ? 'memory-only'
                        : statuses.includes('pending') ? 'pending' : statuses.includes('memory-only') ? 'memory-only'
                            : statuses.includes('disabled') ? 'disabled' : statuses.length ? 'persisted' : storage?.persistence || 'memory-only';
                const report = { schemaVersion: 1, reportType: 'passive-diagnostics', notice: NOTICE, ...meta,
                    selection: { kind: incident ? 'incident' : 'history', eventId, found: incident ? !!chosen : null },
                    persistence, storage, sources, ...(transport ? { transport } : {}),
                    collection: { coverage: 'partial', aggregation: 'incomplete', connection: transport?.connection || connection(meta.environment.context),
                        entryCoverage: memory.entryCoverage.entry !== 'unknown' ? memory.entryCoverage : bootstrap.entryCoverage,
                        limitations: [...contract.COVERAGE_LIMITATIONS, 'cross-window-completeness-unverified',
                            'retained-context-only', 'independent-source-snapshots'] },
                    truncated: Object.values(sources).some((source) => source.truncated) || !!storage?.dropped || candidates.length > limit,
                    issues, events: [], timeline: { ordering: ORDERING, windows: [] } };
                let bytes = contract.utf8Bytes(JSON.stringify(report)) + 256;
                for (const event of candidates.slice(0, limit)) {
                    // Reserve an entire window entry per event, a conservative bound
                    // on the timeline and all enclosing JSON separators/keys.
                    const size = contract.utf8Bytes(JSON.stringify(event)) + event.eventId.length + event.windowId.length + 128;
                    if (bytes + size > LIMITS.bytes) { report.truncated = true; break; }
                    report.events.push(event);
                    bytes += size;
                }
                report.events.sort((a, b) => a.windowId.localeCompare(b.windowId) || a.sequence - b.sequence);
                const windows = new Map();
                for (const event of report.events) {
                    if (!windows.has(event.windowId)) windows.set(event.windowId, { windowId: event.windowId, eventIds: [] });
                    windows.get(event.windowId).eventIds.push(event.eventId);
                }
                report.timeline.windows = Array.from(windows.values());
                return freeze(report);
            } catch (_) { return failureReport(); }
        }

        function summary(report) {
            const lines = [NOTICE, 'Build: ' + report.appVersion + ' / ' + report.buildId,
                'Context: ' + report.environment.context + ' / ' + report.environment.runMode,
                'Selection: ' + report.selection.kind + (report.selection.eventId ? ' / ' + report.selection.eventId : ''),
                'Incident found: ' + report.selection.found, 'Diagnostic persistence: ' + report.persistence,
                'Coverage: partial; aggregation: incomplete; connection: ' + report.collection.connection,
                'Truncated: ' + report.truncated + '; retained events: ' + report.events.length,
                'Storage: ' + (report.storage ? report.storage.persistence + '; failure: ' + report.storage.failure : 'unavailable'), ORDERING];
            for (const [name, status] of Object.entries(report.sources)) lines.push(name + ': ' + status.state + '; ' + status.persistence);
            lines.push('Limitations: ' + report.collection.limitations.join(', '));
            if (report.collection.entryCoverage) lines.push('Entry: ' + report.collection.entryCoverage.entry
                + '; capture: ' + report.collection.entryCoverage.capture + '; limitations: ' + report.collection.entryCoverage.limitations.join(', '));
            if (report.issues.length) lines.push('Issues: ' + report.issues.join(', '));
            const chosen = report.events.find((event) => event.eventId === report.selection.eventId);
            const events = chosen ? [chosen, ...report.events.filter((event) => event !== chosen)] : report.events;
            for (const event of events.slice(0, 12)) {
                const line = event.eventId + ' ' + event.code + ' / ' + event.causeCode + ' ' + event.module + '/' + event.action
                    + '; operation: ' + event.persistence.operation + '; diagnostics: ' + event.persistence.diagnostics
                    + '; resource: ' + event.resource.path + ':' + event.resource.line + ':' + event.resource.column;
                if (contract.utf8Bytes(lines.join('\n') + '\n' + line) > LIMITS.summaryBytes - 100) break;
                lines.push(line);
            }
            if (events.length > 12) lines.push('Additional events are available in the bounded JSON report.');
            return lines.join('\n');
        }
        async function exportJSON(query) {
            try {
                const report = await snapshot(query);
                const json = JSON.stringify(report);
                const text = summary(report);
                if (contract.utf8Bytes(json) > LIMITS.bytes || contract.utf8Bytes(text) > LIMITS.summaryBytes) throw new Error();
                return freeze({ status: report.issues.includes('export-generation-failed') ? 'fallback' : 'ready', report, json, text });
            } catch (_) { return freeze({ status: 'fallback', report: null, json: null, text: FALLBACK }); }
        }
        function selectable(text, target) {
            try {
                const doc = global.document;
                let area = target;
                if (!area) {
                    area = doc.getElementById('diagnostic-export-text');
                    if (!area) {
                        area = doc.createElement('textarea');
                        area.id = 'diagnostic-export-text';
                        area.setAttribute('aria-label', '诊断摘要（不包含答案备份）');
                        area.rows = 12;
                        area.style.cssText = 'display:block;width:100%;max-height:60vh;color:#17202a;background:#fff;';
                        doc.body.appendChild(area);
                    }
                }
                area.readOnly = true;
                area.value = text;
                area.focus();
                area.select();
                return true;
            } catch (_) { return false; }
        }
        async function copySummary(query, presentation = {}) {
            const result = await exportJSON(query);
            const copied = await bounded(() => global.navigator.clipboard.writeText(result.text));
            return { ...result, status: copied.state === 'available' ? 'copied' : 'text-fallback',
                selectable: copied.state !== 'available' && selectable(result.text, field(presentation, 'textTarget')) };
        }
        async function download(query, presentation = {}) {
            const result = await exportJSON(query);
            let url;
            let link;
            try {
                if (result.status !== 'ready' || !result.json) throw new Error();
                url = global.URL.createObjectURL(new global.Blob([result.json], { type: 'application/json;charset=utf-8' }));
                link = global.document.createElement('a');
                link.href = url;
                link.download = 'ielts-diagnostics.json';
                global.document.body.appendChild(link);
                link.click();
                return { ...result, status: 'download-started', selectable: false };
            } catch (_) {
                return { ...result, status: 'text-fallback', selectable: selectable(result.text, field(presentation, 'textTarget')) };
            } finally {
                try { if (link?.parentNode) link.parentNode.removeChild(link); } catch (_) { }
                if (url) {
                    const release = () => { try { global.URL.revokeObjectURL(url); } catch (_) { } };
                    try { global.setTimeout(release, 1000); } catch (_) { release(); }
                }
            }
        }
        return Object.freeze({ snapshot, exportJSON, copySummary, download,
            async getIncident(eventId) {
                const report = await snapshot({ eventId, limit: 1 });
                return report.events.find((event) => event.eventId === report.selection.eventId) || null;
            } });
    }
    global.AppDiagnosticExport = Object.freeze({ create, LIMITS, ...create() });
})(typeof globalThis !== 'undefined' ? globalThis : this);
