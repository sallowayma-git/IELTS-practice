(function(window) {
    const STORAGE_KEYS = Object.freeze({
        WORDS: 'vocab_words',
        CONFIG: 'vocab_user_config',
        REVIEW_QUEUE: 'vocab_review_queue'
    });

    const DEFAULT_CONFIG = Object.freeze({
        dailyNew: 20,
        reviewLimit: 100,
        masteryCount: 4,
        theme: 'auto',
        notify: true
    });

    const DEFAULT_REVIEW_QUEUE = Object.freeze([]);

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
        lastLoadSource: 'init'
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
        const boxValue = Number(entry.box);
        const box = Number.isFinite(boxValue) ? Math.min(5, Math.max(1, Math.floor(boxValue))) : 1;
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
            box,
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

    async function loadState() {
        if (state.loadingPromise) {
            return state.loadingPromise;
        }
        state.loadingPromise = (async () => {
            const [storedWords, storedConfig, storedQueue] = await Promise.all([
                read(STORAGE_KEYS.WORDS, []),
                read(STORAGE_KEYS.CONFIG, { ...DEFAULT_CONFIG }),
                read(STORAGE_KEYS.REVIEW_QUEUE, DEFAULT_REVIEW_QUEUE.slice())
            ]);

            const normalizedWords = Array.isArray(storedWords)
                ? storedWords.map(normalizeWordRecord).filter(Boolean)
                : [];
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
        if (state.words.length) {
            return;
        }
        try {
            const response = await fetch('assets/wordlists/ielts_core.json', { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const payload = await response.json();
            const validator = window.VocabDataIO;
            if (validator && typeof validator.validateSchema === 'function' && !validator.validateSchema(payload)) {
                console.warn('[VocabStore] 默认词库校验失败，跳过加载');
                return;
            }
            const entries = validator && typeof validator.normalizeEntry === 'function'
                ? (Array.isArray(payload) ? payload.map(validator.normalizeEntry).filter(Boolean) : [])
                : (Array.isArray(payload) ? payload : []);
            const normalized = entries.map((entry) => normalizeWordRecord({ ...entry, box: 1, correctCount: 0, lastReviewed: null, nextReview: null }));
            if (!normalized.length) {
                console.warn('[VocabStore] 默认词库为空');
                return;
            }
            setWordsInternal(normalized);
            state.lastLoadSource = 'default';
            await persist(STORAGE_KEYS.WORDS, normalized);
        } catch (error) {
            console.warn('[VocabStore] 默认词库加载失败:', error);
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
        await persist(STORAGE_KEYS.WORDS, state.words);
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
        await persist(STORAGE_KEYS.WORDS, normalized);
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
            await persist(STORAGE_KEYS.WORDS, state.words);
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
        get state() {
            return {
                ready: state.ready,
                lastLoadSource: state.lastLoadSource
            };
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.VocabStore = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
