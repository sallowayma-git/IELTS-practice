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

function createHarness(seed = {}) {
    const storageState = new Map(Object.entries(clone(seed)));
    const events = [];
    const windowStub = {};
    const sandbox = {
        window: windowStub,
        console: { log() {}, warn() {}, error() {}, info() {} },
        Date,
        JSON,
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
    windowStub.storage = {
        async waitForInitialization() {},
        async get(key, fallback) {
            return storageState.has(key) ? clone(storageState.get(key)) : clone(fallback);
        },
        async set(key, value) {
            storageState.set(key, clone(value));
        }
    };
    sandbox.globalThis = windowStub;
    const context = vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/core/goalManager.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'js/core/goalManager.js' });
    return {
        GoalManager: windowStub.GoalManager,
        events,
        storageState
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

console.log(JSON.stringify({
    status: 'pass',
    detail: 'goal manager tests passed'
}, null, 2));
