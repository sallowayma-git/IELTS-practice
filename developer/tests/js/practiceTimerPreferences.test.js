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
    const persisted = { reading: null, listening: null };
    const calls = [];
    let writeFailure = null;
    const window = {
        AppData: {
            ready: Promise.resolve(true),
            preferences: {
                async getTimer() {
                    return JSON.parse(JSON.stringify(persisted));
                },
                async setTimer(scope, value) {
                    if (writeFailure) throw writeFailure;
                    const normalized = JSON.parse(JSON.stringify(value));
                    calls.push({ scope, value: normalized });
                    persisted[scope] = normalized;
                }
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
        Boolean,
        console
    };
    vm.runInNewContext(source, context, { filename: 'practiceTimerPreferences.js' });
    return {
        manager: window.PracticeTimerPreferences,
        calls,
        persisted,
        failWrites(error) { writeFailure = error; }
    };
}

async function testHydrationRetriesAfterAppDataInstall() {
    const window = {};
    const context = {
        window,
        globalThis: window,
        Object,
        Number,
        Math,
        JSON,
        String,
        Boolean,
        console
    };
    vm.runInNewContext(source, context, { filename: 'practiceTimerPreferences-before-appdata.js' });
    assert.equal(await window.PracticeTimerPreferences.ready, false);
    window.AppData = {
        ready: Promise.resolve(true),
        preferences: {
            async getTimer() {
                return { reading: { mode: 'countdown', countdownMinutes: 12 }, listening: { expiryAction: 'lock' } };
            }
        }
    };
    assert.equal(await window.PracticeTimerPreferences.ready, true);
    assert.equal(window.PracticeTimerPreferences.read('reading').countdownMinutes, 12);
    assert.equal(window.PracticeTimerPreferences.read('listening').expiryAction, 'lock');
}

await testHydrationRetriesAfterAppDataInstall();

const { manager, calls, persisted, failWrites } = loadPreferences();
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.equal(await manager.ready, true);

assert.deepEqual(plain(manager.read('reading')), {
    version: 1,
    mode: 'elapsed',
    countdownMinutes: 60,
    limitEnabled: false,
    limitMinutes: 60,
    expiryAction: 'warn'
});

const reading = await manager.save('reading', {
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

const listening = await manager.save('listening', {
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

assert.deepEqual(calls.map((entry) => entry.scope), ['reading', 'listening']);
assert.deepEqual(persisted.reading, plain(reading));
assert.deepEqual(persisted.listening, plain(listening));
assert.equal(manager.read('reading').expiryAction, 'auto-submit');
assert.equal(manager.read('listening').expiryAction, 'lock');

failWrites(new Error('timer persistence unavailable'));
await assert.rejects(
    manager.save('reading', { mode: 'elapsed', expiryAction: 'warn' }),
    /timer persistence unavailable/
);
assert.equal(manager.read('reading').expiryAction, 'auto-submit', 'failed writes must not change the cached preference');

process.stdout.write(JSON.stringify({
    status: 'pass',
    detail: 'practice timer preferences sanitize and persist through AppData independently'
}));
