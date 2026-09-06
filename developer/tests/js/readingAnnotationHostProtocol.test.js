#!/usr/bin/env node
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function loadScript(relativePath, context) {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'), context, { filename: relativePath });
}

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createHarness(initialRecord, options = {}) {
    const records = new Map([[String(initialRecord.id), clone(initialRecord)]]);
    const saveCalls = [];
    const conflicts = [];
    let revision = 1;
    const listeners = new Map();
    let drafts = [];
    const documentStub = {
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
    const windowStub = {
        document: documentStub,
        location: { origin: 'http://localhost', href: 'http://localhost/' },
        resolveActiveLibraryIndex: async () => [],
        addEventListener(type, handler) { listeners.set(type, handler); },
        removeEventListener(type, handler) {
            if (listeners.get(type) === handler) listeners.delete(type);
        },
        AppData: {
            ready: Promise.resolve(),
            practice: {
            async get(id) { return clone(records.get(String(id)) || null); },
            async list() { return clone(Array.from(records.values())); },
            async updateAnnotations(command) {
                const expectedRevision = revision;
                const current = clone(records.get(String(command.recordId)) || null);
                if (!current) throw new Error(`Unknown record: ${command.recordId}`);
                const patch = clone(command.patch);
                current.annotations = { ...(current.annotations || {}), [command.examId]: patch };
                if (Array.isArray(current.suiteEntries) && current.suiteEntries.length) {
                    current.suiteEntries = current.suiteEntries.map((entry) => (
                        String(entry.examId) === String(command.examId)
                            ? { ...entry, ...patch, realData: { ...(entry.realData || {}), ...patch } }
                            : entry
                    ));
                } else {
                    Object.assign(current, patch);
                    current.realData = { ...(current.realData || {}), ...patch };
                }
                saveCalls.push({ command: clone(command), record: clone(current) });
                if (typeof options?.beforeSave === 'function') {
                    await options.beforeSave(current, saveCalls.length);
                }
                if (revision !== expectedRevision) {
                    const error = new Error('annotation revision conflict');
                    error.code = 'CONFLICT';
                    conflicts.push(clone(command));
                    throw error;
                }
                records.set(String(current.id), clone(current));
                revision += 1;
                return { committed: true };
            }
            },
            recovery: {
                async listDrafts() { return clone(drafts); },
                async saveDraft(value) {
                    const item = { ...clone(value), updatedAt: new Date().toISOString() };
                    const index = drafts.findIndex((draft) => draft.id === item.id);
                    if (index >= 0) drafts[index] = item;
                    else drafts.push(item);
                    return { committed: true, item: clone(item) };
                },
                async discardDraft(id) {
                    drafts = drafts.filter((draft) => draft.id !== id);
                    return { committed: true };
                }
            }
        }
    };
    const sandbox = {
        window: windowStub,
        document: documentStub,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Date,
        Math,
        JSON,
        Map,
        Set,
        URL,
        URLSearchParams
    };
    sandbox.globalThis = windowStub;
    const context = vm.createContext(sandbox);
    loadScript('js/app/examSessionMixin.js', context);
    loadScript('js/app/suitePracticeMixin.js', context);
    const app = { components: {}, setState() {}, getState() { return null; } };
    Object.assign(app, windowStub.ExamSystemAppMixins.examSession, windowStub.ExamSystemAppMixins.suitePractice);
    return { app, windowStub, records, saveCalls, conflicts, listeners, getDrafts: () => clone(drafts) };
}

function bindReviewProtocol(harness, record, examId) {
    const examWindow = {
        name: `review-${examId}`,
        closed: false,
        location: { href: `http://localhost/${examId}.html` },
        _messages: [],
        postMessage(message) { this._messages.push(clone(message)); }
    };
    const review = harness.app._buildReviewSession(record);
    assert(review, 'review session should be created');
    harness.app._ensureReviewReplayStore().set(review.sessionId, review);
    const info = {
        window: examWindow,
        expectedSessionId: `session-${examId}`,
        windowSessionToken: `token-${examId}`,
        windowSessionTokenSessionId: `session-${examId}`,
        expectedUrl: `http://localhost/${examId}.html`,
        expectedOrigin: 'http://localhost',
        allowOpaqueOrigin: false,
        reviewMode: true,
        reviewSessionId: review.sessionId,
        reviewEntryIndex: review.entries.findIndex(entry => entry.examId === examId),
        readOnly: true
    };
    harness.app.examWindows = new Map([[examId, info]]);
    harness.app.setupExamWindowCommunication(examWindow, examId);
    const handler = harness.app.messageHandlers.get(examId);
    assert.strictEqual(typeof handler, 'function', 'message handler should be registered');
    return { examWindow, review, info, handler };
}

async function send(handler, examWindow, data, type = 'READING_ANNOTATION_SYNC', overrides = {}) {
    await handler({
        origin: overrides.origin || 'http://localhost',
        source: overrides.source || examWindow,
        data: { type, source: overrides.envelopeSource || 'practice_page', data }
    });
}

function bindLiveProtocol(harness, examId, libraryConfigurationId = null) {
    const examWindow = {
        name: `practice-${examId}`,
        closed: false,
        location: { href: `http://localhost/${examId}.html` },
        postMessage() {}
    };
    const info = {
        window: examWindow,
        expectedSessionId: `session-${examId}`,
        windowSessionToken: `token-${examId}`,
        windowSessionTokenSessionId: `session-${examId}`,
        expectedUrl: `http://localhost/${examId}.html`,
        expectedOrigin: 'http://localhost',
        allowOpaqueOrigin: false,
        reviewMode: false,
        practiceMode: 'single',
        readOnly: false,
        ...(libraryConfigurationId ? { libraryConfigurationId } : {})
    };
    harness.app.examWindows = new Map([[examId, info]]);
    harness.app.setupExamWindowCommunication(examWindow, examId);
    const handler = harness.app.messageHandlers.get(examId);
    assert.strictEqual(typeof handler, 'function', 'live message handler should be registered');
    return { examWindow, info, handler };
}

// 单篇阅读 final-submit 落库后，结果页的 windowInfo 不在 review 回放态，
// 而是持有宿主回传的 submittedRecordId。该 helper 模拟该场景。
function bindSubmittedProtocol(harness, examId, recordId) {
    const examWindow = {
        name: `submitted-${examId}`,
        closed: false,
        location: { href: `http://localhost/${examId}.html` },
        _messages: [],
        postMessage(message) { this._messages.push(clone(message)); }
    };
    const info = {
        window: examWindow,
        expectedSessionId: `session-${examId}`,
        windowSessionToken: `token-${examId}`,
        windowSessionTokenSessionId: `session-${examId}`,
        expectedUrl: `http://localhost/${examId}.html`,
        expectedOrigin: 'http://localhost',
        allowOpaqueOrigin: false,
        reviewMode: false,
        reviewSessionId: null,
        practiceMode: 'single',
        readOnly: false,
        submittedRecordId: String(recordId)
    };
    harness.app.examWindows = new Map([[examId, info]]);
    harness.app.setupExamWindowCommunication(examWindow, examId);
    const handler = harness.app.messageHandlers.get(examId);
    assert.strictEqual(typeof handler, 'function', 'submitted message handler should be registered');
    return { examWindow, info, handler };
}

async function testSingleRecordTokenGateAndMerge() {
    const original = {
        id: 'record-single',
        examId: 'reading-p1',
        status: 'completed',
        scoreInfo: { correct: 8, total: 10, percentage: 80 },
        duration: 612,
        date: '2026-07-01T00:00:00.000Z',
        realData: { source: 'unified-reading', noteText: 'old' }
    };
    const harness = createHarness(original);
    const { examWindow, review, info, handler } = bindReviewProtocol(harness, original, 'reading-p1');
    const base = {
        examId: 'reading-p1',
        recordId: original.id,
        reviewSessionId: review.sessionId,
        sessionId: info.expectedSessionId,
        annotations: {
            noteText: 'updated',
            notes: [{ id: 'n1', body: 'body', outlineId: 'o1' }],
            noteOutlines: [{ id: 'o1', title: 'Outline' }],
            highlights: [{ id: 'h1', text: 'quote', noteId: 'n1' }],
            markedQuestions: ['q2'],
            scrollY: 245
        }
    };

    await send(handler, examWindow, { ...base, windowSessionToken: 'forged-token' });
    assert.strictEqual(harness.saveCalls.length, 0, 'forged window token must be rejected');
    await send(handler, examWindow, { ...base, sessionId: 'stale-session', windowSessionToken: info.windowSessionToken });
    assert.strictEqual(harness.saveCalls.length, 0, 'stale session id must be rejected');
    await send(handler, examWindow, { ...base, reviewSessionId: 'review-forged', windowSessionToken: info.windowSessionToken });
    assert.strictEqual(harness.saveCalls.length, 0, 'foreign review session must be rejected');
    const { recordId: _omittedRecordId, ...withoutRecordId } = base;
    await send(handler, examWindow, { ...withoutRecordId, windowSessionToken: info.windowSessionToken });
    assert.strictEqual(harness.saveCalls.length, 0, 'missing record binding must be rejected');
    await send(
        handler,
        examWindow,
        { ...base, windowSessionToken: info.windowSessionToken },
        'READING_ANNOTATION_SYNC',
        { origin: 'https://attacker.invalid' }
    );
    assert.strictEqual(harness.saveCalls.length, 0, 'wrong origin must be rejected');
    await send(
        handler,
        examWindow,
        { ...base, windowSessionToken: info.windowSessionToken },
        'READING_ANNOTATION_SYNC',
        { source: { name: examWindow.name, location: examWindow.location } }
    );
    assert.strictEqual(harness.saveCalls.length, 0, 'lookalike WindowProxy must be rejected');
    await send(
        handler,
        examWindow,
        { ...base, windowSessionToken: info.windowSessionToken },
        'READING_ANNOTATION_SYNC',
        { envelopeSource: 'exam_host' }
    );
    assert.strictEqual(harness.saveCalls.length, 0, 'wrong source tag must be rejected');

    await send(handler, examWindow, { ...base, windowSessionToken: info.windowSessionToken });
    assert.strictEqual(harness.saveCalls.length, 1, 'valid annotation sync should save once');
    const call = harness.saveCalls[0];
    assert.strictEqual(Object.prototype.hasOwnProperty.call(call.command, 'updateStats'), false, 'annotation command must not expose a stats toggle');
    assert.strictEqual(call.command.recordId, original.id);
    assert.strictEqual(call.command.examId, 'reading-p1');
    assert.deepStrictEqual(call.record.scoreInfo, original.scoreInfo, 'score must be preserved');
    assert.strictEqual(call.record.duration, original.duration, 'duration must be preserved');
    assert.strictEqual(call.record.status, original.status, 'completion status must be preserved');
    assert.strictEqual(call.record.date, original.date, 'completion date must be preserved');
    assert.strictEqual(call.record.highlights[0].noteId, 'n1', 'highlight noteId link must survive host merge');
    assert.strictEqual(call.record.realData.notes[0].id, 'n1', 'canonical replay data should receive notes');
}

async function testSuiteEntryScopedMerge() {
    const original = {
        id: 'record-suite',
        examId: 'suite-record-suite',
        status: 'completed',
        scoreInfo: { correct: 20, total: 30 },
        duration: 3200,
        suiteEntries: [
            { examId: 'reading-p1', scoreInfo: { correct: 7, total: 10 }, notes: [{ id: 'old-p1' }] },
            { examId: 'reading-p2', scoreInfo: { correct: 6, total: 10 }, notes: [{ id: 'keep-p2' }] }
        ]
    };
    const harness = createHarness(original);
    const { examWindow, review, info, handler } = bindReviewProtocol(harness, original, 'reading-p1');
    await send(handler, examWindow, {
        examId: 'reading-p1',
        recordId: original.id,
        reviewSessionId: review.sessionId,
        sessionId: info.expectedSessionId,
        windowSessionToken: info.windowSessionToken,
        notes: [{ id: 'new-p1' }],
        noteOutlines: []
    });
    assert.strictEqual(harness.saveCalls.length, 1, 'suite annotation should save aggregate record once');
    const saved = harness.saveCalls[0].record;
    assert.strictEqual(saved.suiteEntries[0].notes[0].id, 'new-p1', 'matching suite entry should be updated');
    assert.strictEqual(saved.suiteEntries[1].notes[0].id, 'keep-p2', 'other suite entry must remain unchanged');
    assert.deepStrictEqual(saved.scoreInfo, original.scoreInfo, 'aggregate score must remain unchanged');
}

async function testAnnotationWritesAreSerialized() {
    const original = {
        id: 'record-race',
        examId: 'reading-p1',
        scoreInfo: { correct: 8, total: 10 },
        notes: [{ id: 'old' }]
    };
    let releaseFirstSave;
    let markFirstSaveStarted;
    const firstSaveStarted = new Promise((resolve) => { markFirstSaveStarted = resolve; });
    const harness = createHarness(original, {
        async beforeSave(_record, saveNumber) {
            if (saveNumber !== 1) return;
            markFirstSaveStarted();
            await new Promise((resolve) => { releaseFirstSave = resolve; });
        }
    });
    const { examWindow, review, info, handler } = bindReviewProtocol(harness, original, 'reading-p1');
    const base = {
        examId: 'reading-p1',
        recordId: original.id,
        reviewSessionId: review.sessionId,
        sessionId: info.expectedSessionId,
        windowSessionToken: info.windowSessionToken
    };

    const first = send(handler, examWindow, { ...base, notes: [{ id: 'first' }] });
    await firstSaveStarted;
    const second = send(handler, examWindow, { ...base, notes: [{ id: 'second' }] });
    releaseFirstSave();
    const settled = await Promise.allSettled([first, second]);

    assert.strictEqual(harness.saveCalls.length, 2, 'both valid annotation snapshots should reach the domain boundary');
    assert.strictEqual(harness.conflicts.length, 1, 'a stale concurrent annotation must produce a deterministic conflict');
    assert.strictEqual(settled.filter((result) => result.status === 'rejected').length, 1);
    assert.strictEqual(
        harness.records.get(original.id).notes[0].id,
        'second',
        'later annotation snapshot must win even when the prior write is slow'
    );
}

function testSuiteDraftCarriesStructuredNotes() {
    const harness = createHarness({ id: 'unused', examId: 'unused' });
    const draft = harness.app._buildSuiteDraftSnapshot({
        draft: {
            answers: { q1: 'A' },
            notes: [{ id: 'n1', body: 'draft' }],
            noteOutlines: [{ id: 'o1', title: 'Draft outline' }],
            highlights: [{ id: 'h1', noteId: 'n1' }]
        },
        draftUpdatedAt: 1234
    });
    assert.strictEqual(draft.notes[0].id, 'n1', 'suite draft should retain structured notes');
    assert.strictEqual(draft.noteOutlines[0].id, 'o1', 'suite draft should retain outlines');
    assert.strictEqual(draft.highlights[0].noteId, 'n1', 'suite draft should retain highlight noteId');
    assert.strictEqual(draft.updatedAt, 1234, 'suite draft ordering timestamp should be retained');
}

async function testLiveDraftUsesIsolatedTokenGatedStore() {
    const harness = createHarness({ id: 'unused-live', examId: 'reading-live' });
    const { examWindow, info, handler } = bindLiveProtocol(harness, 'reading-live');
    const base = {
        examId: 'reading-live',
        sessionId: info.expectedSessionId,
        windowSessionToken: info.windowSessionToken,
        draftUpdatedAt: 2000,
        draft: {
            answers: { q1: 'A' },
            highlights: [{ id: 'h-live', noteId: 'n-live' }],
            notes: [{ id: 'n-live', body: 'draft note' }],
            noteOutlines: [{ id: 'o-live', title: 'Draft' }],
            markedQuestions: ['q1'],
            noteText: 'draft note',
            scrollY: 88,
            updatedAt: 2000
        }
    };

    await send(handler, examWindow, { ...base, windowSessionToken: 'forged' }, 'READING_DRAFT_SYNC');
    assert.strictEqual(harness.getDrafts().length, 0, 'forged draft token must not write recovery data');

    await send(handler, examWindow, base, 'READING_DRAFT_SYNC');
    assert.strictEqual(harness.saveCalls.length, 0, 'in-progress drafts must not enter practice records');
    const stored = harness.getDrafts().find((draft) => draft.id === 'reading-draft:reading-live');
    assert.strictEqual(stored.notes[0].id, 'n-live', 'structured notes should persist in recovery drafts');
    assert.strictEqual(stored.highlights[0].noteId, 'n-live', 'draft highlight noteId should persist');

    await send(handler, examWindow, {
        ...base,
        draftUpdatedAt: 1000,
        draft: { ...base.draft, notes: [{ id: 'stale' }], updatedAt: 1000 }
    }, 'READING_DRAFT_SYNC');
    assert.strictEqual(
        harness.getDrafts().find((draft) => draft.id === 'reading-draft:reading-live').notes[0].id,
        'n-live',
        'older draft snapshots must not replace newer state'
    );
    assert.strictEqual(
        await harness.app.clearReadingDraftForExam('reading-live', { sessionId: info.expectedSessionId }),
        true,
        'matching submitted draft should be discarded by entity id'
    );
    assert.strictEqual(harness.getDrafts().length, 0);

    const isolatedHarness = createHarness({ id: 'unused-library-live', examId: 'reading-library-live' });
    const isolated = bindLiveProtocol(isolatedHarness, 'reading-library-live', 'library-a');
    const isolatedBase = {
        examId: 'reading-library-live',
        sessionId: isolated.info.expectedSessionId,
        windowSessionToken: isolated.info.windowSessionToken,
        draftUpdatedAt: 3000,
        draft: { notes: [{ id: 'note-a' }], updatedAt: 3000 }
    };
    await send(isolated.handler, isolated.examWindow, isolatedBase, 'READING_DRAFT_SYNC');
    isolated.info.libraryConfigurationId = 'library-b';
    await send(isolated.handler, isolated.examWindow, {
        ...isolatedBase,
        draftUpdatedAt: 4000,
        draft: { notes: [{ id: 'note-b' }], updatedAt: 4000 }
    }, 'READING_DRAFT_SYNC');
    assert.deepStrictEqual(
        isolatedHarness.getDrafts().map((draft) => draft.id).sort(),
        ['reading-draft:reading-library-live:library-a', 'reading-draft:reading-library-live:library-b']
    );
    assert.strictEqual(
        (await isolatedHarness.app.getReadingDraftForExam('reading-library-live', { libraryConfigurationId: 'library-a' })).notes[0].id,
        'note-a'
    );
    assert.strictEqual(
        (await isolatedHarness.app.getReadingDraftForExam('reading-library-live', { libraryConfigurationId: 'library-b' })).notes[0].id,
        'note-b'
    );
    await isolatedHarness.app.clearReadingDraftForExam('reading-library-live', { libraryConfigurationId: 'library-a' });
    assert.deepStrictEqual(isolatedHarness.getDrafts().map((draft) => draft.id), ['reading-draft:reading-library-live:library-b']);
}

async function testCompletionPersistenceVerification() {
    const persisted = {
        id: 'record-persisted',
        examId: 'reading-persisted',
        sessionId: 'session-persisted',
        endTime: '2026-07-22T10:00:00.000Z'
    };
    const harness = createHarness(persisted);
    assert.strictEqual(
        await harness.app._isPracticeCompletionPersisted(persisted),
        true,
        'an exact canonical record round-trip should authorize draft cleanup'
    );
    assert.strictEqual(
        await harness.app._isPracticeCompletionPersisted({ ...persisted, endTime: '2026-07-22T10:01:00.000Z' }),
        false,
        'an older record with the same id must not authorize cleanup for a newer completion'
    );
    assert.strictEqual(
        await harness.app._isPracticeCompletionPersisted({ ...persisted, id: 'record-missing' }),
        false,
        'a completion absent from the canonical store must retain its resumable draft'
    );
    for (const field of ['examId', 'sessionId', 'endTime']) {
        const incomplete = { ...persisted };
        delete incomplete[field];
        assert.strictEqual(
            await harness.app._isPracticeCompletionPersisted(incomplete),
            false,
            `a completion without ${field} must not authorize cleanup`
        );
    }
}

async function testSubmittedReadingAnnotationSync() {
    // 单篇阅读 final-submit 后，结果页通过宿主回传的 submittedRecordId 发送标注
    // 同步；路由守卫与 handleReadingAnnotationSync 必须按该 id 直连已存档记录，
    // 不再要求 review 回放态。同时校验仍拒绝伪造的 token/session/recordId。
    const original = {
        id: 'record-submitted',
        examId: 'reading-submitted',
        status: 'completed',
        scoreInfo: { correct: 8, total: 10, percentage: 80 },
        duration: 612,
        date: '2026-07-01T00:00:00.000Z',
        realData: { source: 'unified-reading', noteText: 'old' }
    };
    const harness = createHarness(original);
    const { examWindow, info, handler } = bindSubmittedProtocol(harness, 'reading-submitted', original.id);
    const base = {
        examId: 'reading-submitted',
        recordId: original.id,
        reviewSessionId: null,
        sessionId: info.expectedSessionId,
        annotations: {
            noteText: 'updated-after-submit',
            notes: [{ id: 'n1', body: 'post-submit note', outlineId: 'o1' }],
            noteOutlines: [{ id: 'o1', title: 'Outline' }],
            highlights: [{ id: 'h1', text: 'quote', noteId: 'n1' }],
            markedQuestions: ['q5'],
            scrollY: 305
        }
    };

    await send(handler, examWindow, { ...base, windowSessionToken: 'forged-token' });
    assert.strictEqual(harness.saveCalls.length, 0, 'submitted sync: forged window token must be rejected');
    await send(handler, examWindow, { ...base, sessionId: 'stale-session', windowSessionToken: info.windowSessionToken });
    assert.strictEqual(harness.saveCalls.length, 0, 'submitted sync: stale session id must be rejected');
    await send(handler, examWindow, { ...base, recordId: 'record-forged', windowSessionToken: info.windowSessionToken });
    assert.strictEqual(harness.saveCalls.length, 0, 'submitted sync: foreign recordId must be rejected');

    await send(handler, examWindow, { ...base, windowSessionToken: info.windowSessionToken });
    assert.strictEqual(harness.saveCalls.length, 1, 'submitted sync: valid payload should save once');
    const call = harness.saveCalls[0];
    assert.strictEqual(Object.prototype.hasOwnProperty.call(call.command, 'updateStats'), false, 'submitted annotation command must not expose a stats toggle');
    assert.deepStrictEqual(call.record.scoreInfo, original.scoreInfo, 'submitted sync: score must be preserved');
    assert.strictEqual(call.record.status, original.status, 'submitted sync: completion status must be preserved');
    assert.strictEqual(call.record.realData.noteText, 'updated-after-submit', 'submitted sync: noteText must land on realData');
    assert.strictEqual(call.record.realData.notes[0].id, 'n1', 'submitted sync: notes must land on realData');
    assert.strictEqual(call.record.realData.markedQuestions[0], 'q5', 'submitted sync: markedQuestions must land on realData');
    assert.strictEqual(call.record.highlights[0].noteId, 'n1', 'submitted sync: highlight link must survive host merge');
}

async function testSubmittedRecordAnnouncementRequiresCanonicalPersistence() {
    const candidate = {
        id: 'record-completion',
        examId: 'reading-completion',
        sessionId: 'session-completion',
        endTime: '2026-07-22T11:00:00.000Z'
    };
    const harness = createHarness(candidate);
    harness.records.delete(candidate.id);
    const announcements = [];
    const clearedDrafts = [];
    let cleanupCalls = 0;
    harness.app.components.practiceRecorder = {
        async handleSessionCompleted() {
            return clone(candidate);
        }
    };
    harness.app._normalizeListeningSpellingErrors = () => {};
    harness.app._announceSubmittedReadingRecord = (...args) => announcements.push(args);
    harness.app.clearReadingDraftForExam = async (...args) => clearedDrafts.push(args);
    harness.app.updateExamStatus = () => {};
    harness.app.showRealCompletionNotification = async () => {};
    harness.app.cleanupExamSession = () => { cleanupCalls += 1; };
    harness.app._isResetCapableUnifiedReadingCompletion = () => false;
    const submitWindow = {
        closed: false,
        location: { href: `http://localhost/${candidate.examId}.html` },
        _messages: [],
        postMessage(message) { this._messages.push(clone(message)); }
    };
    harness.app.examWindows = new Map([[candidate.examId, {
        window: submitWindow,
        expectedSessionId: candidate.sessionId,
        sessionId: candidate.sessionId,
        windowSessionToken: 'token-completion',
        windowSessionTokenSessionId: candidate.sessionId,
        expectedUrl: submitWindow.location.href,
        expectedOrigin: 'http://localhost',
        allowOpaqueOrigin: false
    }]]);
    const submissionId = 'submission-completion';

    await harness.app.handlePracticeComplete(candidate.examId, {
        examId: candidate.examId,
        sessionId: candidate.sessionId,
        submissionId,
        endTime: candidate.endTime
    }, submitWindow);
    assert.strictEqual(announcements.length, 0, 'temporary-only completion must not announce an unsaved record id');
    assert.strictEqual(clearedDrafts.length, 0, 'temporary-only completion must retain its resumable draft');
    assert.strictEqual(cleanupCalls, 0, 'unverified completion must retain the live session for retry');
    assert.strictEqual(submitWindow._messages.at(-1).type, 'PRACTICE_SUBMIT_FAILED', 'failed persistence must NACK the child');
    assert.deepStrictEqual(
        clone({
            submissionId: submitWindow._messages.at(-1).data.submissionId,
            sessionId: submitWindow._messages.at(-1).data.sessionId,
            examId: submitWindow._messages.at(-1).data.examId,
            suiteSessionId: submitWindow._messages.at(-1).data.suiteSessionId
        }),
        { submissionId, sessionId: candidate.sessionId, examId: candidate.examId, suiteSessionId: null },
        'NACK must carry every submission correlation field'
    );

    harness.records.set(candidate.id, clone(candidate));
    await harness.app.handlePracticeComplete(candidate.examId, {
        examId: candidate.examId,
        sessionId: candidate.sessionId,
        submissionId,
        endTime: candidate.endTime
    }, submitWindow);
    assert.strictEqual(announcements.length, 1, 'canonical completion should announce its saved record id once');
    assert.strictEqual(clearedDrafts.length, 1, 'canonical completion should clear its resumable draft');
    assert.strictEqual(cleanupCalls, 1, 'verified canonical completion may clean up its live session');
    assert.strictEqual(submitWindow._messages.at(-1).type, 'PRACTICE_SUBMIT_ACK', 'verified persistence must ACK the child');
    assert.deepStrictEqual(
        clone({
            submissionId: submitWindow._messages.at(-1).data.submissionId,
            sessionId: submitWindow._messages.at(-1).data.sessionId,
            examId: submitWindow._messages.at(-1).data.examId,
            suiteSessionId: submitWindow._messages.at(-1).data.suiteSessionId
        }),
        { submissionId, sessionId: candidate.sessionId, examId: candidate.examId, suiteSessionId: null },
        'ACK must carry every submission correlation field'
    );
}

async function main() {
    await testSingleRecordTokenGateAndMerge();
    await testSuiteEntryScopedMerge();
    await testAnnotationWritesAreSerialized();
    await testSubmittedReadingAnnotationSync();
    await testLiveDraftUsesIsolatedTokenGatedStore();
    await testCompletionPersistenceVerification();
    await testSubmittedRecordAnnouncementRequiresCanonicalPersistence();
    testSuiteDraftCarriesStructuredNotes();
    process.stdout.write(JSON.stringify({
        status: 'pass',
        detail: 'reading draft/annotation protocols reject forged tokens, isolate recovery entities, surface CAS conflicts, persist post-submit notes and preserve stats'
    }));
}

main().catch((error) => {
    process.stdout.write(JSON.stringify({ status: 'fail', detail: error && error.stack ? error.stack : String(error) }));
    process.exit(1);
});
