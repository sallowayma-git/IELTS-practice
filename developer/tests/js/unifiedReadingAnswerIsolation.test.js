import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const runtimeSource = fs.readFileSync(new URL('../../../js/runtime/unifiedReadingPage.js', import.meta.url), 'utf8');

function control(tagName, attributes, value = '', checked = false) {
    return {
        tagName,
        type: tagName === 'INPUT' ? (attributes.type || 'text') : undefined,
        name: attributes.name || '',
        id: attributes.id || '',
        value,
        checked,
        dataset: {},
        getAttribute(name) { return attributes[name] ?? null; }
    };
}

function queryControls(controls, selector) {
    return controls.filter((field) => selector.split(', ').some((part) => {
        const tag = part.match(/^[a-z]+/i)?.[0];
        if (tag && field.tagName.toLowerCase() !== tag.toLowerCase()) return false;
        if (/^[.#]/.test(part)) return false;
        const attributes = [...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
        if (!attributes.length) return false;
        return attributes.every(([, name, value]) => value === undefined
            ? field.getAttribute(name) !== null
            : field.getAttribute(name) === value);
    }));
}

function createHarness() {
    const practice = [
        control('INPUT', { type: 'radio', name: 'q1' }, 'A', true),
        control('INPUT', { type: 'radio', name: 'q1' }, 'B'),
        control('INPUT', { type: 'checkbox', name: 'q2-3' }, 'C', true),
        control('INPUT', { type: 'checkbox', name: 'q2-3' }, 'A', true),
        control('INPUT', { type: 'checkbox', name: 'q2-3' }, 'D'),
        control('INPUT', { name: 'q4' }, ' practice text '),
        control('INPUT', { name: 'q4', type: 'hidden' }, 'hidden shadow'),
        control('SELECT', { name: 'q5' }, 'E'),
        control('TEXTAREA', { name: 'q6' }, 'practice note answer'),
        control('INPUT', { id: 'q7_input' }, 'id fallback'),
        control('INPUT', { name: 'q8', type: 'hidden' }, 'must stay unanswered'),
        control('INPUT', { id: 'q8_input', type: 'hidden' }, 'hidden id fallback'),
        control('INPUT', { name: 'q999', type: 'checkbox' }, 'outside dataset', true)
    ];
    const reader = [
        control('INPUT', { name: 'q1', type: 'radio' }, 'B', true),
        control('INPUT', { name: 'q2-3', type: 'checkbox' }, 'D', true),
        control('INPUT', { name: 'q4' }, 'reader text'),
        control('SELECT', { name: 'q5' }, 'reader select'),
        control('TEXTAREA', { name: 'q6' }, 'reader textarea'),
        control('INPUT', { id: 'q7_input' }, 'reader fallback'),
        control('INPUT', { name: 'q10', type: 'checkbox' }, 'reader-only answer', true)
    ];
    const practiceDropzone = { dataset: { answerValue: 'G' } };
    const passageDropzone = { dataset: { answerValue: 'I' } };
    const readerDropzone = { dataset: { answerValue: 'reader dropzone' } };
    const left = {
        querySelector(selector) {
            return selector.includes('.match-dropzone[data-question="q11"]') ? passageDropzone : null;
        }
    };
    const root = {
        querySelectorAll(selector) { return queryControls(practice, selector); },
        querySelector(selector) {
            if (selector.includes('.match-dropzone[data-question="q9"]')) return practiceDropzone;
            return this.querySelectorAll(selector)[0] || null;
        }
    };
    let rootAvailable = true;
    let readerOpen = false;
    const document = {
        referrer: '',
        body: { dataset: {} },
        getElementById(id) {
            if (id === 'question-groups') return rootAvailable ? root : null;
            if (id === 'left') return rootAvailable ? left : null;
            return (readerOpen ? [...reader, ...practice] : practice).find((field) => field.id === id) || null;
        },
        querySelectorAll(selector) {
            return queryControls(readerOpen ? [...reader, ...practice] : practice, selector);
        },
        querySelector(selector) {
            if (selector === '#notes-panel textarea') return { value: 'existing practice note' };
            if (selector.includes('.match-dropzone[data-question="q9"]')) {
                return readerOpen ? readerDropzone : practiceDropzone;
            }
            return this.querySelectorAll(selector)[0] || null;
        },
        addEventListener() {}
    };
    const window = {
        document,
        location: { href: 'http://localhost/practice.html' },
        __IELTS_READING_PAGE_TEST_HOOKS__: true,
        CSS: { escape: (value) => String(value) },
        scrollY: 77
    };
    window.parent = window;
    vm.runInNewContext(runtimeSource, { window, document, URL, console });
    const hooks = window.__IELTS_UNIFIED_READING_PAGE_TEST__;
    hooks.setTestState({
        examId: 'practice-exam',
        sessionId: 'existing-session',
        dataset: {
            questionOrder: Array.from({ length: 11 }, (_, index) => `q${index + 1}`),
            answerKey: {},
            questionGroups: []
        }
    });
    return {
        hooks,
        practice,
        reader,
        setReaderOpen(value) { readerOpen = value; },
        removeRoot() { rootAvailable = false; }
    };
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

test('answer and draft payloads ignore controls outside the practice root for every supported question type', () => {
    const harness = createHarness();
    const expected = {
        q1: 'A', q2: ['A', 'C'], q3: ['A', 'C'], q4: 'practice text',
        q5: 'E', q6: 'practice note answer', q7: 'id fallback', q8: '', q9: 'G', q10: '', q11: 'I'
    };
    const before = plain(harness.hooks.collectCurrentDraft());
    assert.deepEqual(before.answers, expected);
    harness.setReaderOpen(true);
    assert.deepEqual(plain(harness.hooks.collectAnswers()), expected);
    const during = plain(harness.hooks.collectCurrentDraft());
    delete before.updatedAt;
    delete during.updatedAt;
    assert.deepEqual(during, before, 'reader controls must not change answers, notes, marks, or draft scroll position');
    harness.setReaderOpen(false);
    assert.deepEqual(plain(harness.hooks.collectAnswers()), expected);
    assert.equal(harness.hooks.getTestState().sessionId, 'existing-session');
});

test('missing practice root cannot collect document-level answers', () => {
    const harness = createHarness();
    harness.setReaderOpen(true);
    harness.removeRoot();
    assert.deepEqual(plain(harness.hooks.collectAnswers()), Object.fromEntries(
        Array.from({ length: 11 }, (_, index) => [`q${index + 1}`, ''])
    ));
});

test('answer replay updates practice controls without changing reader fields or hidden inputs', () => {
    const harness = createHarness();
    harness.setReaderOpen(true);
    const readerBefore = harness.reader.map(({ value, checked }) => ({ value, checked }));
    harness.hooks.applyAnswersToDom({ q1: 'B', q2: ['A', 'D'], q3: ['A', 'D'], q4: 'restored', q8: 'ignored' });
    assert.deepEqual(harness.reader.map(({ value, checked }) => ({ value, checked })), readerBefore);
    assert.equal(harness.practice[0].checked, false);
    assert.equal(harness.practice[1].checked, true);
    assert.equal(harness.practice[4].checked, true);
    assert.equal(harness.practice[5].value, 'restored');
    assert.equal(harness.practice[6].value, 'hidden shadow');
    assert.equal(harness.practice[10].value, 'must stay unanswered');
});
