import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';

const source = (name) => fs.readFileSync(new URL(`../../../js/${name}`, import.meta.url), 'utf8');
const contract = source('diagnostics/diagnosticContract.js');
const store = source('diagnostics/diagnosticStore.js');
const bootstrap = source('diagnostics/bootstrapCollector.js');
const reporter = source('diagnostics/diagnosticReporter.js');

test('diagnostic IndexedDB retention and lifecycle in isolated browser databases', { timeout: 120000 }, async (t) => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html><title>Diagnostic persistence fixture</title>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true,
        ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
    const url = `http://127.0.0.1:${server.address().port}/`;
    async function load(page, options = {}, timestamp = 1800000000000) {
        await page.addScriptTag({ content: contract });
        await page.evaluate((timestamp) => {
            window.clock = timestamp;
            Date.now = () => window.clock;
        }, timestamp);
        await page.addScriptTag({ content: store });
        if (Object.keys(options).length) await page.evaluate((options) => {
            AppDiagnosticStore.close();
            window.AppDiagnosticStore = AppDiagnosticStorage.create(options);
        }, options);
        await page.addScriptTag({ content: bootstrap });
        await page.addScriptTag({ content: reporter });
        await page.evaluate(() => AppDiagnosticStore.ready);
        await page.evaluate(() => {
            window.normalizer = AppDiagnosticContract.createNormalizer();
            window.makeEvents = (count, input = {}) => Array.from({ length: count }, () => normalizer.normalize({
                ...input, persistence: { generation: AppDiagnosticStore.status().generation }
            }));
            window.persist = async (events) => {
                const receipts = [];
                for (let i = 0; i < events.length; i += 20) receipts.push(await AppDiagnosticStore.append(events.slice(i, i + 20)));
                return receipts;
            };
            window.databaseNames = async () => (await indexedDB.databases()).map((db) => db.name);
        });
    }
    async function fixture(t, count = 1, options = {}) {
        const context = await browser.newContext();
        t.after(() => context.close());
        const pages = [];
        for (let i = 0; i < count; i += 1) {
            const page = await context.newPage();
            await page.goto(url);
            await load(page, options);
            pages.push(page);
        }
        return { context, pages };
    }
    async function fillLocalStorage(page) {
        return page.evaluate(() => {
            let payload = '';
            for (let size = 1024 * 1024; size >= 1; size /= 2) {
                while (true) {
                    const next = payload + 'x'.repeat(size);
                    try { localStorage.setItem('quota-fixture', next); payload = next; }
                    catch (error) {
                        if (error.name !== 'QuotaExceededError') throw error;
                        break;
                    }
                }
            }
            return payload.length;
        });
    }

    await t.test('passive reads do not create a database; reload and identity upsert retain sanitized evidence', async (t) => {
        const { pages: [page] } = await fixture(t);
        assert.deepEqual(await page.evaluate(async () => { await AppDiagnosticStore.snapshot(); return databaseNames(); }), []);
        const eventId = await page.evaluate(async () => {
            const event = makeEvents(1, { error: new Error('PRIVATE_答案_😀') })[0];
            await persist([event, event]);
            await persist([{ ...event, code: 'PRACTICE_SAVE_FAILED', notification: { kind: 'dialog' } }]);
            return event.eventId;
        });
        await page.reload();
        await load(page);
        const snapshot = await page.evaluate(() => AppDiagnosticStore.snapshot());
        assert.equal(snapshot.events.length, 1);
        assert.equal(snapshot.events[0].eventId, eventId);
        assert.equal(snapshot.events[0].code, 'PRACTICE_SAVE_FAILED');
        assert.equal(snapshot.events[0].persistence.diagnostics, 'persisted');
        assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
        assert.equal(await page.evaluate(async (id) => (await AppDiagnosticStore.getIncident(id)).eventId, eventId), eventId);
    });

    await t.test('transactional count/age retention prefers failures and their embedded context', async (t) => {
        const { pages: [page] } = await fixture(t, 1, { limits: { events: 25 } });
        const result = await page.evaluate(async () => {
            const failure = makeEvents(1, { code: 'PRACTICE_SAVE_FAILED', notification: { kind: 'dialog' },
                breadcrumbs: [{ action: 'submit', module: 'practice', outcome: 'started' }] })[0];
            await persist([failure]);
            clock += 1;
            await persist(makeEvents(60));
            const before = await AppDiagnosticStore.snapshot({ limit: 2000 });
            clock += 7 * 86400000 + 1;
            const expired = await AppDiagnosticStore.snapshot();
            await persist(makeEvents(1));
            return { id: failure.eventId, before, expired, after: await AppDiagnosticStore.snapshot() };
        });
        assert.equal(result.before.events.length, 25);
        assert.equal(result.before.events[0].eventId, result.id);
        assert.equal(result.before.events[0].breadcrumbs[0].action, 'submit');
        assert.equal(result.before.events.at(-1).sequence, 61);
        assert.equal(result.expired.events.length, 0);
        assert.equal(result.after.events.length, 1);
    });

    await t.test('production UTF-8 payload ceiling, query limits and detached snapshots', async (t) => {
        const { pages: [page] } = await fixture(t);
        const result = await page.evaluate(async () => {
            await persist(makeEvents(400, { breadcrumbs: Array.from({ length: 50 }, () => ({ action: 'submit', module: 'practice' })) }));
            const all = await AppDiagnosticStore.snapshot({ limit: 2000 });
            const payloadBytes = all.events.reduce((sum, event) => sum + new TextEncoder().encode(JSON.stringify(event)).length, 0);
            const normal = await AppDiagnosticStore.snapshot();
            const empty = await AppDiagnosticStore.snapshot({ limit: 0 });
            return { count: all.events.length, payloadBytes, normalCount: normal.events.length,
                normalTruncated: normal.truncated, empty, frozen: Object.isFrozen(all) && Object.isFrozen(all.events[0]),
                unicodeBytes: AppDiagnosticContract.utf8Bytes('学习😀') };
        });
        assert.ok(result.count > 200 && result.count < 400 && result.count <= 2000);
        assert.ok(result.payloadBytes <= 2 * 1024 * 1024 && result.payloadBytes > 2 * 1024 * 1024 - 8192);
        assert.equal(result.normalCount, 200);
        assert.equal(result.normalTruncated, true);
        assert.equal(result.empty.events.length, 0);
        assert.equal(result.frozen, true);
        assert.equal(result.unicodeBytes, 10);
    });

    await t.test('startup physically removes expired records without waiting for a new report', async (t) => {
        const { pages: [page] } = await fixture(t);
        await page.evaluate(() => persist(makeEvents(2)));
        await page.reload();
        await load(page, {}, 1800000000000 + 8 * 86400000);
        const count = await page.evaluate(async () => {
            const db = await new Promise((resolve) => {
                const request = indexedDB.open(AppDiagnosticStorage.DATABASE_NAME);
                request.onsuccess = () => resolve(request.result);
            });
            return new Promise((resolve) => {
                const tx = db.transaction('events');
                const request = tx.objectStore('events').count();
                tx.oncomplete = () => { db.close(); resolve(request.result); };
            });
        });
        assert.equal(count, 0);
    });

    await t.test('concurrent windows serialize trimming and deduplicate originating IDs', async (t) => {
        const { pages } = await fixture(t, 3, { limits: { events: 70 } });
        const shared = await pages[0].evaluate(() => makeEvents(1, { code: 'PRACTICE_SAVE_FAILED' })[0]);
        await Promise.all(pages.map((page) => page.evaluate(async (shared) => {
            await persist([shared, ...makeEvents(40)]);
        }, shared)));
        const snapshots = await Promise.all(pages.map((page) => page.evaluate(() => AppDiagnosticStore.snapshot())));
        for (const snapshot of snapshots) {
            assert.equal(snapshot.events.length, 70);
            assert.equal(snapshot.events.filter((event) => event.eventId === shared.eventId).length, 1);
        }
        assert.deepEqual(snapshots[0].events, snapshots[1].events);
    });

    for (const fault of ['unavailable', 'quota', 'abort', 'blocked']) {
        await t.test(`${fault} switches to bounded memory, stops write storms and supports explicit retry`, async (t) => {
            const { pages: [page] } = await fixture(t);
            const initial = await page.evaluate(async (fault) => {
                window.openAttempts = 0;
                const open = indexedDB.open.bind(indexedDB);
                const put = IDBObjectStore.prototype.put;
                indexedDB.open = function (...args) {
                    openAttempts += 1;
                    if (fault === 'unavailable') throw new DOMException('private', 'SecurityError');
                    if (fault === 'blocked') {
                        const request = {};
                        queueMicrotask(() => request.onblocked());
                        return request;
                    }
                    return open(...args);
                };
                IDBObjectStore.prototype.put = function (...args) {
                    if (fault === 'quota') throw new DOMException('private', 'QuotaExceededError');
                    if (fault === 'abort') this.transaction.abort();
                    return put.apply(this, args);
                };
                window.restoreFault = () => { indexedDB.open = open; IDBObjectStore.prototype.put = put; };
                const id = AppDiagnostics.report({ code: 'PRACTICE_SAVE_FAILED' });
                await AppDiagnostics.flush();
                for (let i = 0; i < 600; i += 1) AppDiagnostics.report({});
                await AppDiagnostics.flush();
                return { id, attempts: openAttempts, status: AppDiagnostics.status(), exported: AppDiagnostics.exportText(id) };
            }, fault);
            assert.equal(initial.attempts, 1);
            assert.equal(initial.status.persistence, 'memory-only');
            assert.ok(initial.status.storage.failure);
            assert.ok(initial.status.events <= 200 && initial.status.bytes <= 256 * 1024);
            assert.ok(JSON.parse(initial.exported).events.length);
            const retry = await page.evaluate(async () => {
                const stillFailed = await AppDiagnosticStore.retry();
                restoreFault();
                const result = await AppDiagnostics.retrySink();
                await AppDiagnostics.flush();
                return { stillFailed, result, snapshot: await AppDiagnosticStore.snapshot() };
            });
            assert.equal(retry.stillFailed.success, false);
            assert.equal(retry.result.success, true);
            assert.ok(retry.snapshot.events.length > 0);
            assert.equal(retry.snapshot.storage.failure, null);
        });
    }

    await t.test('failed explicit retry is observable and missing coordination never opens IndexedDB', async (t) => {
        const { pages: [page] } = await fixture(t);
        const result = await page.evaluate(async () => {
            indexedDB.open = () => { throw new DOMException('private', 'SecurityError'); };
            const failed = await AppDiagnosticStore.retry();
            AppDiagnosticStore.close();
            Object.defineProperty(navigator, 'locks', { value: undefined });
            let attempts = 0;
            indexedDB.open = () => { attempts += 1; };
            const isolated = AppDiagnosticStorage.create();
            await isolated.append(makeEvents(1));
            return { failed, status: isolated.status(), attempts };
        });
        assert.equal(result.failed.success, false);
        assert.equal(result.status.failure, 'COORDINATION_UNAVAILABLE');
        assert.equal(result.attempts, 0);
    });

    await t.test('native localStorage quota blocks persistence and retry until writable coordination recovers', async (t) => {
        const context = await browser.newContext();
        t.after(() => context.close());
        const page = await context.newPage();
        await page.goto(url);
        assert.ok(await fillLocalStorage(page) > 1024 * 1024);
        // Web Storage is full, but an independent native IndexedDB write still works.
        await page.evaluate(async () => {
            const db = await new Promise((resolve, reject) => {
                const request = indexedDB.open('quota-independent-idb');
                request.onupgradeneeded = () => request.result.createObjectStore('probe');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            await new Promise((resolve, reject) => {
                const tx = db.transaction('probe', 'readwrite');
                tx.objectStore('probe').put(true, 'writable');
                tx.oncomplete = resolve;
                tx.onabort = () => reject(tx.error);
            });
            db.close();
        });
        await load(page);
        const blocked = await page.evaluate(async () => {
            const initial = AppDiagnosticStore.status();
            const id = AppDiagnostics.report({ code: 'PRACTICE_SAVE_FAILED' });
            await AppDiagnostics.flush();
            return { initial, id, retry: await AppDiagnostics.retrySink(), optOut: await AppDiagnosticStore.setEnabled(false),
                exported: JSON.parse(AppDiagnostics.exportText(id)), names: await databaseNames() };
        });
        for (const status of [blocked.initial, blocked.retry.status, blocked.optOut.status]) {
            assert.equal(status.persistence, 'memory-only');
            assert.equal(status.coverage, 'partial');
            assert.equal(status.failure, 'COORDINATION_UNAVAILABLE');
        }
        assert.equal(blocked.retry.success, false);
        assert.equal(blocked.optOut.success, false);
        assert.equal(blocked.exported.events[0].eventId, blocked.id);
        assert.deepEqual(blocked.names, ['quota-independent-idb']);
        const recovered = await page.evaluate(async () => {
            localStorage.removeItem('quota-fixture');
            const retry = await AppDiagnostics.retrySink();
            await AppDiagnostics.flush();
            return { retry, snapshot: await AppDiagnosticStore.snapshot() };
        });
        assert.equal(recovered.retry.success, true);
        assert.equal(recovered.retry.status.failure, null);
        assert.deepEqual(recovered.snapshot.events.map((event) => event.eventId), [blocked.id]);
    });

    for (const fault of ['denied', 'discarded']) {
        await t.test(`${fault} control writes latch during retry and preserve the lifecycle generation`, async (t) => {
            const { pages: [page] } = await fixture(t);
            const result = await page.evaluate(async (fault) => {
                const original = AppDiagnosticStore.status();
                const setItem = Storage.prototype.setItem;
                let writes = 0;
                Storage.prototype.setItem = function (key, ...args) {
                    if (key !== AppDiagnosticStorage.CONTROL_KEY) return setItem.call(this, key, ...args);
                    writes += 1;
                    if (fault === 'denied') throw new DOMException('private', 'SecurityError');
                };
                const failed = await AppDiagnosticStore.retry();
                const attempts = writes;
                for (let i = 0; i < 10; i += 1) await persist(makeEvents(1));
                const latched = { status: AppDiagnosticStore.status(), writes, names: await databaseNames() };
                Storage.prototype.setItem = setItem;
                const recovered = await AppDiagnosticStore.retry();
                return { original, failed, attempts, latched, recovered };
            }, fault);
            assert.equal(result.failed.success, false);
            assert.equal(result.failed.status.failure, 'COORDINATION_UNAVAILABLE');
            assert.equal(result.latched.status.persistence, 'memory-only');
            assert.equal(result.latched.writes, result.attempts);
            assert.deepEqual(result.latched.names, []);
            assert.equal(result.recovered.success, true);
            for (const key of ['generation', 'cutoff', 'enabled', 'phase']) {
                assert.equal(result.recovered.status[key], result.original[key]);
            }
        });
    }

    await t.test('reserved coordination space keeps retry, clear, opt-out and reset writable at native quota', async (t) => {
        const { pages: [page] } = await fixture(t);
        await page.evaluate(() => persist(makeEvents(1)));
        assert.ok(await fillLocalStorage(page) > 1024 * 1024);
        const result = await page.evaluate(async () => {
            const retry = await AppDiagnosticStore.retry();
            const clear = await AppDiagnosticStore.clear();
            const optOut = await AppDiagnosticStore.setEnabled(false);
            const optIn = await AppDiagnosticStore.setEnabled(true);
            const reset = await AppDiagnosticStore.withFullReset(async () => ({ success: true }));
            return { retry, clear, optOut, optIn, reset, status: AppDiagnosticStore.status(), names: await databaseNames() };
        });
        for (const action of ['retry', 'clear', 'optOut', 'optIn', 'reset']) assert.equal(result[action].success, true, action);
        assert.equal(result.optOut.status.enabled, false);
        assert.equal(result.status.phase, 'reset-complete');
        assert.deepEqual(result.names, []);
    });

    await t.test('startup stays memory-only until the lifecycle lock verifies writable coordination', async (t) => {
        const { pages: [page] } = await fixture(t);
        const result = await page.evaluate(async () => {
            const isolated = await navigator.locks.request('initial-coordination', async () => {
                const instance = AppDiagnosticStorage.create({ databaseName: 'initial-coordination',
                    controlKey: 'initial-coordination', lockName: 'initial-coordination' });
                window.initialCoordinationStatus = instance.status();
                return instance;
            });
            await isolated.ready;
            const ready = isolated.status();
            isolated.close();
            return { initial: initialCoordinationStatus, ready };
        });
        assert.equal(result.initial.persistence, 'memory-only');
        assert.equal(result.initial.coverage, 'partial');
        assert.equal(result.ready.persistence, 'persisted');
        assert.equal(result.ready.coverage, 'complete');
    });

    await t.test('opt-out propagates, fences pending/relayed events and keeps local export', async (t) => {
        const { pages: [a, b] } = await fixture(t, 2);
        const old = await b.evaluate(async () => {
            const id = AppDiagnostics.report({ code: 'PRACTICE_SAVE_FAILED' });
            await AppDiagnostics.flush();
            return AppDiagnostics.getIncident(id);
        });
        assert.equal((await a.evaluate(() => AppDiagnosticStore.setEnabled(false))).success, true);
        await b.waitForFunction(() => AppDiagnosticStore.status().persistence === 'disabled');
        assert.equal(await b.evaluate((id) => !!AppDiagnostics.getIncident(id), old.eventId), true);
        assert.equal(await b.evaluate(async () => (await AppDiagnosticStore.snapshot()).events.length), 0);
        await a.evaluate(() => AppDiagnosticStore.setEnabled(true));
        const after = await b.evaluate(async (old) => {
            clock += 1;
            await AppDiagnosticStore.append([old, { ...old, timestamp: clock, collection: { ...old.collection, source: 'relay' } }]);
            const empty = await AppDiagnosticStore.snapshot();
            const id = AppDiagnostics.report({ code: 'DATA_EXPORT_FAILED' });
            await AppDiagnostics.flush();
            return { empty, id, current: await AppDiagnosticStore.snapshot(), memory: AppDiagnostics.snapshot() };
        }, old);
        assert.equal(after.empty.events.length, 0);
        assert.deepEqual(after.current.events.map((event) => event.eventId), [after.id]);
        assert.equal(after.memory.events.find((event) => event.eventId === old.eventId).persistence.diagnostics, 'memory-only');
    });

    await t.test('queued append cannot repopulate history when clear wins the lifecycle lock', async (t) => {
        const { pages: [a, b] } = await fixture(t, 2);
        await a.evaluate(() => {
            window.holding = navigator.locks.request(AppDiagnosticStorage.LOCK_NAME, async () => {
                window.locked = true;
                await new Promise((resolve) => { window.release = resolve; });
            });
        });
        await a.waitForFunction(() => window.locked);
        await a.evaluate(() => { window.clearing = AppDiagnosticStore.clear(); });
        await b.evaluate(() => { AppDiagnostics.report({ code: 'PRACTICE_SAVE_FAILED' }); window.flushing = AppDiagnostics.flush(); });
        await b.waitForFunction(() => AppDiagnosticStore.status().pendingEvents === 1);
        await a.evaluate(async () => { release(); await holding; await clearing; });
        await b.evaluate(() => flushing);
        assert.equal(await a.evaluate(async () => (await AppDiagnosticStore.snapshot()).events.length), 0);
        assert.equal(await b.evaluate(() => AppDiagnostics.snapshot().events[0].persistence.diagnostics), 'memory-only');
    });

    await t.test('an occupied lifecycle lock cannot grow the asynchronous queue beyond its byte/event ceilings', async (t) => {
        const { pages: [page] } = await fixture(t);
        await page.evaluate(() => {
            navigator.locks.request(AppDiagnosticStorage.LOCK_NAME, async () => {
                window.locked = true;
                await new Promise((resolve) => { window.release = resolve; });
            });
        });
        await page.waitForFunction(() => window.locked);
        const pending = await page.evaluate(() => {
            window.batches = Array.from({ length: 30 }, () => AppDiagnosticStore.append(makeEvents(20)));
            return AppDiagnosticStore.status();
        });
        assert.ok(pending.pendingEvents > 0 && pending.pendingEvents <= 200);
        assert.ok(pending.pendingBytes <= 256 * 1024);
        assert.ok(pending.dropped > 0);
        const after = await page.evaluate(async () => { release(); await Promise.all(batches); return AppDiagnosticStore.status(); });
        assert.equal(after.pendingEvents, 0);
        assert.equal(after.pendingBytes, 0);
        assert.equal(after.failure, null);
    });

    await t.test('an aborted multi-record transaction confirms no partial writes and preserves prior history', async (t) => {
        const { pages: [page] } = await fixture(t);
        const result = await page.evaluate(async () => {
            const original = makeEvents(1)[0];
            await persist([original]);
            const put = IDBObjectStore.prototype.put;
            let attempts = 0;
            IDBObjectStore.prototype.put = function (...args) {
                attempts += 1;
                if (attempts === 2) throw new DOMException('private', 'QuotaExceededError');
                return put.apply(this, args);
            };
            const receipt = await AppDiagnosticStore.append(makeEvents(3));
            IDBObjectStore.prototype.put = put;
            await AppDiagnosticStore.retry();
            return { id: original.eventId, receipt, retained: await AppDiagnosticStore.snapshot() };
        });
        assert.equal(result.receipt.persistence, 'memory-only');
        assert.deepEqual(result.receipt.persistedEventIds, []);
        assert.deepEqual(result.retained.events.map((event) => event.eventId), [result.id]);
    });

    await t.test('diagnostic clear leaves learning data intact; backup/restore cannot restore diagnostics', async (t) => {
        const { pages: [page] } = await fixture(t);
        for (const name of ['data/v2/dataCatalog.js', 'data/v2/dataKernel.js', 'data/practiceRecordSource.js',
            'data/v2/readingVocabularyModel.js', 'data/v2/appData.js']) await page.addScriptTag({ content: source(name) });
        const result = await page.evaluate(async () => {
            await AppData.ready;
            await AppData.preferences.setTheme('diagnostic-learning-fixture');
            const events = makeEvents(1);
            await persist(events);
            const backup = await AppData.backups.export();
            await AppData.backups.create({ id: 'diagnostic-backup-isolation' });
            await AppDiagnosticStore.clear();
            const themeAfterClear = await AppData.preferences.getTheme();
            await AppData.preferences.setTheme('changed');
            await AppData.backups.restore('diagnostic-backup-isolation');
            return { backupContainsEvent: JSON.stringify(backup).includes(events[0].eventId), themeAfterClear,
                themeAfterRestore: await AppData.preferences.getTheme(), history: await AppDiagnosticStore.snapshot() };
        });
        assert.equal(result.backupContainsEvent, false);
        assert.equal(result.themeAfterClear, 'diagnostic-learning-fixture');
        assert.equal(result.themeAfterRestore, result.themeAfterClear);
        assert.equal(result.history.events.length, 0);
    });

    await t.test('blocked diagnostic removal reports incomplete status until the native handle closes', async (t) => {
        const { pages: [a, b] } = await fixture(t, 2);
        await a.evaluate(() => persist(makeEvents(1)));
        await b.evaluate(async () => {
            window.blocker = await new Promise((resolve) => {
                const request = indexedDB.open(AppDiagnosticStorage.DATABASE_NAME);
                request.onsuccess = () => resolve(request.result);
            });
        });
        await a.evaluate(() => { window.clearDone = false; window.clearing = AppDiagnosticStore.setEnabled(false).then((value) => { clearDone = true; return value; }); });
        await a.waitForFunction(() => AppDiagnosticStore.status().failure === 'DELETE_BLOCKED');
        assert.equal(await a.evaluate(() => window.clearDone), false);
        await b.evaluate(() => blocker.close());
        assert.equal((await a.evaluate(() => clearing)).success, true);
        assert.deepEqual(await a.evaluate(() => databaseNames()), []);
    });

    await t.test('full reset fences surviving, reconnecting and newly opened windows through blocked deletion', async (t) => {
        const { pages: [a, b], context } = await fixture(t, 2);
        const stale = await b.evaluate(async () => { const events = makeEvents(1); await persist(events); return events[0]; });
        await a.addScriptTag({ content: source('core/siteDataReset.js') });
        await a.evaluate(() => {
            window.messages = [];
            window.showMessage = (message, type) => messages.push({ message, type });
            window.ExternalBackupService = {
                withFullResetLock: (callback) => navigator.locks.request('test-external-backup-reset', callback),
                prepareForFullReset: async () => ({ success: true }),
                rollbackFullResetPreparation: async () => true, commitFullResetPreparation: async () => true
            };
        });
        await b.evaluate(async () => {
            window.blocker = await new Promise((resolve) => {
                const request = indexedDB.open(AppDiagnosticStorage.DATABASE_NAME);
                request.onsuccess = () => resolve(request.result);
            });
        });
        await a.evaluate(() => { window.resetDone = false; window.resetting = SiteDataReset.perform({ reload: false }).then((value) => { resetDone = true; return value; }); });
        await a.waitForFunction(() => messages.some((message) => message.type === 'warning'));
        assert.equal(await a.evaluate(() => resetDone), false);
        const during = await context.newPage();
        await during.goto(url);
        await load(during);
        assert.equal(await during.evaluate(() => AppDiagnosticStore.status().suspended), true);
        await b.evaluate(async () => { AppDiagnostics.report({}); await AppDiagnostics.flush(); blocker.close(); });
        const result = await a.evaluate(() => resetting);
        assert.equal(result.success, true);
        assert.equal(result.externalBackupFilesPreserved, true);
        for (const page of [a, b, during]) {
            const state = await page.evaluate(async (stale) => {
                await AppDiagnosticStore.append([stale]);
                AppDiagnostics.report({});
                await AppDiagnostics.flush();
                return { retry: await AppDiagnosticStore.retry(), names: await databaseNames(), status: AppDiagnosticStore.status() };
            }, stale);
            assert.equal(state.retry.success, false);
            assert.equal(state.status.suspended, true);
            assert.ok(!state.names.includes('IELTSAtlasDiagnosticsV1'));
        }
        const fresh = await context.newPage();
        await fresh.goto(url);
        await load(fresh);
        const resumed = await fresh.evaluate(async () => { clock += 1; await persist(makeEvents(1)); return AppDiagnosticStore.snapshot(); });
        assert.equal(resumed.events.length, 1);
    });

    await t.test('late open after timeout cannot recreate diagnostics after reset', async (t) => {
        const { pages: [page] } = await fixture(t, 1, { timeoutMs: 25 });
        const result = await page.evaluate(async () => {
            const nativeOpen = indexedDB.open.bind(indexedDB);
            indexedDB.open = (...args) => {
                const delayed = {};
                setTimeout(() => {
                    const request = nativeOpen(...args);
                    for (const type of ['upgradeneeded', 'success', 'error', 'blocked']) request['on' + type] = () => {
                        for (const key of ['result', 'transaction', 'error']) {
                            try { delayed[key] = request[key]; } catch (_) { }
                        }
                        delayed['on' + type]?.();
                    };
                }, 100);
                return delayed;
            };
            await persist(makeEvents(1));
            const failed = AppDiagnosticStore.status();
            await AppDiagnosticStore.withFullReset(async () => {
                await new Promise((resolve) => { indexedDB.deleteDatabase(AppDiagnosticStorage.DATABASE_NAME).onsuccess = resolve; });
                return { success: true };
            });
            await new Promise((resolve) => setTimeout(resolve, 160));
            return { failed, names: await databaseNames() };
        });
        assert.equal(result.failed.failure, 'OPEN_TIMEOUT');
        assert.deepEqual(result.names, []);
    });

    await t.test('missed broadcasts/storage events cannot bypass reset fencing; partial reset stays suspended', async (t) => {
        const { pages: [a], context } = await fixture(t);
        const b = await context.newPage();
        await b.goto(url);
        await b.evaluate(() => {
            window.BroadcastChannel = undefined;
            const add = window.addEventListener;
            window.addEventListener = function (type, ...args) {
                if (type !== 'storage') return add.call(this, type, ...args);
            };
        });
        await load(b);
        const old = await b.evaluate(() => makeEvents(1)[0]);
        await a.evaluate(() => AppDiagnosticStore.withFullReset(async () => ({ success: false })));
        const blocked = await b.evaluate(async (old) => {
            await AppDiagnosticStore.append([old]);
            return AppDiagnosticStore.status();
        }, old);
        assert.equal(blocked.suspended, true);
        assert.equal(blocked.phase, 'resetting');
        await a.evaluate(() => AppDiagnosticStore.withFullReset(async () => ({ success: true })));
        await b.evaluate(async (old) => { clock += 1; await AppDiagnosticStore.append([old]); }, old);
        assert.deepEqual(await b.evaluate(() => databaseNames()), []);
        assert.equal(await b.evaluate(async () => (await AppDiagnosticStore.retry()).success), false);
    });
});
