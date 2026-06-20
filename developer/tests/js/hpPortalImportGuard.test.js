#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const sourcePath = path.join(repoRoot, 'js/plugins/hp/hp-portal.js');
const source = fs.readFileSync(sourcePath, 'utf8')
    .replace('const boot = () => Portal.init();', 'window.__hpPortalTest = Portal;\n  const boot = () => Portal.init();');

const emitted = [];
const messages = [];
const localStorageState = new Map();
const hpCore = {
    ready() {},
    emit(type, payload) {
        emitted.push({ type, payload });
    },
    showMessage(message, level) {
        messages.push({ message, level });
    }
};

const context = {
    console,
    window: {
        hpCore,
        location: {
            href: 'http://127.0.0.1:3000/',
            origin: 'http://127.0.0.1:3000',
            protocol: 'http:'
        }
    },
    hpCore,
    document: {
        readyState: 'loading',
        addEventListener() {}
    },
    localStorage: {
        getItem(key) { return localStorageState.has(key) ? localStorageState.get(key) : null; },
        setItem(key, value) { localStorageState.set(key, String(value)); }
    },
    sessionStorage: {
        getItem() { return null; },
        removeItem() {}
    },
    URL,
    URLSearchParams
};
context.window.document = context.document;
context.window.localStorage = context.localStorage;
context.window.sessionStorage = context.sessionStorage;

vm.createContext(context);
vm.runInContext(source, context, { filename: 'js/plugins/hp/hp-portal.js' });

assert(context.window.__hpPortalTest, 'hp portal test handle should be available');

localStorageState.set('hp.portal.state', JSON.stringify({
    activeView: ' SETTINGS ',
    practiceFilter: {
        type: 'javascript:alert(1)',
        query: ` ${'search'.repeat(40)} `,
        '__proto__': { polluted: true },
        constructor: { prototype: { polluted: true } }
    },
    prototype: { polluted: true }
}));
context.window.__hpPortalTest.state = {
    activeView: 'overview',
    practiceFilter: { type: 'all', query: '' }
};
context.window.__hpPortalTest.restoreState();
assert.equal(context.window.__hpPortalTest.state.activeView, 'settings');
assert.equal(context.window.__hpPortalTest.state.practiceFilter.type, 'all');
assert.equal(context.window.__hpPortalTest.state.practiceFilter.query.length, 120);
assert.deepStrictEqual(Object.keys(context.window.__hpPortalTest.state.practiceFilter).sort(), ['query', 'type']);
assert.equal(Object.prototype.polluted, undefined);

context.window.__hpPortalTest.state = {
    activeView: 'not-a-view',
    practiceFilter: {
        type: 'LISTENING',
        query: ' recent tests ',
        prototype: { polluted: true }
    }
};
context.window.__hpPortalTest.persistState();
const persistedState = JSON.parse(localStorageState.get('hp.portal.state'));
assert.equal(persistedState.activeView, 'overview');
assert.deepStrictEqual(persistedState.practiceFilter, {
    type: 'listening',
    query: 'recent tests'
});
assert.equal(Object.prototype.hasOwnProperty.call(persistedState.practiceFilter, 'prototype'), false);

const payload = JSON.parse(`{
  "examIndex": [{
    "id": "exam-1",
    "__proto__": { "polluted": true },
    "metadata": {
      "title": "Safe",
      "constructor": { "prototype": { "polluted": true } }
    }
  }],
  "practiceRecords": [{
    "id": "record-1",
    "realData": {
      "duration": 60,
      "prototype": { "polluted": true }
    }
  }]
}`);

context.window.__hpPortalTest.renderAll = () => {};
context.window.__hpPortalTest.updateSettingsMeta = () => {};
context.window.__hpPortalTest.applyImportedData(payload);

assert.equal(Object.prototype.polluted, undefined);
assert.equal(emitted.length, 1);
assert.equal(emitted[0].type, 'dataUpdated');
assert.equal(Object.prototype.hasOwnProperty.call(emitted[0].payload.examIndex[0], '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(emitted[0].payload.examIndex[0].metadata, 'constructor'), false);
assert.equal(Object.prototype.hasOwnProperty.call(emitted[0].payload.practiceRecords[0].realData, 'prototype'), false);

assert.throws(
    () => context.window.__hpPortalTest.applyImportedData({
        examIndex: Array.from({ length: 5001 }, (_, index) => ({ id: `exam-${index}` }))
    }),
    /too many entries/
);

emitted.length = 0;
localStorageState.set('hp.portal.backups', JSON.stringify([JSON.parse(`{
  "id": "backup-unsafe",
  "createdAt": 1710000000000,
  "exams": [{
    "id": "backup-exam",
    "__proto__": { "polluted": true },
    "metadata": {
      "constructor": { "prototype": { "polluted": true } }
    }
  }],
  "records": [{
    "id": "backup-record",
    "realData": {
      "prototype": { "polluted": true }
    }
  }]
}`)]));
context.window.__hpPortalTest.restoreBackup('backup-unsafe');
assert.equal(Object.prototype.polluted, undefined);
assert.equal(emitted.length, 1);
assert.equal(emitted[0].type, 'dataUpdated');
assert.equal(Object.prototype.hasOwnProperty.call(emitted[0].payload.examIndex[0], '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(emitted[0].payload.examIndex[0].metadata, 'constructor'), false);
assert.equal(Object.prototype.hasOwnProperty.call(emitted[0].payload.practiceRecords[0].realData, 'prototype'), false);

console.log(JSON.stringify({
    status: 'pass',
    detail: 'hp portal import guard tests passed'
}, null, 2));
