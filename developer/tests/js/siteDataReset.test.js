#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = fs.readFileSync(path.join(root, 'js/core/siteDataReset.js'), 'utf8');

function createStorage(seed = {}) {
    const values = new Map(Object.entries(seed));
    return {
        values,
        clearCalls: 0,
        clear() {
            this.clearCalls += 1;
            values.clear();
        }
    };
}

function createHarness(options = {}) {
    const events = [];
    const messages = [];
    const requests = [];
    const deleteModes = Object.assign({}, options.deleteModes);
    const localStorage = createStorage({ consent: 'yes' });
    const sessionStorage = createStorage({ recovery: 'active' });
    const indexedDB = {
        deleteDatabase(name) {
            events.push(`delete:${name}`);
            const request = { name, completed: false };
            requests.push(request);
            request.complete = () => {
                if (request.completed) return;
                request.completed = true;
                events.push(`deleted:${name}`);
                request.onsuccess?.({ target: request });
            };
            queueMicrotask(() => {
                const mode = deleteModes[name] || 'success';
                if (mode === 'error') {
                    request.error = new Error(`delete failed: ${name}`);
                    request.onerror?.({ target: request });
                    return;
                }
                if (mode === 'blocked' || mode === 'blocked-success') {
                    request.onblocked?.({ target: request });
                    if (mode === 'blocked') return;
                }
                queueMicrotask(request.complete);
            });
            return request;
        }
    };
    const externalBackup = {
        calls: 0,
        async prepareForFullReset() {
            this.calls += 1;
            events.push('external:prepare');
            if (options.externalError) throw new Error('external backup busy');
        }
    };
    const windowStub = {
        indexedDB,
        localStorage,
        sessionStorage,
        ExternalBackupService: externalBackup,
        confirm: () => options.confirmed !== false,
        showMessage(message, type) { messages.push({ message, type }); },
        console: Object.assign({}, console, { error() {} }),
        location: {
            reloadCalls: 0,
            reload() { this.reloadCalls += 1; events.push('reload'); }
        }
    };
    const context = vm.createContext({
        window: windowStub,
        globalThis: windowStub,
        console: windowStub.console,
        Promise,
        Object,
        Error
    });
    vm.runInContext(source, context, { filename: 'siteDataReset.js' });
    return {
        windowStub,
        events,
        messages,
        requests,
        deleteModes,
        localStorage,
        sessionStorage,
        externalBackup,
        complete(name) {
            const request = requests.find((item) => item.name === name && !item.completed);
            assert.ok(request, `missing pending request for ${name}`);
            request.complete();
        }
    };
}

async function flush() {
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

async function testCancelledReset() {
    const harness = createHarness({ confirmed: false });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.reason, 'cancelled');
    assert.deepEqual(harness.events, []);
    assert.equal(harness.localStorage.clearCalls, 0);
}

async function testSuccessfulReset() {
    const harness = createHarness();
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.databases)), [
        'IELTSAtlasDataV2',
        'ExamSystemDB',
        'IELTSAtlasExternalBackupV2'
    ]);
    assert.equal(result.databases.includes('ExamSystemExternalBackup'), false,
        'legacy external handle database stays untouched for this release');
    assert.equal(harness.events[0], 'external:prepare');
    assert.equal(harness.localStorage.values.size, 0);
    assert.equal(harness.sessionStorage.values.size, 0);
    assert.equal(harness.windowStub.location.reloadCalls, 1);
    assert.equal(result.externalBackupFilesPreserved, true);
}

async function testBlockedDeletionKeepsWaiting() {
    const harness = createHarness({ deleteModes: { IELTSAtlasDataV2: 'blocked' } });
    const pending = harness.windowStub.SiteDataReset.perform({ reload: false });
    let settled = false;
    pending.finally(() => { settled = true; });
    await flush();
    assert.equal(settled, false);
    assert.equal(harness.localStorage.clearCalls, 0, 'storage clears only after every database is deleted');
    assert.ok(harness.messages.some((entry) => entry.type === 'warning' && /关闭其他标签页/.test(entry.message)));
    harness.complete('IELTSAtlasDataV2');
    const result = await pending;
    assert.equal(result.success, true);
    assert.equal(harness.localStorage.values.size, 0);
}

async function testDeletionFailureIsVisible() {
    const harness = createHarness({ deleteModes: { ExamSystemDB: 'error' } });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.success, false);
    assert.equal(result.reason, 'partial_reset');
    assert.equal(result.terminal, false);
    assert.equal(harness.windowStub.location.reloadCalls, 0);
    assert.equal(harness.localStorage.clearCalls, 1);
    assert.ok(harness.messages.some((entry) => entry.type === 'error'));
}

async function testExternalFailureStopsBeforeDeletion() {
    const harness = createHarness({ externalError: true });
    const result = await harness.windowStub.clearCache();
    assert.equal(result.reason, 'external_backup_busy');
    assert.equal(harness.events.some((entry) => entry.startsWith('delete:')), false);
    assert.equal(harness.localStorage.clearCalls, 0);
    assert.equal(harness.windowStub.location.reloadCalls, 0);
}

async function testConcurrentCallsShareOneRun() {
    const harness = createHarness({ deleteModes: { IELTSAtlasDataV2: 'blocked' } });
    const first = harness.windowStub.SiteDataReset.perform({ reload: false });
    const second = harness.windowStub.SiteDataReset.perform({ reload: false });
    await flush();
    assert.equal(harness.events.filter((entry) => entry.startsWith('delete:')).length, 3);
    assert.equal(harness.externalBackup.calls, 1);
    harness.complete('IELTSAtlasDataV2');
    const [left, right] = await Promise.all([first, second]);
    assert.equal(left, right);
}

async function testFinishedNonTerminalRunCanRepeat() {
    const harness = createHarness();
    assert.equal((await harness.windowStub.SiteDataReset.perform({ reload: false })).success, true);
    assert.equal((await harness.windowStub.SiteDataReset.perform({ reload: false })).success, true);
    assert.equal(harness.events.filter((entry) => entry.startsWith('delete:')).length, 6);
    assert.equal(harness.localStorage.clearCalls, 2);
}

await testCancelledReset();
await testSuccessfulReset();
await testBlockedDeletionKeepsWaiting();
await testDeletionFailureIsVisible();
await testExternalFailureStopsBeforeDeletion();
await testConcurrentCallsShareOneRun();
await testFinishedNonTerminalRunCanRepeat();
console.log('SiteDataReset tests passed');
