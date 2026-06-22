#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const source = fs.readFileSync(path.join(repoRoot, 'js/plugins/themes/theme-adapter-base.js'), 'utf8');
const localStorageState = new Map();
let oversizedParseCalls = 0;
const pollutedRecord = JSON.parse(`{
  "id": "record-1",
  "sessionId": "session-1",
  "type": "audio",
  "constructor": { "prototype": { "themeAdapterPolluted": true } },
  "realData": {
    "safe": "ok",
    "__proto__": { "themeAdapterPolluted": true },
    "nested": {
      "prototype": { "themeAdapterPolluted": true }
    }
  }
}`);

const context = vm.createContext({
  console: { log() {}, warn() {}, error() {} },
  JSON: {
    parse(value) {
      if (String(value || '').length > 5 * 1024 * 1024) {
        oversizedParseCalls += 1;
      }
      return JSON.parse(value);
    },
    stringify: JSON.stringify
  },
  localStorage: {
    getItem(key) {
      return localStorageState.has(key) ? localStorageState.get(key) : null;
    },
    setItem(key, value) {
      localStorageState.set(String(key), String(value));
    }
  },
  window: {
    location: { href: 'http://127.0.0.1:3000/', origin: 'http://127.0.0.1:3000', protocol: 'http:' },
    storage: {
      async get(key) {
        return key === 'practice_records' ? [null, 'bad-record', pollutedRecord] : null;
      }
    }
  }
});

vm.runInContext(source, context, { filename: 'theme-adapter-base.js' });

const adapter = context.window.ThemeAdapterBase;
await adapter._loadPracticeRecords();

assert.equal(Object.prototype.themeAdapterPolluted, undefined);
assert.equal(adapter._practiceRecords.length, 1);
const [record] = adapter._practiceRecords;
assert.equal(record.type, 'listening');
assert.equal(Object.prototype.hasOwnProperty.call(record, 'constructor'), false);
assert.equal(Object.prototype.hasOwnProperty.call(record.realData, '__proto__'), false);
assert.equal(Object.prototype.hasOwnProperty.call(record.realData.nested, 'prototype'), false);

context.window.storage = null;
oversizedParseCalls = 0;
localStorageState.set(
  'exam_system_practice_records',
  '{"data":[],"padding":"' + 'x'.repeat((5 * 1024 * 1024) + 1) + '"}'
);
const fallbackRecords = await adapter._readFromStorage('practice_records');
assert.equal(fallbackRecords, null);
assert.equal(oversizedParseCalls, 0, 'oversized theme adapter fallback storage must be rejected before JSON.parse');

console.log(JSON.stringify({
  status: 'pass',
  detail: 'theme adapter storage sanitizer strips unsafe practice record keys'
}, null, 2));
