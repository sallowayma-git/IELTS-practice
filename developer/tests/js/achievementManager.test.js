#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/services/achievementManager.js'), 'utf8');

function createLocalStorage(seed = {}) {
    const state = new Map(Object.entries(seed).map(([key, value]) => [key, String(value)]));
    return {
        getItem(key) {
            return state.has(key) ? state.get(key) : null;
        },
        setItem(key, value) {
            state.set(String(key), String(value));
        },
        removeItem(key) {
            state.delete(String(key));
        }
    };
}

function createHarness(options = {}) {
    const localStorage = createLocalStorage(options.localStorage);
    const document = {
        readyState: 'loading',
        addEventListener() {},
        getElementById() {
            return null;
        }
    };
    const window = {
        document,
        localStorage,
        dispatchEvent() {}
    };
    if (options.storage) {
        window.storage = options.storage;
    }
    const context = vm.createContext({
        window,
        document,
        localStorage,
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        console: {
            log() {},
            warn() {},
            error() {}
        }
    });
    vm.runInContext(source, context, { filename: 'js/services/achievementManager.js' });
    return { window, localStorage };
}

const unsafeStoredState = `{
    "first_step": { "unlockedAt": "2026-01-01T00:00:00.000Z" },
    "__proto__": { "pollutedAchievement": true, "unlockedAt": "2026-01-02T00:00:00.000Z" },
    "constructor": { "unlockedAt": "2026-01-03T00:00:00.000Z" },
    "unknown_achievement": { "unlockedAt": "2026-01-04T00:00:00.000Z" },
    "reading_first": { "unlockedAt": "not-a-date" },
    "listening_first": "2026-01-05T00:00:00.000Z"
}`;

const localHarness = createHarness({
    localStorage: {
        user_achievements: unsafeStoredState
    }
});
await localHarness.window.AchievementManager.init();
assert.deepStrictEqual(Object.keys(localHarness.window.AchievementManager.unlocked), ['first_step']);
assert.equal(
    localHarness.window.AchievementManager.unlocked.first_step.unlockedAt,
    '2026-01-01T00:00:00.000Z'
);
assert.equal({}.pollutedAchievement, undefined);

localHarness.window.AchievementManager.unlocked = {
    first_step: { unlockedAt: '2026-01-01T00:00:00.000Z' },
    reading_bronze: { unlockedAt: '2026-01-02T00:00:00.000Z' },
    unknown_achievement: { unlockedAt: '2026-01-03T00:00:00.000Z' },
    constructor: { unlockedAt: '2026-01-04T00:00:00.000Z' },
    reading_first: { unlockedAt: 'invalid-date' }
};
await localHarness.window.AchievementManager._saveUnlockedState();
const saved = JSON.parse(localHarness.localStorage.getItem('user_achievements'));
assert.deepStrictEqual(Object.keys(saved).sort(), ['first_step', 'reading_bronze']);

let storedViaRepository = null;
const storageHarness = createHarness({
    storage: {
        async get(key, fallback) {
            assert.equal(key, 'user_achievements');
            return JSON.parse(unsafeStoredState) || fallback;
        },
        async set(key, value) {
            assert.equal(key, 'user_achievements');
            storedViaRepository = value;
        }
    }
});
await storageHarness.window.AchievementManager.init();
assert.deepStrictEqual(Object.keys(storageHarness.window.AchievementManager.unlocked), ['first_step']);
storageHarness.window.AchievementManager.unlocked = {
    first_step: { unlockedAt: '2026-01-01T00:00:00.000Z' },
    unknown_achievement: { unlockedAt: '2026-01-03T00:00:00.000Z' }
};
await storageHarness.window.AchievementManager._saveUnlockedState();
assert.deepStrictEqual(Object.keys(storedViaRepository), ['first_step']);

assert(
    source.includes('MAX_STORED_UNLOCKED_ACHIEVEMENTS = 200') &&
    source.includes("UNSAFE_UNLOCKED_STATE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])") &&
    source.includes('_normalizeUnlockedState(value)') &&
    source.includes('this.unlocked = this._normalizeUnlockedState(this.unlocked)'),
    'achievement state must be normalized on load and before save'
);

console.log('achievementManager.test.js passed');
