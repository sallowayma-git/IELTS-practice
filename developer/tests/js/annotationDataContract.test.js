#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function loadScript(relativePath, context) {
    vm.runInContext(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'), context, { filename: relativePath });
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

async function main() {
    const windowStub = { console };
    const sandbox = { window: windowStub, console, Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval };
    sandbox.globalThis = windowStub;
    const context = vm.createContext(sandbox);

    loadScript('js/core/practiceCore.js', context);
    const PracticeCore = windowStub.PracticeCore;
    const annotationFixture = {
        highlights: [{ id: 'hl-1', noteId: 'note-1', text: 'quoted evidence' }],
        markedQuestions: ['q2'],
        noteText: 'legacy free-form note',
        notes: [{ id: 'note-1', outlineId: 'outline-1', body: 'structured note', quote: 'quoted evidence' }],
        noteOutlines: [{ id: 'outline-1', title: 'Evidence', order: 1 }],
        scrollY: 432
    };
    const baseRecord = {
        id: 'annotation-record',
        examId: 'reading-annotation',
        sessionId: 'annotation-session',
        title: 'Annotation contract',
        startTime: '2026-07-16T00:00:00.000Z',
        endTime: '2026-07-16T00:10:00.000Z',
        duration: 600,
        answers: { q1: 'A' },
        correctAnswerMap: { q1: 'A' },
        score: 1,
        totalQuestions: 1,
        correctAnswers: 1,
        ...annotationFixture
    };

    const canonical = PracticeCore.contracts.standardizeRecord(baseRecord);
    for (const field of ['highlights', 'markedQuestions', 'noteText', 'notes', 'noteOutlines', 'scrollY']) {
        assert.deepStrictEqual(plain(canonical[field]), plain(annotationFixture[field]), `canonical root must preserve ${field}`);
        assert.deepStrictEqual(plain(canonical.realData[field]), plain(annotationFixture[field]), `realData must authoritatively preserve ${field}`);
    }
    assert.strictEqual(canonical.highlights[0].noteId, 'note-1', 'highlight noteId must survive canonical normalization');
    canonical.notes[0].body = 'mutated mirror';
    assert.strictEqual(canonical.realData.notes[0].body, 'structured note', 'root and realData annotation snapshots must not alias');

    const completion = PracticeCore.ingestor.fromCompletion({
        type: 'practice_complete',
        data: { ...baseRecord, id: 'completion-annotation-record' }
    });
    assert.deepStrictEqual(plain(completion.notes), plain(annotationFixture.notes), 'completion ingestion must preserve structured notes');
    assert.deepStrictEqual(plain(completion.realData.noteOutlines), plain(annotationFixture.noteOutlines), 'completion realData must preserve outlines');
    assert.strictEqual(completion.realData.highlights[0].noteId, 'note-1', 'completion must preserve highlight-note linkage');

    const suiteEntries = PracticeCore.contracts.standardizeSuiteEntries([{
        examId: 'reading-suite-p2',
        answers: { q1: 'A' },
        realData: annotationFixture
    }]);
    assert.deepStrictEqual(plain(suiteEntries[0].notes), plain(annotationFixture.notes), 'suite entry must recover notes from realData');
    assert.deepStrictEqual(plain(suiteEntries[0].markedQuestions), ['q2'], 'suite entry must recover marked questions');

    const replay = PracticeCore.contracts.buildReplayResultSnapshot({
        answers: { q1: 'A' },
        correctAnswerMap: { q1: 'A' },
        realData: annotationFixture
    });
    assert.deepStrictEqual(plain(replay.noteOutlines), plain(annotationFixture.noteOutlines), 'replay snapshot must include note outlines');
    assert.strictEqual(replay.highlights[0].noteId, 'note-1', 'replay snapshot must preserve noteId');

    const saveCalls = [];
    windowStub.AppData = {
        ready: Promise.resolve(true),
        practice: {
            async completeAttempt(command) {
                saveCalls.push(plain(command));
                return { committed: true, record: plain(command.record) };
            },
            async getStats() { return {}; }
        },
        recovery: {
            async listActiveSessions() { return []; },
            async listDrafts() { return []; }
        }
    };
    loadScript('js/core/practiceRecorder.js', context);
    const recorder = Object.create(windowStub.PracticeRecorder.prototype);
    recorder.practiceTypeCache = new Map();
    recorder.wait = async () => {};
    recorder.verifyRecordSaved = async () => true;
    await recorder.savePracticeRecord(baseRecord, { updateStats: false });
    assert.strictEqual(saveCalls.length, 1, 'recorder must submit one AppData practice command');
    assert.deepStrictEqual(saveCalls[0].record.realData.notes, annotationFixture.notes, 'recorder AppData path must preserve realData notes');

    console.log(JSON.stringify({ status: 'pass', detail: 'annotation canonical/completion/suite/replay/AppData recorder contract passed' }, null, 2));
}

main().catch((error) => {
    console.error(JSON.stringify({ status: 'fail', detail: error.message, stack: error.stack }, null, 2));
    process.exit(1);
});
