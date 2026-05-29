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

function createHarness(options = {}) {
    const routeCalls = []
    const fetchCalls = []
    const legacyStarts = []
    const ensureGroups = []
    const messages = []
    const search = typeof options.search === 'string' ? options.search : ''
    const apiAvailable = options.apiAvailable !== false
    const fetchOk = options.fetchOk !== false
    const routeOk = options.routeOk !== false

    const documentStub = {
        readyState: 'complete',
        body: null,
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null },
        querySelectorAll() { return [] },
        getElementById() { return null },
        createElement() {
            return {
                id: '',
                style: {},
                innerHTML: '',
                parentNode: null,
                addEventListener() {},
                querySelector() { return null },
                querySelectorAll() { return [] }
            }
        }
    }

    const windowStub = {
        document: documentStub,
        location: { search, href: `app://app/index.html${search}`, protocol: 'app:' },
        AppLazyLoader: {
            ensureGroup(name) {
                ensureGroups.push(name)
                return Promise.resolve(true)
            }
        },
        SuitePreferenceUtils: {
            resolveSuitePreference() {
                return {
                    flowMode: 'simulation',
                    frequencyScope: 'high_medium',
                    autoAdvanceAfterSubmit: true
                }
            },
            persistSuitePreference(partial = {}) {
                return {
                    flowMode: partial.flowMode || 'simulation',
                    frequencyScope: partial.frequencyScope || 'high_medium',
                    autoAdvanceAfterSubmit: partial.flowMode !== 'stationary'
                }
            }
        },
        app: {
            startSuitePractice(selection) {
                legacyStarts.push({ ...selection })
                return Promise.resolve('legacy-started')
            }
        },
        showMessage(message, type) {
            messages.push({ message, type })
        },
        electronAPI: apiAvailable
            ? {
                getLocalApiInfo() {
                    return Promise.resolve({ success: true, data: { baseUrl: 'http://127.0.0.1:49321' } })
                },
                openPracticeRoute(route) {
                    routeCalls.push(route)
                    return Promise.resolve(routeOk ? { success: true, route } : { success: false, error: 'route_failed' })
                }
            }
            : {},
        fetch(url, init = {}) {
            fetchCalls.push({ url, init })
            return Promise.resolve({
                ok: fetchOk,
                json() {
                    return Promise.resolve(fetchOk ? { success: true, data: { sessionId: 'suite_vue_001' } } : { success: false, error: 'failed' })
                }
            })
        }
    }

    const sandbox = {
        window: windowStub,
        document: documentStub,
        console,
        Promise,
        JSON,
        Math,
        Date,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval
    }
    sandbox.globalThis = sandbox.window
    sandbox.global = sandbox.window

    const context = vm.createContext(sandbox)
    loadScript('js/presentation/app-actions.js', context)
    return { windowStub, routeCalls, fetchCalls, legacyStarts, ensureGroups, messages }
}

async function testLegacySuiteEntryPrefersVuePracticeRoute() {
    const harness = createHarness()

    const result = await harness.windowStub.AppActions.startSuitePractice()

    assert.strictEqual(result, true)
    assert.deepStrictEqual(harness.routeCalls, ['/reading-suite/suite_vue_001'])
    assert.strictEqual(harness.fetchCalls.length, 1)
    assert.strictEqual(harness.fetchCalls[0].url, 'http://127.0.0.1:49321/api/practice/reading-suite')
    assert.deepStrictEqual(JSON.parse(harness.fetchCalls[0].init.body), {
        flowMode: 'simulation',
        frequencyScope: 'high_medium'
    })
    assert.deepStrictEqual(harness.legacyStarts, [])
    assert.deepStrictEqual(harness.ensureGroups, [])
}

async function testLegacySuiteFallbackIsPreservedForE2E() {
    for (const search of ['?test_env=1', '?suite_test=1', '?ci=1']) {
        const harness = createHarness({ search })

        const result = await harness.windowStub.AppActions.startSuitePractice()

        assert.strictEqual(result, 'legacy-started', `expected legacy suite for ${search}`)
        assert.deepStrictEqual(harness.routeCalls, [], `unexpected Vue route for ${search}`)
        assert.deepStrictEqual(harness.fetchCalls, [], `unexpected Practice API call for ${search}`)
        assert.deepStrictEqual(harness.ensureGroups, ['practice-suite'], `missing legacy suite lazy group for ${search}`)
        assert.deepStrictEqual(harness.legacyStarts, [{
            flowMode: 'simulation',
            frequencyScope: 'high_medium'
        }], `missing legacy suite start for ${search}`)
    }
}

async function testLegacySuiteDoesNotFallbackWithoutElectronApi() {
    const harness = createHarness({ apiAvailable: false })

    const result = await harness.windowStub.AppActions.startSuitePractice()

    assert.strictEqual(result, undefined)
    assert.deepStrictEqual(harness.routeCalls, [])
    assert.deepStrictEqual(harness.fetchCalls, [])
    assert.deepStrictEqual(harness.ensureGroups, [])
    assert.deepStrictEqual(harness.legacyStarts, [])
    assert.ok(harness.messages.some((entry) => (
        entry.type === 'error' && String(entry.message || '').includes('套题模块加载失败')
    )))
}

async function testLegacySuiteDoesNotFallbackWhenVueApiFails() {
    const harness = createHarness({ fetchOk: false })

    const result = await harness.windowStub.AppActions.startSuitePractice()

    assert.strictEqual(result, undefined)
    assert.strictEqual(harness.fetchCalls.length, 1)
    assert.deepStrictEqual(harness.routeCalls, [])
    assert.deepStrictEqual(harness.ensureGroups, [])
    assert.deepStrictEqual(harness.legacyStarts, [])
    assert.ok(harness.messages.some((entry) => (
        entry.type === 'error' && String(entry.message || '').includes('套题模块加载失败')
    )))
}

async function testLegacySuiteDoesNotFallbackWhenVueRouteFails() {
    const harness = createHarness({ routeOk: false })

    const result = await harness.windowStub.AppActions.startSuitePractice()

    assert.strictEqual(result, undefined)
    assert.strictEqual(harness.fetchCalls.length, 1)
    assert.deepStrictEqual(harness.routeCalls, ['/reading-suite/suite_vue_001'])
    assert.deepStrictEqual(harness.ensureGroups, [])
    assert.deepStrictEqual(harness.legacyStarts, [])
    assert.ok(harness.messages.some((entry) => (
        entry.type === 'error' && String(entry.message || '').includes('套题模块加载失败')
    )))
}

async function main() {
    await testLegacySuiteEntryPrefersVuePracticeRoute()
    await testLegacySuiteFallbackIsPreservedForE2E()
    await testLegacySuiteDoesNotFallbackWithoutElectronApi()
    await testLegacySuiteDoesNotFallbackWhenVueApiFails()
    await testLegacySuiteDoesNotFallbackWhenVueRouteFails()
    console.log(JSON.stringify({
        status: 'pass',
        detail: 'Legacy suite entry uses Vue Practice reading-suite in product mode and preserves legacy only for explicit regression mode'
    }))
}

main().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error)
    console.log(JSON.stringify({ status: 'fail', detail }))
    process.exit(1)
})
