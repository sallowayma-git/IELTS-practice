#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/app/examActions.js'), 'utf8');

let lastBlob = null;
let clicked = 0;
let revokedUrl = null;

class TestBlob {
    constructor(parts, options = {}) {
        this.parts = parts;
        this.options = options;
        lastBlob = this;
    }
}

const circular = {
    id: 'cycle',
    text: `${'x'.repeat(20010)}<script>alert(1)</script>`,
    score: 10n,
    nested: {
        ok: true
    }
};
circular.self = circular;
Object.defineProperty(circular.nested, '__proto__', {
    enumerable: true,
    value: { polluted: true }
});
circular.nested.constructor = 'drop-me';

const shared = { label: 'shared' };

const documentStub = {
    body: {
        appendChild() {},
        removeChild() {}
    },
    createElement(tagName) {
        assert.equal(tagName, 'a');
        return {
            href: '',
            download: '',
            click() {
                clicked += 1;
            }
        };
    },
    getElementById() {
        return null;
    },
    querySelector() {
        return null;
    },
    querySelectorAll() {
        return [];
    },
    addEventListener() {}
};

const context = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    document: documentStub,
    Blob: TestBlob,
    URL: {
        createObjectURL() {
            return 'blob:exam-actions-export';
        },
        revokeObjectURL(url) {
            revokedUrl = url;
        }
    },
    setTimeout(callback) {
        callback();
    },
    getPracticeRecordsState() {
        return [
            circular,
            { id: 'shared-a', meta: shared },
            { id: 'shared-b', meta: shared },
            ...Array.from({ length: 5005 }, (_, index) => ({ id: `extra-${index}` }))
        ];
    },
    showMessage() {}
};
context.window = context;

vm.runInNewContext(source, context, { filename: 'js/app/examActions.js' });

await context.window.exportPracticeData();

assert.equal(clicked, 1, 'fallback export should trigger one download click');
assert.equal(revokedUrl, 'blob:exam-actions-export', 'fallback export should revoke the object URL after click dispatch');
assert.equal(lastBlob.options.type, 'application/json; charset=utf-8');

const exported = JSON.parse(lastBlob.parts[0]);
assert.equal(exported.length, 5000, 'fallback export should cap record count');
assert.equal(exported[0].self, '[Circular]', 'fallback export should serialize circular references safely');
assert.equal(exported[0].score, '10', 'fallback export should serialize bigint values safely');
assert(exported[0].text.endsWith('...'), 'fallback export should truncate oversized strings');
assert(!Object.prototype.hasOwnProperty.call(exported[0].nested, '__proto__'), 'fallback export should strip __proto__ keys');
assert(!Object.prototype.hasOwnProperty.call(exported[0].nested, 'constructor'), 'fallback export should strip constructor keys');
assert.deepEqual(exported[1].meta, { label: 'shared' }, 'shared values should be preserved on first occurrence');
assert.deepEqual(exported[2].meta, { label: 'shared' }, 'shared values should not be mislabeled as circular');

console.log(JSON.stringify({
    status: 'pass',
    detail: 'exam actions fallback export guard passed'
}, null, 2));
