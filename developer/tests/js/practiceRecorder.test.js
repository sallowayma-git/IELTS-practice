#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deferred() {
    let resolve;
    const promise = new Promise((complete) => { resolve = complete; });
    return { promise, resolve };
}

function loadScript(relativePath, context) {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'), context, { filename: relativePath });
}

function createHarness({ now = null } = {}) {
    const state = {
        records: [],
        drafts: [{
            id: 'reading-draft:reading-p2',
            kind: 'reading_draft',
            examId: 'reading-p2',
            sessionId: 'reading-session',
            answers: { q1: 'A' },
            updatedAt: '2026-07-26T00:00:00.000Z'
        }],
        commands: [],
        backupCalls: [],
        activeCheckpoints: new Map(),
        interruptedRecords: [],
        discardedInterruptedIds: [],
        discardedSessionIds: [],
        intervals: new Set(),
        events: [],
        eventListeners: new Map(),
        failCompleteAttempts: 0
    };
    const quietConsole = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
    const appData = {
        ready: Promise.resolve(),
        practice: {
            async completeAttempt(command) {
                state.commands.push(clone(command));
                if (state.failCompleteAttempts > 0) {
                    state.failCompleteAttempts -= 1;
                    const error = new Error('transient write failure');
                    error.code = 'IO';
                    throw error;
                }
                const existing = state.records.find((record) => record.id === command.record.id);
                if (existing) return { committed: true, operationId: command.operationId, revision: 1, record: clone(existing) };
                const record = clone(command.record);
                state.records.unshift(record);
                return { committed: true, operationId: command.operationId, revision: 1, record: clone(record) };
            },
            async get(id) {
                return clone(state.records.find((record) => record.id === id) || null);
            },
            async list() {
                return clone(state.records);
            },
            async getStats() {
                return { totalPractices: state.records.length, totalTimeSpent: 600, averageScore: 0.5 };
            }
        },
        recovery: {
            async saveActiveSession(session) {
                state.activeCheckpoints.set(session.id, clone(session));
                return { committed: true };
            },
            async discardActiveSession(id) {
                state.discardedSessionIds.push(id);
                state.activeCheckpoints.delete(id);
                return { committed: true };
            },
            async saveInterrupted(record) {
                state.interruptedRecords.push(clone(record));
                return { committed: true };
            },
            async listInterrupted() {
                return clone(state.interruptedRecords);
            },
            async discardInterrupted(id) {
                state.discardedInterruptedIds.push(id);
                state.interruptedRecords = state.interruptedRecords.filter((record) => record.id !== id);
                return { committed: true };
            },
            async listDrafts() {
                return clone(state.drafts);
            },
            async saveDraft(value) {
                const draft = { ...clone(value), updatedAt: '2026-07-26T01:00:00.000Z' };
                const index = state.drafts.findIndex((entry) => entry.id === draft.id);
                if (index >= 0) state.drafts[index] = draft;
                else state.drafts.push(draft);
                return { committed: true, item: clone(draft) };
            },
            async discardDraft(id) {
                state.drafts = state.drafts.filter((entry) => entry.id !== id);
                return { committed: true };
            }
        },
        backups: {
            async export(options) {
                state.backupCalls.push({ method: 'export', options: clone(options) });
                return {
                    format: 'ielts-atlas-data-v2',
                    schemaVersion: 2,
                    scope: 'partial',
                    envelopes: {},
                    entities: {
                        practiceSummaries: state.records.map((record) => ({
                            recordId: record.id,
                            revision: 1,
                            operationId: 'export',
                            updatedAt: '2026-07-26T00:00:00.000Z',
                            data: clone(record),
                            checksum: `sum-${record.id}`
                        })),
                        practiceDetails: [],
                        practiceAnnotations: []
                    },
                    checksum: 'snapshot-checksum'
                };
            },
            async create(options) {
                state.backupCalls.push({ method: 'create', options: clone(options) });
                return { id: options.id || 'backup-before-import' };
            },
            async previewImport(payload, options) {
                state.backupCalls.push({ method: 'previewImport', payload: clone(payload), options: clone(options) });
                const format = payload && payload.format === 'ielts-atlas-data-v2' ? 'v2' : 'v1';
                return {
                    id: 'import-plan-1',
                    format,
                    keys: [],
                    practice: { accepted: 1, importedCount: 1, skippedCount: 0 }
                };
            },
            async commitImport(id, options) {
                state.backupCalls.push({ method: 'commitImport', id, options: clone(options) });
                return {
                    committed: true,
                    operationId: options.operationId || 'import-operation',
                    revisions: { 'practiceSummaries/legacy-import': 1 },
                    importedCount: 1,
                    practice: { accepted: 1, importedCount: 1, skippedCount: 0 }
                };
            },
            async recordImport(entry) {
                state.backupCalls.push({ method: 'recordImport', entry: clone(entry) });
                return { committed: true };
            },
            async restore(id) {
                state.backupCalls.push({ method: 'restore', id });
                return { committed: true, operationId: `restore:${id}` };
            },
            async list() {
                return [{ id: 'backup-before-import' }];
            }
        }
    };
    const windowStub = {
        console: quietConsole,
        AppData: appData,
        resolveActiveLibraryIndex: async () => [{ id: 'reading-p1', title: 'Passage 1', type: 'reading', category: 'P1', frequency: 'high' }]
    };
    const sandbox = {
        window: windowStub,
        console: quietConsole,
        setTimeout,
        clearTimeout,
        setInterval() {
            const timer = Symbol('session listener');
            state.intervals.add(timer);
            return timer;
        },
        clearInterval(timer) {
            state.intervals.delete(timer);
        },
        navigator: { userAgent: 'PracticeRecorder test' },
        screen: { width: 1280, height: 720 },
        CustomEvent: class {
            constructor(type, options) {
                this.type = type;
                this.detail = options.detail;
            }
        },
        document: {
            addEventListener(type, listener) {
                const listeners = state.eventListeners.get(type) || [];
                listeners.push(listener);
                state.eventListeners.set(type, listeners);
            },
            dispatchEvent(event) {
                state.events.push({ type: event.type, detail: clone(event.detail) });
                for (const listener of state.eventListeners.get(event.type) || []) listener(event);
            }
        },
        Date: now === null ? Date : class extends Date {
            constructor(...args) {
                super(...(args.length ? args : [now]));
            }
            static now() { return now; }
        },
        Math,
        JSON
    };
    sandbox.globalThis = windowStub;
    const context = vm.createContext(sandbox);
    loadScript('js/core/practiceCore.js', context);
    loadScript('js/core/practiceRecorder.js', context);
    const recorder = Object.create(windowStub.PracticeRecorder.prototype);
    recorder.activeSessions = new Map();
    recorder.sessionListeners = new Map();
    recorder.sessionStartGenerations = new WeakMap();
    recorder.wait = async () => {};
    return { recorder, state, windowStub, document: sandbox.document };
}

function makeRecord(id = 'record-v2') {
    return {
        id,
        examId: 'reading-p1',
        sessionId: `session-${id}`,
        title: 'Passage 1',
        type: 'reading',
        date: '2026-07-26',
        startTime: '2026-07-26T00:00:00.000Z',
        endTime: '2026-07-26T00:10:00.000Z',
        duration: 600,
        score: 1,
        totalQuestions: 2,
        correctAnswers: 1,
        accuracy: 0.5,
        answers: { q1: 'A', q2: 'B' },
        correctAnswerMap: { q1: 'A', q2: 'C' },
        realData: {
            questionTypeMap: { q1: 'true-false-not-given' },
            interactions: [{ type: 'answer', questionId: 'q1' }]
        },
        metadata: { examId: 'reading-p1', examTitle: 'Passage 1', category: 'P1', frequency: 'high', type: 'reading' }
    };
}

async function main() {
    const results = [];
    const record = async (name, test) => {
        await test();
        results.push({ name, status: 'pass' });
    };

    try {
        await record('save separates business id from per-call operation id', async () => {
            const { recorder, state } = createHarness();
            const saved = await recorder.savePracticeRecord(makeRecord());
            assert.strictEqual(saved.id, 'record-v2');
            assert.strictEqual(state.records.length, 1);
            assert.strictEqual(state.commands.length, 1);
            assert.notStrictEqual(state.commands[0].operationId, 'record-v2');
            assert(String(state.commands[0].operationId).startsWith('practice-complete_'));
            assert.deepStrictEqual(clone(state.commands[0].record.answers), { q1: 'A', q2: 'B' });
            assert(Array.isArray(state.commands[0].record.answerList));
            assert.deepStrictEqual(clone(state.commands[0].record.answerList.map((item) => item.questionId)), ['q1', 'q2']);
            assert.deepStrictEqual(clone(state.commands[0].record.questionTypeMap), { q1: 'true-false-not-given' });
            assert.deepStrictEqual(clone(state.commands[0].record.interactions), [{ type: 'answer', questionId: 'q1' }]);
            assert.deepStrictEqual(clone(saved.correctAnswerMap), { q1: 'A', q2: 'C' });
            await recorder.savePracticeRecord({ ...makeRecord(), title: 'Updated title' });
            assert.notStrictEqual(
                state.commands[1].operationId,
                state.commands[0].operationId,
                'a second logical save of the same record must receive a new operation id'
            );
        });

        await record('internal retries reuse one operation id', async () => {
            const { recorder, state } = createHarness();
            state.failCompleteAttempts = 1;
            const saved = await recorder.savePracticeRecord(makeRecord('record-retry'));
            assert.strictEqual(saved.id, 'record-retry');
            assert.strictEqual(state.commands.length, 2);
            assert.strictEqual(state.commands[0].operationId, state.commands[1].operationId);
        });

        await record('global message listener never persists PRACTICE_COMPLETE alongside the host', async () => {
            const { recorder } = createHarness();
            let completionCalls = 0;
            recorder.handleSessionCompleted = async () => { completionCalls += 1; };
            recorder.handleExamMessage({
                data: {
                    type: 'PRACTICE_COMPLETE',
                    data: { examId: 'reading-p1', results: { scoreInfo: { correct: 1, total: 1 } } }
                }
            });
            assert.strictEqual(completionCalls, 0, 'host-owned completion must not be saved through the recorder global listener');
        });

        await record('restore and autosave isolate recorder sessions from suite recovery', async () => {
            const { recorder, windowStub } = createHarness();
            const savedSessions = [];
            windowStub.AppData.recovery.listActiveSessions = async () => clone([
                {
                    schema: 'suite-session-v2',
                    id: 'suite-owner',
                    sessionId: 'suite-owner',
                    examId: 'reading-suite-host'
                },
                {
                    id: 'active-session:ordinary-session',
                    sessionId: 'ordinary-session',
                    examId: 'reading-p1',
                    updatedAt: '2026-08-09T00:01:00.000Z'
                }
            ]);
            windowStub.AppData.recovery.saveActiveSession = async (session) => {
                savedSessions.push(clone(session));
                return { committed: true };
            };
            recorder.activeSessions = new Map();

            await recorder.restoreActiveSessions();

            assert.deepStrictEqual(
                Array.from(recorder.activeSessions.keys()),
                ['reading-p1']
            );
            assert.strictEqual(recorder.activeSessions.get('reading-p1').status, 'restored');

            await recorder.saveActiveSessions();

            assert.deepStrictEqual(
                savedSessions.map((session) => session.id),
                ['active-session:ordinary-session']
            );
            assert(savedSessions.every((session) => session.schema !== 'suite-session-v2'),
                'autosave must not clone suite recovery entities');
        });

        await record('temporary recovery draft does not overwrite reading drafts', async () => {
            const { recorder, state } = createHarness();
            await recorder.saveToTemporaryStorage(makeRecord('record-recovery'));
            assert(state.drafts.some((draft) => draft.id === 'reading-draft:reading-p2'));
            assert(state.drafts.some((draft) => draft.id === 'practice-record:record-recovery' && draft.kind === 'practice_record_recovery'));

            const recovered = [];
            recorder.savePracticeRecord = async (value) => {
                recovered.push(clone(value));
                return value;
            };
            await recorder.recoverTemporaryRecords();
            assert.strictEqual(recovered.length, 1);
            assert.strictEqual(recovered[0].id, 'record-recovery');
            assert.deepStrictEqual(state.drafts.map((draft) => draft.id), ['reading-draft:reading-p2']);
        });

        for (const scenario of [
            { name: 'launch type with an unknown ready page', launch: { type: 'LISTENING' }, ready: { metadata: { type: 'practice', pageType: 'suite-placeholder' } }, expected: 'listening' },
            { name: 'unified listening ready page', launch: {}, ready: { metadata: { type: 'unknown', pageType: 'unified-listening' } }, expected: 'listening' },
            { name: 'unified reading ready page', launch: {}, ready: { metadata: { pageType: 'unified-reading' } }, expected: 'reading' },
            { name: 'known launch examType behind an unknown type', launch: { type: 'unknown', examType: 'reading' }, ready: { metadata: { pageType: 'practice' } }, expected: 'reading' }
        ]) {
            await record(`timeout retains ${scenario.name} without the source library`, async () => {
                const now = Date.parse('2026-09-07T12:00:00.000Z');
                const { recorder, state, windowStub } = createHarness({ now });
                const examId = 'opaque-shared-exam';
                let libraryReads = 0;
                windowStub.resolveActiveLibraryIndex = async () => {
                    libraryReads += 1;
                    return [{ id: examId, type: scenario.expected === 'reading' ? 'listening' : 'reading' }];
                };
                const session = recorder.startPracticeSession(examId, {
                    ...scenario.launch,
                    sessionId: 'typed-attempt',
                    title: 'Original library title',
                    libraryConfigurationId: 'removed-library'
                });
                recorder.handleSessionStarted({ ...scenario.ready, examId, sessionId: session.sessionId });
                recorder.handleSessionProgress({ examId, progress: { currentQuestion: 2 }, answers: { q1: 'B' } });
                await recorder.saveActiveSessions();
                assert.strictEqual(session.type, scenario.expected);
                assert.strictEqual(session.metadata.type, scenario.expected);
                assert.strictEqual(state.activeCheckpoints.get(session.id).type, scenario.expected);
                windowStub.resolveActiveLibraryIndex = async () => {
                    libraryReads += 1;
                    return [];
                };

                let ending;
                const endPracticeSession = recorder.endPracticeSession.bind(recorder);
                recorder.endPracticeSession = (...args) => {
                    ending = endPracticeSession(...args);
                    return ending;
                };
                session.lastActivity = new Date(now - 31 * 60 * 1000).toISOString();
                recorder.checkSessionActivity(examId);
                assert(ending, 'the original timeout path must run');
                assert.strictEqual(await ending, true);

                const saved = state.interruptedRecords[0];
                assert.strictEqual(saved.type, scenario.expected);
                assert.strictEqual(saved.metadata.type, scenario.expected);
                assert.strictEqual(saved.metadata.libraryConfigurationId, 'removed-library');
                assert.strictEqual(saved.metadata.examTitle, 'Original library title');
                assert.deepStrictEqual(saved.answers, { q1: 'B' });
                assert.strictEqual(libraryReads, 0, 'attempt type must come from the session, independent of the active library');
            });
        }

        for (const pageType of ['unified-reading', 'listening']) {
            await record(`host-only ${pageType} handshake preserves type in interruption`, async () => {
                const { recorder, state, windowStub } = createHarness();
                windowStub.resolveActiveLibraryIndex = async () => [];
                const examId = 'host-only-opaque-id';
                recorder.handleSessionStarted({
                    examId,
                    sessionId: 'host-created-attempt',
                    metadata: { pageType, libraryConfigurationId: 'inactive-library', examTitle: 'Host title' }
                });
                const session = recorder.activeSessions.get(examId);
                await recorder.saveActiveSessions();
                const expected = pageType === 'unified-reading' ? 'reading' : 'listening';
                assert.strictEqual(session.type, expected);
                assert.strictEqual(session.metadata.type, expected);
                assert.strictEqual(session.metadata.pageType, pageType);
                assert.strictEqual(state.activeCheckpoints.get(session.id).metadata.type, expected);
                assert.strictEqual(await recorder.endPracticeSession(examId, 'timeout'), true);
                assert.strictEqual(state.interruptedRecords[0].type, expected);
                assert.strictEqual(state.interruptedRecords[0].metadata.type, expected);
                assert.strictEqual(state.interruptedRecords[0].metadata.libraryConfigurationId, 'inactive-library');
            });
        }

        await record('JSON export is a catalog-governed v2 practice snapshot', async () => {
            const { recorder, state } = createHarness();
            state.records.push(makeRecord('record-export'));
            const exported = JSON.parse(await recorder.exportData('json'));
            assert.strictEqual(exported.format, 'ielts-atlas-data-v2');
            assert.strictEqual(exported.schemaVersion, 2);
            assert(Array.isArray(exported.entities.practiceSummaries));
            assert.strictEqual(Object.prototype.hasOwnProperty.call(exported, 'practiceRecords'), false);
            assert.strictEqual(Object.prototype.hasOwnProperty.call(exported, 'userStats'), false);
            assert.deepStrictEqual(state.backupCalls[0], { method: 'export', options: { domains: ['practice'] } });
        });

        await record('import preview and commit stay inside AppData.backups', async () => {
            const { recorder, state } = createHarness();
            const result = await recorder.importData({ practice_records: [makeRecord('legacy-import')] }, {
                merge: false,
                operationId: 'import-practice-v2'
            });
            assert.strictEqual(result.committed, true);
            assert.strictEqual(result.backupId, 'backup-before-import');
            const previewCall = state.backupCalls.find((call) => call.method === 'previewImport');
            assert(previewCall);
            assert.strictEqual(previewCall.options.practiceMode, 'replace');
            assert.strictEqual(previewCall.payload.practice_records[0].id, 'legacy-import');
            const commitCall = state.backupCalls.find((call) => call.method === 'commitImport' && call.id === 'import-plan-1');
            assert(commitCall);
            assert.strictEqual(commitCall.options.confirmDestructive, true);
            assert(state.backupCalls.some((call) => call.method === 'recordImport'));
            assert.deepStrictEqual(
                state.backupCalls.slice(0, 3).map((call) => call.method),
                ['previewImport', 'create', 'commitImport'],
                'validation must complete before a retention-limited safety backup is created'
            );
        });

        await record('invalid import does not consume a backup retention slot', async () => {
            const { recorder, state, windowStub } = createHarness();
            windowStub.AppData.backups.previewImport = async () => {
                state.backupCalls.push({ method: 'previewImport' });
                const error = new Error('invalid import');
                error.code = 'VALIDATION';
                throw error;
            };
            await assert.rejects(() => recorder.importData({ broken: true }), { code: 'VALIDATION' });
            assert.deepStrictEqual(state.backupCalls.map((call) => call.method), ['previewImport']);
        });

        for (const mode of ['replacement', 'identity rebind', 'same-id replacement', 'same-id identity rebind']) {
            await record(`delayed interrupted save preserves the session after ${mode}`, async () => {
                const { recorder, state, windowStub } = createHarness({ now: Date.parse('2026-09-05T00:00:00.000Z') });
                const examId = 'reading-p1';
                const original = recorder.startPracticeSession(examId, {
                    sessionId: 'session-A', type: 'listening', title: 'Original listening title', libraryConfigurationId: 'original-library'
                });
                recorder.handleSessionStarted({ examId, sessionId: 'session-A', metadata: { pageType: 'unified-listening' } });
                recorder.handleSessionProgress({
                    examId,
                    progress: { currentQuestion: 4 },
                    answers: { q1: 'A' }
                });
                await recorder.saveActiveSessions();
                const originalStatus = original.status;
                const originalActivity = original.lastActivity;

                const saveGate = deferred();
                const saveInterrupted = windowStub.AppData.recovery.saveInterrupted;
                windowStub.AppData.recovery.saveInterrupted = async (value) => {
                    await saveGate.promise;
                    return saveInterrupted(value);
                };
                const ending = recorder.endPracticeSession(examId, 'timeout');
                assert.strictEqual(state.interruptedRecords.length, 0);

                const sessionId = mode.startsWith('same-id') ? 'session-A' : 'session-B';
                if (mode.endsWith('identity rebind')) {
                    recorder.handleSessionStarted({ examId, sessionId, metadata: {
                        pageType: 'unified-reading', examTitle: 'Replacement reading title', libraryConfigurationId: 'replacement-library'
                    } });
                    assert.strictEqual(recorder.activeSessions.get(examId), original);
                } else {
                    recorder.startPracticeSession(examId, {
                        sessionId, type: 'reading', title: 'Replacement reading title', libraryConfigurationId: 'replacement-library'
                    });
                    assert.notStrictEqual(recorder.activeSessions.get(examId), original);
                }
                const replacement = recorder.activeSessions.get(examId);
                const listener = recorder.sessionListeners.get(examId);
                if (mode === 'same-id identity rebind') {
                    assert.strictEqual(replacement.sessionId, 'session-A');
                    assert.strictEqual(replacement.status, originalStatus);
                    assert.strictEqual(replacement.lastActivity, originalActivity,
                        'a restart must supersede cleanup even within the same clock tick');
                } else {
                    recorder.handleSessionProgress({
                        examId,
                        progress: { currentQuestion: 5 },
                        answers: { q1: 'B' }
                    });
                }
                await recorder.saveActiveSessions();
                const checkpoint = clone(state.activeCheckpoints.get(replacement.id));
                assert.strictEqual(checkpoint.sessionId, sessionId);

                saveGate.resolve();
                assert.strictEqual(await ending, true);

                assert.strictEqual(state.interruptedRecords.length, 1);
                assert.strictEqual(state.interruptedRecords[0].sessionId, 'session-A');
                assert.strictEqual(state.interruptedRecords[0].reason, 'timeout');
                assert.strictEqual(state.interruptedRecords[0].type, 'listening');
                assert.strictEqual(state.interruptedRecords[0].metadata.type, 'listening');
                assert.strictEqual(state.interruptedRecords[0].metadata.examTitle, 'Original listening title');
                assert.strictEqual(state.interruptedRecords[0].metadata.libraryConfigurationId, 'original-library');
                assert.strictEqual(replacement.type, 'reading');
                assert.strictEqual(replacement.metadata.type, 'reading');
                assert.strictEqual(replacement.metadata.libraryConfigurationId, 'replacement-library');
                assert.strictEqual(state.interruptedRecords[0].progress.currentQuestion, 4);
                assert.deepStrictEqual(state.interruptedRecords[0].answers, { q1: 'A' });
                assert.strictEqual(recorder.activeSessions.get(examId), replacement,
                    'the superseded end call must preserve the current session');
                assert.strictEqual(recorder.sessionListeners.get(examId), listener);
                assert(state.intervals.has(listener), 'the current listener must remain scheduled');
                assert.deepStrictEqual(state.activeCheckpoints.get(replacement.id), checkpoint);
                assert.deepStrictEqual(
                    state.events.filter((event) => event.type === 'practiceInterruptedRecordSaved'),
                    [{ type: 'practiceInterruptedRecordSaved', detail: { examId, reason: 'timeout', sessionId: 'session-A', interruptedRecordSaved: true } }],
                    'a saved earlier attempt must refresh history without announcing the replacement as ended'
                );
                assert.strictEqual(state.events.filter((event) => event.type === 'practiceSessionEnded').length, 0);
                assert.strictEqual(state.events.filter((event) => event.type === 'practicesessionEnded').length, 0);

                recorder.handleSessionProgress({
                    examId,
                    progress: { currentQuestion: 6 },
                    answers: { q1: 'C' }
                });
                await recorder.saveActiveSessions();
                assert.strictEqual(replacement.progress.currentQuestion, 6);
                assert.deepStrictEqual(clone(replacement.answers), { q1: 'C' });
                assert.strictEqual(state.activeCheckpoints.get(replacement.id).progress.currentQuestion, 6);
                assert.deepStrictEqual(state.activeCheckpoints.get(replacement.id).answers, { q1: 'C' });
            });
        }

        await record('a host start for another exam does not supersede the ending session', async () => {
            const { recorder, state, windowStub } = createHarness();
            const examId = 'reading-p1';
            const original = recorder.startPracticeSession(examId, { sessionId: 'session-A' });
            recorder.handleSessionStarted({ examId, sessionId: 'session-A' });
            await recorder.saveActiveSessions();

            const saveGate = deferred();
            const saveInterrupted = windowStub.AppData.recovery.saveInterrupted;
            windowStub.AppData.recovery.saveInterrupted = async (value) => {
                await saveGate.promise;
                return saveInterrupted(value);
            };
            const ending = recorder.endPracticeSession(examId, 'timeout');
            recorder.handleSessionStarted({ examId: 'reading-p2', sessionId: 'session-B' });
            recorder.handleSessionStarted({ examId: 'reading-p2', sessionId: 'session-B' });
            const otherSession = recorder.activeSessions.get('reading-p2');
            const otherListener = recorder.sessionListeners.get('reading-p2');
            await recorder.saveActiveSessions();

            saveGate.resolve();
            assert.strictEqual(await ending, true);
            assert.strictEqual(recorder.activeSessions.has(examId), false);
            assert.strictEqual(recorder.sessionListeners.has(examId), false);
            assert.strictEqual(state.activeCheckpoints.has(original.id), false);
            assert.strictEqual(state.interruptedRecords[0].sessionId, 'session-A');
            assert.strictEqual(recorder.activeSessions.get('reading-p2'), otherSession);
            assert.strictEqual(recorder.sessionListeners.get('reading-p2'), otherListener);
            assert(state.intervals.has(otherListener));
            assert.strictEqual(state.activeCheckpoints.get(otherSession.id).sessionId, 'session-B');
            assert.deepStrictEqual(
                state.events.filter((event) => event.type === 'practicesessionEnded'),
                [{ type: 'practicesessionEnded', detail: { examId, reason: 'timeout' } }]
            );
        });

        for (const reason of ['completed', 'timeout']) {
            await record(`normal ${reason} cleanup removes the session and emits one end event`, async () => {
                const { recorder, state } = createHarness();
                const examId = 'reading-p1';
                const session = recorder.startPracticeSession(examId, { sessionId: 'session-A' });
                recorder.handleSessionStarted({ examId, sessionId: 'session-A' });
                const listener = recorder.sessionListeners.get(examId);
                await recorder.saveActiveSessions();

                assert.strictEqual(await recorder.endPracticeSession(examId, reason), true);
                assert.strictEqual(recorder.activeSessions.has(examId), false);
                assert.strictEqual(recorder.sessionListeners.has(examId), false);
                assert.strictEqual(state.intervals.has(listener), false);
                assert.strictEqual(state.activeCheckpoints.has(session.id), false);
                assert.deepStrictEqual(state.discardedSessionIds, [session.id]);
                assert.strictEqual(state.interruptedRecords.length, reason === 'timeout' ? 1 : 0);
                assert.strictEqual(state.events.filter((event) => event.type === 'practiceInterruptedRecordSaved').length, 0,
                    'ordinary session cleanup must not publish a second history refresh');
                assert.deepStrictEqual(
                    state.events.filter((event) => event.type === 'practiceSessionEnded'),
                    [{ type: 'practiceSessionEnded', detail: { examId, reason, interruptedRecordSaved: reason === 'timeout' } }]
                );
                assert.deepStrictEqual(
                    state.events.filter((event) => event.type === 'practicesessionEnded'),
                    [{ type: 'practicesessionEnded', detail: { examId, reason } }]
                );
                assert.strictEqual(await recorder.endPracticeSession(examId, reason), false);
            });

            await record(`delayed ${reason} checkpoint cleanup does not announce a replacement as ended`, async () => {
                const { recorder, state, windowStub } = createHarness();
                const examId = 'reading-p1';
                const original = recorder.startPracticeSession(examId, { sessionId: 'session-A' });
                await recorder.saveActiveSessions();

                const discardStarted = deferred();
                const discardGate = deferred();
                const discardActiveSession = windowStub.AppData.recovery.discardActiveSession;
                windowStub.AppData.recovery.discardActiveSession = async (id) => {
                    assert.strictEqual(id, original.id);
                    discardStarted.resolve();
                    await discardGate.promise;
                    return discardActiveSession(id);
                };
                const ending = recorder.endPracticeSession(examId, reason);
                await discardStarted.promise;
                const replacement = recorder.startPracticeSession(examId, { sessionId: 'session-B' });
                const listener = recorder.sessionListeners.get(examId);
                await recorder.saveActiveSessions();

                discardGate.resolve();
                assert.strictEqual(await ending, true);
                assert.strictEqual(recorder.activeSessions.get(examId), replacement);
                assert.strictEqual(recorder.sessionListeners.get(examId), listener);
                assert(state.intervals.has(listener));
                assert.strictEqual(state.activeCheckpoints.has(original.id), false);
                assert.strictEqual(state.activeCheckpoints.get(replacement.id).sessionId, 'session-B');
                assert.deepStrictEqual(
                    state.events.filter((event) => event.type === 'practiceInterruptedRecordSaved'),
                    reason === 'timeout'
                        ? [{ type: 'practiceInterruptedRecordSaved', detail: { examId, reason, sessionId: 'session-A', interruptedRecordSaved: true } }]
                        : []
                );
                assert.strictEqual(state.events.filter((event) => event.type === 'practiceSessionEnded').length, 0);
                assert.strictEqual(state.events.filter((event) => event.type === 'practicesessionEnded').length, 0);
            });
        }

        await record('failed interrupted save keeps the active checkpoint and listener', async () => {
            const { recorder, state, windowStub } = createHarness();
            const examId = 'reading-p1';
            const session = recorder.startPracticeSession(examId, { sessionId: 'session-interrupted' });
            const listener = recorder.sessionListeners.get(examId);
            await recorder.saveActiveSessions();
            const checkpoint = clone(state.activeCheckpoints.get(session.id));
            windowStub.AppData.recovery.saveInterrupted = async () => {
                const error = new Error('quota exceeded');
                error.code = 'QUOTA_EXCEEDED';
                throw error;
            };

            const ended = await recorder.endPracticeSession(examId, 'timeout');
            assert.strictEqual(ended, false);
            assert.strictEqual(recorder.activeSessions.get(examId), session);
            assert.strictEqual(recorder.sessionListeners.get(examId), listener);
            assert(state.intervals.has(listener));
            assert.deepStrictEqual(state.activeCheckpoints.get(session.id), checkpoint);
            assert.strictEqual(state.discardedSessionIds.length, 0,
                'the only durable checkpoint must not be discarded after save failure');
            assert.strictEqual(state.interruptedRecords.length, 0);
            assert.strictEqual(state.events.filter((event) => event.type === 'practiceInterruptedRecordSaved').length, 0);
            assert.strictEqual(state.events.filter((event) => event.type === 'practiceSessionEnded').length, 0);
            assert.strictEqual(state.events.filter((event) => event.type === 'practicesessionEnded').length, 0);
        });

        await record('real timeout publishes saved answers only after interruption commits', async () => {
            const now = Date.parse('2026-09-05T12:00:00.000Z');
            const { recorder, state, windowStub, document } = createHarness({ now });
            const examId = 'reading-p1';
            const session = recorder.startPracticeSession(examId, { sessionId: 'timed-out-session' });
            recorder.handleSessionStarted({ examId, sessionId: session.sessionId });
            recorder.handleSessionProgress({ examId, progress: { currentQuestion: 2 }, answers: { q1: 'B' } });
            await recorder.saveActiveSessions();
            const draftsBefore = clone(state.drafts);
            const gate = deferred();
            const saveInterrupted = windowStub.AppData.recovery.saveInterrupted;
            windowStub.AppData.recovery.saveInterrupted = async (value) => {
                await gate.promise;
                return saveInterrupted(value);
            };
            let ending;
            const endPracticeSession = recorder.endPracticeSession.bind(recorder);
            recorder.endPracticeSession = (...args) => {
                ending = endPracticeSession(...args);
                return ending;
            };
            let refreshedRecords = null;
            let refresh;
            document.addEventListener('practiceSessionEnded', (event) => {
                assert.strictEqual(event.detail.interruptedRecordSaved, true);
                refresh = windowStub.AppData.recovery.listInterrupted().then((records) => { refreshedRecords = records; });
            });

            session.lastActivity = new Date(now - 31 * 60 * 1000).toISOString();
            recorder.checkSessionActivity(examId);
            assert(ending, 'the original inactivity check must invoke the end lifecycle');
            assert.strictEqual(refreshedRecords, null);
            assert.strictEqual(state.events.filter((event) => event.type === 'practiceSessionEnded').length, 0);
            gate.resolve();
            assert.strictEqual(await ending, true);
            await refresh;

            assert.strictEqual(refreshedRecords.length, 1);
            assert.strictEqual(refreshedRecords[0].reason, 'timeout');
            assert.deepStrictEqual(refreshedRecords[0].answers, { q1: 'B' });
            assert.strictEqual(state.records.length, 0, 'interruption must not create a formal score');
            assert.strictEqual(state.commands.length, 0);
            assert.deepStrictEqual(state.drafts, draftsBefore, 'reading drafts remain a separate answer source');
            assert.strictEqual(state.events.filter((event) => event.type === 'practiceSessionEnded').length, 1);
        });

        for (const failedCleanup of ['retention read', 'retention discard', 'active checkpoint discard']) {
            await record(`committed interruption still publishes history after ${failedCleanup} failure`, async () => {
                const { recorder, state, windowStub } = createHarness();
                const examId = 'reading-p1';
                const session = recorder.startPracticeSession(examId, { sessionId: 'saved-before-cleanup-error' });
                recorder.handleSessionProgress({ examId, progress: { currentQuestion: 1 }, answers: { q1: 'A' } });
                await recorder.saveActiveSessions();
                const fail = async () => { throw new Error(`forced ${failedCleanup} failure`); };
                if (failedCleanup === 'retention read') windowStub.AppData.recovery.listInterrupted = fail;
                if (failedCleanup === 'retention discard') {
                    state.interruptedRecords = Array.from({ length: 100 }, (_, index) => ({
                        id: `stale-${index}`, createdAt: new Date(index * 1000).toISOString()
                    }));
                    windowStub.AppData.recovery.discardInterrupted = fail;
                }
                if (failedCleanup === 'active checkpoint discard') windowStub.AppData.recovery.discardActiveSession = fail;

                assert.strictEqual(await recorder.endPracticeSession(examId, 'timeout'), true);
                const saved = state.interruptedRecords.find((record) => record.sessionId === session.sessionId);
                assert.deepStrictEqual(saved.answers, { q1: 'A' });
                assert.strictEqual(recorder.activeSessions.has(examId), false);
                assert.strictEqual(state.activeCheckpoints.has(session.id), failedCleanup === 'active checkpoint discard');
                assert.deepStrictEqual(
                    state.events.filter((event) => event.type === 'practiceSessionEnded'),
                    [{ type: 'practiceSessionEnded', detail: { examId, reason: 'timeout', interruptedRecordSaved: true } }]
                );
                assert.strictEqual(state.events.filter((event) => event.type === 'practicesessionError').length, 0,
                    'cleanup warnings must not misreport a committed interrupted write as failed');
                assert.strictEqual(state.records.length, 0);
            });
        }

        await record('interruption retention keeps the newest 100 records', async () => {
            const { recorder, state } = createHarness();
            state.interruptedRecords = Array.from({ length: 105 }, (_, index) => ({
                id: `older-${index}`,
                createdAt: new Date(index * 1000).toISOString()
            }));
            const receipt = await recorder.saveInterruptedRecord({ id: 'newest', createdAt: new Date().toISOString() });
            assert.strictEqual(receipt.committed, true);
            assert.strictEqual(state.interruptedRecords.length, 100);
            assert(state.interruptedRecords.some((record) => record.id === 'newest'));
            assert.deepStrictEqual(state.discardedInterruptedIds, ['older-5', 'older-4', 'older-3', 'older-2', 'older-1', 'older-0']);
        });

        await record('backup create and restore delegate to the backups domain', async () => {
            const { recorder, state } = createHarness();
            const backup = await recorder.createBackup('practice-backup');
            const restored = await recorder.restoreBackup(backup.id);
            assert.strictEqual(restored.committed, true);
            assert(state.backupCalls.some((call) => call.method === 'create' && call.options.type === 'practice-recorder'));
            assert(state.backupCalls.some((call) => call.method === 'restore' && call.id === 'practice-backup'));
        });

        console.log(JSON.stringify({ status: 'pass', detail: `${results.length}/${results.length} tests passed`, results }, null, 2));
    } catch (error) {
        results.push({ name: 'test execution', status: 'fail', error: error.stack || error.message });
        console.log(JSON.stringify({ status: 'fail', results }, null, 2));
        process.exit(1);
    }
}

main();
