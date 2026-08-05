#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const originalConsoleLog = console.log.bind(console);
function emitResult(payload) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

global.window = global;
global.document = {
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {}
};
global.console = { log() {}, warn() {}, error() {}, info() {} };

const state = {
    words: [{ id: 'core-seed', word: 'atlas', meaning: 'n. 地图集' }],
    collections: {},
    config: { activeListId: 'default' },
    rejectActivation: false
};

global.AppData = {
    ready: Promise.resolve(),
    vocab: {
        async getConfig() {
            return clone(state.config);
        },
        async listWords() {
            return clone(state.words);
        },
        async listCollections() {
            return clone(state.collections);
        },
        async replaceListWords({ listId = 'default', words = [] }) {
            if (listId === 'default') {
                state.words = clone(words);
            } else {
                state.collections[listId] = {
                    ...(state.collections[listId] || {}),
                    id: listId,
                    words: clone(words)
                };
            }
            return { committed: true };
        },
        async saveCollection(id, value) {
            state.collections[id] = clone(value);
            return { committed: true };
        },
        async saveCollections(values) {
            Object.entries(values).forEach(([id, value]) => {
                state.collections[id] = clone(value);
            });
            return { committed: true };
        },
        async patchConfig(patch = {}) {
            state.config = { ...state.config, ...clone(patch) };
            return { committed: true };
        },
        async activateList(listId) {
            if (state.rejectActivation) throw new Error('injected activation failure');
            state.config = { ...state.config, activeListId: listId };
            return { committed: true };
        },
        async patchWord({ listId = 'default', wordId, patch = {} }) {
            const words = listId === 'default' ? state.words : (state.collections[listId]?.words || []);
            const index = words.findIndex((word) => (word.id || word.word) === wordId);
            if (index < 0) throw new Error(`Unknown word: ${wordId}`);
            words[index] = { ...words[index], ...clone(patch) };
            return { committed: true, word: clone(words[index]) };
        },
        async replaceProgress({ listId = 'default', words = [], config = {} }) {
            await this.replaceListWords({ listId, words });
            state.config = { ...state.config, ...clone(config), activeListId: listId };
            return { committed: true };
        }
    }
};

global.__EMBEDDED_WORDLISTS__ = { ielts_core: clone(state.words) };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
eval(fs.readFileSync(path.join(repoRoot, 'js/app/spellingErrorCollector.js'), 'utf8'));
eval(fs.readFileSync(path.join(repoRoot, 'js/core/vocabStore.js'), 'utf8'));

const testData = {
    p1: [
        { word: 'accommodation', userInput: 'accomodation', questionId: 'q1', examId: 'listening-p1', timestamp: 1, errorCount: 1, source: 'p1' },
        { word: 'receive', userInput: 'recieve', questionId: 'q2', examId: 'listening-p1', timestamp: 2, errorCount: 1, source: 'p1' }
    ],
    p4: [
        { word: 'environment', userInput: 'enviroment', questionId: 'q1', examId: 'listening-p4', timestamp: 3, errorCount: 1, source: 'p4' },
        { word: 'government', userInput: 'goverment', questionId: 'q2', examId: 'listening-p4', timestamp: 4, errorCount: 1, source: 'p4' },
        { word: 'development', userInput: 'developement', questionId: 'q3', examId: 'listening-p4', timestamp: 5, errorCount: 1, source: 'p4' }
    ]
};

async function runTests() {
    const results = [];
    const record = async (name, test) => {
        await test();
        results.push({ name, status: 'pass' });
    };

    try {
        const collector = new window.SpellingErrorCollector();
        await collector.ensureInitialized();
        await window.VocabStore.init();
        assert.strictEqual(await collector.saveErrors(testData.p1), true);
        assert.strictEqual(await collector.saveErrors(testData.p4), true);

        await record('canonical collections are created', async () => {
            assert.ok(state.collections['spelling-errors-p1']);
            assert.ok(state.collections['spelling-errors-p4']);
            assert.ok(state.collections['spelling-errors-master']);
            assert.strictEqual(state.collections['spelling-errors-p1'].words.length, 2);
            assert.strictEqual(state.collections['spelling-errors-p4'].words.length, 3);
            assert.strictEqual(state.collections['spelling-errors-master'].words.length, 5);
        });

        await record('loads canonical list projections', async () => {
            const p1 = await window.VocabStore.loadList('spelling-errors-p1');
            const p4 = await window.VocabStore.loadList('spelling-errors-p4');
            assert.strictEqual(p1.words.length, 2);
            assert.strictEqual(p4.words.length, 3);
            assert.strictEqual(p1.id, 'spelling-errors-p1');
        });

        await record('switch persists active list through AppData', async () => {
            assert.strictEqual(await window.VocabStore.setActiveList('spelling-errors-p1'), true);
            assert.strictEqual(window.VocabStore.getActiveListId(), 'spelling-errors-p1');
            assert.strictEqual(state.config.activeListId, 'spelling-errors-p1');
            assert.strictEqual(window.VocabStore.getWords().length, 2);
        });

        await record('list counts come from the domain data', async () => {
            assert.strictEqual(await window.VocabStore.getListWordCount('spelling-errors-p1'), 2);
            assert.strictEqual(await window.VocabStore.getListWordCount('spelling-errors-p4'), 3);
            assert.strictEqual(await window.VocabStore.getListWordCount('spelling-errors-master'), 5);
            assert.strictEqual(await window.VocabStore.getListWordCount('custom'), 0);
        });

        await record('empty custom list is a valid switch target', async () => {
            const custom = await window.VocabStore.loadList('custom');
            assert.deepStrictEqual(custom.words, []);
            assert.strictEqual(await window.VocabStore.setActiveList(custom), true);
            assert.strictEqual(window.VocabStore.getActiveListId(), 'custom');
            assert.deepStrictEqual(window.VocabStore.getWords(), []);
        });

        await record('unknown list cannot replace the active list', async () => {
            const before = state.config.activeListId;
            assert.strictEqual(await window.VocabStore.setActiveList('nonexistent'), false);
            assert.strictEqual(state.config.activeListId, before);
        });

        await record('activation failure does not update in-memory state', async () => {
            const before = window.VocabStore.getActiveListId();
            state.rejectActivation = true;
            assert.strictEqual(await window.VocabStore.setActiveList('spelling-errors-p4'), false);
            state.rejectActivation = false;
            assert.strictEqual(window.VocabStore.getActiveListId(), before);
            assert.strictEqual(state.config.activeListId, before);
        });

        await record('repeated switches remain stable', async () => {
            for (let index = 0; index < 3; index += 1) {
                assert.strictEqual(await window.VocabStore.setActiveList('spelling-errors-p1'), true);
                assert.strictEqual(await window.VocabStore.setActiveList('spelling-errors-p4'), true);
                assert.strictEqual(await window.VocabStore.setActiveList('spelling-errors-master'), true);
            }
            assert.strictEqual(window.VocabStore.getActiveListId(), 'spelling-errors-master');
            assert.strictEqual(window.VocabStore.getWords().length, 5);
        });
    } catch (error) {
        results.push({ name: 'test execution', status: 'fail', error: error.message, stack: error.stack });
    } finally {
        global.console = { ...global.console, log: originalConsoleLog };
    }

    const allPassed = results.every((result) => result.status === 'pass');
    emitResult({
        status: allPassed ? 'pass' : 'fail',
        total: results.length,
        passed: results.filter((result) => result.status === 'pass').length,
        failed: results.filter((result) => result.status === 'fail').length,
        results
    });
    return allPassed ? 0 : 1;
}

runTests().then((code) => process.exit(code));
