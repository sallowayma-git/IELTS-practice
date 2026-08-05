#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/utils/suitePreference.js'), 'utf8');

// Mirrors practiceTimerPreferences.test.js: each call spins up a fresh vm
// context so the IIFE-captured hydrationPromise cache is reset between
// cases. tenanceAppData.preferences.getSuite is stubbed per scenario so the
// contract "reload must surface stored suite preference on first read" can
// be asserted without racing eager hydration.
function loadSuitePreference(stored) {
    const persisted = JSON.parse(JSON.stringify(stored == null ? {} : stored));
    const patchCalls = [];
    const window = {
        AppData: {
            ready: Promise.resolve(true),
            preferences: {
                async getSuite() {
                    return JSON.parse(JSON.stringify(persisted));
                },
                async patchSuite(patch) {
                    patchCalls.push(JSON.parse(JSON.stringify(patch)));
                }
            }
        }
    };
    const context = {
        window,
        globalThis: window,
        Object,
        Number,
        Math,
        JSON,
        String,
        Boolean,
        Promise,
        console: { log() {}, warn() {}, error() {} }
    };
    vm.runInNewContext(source, context, { filename: 'suitePreference.js' });
    return {
        utils: window.SuitePreferenceUtils,
        patchCalls,
        persisted
    };
}

function loadSuitePreferenceBeforeAppData(stored) {
    const persisted = JSON.parse(JSON.stringify(stored == null ? {} : stored));
    const patchCalls = [];
    const window = {};
    const context = {
        window,
        globalThis: window,
        Object,
        Number,
        Math,
        JSON,
        String,
        Boolean,
        Promise,
        console: { log() {}, warn() {}, error() {} }
    };
    vm.runInNewContext(source, context, { filename: 'suitePreference.js' });
    window.AppData = {
        ready: Promise.resolve(true),
        preferences: {
            async getSuite() { return JSON.parse(JSON.stringify(persisted)); },
            async patchSuite(patch) { patchCalls.push(JSON.parse(JSON.stringify(patch))); }
        }
    };
    return { utils: window.SuitePreferenceUtils, patchCalls };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

// Behaviour contract for Fix 6: after a reload the first call to
// resolveSuitePreference() must surface the persisted suite preference
// (e.g. flowMode='simulation'), not the classic default, because hydration
// is awaited before any suiteConfig read.
{
    const stored = { flowMode: 'simulation', frequencyScope: 'high', autoAdvanceAfterSubmit: false };
    const { utils, patchCalls } = loadSuitePreference(stored);

    // eagerly-kicked hydration has a chance to settle before we await, but
    // resolveSuitePreference awaits it anyway; the first read must reflect
    // the stored value regardless of timing.
    const first = await utils.resolveSuitePreference();
    assert.equal(first.flowMode, 'simulation',
        'first resolve after reload must surface the stored flowMode, not the classic default');
    assert.equal(first.frequencyScope, 'high',
        'first resolve after reload must surface the stored frequencyScope');
    assert.equal(first.autoAdvanceAfterSubmit, false,
        'first resolve after reload must surface the stored autoAdvanceAfterSubmit');
    assert.deepEqual(plain(first), {
        flowMode: 'simulation',
        frequencyScope: 'high',
        autoAdvanceAfterSubmit: false
    });
    // The promise-based read must not mutate persistence on its own.
    assert.equal(patchCalls.length, 0, 'resolveSuitePreference must not patch preferences');
}

// Reverse assertion: once hydration has been awaited, a subsequent call
// must keep returning the stored preference (the cached hydrationPromise
// short-circuits, so the stored value must still answer). ready is the
// hydrateSuitePreference function reference, so it must be invoked, not
// awaited as a bare value.
{
    const stored = { flowMode: 'simulation', frequencyScope: 'high', autoAdvanceAfterSubmit: false };
    const { utils } = loadSuitePreference(stored);

    await utils.ready();
    const result = await utils.resolveSuitePreference();
    assert.equal(result.flowMode, 'simulation');
    assert.equal(result.frequencyScope, 'high');
    const second = await utils.resolveSuitePreference();
    assert.equal(second.flowMode, 'simulation',
        'a second resolve after hydration must still report the stored preference');
    assert.equal(second.frequencyScope, 'high');
}

// Contract default when nothing is persisted: resolve must fall back to the
// canonical classic/all defaults even after hydration runs to completion.
{
    const { utils } = loadSuitePreference({});
    const result = await utils.resolveSuitePreference();
    assert.equal(result.flowMode, 'classic',
        'empty persisted suite must resolve to the classic flowMode default');
    assert.equal(result.frequencyScope, 'all',
        'empty persisted suite must resolve to the all frequencyScope default');
    assert.equal(result.autoAdvanceAfterSubmit, true,
        'classic fallback must auto-advance after submit');
}

// persistSuitePreference is synchronous and reads config.suite inline: after
// hydration surfaces simulation, a persist without an explicit flowMode must
// keep the stored flowMode (Fix 6 contract: persist no longer defers to
// resolveSuitePreference, but the value was already hydrated into config.suite).
{
    const stored = { flowMode: 'simulation', frequencyScope: 'high', autoAdvanceAfterSubmit: false };
    const { utils, patchCalls } = loadSuitePreference(stored);

    await utils.ready();
    const persisted = utils.persistSuitePreference({ autoAdvanceAfterSubmit: true });
    assert.equal(persisted.flowMode, 'simulation',
        'persist must reuse the hydrated flowMode when the caller omits it');
    assert.equal(persisted.frequencyScope, 'high',
        'persist must reuse the hydrated frequencyScope when the caller omits it');
    assert.equal(persisted.autoAdvanceAfterSubmit, true,
        'persist must honour the explicit autoAdvanceAfterSubmit override');
    // persist fires patchSuite asynchronously after hydration settles.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(patchCalls.length, 1, 'persist must persist the resolved preference once');
    assert.deepEqual(patchCalls[0], {
        flowMode: 'simulation',
        frequencyScope: 'high',
        autoAdvanceAfterSubmit: true
    });
}

// Race regression for the suitePracticeMixin synchronous reader: even when
// resolveSuitePreference is never awaited, the eagerly-kicked hydration must
// populate config.suite before ensurePracticeConfig().suite is read. We
// emulate the mixin by awaiting utils.ready() (which is hydrateSuitePreference)
// then synchronously inspecting ensurePracticeConfig().suite.
{
    const stored = { flowMode: 'stationary', frequencyScope: 'custom', autoAdvanceAfterSubmit: true };
    const { utils } = loadSuitePreference(stored);
    await utils.ready();
    const suiteConfig = utils.ensurePracticeConfig().suite;
    assert.equal(suiteConfig.flowMode, 'stationary',
        'eager hydration must populate config.suite.flowMode for synchronous readers');
    assert.equal(suiteConfig.frequencyScope, 'custom',
        'eager hydration must populate config.suite.frequencyScope for synchronous readers');
    assert.equal(suiteConfig.autoAdvanceAfterSubmit, true,
        'eager hydration must populate config.suite.autoAdvanceAfterSubmit for synchronous readers');
}

// runtime-entry loads before core-foundation, so the eager call can legitimately
// run before AppData exists.  That miss must not be cached as a permanent false.
{
    const stored = { flowMode: 'simulation', frequencyScope: 'high', autoAdvanceAfterSubmit: false };
    const { utils } = loadSuitePreferenceBeforeAppData(stored);
    const result = await utils.resolveSuitePreference();
    assert.equal(result.flowMode, 'simulation',
        'late AppData installation must retry suite hydration after the eager early miss');
    assert.equal(result.frequencyScope, 'high');
    assert.equal(result.autoAdvanceAfterSubmit, false);
}

process.stdout.write(JSON.stringify({
    status: 'pass',
    detail: ' suitePreference resolves the hydrated suite preference on first read instead of the classic default'
}));
