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

console.log(JSON.stringify({
  status: 'pass',
  detail: 'theme adapter storage sanitizer strips unsafe practice record keys'
}, null, 2));
