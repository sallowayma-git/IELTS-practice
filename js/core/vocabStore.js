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
                console.error('[VocabStore] ready resolve failed:', error);
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
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        const base = seed ? String(seed).trim().toLowerCase().replace(/[^a-z0-9]+/gi, '-') : 'word';
        return `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function normalizeWordRecord(entry) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        const baseWord = typeof entry.word === 'string' ? entry.word.trim() : '';
        const baseMeaning = typeof entry.meaning === 'string' ? entry.meaning.trim() : '';
        if (!baseWord || !baseMeaning) {
            return null;
        }
        const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : generateId(baseWord);
        const example = typeof entry.example === 'string' ? entry.example.trim() : '';
        const note = typeof entry.note === 'string' ? entry.note.trim() : '';
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
        return record;
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
            console.error('[VocabStore] persist error:', error);
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
                console.warn('[VocabStore] metaRepo读取失败:', error);
            }
        }
        if (state.storageManager && typeof state.storageManager.get === 'function') {
            try {
                const value = await state.storageManager.get(key, defaultValue);
                if (value !== undefined) {
                    return value;
                }
            } catch (error) {
                console.warn('[VocabStore] storageManager读取失败:', error);
            }
        }
        if (typeof localStorage !== 'undefined') {
            try {
                const raw = localStorage.getItem(key);
                if (!raw) {
                    return defaultValue;
                }
                return JSON.parse(raw);
            } catch (error) {
                console.warn('[VocabStore] localStorage解析失败:', error);
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
        state.words = words;
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
            return convertSpellingErrorToWord(entry) || normalizeWordRecord(entry);
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
        return listWords.map((entry) => normalizeListEntry(entry, listId)).filter(Boolean);
    }

    async function fetchJsonWithFileFallback(url) {
        const primary = await fetch(url, { cache: 'no-store' });
        if (!primary.ok) {
            throw new Error(`HTTP ${primary.status}`);
        }
        return primary.json();
    }

    async function readJsonViaXHR(url) {
        return new Promise((resolve, reject) => {
            if (typeof XMLHttpRequest === 'undefined') {
                reject(new Error('xhr_unavailable'));
                return;
            }
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
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
                        const parsed = JSON.parse(xhr.responseText);
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
            state.reviewQueue = Array.isArray(storedQueue) ? storedQueue.map((id) => String(id)) : [];
        })()
            .catch((error) => {
                console.error('[VocabStore] 初始化加载失败:', error);
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
                data: {
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
                },
                timestamp: Date.now()
            });
            return normalized;
        } catch (error) {
            console.warn('[VocabStore] 默认词库加载失败:', error);
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
        return state.words.map((word) => ({ ...word }));
    }

    async function setWords(words) {
        const normalized = Array.isArray(words)
            ? words.map((word) => normalizeWordRecord(word)).filter(Boolean)
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
            return { ...updated };
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
        state.reviewQueue = Array.isArray(queue) ? queue.map((id) => String(id)) : [];
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
                due.push({ ...word });
            }
        });
        if (scheduler && typeof scheduler.pickDailyTask === 'function') {
            return scheduler.pickDailyTask(due, due.length, { now });
        }
        return due;
    }

    function getNewWords(limit = state.config.dailyNew) {
        const target = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : state.config.dailyNew;
        const fresh = state.words.filter((word) => !word.lastReviewed || !word.nextReview);
        return fresh.slice(0, target).map((word) => ({ ...word }));
    }

    function convertSpellingErrorToWord(error) {
        if (!error || typeof error !== 'object') {
            return null;
        }

        // 拼写错误词表格式: { word, userInput, questionId, examId, timestamp, errorCount, source }
        // VocabStore 格式: { id, word, meaning, example, note, easeFactor, interval, repetitions, ... }
        
        const word = typeof error.word === 'string' ? error.word.trim() : '';
        if (!word) {
            return null;
        }

        // 生成含义：显示用户的错误拼写和题目来源
        const userInput = error.userInput || '(未记录)';
        const examId = error.examId || '';
        const questionId = error.questionId || '';
        const errorCount = error.errorCount || 1;
        
        let meaning = `你曾拼写为: ${userInput}`;
        if (errorCount > 1) {
            meaning += ` (错误${errorCount}次)`;
        }
        
        // 生成例句：显示题目来源
        let example = '';
        if (examId) {
            example = `来源: ${examId}`;
            if (questionId) {
                example += ` - 题目 ${questionId}`;
            }
        }

        // 生成ID
        const id = generateId(word);

        // 生成来源标签
        const sourceLabels = {
            'p1': 'P1 听力练习',
            'p4': 'P4 听力练习',
            'all': '综合练习',
            'other': '听力练习'
        };
        const source = sourceLabels[error.source] || '听力练习';

        return normalizeWordRecord({
            id,
            word,
            meaning,
            example,
            note: '',
            source,
            // 新词，没有复习记录
            easeFactor: null,
            interval: 1,
            repetitions: 0,
            intraCycles: 0,
            correctCount: 0,
            lastReviewed: null,
            nextReview: null,
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
            console.warn('[VocabStore] loadList: 未知的词表 ID:', listId);
            return null;
        }

        // 检查缓存（带TTL）
        const cached = state.listCache.get(listId);
        if (cached && cached.timestamp && (Date.now() - cached.timestamp) < 5 * 60 * 1000) {
            console.log(`[VocabStore] 从缓存加载词表: ${listId}`);
            return cached.data;
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
                console.log(`[VocabStore] 词表为空或格式未知: ${listId}`);
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
                data: listData,
                timestamp: Date.now()
            });
            console.log(`[VocabStore] 加载词表成功: ${listId}, 单词数: ${normalizedWords.length}`);
            return listData;
        } catch (error) {
            console.error('[VocabStore] loadList 失败:', error);
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
            console.warn('[VocabStore] setActiveList: 词表不存在:', listId);
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
            console.error('[VocabStore] setActiveList 失败:', error);
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
            console.error('[VocabStore] getListWordCount 失败:', error);
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
        get VOCAB_LISTS() {
            return VOCAB_LISTS;
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
