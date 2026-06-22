(function(window) {
    // 词表元数据配置
    const VOCAB_LISTS = Object.freeze({
        'default': {
            id: 'default',
            name: 'IELTS 核心词表',
            icon: '📚',
            source: 'builtin',
            storageKey: 'vocab_words'
        },
        'spelling-errors-p1': {
            id: 'spelling-errors-p1',
            name: 'P1 拼写错误',
            icon: '📝',
            source: 'p1',
            storageKey: 'vocab_list_p1_errors'
        },
        'spelling-errors-p4': {
            id: 'spelling-errors-p4',
            name: 'P4 拼写错误',
            icon: '📝',
            source: 'p4',
            storageKey: 'vocab_list_p4_errors'
        },
        'spelling-errors-master': {
            id: 'spelling-errors-master',
            name: '综合错误词表',
            icon: '📚',
            source: 'all',
            storageKey: 'vocab_list_master_errors'
        },
        'custom': {
            id: 'custom',
            name: '自定义词表',
            icon: '✏️',
            source: 'user',
            storageKey: 'vocab_list_custom'
        },
        'reading-highlights': {
            id: 'reading-highlights',
            name: '阅读高亮生词',
            icon: '📖',
            source: 'reading-highlight',
            storageKey: 'vocab_list_reading_highlights'
        }
    });

    const STORAGE_KEYS = Object.freeze({
        WORDS: 'vocab_words',
        CONFIG: 'vocab_user_config',
        REVIEW_QUEUE: 'vocab_review_queue',
        ACTIVE_LIST: 'vocab_active_list_id'
    });

    const DEFAULT_CONFIG = Object.freeze({
        dailyNew: 20,
        reviewLimit: 100,
        masteryCount: 4,
        theme: 'auto',
        notify: true
    });

    const DEFAULT_REVIEW_QUEUE = Object.freeze([]);
    const DEFAULT_LIST_ID = 'default';
    const DEFAULT_LEXICON_URL = 'assets/wordlists/ielts_core.json';
    const SPELLING_ERROR_LIST_IDS = new Set(['spelling-errors-p1', 'spelling-errors-p4', 'spelling-errors-master']);
    const MAX_STORED_VOCAB_WORDS = 5000;
    const MAX_WORD_TEXT_LENGTH = 160;
    const MAX_MEANING_TEXT_LENGTH = 4000;
    const MAX_EXAMPLE_TEXT_LENGTH = 4000;
    const MAX_NOTE_TEXT_LENGTH = 4000;
    const MAX_SOURCE_TEXT_LENGTH = 200;
    const MAX_EXTRA_TEXT_LENGTH = 1000;
    const MAX_METADATA_JSON_CHARS = 8000;
    const MAX_EXTRA_DEPTH = 8;
    const MAX_EXTRA_OBJECT_KEYS = 100;
    const MAX_EXTRA_ARRAY_ITEMS = 100;
    const MAX_VOCAB_STORAGE_JSON_LENGTH = 5 * 1024 * 1024;
    const MAX_VOCAB_LEXICON_JSON_BYTES = 2 * 1024 * 1024;
    const EXTRA_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

    function summarizeVocabStoreErrorForLog(error) {
        if (!error || typeof error !== 'object') {
            return { name: typeof error };
        }
        const status = Number(error.status);
        return {
            name: typeof error.name === 'string' && error.name ? error.name.slice(0, 80) : 'Error',
            status: Number.isFinite(status) ? status : undefined
        };
    }

    function parseBoundedVocabStorageJson(raw) {
        if (!raw) {
            return null;
        }
        const source = String(raw);
        if (source.length > MAX_VOCAB_STORAGE_JSON_LENGTH) {
            return null;
        }
        return JSON.parse(source);
    }

    function parseBoundedVocabLexiconJson(text) {
        if (typeof text !== 'string') {
            throw new Error('vocab_lexicon_json_invalid');
        }
        if (text.length > MAX_VOCAB_LEXICON_JSON_BYTES) {
            throw new Error('vocab_lexicon_json_too_large');
        }
        return JSON.parse(text);
    }

    const state = {
        repositories: null,
        metaRepo: null,
        storageManager: null,
        words: [],
        wordIndex: new Map(),
        config: { ...DEFAULT_CONFIG },
        reviewQueue: DEFAULT_REVIEW_QUEUE.slice(),
        ready: false,
        readyPromise: null,
        readyResolvers: [],
        loadingPromise: null,
        registryUnsubscribe: null,
        lastLoadSource: 'init',
        activeListId: DEFAULT_LIST_ID,
        listCache: new Map()
    };

    function emitReady(value) {
        if (state.ready) {
            return;
        }
        state.ready = true;
        while (state.readyResolvers.length) {
            const resolve = state.readyResolvers.shift();
            try {
                resolve(value);
            } catch (error) {
                console.error('[VocabStore] ready resolve failed:', summarizeVocabStoreErrorForLog(error));
            }
        }
    }

    function ensureReadyPromise() {
        if (!state.readyPromise) {
            state.readyPromise = new Promise((resolve) => {
                state.readyResolvers.push(resolve);
            });
        }
        return state.readyPromise;
    }

    function getNow() {
        return new Date().toISOString();
    }

    function generateId(seed) {
        var seedStr = seed ? String(seed).trim() : '';
        if (seedStr) {
            var hash = 0;
            for (var i = 0; i < seedStr.length; i++) {
                hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
                hash |= 0;
            }
            return 'word-' + Math.abs(hash).toString(36);
        }
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
            var bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            return 'word-' + Array.prototype.map.call(bytes, function (byte) {
                return byte.toString(16).padStart(2, '0');
            }).join('');
        }
        return 'word-' + Date.now();
    }

    function normalizeTextField(value, maxLength) {
        if (typeof value !== 'string') {
            return '';
        }
        return value.trim().slice(0, maxLength);
    }

    function estimateExtraJsonChars(value, depth = 0, seen = new WeakSet()) {
        if (value == null) {
            return 4;
        }
        if (typeof value === 'string') {
            return value.length + 2;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value).length;
        }
        if (typeof value !== 'object' || depth >= MAX_EXTRA_DEPTH || seen.has(value)) {
            return 0;
        }
        seen.add(value);
        try {
            if (Array.isArray(value)) {
                let size = 2;
                value.slice(0, MAX_EXTRA_ARRAY_ITEMS).forEach((item, index) => {
                    size += (index > 0 ? 1 : 0) + estimateExtraJsonChars(item, depth + 1, seen);
                });
                return size;
            }
            let size = 2;
            Object.keys(value).slice(0, MAX_EXTRA_OBJECT_KEYS).forEach((key, index) => {
                size += (index > 0 ? 1 : 0) + String(key).length + 3 + estimateExtraJsonChars(value[key], depth + 1, seen);
            });
            return size;
        } catch (_) {
            return MAX_METADATA_JSON_CHARS + 1;
        } finally {
            seen.delete(value);
        }
    }

    function normalizeExtraValue(value, depth = 0, seen = new WeakSet()) {
        if (typeof value === 'string') {
            return normalizeTextField(value, MAX_EXTRA_TEXT_LENGTH);
        }
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : null;
        }
        if (value == null || typeof value === 'boolean') {
            return value;
        }
        if (Array.isArray(value)) {
            if (depth >= MAX_EXTRA_DEPTH || seen.has(value)) {
                return null;
            }
            seen.add(value);
            try {
                return value
                    .slice(0, MAX_EXTRA_ARRAY_ITEMS)
                    .map((item) => normalizeExtraValue(item, depth + 1, seen))
                    .filter((item) => item !== null && item !== undefined);
            } finally {
                seen.delete(value);
            }
        }
        if (value && typeof value === 'object') {
            if (depth >= MAX_EXTRA_DEPTH || seen.has(value)) {
                return null;
            }
            if (estimateExtraJsonChars(value, depth) > MAX_METADATA_JSON_CHARS) {
                return null;
            }
            seen.add(value);
            try {
                const clone = {};
                Object.keys(value)
                    .slice(0, MAX_EXTRA_OBJECT_KEYS)
                    .forEach((key) => {
                        if (EXTRA_POLLUTION_KEYS.has(String(key))) {
                            return;
                        }
                        const safeKey = normalizeTextField(key, MAX_SOURCE_TEXT_LENGTH);
                        if (!safeKey || EXTRA_POLLUTION_KEYS.has(safeKey)) {
                            return;
                        }
                        const normalized = normalizeExtraValue(value[key], depth + 1, seen);
                        if (normalized !== null && normalized !== undefined) {
                            clone[safeKey] = normalized;
                        }
                    });
                return JSON.stringify(clone).length <= MAX_METADATA_JSON_CHARS ? clone : null;
            } catch (_) {
                return null;
            } finally {
                seen.delete(value);
            }
        }
        return null;
    }

    function normalizeWordRecord(entry) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        const baseWord = normalizeTextField(entry.word, MAX_WORD_TEXT_LENGTH);
        const baseMeaning = normalizeTextField(entry.meaning, MAX_MEANING_TEXT_LENGTH);
        if (!baseWord || !baseMeaning) {
            return null;
        }
        const id = normalizeTextField(entry.id, MAX_SOURCE_TEXT_LENGTH) || generateId(baseWord);
        const example = normalizeTextField(entry.example, MAX_EXAMPLE_TEXT_LENGTH);
        const note = normalizeTextField(entry.note, MAX_NOTE_TEXT_LENGTH);
        const source = normalizeTextField(entry.source, MAX_SOURCE_TEXT_LENGTH);
        const freq = typeof entry.freq === 'number' && Number.isFinite(entry.freq) ? Math.min(1, Math.max(0, entry.freq)) : null;

        // SM-2 字段
        const easeFactor = typeof entry.easeFactor === 'number' && Number.isFinite(entry.easeFactor)
            ? Math.min(3.0, Math.max(1.3, entry.easeFactor))
            : null; // 新词没有EF

        const interval = typeof entry.interval === 'number' && Number.isFinite(entry.interval) && entry.interval >= 0
            ? Math.floor(entry.interval)
            : 1;

        const repetitions = typeof entry.repetitions === 'number' && Number.isFinite(entry.repetitions) && entry.repetitions >= 0
            ? Math.floor(entry.repetitions)
            : 0;

        // 轮内循环次数
        const intraCycles = typeof entry.intraCycles === 'number' && Number.isFinite(entry.intraCycles) && entry.intraCycles >= 0
            ? Math.floor(entry.intraCycles)
            : 0;

        const correctCountValue = Number(entry.correctCount);
        const correctCount = Number.isFinite(correctCountValue) && correctCountValue >= 0 ? Math.floor(correctCountValue) : 0;

        const lastReviewed = entry.lastReviewed && !Number.isNaN(new Date(entry.lastReviewed).getTime())
            ? new Date(entry.lastReviewed).toISOString()
            : null;
        const nextReview = entry.nextReview && !Number.isNaN(new Date(entry.nextReview).getTime())
            ? new Date(entry.nextReview).toISOString()
            : null;
        const createdAt = entry.createdAt && !Number.isNaN(new Date(entry.createdAt).getTime())
            ? new Date(entry.createdAt).toISOString()
            : getNow();
        const updatedAt = entry.updatedAt && !Number.isNaN(new Date(entry.updatedAt).getTime())
            ? new Date(entry.updatedAt).toISOString()
            : createdAt;

        const record = {
            id,
            word: baseWord,
            meaning: baseMeaning,
            example,
            note,

            // SM-2 字段
            easeFactor,
            interval,
            repetitions,
            intraCycles,
            correctCount,

            lastReviewed,
            nextReview,
            createdAt,
            updatedAt
        };
        if (freq !== null) {
            record.freq = freq;
        }
        if (source) {
            record.source = source;
        }
        [
            'userInput',
            'questionId',
            'suiteId',
            'examId',
            'errorCount',
            'timestamp',
            'acceptedAnswers',
            'canonicalAnswer',
            'reasonCode',
            'confidence',
            'tokenIndex',
            'metadata',
            'spellingNote'
        ].forEach((key) => {
            if (entry[key] !== undefined) {
                const normalizedExtra = normalizeExtraValue(entry[key]);
                if (normalizedExtra !== null && normalizedExtra !== undefined) {
                    record[key] = normalizedExtra;
                }
            }
        });
        return record;
    }

    function cloneWordRecord(word) {
        return normalizeWordRecord(word);
    }

    function cloneWordList(words) {
        return Array.isArray(words)
            ? words.slice(0, MAX_STORED_VOCAB_WORDS).map(cloneWordRecord).filter(Boolean)
            : [];
    }

    function cloneListData(listData) {
        if (!listData || typeof listData !== 'object') {
            return null;
        }
        const words = cloneWordList(listData.words);
        const stats = listData.stats && typeof listData.stats === 'object'
            ? {
                totalWords: Number.isFinite(Number(listData.stats.totalWords)) ? Math.max(0, Math.floor(Number(listData.stats.totalWords))) : words.length,
                masteredWords: Number.isFinite(Number(listData.stats.masteredWords)) ? Math.max(0, Math.floor(Number(listData.stats.masteredWords))) : 0,
                reviewingWords: Number.isFinite(Number(listData.stats.reviewingWords)) ? Math.max(0, Math.floor(Number(listData.stats.reviewingWords))) : 0
            }
            : {
                totalWords: words.length,
                masteredWords: words.filter((word) => (word.correctCount || 0) >= (state.config.masteryCount || 4)).length,
                reviewingWords: words.filter((word) => word.lastReviewed && !word.nextReview).length
            };
        return {
            id: normalizeTextField(listData.id, MAX_SOURCE_TEXT_LENGTH),
            name: normalizeTextField(listData.name, MAX_SOURCE_TEXT_LENGTH),
            icon: normalizeTextField(listData.icon, MAX_SOURCE_TEXT_LENGTH),
            source: normalizeTextField(listData.source, MAX_SOURCE_TEXT_LENGTH),
            words,
            stats
        };
    }

    function cloneVocabLists() {
        return Object.keys(VOCAB_LISTS).reduce((clone, id) => {
            clone[id] = { ...VOCAB_LISTS[id] };
            return clone;
        }, {});
    }

    function normalizeLexiconLookupKey(word) {
        return String(word || '').trim().toLowerCase().replace(/[^a-z'-]+/g, '');
    }

    function isSpellingFallbackMeaning(meaning) {
        return typeof meaning === 'string' && meaning.trim().startsWith('你曾拼写为:');
    }

    function isUsableLexiconEntry(entry) {
        return entry
            && typeof entry === 'object'
            && typeof entry.word === 'string'
            && entry.word.trim()
            && typeof entry.meaning === 'string'
            && entry.meaning.trim()
            && !isSpellingFallbackMeaning(entry.meaning);
    }

    function findLexiconEntry(word) {
        const key = normalizeLexiconLookupKey(word);
        if (!key) {
            return null;
        }

        const embedded = window.__EMBEDDED_WORDLISTS__;
        const embeddedCore = embedded && Array.isArray(embedded.ielts_core)
            ? embedded.ielts_core
            : [];
        const cacheDefault = state.listCache.get(DEFAULT_LIST_ID);
        const cachedWords = cacheDefault && cacheDefault.data && Array.isArray(cacheDefault.data.words)
            ? cacheDefault.data.words
            : [];
        const sources = [embeddedCore, cachedWords, state.words];

        for (const source of sources) {
            if (!Array.isArray(source) || !source.length) {
                continue;
            }
            const found = source.find((entry) => (
                isUsableLexiconEntry(entry)
                && normalizeLexiconLookupKey(entry.word) === key
            ));
            if (found) {
                return found;
            }
        }

        return null;
    }

    function rebuildIndex() {
        state.wordIndex = new Map();
        state.words.forEach((word) => {
            state.wordIndex.set(word.id, word);
        });
    }

    async function persist(key, value) {
        try {
            if (state.metaRepo && typeof state.metaRepo.set === 'function') {
                await state.metaRepo.set(key, value, { clone: true });
                return true;
            }
            if (state.storageManager && typeof state.storageManager.set === 'function') {
                await state.storageManager.set(key, value);
                return true;
            }
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            }
        } catch (error) {
            console.error('[VocabStore] persist error:', summarizeVocabStoreErrorForLog(error));
        }
        return false;
    }

    async function read(key, defaultValue) {
        if (state.metaRepo && typeof state.metaRepo.get === 'function') {
            try {
                const value = await state.metaRepo.get(key, defaultValue);
                if (value !== undefined) {
                    return value;
                }
            } catch (error) {
                console.warn('[VocabStore] metaRepo读取失败:', summarizeVocabStoreErrorForLog(error));
            }
        }
        if (state.storageManager && typeof state.storageManager.get === 'function') {
            try {
                const value = await state.storageManager.get(key, defaultValue);
                if (value !== undefined) {
                    return value;
                }
            } catch (error) {
                console.warn('[VocabStore] storageManager读取失败:', summarizeVocabStoreErrorForLog(error));
            }
        }
        if (typeof localStorage !== 'undefined') {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) {
                    return defaultValue;
                }
                const parsed = parseBoundedVocabStorageJson(raw);
                return parsed === null ? defaultValue : parsed;
            } catch (error) {
                console.warn('[VocabStore] localStorage解析失败:', summarizeVocabStoreErrorForLog(error));
            }
        }
        return defaultValue;
    }

    function mergeConfig(config) {
        const base = { ...DEFAULT_CONFIG };
        if (config && typeof config === 'object') {
            Object.keys(DEFAULT_CONFIG).forEach((key) => {
                if (typeof config[key] !== 'undefined') {
                    base[key] = config[key];
                }
            });
        }
        return base;
    }

    function setWordsInternal(words) {
        state.words = cloneWordList(words);
        rebuildIndex();
    }

    function getStorageKeyForListId(listId) {
        const targetId = typeof listId === 'string' && VOCAB_LISTS[listId] ? listId : DEFAULT_LIST_ID;
        return VOCAB_LISTS[targetId].storageKey;
    }

    function getActiveStorageKey() {
        return getStorageKeyForListId(state.activeListId);
    }

    function isSpellingErrorList(listId) {
        return SPELLING_ERROR_LIST_IDS.has(listId);
    }

    function normalizeListEntry(entry, listId) {
        if (isSpellingErrorList(listId)) {
            return convertSpellingErrorToWord(entry, listId) || normalizeWordRecord(entry);
        }
        return normalizeWordRecord(entry);
    }

    function normalizeStoredListWords(storedData, listId = DEFAULT_LIST_ID) {
        const listWords = storedData && typeof storedData === 'object' && Array.isArray(storedData.words)
            ? storedData.words
            : (Array.isArray(storedData) ? storedData : null);
        if (!listWords) {
            return [];
        }
        return listWords
            .slice(0, MAX_STORED_VOCAB_WORDS)
            .map((entry) => normalizeListEntry(entry, listId))
            .filter(Boolean);
    }

    function resolveTrustedVocabJsonUrl(rawUrl) {
        if (!rawUrl) {
            return '';
        }
        try {
            const baseHref = window.location && window.location.href ? window.location.href : 'http://localhost/';
            const resolved = new URL(String(rawUrl), baseHref);
            const protocol = (resolved.protocol || '').toLowerCase();
            if (!resolved.pathname || !resolved.pathname.toLowerCase().endsWith('.json')) {
                return '';
            }
            if (protocol === 'http:' || protocol === 'https:') {
                const currentOrigin = window.location && window.location.origin;
                return currentOrigin && currentOrigin !== 'null' && resolved.origin === currentOrigin
                    ? resolved.href
                    : '';
            }
            if (protocol === 'file:' && window.location && window.location.protocol === 'file:') {
                return resolved.href;
            }
        } catch (_) {
            return '';
        }
        return '';
    }

    async function fetchJsonWithFileFallback(url) {
        const trustedUrl = resolveTrustedVocabJsonUrl(url);
        if (!trustedUrl) {
            throw new Error('untrusted_vocab_json_url');
        }
        const primary = await fetch(trustedUrl, { cache: 'no-store' });
        if (!primary.ok) {
            throw new Error(`HTTP ${primary.status}`);
        }
        const contentLength = Number(primary.headers?.get?.('content-length'));
        if (Number.isFinite(contentLength) && contentLength > MAX_VOCAB_LEXICON_JSON_BYTES) {
            throw new Error('vocab_lexicon_json_too_large');
        }
        return parseBoundedVocabLexiconJson(await primary.text());
    }

    async function readJsonViaXHR(url) {
        return new Promise((resolve, reject) => {
            if (typeof XMLHttpRequest === 'undefined') {
                reject(new Error('xhr_unavailable'));
                return;
            }
            try {
                const trustedUrl = resolveTrustedVocabJsonUrl(url);
                if (!trustedUrl) {
                    reject(new Error('untrusted_vocab_json_url'));
                    return;
                }
                const xhr = new XMLHttpRequest();
                xhr.open('GET', trustedUrl, true);
                xhr.overrideMimeType('application/json');
                xhr.onreadystatechange = () => {
                    if (xhr.readyState !== 4) {
                        return;
                    }
                    const isSuccess = (xhr.status >= 200 && xhr.status < 300) || xhr.status === 0;
                    if (!isSuccess) {
                        reject(new Error(`HTTP ${xhr.status}`));
                        return;
                    }
                    try {
                        const parsed = parseBoundedVocabLexiconJson(xhr.responseText);
                        resolve(parsed);
                    } catch (error) {
                        reject(error);
                    }
                };
                xhr.onerror = () => reject(new Error('xhr_network_error'));
                xhr.send();
            } catch (error) {
                reject(error);
            }
        });
    }

    function isLikelySpellingErrorSnapshot(words) {
        if (!Array.isArray(words) || words.length === 0) {
            return false;
        }
        let taggedCount = 0;
        words.forEach((entry) => {
            const meaning = typeof entry?.meaning === 'string' ? entry.meaning : '';
            if (meaning.startsWith('你曾拼写为:')) {
                taggedCount += 1;
            }
        });
        return taggedCount / words.length >= 0.6;
    }

    async function loadBundledDefaultLexicon() {
        let payload;
        const embeddedWordlists = window.__EMBEDDED_WORDLISTS__;
        if (embeddedWordlists && Array.isArray(embeddedWordlists.ielts_core) && embeddedWordlists.ielts_core.length) {
            payload = embeddedWordlists.ielts_core;
        }
        if (!payload) {
        try {
            payload = await fetchJsonWithFileFallback(DEFAULT_LEXICON_URL);
        } catch (fetchError) {
            const isFileProtocol = typeof window !== 'undefined'
                && window.location
                && window.location.protocol === 'file:';
            if (!isFileProtocol) {
                throw fetchError;
            }
            payload = await readJsonViaXHR(DEFAULT_LEXICON_URL);
        }
        }
        const validator = window.VocabDataIO;
        if (validator && typeof validator.validateSchema === 'function' && !validator.validateSchema(payload)) {
            throw new Error('default_lexicon_schema_invalid');
        }
        const entries = validator && typeof validator.normalizeEntry === 'function'
            ? (Array.isArray(payload) ? payload.map(validator.normalizeEntry).filter(Boolean) : [])
            : (Array.isArray(payload) ? payload : []);
        return entries
            .slice(0, MAX_STORED_VOCAB_WORDS)
            .map((entry) => normalizeWordRecord({ ...entry, box: 1, correctCount: 0, lastReviewed: null, nextReview: null }))
            .filter(Boolean);
    }

    async function loadState() {
        if (state.loadingPromise) {
            return state.loadingPromise;
        }
        state.loadingPromise = (async () => {
            const [storedConfig, storedQueue, storedActiveList] = await Promise.all([
                read(STORAGE_KEYS.CONFIG, { ...DEFAULT_CONFIG }),
                read(STORAGE_KEYS.REVIEW_QUEUE, DEFAULT_REVIEW_QUEUE.slice()),
                read(STORAGE_KEYS.ACTIVE_LIST, DEFAULT_LIST_ID)
            ]);

            state.activeListId = typeof storedActiveList === 'string' && VOCAB_LISTS[storedActiveList]
                ? storedActiveList
                : DEFAULT_LIST_ID;

            const activeStorageKey = getStorageKeyForListId(state.activeListId);
            const storedWords = await read(activeStorageKey, []);
            const normalizedWords = normalizeStoredListWords(storedWords, state.activeListId);
            if (normalizedWords.length) {
                setWordsInternal(normalizedWords);
                state.lastLoadSource = state.metaRepo ? 'meta' : (state.storageManager ? 'storage' : 'localStorage');
            }

            state.config = mergeConfig(storedConfig);
            state.reviewQueue = Array.isArray(storedQueue)
                ? storedQueue.slice(0, MAX_STORED_VOCAB_WORDS).map((id) => normalizeTextField(String(id), MAX_SOURCE_TEXT_LENGTH)).filter(Boolean)
                : [];
        })()
            .catch((error) => {
                console.error('[VocabStore] 初始化加载失败:', summarizeVocabStoreErrorForLog(error));
            })
            .finally(() => {
                state.loadingPromise = null;
            });
        return state.loadingPromise;
    }

    async function ensureDefaultLexicon() {
        try {
            const defaultStorageKey = getStorageKeyForListId(DEFAULT_LIST_ID);
            const storedDefault = await read(defaultStorageKey, []);
            const normalizedStored = normalizeStoredListWords(storedDefault, DEFAULT_LIST_ID);
            const pollutedBySpellingList = isLikelySpellingErrorSnapshot(normalizedStored);
            if (normalizedStored.length && !pollutedBySpellingList) {
                if (state.activeListId === DEFAULT_LIST_ID && !state.words.length) {
                    setWordsInternal(normalizedStored);
                }
                return normalizedStored;
            }
            if (pollutedBySpellingList) {
                console.warn('[VocabStore] 检测到默认词表被错词快照污染，正在恢复 IELTS 核心词表');
            }

            const normalized = await loadBundledDefaultLexicon();
            if (!normalized.length) {
                console.warn('[VocabStore] 默认词库为空');
                return [];
            }
            await persist(defaultStorageKey, normalized);
            if (state.activeListId === DEFAULT_LIST_ID) {
                setWordsInternal(normalized);
                state.lastLoadSource = 'default';
            }
            state.listCache.set(DEFAULT_LIST_ID, {
                data: cloneListData({
                    id: DEFAULT_LIST_ID,
                    name: VOCAB_LISTS[DEFAULT_LIST_ID].name,
                    icon: VOCAB_LISTS[DEFAULT_LIST_ID].icon,
                    source: VOCAB_LISTS[DEFAULT_LIST_ID].source,
                    words: normalized,
                    stats: {
                        totalWords: normalized.length,
                        masteredWords: normalized.filter(w => (w.correctCount || 0) >= (state.config.masteryCount || 4)).length,
                        reviewingWords: normalized.filter(w => w.lastReviewed && !w.nextReview).length
                    }
                }),
                timestamp: Date.now()
            });
            return normalized;
        } catch (error) {
            console.warn('[VocabStore] 默认词库加载失败:', summarizeVocabStoreErrorForLog(error));
            return [];
        }
    }

    async function bootstrap() {
        await loadState();
        await ensureDefaultLexicon();
        emitReady(true);
    }

    function connectToProviders() {
        if (state.registryUnsubscribe || state.repositories || state.storageManager) {
            return;
        }
        const registry = window.StorageProviderRegistry;
        if (registry && typeof registry.onProvidersReady === 'function') {
            state.registryUnsubscribe = registry.onProvidersReady((payload) => {
                if (payload && payload.repositories) {
                    attachRepositories(payload.repositories);
                }
                if (payload && payload.storageManager) {
                    state.storageManager = payload.storageManager;
                }
            });
            const current = typeof registry.getCurrentProviders === 'function' ? registry.getCurrentProviders() : null;
            if (current) {
                if (current.repositories) {
                    attachRepositories(current.repositories);
                }
                if (current.storageManager) {
                    state.storageManager = current.storageManager;
                }
            }
            return;
        }
        if (window.dataRepositories) {
            attachRepositories(window.dataRepositories);
        }
        if (window.storage) {
            state.storageManager = window.storage;
        }
    }

    async function attachRepositories(repositories) {
        if (!repositories || state.repositories === repositories) {
            return;
        }
        state.repositories = repositories;
        state.metaRepo = repositories.meta || null;
        await loadState();
        if (!state.words.length) {
            await ensureDefaultLexicon();
        }
        await persist(getActiveStorageKey(), state.words);
        await persist(STORAGE_KEYS.CONFIG, state.config);
        await persist(STORAGE_KEYS.REVIEW_QUEUE, state.reviewQueue);
        emitReady(true);
    }

    function getWords() {
        return cloneWordList(state.words);
    }

    async function setWords(words) {
        const normalized = Array.isArray(words)
            ? words.slice(0, MAX_STORED_VOCAB_WORDS).map((word) => normalizeWordRecord(word)).filter(Boolean)
            : [];
        setWordsInternal(normalized);
        await persist(getActiveStorageKey(), normalized);
        state.listCache.delete(state.activeListId);
        return getWords();
    }

    async function updateWord(id, patch = {}) {
        if (!id || !state.wordIndex.has(id)) {
            return null;
        }
        const original = state.wordIndex.get(id);
        const updated = normalizeWordRecord({
            ...original,
            ...patch,
            id,
            updatedAt: getNow()
        });
        const index = state.words.findIndex((word) => word.id === id);
        if (index >= 0 && updated) {
            state.words.splice(index, 1, updated);
            state.wordIndex.set(id, updated);
            await persist(getActiveStorageKey(), state.words);
            state.listCache.delete(state.activeListId);
            return cloneWordRecord(updated);
        }
        return null;
    }

    function getConfig() {
        return { ...state.config };
    }

    async function setConfig(config) {
        state.config = mergeConfig(config);
        await persist(STORAGE_KEYS.CONFIG, state.config);
        return getConfig();
    }

    function getReviewQueue() {
        return state.reviewQueue.slice();
    }

    async function setReviewQueue(queue) {
        state.reviewQueue = Array.isArray(queue)
            ? queue.slice(0, MAX_STORED_VOCAB_WORDS).map((id) => normalizeTextField(String(id), MAX_SOURCE_TEXT_LENGTH)).filter(Boolean)
            : [];
        await persist(STORAGE_KEYS.REVIEW_QUEUE, state.reviewQueue);
        return getReviewQueue();
    }

    function getDueWords(referenceTime = new Date()) {
        const scheduler = window.VocabScheduler;
        const now = referenceTime instanceof Date ? referenceTime : new Date(referenceTime);
        const due = [];
        state.words.forEach((word) => {
            if (!word.nextReview) {
                return;
            }
            const next = new Date(word.nextReview);
            if (!Number.isNaN(next.getTime()) && next <= now) {
                const cloned = cloneWordRecord(word);
                if (cloned) {
                    due.push(cloned);
                }
            }
        });
        if (scheduler && typeof scheduler.pickDailyTask === 'function') {
            return cloneWordList(scheduler.pickDailyTask(due, due.length, { now }));
        }
        return due;
    }

    function getNewWords(limit = state.config.dailyNew) {
        const target = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : state.config.dailyNew;
        const fresh = state.words.filter((word) => !word.lastReviewed || !word.nextReview);
        return cloneWordList(fresh.slice(0, target));
    }

    function sourceForSpellingList(errorSource, listId) {
        if (errorSource === 'p1' || listId === 'spelling-errors-p1') {
            return 'P1 听力练习';
        }
        if (errorSource === 'p4' || listId === 'spelling-errors-p4') {
            return 'P4 听力练习';
        }
        if (errorSource === 'all' || errorSource === 'master' || listId === 'spelling-errors-master') {
            return '综合练习';
        }
        if (typeof errorSource === 'string' && errorSource.trim()) {
            return errorSource.trim();
        }
        return '听力练习';
    }

    function convertSpellingErrorToWord(error, listId) {
        if (!error || typeof error !== 'object') {
            return null;
        }

        // 拼写错误词表格式: { word, userInput, questionId, examId, timestamp, errorCount, source }
        // VocabStore 格式: { id, word, meaning, example, note, easeFactor, interval, repetitions, ... }

        const word = typeof error.word === 'string' ? error.word.trim() : '';
        if (!word) {
            return null;
        }

        const userInput = error.userInput || '(未记录)';
        const examId = error.examId || '';
        const questionId = error.questionId || '';
        const errorCount = error.errorCount || 1;

        const lexiconEntry = findLexiconEntry(word);
        let spellingNote = `你曾拼写为: ${userInput}`;
        if (errorCount > 1) {
            spellingNote += ` (错误${errorCount}次)`;
        }

        const sourceParts = [];
        if (examId) {
            sourceParts.push(`来源: ${examId}`);
        }
        if (questionId) {
            sourceParts.push(`题目 ${questionId}`);
        }
        const sourceNote = sourceParts.join(' - ');
        const note = [spellingNote, sourceNote].filter(Boolean).join('；');

        const existingMeaning = typeof error.meaning === 'string' && error.meaning.trim() && !isSpellingFallbackMeaning(error.meaning)
            ? error.meaning.trim()
            : '';
        const fallbackMeaning = '暂无中文释义';
        const meaning = lexiconEntry && typeof lexiconEntry.meaning === 'string' && lexiconEntry.meaning.trim()
            ? lexiconEntry.meaning.trim()
            : (existingMeaning || fallbackMeaning);
        const example = lexiconEntry && typeof lexiconEntry.example === 'string' && lexiconEntry.example.trim()
            ? lexiconEntry.example.trim()
            : (error.example || sourceNote);

        // 生成ID
        const id = typeof error.id === 'string' && error.id.trim() ? error.id.trim() : generateId(word);
        const source = sourceForSpellingList(error.source, listId);

        return normalizeWordRecord({
            ...error,
            id,
            word,
            meaning,
            example,
            note,
            source,
            userInput,
            examId,
            questionId,
            errorCount,
            spellingNote,
            // 新词，没有复习记录
            easeFactor: error.easeFactor ?? null,
            interval: error.interval ?? 1,
            repetitions: error.repetitions ?? 0,
            intraCycles: error.intraCycles ?? 0,
            correctCount: error.correctCount ?? 0,
            lastReviewed: error.lastReviewed ?? null,
            nextReview: error.nextReview ?? null,
            createdAt: error.timestamp ? new Date(error.timestamp).toISOString() : getNow(),
            updatedAt: getNow()
        });
    }

    async function loadList(listId) {
        if (!listId || typeof listId !== 'string') {
            console.warn('[VocabStore] loadList: 无效的 listId');
            return null;
        }

        const listConfig = VOCAB_LISTS[listId];
        if (!listConfig) {
            console.warn('[VocabStore] loadList: 未知的词表 ID');
            return null;
        }

        // 检查缓存（带TTL）
        const cached = state.listCache.get(listId);
        if (cached && cached.timestamp && (Date.now() - cached.timestamp) < 5 * 60 * 1000) {
            console.log('[VocabStore] 从缓存加载词表');
            return cloneListData(cached.data);
        }

        try {
            const storageKey = listConfig.storageKey;
            let storedData = await read(storageKey, null);
            if (listId === DEFAULT_LIST_ID && (!storedData || (Array.isArray(storedData) && storedData.length === 0))) {
                const ensured = await ensureDefaultLexicon();
                storedData = ensured;
            }
            let normalizedWords = normalizeStoredListWords(storedData, listId);
            if (!normalizedWords.length && listId === DEFAULT_LIST_ID) {
                normalizedWords = await ensureDefaultLexicon();
            }
            if (!normalizedWords.length) {
                console.log('[VocabStore] 词表为空或格式未知');
            }

            const listData = {
                id: listConfig.id,
                name: listConfig.name,
                icon: listConfig.icon,
                source: listConfig.source,
                words: normalizedWords,
                stats: {
                    totalWords: normalizedWords.length,
                    masteredWords: normalizedWords.filter(w => (w.correctCount || 0) >= (state.config.masteryCount || 4)).length,
                    reviewingWords: normalizedWords.filter(w => w.lastReviewed && !w.nextReview).length
                }
            };

            // 缓存词表数据（带时间戳）
            state.listCache.set(listId, {
                data: cloneListData(listData),
                timestamp: Date.now()
            });
            console.log(`[VocabStore] 加载词表成功，单词数: ${normalizedWords.length}`);
            return cloneListData(listData);
        } catch (error) {
            console.error('[VocabStore] loadList 失败:', summarizeVocabStoreErrorForLog(error));
            return null;
        }
    }

    async function setActiveList(listIdOrData) {
        let listId;
        let listData;

        if (typeof listIdOrData === 'string') {
            listId = listIdOrData;
            listData = await loadList(listId);
        } else if (listIdOrData && typeof listIdOrData === 'object' && listIdOrData.id) {
            listData = listIdOrData;
            listId = listData.id;
        } else {
            console.warn('[VocabStore] setActiveList: 无效的参数');
            return false;
        }

        if (!listData || !VOCAB_LISTS[listId]) {
            console.warn('[VocabStore] setActiveList: 词表不存在');
            return false;
        }

        try {
            // 保存当前词表到存储（如果有修改）
            if (state.activeListId && state.words.length > 0) {
                const currentConfig = VOCAB_LISTS[state.activeListId];
                if (currentConfig) {
                    await persist(currentConfig.storageKey, state.words);
                }
            }

            // 切换到新词表
            state.activeListId = listId;
            setWordsInternal(listData.words || []);
            state.listCache.delete(listId);

            // 保存激活的词表 ID
            await persist(STORAGE_KEYS.ACTIVE_LIST, listId);

            // 清空复习队列（新词表需要重新生成队列）
            state.reviewQueue = [];
            await persist(STORAGE_KEYS.REVIEW_QUEUE, []);

            return true;
        } catch (error) {
            console.error('[VocabStore] setActiveList 失败:', summarizeVocabStoreErrorForLog(error));
            return false;
        }
    }

    async function getListWordCount(listId) {
        if (!listId || !VOCAB_LISTS[listId]) {
            return 0;
        }

        // 如果是当前激活的词表，直接返回
        if (listId === state.activeListId) {
            return state.words.length;
        }

        // 尝试从缓存获取
        if (state.listCache.has(listId)) {
            const cached = state.listCache.get(listId);
            const data = cached.data || cached;
            return data.words ? data.words.length : 0;
        }

        // 从存储读取
        try {
            const listConfig = VOCAB_LISTS[listId];
            const storedData = await read(listConfig.storageKey, null);

            // 检查是否为拼写错误词表格式
            if (storedData && typeof storedData === 'object' && Array.isArray(storedData.words)) {
                return storedData.words.length;
            } else if (Array.isArray(storedData)) {
                return storedData.length;
            }

            return 0;
        } catch (error) {
            console.error('[VocabStore] getListWordCount 失败:', summarizeVocabStoreErrorForLog(error));
            return 0;
        }
    }

    function getAvailableLists() {
        return Object.values(VOCAB_LISTS).map(list => ({
            id: list.id,
            name: list.name,
            icon: list.icon,
            source: list.source
        }));
    }

    function getActiveListId() {
        return state.activeListId;
    }

    function normalizeReadingHighlightPayload(payload) {
        if (!payload || typeof payload !== 'object') {
            return null;
        }
        const word = typeof payload.word === 'string' ? payload.word.trim() : '';
        if (!word) {
            return null;
        }
        const selectedText = typeof payload.selectedText === 'string' ? payload.selectedText.trim() : '';
        const meaning = typeof payload.meaning === 'string' && payload.meaning.trim()
            ? payload.meaning.trim()
            : (typeof payload.definition === 'string' && payload.definition.trim() ? payload.definition.trim() : '待补充释义');
        const noteParts = [
            payload.phonetic ? `音标: ${String(payload.phonetic).trim()}` : '',
            payload.partOfSpeech ? `词性: ${String(payload.partOfSpeech).trim()}` : '',
            selectedText && selectedText !== word ? `原高亮: ${selectedText}` : '',
            payload.sourceLabel ? `来源: ${String(payload.sourceLabel).trim()}` : '',
            payload.license ? `许可: ${String(payload.license).trim()}` : ''
        ].filter(Boolean);
        const context = payload.context && typeof payload.context === 'object' ? payload.context : {};
        if (context.title) {
            noteParts.push(`文章: ${String(context.title).trim()}`);
        }
        if (context.examId) {
            noteParts.push(`题目: ${String(context.examId).trim()}`);
        }
        return normalizeWordRecord({
            id: generateId(`reading-highlight:${word}`),
            word,
            meaning,
            example: typeof payload.example === 'string' ? payload.example.trim() : '',
            note: noteParts.join('；'),
            easeFactor: null,
            interval: 1,
            repetitions: 0,
            intraCycles: 0,
            correctCount: 0,
            lastReviewed: null,
            nextReview: null,
            createdAt: getNow(),
            updatedAt: getNow()
        });
    }

    async function upsertReadingHighlightWord(payload) {
        const normalized = normalizeReadingHighlightPayload(payload);
        if (!normalized) {
            return null;
        }
        await init();
        const listId = 'reading-highlights';
        const listConfig = VOCAB_LISTS[listId];
        const storedData = await read(listConfig.storageKey, []);
        const words = normalizeStoredListWords(storedData, listId);
        const key = normalized.word.toLowerCase();
        const existingIndex = words.findIndex((entry) => String(entry.word || '').trim().toLowerCase() === key);
        if (existingIndex >= 0) {
            const existing = words[existingIndex];
            words.splice(existingIndex, 1, normalizeWordRecord({
                ...existing,
                ...normalized,
                id: existing.id || normalized.id,
                createdAt: existing.createdAt || normalized.createdAt,
                updatedAt: getNow()
            }));
        } else {
            words.push(normalized);
        }
        const limitedWords = words.filter(Boolean).slice(0, MAX_STORED_VOCAB_WORDS);
        await persist(listConfig.storageKey, limitedWords);
        state.listCache.delete(listId);
        if (state.activeListId === listId) {
            setWordsInternal(limitedWords);
        }
        return cloneWordRecord(normalized);
    }

    async function init() {
        ensureReadyPromise();
        connectToProviders();
        if (!state.ready) {
            await bootstrap();
        }
        return state.readyPromise;
    }

    const api = {
        init,
        getWords,
        setWords,
        updateWord,
        getConfig,
        setConfig,
        getReviewQueue,
        setReviewQueue,
        getDueWords,
        getNewWords,
        loadList,
        setActiveList,
        getListWordCount,
        getAvailableLists,
        getActiveListId,
        upsertReadingHighlightWord,
        get VOCAB_LISTS() {
            return cloneVocabLists();
        },
        get state() {
            return {
                ready: state.ready,
                lastLoadSource: state.lastLoadSource,
                activeListId: state.activeListId
            };
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.VocabStore = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
