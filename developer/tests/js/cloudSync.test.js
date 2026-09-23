#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { test } from 'node:test';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeResponse(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async text() {
            return payload == null ? '' : (typeof payload === 'string' ? payload : JSON.stringify(payload));
        }
    };
}

function createAppDataHarness(initialRecords) {
    const records = clone(initialRecords);
    const practice = Object.freeze({
        async list() {
            return clone(records);
        },
        async completeAttempt(command) {
            const record = clone(command.record || command.attempt || command);
            const index = records.findIndex((item) => String(item.id) === String(record.id));
            if (index >= 0) records[index] = record;
            else records.unshift(record);
            return { record: clone(record) };
        },
        async delete(command) {
            const recordId = String(command.recordId || command.id || command);
            const index = records.findIndex((item) => String(item.id) === recordId);
            if (index >= 0) records.splice(index, 1);
            return { deletedCount: index >= 0 ? 1 : 0 };
        },
        async clear() {
            records.splice(0, records.length);
            return { ok: true };
        }
    });
    return {
        practice,
        async records() {
            return clone(records);
        }
    };
}

function createHarness({ backendAvailable = true, healthPayload, document } = {}) {
    const calls = [];
    const remoteRecords = [{ id: 'remote-record', updatedAt: '2026-09-01T00:00:00.000Z' }];
    const appData = createAppDataHarness([{ id: 'local-record', updatedAt: '2026-09-02T00:00:00.000Z' }]);
    const window = {
        location: { protocol: 'http:' },
        AppData: appData,
        setTimeout,
        clearTimeout,
        console: { log() {}, warn() {}, error() {} },
        async fetch(url, options = {}) {
            calls.push({ url, options: clone(options) });
            if (url === '/api/health') return makeResponse(backendAvailable ? 200 : 404, healthPayload === undefined ? (backendAvailable ? { ok: true } : { error: 'Not found' }) : healthPayload);
            if (url === '/api/auth/me') return makeResponse(401, { user: null, csrfToken: 'csrf-anonymous' });
            if (url === '/api/auth/csrf') return makeResponse(200, { csrfToken: 'csrf-anonymous' });
            if (url === '/api/auth/login') return makeResponse(200, {
                user: { id: 'user-1', username: 'learner' },
                csrfToken: 'csrf-authenticated'
            });
            if (url === '/api/practice-records/import') {
                const incoming = JSON.parse(options.body).records;
                const byId = new Map(remoteRecords.map((record) => [record.id, clone(record)]));
                incoming.forEach((record) => byId.set(record.id, clone(record)));
                return makeResponse(201, { records: Array.from(byId.values()) });
            }
            if (url === '/api/practice-records/local-record') return makeResponse(200, { removed: 1 });
            return makeResponse(404, { error: 'Not found' });
        }
    };
    if (document) window.document = document;
    window.window = window;
    const context = vm.createContext({
        window,
        globalThis: window,
        setTimeout,
        clearTimeout,
        JSON,
        Promise,
        Error,
        Object,
        Array,
        String,
        encodeURIComponent
    });
    const source = fs.readFileSync(path.join(repoRoot, 'js/core/cloudSync.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'js/core/cloudSync.js' });
    return { appData, calls, cloudSync: window.CloudSync };
}

test('CloudSync keeps an HTTP static deployment in local-only mode after one health check', async () => {
    let createdElements = 0;
    const document = {
        readyState: 'complete',
        body: { appendChild() {} },
        head: { appendChild() {} },
        querySelector() { return null; },
        createElement() {
            createdElements += 1;
            throw new Error('static deployment must not create a cloud-sync UI element');
        }
    };
    const { calls, cloudSync } = createHarness({ backendAvailable: false, document });
    await cloudSync.refreshSession();

    assert.equal(cloudSync.getState().available, false);
    assert.deepEqual(calls.map((call) => call.url), ['/api/health']);
    assert.equal(createdElements, 0);
});

test('CloudSync rejects an HTML 200 fallback as a synchronization backend', async () => {
    const { calls, cloudSync } = createHarness({ healthPayload: '<!doctype html><html></html>' });
    await cloudSync.refreshSession();

    assert.equal(cloudSync.getState().available, false);
    assert.deepEqual(calls.map((call) => call.url), ['/api/health']);
});

test('CloudSync merges server records through the AppData v2 practice API', async () => {
    const { appData, calls, cloudSync } = createHarness();
    await cloudSync.login('learner', 'StrongPass1');
    const synced = await cloudSync.sync();

    assert.equal(cloudSync.getState().user.username, 'learner');
    assert.deepEqual(synced.records.map((record) => record.id).sort(), ['local-record', 'remote-record']);
    assert.deepEqual((await appData.records()).map((record) => record.id).sort(), ['local-record', 'remote-record']);
    const importCall = calls.find((call) => call.url === '/api/practice-records/import');
    assert.equal(importCall.options.headers['X-CSRF-Token'], 'csrf-authenticated');
});

test('CloudSync propagates an AppData practice deletion after the local mutation', async () => {
    const { appData, calls, cloudSync } = createHarness();
    await cloudSync.login('learner', 'StrongPass1');
    await appData.practice.delete({ recordId: 'local-record' });
    await cloudSync.notifyPracticeMutation({ type: 'delete', recordIds: ['local-record'] });
    await cloudSync.sync();

    assert.equal((await appData.records()).some((record) => record.id === 'local-record'), false);
    assert.ok(calls.some((call) => call.url === '/api/practice-records/local-record' && call.options.method === 'DELETE'));
});

test('AppData v2 mutations notify CloudSync and the panel has an independent close path', () => {
    const cloudSyncSource = fs.readFileSync(path.join(repoRoot, 'js/core/cloudSync.js'), 'utf8');
    const appDataSource = fs.readFileSync(path.join(repoRoot, 'js/data/v2/appData.js'), 'utf8');

    assert.match(cloudSyncSource, /global\.AppData\.practice/);
    assert.match(cloudSyncSource, /notifyPracticeMutation/);
    assert.match(cloudSyncSource, /data-cloud-action="close"/);
    assert.match(cloudSyncSource, /function closeDialog\(dialog\)/);
    assert.match(cloudSyncSource, /event\.key === 'Escape'/);
    assert.match(appDataSource, /notifyCloudSync\(\{ type: 'upsert'/);
    assert.match(appDataSource, /notifyCloudSync\(\{ type: 'delete'/);
});
