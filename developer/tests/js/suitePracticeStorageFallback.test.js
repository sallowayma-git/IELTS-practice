#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

function loadScript(relativePath, context) {
    const fullPath = path.join(repoRoot, relativePath);
    const code = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(code, context, { filename: relativePath });
}

function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

async function main() {
    const state = new Map();
    state.set('practice_records', [{ id: 'legacy_1', examId: 'legacy-a' }]);
    const apiRecords = [{ id: 'api_1', examId: 'api-a' }];
    const storage = {
        async get(key, fallback = undefined) {
            if (state.has(key)) {
                return deepClone(state.get(key));
            }
            return deepClone(fallback);
        },
        async set(key, value) {
            state.set(key, deepClone(value));
        }
    };

    const sandboxWindow = {
        location: { href: 'http://localhost/' },
        showMessage() {},
        addEventListener() {},
        removeEventListener() {},
        document: { addEventListener() {}, removeEventListener() {} },
        PracticeRecordAPI: {
            async list() {
                return deepClone(apiRecords);
            },
            async replace(records) {
                apiRecords.splice(
                    0,
                    apiRecords.length,
                    ...(Array.isArray(records) ? records.map((record) => deepClone(record)) : [])
                );
                return deepClone(apiRecords);
            },
            async saveRecord(record) {
                apiRecords.unshift(deepClone(record));
                return deepClone(record);
            },
            async deleteMany(ids) {
                const idSet = new Set((Array.isArray(ids) ? ids : []).map(String));
                const before = apiRecords.length;
                for (let index = apiRecords.length - 1; index >= 0; index -= 1) {
                    const record = apiRecords[index];
                    if (record && idSet.has(String(record.id))) {
                        apiRecords.splice(index, 1);
                    }
                }
                return { deletedCount: before - apiRecords.length, records: deepClone(apiRecords) };
            }
        },
        PracticeCore: {
            store: {
                async listPracticeRecords() {
                    throw new Error('PracticeCore should not be read by business fallback');
                }
            }
        },
        PracticeStore: {
            async list() {
                throw new Error('PracticeStore should not be read by business fallback');
            },
            async save() {
                throw new Error('save should not be called in this case');
            },
            async replace() {
                throw new Error('replace should not be called in this case');
            }
        }
    };

    const sandbox = {
        window: sandboxWindow,
        document: sandboxWindow.document,
        storage,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Math,
        Date,
        JSON,
        Array
    };
    sandbox.globalThis = sandbox.window;
    const context = vm.createContext(sandbox);

    loadScript('js/app/examSessionMixin.js', context);
    loadScript('js/app/suitePracticeMixin.js', context);

    const mixins = sandboxWindow.ExamSystemAppMixins;
    const app = {
        components: {
            practiceRecorder: {
                async getPracticeRecords() {
                    throw new Error('PracticeRecorder should not be read by business fallback');
                }
            }
        },
        setStateCalls: [],
        setState(pathName, value) {
            this.setStateCalls.push({ pathName, value: deepClone(value) });
        },
        getState() { return null; }
    };

    Object.assign(app, mixins.examSession, mixins.suitePractice);

    const fromFiltering = await app._loadSuitePracticeRecordsForFiltering();
    assert.strictEqual(fromFiltering[0].id, 'api_1', '过滤读取应只使用 PracticeRecordAPI');

    const fromStateSync = await app._listPracticeRecordsViaAPI();
    assert.strictEqual(fromStateSync[0].id, 'api_1', '状态同步读取应只使用 PracticeRecordAPI');

    delete sandboxWindow.PracticeRecordAPI;
    const fromStorage = await app._listPracticeRecordsViaAPI();
    assert.strictEqual(fromStorage.length, 0, '无统一记录层时不应把 storage practice_records 当业务事实源');

    await app._updatePracticeRecordsState();
    assert.strictEqual(app.setStateCalls.length, 1, '应同步一次 practice.records');
    assert.strictEqual(app.setStateCalls[0].pathName, 'practice.records');
    assert.strictEqual(app.setStateCalls[0].value.length, 0, '无统一记录层时应同步空记录，避免 legacy shadow key 回灌');

    process.stdout.write(JSON.stringify({ status: 'pass', detail: 'suitePractice 读取链只认 PracticeRecordAPI，并拒绝 raw practice_records 作为业务事实源' }));
}

main().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
