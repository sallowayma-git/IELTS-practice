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

const results = [];

function recordResult(name, passed, detail) {
    results.push({ name, passed, detail, timestamp: new Date().toISOString() });
}

function createHarness() {
    const windowStub = {};
    const sandbox = {
        window: windowStub,
        console: { log() {}, warn() {}, error() {}, info() {} },
        Map,
        Set,
        Array,
        Object,
        String,
        Date,
        JSON
    };
    sandbox.globalThis = sandbox.window;
    const context = vm.createContext(sandbox);
    loadScript('js/services/overviewStats.js', context);
    return windowStub.AppServices.overviewStats;
}

function testCustomListeningCategoryIsVisible(service) {
    const stats = service.calculate([
        {
            id: 'custom-listening-deep',
            type: 'listening',
            category: 'Custom',
            path: 'Teacher Pack/level/a/deep/',
            filename: 'custom.html'
        },
        {
            id: 'p2-listening',
            type: 'listening',
            category: 'P2',
            path: 'ListeningPractice/P2/demo/',
            filename: 'demo.html'
        }
    ]);

    const custom = stats.listening.find((entry) => entry.category === 'Custom');
    assert(custom, '自定义听力类别必须进入听力总览卡片');
    assert.strictEqual(custom.total, 1);
    assert.strictEqual(custom.custom, true);
    assert.strictEqual(stats.meta.listeningUnknown, 1, '未知统计仍保留诊断信息');

    const p2 = stats.listening.find((entry) => entry.category === 'P2');
    assert.strictEqual(p2.total, 1, '内置 P2 统计不能被自定义类别破坏');

    recordResult('自定义听力类别在总览可见', true, {
        custom,
        listening: stats.listening
    });
}

function testBlankListeningCategoryFallsBackToCustom(service) {
    const stats = service.calculate([
        {
            id: 'custom-listening-blank',
            type: 'listening',
            category: '',
            path: 'Loose Folder/',
            filename: 'listen.html'
        }
    ]);

    const custom = stats.listening.find((entry) => entry.category === 'Custom');
    assert(custom, '空类别听力导入应归入 Custom');
    assert.strictEqual(custom.total, 1);

    recordResult('空听力类别归入 Custom', true, { custom });
}

function main() {
    try {
        const service = createHarness();
        testCustomListeningCategoryIsVisible(service);
        testBlankListeningCategoryFallsBackToCustom(service);
        console.log(JSON.stringify({
            status: 'pass',
            detail: `${results.length}/${results.length} 测试通过`,
            passed: results.length,
            total: results.length
        }, null, 2));
    } catch (error) {
        recordResult('OverviewStats 测试执行失败', false, { error: error.message });
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message,
            results
        }, null, 2));
        process.exit(1);
    }
}

main();
