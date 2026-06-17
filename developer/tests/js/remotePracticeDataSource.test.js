#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadScript(relativePath, context) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

function createContext() {
    const windowStub = {
        ExamData: {
            cloneValue(value) {
                return value == null ? value : JSON.parse(JSON.stringify(value));
            }
        },
        console: { log() {}, warn() {}, error() {}, info() {} },
        dispatchEvent() {},
        CustomEvent: class CustomEvent {
            constructor(type, options = {}) {
                this.type = type;
                this.detail = options.detail;
            }
        }
    };
    const context = vm.createContext({
        window: windowStub,
        console: windowStub.console,
        JSON,
        Map,
        Promise,
        Error
    });
    loadScript('js/data/dataSources/remotePracticeDataSource.js', context);
    return { context, window: windowStub };
}

function createLocalDataSource(initial = {}) {
    const state = new Map(Object.entries(initial));
    const calls = [];
    return {
        state,
        calls,
        async read(key, defaultValue) {
            calls.push(['read', key]);
            return state.has(key) ? state.get(key) : defaultValue;
        },
        async write(key, value) {
            calls.push(['write', key, value]);
            state.set(key, value);
            return true;
        },
        async remove(key) {
            calls.push(['remove', key]);
            state.delete(key);
            return true;
        }
    };
}

async function testPracticeRecordsUseRemoteAndMirrorLocal() {
    const { window } = createContext();
    const local = createLocalDataSource({ settings: { theme: 'light' } });
    const remoteRecords = [{ id: 'remote-1', type: 'reading', score: 90, date: '2026-01-01T00:00:00.000Z' }];
    const apiCalls = [];
    const apiClient = {
        user: { id: 'user-1' },
        isAuthenticated() {
            return true;
        },
        async listPracticeRecords() {
            apiCalls.push(['list']);
            return remoteRecords;
        },
        async replacePracticeRecords(records) {
            apiCalls.push(['replace', records]);
            return records;
        }
    };

    const dataSource = new window.ExamData.RemotePracticeDataSource(local, apiClient);
    assert.deepStrictEqual(await dataSource.read('practice_records', []), remoteRecords);
    assert.deepStrictEqual(local.state.get('practice_records'), remoteRecords);

    await dataSource.write('settings', { theme: 'dark' });
    assert.deepStrictEqual(apiCalls, [['list']]);
    assert.deepStrictEqual(local.state.get('settings'), { theme: 'dark' });

    const replacement = [{ id: 'remote-2', type: 'listening', score: 70, date: '2026-01-02T00:00:00.000Z' }];
    await dataSource.write('practice_records', replacement);
    assert.deepStrictEqual(apiCalls[1], ['replace', replacement]);
    assert.deepStrictEqual(local.state.get('practice_records'), replacement);
}

async function testUnauthorizedReadFallsBackToLocal() {
    const { window } = createContext();
    const fallbackRecords = [{ id: 'local-1', type: 'reading', score: 50, date: '2026-01-01T00:00:00.000Z' }];
    const local = createLocalDataSource({ practice_records: fallbackRecords });
    const apiClient = {
        user: { id: 'user-1' },
        isAuthenticated() {
            return Boolean(this.user);
        },
        async listPracticeRecords() {
            const error = new Error('Authentication required');
            error.status = 401;
            throw error;
        }
    };

    const dataSource = new window.ExamData.RemotePracticeDataSource(local, apiClient);
    assert.deepStrictEqual(await dataSource.read('practice_records', []), fallbackRecords);
    assert.strictEqual(apiClient.user, null);
}

async function testImportMarkersAreScopedByUserId() {
    const windowStub = {
        ExamData: {},
        localStorage: null
    };
    const context = vm.createContext({
        window: windowStub,
        console,
        JSON,
        Map,
        Promise
    });
    loadScript('js/data/authOverlay.js', context);

    const storage = new Map();
    const markerStore = windowStub.ExamData.createRemoteImportMarkerStore({
        getItem(key) {
            return storage.has(key) ? storage.get(key) : null;
        },
        setItem(key, value) {
            storage.set(key, String(value));
        }
    });

    assert.notStrictEqual(
        windowStub.ExamData.getRemoteImportMarkerKey('user-a'),
        windowStub.ExamData.getRemoteImportMarkerKey('user-b')
    );
    assert.strictEqual(await markerStore.has('user-a'), false);
    await markerStore.mark('user-a');
    assert.strictEqual(await markerStore.has('user-a'), true);
    assert.strictEqual(await markerStore.has('user-b'), false);
}

async function main() {
    await testPracticeRecordsUseRemoteAndMirrorLocal();
    await testUnauthorizedReadFallsBackToLocal();
    await testImportMarkersAreScopedByUserId();
    console.log(JSON.stringify({
        status: 'pass',
        detail: 'remote practice data source tests passed'
    }, null, 2));
}

main().catch((error) => {
    console.log(JSON.stringify({
        status: 'fail',
        detail: error.message
    }, null, 2));
    process.exit(1);
});
