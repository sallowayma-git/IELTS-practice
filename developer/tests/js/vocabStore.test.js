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

function normalizePhoneticValue(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/^\/+|\/+$/g, '').trim();
}

function createVocabFacade(seed = {}) {
    const committedListeners = new Set();
    const metrics = {
        replaceListWordsCalls: [],
        backfillListWordPhoneticsCalls: [],
        backfillListWordPhoneticsWrites: 0,
        replaceProgressCalls: []
    };
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
            metrics.replaceListWordsCalls.push({ listId, words: clone(words) });
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
        async backfillListWordPhonetics({ listId = 'default', entries = [] } = {}) {
            metrics.backfillListWordPhoneticsCalls.push({ listId, entries: clone(entries) });
            if (seed.failBackfill) throw new Error('backend phonetic backfill failed');
            const phonetics = new Map();
            for (const entry of entries) {
                const identity = String(entry && entry.word || '').trim().toLowerCase();
                const phonetic = normalizePhoneticValue(entry && entry.phonetic);
                if (identity && phonetic && !phonetics.has(identity)) {
                    phonetics.set(identity, phonetic);
                }
            }

            const storedList = listId === 'default'
                ? state.words
                : (Array.isArray(state.collections[listId])
                    ? state.collections[listId]
                    : (state.collections[listId]?.words || []));
            let updatedCount = 0;
            const words = storedList.map((word) => {
                const existing = word && typeof word === 'object' && !Array.isArray(word) ? clone(word) : {};
                if (normalizePhoneticValue(existing.phonetic)) return existing;
                const identity = String(existing.word || existing.id || '').trim().toLowerCase();
                const phonetic = phonetics.get(identity);
                if (!phonetic) return existing;
                updatedCount += 1;
                return { ...existing, phonetic };
            });

            if (!updatedCount) {
                return { committed: false, listId, words: clone(words), updatedCount: 0 };
            }
            if (listId === 'default') {
                state.words = clone(words);
            } else {
                const collection = state.collections[listId];
                const base = collection && typeof collection === 'object' && !Array.isArray(collection)
                    ? clone(collection)
                    : {};
                state.collections[listId] = { ...base, id: listId, words: clone(words) };
            }
            metrics.backfillListWordPhoneticsWrites += 1;
            return { committed: true, listId, words: clone(words), updatedCount };
        },
        async replaceProgress({ listId = 'default', words = [], config = {} } = {}) {
            const storedList = listId === 'default'
                ? state.words
                : (Array.isArray(state.collections[listId])
                    ? state.collections[listId]
                    : (state.collections[listId]?.words || []));
            const existingById = new Map();
            const existingByWord = new Map();
            for (const rawWord of storedList) {
                const existing = rawWord && typeof rawWord === 'object' && !Array.isArray(rawWord) ? rawWord : {};
                const phonetic = normalizePhoneticValue(existing.phonetic);
                if (!phonetic) continue;
                const id = typeof existing.id === 'string' ? existing.id.trim() : '';
                const identity = String(existing.word || '').trim().toLowerCase();
                if (id && !existingById.has(id)) existingById.set(id, phonetic);
                if (identity && !existingByWord.has(identity)) existingByWord.set(identity, phonetic);
            }
            const committedWords = words.map((rawWord) => {
                if (!rawWord || typeof rawWord !== 'object' || Array.isArray(rawWord)) return clone(rawWord);
                const word = clone(rawWord);
                const incomingPhonetic = normalizePhoneticValue(word.phonetic);
                if (incomingPhonetic) {
                    word.phonetic = incomingPhonetic;
                    return word;
                }
                delete word.phonetic;
                const id = typeof word.id === 'string' ? word.id.trim() : '';
                const identity = String(word.word || '').trim().toLowerCase();
                const preserved = (id && existingById.get(id)) || (identity && existingByWord.get(identity)) || '';
                if (preserved) word.phonetic = preserved;
                return word;
            });

            metrics.replaceProgressCalls.push({
                listId,
                words: clone(words),
                config: clone(config),
                committedWords: clone(committedWords)
            });
            state.config = { ...state.config, ...clone(config), activeListId: listId };
            if (listId === 'default') {
                state.words = clone(committedWords);
            } else {
                const collection = state.collections[listId];
                const base = collection && typeof collection === 'object' && !Array.isArray(collection)
                    ? clone(collection)
                    : {};
                state.collections[listId] = { ...base, id: listId, words: clone(committedWords) };
            }
            return { committed: true, listId, words: clone(committedWords) };
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
    const backups = {
        onDataCommitted(listener) {
            committedListeners.add(listener);
            return () => committedListeners.delete(listener);
        }
    };
    function emitCommitted(logicalKeys) {
        const keys = Array.isArray(logicalKeys) ? logicalKeys : [logicalKeys];
        const event = {
            operationId: 'external-test-commit',
            remote: true,
            targets: keys.map((logicalKey) => ({ logicalKey }))
        };
        for (const listener of committedListeners) {
            listener(clone(event));
        }
    }
    return { state, vocab, backups, emitCommitted, metrics };
}

function loadVocabStore({ embeddedWords, dataSeed }) {
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {}
    };
    const { state: appDataState, vocab, backups, emitCommitted, metrics } = createVocabFacade(dataSeed);
    const windowStub = {
        console: quietConsole,
        __EMBEDDED_WORDLISTS__: {
            ielts_core: embeddedWords || []
        },
        location: { protocol: 'file:' },
        AppData: { ready: Promise.resolve(), vocab, backups }
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
    sandbox.window.VocabStore.__appDataMetrics = metrics;
    sandbox.window.VocabStore.__emitDataCommitted = emitCommitted;
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

async function testImportedVocabInSpellingListSurvivesReload() {
    const vocabStore = loadVocabStore({
        embeddedWords: [{
            word: 'alpha',
            meaning: 'Bundled meaning',
            example: 'Bundled example.',
            phonetic: 'bundled-alpha'
        }],
        dataSeed: {
            words: [{ id: 'default-alpha', word: 'alpha', meaning: 'Bundled meaning' }],
            collections: {
                'spelling-errors-p1': { id: 'spelling-errors-p1', words: [] }
            }
        }
    });

    await vocabStore.init();
    await vocabStore.setActiveList('spelling-errors-p1');
    await vocabStore.mergeWords([{
        id: 'imported-alpha',
        word: 'alpha',
        meaning: 'Imported meaning',
        example: 'Imported example.',
        note: 'Imported note',
        phonetic: ' /imported-alpha/ '
    }]);

    let [word] = vocabStore.getWords();
    assert.strictEqual(word.meaning, 'Imported meaning');
    assert.strictEqual(word.example, 'Imported example.');
    assert.strictEqual(word.note, 'Imported note');
    assert.strictEqual(word.phonetic, 'imported-alpha');

    await vocabStore.setActiveList('default');
    await vocabStore.setActiveList('spelling-errors-p1');
    [word] = vocabStore.getWords();
    assert.strictEqual(word.meaning, 'Imported meaning', 'reloading must not reinterpret an ordinary imported word as a spelling error');
    assert.strictEqual(word.example, 'Imported example.');
    assert.strictEqual(word.note, 'Imported note');
    assert.strictEqual(word.phonetic, 'imported-alpha');
    assert.ok(!word.note.includes('你曾拼写为'));
}

async function testDefaultLexiconWriteFailureRejectsInitialization() {
    const vocabStore = loadVocabStore({
        embeddedWords: [{ word: 'alpha', meaning: 'A' }],
        dataSeed: { failReplace: true }
    });

    await assert.rejects(vocabStore.init(), /backend write failed/);
    assert.strictEqual(vocabStore.state.ready, false, '持久化失败时不得把词汇域标记为 ready');
}

async function testPhoneticIsOptionalAndPresentationRemovesSlashes() {
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        dataSeed: {
            words: [
                {
                    id: 'word-alpha',
                    word: 'alpha',
                    meaning: 'A',
                    phonetic: '  /ˈæl.fə/  '
                },
                {
                    id: 'word-beta',
                    word: 'beta',
                    meaning: 'B',
                    phonetic: ' / '
                },
                {
                    id: 'word-gamma',
                    word: 'gamma',
                    meaning: 'G'
                },
                {
                    id: 'word-delta',
                    word: 'delta',
                    meaning: 'D',
                    phonetic: ' /del.tə '
                },
                {
                    id: 'word-epsilon',
                    word: 'epsilon',
                    meaning: 'E',
                    phonetic: 'ep.sɪ.lɒn/ '
                }
            ]
        }
    });

    await vocabStore.init();
    const [alpha, beta, gamma, delta, epsilon] = vocabStore.getWords();
    assert.strictEqual(alpha.phonetic, 'ˈæl.fə', '展示层应移除音标外围斜杠和空白');
    assert.strictEqual(delta.phonetic, 'del.tə', '单独的前导展示斜杠也应移除');
    assert.strictEqual(epsilon.phonetic, 'ep.sɪ.lɒn', '单独的尾随展示斜杠也应移除');
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(beta, 'phonetic'),
        false,
        '仅含斜杠的音标应视为空值，且不制造空字段'
    );
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(gamma, 'phonetic'),
        false,
        '音标缺失时仍应保留合法单词记录，且不制造空字段'
    );
    assert.strictEqual(
        vocabStore.__appDataState.words[0].phonetic,
        '  /ˈæl.fə/  ',
        '纯展示规范化不应擅自改写已有持久化记录'
    );
}

async function testDefaultPhoneticBackfillPreservesRawRecordsAndIsIdempotent() {
    const originalWords = [
        {
            id: 'persisted-alpha-primary',
            word: 'Alpha',
            meaning: 'A',
            example: 'Alpha example.',
            note: '用户记忆笔记',
            easeFactor: 2.45,
            interval: 12,
            repetitions: 4,
            intraCycles: 2,
            correctCount: 9,
            lastReviewed: '2026-08-01T00:00:00.000Z',
            nextReview: '2026-08-13T00:00:00.000Z',
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
            futureSchema: {
                algorithm: 'sm-next',
                weights: [0.25, 0.75]
            },
            futureFlag: true
        },
        {
            id: 'persisted-alpha-duplicate',
            word: ' alpha ',
            meaning: 'Second A',
            note: 'duplicate note',
            correctCount: 2,
            futureToken: 'keep-me'
        },
        {
            id: 'persisted-beta-explicit',
            word: 'beta',
            meaning: 'B',
            phonetic: '  /user-supplied/  ',
            note: 'explicit pronunciation'
        }
    ];
    const vocabStore = loadVocabStore({
        embeddedWords: [
            { word: 'alpha', meaning: 'A', phonetic: '/ˈæl.fə/' },
            { word: 'beta', meaning: 'B', phonetic: '/ˈbiː.tə/' }
        ],
        dataSeed: { words: originalWords }
    });

    await vocabStore.init();
    const persisted = vocabStore.__appDataState.words;
    assert.deepStrictEqual(
        persisted[0],
        { ...originalWords[0], phonetic: 'ˈæl.fə' },
        '回填只能为原始记录追加音标，ID、笔记、SM-2、时间戳和未来字段都必须原样保留'
    );
    assert.deepStrictEqual(
        persisted[1],
        { ...originalWords[1], phonetic: 'ˈæl.fə' },
        '同一词头的重复记录都必须完成回填'
    );
    assert.deepStrictEqual(
        persisted[2],
        originalWords[2],
        '显式音标必须保留，不能被内置词库覆盖或重写格式'
    );

    const presented = vocabStore.getWords();
    assert.strictEqual(presented[0].phonetic, 'ˈæl.fə');
    assert.strictEqual(presented[1].phonetic, 'ˈæl.fə');
    assert.strictEqual(presented[2].phonetic, 'user-supplied', '展示层仍应规范化显式音标的外围斜杠');
    assert.strictEqual(vocabStore.__appDataMetrics.backfillListWordPhoneticsCalls.length, 1);
    assert.strictEqual(vocabStore.__appDataMetrics.backfillListWordPhoneticsWrites, 1);
    assert.strictEqual(
        vocabStore.__appDataMetrics.replaceListWordsCalls.length,
        0,
        '回填不得通过整表规范化覆盖原始记录'
    );

    const afterFirstInit = clone(persisted);
    await vocabStore.init();
    assert.deepStrictEqual(vocabStore.__appDataState.words, afterFirstInit, '第二次初始化必须保持持久化内容不变');
    assert.strictEqual(
        vocabStore.__appDataMetrics.backfillListWordPhoneticsCalls.length,
        1,
        '第二次初始化不应重复发起回填'
    );
    assert.strictEqual(
        vocabStore.__appDataMetrics.backfillListWordPhoneticsWrites,
        1,
        '第二次初始化不应产生额外写入'
    );
}

async function testDefaultPhoneticBackfillDoesNotRewriteOrSwitchCustomActiveList() {
    const originalConfig = {
        activeListId: 'custom',
        dailyNew: 17,
        futureConfig: { mode: 'keep' }
    };
    const originalCustomCollection = {
        id: 'custom',
        name: 'My custom vocabulary',
        futureCollectionField: ['preserve', 'this'],
        words: [{
            id: 'custom-word',
            word: 'bespoke',
            meaning: '定制的',
            note: 'custom note',
            futureWordField: { source: 'user' }
        }]
    };
    const vocabStore = loadVocabStore({
        embeddedWords: [{ word: 'alpha', meaning: 'A', phonetic: '/ˈæl.fə/' }],
        dataSeed: {
            words: [{ id: 'default-alpha', word: 'alpha', meaning: 'A' }],
            config: originalConfig,
            collections: { custom: originalCustomCollection }
        }
    });

    await vocabStore.init();
    assert.strictEqual(vocabStore.getActiveListId(), 'custom', '默认词表回填不得切换当前词表');
    assert.strictEqual(vocabStore.getWords()[0].id, 'custom-word', '内存中的激活词表仍应是自定义词表');
    assert.deepStrictEqual(vocabStore.__appDataState.config, originalConfig, '回填不得改写激活词表配置');
    assert.deepStrictEqual(
        vocabStore.__appDataState.collections.custom,
        originalCustomCollection,
        '回填默认词表时不得规范化或重写自定义词表原始记录'
    );
    assert.strictEqual(vocabStore.__appDataState.words[0].phonetic, 'ˈæl.fə');
    assert.strictEqual(vocabStore.__appDataMetrics.backfillListWordPhoneticsCalls.length, 1);
    assert.strictEqual(vocabStore.__appDataMetrics.backfillListWordPhoneticsCalls[0].listId, 'default');
    assert.strictEqual(
        vocabStore.__appDataMetrics.replaceListWordsCalls.some((call) => call.listId === 'custom'),
        false,
        '自定义激活词表不应产生整表写入'
    );
}

async function testPhoneticBackfillFailureKeepsRuntimeFallbackAndRawRecord() {
    const originalWords = [{
        id: 'persisted-alpha',
        word: 'alpha',
        meaning: 'A',
        note: 'keep this note',
        easeFactor: 2.3,
        interval: 8,
        repetitions: 3,
        correctCount: 6,
        futureField: { schema: 3 }
    }];
    const vocabStore = loadVocabStore({
        embeddedWords: [{ word: 'alpha', meaning: 'A', phonetic: '/ˈæl.fə/' }],
        dataSeed: {
            words: originalWords,
            failBackfill: true
        }
    });

    await vocabStore.init();
    const [runtimeWord] = vocabStore.getWords();
    assert.strictEqual(vocabStore.state.ready, true, '音标回填失败不应阻断词汇域初始化');
    assert.strictEqual(runtimeWord.phonetic, 'ˈæl.fə', '回填失败时当前会话仍应使用内置音标');
    assert.strictEqual(runtimeWord.id, 'persisted-alpha');
    assert.strictEqual(runtimeWord.note, 'keep this note');
    assert.strictEqual(runtimeWord.correctCount, 6);
    assert.deepStrictEqual(
        vocabStore.__appDataState.words,
        originalWords,
        '失败的回填不得部分改写或规范化持久化原始记录'
    );
    assert.strictEqual(vocabStore.__appDataMetrics.backfillListWordPhoneticsCalls.length, 1);
    assert.strictEqual(vocabStore.__appDataMetrics.backfillListWordPhoneticsWrites, 0);
    assert.strictEqual(vocabStore.__appDataMetrics.replaceListWordsCalls.length, 0);
}

async function testConfigUsesCentralBoundsAndTypes() {
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        dataSeed: {
            words: [{ id: 'word-1', word: 'alpha', meaning: 'A' }]
        }
    });
    await vocabStore.init();

    await vocabStore.setConfig({
        dailyNew: -10,
        reviewLimit: 999,
        masteryCount: 2.9,
        notify: 'yes',
        theme: 'neon'
    });
    let config = vocabStore.getConfig();
    assert.strictEqual(config.dailyNew, 0);
    assert.strictEqual(config.reviewLimit, 300);
    assert.strictEqual(config.masteryCount, 2);
    assert.strictEqual(config.notify, true);
    assert.strictEqual(config.theme, 'auto');

    await vocabStore.setConfig({
        dailyNew: '10',
        reviewLimit: Number.NaN,
        masteryCount: Number.POSITIVE_INFINITY,
        notify: false,
        theme: 'dark'
    });
    config = vocabStore.getConfig();
    assert.strictEqual(config.dailyNew, 20);
    assert.strictEqual(config.reviewLimit, 100);
    assert.strictEqual(config.masteryCount, 4);
    assert.strictEqual(config.notify, false);
    assert.strictEqual(config.theme, 'dark');
}

async function testProgressRestoreRequiresCompleteV2Identity() {
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        dataSeed: {
            words: [{ id: 'word-1', word: 'alpha', meaning: 'A' }]
        }
    });
    await vocabStore.init();

    await assert.rejects(
        vocabStore.replaceProgress([{ word: 'beta', meaning: 'B' }], { dailyNew: 10 }, null),
        /未知词表/
    );
    await assert.rejects(
        vocabStore.replaceProgress([{ word: 'beta', meaning: 'B' }], null, 'custom'),
        /有效配置/
    );
    await assert.rejects(
        vocabStore.replaceProgress([{ word: 'beta', meaning: 'B' }], { dailyNew: 10 }, 'other-list'),
        /未知词表/
    );
}

async function testProgressRestorePreservesExistingExplicitPhonetics() {
    const vocabStore = loadVocabStore({
        embeddedWords: [
            { word: 'alpha', meaning: 'A', phonetic: '/bundled-alpha/' },
            { word: 'beta', meaning: 'B', phonetic: '/bundled-beta/' }
        ],
        dataSeed: {
            words: [
                {
                    id: 'word-alpha',
                    word: 'alpha',
                    meaning: 'Old A',
                    phonetic: ' /custom-alpha/ ',
                    note: 'old alpha note'
                },
                {
                    id: 'word-beta',
                    word: 'beta',
                    meaning: 'Old B',
                    phonetic: 'custom-beta',
                    note: 'old beta note'
                }
            ]
        }
    });
    await vocabStore.init();

    const restored = await vocabStore.replaceProgress([
        {
            id: 'word-alpha',
            word: 'alpha',
            meaning: 'Restored A',
            note: 'restored alpha note',
            correctCount: 4
        },
        {
            id: 'word-beta',
            word: 'beta',
            meaning: 'Restored B',
            phonetic: '   ',
            note: 'restored beta note',
            correctCount: 5
        }
    ], { dailyNew: 12, reviewLimit: 40, masteryCount: 4 }, 'default');

    const [storedAlpha, storedBeta] = vocabStore.__appDataState.words;
    assert.strictEqual(storedAlpha.phonetic, 'custom-alpha', '缺失的备份音标不得擦除存量自定义音标');
    assert.strictEqual(storedBeta.phonetic, 'custom-beta', '空白的备份音标不得擦除存量自定义音标');
    assert.strictEqual(storedAlpha.note, 'restored alpha note');
    assert.strictEqual(storedBeta.note, 'restored beta note');

    const [runtimeAlpha, runtimeBeta] = vocabStore.getWords();
    assert.strictEqual(runtimeAlpha.phonetic, 'custom-alpha', '内存状态必须使用 AppData 返回的已提交音标');
    assert.strictEqual(runtimeBeta.phonetic, 'custom-beta', '内存状态不得退回内置音标');
    assert.strictEqual(restored.words[0].phonetic, 'custom-alpha');
    assert.strictEqual(restored.words[1].phonetic, 'custom-beta');
    assert.strictEqual(vocabStore.__appDataMetrics.replaceProgressCalls.length, 1);
    assert.strictEqual(
        vocabStore.__appDataMetrics.replaceProgressCalls[0].committedWords[0].phonetic,
        'custom-alpha',
        'facade 应返回保留音标后的 committed words'
    );
}

async function testReadingHighlightUpsertPreservesStudyProgress() {
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        dataSeed: {
            words: [{ id: 'word-1', word: 'seed', meaning: 'Seed' }],
            collections: {
                'reading-highlights': {
                    id: 'reading-highlights',
                    words: [{
                        id: 'reading-highlight-alpha',
                        word: 'alpha',
                        meaning: '旧释义',
                        phonetic: 'old-phonetic',
                        example: 'Old example',
                        note: '用户记忆笔记',
                        easeFactor: 2.2,
                        interval: 10,
                        repetitions: 5,
                        intraCycles: 0,
                        correctCount: 5,
                        lastReviewed: '2026-08-01T00:00:00.000Z',
                        nextReview: '2026-08-11T00:00:00.000Z',
                        createdAt: '2026-07-01T00:00:00.000Z',
                        updatedAt: '2026-08-01T00:00:00.000Z'
                    }]
                }
            }
        }
    });

    await vocabStore.init();
    const saved = await vocabStore.upsertReadingHighlightWord({
        word: 'alpha',
        meaning: '新释义',
        phonetic: '  /njuː/  ',
        example: 'New example',
        sourceLabel: 'Reading passage'
    });
    let [stored] = vocabStore.__appDataState.collections['reading-highlights'].words;

    assert.strictEqual(saved.meaning, '新释义');
    assert.strictEqual(saved.phonetic, 'njuː', '非空音标应写入结构化 phonetic 字段并移除外围斜杠');
    assert.strictEqual(saved.example, 'New example');
    assert.strictEqual(saved.note, '用户记忆笔记');
    assert.strictEqual(stored.phonetic, 'njuː');
    assert.strictEqual(stored.note.includes('音标:'), false, '音标不应再编码进 note 文本');
    assert.strictEqual(stored.easeFactor, 2.2);
    assert.strictEqual(stored.interval, 10);
    assert.strictEqual(stored.repetitions, 5);
    assert.strictEqual(stored.correctCount, 5);
    assert.strictEqual(stored.lastReviewed, '2026-08-01T00:00:00.000Z');
    assert.strictEqual(stored.nextReview, '2026-08-11T00:00:00.000Z');
    assert.strictEqual(stored.createdAt, '2026-07-01T00:00:00.000Z');

    const savedWithBlankPhonetic = await vocabStore.upsertReadingHighlightWord({
        word: 'alpha',
        meaning: '再次更新释义',
        phonetic: '   ',
        example: 'Latest example',
        sourceLabel: 'Another reading passage'
    });
    [stored] = vocabStore.__appDataState.collections['reading-highlights'].words;
    assert.strictEqual(savedWithBlankPhonetic.phonetic, 'njuː', '空音标更新必须保留已有结构化音标');
    assert.strictEqual(stored.phonetic, 'njuː');
    assert.strictEqual(stored.note, '用户记忆笔记', '空音标更新不得破坏用户笔记');
    assert.strictEqual(stored.easeFactor, 2.2);
    assert.strictEqual(stored.interval, 10);
    assert.strictEqual(stored.repetitions, 5);
    assert.strictEqual(stored.correctCount, 5);
    assert.strictEqual(stored.lastReviewed, '2026-08-01T00:00:00.000Z');
    assert.strictEqual(stored.nextReview, '2026-08-11T00:00:00.000Z');
    assert.strictEqual(stored.createdAt, '2026-07-01T00:00:00.000Z');
}

async function testReadingHighlightLegacyNoteProjectsPhoneticWithoutMutation() {
    const legacyNote = '音标: kɑ:vz;kævz；来源: 旧版阅读高亮；用户补充内容';
    const explicitNote = '音标: /note-value/；来源: 旧版阅读高亮';
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        dataSeed: {
            words: [{ id: 'word-default', word: 'seed', meaning: 'Seed' }],
            collections: {
                'reading-highlights': {
                    id: 'reading-highlights',
                    words: [
                        {
                            id: 'reading-highlight-legacy',
                            word: 'legacy',
                            meaning: '旧记录',
                            note: legacyNote,
                            easeFactor: 2.35,
                            interval: 14,
                            repetitions: 6,
                            intraCycles: 1,
                            correctCount: 8,
                            lastReviewed: '2026-08-01T00:00:00.000Z',
                            nextReview: '2026-08-15T00:00:00.000Z',
                            createdAt: '2026-07-01T00:00:00.000Z',
                            updatedAt: '2026-08-01T00:00:00.000Z'
                        },
                        {
                            id: 'reading-highlight-explicit',
                            word: 'explicit',
                            meaning: '显式记录',
                            phonetic: ' /structured/ ',
                            note: explicitNote,
                            easeFactor: 2.1,
                            interval: 4,
                            repetitions: 2,
                            correctCount: 3
                        }
                    ]
                }
            }
        }
    });

    await vocabStore.init();
    const list = await vocabStore.loadList('reading-highlights');
    const [legacy, explicit] = list.words;
    assert.strictEqual(legacy.phonetic, 'kɑ:vz;kævz', '旧 note 中的 ASCII 分号应作为音标内容完整投影');
    assert.strictEqual(legacy.note, legacyNote, '投影不得改写旧 note');
    assert.strictEqual(legacy.easeFactor, 2.35);
    assert.strictEqual(legacy.interval, 14);
    assert.strictEqual(legacy.repetitions, 6);
    assert.strictEqual(legacy.intraCycles, 1);
    assert.strictEqual(legacy.correctCount, 8);
    assert.strictEqual(legacy.lastReviewed, '2026-08-01T00:00:00.000Z');
    assert.strictEqual(legacy.nextReview, '2026-08-15T00:00:00.000Z');
    assert.strictEqual(legacy.createdAt, '2026-07-01T00:00:00.000Z');
    assert.strictEqual(explicit.phonetic, 'structured', '显式 phonetic 必须优先于旧 note 中的音标');
    assert.strictEqual(explicit.note, explicitNote);

    const [rawLegacy, rawExplicit] = vocabStore.__appDataState.collections['reading-highlights'].words;
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(rawLegacy, 'phonetic'),
        false,
        '兼容投影不得向旧持久化记录写入字段'
    );
    assert.strictEqual(rawLegacy.note, legacyNote);
    assert.strictEqual(rawExplicit.phonetic, ' /structured/ ', '读取投影不得规范化持久层显式音标');

    assert.strictEqual(await vocabStore.setActiveList(list), true);
    const updated = await vocabStore.updateWord('reading-highlight-legacy', {
        interval: 21,
        repetitions: 7,
        correctCount: 9,
        lastReviewed: '2026-08-20T00:00:00.000Z',
        nextReview: '2026-09-10T00:00:00.000Z'
    });
    assert.strictEqual(updated.phonetic, 'kɑ:vz;kævz', 'mutation receipt 归一化后仍应完整投影旧 note 音标');
    assert.strictEqual(updated.note, legacyNote);
    assert.strictEqual(updated.easeFactor, 2.35);
    assert.strictEqual(updated.interval, 21);
    assert.strictEqual(updated.repetitions, 7);
    assert.strictEqual(updated.correctCount, 9);
    assert.strictEqual(updated.lastReviewed, '2026-08-20T00:00:00.000Z');
    assert.strictEqual(updated.nextReview, '2026-09-10T00:00:00.000Z');

    let runtimeLegacy = vocabStore.getWords().find((word) => word.id === 'reading-highlight-legacy');
    assert.strictEqual(runtimeLegacy.phonetic, 'kɑ:vz;kævz', 'updateWord 后内存词条必须保留完整兼容投影');
    assert.strictEqual(runtimeLegacy.note, legacyNote);
    assert.strictEqual(runtimeLegacy.correctCount, 9);
    const rawAfterUpdate = vocabStore.__appDataState.collections['reading-highlights'].words[0];
    assert.strictEqual(Object.prototype.hasOwnProperty.call(rawAfterUpdate, 'phonetic'), false);
    assert.strictEqual(rawAfterUpdate.note, legacyNote);
    assert.strictEqual(rawAfterUpdate.interval, 21);
    assert.strictEqual(rawAfterUpdate.correctCount, 9);

    const merged = await vocabStore.mergeWords([{
        id: 'reading-highlight-new',
        word: 'new-entry',
        meaning: '新增记录'
    }]);
    runtimeLegacy = merged.words.find((word) => word.id === 'reading-highlight-legacy');
    assert.strictEqual(runtimeLegacy.phonetic, 'kɑ:vz;kævz', 'mergeWords receipt 也必须保留 ASCII 分号音标');
    assert.strictEqual(runtimeLegacy.note, legacyNote);
    assert.strictEqual(runtimeLegacy.interval, 21);
    assert.strictEqual(runtimeLegacy.correctCount, 9);
}

async function testExternalListCommitInvalidatesCacheAndRefreshesActiveList() {
    const vocabStore = loadVocabStore({
        embeddedWords: [],
        dataSeed: {
            words: [{ id: 'word-default', word: 'default', meaning: 'Default' }],
            collections: {
                'spelling-errors-p1': {
                    id: 'spelling-errors-p1',
                    words: [{ id: 'word-p1-a', word: 'alpha', meaning: 'A' }]
                },
                'spelling-errors-p4': {
                    id: 'spelling-errors-p4',
                    words: [{ id: 'word-p4-a', word: 'gamma', meaning: 'G' }]
                }
            }
        }
    });

    await vocabStore.init();
    await vocabStore.setActiveList('spelling-errors-p1');
    await vocabStore.loadList('spelling-errors-p4');
    assert.strictEqual(await vocabStore.getListWordCount('spelling-errors-p4'), 1);

    vocabStore.__appDataState.collections['spelling-errors-p1'].words.push({
        id: 'word-p1-b', word: 'beta', meaning: 'B'
    });
    vocabStore.__appDataState.collections['spelling-errors-p4'].words.push({
        id: 'word-p4-b', word: 'delta', meaning: 'D'
    });
    vocabStore.__emitDataCommitted('vocab.lists');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(vocabStore.getWords().length, 2, '激活词表应在外部提交后刷新');
    assert.strictEqual(await vocabStore.getListWordCount('spelling-errors-p4'), 2, '计数不应继续使用旧缓存');
    const reloaded = await vocabStore.loadList('spelling-errors-p4');
    assert.strictEqual(reloaded.words.length, 2, '词表加载不应继续使用旧缓存');

    const originalDateNow = Date.now;
    const cacheStartedAt = originalDateNow();
    try {
        Date.now = () => cacheStartedAt;
        vocabStore.__appDataState.collections['spelling-errors-p4'].words.push({
            id: 'word-p4-c', word: 'epsilon', meaning: 'E'
        });
        assert.strictEqual(await vocabStore.getListWordCount('spelling-errors-p4'), 2, 'TTL 内允许复用缓存');
        Date.now = () => cacheStartedAt + (5 * 60 * 1000) + 1;
        assert.strictEqual(await vocabStore.getListWordCount('spelling-errors-p4'), 3, '计数缓存过期后应重读存储');
    } finally {
        Date.now = originalDateNow;
    }
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
        await testImportedVocabInSpellingListSurvivesReload();
        results.push({ name: '拼写词表中的普通导入词在重载后保持原字段', status: 'pass' });
        await testDefaultLexiconWriteFailureRejectsInitialization();
        results.push({ name: '默认词库持久化失败会阻断 ready', status: 'pass' });
        await testPhoneticIsOptionalAndPresentationRemovesSlashes();
        results.push({ name: '音标可选且展示时移除外围斜杠', status: 'pass' });
        await testDefaultPhoneticBackfillPreservesRawRecordsAndIsIdempotent();
        results.push({ name: '默认用户音标回填保留原始记录且幂等', status: 'pass' });
        await testDefaultPhoneticBackfillDoesNotRewriteOrSwitchCustomActiveList();
        results.push({ name: '默认词表回填不切换或重写自定义激活词表', status: 'pass' });
        await testPhoneticBackfillFailureKeepsRuntimeFallbackAndRawRecord();
        results.push({ name: '音标回填失败时使用内存降级且不改原始记录', status: 'pass' });
        await testConfigUsesCentralBoundsAndTypes();
        results.push({ name: '配置写入遵守统一范围和类型', status: 'pass' });
        await testProgressRestoreRequiresCompleteV2Identity();
        results.push({ name: '进度恢复要求完整 v2 词表身份', status: 'pass' });
        await testProgressRestorePreservesExistingExplicitPhonetics();
        results.push({ name: '进度恢复保留存量显式音标并采用提交结果', status: 'pass' });
        await testReadingHighlightUpsertPreservesStudyProgress();
        results.push({ name: '阅读高亮结构化音标更新并保留学习进度', status: 'pass' });
        await testReadingHighlightLegacyNoteProjectsPhoneticWithoutMutation();
        results.push({ name: '阅读高亮旧 note 音标只投影且显式字段优先', status: 'pass' });
        await testExternalListCommitInvalidatesCacheAndRefreshesActiveList();
        results.push({ name: '外部词表提交会失效缓存并刷新激活词表', status: 'pass' });
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
