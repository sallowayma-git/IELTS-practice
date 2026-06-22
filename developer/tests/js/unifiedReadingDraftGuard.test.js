#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import test from 'node:test';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'js', 'runtime', 'unifiedReadingPage.js'), 'utf8');

function createContext() {
    const context = {
        console,
        URL,
        URLSearchParams,
        setInterval() { return 1; },
        clearInterval() {},
        setTimeout(callback) {
            if (typeof callback === 'function') {
                callback();
            }
            return 1;
        },
        clearTimeout() {},
        requestAnimationFrame(callback) {
            if (typeof callback === 'function') {
                callback();
            }
            return 1;
        },
        addEventListener() {},
        removeEventListener() {},
        scrollY: 0,
        scrollX: 0,
        scrollTo() {},
        close() {},
        opener: null,
        parent: null,
        location: {
            href: 'http://127.0.0.1:3000/templates/reading.html?exam=test',
            origin: 'http://127.0.0.1:3000',
            protocol: 'http:',
            search: '?exam=test'
        },
        sessionStorage: {
            getItem() { return null; },
            setItem() {},
            removeItem() {}
        },
        document: {
            addEventListener() {},
            getElementById() { return null; },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            createElement() {
                return {
                    className: '',
                    dataset: {},
                    style: {},
                    setAttribute() {},
                    appendChild() {},
                    querySelectorAll() { return []; },
                    addEventListener() {}
                };
            }
        },
        CSS: {
            escape(value) {
                return String(value);
            }
        },
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        }
    };
    context.window = context;
    context.globalThis = context;
    return context;
}

function loadHooks() {
    const context = createContext();
    const patchedSource = source.replace(
        '    function persistSimulationDraftMirror(draft) {',
        [
            '    global.__UnifiedReadingDraftGuardHooks = {',
            '        sanitizeSimulationDraft,',
            '        cloneDraftSafely,',
            '        parseSimulationDraftStorage',
            '    };',
            '',
            '    function persistSimulationDraftMirror(draft) {'
        ].join('\n')
    );
    vm.createContext(context);
    vm.runInContext(patchedSource, context, { filename: 'unifiedReadingPage.js' });
    return context.__UnifiedReadingDraftGuardHooks;
}

test('simulation draft sanitizer removes unsafe keys and bounds restored data', () => {
    const hooks = loadHooks();
    const polluted = JSON.parse(`{
      "answers": {
        "q1": "A",
        "Q2": ${JSON.stringify(Array.from({ length: 60 }, (_, index) => `item-${index}`))},
        "q3": "${'x'.repeat(5000)}",
        "__proto__": "polluted",
        "constructor": "polluted",
        "prototype": "polluted"
      },
      "highlights": ${JSON.stringify(Array.from({ length: 650 }, (_, index) => ({
        scope: index % 2 === 0 ? 'left' : 'bad-scope',
        text: `highlight ${index}`,
        kind: index % 3 === 0 ? 'note' : 'script',
        occurrence: index,
        start: index + 5,
        end: index,
        attrs: { onclick: 'alert(1)' }
      })))},
      "scrollY": 999999999,
      "updatedAt": 12345,
      "__proto__": { "pollutedUnifiedDraft": true }
    }`);

    const sanitized = hooks.sanitizeSimulationDraft(polluted);

    assert.equal(Object.getPrototypeOf(sanitized.answers), null);
    assert.equal(Object.prototype.hasOwnProperty.call(sanitized.answers, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(sanitized.answers, 'constructor'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(sanitized.answers, 'prototype'), false);
    assert.equal(sanitized.answers.q1, 'A');
    assert.equal(sanitized.answers.q2.length, 40);
    assert.equal(sanitized.answers.q3.length, 4000);
    assert.equal(sanitized.highlights.length, 500);
    assert.equal(sanitized.highlights[0].kind, 'note');
    assert.equal(sanitized.highlights[1].kind, 'highlight');
    assert.equal(sanitized.highlights[0].scope, 'left');
    assert.equal(sanitized.highlights[1].scope, 'groups');
    assert.equal(Object.prototype.hasOwnProperty.call(sanitized.highlights[0], 'attrs'), false);
    assert(sanitized.highlights.every((entry) => entry.start <= entry.end));
    assert.equal(sanitized.scrollY, 10000000);
    assert.equal(sanitized.updatedAt, 12345);
    assert.equal(Object.prototype.pollutedUnifiedDraft, undefined);
});

test('simulation draft sanitizer tolerates hostile runtime objects', () => {
    const hooks = loadHooks();
    const throwingAnswers = new Proxy({}, {
        ownKeys() {
            throw new Error('no keys');
        }
    });
    const highlight = { text: 'safe highlight' };
    Object.defineProperty(highlight, 'start', {
        enumerable: true,
        get() {
            throw new Error('bad start');
        }
    });
    const draft = {
        answers: throwingAnswers,
        highlights: [highlight],
        get scrollY() {
            throw new Error('bad scroll');
        }
    };

    const sanitized = hooks.cloneDraftSafely(draft);

    assert.deepEqual(Object.keys(sanitized.answers), []);
    assert.equal(sanitized.highlights.length, 1);
    assert.equal(sanitized.highlights[0].text, 'safe highlight');
    assert.equal(sanitized.highlights[0].start, 0);
    assert.equal(sanitized.scrollY, 0);
});
