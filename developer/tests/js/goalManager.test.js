#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createHarness(seed = {}, options = {}) {
    const storageState = new Map(Object.entries(clone(seed)));
    const localStorageState = new Map(Object.entries(options.localStorage || {}).map(([key, value]) => [key, String(value)]));
    const events = [];
    const windowStub = {};
    const onJsonParse = typeof options.onJsonParse === 'function' ? options.onJsonParse : null;
    const guardedJson = {
        parse(value) {
            if (onJsonParse) {
                onJsonParse(value);
            }
            return JSON.parse(value);
        },
        stringify(value) {
            return JSON.stringify(value);
        }
    };
    const sandbox = {
        window: windowStub,
        console: { log() {}, warn() {}, error() {}, info() {} },
        Date,
        JSON: guardedJson,
        Map,
        Object,
        Array,
        String,
        Number,
        Math,
        Uint8Array,
        CustomEvent: class CustomEvent {
            constructor(type, options = {}) {
                this.type = type;
                this.detail = options.detail;
            }
        }
    };
    const localStorage = {
        getItem(key) {
            return localStorageState.has(key) ? localStorageState.get(key) : null;
        },
        setItem(key, value) {
            localStorageState.set(key, String(value));
        },
        removeItem(key) {
            localStorageState.delete(key);
        }
    };
    windowStub.crypto = {
        randomUUID() {
            return '00000000-0000-4000-8000-000000000001';
        }
    };
    windowStub.addEventListener = () => {};
    windowStub.removeEventListener = () => {};
    windowStub.dispatchEvent = (event) => {
        events.push(event);
        return true;
    };
    windowStub.localStorage = localStorage;
    sandbox.localStorage = localStorage;
    if (options.useWindowStorage !== false) {
        windowStub.storage = {
            async waitForInitialization() {},
            async get(key, fallback) {
                return storageState.has(key) ? clone(storageState.get(key)) : clone(fallback);
            },
            async set(key, value) {
                storageState.set(key, clone(value));
            }
        };
    }
    sandbox.globalThis = windowStub;
    const context = vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/core/goalManager.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'js/core/goalManager.js' });
    return {
        GoalManager: windowStub.GoalManager,
        events,
        storageState,
        localStorageState
    };
}

{
    const { GoalManager, events } = createHarness();
    const manager = new GoalManager();
    const goal = await manager.createGoal({
        type: 'practice_count',
        period: 'daily',
        target: 3,
        title: 'Daily practice'
    });
    assert(goal, 'valid UI goal payload should create a goal');
    assert.equal(goal.type, 'practice_count');
    assert.equal(goal.period, 'daily');
    assert.equal(goal.target, 3);
    assert.equal(manager.getGoals().length, 1);
    assert(events.some((event) => event.type === 'goalUpdated'));
}

{
    const maliciousTitle = '<img src=x onerror=alert(1)>'.repeat(8);
    const { GoalManager } = createHarness({
        learning_goals: [
            {
                id: 'x'.repeat(240),
                type: 'practice_count',
                period: 'daily',
                target: '5',
                title: maliciousTitle
            },
            {
                id: 'bad-type',
                type: '<script>alert(1)</script>',
                period: 'daily',
                target: 1,
                title: 'bad'
            },
            {
                id: 'bad-period',
                type: 'accuracy',
                period: 'javascript:alert(1)',
                target: 1,
                title: 'bad'
            }
        ],
        goal_progress: {
            progress: {},
            streak: {
                current: '<img src=x onerror=alert(1)>',
                best: '9<script>',
                lastDate: 'not-a-date'
            }
        }
    });
    const manager = new GoalManager();
    await manager._readyPromise;
    const goals = manager.getGoals();
    assert.equal(goals.length, 1, 'invalid stored goals should be dropped during initialization');
    assert(goals[0].id.length <= 160, 'stored goal ids should be bounded');
    assert(goals[0].title.length <= 80, 'stored goal titles should be bounded');
    assert.deepEqual(manager.getStreak(), {
        current: 0,
        best: 0,
        lastDate: null
    });
}

{
    const { GoalManager } = createHarness({
        learning_goals: [
            {
                id: `${'g'.repeat(159)}\uD83D\uDE00tail`,
                type: 'practice_count',
                period: 'daily',
                target: 1,
                title: `${'t'.repeat(79)}\uD83D\uDE00tail`
            }
        ]
    });
    const manager = new GoalManager();
    await manager._readyPromise;
    const [goal] = manager.getGoals();
    assert.equal(goal.id, 'g'.repeat(159), 'goal id truncation should not keep a dangling high surrogate');
    assert.equal(goal.title, 't'.repeat(79), 'goal title truncation should not keep a dangling high surrogate');
    assert.equal(/[\uD800-\uDFFF]/.test(goal.id), false);
    assert.equal(/[\uD800-\uDFFF]/.test(goal.title), false);
}

{
    const today = new Date().toISOString().slice(0, 10);
    const progressPayload = JSON.parse(`{
      "${today}": {
        "practice_count": 999999999,
        "study_time": "42",
        "accuracy": "7",
        "accuracy_sum": "900000000",
        "accuracy_count": "12.8",
        "constructor": { "prototype": { "polluted": true } },
        "arbitrary_metric": 123
      },
      "2026-13-99": { "practice_count": 1 },
      "not-a-date": { "study_time": 1 },
      "__proto__": { "polluted": true }
    }`);
    const { GoalManager } = createHarness({
        learning_goals: [{
            id: 'daily-practice',
            type: 'practice_count',
            period: 'daily',
            target: 3,
            title: 'Daily practice'
        }],
        goal_progress: {
            progress: progressPayload,
            streak: {
                current: 1,
                best: 2,
                lastDate: today
            }
        }
    });
    const manager = new GoalManager();
    await manager._readyPromise;

    assert.equal(Object.prototype.polluted, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(manager.progress, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(manager.progress, 'not-a-date'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(manager.progress, '2026-13-99'), false);
    assert.equal(manager.progress[today].practice_count, 1000000);
    assert.equal(manager.progress[today].study_time, 42);
    assert.equal(manager.progress[today].accuracy, 1);
    assert.equal(manager.progress[today].accuracy_sum, 1000000);
    assert.equal(manager.progress[today].accuracy_count, 12);
    assert.equal(Object.prototype.hasOwnProperty.call(manager.progress[today], 'arbitrary_metric'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(manager.progress[today], 'constructor'), false);
}

{
    const storedGoals = Array.from({ length: 150 }, (_, index) => ({
        id: `goal-${index}`,
        type: 'practice_count',
        period: 'daily',
        target: index + 1,
        title: `Goal ${index}`
    }));
    const { GoalManager } = createHarness({
        learning_goals: storedGoals
    });
    const manager = new GoalManager();
    await manager._readyPromise;
    assert.equal(manager.getGoals().length, 100, 'stored goals should be capped before rendering');
    assert.equal(manager.getGoals()[99].id, 'goal-99');
}

{
    let parsed = false;
    const { GoalManager } = createHarness({}, {
        useWindowStorage: false,
        localStorage: {
            learning_goals: '[' + ' '.repeat(1024 * 1024 + 1) + ']',
            goal_progress: '{"progress":{},"streak":{"current":1}}'
        },
        onJsonParse(value) {
            if (String(value).length > 1024 * 1024) {
                parsed = true;
            }
        }
    });
    const manager = new GoalManager();
    await manager._readyPromise;
    assert.equal(parsed, false, 'oversized locally stored goals should be rejected before JSON.parse');
    assert.equal(manager.getGoals().length, 0);
    assert.deepEqual(manager.getStreak(), {
        current: 1,
        best: 0,
        lastDate: null
    });
}

{
    let parsed = false;
    const { GoalManager } = createHarness({}, {
        useWindowStorage: false,
        localStorage: {
            goal_progress: '{"progress":' + ' '.repeat(1024 * 1024 + 1) + '}'
        },
        onJsonParse(value) {
            if (String(value).length > 1024 * 1024) {
                parsed = true;
            }
        }
    });
    const manager = new GoalManager();
    await manager._readyPromise;
    assert.equal(parsed, false, 'oversized locally stored goal progress should be rejected before JSON.parse');
    assert.deepEqual(manager.progress, {});
}

const goalManagerSource = fs.readFileSync(path.join(repoRoot, 'js/core/goalManager.js'), 'utf8');
assert(
    goalManagerSource.includes('MAX_GOAL_STORAGE_JSON_LENGTH = 1024 * 1024') &&
    goalManagerSource.includes('MAX_PROGRESS_STORAGE_JSON_LENGTH = 1024 * 1024') &&
    goalManagerSource.includes('function parseStoredGoalManagerJson') &&
    goalManagerSource.includes('raw.length > maxLength'),
    'goal manager localStorage JSON must be size-checked before parsing'
);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'goal manager tests passed'
}, null, 2));
