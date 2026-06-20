#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js/components/practiceHistoryEnhancer.js'), 'utf8');

let lastBlob = null;
let clickCount = 0;
let revokedUrl = null;

class TestBlob {
    constructor(parts, options = {}) {
        this.parts = parts;
        this.options = options;
        lastBlob = this;
    }
}

const documentStub = {
    readyState: 'loading',
    body: {
        appendChild() {},
        removeChild() {},
        insertAdjacentHTML() {}
    },
    addEventListener() {},
    createElement(tagName) {
        assert.strictEqual(tagName, 'a');
        return {
            href: '',
            download: '',
            click() {
                clickCount++;
            }
        };
    },
    getElementById() {
        return null;
    },
    querySelector() {
        return null;
    }
};

const context = {
    console,
    document: documentStub,
    Blob: TestBlob,
    URL: {
        createObjectURL() {
            return 'blob:test-export';
        },
        revokeObjectURL(url) {
            revokedUrl = url;
        }
    },
    setTimeout(callback) {
        callback();
    },
    setInterval() {
        return 1;
    },
    clearInterval() {},
    HTMLElement: class HTMLElement {}
};
context.window = context;

vm.runInNewContext(source, context, { filename: 'practiceHistoryEnhancer.js' });

const enhancer = context.window.practiceHistoryEnhancer;

assert.strictEqual(
    enhancer.normalizeRecordLookupId('r'.repeat(200)),
    'r'.repeat(200),
    '200-character record ids remain usable'
);
assert.strictEqual(
    enhancer.normalizeRecordLookupId('r'.repeat(201)),
    '',
    'oversized record ids are rejected before lookup or DOM attribute rendering'
);
assert.strictEqual(
    enhancer.normalizeRecordLookupId({ toString() { throw new Error('bad id'); } }),
    '',
    'record id normalization tolerates hostile toString implementations'
);

context.window.app = {
    components: {
        practiceHistory: {
            createRecordItem() {
                return '<h4 class="record-title clickable">Safe title</h4>';
            }
        }
    }
};
enhancer.enhancePracticeHistory();
const renderedRecord = context.window.app.components.practiceHistory.createRecordItem({ id: 'x'.repeat(201) });
assert(
    renderedRecord.includes('data-record-id=""'),
    'enhanced record titles must not render oversized record ids into DOM attributes'
);

context.window.practiceRecords = [{ id: 'safe-record', sessionId: 'session-1' }];
assert.strictEqual(
    await enhancer.fetchRecordById('safe-record'),
    context.window.practiceRecords[0],
    'normal record ids still resolve from legacy records'
);
assert.strictEqual(
    await enhancer.fetchRecordById('x'.repeat(201)),
    null,
    'oversized lookup ids do not trigger legacy record scans'
);

const circular = { id: 'cycle' };
circular.self = circular;
const records = [
    circular,
    { id: 'bigint', score: 10n },
    { id: 'long-string', text: 'a'.repeat(20010) },
    ...Array.from({ length: 5000 }, (_, index) => ({ id: `extra-${index}` }))
];
const stats = { total: 1, nested: { ok: true, constructor: 'drop-me' } };
Object.defineProperty(stats, '__proto__', {
    enumerable: true,
    value: { polluted: true }
});
context.window.practiceRecords = records;
context.window.practiceStats = stats;
context.window.showMessage = () => {};

await enhancer.exportAsJSON();

assert.strictEqual(clickCount, 1, 'JSON export should dispatch one download click');
assert.strictEqual(revokedUrl, 'blob:test-export', 'JSON export should revoke the generated object URL');
assert.strictEqual(lastBlob.options.type, 'application/json', 'JSON export should use a JSON MIME type');

const exported = JSON.parse(lastBlob.parts[0]);
assert.strictEqual(exported.records.length, 5000, 'fallback JSON export caps record count');
assert.strictEqual(exported.truncated.records, true, 'fallback JSON export marks truncated record lists');
assert.strictEqual(exported.records[0].self, '[Circular]', 'fallback JSON export serializes circular references safely');
assert.strictEqual(exported.records[1].score, '10', 'fallback JSON export serializes bigint values safely');
assert(exported.records[2].text.endsWith('...'), 'fallback JSON export truncates oversized strings');
assert(!Object.prototype.hasOwnProperty.call(exported.stats, '__proto__'), 'fallback JSON export strips __proto__ keys');
assert(!Object.prototype.hasOwnProperty.call(exported.stats.nested, 'constructor'), 'fallback JSON export strips constructor keys');

console.log(JSON.stringify({
    status: 'pass',
    detail: 'practice history enhancer tests passed'
}, null, 2));
