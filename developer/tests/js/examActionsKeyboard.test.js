#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/app/examActions.js'), 'utf8');

const delegates = new Map();
const selectedExamIds = [];
const draft = {
    status: 'selecting',
    categories: ['P1', 'P2', 'P3'],
    stageIndex: 0,
    pickedByCategory: {},
    flowMode: 'classic',
    frequencyScope: 'custom'
};
const documentStub = {
    body: { appendChild() {} },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return {}; },
    addEventListener() {}
};
const windowStub = {
    document: documentStub,
    console: { log() {}, warn() {}, error() {} },
    DOM: {
        delegate(type, selector, handler) {
            delegates.set(`${type}:${selector}`, handler);
        }
    },
    appStateService: {
        getCustomSuiteDraft() { return draft; },
        selectCustomSuiteExam(exam) {
            selectedExamIds.push(exam.id);
            return { ...draft, stageIndex: 1 };
        }
    },
    async resolveActiveLibraryIndex() {
        return [{ id: 'reading-p1', title: 'P1 test', type: 'reading', category: 'P1' }];
    },
    browseCategory() {}
};
const sandbox = {
    window: windowStub,
    document: documentStub,
    console: windowStub.console,
    Promise,
    Set,
    Map
};
sandbox.globalThis = windowStub;
vm.runInContext(source, vm.createContext(sandbox), { filename: 'js/app/examActions.js' });
windowStub.ExamActions.setupExamActionHandlers();

const keyHandler = delegates.get('keydown:[data-action="suite-custom-select"]');
assert.strictEqual(typeof keyHandler, 'function', '自选套题卡片应注册键盘事件委托');

const target = { dataset: { action: 'suite-custom-select', examId: 'reading-p1' } };
let prevented = 0;
keyHandler.call(target, { key: 'Enter', repeat: false, preventDefault() { prevented += 1; } });
await new Promise((resolve) => setTimeout(resolve, 0));

assert.deepStrictEqual(selectedExamIds, ['reading-p1'], 'Enter 应选择当前聚焦的自选套题卡片');
assert.strictEqual(prevented, 1, '已处理的键盘激活应阻止默认行为');

keyHandler.call(target, { key: ' ', repeat: false, preventDefault() { prevented += 1; } });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(selectedExamIds, ['reading-p1', 'reading-p1'], 'Space 应选择当前聚焦的自选套题卡片');
assert.strictEqual(prevented, 2, 'Space 激活也应阻止页面滚动');

keyHandler.call(target, { key: 'ArrowDown', repeat: false, preventDefault() { prevented += 1; } });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepStrictEqual(selectedExamIds, ['reading-p1', 'reading-p1'], '非激活键不得误选题目');

console.log(JSON.stringify({
    status: 'pass',
    detail: 'custom suite cards support keyboard activation'
}, null, 2));
