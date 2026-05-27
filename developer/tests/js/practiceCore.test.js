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

function createRepositoryHarness() {
    const practiceState = [];
    const metaState = new Map();

    return {
        repositories: {
            practice: {
                async list() {
                    return practiceState.map((record) => JSON.parse(JSON.stringify(record)));
                },
                async overwrite(records) {
                    practiceState.splice(0, practiceState.length, ...records.map((record) => JSON.parse(JSON.stringify(record))));
                    return true;
                },
                async upsert(record) {
                    const clone = JSON.parse(JSON.stringify(record));
                    const index = practiceState.findIndex((entry) => entry && String(entry.id) === String(clone.id));
                    if (index >= 0) {
                        practiceState[index] = clone;
                    } else {
                        practiceState.unshift(clone);
                    }
                    return clone;
                }
            },
            meta: {
                async get(key, fallback = null) {
                    return metaState.has(key)
                        ? JSON.parse(JSON.stringify(metaState.get(key)))
                        : JSON.parse(JSON.stringify(fallback));
                },
                async set(key, value) {
                    metaState.set(key, JSON.parse(JSON.stringify(value)));
                    return true;
                },
                async remove(key) {
                    metaState.delete(key);
                    return true;
                }
            }
        },
        practiceState,
        metaState
    };
}

const results = [];

function recordResult(name, passed, detail) {
    results.push({ name, passed, detail, timestamp: new Date().toISOString() });
}

async function testProtocolNormalization(PracticeCore) {
    const normalized = PracticeCore.protocol.normalizeMessage({
        type: 'practice_completed',
        data: { examId: 'reading-p1' },
        source: 'practice_page'
    });

    assert(normalized, '消息应被正确解析');
    assert.strictEqual(normalized.type, 'PRACTICE_COMPLETE', '消息类型应折叠为 PRACTICE_COMPLETE');
    assert.strictEqual(PracticeCore.protocol.normalizeMessageType('request_init'), 'REQUEST_INIT', 'REQUEST_INIT 别名应归一');
    recordResult('PracticeCore 协议归一化', true, normalized);
}

async function testCompletionIngestion(PracticeCore) {
    const record = PracticeCore.ingestor.fromCompletion({
        type: 'practice_complete',
        data: {
            examId: 'reading-p1',
            sessionId: 'session-reading-p1',
            title: 'Passage 1',
            duration: 1800,
            answers: { 1: 'A', 2: 'B' },
            correctAnswers: { 1: 'A', 2: 'C' },
            scoreInfo: { correct: 1, total: 2, accuracy: 0.5, percentage: 50 },
            metadata: { category: 'P1', frequency: 'high', type: 'reading' }
        }
    }, {
        examId: 'reading-p1',
        metadata: { examTitle: 'Passage 1', category: 'P1', frequency: 'high', type: 'reading' }
    }, {
        id: 'reading-p1',
        title: 'Passage 1',
        category: 'P1',
        frequency: 'high',
        type: 'reading'
    });

    assert(record, '完成负载应成功转换为记录');
    assert.strictEqual(record.examId, 'reading-p1');
    assert.strictEqual(record.type, 'reading');
    assert.strictEqual(record.totalQuestions, 2);
    assert.strictEqual(record.correctAnswers, 1);
    assert.strictEqual(record.answers.length, 2);
    assert.strictEqual(record.correctAnswerMap.q1, 'A');
    assert.strictEqual(record.metadata.category, 'P1');
    recordResult('PracticeCore 完成负载入站', true, { id: record.id, metadata: record.metadata });
}

async function testPracticeRecordApiWritePath(sandbox, PracticeCore, practiceState, metaState) {
    assert.strictEqual(typeof PracticeCore.store.savePracticeRecord, 'undefined', '公开 PracticeCore.store 不能暴露记录写入口');
    assert.strictEqual(typeof PracticeCore.store.replacePracticeRecords, 'undefined', '公开 PracticeCore.store 不能暴露批量替换入口');
    assert.strictEqual(typeof PracticeCore.store.writeMeta, 'undefined', '公开 PracticeCore.store 不能暴露 meta 写入口');
    assert.strictEqual(typeof PracticeCore.store.routeStorageSet, 'undefined', '公开 PracticeCore.store 不能暴露 storage 写路由');
    assert.strictEqual(typeof PracticeCore.__installRecordAPI, 'undefined', 'PracticeRecordAPI 初始化后必须删除内部 store 安装钩子');
    const api = sandbox.window.PracticeRecordAPI;

    const first = await api.saveRecord({
        id: 'record-reading-p1',
        examId: 'reading-p1',
        sessionId: 'session-reading-p1',
        title: 'Passage 1',
        type: 'reading',
        date: new Date().toISOString(),
        score: 1,
        totalQuestions: 2,
        correctAnswers: 1,
        accuracy: 0.5,
        answers: { q1: 'A', q2: 'B' },
        correctAnswerMap: { q1: 'A', q2: 'C' },
        metadata: { examTitle: 'Passage 1', category: 'P1', frequency: 'high', type: 'reading' }
    }, { maxRecords: 1000 });

    const second = await api.saveRecord({
        id: 'record-reading-p1-retry',
        examId: 'reading-p1',
        sessionId: 'session-reading-p1',
        title: 'Passage 1 retry',
        type: 'reading',
        date: new Date().toISOString(),
        score: 2,
        totalQuestions: 2,
        correctAnswers: 2,
        accuracy: 1,
        answers: { q1: 'A', q2: 'C' },
        correctAnswerMap: { q1: 'A', q2: 'C' },
        metadata: { examTitle: 'Passage 1 retry', category: 'P1', frequency: 'high', type: 'reading' }
    }, { maxRecords: 1000 });

    assert(first, '第一次保存应成功');
    assert(second, '第二次保存应成功');
    assert.strictEqual(practiceState.length, 1, '相同 sessionId 的记录应只保留一条');
    assert.strictEqual(practiceState[0].id, 'record-reading-p1-retry', '应保留最新记录');

    await api.writeStats({ totalPractices: 1 });
    assert.strictEqual(metaState.get('user_stats').totalPractices, 1, 'user_stats 应走统一 PracticeRecordAPI 写路径');

    recordResult('PracticeRecordAPI 统一写路径', true, {
        savedRecordId: practiceState[0].id,
        totalRecords: practiceState.length
    });
}

async function testPracticeRecordApiContract(sandbox, PracticeCore, practiceState, metaState) {
    const api = sandbox.window.PracticeRecordAPI;
    assert(api, 'PracticeRecordAPI 应挂载到 window');
    assert.strictEqual(typeof api.saveCompletion, 'function', 'PracticeRecordAPI 应提供 saveCompletion');
    assert.strictEqual(typeof api.getById, 'function', 'PracticeRecordAPI 应提供 getById');
    assert.strictEqual(typeof api.toSummaryMetrics, 'function', 'PracticeRecordAPI 应提供 toSummaryMetrics');

    const saved = await api.saveCompletion({
        type: 'PRACTICE_COMPLETE',
        data: {
            examId: 'reading-p2',
            sessionId: 'session-reading-p2',
            title: 'Passage 2',
            duration: 900,
            answers: { q1: 'TRUE', q2: 'FALSE' },
            correctAnswerMap: { q1: 'TRUE', q2: 'NOT GIVEN' },
            answerComparison: {
                q1: { userAnswer: 'TRUE', correctAnswer: 'TRUE', isCorrect: true },
                q2: { userAnswer: 'FALSE', correctAnswer: 'NOT GIVEN', isCorrect: false }
            },
            scoreInfo: { correct: 1, total: 2, accuracy: 0.5, percentage: 50 },
            metadata: { category: 'P2', frequency: 'high', type: 'reading' }
        }
    }, {
        examId: 'reading-p2',
        metadata: { examTitle: 'Passage 2', category: 'P2', frequency: 'high', type: 'reading' }
    }, {
        id: 'reading-p2',
        title: 'Passage 2',
        category: 'P2',
        frequency: 'high',
        type: 'reading'
    }, { currentVersion: '1.0.0', maxRecords: 1000 });

    assert(saved, 'saveCompletion 应返回已保存记录');
    assert.strictEqual(saved.examId, 'reading-p2');
    assert.strictEqual(saved.correctAnswerMap.q2, 'NOT GIVEN');
    assert.strictEqual(saved.answerComparison.q2.isCorrect, false);
    assert.strictEqual(practiceState[0].id, saved.id, 'saveCompletion 应写入统一 PracticeCore store');

    const hit = await api.getById(saved.id);
    assert(hit, 'getById 应能按 record id 找回记录');
    assert.strictEqual(hit.sessionId, 'session-reading-p2');

    const sessionHit = await api.getById('session-reading-p2');
    assert(sessionHit, 'getById 应能按 sessionId 找回记录');
    assert.strictEqual(sessionHit.id, saved.id);

    const metrics = api.toSummaryMetrics({ accuracy: 0.75, totalQuestions: 4, correctAnswers: 3 });
    assert.strictEqual(metrics.percentage, 75, 'summary metrics 应从 0..1 accuracy 推导 percentage');
    const importedMetrics = api.toSummaryMetrics({ accuracy: 85, totalQuestions: 20, correctAnswers: 17 });
    assert.strictEqual(importedMetrics.accuracy, 0.85, 'summary metrics 应把 0..100 accuracy 归一到 0..1');

    await api.replace([
        {
            id: 'record-delete-a',
            examId: 'reading-delete-a',
            sessionId: 'session-delete-a',
            title: 'Delete A',
            type: 'reading',
            score: 1,
            totalQuestions: 1,
            correctAnswers: 1,
            accuracy: 1
        },
        {
            id: 'record-delete-b',
            examId: 'reading-delete-b',
            sessionId: 'session-delete-b',
            title: 'Delete B',
            type: 'reading',
            score: 0,
            totalQuestions: 1,
            correctAnswers: 0,
            accuracy: 0
        }
    ], { maxRecords: 1000 });
    assert.strictEqual(practiceState.length, 2, 'replace 应写入统一 PracticeCore store');

    const deletedBySession = await api.deleteMany(['session-delete-a'], { maxRecords: 1000, updateStats: true });
    assert.strictEqual(deletedBySession.deletedCount, 1, 'deleteMany 应支持按 sessionId 删除');
    assert.deepStrictEqual(
        practiceState.map((record) => record.id),
        ['record-delete-b'],
        'deleteMany 应通过统一 replace 更新 canonical store'
    );
    assert.strictEqual(metaState.get('user_stats').totalPractices, 1, 'deleteMany(updateStats) 后统计应按剩余 canonical 记录重算');

    const deletedById = await api.deleteById('record-delete-b', { maxRecords: 1000, updateStats: true });
    assert.strictEqual(deletedById.deleted, true, 'deleteById 应支持按 record id 删除');
    assert.strictEqual(practiceState.length, 0, 'deleteById 删除后 canonical store 应为空');
    assert.strictEqual(metaState.get('user_stats').totalPractices, 0, 'deleteById(updateStats) 删除最后一条后统计应归零');

    await api.saveRecord({
        id: 'record-clear-a',
        examId: 'reading-clear-a',
        sessionId: 'session-clear-a',
        title: 'Clear A',
        type: 'reading',
        score: 1,
        totalQuestions: 1,
        correctAnswers: 1,
        accuracy: 1
    }, { maxRecords: 1000 });
    assert.strictEqual(practiceState.length, 1, 'saveRecord 应在 clear 前写入记录');
    await api.clear({ maxRecords: 1000, updateStats: true });
    assert.strictEqual(practiceState.length, 0, 'clear 应清空 canonical store');
    assert.strictEqual(metaState.get('user_stats').totalPractices, 0, 'clear(updateStats) 后统计应归零');

    recordResult('PracticeRecordAPI 统一记录门面', true, {
        savedRecordId: saved.id,
        metrics
    });
}

async function testPracticeRecordApiStatsIdempotency(sandbox, practiceState, metaState) {
    const api = sandbox.window.PracticeRecordAPI;
    let recalculateCalls = 0;
    sandbox.window.scoreStorage = {
        get currentVersion() {
            throw new Error('PracticeRecordAPI must not read scoreStorage.currentVersion');
        },
        get maxRecords() {
            throw new Error('PracticeRecordAPI must not read scoreStorage.maxRecords');
        },
        async recalculateUserStats() {
            recalculateCalls += 1;
            throw new Error('PracticeRecordAPI must not delegate stats to scoreStorage');
        }
    };

    await api.clear({ maxRecords: 1000 });
    await api.writeStats({
        totalPractices: 0,
        totalTimeSpent: 0,
        averageScore: 0
    });

    const payload = {
        type: 'PRACTICE_COMPLETE',
        data: {
            examId: 'reading-idempotent',
            sessionId: 'session-idempotent',
            title: 'Idempotent Passage',
            duration: 300,
            answers: { q1: 'A', q2: 'B' },
            correctAnswerMap: { q1: 'A', q2: 'C' },
            scoreInfo: { correct: 1, total: 2, accuracy: 0.5, percentage: 50 },
            metadata: { category: 'P1', frequency: 'high', type: 'reading' }
        }
    };
    const context = {
        examId: 'reading-idempotent',
        sessionId: 'session-idempotent',
        metadata: { examTitle: 'Idempotent Passage', category: 'P1', frequency: 'high', type: 'reading' }
    };
    const examEntry = {
        id: 'reading-idempotent',
        title: 'Idempotent Passage',
        category: 'P1',
        frequency: 'high',
        type: 'reading'
    };

    await api.saveCompletion(payload, context, examEntry, { currentVersion: '1.0.0', maxRecords: 1000, updateStats: true });
    await api.saveCompletion(payload, context, examEntry, { currentVersion: '1.0.0', maxRecords: 1000, updateStats: true });

    assert.strictEqual(practiceState.length, 1, '重复 completion 只能保留一条 canonical 记录');
    const stats = metaState.get('user_stats');
    assert(stats, '重复 completion 后应写入 user_stats');
    assert.strictEqual(stats.totalPractices, 1, '重复 completion 不能让 user_stats.totalPractices 翻倍');
    assert.strictEqual(stats.totalTimeSpent, 300, '重复 completion 不能让 user_stats.totalTimeSpent 翻倍');
    assert.strictEqual(stats.averageScore, 0.5, '重复 completion 后平均分应基于唯一 canonical 记录');
    assert.strictEqual(recalculateCalls, 0, 'PracticeRecordAPI 不应调用 scoreStorage.recalculateUserStats');

    delete sandbox.window.scoreStorage;
    recordResult('PracticeRecordAPI 统计幂等', true, {
        totalRecords: practiceState.length,
        totalPractices: stats.totalPractices
    });
}

async function testNumericCorrectAnswersRemainScoreCount(PracticeCore) {
    const standardized = PracticeCore.contracts.standardizeRecord({
        id: 'record-numeric-correct-answers',
        examId: 'reading-numeric-correct-answers',
        sessionId: 'session-numeric-correct-answers',
        title: 'Numeric Correct Answers',
        type: 'reading',
        date: '2026-05-24T00:00:00.000Z',
        score: 7,
        totalQuestions: 10,
        correctAnswers: 7,
        answers: { q1: 'A', q2: 'B' },
        realData: {
            answers: { q1: 'A', q2: 'B' },
            correctAnswers: 7
        }
    }, {
        currentVersion: '1.0.0',
        generateRecordId: () => 'record-generated-should-not-be-used'
    });

    assert.strictEqual(standardized.correctAnswers, 7, 'top-level correctAnswers 数字应表示答对数量');
    assert(standardized.realData, 'standardizeRecord 应保留 realData');
    assert.strictEqual(typeof standardized.realData.correctAnswers, 'object', 'realData.correctAnswers 只能是答案表对象');
    assert(!Array.isArray(standardized.realData.correctAnswers), 'realData.correctAnswers 不能是数组');
    assert.strictEqual(
        Object.keys(standardized.realData.correctAnswers).length,
        0,
        'numeric realData.correctAnswers 不能被伪造成正确答案表'
    );

    recordResult('PracticeCore numeric correctAnswers 契约', true, {
        correctAnswers: standardized.correctAnswers,
        realDataCorrectAnswerKeys: Object.keys(standardized.realData.correctAnswers)
    });
}

async function testObjectCorrectAnswersBecomeCorrectAnswerMap(PracticeCore) {
    const standardized = PracticeCore.contracts.standardizeRecord({
        id: 'record-object-correct-answers',
        examId: 'reading-object-correct-answers',
        sessionId: 'session-object-correct-answers',
        title: 'Object Correct Answers',
        type: 'reading',
        date: '2026-05-24T00:00:00.000Z',
        totalQuestions: 2,
        answers: { 1: 'A', 2: 'B' },
        correctAnswers: { 1: 'A', 2: 'C' },
        metadata: { examTitle: 'Object Correct Answers', category: 'P1', frequency: 'low', type: 'reading' }
    }, {
        currentVersion: '1.0.0',
        generateRecordId: () => 'record-generated-should-not-be-used'
    });

    assert.strictEqual(standardized.correctAnswers, 1, '对象型 correctAnswers 应作为答案表推导答对数量');
    assert.strictEqual(standardized.correctAnswerMap.q1, 'A', '对象型 correctAnswers 应迁移到 correctAnswerMap');
    assert.strictEqual(standardized.correctAnswerMap.q2, 'C', '对象型 correctAnswers 不应丢失后续题目');
    assert.strictEqual(standardized.answers.length, 2, '答案列表应带正确答案表一起归一化');
    assert.strictEqual(standardized.answers[1].correctAnswer, 'C', 'answerList 应保留正确答案');

    recordResult('PracticeCore object correctAnswers 兼容答案表', true, {
        correctAnswers: standardized.correctAnswers,
        correctAnswerMap: standardized.correctAnswerMap
    });
}

async function testSuiteEntryCorrectAnswerMapSurvives(PracticeCore) {
    const standardized = PracticeCore.contracts.standardizeRecord({
        id: 'record-suite-entry-correct-map',
        examId: 'suite-parent',
        sessionId: 'session-suite-entry-correct-map',
        title: 'Suite Parent',
        type: 'reading',
        date: '2026-05-24T00:00:00.000Z',
        suiteMode: true,
        suiteSessionId: 'suite-correct-map',
        suiteEntries: [
            {
                examId: 'reading-p1',
                title: 'Passage 1',
                answers: { 1: 'A', 2: 'B' },
                correctAnswers: { 1: 'A', 2: 'C' },
                scoreInfo: { correct: 1, total: 2, accuracy: 0.5 }
            }
        ],
        metadata: { examTitle: 'Suite Parent', category: 'suite', frequency: 'suite', type: 'reading' }
    }, {
        currentVersion: '1.0.0',
        generateRecordId: () => 'record-generated-should-not-be-used'
    });

    const entry = standardized.suiteEntries[0];
    assert(entry, 'suite entry 应存在');
    assert.strictEqual(entry.correctAnswerMap.q1, 'A', 'suite entry 应保留对象型 correctAnswers');
    assert.strictEqual(entry.correctAnswerMap.q2, 'C', 'suite entry correctAnswerMap 不应丢失');

    recordResult('PracticeCore suite entry correctAnswerMap 保留', true, {
        correctAnswerMap: entry.correctAnswerMap
    });
}

async function testCanonicalCorrectAnswerMapWinsOverLegacyObjects(PracticeCore) {
    const standardized = PracticeCore.contracts.standardizeRecord({
        id: 'record-canonical-correct-map',
        examId: 'reading-canonical-correct-map',
        sessionId: 'session-canonical-correct-map',
        title: 'Canonical Correct Map',
        type: 'reading',
        date: '2026-05-24T00:00:00.000Z',
        totalQuestions: 2,
        answers: { q1: 'A', q2: 'B' },
        correctAnswerMap: { q1: 'A', q2: 'D' },
        correctAnswers: { q1: 'B', q2: 'C' },
        realData: {
            answers: { q1: 'A', q2: 'B' },
            correctAnswerMap: { q2: 'D' },
            correctAnswers: { q1: 'B', q2: 'C' }
        },
        metadata: { examTitle: 'Canonical Correct Map', category: 'P1', frequency: 'low', type: 'reading' }
    }, {
        currentVersion: '1.0.0',
        generateRecordId: () => 'record-generated-should-not-be-used'
    });

    assert.strictEqual(standardized.correctAnswerMap.q1, 'A', 'canonical correctAnswerMap 不能被 legacy correctAnswers 覆盖');
    assert.strictEqual(standardized.correctAnswerMap.q2, 'D', 'canonical correctAnswerMap 后续题目也不能被 legacy correctAnswers 覆盖');
    assert.strictEqual(standardized.realData.correctAnswers.q1, 'A', 'realData.correctAnswers 应镜像 canonical correctAnswerMap');
    assert.strictEqual(standardized.realData.correctAnswerMap.q2, 'D', 'realData.correctAnswerMap 应镜像 canonical correctAnswerMap');
    assert.strictEqual(standardized.correctAnswers, 1, '答对数量应基于 canonical correctAnswerMap 计算');

    recordResult('PracticeCore canonical correctAnswerMap 优先级', true, {
        correctAnswerMap: standardized.correctAnswerMap,
        correctAnswers: standardized.correctAnswers
    });
}

async function testSuiteEntryDerivesCorrectAnswerMapFromComparison(PracticeCore) {
    const standardized = PracticeCore.contracts.standardizeRecord({
        id: 'record-suite-entry-derived-map',
        examId: 'suite-parent-derived',
        sessionId: 'session-suite-entry-derived-map',
        title: 'Suite Parent Derived',
        type: 'reading',
        date: '2026-05-24T00:00:00.000Z',
        suiteMode: true,
        suiteSessionId: 'suite-derived-map',
        suiteEntries: [
            {
                examId: 'reading-p2',
                title: 'Passage 2',
                answers: { q1: 'A', q2: 'B' },
                answerComparison: {
                    q1: { userAnswer: 'A', correctAnswer: 'A', isCorrect: true },
                    q2: { userAnswer: 'B', correctAnswer: 'C', isCorrect: false }
                }
            },
            {
                examId: 'reading-p3',
                title: 'Passage 3',
                answers: { q1: 'TRUE' },
                realData: {
                    correctAnswerMap: { q1: 'FALSE' }
                }
            }
        ],
        metadata: { examTitle: 'Suite Parent Derived', category: 'suite', frequency: 'suite', type: 'reading' }
    }, {
        currentVersion: '1.0.0',
        generateRecordId: () => 'record-generated-should-not-be-used'
    });

    assert.strictEqual(standardized.suiteEntries[0].correctAnswerMap.q1, 'A', 'suite entry 应能从 answerComparison 派生正确答案');
    assert.strictEqual(standardized.suiteEntries[0].correctAnswerMap.q2, 'C', 'suite entry 派生 correctAnswerMap 不应漏后续题目');
    assert.strictEqual(standardized.suiteEntries[1].correctAnswerMap.q1, 'FALSE', 'suite entry 应读取 realData.correctAnswerMap');

    recordResult('PracticeCore suite entry 派生 correctAnswerMap', true, {
        firstEntry: standardized.suiteEntries[0].correctAnswerMap,
        secondEntry: standardized.suiteEntries[1].correctAnswerMap
    });
}

async function testReplayResultSnapshotCanonicalOnly(PracticeCore) {
    const replay = PracticeCore.contracts.buildReplayResultSnapshot({
        answers: { q1: 'A', q2: 'D' },
        correctAnswerMap: { q1: 'A', q2: 'D' },
        correctAnswers: { q1: 'B', q2: 'C' },
        answerComparison: {
            q1: { userAnswer: 'A', correctAnswer: 'B', isCorrect: false },
            q2: { userAnswer: 'D', correctAnswer: 'C', isCorrect: false }
        },
        scoreInfo: { correct: 0, total: 2, accuracy: 0, percentage: 0 },
        realData: {
            correctAnswerMap: { q2: 'D' },
            correctAnswers: { q1: 'B', q2: 'C' }
        }
    });

    assert.strictEqual(replay.correctAnswers.q1, 'A', 'replay 应以 canonical correctAnswerMap 为唯一正确答案表');
    assert.strictEqual(replay.correctAnswers.q2, 'D', 'realData canonical map 只能补缺，不能被 legacy 覆盖');
    assert.strictEqual(replay.correctAnswerMap.q2, 'D', 'replay 应同时输出 canonical correctAnswerMap 别名');
    assert.strictEqual(replay.answerComparison.q1.correctAnswer, 'A', 'comparison 正确答案必须按 canonical map 重建');
    assert.strictEqual(replay.answerComparison.q2.correctAnswer, 'D', 'comparison 后续题目也必须按 canonical map 重建');
    assert.strictEqual(replay.answerComparison.q1.isCorrect, true, 'isCorrect 必须按 canonical map 重算');
    assert.strictEqual(replay.scoreInfo.correct, 2, '完整 canonical map 时必须重算正确数');
    assert.strictEqual(replay.scoreInfo.total, 2, '完整 canonical map 时必须重算总题数');
    assert.strictEqual(replay.scoreInfo.percentage, 100, '完整 canonical map 时必须重算百分比');

    recordResult('PracticeCore replay canonical correctAnswerMap 契约', true, {
        correctAnswerMap: replay.correctAnswerMap,
        scoreInfo: replay.scoreInfo
    });
}

async function testReplayResultSnapshotRefusesLegacyCorrectAnswerFallback(PracticeCore) {
    const replay = PracticeCore.contracts.buildReplayResultSnapshot({
        answers: { q1: 'A' },
        correctAnswers: 7,
        answerComparison: {
            q1: { userAnswer: 'A', correctAnswer: 'B', isCorrect: false }
        },
        scoreInfo: { correct: 5, total: 7, accuracy: 5 / 7, percentage: 71 }
    });

    assert.strictEqual(Object.keys(replay.correctAnswers).length, 0, '数字型 correctAnswers 不能被当成 replay 答案表');
    assert.strictEqual(replay.answerComparison.q1.correctAnswer, '', 'comparison.correctAnswer 不能作为 replay 正确答案 fallback');
    assert.strictEqual(replay.answerComparison.q1.isCorrect, null, '缺 canonical map 时不能猜测 isCorrect');
    assert.strictEqual(replay.scoreInfo.correct, 5, '缺 canonical map 时保留来源分数');
    assert.strictEqual(replay.scoreInfo.total, 7, '缺 canonical map 时保留来源总题数');

    recordResult('PracticeCore replay 拒绝 legacy 正确答案兜底', true, {
        correctAnswers: replay.correctAnswers,
        scoreInfo: replay.scoreInfo
    });
}

async function testReplayResultSnapshotSuitePrefixedKeys(PracticeCore) {
    const replay = PracticeCore.contracts.buildReplayResultSnapshot({
        answers: {
            q1: 'A',
            'reading-p1::q17': 'B'
        },
        correctAnswerMap: {
            q1: 'A',
            'reading-p1::q17': 'C'
        },
        allQuestionIds: ['q1', 'reading-p1::q17']
    });

    assert.strictEqual(replay.answers.q1, 'A', '普通 q1 应保留');
    assert.strictEqual(replay.answers.q17, 'B', 'suite 前缀题号应只取 :: 后的问题段');
    assert.strictEqual(Object.keys(replay.answers).length, 2, 'suite 前缀题号不能和 q1 撞键');
    assert.strictEqual(replay.answerComparison.q17.correctAnswer, 'C', 'suite 前缀正确答案应归一到 q17');
    assert.strictEqual(replay.scoreInfo.total, 2, 'suite 前缀题号应计入总题数');

    recordResult('PracticeCore replay suite 前缀题号归一', true, {
        answers: replay.answers,
        correctAnswerMap: replay.correctAnswerMap
    });
}

async function main() {
    const { repositories, practiceState, metaState } = createRepositoryHarness();

    const windowStub = {
        console,
        practiceRecords: []
    };

    const sandbox = {
        window: windowStub,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math,
        JSON
    };
    sandbox.globalThis = sandbox.window;

    const context = vm.createContext(sandbox);
    loadScript('js/core/practiceCore.js', context);
    sandbox.window.PracticeCore.__installInternalRepositories(repositories);
    loadScript('js/core/practiceRecordAPI.js', context);
    loadScript('js/core/practiceStore.js', context);
    const PracticeCore = sandbox.window.PracticeCore;

    try {
        await testProtocolNormalization(PracticeCore);
        await testCompletionIngestion(PracticeCore);
        await testPracticeRecordApiWritePath(sandbox, PracticeCore, practiceState, metaState);
        await testPracticeRecordApiContract(sandbox, PracticeCore, practiceState, metaState);
        await testPracticeRecordApiStatsIdempotency(sandbox, practiceState, metaState);
        await testNumericCorrectAnswersRemainScoreCount(PracticeCore);
        await testObjectCorrectAnswersBecomeCorrectAnswerMap(PracticeCore);
        await testSuiteEntryCorrectAnswerMapSurvives(PracticeCore);
        await testCanonicalCorrectAnswerMapWinsOverLegacyObjects(PracticeCore);
        await testSuiteEntryDerivesCorrectAnswerMapFromComparison(PracticeCore);
        await testReplayResultSnapshotCanonicalOnly(PracticeCore);
        await testReplayResultSnapshotRefusesLegacyCorrectAnswerFallback(PracticeCore);
        await testReplayResultSnapshotSuitePrefixedKeys(PracticeCore);

        const summary = {
            status: 'pass',
            detail: `${results.length}/${results.length} 测试通过`,
            passed: results.length,
            total: results.length
        };
        console.log(JSON.stringify(summary, null, 2));
    } catch (error) {
        recordResult('PracticeCore 测试执行失败', false, { error: error.message });
        console.log(JSON.stringify({
            status: 'fail',
            detail: error.message,
            results
        }, null, 2));
        process.exit(1);
    }
}

main();
