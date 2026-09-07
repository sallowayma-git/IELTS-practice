import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('Bookshelf delete button and vocab isolation test', async () => {
    const bookshelfPath = new URL('../../../js/components/bookshelfView.js', import.meta.url);
    const bookshelfCode = fs.readFileSync(bookshelfPath, 'utf8');

    // 1. 静态断言：确认已移除脆弱的 window.confirm，使用安全的 openConfirmDialog
    assert.ok(!bookshelfCode.includes('if (confirm('), '应当不再依赖沙箱 iframe 中易被拦截的 window.confirm');
    assert.ok(bookshelfCode.includes('openConfirmDialog'), '应当具有 openConfirmDialog 自定义模态确认');
    assert.ok(bookshelfCode.includes('bookshelf-confirm-dialog'), '应当包含 bookshelf-confirm-dialog 确认对话框');

    // 2. 模拟运行环境测试 ReadingBookshelfStore.removeExam
    const mockStorage = new Map();
    const localStorageShim = {
        getItem: (k) => mockStorage.get(k) || null,
        setItem: (k, v) => mockStorage.set(k, String(v)),
        removeItem: (k) => mockStorage.delete(k)
    };

    let readingVocabStoreClearedExamId = null;
    const mockReadingVocabStore = {
        clear: (eid) => {
            readingVocabStoreClearedExamId = eid;
        }
    };

    let appDataSavedWords = null;
    const mockAppData = {
        vocab: {
            saveReadingWords: async (words) => {
                appDataSavedWords = words;
            }
        },
        // 练习做题记录（严格隔离，绝不允许被删除）
        practice: {
            records: [
                { id: 'rec_1', examId: 'cambridge-18-test-1-p1', score: 11, total: 13, timeSpent: 1200 },
                { id: 'rec_2', examId: 'cambridge-18-test-1-p2', score: 9, total: 13, timeSpent: 1100 }
            ]
        }
    };

    const sandbox = {
        console,
        localStorage: localStorageShim,
        CustomEvent: class { constructor(type, detail) { this.type = type; this.detail = detail; } },
        setTimeout,
        clearTimeout,
        Date,
        JSON,
        Set,
        Map,
        Array,
        String,
        Math,
        ReadingVocabStore: mockReadingVocabStore,
        AppData: mockAppData
    };
    sandbox.window = sandbox;
    sandbox.global = sandbox;
    sandbox.document = {
        getElementById: () => null,
        createElement: () => ({ setAttribute: () => {}, querySelector: () => null }),
        querySelector: () => null,
        body: { appendChild: () => {} }
    };
    sandbox.addEventListener = () => {};
    sandbox.dispatchEvent = () => {};

    vm.createContext(sandbox);
    vm.runInContext(bookshelfCode, sandbox);

    const store = sandbox.ReadingBookshelfStore;
    assert.ok(store, 'ReadingBookshelfStore 必须正常导出到全局');

    // 初始化测试数据：
    // - 篇目 1: cambridge-18-test-1-p1 (有书架记录 + 2个生词)
    // - 篇目 2: cambridge-18-test-1-p2 (有书架记录 + 1个生词)
    const initialBookshelf = [
        { examId: 'cambridge-18-test-1-p1', examTitle: 'Reading Passage 1', firstUsedAt: 1000, lastOpenedAt: 2000 },
        { examId: 'cambridge-18-test-1-p2', examTitle: 'Reading Passage 2', firstUsedAt: 1000, lastOpenedAt: 3000 }
    ];
    const initialVocab = [
        { id: 'w1', examId: 'cambridge-18-test-1-p1', word: 'urbanisation', createdAt: 2000 },
        { id: 'w2', examId: 'cambridge-18-test-1-p1', word: 'infrastructure', createdAt: 2100 },
        { id: 'w3', examId: 'cambridge-18-test-1-p2', word: 'biodiversity', createdAt: 3000 }
    ];

    mockStorage.set('ielts_reading_bookshelf_exams_v1', JSON.stringify(initialBookshelf));
    mockStorage.set('ielts_reading_vocab_words_v1', JSON.stringify(initialVocab));

    // 检查删除前书架列表
    const beforeExams = store.getBookshelfExams();
    assert.equal(beforeExams.length, 2, '初始书架应当包含2篇');
    const p1Before = beforeExams.find(e => e.examId === 'cambridge-18-test-1-p1');
    assert.ok(p1Before);
    assert.equal(p1Before.wordCount, 2);

    // 记录做题练习数据基线（必须严格保持一致）
    const initialPracticeSnapshot = JSON.stringify(mockAppData.practice.records);

    // 执行从书架移除 cambridge-18-test-1-p1
    const res = store.removeExam('cambridge-18-test-1-p1', true);
    assert.ok(res, 'removeExam 执行应当成功');

    // 检查删除后的书架列表
    const afterExams = store.getBookshelfExams();
    assert.equal(afterExams.length, 1, '删除后书架应仅剩 1 篇');
    assert.equal(afterExams[0].examId, 'cambridge-18-test-1-p2', '剩余篇目应为 p2');

    // 检查生词本数据：p1 的词汇已被清除，p2 的词汇完整保留
    const currentVocabRaw = mockStorage.get('ielts_reading_vocab_words_v1');
    const currentVocab = JSON.parse(currentVocabRaw || '[]');
    assert.equal(currentVocab.length, 1, '生词本中只保留非删除篇目的词');
    assert.equal(currentVocab[0].word, 'biodiversity');

    // 检查 ReadingVocabStore.clear 调用
    assert.equal(readingVocabStoreClearedExamId, 'cambridge-18-test-1-p1');

    // 核心断言：做题练习记录严格隔离，分毫未动！
    const finalPracticeSnapshot = JSON.stringify(mockAppData.practice.records);
    assert.equal(
        finalPracticeSnapshot,
        initialPracticeSnapshot,
        '做题练习记录与答题历史必须完好无损，严格与生词本/书架删除隔离'
    );

    console.log('✅ 书架删除生词本记录且严格隔离做题练习记录测试全部通过！');
});
