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

const results = [];

function recordResult(name, passed, detail) {
    results.push({ name, passed, detail, timestamp: new Date().toISOString() });
}

function createDocumentStub(inputState, buttonState) {
    return {
        readyState: 'complete',
        addEventListener() {},
        querySelector(selector) {
            if (selector === '.main-nav [data-view="practice"]' || selector === '.main-nav [data-view="browse"]' || selector === '.main-nav [data-view="more"]') {
                return { addEventListener() {} };
            }
            if (selector === '.search-input') {
                return inputState;
            }
            if (selector === '.view.active') {
                return { id: 'overview-view' };
            }
            return null;
        },
        getElementById(id) {
            if (id === 'exam-search-input') {
                return inputState;
            }
            if (id === 'search-clear-btn') {
                return buttonState;
            }
            return null;
        }
    };
}

function createHarness() {
    const ensureCalls = [];
    const messages = [];
    const inputState = {
        value: 'ocean',
        focusCalled: false,
        focus() {
            this.focusCalled = true;
        }
    };
    const buttonState = { hidden: false };
    const document = createDocumentStub(inputState, buttonState);
    const windowStub = {
        console,
        document,
        addEventListener() {},
        showMessage(message, type) {
            messages.push({ message, type });
        },
        getExamIndexState() {
            return [
                { id: 'reading-1', title: 'Ocean Passage', type: 'reading', hasHtml: true, path: 'Reading/set-1' }
            ];
        },
        AppLazyLoader: {
            ensureGroup(name) {
                ensureCalls.push(name);
                if (name === 'browse-runtime') {
                    windowStub.openExam = function (examId) {
                        windowStub.__openedExamId = examId;
                    };
                    windowStub.viewPDF = function (examId) {
                        windowStub.__viewedPdfId = examId;
                    };
                    windowStub.searchExams = function (query) {
                        windowStub.__searchedQuery = query;
                    };
                    windowStub.clearSearch = function () {
                        windowStub.__clearSearchInvoked = true;
                    };
                }
                return Promise.resolve(true);
            }
        }
    };

    const sandbox = {
        window: windowStub,
        document,
        console,
        setTimeout(fn) {
            fn();
            return 1;
        },
        clearTimeout() {},
        Promise,
        Math: Object.create(Math),
        Date,
        JSON
    };
    sandbox.Math.random = () => 0;
    sandbox.globalThis = sandbox.window;
    return { context: vm.createContext(sandbox), ensureCalls, messages, inputState, buttonState, windowStub };
}

async function testRandomPracticeEnsuresBrowseRuntime(harness) {
    loadScript('js/app/main-entry.js', harness.context);
    loadScript('js/presentation/app-actions.js', harness.context);

    harness.windowStub.AppActions.startRandomPractice('all', 'reading');
    await Promise.resolve();
    await Promise.resolve();

    assert(harness.ensureCalls.includes('browse-runtime'), '随机练习应主动确保 browse-runtime 已加载');
    assert.strictEqual(harness.windowStub.__openedExamId, 'reading-1', '随机练习应在严格按需模式下仍能打开题目');
    recordResult('严格按需模式随机练习可启动', true, {
        ensureCalls: harness.ensureCalls,
        openedExamId: harness.windowStub.__openedExamId
    });
}

async function testClearSearchProxyLoadsBrowseRuntime(harness) {
    delete harness.windowStub.clearSearch;
    harness.ensureCalls.length = 0;

    loadScript('js/app/main-entry.js', harness.context);
    await Promise.resolve();

    const result = harness.windowStub.clearSearch();
    await Promise.resolve(result);
    await Promise.resolve();

    assert(harness.ensureCalls.includes('browse-runtime'), 'clearSearch 应通过 browse-runtime 代理落到真实实现');
    assert.strictEqual(harness.windowStub.__clearSearchInvoked, true, 'clearSearch 应调用 browse-runtime 中的真实实现');
    recordResult('clearSearch 全局入口可用', true, {
        ensureCalls: harness.ensureCalls
    });
}

async function main() {
    try {
        await testRandomPracticeEnsuresBrowseRuntime(createHarness());
        await testClearSearchProxyLoadsBrowseRuntime(createHarness());
        console.log(JSON.stringify({
            status: 'pass',
            detail: `${results.length}/${results.length} 测试通过`,
            passed: results.length,
            total: results.length
        }, null, 2));
    } catch (error) {
        recordResult('on-demand 入口测试执行失败', false, { error: error.message });
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message,
            results
        }, null, 2));
        process.exit(1);
    }
}

main();
