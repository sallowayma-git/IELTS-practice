#!/usr/bin/env node
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..', '..', '..')

function loadScript(relativePath, context) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
    vm.runInContext(source, context, { filename: relativePath })
}

function deepClone(value) {
    return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

function createStorage(initial = {}) {
    const state = new Map(Object.entries(initial).map(([key, value]) => [key, deepClone(value)]))
    return {
        async get(key, fallback = undefined) {
            return state.has(key) ? deepClone(state.get(key)) : deepClone(fallback)
        },
        async set(key, value) {
            state.set(key, deepClone(value))
            return true
        }
    }
}

function createContext({ exposePracticeRouteApi = true } = {}) {
    const exam = {
        id: 'p1-high-01',
        title: 'Reading Passage One',
        type: 'reading',
        hasHtml: true,
        path: 'assets/generated/reading-exams/',
        filename: 'p1-high-01.html',
        pdfFilename: 'p1-high-01.pdf'
    }
    const storage = createStorage({
        active_exam_index_key: 'exam_index',
        exam_index: [exam],
        practice_records: [],
        active_sessions: []
    })
    const routeCalls = []
    const windowMessages = []
    const documentStub = {
        title: 'IELTS Practice',
        body: null,
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null },
        querySelectorAll() { return [] },
        dispatchEvent() { return true },
        createElement() {
            return {
                id: '',
                style: {},
                setAttribute() {},
                appendChild() {},
                parentNode: null
            }
        }
    }
    const electronAPI = exposePracticeRouteApi
        ? {
            async openPracticeRoute(route) {
                routeCalls.push(route)
                return { success: true, route }
            }
        }
        : {}

    const windowStub = {
        storage,
        __READING_EXAM_MANIFEST__: {
            'p1-high-01': {
                examId: 'p1-high-01',
                dataKey: 'p1-high-01',
                script: './p1-high-01.js'
            }
        },
        electronAPI,
        location: { href: 'app://app/index.html', protocol: 'app:' },
        document: documentStub,
        screen: { availWidth: 1440, availHeight: 900 },
        showMessage(text, level) {
            windowMessages.push({ text, level })
        },
        addEventListener() {},
        removeEventListener() {},
        open() {
            throw new Error('window.open should not be used by Vue reading route launch')
        },
        CustomEvent: function CustomEvent(type, init = {}) {
            return { type, detail: init.detail || null }
        }
    }

    const sandbox = {
        window: windowStub,
        document: documentStub,
        storage,
        console,
        URL,
        URLSearchParams,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Math,
        Date,
        JSON,
        Array,
        CustomEvent: windowStub.CustomEvent
    }
    sandbox.globalThis = sandbox.window
    sandbox.global = sandbox.window

    const context = vm.createContext(sandbox)
    loadScript('js/app/readingLaunchMixin.js', context)
    loadScript('js/app/examSessionMixin.js', context)

    const mixins = windowStub.ExamSystemAppMixins
    assert.ok(mixins?.readingLaunch, 'reading launch mixin should load')
    assert.ok(mixins?.examSession, 'exam session mixin should load')

    const app = {
        components: {},
        setState() {},
        getState() { return null },
        updateExamStatus() {},
        refreshOverviewData() {}
    }
    Object.assign(app, mixins.readingLaunch, mixins.examSession)

    return { app, exam, routeCalls, windowMessages, windowStub }
}

async function testReadingDescriptorRouting() {
    const { app, exam } = createContext()

    const normal = app.resolveReadingLaunchDescriptor(exam)
    assert.strictEqual(normal.mode, 'vue_practice_reading')
    assert.strictEqual(normal.route, '/reading/p1-high-01')
    assert.strictEqual(normal.assetId, 'p1-high-01')

    const suite = app.resolveReadingLaunchDescriptor(exam, {
        suiteSessionId: 'suite-1',
        suiteFlowMode: 'simulation',
        sequenceIndex: 0,
        sequenceTotal: 3
    })
    assert.strictEqual(suite.mode, 'unified_html')
    assert.ok(suite.url.includes('assets/generated/reading-exams/reading-practice-unified.html'))
    assert.ok(!suite.route)

    const review = app.resolveReadingLaunchDescriptor(exam, {
        reviewMode: true,
        reviewSessionId: 'history-1'
    })
    assert.strictEqual(review.mode, 'unified_html')

    const forced = app.resolveReadingLaunchDescriptor(exam, { forceLegacyReading: true })
    assert.strictEqual(forced.mode, 'unified_html')
}

async function testNoElectronApiFallsBackToUnifiedHtml() {
    const { app, exam } = createContext({ exposePracticeRouteApi: false })
    const descriptor = app.resolveReadingLaunchDescriptor(exam)
    assert.strictEqual(descriptor.mode, 'unified_html')
    assert.ok(descriptor.url.includes('reading-practice-unified.html'))
}

async function testOpenExamUsesVueRouteWithoutLegacySession() {
    const { app, routeCalls, windowStub } = createContext()
    let sessionStarts = 0
    let openWindowCalls = 0
    let injectCalls = 0
    let setupCalls = 0

    app.startPracticeSession = async () => { sessionStarts += 1 }
    app.openExamWindow = () => {
        openWindowCalls += 1
        return { closed: false }
    }
    app.injectDataCollectionScript = () => { injectCalls += 1 }
    app.setupExamWindowManagement = () => { setupCalls += 1 }

    const opened = await app.openExam('p1-high-01')

    assert.strictEqual(opened, windowStub)
    assert.deepStrictEqual(routeCalls, ['/reading/p1-high-01'])
    assert.strictEqual(sessionStarts, 0)
    assert.strictEqual(openWindowCalls, 0)
    assert.strictEqual(injectCalls, 0)
    assert.strictEqual(setupCalls, 0)
}

async function testSuiteLaunchKeepsLegacyUnifiedHtml() {
    const { app, routeCalls } = createContext()
    const openedWindow = { closed: false, location: { href: 'about:blank' } }
    let sessionStarts = 0
    let injectCalls = 0
    let setupCalls = 0
    const openedUrls = []

    app.startPracticeSession = async () => { sessionStarts += 1 }
    app.openExamWindow = (url, _exam, options) => {
        openedUrls.push({ url, options: { ...options } })
        return openedWindow
    }
    app._guardExamWindowContent = (win) => win
    app.injectDataCollectionScript = () => { injectCalls += 1 }
    app.setupExamWindowManagement = () => { setupCalls += 1 }
    app.ensureExamWindowSession = function ensureExamWindowSession(examId, win) {
        if (!this.examWindows) this.examWindows = new Map()
        const info = { examId, window: win }
        this.examWindows.set(examId, info)
        return info
    }

    const result = await app.openExam('p1-high-01', {
        suiteSessionId: 'suite-1',
        suiteFlowMode: 'simulation',
        sequenceIndex: 0,
        sequenceTotal: 3
    })

    assert.strictEqual(result, openedWindow)
    assert.deepStrictEqual(routeCalls, [])
    assert.strictEqual(sessionStarts, 1)
    assert.strictEqual(injectCalls, 1)
    assert.strictEqual(setupCalls, 1)
    assert.strictEqual(openedUrls.length, 1)
    assert.ok(openedUrls[0].url.includes('reading-practice-unified.html'))
    assert.strictEqual(openedUrls[0].options.target, 'inline')
    assert.strictEqual(openedUrls[0].options.suiteSessionId, 'suite-1')
}

async function main() {
    await testReadingDescriptorRouting()
    await testNoElectronApiFallsBackToUnifiedHtml()
    await testOpenExamUsesVueRouteWithoutLegacySession()
    await testSuiteLaunchKeepsLegacyUnifiedHtml()
    console.log(JSON.stringify({
        status: 'pass',
        detail: 'Legacy single-reading launch redirects to Vue Practice route while suite/review fallbacks stay on unified HTML'
    }))
}

main().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error)
    console.log(JSON.stringify({ status: 'fail', detail }))
    process.exit(1)
})
