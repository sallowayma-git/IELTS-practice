#!/usr/bin/env node
// 回归守卫（PR #192 review）：排序筛选偏好写入失败时必须保留用户可见的报错，
// 且失败不能堵塞队列——下一次写入仍须成功持久化。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadScript(relativePath, context) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

async function flushMicrotasks(rounds = 5) {
    // 每个 setTimeout tick 会先排空全部待处理微任务，足以让
    // 入队 -> AppData.ready -> 水合 -> patchBrowse -> outcome -> report
    // 的完整异步链路结算完毕。
    for (let index = 0; index < rounds; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

function createHarness() {
    const durable = {
        lastFilter: null,
        learningState: 'all',
        favoritesOnly: false,
        sortMode: 'default',
        autoScrollEnabled: true,
        readingFavorites: {}
    };
    const patchCalls = [];
    let failNextWrite = false;
    const messages = [];

    const inputs = {
        learningState: [
            { value: 'all', checked: true },
            { value: 'completed', checked: false },
            { value: 'unattempted', checked: false }
        ],
        sortMode: [
            { value: 'default', checked: true },
            { value: 'frequency-desc', checked: false },
            { value: 'difficulty-desc', checked: false }
        ]
    };

    function checked(name) {
        return inputs[name].find((input) => input.checked) || null;
    }

    const panel = {
        hidden: true,
        changeHandlers: [],
        addEventListener(type, handler) {
            if (type === 'change') this.changeHandlers.push(handler);
        },
        querySelector(selector) {
            if (selector === '[name="browse-learning-state"]:checked') return checked('learningState');
            if (selector === '[name="browse-sort-mode"]:checked') return checked('sortMode');
            if (selector === 'input:checked') return checked('learningState');
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '[name="browse-learning-state"]') return inputs.learningState;
            if (selector === '[name="browse-sort-mode"]') return inputs.sortMode;
            return [];
        }
    };

    const trigger = {
        ariaExpanded: 'false',
        ariaLabel: '',
        activeClass: false,
        addEventListener() {},
        classList: {
            toggle(name, enabled) {
                if (name === 'active') trigger.activeClass = !!enabled;
            }
        },
        setAttribute(name, value) {
            if (name === 'aria-expanded') trigger.ariaExpanded = value;
            if (name === 'aria-label') trigger.ariaLabel = value;
        },
        focus() {}
    };

    const elements = {
        'browse-learning-panel': panel,
        'browse-learning-trigger': trigger,
        'browse-learning-label': { textContent: '' },
        'browse-learning-reset': { addEventListener() {} },
        'browse-learning-controls': {
            addEventListener() {},
            contains() { return true; }
        },
        'browse-favorites-only': { checked: false }
    };

    const windowStub = {
        addEventListener() {},
        document: {
            addEventListener() {},
            getElementById: (id) => elements[id] || null
        },
        showMessage(message, level) {
            messages.push({ message, level });
        },
        __renderBrowseResultsForState: async () => {}
    };
    windowStub.window = windowStub;

    const context = vm.createContext(windowStub);
    loadScript('js/services/browseLearningState.js', context);
    loadScript('js/utils/BrowsePreferencesUtils.js', context);
    loadScript('js/components/browseLearningControls.js', context);

    const sandbox = context;
    sandbox.AppData = {
        ready: Promise.resolve(),
        backups: {},
        preferences: {
            getBrowse: async () => JSON.parse(JSON.stringify(durable)),
            patchBrowse: async (patch) => {
                patchCalls.push(JSON.parse(JSON.stringify(patch)));
                if (failNextWrite) {
                    failNextWrite = false;
                    throw new Error('storage unavailable');
                }
                Object.assign(durable, JSON.parse(JSON.stringify(patch)));
                return { committed: true, ...JSON.parse(JSON.stringify(patch)) };
            }
        }
    };

    async function emitChange() {
        for (const handler of panel.changeHandlers) handler();
        await flushMicrotasks();
    }

    return {
        sandbox,
        durable,
        patchCalls,
        messages,
        inputs,
        trigger,
        emitChange,
        select(name, value) {
            // 模拟 radio 的互斥选中，find(checked) 才能读到用户实际选项。
            for (const input of inputs[name]) {
                input.checked = input.value === value;
            }
        },
        setWriteFailure(enabled) {
            failNextWrite = enabled;
        },
        flush() {
            return sandbox.flushBrowsePreferenceWrites();
        }
    };
}

test('sort/filter change failure reports a user-visible error and keeps the durable value', async () => {
    const harness = createHarness();
    harness.sandbox.BrowseLearningControls.setup();
    await harness.sandbox.BrowseLearningControls.ready();

    harness.select('learningState', 'completed');
    harness.select('sortMode', 'frequency-desc');
    harness.setWriteFailure(true);
    await harness.emitChange();

    assert.deepEqual(harness.messages, [{
        message: '筛选或收藏未能保存，请重试。',
        level: 'error'
    }], '写入失败必须通过 showMessage 通知用户');
    assert.equal(harness.durable.learningState, 'all', '写入失败后持久化状态必须保持 all');
    assert.equal(harness.durable.sortMode, 'default', '写入失败后持久化排序必须保持 default');
    assert.equal(harness.sandbox.__browseSortMode, 'frequency-desc', 'UI 侧选中态仍应即时更新');
    await assert.doesNotReject(harness.flush(), 'flush 屏障在写入失败后仍必须正常结算');
});

test('a write after the failure persists and does not report again', async () => {
    const harness = createHarness();
    harness.sandbox.BrowseLearningControls.setup();
    await harness.sandbox.BrowseLearningControls.ready();

    harness.select('learningState', 'completed');
    harness.select('sortMode', 'frequency-desc');
    harness.setWriteFailure(true);
    await harness.emitChange();
    assert.equal(harness.messages.length, 1);

    await harness.emitChange();

    assert.equal(harness.messages.length, 1, '重试成功后不得重复报错');
    assert.equal(harness.durable.learningState, 'completed', '失败后的写入必须持久化学习状态');
    assert.equal(harness.durable.sortMode, 'frequency-desc', '失败后的写入必须持久化排序');
    assert.deepEqual(harness.patchCalls.at(-1), {
        learningState: 'completed',
        favoritesOnly: false,
        sortMode: 'frequency-desc'
    });
    await harness.flush();
    assert.deepEqual(
        { learningState: harness.durable.learningState, sortMode: harness.durable.sortMode },
        { learningState: 'completed', sortMode: 'frequency-desc' },
        'flush 屏障结算后持久化值必须与 UI 一致'
    );
});

test('persistSelection falls back to direct patchBrowse without the queue helpers', async () => {
    const harness = createHarness();
    delete harness.sandbox.enqueueBrowsePreferenceWrite;
    delete harness.sandbox.saveBrowseViewPreferences;
    delete harness.sandbox.flushBrowsePreferenceWrites;
    harness.sandbox.BrowseLearningControls.setup();
    await harness.sandbox.BrowseLearningControls.ready();

    harness.select('learningState', 'completed');
    harness.setWriteFailure(true);
    await harness.emitChange();

    assert.deepEqual(harness.messages, [{
        message: '筛选或收藏未能保存，请重试。',
        level: 'error'
    }], '无队列环境下的直写失败同样必须上报');
    assert.equal(harness.durable.learningState, 'all');
});
