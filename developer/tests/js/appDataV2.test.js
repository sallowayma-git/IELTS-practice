#!/usr/bin/env node

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const appDataSource = fs.readFileSync(path.join(root, 'js/data/v2/appData.js'), 'utf8');
const catalogSource = fs.readFileSync(path.join(root, 'js/data/v2/dataCatalog.js'), 'utf8');
const recordSource = fs.readFileSync(path.join(root, 'js/data/practiceRecordSource.js'), 'utf8');
const clone = (value) => value === undefined ? undefined : structuredClone(value);
function stable(value) { if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`; return JSON.stringify(value); }
function checksum(value) { let hash = 0x811c9dc5; for (const char of stable(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193); } return `fnv1a-${(hash >>> 0).toString(16)}`; }
function parseLegacyValue(value) { let parsed = clone(value); for (let depth = 0; depth < 3; depth += 1) { if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { break; } } else if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'data') && (Object.prototype.hasOwnProperty.call(parsed, 'version') || Object.prototype.hasOwnProperty.call(parsed, 'compressed'))) parsed = parsed.data; else break; } return clone(parsed); }
class AppDataError extends Error { constructor(code, message) { super(message); this.code = code; } }

function harness() {
    const catalogSandbox = { structuredClone }; catalogSandbox.globalThis = catalogSandbox;
    vm.runInContext(catalogSource, vm.createContext(catalogSandbox), { filename: 'dataCatalog.js' });
    const catalog = catalogSandbox.__AppDataV2Catalog;
    const shared = { docs: new Map(), entities: new Map([['practiceSummaries', new Map()], ['practiceDetails', new Map()], ['practiceAnnotations', new Map()]]), reads: [], lists: [], mutations: [], counter: 0, failEntityStore: null, lastInstallOptions: null };
    const envelope = (key, data, state = 'present', revision = 1, operationId = 'seed') => ({ schemaVersion: 2, revision, operationId, updatedAt: new Date().toISOString(), state, data: state === 'cleared' ? null : clone(data), checksum: checksum(state === 'cleared' ? null : data) });
    class Kernel {
        async initialize() { this.state = 'ready'; this.backend = 'memory'; return this; }
        async read(key, options = {}) { const entry = catalog.get(key); const value = shared.docs.get(key) || null; const data = !value || value.state === 'cleared' ? entry.defaultValue() : value.data; return options.withMeta ? { data: clone(data), envelope: clone(value) } : clone(data); }
        async mutate(changes, options = {}) {
            const op = String(options.operationId || `doc-${++shared.counter}`);
            if (typeof options.commitGuard === 'function') {
                let allowed = false;
                try { allowed = options.commitGuard() === true; } catch (_) {
                    throw new AppDataError('PRECONDITION_FAILED', 'commit guard threw');
                }
                if (!allowed) throw new AppDataError('PRECONDITION_FAILED', 'commit guard rejected mutation');
            }
            const revisions = {};
            for (const change of changes) {
                const old = shared.docs.get(change.logicalKey);
                if (change.expectedRevision !== undefined && Number(change.expectedRevision) !== Number(old && old.revision || 0)) throw new AppDataError('CONFLICT', 'document revision');
                const revision = Number(old && old.revision || 0) + 1;
                shared.docs.set(change.logicalKey, envelope(change.logicalKey, change.data, change.state, revision, op));
                revisions[change.logicalKey] = revision;
            }
            return { committed: true, operationId: op, revisions, derived: { status: 'ready', pending: [] }, warnings: [] };
        }
        async journalNoop(options = {}) { return { committed: true, operationId: options.operationId || `noop-${++shared.counter}`, revisions: {}, derived: { status: 'ready', pending: [] }, warnings: [] }; }
        async readEntity(store, recordId, options = {}) { shared.reads.push(store); const row = shared.entities.get(store).get(String(recordId)) || null; return options.withMeta ? clone(row) : row && clone(row.data); }
        async listEntities(store, options = {}) { if (store !== 'practiceSummaries') throw new AppDataError('VALIDATION', 'details are not listable'); shared.lists.push(store); const rows = Array.from(shared.entities.get(store).values()); return options.withMeta ? clone(rows) : rows.map((row) => clone(row.data)); }
        async readPracticeSnapshot(recordIds = null, options = {}) { const ids = recordIds === null ? null : new Set((Array.isArray(recordIds) ? recordIds : [recordIds]).map(String)); const stores = options.stores || ['practiceSummaries', 'practiceDetails', 'practiceAnnotations']; const result = {}; for (const store of stores) { if (ids) shared.reads.push(store); const rows = Array.from(shared.entities.get(store).values()).filter((row) => !ids || ids.has(String(row.recordId))); result[store] = options.withMeta ? clone(rows) : rows.map((row) => clone(row.data)); } return result; }
        async mutateEntities(operations, options = {}) { const op = String(options.operationId || `entity-${++shared.counter}`); const revisions = {}; const next = new Map(Array.from(shared.entities, ([store, rows]) => [store, new Map(rows)])); for (const item of operations) { if (shared.failEntityStore === item.store) throw new AppDataError('IO', `forced entity failure: ${item.store}`); const rows = next.get(item.store); if (item.type === 'clear') { rows.clear(); revisions[`${item.store}/*`] = 0; continue; } const old = rows.get(String(item.recordId)); if (item.expectedRevision !== undefined && item.expectedRevision !== null && Number(item.expectedRevision) !== Number(old && old.revision || 0)) throw new AppDataError('CONFLICT', 'entity revision'); if (item.type === 'delete') { rows.delete(String(item.recordId)); revisions[`${item.store}/${item.recordId}`] = Number(old && old.revision || 0) + 1; } else { const row = { recordId: String(item.recordId), revision: Number(old && old.revision || 0) + 1, operationId: op, updatedAt: new Date().toISOString(), data: clone(item.data), checksum: checksum(item.data) }; rows.set(row.recordId, row); revisions[`${item.store}/${item.recordId}`] = row.revision; } } shared.entities = next; shared.mutations.push(clone(operations)); return { committed: true, operationId: op, revisions, derived: { status: 'ready', pending: [] }, warnings: [] }; }
        async exportSnapshot(options = {}) {
            const selected = Array.isArray(options.logicalKeys) ? new Set(options.logicalKeys) : null;
            const selectedEntities = Array.isArray(options.entityStores) ? new Set(options.entityStores) : null;
            const envelopes = {};
            for (const entry of catalog.list()) {
                const key = entry.logicalKey;
                if (entry.export !== true || (selected && !selected.has(key))) continue;
                envelopes[key] = shared.docs.has(key)
                    ? clone(shared.docs.get(key))
                    : envelope(key, null, 'cleared', 1, 'snapshot-default');
            }
            const entities = {};
            for (const [store, rows] of shared.entities) {
                if (selectedEntities && !selectedEntities.has(store)) continue;
                entities[store] = Array.from(rows.values()).map(clone);
            }
            const snapshot = { format: 'ielts-atlas-data-v2', schemaVersion: 2, scope: selected ? 'partial' : 'full', envelopes, entities };
            snapshot.checksum = checksum({ envelopes, entities });
            return snapshot;
        }
        async installSnapshot(snapshot, options = {}) {
            if (snapshot.checksum !== checksum({ envelopes: snapshot.envelopes, entities: snapshot.entities })) throw new AppDataError('VALIDATION', 'snapshot checksum');
            const token = options.expectedRevisionToken || {};
            for (const [key, expected] of Object.entries(token.documents || {})) {
                const actual = shared.docs.get(key) || null;
                if (Number(actual && actual.revision || 0) !== Number(expected || 0)) {
                    throw new AppDataError('CONFLICT', `document revision: ${key}`);
                }
            }
            for (const [store, expectedRows] of Object.entries(token.entities || {})) {
                const actualRows = shared.entities.get(store) || new Map();
                const ids = new Set([...actualRows.keys(), ...Object.keys(expectedRows || {})]);
                for (const id of ids) {
                    const actual = actualRows.get(id) || null;
                    const expected = expectedRows[id] || 0;
                    if (Number(actual && actual.revision || 0) !== Number(expected || 0)) {
                        throw new AppDataError('CONFLICT', `entity revision: ${store}/${id}`);
                    }
                }
            }
            const nextDocs = new Map(shared.docs);
            const nextEntities = new Map(Array.from(shared.entities, ([store, rows]) => [store, new Map(rows)]));
            for (const [key, value] of Object.entries(snapshot.envelopes)) nextDocs.set(key, clone(value));
            for (const [store, rows] of Object.entries(snapshot.entities)) nextEntities.set(store, new Map(rows.map((row) => [String(row.recordId), clone(row)])));
            shared.docs = nextDocs; shared.entities = nextEntities; shared.lastInstallOptions = clone(options);
            return { committed: true, operationId: options.operationId || `install-${++shared.counter}`, revisions: {}, derived: { status: 'ready', pending: [] }, warnings: [] };
        }
        onCommitted() { return () => {}; }
        status() { return { state: this.state, backend: this.backend, failure: null }; }
    }
    const internals = { DataKernel: Kernel, AppDataError, catalog, clone, checksum, parseLegacyValue, randomId: (prefix) => `${prefix}-${++shared.counter}`, nowIso: () => new Date().toISOString(), makeEnvelope: (entry, data, options = {}) => envelope(entry.logicalKey, data, options.state, options.revision, options.operationId), validateEnvelope: (entry, value) => Boolean(value && value.schemaVersion === 2 && value.checksum === checksum(value.data)) };
    const sandbox = { console, Date, JSON, Math, Map, Set, Promise, structuredClone, __AppDataV2Internals: internals, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } }; sandbox.window = sandbox; sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox); vm.runInContext(recordSource, context, { filename: 'practiceRecordSource.js' }); vm.runInContext(appDataSource, context, { filename: 'appData.js' }); return { app: sandbox.AppData, shared, envelope };
}

async function run() {
    const { app, shared, envelope } = harness(); await app.ready;
    const huge = 'x'.repeat(20000);
    const completed = await app.practice.completeAttempt({ operationId: 'complete', record: { id: 'r1', examId: 'reading-1', type: 'reading', title: 'Test', totalQuestions: 2, correctAnswers: 1, answers: { 1: 'A' }, answerMap: { 2: 'B' }, answerList: [{ questionId: '3', answer: 'C' }], correctAnswerMap: { 1: 'B' }, answerDetails: huge, scoreInfo: { band: 7 }, markedQuestions: ['q1'], highlights: [{ text: huge }], notes: { q1: huge }, interactions: [{ type: 'click' }], metadata: { examId: 'reading-1', examTitle: 'Reading 1', category: 'academic', frequency: 4, libraryConfigurationId: 'library-1', privatePayload: huge }, realData: { rawData: { token: huge }, answers: { 1: 'wrong', 4: 'D' }, answerMap: { 5: 'E' } }, rawData: { shouldNotPersist: huge, answers: { 6: 'F' }, answerMap: { 7: 'G' }, realData: { answers: { 8: 'H' } } } } });
    assert.strictEqual(completed.record.answers[1], 'A');
    const overloadedScore = await app.practice.completeAttempt({
        operationId: 'complete-overloaded-score',
        record: {
            id: 'r-overloaded-score',
            examId: 'reading-overloaded',
            type: 'reading',
            correctAnswers: { q1: 'A', q2: 'B' },
            correctAnswerMap: {},
            scoreInfo: { correct: 1, total: 2, accuracy: 0.5 }
        }
    });
    assert.strictEqual(overloadedScore.record.correctAnswers, 1, 'object answer map must not replace the numeric score');
    assert.strictEqual(overloadedScore.record.totalQuestions, 2, 'scoreInfo.total must supply the canonical question count');
    assert.deepStrictEqual(overloadedScore.record.correctAnswerMap, { q1: 'A', q2: 'B' }, 'the overloaded answer map must be preserved in detail');
    const zeroScore = await app.practice.completeAttempt({
        operationId: 'complete-zero-score',
        record: { id: 'r-zero-score', type: 'listening', correctAnswers: -1, scoreInfo: { correct: 0, total: 1 } }
    });
    assert.strictEqual(zeroScore.record.correctAnswers, 0, 'a valid zero score must survive fallback selection');
    await assert.rejects(
        () => app.practice.completeAttempt({ operationId: 'complete-invalid-score', record: { id: 'r-invalid-score', type: 'reading', correctAnswers: -1 } }),
        { code: 'VALIDATION' }
    );
    const summary = shared.entities.get('practiceSummaries').get('r1').data;
    const detail = shared.entities.get('practiceDetails').get('r1').data;
    const annotations = shared.entities.get('practiceAnnotations').get('r1').data;
    assert(!Object.prototype.hasOwnProperty.call(summary, 'answers')); assert(!Object.prototype.hasOwnProperty.call(summary, 'answerDetails')); assert(!Object.prototype.hasOwnProperty.call(summary, 'notes')); assert(!Object.prototype.hasOwnProperty.call(summary.metadata, 'privatePayload')); assert.deepStrictEqual(summary.metadata, { examId: 'reading-1', examTitle: 'Reading 1', category: 'academic', frequency: 4, libraryConfigurationId: 'library-1' }); assert(JSON.stringify(summary).length < 3000, 'large fields must not enter summary');
    assert.deepStrictEqual(detail.answers, { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E', 6: 'F', 7: 'G', 8: 'H' }, 'all compatibility aliases must converge on Detail.answers with canonical values winning conflicts');
    assert(!Object.prototype.hasOwnProperty.call(detail, 'answerMap'));
    assert(!Object.prototype.hasOwnProperty.call(detail, 'answerList'));
    assert(!Object.prototype.hasOwnProperty.call(annotations, 'answers'));
    assert(!JSON.stringify(detail).includes('realData') && !JSON.stringify(detail).includes('rawData')); assert(!JSON.stringify(annotations).includes('realData') && !JSON.stringify(annotations).includes('rawData'));
    shared.reads = []; shared.lists = []; await app.practice.list({ projection: 'light' }); assert.deepStrictEqual(shared.lists, ['practiceSummaries']); assert.deepStrictEqual(shared.reads, []);
    shared.reads = []; await app.practice.get('r1', { projection: 'detail' }); assert.deepStrictEqual(shared.reads, ['practiceSummaries', 'practiceDetails']);
    shared.reads = []; const full = await app.practice.get('r1'); assert.deepStrictEqual(shared.reads, ['practiceSummaries', 'practiceDetails', 'practiceAnnotations']); assert.strictEqual(full.notes.q1, huge);
    assert.deepStrictEqual(full.answers, detail.answers);
    const writes = shared.mutations.at(-1); assert.strictEqual(writes.length, 3); assert.deepStrictEqual(new Set(writes.map((item) => item.store)), new Set(['practiceSummaries', 'practiceDetails', 'practiceAnnotations']));
    const summaryRevision = shared.entities.get('practiceSummaries').get('r1').revision;
    const detailRevision = shared.entities.get('practiceDetails').get('r1').revision;
    const annotationRevision = shared.entities.get('practiceAnnotations').get('r1').revision;
    await app.practice.updateAnnotations({ recordId: 'r1', examId: 'reading-1', expectedRevision: annotationRevision, patch: { reviewed: true } });
    assert.deepStrictEqual(shared.mutations.at(-1).map((item) => item.store), ['practiceAnnotations'], 'annotation edits must write only the Annotation layer');
    assert.strictEqual(shared.entities.get('practiceSummaries').get('r1').revision, summaryRevision);
    assert.strictEqual(shared.entities.get('practiceDetails').get('r1').revision, detailRevision);
    assert.strictEqual(shared.entities.get('practiceAnnotations').get('r1').revision, annotationRevision + 1);
    const suiteLight = app.practice.projectLight({
        id: 'suite-light',
        type: 'reading-suite',
        suiteEntries: [{
            examId: 'reading-child',
            title: 'Child',
            correctAnswers: { q1: 'A', q2: 'B' },
            scoreInfo: { correct: 1, total: 2 },
            answers: { 1: 'A' },
            notes: { 1: 'private' },
            replay: { html: '<secret>' }
        }]
    });
    assert.deepStrictEqual(suiteLight.suiteEntrySummaries.map((entry) => entry.examId), ['reading-child']);
    assert.strictEqual(suiteLight.suiteEntrySummaries[0].correctAnswers, 1);
    assert.strictEqual(suiteLight.suiteEntrySummaries[0].totalQuestions, 2);
    assert.strictEqual(suiteLight.suiteEntrySummaries[0].accuracy, 0.5);
    assert.strictEqual(suiteLight.suiteEntrySummaries[0].type, 'reading');
    assert(!JSON.stringify(suiteLight.suiteEntrySummaries).includes('answers'));
    assert(!JSON.stringify(suiteLight.suiteEntrySummaries).includes('private'));
    const insightRecord = app.practice.projectLight({
        id: 'reading-insight',
        type: 'reading',
        questionTypePerformance: {
            true_false_not_given: { total: 3, correct: 1 },
            short_answer: { totalQuestions: 2, correctAnswers: 1 }
        }
    });
    assert.deepStrictEqual(
        insightRecord.questionTypeErrorCounts,
        { true_false_not_given: 2, short_answer: 1 },
        'light projection must retain compact error counts without answer content'
    );
    const insightSuite = app.practice.projectLight({
        id: 'suite-insight',
        type: 'suite',
        suiteEntries: [{
            examId: 'reading-suite-entry',
            type: 'reading',
            scoreInfo: {
                details: {
                    q1: { isCorrect: false, questionType: 'matching_headings' },
                    q2: { isCorrect: true, questionType: 'matching_headings' }
                }
            }
        }]
    });
    assert.deepStrictEqual(
        insightSuite.suiteEntrySummaries[0].questionTypeErrorCounts,
        { matching_headings: 1 },
        'suite entry light projection must retain compact error counts after child deletion'
    );
    const suiteHarness = harness();
    await suiteHarness.app.ready;
    await suiteHarness.app.practice.completeAttempt({
        operationId: 'suite-child',
        record: { id: 'record_suite-child-session', sessionId: 'suite-child-session', type: 'reading', answers: { q1: 'A' } }
    });
    await suiteHarness.app.practice.finalizeSuite({
        operationId: 'suite-finalize',
        childSessionIds: ['suite-child-session'],
        record: { id: 'suite-parent', sessionId: 'suite-parent', type: 'reading', suiteEntries: [{ examId: 'reading-child' }] }
    });
    for (const store of ['practiceSummaries', 'practiceDetails', 'practiceAnnotations']) {
        assert.strictEqual(suiteHarness.shared.entities.get(store).has('record_suite-child-session'), false, `${store} child row must be removed by sessionId`);
        assert.strictEqual(suiteHarness.shared.entities.get(store).has('suite-parent'), true, `${store} aggregate row must remain`);
    }
    const historicalHarness = harness();
    historicalHarness.shared.entities.get('practiceSummaries').set('historical-insight', {
        recordId: 'historical-insight',
        revision: 1,
        operationId: 'historical-summary',
        updatedAt: '2026-01-01T00:00:00.000Z',
        data: {
            id: 'historical-insight',
            sessionId: 'historical-insight',
            type: 'reading',
            date: '2026-01-01T00:00:00.000Z'
        },
        checksum: checksum({
            id: 'historical-insight',
            sessionId: 'historical-insight',
            type: 'reading',
            date: '2026-01-01T00:00:00.000Z'
        })
    });
    historicalHarness.shared.entities.get('practiceDetails').set('historical-insight', {
        recordId: 'historical-insight',
        revision: 1,
        operationId: 'historical-detail',
        updatedAt: '2026-01-01T00:00:00.000Z',
        data: {
            recordId: 'historical-insight',
            questionTypePerformance: {
                matching_information: { total: 2, correct: 1 }
            }
        },
        checksum: checksum({
            recordId: 'historical-insight',
            questionTypePerformance: {
                matching_information: { total: 2, correct: 1 }
            }
        })
    });
    historicalHarness.shared.entities.get('practiceAnnotations').set('historical-insight', {
        recordId: 'historical-insight',
        revision: 1,
        operationId: 'historical-annotations',
        updatedAt: '2026-01-01T00:00:00.000Z',
        data: { recordId: 'historical-insight' },
        checksum: checksum({ recordId: 'historical-insight' })
    });
    historicalHarness.shared.reads = [];
    const historicalInsights = await historicalHarness.app.practice.listInsights({ limit: 10 });
    const historicalInsight = historicalInsights.find((record) => record.id === 'historical-insight');
    assert.deepStrictEqual(
        historicalInsight.questionTypeErrorCounts,
        { matching_information: 1 },
        'historical summaries must receive a bounded detail-backed insight projection'
    );
    assert.deepStrictEqual(
        historicalHarness.shared.reads,
        ['practiceDetails'],
        'insight backfill may read only the bounded missing detail, never annotations'
    );
    shared.reads = []; shared.lists = []; await app.practice.getStats(); assert.deepStrictEqual(shared.lists, ['practiceSummaries']); assert.deepStrictEqual(shared.reads, []);
    shared.reads = []; shared.lists = []; await app.achievements.getAll(); assert.deepStrictEqual(shared.lists, ['practiceSummaries']); assert.deepStrictEqual(shared.reads, []);
    const durableAchievements = harness();
    await durableAchievements.app.practice.completeAttempt({
        operationId: 'durable-achievement-record',
        record: {
            id: 'achievement-record',
            type: 'reading',
            completedAt: '2026-01-02T00:00:00.000Z',
            totalQuestions: 1,
            correctAnswers: 1
        }
    });
    const firstUnlock = await durableAchievements.app.achievements.getAll();
    assert.strictEqual(firstUnlock.first_step.unlockedAt, '2026-01-02T00:00:00.000Z');
    await durableAchievements.app.practice.clear();
    const retainedUnlock = await durableAchievements.app.achievements.getAll();
    assert.strictEqual(
        retainedUnlock.first_step.unlockedAt,
        firstUnlock.first_step.unlockedAt,
        'deleting source records must not relock a persisted achievement'
    );
    assert(durableAchievements.shared.docs.has('achievements.progress'), 'achievement progress must be durable');
    const backup = await app.backups.create({ id: 'b1' }); assert.deepStrictEqual(Object.keys(backup.data.entities).sort(), ['practiceAnnotations', 'practiceDetails', 'practiceSummaries']);
    const exported = await app.backups.export(); assert.deepStrictEqual(Object.keys(exported.entities).sort(), ['practiceAnnotations', 'practiceDetails', 'practiceSummaries']);
    await app.practice.clear(); assert.strictEqual(shared.mutations.at(-1).length, 3);
    const importPlan = await app.backups.previewImport(exported, { replace: true });
    await app.backups.commitImport(importPlan.id, { confirmDestructive: true });
    assert.strictEqual(shared.lastInstallOptions.resetJournal, true, 'full replacement imports must reset stale operation-journal entries');
    assert.strictEqual((await app.practice.get('r1')).answers[1], 'A');
    const stalePlan = await app.backups.previewImport(exported, { replace: true });
    const annotationRevisionBeforeStaleCommit = shared.entities.get('practiceAnnotations').get('r1').revision;
    await app.practice.updateAnnotations({
        recordId: 'r1',
        examId: 'reading-1',
        expectedRevision: annotationRevisionBeforeStaleCommit,
        patch: { createdDuringImportConfirmation: true }
    });
    await assert.rejects(
        () => app.backups.commitImport(stalePlan.id, { confirmDestructive: true }),
        { code: 'CONFLICT' },
        'commitImport must reject a plan built before a concurrent practice edit'
    );
    assert.strictEqual(
        shared.entities.get('practiceAnnotations').get('r1').data.createdDuringImportConfirmation,
        true,
        'a stale import must not erase the concurrent practice edit'
    );
    const partial = { format: 'ielts-atlas-data-v2', schemaVersion: 2, scope: 'partial', envelopes: {}, entities: { practiceSummaries: [] } }; partial.checksum = checksum({ envelopes: partial.envelopes, entities: partial.entities });
    await assert.rejects(() => app.backups.previewImport(partial, { replace: true }), { code: 'VALIDATION' });
    const orphanMerge = clone(partial);
    orphanMerge.entities.practiceSummaries = [{
        recordId: 'orphan',
        revision: 1,
        operationId: 'orphan-import',
        updatedAt: new Date().toISOString(),
        data: { id: 'orphan', type: 'reading' },
        checksum: checksum({ id: 'orphan', type: 'reading' })
    }];
    orphanMerge.checksum = checksum({ envelopes: orphanMerge.envelopes, entities: orphanMerge.entities });
    await assert.rejects(() => app.backups.previewImport(orphanMerge, { practiceMode: 'merge' }), { code: 'VALIDATION' });
    await app.settings.patch({ lateSetting: true });
    await app.vocab.saveWords([{ id: 'late-word', word: 'late-word' }]);
    await app.goals.save({ id: 'late-goal', title: 'Late goal' });
    await app.preferences.setTheme('late-theme');
    await app.backups.restore('b1');
    assert.strictEqual((await app.practice.get('r1')).answers[1], 'A');
    assert.deepStrictEqual(await app.settings.getAll(), {});
    assert.deepStrictEqual(await app.vocab.listWords(), []);
    assert.deepStrictEqual(await app.goals.list(), []);
    assert.deepStrictEqual(await app.preferences.getAll(), {});
    assert.strictEqual(shared.lastInstallOptions.resetJournal, true);
    assert.deepStrictEqual(
        new Set(Array.from(shared.entities, ([store, rows]) => `${store}:${Array.from(rows.keys()).sort().join(',')}`)),
        new Set([
            'practiceSummaries:r-overloaded-score,r-zero-score,r1',
            'practiceDetails:r-overloaded-score,r-zero-score,r1',
            'practiceAnnotations:r-overloaded-score,r-zero-score,r1'
        ])
    );
    await Promise.all([
        app.vocab.upsertCollectionWord('highlights', { word: 'alpha' }),
        app.vocab.upsertCollectionWord('highlights', { word: 'beta' })
    ]);
    assert.deepStrictEqual(
        (await app.vocab.readList('highlights')).words.map((word) => word.word).sort(),
        ['alpha', 'beta']
    );
    shared.failEntityStore = 'practiceDetails'; await assert.rejects(() => app.practice.completeAttempt({ record: { id: 'r2', type: 'reading' } }), { code: 'IO' }); assert.strictEqual(shared.entities.get('practiceSummaries').has('r2'), false); assert.strictEqual(shared.entities.get('practiceDetails').has('r2'), false); assert.strictEqual(shared.entities.get('practiceAnnotations').has('r2'), false);
    await assert.rejects(() => app.practice.delete('r1'), { code: 'IO' }); assert.strictEqual(shared.entities.get('practiceSummaries').has('r1'), true); assert.strictEqual(shared.entities.get('practiceDetails').has('r1'), true); assert.strictEqual(shared.entities.get('practiceAnnotations').has('r1'), true); shared.failEntityStore = null;
    await Promise.all([
        app.preferences.setTheme('dark'),
        app.preferences.setConsent({ accepted: true }),
        app.preferences.setBrowse({ category: 'reading' }),
        app.preferences.setOnboarding({ completed: true }),
        app.preferences.setThreeBackground('aurora'),
        app.preferences.setThemePortal({ open: false }),
        app.preferences.setPracticeWidget('compact'),
        app.preferences.setLogConfig({ level: 'warn' }),
        app.preferences.setCandidateCode({ mode: 'auto' }),
        app.preferences.setReadingDisplay({ fontSize: 18 }),
        app.preferences.setSuite({ autoAdvance: true }),
        app.preferences.setResourceBasePrefix('./')
    ]);
    const concurrentPreferences = await app.preferences.getAll();
    assert.strictEqual(concurrentPreferences.theme, 'dark');
    assert.strictEqual(concurrentPreferences.consent.accepted, true);
    assert.strictEqual(concurrentPreferences.browse.category, 'reading');
    assert.strictEqual(concurrentPreferences.logConfig.level, 'warn');
    await Promise.all(Array.from({ length: 8 }, (_, index) => app.recovery.saveActiveSession({
        id: `active-${index}`,
        sessionId: `session-${index}`,
        examId: `exam-${index}`
    })));
    assert.deepStrictEqual(
        (await app.recovery.listActiveSessions()).map((item) => item.id).sort(),
        Array.from({ length: 8 }, (_, index) => `active-${index}`)
    );
    let rejectedDraftGuardCalls = 0;
    const rejectedDraft = await app.recovery.saveDraft({
        id: 'reading-draft:guarded',
        examId: 'reading-guarded',
        kind: 'reading_draft'
    }, {
        commitGuard() {
            rejectedDraftGuardCalls += 1;
            return false;
        }
    });
    assert.strictEqual(rejectedDraft.committed, false);
    assert.strictEqual(rejectedDraft.code, 'STALE_RECOVERY_WRITE');
    assert.strictEqual(rejectedDraft.reason, 'COMMIT_GUARD_REJECTED');
    assert.strictEqual(rejectedDraftGuardCalls, 1);
    assert.strictEqual(await app.recovery.getDraft('reading-draft:guarded'), null, 'rejected commit guards must not write recovery drafts');
    const acceptedDraft = await app.recovery.saveDraft({
        id: 'reading-draft:guarded',
        examId: 'reading-guarded',
        kind: 'reading_draft'
    }, { commitGuard: () => true });
    assert.strictEqual(acceptedDraft.committed, true);
    assert(await app.recovery.getDraft('reading-draft:guarded'));
    await app.recovery.discardDraft('reading-draft:guarded');
    assert.deepStrictEqual(
        { ...(await app.recovery.getActiveSessionFence('active-never-persisted')) },
        { id: 'active-never-persisted', exists: false, tombstoned: false, revision: 0 }
    );
    assert.strictEqual((await app.recovery.saveActiveSession({
        id: 'active-discard-guard',
        revision: 1,
        marker: 'guarded-owner'
    }, { expectedEntityRevision: 0 })).committed, true);
    let rejectedDiscardGuardCalls = 0;
    const rejectedDiscard = await app.recovery.discardActiveSession('active-discard-guard', {
        expectedEntityRevision: 1,
        commitGuard() {
            rejectedDiscardGuardCalls += 1;
            return false;
        }
    });
    assert.strictEqual(rejectedDiscard.committed, false);
    assert.strictEqual(rejectedDiscard.code, 'STALE_RECOVERY_WRITE');
    assert.strictEqual(rejectedDiscard.reason, 'COMMIT_GUARD_REJECTED');
    assert.strictEqual(rejectedDiscardGuardCalls, 1);
    assert(await app.recovery.getActiveSession('active-discard-guard'), 'a rejected discard guard must not write a tombstone');
    const acceptedDiscard = await app.recovery.discardActiveSession('active-discard-guard', {
        expectedEntityRevision: 1,
        commitGuard: () => true
    });
    assert.strictEqual(acceptedDiscard.committed, true);
    assert.strictEqual(await app.recovery.getActiveSession('active-discard-guard'), null);
    assert.deepStrictEqual(
        { ...(await app.recovery.getActiveSessionFence('active-discard-guard')) },
        { id: 'active-discard-guard', exists: true, tombstoned: true, revision: 2 }
    );
    const casFirst = await app.recovery.saveActiveSession({
        id: 'active-cas',
        revision: 1,
        lastUpdate: 100,
        marker: 'first'
    }, { expectedEntityRevision: 0 });
    assert.strictEqual(casFirst.committed, true);
    assert.deepStrictEqual(
        { ...(await app.recovery.getActiveSessionFence('active-cas')) },
        { id: 'active-cas', exists: true, tombstoned: false, revision: 1 },
        'the public recovery fence must expose the live raw first owner revision'
    );
    const casSecond = await app.recovery.saveActiveSession({
        id: 'active-cas',
        revision: 2,
        lastUpdate: 200,
        marker: 'second'
    }, { expectedEntityRevision: 1 });
    assert.strictEqual(casSecond.committed, true);
    await assert.rejects(() => app.recovery.saveActiveSession({
        id: 'active-cas',
        revision: 2,
        lastUpdate: 250,
        marker: 'non-advancing'
    }, { expectedEntityRevision: 2 }), { code: 'VALIDATION' });
    for (const invalidRevision of [1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        const corruptId = `active-cas-invalid-${String(invalidRevision)}`;
        const corruptSave = await app.recovery.saveActiveSession({
            id: corruptId,
            revision: invalidRevision,
            marker: 'corrupt-revision'
        });
        assert.strictEqual(corruptSave.committed, true);
        const repairedSave = await app.recovery.saveActiveSession({
            id: corruptId,
            revision: 1,
            marker: 'repaired-revision'
        }, { expectedEntityRevision: 0 });
        assert.strictEqual(repairedSave.committed, true, 'invalid actual recovery revisions must normalize to zero');
        assert.strictEqual((await app.recovery.getActiveSession(corruptId)).marker, 'repaired-revision');
        await assert.rejects(() => app.recovery.saveActiveSession({
            id: `${corruptId}-invalid-expected`,
            revision: 1
        }, { expectedEntityRevision: invalidRevision }), { code: 'VALIDATION' });
        await app.recovery.discardActiveSession(corruptId, { expectedEntityRevision: 1 });
    }
    const maxSafeId = 'active-cas-max-safe';
    assert.strictEqual((await app.recovery.saveActiveSession({
        id: maxSafeId,
        revision: Number.MAX_SAFE_INTEGER
    }, { expectedEntityRevision: 0 })).committed, true);
    assert.strictEqual((await app.recovery.discardActiveSession(maxSafeId, {
        expectedEntityRevision: Number.MAX_SAFE_INTEGER
    })).committed, true);
    const delayedAfterMaxSafeDiscard = await app.recovery.saveActiveSession({
        id: maxSafeId,
        revision: 1
    }, { expectedEntityRevision: 0 });
    assert.strictEqual(delayedAfterMaxSafeDiscard.committed, false);
    assert.strictEqual(delayedAfterMaxSafeDiscard.actualEntityRevision, Number.MAX_SAFE_INTEGER);
    const staleSave = await app.recovery.saveActiveSession({
        id: 'active-cas',
        revision: 99,
        lastUpdate: 999,
        marker: 'stale-tab'
    }, { expectedEntityRevision: 1 });
    assert.strictEqual(staleSave.committed, false, 'stale tabs must not overwrite a newer active-session entity');
    assert.strictEqual(staleSave.code, 'STALE_RECOVERY_WRITE');
    assert.strictEqual(staleSave.item, undefined, 'stale receipt must not expose another tab current entity as the saved item');
    assert.strictEqual((await app.recovery.getActiveSession('active-cas')).marker, 'second');
    const staleDiscard = await app.recovery.discardActiveSession('active-cas', { expectedEntityRevision: 1 });
    assert.strictEqual(staleDiscard.committed, false, 'stale tabs must not discard a newer active-session entity');
    assert(await app.recovery.getActiveSession('active-cas'));
    const currentDiscard = await app.recovery.discardActiveSession('active-cas', { expectedEntityRevision: 2 });
    assert.strictEqual(currentDiscard.committed, true);
    assert.strictEqual(await app.recovery.getActiveSession('active-cas'), null);
    assert.deepStrictEqual(
        { ...(await app.recovery.getActiveSessionFence('active-cas')) },
        { id: 'active-cas', exists: true, tombstoned: true, revision: 3 },
        'active-session reads hide a CAS tombstone while the fence preserves its completion proof'
    );
    const delayedFirstSave = await app.recovery.saveActiveSession({
        id: 'active-cas',
        revision: 1,
        lastUpdate: 50,
        marker: 'delayed-first-save'
    }, { expectedEntityRevision: 0 });
    assert.strictEqual(delayedFirstSave.committed, false, 'discard tombstone must reject a delayed cross-realm first save');
    assert.strictEqual(delayedFirstSave.code, 'STALE_RECOVERY_WRITE');
    assert.strictEqual(await app.recovery.getActiveSession('active-cas'), null);
    const tombstoneCleanup = await app.recovery.cleanupForRetry({
        discardable: { activeSession: ['active-cas'] }
    });
    assert.deepStrictEqual(Array.from(tombstoneCleanup.removedByKind.activeSession), [], 'cleanup must retain CAS tombstones');
    const delayedAfterCleanup = await app.recovery.saveActiveSession({
        id: 'active-cas',
        revision: 1,
        lastUpdate: 60,
        marker: 'delayed-after-cleanup'
    }, { expectedEntityRevision: 0 });
    assert.strictEqual(delayedAfterCleanup.committed, false, 'cleanup must not reopen a discarded entity revision');
    const recoveryKey = 'recovery.activeSessions';
    const mutateRawActiveSessions = (operationId, mutate) => {
        const current = shared.docs.get(recoveryKey);
        const items = clone(current && current.data || []);
        mutate(items);
        shared.docs.set(recoveryKey, envelope(
            recoveryKey,
            items,
            'present',
            Number(current && current.revision || 0) + 1,
            operationId
        ));
        return items;
    };
    const rawActiveSessionsFor = (id) => clone(shared.docs.get(recoveryKey)?.data || [])
        .filter((item) => String(item && (item.id || item.sessionId || item.recordId) || '') === String(id));
    const shadowedByTombstoneId = 'active-shadowed-by-tombstone';
    assert.strictEqual((await app.recovery.saveActiveSession({
        id: shadowedByTombstoneId,
        revision: 1,
        marker: 'original-owner'
    }, { expectedEntityRevision: 0 })).committed, true);
    assert.strictEqual((await app.recovery.discardActiveSession(shadowedByTombstoneId, {
        expectedEntityRevision: 1
    })).committed, true);
    const duplicateOwnerDocument = shared.docs.get(recoveryKey);
    const duplicateOwnerItems = clone(duplicateOwnerDocument.data);
    duplicateOwnerItems.push({
        id: shadowedByTombstoneId,
        revision: 9,
        marker: 'later-imported-duplicate',
        updatedAt: new Date().toISOString()
    });
    shared.docs.set(recoveryKey, envelope(
        recoveryKey,
        duplicateOwnerItems,
        'present',
        duplicateOwnerDocument.revision + 1,
        'append-shadowed-recovery-duplicate'
    ));
    assert.strictEqual(
        (await app.recovery.listActiveSessions()).some((item) => item.id === shadowedByTombstoneId),
        false,
        'a later duplicate must not become visible when the raw first owner is a tombstone'
    );
    assert.strictEqual(await app.recovery.getActiveSession(shadowedByTombstoneId), null);
    assert.deepStrictEqual(
        { ...(await app.recovery.getActiveSessionFence(shadowedByTombstoneId)) },
        { id: shadowedByTombstoneId, exists: true, tombstoned: true, revision: 2 },
        'the fence must keep the raw first tombstone authoritative over a later duplicate'
    );
    const shadowedDuplicateSave = await app.recovery.saveActiveSession({
        id: shadowedByTombstoneId,
        revision: 10,
        marker: 'must-not-revive'
    }, { expectedEntityRevision: 9 });
    assert.strictEqual(shadowedDuplicateSave.committed, false);
    assert.strictEqual(shadowedDuplicateSave.actualEntityRevision, 2, 'CAS must still target the hidden first tombstone');
    const visibleMarkerOwnerId = 'active-visible-shadow-marker';
    assert.strictEqual((await app.recovery.saveActiveSession({
        id: visibleMarkerOwnerId,
        revision: 1,
        schema: 'suite-session-v2',
        marker: 'first-visible-owner'
    }, { expectedEntityRevision: 0 })).committed, true);
    const visibleMarkerDocument = shared.docs.get(recoveryKey);
    const visibleMarkerItems = clone(visibleMarkerDocument.data);
    visibleMarkerItems.push({
        id: visibleMarkerOwnerId,
        revision: 8,
        schema: 'multi-suite-sessions-v2',
        version: 2,
        sessions: [{ id: 'shadow-marker', baseExamId: 'shadow-marker-base' }],
        updatedAt: new Date().toISOString()
    });
    shared.docs.set(recoveryKey, envelope(
        recoveryKey,
        visibleMarkerItems,
        'present',
        visibleMarkerDocument.revision + 1,
        'append-visible-recovery-marker'
    ));
    assert.strictEqual(
        (await app.recovery.listActiveSessions()).filter((item) => item.id === visibleMarkerOwnerId).length,
        2,
        'non-tombstone shadow entries must remain visible for raw recovery marker reconciliation'
    );
    await app.recovery.discardActiveSession(visibleMarkerOwnerId);
    const recoveryDocument = shared.docs.get(recoveryKey);
    const expiredRecoveryItems = clone(recoveryDocument.data);
    const expiredTombstone = expiredRecoveryItems.find((item) => item && item.id === 'active-cas');
    expiredTombstone.updatedAt = new Date(Date.now() - (31 * 24 * 60 * 60 * 1000)).toISOString();
    shared.docs.set(recoveryKey, envelope(
        recoveryKey,
        expiredRecoveryItems,
        'present',
        recoveryDocument.revision + 1,
        'expire-recovery-tombstone'
    ));
    const expiredTombstoneCleanup = await app.recovery.cleanupForRetry();
    assert.deepStrictEqual(
        Array.from(expiredTombstoneCleanup.removedByKind.activeSession),
        ['active-cas'],
        'existing recovery TTL must remove tombstones older than 30 days'
    );
    const recreatedAfterTtl = await app.recovery.saveActiveSession({
        id: 'active-cas',
        revision: 1,
        marker: 'recreated-after-ttl'
    }, { expectedEntityRevision: 0 });
    assert.strictEqual(recreatedAfterTtl.committed, true);

    // A. Exclusive suite ownership is derived from the raw first owner only.
    const saveSingleSuiteClaim = (id, revision = 1, expectedEntityRevision = 0, marker = '') => (
        app.recovery.saveActiveSession({
            id,
            revision,
            schema: 'suite-session-v2',
            version: 2,
            marker
        }, { expectedEntityRevision, exclusiveGroup: 'suite-practice' })
    );
    const saveMultiSuiteRecovery = (id, marker = '') => app.recovery.saveActiveSession({
        id,
        revision: 1,
        schema: 'multi-suite-sessions-v2',
        version: 2,
        sessions: [],
        marker
    }, { expectedEntityRevision: 0 });

    const legacyUntaggedSuiteId = 'suite-legacy-untagged-first-owner';
    mutateRawActiveSessions('append-legacy-untagged-suite-owner', (items) => {
        items.push({
            id: legacyUntaggedSuiteId,
            revision: 1,
            schema: 'suite-session-v2',
            version: 2,
            marker: 'legacy-untagged-first-owner',
            updatedAt: new Date().toISOString()
        });
    });
    const blockedByLegacyOwner = await saveSingleSuiteClaim('suite-blocked-by-legacy-owner');
    assert.strictEqual(blockedByLegacyOwner.committed, false, 'legacy untagged suite-session-v2 must occupy the singleton suite group');
    assert.strictEqual(blockedByLegacyOwner.code, 'RECOVERY_GROUP_CONFLICT');
    assert.strictEqual(blockedByLegacyOwner.conflictingEntityId, legacyUntaggedSuiteId);
    await app.recovery.discardActiveSession(legacyUntaggedSuiteId);

    const multiBeforeSingleId = 'multi-suite-before-single';
    const singleAfterMultiId = 'single-suite-after-multi';
    assert.strictEqual((await saveMultiSuiteRecovery(multiBeforeSingleId, 'multi-first')).committed, true);
    assert.strictEqual(
        (await saveSingleSuiteClaim(singleAfterMultiId, 1, 0, 'single-second')).committed,
        true,
        'multi-suite schema must not occupy the singleton suite-practice group'
    );
    assert(await app.recovery.getActiveSession(multiBeforeSingleId));
    assert(await app.recovery.getActiveSession(singleAfterMultiId));
    await app.recovery.discardActiveSession(multiBeforeSingleId);
    await app.recovery.discardActiveSession(singleAfterMultiId);

    const singleBeforeMultiId = 'single-suite-before-multi';
    const multiAfterSingleId = 'multi-suite-after-single';
    assert.strictEqual((await saveSingleSuiteClaim(singleBeforeMultiId, 1, 0, 'single-first')).committed, true);
    assert.strictEqual(
        (await saveMultiSuiteRecovery(multiAfterSingleId, 'multi-second')).committed,
        true,
        'an active singleton suite must not block an independent multi-suite recovery'
    );
    assert(await app.recovery.getActiveSession(singleBeforeMultiId));
    assert(await app.recovery.getActiveSession(multiAfterSingleId));
    await app.recovery.discardActiveSession(singleBeforeMultiId);
    await app.recovery.discardActiveSession(multiAfterSingleId);

    const sameIdSuiteOwner = 'suite-same-id-raw-duplicate';
    assert.strictEqual((await saveSingleSuiteClaim(sameIdSuiteOwner, 1, 0, 'raw-first')).committed, true);
    mutateRawActiveSessions('append-same-id-suite-duplicate', (items) => {
        items.push({
            id: sameIdSuiteOwner,
            revision: 9,
            schema: 'suite-session-v2',
            version: 2,
            _recoveryExclusiveGroup: 'suite-practice',
            marker: 'raw-shadow',
            updatedAt: new Date().toISOString()
        });
    });
    assert.strictEqual(
        (await saveSingleSuiteClaim(sameIdSuiteOwner, 2, 1, 'updated-first-owner')).committed,
        true,
        'a raw duplicate of the same logical id must not conflict with its own suite update'
    );

    // B. The public fence must keep reporting the raw first owner, never its shadow.
    assert.deepStrictEqual(
        { ...(await app.recovery.getActiveSessionFence(sameIdSuiteOwner)) },
        { id: sameIdSuiteOwner, exists: true, tombstoned: false, revision: 2 },
        'a later high-revision duplicate must not replace the live raw first-owner fence'
    );
    await app.recovery.discardActiveSession(sameIdSuiteOwner);

    const tombstonedSuiteOwner = 'suite-tombstoned-first-owner-with-shadow';
    assert.strictEqual((await saveSingleSuiteClaim(tombstonedSuiteOwner, 1, 0, 'tombstone-source')).committed, true);
    assert.strictEqual((await app.recovery.discardActiveSession(tombstonedSuiteOwner, {
        expectedEntityRevision: 1
    })).committed, true);
    mutateRawActiveSessions('append-suite-shadow-after-tombstone', (items) => {
        items.push({
            id: tombstonedSuiteOwner,
            revision: 11,
            schema: 'suite-session-v2',
            version: 2,
            _recoveryExclusiveGroup: 'suite-practice',
            marker: 'must-remain-shadowed',
            updatedAt: new Date().toISOString()
        });
    });
    const claimAfterShadowedTombstone = await saveSingleSuiteClaim('suite-after-shadowed-tombstone');
    assert.strictEqual(
        claimAfterShadowedTombstone.committed,
        true,
        'a suite duplicate shadowed by its first tombstone must not block a different suite id'
    );
    assert.deepStrictEqual(
        { ...(await app.recovery.getActiveSessionFence(tombstonedSuiteOwner)) },
        { id: tombstonedSuiteOwner, exists: true, tombstoned: true, revision: 2 },
        'the tombstone must remain the fence owner when a later live suite duplicate exists'
    );
    await app.recovery.discardActiveSession(tombstonedSuiteOwner);
    await app.recovery.discardActiveSession('suite-after-shadowed-tombstone');

    // C. TTL and retry cleanup operate on whole first-owner logical-id groups.
    const expiredFirstOwnerAt = new Date(Date.now() - (31 * 24 * 60 * 60 * 1000)).toISOString();
    const seedExpiredTombstoneWithFreshShadow = async (id, operationId) => {
        assert.strictEqual((await app.recovery.saveActiveSession({
            id,
            revision: 1,
            marker: 'ttl-first-owner'
        }, { expectedEntityRevision: 0 })).committed, true);
        assert.strictEqual((await app.recovery.discardActiveSession(id, {
            expectedEntityRevision: 1
        })).committed, true);
        mutateRawActiveSessions(operationId, (items) => {
            const firstOwner = items.find((item) => item && item.id === id);
            firstOwner.updatedAt = expiredFirstOwnerAt;
            items.push({
                id,
                revision: 19,
                marker: 'fresh-shadow-must-not-promote',
                updatedAt: new Date().toISOString()
            });
        });
    };

    const ttlFirstOwnerGroupId = 'active-ttl-first-owner-group';
    await seedExpiredTombstoneWithFreshShadow(ttlFirstOwnerGroupId, 'seed-ttl-first-owner-group');
    assert.deepStrictEqual(
        { ...(await app.recovery.getActiveSessionFence(ttlFirstOwnerGroupId)) },
        { id: ttlFirstOwnerGroupId, exists: false, tombstoned: false, revision: 0 },
        'TTL pruning must remove an expired first tombstone and every fresh shadow with the same logical id'
    );
    assert.deepStrictEqual(rawActiveSessionsFor(ttlFirstOwnerGroupId), [], 'TTL pruning must not promote a fresh shadow duplicate');

    const cleanupExpiredGroupId = 'active-cleanup-expired-first-owner-group';
    await seedExpiredTombstoneWithFreshShadow(cleanupExpiredGroupId, 'seed-cleanup-first-owner-group');
    const expiredFirstOwnerGroupCleanup = await app.recovery.cleanupForRetry();
    assert.deepStrictEqual(
        Array.from(expiredFirstOwnerGroupCleanup.removedByKind.activeSession)
            .filter((id) => id === cleanupExpiredGroupId),
        [cleanupExpiredGroupId],
        'retry cleanup must report an expired logical group exactly once'
    );
    assert.deepStrictEqual(rawActiveSessionsFor(cleanupExpiredGroupId), [], 'retry cleanup must remove every shadow of an expired first owner');

    const preservedLogicalGroupId = 'active-cleanup-preserved-logical-group';
    assert.strictEqual((await app.recovery.saveActiveSession({
        id: preservedLogicalGroupId,
        revision: 1,
        marker: 'preserved-first-owner'
    }, { expectedEntityRevision: 0 })).committed, true);
    mutateRawActiveSessions('append-preserved-logical-shadow', (items) => {
        items.push({
            id: preservedLogicalGroupId,
            revision: 7,
            marker: 'preserved-shadow',
            updatedAt: new Date().toISOString()
        });
    });
    const preservedLogicalGroupCleanup = await app.recovery.cleanupForRetry({
        preserve: { activeSession: [preservedLogicalGroupId] },
        discardable: { activeSession: [preservedLogicalGroupId] }
    });
    assert.strictEqual(
        Array.from(preservedLogicalGroupCleanup.removedByKind.activeSession).includes(preservedLogicalGroupId),
        false,
        'preserve must win for the complete logical-id group'
    );
    assert.strictEqual(rawActiveSessionsFor(preservedLogicalGroupId).length, 2, 'preserve must retain the first owner and every raw shadow');
    await app.recovery.discardActiveSession(preservedLogicalGroupId);

    const discardableLogicalGroupId = 'active-cleanup-discardable-logical-group';
    assert.strictEqual((await app.recovery.saveActiveSession({
        id: discardableLogicalGroupId,
        revision: 1,
        marker: 'discardable-first-owner'
    }, { expectedEntityRevision: 0 })).committed, true);
    mutateRawActiveSessions('append-discardable-logical-shadow', (items) => {
        items.push({
            id: discardableLogicalGroupId,
            revision: 8,
            marker: 'discardable-shadow',
            updatedAt: new Date().toISOString()
        });
    });
    const discardableLogicalGroupCleanup = await app.recovery.cleanupForRetry({
        discardable: { activeSession: [discardableLogicalGroupId] }
    });
    assert.deepStrictEqual(
        Array.from(discardableLogicalGroupCleanup.removedByKind.activeSession)
            .filter((id) => id === discardableLogicalGroupId),
        [discardableLogicalGroupId],
        'discardable cleanup must report one removal per logical id instead of one per raw duplicate'
    );
    assert.deepStrictEqual(rawActiveSessionsFor(discardableLogicalGroupId), [], 'discardable cleanup must remove the entire logical-id group');

    const suiteClaimA = await app.recovery.saveActiveSession({
        id: 'suite-claim-a',
        revision: 1,
        schema: 'suite-session-v2'
    }, { expectedEntityRevision: 0, exclusiveGroup: 'suite-practice' });
    assert.strictEqual(suiteClaimA.committed, true);
    const suiteClaimBConflict = await app.recovery.saveActiveSession({
        id: 'suite-claim-b',
        revision: 1,
        schema: 'suite-session-v2'
    }, { expectedEntityRevision: 0, exclusiveGroup: 'suite-practice' });
    assert.strictEqual(suiteClaimBConflict.committed, false, 'only one suite claim may exist across tabs');
    assert.strictEqual(suiteClaimBConflict.code, 'RECOVERY_GROUP_CONFLICT');
    await app.recovery.discardActiveSession('suite-claim-a', { expectedEntityRevision: 1 });
    const suiteClaimBAfterDiscard = await app.recovery.saveActiveSession({
        id: 'suite-claim-b',
        revision: 1,
        schema: 'suite-session-v2'
    }, { expectedEntityRevision: 0, exclusiveGroup: 'suite-practice' });
    assert.strictEqual(suiteClaimBAfterDiscard.committed, true, 'a new suite may claim the group after durable discard');
    const preferencesBeforeRecoveryCleanup = await app.preferences.getAll();
    const practiceBeforeRecoveryCleanup = await app.practice.get('r1');
    const cleanupReceipt = await app.recovery.cleanupForRetry({
        preserve: { activeSession: ['active-0'] },
        discardable: { activeSession: ['active-0', 'active-1'] }
    });
    assert.strictEqual(cleanupReceipt.committed, true);
    assert.strictEqual(cleanupReceipt.removedCount, 1, 'cleanup should remove only explicitly disposable recovery');
    assert.deepStrictEqual(Array.from(cleanupReceipt.removedByKind.activeSession), ['active-1']);
    assert(await app.recovery.getActiveSession('active-0'), 'preserve must win over discardable');
    assert.strictEqual(await app.recovery.getActiveSession('active-1'), null);
    assert.deepStrictEqual(await app.preferences.getAll(), preferencesBeforeRecoveryCleanup, 'recovery cleanup must not touch preferences');
    assert.deepStrictEqual(await app.practice.get('r1'), practiceBeforeRecoveryCleanup, 'recovery cleanup must not touch business records');
    await assert.rejects(() => app.backups.previewImport({ records: [] }), { code: 'VALIDATION' });
    const invalidStore = { format: 'ielts-atlas-data-v2', schemaVersion: 2, scope: 'partial', envelopes: {}, entities: { practiceRecords: [] } }; invalidStore.checksum = checksum({ envelopes: invalidStore.envelopes, entities: invalidStore.entities }); await assert.rejects(() => app.backups.previewImport(invalidStore), { code: 'VALIDATION' });

    // A real-world v2 export produced by the broken whole-IDB-row migration:
    // salvage safe wrappers, quarantine the inconsistent library domain, and
    // never let an empty practice replace commit without a second confirmation.
    await app.library.import({
        id: 'current-library',
        configuration: { name: 'Current library' },
        index: [{ id: 'reading-current' }]
    });
    await app.library.activate('current-library');
    await app.settings.patch({ currentOnly: true });
    const poisoned = {
        format: 'ielts-atlas-data-v2',
        schemaVersion: 2,
        scope: 'full',
        envelopes: {
            'achievements.manual': envelope('achievements.manual', {
                key: 'exam_system_user_achievements',
                value: '{}',
                timestamp: 1
            }),
            'library.activeConfigurationId': envelope('library.activeConfigurationId', '[object Object]'),
            'library.configurations': envelope('library.configurations', []),
            'preferences.values': envelope('preferences.values', {
                key: 'exam_system_settings',
                value: JSON.stringify({ theme: 'must-not-cross-domains' }),
                timestamp: 1
            }),
            'settings.values': envelope('settings.values', {
                key: 'exam_system_settings',
                value: JSON.stringify({ theme: 'light', notifications: true }),
                timestamp: 1,
                postMigrationFlag: true
            }),
            'vocab.userConfig': envelope('vocab.userConfig', {
                key: 'exam_system_vocab_user_config',
                value: JSON.stringify({ dailyNew: 20, reviewLimit: 100 }),
                timestamp: 1
            })
        },
        entities: {
            practiceSummaries: [],
            practiceDetails: [],
            practiceAnnotations: []
        }
    };
    poisoned.checksum = checksum({ envelopes: poisoned.envelopes, entities: poisoned.entities });
    const safePlan = await app.backups.previewImport(poisoned, { practiceMode: 'merge' });
    assert.strictEqual(safePlan.destructive, false);
    assert.strictEqual(safePlan.diagnostics.trust, 'degraded-partial');
    assert(safePlan.diagnostics.repairedKeys.includes('settings.values'));
    assert(safePlan.diagnostics.ignoredKeys.includes('library.activeConfigurationId'));
    assert(safePlan.diagnostics.ignoredKeys.includes('preferences.values'));
    assert(safePlan.diagnostics.missingKeys.includes('library.importedIndexes'));
    assert.strictEqual(safePlan.practice.removedCount, 0);
    await app.backups.commitImport(safePlan.id);
    assert.strictEqual(await app.library.getActive(), 'current-library');
    assert.strictEqual((await app.library.getIndex('current-library'))[0].id, 'reading-current');
    assert.strictEqual((await app.settings.getAll()).theme, 'light');
    assert.strictEqual((await app.settings.getAll()).currentOnly, true);
    assert.strictEqual((await app.settings.getAll()).postMigrationFlag, true);

    const partialLibrary = {
        format: 'ielts-atlas-data-v2',
        schemaVersion: 2,
        scope: 'partial',
        envelopes: {
            'library.activeConfigurationId': envelope('library.activeConfigurationId', null)
        },
        entities: {}
    };
    partialLibrary.checksum = checksum({ envelopes: partialLibrary.envelopes, entities: partialLibrary.entities });
    const partialLibraryPlan = await app.backups.previewImport(partialLibrary, { practiceMode: 'merge' });
    assert(partialLibraryPlan.keys.includes('library.activeConfigurationId'), 'valid partial library keys must not be quarantined');
    assert.deepStrictEqual(partialLibraryPlan.diagnostics.ignoredKeys, []);

    const destructivePlan = await app.backups.previewImport(poisoned, { practiceMode: 'replace' });
    assert.strictEqual(destructivePlan.destructive, true);
    assert(destructivePlan.practice.existingCount > 0);
    assert.strictEqual(destructivePlan.practice.finalCount, 0);
    assert.strictEqual(destructivePlan.practice.removedCount, destructivePlan.practice.existingCount);
    await assert.rejects(() => app.backups.commitImport(destructivePlan.id), { code: 'VALIDATION' });

    // Historical v1 export recognition (opensource practiceRecorder / DataBackupManager shapes).
    await app.practice.completeAttempt({
        operationId: 'keep-existing',
        record: { id: 'keep-me', examId: 'reading-keep', type: 'reading', title: 'Keep', totalQuestions: 1, correctAnswers: 1, answers: { 1: 'Z' } }
    });
    const v1Export = {
        exportDate: '2026-01-01T00:00:00.000Z',
        version: '0.6.2-form',
        practiceRecords: [{
            id: 'legacy-1',
            examId: 'reading-legacy',
            type: 'reading',
            title: 'Legacy Passage',
            metadata: { examTitle: 'Legacy Passage', category: 'P1' },
            realData: {
                answers: { q1: 'A', q2: 'B' },
                scoreInfo: { correct: 1, total: 2, accuracy: 50 },
                highlights: [{ text: 'real-highlight' }],
                notes: { q1: 'real-note' },
                noteText: 'real-note-text',
                interactions: [{ type: 'real-click' }]
            },
            rawData: {
                highlights: [{ text: 'raw-highlight' }],
                noteOutlines: { q1: ['raw-outline'] },
                noteText: 'raw-note-text',
                interactions: [{ type: 'raw-click' }]
            }
        }],
        userStats: { totalPractices: 99 }
    };
    const v1Plan = await app.backups.previewImport(v1Export, { practiceMode: 'merge' });
    assert.strictEqual(v1Plan.format, 'v1');
    assert.strictEqual(v1Plan.practice.importedCount, 1);
    const v1Receipt = await app.backups.commitImport(v1Plan.id);
    assert.strictEqual(v1Receipt.importedCount, 1);
    const legacy = await app.practice.get('legacy-1');
    assert.strictEqual(legacy.answers.q1, 'A');
    assert.strictEqual(legacy.correctAnswers, 1);
    assert.strictEqual(legacy.totalQuestions, 2);
    assert.strictEqual(legacy.accuracy, 0.5);
    assert.strictEqual(legacy.percentage, 50);
    assert.strictEqual(legacy.highlights[0].text, 'real-highlight');
    assert.strictEqual(legacy.notes.q1, 'real-note');
    assert.deepStrictEqual(legacy.noteOutlines.q1, ['raw-outline']);
    assert.strictEqual(legacy.noteText, 'real-note-text');
    assert.strictEqual(legacy.interactions[0].type, 'real-click');
    assert.strictEqual((await app.practice.get('keep-me')).answers[1], 'Z', 'merge must retain existing practice rows');

    const snakePlan = await app.backups.previewImport({
        practice_records: [{ id: 'snake-1', type: 'listening', title: 'Snake', totalQuestions: 3, correctAnswers: 2, answers: { 1: 'yes' } }]
    }, { practiceMode: 'replace' });
    assert.strictEqual(snakePlan.format, 'v1');
    assert.strictEqual(snakePlan.destructive, true);
    await app.backups.commitImport(snakePlan.id, { confirmDestructive: true });
    assert.strictEqual(await app.practice.get('keep-me'), null, 'practiceMode replace must clear prior practice rows');
    assert.strictEqual(await app.practice.get('legacy-1'), null);
    assert.strictEqual((await app.practice.get('snake-1')).answers[1], 'yes');

    console.log(JSON.stringify({ status: 'pass', tests: 47 }));
}
run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
