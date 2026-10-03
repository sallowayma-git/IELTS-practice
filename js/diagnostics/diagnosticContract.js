(function installDiagnosticContract(global) {
    'use strict';

    if (global.AppDiagnosticContract) return;

    const SCHEMA_VERSION = 1;
    const LIMITS = Object.freeze({
        eventBytes: 8192, stackFrames: 20, causeDepth: 3, breadcrumbs: 50,
        inputStringUnits: 8192, correlationEntries: 1024, correlationIdUnits: 512,
        repetitionWindowMs: 60000, snapshotEvents: 200
    });
    const CODES = Object.freeze([
        'APP_BOOT_FAILED', 'RESOURCE_LOAD_FAILED', 'PRACTICE_SAVE_FAILED',
        'RECOVERY_SAVE_FAILED', 'PRACTICE_CHANNEL_TIMEOUT', 'DATA_IMPORT_FAILED',
        'DATA_EXPORT_FAILED', 'UNEXPECTED_RUNTIME_ERROR'
    ]);
    const CAUSE_CODES = Object.freeze([
        'BACKEND_UNAVAILABLE', 'QUOTA_EXCEEDED', 'CONFLICT', 'CORRUPT_RECORD', 'VALIDATION',
        'INITIALIZATION_BLOCKED', 'TIMING_FINALIZED', 'TIMING_STALE_WRITER', 'TIMING_STALE_REVISION'
    ]);
    const ERROR_NAMES = [
        'Error', 'AppDataError', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
        'URIError', 'EvalError', 'AggregateError', 'DOMException', 'QuotaExceededError',
        'AbortError', 'SecurityError', 'NotFoundError', 'NetworkError', 'UnknownError'
    ];
    const MESSAGES = Object.freeze({
        APP_BOOT_FAILED: 'Application startup failed.',
        RESOURCE_LOAD_FAILED: 'A resource could not be loaded.',
        PRACTICE_SAVE_FAILED: 'Practice persistence failed.',
        RECOVERY_SAVE_FAILED: 'Recovery persistence failed.',
        PRACTICE_CHANNEL_TIMEOUT: 'Practice communication timed out.',
        DATA_IMPORT_FAILED: 'Data import failed.',
        DATA_EXPORT_FAILED: 'Data export failed.',
        UNEXPECTED_RUNTIME_ERROR: 'An unexpected runtime error occurred.'
    });
    const MODULES = ['bootstrap', 'main', 'practice', 'reading', 'listening', 'suite',
        'logger', 'data-kernel', 'storage', 'import', 'export', 'diagnostics', 'channel'];
    const ACTIONS = ['initialize', 'load-resource', 'open-practice', 'handshake', 'submit',
        'host-receipt', 'acknowledgement', 'save', 'save-draft', 'save-recovery', 'storage-confirmed',
        'suite-navigation', 'import', 'export', 'retry', 'reset', 'report'];
    const RETRY_ACTIONS = ['submit', 'save', 'save-draft', 'save-recovery', 'import', 'export', 'load-resource'];
    const SOURCES = ['bootstrap', 'business', 'console', 'global', 'resource', 'storage', 'relay'];
    const CORRELATION_KINDS = ['session', 'suite', 'submission', 'operation'];
    const COVERAGE_LIMITATIONS = Object.freeze([
        'javascript-disabled', 'page-not-opened', 'process-crash', 'blocked-main-thread',
        'cross-origin-details'
    ]);
    // Exact code-owned paths only: arbitrary resource names can contain learning data.
    // Extend this list when an integration needs another shipped resource.
    const PROJECT_PATHS = Object.freeze([
        'index.html', 'js/app.js', 'js/main.js', 'js/utils/logger.js',
        'js/presentation/incident-center.js', 'js/presentation/message-center.js',
        'js/data/v2/dataKernel.js', 'js/data/v2/appData.js',
        'js/diagnostics/diagnosticContract.js',
        'js/diagnostics/bootstrapCollector.js', 'js/diagnostics/diagnosticReporter.js', 'js/diagnostics/operationDiagnostics.js',
        'js/diagnostics/diagnosticStore.js', 'js/diagnostics/diagnosticExport.js', 'js/diagnostics/diagnosticChannel.js',
        'js/runtime/lazyLoader.js', 'js/runtime/bootScreen.js', 'js/boot-fallbacks.js',
        'css/main.css', 'css/incident-center.css', 'css/heroui-bridge.css', 'css/theme-switcher-scroll.css',
        'css/onboarding.css', 'css/vocab-reader.css', 'assets/vendor/three.min.js',
        'assets/images/favicon.svg', 'assets/images/logo.svg',
        'assets/generated/listening-exams/manifest.js',
        'assets/generated/listening-exams/listening-index.compat.js',
        'assets/generated/reading-exams/manifest.js',
        'assets/generated/reading-explanations/manifest.js',
        'js/runtime/unifiedReadingPage.js',
        'js/listeningRecordBridge.js', 'js/listeningUnifiedWrapper.js', 'js/practice-page-enhancer.js',
        'js/diagnostics/practiceDiagnosticBootstrap.js', 'js/diagnostics/practiceDiagnostics.js',
        'assets/generated/reading-exams/reading-practice-unified.html',
        'assets/generated/listening-exams/listening-practice-unified.html',
        ...['runtime-entry', 'core-foundation', 'ui-shell', 'legacy-app', 'browse',
            'diagnostics', 'practice', 'session', 'reading-page', 'practice-page-enhancer',
            'listening-record-bridge', 'listening-wrapper', 'vocabulary', 'reading-tools',
            'reading-library', 'dictionary', 'more', 'theme']
            .map((name) => `js/bundles/${name}.bundle.js`)
    ]);
    const EVENT_ID = /^evt_[a-f0-9]{32}_[1-9][0-9]{0,15}$/;
    const WINDOW_ID = /^win_[a-f0-9]{32}$/;
    const SCOPE_ID = /^scope_[a-f0-9]{32}$/;
    const ALIAS_ID = /^alias_(session|suite|submission|operation)_[a-f0-9]{32}$/;
    const scopeInternals = new WeakMap();
    const identityInternals = new WeakMap();
    // Membership is provenance: only code-owned, fully projected and deeply
    // frozen events enter this cache. Frozen external inputs are still untrusted.
    const validatedEvents = new WeakMap();
    const readingResourcePaths = new Set();
    try {
        const resources = Object.getOwnPropertyDescriptor(global.AppDiagnosticBuild, 'readingResources')?.value;
        if (Array.isArray(resources)) {
            for (let i = 0; i < Math.min(resources.length, 1024); i += 1) {
                const value = Object.getOwnPropertyDescriptor(resources, String(i))?.value;
                if (typeof value === 'string' && /^assets\/generated\/reading-(?:exams|explanations)\/p[123]-(?:high|medium|low)-[0-9]{2,3}\.js$/.test(value)) readingResourcePaths.add(value);
            }
        }
    } catch (_) { }
    let nativeDOMExceptionName;
    try { nativeDOMExceptionName = Object.getOwnPropertyDescriptor(global.DOMException.prototype, 'name')?.get; } catch (_) { }

    function platformErrorName(value) {
        try { return nativeDOMExceptionName?.call(value); } catch (_) { return undefined; }
    }

    function objectLike(value) { return value !== null && (typeof value === 'object' || typeof value === 'function'); }
    function state() { return { issues: new Set(), stackFrames: 0 }; }
    function field(value, key, context) {
        if (!objectLike(value)) return undefined;
        try {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor) return undefined;
            if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                context.issues.add('accessor-skipped');
                return undefined;
            }
            return descriptor.value;
        } catch (_) {
            context.issues.add('unreadable');
            return undefined;
        }
    }
    function choice(value, values, fallback = 'unknown') {
        return typeof value === 'string' && values.includes(value) ? value : fallback;
    }
    function errorName(value, context) {
        // Native Error names are usually inherited. Inspect descriptors without calling getters.
        let current = value;
        for (let depth = 0; objectLike(current) && depth < 4; depth += 1) {
            const name = field(current, 'name', context);
            if (name !== undefined) return choice(name, ERROR_NAMES);
            if (context.issues.has('accessor-skipped') || context.issues.has('unreadable')) break;
            try { current = Object.getPrototypeOf(current); }
            catch (_) { context.issues.add('unreadable'); break; }
        }
        return 'unknown';
    }
    function integer(value, min, max, fallback = null) {
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
    }
    function matches(value, expression) {
        return typeof value === 'string' && value.length <= 128 && expression.test(value);
    }
    function textInput(value, context) {
        if (typeof value !== 'string') return '';
        if (value.length > LIMITS.inputStringUnits) {
            context.issues.add('input-truncated');
            return ''; // Do not cut a URL or secret in half and reinterpret its suffix.
        }
        return value;
    }
    function arrayLength(value, context) {
        try {
            return Array.isArray(value) ? integer(field(value, 'length', context), 0, 4294967295, 0) : 0;
        } catch (_) { context.issues.add('unreadable'); return 0; }
    }
    function randomHex() {
        const bytes = new Uint8Array(16);
        try {
            global.crypto.getRandomValues(bytes);
        } catch (_) {
            // Identifiers are correlation references, never authentication tokens.
            for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
        }
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    function freeze(value) {
        if (value && typeof value === 'object') {
            Object.values(value).forEach(freeze);
            Object.freeze(value);
        }
        return value;
    }
    function utf8Bytes(value) {
        if (typeof value !== 'string') return 0;
        let bytes = 0;
        for (let i = 0; i < value.length; i += 1) {
            const code = value.charCodeAt(i);
            if (code < 0x80) bytes += 1;
            else if (code < 0x800) bytes += 2;
            else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length
                && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) {
                bytes += 4;
                i += 1;
            } else bytes += 3;
        }
        return bytes;
    }

    function createCorrelationScope() {
        const id = `scope_${randomHex()}`;
        const entries = new Map();
        let disposed = false;
        const alias = (kind, value) => {
            if (disposed || !CORRELATION_KINDS.includes(kind) || typeof value !== 'string'
                || !value.length || value.length > LIMITS.correlationIdUnits) return 'unknown';
            const key = `${kind}:${value}`;
            if (entries.has(key)) return entries.get(key);
            if (entries.size >= LIMITS.correlationEntries) return 'unknown';
            const result = `alias_${kind}_${randomHex()}`;
            entries.set(key, result);
            return result;
        };
        const scope = Object.freeze({ id, alias, dispose() { disposed = true; entries.clear(); } });
        scopeInternals.set(scope, { id, alias });
        return scope;
    }

    function createWindowIdentity() {
        const nonce = randomHex();
        const identity = Object.freeze({ windowId: `win_${nonce}` });
        identityInternals.set(identity, { nonce, windowId: identity.windowId, sequence: 0, errors: new WeakMap() });
        return identity;
    }

    function location(value, context, browserFrame = false) {
        let text = textInput(value, context).trim().replace(/\)$/, '');
        // Browsers append positions after the entire URL, including its query/fragment.
        // A plain resource URL has no such suffix; never interpret its query as a position.
        if (!browserFrame) text = text.split(/[?#]/, 1)[0];
        const suffix = /:(\d{1,10})(?::(\d{1,10}))?$/.exec(text);
        let line = null;
        let column = null;
        if (suffix) {
            line = integer(Number(suffix[1]), 1, 2147483647);
            column = suffix[2] ? integer(Number(suffix[2]), 1, 2147483647) : null;
            text = text.slice(0, suffix.index);
        }
        // A query or fragment must never supply an allowlisted project path.
        text = text.split(/[?#]/, 1)[0].replace(/\\/g, '/');
        const readingPath = text.match(/(?:^|\/)(assets\/generated\/reading-(?:exams|explanations)\/[^/]+)$/)?.[1];
        const path = PROJECT_PATHS.find((candidate) => text === candidate || text.endsWith(`/${candidate}`))
            || (readingResourcePaths.has(readingPath) ? readingPath : null);
        return { path: path || 'unknown', line: path ? line : null, column: path ? column : null };
    }
    function frame(value, context) {
        if (typeof value === 'string') {
            let text = textInput(value, context).trim();
            const prefix = text.split(/[?#]/, 1)[0];
            if (prefix.includes('(')) text = text.slice(prefix.lastIndexOf('(') + 1);
            else if (prefix.includes('@')) text = text.slice(prefix.lastIndexOf('@') + 1);
            else text = text.replace(/^at\s+/, '');
            return location(text, context, true);
        }
        const result = location(field(value, 'path', context), context);
        if (result.path !== 'unknown') {
            result.line = integer(field(value, 'line', context), 1, 2147483647, result.line);
            result.column = integer(field(value, 'column', context), 1, 2147483647, result.column);
        }
        return result;
    }
    function stack(value, context) {
        const output = [];
        let values = value;
        if (typeof value === 'string') {
            values = textInput(value, context).split(/\r?\n/).filter((line) => /^\s*at\s/.test(line) || line.includes('@'));
        }
        const length = arrayLength(values, context);
        const remaining = LIMITS.stackFrames - context.stackFrames;
        if (length > remaining) context.issues.add('stack-truncated');
        for (let i = 0; i < Math.min(length, remaining); i += 1) {
            output.push(frame(field(values, String(i), context), context));
            context.stackFrames += 1;
        }
        return output;
    }
    function errorCause(value, context) {
        const cause = field(value, 'cause', context);
        return cause == null ? field(field(value, 'details', context), 'cause', context) : cause;
    }
    function errorDetails(value, context, depth = 0, seen = new Set()) {
        const result = { name: 'unknown', message: '[redacted]', code: 'unknown', kind: 'unknown', stack: [], cause: null };
        if (!objectLike(value)) {
            result.kind = choice(typeof value, ['string', 'number', 'boolean', 'bigint', 'symbol', 'undefined']);
            return result;
        }
        if (seen.has(value)) { result.kind = 'cycle'; context.issues.add('cause-cycle'); return result; }
        seen.add(value);
        result.kind = 'object';
        const nativeName = platformErrorName(value);
        const name = nativeName || errorName(value, context);
        const message = field(value, 'message', context);
        result.name = choice(name, ERROR_NAMES);
        result.code = result.name === 'AppDataError' ? choice(field(value, 'code', context), CAUSE_CODES)
            : result.name === 'QuotaExceededError' ? 'QUOTA_EXCEEDED' : 'unknown';
        result.message = choice(message, Object.values(MESSAGES).concat('[redacted]'), '[redacted]');
        if (typeof message === 'string' && message.length > LIMITS.inputStringUnits) context.issues.add('input-truncated');
        if (integer(field(value, 'nodeType', context), 1, 12)) {
            result.kind = 'dom';
            return result;
        }
        // Do not materialize a lazy Error stack after discovering hostile accessors.
        if (!context.issues.has('accessor-skipped') && !context.issues.has('unreadable')) {
            result.stack = stack(field(value, 'stack', context), context);
        }
        const cause = errorCause(value, context);
        if (cause != null) {
            if (depth < LIMITS.causeDepth) result.cause = errorDetails(cause, context, depth + 1, seen);
            else context.issues.add('causes-truncated');
        }
        // Preserve explicit markers when sanitizing an already normalized record.
        result.kind = choice(field(value, 'kind', context), ['object', 'cycle', 'dom', 'string',
            'number', 'boolean', 'bigint', 'symbol', 'undefined', 'unknown'], result.kind);
        return result;
    }
    function causeCode(error) {
        let current = error;
        while (current) {
            if (current.code !== 'unknown') return current.code;
            current = current.cause;
        }
        return 'unknown';
    }
    function environment(value, context) {
        const browserVersion = field(value, 'browserVersion', context);
        return {
            runMode: choice(field(value, 'runMode', context), ['file', 'http', 'subpath']),
            browser: choice(field(value, 'browser', context), ['chromium', 'firefox', 'safari']),
            browserVersion: matches(browserVersion, /^\d{1,3}(?:\.\d{1,5}){0,3}$/) ? browserVersion : 'unknown',
            platform: choice(field(value, 'platform', context), ['windows', 'macos', 'linux', 'android', 'ios']),
            online: choice(field(value, 'online', context), ['online', 'offline']),
            context: choice(field(value, 'context', context), ['main', 'reading', 'listening', 'legacy', 'worker'])
        };
    }
    function correlations(value, scope, context, wire) {
        const output = { scopeId: scope.id };
        if (wire) {
            const scopeId = field(value, 'scopeId', context);
            output.scopeId = matches(scopeId, SCOPE_ID) ? scopeId : 'unknown';
        }
        for (const kind of CORRELATION_KINDS) {
            const raw = field(value, kind, context);
            output[kind] = wire
                ? (output.scopeId !== 'unknown' && matches(raw, ALIAS_ID) && raw.startsWith(`alias_${kind}_`) ? raw : 'unknown')
                : scope.alias(kind, raw);
        }
        return output;
    }
    function breadcrumbs(value, scope, context, wire) {
        const length = arrayLength(value, context);
        if (length > LIMITS.breadcrumbs) context.issues.add('breadcrumbs-truncated');
        const output = [];
        for (let i = Math.max(0, length - LIMITS.breadcrumbs); i < length; i += 1) {
            const item = field(value, String(i), context);
            const action = choice(field(item, 'action', context), ACTIONS);
            if (action === 'unknown') continue; // No keystrokes, DOM events, or free-form messages.
            output.push({
                action, module: choice(field(item, 'module', context), MODULES),
                timestamp: integer(field(item, 'timestamp', context), 0, 8640000000000000),
                outcome: choice(field(item, 'outcome', context), ['started', 'succeeded', 'failed', 'unconfirmed', 'cancelled']),
                correlation: correlations(!wire && field(item, 'correlationAliases', context) !== undefined
                    ? field(item, 'correlationAliases', context) : field(item, 'correlation', context),
                    scope, context, wire || field(item, 'correlationAliases', context) !== undefined)
            });
        }
        return output;
    }
    function fingerprint(event) {
        // Only normalized fields enter this non-cryptographic grouping hash.
        const parts = [event.code, event.causeCode, event.module, event.action, event.error.name,
            event.error.stack[0] || null, event.resource.path];
        const text = JSON.stringify(parts);
        let hash = 2166136261;
        for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
        return `fp_${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }
    function bound(event, context) {
        event.collection.issues = Array.from(context.issues).sort();
        let bytes;
        const size = () => {
            bytes = utf8Bytes(JSON.stringify(event));
            return bytes;
        };
        if (size() > LIMITS.eventBytes) {
            context.issues.add('event-truncated');
            context.issues.add('breadcrumbs-truncated');
            event.collection.issues = Array.from(context.issues).sort();
            while (event.breadcrumbs.length && size() > LIMITS.eventBytes) event.breadcrumbs.shift();
            if (size() > LIMITS.eventBytes) {
                context.issues.add('stack-truncated');
                event.collection.issues = Array.from(context.issues).sort();
                // Keep the first frame (part of the fingerprint) and all cause codes.
                const errors = [];
                for (let error = event.error; error; error = error.cause) errors.push(error);
                for (const error of errors.reverse()) {
                    while (error.stack.length > (error === event.error ? 1 : 0) && size() > LIMITS.eventBytes) {
                        error.stack.pop();
                        context.issues.add('stack-truncated');
                    }
                }
                event.collection.issues = Array.from(context.issues).sort();
            }
            // The final issue list can change after the last trimming check.
            size();
        }
        const immutable = freeze(event);
        validatedEvents.set(immutable, { bytes });
        return immutable;
    }

    function eventBytes(input) {
        // Do not serialize unknown caller objects: even a frozen object may
        // contain getters, mutable children, or a hostile toJSON callback.
        return validatedEvents.get(input)?.bytes ?? null;
    }

    function createNormalizer(options = {}) {
        const setup = state();
        const candidate = field(options, 'correlationScope', setup);
        const scope = scopeInternals.get(candidate) || scopeInternals.get(createCorrelationScope());
        const origin = identityInternals.get(field(options, 'windowIdentity', setup))
            || identityInternals.get(createWindowIdentity());
        const windowId = origin.windowId;
        const identities = origin.errors;
        const appVersion = field(options, 'appVersion', setup);
        const buildId = field(options, 'buildId', setup);
        const defaults = {
            appVersion: matches(appVersion, /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-(?:alpha|beta|rc|fix)(?:\.\d{1,4})?)?$/) ? appVersion : 'unknown',
            buildId: matches(buildId, /^(?:sha256:[a-f0-9]{64}|git:[a-f0-9]{40})$/) ? buildId : 'unknown',
            environment: environment(field(options, 'environment', setup), setup)
        };
        function freshIdentity() {
            origin.sequence += 1;
            return { eventId: `evt_${origin.nonce}_${origin.sequence}`, windowId,
                sequence: origin.sequence, timestamp: Date.now() };
        }
        function identify(error, fresh, context) {
            const chain = [];
            let current = error;
            let existing;
            for (let depth = 0; objectLike(current) && depth <= LIMITS.causeDepth; depth += 1) {
                if (chain.includes(current)) break;
                chain.push(current);
                if (!fresh && identities.has(current)) { existing = identities.get(current); break; }
                current = errorCause(current, context);
            }
            const identity = existing || freshIdentity();
            // A new occurrence must not steal the identity of a shared underlying cause.
            for (const item of fresh ? chain.slice(0, 1) : chain) identities.set(item, identity);
            return identity;
        }
        function project(input, identity, context, wire) {
            const error = errorDetails(field(input, 'error', context), context);
            const rawResource = field(input, 'resource', context);
            const resource = wire ? frame(rawResource, context) : location(field(rawResource, 'url', context), context);
            if (!wire && resource.path !== 'unknown') {
                resource.line = integer(field(rawResource, 'line', context), 1, 2147483647, resource.line);
                resource.column = integer(field(rawResource, 'column', context), 1, 2147483647, resource.column);
            }
            resource.status = integer(field(rawResource, 'status', context), 100, 599, 'unknown');
            const optional = field(rawResource, 'optional', context);
            resource.optional = typeof optional === 'boolean' ? optional : 'unknown';
            const persistence = field(input, 'persistence', context);
            const collection = field(input, 'collection', context);
            const entryCoverage = sanitizeEntryCoverage(field(collection, 'entryCoverage', context));
            const notification = field(input, 'notification', context);
            const retry = field(input, 'retry', context);
            const aliases = wire ? undefined : field(input, 'correlationAliases', context);
            const correlation = correlations(aliases === undefined ? field(input, 'correlation', context) : aliases,
                scope, context, wire || aliases !== undefined);
            const version = wire ? field(input, 'appVersion', context) : defaults.appVersion;
            const build = wire ? field(input, 'buildId', context) : defaults.buildId;
            const event = {
                schemaVersion: SCHEMA_VERSION,
                appVersion: matches(version, /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-(?:alpha|beta|rc|fix)(?:\.\d{1,4})?)?$/) ? version : 'unknown',
                buildId: matches(build, /^(?:sha256:[a-f0-9]{64}|git:[a-f0-9]{40})$/) ? build : 'unknown',
                ...identity,
                fingerprint: '',
                code: choice(field(input, 'code', context), CODES, 'UNEXPECTED_RUNTIME_ERROR'),
                causeCode: causeCode(error),
                module: choice(field(input, 'module', context), MODULES),
                action: choice(field(input, 'action', context), ACTIONS),
                repetitionCount: 1,
                error, resource, correlation,
                environment: wire ? environment(field(input, 'environment', context), context) : { ...defaults.environment },
                persistence: {
                    operation: choice(field(persistence, 'operation', context), ['committed', 'not-committed', 'unconfirmed'], 'unconfirmed'),
                    diagnostics: choice(field(persistence, 'diagnostics', context), ['memory-only', 'pending', 'persisted', 'disabled', 'failed'], 'memory-only'),
                    generation: matches(field(persistence, 'generation', context), /^dg-[a-f0-9]{32}$/)
                        ? field(persistence, 'generation', context) : 'unknown'
                },
                notification: {
                    kind: choice(field(notification, 'kind', context), ['none', 'transient', 'persistent', 'dialog', 'startup'], 'none'),
                    requiresDismissal: field(notification, 'requiresDismissal', context) === true
                },
                retry: {
                    available: field(retry, 'available', context) === true && correlation.operation !== 'unknown'
                        && choice(field(retry, 'action', context), RETRY_ACTIONS) !== 'unknown',
                    action: choice(field(retry, 'action', context), RETRY_ACTIONS),
                    operationAlias: correlation.operation,
                    submissionAlias: correlation.submission
                },
                breadcrumbs: breadcrumbs(field(input, 'breadcrumbs', context), scope, context, wire),
                collection: {
                    ...(entryCoverage.entry !== 'unknown' ? { entryCoverage } : {}),
                    source: choice(field(collection, 'source', context), SOURCES),
                    coverage: choice(field(collection, 'coverage', context), ['complete', 'partial']),
                    aggregation: choice(field(collection, 'aggregation', context), ['local', 'complete', 'incomplete']),
                    redaction: 'allowlist-v1', limitations: COVERAGE_LIMITATIONS.slice(), issues: []
                }
            };
            if (wire) {
                const issues = field(collection, 'issues', context);
                const knownIssues = ['accessor-skipped', 'unreadable', 'input-truncated', 'stack-truncated',
                    'cause-cycle', 'causes-truncated', 'breadcrumbs-truncated', 'event-truncated', 'normalization-failed'];
                for (let i = 0; i < Math.min(arrayLength(issues, context), knownIssues.length); i += 1) {
                    const issue = choice(field(issues, String(i), context), knownIssues);
                    if (issue !== 'unknown') context.issues.add(issue);
                }
            }
            event.fingerprint = fingerprint(event);
            return bound(event, context);
        }
        function normalize(input) {
            const context = state();
            let identity;
            try {
                identity = identify(field(input, 'error', context), field(input, 'newOccurrence', context) === true, context);
                return project(input, identity, context, false);
            } catch (_) {
                context.issues.add('normalization-failed');
                return project(null, identity || freshIdentity(), context, false);
            }
        }
        function sanitizeEvent(input) {
            if (validatedEvents.has(input)) return input;
            const context = state();
            try {
                if (field(input, 'schemaVersion', context) !== SCHEMA_VERSION) return null;
                const eventId = field(input, 'eventId', context);
                const originWindow = field(input, 'windowId', context);
                const originSequence = integer(field(input, 'sequence', context), 1, Number.MAX_SAFE_INTEGER);
                const timestamp = integer(field(input, 'timestamp', context), 0, 8640000000000000);
                if (!matches(eventId, EVENT_ID) || !matches(originWindow, WINDOW_ID) || timestamp === null
                    || eventId !== `evt_${originWindow.slice(4)}_${originSequence}`) return null;
                return project(input, { eventId, windowId: originWindow, sequence: originSequence, timestamp }, context, true);
            } catch (_) { return null; }
        }
        return Object.freeze({ windowId, normalize, sanitizeEvent });
    }

    function sanitizeTransportStatus(input) {
        if (!input) return null;
        const context = state();
        return Object.freeze({
            connection: choice(field(input, 'connection', context), ['waiting', 'connected', 'disconnected', 'unavailable', 'incomplete']),
            aggregation: 'incomplete',
            pendingEvents: integer(field(input, 'pendingEvents', context), 0, 200, 0),
            pendingBytes: integer(field(input, 'pendingBytes', context), 0, 256 * 1024, 0),
            dropped: integer(field(input, 'dropped', context), 0, Number.MAX_SAFE_INTEGER, 0)
        });
    }

    function sanitizeEntryCoverage(input) {
        const context = state();
        const entry = choice(field(input, 'entry', context), ['listening-wrapper', 'listening-bridge', 'legacy-enhancer']);
        const capture = choice(field(input, 'capture', context), ['before-dependencies', 'late-injection']);
        return Object.freeze({ entry, capture, limitations: Object.freeze([
            ...(capture === 'late-injection' ? ['earlier-failures-unavailable'] : []),
            ...(entry === 'listening-wrapper' ? ['embedded-content-separate-context'] : []),
            ...(['listening-bridge', 'legacy-enhancer'].includes(entry) ? ['legacy-draft-recovery-unavailable'] : [])
        ]) });
    }

    const api = Object.freeze({ SCHEMA_VERSION, LIMITS, CODES, CAUSE_CODES, MESSAGES, sanitizeTransportStatus, sanitizeEntryCoverage,
        PROJECT_PATHS, COVERAGE_LIMITATIONS, createCorrelationScope, createWindowIdentity, createNormalizer, utf8Bytes, eventBytes });
    global.AppDiagnosticContract = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
