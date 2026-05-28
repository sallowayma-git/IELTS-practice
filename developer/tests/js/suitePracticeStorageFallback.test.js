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
        PracticeCore: {
            store: {
                async listPracticeRecords() {
                    return [{ id: 'core_1', examId: 'core-a' }];
                }
            }
        },
        PracticeStore: {
            async list() {
                return [{ id: 'store_1', examId: 'store-a' }];
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
                    return [{ id: 'recorder_1', examId: 'recorder-a' }];
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
    assert.strictEqual(fromFiltering[0].id, 'recorder_1', '过滤读取应优先 PracticeRecorder');

    delete app.components.practiceRecorder;
    const fromStateSync = await app._listPracticeRecordsWithFallback({ includeRecorder: false });
    assert.strictEqual(fromStateSync[0].id, 'core_1', '无 recorder 时应回退 PracticeCore');

    delete sandboxWindow.PracticeCore;
    const fromStore = await app._listPracticeRecordsWithFallback({ includeRecorder: false });
    assert.strictEqual(fromStore[0].id, 'store_1', '无 PracticeCore 时应回退 PracticeStore');

    delete sandboxWindow.PracticeStore;
    const fromStorage = await app._listPracticeRecordsWithFallback({ includeRecorder: false });
    assert.strictEqual(fromStorage[0].id, 'legacy_1', '最终应回退 storage practice_records');

    await app._updatePracticeRecordsState();
    assert.strictEqual(app.setStateCalls.length, 1, '应同步一次 practice.records');
    assert.strictEqual(app.setStateCalls[0].pathName, 'practice.records');
    assert.strictEqual(app.setStateCalls[0].value[0].id, 'legacy_1');

    process.stdout.write(JSON.stringify({ status: 'pass', detail: 'suitePractice fallback 链统一并按顺序工作' }));
}

main().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
