#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadScript(relativePath, context) {
    const fullPath = path.join(repoRoot, relativePath);
    const source = fs.readFileSync(fullPath, 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
}

function createWebStorage() {
    const map = new Map();
    return {
        getItem(key) {
            return map.has(key) ? map.get(key) : null;
        },
        setItem(key, value) {
            map.set(key, String(value));
        },
        removeItem(key) {
            map.delete(key);
        },
        dump() {
            return new Map(map);
        }
    };
}

function createHarness(options = {}) {
    const { syncUiOnReplace = false } = options;
    const practiceState = [
        {
            id: 'record-1',
            title: 'Record 1',
            date: '2026-03-09T10:00:00.000Z',
            percentage: 80,
            duration: 120
        },
        {
            id: 'record-2',
            title: 'Record 2',
            date: '2026-03-09T11:00:00.000Z',
            percentage: 60,
            duration: 90
        }
    ];
    const uiState = practiceState.map((record) => ({ ...record }));
    const localStorage = createWebStorage();
    const sessionStorage = createWebStorage();
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };

    const storageStub = {
        mode: 'indexeddb',
        getKey(key) {
            return `exam_system_${key}`;
        },
        async get() {
            return practiceState.map((record) => ({ ...record }));
        },
        async set(key, value) {
            if (key === 'practice_records') {
                practiceState.splice(0, practiceState.length, ...(Array.isArray(value) ? value.map((record) => ({ ...record })) : []));
            }
            return true;
        },
        async writePersistentValue(key, value) {
            return this.set(key, value);
        }
    };

    const messageLog = [];
    let renderCount = 0;

    const sandbox = {
        console: quietConsole,
        localStorage,
        sessionStorage,
        storage: storageStub,
        confirm: () => true,
        showMessage: (message, type) => {
            messageLog.push({ message, type });
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math,
        JSON,
        processedSessions: {
            clear() {}
        },
        getPracticeRecordsState() {
            return uiState.map((record) => ({ ...record }));
        },
        setPracticeRecordsState(records) {
            uiState.splice(0, uiState.length, ...(Array.isArray(records) ? records.map((record) => ({ ...record })) : []));
            return uiState.map((record) => ({ ...record }));
        },
        getSelectedRecordsState() {
            return new Set();
        },
        clearSelectedRecordsState() {},
        setBulkDeleteModeState() {},
        refreshBulkDeleteButton() {},
        refreshBrowseProgressFromRecords() {},
        updatePracticeView() {},
        normalizeRecordId(id) {
            return id == null ? '' : String(id);
        },
        document: {
            addEventListener() {},
            getElementById() {
                return null;
            },
            querySelector() {
                return null;
            },
            querySelectorAll() {
                return [];
            }
        },
        window: {
            console: quietConsole,
            storage: storageStub,
            app: {
                state: {
                    practice: {
                        records: uiState.map((record) => ({ ...record }))
                    }
                }
            },
            PracticeCore: {
                store: {
                    async listPracticeRecords() {
                        return practiceState.map((record) => ({ ...record }));
                    },
                    async replacePracticeRecords(records) {
                        practiceState.splice(0, practiceState.length, ...(Array.isArray(records) ? records.map((record) => ({ ...record })) : []));
                        if (syncUiOnReplace) {
                            uiState.splice(0, uiState.length, ...(Array.isArray(records) ? records.map((record) => ({ ...record })) : []));
                        }
                        return true;
                    }
                }
            }
        }
    };

    sandbox.globalThis = sandbox.window;
    sandbox.window.localStorage = localStorage;
    sandbox.window.sessionStorage = sessionStorage;

    loadScript('js/main.js', vm.createContext(sandbox));
    sandbox.updatePracticeView = function updatePracticeViewSpy() {
        renderCount += 1;
    };
    sandbox.window.updatePracticeView = sandbox.updatePracticeView;

    return {
        sandbox,
        practiceState,
        localStorage,
        sessionStorage,
        messageLog,
        getRenderCount() {
            return renderCount;
        }
    };
}

async function testDeleteRecordPersistsAndCleansLegacyKeys() {
    const harness = createHarness();
    harness.localStorage.setItem('practice_records', JSON.stringify([{ id: 'legacy-record' }]));
    harness.localStorage.setItem('old_prefix_practice_records', JSON.stringify([{ id: 'legacy-old' }]));
    harness.localStorage.setItem('exam_system_practice_records', 'stale-shadow');

    await harness.sandbox.deleteRecord('record-1');

    assert.deepStrictEqual(
        harness.practiceState.map((record) => record.id),
        ['record-2'],
        'deleteRecord 应删除 canonical store 中的目标记录'
    );
    assert.strictEqual(
        harness.localStorage.getItem('practice_records'),
        JSON.stringify([{ id: 'record-2', title: 'Record 2', date: '2026-03-09T11:00:00.000Z', percentage: 60, duration: 90 }]),
        'deleteRecord 后应同步 legacy practice_records'
    );
    assert.deepStrictEqual(
        harness.sandbox.window.app.state.practice.records.map((record) => record.id),
        ['record-2'],
        'deleteRecord 后应同步 app.state.practice.records，避免页面销毁时把旧记录写回去'
    );
    assert.strictEqual(harness.localStorage.getItem('old_prefix_practice_records'), null, 'deleteRecord 后应清理 old_prefix 影子键');
    assert.strictEqual(harness.localStorage.getItem('exam_system_practice_records'), null, 'deleteRecord 后应清理 indexeddb shadow key');
}

async function testClearPracticeDataPersistsAndClearsLegacyKeys() {
    const harness = createHarness();
    harness.localStorage.setItem('practice_records', JSON.stringify([{ id: 'legacy-record' }]));
    harness.sessionStorage.setItem('practice_records', JSON.stringify([{ id: 'legacy-record' }]));

    await harness.sandbox.clearPracticeData();

    assert.strictEqual(harness.practiceState.length, 0, 'clearPracticeData 应清空 canonical store');
    assert.strictEqual(harness.sandbox.window.app.state.practice.records.length, 0, 'clearPracticeData 后应同步清空 app.state.practice.records');
    assert.strictEqual(harness.localStorage.getItem('practice_records'), null, 'clearPracticeData 后应删除 localStorage legacy 键');
    assert.strictEqual(harness.sessionStorage.getItem('practice_records'), null, 'clearPracticeData 后应删除 sessionStorage legacy 键');
}

async function testDeleteRecordForcesUiRefreshWhenPracticeCoreAlreadySyncedState() {
    const harness = createHarness({ syncUiOnReplace: true });

    await harness.sandbox.deleteRecord('record-1');

    assert.ok(
        harness.getRenderCount() > 0,
        'deleteRecord 后即使全局状态已被 PracticeCore 提前同步，仍应强制刷新 UI，避免残留旧卡片'
    );
}

function testScoreStorageDurationPrefersTimelineWhenConflict() {
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };
    const sandbox = {
        console: quietConsole,
        window: {
            console: quietConsole
        },
        Date,
        Math,
        JSON,
        Map,
        Set,
        Promise
    };
    sandbox.globalThis = sandbox.window;

    loadScript('js/core/scoreStorage.js', vm.createContext(sandbox));
    const ScoreStorage = sandbox.window.ScoreStorage;
    assert.strictEqual(typeof ScoreStorage, 'function', 'ScoreStorage 应成功加载');

    const storageLike = Object.create(ScoreStorage.prototype);
    storageLike.convertComparisonToMap = () => ({});
    storageLike.deriveCorrectMapFromDetails = () => ({});
    storageLike.convertComparisonToDetails = () => null;
    storageLike.buildAnswerDetailsFromMaps = () => null;

    const normalized = storageLike.normalizeRecordFields({
        id: 'duration-conflict',
        examId: 'reading-duration',
        duration: 7200,
        startTime: '2026-03-09T09:20:00.000Z',
        endTime: '2026-03-09T10:39:00.000Z',
        metadata: {},
        realData: {}
    });

    assert.strictEqual(
        normalized.duration,
        4740,
        'duration 与 start/end 冲突时，应优先使用 start/end 计算的可信时长'
    );
}

function testScoreStorageDurationRejectsRawFallbackWithoutTimeline() {
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };
    const sandbox = {
        console: quietConsole,
        window: {
            console: quietConsole
        },
        Date,
        Math,
        JSON,
        Map,
        Set,
        Promise
    };
    sandbox.globalThis = sandbox.window;

    loadScript('js/core/scoreStorage.js', vm.createContext(sandbox));
    const ScoreStorage = sandbox.window.ScoreStorage;
    const storageLike = Object.create(ScoreStorage.prototype);
    storageLike.convertComparisonToMap = () => ({});
    storageLike.deriveCorrectMapFromDetails = () => ({});
    storageLike.convertComparisonToDetails = () => null;
    storageLike.buildAnswerDetailsFromMaps = () => null;

    const normalized = storageLike.normalizeRecordFields({
        id: 'duration-no-timeline',
        examId: 'reading-duration',
        duration: 7200,
        metadata: {},
        realData: {}
    });

    assert.strictEqual(
        normalized.duration,
        0,
        '缺少完整 start/end 时间线时，不应再相信裸 duration'
    );
    assert.strictEqual(
        normalized.startTime,
        null,
        '缺少可信开始时间时，不应伪造 startTime'
    );
    assert.strictEqual(
        normalized.endTime,
        null,
        '缺少可信结束时间时，不应伪造 endTime'
    );
}

function testScoreStorageAnalysisInputCanonicalization() {
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };
    const sandbox = {
        console: quietConsole,
        window: {
            console: quietConsole
        },
        Date,
        Math,
        JSON,
        Map,
        Set,
        Promise
    };
    sandbox.globalThis = sandbox.window;

    loadScript('js/core/scoreStorage.js', vm.createContext(sandbox));
    const ScoreStorage = sandbox.window.ScoreStorage;
    const storageLike = Object.create(ScoreStorage.prototype);
    storageLike.currentVersion = '1.0.0';
    storageLike.generateRecordId = () => 'generated-analysis-id';
    storageLike.convertComparisonToMap = () => ({});
    storageLike.deriveCorrectMapFromDetails = () => ({});
    storageLike.convertComparisonToDetails = () => null;
    storageLike.buildAnswerDetailsFromMaps = () => null;

    const standardized = storageLike.standardizeRecord({
        id: 'legacy-general-record',
        examId: 'reading-analysis-canonical',
        type: 'reading',
        startTime: '2026-03-09T10:00:00.000Z',
        endTime: '2026-03-09T10:20:00.000Z',
        score: 3,
        totalQuestions: 5,
        correctAnswers: 3,
        accuracy: 0.6,
        answers: { q1: 'A', q2: 'B', q3: 'C', q4: 'D', q5: 'E' },
        questionTypePerformance: {
            general: { total: 3, correct: 2, accuracy: 0.67 },
            matching: { total: 2, correct: 1, accuracy: 0.5 }
        },
        metadata: {
            type: 'reading',
            examType: 'reading',
            dataQuality: { confidence: 0.8 }
        }
    });

    assert.strictEqual(standardized.questionTypePerformance.general, undefined, 'standardizeRecord 不能回写 general');
    assert.strictEqual(standardized.questionTypePerformance.unknown.total, 3, 'general 应归并为 unknown');
    assert(standardized.singleAttemptAnalysisInput, 'standardizeRecord 应持久化 singleAttemptAnalysisInput');
    assert.strictEqual(standardized.singleAttemptAnalysisInput.missingKindRatio, 0.6, 'missingKindRatio 应正确计算');
    assert(
        Math.abs(standardized.singleAttemptAnalysisInput.confidence - 0.32) < 1e-9,
        'unknown 置信度公式应生效'
    );
}

function testScoreStorageNormalizeRecordBackfillsAnalysisInputForLegacyRecord() {
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };
    const sandbox = {
        console: quietConsole,
        window: {
            console: quietConsole
        },
        Date,
        Math,
        JSON,
        Map,
        Set,
        Promise
    };
    sandbox.globalThis = sandbox.window;

    loadScript('js/core/scoreStorage.js', vm.createContext(sandbox));
    const ScoreStorage = sandbox.window.ScoreStorage;
    const storageLike = Object.create(ScoreStorage.prototype);
    storageLike.convertComparisonToMap = () => ({});
    storageLike.deriveCorrectMapFromDetails = () => ({});
    storageLike.convertComparisonToDetails = () => null;
    storageLike.buildAnswerDetailsFromMaps = () => null;

    const normalized = storageLike.normalizeRecordFields({
        id: 'legacy-read-record',
        examId: 'reading-legacy',
        type: 'reading',
        totalQuestions: 4,
        correctAnswers: 2,
        accuracy: 0.5,
        metadata: {
            type: 'reading',
            examType: 'reading',
            dataQuality: { confidence: 0.9 }
        },
        answers: { q1: 'A', q2: 'B', q3: 'C', q4: 'D' },
        questionTypePerformance: {
            general: { total: 4, correct: 2, accuracy: 0.5 }
        },
        realData: {}
    });

    assert(normalized.singleAttemptAnalysisInput, 'legacy 记录读取时应补齐 singleAttemptAnalysisInput');
    assert(normalized.singleAttemptAnalysis && typeof normalized.singleAttemptAnalysis === 'object', 'legacy 记录读取时应补齐 singleAttemptAnalysis');
    assert.strictEqual(normalized.questionTypePerformance.general, undefined, 'legacy 读取结果不应包含 general');
    assert.strictEqual(normalized.questionTypePerformance.unknown.total, 4, 'legacy general 应迁移为 unknown');
    assert(
        Math.abs(normalized.singleAttemptAnalysisInput.confidence - 0.2) < 1e-9,
        '置信度应在下限 0.2 被 clamp'
    );
    assert(
        Array.isArray(normalized.singleAttemptAnalysis.radar?.byQuestionKind),
        'singleAttemptAnalysis 应包含雷达数据结构'
    );
}

function testScoreStorageNormalizeRecordRebuildsLegacyAnalysisShape() {
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };
    const sandbox = {
        console: quietConsole,
        window: {
            console: quietConsole
        },
        Date,
        Math,
        JSON,
        Map,
        Set,
        Promise
    };
    sandbox.globalThis = sandbox.window;

    loadScript('js/core/scoreStorage.js', vm.createContext(sandbox));
    const ScoreStorage = sandbox.window.ScoreStorage;
    const storageLike = Object.create(ScoreStorage.prototype);
    storageLike.convertComparisonToMap = () => ({});
    storageLike.deriveCorrectMapFromDetails = () => ({});
    storageLike.convertComparisonToDetails = () => null;
    storageLike.buildAnswerDetailsFromMaps = () => null;

    const normalized = storageLike.normalizeRecordFields({
        id: 'legacy-analysis-shape-record',
        examId: 'reading-legacy-shape',
        type: 'reading',
        totalQuestions: 3,
        correctAnswers: 2,
        accuracy: 0.6667,
        metadata: {
            type: 'reading',
            examType: 'reading',
            dataQuality: { confidence: 0.8 }
        },
        answers: { q1: 'A', q2: 'B', q3: 'C' },
        questionTypePerformance: {
            unknown: { total: 3, correct: 2, accuracy: 0.6667 }
        },
        singleAttemptAnalysis: {
            summary: { accuracy: 0.6667 },
            questions: [{ questionId: 'q1' }]
        },
        realData: {}
    });

    assert(
        normalized.singleAttemptAnalysis
        && normalized.singleAttemptAnalysis.radar
        && Array.isArray(normalized.singleAttemptAnalysis.radar.byQuestionKind),
        '旧版 singleAttemptAnalysis 结构应被重建为 canonical radar 结构'
    );
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(normalized.singleAttemptAnalysis, 'questions'),
        false,
        '旧版 questions 字段不应继续保留在 canonical 分析对象'
    );
}

function testScoreStorageFallbackInputCarriesSignalsAndTimeline() {
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };
    const sandbox = {
        console: quietConsole,
        window: {
            console: quietConsole
        },
        Date,
        Math,
        JSON,
        Map,
        Set,
        Promise
    };
    sandbox.globalThis = sandbox.window;

    loadScript('js/core/scoreStorage.js', vm.createContext(sandbox));
    const ScoreStorage = sandbox.window.ScoreStorage;
    const storageLike = Object.create(ScoreStorage.prototype);

    const input = storageLike.buildSingleAttemptAnalysisInputFallback({
        examId: 'reading-fallback-signals',
        type: 'reading',
        duration: 120,
        metadata: {
            type: 'reading',
            examType: 'reading',
            category: 'p2',
            dataQuality: { confidence: 0.8 }
        },
        questionTypePerformance: {
            single_choice: { total: 3, correct: 2, accuracy: 0.6667 }
        },
        answerComparison: {
            q1: { userAnswer: 'A' },
            q2: { userAnswer: '' },
            q3: { userAnswer: 'C' }
        },
        questionTimelineLite: [
            { questionId: 'q1', firstAnsweredAt: Date.now() - 2000, lastAnsweredAt: Date.now() - 1000, changeCount: 2 },
            { questionId: 'q2', firstAnsweredAt: null, lastAnsweredAt: null, changeCount: 0 },
            { questionId: 'q3', firstAnsweredAt: Date.now() - 1500, lastAnsweredAt: Date.now() - 500, changeCount: 1 }
        ],
        interactions: Array.from({ length: 12 }, (_, idx) => ({ type: 'answer', questionId: `q${idx + 1}` }))
    }, {
        totalQuestions: 3,
        correctAnswers: 2,
        accuracy: 2 / 3,
        durationSec: 120
    });

    assert.strictEqual(input.durationSec, 120, 'fallback input 应补齐 durationSec');
    assert.strictEqual(input.category, 'p2', 'fallback input 应保留 category');
    assert(Array.isArray(input.questionTimelineLite), 'fallback input 应补齐 questionTimelineLite');
    assert(input.analysisSignals && typeof input.analysisSignals === 'object', 'fallback input 应补齐 analysisSignals');
    assert.strictEqual(input.analysisSignals.unansweredCount, 1, 'fallback input 应正确统计 unansweredCount');
    assert.strictEqual(input.analysisSignals.changedAnswerCount, 2, 'fallback input 应按改答题数统计 changedAnswerCount');
    assert.strictEqual(input.analysisSignals.interactionDensity, 6, 'fallback input 应按每分钟口径计算 interactionDensity');

    const artifacts = storageLike.buildSingleAttemptAnalysisArtifacts({
        examId: 'reading-fallback-signals',
        type: 'reading',
        metadata: {
            type: 'reading',
            examType: 'reading',
            category: 'p2',
            dataQuality: { confidence: 0.8 }
        },
        totalQuestions: 3,
        correctAnswers: 2,
        accuracy: 2 / 3,
        duration: 120,
        questionTypePerformance: {
            single_choice: { total: 3, correct: 2, accuracy: 0.6667 }
        }
    }, {
        totalQuestions: 3,
        correctAnswers: 2,
        accuracy: 2 / 3,
        durationSec: 120
    });
    assert(
        Array.isArray(artifacts.singleAttemptAnalysis?.radar?.byPassageCategory)
        && artifacts.singleAttemptAnalysis.radar.byPassageCategory.some((item) => item.category === 'p2'),
        'fallback analysis 应包含 byPassageCategory 维度'
    );
}

function testScoreStorageFallbackArtifactsRebuildAnalysisFromInput() {
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };
    const sandbox = {
        console: quietConsole,
        window: {
            console: quietConsole
        },
        Date,
        Math,
        JSON,
        Map,
        Set,
        Promise
    };
    sandbox.globalThis = sandbox.window;

    loadScript('js/core/scoreStorage.js', vm.createContext(sandbox));
    const ScoreStorage = sandbox.window.ScoreStorage;
    const storageLike = Object.create(ScoreStorage.prototype);

    const artifacts = storageLike.buildSingleAttemptAnalysisArtifacts({
        examId: 'reading-stale-analysis',
        type: 'reading',
        metadata: {
            type: 'reading',
            examType: 'reading',
            dataQuality: { confidence: 0.8 }
        },
        totalQuestions: 4,
        correctAnswers: 1,
        accuracy: 0.25,
        questionTypePerformance: {
            unknown: { total: 4, correct: 1, accuracy: 0.25 }
        },
        singleAttemptAnalysis: {
            summary: {
                accuracy: 0.1,
                durationSec: 10,
                unansweredRate: 0.5,
                changedAnswerRate: 0.5
            },
            radar: {
                byQuestionKind: [{ kind: 'unknown', total: 4, correct: 0, accuracy: 0, confidence: 0.2 }],
                byPassageCategory: []
            },
            diagnosis: [{ reason: 'stale' }],
            nextActions: [{ instruction: 'stale' }],
            confidence: 0.2
        }
    }, {
        totalQuestions: 4,
        correctAnswers: 3,
        accuracy: 0.75,
        durationSec: 120,
        questionTypePerformance: {
            single_choice: { total: 4, correct: 3, accuracy: 0.75, confidence: 0.8 }
        },
        analysisSignals: {
            unansweredCount: 0,
            changedAnswerCount: 1,
            interactionDensity: 3
        }
    });

    assert.strictEqual(
        artifacts.singleAttemptAnalysis.summary.accuracy,
        0.75,
        'fallback artifacts 不应复用陈旧 canonical analysis；应按最新 input 重建'
    );
    assert.strictEqual(
        artifacts.singleAttemptAnalysis.radar.byQuestionKind[0].kind,
        'single_choice',
        'fallback artifacts 的题型维度应来自最新 input.questionTypePerformance'
    );
}

function testPracticeRecorderFallbackArtifactsRebuildAnalysisFromInput() {
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };
    const sandbox = {
        console: quietConsole,
        window: {
            console: quietConsole
        },
        Date,
        Math,
        JSON,
        Map,
        Set,
        Promise
    };
    sandbox.globalThis = sandbox.window;

    loadScript('js/core/practiceRecorder.js', vm.createContext(sandbox));
    const PracticeRecorder = sandbox.window.PracticeRecorder;
    const recorderLike = Object.create(PracticeRecorder.prototype);
    recorderLike.getPracticeCoreContracts = () => null;
    recorderLike.getPracticeCoreAnalysis = () => null;

    const artifacts = recorderLike.buildSingleAttemptAnalysisArtifacts({
        examId: 'reading-stale-analysis-recorder',
        type: 'reading',
        metadata: {
            type: 'reading',
            examType: 'reading',
            dataQuality: { confidence: 0.8 }
        },
        totalQuestions: 4,
        correctAnswers: 1,
        accuracy: 0.25,
        questionTypePerformance: {
            unknown: { total: 4, correct: 1, accuracy: 0.25 }
        },
        singleAttemptAnalysis: {
            summary: {
                accuracy: 0.1,
                durationSec: 9,
                unansweredRate: 0.5,
                changedAnswerRate: 0.5
            },
            radar: {
                byQuestionKind: [{ kind: 'unknown', total: 4, correct: 0, accuracy: 0, confidence: 0.2 }],
                byPassageCategory: []
            },
            diagnosis: [{ reason: 'stale' }],
            nextActions: [{ instruction: 'stale' }],
            confidence: 0.2
        }
    }, {
        totalQuestions: 4,
        correctAnswers: 3,
        accuracy: 0.75,
        durationSec: 90,
        questionTypePerformance: {
            single_choice: { total: 4, correct: 3, accuracy: 0.75, confidence: 0.8 }
        },
        analysisSignals: {
            unansweredCount: 0,
            changedAnswerCount: 1,
            interactionDensity: 3
        }
    });

    assert.strictEqual(
        artifacts.singleAttemptAnalysis.summary.accuracy,
        0.75,
        'PracticeRecorder fallback artifacts 不应复用陈旧 canonical analysis；应按最新 input 重建'
    );
    assert.strictEqual(
        artifacts.singleAttemptAnalysis.radar.byQuestionKind[0].kind,
        'single_choice',
        'PracticeRecorder fallback artifacts 的题型维度应来自最新 input.questionTypePerformance'
    );
}

async function main() {
    try {
        await testDeleteRecordPersistsAndCleansLegacyKeys();
        await testClearPracticeDataPersistsAndClearsLegacyKeys();
        await testDeleteRecordForcesUiRefreshWhenPracticeCoreAlreadySyncedState();
        testScoreStorageDurationPrefersTimelineWhenConflict();
        testScoreStorageDurationRejectsRawFallbackWithoutTimeline();
        testScoreStorageAnalysisInputCanonicalization();
        testScoreStorageNormalizeRecordBackfillsAnalysisInputForLegacyRecord();
        testScoreStorageNormalizeRecordRebuildsLegacyAnalysisShape();
        testScoreStorageFallbackInputCarriesSignalsAndTimeline();
        testScoreStorageFallbackArtifactsRebuildAnalysisFromInput();
        testPracticeRecorderFallbackArtifactsRebuildAnalysisFromInput();
        console.log(JSON.stringify({
            status: 'pass',
            detail: 'deleteRecord / clearPracticeData 已覆盖 canonical store、legacy shadow key 与删除后的强制 UI 刷新链路'
        }, null, 2));
    } catch (error) {
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message
        }, null, 2));
        process.exit(1);
    }
}

main();
