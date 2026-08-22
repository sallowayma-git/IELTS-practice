#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadLegacyExamListView() {
    const windowStub = {};
    const documentStub = {
        createElement() {
            return {
                className: '',
                dataset: {},
                style: {},
                appendChild() {},
                setAttribute() {},
                addEventListener() {},
                removeEventListener() {}
            };
        },
        createTextNode(text) {
            return { textContent: String(text) };
        },
        getElementById() {
            return null;
        },
        querySelector() {
            return null;
        }
    };
    const sandbox = {
        window: windowStub,
        document: documentStub,
        Node: function Node() {},
        console,
        Date,
        Math,
        Number,
        String,
        Boolean,
        Array,
        Object,
        RegExp,
        Set,
        Map,
        JSON
    };
    sandbox.globalThis = sandbox.window;
    vm.createContext(sandbox);
    const source = fs.readFileSync(path.join(repoRoot, 'js/views/legacyViewBundle.js'), 'utf8');
    vm.runInContext(source, sandbox, { filename: 'js/views/legacyViewBundle.js' });
    return {
        windowStub,
        LegacyExamListView: windowStub.LegacyExamListView
    };
}

function describe(name, fn) {
    try {
        fn();
        console.log(`✔ ${name}`);
    } catch (error) {
        console.error(`✖ ${name}`);
        throw error;
    }
}

function it(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (error) {
        console.error(`  ✗ ${name}`);
        throw error;
    }
}

describe('LegacyExamListView.render commit contract', () => {
    it('fails closed when its container is unavailable', () => {
        const { LegacyExamListView } = loadLegacyExamListView();
        const view = new LegacyExamListView();

        assert.strictEqual(view.render([]), false);
    });

    it('reports success only after committing the empty state', () => {
        const { LegacyExamListView } = loadLegacyExamListView();
        const view = new LegacyExamListView();
        const container = {};
        let emptyStateCommits = 0;
        view._getContainer = () => container;
        view._getLoadingIndicator = () => null;
        view._renderEmptyState = (target) => {
            assert.strictEqual(target, container);
            emptyStateCommits += 1;
        };
        view._hideLoading = () => {};

        assert.strictEqual(view.render([]), true);
        assert.strictEqual(emptyStateCommits, 1);
    });
});

describe('LegacyExamListView._getCompletionStatus', () => {
    it('keeps a prepared completion map invisible until commit', () => {
        const { windowStub, LegacyExamListView } = loadLegacyExamListView();
        const view = new LegacyExamListView();
        const exam = { id: 'staged-reading', title: 'Staged Reading' };
        const prepared = windowStub.prepareBrowseCompletionIndex([{
            examId: 'staged-reading',
            title: 'Staged Reading',
            percentage: 77,
            date: '2026-08-23T00:00:00.000Z'
        }]);

        assert.strictEqual(
            view._getCompletionStatus(exam),
            null,
            'preparation alone must not replace the accepted completion map'
        );
        assert.strictEqual(windowStub.commitBrowseCompletionIndex(prepared), true);
        assert.strictEqual(view._getCompletionStatus(exam).percentage, 77);
    });

    it('reads score and timestamp from matching suite child entries', () => {
        const { windowStub, LegacyExamListView } = loadLegacyExamListView();
        const view = new LegacyExamListView();
        const exam = {
            id: 'reading-p2',
            title: 'Passage 2',
            path: 'Reading/P2/passage-2.html'
        };
        const records = [
            {
                id: 'suite-record-1',
                examId: 'suite-suite-record-1',
                title: '2026-07-01 套题',
                date: '2026-07-01T10:00:00.000Z',
                suiteEntries: [
                    {
                        examId: 'reading-p2',
                        title: 'Passage 2',
                        percentage: 84,
                        updatedAt: '2026-07-01T09:58:00.000Z'
                    }
                ]
            }
        ];
        windowStub.rebuildBrowseCompletionIndex(records);

        const status = view._getCompletionStatus(exam);

        assert(status, '匹配的套题子条目应产生完成状态');
        assert.strictEqual(status.percentage, 84, '应读取 suiteEntries 子条目的分数');
        assert.strictEqual(status.date, '2026-07-01T09:58:00.000Z', '应优先读取 suiteEntries 子条目的时间');
    });

    it('uses suiteEntrySummaries score and parent timestamp fallback for light records', () => {
        const { windowStub, LegacyExamListView } = loadLegacyExamListView();
        const view = new LegacyExamListView();
        const exam = {
            id: 'reading-p3',
            title: 'Passage 3'
        };
        const records = [
            {
                id: 'suite-record-2',
                examId: 'suite-suite-record-2',
                title: '2026-07-02 套题',
                date: '2026-07-02T12:30:00.000Z',
                suiteEntrySummaries: [
                    {
                        examId: 'reading-p3',
                        title: 'Passage 3',
                        correctAnswers: 9,
                        totalQuestions: 10,
                        accuracy: 0.9,
                        percentage: 90
                    }
                ]
            }
        ];
        windowStub.rebuildBrowseCompletionIndex(records);

        const status = view._getCompletionStatus(exam);

        assert(status, 'light.suiteEntrySummaries 子条目也应产生完成状态');
        assert.strictEqual(status.percentage, 90, '应从 suiteEntrySummaries 读取分数');
        assert.strictEqual(status.date, '2026-07-02T12:30:00.000Z', '子条目缺失时间时应回退到父记录时间');
    });
});
