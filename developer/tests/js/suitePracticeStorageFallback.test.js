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
        // 统一入口：PracticeRecordAPI 是套题练习记录的唯一读取通道
        PracticeRecordAPI: {
            async list() {
                return [{ id: 'api_1', examId: 'api-a' }];
            },
            async saveRecord() {
                throw new Error('saveRecord should not be called in this read test');
            },
            async recalculateStats() {
                return { totalPractices: 1 };
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
        components: {},
        setStateCalls: [],
        setState(pathName, value) {
            this.setStateCalls.push({ pathName, value: deepClone(value) });
        },
        getState() { return null; }
    };

    Object.assign(app, mixins.examSession, mixins.suitePractice);

    // 统一入口验证：_loadSuitePracticeRecordsForFiltering 应通过 PracticeRecordAPI.list 读取
    const fromFiltering = await app._loadSuitePracticeRecordsForFiltering();
    assert.ok(Array.isArray(fromFiltering) && fromFiltering.length > 0, '过滤读取应返回记录');
    assert.strictEqual(fromFiltering[0].id, 'api_1', '过滤读取应通过 PracticeRecordAPI.list 获取');

    // _listPracticeRecordsViaAPI 也应直接走 PracticeRecordAPI.list
    const viaAPI = await app._listPracticeRecordsViaAPI();
    assert.ok(Array.isArray(viaAPI) && viaAPI.length > 0, 'API 读取应返回记录');
    assert.strictEqual(viaAPI[0].id, 'api_1', 'API 读取应通过 PracticeRecordAPI.list 获取');

    // 无 PracticeRecordAPI 时应返回空数组，不崩溃
    delete sandboxWindow.PracticeRecordAPI;
    const emptyResult = await app._listPracticeRecordsViaAPI();
    assert.ok(Array.isArray(emptyResult) && emptyResult.length === 0, '无 API 时应安全返回空数组');

    process.stdout.write(JSON.stringify({ status: 'pass', detail: 'suitePractice 统一通过 PracticeRecordAPI 读取记录' }));
}

main().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
