import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';

// Production AppData and DataKernel execute in Chromium against actual IndexedDB.
// Faults intercept only a transaction boundary; there is no in-memory kernel.
const source = (name) => fs.readFileSync(new URL(`../../../js/${name}`, import.meta.url), 'utf8');
const scripts = [
    'data/v2/dataCatalog.js', 'data/v2/dataKernel.js',
    'data/practiceRecordSource.js', 'data/v2/readingVocabularyModel.js'
].map(source);
const appDataSource = source('data/v2/appData.js');
const AT = '2026-09-08T01:00:00.000Z';
const SOURCE_A = { kind: 'imported', id: 'library-a' };
const SOURCE_B = { kind: 'imported', id: 'library-b' };
const ARTICLE = { examId: 'shared-exam', title: 'The same exam in independent libraries' };
const REVIEWED_APPLE = {
    id: 'reviewed-apple', word: 'apple', meaning: 'My definition', note: 'My note',
    phonetic: 'æpəl', easeFactor: 2.3, repetitions: 7, interval: 21,
    correctCount: 9, lastReviewed: '2026-09-01T01:00:00.000Z',
    nextReview: '2026-09-22T01:00:00.000Z',
    reviewHistory: [{ at: '2026-09-01T01:00:00.000Z', grade: 4 }]
};
const command = (word, sourceIdentity = SOURCE_A, extra = {}) => ({
    source: sourceIdentity, article: ARTICLE, word: { word, meaning: `Definition of ${word}` }, at: AT,
    occurrence: {
        scopeId: 'passage-1', contentVersion: 'sha256:fixture-v1',
        startOffset: 10, endOffset: 10 + word.length, quote: word,
        before: 'A ', after: ' grows here.'
    }, ...extra
});

async function loadAppData(page, { fault = null, seedBackup = null } = {}) {
    for (const content of scripts) await page.addScriptTag({ content });
    await page.evaluate((fault) => {
        const internals = window.__AppDataV2Internals;
        window.readingTest = { internals, fault, writes: [], attempts: 0, blocked: false, installCalls: 0 };
        const prototype = internals.DataKernel.prototype;
        const mutate = prototype.mutate;
        prototype.mutate = async function (changes, options = {}) {
            const control = window.readingTest;
            if (control.pauseOperation === options.operationId) {
                control.attempts += 1;
                if (!control.blocked) {
                    control.blocked = true;
                    await new Promise((resolve) => { control.release = resolve; });
                }
            }
            return mutate.call(this, changes, options);
        };
        const install = prototype.installSnapshot;
        prototype.installSnapshot = function (...args) {
            window.readingTest.installCalls += 1;
            return install.apply(this, args);
        };
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, ...args) {
            const control = window.readingTest;
            const matches = control.fault && (value?.envelope?.operationId === control.fault.operationId
                || (control.fault.operationPrefix && value?.envelope?.operationId?.startsWith(control.fault.operationPrefix)));
            if (matches) {
                control.writes.push(value.logicalKey);
                if (value.logicalKey === control.fault.failKey || control.writes.length === control.fault.afterWrites) {
                    if (control.fault.kind === 'abort') {
                        this.transaction.abort();
                        throw new DOMException('Injected transaction abort', 'AbortError');
                    }
                    throw new DOMException('Injected storage quota failure', 'QuotaExceededError');
                }
            }
            return put.call(this, value, ...args);
        };
    }, fault);
    if (seedBackup) await page.evaluate(async (backup) => {
        const kernel = new window.readingTest.internals.DataKernel();
        await kernel.initialize();
        await kernel.mutate([{ logicalKey: 'backups.entries', data: [backup] }], { operationId: 'seed-existing-backup' });
        kernel.close();
    }, seedBackup);
    await page.addScriptTag({ content: appDataSource });
    await page.evaluate(() => AppData.ready);
    assert.equal(await page.evaluate(() => AppData.status().backend), 'indexeddb-v2');
}

async function collect(page, input) {
    return page.evaluate(({ operationId, ...input }) => AppData.vocab.mutateReading('collect', input, { operationId }), input);
}

async function snapshot(page) {
    return page.evaluate(async () => (await AppData.vocab.getReadingSnapshot()).snapshot);
}

async function importSnapshot(page, data, replace = false) {
    return page.evaluate(async ({ data, replace }) => {
        const plan = await AppData.backups.previewImport(data, { replace });
        return AppData.backups.commitImport(plan.id, { confirmDestructive: true });
    }, { data, replace });
}

async function startPausedCollect(page, input) {
    return startPausedOperation(page, 'collect', input);
}

async function startPausedOperation(page, type, input) {
    await page.evaluate(({ type, input: { operationId, ...input } }) => {
        window.readingTest.pauseOperation = operationId;
        window.pendingReadingOperation = AppData.vocab.mutateReading(type, input, { operationId }).then(
            (receipt) => { window.readingTest.finished = true; return { receipt }; },
            (error) => { window.readingTest.finished = true; return { error: { code: error.code, committed: error.committed, message: error.message } }; }
        );
    }, { type, input });
    await page.waitForFunction(() => window.readingTest.blocked || window.readingTest.finished);
    if (!await page.evaluate(() => window.readingTest.blocked)) {
        assert.fail(`The intended transaction boundary was never reached: ${JSON.stringify(await page.evaluate(() => window.pendingReadingOperation))}`);
    }
}

async function releaseCollect(page) {
    return page.evaluate(async () => {
        window.readingTest.release();
        return window.pendingReadingOperation;
    });
}

async function durableRow(page, store, key) {
    return page.evaluate(({ store, key }) => new Promise((resolve, reject) => {
        const open = indexedDB.open('IELTSAtlasDataV2');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const database = open.result;
            const get = database.transaction(store, 'readonly').objectStore(store).get(key);
            get.onsuccess = () => { database.close(); resolve(get.result || null); };
            get.onerror = () => { database.close(); reject(get.error); };
        };
    }), { store, key });
}

test('reading vocabulary operations are durable, atomic and backup-safe in real browser pages', { timeout: 180000 }, async (t) => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
        response.end('<!doctype html><title>Reading vocabulary persistence integration</title>');
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    let browser;
    t.after(async () => {
        if (browser) await browser.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    });
    const url = `http://127.0.0.1:${server.address().port}/`;
    const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

    async function pages(t, count = 1, options = {}) {
        const context = await browser.newContext();
        t.after(() => context.close());
        const result = [];
        for (let index = 0; index < count; index += 1) {
            const page = await context.newPage();
            await page.goto(url);
            if (options.legacy) await page.evaluate((legacy) => {
                for (const [key, value] of Object.entries(legacy)) localStorage.setItem(key, value);
            }, options.legacy);
            await loadAppData(page, options);
            result.push(page);
        }
        return result;
    }

    await t.test('two stale readers keep apple and banana with both source associations after a real conflict', async (t) => {
        const [stale, writer] = await pages(t, 2);
        assert.deepEqual(await snapshot(stale), await snapshot(writer));
        await startPausedCollect(stale, command('apple', SOURCE_A, { operationId: 'stale-apple' }));
        const banana = await collect(writer, command('banana', SOURCE_B, { operationId: 'fresh-banana' }));
        assert.equal(banana.committed, true);
        const apple = await releaseCollect(stale);
        assert.equal(apple.receipt?.committed, true, apple.error?.message);
        assert.ok(await stale.evaluate(() => window.readingTest.attempts) >= 2, 'the stale snapshot encountered a real revision conflict');
        const actual = await snapshot(writer);
        assert.deepEqual(actual.reading.terms.map((row) => row.normalizedTerm).sort(), ['apple', 'banana']);
        assert.equal(actual.reading.associations.length, 2);
        assert.equal(actual.reading.occurrences.length, 2);
        assert.deepEqual(actual.reading.sources.map((row) => row.libraryId).sort(), ['library-a', 'library-b']);
        assert.equal(actual.reading.visits.length, 2, 'collect and required bookshelf visit commit together');
        await stale.reload();
        await loadAppData(stale);
        assert.deepEqual(await snapshot(stale), actual, 'a cold page reads both committed commands');
    });

    for (const removal of ['removeArticleTerm', 'clearArticle', 'clearReading']) {
        await t.test(`${removal} wins over an already pending collection, while a fresh collection can be acknowledged`, async (t) => {
            const [stale, writer] = await pages(t, 2);
            await collect(writer, command('apple', SOURCE_A, { operationId: `seed-${removal}` }));
            await collect(writer, command('apple', SOURCE_B, { operationId: `other-${removal}` }));
            await startPausedCollect(stale, command('apple', SOURCE_A, {
                operationId: `delayed-${removal}`,
                occurrence: { ...command('apple').occurrence, startOffset: 30, endOffset: 35 }
            }));
            const removed = await writer.evaluate(async ({ removal, source, examId }) => {
                const model = AppData.vocab.readingModel;
                return AppData.vocab.mutateReading(removal, {
                    articleId: model.articleId(source, examId), termId: model.termId('apple')
                }, { operationId: `remove-${removal}` });
            }, { removal, source: SOURCE_A, examId: ARTICLE.examId });
            assert.equal(removed.committed, true);
            const result = await releaseCollect(stale);
            assert.equal(result.error?.code, 'CONFLICT', 'stale collect must require an explicit refreshed intent');
            assert.equal(result.error?.committed, false);
            const after = await snapshot(writer);
            const articleA = after.reading.articles.find((row) => row.sourceId === after.reading.sources.find((row) => row.libraryId === SOURCE_A.id)?.id);
            assert.equal(after.reading.associations.filter((row) => row.articleId === articleA?.id).length, 0);
            assert.equal(after.reading.associations.length, removal === 'clearReading' ? 0 : 1, 'article deletion leaves the other source independent');
            assert.equal(after.reading.visits.length, 2, 'clearing vocabulary retains visits');
            const fresh = await collect(stale, command('apple', SOURCE_A, { operationId: `fresh-${removal}` }));
            assert.equal(fresh.committed, true);
            assert.equal((await snapshot(writer)).reading.associations.length, removal === 'clearReading' ? 1 : 2);
        });
    }

    for (const removal of ['removeOccurrence', 'removeArticleTerm', 'clearArticle', 'deleteCanonicalTerm',
        'removeTermAssociations', 'clearReading', 'removeArticle']) {
        await t.test(`${removal} rejects an old generation and a pending deletion across replacement`, async (t) => {
            const [stale, writer] = await pages(t, 2);
            const [donor] = await pages(t);
            await collect(writer, command('apple'));
            await collect(donor, command('apple'));
            await collect(donor, command('banana'));
            const restored = await snapshot(donor);
            const backup = await donor.evaluate(() => AppData.backups.export());
            const observed = await stale.evaluate(() => AppData.vocab.getReadingSnapshot());
            const input = {
                articleId: observed.snapshot.reading.articles[0].id,
                termId: observed.snapshot.reading.terms[0].id,
                occurrenceId: observed.snapshot.reading.occurrences[0].id,
                clearWords: true, at: AT
            };
            await startPausedOperation(stale, removal, { ...input, operationId: `pending-delete-${removal}` });
            assert.equal((await importSnapshot(writer, backup, true)).committed, true);
            const pending = await releaseCollect(stale);
            assert.equal(pending.error?.code, 'CONFLICT', 'a pending deletion must not replay against restored data');
            assert.equal(pending.error?.committed, false);
            assert.deepEqual(await snapshot(writer), restored);

            const oldGeneration = await stale.evaluate(async ({ removal, input, observed }) => {
                try {
                    return { receipt: await AppData.vocab.mutateReading(removal, input, {
                        observedRevision: observed.revision, observedGeneration: observed.generation
                    }) };
                } catch (error) { return { code: error.code, committed: error.committed }; }
            }, { removal, input, observed });
            assert.deepEqual(oldGeneration, { code: 'CONFLICT', committed: false });
            assert.deepEqual(await snapshot(writer), restored, 'explicit stale observation cannot remove any restored records');
            await stale.reload();
            await loadAppData(stale);
            assert.deepEqual(await snapshot(stale), restored, 'rejected commands leave durable data intact');
            const fresh = await stale.evaluate(({ removal, input }) => AppData.vocab.mutateReading(removal, input), { removal, input });
            assert.equal(fresh.committed, true, 'a refreshed deletion can still be acknowledged');
            assert.notDeepEqual(await snapshot(writer), restored);
        });
    }

    await t.test('removing an article and its vocabulary commits together and fences an already pending bookshelf visit', async (t) => {
        const [stale, writer] = await pages(t, 2);
        await collect(writer, command('apple', SOURCE_A));
        await collect(writer, command('apple', SOURCE_B));
        const initialVisit = { source: SOURCE_A, article: ARTICLE, at: AT };
        await writer.evaluate((input) => AppData.vocab.mutateReading('recordVisit', input, {
            operationId: 'initial-visit'
        }), initialVisit);
        await startPausedOperation(stale, 'recordVisit', {
            source: SOURCE_A, article: ARTICLE, at: AT, operationId: 'delayed-visit'
        });
        const removal = await writer.evaluate(({ source, examId }) => AppData.vocab.mutateReading('removeArticle', {
            articleId: AppData.vocab.readingModel.articleId(source, examId), clearWords: true
        }), { source: SOURCE_A, examId: ARTICLE.examId });
        assert.equal(removal.committed, true);
        const result = await releaseCollect(stale);
        assert.equal(result.error?.code, 'CONFLICT');
        const replay = await writer.evaluate(async (input) => {
            try { return { receipt: await AppData.vocab.mutateReading('recordVisit', input, { operationId: 'initial-visit' }) }; }
            catch (error) { return { code: error.code, committed: error.committed }; }
        }, initialVisit);
        assert.deepEqual(replay, { code: 'CONFLICT', committed: false }, 'an old visit receipt cannot claim a deleted bookshelf entry is still saved');
        const after = await snapshot(writer);
        assert.equal(after.reading.visits.length, 1);
        assert.equal(after.reading.associations.length, 1);
        assert.equal(after.reading.occurrences.length, 1);
        const remaining = after.reading.articles.find((row) => row.id === after.reading.visits[0].articleId);
        assert.equal(after.reading.sources.find((row) => row.id === remaining.sourceId).libraryId, SOURCE_B.id);
        assert.equal((await stale.evaluate(({ source, article, at }) => AppData.vocab.mutateReading('recordVisit', {
            source, article, at
        }), { source: SOURCE_A, article: ARTICLE, at: AT })).committed, true);
        const revisited = await snapshot(writer);
        assert.equal(revisited.reading.visits.length, 2, 'a newly acknowledged visit restores the zero-word bookshelf entry');
        assert.equal(revisited.reading.associations.length, 1, 'visiting alone does not resurrect removed vocabulary');
    });

    await t.test('same-term A/B backup merge retains associations and occurrences, local review progress and retry idempotence', async (t) => {
        const [articleA] = await pages(t);
        const [articleB] = await pages(t);
        await articleA.evaluate((word) => AppData.vocab.saveWords([word]), REVIEWED_APPLE);
        await collect(articleA, command('apple', SOURCE_A, { operationId: 'backup-article-a' }));
        await collect(articleB, command('apple', SOURCE_B, { operationId: 'backup-article-b' }));
        const backupB = await articleB.evaluate(() => AppData.backups.export({ domains: ['vocab'] }));
        assert.equal((await importSnapshot(articleA, backupB)).committed, true);
        const merged = await snapshot(articleA);
        assert.equal(merged.reading.terms.length, 1, 'same normalized term retains one canonical owner');
        assert.equal(merged.reading.associations.length, 2);
        assert.equal(merged.reading.occurrences.length, 2);
        assert.equal(merged.reading.visits.length, 2);
        assert.deepEqual(merged.words, [REVIEWED_APPLE], 'an imported definition and schedule cannot replace local review history');
        assert.equal(merged.reading.terms[0].wordRef.wordId, REVIEWED_APPLE.id);
        assert.equal((await importSnapshot(articleA, backupB)).committed, true);
        assert.deepEqual(await snapshot(articleA), merged, 'repeated merge does not duplicate or change reading data');
        await articleA.reload();
        await loadAppData(articleA);
        assert.deepEqual(await snapshot(articleA), merged);
    });

    for (const removal of ['deleteCanonicalTerm', 'removeOccurrence', 'removeArticleTerm', 'clearArticle',
        'clearReading', 'removeTermAssociations', 'removeArticle']) {
        await t.test(`${removal} remains effective when an older backup is merged, without deleting unrelated visits or associations`, async (t) => {
            const [page] = await pages(t);
            const oldClock = removal === 'deleteCanonicalTerm' ? { at: '2099-01-01T00:00:00.000Z' } : {};
            const initialCollection = command('apple', SOURCE_A, { ...oldClock, operationId: `initial-${removal}` });
            await collect(page, initialCollection);
            await collect(page, command('apple', SOURCE_B, oldClock));
            const oldBackup = await page.evaluate(() => AppData.backups.export({ domains: ['vocab'] }));
            await page.evaluate(({ removal, source, examId, selected }) => AppData.vocab.mutateReading(removal, {
                articleId: AppData.vocab.readingModel.articleId(source, examId),
                termId: AppData.vocab.readingModel.termId('apple'), clearWords: false,
                occurrenceId: AppData.vocab.readingModel.occurrenceId(AppData.vocab.readingModel.articleId(source, examId),
                    AppData.vocab.readingModel.termId('apple'), selected)
            }, { operationId: `removal-${removal}` }), { removal, source: SOURCE_A, examId: ARTICLE.examId, selected: command('apple').occurrence });
            if (removal === 'deleteCanonicalTerm') {
                const replay = await page.evaluate(async ({ operationId, ...input }) => {
                    try { return { receipt: await AppData.vocab.mutateReading('collect', input, { operationId }) }; }
                    catch (error) { return { code: error.code, committed: error.committed }; }
                }, initialCollection);
                assert.deepEqual(replay, { code: 'CONFLICT', committed: false }, 'an old acknowledged operation cannot report saved after its association was deleted');
            }
            assert.equal((await importSnapshot(page, oldBackup)).committed, true);
            const merged = await snapshot(page);
            const owners = merged.words.concat(...Object.values(merged.lists).map((list) => Array.isArray(list) ? list : list.words || []));
            if (removal === 'deleteCanonicalTerm') {
                assert.equal(merged.reading.terms.length, 0);
                assert.equal(owners.filter((row) => row.word.toLowerCase() === 'apple').length, 0, 'stale backup cannot resurrect a deleted review owner');
                assert.equal(merged.reading.associations.length, 0);
                assert.equal(merged.reading.occurrences.length, 0);
                assert.equal(merged.reading.visits.length, 2, 'global vocabulary deletion retains both visits');
            } else if (['clearReading', 'removeTermAssociations'].includes(removal)) {
                assert.equal(merged.reading.associations.length, 0);
                assert.equal(merged.reading.occurrences.length, 0);
                assert.equal(merged.reading.visits.length, 2);
                assert.equal(owners.length, 1, 'clearing associations preserves the review owner');
            } else if (removal !== 'removeArticle') {
                assert.equal(merged.reading.associations.length, 1);
                assert.equal(merged.reading.occurrences.length, 1);
                assert.equal(merged.reading.visits.length, 2, 'clearing a vocabulary article does not remove its bookshelf visit');
            } else {
                assert.equal(merged.reading.associations.length, 2, 'removing a visit with clearWords=false retains both article collections');
                assert.equal(merged.reading.occurrences.length, 2);
                assert.equal(merged.reading.visits.length, 1, 'an old backup cannot resurrect the removed visit');
            }
            await importSnapshot(page, oldBackup);
            assert.deepEqual(await snapshot(page), merged, 'deletion precedence is idempotent across repeated merges');
            await collect(page, command('apple', SOURCE_A));
            if (removal === 'deleteCanonicalTerm') await page.evaluate(async () => {
                const current = (await AppData.vocab.getReadingSnapshot()).snapshot;
                const owner = current.lists['reading-highlights'].words[0];
                await AppData.vocab.upsertCollectionWord('reading-highlights', {
                    ...owner, note: 'Reviewed after explicit recollection', repetitions: 9, interval: 17,
                    correctCount: 12, reviewHistory: [{ at: '2099-01-02T00:00:00.000Z', grade: 4 }]
                });
            });
            const recollected = await snapshot(page);
            assert.equal(recollected.reading.associations.length, ['deleteCanonicalTerm', 'clearReading', 'removeTermAssociations'].includes(removal) ? 1 : 2);
            assert.equal(recollected.reading.visits.length, 2);
            const obsoleteRemoval = await page.evaluate(async ({ removal, source, examId, selected }) => {
                try {
                    return { receipt: await AppData.vocab.mutateReading(removal, {
                        articleId: AppData.vocab.readingModel.articleId(source, examId),
                        termId: AppData.vocab.readingModel.termId('apple'), clearWords: false,
                        occurrenceId: AppData.vocab.readingModel.occurrenceId(AppData.vocab.readingModel.articleId(source, examId),
                            AppData.vocab.readingModel.termId('apple'), selected)
                    }, { operationId: `removal-${removal}` }) };
                } catch (error) { return { code: error.code, committed: error.committed }; }
            }, { removal, source: SOURCE_A, examId: ARTICLE.examId, selected: command('apple').occurrence });
            assert.deepEqual(obsoleteRemoval, { code: 'CONFLICT', committed: false }, 'an obsolete removal receipt cannot acknowledge removal of a later deliberate recollection');
            assert.deepEqual(await snapshot(page), recollected, 'replaying a historical removal does not delete newer data');
            if (removal === 'deleteCanonicalTerm') {
                await importSnapshot(page, oldBackup);
                assert.deepEqual(await snapshot(page), recollected, 'old future-dated backup rows cannot erase or replace a fresh recollection and review');
            }
            const newBackup = await page.evaluate(() => AppData.backups.export());
            const [restored] = await pages(t);
            await importSnapshot(restored, newBackup, true);
            assert.deepEqual(await snapshot(restored), recollected, 'an explicitly fresh collection survives a full backup roundtrip after prior deletion');
        });
    }

    for (const collection of ['words', 'bookshelf']) {
        await t.test(`legacy ${collection} snapshots require explicit revision and cannot overwrite newer reading operations`, async (t) => {
            const [stale, writer] = await pages(t, 2);
            await collect(writer, command('apple'));
            const observed = await stale.evaluate((collection) => collection === 'words'
                ? AppData.vocab.listReadingWords({ withMeta: true })
                : AppData.vocab.listReadingBookshelfExams({ withMeta: true }), collection);
            await collect(writer, command('banana', SOURCE_B));
            const before = await snapshot(writer);
            const result = await stale.evaluate(async ({ collection, observed }) => {
                const save = collection === 'words' ? AppData.vocab.saveReadingWords : AppData.vocab.saveReadingBookshelfExams;
                const failure = async (options) => {
                    try { return { receipt: await save(observed.data, options) }; }
                    catch (error) { return { code: error.code, committed: error.committed }; }
                };
                return { unversioned: await failure({}), stale: await failure({ expectedRevision: observed.envelope.revision }) };
            }, { collection, observed });
            assert.equal(result.unversioned.code, 'VALIDATION');
            assert.equal(result.stale.code, 'CONFLICT');
            assert.equal(result.stale.committed, false);
            assert.deepEqual(await snapshot(writer), before);
        });
    }

    await t.test('replaying a former manual collection cannot report saved for a later occurrence-only association', async (t) => {
        const [page] = await pages(t);
        const manual = command('apple', SOURCE_A, { manual: true, operationId: 'manual-original' });
        delete manual.occurrence;
        await collect(page, manual);
        await page.evaluate(({ source, examId }) => AppData.vocab.mutateReading('removeArticleTerm', {
            articleId: AppData.vocab.readingModel.articleId(source, examId), termId: AppData.vocab.readingModel.termId('apple')
        }), { source: SOURCE_A, examId: ARTICLE.examId });
        await collect(page, command('apple', SOURCE_A, { operationId: 'selected-later' }));
        const before = await snapshot(page);
        assert.equal(before.reading.associations[0].manual, false);
        const replay = await page.evaluate(async ({ operationId, ...input }) => {
            try { return { receipt: await AppData.vocab.mutateReading('collect', input, { operationId }) }; }
            catch (error) { return { code: error.code, committed: error.committed }; }
        }, manual);
        assert.deepEqual(replay, { code: 'CONFLICT', committed: false });
        assert.deepEqual(await snapshot(page), before, 'a journal replay cannot silently promote the association to manual');
        assert.equal((await collect(page, { ...manual, operationId: 'manual-fresh' })).committed, true);
        assert.equal((await snapshot(page)).reading.associations[0].manual, true);
    });

    await t.test('backup roundtrip preserves source identity, manual associations, exact occurrences and zero-word visits', async (t) => {
        const [page] = await pages(t);
        const [restored] = await pages(t);
        await collect(page, command('apple', SOURCE_A, { operationId: 'roundtrip-selected' }));
        const manual = command('banana', SOURCE_B, { manual: true, operationId: 'roundtrip-manual' });
        delete manual.occurrence;
        await collect(page, manual);
        await page.evaluate(({ source, at }) => AppData.vocab.mutateReading('recordVisit', {
            source, article: { examId: 'zero-words', title: 'Visited without collecting' }, at
        }, { operationId: 'roundtrip-visit' }), { source: SOURCE_A, at: AT });
        const before = await snapshot(page);
        assert.equal(before.reading.visits.length, 3);
        assert.equal(before.reading.associations.filter((row) => row.manual).length, 1);
        const exported = await page.evaluate(() => AppData.backups.export());
        assert.ok(exported.envelopes['vocab.readingState'], 'the canonical relationship state is a backup domain');
        assert.equal((await importSnapshot(restored, exported, true)).committed, true);
        assert.deepEqual(await snapshot(restored), before);
        await restored.reload();
        await loadAppData(restored);
        assert.deepEqual(await snapshot(restored), before);
        const reexported = await restored.evaluate(() => AppData.backups.export());
        assert.deepEqual(reexported.envelopes['vocab.readingState'].data.reading, exported.envelopes['vocab.readingState'].data.reading);
    });

    await t.test('empty replace stays authoritative across stale mirrors, lazy reader/bookshelf initialization, reload and export', async (t) => {
        const [page, stale] = await pages(t, 2);
        const empty = await page.evaluate(() => AppData.backups.export());
        await collect(page, command('apple', SOURCE_A, { operationId: 'before-empty' }));
        const staleBefore = await stale.evaluate(() => AppData.vocab.getReadingSnapshot());
        await importSnapshot(page, empty, true);
        const writeStaleMirrors = async () => stale.evaluate(() => {
            localStorage.setItem('ielts_reading_vocab_words_v1', JSON.stringify([{ id: 'stale', word: 'apple', examId: 'shared-exam' }]));
            localStorage.setItem('ielts_reading_bookshelf_exams_v1', JSON.stringify([{ examId: 'shared-exam', firstUsedAt: 1 }]));
        });
        await writeStaleMirrors();
        const staleResult = await stale.evaluate(async ({ before, input }) => {
            try {
                await AppData.vocab.mutateReading('collect', input, {
                    operationId: 'collect-from-before-empty', observedRevision: before.revision, observedGeneration: before.generation
                });
                return null;
            } catch (error) { return { code: error.code, committed: error.committed }; }
        }, { before: staleBefore, input: command('apple') });
        assert.deepEqual(staleResult, { code: 'CONFLICT', committed: false }, 'replace invalidates pre-import readers even if an old revision number recurs');
        await page.addScriptTag({ content: source('components/readingVocabReader.js') });
        await page.addScriptTag({ content: source('components/bookshelfView.js') });
        await page.evaluate(async () => {
            await ReadingVocabStore.init();
            await ReadingBookshelfStore.init();
        });
        let actual = await snapshot(page);
        assert.equal(actual.reading.associations.length, 0);
        assert.equal(actual.reading.occurrences.length, 0);
        assert.equal(actual.reading.visits.length, 0);
        await writeStaleMirrors();
        await page.reload();
        await loadAppData(page);
        actual = await snapshot(page);
        assert.equal(actual.reading.associations.length, 0);
        assert.equal(actual.reading.visits.length, 0);
        const exported = await page.evaluate(() => AppData.backups.export());
        assert.equal(exported.envelopes['vocab.readingState'].data.reading.associations.length, 0);
        assert.equal(exported.envelopes['vocab.readingState'].data.reading.visits.length, 0);
    });

    await t.test('loaded reader and bookshelf caches adopt a remote replace through production commit notifications', async (t) => {
        const [writer, observer] = await pages(t, 2);
        const empty = await writer.evaluate(() => AppData.backups.export());
        await collect(writer, command('apple'));
        await observer.addScriptTag({ content: source('components/readingVocabReader.js') });
        await observer.addScriptTag({ content: source('components/bookshelfView.js') });
        await observer.evaluate(async () => {
            await ReadingVocabStore.init();
            await ReadingBookshelfStore.init();
        });
        assert.deepEqual(await observer.evaluate(() => ({
            words: ReadingVocabStore.getAll().length, visits: ReadingBookshelfStore.getBookshelfExams().length
        })), { words: 1, visits: 1 });
        await importSnapshot(writer, empty, true);
        // These are synchronous cached projections: no explicit init, AppData
        // refresh, or new page navigation can conceal a missing notification.
        await observer.waitForFunction(() => ReadingVocabStore.getAll().length === 0
            && ReadingBookshelfStore.getBookshelfExams().length === 0);
    });

    await t.test('a deletion imported from a lower-revision device fences stale local readers but allows freshly observed collection', async (t) => {
        const [writer, stale] = await pages(t, 2);
        const [remote] = await pages(t);
        await collect(writer, command('apple'));
        await collect(remote, command('apple'));
        await writer.evaluate(async ({ source, article, at }) => {
            for (let index = 0; index < 12; index += 1) {
                await AppData.vocab.mutateReading('recordVisit', { source, article, at }, { operationId: `advance-local-${index}` });
            }
        }, { source: SOURCE_A, article: ARTICLE, at: AT });
        const observed = await stale.evaluate(() => AppData.vocab.getReadingSnapshot());
        await remote.evaluate(() => AppData.vocab.mutateReading('deleteCanonicalTerm', {
            termId: AppData.vocab.readingModel.termId('apple')
        }));
        const remoteState = await remote.evaluate(() => AppData.vocab.getReadingSnapshot());
        assert.ok(observed.revision > remoteState.revision, 'exercise different device-local revision ranges');
        const backup = await remote.evaluate(() => AppData.backups.export({ domains: ['vocab'] }));
        await importSnapshot(writer, backup);
        assert.equal((await snapshot(writer)).reading.associations.length, 0);
        const rejected = await stale.evaluate(async ({ observed, input }) => {
            try {
                await AppData.vocab.mutateReading('collect', input, {
                    observedRevision: observed.revision, observedGeneration: observed.generation
                });
                return null;
            } catch (error) { return { code: error.code, committed: error.committed }; }
        }, { observed, input: command('apple') });
        assert.deepEqual(rejected, { code: 'CONFLICT', committed: false });
        assert.equal((await collect(stale, command('apple'))).committed, true, 'foreign revision numbers do not permanently block a refreshed local intent');
        assert.equal((await snapshot(writer)).reading.associations.length, 1);
    });

    for (const kind of ['quota', 'abort']) {
        await t.test(`${kind} failure rolls back every written document and retries without duplicate vocabulary or occurrences`, async (t) => {
            const operationId = `${kind}-retry`;
            const [page, observer] = await pages(t, 2, { fault: { operationId, kind, afterWrites: 2 } });
            const before = await snapshot(observer);
            await observer.evaluate(() => {
                window.readingCommits = [];
                AppData.backups.onDataCommitted((event) => window.readingCommits.push(event.operationId));
            });
            const failed = await page.evaluate(async ({ operationId, input }) => {
                try { return { receipt: await AppData.vocab.mutateReading('collect', input, { operationId }) }; }
                catch (error) { return { code: error.code, committed: error.committed, writes: window.readingTest.writes }; }
            }, { operationId, input: command('apple') });
            assert.equal(failed.receipt, undefined, 'failed persistence cannot return saved/added success');
            assert.equal(failed.committed, false);
            assert.equal(failed.code, kind === 'quota' ? 'QUOTA_EXCEEDED' : 'BACKEND_UNAVAILABLE');
            assert.equal(failed.writes.length, 2, 'failure follows a prior write inside a real transaction');
            assert.deepEqual(await snapshot(observer), before, 'the preceding put was rolled back atomically');
            assert.equal(await observer.evaluate((id) => window.readingCommits.includes(id), operationId), false, 'failed transaction emits no commit notification');
            if (kind === 'abort') {
                await page.reload();
                await loadAppData(page);
            } else await page.evaluate(() => { window.readingTest.fault = null; });
            const receipt = await collect(page, command('apple', SOURCE_A, { operationId }));
            assert.equal(receipt.committed, true);
            assert.equal(receipt.saved, true);
            await observer.waitForFunction((id) => window.readingCommits.includes(id), operationId);
            const after = await snapshot(observer);
            assert.equal(after.reading.terms.length, 1);
            assert.equal(after.reading.associations.length, 1);
            assert.equal(after.reading.occurrences.length, 1);
            assert.equal(after.reading.visits.length, 1);
            assert.equal((await collect(page, command('apple', SOURCE_A, { operationId }))).committed, true);
            assert.deepEqual(await snapshot(observer), after, 'retrying the acknowledged operation is also idempotent');
        });
    }

    await t.test('interrupted one-time migration retains original bytes, retries atomically and cannot reimport later stale mirrors', async (t) => {
        const words = [{
            id: 'legacy-apple', word: 'apple', examId: 'legacy-exam', examTitle: 'Legacy article',
            source: SOURCE_A, createdAt: AT, note: 'Retain this note',
            highlights: [{ examId: 'legacy-exam', text: 'apple', scope: 'passage-1', startOffset: 2, endOffset: 7 }]
        }];
        const visits = [{ examId: 'legacy-zero', source: SOURCE_B, firstUsedAt: 1000, lastOpenedAt: 2000 }];
        const legacy = {
            ielts_reading_vocab_words_v1: JSON.stringify(words),
            ielts_reading_bookshelf_exams_v1: JSON.stringify(visits)
        };
        const [page] = await pages(t, 1, { legacy, fault: {
            kind: 'quota', operationPrefix: 'migrate-reading_', failKey: 'system.migrations'
        } });
        assert.equal(await durableRow(page, 'documents', 'vocab.readingState'), null, 'failed marker put rolls back the new model document');
        const initialMarker = await durableRow(page, 'system', 'system.migrations');
        assert.equal(initialMarker?.envelope?.data?.readingVocabularyV1, undefined, 'interrupted migration must not be marked complete');
        assert.deepEqual(await page.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), Object.keys(legacy)), legacy);
        assert.ok(await page.evaluate(() => window.readingTest.writes.includes('vocab.readingState')), 'exercise rollback after a real canonical state write');
        await page.reload();
        await loadAppData(page);
        const migrated = await snapshot(page);
        assert.equal(migrated.reading.terms.length, 1);
        assert.equal(migrated.reading.associations.length, 1);
        assert.equal(migrated.reading.occurrences.length, 1);
        assert.equal(migrated.reading.visits.length, 2);
        const marker = (await durableRow(page, 'system', 'system.migrations')).envelope.data.readingVocabularyV1;
        assert.equal(marker.version, 1);
        assert.equal(marker.completed, true);
        assert.deepEqual(marker.recoverable.localStorage, legacy, 'original bytes remain durably recoverable after conversion');
        await page.evaluate(() => {
            localStorage.setItem('ielts_reading_vocab_words_v1', JSON.stringify([{ word: 'banana', examId: 'stale-late' }]));
        });
        await page.reload();
        await loadAppData(page);
        await page.evaluate(() => AppData.backups.export());
        assert.deepEqual(await snapshot(page), migrated, 'startup and export do not repeat a completed migration');
        assert.deepEqual((await durableRow(page, 'system', 'system.migrations')).envelope.data.readingVocabularyV1, marker);
    });

    await t.test('unrecognized prototype payloads stay recoverable with explicit migration diagnostics', async (t) => {
        const legacy = {
            ielts_reading_vocab_words_v1: JSON.stringify({ vendorVersion: 'unknown', terms: [{ term: 'apple' }] }),
            ielts_reading_bookshelf_exams_v1: '{broken json'
        };
        const [page] = await pages(t, 1, { legacy });
        const actual = await snapshot(page);
        assert.equal(actual.reading.associations.length, 0);
        assert.equal(actual.reading.visits.length, 0);
        const marker = (await durableRow(page, 'system', 'system.migrations')).envelope.data.readingVocabularyV1;
        assert.equal(marker.completed, true);
        assert.deepEqual(marker.recoverable.localStorage, legacy);
        for (const key of Object.keys(legacy)) assert.ok(marker.recoverable.rejected.some((entry) => entry.key === key), `record rejection diagnostics for ${key}`);
        await page.evaluate(() => AppData.backups.export());
        await page.reload();
        await loadAppData(page);
        assert.deepEqual(await page.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), Object.keys(legacy)), legacy, 'unrecognized original payloads are not silently overwritten with empty mirrors');
        assert.deepEqual((await durableRow(page, 'system', 'system.migrations')).envelope.data.readingVocabularyV1, marker);
    });

    await t.test('settings-only import is independent of interrupted reading migration, while reading backups require recovery first', async (t) => {
        const [donor] = await pages(t);
        await donor.evaluate(() => AppData.settings.patch({ theme: 'imported' }));
        const settings = await donor.evaluate(() => AppData.backups.export({ domains: ['settings'] }));
        const seedBackup = await donor.evaluate(() => AppData.backups.create({ id: 'migration-target' }));
        const legacy = {
            ielts_reading_vocab_words_v1: JSON.stringify([{ id: 'legacy', word: 'apple', examId: 'legacy' }]),
            ielts_reading_bookshelf_exams_v1: JSON.stringify([{ examId: 'legacy-zero', firstUsedAt: 1 }])
        };
        const [page] = await pages(t, 1, { legacy, seedBackup,
            fault: { kind: 'quota', operationPrefix: 'migrate-reading_', failKey: 'system.migrations' } });
        await page.evaluate(() => AppData.settings.patch({ theme: 'changed' }));
        assert.equal((await importSnapshot(page, settings, true)).committed, true, 'an unrelated settings import does not require reading migration');
        assert.equal(await page.evaluate(async () => (await AppData.settings.getAll()).theme), 'imported');
        const beforeIds = await page.evaluate(async () => (await AppData.backups.list()).map((entry) => entry.id));
        const beforeInstalls = await page.evaluate(() => window.readingTest.installCalls);
        for (const workflow of ['export', 'create', 'preview', 'restore']) {
            const failure = await page.evaluate(async ({ workflow, snapshot }) => {
                try {
                    if (workflow === 'export') await AppData.backups.export();
                    if (workflow === 'create') await AppData.backups.create({ id: 'unsafe-safety', type: 'pre-import' });
                    if (workflow === 'preview') await AppData.backups.previewImport(snapshot, { replace: true });
                    if (workflow === 'restore') await AppData.backups.restore('migration-target');
                    return null;
                } catch (error) { return { code: error.code, committed: error.committed }; }
            }, { workflow, snapshot: seedBackup.data });
            assert.deepEqual(failure, { code: 'QUOTA_EXCEEDED', committed: false }, `${workflow} must not silently omit unmigrated reading data`);
            assert.equal(await page.evaluate(() => window.readingTest.installCalls), beforeInstalls, `${workflow} aborts before snapshot installation`);
            assert.deepEqual(await page.evaluate(async () => (await AppData.backups.list()).map((entry) => entry.id)), beforeIds, 'do not leave a misleading partial safety backup');
            assert.equal(await durableRow(page, 'documents', 'vocab.readingState'), null);
            assert.deepEqual(await page.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), Object.keys(legacy)), legacy);
        }
        await page.evaluate(() => { window.readingTest.fault = null; });
        const safety = await page.evaluate(() => AppData.backups.create({ id: 'recovered-safety', type: 'pre-import' }));
        assert.equal(safety.data.envelopes['vocab.readingState'].data.reading.associations.length, 1);
        assert.equal(safety.data.envelopes['vocab.readingState'].data.reading.visits.length, 2);
        assert.equal(safety.data.envelopes['settings.values'].data.theme, 'imported');
    });
});
