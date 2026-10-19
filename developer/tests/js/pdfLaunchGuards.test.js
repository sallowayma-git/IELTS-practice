#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function read(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractMainFunctionSource(startMarker, endMarker) {
    const source = read('js/main.js');
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notStrictEqual(start, -1, `${startMarker} should exist in js/main.js`);
    assert.notStrictEqual(end, -1, `${startMarker} extraction boundary should exist`);
    return source.slice(start, end);
}

function extractViewPdfSource() {
    return extractMainFunctionSource('async function viewPDF(', '\n\n// Bridge for record details');
}

function extractOpenPdfSafelySource() {
    return extractMainFunctionSource('function openPDFSafely(', '\n\n// --- Helper Functions ---');
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

function isListeningExam(exam) {
    if (!exam || typeof exam !== 'object') return false;
    const type = typeof exam.type === 'string' ? exam.type.trim().toLowerCase() : '';
    const id = typeof exam.id === 'string' ? exam.id.trim().toLowerCase() : '';
    const examPath = typeof exam.path === 'string'
        ? exam.path.trim().replace(/\\/g, '/').toLowerCase()
        : '';
    if (type === 'reading') return false;
    return type === 'listening'
        || id.startsWith('listening-')
        || examPath.includes('listeningpractice/')
        || /^p[1-4]\//.test(examPath);
}

function createPopup(label = 'reserved', initialHref = 'about:blank') {
    const state = { label, closeCalls: 0, focusCalls: 0, navigationWrites: [] };
    let href = initialHref;
    const location = {};
    Object.defineProperty(location, 'href', {
        enumerable: true,
        configurable: true,
        get() { return href; },
        set(value) {
            state.navigationWrites.push(value);
            href = value;
        }
    });
    const popup = {
        closed: false,
        location,
        focus() { state.focusCalls += 1; },
        close() {
            state.closeCalls += 1;
            popup.closed = true;
        },
        addEventListener() {}
    };
    return { popup, state };
}

function createDirectEntryHarness({
    protocol,
    exam,
    resolutionUrl = '',
    resolveError = null,
    activeIndexPromise = null,
    resourcePromise = null,
    popupFactory = () => createPopup(),
    useRealSafeOpen = false
}) {
    const state = {
        buildCalls: 0,
        resolveCalls: 0,
        windowOpenCalls: [],
        openedPopups: [],
        safeOpenCalls: [],
        messages: [],
        navigationWrites: [],
        events: []
    };
    const initialHref = protocol === 'file:'
        ? 'file:///workspace/index.html'
        : `${protocol}//example.test/index.html`;
    let currentHref = initialHref;
    const location = { protocol };
    Object.defineProperty(location, 'href', {
        enumerable: true,
        configurable: true,
        get() { return currentHref; },
        set(value) {
            state.navigationWrites.push(value);
            currentHref = value;
        }
    });
    const resourceCore = {
        isListeningExam,
        isPdfAvailable(candidate) {
            return Boolean(candidate && candidate.hasPdf === true && String(candidate.pdfFilename || '').trim());
        },
        async resolveResource(candidate, kind) {
            state.resolveCalls += 1;
            state.events.push('resolve-resource');
            assert.strictEqual(candidate, exam);
            assert.strictEqual(kind, 'pdf');
            if (resolveError) throw resolveError;
            if (resourcePromise) return resourcePromise;
            return { url: resolutionUrl, attempts: [], source: 'map', kind: 'pdf' };
        },
        isApprovedPdfResolution() { return false; }
    };
    const windowStub = {
        location,
        ResourceCore: resourceCore,
        buildResourcePath(candidate, kind) {
            state.buildCalls += 1;
            assert.strictEqual(candidate, exam);
            assert.strictEqual(kind, 'pdf');
            return './local-library.pdf';
        },
        open(url, target, features) {
            state.events.push(`window-open:${url}`);
            state.windowOpenCalls.push({ url, target, features });
            const created = popupFactory(state.windowOpenCalls.length);
            if (!created) return null;
            state.openedPopups.push(created);
            return created.popup;
        }
    };
    const sandbox = {
        window: windowStub,
        console: { log() {}, warn() {}, error() {} },
        Date,
        pdfHandler: null,
        async resolveActiveExamIndex() {
            state.events.push('resolve-active-index');
            return activeIndexPromise || (exam ? [exam] : []);
        },
        getResourceCore() { return resourceCore; },
        showMessage(message, type) {
            state.messages.push({ message, type });
            return null;
        }
    };
    if (!useRealSafeOpen) {
        sandbox.openPDFSafely = (url, title, options = {}) => {
            state.safeOpenCalls.push({ url, title, options });
            return options.reservedWindow || { url, title };
        };
    }
    sandbox.globalThis = windowStub;
    const context = vm.createContext(sandbox);
    if (useRealSafeOpen) {
        vm.runInContext(extractOpenPdfSafelySource(), context, { filename: 'js/main.js#openPDFSafely' });
    }
    vm.runInContext(extractViewPdfSource(), context, { filename: 'js/main.js#viewPDF' });
    return { context, state, location, initialHref, getCurrentHref: () => currentHref };
}

function createSessionHarness({
    protocol,
    resolutionUrl = '',
    resourcePromise = null,
    activeIndexPromise = null,
    activeIndexResolver = null,
    popupFactory = () => createPopup()
}) {
    const state = {
        buildCalls: 0,
        resolveCalls: 0,
        windowOpenCalls: [],
        openedPopups: [],
        activeIndexCalls: 0,
        messages: [],
        navigationWrites: [],
        consoleErrors: []
    };
    const initialHref = protocol === 'file:'
        ? 'file:///workspace/index.html'
        : `${protocol}//example.test/index.html`;
    let currentHref = initialHref;
    const location = { protocol };
    Object.defineProperty(location, 'href', {
        enumerable: true,
        configurable: true,
        get() { return currentHref; },
        set(value) {
            state.navigationWrites.push(value);
            currentHref = value;
        }
    });
    const resourceCore = {
        isListeningExam,
        isPdfAvailable(candidate) {
            return Boolean(candidate && candidate.hasPdf === true && String(candidate.pdfFilename || '').trim());
        },
        async resolveResource(candidate, kind) {
            state.resolveCalls += 1;
            assert.ok(candidate);
            assert.strictEqual(kind, 'pdf');
            if (resourcePromise) return resourcePromise;
            return { url: resolutionUrl, attempts: [], source: 'map', kind: 'pdf' };
        }
    };
    const windowStub = {
        location,
        ResourceCore: resourceCore,
        __READING_EXAM_MANIFEST__: {},
        buildResourcePath(candidate, kind) {
            state.buildCalls += 1;
            assert.ok(candidate);
            assert.strictEqual(kind, 'pdf');
            return './local-library.pdf';
        },
        open(url, target, features) {
            const openCall = { url, target, features };
            state.windowOpenCalls.push(openCall);
            const created = popupFactory(state.windowOpenCalls.length, openCall);
            if (!created) return null;
            state.openedPopups.push(created);
            return created.popup;
        },
        async resolveActiveLibraryIndex() {
            state.activeIndexCalls += 1;
            if (typeof activeIndexResolver === 'function') {
                return activeIndexResolver(state.activeIndexCalls);
            }
            return activeIndexPromise || [];
        },
        showMessage(message, type) {
            state.messages.push({ message, type });
            return null;
        },
        addEventListener() {},
        removeEventListener() {}
    };
    const sandbox = {
        window: windowStub,
        globalThis: windowStub,
        console: { log() {}, warn() {}, error(...args) { state.consoleErrors.push(args); } },
        URL,
        URLSearchParams,
        Map,
        WeakMap,
        Set,
        Promise,
        Date,
        Math,
        JSON,
        Object,
        Array,
        String,
        Number,
        Boolean,
        Error,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval
    };
    const context = vm.createContext(sandbox);
    vm.runInContext(read('js/app/examSessionMixin.js'), context, { filename: 'js/app/examSessionMixin.js' });
    const app = Object.assign({}, windowStub.ExamSystemAppMixins.examSession);
    app._recordExamWindowNavigation = () => 1;
    return { app, state, location, getCurrentHref: () => currentHref, initialHref };
}

function createRealBlobHarness() {
    const state = { runtimeRequests: [], windowOpenCalls: [], messages: [] };
    const windowStub = {
        location: { protocol: 'https:', href: 'https://example.test/index.html' },
        screen: { availWidth: 1440, availHeight: 900 },
        LibraryDiscovery: {
            resolveRuntimeResource(exam, kind) {
                state.runtimeRequests.push({ exam, kind });
                return kind === 'pdf' ? exam.runtimePdfUrl : exam.runtimeHtmlUrl;
            }
        },
        open(url, target, features) {
            state.windowOpenCalls.push({ url, target, features });
            return createPopup('late-open').popup;
        },
        showMessage(message, type) { state.messages.push({ message, type }); }
    };
    const sandbox = {
        window: windowStub,
        globalThis: windowStub,
        URL,
        Map,
        WeakMap,
        Set,
        Promise,
        Date,
        Math,
        JSON,
        Object,
        Array,
        String,
        Number,
        Boolean,
        Error,
        console: { log() {}, warn() {}, error() {} },
        document: { dispatchEvent() {} },
        CustomEvent: class CustomEvent {
            constructor(type, options) {
                this.type = type;
                this.detail = options && options.detail;
            }
        },
        setTimeout() { return 1; },
        clearTimeout() {},
        fetch() { throw new Error('Blob URLs must bypass network probing'); }
    };
    const context = vm.createContext(sandbox);
    vm.runInContext(read('js/core/resourceCore.js'), context, { filename: 'js/core/resourceCore.js' });
    vm.runInContext(read('js/components/PDFHandler.js'), context, { filename: 'js/components/PDFHandler.js' });
    return {
        context,
        state,
        ResourceCore: windowStub.ResourceCore,
        PDFHandler: windowStub.PDFHandler
    };
}

function createRandomPracticePdfHarness() {
    const activeIndex = createDeferred();
    const exam = pdfExam();
    const popup = createPopup('random-practice');
    const timers = [];
    let gestureActive = true;
    const state = {
        activeIndexCalls: 0,
        windowOpenCalls: [],
        safeOpenCalls: [],
        messages: [],
        events: []
    };
    const documentStub = {
        readyState: 'loading',
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getElementById() { return null; }
    };
    const resourceCore = {
        isListeningExam,
        isPdfAvailable(candidate) {
            return Boolean(candidate && candidate.hasPdf === true && String(candidate.pdfFilename || '').trim());
        },
        async resolveResource(candidate, kind) {
            assert.strictEqual(candidate, exam);
            assert.strictEqual(kind, 'pdf');
            state.events.push('resolve-resource');
            return { url: '/deployed/random-practice.pdf', attempts: [], source: 'map', kind: 'pdf' };
        }
    };
    const windowStub = {
        document: documentStub,
        location: { protocol: 'https:', href: 'https://example.test/index.html' },
        ResourceCore: resourceCore,
        async resolveActiveLibraryIndex() {
            state.activeIndexCalls += 1;
            state.events.push('resolve-random-index');
            return activeIndex.promise;
        },
        buildResourcePath() {
            return './random-practice.pdf';
        },
        open(url, target, features) {
            state.events.push(`window-open:${url}`);
            state.windowOpenCalls.push({ url, target, features, gestureActive });
            return gestureActive ? popup.popup : null;
        },
        showMessage(message, type) {
            state.messages.push({ message, type });
        }
    };
    const sandbox = {
        window: windowStub,
        globalThis: windowStub,
        document: documentStub,
        console: { log() {}, warn() {}, error() {} },
        Date,
        Math: Object.create(Math),
        JSON,
        Map,
        WeakMap,
        Set,
        Promise,
        Object,
        Array,
        String,
        Number,
        Boolean,
        Error,
        URL,
        URLSearchParams,
        setTimeout(callback) {
            timers.push(callback);
            return timers.length;
        },
        clearTimeout() {},
        async resolveActiveExamIndex() {
            state.events.push('resolve-view-index');
            return [exam];
        },
        getResourceCore() {
            return resourceCore;
        },
        showMessage(message, type) {
            state.messages.push({ message, type });
        },
        openPDFSafely(url, title, options) {
            state.safeOpenCalls.push({ url, title, options });
            return options.reservedWindow;
        }
    };
    sandbox.Math.random = () => 0;
    const context = vm.createContext(sandbox);
    vm.runInContext(extractViewPdfSource(), context, { filename: 'js/main.js#viewPDF' });
    windowStub.viewPDF = context.viewPDF;
    vm.runInContext(read('js/presentation/app-actions.js'), context, { filename: 'js/presentation/app-actions.js' });
    return {
        activeIndex,
        exam,
        popup,
        timers,
        state,
        windowStub,
        endGesture() { gestureActive = false; }
    };
}

function pdfExam(overrides = {}) {
    return {
        id: 'custom-reading-pdf-only',
        type: 'reading',
        title: 'Imported PDF-only exercise',
        path: 'Imported/',
        filename: undefined,
        pdfFilename: 'exercise.pdf',
        hasHtml: false,
        hasPdf: true,
        ...overrides
    };
}

async function testDirectEntryReservesBeforeActiveIndexAndClosesOwnedFailure() {
    const activeIndex = createDeferred();
    const exam = pdfExam({ hasPdf: false });
    const harness = createDirectEntryHarness({
        protocol: 'https:',
        exam,
        activeIndexPromise: activeIndex.promise
    });

    const pending = harness.context.viewPDF(exam.id);
    assert.strictEqual(harness.state.windowOpenCalls.length, 1,
        'a blank popup must be reserved synchronously before the active index settles');
    assert.strictEqual(harness.state.windowOpenCalls[0].url, 'about:blank');
    assert.deepStrictEqual(harness.state.events.slice(0, 2), [
        'window-open:about:blank',
        'resolve-active-index'
    ]);
    assert.strictEqual(harness.state.openedPopups[0].state.closeCalls, 0);

    activeIndex.resolve([exam]);
    await pending;
    assert.strictEqual(harness.state.resolveCalls, 0, 'unavailable PDFs must not be resolved');
    assert.strictEqual(harness.state.buildCalls, 0, 'unavailable PDFs must not have a path built');
    assert.deepStrictEqual(harness.state.safeOpenCalls, [], 'unavailable PDFs must not be opened');
    assert.strictEqual(harness.state.openedPopups[0].state.closeCalls, 1,
        'the entry point must close the blank popup it owns when availability fails');
    assert.deepStrictEqual(harness.state.messages, [{ message: '此PDF不存在', type: 'error' }]);
}

async function testDirectEntryReservesBeforeResourceAndPropagatesLaunchContext() {
    const resource = createDeferred();
    const exam = pdfExam();
    const harness = createDirectEntryHarness({ protocol: 'https:', exam, resourcePromise: resource.promise });

    const pending = harness.context.viewPDF(exam.id);
    assert.strictEqual(harness.state.windowOpenCalls.length, 1);
    assert.strictEqual(harness.state.windowOpenCalls[0].url, 'about:blank');
    await flushMicrotasks();
    assert.strictEqual(harness.state.resolveCalls, 1,
        'the resource probe should remain pending after the blank popup is reserved');
    assert.deepStrictEqual(harness.state.safeOpenCalls, []);

    const resolution = { url: '/deployed/exercise.pdf', attempts: [], source: 'map', kind: 'pdf' };
    resource.resolve(resolution);
    await pending;

    assert.strictEqual(harness.state.windowOpenCalls.length, 1,
        'the async continuation must not create a second popup');
    assert.strictEqual(harness.state.safeOpenCalls.length, 1);
    const launch = harness.state.safeOpenCalls[0];
    assert.strictEqual(launch.url, resolution.url);
    assert.strictEqual(launch.title, exam.title);
    assert.strictEqual(launch.options.reservedWindow, harness.state.openedPopups[0].popup);
    assert.strictEqual(launch.options.reservationAttempted, true);
    assert.strictEqual(launch.options.ownsReservedWindow, true);
    assert.strictEqual(launch.options.preventCurrentWindowFallback, true);
    assert.strictEqual(launch.options.resourceResolution, resolution);
}

async function testDirectEntryNeverLateOpensOrNavigatesHostWhenReservationUnavailable() {
    const exam = pdfExam();
    for (const scenario of ['blocked', 'closed']) {
        const resource = createDeferred();
        let created = null;
        const harness = createDirectEntryHarness({
            protocol: 'https:',
            exam,
            resourcePromise: resource.promise,
            useRealSafeOpen: true,
            popupFactory() {
                if (scenario === 'blocked') return null;
                created = createPopup('closed-before-resolution');
                return created;
            }
        });

        const pending = harness.context.viewPDF(exam.id);
        await flushMicrotasks();
        assert.strictEqual(harness.state.windowOpenCalls.length, 1);
        assert.strictEqual(harness.state.windowOpenCalls[0].url, 'about:blank');
        if (created) created.popup.closed = true;
        resource.resolve({ url: '/deployed/exercise.pdf', attempts: [], source: 'map', kind: 'pdf' });
        const result = await pending;

        assert.strictEqual(result, null, `${scenario}: launch should fail closed`);
        assert.strictEqual(harness.state.windowOpenCalls.length, 1,
            `${scenario}: no popup may be opened after the async boundary`);
        assert.deepStrictEqual(harness.state.navigationWrites, [],
            `${scenario}: the application window must never become the PDF fallback`);
        assert.strictEqual(harness.getCurrentHref(), harness.initialHref);
    }
}

async function testDirectEntryPreservesCallerOwnedReservationOnFailure() {
    const exam = pdfExam({ hasPdf: false });
    const callerOwned = createPopup('caller-owned');
    const harness = createDirectEntryHarness({ protocol: 'https:', exam });

    await harness.context.viewPDF(exam.id, {
        reservationAttempted: true,
        reservedWindow: callerOwned.popup,
        ownsReservedWindow: false
    });

    assert.strictEqual(harness.state.windowOpenCalls.length, 0,
        'an upstream reservation must suppress a second reservation attempt');
    assert.strictEqual(callerOwned.state.closeCalls, 0,
        'viewPDF must not close a window owned by its caller');
    assert.strictEqual(callerOwned.popup.closed, false);
}

async function testDirectEntryFileProtocolPreservesPathLaunch() {
    const exam = pdfExam();
    const harness = createDirectEntryHarness({ protocol: 'file:', exam });
    await harness.context.viewPDF(exam.id);

    assert.strictEqual(harness.state.resolveCalls, 0, 'file:// must not perform the HTTP resource probe');
    assert.strictEqual(harness.state.buildCalls, 1);
    assert.strictEqual(harness.state.safeOpenCalls.length, 1);
    assert.strictEqual(harness.state.safeOpenCalls[0].url, './local-library.pdf');
    assert.strictEqual(harness.state.safeOpenCalls[0].options.reservedWindow,
        harness.state.openedPopups[0].popup);
}

async function testPathOnlyLegacyListeningBypassesReadingGuard() {
    const exam = {
        id: 'legacy-library-entry',
        title: 'Legacy listening PDF',
        path: 'P3/Legacy Set/',
        pdfFilename: 'legacy.pdf',
        hasHtml: false,
        hasPdf: false
    };
    const direct = createDirectEntryHarness({ protocol: 'https:', exam });
    await direct.context.viewPDF(exam.id);

    assert.strictEqual(direct.state.resolveCalls, 0,
        'path-only listening must not enter the reading availability/probe path');
    assert.strictEqual(direct.state.buildCalls, 1);
    assert.strictEqual(direct.state.safeOpenCalls.length, 1);
    assert.strictEqual(direct.state.safeOpenCalls[0].url, './local-library.pdf');

    const session = createSessionHarness({ protocol: 'https:' });
    const opened = await session.app._openPdfWindow(
        exam,
        'https://example.test/ListeningPractice/PDF/legacy.pdf'
    );
    assert.ok(opened, 'path-only listening should retain the legacy direct launch');
    assert.strictEqual(session.state.resolveCalls, 0);
    assert.strictEqual(session.state.windowOpenCalls.length, 1);
    assert.strictEqual(session.state.windowOpenCalls[0].url,
        'https://example.test/ListeningPractice/PDF/legacy.pdf');
    assert.deepStrictEqual(session.state.messages, [{
        message: '正在打开PDF: Legacy listening PDF',
        type: 'info'
    }]);
}

async function testExplicitReadingTypeOverridesLegacyListeningPath() {
    const exam = pdfExam({
        id: 'explicit-reading-in-legacy-folder',
        type: 'reading',
        path: 'ListeningPractice/P1/Imported/',
        hasPdf: false
    });
    const harness = createDirectEntryHarness({ protocol: 'https:', exam });

    await harness.context.viewPDF(exam.id);

    assert.strictEqual(harness.state.resolveCalls, 0,
        'explicit reading must fail availability before resource resolution');
    assert.strictEqual(harness.state.buildCalls, 0,
        'legacy listening-looking paths must not override explicit reading type');
    assert.deepStrictEqual(harness.state.safeOpenCalls, []);
    assert.deepStrictEqual(harness.state.messages, [{ message: '此PDF不存在', type: 'error' }]);
    assert.strictEqual(harness.state.openedPopups[0].state.closeCalls, 1);
}

async function testSessionReservesBeforeResourceResolutionAndReusesExactWindow() {
    const resource = createDeferred();
    const exam = pdfExam();
    const harness = createSessionHarness({ protocol: 'https:', resourcePromise: resource.promise });

    const pending = harness.app._openPdfWindow(exam, 'https://example.test/prebuilt.pdf');
    assert.strictEqual(harness.state.windowOpenCalls.length, 1,
        '_openPdfWindow must reserve synchronously before awaiting ResourceCore');
    assert.strictEqual(harness.state.windowOpenCalls[0].url, 'about:blank');
    assert.strictEqual(harness.state.resolveCalls, 1);
    const reserved = harness.state.openedPopups[0];
    resource.resolve({ url: '/deployed/exercise.pdf', attempts: [], source: 'map', kind: 'pdf' });
    const opened = await pending;

    assert.strictEqual(opened, reserved.popup);
    assert.strictEqual(harness.state.windowOpenCalls.length, 1,
        'the resolved URL must navigate the reserved popup instead of opening again');
    assert.deepStrictEqual(reserved.state.navigationWrites, ['https://example.test/deployed/exercise.pdf']);
    assert.deepStrictEqual(harness.state.navigationWrites, []);
}

async function testSessionNeverLateOpensOrNavigatesHostWhenReservationUnavailable() {
    const exam = pdfExam();
    for (const scenario of ['blocked', 'closed']) {
        const resource = createDeferred();
        let created = null;
        const harness = createSessionHarness({
            protocol: 'https:',
            resourcePromise: resource.promise,
            popupFactory() {
                if (scenario === 'blocked') return null;
                created = createPopup('closed-before-resolution');
                return created;
            }
        });

        const pending = harness.app._openPdfWindow(exam, 'https://example.test/prebuilt.pdf');
        assert.strictEqual(harness.state.windowOpenCalls.length, 1);
        assert.strictEqual(harness.state.windowOpenCalls[0].url, 'about:blank');
        if (created) created.popup.closed = true;
        resource.resolve({ url: '/deployed/exercise.pdf', attempts: [], source: 'map', kind: 'pdf' });
        const result = await pending;

        assert.strictEqual(result, null, `${scenario}: launch should fail closed`);
        assert.strictEqual(harness.state.windowOpenCalls.length, 1,
            `${scenario}: no late window.open call is allowed`);
        assert.deepStrictEqual(harness.state.navigationWrites, [],
            `${scenario}: the host application must not be navigated`);
        assert.strictEqual(harness.getCurrentHref(), harness.initialHref);
        assert.deepStrictEqual(harness.state.messages, [{
            message: '无法打开PDF窗口，请检查弹窗设置',
            type: 'error'
        }]);
    }
}

async function testSessionReservationOwnershipOnResolutionFailure() {
    const exam = pdfExam();
    const ownedHarness = createSessionHarness({ protocol: 'https:', resolutionUrl: '' });
    const ownedResult = await ownedHarness.app._openPdfWindow(exam, 'https://example.test/prebuilt.pdf');

    assert.strictEqual(ownedResult, null);
    assert.strictEqual(ownedHarness.state.openedPopups[0].state.closeCalls, 1,
        'a reservation created inside _openPdfWindow must close on resolution failure');

    const callerOwned = createPopup('caller-owned-reuse-window');
    const reusedHarness = createSessionHarness({ protocol: 'https:', resolutionUrl: '' });
    const reusedResult = await reusedHarness.app._openPdfWindow(
        exam,
        'https://example.test/prebuilt.pdf',
        { reuseWindow: callerOwned.popup }
    );

    assert.strictEqual(reusedResult, null);
    assert.strictEqual(reusedHarness.state.windowOpenCalls.length, 0,
        'a live reuseWindow must suppress internal reservation');
    assert.strictEqual(callerOwned.state.closeCalls, 0,
        'a caller-owned reuseWindow must not close on resolution failure');
    assert.strictEqual(callerOwned.popup.closed, false);
}

async function testRapidOpenExamGenerationCannotCloseNewerReservation() {
    const activeIndex = createDeferred();
    const exam = pdfExam();
    const reservationsByTarget = new Map();
    const harness = createSessionHarness({
        protocol: 'https:',
        resolutionUrl: '/deployed/exercise.pdf',
        activeIndexPromise: activeIndex.promise,
        popupFactory(_callNumber, openCall) {
            // Model browser named-window reuse: two window.open() calls using the
            // same target return the same handle unless production isolates them
            // with a generation-specific name.
            if (reservationsByTarget.has(openCall.target)) {
                return reservationsByTarget.get(openCall.target);
            }
            const created = createPopup(`reservation:${openCall.target}`);
            reservationsByTarget.set(openCall.target, created);
            return created;
        }
    });

    const firstOpen = harness.app.openExam(exam.id);
    assert.strictEqual(harness.state.activeIndexCalls, 1);
    assert.strictEqual(harness.state.windowOpenCalls.length, 1);
    assert.strictEqual(harness.state.windowOpenCalls[0].url, '');
    assert.strictEqual(harness.state.windowOpenCalls[0].target, `exam_${exam.id}`,
        'an ID-only launch should reserve the same named browsing context used by the final exam window');

    const secondOpen = harness.app.openExam(exam.id, { examDefinition: exam });
    const secondResult = await secondOpen;

    assert.ok(secondResult, 'the newer generation should complete successfully');
    assert.strictEqual(harness.state.windowOpenCalls.length, 2,
        'each full openExam call should synchronously attempt its own reservation');
    assert.ok(harness.state.windowOpenCalls.every(call => call.url === ''));
    assert.strictEqual(harness.state.windowOpenCalls[1].target, `pdf_${exam.id}`,
        'a known PDF-only launch should reserve its established named PDF context');
    const firstReservation = harness.state.openedPopups[0].popup;
    const secondReservation = harness.state.openedPopups[1].popup;
    assert.strictEqual(secondResult, secondReservation);
    const currentGeneration = harness.app._examOpenGenerations.get(`exam:${exam.id}`);
    const isolatedReservation = firstReservation !== secondReservation
        || harness.state.windowOpenCalls[0].target !== harness.state.windowOpenCalls[1].target;
    const generationOwnsSecond = harness.app._examOpenWindowGenerations.get(secondReservation)
        === currentGeneration;
    assert.ok(isolatedReservation || generationOwnsSecond,
        'reservations must be isolated by handle/name or attributed to the current generation');

    activeIndex.resolve([exam]);
    const firstResult = await firstOpen;

    assert.strictEqual(firstResult, null, 'the stale first continuation must stop');
    assert.strictEqual(secondReservation.closed, false,
        'the stale continuation must not close the newer generation reservation');
    assert.strictEqual(secondResult.closed, false);
    assert.deepStrictEqual(harness.state.navigationWrites, [],
        'neither generation may fall back to navigating the host application');
    assert.strictEqual(harness.getCurrentHref(), harness.initialHref);
}

async function testStableCallerWindowNameIsReusedAcrossIndexBackedLaunches() {
    for (const windowName of ['ielts-reading-memorize', 'ielts-endless-mode-tab']) {
        const firstActiveIndex = createDeferred();
        const exam = pdfExam({ id: `stable-window-${windowName}` });
        const reservationsByTarget = new Map();
        const harness = createSessionHarness({
            protocol: 'https:',
            resolutionUrl: '/deployed/exercise.pdf',
            activeIndexResolver(callNumber) {
                return callNumber === 1 ? firstActiveIndex.promise : [exam];
            },
            popupFactory(_callNumber, openCall) {
                if (reservationsByTarget.has(openCall.target)) {
                    return reservationsByTarget.get(openCall.target);
                }
                const created = createPopup(`stable-reservation:${openCall.target}`);
                reservationsByTarget.set(openCall.target, created);
                return created;
            }
        });
        const launchOptions = {
            target: 'tab',
            windowName,
            ...(windowName === 'ielts-reading-memorize'
                ? { practiceMode: 'memorize' }
                : { endlessMode: true })
        };

        const firstOpen = harness.app.openExam(exam.id, launchOptions);
        assert.strictEqual(harness.state.windowOpenCalls.length, 1);
        assert.strictEqual(harness.state.windowOpenCalls[0].target, windowName,
            `${windowName}: provisional reservation must preserve the stable caller name`);

        const secondOpen = harness.app.openExam(exam.id, launchOptions);
        const secondResult = await secondOpen;

        assert.ok(secondResult, `${windowName}: the newer launch should succeed`);
        assert.strictEqual(harness.state.activeIndexCalls, 2,
            `${windowName}: both launches should resolve the active index without examDefinition`);
        assert.strictEqual(harness.state.windowOpenCalls.length, 2);
        assert.ok(harness.state.windowOpenCalls.every(call => call.url === ''),
            `${windowName}: named reservations must retrieve the context without blanking it`);
        assert.ok(harness.state.windowOpenCalls.every(call => call.target === windowName),
            `${windowName}: both reservations must use the same stable target name`);
        assert.strictEqual(reservationsByTarget.size, 1,
            `${windowName}: the browser should observe one reusable named browsing context`);
        const firstReservation = harness.state.openedPopups[0].popup;
        const secondReservation = harness.state.openedPopups[1].popup;
        assert.strictEqual(firstReservation, secondReservation,
            `${windowName}: the second launch must reuse the named reservation handle`);
        assert.strictEqual(secondResult, secondReservation);

        firstActiveIndex.resolve([exam]);
        const firstResult = await firstOpen;

        assert.strictEqual(firstResult, null,
            `${windowName}: the first continuation should be stale after the second launch`);
        assert.strictEqual(secondReservation.closed, false,
            `${windowName}: stale cleanup must not close the reused current-generation window`);
        assert.strictEqual(harness.state.openedPopups[1].state.closeCalls, 0,
            `${windowName}: no generation may close the successfully reused window`);
        assert.deepStrictEqual(harness.state.navigationWrites, [],
            `${windowName}: neither launch may navigate the host application`);
        assert.strictEqual(harness.getCurrentHref(), harness.initialHref);
    }
}

async function testFailedNamedRelaunchPreservesExistingSuccessfulContext() {
    const windowName = 'ielts-reading-memorize';
    const exam = pdfExam({ id: 'stable-window-failure-preservation' });
    const namedContext = createPopup(`stable-reservation:${windowName}`);
    let activeIndexCall = 0;
    const harness = createSessionHarness({
        protocol: 'https:',
        resolutionUrl: '/deployed/exercise.pdf',
        activeIndexResolver() {
            activeIndexCall += 1;
            return activeIndexCall === 1 ? [exam] : [];
        },
        popupFactory(_callNumber, openCall) {
            assert.strictEqual(openCall.target, windowName);
            return namedContext;
        }
    });
    const launchOptions = {
        target: 'tab',
        windowName,
        practiceMode: 'memorize'
    };

    const firstResult = await harness.app.openExam(exam.id, launchOptions);
    assert.strictEqual(firstResult, namedContext.popup);
    assert.strictEqual(namedContext.popup.location.href, 'https://example.test/deployed/exercise.pdf');
    assert.strictEqual(namedContext.state.closeCalls, 0);

    const secondResult = await harness.app.openExam(exam.id, launchOptions);
    assert.strictEqual(secondResult, undefined,
        'a missing exam on the second launch should fail before navigation');
    assert.strictEqual(harness.state.windowOpenCalls.length, 2);
    assert.strictEqual(harness.state.windowOpenCalls[1].url, '',
        'retrieving an existing named context must not navigate it to about:blank');
    assert.strictEqual(namedContext.popup.location.href, 'https://example.test/deployed/exercise.pdf',
        'the failed relaunch must preserve the successful context contents');
    assert.strictEqual(namedContext.popup.closed, false,
        'the failed relaunch must not close a pre-existing named context');
    assert.strictEqual(namedContext.state.closeCalls, 0);
}

async function testConcurrentFailedNamedRelaunchClosesTransferredBlankReservation() {
    const windowName = 'ielts-endless-mode-tab';
    const exam = pdfExam({ id: 'stable-window-concurrent-failure' });
    const firstActiveIndex = createDeferred();
    const namedContext = createPopup(`stable-reservation:${windowName}`);
    let activeIndexCall = 0;
    const harness = createSessionHarness({
        protocol: 'https:',
        activeIndexResolver() {
            activeIndexCall += 1;
            return activeIndexCall === 1 ? firstActiveIndex.promise : [];
        },
        popupFactory(_callNumber, openCall) {
            assert.strictEqual(openCall.target, windowName);
            return namedContext;
        }
    });
    const launchOptions = {
        target: 'tab',
        windowName,
        endlessMode: true
    };

    const firstOpen = harness.app.openExam(exam.id, launchOptions);
    assert.strictEqual(namedContext.popup.location.href, 'about:blank');
    const secondResult = await harness.app.openExam(exam.id, launchOptions);

    assert.strictEqual(secondResult, undefined);
    assert.strictEqual(namedContext.state.closeCalls, 1,
        'the newer generation must inherit and close the app-owned blank reservation');
    assert.strictEqual(namedContext.popup.closed, true);

    firstActiveIndex.resolve([exam]);
    assert.strictEqual(await firstOpen, null,
        'the stale first continuation must stop after the newer failed generation');
    assert.strictEqual(namedContext.state.closeCalls, 1,
        'the stale generation must not close the transferred reservation again');
}

async function testFailedNamedRelaunchPreservesExternallyNavigatedPendingContext() {
    const windowName = 'ielts-reading-memorize';
    const exam = pdfExam({ id: 'stable-window-external-navigation' });
    const firstActiveIndex = createDeferred();
    const namedContext = createPopup(`stable-reservation:${windowName}`);
    let activeIndexCall = 0;
    const harness = createSessionHarness({
        protocol: 'https:',
        activeIndexResolver() {
            activeIndexCall += 1;
            return activeIndexCall === 1 ? firstActiveIndex.promise : [];
        },
        popupFactory() { return namedContext; }
    });
    const launchOptions = {
        target: 'tab',
        windowName,
        practiceMode: 'memorize'
    };

    const firstOpen = harness.app.openExam(exam.id, launchOptions);
    namedContext.popup.location.href = 'https://example.test/user-content';
    const secondResult = await harness.app.openExam(exam.id, launchOptions);

    assert.strictEqual(secondResult, undefined);
    assert.strictEqual(namedContext.popup.location.href, 'https://example.test/user-content',
        'a relaunch lookup must not blank externally navigated content');
    assert.strictEqual(namedContext.state.closeCalls, 0,
        'a no-longer-blank context must lose app-owned reservation status');
    assert.strictEqual(namedContext.popup.closed, false);

    firstActiveIndex.resolve([exam]);
    assert.strictEqual(await firstOpen, null);
    assert.strictEqual(namedContext.state.closeCalls, 0,
        'the stale first generation must not reclaim or close the navigated context');
}

async function testPdfOnlyFallbackFileProtocolPreservesPathLaunch() {
    const exam = pdfExam();
    const harness = createSessionHarness({ protocol: 'file:' });
    const opened = await harness.app._openPdfWindow(exam, 'file:///workspace/local-library.pdf');

    assert.ok(opened);
    assert.strictEqual(harness.state.resolveCalls, 0);
    assert.strictEqual(harness.state.windowOpenCalls.length, 1);
    assert.strictEqual(harness.state.windowOpenCalls[0].url, 'file:///workspace/local-library.pdf');
    assert.deepStrictEqual(harness.state.navigationWrites, []);
}

async function testRandomPracticeReservesPdfWindowBeforeDelayedSelection() {
    const harness = createRandomPracticePdfHarness();

    const pending = harness.windowStub.AppActions.startRandomPractice('all', 'reading');
    assert.strictEqual(harness.state.windowOpenCalls.length, 1,
        'Random Practice must reserve a popup synchronously at the initiating gesture');
    assert.deepStrictEqual(harness.state.windowOpenCalls[0], {
        url: 'about:blank',
        target: '_blank',
        features: 'width=1000,height=800,scrollbars=yes,resizable=yes,status=yes,toolbar=yes',
        gestureActive: true
    });
    assert.deepStrictEqual(harness.state.events.slice(0, 2), [
        'window-open:about:blank',
        'resolve-random-index'
    ]);

    harness.endGesture();
    harness.activeIndex.resolve([harness.exam]);
    await pending;
    assert.strictEqual(harness.timers.length, 1, 'the selected exercise should retain the existing launch delay');
    harness.timers.shift()();
    for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
    }

    assert.strictEqual(harness.state.windowOpenCalls.length, 1,
        'the delayed PDF path must not attempt a popup after transient activation expires');
    assert.strictEqual(harness.state.safeOpenCalls.length, 1);
    const launch = harness.state.safeOpenCalls[0];
    assert.strictEqual(launch.url, '/deployed/random-practice.pdf');
    assert.strictEqual(launch.options.reservedWindow, harness.popup.popup);
    assert.strictEqual(launch.options.reservationAttempted, true);
    assert.strictEqual(launch.options.ownsReservedWindow, true);
    assert.strictEqual(launch.options.preventCurrentWindowFallback, true);
    assert.strictEqual(harness.popup.state.closeCalls, 0,
        'ownership must transfer to viewPDF instead of closing the reserved popup early');
}

async function testRealResourceCoreAndPdfHandlerBlobProvenance() {
    const harness = createRealBlobHarness();
    const handler = new harness.PDFHandler();
    const exam = pdfExam({
        runtimePdfUrl: 'blob:https://example.test/runtime-pdf',
        runtimeHtmlUrl: 'blob:https://example.test/runtime-html'
    });

    const pdfResolution = await harness.ResourceCore.resolveResource(exam, 'pdf');
    const htmlResolution = await harness.ResourceCore.resolveResource(exam, 'html');
    assert.strictEqual(pdfResolution.source, 'runtime');
    assert.strictEqual(pdfResolution.kind, 'pdf');
    assert.strictEqual(htmlResolution.source, 'runtime');
    assert.strictEqual(htmlResolution.kind, 'html');

    const approved = createPopup('approved-runtime-pdf');
    const approvedResult = handler.openPDF(pdfResolution.url, exam.title, {
        reservationAttempted: true,
        reservedWindow: approved.popup,
        ownsReservedWindow: true,
        preventCurrentWindowFallback: true,
        resourceResolution: pdfResolution
    });
    assert.strictEqual(approvedResult, approved.popup,
        'the real handler should accept the exact resolver-issued runtime PDF resolution');
    assert.deepStrictEqual(approved.state.navigationWrites, [pdfResolution.url]);
    assert.strictEqual(approved.state.closeCalls, 0);

    const forged = createPopup('forged-resolution');
    const forgedResult = handler.openPDF(pdfResolution.url, exam.title, {
        reservationAttempted: true,
        reservedWindow: forged.popup,
        ownsReservedWindow: false,
        preventCurrentWindowFallback: true,
        resourceResolution: Object.freeze({ ...pdfResolution })
    });
    assert.strictEqual(forgedResult, null, 'a structural clone must not forge resolver provenance');
    assert.strictEqual(forged.state.closeCalls, 0,
        'the handler must not close a caller-owned reservation when provenance validation fails');

    const unapproved = createPopup('unapproved-blob');
    const unapprovedResult = handler.openPDF('blob:https://example.test/unapproved', exam.title, {
        reservationAttempted: true,
        reservedWindow: unapproved.popup,
        ownsReservedWindow: true,
        preventCurrentWindowFallback: true,
        resourceResolution: null
    });
    assert.strictEqual(unapprovedResult, null);
    assert.strictEqual(unapproved.state.closeCalls, 1,
        'the handler should close its own reservation when an unapproved Blob is rejected');

    const extensionShapedBlob = createPopup('extension-shaped-blob');
    const extensionShapedResult = handler.openPDF(
        'blob:https://example.test/unapproved.pdf',
        exam.title,
        {
            reservationAttempted: true,
            reservedWindow: extensionShapedBlob.popup,
            ownsReservedWindow: true,
            preventCurrentWindowFallback: true,
            resourceResolution: null
        }
    );
    assert.strictEqual(extensionShapedResult, null,
        'a .pdf suffix must not let an unapproved Blob bypass provenance validation');
    assert.strictEqual(extensionShapedBlob.state.closeCalls, 1);

    const htmlBlob = createPopup('html-blob');
    const htmlBlobResult = handler.openPDF(htmlResolution.url, exam.title, {
        reservationAttempted: true,
        reservedWindow: htmlBlob.popup,
        ownsReservedWindow: true,
        preventCurrentWindowFallback: true,
        resourceResolution: htmlResolution
    });
    assert.strictEqual(htmlBlobResult, null,
        'a genuine HTML resolution must not authorize a Blob as a PDF');
    assert.strictEqual(htmlBlob.state.closeCalls, 1);
    assert.deepStrictEqual(harness.state.windowOpenCalls, [],
        'all Blob cases should use or reject the supplied reservation without a late open');
}

async function main() {
    const tests = [
        testDirectEntryReservesBeforeActiveIndexAndClosesOwnedFailure,
        testDirectEntryReservesBeforeResourceAndPropagatesLaunchContext,
        testDirectEntryNeverLateOpensOrNavigatesHostWhenReservationUnavailable,
        testDirectEntryPreservesCallerOwnedReservationOnFailure,
        testDirectEntryFileProtocolPreservesPathLaunch,
        testPathOnlyLegacyListeningBypassesReadingGuard,
        testExplicitReadingTypeOverridesLegacyListeningPath,
        testSessionReservesBeforeResourceResolutionAndReusesExactWindow,
        testSessionNeverLateOpensOrNavigatesHostWhenReservationUnavailable,
        testSessionReservationOwnershipOnResolutionFailure,
        testRapidOpenExamGenerationCannotCloseNewerReservation,
        testStableCallerWindowNameIsReusedAcrossIndexBackedLaunches,
        testFailedNamedRelaunchPreservesExistingSuccessfulContext,
        testConcurrentFailedNamedRelaunchClosesTransferredBlankReservation,
        testFailedNamedRelaunchPreservesExternallyNavigatedPendingContext,
        testPdfOnlyFallbackFileProtocolPreservesPathLaunch,
        testRandomPracticeReservesPdfWindowBeforeDelayedSelection,
        testRealResourceCoreAndPdfHandlerBlobProvenance
    ];

    for (const test of tests) await test();

    console.log(JSON.stringify({
        status: 'pass',
        detail: `${tests.length}/${tests.length} PDF launch guard tests passed`,
        passed: tests.length,
        total: tests.length
    }, null, 2));
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: 'fail',
        detail: error && error.stack ? error.stack : String(error)
    }, null, 2));
    process.exit(1);
});
