import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const sourcePath = path.join(repoRoot, 'js/runtime/reviewHighlightDictionary.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const instrumentedSource = source.replace(
    '    const api = {',
    `    global.__reviewHighlightDictionaryTestHooks = {
        configure(options) {
            currentOptions = { ...currentOptions, ...(options || {}) };
        },
        setActiveLookup(lookup, selectedText) {
            activeLookup = lookup || null;
            activeHighlight = { textContent: selectedText || '' };
        },
        saveActiveLookup
    };

    const api = {`
);
assert.notStrictEqual(instrumentedSource, source, 'test instrumentation marker must match production source');

class HTMLElement {}
class HTMLButtonElement extends HTMLElement {
    constructor() {
        super();
        this.textContent = '加入生词';
        this.disabled = false;
    }
}

function createHarness() {
    let uuidSequence = 0;
    const sandbox = {
        window: null,
        document: {},
        HTMLElement,
        HTMLButtonElement,
        Node: class Node {},
        crypto: {
            randomUUID() {
                uuidSequence += 1;
                return `request-${uuidSequence}`;
            }
        },
        console,
        setTimeout,
        clearTimeout
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.runInContext(instrumentedSource, vm.createContext(sandbox), {
        filename: 'js/runtime/reviewHighlightDictionary.js'
    });
    return sandbox;
}

async function run() {
    const harness = createHarness();
    const hooks = harness.__reviewHighlightDictionaryTestHooks;
    const dictionary = harness.ReviewHighlightDictionary;
    const posted = [];

    hooks.configure({
        postMessage(type, payload) {
            posted.push({ type, payload });
            return true;
        }
    });
    hooks.setActiveLookup({
        term: 'resilient',
        zh: '有韧性的',
        en: 'able to recover quickly',
        source: 'local'
    }, 'resilient');

    const failedButton = new HTMLButtonElement();
    const failedSave = hooks.saveActiveLookup(failedButton);
    assert.strictEqual(posted.length, 1);
    assert.strictEqual(posted[0].type, 'VOCAB_HIGHLIGHT_SAVE');
    assert.strictEqual(posted[0].payload.requestId, 'vocab-highlight-request-1');
    assert.strictEqual(failedButton.textContent, '加入生词', 'bare postMessage delivery must not show success');
    assert.strictEqual(
        dictionary.handleSaveOutcome({ requestId: 'unknown-request' }, true),
        false,
        'unknown ACK must not settle another request'
    );
    assert.strictEqual(failedButton.textContent, '加入生词');
    assert.strictEqual(
        dictionary.handleSaveOutcome({ requestId: posted[0].payload.requestId }, false),
        true,
        'matching FAILED must settle the pending request'
    );
    await failedSave;
    assert.strictEqual(failedButton.textContent, '保存失败');
    assert.strictEqual(failedButton.disabled, false);

    const ackButton = new HTMLButtonElement();
    const ackSave = hooks.saveActiveLookup(ackButton);
    assert.strictEqual(posted[1].payload.requestId, 'vocab-highlight-request-2');
    dictionary.handleSaveOutcome({ requestId: posted[1].payload.requestId }, true);
    await ackSave;
    assert.strictEqual(ackButton.textContent, '已加入');
    assert.strictEqual(ackButton.disabled, true);

    const directWrites = [];
    const existingDirectWord = {
        id: 'reading-highlight-durable',
        word: 'durable',
        meaning: '旧释义',
        phonetic: 'old-phonetic',
        note: '用户笔记',
        easeFactor: 2.2,
        interval: 10,
        repetitions: 5,
        intraCycles: 0,
        correctCount: 5,
        lastReviewed: '2026-08-01T00:00:00.000Z',
        nextReview: '2026-08-11T00:00:00.000Z'
    };
    harness.AppData = {
        ready: Promise.resolve(),
        vocab: {
            async mergeListWords(command) {
                directWrites.push(command);
                const incoming = command.words[0];
                existingDirectWord.meaning = incoming.meaning;
                if (incoming.example) existingDirectWord.example = incoming.example;
                if (typeof incoming.phonetic === 'string' && incoming.phonetic.trim()) {
                    existingDirectWord.phonetic = incoming.phonetic.trim().replace(/^\/(.*)\/$/, '$1').trim();
                }
            }
        }
    };
    hooks.configure({
        postMessage() {
            return false;
        }
    });
    hooks.setActiveLookup({ term: 'durable', zh: '持久的', phonetic: '/ˈdjʊərəbəl/' }, 'durable');
    const directButton = new HTMLButtonElement();
    await hooks.saveActiveLookup(directButton);
    assert.strictEqual(directWrites.length, 1, 'unavailable host route must commit through direct AppData');
    assert.strictEqual(directWrites[0].listId, 'reading-highlights');
    const incomingDirectWord = directWrites[0].words[0];
    ['easeFactor', 'interval', 'repetitions', 'intraCycles', 'correctCount', 'lastReviewed', 'nextReview'].forEach((field) => {
        assert.ok(
            !Object.prototype.hasOwnProperty.call(incomingDirectWord, field),
            `direct merge must not overwrite existing ${field}`
        );
    });
    assert.ok(
        Object.prototype.hasOwnProperty.call(incomingDirectWord, 'phonetic'),
        'lookup phonetic must be saved as a structured word field'
    );
    assert.strictEqual(
        incomingDirectWord.phonetic.replace(/^\/(.*)\/$/, '$1').trim(),
        'ˈdjʊərəbəl',
        'structured phonetic may be normalized by the downstream AppData merge'
    );
    assert.ok(
        !incomingDirectWord.note.includes('ˈdjʊərəbəl'),
        'phonetic must not be duplicated into the free-form note'
    );
    assert.strictEqual(existingDirectWord.meaning, '持久的');
    assert.strictEqual(existingDirectWord.phonetic, 'ˈdjʊərəbəl');
    assert.strictEqual(existingDirectWord.note, '用户笔记');
    assert.strictEqual(existingDirectWord.correctCount, 5);
    assert.strictEqual(existingDirectWord.interval, 10);
    assert.strictEqual(directButton.textContent, '已加入');
    assert.strictEqual(directButton.disabled, true);

    hooks.setActiveLookup({ term: 'durable', zh: '耐用的', phonetic: '   ' }, 'durable');
    const blankPhoneticButton = new HTMLButtonElement();
    await hooks.saveActiveLookup(blankPhoneticButton);
    assert.strictEqual(directWrites.length, 2);
    const blankPhoneticWord = directWrites[1].words[0];
    assert.ok(
        !Object.prototype.hasOwnProperty.call(blankPhoneticWord, 'phonetic'),
        'blank lookup phonetic must be omitted from the merge patch'
    );
    assert.strictEqual(
        existingDirectWord.phonetic,
        'ˈdjʊərəbəl',
        'omitted phonetic must not erase the existing stored value'
    );
    assert.ok(
        !blankPhoneticWord.note.includes('ˈdjʊərəbəl'),
        'blank lookup phonetic must not be represented in the note'
    );
    assert.strictEqual(blankPhoneticButton.textContent, '已加入');
    assert.strictEqual(blankPhoneticButton.disabled, true);

    console.log(JSON.stringify({
        status: 'pass',
        detail: 'vocab requestId ACK/FAILED, direct-commit phonetic merge, and UI checks passed'
    }));
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
