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
    const fullPath = path.join(repoRoot, relativePath);
    const source = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

function createWebStorage() {
    const map = new Map();
    return {
        getItem(key) {
            return map.has(key) ? map.get(key) : null;
        },
        setItem(key, value) {
            map.set(key, String(value));
        },
        removeItem(key) {
            map.delete(key);
        },
        dump() {
            return new Map(map);
        }
    };
}

function createHarness(options = {}) {
    const { syncUiOnReplace = false } = options;
    const practiceState = [
        {
            id: 'record-1',
            title: 'Record 1',
            date: '2026-03-09T10:00:00.000Z',
            percentage: 80,
            duration: 120
        },
        {
            id: 'record-2',
            title: 'Record 2',
            date: '2026-03-09T11:00:00.000Z',
            percentage: 60,
            duration: 90
        }
    ];
    const uiState = practiceState.map((record) => ({ ...record }));
    const localStorage = createWebStorage();
    const sessionStorage = createWebStorage();
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };

    const storageStub = {
        mode: 'indexeddb',
        getKey(key) {
            return `exam_system_${key}`;
        },
        async get() {
            return practiceState.map((record) => ({ ...record }));
        },
        async set(key, value) {
            if (key === 'practice_records') {
                practiceState.splice(0, practiceState.length, ...(Array.isArray(value) ? value.map((record) => ({ ...record })) : []));
            }
            return true;
        },
        async writePersistentValue(key, value) {
            return this.set(key, value);
        }
    };

    const messageLog = [];
    let renderCount = 0;

    const sandbox = {
        console: quietConsole,
        localStorage,
        sessionStorage,
        storage: storageStub,
        confirm: () => true,
        showMessage: (message, type) => {
            messageLog.push({ message, type });
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math,
        JSON,
        processedSessions: {
            clear() {}
        },
        getPracticeRecordsState() {
            return uiState.map((record) => ({ ...record }));
        },
        setPracticeRecordsState(records) {
            uiState.splice(0, uiState.length, ...(Array.isArray(records) ? records.map((record) => ({ ...record })) : []));
            return uiState.map((record) => ({ ...record }));
        },
        getSelectedRecordsState() {
            return new Set();
        },
        clearSelectedRecordsState() {},
        setBulkDeleteModeState() {},
        refreshBulkDeleteButton() {},
        refreshBrowseProgressFromRecords() {},
        updatePracticeView() {},
        normalizeRecordId(id) {
            return id == null ? '' : String(id);
        },
        document: {
            addEventListener() {},
            getElementById() {
                return null;
            },
            querySelector() {
                return null;
            },
            querySelectorAll() {
                return [];
            }
        },
        window: {
            console: quietConsole,
            storage: storageStub,
            app: {
                state: {
                    practice: {
                        records: uiState.map((record) => ({ ...record }))
                    }
                }
            },
            PracticeCore: {
                store: {
                    async listPracticeRecords() {
                        return practiceState.map((record) => ({ ...record }));
                    },
                    async replacePracticeRecords(records) {
                        practiceState.splice(0, practiceState.length, ...(Array.isArray(records) ? records.map((record) => ({ ...record })) : []));
                        if (syncUiOnReplace) {
                            uiState.splice(0, uiState.length, ...(Array.isArray(records) ? records.map((record) => ({ ...record })) : []));
                        }
                        return true;
                    }
                }
            }
        }
    };

    sandbox.globalThis = sandbox.window;
    sandbox.window.localStorage = localStorage;
    sandbox.window.sessionStorage = sessionStorage;

    loadScript('js/main.js', vm.createContext(sandbox));
    sandbox.updatePracticeView = function updatePracticeViewSpy() {
        renderCount += 1;
    };
    sandbox.window.updatePracticeView = sandbox.updatePracticeView;

    return {
        sandbox,
        practiceState,
        localStorage,
        sessionStorage,
        messageLog,
        getRenderCount() {
            return renderCount;
        }
    };
}

async function testDeleteRecordPersistsAndCleansLegacyKeys() {
    const harness = createHarness();
    harness.localStorage.setItem('practice_records', JSON.stringify([{ id: 'legacy-record' }]));
    harness.localStorage.setItem('old_prefix_practice_records', JSON.stringify([{ id: 'legacy-old' }]));
    harness.localStorage.setItem('exam_system_practice_records', 'stale-shadow');

    await harness.sandbox.deleteRecord('record-1');

    assert.deepStrictEqual(
        harness.practiceState.map((record) => record.id),
        ['record-2'],
        'deleteRecord 应删除 canonical store 中的目标记录'
    );
    assert.strictEqual(
        harness.localStorage.getItem('practice_records'),
        JSON.stringify([{ id: 'record-2', title: 'Record 2', date: '2026-03-09T11:00:00.000Z', percentage: 60, duration: 90 }]),
        'deleteRecord 后应同步 legacy practice_records'
    );
    assert.deepStrictEqual(
        harness.sandbox.window.app.state.practice.records.map((record) => record.id),
        ['record-2'],
        'deleteRecord 后应同步 app.state.practice.records，避免页面销毁时把旧记录写回去'
    );
    assert.strictEqual(harness.localStorage.getItem('old_prefix_practice_records'), null, 'deleteRecord 后应清理 old_prefix 影子键');
    assert.strictEqual(harness.localStorage.getItem('exam_system_practice_records'), null, 'deleteRecord 后应清理 indexeddb shadow key');
}

async function testClearPracticeDataPersistsAndClearsLegacyKeys() {
    const harness = createHarness();
    harness.localStorage.setItem('practice_records', JSON.stringify([{ id: 'legacy-record' }]));
    harness.sessionStorage.setItem('practice_records', JSON.stringify([{ id: 'legacy-record' }]));

    await harness.sandbox.clearPracticeData();

    assert.strictEqual(harness.practiceState.length, 0, 'clearPracticeData 应清空 canonical store');
    assert.strictEqual(harness.sandbox.window.app.state.practice.records.length, 0, 'clearPracticeData 后应同步清空 app.state.practice.records');
    assert.strictEqual(harness.localStorage.getItem('practice_records'), null, 'clearPracticeData 后应删除 localStorage legacy 键');
    assert.strictEqual(harness.sessionStorage.getItem('practice_records'), null, 'clearPracticeData 后应删除 sessionStorage legacy 键');
}

async function testDeleteRecordForcesUiRefreshWhenPracticeCoreAlreadySyncedState() {
    const harness = createHarness({ syncUiOnReplace: true });

    await harness.sandbox.deleteRecord('record-1');

    assert.ok(
        harness.getRenderCount() > 0,
        'deleteRecord 后即使全局状态已被 PracticeCore 提前同步，仍应强制刷新 UI，避免残留旧卡片'
    );
}

async function main() {
    try {
        await testDeleteRecordPersistsAndCleansLegacyKeys();
        await testClearPracticeDataPersistsAndClearsLegacyKeys();
        await testDeleteRecordForcesUiRefreshWhenPracticeCoreAlreadySyncedState();
        console.log(JSON.stringify({
            status: 'pass',
            detail: 'deleteRecord / clearPracticeData 已覆盖 canonical store、legacy shadow key 与删除后的强制 UI 刷新链路'
        }, null, 2));
    } catch (error) {
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message
        }, null, 2));
        process.exit(1);
    }
}

main();
