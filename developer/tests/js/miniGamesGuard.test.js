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
const source = fs.readFileSync(path.join(repoRoot, 'js', 'presentation', 'miniGames.js'), 'utf8');

function loadHooks(fetchImpl) {
    const context = {
        console,
        TextEncoder,
        Uint32Array,
        fetch: fetchImpl,
        crypto: {
            getRandomValues(buffer) {
                buffer[0] = 0;
                return buffer;
            }
        },
        document: {
            readyState: 'loading',
            addEventListener() {},
            getElementById() { return null; },
            querySelector() { return null; },
            querySelectorAll() { return []; }
        },
        showMessage() {}
    };
    context.window = context;
    context.globalThis = context;

    const patchedSource = source.replace(
        '    global.VocabSparkGame = {',
        [
            '    global.__MiniGamesGuardHooks = {',
            '        normalizeVocabEntry,',
            '        ensureVocabSparkLexicon,',
            '        drawVocabSparkQueue,',
            '        parseVocabSparkLexiconJson',
            '    };',
            '    global.VocabSparkGame = {'
        ].join('\n')
    );

    vm.createContext(context);
    vm.runInContext(patchedSource, context, { filename: 'js/presentation/miniGames.js' });
    assert(context.__MiniGamesGuardHooks, 'mini games hooks should be exposed for tests');
    return context.__MiniGamesGuardHooks;
}

test('vocab entries normalize control characters and bound text length', () => {
    const hooks = loadHooks(async () => {
        throw new Error('fetch should not be called');
    });
    const entry = hooks.normalizeVocabEntry({
        word: `  ${'word'.repeat(40)}\u0000\n `,
        meaning: ` ${'meaning'.repeat(90)}\u0007 `
    });

    assert(entry, 'long but valid vocab entry should be retained');
    assert(entry.word.length <= 120);
    assert(entry.meaning.length <= 500);
    assert(!/[\u0000-\u001f\u007f]/.test(entry.word));
    assert(!/[\u0000-\u001f\u007f]/.test(entry.meaning));
});

test('vocab lexicon loading caps entries before exposing the game list', async () => {
    const payload = Array.from({ length: 5200 }, (_, index) => ({
        word: index === 0 ? 'w'.repeat(200) : `word-${index}`,
        meaning: index === 0 ? 'm'.repeat(700) : `meaning-${index}`
    }));
    const body = JSON.stringify(payload);
    const hooks = loadHooks(async () => ({
        ok: true,
        status: 200,
        headers: {
            get(name) {
                return String(name).toLowerCase() === 'content-length'
                    ? String(Buffer.byteLength(body, 'utf8'))
                    : null;
            }
        },
        async text() {
            return body;
        }
    }));

    const lexicon = await hooks.ensureVocabSparkLexicon();

    assert.equal(lexicon.length, 5000);
    assert.equal(lexicon[0].word.length, 120);
    assert.equal(lexicon[0].meaning.length, 500);
});

test('vocab draw queue only samples from the bounded lexicon window', () => {
    const hooks = loadHooks(async () => {
        throw new Error('fetch should not be called');
    });
    const lexicon = Array.from({ length: 5200 }, (_, index) => ({
        word: `word-${index}`,
        meaning: `meaning-${index}`
    }));

    const queue = hooks.drawVocabSparkQueue(lexicon, 5200);

    assert.equal(queue.length, 5000);
    assert(queue.every((entry) => Number(entry.word.slice('word-'.length)) < 5000));
});
