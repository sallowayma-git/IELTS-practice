#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function createLocalStorage(seed = {}) {
    const store = new Map(Object.entries(seed));
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        },
        clear() {
            store.clear();
        }
    };
}

function loadVocabStore({ embeddedWords, storageSeed }) {
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {}
    };
    const windowStub = {
        console: quietConsole,
        __EMBEDDED_WORDLISTS__: {
            ielts_core: embeddedWords || []
        },
        location: { protocol: 'file:' }
    };
    const sandbox = {
        window: windowStub,
        console: quietConsole,
        localStorage: createLocalStorage(storageSeed),
        Date,
        Math,
        JSON,
        setTimeout,
        clearTimeout
    };
    sandbox.globalThis = sandbox.window;
    sandbox.window.localStorage = sandbox.localStorage;
    sandbox.window.Date = Date;
    sandbox.window.Math = Math;
    sandbox.window.JSON = JSON;
    sandbox.window.setTimeout = setTimeout;
    sandbox.window.clearTimeout = clearTimeout;

    const context = vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/core/vocabStore.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'js/core/vocabStore.js' });
    return sandbox.window.VocabStore;
}

async function testSpellingErrorUsesEmbeddedLexiconMeaning() {
    const vocabStore = loadVocabStore({
        embeddedWords: [{
            word: 'accommodation',
            meaning: 'n. 住宿',
            example: 'The hotel provides comfortable accommodation.'
        }],
        storageSeed: {
            vocab_list_p1_errors: JSON.stringify({
                id: 'p1',
                words: [{
                    word: 'accommodation',
                    userInput: 'accomodation',
                    questionId: 'q1',
                    examId: 'listening-p1-demo',
                    timestamp: 1710000000000,
                    errorCount: 2,
                    source: 'p1'
                }]
            })
        }
    });

    await vocabStore.init();
    const list = await vocabStore.loadList('spelling-errors-p1');
    assert.strictEqual(list.words.length, 1, '应该加载1个错词');
    assert.strictEqual(list.words[0].word, 'accommodation');
    assert.strictEqual(list.words[0].meaning, 'n. 住宿', '应该使用核心词库中文释义');
    assert.strictEqual(list.words[0].example, 'The hotel provides comfortable accommodation.');
    assert.ok(list.words[0].note.includes('你曾拼写为: accomodation'), '错拼信息应该进入note');
    assert.ok(list.words[0].note.includes('错误2次'), '错误次数应该进入note');
    assert.strictEqual(list.words[0].source, 'P1 听力练习');
}

async function testSpellingErrorFallsBackWhenLexiconMissing() {
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        storageSeed: {
            vocab_list_p4_errors: JSON.stringify({
                id: 'p4',
                words: [{
                    word: 'specialised',
                    userInput: 'specializedd',
                    questionId: 'q8',
                    examId: 'listening-p4-demo',
                    timestamp: 1710000000000,
                    errorCount: 1,
                    source: 'p4'
                }]
            })
        }
    });

    await vocabStore.init();
    const list = await vocabStore.loadList('spelling-errors-p4');
    assert.strictEqual(list.words.length, 1, '应该加载1个错词');
    assert.strictEqual(list.words[0].meaning, '你曾拼写为: specializedd', '词库缺失时应该回退到错拼提示');
    assert.ok(list.words[0].note.includes('来源: listening-p4-demo'), '来源信息应该进入note');
    assert.strictEqual(list.words[0].source, 'P4 听力练习');
}

async function main() {
    const results = [];
    try {
        await testSpellingErrorUsesEmbeddedLexiconMeaning();
        results.push({ name: '错词优先使用核心词库释义', status: 'pass' });
        await testSpellingErrorFallsBackWhenLexiconMissing();
        results.push({ name: '词库缺失时错词回退提示', status: 'pass' });
        console.log(JSON.stringify({
            status: 'pass',
            detail: `${results.length}/${results.length} 测试通过`,
            passed: results.length,
            total: results.length,
            results
        }, null, 2));
    } catch (error) {
        results.push({ name: '测试执行', status: 'fail', error: error.message });
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message,
            results
        }, null, 2));
        process.exit(1);
    }
}

main();
