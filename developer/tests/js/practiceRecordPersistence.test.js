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
    const listeners = new Map();
    const savedSpellingErrors = [];
    const savedHighlightWords = [];
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
        getExamIndexState() {
            return [
                {
                    id: 'listening-p1-fallback',
                    title: 'Fallback Listening P1',
                    type: 'listening',
                    category: 'P1',
                    frequency: 'high',
                    path: 'P1/高频/Fallback Listening P1/'
                }
            ];
        },
        syncPracticeRecords() {},
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
            location: { origin: 'http://localhost', href: 'http://localhost/' },
            fallbackExamSessions: new Map(),
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
            VocabStore: {
                async upsertReadingHighlightWord(payload) {
                    savedHighlightWords.push({ ...(payload || {}) });
                    return { word: payload && payload.word ? payload.word : 'saved-word' };
                }
            },
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
    sandbox.window.getExamIndexState = sandbox.getExamIndexState;
    sandbox.window.syncPracticeRecords = sandbox.syncPracticeRecords;
    sandbox.fallbackExamSessions = sandbox.window.fallbackExamSessions;

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
        savedSpellingErrors,
        savedHighlightWords,
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

async function testFallbackCompletionPersistsNormalizedSpellingErrors() {
    const harness = createHarness();
    const childWindow = { closed: false, postMessage() {} };
    harness.sandbox.window.fallbackExamSessions.set('parent-session-1', {
        examId: 'listening-p1-fallback',
        sessionId: 'parent-session-1',
        win: childWindow,
        initPayload: {
            examId: 'listening-p1-fallback',
            sessionId: 'parent-session-1'
        },
        timer: null
    });

    harness.sandbox.setupMessageListener();
    await harness.sandbox.window.__dispatchWindowEvent('message', {
        origin: 'http://localhost',
        source: childWindow,
        data: {
            type: 'PRACTICE_COMPLETE',
            realData: {
                examId: 'listening-unknown',
                sessionId: 'child-temp-session',
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

async function testFallbackVocabHighlightRequiresKnownWindow() {
    const harness = createHarness();
    const childWindow = { closed: false, postMessage() {} };
    const unknownWindow = { closed: false, postMessage() {} };

    harness.sandbox.window.fallbackExamSessions.set('known-session', {
        examId: 'listening-p1-fallback',
        sessionId: 'known-session',
        win: childWindow,
        initPayload: {
            examId: 'listening-p1-fallback',
            sessionId: 'known-session'
        },
        timer: null
    });

    harness.sandbox.setupMessageListener();
    await harness.sandbox.window.__dispatchWindowEvent('message', {
        origin: 'http://localhost',
        source: unknownWindow,
        data: {
            type: 'VOCAB_HIGHLIGHT_SAVE',
            data: { word: 'untrusted' }
        }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(
        harness.savedHighlightWords.length,
        0,
        'unknown same-origin windows must not be able to save highlighted vocab'
    );

    await harness.sandbox.window.__dispatchWindowEvent('message', {
        origin: 'http://localhost',
        source: childWindow,
        data: {
            type: 'VOCAB_HIGHLIGHT_SAVE',
            data: { word: 'trusted' }
        }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepStrictEqual(
        harness.savedHighlightWords,
        [{ word: 'trusted' }],
        'registered fallback windows may save highlighted vocab'
    );
}

async function testFallbackCompletionRejectsKnownSessionFromWrongWindow() {
    const harness = createHarness();
    const childWindow = { closed: false, postMessage() {} };
    const unknownWindow = { closed: false, postMessage() {} };

    harness.sandbox.window.fallbackExamSessions.set('known-session', {
        examId: 'listening-p1-fallback',
        sessionId: 'known-session',
        win: childWindow,
        initPayload: {
            examId: 'listening-p1-fallback',
            sessionId: 'known-session'
        },
        timer: null
    });

    harness.sandbox.setupMessageListener();
    await harness.sandbox.window.__dispatchWindowEvent('message', {
        origin: 'http://localhost',
        source: unknownWindow,
        data: {
            type: 'PRACTICE_COMPLETE',
            data: {
                examId: 'listening-p1-fallback',
                sessionId: 'known-session',
                scoreInfo: {
                    correct: 1,
                    total: 1,
                    percentage: 100
                }
            }
        }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(
        harness.practiceState.some((record) => record && record.examId === 'listening-p1-fallback'),
        false,
        'same-origin windows must not save fallback completions for sessions owned by another window'
    );
    assert.strictEqual(
        harness.sandbox.window.fallbackExamSessions.has('known-session'),
        true,
        'rejected fallback completion must not clear the legitimate session'
    );
}

async function testFallbackCompletionRejectsUnknownWindowSideEffects() {
    const harness = createHarness();
    const unknownWindow = { closed: false, postMessage() {} };
    const beforeIds = harness.practiceState.map((record) => record.id);

    harness.sandbox.setupMessageListener();
    await harness.sandbox.window.__dispatchWindowEvent('message', {
        origin: 'http://localhost',
        source: unknownWindow,
        data: {
            type: 'PRACTICE_COMPLETE',
            data: {
                examId: 'listening-p1-fallback',
                sessionId: 'unknown-session',
                scoreInfo: {
                    correct: 1,
                    total: 1,
                    percentage: 100
                }
            }
        }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepStrictEqual(
        harness.practiceState.map((record) => record.id),
        beforeIds,
        'unknown same-origin windows must not create fallback practice records'
    );
    assert.deepStrictEqual(
        harness.messageLog,
        [],
        'unknown same-origin completion messages must not trigger completion notifications'
    );
}

async function main() {
    try {
        await testDeleteRecordPersistsAndCleansLegacyKeys();
        await testClearPracticeDataPersistsAndClearsLegacyKeys();
        await testDeleteRecordForcesUiRefreshWhenPracticeCoreAlreadySyncedState();
        await testFallbackCompletionPersistsNormalizedSpellingErrors();
        await testFallbackVocabHighlightRequiresKnownWindow();
        await testFallbackCompletionRejectsKnownSessionFromWrongWindow();
        await testFallbackCompletionRejectsUnknownWindowSideEffects();
        console.log(JSON.stringify({
            status: 'pass',
            detail: 'practice record persistence and fallback message trust are covered'
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
