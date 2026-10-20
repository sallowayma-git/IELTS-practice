import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8');
const exists = (file) => fs.existsSync(new URL(file, root));

function catalog() {
    const window = {};
    const context = vm.createContext({ window, globalThis: window });
    vm.runInContext(read('assets/generated/reading-exams/manifest.js'), context);
    vm.runInContext(read('assets/generated/reading-explanations/manifest.js'), context);
    return window;
}

const duplicates = (entries, keyOf) => {
    const groups = new Map();
    for (const entry of entries) {
        const key = keyOf(entry);
        if (key) groups.set(key, [...(groups.get(key) || []), entry.examId]);
    }
    return [...groups].filter(([, ids]) => ids.length > 1);
};

const ISSUE_249_MISSING_PDF_IDS = [
    'p1-high-240',
    'p2-high-235',
    'p2-high-239',
    'p2-low-240',
    'p2-low-242',
    'p2-medium-243',
    'p3-high-229',
    'p3-low-240',
    'p3-low-999',
    'p3-medium-241',
    'p3-medium-244',
].sort();

test('each passage is listed under exactly one exam ID', () => {
    const entries = Object.values(catalog().__READING_EXAM_MANIFEST__);
    const title = (entry) => String(entry.title || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    // A re-import must reuse the existing ID; retire released duplicates instead.
    assert.deepEqual(duplicates(entries, (entry) => entry.zyzPassageId), []);
    assert.deepEqual(duplicates(entries, title), []);
});

test('retired exam IDs resolve to a listed passage and own no data', () => {
    const window = catalog();
    const manifest = window.__READING_EXAM_MANIFEST__;
    const listed = new Set(Object.keys(manifest));
    assert.deepEqual(Array.from(window.__READING_EXAM_INDEX__, (exam) => exam.id).sort(), [...listed].sort());
    for (const [retired, current] of Object.entries(window.__READING_EXAM_ALIASES__)) {
        assert.equal(listed.has(retired), false, retired);
        assert.equal(listed.has(current), true, current);
        assert.equal(manifest[retired], manifest[current]);
        assert.equal(window.resolveReadingExamId(retired), current);
        assert.equal(Object.prototype.hasOwnProperty.call(window.__READING_EXPLANATION_MANIFEST__, retired), false);
        assert.equal(exists(`assets/generated/reading-exams/${retired}.js`), false, retired);
        assert.equal(exists(`assets/generated/reading-explanations/${retired}.js`), false, retired);
    }
    assert.equal(window.resolveReadingExamId('p1-high-01'), 'p1-high-01');
});

test('listed passages point at existing data files', () => {
    const window = catalog();
    for (const entry of Object.values(window.__READING_EXAM_MANIFEST__)) {
        if (entry.script) assert.ok(exists(`assets/generated/reading-exams/${entry.script.replace(/^\.\//, '')}`), entry.examId);
    }
    for (const entry of Object.values(window.__READING_EXPLANATION_MANIFEST__)) {
        assert.ok(window.__READING_EXAM_MANIFEST__[entry.examId], entry.examId);
    }
});

test('issue #249 keeps the confirmed missing PDFs unavailable without disabling HTML practice', () => {
    const manifest = catalog().__READING_EXAM_MANIFEST__;

    for (const examId of ISSUE_249_MISSING_PDF_IDS) {
        const entry = manifest[examId];
        assert.ok(entry, `${examId} must remain in the manifest`);
        assert.equal(entry.hasPdf, false, `${examId} must not expose a missing PDF`);
        assert.equal(entry.hasHtml, true, `${examId} must keep its HTML exercise`);
        assert.match(String(entry.pdfFilename || ''), /^ReadingPractice\/PDF\/.+\.pdf$/i, `${examId} must retain its expected PDF locator`);
        assert.match(String(entry.script || ''), /^\.\/p.+\.js$/, `${examId} must retain its generated exercise script`);
        assert.ok(exists(`assets/generated/reading-exams/${entry.script.slice(2)}`), `${examId} exercise script must exist`);
    }
});
