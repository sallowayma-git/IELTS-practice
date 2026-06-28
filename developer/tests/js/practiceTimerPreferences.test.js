#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/utils/practiceTimerPreferences.js'), 'utf8');

function loadPreferences() {
    const store = new Map();
    const window = {
        localStorage: {
            getItem(key) {
                return store.has(key) ? store.get(key) : null;
            },
            setItem(key, value) {
                store.set(key, String(value));
            }
        }
    };
    const context = {
        window,
        globalThis: window,
        Object,
        Number,
        Math,
        JSON,
        String,
        Boolean
    };
    vm.runInNewContext(source, context, { filename: 'practiceTimerPreferences.js' });
    return { manager: window.PracticeTimerPreferences, store };
}

const { manager, store } = loadPreferences();

assert.equal(manager.READING_KEY, 'ielts_reading_timer_preferences_v2');
assert.equal(manager.LISTENING_KEY, 'ielts_listening_timer_preferences_v1');

assert.deepEqual(manager.read('reading'), {
    version: 1,
    mode: 'elapsed',
    countdownMinutes: 60,
    limitEnabled: false,
    limitMinutes: 60,
    expiryAction: 'warn'
});

const reading = manager.save('reading', {
    mode: 'countdown',
    countdownMinutes: 999,
    limitEnabled: true,
    limitMinutes: 0,
    expiryAction: 'auto-submit'
});
assert.equal(reading.mode, 'countdown');
assert.equal(reading.countdownMinutes, 240);
assert.equal(reading.limitEnabled, true);
assert.equal(reading.limitMinutes, 1);
assert.equal(reading.expiryAction, 'auto-submit');

const listening = manager.save('listening', {
    mode: 'invalid',
    countdownMinutes: '30',
    limitEnabled: false,
    limitMinutes: 'bad',
    expiryAction: 'lock'
});
assert.equal(listening.mode, 'elapsed');
assert.equal(listening.countdownMinutes, 30);
assert.equal(listening.limitEnabled, false);
assert.equal(listening.limitMinutes, 60);
assert.equal(listening.expiryAction, 'lock');

assert.notEqual(manager.keyFor('reading'), manager.keyFor('listening'));
assert(store.has(manager.READING_KEY), 'reading preferences should be persisted');
assert(store.has(manager.LISTENING_KEY), 'listening preferences should be persisted');
assert.equal(manager.read('reading').expiryAction, 'auto-submit');
assert.equal(manager.read('listening').expiryAction, 'lock');

process.stdout.write(JSON.stringify({
    status: 'pass',
    detail: 'practice timer preferences sanitize and persist independently'
}));
