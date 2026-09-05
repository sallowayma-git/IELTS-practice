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

function createHarness(options = {}) {
    const {
        saveCompletionImpl = null,
        forceCompletionNotice = false
    } = options;
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
    const interruptedState = [{
        id: 'interrupted-session-1',
        sessionId: 'session-1',
        examId: 'reading-p1-interrupted',
        endTime: '2026-03-09T11:30:00.000Z',
        status: 'interrupted',
        metadata: { examTitle: 'Interrupted Record 1' }
    }];
    const listeners = new Map();
    const savedSpellingErrors = [];
    const renderedSnapshots = [];
    const browseSnapshots = [];
    const examIndex = [{
        id: 'listening-p1-fallback',
        title: 'Listening P1 Fallback',
        category: 'P1',
        path: 'assets/generated/listening-exams/listening-p1-fallback.html',
        frequency: 'fallback',
        type: 'listening'
    }];
    const quietConsole = {
        log() {},
        warn() {},
        error() {},
        info() {},
        debug() {}
    };

    const messageLog = [];
    const deleteCommands = [];
    const deleteManyCommands = [];
    const clearCommands = [];
    const completionCommands = [];
    const discardInterruptedCommands = [];

    const sandbox = {
        console: quietConsole,
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
        getSelectedRecordsState() {
            return new Set();
        },
        clearSelectedRecordsState() {},
        setBulkDeleteModeState() {},
        refreshBulkDeleteButton() {},
        refreshBrowseProgressFromRecords(records, index) {
            browseSnapshots.push({ records: structuredClone(records), index: structuredClone(index) });
        },
        updatePracticeView(records, index, interruptedRecords) {
            renderedSnapshots.push({
                records: structuredClone(records),
                index: structuredClone(index),
                interruptedRecords: structuredClone(interruptedRecords || [])
            });
        },
        normalizeRecordId(id) {
            return id == null ? '' : String(id);
        },
        async resolveActiveLibraryIndex() {
            return structuredClone(examIndex);
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
            location: options.location || {
                origin: 'http://localhost',
                protocol: 'http:'
            },
            addEventListener(type, handler) {
                if (!listeners.has(type)) {
                    listeners.set(type, []);
                }
                listeners.get(type).push(handler);
            },
            async __dispatchWindowEvent(type, event) {
                const handlers = listeners.get(type) || [];
                for (const handler of handlers) {
                    await handler(event);
                }
            },
            spellingErrorCollector: {
                detectSource(value) {
                    const text = String(value || '').toLowerCase();
                    return text.includes('p1') ? 'p1' : (text.includes('p4') ? 'p4' : 'other');
                },
                async saveErrors(errors) {
                    savedSpellingErrors.push(...errors.map((error) => ({ ...error })));
                    return true;
                }
            },
            AppData: {
                ready: Promise.resolve(),
                practice: {
                    async list() {
                        return structuredClone(practiceState);
                    },
                    async listInsights() {
                        return structuredClone(practiceState);
                    },
                    async get(recordId) {
                        const target = String(recordId || '');
                        const record = practiceState.find((item) => item && (
                            String(item.id || '') === target || String(item.sessionId || '') === target
                        ));
                        return structuredClone(record || null);
                    },
                    async delete(command = {}) {
                        deleteCommands.push(structuredClone(command));
                        const index = practiceState.findIndex((record) => String(record.id) === String(command.recordId));
                        if (index >= 0) practiceState.splice(index, 1);
                        return {
                            committed: true,
                            revision: deleteCommands.length,
                            operationId: command.operationId || `delete-${deleteCommands.length}`,
                            derived: { status: 'ready', pending: [] },
                            warnings: []
                        };
                    },
                    async deleteMany(command = {}) {
                        deleteManyCommands.push(structuredClone(command));
                        const ids = new Set((command.recordIds || []).map(String));
                        for (let index = practiceState.length - 1; index >= 0; index -= 1) {
                            if (ids.has(String(practiceState[index].id))) practiceState.splice(index, 1);
                        }
                        return {
                            committed: true,
                            revision: deleteManyCommands.length,
                            operationId: command.operationId || `delete-many-${deleteManyCommands.length}`,
                            derived: { status: 'ready', pending: [] },
                            warnings: []
                        };
                    },
                    async clear(command = {}) {
                        clearCommands.push(structuredClone(command));
                        practiceState.splice(0, practiceState.length);
                        return {
                            committed: true,
                            revision: clearCommands.length,
                            operationId: command.operationId || `clear-${clearCommands.length}`,
                            derived: { status: 'ready', pending: [] },
                            warnings: []
                        };
                    },
                    async completeAttempt(command = {}) {
                        completionCommands.push(structuredClone(command));
                        if (typeof saveCompletionImpl === 'function') {
                            return await saveCompletionImpl(command);
                        }
                        const input = command.record && typeof command.record === 'object'
                            ? structuredClone(command.record)
                            : {};
                        const record = {
                            ...input,
                            id: input.id || `record-${practiceState.length + 1}`,
                            examId: input.examId || '',
                            sessionId: input.sessionId || '',
                            title: input.title || '',
                            endTime: input.endTime || input.date || '2026-03-09T12:00:00.000Z',
                            date: input.endTime || input.date || '2026-03-09T12:00:00.000Z'
                        };
                        practiceState.unshift(structuredClone(record));
                        return {
                            committed: true,
                            revision: completionCommands.length,
                            operationId: command.operationId || `completion-${completionCommands.length}`,
                            derived: { status: 'ready', pending: [] },
                            warnings: [],
                            record: structuredClone(record)
                        };
                    }
                },
                recovery: {
                    async listInterrupted() {
                        return structuredClone(interruptedState);
                    },
                    async getInterrupted(recordId) {
                        return structuredClone(interruptedState.find((record) => String(record.id) === String(recordId)) || null);
                    },
                    async discardInterrupted(recordId) {
                        discardInterruptedCommands.push(String(recordId));
                        const index = interruptedState.findIndex((record) => String(record.id) === String(recordId));
                        if (index >= 0) interruptedState.splice(index, 1);
                        return { committed: true };
                    },
                    async clear() {
                        interruptedState.splice(0, interruptedState.length);
                        return { committed: true };
                    }
                },
                settings: {
                    async reset() {
                        return {
                            committed: true,
                            revision: 1,
                            operationId: 'settings-reset',
                            derived: { status: 'ready', pending: [] },
                            warnings: []
                        };
                    }
                }
            }
        }
    };

    sandbox.globalThis = sandbox.window;
    sandbox.fallbackExamSessions = new Map();
    sandbox.window.fallbackExamSessions = sandbox.fallbackExamSessions;
    sandbox.window.resolveActiveLibraryIndex = sandbox.resolveActiveLibraryIndex;

    loadScript('js/main.js', vm.createContext(sandbox));
    if (forceCompletionNotice) {
        sandbox.shouldAnnounceCompletion = () => true;
    }
    sandbox.updatePracticeView = function updatePracticeViewSpy(records, index, interruptedRecords) {
        renderedSnapshots.push({
            records: structuredClone(records),
            index: structuredClone(index),
            interruptedRecords: structuredClone(interruptedRecords || [])
        });
    };
    sandbox.refreshBrowseProgressFromRecords = function refreshBrowseProgressFromRecordsSpy(records, index) {
        browseSnapshots.push({ records: structuredClone(records), index: structuredClone(index) });
    };
    sandbox.window.updatePracticeView = sandbox.updatePracticeView;
    sandbox.window.refreshBrowseProgressFromRecords = sandbox.refreshBrowseProgressFromRecords;

    return {
        sandbox,
        practiceState,
        interruptedState,
        examIndex,
        renderedSnapshots,
        browseSnapshots,
        deleteCommands,
        deleteManyCommands,
        clearCommands,
        completionCommands,
        discardInterruptedCommands,
        messageLog,
        savedSpellingErrors
    };
}

async function testDeleteRecordCommitsAndRefreshesCanonicalSnapshot() {
    const harness = createHarness();

    await harness.sandbox.deleteRecord('record-1');

    assert.deepStrictEqual(
        harness.practiceState.map((record) => record.id),
        ['record-2'],
        'deleteRecord 应删除 canonical store 中的目标记录'
    );
    assert.deepStrictEqual(
        harness.deleteCommands[0],
        { recordId: 'record-1' },
        'deleteRecord 应通过 AppData.practice.delete 提交目标 identity'
    );
    assert.deepStrictEqual(
        harness.renderedSnapshots.at(-1).records.map((record) => record.id),
        ['record-2'],
        'deleteRecord 后应以 AppData 回读结果刷新练习视图'
    );
    assert.deepStrictEqual(
        harness.browseSnapshots.at(-1).records.map((record) => record.id),
        ['record-2'],
        'deleteRecord 后应以同一 AppData 快照重建浏览完成索引'
    );
    assert.deepStrictEqual(harness.renderedSnapshots.at(-1).index, harness.examIndex, '练习视图应接收活动题库快照');
    assert.deepStrictEqual(harness.browseSnapshots.at(-1).index, harness.examIndex, '浏览索引应接收同一活动题库快照');
}

async function testDeleteInterruptedRecordUsesRecoveryStoreAndRefreshesHistoryOnly() {
    const harness = createHarness();

    await harness.sandbox.deleteRecord('interrupted-session-1', { recordKind: 'interrupted' });

    assert.deepStrictEqual(harness.discardInterruptedCommands, ['interrupted-session-1']);
    assert.deepStrictEqual(harness.interruptedState, [], '删除中断记录必须清理 recovery，而不是 canonical practice');
    assert.strictEqual(harness.deleteCommands.length, 0, '删除中断记录不能误删正式练习成绩');
    assert.deepStrictEqual(
        harness.practiceState.map((record) => record.id),
        ['record-1', 'record-2'],
        '正式练习记录必须保持不变'
    );
    assert.deepStrictEqual(
        harness.renderedSnapshots.at(-1).interruptedRecords,
        [],
        '删除后刷新必须从 recovery 回读，确保中断条目立即消失'
    );
    assert.deepStrictEqual(
        harness.browseSnapshots.at(-1).records.map((record) => record.id),
        ['record-1', 'record-2'],
        '中断记录的删除不能改变 Browse 完成投影'
    );
}

async function testClearPracticeDataCommitsAndRefreshesCanonicalSnapshot() {
    const harness = createHarness();

    await harness.sandbox.clearPracticeData();

    assert.strictEqual(harness.practiceState.length, 0, 'clearPracticeData 应清空 canonical store');
    assert.strictEqual(harness.clearCommands.length, 1, 'clearPracticeData 应通过 AppData.practice.clear 写入 tombstone');
    assert.deepStrictEqual(harness.renderedSnapshots.at(-1).records, [], 'clearPracticeData 后练习视图应接收空快照');
    assert.deepStrictEqual(harness.browseSnapshots.at(-1).records, [], 'clearPracticeData 后浏览完成索引应接收空快照');
}

async function testFallbackCompletionPersistsNormalizedSpellingErrors() {
    const harness = createHarness({
        forceCompletionNotice: true,
        location: { origin: 'file://', protocol: 'file:' }
    });
    const outcomes = [];
    const targetOrigins = [];
    const childWindow = {
        closed: false,
        postMessage(message, targetOrigin) {
            outcomes.push(message);
            targetOrigins.push(targetOrigin);
        }
    };
    harness.sandbox.window.fallbackExamSessions.set('parent-session-1', {
        examId: 'listening-p1-fallback',
        sessionId: 'parent-session-1',
        win: childWindow,
        windowSessionToken: 'fallback-token-1',
        initPayload: {
            examId: 'listening-p1-fallback',
            sessionId: 'parent-session-1'
        },
        timer: null
    });

    harness.sandbox.setupMessageListener();
    await harness.sandbox.window.__dispatchWindowEvent('message', {
        origin: 'null',
        source: childWindow,
        data: {
            type: 'REQUEST_INIT',
            source: 'listening_record_bridge',
            data: {
                examId: 'listening-p1-fallback',
                sessionId: 'child-temp-session'
            }
        }
    });
    const initMessage = outcomes.find((message) => message && message.type === 'INIT_SESSION');
    assert(initMessage, 'file fallback REQUEST_INIT must receive INIT_SESSION');
    assert.strictEqual(initMessage.data.parentOrigin, 'null', 'file fallback must declare opaque null origin');
    assert(targetOrigins.every((origin) => origin === '*'), 'file fallback INIT must use wildcard targetOrigin');

    await harness.sandbox.window.__dispatchWindowEvent('message', {
        origin: 'null',
        source: childWindow,
        data: {
            type: 'PRACTICE_COMPLETE',
            source: 'listening_record_bridge',
            windowSessionToken: 'fallback-token-1',
            realData: {
                examId: 'listening-unknown',
                sessionId: 'child-temp-session',
                submissionId: 'listening-submit-fallback-1',
                type: 'listening',
                practiceType: 'listening',
                answers: { q1: 'acommodatio' },
                correctAnswers: { q1: 'accommodation' },
                answerComparison: {
                    q1: {
                        userAnswer: 'acommodatio',
                        correctAnswer: 'accommodation',
                        isCorrect: false
                    }
                },
                scoreInfo: {
                    correct: 0,
                    total: 1,
                    accuracy: 0,
                    percentage: 0,
                    source: 'listening_record_bridge'
                },
                spellingErrors: [
                    {
                        word: 'accommodation',
                        userInput: 'acommodatio',
                        questionId: 'q1',
                        examId: 'listening-unknown',
                        source: 'other'
                    }
                ]
            }
        }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const savedRecord = harness.practiceState.find((record) => record && record.examId === 'listening-p1-fallback');
    assert(savedRecord, 'fallback PRACTICE_COMPLETE 应保存父页题源练习记录');
    assert.strictEqual(savedRecord.sessionId, 'parent-session-1', 'fallback 记录 sessionId 应归一到父页会话');
    const acknowledgement = outcomes.find((message) => message && message.type === 'PRACTICE_SUBMIT_ACK');
    assert(acknowledgement, 'fallback 持久化成功后必须回传 PRACTICE_SUBMIT_ACK');
    assert.strictEqual(acknowledgement.data.submissionId, 'listening-submit-fallback-1');
    assert.strictEqual(acknowledgement.data.sessionId, 'parent-session-1');
    assert.strictEqual(acknowledgement.data.windowSessionToken, 'fallback-token-1');
    assert(targetOrigins.every((origin) => origin === '*'), 'file fallback ACK must use wildcard targetOrigin');

    assert.strictEqual(harness.savedSpellingErrors.length, 1, 'fallback 应保存 bridge 带回的 spellingErrors');
    assert.deepStrictEqual(
        harness.savedSpellingErrors[0],
        {
            word: 'accommodation',
            userInput: 'acommodatio',
            questionId: 'q1',
            examId: 'listening-p1-fallback',
            source: 'p1',
            sessionId: 'parent-session-1'
        },
        'fallback 错词必须归一 examId/source/sessionId，不能落到 listening-unknown/other'
    );
}

async function testCanonicalCompletionSaveRejectsWhenPersistenceFails() {
    const harness = createHarness({
        saveCompletionImpl: async () => {
            throw new Error('save failed');
        }
    });
    await assert.rejects(
        () => harness.sandbox.savePracticeCompletionRecord('listening-p1-fallback', {
            examId: 'listening-p1-fallback',
            sessionId: 'child-temp-session-fail',
            type: 'listening',
            practiceType: 'listening',
            answers: { q1: 'A' },
            correctAnswers: { q1: 'A' },
            answerComparison: {
                q1: {
                    userAnswer: 'A',
                    correctAnswer: 'A',
                    isCorrect: true
                }
            },
            scoreInfo: {
                correct: 1,
                total: 1,
                accuracy: 1,
                percentage: 100,
                source: 'listening_record_bridge'
            }
        }),
        /save failed/,
        'canonical 持久化失败时 savePracticeCompletionRecord 必须向上抛错，供上层停止成功提示'
    );
    assert.strictEqual(
        harness.practiceState.some((record) => record.examId === 'listening-p1-fallback' && record.id !== 'record-1' && record.id !== 'record-2'),
        false,
        '保存失败时不能偷偷留下半成品记录'
    );
}

async function testSubmissionIdProducesStableCompletionOperationId() {
    const harness = createHarness();
    const payload = {
        examId: 'listening-p1-fallback',
        sessionId: 'session-stable-submit',
        submissionId: 'submission-stable-submit',
        type: 'listening',
        scoreInfo: { correct: 1, total: 1, accuracy: 1, percentage: 100 }
    };
    await harness.sandbox.savePracticeCompletionRecord(payload.examId, payload);
    await harness.sandbox.savePracticeCompletionRecord(payload.examId, payload);
    assert.strictEqual(harness.completionCommands.length, 2);
    assert.strictEqual(
        harness.completionCommands[0].operationId,
        'practice-complete:listening-p1-fallback:session-stable-submit:submission-stable-submit'
    );
    assert.strictEqual(
        harness.completionCommands[1].operationId,
        harness.completionCommands[0].operationId,
        'retrying the same submission must reuse the canonical idempotency operationId'
    );
}

async function main() {
    try {
        await testDeleteRecordCommitsAndRefreshesCanonicalSnapshot();
        await testDeleteInterruptedRecordUsesRecoveryStoreAndRefreshesHistoryOnly();
        await testClearPracticeDataCommitsAndRefreshesCanonicalSnapshot();
        await testFallbackCompletionPersistsNormalizedSpellingErrors();
        await testCanonicalCompletionSaveRejectsWhenPersistenceFails();
        await testSubmissionIdProducesStableCompletionOperationId();
        console.log(JSON.stringify({
            status: 'pass',
            detail: 'practice record persistence and fallback completion regressions are covered'
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
