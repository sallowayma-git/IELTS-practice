(function installReadingViewCache(global) {
    'use strict';
    const VERSION = 1;
    const PAGE_SIZE = 10;
    const clone = value => JSON.parse(JSON.stringify(value));
    const digest = global.__AppDataV2Internals.checksum;
    const pageKey = (articleId, page) => JSON.stringify(['words', articleId, page]);

    // Disposable, excluded from backups. The canonical database's atomic token
    // is checked around every read, including reads made after a missed broadcast.
    global.createReadingViewCache = function ({ readToken, readSnapshot }) {
        let connection;
        let building = null;
        const fallback = new Map();
        async function database() {
            if (!global.indexedDB) return null;
            if (!connection) connection = new Promise(resolve => {
                let completed = false;
                const finish = value => { if (!completed) { completed = true; clearTimeout(timer); resolve(value); } };
                const timer = setTimeout(() => finish(null), 3000);
                let request;
                try { request = global.indexedDB.open('IELTSAtlasReadingViewCache', 1); }
                catch (_) { finish(null); return; }
                request.onupgradeneeded = () => request.result.createObjectStore('rows', { keyPath: 'key' });
                request.onsuccess = () => {
                    if (completed) { request.result.close(); return; }
                    const db = request.result;
                    db.onversionchange = () => { db.close(); connection = null; };
                    finish(db);
                };
                request.onerror = request.onblocked = () => finish(null);
            });
            return connection;
        }
        async function access(mode, work) {
            const db = await database();
            if (!db) return work(null);
            return new Promise((resolve, reject) => {
                let value;
                const tx = db.transaction('rows', mode);
                const timer = setTimeout(() => { try { tx.abort(); } catch (_) {} reject(new Error('Reading cache timeout')); }, 5000);
                tx.oncomplete = () => { clearTimeout(timer); resolve(value); };
                tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(tx.error || new Error('Reading cache unavailable')); };
                work(tx.objectStore('rows'), result => { value = result; });
            });
        }
        async function read(key, token) {
            let row;
            try {
                row = await access('readonly', (store, done) => {
                    if (!store) return fallback.get(key);
                    const request = store.get(key);
                    request.onsuccess = () => done(request.result);
                });
            } catch (_) { return null; }
            try {
                if (!row || row.version !== VERSION || row.token !== token || row.checksum !== digest(row.value)) return null;
                return clone(row.value);
            } catch (_) { return null; }
        }
        async function build() {
            if (building) return building;
            building = (async () => {
                for (let retry = 0; retry < 3; retry++) {
                    const token = await readToken();
                    const result = await readSnapshot();
                    const snapshot = result.snapshot;
                    const words = new Map();
                    for (const [listId, list] of [['default', snapshot.words], ...Object.entries(snapshot.lists)]) {
                        for (const word of Array.isArray(list) ? list : list.words || []) words.set(JSON.stringify([listId, word.id]), word.word);
                    }
                    const sources = new Map(snapshot.reading.sources.map(source => [source.id, source]));
                    const terms = new Map(snapshot.reading.terms.map(term => [term.id, words.get(JSON.stringify([term.wordRef.listId, term.wordRef.wordId]))]));
                    const visits = new Map(snapshot.reading.visits.map(visit => [visit.articleId, visit]));
                    const associations = new Map();
                    const distinct = new Set();
                    for (const row of snapshot.reading.associations) {
                        if (!associations.has(row.articleId)) associations.set(row.articleId, []);
                        associations.get(row.articleId).push(row);
                        distinct.add(row.termId);
                    }
                    const rows = [];
                    const articles = [];
                    const search = [];
                    for (const article of snapshot.reading.articles) {
                        const related = associations.get(article.id) || [];
                        const visit = visits.get(article.id);
                        if (!related.length && !visit) continue;
                        const names = [...new Set(related.map(row => terms.get(row.termId)).filter(Boolean))];
                        const source = sources.get(article.sourceId);
                        articles.push({ articleId: article.id, examId: article.examId, title: article.title,
                            source: { kind: source.kind, id: source.libraryId }, wordCount: names.length,
                            lastActivityAt: related.reduce((at, row) => Math.max(at, Date.parse(row.updatedAt) || 0), visit ? Date.parse(visit.lastVisitedAt) || 0 : 0) });
                        search.push({ articleId: article.id, words: names.map(word => word.toLowerCase()) });
                        for (let offset = 0; offset < names.length; offset += PAGE_SIZE) {
                            rows.push([pageKey(article.id, offset / PAGE_SIZE), { words: names.slice(offset, offset + PAGE_SIZE) }]);
                        }
                        // Backfill cooperatively instead of monopolizing an entire frame.
                        if (articles.length % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
                    }
                    const index = { articles, sources: snapshot.reading.sources, distinctWordCount: distinct.size,
                        revision: result.revision, generation: result.generation };
                    if (await readToken() !== token) continue;
                    rows.push(['index', index], ['search', { rows: search }]);
                    const records = rows.map(([key, value]) => ({ key, version: VERSION, token, value, checksum: digest(value) }));
                    try {
                        await access('readwrite', store => {
                            if (!store) { fallback.clear(); records.forEach(row => fallback.set(row.key, row)); return; }
                            store.clear(); records.forEach(row => store.put(row));
                        });
                    } catch (_) {
                        // A failed cache write must never affect the acknowledged data.
                        fallback.clear(); records.forEach(row => fallback.set(row.key, row));
                        connection = Promise.resolve(null);
                    }
                    if (await readToken() === token) return;
                }
                throw new Error('Reading data changed repeatedly; retry loading');
            })();
            try { return await building; } finally { building = null; }
        }
        async function coherent(key, empty) {
            for (let retry = 0; retry < 4; retry++) {
                const token = await readToken();
                const index = await read('index', token);
                if (!index) { await build(); continue; }
                const value = key === 'index' ? index : await read(key, token);
                if (await readToken() !== token) continue;
                if (value) return { ...value, token };
                if (empty && empty(index)) return { words: [], token };
                // Missing/corrupt search row is recoverable without changing owners.
                await build();
            }
            throw new Error('Reading cache unavailable; retry loading');
        }
        return {
            async index() { return coherent('index'); },
            async words(articleId, page = 0) {
                if (!Number.isSafeInteger(page) || page < 0) throw new Error('Invalid vocabulary page');
                // An absent article/page is empty, never a stale page from another token.
                return coherent(pageKey(String(articleId), page), index => {
                    const article = index.articles.find(row => row.articleId === String(articleId));
                    return !article || page * PAGE_SIZE >= article.wordCount;
                });
            },
            async search(query) {
                const result = await coherent('search');
                return result.rows.filter(row => row && typeof row === 'object'
                    && Array.isArray(row.words) && row.words.some(word => word.includes(String(query).toLowerCase())))
                    .map(row => row.articleId);
            }
        };
    };
})(typeof window !== 'undefined' ? window : globalThis);
