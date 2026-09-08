(function installReadingVocabularyModel(global) {
    'use strict';

    // This is the shared, storage-free contract. Persistence must commit the
    // returned vocabulary snapshots and reading relationships together.
    const SCHEMA_VERSION = 1;
    const READING_LIST_ID = 'reading-highlights';
    const TABLES = ['sources', 'articles', 'terms', 'associations', 'occurrences', 'visits'];
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

    function fail(message) {
        const ErrorType = global.__AppDataV2Internals && global.__AppDataV2Internals.AppDataError;
        if (ErrorType) throw new ErrorType('VALIDATION', message);
        const error = new Error(message);
        error.code = 'VALIDATION';
        throw error;
    }

    function object(value, label) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
        return value;
    }

    function nonempty(value, label) {
        if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a nonempty string`);
        return value.trim();
    }

    function exactString(value, label) {
        const trimmed = nonempty(value, label);
        if (trimmed !== value) fail(`${label} must not have surrounding whitespace`);
        return value;
    }

    function copy(value) {
        try {
            return JSON.parse(JSON.stringify(value, (_key, item) => {
                if (item === undefined || typeof item === 'function' || typeof item === 'symbol'
                    || typeof item === 'bigint' || (typeof item === 'number' && !Number.isFinite(item))) {
                    fail('Reading vocabulary snapshots must contain JSON values');
                }
                return item;
            }));
        } catch (error) {
            if (error && error.code === 'VALIDATION') throw error;
            fail('Reading vocabulary snapshots must be JSON-serializable');
        }
    }

    function timestamp(value, label = 'at') {
        nonempty(value, label);
        if (!Number.isFinite(Date.parse(value))) fail(`${label} must be an ISO timestamp`);
        const normalized = new Date(value).toISOString();
        if (normalized !== value) fail(`${label} must use UTC ISO format (YYYY-MM-DDTHH:mm:ss.sssZ)`);
        return normalized;
    }

    function normalizeTerm(value) { return nonempty(value, 'word').toLowerCase(); }
    function key(...parts) { return JSON.stringify(parts); }

    function sourceId(source) {
        object(source, 'source');
        if (source.kind !== 'builtin' && source.kind !== 'imported') fail('source.kind must be builtin or imported');
        return key('source', source.kind, nonempty(source.id, 'source.id'));
    }

    function articleId(source, examId) { return key('article', sourceId(source), nonempty(examId, 'examId')); }
    function contentRef(exam) {
        object(exam, 'exam');
        return key(...['sourceKind', 'dataKey', 'path', 'filename', 'importKey'].map((field) => {
            const value = typeof exam[field] === 'string' ? exam[field].trim() : '';
            return field === 'path' || field === 'filename' ? value.replace(/\\/g, '/') : value;
        }));
    }
    function termId(word) { return key('term', normalizeTerm(word)); }
    function associationId(article, term) { return key('association', article, term); }

    function normalizedTermFromId(id) {
        let parts;
        try { parts = JSON.parse(exactString(id, 'termId')); } catch (_) { fail('Invalid termId'); }
        if (!Array.isArray(parts) || parts.length !== 2 || parts[0] !== 'term'
            || typeof parts[1] !== 'string' || termId(parts[1]) !== id) fail('Invalid termId');
        return parts[1];
    }

    function anchor(value) {
        object(value, 'occurrence');
        const scopeId = nonempty(value.scopeId, 'occurrence.scopeId');
        const contentVersion = nonempty(value.contentVersion, 'occurrence.contentVersion');
        if (!Number.isSafeInteger(value.startOffset) || value.startOffset < 0
            || !Number.isSafeInteger(value.endOffset) || value.endOffset <= value.startOffset) {
            fail('Occurrence offsets must be nonnegative UTF-16 integers with endOffset > startOffset');
        }
        nonempty(value.quote, 'occurrence.quote');
        if (value.endOffset - value.startOffset !== value.quote.length) fail('Occurrence offsets must span the exact quote');
        for (const field of ['before', 'after']) {
            if (own(value, field) && typeof value[field] !== 'string') fail(`occurrence.${field} must be a string`);
        }
        return {
            scopeId, contentVersion, startOffset: value.startOffset, endOffset: value.endOffset,
            quote: value.quote, before: value.before || '', after: value.after || ''
        };
    }

    function occurrenceId(article, term, occurrence) {
        exactString(article, 'articleId');
        exactString(term, 'termId');
        const selection = anchor(occurrence);
        return key('occurrence', article, term, selection.scopeId, selection.contentVersion,
            selection.startOffset, selection.endOffset);
    }

    function collectionWords(value) {
        if (Array.isArray(value)) return value;
        return value && Array.isArray(value.words) ? value.words : [];
    }

    function listWords(snapshot, listId) {
        return listId === 'default' ? snapshot.words : collectionWords(snapshot.lists[listId]);
    }

    function ownerWord(snapshot, ref) {
        object(ref, 'wordRef');
        exactString(ref.listId, 'wordRef.listId');
        exactString(ref.wordId, 'wordRef.wordId');
        const matches = listWords(snapshot, ref.listId).filter((word) => word && word.id === ref.wordId);
        if (matches.length !== 1) fail('Canonical wordRef must resolve to exactly one existing vocabulary record');
        return matches[0];
    }

    function indexes(reading) {
        const result = {};
        for (const table of TABLES) {
            if (!Array.isArray(reading[table])) fail(`reading.${table} must be an array`);
            const rows = new Map();
            for (const row of reading[table]) {
                object(row, `reading.${table} row`);
                exactString(row.id, `reading.${table}.id`);
                if (rows.has(row.id)) fail(`Duplicate reading.${table} identity`);
                rows.set(row.id, row);
            }
            result[table] = rows;
        }
        return result;
    }

    function validate(snapshot) {
        object(snapshot, 'snapshot');
        if (!Array.isArray(snapshot.words)) fail('snapshot.words must be an array');
        object(snapshot.lists, 'snapshot.lists');
        const reading = object(snapshot.reading, 'snapshot.reading');
        if (reading.schemaVersion !== SCHEMA_VERSION) fail('Unsupported reading vocabulary schemaVersion');
        const idx = indexes(reading);
        for (const source of reading.sources) {
            exactString(source.libraryId, 'source.libraryId');
            if (source.id !== sourceId({ kind: source.kind, id: source.libraryId })) fail('Invalid source identity');
        }
        for (const article of reading.articles) {
            exactString(article.examId, 'article.examId');
            const source = idx.sources.get(article.sourceId);
            if (!source || article.id !== articleId({ kind: source.kind, id: source.libraryId }, article.examId)) fail('Invalid article source or identity');
            if (typeof article.title !== 'string') fail('Article title must be a string');
            if (own(article, 'contentRefs')) {
                if (!Array.isArray(article.contentRefs)) fail('Article contentRefs must be an array');
                const refs = new Set();
                for (const ref of article.contentRefs) {
                    exactString(ref, 'article.contentRefs entry');
                    if (refs.has(ref)) fail('Article contentRefs must be unique');
                    refs.add(ref);
                }
                if (article.contentRefs.some((ref, index) => index > 0 && article.contentRefs[index - 1] > ref)) {
                    fail('Article contentRefs must be sorted');
                }
            }
            timestamp(article.createdAt, 'article.createdAt');
            timestamp(article.updatedAt, 'article.updatedAt');
            if (article.createdAt > article.updatedAt) fail('Article timestamps are out of order');
            if (article.titleUpdatedAt === null) {
                if (article.title !== '') fail('An article without a title update must have an empty title');
            } else {
                timestamp(article.titleUpdatedAt, 'article.titleUpdatedAt');
                if (article.titleUpdatedAt < article.createdAt || article.titleUpdatedAt > article.updatedAt) {
                    fail('Article title timestamp must be within article activity timestamps');
                }
            }
        }
        for (const term of reading.terms) {
            if (term.normalizedTerm !== normalizeTerm(term.normalizedTerm) || term.id !== termId(term.normalizedTerm)) fail('Invalid normalized term identity');
            const word = ownerWord(snapshot, term.wordRef);
            if (normalizeTerm(word.word) !== term.normalizedTerm) fail('Canonical wordRef has a different normalized term');
            timestamp(term.createdAt, 'term.createdAt');
        }
        const occurrenceCounts = new Map();
        for (const occurrence of reading.occurrences) {
            exactString(occurrence.scopeId, 'occurrence.scopeId');
            exactString(occurrence.contentVersion, 'occurrence.contentVersion');
            const association = idx.associations.get(occurrence.associationId);
            if (!association) fail('Occurrence has a dangling article-term association');
            if (occurrence.id !== occurrenceId(association.articleId, association.termId, occurrence)) fail('Invalid occurrence identity');
            const term = idx.terms.get(association.termId);
            if (!term || normalizeTerm(occurrence.quote) !== term.normalizedTerm) fail('Occurrence quote must match its normalized term');
            timestamp(occurrence.createdAt, 'occurrence.createdAt');
            timestamp(occurrence.updatedAt, 'occurrence.updatedAt');
            if (occurrence.createdAt > occurrence.updatedAt) fail('Occurrence timestamps are out of order');
            occurrenceCounts.set(association.id, (occurrenceCounts.get(association.id) || 0) + 1);
        }
        for (const association of reading.associations) {
            if (!idx.articles.has(association.articleId) || !idx.terms.has(association.termId)) fail('Association has a dangling article or term');
            if (association.id !== associationId(association.articleId, association.termId)) fail('Invalid article-term association identity');
            if (typeof association.manual !== 'boolean') fail('Association manual flag must be boolean');
            if (!association.manual && !occurrenceCounts.get(association.id)) fail('Occurrence-only associations must have an occurrence');
            timestamp(association.createdAt, 'association.createdAt');
            timestamp(association.updatedAt, 'association.updatedAt');
            if (association.createdAt > association.updatedAt) fail('Association timestamps are out of order');
        }
        for (const visit of reading.visits) {
            if (!idx.articles.has(visit.articleId) || visit.id !== visit.articleId) fail('Visit has an invalid article identity');
            timestamp(visit.firstVisitedAt, 'visit.firstVisitedAt');
            timestamp(visit.lastVisitedAt, 'visit.lastVisitedAt');
            if (visit.firstVisitedAt > visit.lastVisitedAt) fail('Visit timestamps are out of order');
        }
        copy(snapshot);
        return true;
    }

    function createSnapshot(input = {}) {
        object(input, 'snapshot');
        const snapshot = copy({
            words: own(input, 'words') ? input.words : [],
            lists: own(input, 'lists') ? input.lists : {},
            reading: own(input, 'reading') ? input.reading : {
                schemaVersion: SCHEMA_VERSION, sources: [], articles: [], terms: [],
                associations: [], occurrences: [], visits: []
            }
        });
        validate(snapshot);
        return snapshot;
    }

    function writable(snapshot) { validate(snapshot); return copy(snapshot); }
    function finish(snapshot) { validate(snapshot); return snapshot; }

    function ensureArticle(snapshot, command, at) {
        const source = object(command.source, 'source');
        const article = object(command.article, 'article');
        const sourceKey = sourceId(source);
        const articleKey = articleId(source, article.examId);
        const hasTitle = own(article, 'title');
        if (hasTitle && typeof article.title !== 'string') fail('article.title must be a string');
        const ref = own(article, 'contentRef') ? exactString(article.contentRef, 'article.contentRef') : null;
        if (!snapshot.reading.sources.some((row) => row.id === sourceKey)) {
            snapshot.reading.sources.push({ id: sourceKey, kind: source.kind, libraryId: source.id.trim() });
        }
        let row = snapshot.reading.articles.find((item) => item.id === articleKey);
        if (row && ref !== null && row.contentRefs && (row.contentRefs.length > 1
            || (row.contentRefs.length === 1 && row.contentRefs[0] !== ref))) {
            fail('Article content reference has changed or is ambiguous');
        }
        if (!row) {
            row = {
                id: articleKey, sourceId: sourceKey, examId: article.examId.trim(),
                title: hasTitle ? article.title : '', titleUpdatedAt: hasTitle ? at : null,
                createdAt: at, updatedAt: at
            };
            snapshot.reading.articles.push(row);
        } else {
            // Title-less activity must not block delayed title-bearing updates.
            if (hasTitle && (row.titleUpdatedAt === null || at >= row.titleUpdatedAt)) {
                row.title = article.title;
                row.titleUpdatedAt = at;
            }
            row.createdAt = at < row.createdAt ? at : row.createdAt;
            row.updatedAt = at > row.updatedAt ? at : row.updatedAt;
        }
        if (ref !== null) row.contentRefs = [ref];
        return row;
    }

    function allLists(snapshot) { return ['default'].concat(Object.keys(snapshot.lists).filter((id) => id !== 'default').sort()); }

    function findExistingOwner(snapshot, normalizedTerm, explicitRef) {
        if (explicitRef) {
            if (normalizeTerm(ownerWord(snapshot, explicitRef).word) !== normalizedTerm) fail('wordRef must match the collected normalized term');
            return copy(explicitRef);
        }
        for (const listId of allLists(snapshot)) {
            const word = listWords(snapshot, listId).find((item) => item && typeof item.word === 'string'
                && item.word.trim().toLowerCase() === normalizedTerm);
            if (word) {
                const wordId = exactString(word.id, 'Existing canonical word.id');
                const ref = { listId, wordId };
                ownerWord(snapshot, ref);
                return ref;
            }
        }
        return null;
    }

    function addCanonicalWord(snapshot, input, normalizedTerm, at) {
        const meaning = nonempty(input.meaning, 'New canonical word.meaning');
        const id = own(input, 'id') ? exactString(input.id, 'word.id') : key('reading-word', normalizedTerm);
        const existing = snapshot.lists[READING_LIST_ID];
        if (own(snapshot.lists, READING_LIST_ID) && !Array.isArray(existing)) {
            object(existing, `lists.${READING_LIST_ID}`);
            if (!Array.isArray(existing.words)) fail(`lists.${READING_LIST_ID}.words must be an array`);
        }
        if (collectionWords(existing).some((word) => word && word.id === id)) fail('New canonical word.id conflicts with an existing vocabulary record');
        const word = {
            ...copy(input),
            id, word: input.word.trim(), meaning,
            example: typeof input.example === 'string' ? input.example.trim() : '',
            note: typeof input.note === 'string' ? input.note.trim() : '',
            source: 'reading-highlight', easeFactor: null, interval: 1, repetitions: 0,
            intraCycles: 0, correctCount: 0, lastReviewed: null, nextReview: null,
            createdAt: at, updatedAt: at
        };
        if (Array.isArray(existing)) existing.push(word);
        else {
            const list = existing ? object(existing, `lists.${READING_LIST_ID}`) : { id: READING_LIST_ID, words: [] };
            list.words.push(word);
            snapshot.lists[READING_LIST_ID] = list;
        }
        return { listId: READING_LIST_ID, wordId: id };
    }

    function collect(snapshot, command) {
        object(command, 'collect command');
        const at = timestamp(command.at);
        const input = object(command.word, 'word');
        const normalizedTerm = normalizeTerm(input.word);
        if (own(command, 'wordRef')) {
            object(command.wordRef, 'wordRef');
            exactString(command.wordRef.listId, 'wordRef.listId');
            exactString(command.wordRef.wordId, 'wordRef.wordId');
        }
        const selection = own(command, 'occurrence') ? anchor(command.occurrence) : null;
        if (selection && normalizeTerm(selection.quote) !== normalizedTerm) fail('Occurrence quote must match the collected normalized term');
        if (own(command, 'manual') && typeof command.manual !== 'boolean') fail('manual must be boolean');
        const manual = own(command, 'manual') ? command.manual : !selection;
        if (!manual && !selection) fail('Collection requires a manual association or selected occurrence');
        const next = writable(snapshot);
        const article = ensureArticle(next, command, at);
        const termKey = termId(input.word);
        let term = next.reading.terms.find((row) => row.id === termKey);
        if (!term) {
            const ref = findExistingOwner(next, normalizedTerm, command.wordRef)
                || addCanonicalWord(next, input, normalizedTerm, at);
            term = { id: termKey, normalizedTerm, wordRef: ref, createdAt: at };
            next.reading.terms.push(term);
        } else if (command.wordRef && (command.wordRef.listId !== term.wordRef.listId || command.wordRef.wordId !== term.wordRef.wordId)) {
            fail('An existing reader term already has a different canonical wordRef');
        }
        const associationKey = associationId(article.id, term.id);
        let association = next.reading.associations.find((row) => row.id === associationKey);
        if (!association) {
            association = { id: associationKey, articleId: article.id, termId: term.id, manual, createdAt: at, updatedAt: at };
            next.reading.associations.push(association);
        } else {
            association.manual = association.manual || manual;
            association.createdAt = at < association.createdAt ? at : association.createdAt;
            association.updatedAt = at > association.updatedAt ? at : association.updatedAt;
        }
        if (selection) {
            const id = occurrenceId(article.id, term.id, selection);
            const occurrence = next.reading.occurrences.find((row) => row.id === id);
            if (!occurrence) {
                next.reading.occurrences.push(Object.assign({ id, associationId: associationKey }, selection, { createdAt: at, updatedAt: at }));
            } else {
                if (at >= occurrence.updatedAt) Object.assign(occurrence, selection);
                occurrence.createdAt = at < occurrence.createdAt ? at : occurrence.createdAt;
                occurrence.updatedAt = at > occurrence.updatedAt ? at : occurrence.updatedAt;
            }
        }
        return finish(next);
    }

    function recordVisit(snapshot, command) {
        object(command, 'recordVisit command');
        const at = timestamp(command.at);
        const next = writable(snapshot);
        const article = ensureArticle(next, command, at);
        const visit = next.reading.visits.find((row) => row.articleId === article.id);
        if (!visit) next.reading.visits.push({ id: article.id, articleId: article.id, firstVisitedAt: at, lastVisitedAt: at });
        else {
            visit.firstVisitedAt = at < visit.firstVisitedAt ? at : visit.firstVisitedAt;
            visit.lastVisitedAt = at > visit.lastVisitedAt ? at : visit.lastVisitedAt;
        }
        return finish(next);
    }

    function removeAssociations(next, predicate) {
        const removed = new Set(next.reading.associations.filter(predicate).map((row) => row.id));
        next.reading.associations = next.reading.associations.filter((row) => !removed.has(row.id));
        next.reading.occurrences = next.reading.occurrences.filter((row) => !removed.has(row.associationId));
    }

    function removeOccurrence(snapshot, command) {
        object(command, 'removeOccurrence command');
        const id = exactString(command.occurrenceId, 'occurrenceId');
        const next = writable(snapshot);
        const occurrence = next.reading.occurrences.find((row) => row.id === id);
        if (!occurrence) return next;
        next.reading.occurrences = next.reading.occurrences.filter((row) => row.id !== id);
        removeAssociations(next, (row) => row.id === occurrence.associationId && !row.manual
            && !next.reading.occurrences.some((item) => item.associationId === row.id));
        return finish(next);
    }

    function removeArticleTerm(snapshot, command) {
        object(command, 'removeArticleTerm command');
        const article = exactString(command.articleId, 'articleId');
        const term = exactString(command.termId, 'termId');
        const next = writable(snapshot);
        removeAssociations(next, (row) => row.articleId === article && row.termId === term);
        return finish(next);
    }

    function clearArticle(snapshot, command) {
        object(command, 'clearArticle command');
        const id = exactString(command.articleId, 'articleId');
        const next = writable(snapshot);
        removeAssociations(next, (row) => row.articleId === id);
        return finish(next);
    }

    function deleteCanonicalTerm(snapshot, command) {
        object(command, 'deleteCanonicalTerm command');
        const id = exactString(command.termId, 'termId');
        const normalizedTerm = normalizedTermFromId(id);
        const next = writable(snapshot);
        removeAssociations(next, (row) => row.termId === id);
        next.reading.terms = next.reading.terms.filter((row) => row.id !== id);
        const keep = (word) => !(word && typeof word.word === 'string' && word.word.trim().toLowerCase() === normalizedTerm);
        next.words = next.words.filter(keep);
        for (const listId of Object.keys(next.lists)) {
            const list = next.lists[listId];
            if (Array.isArray(list)) next.lists[listId] = list.filter(keep);
            else if (list && Array.isArray(list.words)) list.words = list.words.filter(keep);
        }
        return finish(next);
    }

    // Backups merge relationships, never review progress. The authoritative
    // persistence layer applies deletion tombstones before/after this union.
    function stableJson(value) {
        if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
        if (value && typeof value === 'object') {
            return `{${Object.keys(value).sort().map((name) => `${JSON.stringify(name)}:${stableJson(value[name])}`).join(',')}}`;
        }
        return JSON.stringify(value);
    }

    function mergeMetadata(existing, incoming, clock) {
        const next = { ...existing };
        const leftAt = clock ? existing[clock] || '' : '';
        const rightAt = clock ? incoming[clock] || '' : '';
        for (const name of Object.keys(incoming)) {
            if (!own(existing, name) || rightAt > leftAt
                || (rightAt === leftAt && stableJson(incoming[name]) > stableJson(existing[name]))) {
                Object.defineProperty(next, name, {
                    value: incoming[name], enumerable: true, writable: true, configurable: true
                });
            }
        }
        return next;
    }

    function mergeVocabulary(next, incoming) {
        const owners = new Map();
        for (const listId of allLists(next)) {
            const words = listWords(next, listId);
            const ids = new Map();
            for (const word of words) {
                if (word && typeof word.id === 'string') ids.set(word.id, (ids.get(word.id) || 0) + 1);
            }
            for (const word of words) {
                if (word && typeof word.word === 'string' && word.word.trim()
                    && typeof word.id === 'string' && word.id.trim() === word.id && word.id
                    && ids.get(word.id) === 1) {
                    const normalized = normalizeTerm(word.word);
                    if (!owners.has(normalized)) owners.set(normalized, { listId, wordId: word.id });
                }
            }
        }
        // An explicitly selected existing owner is stronger than list order.
        for (const term of next.reading.terms) owners.set(term.normalizedTerm, copy(term.wordRef));
        const importedRefs = new Map();

        for (const listId of allLists(incoming)) {
            const incomingWords = listWords(incoming, listId);
            if (listId !== 'default' && !own(next.lists, listId)) {
                const incomingList = incoming.lists[listId];
                const list = Array.isArray(incomingList) ? []
                    : incomingList && Array.isArray(incomingList.words) ? { ...copy(incomingList), words: [] }
                        : copy(incomingList);
                Object.defineProperty(next.lists, listId, {
                    value: list, enumerable: true, writable: true, configurable: true
                });
            }
            if (!incomingWords.length) continue;
            if (listId !== 'default' && !Array.isArray(next.lists[listId])
                && !(next.lists[listId] && Array.isArray(next.lists[listId].words))) {
                fail(`Cannot merge vocabulary into malformed lists.${listId}`);
            }
            const destination = listWords(next, listId);
            const ids = new Map();
            for (const word of destination) {
                if (word && typeof word.id === 'string') {
                    if (!ids.has(word.id)) ids.set(word.id, []);
                    ids.get(word.id).push(word);
                }
            }
            let serialized;
            for (const rawWord of incomingWords) {
                const word = copy(rawWord);
                const normalized = word && typeof word.word === 'string' && word.word.trim()
                    ? normalizeTerm(word.word) : null;
                const referenceable = normalized && typeof word.id === 'string' && word.id && word.id.trim() === word.id;
                if (!referenceable) {
                    if (!serialized) serialized = new Set(destination.map(stableJson));
                    const encoded = stableJson(word);
                    if (serialized.has(encoded)) continue;
                    serialized.add(encoded);
                }
                let existingWord = false;
                if (word && typeof word.id === 'string' && ids.has(word.id)) {
                    if (!normalized) continue;
                    const originalId = word.id;
                    let suffix = 0;
                    while (ids.has(word.id)) {
                        const matches = ids.get(word.id);
                        if (matches.length === 1 && typeof matches[0].word === 'string'
                            && matches[0].word.trim().toLowerCase() === normalized) {
                            existingWord = true;
                            break;
                        }
                        word.id = key('reading-merge-word', listId, originalId, normalized, suffix++);
                    }
                }
                // Vocabulary identity is scoped to its list. Same-term records
                // in other lists have independent membership and review history.
                // A matching local record keeps all of its existing progress.
                if (!existingWord) {
                    destination.push(word);
                    if (word && typeof word.id === 'string') ids.set(word.id, [word]);
                }
                if (referenceable) {
                    importedRefs.set(key(listId, rawWord.id), { listId, wordId: word.id });
                }
            }
        }
        // Reader canonical ownership is separate from vocabulary membership.
        // Reuse local owners, otherwise retain the incoming explicit owner,
        // including any deterministic ID remapping within its own list.
        for (const term of incoming.reading.terms) {
            if (!owners.has(term.normalizedTerm)) {
                owners.set(term.normalizedTerm, importedRefs.get(key(term.wordRef.listId, term.wordRef.wordId)));
            }
        }
        return owners;
    }

    function merge(existingSnapshot, incomingSnapshot) {
        const next = writable(existingSnapshot);
        const incoming = writable(incomingSnapshot);
        const owners = mergeVocabulary(next, incoming);
        for (const table of TABLES) {
            const rows = new Map(next.reading[table].map((row) => [row.id, row]));
            for (const incomingRow of incoming.reading[table]) {
                const existing = rows.get(incomingRow.id);
                let merged = existing ? mergeMetadata(existing, incomingRow,
                    table === 'visits' ? 'lastVisitedAt' : 'updatedAt') : copy(incomingRow);
                if (existing && own(existing, 'createdAt')) {
                    merged.createdAt = existing.createdAt < incomingRow.createdAt ? existing.createdAt : incomingRow.createdAt;
                }
                if (existing && own(existing, 'updatedAt')) {
                    merged.updatedAt = existing.updatedAt > incomingRow.updatedAt ? existing.updatedAt : incomingRow.updatedAt;
                }
                if (table === 'terms') {
                    merged.wordRef = existing ? copy(existing.wordRef) : copy(owners.get(incomingRow.normalizedTerm));
                } else if (existing && table === 'articles') {
                    const title = mergeMetadata(
                        { title: existing.title, titleUpdatedAt: existing.titleUpdatedAt },
                        { title: incomingRow.title, titleUpdatedAt: incomingRow.titleUpdatedAt }, 'titleUpdatedAt');
                    merged.title = title.title;
                    merged.titleUpdatedAt = title.titleUpdatedAt;
                    if (own(existing, 'contentRefs') || own(incomingRow, 'contentRefs')) {
                        // Conflicting backups retain every binding so a reader
                        // cannot silently select a different content source.
                        merged.contentRefs = [...new Set([
                            ...(existing.contentRefs || []), ...(incomingRow.contentRefs || [])
                        ])].sort();
                    }
                } else if (existing && table === 'associations') {
                    merged.manual = existing.manual || incomingRow.manual;
                } else if (existing && table === 'visits') {
                    merged.firstVisitedAt = existing.firstVisitedAt < incomingRow.firstVisitedAt
                        ? existing.firstVisitedAt : incomingRow.firstVisitedAt;
                    merged.lastVisitedAt = existing.lastVisitedAt > incomingRow.lastVisitedAt
                        ? existing.lastVisitedAt : incomingRow.lastVisitedAt;
                }
                rows.set(merged.id, merged);
            }
            next.reading[table] = [...rows.values()].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
        }
        return finish(next);
    }

    function query(snapshot, options = {}) {
        validate(snapshot);
        object(options, 'query options');
        if (own(options, 'articleId')) exactString(options.articleId, 'articleId');
        const associations = snapshot.reading.associations.filter((row) => !own(options, 'articleId') || row.articleId === options.articleId);
        const activeTerms = new Set(associations.map((row) => row.termId));
        const rows = snapshot.reading.terms.filter((term) => activeTerms.has(term.id)).map((term) => {
            const related = associations.filter((row) => row.termId === term.id);
            const ids = new Set(related.map((row) => row.id));
            return {
                term, word: ownerWord(snapshot, term.wordRef), wordRef: term.wordRef,
                associations: related, occurrences: snapshot.reading.occurrences.filter((row) => ids.has(row.associationId))
            };
        });
        return copy({ terms: rows, distinctTermCount: rows.length, occurrenceCount: rows.reduce((sum, row) => sum + row.occurrences.length, 0) });
    }

    function listVisits(snapshot) { validate(snapshot); return copy(snapshot.reading.visits); }
    function serialize(snapshot) { validate(snapshot); return JSON.stringify(snapshot); }
    function deserialize(value) {
        if (typeof value !== 'string') fail('Serialized reading vocabulary snapshot must be a string');
        let parsed;
        try { parsed = JSON.parse(value); } catch (_) { fail('Invalid reading vocabulary JSON'); }
        // Restoration must not silently invent a missing version or tables.
        validate(parsed);
        return copy(parsed);
    }

    const model = Object.freeze({
        SCHEMA_VERSION, READING_LIST_ID, normalizeTerm, sourceId, articleId, contentRef, termId, occurrenceId,
        createSnapshot, validate, collect, recordVisit, removeOccurrence, removeArticleTerm,
        clearArticle, deleteCanonicalTerm, merge, query, listVisits, serialize, deserialize
    });
    global.ReadingVocabularyModel = model;
    if (typeof module !== 'undefined' && module.exports) module.exports = model;
    if (global.__AppDataV2Internals) global.__AppDataV2Internals.ReadingVocabularyModel = model;
})(typeof window !== 'undefined' ? window : globalThis);
