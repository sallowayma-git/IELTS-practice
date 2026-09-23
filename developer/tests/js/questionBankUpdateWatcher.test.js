#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(root, 'js/runtime/questionBankUpdateWatcher.js'), 'utf8');

function createHarness() {
    const versions = ['before', 'after'];
    let cursor = 0;
    let reloads = 0;
    const activeSessions = new Map([['exam-1', {}]]);
    const window = {
        location: { protocol: 'https:', reload() { reloads += 1; } },
        CloudSync: { getState: () => ({ available: true }) },
        app: { components: { practiceRecorder: { activeSessions } } },
        console: { info() {}, warn() {} },
        setInterval() { return 1; },
        async fetch() {
            return { ok: true, async json() { return { revision: versions[Math.min(cursor++, versions.length - 1)] }; } };
        }
    };
    window.window = window;
    const context = vm.createContext({ window, globalThis: window, Date, Promise, Error, String, Number, console: window.console });
    vm.runInContext(source, context, { filename: 'questionBankUpdateWatcher.js' });
    return { watcher: window.QuestionBankUpdateWatcher, activeSessions, reloads: () => reloads };
}

test('question-bank changes defer restart until no practice session is active', async () => {
    const { watcher, activeSessions, reloads } = createHarness();
    const initial = await watcher.checkNow();
    assert.equal(initial.checked, true);
    assert.equal(initial.changed, false);
    const deferred = await watcher.checkNow();
    assert.equal(deferred.checked, true);
    assert.equal(deferred.changed, true);
    assert.equal(deferred.deferred, true);
    assert.equal(reloads(), 0);
    activeSessions.clear();
    const restarted = await watcher.checkNow();
    assert.equal(restarted.checked, true);
    assert.equal(restarted.changed, true);
    assert.equal(restarted.restarted, true);
    assert.equal(reloads(), 1);
});

test('file protocol does not poll the deployment-only revision endpoint', async () => {
    const { watcher } = createHarness();
    const result = await watcher.checkNow();
    assert.equal(result.checked, true);

    const fileWindow = {
        location: { protocol: 'file:', reload() {} },
        console: { info() {}, warn() {} },
        setInterval() { throw new Error('file protocol must not register polling'); },
        fetch() { throw new Error('file protocol must not request a revision'); }
    };
    fileWindow.window = fileWindow;
    const context = vm.createContext({ window: fileWindow, globalThis: fileWindow, Date, Promise, Error, String, Number, console: fileWindow.console });
    vm.runInContext(source, context, { filename: 'questionBankUpdateWatcher.js' });
    assert.equal(fileWindow.QuestionBankUpdateWatcher.supportsRevisionChecks(), false);
    const skipped = await fileWindow.QuestionBankUpdateWatcher.checkNow();
    assert.equal(skipped.reason, 'unsupported-protocol');
});

test('HTTP static deployments do not request the revision endpoint when sync is unavailable', async () => {
    const staticWindow = {
        location: { protocol: 'https:', reload() {} },
        CloudSync: { getState: () => ({ available: false }) },
        console: { info() {}, warn() {} },
        setInterval() { throw new Error('static deployment must not register polling'); },
        fetch() { throw new Error('static deployment must not request a revision'); }
    };
    staticWindow.window = staticWindow;
    const context = vm.createContext({ window: staticWindow, globalThis: staticWindow, Date, Promise, Error, String, Number, console: staticWindow.console });
    vm.runInContext(source, context, { filename: 'questionBankUpdateWatcher.js' });

    const skipped = await staticWindow.QuestionBankUpdateWatcher.checkNow();
    assert.equal(staticWindow.QuestionBankUpdateWatcher.supportsRevisionChecks(), false);
    assert.equal(skipped.reason, 'backend-unavailable');
});

test('watcher uses the documented revision endpoint instead of generated version metadata', () => {
    assert.match(source, /\/api\/question-bank-revision/);
    assert.doesNotMatch(source, /question-bank-version\.json/);
});

test('question-bank updater limits Git restores to generated assets without a generated version file', () => {
    const updaterSource = fs.readFileSync(path.join(root, 'backend/scripts/update-question-bank.sh'), 'utf8');
    assert.match(updaterSource, /remote=\$\{QUESTION_BANK_REMOTE:-upstream\}/);
    assert.match(updaterSource, /git -C "\$repo_root" remote get-url "\$remote"/);
    assert.match(updaterSource, /git fetch --quiet/);
    assert.match(updaterSource, /git diff --quiet FETCH_HEAD -- \$asset_paths/);
    assert.match(updaterSource, /git restore --worktree --source=FETCH_HEAD -- \$asset_paths/);
    assert.doesNotMatch(updaterSource, /question-bank-version\.json/);
    assert.match(updaterSource, /never pulls\n# application code/);
});
