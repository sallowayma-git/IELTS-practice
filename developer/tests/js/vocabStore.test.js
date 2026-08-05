#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createVocabFacade(seed = {}) {
    const state = {
        words: clone(seed.words || []),
        collections: clone(seed.collections || {}),
        config: { activeListId: 'default', ...(clone(seed.config) || {}) }
    };
    const vocab = {
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
            if (seed.failReplace) throw new Error('backend write failed');
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
        async mergeListWords({ listId = 'default', words = [] }) {
            const target = listId === 'default'
                ? state.words
                : (state.collections[listId]?.words || []);
            const merged = clone(target);
            let addedCount = 0;
            let updatedCount = 0;
            for (const incoming of words) {
                const identity = String(incoming.word || incoming.id || '').trim().toLowerCase();
                const index = merged.findIndex((word) => String(word.word || word.id || '').trim().toLowerCase() === identity);
                if (index >= 0) {
                    merged[index] = { ...merged[index], ...clone(incoming) };
                    updatedCount += 1;
                } else {
                    merged.push(clone(incoming));
                    addedCount += 1;
                }
            }
            await this.replaceListWords({ listId, words: merged });
            return { committed: true, words: clone(merged), addedCount, updatedCount };
        },
        async patchConfig(patch = {}) {
            state.config = { ...state.config, ...clone(patch) };
            return { committed: true };
        },
        async activateList(listId) {
            state.config = { ...state.config, activeListId: listId };
            return { committed: true };
        },
        async patchWord({ listId = 'default', wordId, patch = {} }) {
            const source = listId === 'default'
                ? state.words
                : (state.collections[listId]?.words || []);
            const index = source.findIndex((word) => (word.id || word.word) === wordId);
            if (index < 0) throw new Error(`Unknown word: ${wordId}`);
            source[index] = { ...source[index], ...clone(patch) };
            return { committed: true, word: clone(source[index]) };
        }
    };
    return { state, vocab };
}

function loadVocabStore({ embeddedWords, dataSeed }) {
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {}
    };
    const { state: appDataState, vocab } = createVocabFacade(dataSeed);
    const windowStub = {
        console: quietConsole,
        __EMBEDDED_WORDLISTS__: {
            ielts_core: embeddedWords || []
        },
        location: { protocol: 'file:' },
        AppData: { ready: Promise.resolve(), vocab }
    };
    const sandbox = {
        window: windowStub,
        console: quietConsole,
        Date,
        Math,
        JSON,
        setTimeout,
        clearTimeout
    };
    sandbox.globalThis = sandbox.window;
    sandbox.window.Date = Date;
    sandbox.window.Math = Math;
    sandbox.window.JSON = JSON;
    sandbox.window.setTimeout = setTimeout;
    sandbox.window.clearTimeout = clearTimeout;

    const context = vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/core/vocabStore.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'js/core/vocabStore.js' });
    sandbox.window.VocabStore.__appDataState = appDataState;
    return sandbox.window.VocabStore;
}

async function testSpellingErrorUsesEmbeddedLexiconMeaning() {
    const vocabStore = loadVocabStore({
        embeddedWords: [{
            word: 'accommodation',
            meaning: 'n. 住宿',
            example: 'The hotel provides comfortable accommodation.'
        }],
        dataSeed: {
            words: [{ id: 'default-seed', word: 'unrelated', meaning: 'seed' }],
            collections: {
                'spelling-errors-p1': {
                id: 'spelling-errors-p1',
                words: [{
                    word: 'accommodation',
                    userInput: 'accomodation',
                    questionId: 'q1',
                    examId: 'listening-p1-demo',
                    timestamp: 1710000000000,
                    errorCount: 2,
                    source: 'p1'
                }]
                }
            }
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
        dataSeed: {
            words: [{ id: 'default-seed', word: 'unrelated', meaning: 'seed' }],
            collections: {
                'spelling-errors-p4': {
                id: 'spelling-errors-p4',
                words: [{
                    word: 'specialised',
                    userInput: 'specializedd',
                    questionId: 'q8',
                    examId: 'listening-p4-demo',
                    timestamp: 1710000000000,
                    errorCount: 1,
                    source: 'p4'
                }]
                }
            }
        }
    });

    await vocabStore.init();
    const list = await vocabStore.loadList('spelling-errors-p4');
    assert.strictEqual(list.words.length, 1, '应该加载1个错词');
    assert.strictEqual(list.words[0].meaning, '暂无中文释义', '词库缺失时不应该把错拼提示伪装成释义');
    assert.ok(list.words[0].note.includes('你曾拼写为: specializedd'), '错拼信息应该进入note');
    assert.ok(list.words[0].note.includes('来源: listening-p4-demo'), '来源信息应该进入note');
    assert.strictEqual(list.words[0].source, 'P4 听力练习');
}

async function testSpellingErrorPreservesStoredMeaningAndMetadata() {
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        dataSeed: {
            words: [{ id: 'default-seed', word: 'unrelated', meaning: 'seed' }],
            collections: {
                'spelling-errors-master': {
                id: 'spelling-errors-master',
                words: [{
                id: 'spelling-all-garden',
                word: 'garden',
                meaning: 'n. 花园；庭院',
                example: 'The garden is quiet.',
                userInput: 'gardon',
                questionId: 'q20',
                examId: 'listening-p1-demo',
                timestamp: 1710000000000,
                errorCount: 3,
                source: 'p1',
                acceptedAnswers: ['green garden', 'green gardens'],
                canonicalAnswer: 'green garden',
                reasonCode: 'edit'
                }]
                }
            }
        }
    });

    await vocabStore.init();
    const list = await vocabStore.loadList('spelling-errors-master');
    assert.strictEqual(list.words.length, 1, '应该加载数组形态的错词词表');
    const word = list.words[0];
    assert.strictEqual(word.word, 'garden');
    assert.strictEqual(word.meaning, 'n. 花园；庭院', '已补全的中文释义不应被覆盖');
    assert.strictEqual(word.example, 'The garden is quiet.');
    assert.strictEqual(word.userInput, 'gardon', '错拼元数据应该保留');
    assert.strictEqual(word.errorCount, 3, '错误次数应该保留');
    assert.deepStrictEqual(word.acceptedAnswers, ['green garden', 'green gardens']);
    assert.strictEqual(word.canonicalAnswer, 'green garden');
    assert.strictEqual(word.reasonCode, 'edit');
    assert.ok(word.note.includes('你曾拼写为: gardon'), '错拼信息应该进入note');
    assert.strictEqual(word.source, 'P1 听力练习');
}

async function testSpellingErrorMetadataSurvivesStudyUpdates() {
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        dataSeed: {
            words: [{ id: 'default-seed', word: 'unrelated', meaning: 'seed' }],
            collections: {
                'spelling-errors-master': {
                id: 'spelling-errors-master',
                words: [{
                id: 'spelling-all-garden',
                word: 'garden',
                meaning: 'n. 花园；庭院',
                userInput: 'gardon',
                questionId: 'q20',
                examId: 'listening-p1-demo',
                timestamp: 1710000000000,
                errorCount: 3,
                source: 'p1',
                acceptedAnswers: ['green garden'],
                canonicalAnswer: 'green garden'
                }]
                }
            }
        }
    });

    await vocabStore.init();
    const list = await vocabStore.loadList('spelling-errors-master');
    const switched = await vocabStore.setActiveList(list);
    assert.strictEqual(switched, true, '应该能切换到综合错词词表');

    const [initial] = vocabStore.getWords();
    await vocabStore.updateWord(initial.id, { note: 'new memory note', correctCount: 1 });
    const [updated] = vocabStore.getWords();
    assert.strictEqual(updated.note, 'new memory note');
    assert.strictEqual(updated.correctCount, 1);
    assert.strictEqual(updated.userInput, 'gardon', '背诵更新不应该洗掉错拼元数据');
    assert.strictEqual(updated.errorCount, 3, '背诵更新不应该洗掉错误次数');
    assert.deepStrictEqual(updated.acceptedAnswers, ['green garden']);
    assert.strictEqual(updated.canonicalAnswer, 'green garden');
    assert.strictEqual(vocabStore.__appDataState.config.activeListId, 'spelling-errors-master');
    assert.strictEqual(
        vocabStore.__appDataState.collections['spelling-errors-master'].words[0].note,
        'new memory note',
        '学习更新必须通过 AppData.vocab.patchWord 提交'
    );
}

async function testDefaultLexiconWriteFailureRejectsInitialization() {
    const vocabStore = loadVocabStore({
        embeddedWords: [{ word: 'alpha', meaning: 'A' }],
        dataSeed: { failReplace: true }
    });

    await assert.rejects(vocabStore.init(), /backend write failed/);
    assert.strictEqual(vocabStore.state.ready, false, '持久化失败时不得把词汇域标记为 ready');
}

async function main() {
    const results = [];
    try {
        await testSpellingErrorUsesEmbeddedLexiconMeaning();
        results.push({ name: '错词优先使用核心词库释义', status: 'pass' });
        await testSpellingErrorFallsBackWhenLexiconMissing();
        results.push({ name: '词库缺失时错词使用明确占位释义', status: 'pass' });
        await testSpellingErrorPreservesStoredMeaningAndMetadata();
        results.push({ name: '错词保留已补全释义和元数据', status: 'pass' });
        await testSpellingErrorMetadataSurvivesStudyUpdates();
        results.push({ name: '背诵更新保留错词业务元数据', status: 'pass' });
        await testDefaultLexiconWriteFailureRejectsInitialization();
        results.push({ name: '默认词库持久化失败会阻断 ready', status: 'pass' });
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
