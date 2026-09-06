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
    const practiceListCalls = [];
    const sandboxWindow = {
        location: { href: 'http://localhost/' },
        showMessage() {},
        addEventListener() {},
        removeEventListener() {},
        document: { addEventListener() {}, removeEventListener() {} },
        AppData: {
            ready: Promise.resolve(),
            practice: {
            async list(options) {
                practiceListCalls.push(deepClone(options));
                return [{ id: 'api_1', examId: 'api-a' }];
            },
            async getStats() {
                return { totalPractices: 1 };
            }
            }
        }
    };

    const sandbox = {
        window: sandboxWindow,
        document: sandboxWindow.document,
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

    // 统一入口验证：过滤和聚合只读 AppData.practice
    const fromFiltering = await app._loadSuitePracticeRecordsForFiltering();
    assert.ok(Array.isArray(fromFiltering) && fromFiltering.length > 0, '过滤读取应返回记录');
    assert.strictEqual(fromFiltering[0].id, 'api_1', '过滤读取应通过 AppData.practice.list 获取');

    // 兼容命名的方法内部也必须直达领域 API
    const viaAPI = await app._listPracticeRecordsViaAPI();
    assert.ok(Array.isArray(viaAPI) && viaAPI.length > 0, 'API 读取应返回记录');
    assert.strictEqual(viaAPI[0].id, 'api_1', 'API 读取应通过 AppData.practice.list 获取');
    assert.deepStrictEqual(practiceListCalls, [
        { projection: 'detail' },
        { projection: 'detail' }
    ], '套题去重只应读取详情层，不得加载高亮和笔记层');
    assert.strictEqual(await app._recalculatePracticeStatsFromRecords(), true);

    // 缺少事实层必须明确失败，不能伪装成空记录
    delete sandboxWindow.AppData;
    await assert.rejects(() => app._listPracticeRecordsViaAPI(), /AppData|practice/);

    process.stdout.write(JSON.stringify({ status: 'pass', detail: 'suitePractice only reads AppData.practice and does not fake empty data when unavailable' }));
}

main().catch((error) => {
    const detail = error && error.stack ? error.stack : String(error);
    process.stdout.write(JSON.stringify({ status: 'fail', detail }));
    process.exit(1);
});
