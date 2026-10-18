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

function extractViewPdfSource() {
    const source = read('js/main.js');
    const start = source.indexOf('async function viewPDF(examId)');
    const endMarker = '\n\n// Bridge for record details';
    const end = source.indexOf(endMarker, start);
    assert.notStrictEqual(start, -1, 'viewPDF should exist in js/main.js');
    assert.notStrictEqual(end, -1, 'viewPDF extraction boundary should exist');
    return source.slice(start, end);
}

function createDirectEntryHarness({ protocol, exam, resolutionUrl = '', resolveError = null }) {
    const state = {
        buildCalls: 0,
        resolveCalls: 0,
        openCalls: [],
        messages: []
    };
    const location = {
        protocol,
        href: protocol === 'file:' ? 'file:///workspace/index.html' : `${protocol}//example.test/index.html`
    };
    const resourceCore = {
        isPdfAvailable(candidate) {
            return Boolean(candidate && candidate.hasPdf === true && String(candidate.pdfFilename || '').trim());
        },
        async resolveResource(candidate, kind) {
            state.resolveCalls += 1;
            assert.strictEqual(candidate, exam);
            assert.strictEqual(kind, 'pdf');
            if (resolveError) throw resolveError;
            return { url: resolutionUrl, attempts: [] };
        }
    };
    const windowStub = {
        location,
        ResourceCore: resourceCore,
        buildResourcePath(candidate, kind) {
            state.buildCalls += 1;
            assert.strictEqual(candidate, exam);
            assert.strictEqual(kind, 'pdf');
            return './local-library.pdf';
        }
    };
    const sandbox = {
        window: windowStub,
        console,
        async resolveActiveExamIndex() { return exam ? [exam] : []; },
        getResourceCore() { return resourceCore; },
        showMessage(message, type) {
            state.messages.push({ message, type });
            return null;
        },
        openPDFSafely(url, title) {
            state.openCalls.push({ url, title });
            return { url, title };
        }
    };
    sandbox.globalThis = windowStub;
    const context = vm.createContext(sandbox);
    vm.runInContext(extractViewPdfSource(), context, { filename: 'js/main.js#viewPDF' });
    return { context, state, location };
}

function createSessionHarness({ protocol, resolutionUrl = '' }) {
    const state = {
        buildCalls: 0,
        resolveCalls: 0,
        openCalls: [],
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
    const openedWindow = {
        closed: false,
        location: { href: '' },
        focus() {}
    };
    const resourceCore = {
        isPdfAvailable(candidate) {
            return Boolean(candidate && candidate.hasPdf === true && String(candidate.pdfFilename || '').trim());
        },
        async resolveResource(candidate, kind) {
            state.resolveCalls += 1;
            assert.ok(candidate);
            assert.strictEqual(kind, 'pdf');
            return { url: resolutionUrl, attempts: [] };
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
            state.openCalls.push({ url, target, features });
            return openedWindow;
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
        console: {
            log() {},
            warn() {},
            error(...args) { state.consoleErrors.push(args); }
        },
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
    return {
        app,
        state,
        location,
        getCurrentHref: () => currentHref,
        initialHref
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

async function testDirectEntryUnavailableFailsClosed() {
    const exam = pdfExam({ hasPdf: false });
    const harness = createDirectEntryHarness({
        protocol: 'https:',
        exam,
        resolutionUrl: '/should-not-resolve.pdf'
    });

    await harness.context.viewPDF(exam.id);

    assert.strictEqual(harness.state.resolveCalls, 0, 'unavailable PDFs must not be resolved');
    assert.strictEqual(harness.state.buildCalls, 0, 'unavailable PDFs must not have a path built');
    assert.deepStrictEqual(harness.state.openCalls, [], 'unavailable PDFs must not be opened');
    assert.deepStrictEqual(harness.state.messages, [{ message: '此PDF不存在', type: 'error' }]);
}

async function testDirectEntryHttpResolution() {
    const exam = pdfExam();
    const success = createDirectEntryHarness({
        protocol: 'https:',
        exam,
        resolutionUrl: '/deployed/exercise.pdf'
    });

    await success.context.viewPDF(exam.id);

    assert.strictEqual(success.state.resolveCalls, 1, 'HTTP(S) launches must use ResourceCore.resolveResource');
    assert.strictEqual(success.state.buildCalls, 0, 'HTTP(S) launches should use the resolved URL');
    assert.deepStrictEqual(success.state.openCalls, [{
        url: '/deployed/exercise.pdf',
        title: exam.title
    }]);

    const missing = createDirectEntryHarness({ protocol: 'http:', exam, resolutionUrl: '' });
    await missing.context.viewPDF(exam.id);
    assert.strictEqual(missing.state.resolveCalls, 1);
    assert.deepStrictEqual(missing.state.openCalls, [], 'an unresolvable deployed PDF must not be opened');
    assert.deepStrictEqual(missing.state.messages, [{ message: '此PDF不存在', type: 'error' }]);
}

async function testDirectEntryFileProtocolPreservesPathLaunch() {
    const exam = pdfExam();
    const harness = createDirectEntryHarness({ protocol: 'file:', exam });

    await harness.context.viewPDF(exam.id);

    assert.strictEqual(harness.state.resolveCalls, 0, 'file:// must not perform the HTTP resource probe');
    assert.strictEqual(harness.state.buildCalls, 1);
    assert.deepStrictEqual(harness.state.openCalls, [{ url: './local-library.pdf', title: exam.title }]);
}

async function testDirectEntryPreservesLegacyListeningBehavior() {
    const exam = {
        id: 'listening-legacy',
        type: 'listening',
        title: 'Legacy listening PDF',
        pdfFilename: 'ListeningPractice/PDF/legacy.pdf'
    };
    const harness = createDirectEntryHarness({ protocol: 'https:', exam });

    await harness.context.viewPDF(exam.id);

    assert.strictEqual(harness.state.resolveCalls, 0,
        'the reading-only availability contract must not add probes to legacy listening');
    assert.strictEqual(harness.state.buildCalls, 1);
    assert.deepStrictEqual(harness.state.openCalls, [{ url: './local-library.pdf', title: exam.title }]);
}

async function testPdfOnlyFallbackUnavailableFailsClosed() {
    const exam = pdfExam({ hasPdf: false });
    const harness = createSessionHarness({ protocol: 'https:', resolutionUrl: '/should-not-resolve.pdf' });

    const result = await harness.app.openExam(exam.id, { examDefinition: exam });

    assert.strictEqual(result, null);
    assert.strictEqual(harness.state.resolveCalls, 0, 'availability must be checked before HTTP resolution');
    assert.deepStrictEqual(harness.state.openCalls, [], 'PDF-only fallback must not call window.open');
    assert.deepStrictEqual(harness.state.navigationWrites, [], 'PDF-only fallback must not navigate the current page');
    assert.strictEqual(harness.getCurrentHref(), harness.initialHref);
    assert.deepStrictEqual(harness.state.messages, [{ message: '此PDF不存在', type: 'error' }]);
}

async function testPdfOnlyFallbackHttpResolution() {
    const exam = pdfExam();
    const missing = createSessionHarness({ protocol: 'https:', resolutionUrl: '' });

    const missingResult = await missing.app.openExam(exam.id, { examDefinition: exam });

    assert.strictEqual(missingResult, null);
    assert.strictEqual(missing.state.resolveCalls, 1);
    assert.deepStrictEqual(missing.state.openCalls, []);
    assert.deepStrictEqual(missing.state.navigationWrites, []);
    assert.deepStrictEqual(missing.state.messages, [{ message: '此PDF不存在', type: 'error' }]);

    const success = createSessionHarness({ protocol: 'https:', resolutionUrl: '/deployed/exercise.pdf' });
    const opened = await success.app.openExam(exam.id, { examDefinition: exam });

    assert.ok(opened, 'a resolvable PDF should retain the existing popup behavior');
    assert.strictEqual(success.state.resolveCalls, 1);
    assert.strictEqual(success.state.openCalls.length, 1);
    assert.strictEqual(success.state.openCalls[0].url, 'https://example.test/deployed/exercise.pdf');
    assert.strictEqual(success.state.openCalls[0].target, `pdf_${exam.id}`);
    assert.deepStrictEqual(success.state.navigationWrites, []);
}

async function testPdfOnlyFallbackFileProtocolPreservesPathLaunch() {
    const exam = pdfExam();
    const harness = createSessionHarness({ protocol: 'file:' });

    const opened = await harness.app.openExam(exam.id, { examDefinition: exam });

    assert.ok(opened);
    assert.strictEqual(harness.state.resolveCalls, 0);
    assert.strictEqual(harness.state.openCalls.length, 1);
    assert.strictEqual(harness.state.openCalls[0].url, 'file:///workspace/local-library.pdf');
    assert.deepStrictEqual(harness.state.navigationWrites, []);
}

async function testPdfOnlyAsyncFailureStaysInsideOpenExamBoundary() {
    const exam = pdfExam();
    const harness = createSessionHarness({ protocol: 'https:', resolutionUrl: '/deployed/exercise.pdf' });
    const originalEnsureAbsoluteUrl = harness.app._ensureAbsoluteUrl.bind(harness.app);
    let normalizationCalls = 0;
    harness.app._ensureAbsoluteUrl = (url) => {
        normalizationCalls += 1;
        if (normalizationCalls === 2) throw new Error('post-resolution normalization failed');
        return originalEnsureAbsoluteUrl(url);
    };

    const result = await harness.app.openExam(exam.id, { examDefinition: exam });

    assert.strictEqual(result, null, 'openExam should contain asynchronous PDF launch failures');
    assert.strictEqual(harness.state.resolveCalls, 1);
    assert.deepStrictEqual(harness.state.openCalls, []);
    assert.deepStrictEqual(harness.state.navigationWrites, []);
    assert.deepStrictEqual(harness.state.messages, [{ message: '打开题目失败，请重试', type: 'error' }]);
    assert.strictEqual(harness.state.consoleErrors.length, 1);
}

async function main() {
    const tests = [
        testDirectEntryUnavailableFailsClosed,
        testDirectEntryHttpResolution,
        testDirectEntryFileProtocolPreservesPathLaunch,
        testDirectEntryPreservesLegacyListeningBehavior,
        testPdfOnlyFallbackUnavailableFailsClosed,
        testPdfOnlyFallbackHttpResolution,
        testPdfOnlyFallbackFileProtocolPreservesPathLaunch,
        testPdfOnlyAsyncFailureStaysInsideOpenExamBoundary
    ];

    for (const test of tests) {
        await test();
    }

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
