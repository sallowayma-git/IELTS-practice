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

function loadVocabStore({ embeddedWords, storageSeed, onJsonParse } = {}) {
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
    const guardedJson = {
        parse(value) {
            if (typeof onJsonParse === 'function') {
                onJsonParse(value);
            }
            return JSON.parse(value);
        },
        stringify: JSON.stringify
    };
    const sandbox = {
        window: windowStub,
        console: quietConsole,
        localStorage: createLocalStorage(storageSeed),
        Date,
        Math,
        JSON: guardedJson,
        setTimeout,
        clearTimeout
    };
    sandbox.globalThis = sandbox.window;
    sandbox.window.localStorage = sandbox.localStorage;
    sandbox.window.Date = Date;
    sandbox.window.Math = Math;
    sandbox.window.JSON = guardedJson;
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
    assert.strictEqual(list.words[0].meaning, '暂无中文释义', '词库缺失时不应该把错拼提示伪装成释义');
    assert.ok(list.words[0].note.includes('你曾拼写为: specializedd'), '错拼信息应该进入note');
    assert.ok(list.words[0].note.includes('来源: listening-p4-demo'), '来源信息应该进入note');
    assert.strictEqual(list.words[0].source, 'P4 听力练习');
}

async function testSpellingErrorPreservesStoredMeaningAndMetadata() {
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        storageSeed: {
            vocab_list_master_errors: JSON.stringify([{
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
            }])
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
        storageSeed: {
            vocab_list_master_errors: JSON.stringify([{
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
            }])
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
}

async function testVocabStoreCapsImportedWordPayloads() {
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        storageSeed: {}
    });

    await vocabStore.init();
    const longWord = 'w'.repeat(300);
    const longMeaning = 'm'.repeat(5000);
    const longNote = 'n'.repeat(5000);
    const oversizedMetadata = { body: 'x'.repeat(9000) };
    const manyWords = Array.from({ length: 5002 }, (_, index) => ({
        id: `word-${index}`,
        word: index === 0 ? longWord : `word-${index}`,
        meaning: index === 0 ? longMeaning : `meaning-${index}`,
        note: index === 0 ? longNote : '',
        source: index === 0 ? 's'.repeat(300) : 'test',
        acceptedAnswers: index === 0 ? ['a'.repeat(1200)] : [],
        metadata: index === 0 ? oversizedMetadata : { index }
    }));

    await vocabStore.setWords(manyWords);
    const words = vocabStore.getWords();
    assert.strictEqual(words.length, 5000, 'stored vocab lists must be capped');
    assert.strictEqual(words[0].word.length, 160, 'word text must be truncated');
    assert.strictEqual(words[0].meaning.length, 4000, 'meaning text must be truncated');
    assert.strictEqual(words[0].note.length, 4000, 'note text must be truncated');
    assert.strictEqual(words[0].source.length, 200, 'source text must be truncated');
    assert.strictEqual(words[0].acceptedAnswers[0].length, 1000, 'extra string arrays must be truncated');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(words[0], 'metadata'), false, 'oversized metadata must be dropped');

    await vocabStore.setReviewQueue(Array.from({ length: 5002 }, (_, index) => index === 0 ? 'q'.repeat(300) : `q-${index}`));
    const queue = vocabStore.getReviewQueue();
    assert.strictEqual(queue.length, 5000, 'review queue must be capped');
    assert.strictEqual(queue[0].length, 200, 'review queue ids must be truncated');
}

async function testVocabStoreRejectsOversizedLocalStorageBeforeParsing() {
    let oversizedParsed = false;
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        storageSeed: {
            vocab_list_custom: '{"words":[],"padding":"' + 'x'.repeat((5 * 1024 * 1024) + 1) + '"}'
        },
        onJsonParse(value) {
            if (String(value || '').length > 5 * 1024 * 1024) {
                oversizedParsed = true;
            }
        }
    });

    await vocabStore.init();
    const customList = await vocabStore.loadList('custom');
    assert.strictEqual(customList.words.length, 0, 'oversized local vocab list should fall back to an empty list');
    assert.strictEqual(oversizedParsed, false, 'oversized vocab localStorage payload must be rejected before JSON.parse');
}

async function testVocabStoreDropsUnsafeExtraMetadataKeys() {
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        storageSeed: {}
    });
    const payload = JSON.parse(`{
        "word": "garden",
        "meaning": "place with plants",
        "isAdmin": true,
        "metadata": {
            "ok": "yes",
            "__proto__": { "pollutedMetadata": true },
            "constructor": { "prototype": { "pollutedMetadata": true } }
        },
        "acceptedAnswers": [
            "garden",
            {
                "text": "safe",
                "__proto__": { "pollutedAnswer": true }
            }
        ]
    }`);

    await vocabStore.init();
    await vocabStore.setWords([payload]);
    const [word] = vocabStore.getWords();

    assert.strictEqual(word.isAdmin, undefined, 'unknown top-level fields must not be stored');
    assert.strictEqual(word.metadata.ok, 'yes');
    assert.strictEqual(word.metadata.pollutedMetadata, undefined);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(word.metadata, '__proto__'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(word.metadata, 'constructor'), false);
    assert.strictEqual(word.acceptedAnswers[1].text, 'safe');
    assert.strictEqual(word.acceptedAnswers[1].pollutedAnswer, undefined);
    assert.strictEqual(Object.prototype.pollutedMetadata, undefined);
    assert.strictEqual(Object.prototype.pollutedAnswer, undefined);
}

async function testVocabStoreKeepsSharedExtraMetadataButDropsCycles() {
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        storageSeed: {}
    });
    const shared = { text: 'shared context' };
    const metadata = {
        first: shared,
        second: shared
    };
    metadata.self = metadata;

    await vocabStore.init();
    await vocabStore.setWords([{
        word: 'context',
        meaning: 'shared data',
        metadata
    }]);
    const [word] = vocabStore.getWords();

    assert.strictEqual(word.metadata.first.text, 'shared context');
    assert.strictEqual(word.metadata.second.text, 'shared context');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(word.metadata, 'self'), false);
}

async function testVocabStoreReturnsDefensiveClones() {
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        storageSeed: {}
    });

    await vocabStore.init();
    await vocabStore.setWords([{
        id: 'clone-guard',
        word: 'garden',
        meaning: 'place with plants',
        nextReview: '2020-01-01T00:00:00.000Z',
        metadata: { ok: 'yes' },
        acceptedAnswers: [{ text: 'garden' }]
    }]);

    const [word] = vocabStore.getWords();
    word.metadata.ok = 'changed';
    word.acceptedAnswers[0].text = 'changed';

    const [stored] = vocabStore.getWords();
    assert.strictEqual(stored.metadata.ok, 'yes', 'getWords must not expose nested store references');
    assert.strictEqual(stored.acceptedAnswers[0].text, 'garden', 'getWords must clone nested arrays');

    const [dueWord] = vocabStore.getDueWords(new Date('2020-01-02T00:00:00.000Z'));
    dueWord.metadata.ok = 'due-changed';
    assert.strictEqual(vocabStore.getWords()[0].metadata.ok, 'yes', 'getDueWords must not expose nested store references');

    const [newWord] = vocabStore.getNewWords(1);
    newWord.acceptedAnswers[0].text = 'new-changed';
    assert.strictEqual(vocabStore.getWords()[0].acceptedAnswers[0].text, 'garden', 'getNewWords must not expose nested store references');

    const updated = await vocabStore.updateWord('clone-guard', { note: 'remember' });
    updated.metadata.ok = 'updated-changed';
    assert.strictEqual(vocabStore.getWords()[0].metadata.ok, 'yes', 'updateWord return value must be detached from store state');
}

async function testVocabStoreReturnsDefensiveListAndConfigClones() {
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        storageSeed: {
            vocab_list_custom: JSON.stringify([{
                id: 'custom-1',
                word: 'custom',
                meaning: 'owned by user',
                metadata: { ok: 'yes' }
            }])
        }
    });

    await vocabStore.init();
    const first = await vocabStore.loadList('custom');
    first.words[0].metadata.ok = 'changed';
    first.words.push({ word: 'evil', meaning: 'mutated' });

    const second = await vocabStore.loadList('custom');
    assert.strictEqual(second.words.length, 1, 'loadList cache must not expose mutable list arrays');
    assert.strictEqual(second.words[0].metadata.ok, 'yes', 'loadList cache must clone nested word metadata');

    const lists = vocabStore.VOCAB_LISTS;
    lists.custom.storageKey = 'attacker-key';
    assert.notStrictEqual(vocabStore.VOCAB_LISTS.custom.storageKey, 'attacker-key', 'VOCAB_LISTS getter must return detached config objects');
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
        await testVocabStoreCapsImportedWordPayloads();
        results.push({ name: '词库存储限制异常导入负载', status: 'pass' });
        await testVocabStoreRejectsOversizedLocalStorageBeforeParsing();
        results.push({ name: 'vocab store rejects oversized localStorage before parsing', status: 'pass' });
        await testVocabStoreDropsUnsafeExtraMetadataKeys();
        results.push({ name: 'vocab metadata strips prototype pollution keys', status: 'pass' });
        await testVocabStoreKeepsSharedExtraMetadataButDropsCycles();
        results.push({ name: 'vocab metadata preserves shared references without cycles', status: 'pass' });
        await testVocabStoreReturnsDefensiveClones();
        results.push({ name: 'vocab getters return defensive word clones', status: 'pass' });
        await testVocabStoreReturnsDefensiveListAndConfigClones();
        results.push({ name: 'vocab list cache and config getters return defensive clones', status: 'pass' });
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
