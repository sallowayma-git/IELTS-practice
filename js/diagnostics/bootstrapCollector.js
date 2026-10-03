(function defineDiagnosticBootstrap(global) {
    'use strict';
    if (global.AppDiagnosticBootstrap) return;

    let installed;
    const MAX_EVENTS = 200;
    const MAX_BYTES = 256 * 1024;
    const TEXT_BYTES = 32 * 1024;
    const BATCH_SIZE = 20;
    // Capture the platform getter once. Its receiver brand check reads native
    // DOMException state without consulting caller-owned name getters or prototypes.
    let nativeDOMExceptionName;
    try { nativeDOMExceptionName = Object.getOwnPropertyDescriptor(global.DOMException.prototype, 'name')?.get; }
    catch (_) { }

    function isNativeAbort(error) {
        try { return typeof nativeDOMExceptionName === 'function' && nativeDOMExceptionName.call(error) === 'AbortError'; }
        catch (_) { return false; }
    }

    function classificationPriority(event) {
        if (event.code !== 'UNEXPECTED_RUNTIME_ERROR') return event.collection.source === 'business' ? 3 : 2;
        return event.collection.source === 'console' ? 0 : 1;
    }

    // Never invoke accessors on caller-owned inputs (including console arguments).
    function field(value, key) {
        try { return Object.getOwnPropertyDescriptor(value, key)?.value; }
        catch (_) { return undefined; }
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

    function install(options = {}) {
        if (installed) return installed;
        const contract = global.AppDiagnosticContract;
        const build = global.AppDiagnosticBuild || {};
        const context = field(options, 'context');
        const entryCoverage = contract.sanitizeEntryCoverage(field(options, 'entryCoverage'));
        let runMode = 'unknown';
        try {
            const entryRoot = global.location.pathname.replace(/assets\/generated\/(?:reading|listening)-exams\/(?:reading|listening)-practice-unified\.html$/, '');
            runMode = global.location.protocol === 'file:' ? 'file'
                : /^https?:$/.test(global.location.protocol)
                    ? (entryRoot.replace(/[^/]*$/, '') === '/' ? 'http' : 'subpath') : 'unknown';
        } catch (_) { }
        const correlationScope = contract.createCorrelationScope();
        const normalizer = contract.createNormalizer({
            windowIdentity: contract.createWindowIdentity(), correlationScope,
            appVersion: field(build, 'appVersion'), buildId: field(build, 'buildId'),
            environment: { context, runMode }
        });
        // Utility normalization must not allocate incident sequence numbers.
        const utility = contract.createNormalizer({ correlationScope });
        const records = new Map();
        const resources = new Map();
        const elements = new WeakMap();
        const resourceErrors = new WeakMap();
        const crumbs = [];
        const observers = new Set();
        let bytes = 0;
        let dropped = 0;
        let startup = true;
        let reporting = false;
        let internal = false;
        let handedOff = false;
        let sink = null;
        let append;
        let memoryOnlyConsole = false;
        let sinkFailed = false;
        let persistence = 'memory-only';
        let pending = null;
        let startupId = null;
        let panel = null;
        let fallbackFailed = false;
        let waitingForBody = false;
        let transport = null;

        function transportStatus() {
            try { return contract.sanitizeTransportStatus(method(transport, 'status')?.call(transport)); }
            catch (_) { return contract.sanitizeTransportStatus({ connection: 'unavailable' }); }
        }

        function trim() {
            while (records.size > MAX_EVENTS || bytes > MAX_BYTES) {
                const available = Array.from(records.values()).filter((item) => !item.inFlight && item.event.eventId !== startupId);
                const victim = available.find((item) => item.event.notification.kind === 'none') || available[0];
                if (!victim) break;
                records.delete(victim.event.eventId);
                bytes -= victim.bytes;
                dropped += 1;
            }
        }

        function schedule() {
            if (!sink || sinkFailed || pending) return;
            if (!Array.from(records.values()).some((item) => !item.delivered)) return;
            persistence = 'pending';
            // The only queue is the bounded records map. Batches share its immutable values.
            pending = Promise.resolve().then(async function drain() {
                const batch = Array.from(records.values()).filter((item) => !item.delivered).slice(0, BATCH_SIZE);
                if (!batch.length) return;
                batch.forEach((item) => { item.inFlight = true; updatePersistence(item, 'pending'); });
                const revisions = batch.map((item) => item.revision);
                try {
                    internal = true;
                    let result;
                    try { result = append.call(sink, Object.freeze(batch.map((item) => item.event))); }
                    finally { internal = false; }
                    result = await result;
                    const status = field(result, 'persistence');
                    const persistedIds = field(result, 'persistedEventIds');
                    if (!['persisted', 'disabled', 'memory-only'].includes(status)) throw new Error('Invalid sink result');
                    persistence = status;
                    batch.forEach((item, index) => {
                        // An enrichment during append needs its own identity-keyed upsert.
                        // Confirmation of the old version cannot acknowledge the new one.
                        if (item.revision === revisions[index]) {
                            item.delivered = true;
                            updatePersistence(item, status === 'persisted' && Array.isArray(persistedIds)
                                && !persistedIds.includes(item.event.eventId) ? 'memory-only' : status);
                        }
                    });
                } catch (_) {
                    sinkFailed = true;
                    persistence = 'failed';
                    batch.forEach((item) => updatePersistence(item, 'failed'));
                } finally {
                    batch.forEach((item) => { item.inFlight = false; });
                    trim();
                }
            }).catch(function isolateDrain() {
                sinkFailed = true;
                persistence = 'failed';
            }).then(function drained() {
                pending = null;
                if (!sinkFailed && Array.from(records.values()).some((item) => !item.delivered)) schedule();
            });
        }

        function updatePersistence(item, status) {
            if (item.event.persistence.diagnostics === status) return;
            const event = normalizer.sanitizeEvent({ ...item.event,
                persistence: { ...item.event.persistence, diagnostics: status } });
            replaceEvent(item, event);
        }

        function replaceEvent(item, event) {
            bytes -= item.bytes;
            item.event = event;
            item.bytes = contract.eventBytes(event) ?? contract.utf8Bytes(JSON.stringify(event));
            bytes += item.bytes;
        }

        function persistenceStatus() {
            const storage = storageStatus();
            if (storage && storage.persistence !== 'persisted') return storage.persistence;
            if (sinkFailed) return 'failed';
            if (pending) return 'pending';
            if (Array.from(records.values()).some((item) => item.event.persistence.diagnostics === 'memory-only')) return 'memory-only';
            return persistence;
        }

        function storageStatus() {
            try { return method(sink, 'status')?.call(sink); } catch (_) { return null; }
        }

        function storageChanged(change) {
            const state = field(change, 'status');
            if (!state) return;
            persistence = state.persistence;
            for (const item of records.values()) {
                const current = item.event.persistence.generation === state.generation
                    && item.event.timestamp > state.cutoff && !state.suspended && state.enabled;
                if (change.type === 'retry' && current && item.event.persistence.diagnostics !== 'persisted') {
                    item.delivered = false;
                    updatePersistence(item, 'memory-only');
                } else if (!current || state.failure) {
                    item.revision += 1; // Fence acknowledgements already in flight.
                    item.delivered = true;
                    updatePersistence(item, state.enabled ? 'memory-only' : 'disabled');
                }
            }
            trim();
            if (change.type === 'retry') { sinkFailed = false; schedule(); }
        }

        function report(input) {
            // Reentrant internal calls get a reference without buffering or scheduling work.
            if (reporting || internal) return normalizer.normalize(null).eventId;
            reporting = true;
            let event;
            try {
                const safeInput = {};
                ['code', 'module', 'action', 'error', 'newOccurrence', 'resource', 'correlation',
                    'correlationAliases', 'persistence', 'notification', 'retry', 'collection', 'breadcrumbs']
                    .forEach((key) => { safeInput[key] = field(input, key); });
                // Only sink confirmation can promote diagnostic persistence.
                const storage = storageStatus();
                safeInput.persistence = { operation: field(safeInput.persistence, 'operation'), diagnostics: 'memory-only',
                    generation: storage?.generation };
                if (safeInput.breadcrumbs === undefined) {
                    safeInput.breadcrumbs = crumbs.map((item) => ({ ...item, correlationAliases: item.correlation }));
                }
                if (safeInput.collection === undefined) {
                    safeInput.collection = { source: 'business', coverage: 'partial', aggregation: 'local' };
                }
                safeInput.collection = { source: field(safeInput.collection, 'source'),
                    coverage: field(safeInput.collection, 'coverage'), aggregation: field(safeInput.collection, 'aggregation'), entryCoverage };
                event = normalizer.normalize(safeInput);
                // Explicit cancellation is an observation, never a startup incident.
                if (field(input, 'cancelled') === true) {
                    event = normalizer.sanitizeEvent({ ...event, notification: { kind: 'none' } });
                }
                const existing = records.get(event.eventId);
                if (!existing) {
                    const size = contract.eventBytes(event) ?? contract.utf8Bytes(JSON.stringify(event));
                    records.set(event.eventId, { event, bytes: size, revision: 0, delivered: memoryOnlyConsole, inFlight: false });
                    bytes += size;
                } else if (classificationPriority(event) > classificationPriority(existing.event)) {
                    // The normalizer preserves identity, sequence and first-seen time.
                    // Keep a known browser location when the business boundary lacks one.
                    if (event.resource.path === 'unknown' && existing.event.resource.path !== 'unknown') {
                        event = normalizer.sanitizeEvent({ ...event, resource: existing.event.resource });
                    }
                    replaceEvent(existing, event);
                    existing.revision += 1;
                    existing.delivered = false;
                } else {
                    event = existing.event;
                }
                // Pin the canonical startup incident before capacity trimming, including
                // when enrichment grows an older record or rendering waits for the body.
                if (event.notification.kind === 'startup') startupId = event.eventId;
                trim();
                schedule();
                if (event.notification.kind === 'startup') showStartup(event.eventId);
                // Observers receive only normalized evidence, after capture. UI failures
                // cannot throw into reporting or recursively allocate more incidents.
                for (const observer of Array.from(observers)) {
                    try { Promise.resolve(observer(event)).catch(() => {}); } catch (_) { }
                }
                return event.eventId;
            } catch (_) {
                // The contract's fail-closed normalizer supplies a synchronous identity.
                return event ? event.eventId : normalizer.normalize(null).eventId;
            } finally { reporting = false; }
        }

        function breadcrumb(input, options) {
            try {
                if (field(options, 'detailed') === true && !storageStatus()?.detailedMode?.active) return;
                const normalized = utility.normalize({ breadcrumbs: [input] }).breadcrumbs[0];
                if (normalized) {
                    crumbs.push(normalized);
                    if (crumbs.length > contract.LIMITS.breadcrumbs) crumbs.shift();
                }
            } catch (_) { }
        }

        // Only the validated channel calls this ingress. Preserve origin identity and
        // lifecycle instead of allocating a local occurrence through report(). No UI,
        // observer callbacks, business acknowledgements, or retry actions run here.
        function acceptRelayed(input) {
            try {
                let event = normalizer.sanitizeEvent(input);
                const state = storageStatus();
                if (!event || event.windowId === normalizer.windowId || !state || !state.enabled || state.suspended
                    || !['active', 'reset-complete'].includes(state.phase) || state.failure === 'COORDINATION_UNAVAILABLE'
                    || event.persistence.generation === 'unknown' || event.persistence.generation !== state.generation
                    || event.timestamp <= state.cutoff) return false;
                const originPriority = classificationPriority(event);
                event = normalizer.sanitizeEvent({ ...event,
                    persistence: { ...event.persistence, diagnostics: 'memory-only' },
                    collection: { ...event.collection, source: 'relay', aggregation: 'incomplete' },
                    notification: { kind: 'none', requiresDismissal: false }, retry: { available: false } });
                const existing = records.get(event.eventId);
                if (existing && existing.event.timestamp !== event.timestamp) return false;
                if (!existing) {
                    const size = contract.eventBytes(event) ?? contract.utf8Bytes(JSON.stringify(event));
                    records.set(event.eventId, { event, bytes: size, revision: 0, delivered: false, inFlight: false, originPriority });
                    bytes += size;
                } else if (originPriority > (existing.originPriority ?? classificationPriority(existing.event))) {
                    replaceEvent(existing, event); existing.revision += 1; existing.delivered = false;
                    existing.originPriority = originPriority;
                }
                trim(); schedule();
                return records.has(event.eventId);
            } catch (_) { return false; }
        }

        function declareResource(target, declaration = {}) {
            try {
                const resource = utility.normalize({ resource: {
                    url: typeof target === 'string' ? target : field(declaration, 'url'),
                    optional: field(declaration, 'optional')
                } }).resource;
                if (typeof target === 'object' && target) {
                    elements.set(target, resource);
                    resourceErrors.delete(target); // A new declared load is a new attempt.
                }
                // Unknown or user-owned URLs never become registry keys.
                if (resource.path !== 'unknown') resources.set(resource.path, resource);
                breadcrumb({ module: 'bootstrap', action: 'load-resource', outcome: 'started' }, { detailed: true });
            } catch (_) { }
        }

        function resourceFailure(target, error) {
            try {
                let identity = resourceErrors.get(target);
                if (!identity) {
                    // This registry retains only a code-owned identity token, never a raw
                    // browser/loader payload, private URL, or local stack from the caller.
                    identity = new Error(contract.MESSAGES.RESOURCE_LOAD_FAILED);
                    identity.stack = '';
                    resourceErrors.set(target, identity);
                }
                const url = target.src || target.href;
                const location = utility.normalize({ resource: { url } }).resource;
                const declaration = elements.get(target) || resources.get(location.path);
                // Declared by the entry before its media sources are parsed/loaded.
                const optionalMedia = field(options, 'optionalMedia') === true
                    && ['AUDIO', 'VIDEO', 'SOURCE'].includes(String(target.tagName || '').toUpperCase());
                const optional = declaration ? declaration.optional : optionalMedia ? true : 'unknown';
                report({ code: 'RESOURCE_LOAD_FAILED', module: 'bootstrap', action: 'load-resource',
                    error: identity, resource: { url, optional },
                    notification: { kind: optional === false ? (startup ? 'startup' : 'persistent') : 'none' },
                    collection: { source: 'resource', coverage: 'partial', aggregation: 'local' } });
                return identity;
            } catch (_) { return error; }
        }

        function globalFailure(error, location) {
            const checked = utility.normalize({ error, resource: location });
            const declaration = resources.get(checked.resource.path);
            const expected = checked.error.name === 'AbortError' || isNativeAbort(error)
                || (declaration && declaration.optional === true);
            return report({ code: startup && !expected ? 'APP_BOOT_FAILED' : 'UNEXPECTED_RUNTIME_ERROR',
                module: startup ? 'bootstrap' : 'main', action: startup ? 'initialize' : 'report', error,
                resource: { ...location, optional: declaration ? declaration.optional : undefined },
                notification: { kind: startup && !expected ? 'startup' : 'none' },
                collection: { source: handedOff ? 'global' : 'bootstrap', coverage: 'partial', aggregation: 'local' } });
        }

        function captureError(event) {
            if (internal) return;
            try {
                if (event.target && event.target !== global && (event.target.src || event.target.href)) {
                    resourceFailure(event.target);
                } else {
                    globalFailure(event.error || event, { url: event.filename, line: event.lineno, column: event.colno });
                }
            } catch (_) { }
            // Do not preventDefault, return true, or echo the browser's exception to console.
        }

        function captureRejection(event) {
            if (internal) return;
            try { globalFailure(event.reason); } catch (_) { }
        }

        function getIncident(eventId) { storageStatus(); return records.get(eventId)?.event || null; }

        function snapshot(query = {}) {
            const storage = storageStatus();
            const id = field(query, 'eventId');
            const requested = field(query, 'limit');
            const limit = Number.isSafeInteger(requested) ? Math.max(0, Math.min(MAX_EVENTS, requested)) : MAX_EVENTS;
            const matching = Array.from(records.values()).map((item) => item.event).filter((event) => !id || event.eventId === id);
            const events = limit ? matching.slice(-limit).map(normalizer.sanitizeEvent).filter(Boolean) : [];
            return Object.freeze({ schemaVersion: 1, events: Object.freeze(events), persistence: persistenceStatus(), coverage: 'partial',
                entryCoverage,
                truncated: dropped > 0 || matching.length > events.length, ...(storage ? { storage } : {}),
                ...(transport ? { transport: transportStatus() } : {}) });
        }

        function exportText(eventId = startupId) {
            try {
                const current = snapshot();
                const chosen = current.events.find((event) => event.eventId === eventId);
                const ordered = current.events.filter((event) => event !== chosen).reverse();
                if (chosen) ordered.unshift(chosen);
                const output = { schemaVersion: 1, persistence: current.persistence, coverage: 'partial',
                    entryCoverage: current.entryCoverage,
                    truncated: current.truncated, ...(current.storage ? { storage: current.storage } : {}),
                    ...(current.transport ? { transport: current.transport } : {}),
                    notice: 'Local diagnostics; not an answer backup.', events: [] };
                // JSON event payloads are immutable and already sized by the
                // contract. Account for array commas without serializing the
                // growing report once per event.
                let outputBytes = contract.utf8Bytes(JSON.stringify(output));
                for (const event of ordered) {
                    const eventSize = contract.eventBytes(event) ?? contract.utf8Bytes(JSON.stringify(event));
                    const nextBytes = outputBytes + eventSize + (output.events.length ? 1 : 0);
                    if (nextBytes > TEXT_BYTES - 32) {
                        output.truncated = true;
                        break;
                    }
                    output.events.push(event);
                    outputBytes = nextBytes;
                }
                return JSON.stringify(output);
            } catch (_) { return 'Local diagnostic export unavailable. No practice data was changed.'; }
        }

        function showStartup(eventId) {
            startupId = eventId;
            if (fallbackFailed) return;
            try {
                const doc = global.document;
                if (!doc || !doc.body) {
                    if (doc && !waitingForBody) {
                        waitingForBody = true;
                        doc.addEventListener('DOMContentLoaded', function renderWhenReady() {
                            waitingForBody = false;
                            showStartup(startupId);
                        }, { once: true });
                    }
                    return;
                }
                internal = true;
                if (!panel) {
                    const root = doc.createElement('section');
                    root.id = 'diagnostic-startup-failure';
                    root.setAttribute('role', 'alert');
                    root.style.cssText = 'position:fixed;inset:16px 16px auto;z-index:2147483647;max-height:85vh;overflow:auto;padding:20px;background:#fff;color:#17202a;border:2px solid #a11;border-radius:8px;font:16px/1.5 system-ui;white-space:normal;';
                    const heading = doc.createElement('h2');
                    const explanation = doc.createElement('p');
                    const reference = doc.createElement('p');
                    const button = doc.createElement('button');
                    button.type = 'button';
                    button.textContent = '导出诊断';
                    const details = doc.createElement('details');
                    const summary = doc.createElement('summary');
                    summary.textContent = '查看或复制诊断文本';
                    const text = doc.createElement('textarea');
                    text.readOnly = true;
                    text.rows = 8;
                    text.style.cssText = 'display:block;width:100%;color:#17202a;background:#fff;font:12px monospace;';
                    text.setAttribute('aria-label', '诊断文本');
                    details.appendChild(summary);
                    details.appendChild(text);
                    details.addEventListener('toggle', function refreshText() {
                        try { if (details.open) text.value = panel?.exportedText || exportText(); } catch (_) { }
                    });
                    button.addEventListener('click', async function download() {
                        // The full exporter is optional. Missing/broken bundles retain
                        // the bootstrap's independent synchronous text path below.
                        const exporter = global.AppDiagnosticExport;
                        const richDownload = method(exporter, 'download');
                        if (richDownload) {
                            try {
                                const result = await richDownload.call(exporter, { eventId: startupId }, { textTarget: text });
                                if (result?.status === 'download-started') return;
                                // Only a generated report can replace bootstrap evidence.
                                // Delivery failures keep its summary; generation failures
                                // must continue through the independent minimal export.
                                if (result?.status === 'text-fallback' && result.report
                                    && !result.report.issues?.includes('export-generation-failed')) {
                                    panel.exportedText = result.text;
                                    details.open = true; text.focus(); text.select(); return;
                                }
                            } catch (_) { }
                        }
                        panel.exportedText = null;
                        let url;
                        try {
                            text.value = exportText();
                            url = global.URL.createObjectURL(new global.Blob([text.value], { type: 'text/plain;charset=utf-8' }));
                            const link = doc.createElement('a');
                            link.href = url;
                            link.download = 'ielts-startup-diagnostics.txt';
                            root.appendChild(link);
                            try { link.click(); } finally { root.removeChild(link); }
                        } catch (_) {
                            try { details.open = true; text.value = exportText(); text.focus(); text.select(); } catch (_) { }
                        } finally {
                            if (url) {
                                try { global.setTimeout(function release() { try { global.URL.revokeObjectURL(url); } catch (_) { } }, 1000); }
                                catch (_) { try { global.URL.revokeObjectURL(url); } catch (_) { } }
                            }
                        }
                    });
                    [heading, explanation, reference, button, details].forEach((node) => root.appendChild(node));
                    doc.body.appendChild(root);
                    panel = { root, heading, explanation, reference, text, details };
                }
                panel.root.style.position = 'fixed';
                panel.root.setAttribute('role', 'alert');
                panel.heading.textContent = '应用启动失败';
                panel.explanation.textContent = '请保留此页面，并导出诊断信息以便排查。诊断信息不包含答案，也不是练习备份。';
                panel.reference.textContent = '事件编号：' + startupId;
                panel.exportedText = null;
                if (panel.details.open) panel.text.value = exportText();
            } catch (_) {
                fallbackFailed = true;
                // One plain-text attempt, with no logger, reporter call, timers, or retry loop.
                try {
                    const pre = global.document.createElement('pre');
                    pre.textContent = '应用启动失败。事件编号：' + startupId + '\n' + exportText();
                    global.document.body.appendChild(pre);
                } catch (_) { }
            } finally { internal = false; }
        }

        function startupFailed(error) {
            if (internal) return normalizer.normalize(null).eventId;
            const id = report({ code: 'APP_BOOT_FAILED', module: 'main', action: 'initialize', error,
                notification: { kind: 'startup' } });
            showStartup(id);
            return id;
        }

        function captureConsole(level, args) {
            if (level !== 'error' || internal) return;
            try {
                let error;
                const length = Math.min(field(args, 'length') || 0, 20);
                for (let i = 0; i < length; i += 1) {
                    const value = field(args, String(i));
                    if (value && typeof value === 'object') {
                        // Select an Error only; never retain arbitrary argument objects or text.
                        const checked = utility.normalize({ error: value }).error;
                        if (checked.name !== 'unknown' && checked.kind === 'object') { error = value; break; }
                    }
                }
                // Keep console evidence during asynchronous delivery in memory, but do not
                // feed a sink's own asynchronous logging back into that sink indefinitely.
                memoryOnlyConsole = !!pending;
                report({ code: 'UNEXPECTED_RUNTIME_ERROR', module: 'logger', action: 'report', error,
                    collection: { source: 'console', coverage: 'partial', aggregation: 'local' } });
            } catch (_) { } finally { memoryOnlyConsole = false; }
        }

        installed = Object.freeze({
            report, breadcrumb, getIncident, snapshot, exportText, declareResource, resourceFailure,
            // Allocate local aliases or revalidate aliases from an authenticated handshake.
            // This never records the raw identifiers or changes already captured evidence.
            correlate(correlation, aliases) {
                return utility.normalize(aliases === undefined ? { correlation } : { correlationAliases: aliases }).correlation;
            },
            startupFailed, captureConsole, acceptRelayed, windowId: normalizer.windowId,
            attachTransport(next) { if (method(next, 'status')) transport = next; },
            subscribe(observer) {
                if (typeof observer !== 'function' || observers.size >= 16) return () => {};
                observers.add(observer);
                return () => observers.delete(observer);
            },
            markReady() {
                startup = false;
                // Retain the incident and export controls without covering the recovered app.
                try {
                    if (panel) {
                        panel.root.style.position = 'static';
                        panel.root.setAttribute('role', 'region');
                        panel.root.setAttribute('aria-label', '启动故障诊断');
                        panel.heading.textContent = '启动故障记录';
                        panel.explanation.textContent = '应用已完成启动，诊断信息保留供排查。诊断信息不包含答案，也不是练习备份。';
                    }
                } catch (_) { }
            },
            handoff() { handedOff = true; return installed; },
            attachSink(next) {
                if (sink === next) return;
                // A single sink owns delivery; replacing it requires an explicit future lifecycle API.
                const candidate = method(next, 'append');
                if (sink || !candidate) return;
                sink = next;
                append = candidate;
                const state = storageStatus();
                if (state) {
                    // Only this page's pre-sink bootstrap evidence may adopt the
                    // initial generation. Relayed records must carry their origin's.
                    for (const item of records.values()) {
                        if (item.event.persistence.generation === 'unknown' && item.event.collection.source !== 'relay'
                            && item.event.timestamp > state.cutoff) {
                            replaceEvent(item, normalizer.sanitizeEvent({ ...item.event,
                                persistence: { ...item.event.persistence, generation: state.generation } }));
                        }
                    }
                    storageChanged({ type: 'barrier', status: state });
                    method(next, 'subscribe')?.call(next, storageChanged);
                }
                persistence = 'memory-only';
                schedule();
            },
            retrySink() {
                const retry = method(sink, 'retry');
                if (retry) return retry.call(sink);
                if (!sinkFailed || pending) return;
                sinkFailed = false;
                persistence = 'pending';
                schedule();
            },
            async flush() {
                schedule();
                while (pending) await pending;
                return Object.freeze({ persistence: persistenceStatus() });
            },
            status() {
                return Object.freeze({ events: records.size, bytes, dropped, persistence: persistenceStatus(), handedOff, fallbackFailed,
                    ...(storageStatus() ? { storage: storageStatus() } : {}),
                    ...(transport ? { transport: transportStatus() } : {}) });
            }
        });
        for (const key of ['requiredResources', 'optionalResources']) {
            const list = field(options, key);
            if (Array.isArray(list)) list.slice(0, 100).forEach((url) => declareResource(url, { optional: key === 'optionalResources' }));
        }
        if (typeof global.addEventListener === 'function') {
            global.addEventListener('error', captureError, true);
            global.addEventListener('unhandledrejection', captureRejection);
        }
        return installed;
    }
    global.AppDiagnosticBootstrap = Object.freeze({ install, current: () => installed || null });
})(typeof globalThis !== 'undefined' ? globalThis : this);
