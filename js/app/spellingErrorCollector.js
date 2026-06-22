/**
 * SpellingErrorCollector - 拼写错误收集组件
 *
 * 功能：
 * 1. 检测听力填空题中的单词拼写错误
 * 2. 收集错误单词并存储到词表
 * 3. 管理多个词表（P1、P4、综合）
 * 4. 支持错误次数统计和去重
 *
 * 数据结构：
 * - SpellingError: 单个拼写错误记录
 * - VocabularyList: 词表结构
 */

(function() {
    'use strict';

    const PROPER_NOUN_STOPWORDS = new Set([
        'cambridge', 'oxford', 'london', 'sydney', 'melbourne', 'canada', 'australia',
        'britain', 'america', 'europe', 'asia', 'africa', 'nasa', 'nesa', 'ielts'
    ]);
    const MAX_SPELLING_VOCAB_WORDS = 5000;
    const MAX_SPELLING_WORD_TEXT_LENGTH = 160;
    const MAX_SPELLING_NOTE_TEXT_LENGTH = 4000;
    const MAX_SPELLING_LEXICON_JSON_BYTES = 2 * 1024 * 1024;
    const SPELLING_IMPORT_POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
    function summarizeSpellingCollectorErrorForLog(error) {
        if (!error || typeof error !== 'object') {
            return { name: typeof error };
        }
        const status = Number(error.status);
        return {
            name: typeof error.name === 'string' && error.name ? error.name.slice(0, 80) : 'Error',
            status: Number.isFinite(status) ? status : undefined
        };
    }

    function summarizeSpellingTextForLog(value) {
        if (value === null || value === undefined || value === '') {
            return '[empty]';
        }
        return `[${typeof value}:${String(value).length} chars]`;
    }

    function parseSpellingLexiconJson(text) {
        if (typeof text !== 'string') {
            throw new Error('lexicon_json_invalid');
        }
        if (text.length > MAX_SPELLING_LEXICON_JSON_BYTES) {
            throw new Error('lexicon_json_too_large');
        }
        return JSON.parse(text);
    }


    /**
     * 拼写错误记录数据结构
     * @typedef {Object} SpellingError
     * @property {string} word - 正确单词
     * @property {string} userInput - 用户输入的错误拼写
     * @property {string} questionId - 题目ID
     * @property {string} suiteId - 套题ID（可选）
     * @property {string} examId - 考试ID
     * @property {number} timestamp - 错误发生时间戳
     * @property {number} errorCount - 错误次数
     * @property {string} source - 来源标识 ('p1' | 'p4' | 'other')
     * @property {Object} [metadata] - 额外元数据
     * @property {string} [metadata.context] - 上下文信息
     * @property {string} [metadata.difficulty] - 难度级别
     */

    /**
     * 词表数据结构
     * @typedef {Object} VocabularyList
     * @property {string} id - 词表唯一标识
     * @property {string} name - 词表名称
     * @property {string} source - 来源标识 ('p1' | 'p4' | 'all' | 'user')
     * @property {SpellingError[]} words - 单词列表
     * @property {number} createdAt - 创建时间戳
     * @property {number} updatedAt - 最后更新时间戳
     * @property {Object} stats - 统计信息
     * @property {number} stats.totalWords - 总单词数
     * @property {number} stats.masteredWords - 已掌握单词数
     * @property {number} stats.reviewingWords - 复习中单词数
     */

    /**
     * SpellingErrorCollector 类
     */
    class SpellingErrorCollector {
        constructor() {
            console.log('[SpellingErrorCollector] 初始化拼写错误收集器');

            // 错误缓存，用于临时存储检测到的错误
            this.errorCache = new Map();

            // 词表存储键配置
            this.storageKeys = {
                p1: 'vocab_list_p1_errors',
                p4: 'vocab_list_p4_errors',
                master: 'vocab_list_master_errors',
                custom: 'vocab_list_custom'
            };

            this.lexiconCache = null;
            this.lexiconLoadingPromise = null;

            // 初始化完成标志
            this.initialized = false;

            // 执行初始化
            this.init();
        }

        /**
         * 初始化方法
         */
        async init() {
            try {
                // 等待存储系统就绪
                if (window.storage && window.storage.ready) {
                    await window.storage.ready;
                }

                // 设置命名空间
                if (window.storage && typeof window.storage.setNamespace === 'function') {
                    window.storage.setNamespace('exam_system');
                    console.log('[SpellingErrorCollector] 存储命名空间已设置');
                }

                this.initialized = true;
                console.log('[SpellingErrorCollector] 初始化完成');
            } catch (error) {
                console.error('[SpellingErrorCollector] 初始化失败:', summarizeSpellingCollectorErrorForLog(error));
                this.initialized = false;
            }
        }

        /**
         * 确保初始化完成
         * @returns {Promise<void>}
         */
        async ensureInitialized() {
            if (this.initialized) {
                return;
            }

            // 等待初始化完成
            let attempts = 0;
            while (!this.initialized && attempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }

            if (!this.initialized) {
                throw new Error('SpellingErrorCollector 初始化超时');
            }
        }

        /**
         * 从examId中检测来源（p1或p4）
         * @param {string} examId - 考试ID
         * @returns {string} 来源标识 ('p1' | 'p4' | 'other')
         */
        detectSource(examId) {
            if (!examId || typeof examId !== 'string') {
                return 'other';
            }

            const lowerExamId = examId.toLowerCase();

            // 检测P1
            if (lowerExamId.includes('p1') || lowerExamId.includes('part1') || lowerExamId.includes('part-1')) {
                return 'p1';
            }

            // 检测P4
            if (lowerExamId.includes('p4') || lowerExamId.includes('part4') || lowerExamId.includes('part-4')) {
                return 'p4';
            }

            // 检测路径中的P1/P4
            if (lowerExamId.includes('100 p1') || lowerExamId.includes('100p1')) {
                return 'p1';
            }

            if (lowerExamId.includes('100 p4') || lowerExamId.includes('100p4')) {
                return 'p4';
            }

            return 'other';
        }

        /**
         * 创建空词表
         * @param {string} listId - 词表ID
         * @param {string} source - 来源标识
         * @returns {VocabularyList} 新创建的词表对象
         */
        createEmptyList(listId, source) {
            const names = {
                p1: 'P1 拼写错误词表',
                p4: 'P4 拼写错误词表',
                master: '综合拼写错误词表',
                custom: '自定义词表'
            };

            return {
                id: listId,
                name: names[listId] || names[source] || '词表',
                source: source,
                words: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
                stats: {
                    totalWords: 0,
                    masteredWords: 0,
                    reviewingWords: 0
                }
            };
        }

        normalizeListSource(listId, fallback) {
            if (listId === 'master') {
                return 'all';
            }
            if (listId === 'p1' || listId === 'p4' || listId === 'custom') {
                return listId;
            }
            return fallback || 'other';
        }

        isUnsafeImportKey(key) {
            return SPELLING_IMPORT_POLLUTION_KEYS.has(String(key));
        }

        cloneSafeObject(value) {
            if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
                return {};
            }
            const clone = {};
            Object.entries(value).forEach(([key, item]) => {
                if (this.isUnsafeImportKey(key)) {
                    return;
                }
                clone[key] = item;
            });
            return clone;
        }

        limitText(value, maxLength = MAX_SPELLING_NOTE_TEXT_LENGTH) {
            if (typeof value !== 'string') {
                return value;
            }
            if (value.length <= maxLength) {
                return value;
            }
            const truncated = value.slice(0, maxLength);
            return /[\uD800-\uDBFF]$/.test(truncated)
                ? truncated.slice(0, -1)
                : truncated;
        }

        wordTimestamp(entry) {
            const candidates = [entry?.updatedAt, entry?.timestamp, entry?.createdAt];
            for (const value of candidates) {
                const numeric = typeof value === 'number' ? value : Number(new Date(value));
                if (Number.isFinite(numeric)) {
                    return numeric;
                }
            }
            return 0;
        }

        normalizeStoredWordEntry(entry) {
            if (!entry || typeof entry !== 'object') {
                return null;
            }
            const safe = this.cloneSafeObject(entry);
            if (safe.metadata && typeof safe.metadata === 'object') {
                safe.metadata = this.cloneSafeObject(safe.metadata);
            }
            ['word', 'userInput'].forEach((key) => {
                safe[key] = this.limitText(safe[key], MAX_SPELLING_WORD_TEXT_LENGTH);
            });
            ['questionId', 'suiteId', 'examId', 'meaning', 'example', 'note', 'spellingNote', 'source'].forEach((key) => {
                safe[key] = this.limitText(safe[key], MAX_SPELLING_NOTE_TEXT_LENGTH);
            });
            return safe;
        }

        normalizeStoredWords(words) {
            const normalized = Array.isArray(words)
                ? words.map((entry) => this.normalizeStoredWordEntry(entry)).filter(Boolean)
                : [];
            if (normalized.length <= MAX_SPELLING_VOCAB_WORDS) {
                return normalized;
            }
            return normalized
                .sort((a, b) => this.wordTimestamp(b) - this.wordTimestamp(a))
                .slice(0, MAX_SPELLING_VOCAB_WORDS);
        }

        normalizeVocabListShape(rawList, listId, source) {
            const normalizedSource = this.normalizeListSource(listId, source);
            const base = this.createEmptyList(listId, normalizedSource);

            if (Array.isArray(rawList)) {
                return {
                    ...base,
                    words: this.normalizeStoredWords(rawList),
                    updatedAt: Date.now()
                };
            }

            if (!rawList || typeof rawList !== 'object') {
                return null;
            }

            const safeList = this.cloneSafeObject(rawList);
            const words = this.normalizeStoredWords(safeList.words);
            const safeStats = this.cloneSafeObject(safeList.stats);

            return {
                ...base,
                ...safeList,
                id: listId,
                source: safeList.source || normalizedSource,
                words,
                stats: {
                    ...base.stats,
                    ...safeStats,
                    totalWords: words.length
                }
            };
        }

        normalizeLexiconLookupKey(word) {
            return String(word || '').trim().toLowerCase().replace(/[^a-z'-]+/g, '');
        }

        getEmbeddedLexicon() {
            const embedded = window.__EMBEDDED_WORDLISTS__;
            return embedded && Array.isArray(embedded.ielts_core)
                ? embedded.ielts_core
                : [];
        }

        resolveTrustedAssetUrl(rawUrl) {
            try {
                const baseHref = (typeof window !== 'undefined' && window.location && window.location.href)
                    ? window.location.href
                    : 'http://localhost/';
                const resolved = new URL(String(rawUrl), baseHref);
                const protocol = (resolved.protocol || '').toLowerCase();

                if (protocol === 'http:' || protocol === 'https:') {
                    const currentOrigin = (typeof window !== 'undefined' && window.location && window.location.origin)
                        ? window.location.origin
                        : new URL(baseHref).origin;
                    return currentOrigin && currentOrigin !== 'null' && resolved.origin === currentOrigin
                        ? resolved.href
                        : '';
                }

                if (protocol === 'file:' && typeof window !== 'undefined' && window.location && window.location.protocol === 'file:') {
                    return resolved.href;
                }
            } catch (_) {
                return '';
            }
            return '';
        }

        resolveAssetUrl(relativePath) {
            const fallback = this.resolveTrustedAssetUrl(relativePath) || relativePath;
            if (typeof document === 'undefined') {
                return fallback;
            }

            const scripts = Array.from(document.querySelectorAll('script[src]'));
            const ownerScript = document.currentScript || scripts.find((script) => {
                const src = script.getAttribute('src') || '';
                return /(?:js\/bundles\/|js\\bundles\\|js\/app\/|js\\app\\)/i.test(src);
            });
            const src = ownerScript && (ownerScript.src || ownerScript.getAttribute('src'));
            if (!src) {
                return fallback;
            }

            try {
                const markerIndex = src.search(/\/js\/(?:bundles|app)\//i);
                if (markerIndex !== -1) {
                    const root = src.slice(0, markerIndex + 1);
                    return this.resolveTrustedAssetUrl(new URL(relativePath, root).href) || fallback;
                }
                return this.resolveTrustedAssetUrl(new URL(relativePath, document.baseURI || window.location.href).href) || fallback;
            } catch (_) {
                return fallback;
            }
        }

        async fetchJson(url) {
            if (typeof fetch !== 'function') {
                throw new Error('fetch_unavailable');
            }
            const trustedUrl = this.resolveTrustedAssetUrl(url);
            if (!trustedUrl) {
                throw new Error('untrusted_asset_url');
            }
            const response = await fetch(trustedUrl, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const contentLength = Number(response.headers?.get?.('content-length'));
            if (Number.isFinite(contentLength) && contentLength > MAX_SPELLING_LEXICON_JSON_BYTES) {
                throw new Error('lexicon_json_too_large');
            }
            return parseSpellingLexiconJson(await response.text());
        }

        readJsonViaXHR(url) {
            return new Promise((resolve, reject) => {
                if (typeof XMLHttpRequest === 'undefined') {
                    reject(new Error('xhr_unavailable'));
                    return;
                }
                try {
                    const xhr = new XMLHttpRequest();
                    const trustedUrl = this.resolveTrustedAssetUrl(url);
                    if (!trustedUrl) {
                        reject(new Error('untrusted_asset_url'));
                        return;
                    }
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
                            resolve(parseSpellingLexiconJson(xhr.responseText));
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

        async ensureCoreLexicon() {
            const embedded = this.getEmbeddedLexicon();
            if (embedded.length) {
                this.lexiconCache = embedded;
                return embedded;
            }
            if (Array.isArray(this.lexiconCache)) {
                return this.lexiconCache;
            }
            if (this.lexiconLoadingPromise) {
                return this.lexiconLoadingPromise;
            }

            this.lexiconLoadingPromise = (async () => {
                const url = this.resolveAssetUrl('assets/wordlists/ielts_core.json');
                try {
                    const payload = await this.fetchJson(url);
                    this.lexiconCache = Array.isArray(payload) ? payload : [];
                } catch (fetchError) {
                    try {
                        const payload = await this.readJsonViaXHR(url);
                        this.lexiconCache = Array.isArray(payload) ? payload : [];
                    } catch (xhrError) {
                        console.warn('[SpellingErrorCollector] Core lexicon load failed, using placeholder definitions:', {
                            fetch: summarizeSpellingCollectorErrorForLog(fetchError),
                            xhr: summarizeSpellingCollectorErrorForLog(xhrError)
                        });
                        this.lexiconCache = [];
                    }
                } finally {
                    this.lexiconLoadingPromise = null;
                }
                return this.lexiconCache;
            })();

            return this.lexiconLoadingPromise;
        }

        findLexiconEntry(word) {
            const key = this.normalizeLexiconLookupKey(word);
            if (!key) {
                return null;
            }
            const sources = [this.getEmbeddedLexicon(), this.lexiconCache];
            for (const source of sources) {
                if (!Array.isArray(source) || !source.length) {
                    continue;
                }
                const found = source.find((entry) => (
                    entry
                    && typeof entry.word === 'string'
                    && this.normalizeLexiconLookupKey(entry.word) === key
                    && typeof entry.meaning === 'string'
                    && entry.meaning.trim()
                ));
                if (found) {
                    return found;
                }
            }
            return null;
        }

        buildSpellingNote(entry, errorCount) {
            const userInput = entry && entry.userInput ? String(entry.userInput).trim() : '(未记录)';
            let note = `你曾拼写为: ${userInput}`;
            if (errorCount > 1) {
                note += ` (错误${errorCount}次)`;
            }
            return note;
        }

        buildSourceNote(entry) {
            const sourceParts = [];
            if (entry && entry.examId) {
                sourceParts.push(`来源: ${entry.examId}`);
            }
            if (entry && entry.questionId) {
                sourceParts.push(`题目 ${entry.questionId}`);
            }
            return sourceParts.join(' - ');
        }

        isGeneratedSpellingNote(note) {
            return typeof note === 'string' && note.trim().startsWith('你曾拼写为:');
        }

        buildVocabEntryFromError(error, existing, listSource) {
            if (!error || typeof error !== 'object') {
                return null;
            }
            const safeError = this.cloneSafeObject(error);
            const safeExisting = existing && typeof existing === 'object' ? this.cloneSafeObject(existing) : null;
            const word = typeof safeError.word === 'string'
                ? this.limitText(safeError.word.trim(), MAX_SPELLING_WORD_TEXT_LENGTH)
                : '';
            if (!word) {
                return null;
            }

            const incomingCount = Math.max(1, Number(safeError.errorCount) || 1);
            const existingCount = safeExisting ? Math.max(0, Number(safeExisting.errorCount) || 0) : 0;
            const errorCount = safeExisting ? existingCount + incomingCount : incomingCount;
            const timestamp = safeError.timestamp || Date.now();
            const lexiconEntry = this.findLexiconEntry(word);
            const existingMeaning = safeExisting && typeof safeExisting.meaning === 'string' ? safeExisting.meaning.trim() : '';
            const errorMeaning = typeof safeError.meaning === 'string' ? safeError.meaning.trim() : '';
            const meaning = lexiconEntry && typeof lexiconEntry.meaning === 'string' && lexiconEntry.meaning.trim()
                ? lexiconEntry.meaning.trim()
                : (errorMeaning || existingMeaning || '暂无中文释义');
            const example = lexiconEntry && typeof lexiconEntry.example === 'string' && lexiconEntry.example.trim()
                ? lexiconEntry.example.trim()
                : (safeError.example || safeExisting?.example || this.buildSourceNote(safeError));
            const spellingNote = this.buildSpellingNote({ ...(safeExisting || {}), ...safeError }, errorCount);
            const sourceNote = this.buildSourceNote(safeError);
            const existingNote = safeExisting && typeof safeExisting.note === 'string' ? safeExisting.note.trim() : '';
            const noteParts = [spellingNote, sourceNote];
            if (existingNote && !this.isGeneratedSpellingNote(existingNote) && !noteParts.includes(existingNote)) {
                noteParts.push(existingNote);
            }
            const normalizedWord = this.normalizeLexiconLookupKey(word) || word.toLowerCase();
            const source = safeError.source || safeExisting?.source || listSource || 'other';

            return this.normalizeStoredWordEntry({
                ...(safeExisting || {}),
                ...safeError,
                id: safeExisting?.id || safeError.id || `spelling-${source}-${normalizedWord}`,
                word,
                meaning,
                example,
                note: noteParts.filter(Boolean).join('；'),
                spellingNote,
                source,
                errorCount,
                timestamp,
                easeFactor: safeExisting?.easeFactor ?? safeError.easeFactor ?? null,
                interval: safeExisting?.interval ?? safeError.interval ?? 1,
                repetitions: safeExisting?.repetitions ?? safeError.repetitions ?? 0,
                intraCycles: safeExisting?.intraCycles ?? safeError.intraCycles ?? 0,
                correctCount: safeExisting?.correctCount ?? safeError.correctCount ?? 0,
                lastReviewed: safeExisting?.lastReviewed ?? safeError.lastReviewed ?? null,
                nextReview: safeExisting?.nextReview ?? safeError.nextReview ?? null,
                createdAt: safeExisting?.createdAt || safeError.createdAt || new Date(timestamp).toISOString(),
                updatedAt: new Date().toISOString()
            });
        }

        /**
         * 加载词表
         * @param {string} listId - 词表ID
         * @returns {Promise<VocabularyList|null>} 词表对象或null
         */
        async loadVocabList(listId) {
            try {
                await this.ensureInitialized();

                const storageKey = this.storageKeys[listId] || listId;

                if (!window.storage) {
                    console.warn('[SpellingErrorCollector] 存储系统不可用');
                    return null;
                }

                const list = await window.storage.get(storageKey);
                const normalizedList = this.normalizeVocabListShape(list, listId, listId);

                if (normalizedList) {
                    console.log(`[SpellingErrorCollector] 加载词表成功，单词数: ${normalizedList.words.length}`);
                    return normalizedList;
                }

                console.log('[SpellingErrorCollector] 词表不存在');
                return null;
            } catch (error) {
                console.error('[SpellingErrorCollector] 加载词表失败', summarizeSpellingCollectorErrorForLog(error));
                return null;
            }
        }

        /**
         * 保存词表
         * @param {VocabularyList} vocabList - 词表对象
         * @returns {Promise<boolean>} 保存是否成功
         */
        async saveVocabList(vocabList) {
            try {
                await this.ensureInitialized();

                if (!vocabList || !vocabList.id) {
                    console.error('[SpellingErrorCollector] 无效的词表对象');
                    return false;
                }

                if (!Array.isArray(vocabList.words)) {
                    vocabList.words = [];
                }

                vocabList = this.normalizeVocabListShape(vocabList, vocabList.id, vocabList.source) || vocabList;

                // 更新统计信息
                vocabList.stats = vocabList.stats || {};
                vocabList.stats.totalWords = vocabList.words.length;
                vocabList.updatedAt = Date.now();

                const storageKey = this.storageKeys[vocabList.id] || vocabList.id;

                if (!window.storage) {
                    console.warn('[SpellingErrorCollector] 存储系统不可用');
                    return false;
                }

                await window.storage.set(storageKey, vocabList);
                console.log(`[SpellingErrorCollector] 保存词表成功，单词数: ${vocabList.words.length}`);

                return true;
            } catch (error) {
                console.error('[SpellingErrorCollector] 保存词表失败:', summarizeSpellingCollectorErrorForLog(error));
                return false;
            }
        }

        /**
         * 获取词表单词数量
         * @param {string} listId - 词表ID
         * @returns {Promise<number>} 单词数量
         */
        async getWordCount(listId) {
            try {
                const list = await this.loadVocabList(listId);
                return list ? list.words.length : 0;
            } catch (error) {
                console.error('[SpellingErrorCollector] 获取词表单词数失败', summarizeSpellingCollectorErrorForLog(error));
                return 0;
            }
        }

        /**
         * 检测答案比较中的拼写错误
         * @param {Object} answerComparison - 答案比较对象，格式: { questionId: { userAnswer, correctAnswer, isCorrect } }
         * @param {string} suiteId - 套题ID（可选）
         * @param {string} examId - 考试ID
         * @returns {SpellingError[]} 检测到的拼写错误数组
         */
        detectErrors(answerComparison, suiteId, examId) {
            console.log('[SpellingErrorCollector] 开始检测拼写错误');

            if (!answerComparison || typeof answerComparison !== 'object') {
                console.warn('[SpellingErrorCollector] 无效的答案比较对象');
                return [];
            }

            const errors = [];
            const source = this.detectSource(examId);

            // 遍历所有答案比较
            for (const [questionId, comparison] of Object.entries(answerComparison)) {
                // 跳过正确答案
                if (comparison.isCorrect) {
                    continue;
                }

                const detected = this.findSpellingError(comparison);
                if (detected) {
                    const error = {
                        word: detected.word,
                        userInput: detected.userInput,
                        questionId: questionId,
                        suiteId: suiteId || null,
                        examId: examId,
                        timestamp: Date.now(),
                        errorCount: 1,
                        source: source,
                        acceptedAnswers: detected.acceptedAnswers,
                        canonicalAnswer: detected.canonicalAnswer,
                        reasonCode: detected.reasonCode,
                        confidence: detected.confidence,
                        tokenIndex: detected.tokenIndex,
                        metadata: {
                            comparisonMode: detected.mode,
                            correctAnswer: comparison.correctAnswer
                        }
                    };

                    errors.push(error);
                    console.log('[SpellingErrorCollector] 检测到拼写错误');
                }
            }

            console.log(`[SpellingErrorCollector] 检测完成，共发现 ${errors.length} 个拼写错误`);
            return errors;
        }

        /**
         * 判断答案比较是否为拼写错误
         * @param {Object} comparison - 答案比较对象 { userAnswer, correctAnswer, isCorrect }
         * @returns {boolean} 如果是拼写错误返回true
         */
        isSpellingError(comparison) {
            return !!this.findSpellingError(comparison);
        }

        findSpellingError(comparison) {
            if (!comparison || comparison.isCorrect) {
                return false;
            }

            const { userAnswer, correctAnswer } = comparison;
            if (!userAnswer || !correctAnswer) {
                return null;
            }

            const userTokens = this.extractAnswerTokens(userAnswer);
            if (!userTokens.length) {
                return null;
            }

            const candidates = this.extractAcceptedAnswers(comparison);
            for (const candidate of candidates) {
                const correctTokens = this.extractAnswerTokens(candidate);
                if (!correctTokens.length) {
                    continue;
                }

                const tokenMatch = this.matchSpellingTokens(userTokens, correctTokens);
                if (tokenMatch) {
                    return {
                        word: tokenMatch.correctToken,
                        userInput: tokenMatch.userToken,
                        acceptedAnswers: candidates,
                        canonicalAnswer: candidate,
                        reasonCode: tokenMatch.reasonCode,
                        confidence: tokenMatch.confidence,
                        tokenIndex: tokenMatch.tokenIndex,
                        mode: correctTokens.length > 1 ? 'phrase-token' : 'single-token'
                    };
                }
            }

            return null;
        }

        extractAcceptedAnswers(comparison) {
            if (!comparison || typeof comparison !== 'object') {
                return [];
            }

            const rawCandidates = [];
            if (Array.isArray(comparison.acceptedAnswers)) {
                rawCandidates.push(...comparison.acceptedAnswers);
            }
            if (comparison.correctAnswer != null) {
                rawCandidates.push(comparison.correctAnswer);
            }

            const candidates = [];
            rawCandidates.forEach((raw) => {
                if (raw == null) {
                    return;
                }
                if (Array.isArray(raw)) {
                    raw.forEach((item) => rawCandidates.push(item));
                    return;
                }
                String(raw)
                    .split(/\s*(?:\/|\||;)\s*/)
                    .forEach((part) => {
                        const cleaned = this.cleanAnswerText(part);
                        if (cleaned && !candidates.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) {
                            candidates.push(cleaned);
                        }
                    });
            });

            return candidates;
        }

        cleanAnswerText(text) {
            if (text == null) {
                return '';
            }
            return String(text)
                .replace(/[“”]/g, '"')
                .replace(/[‘’]/g, "'")
                .replace(/[—–]/g, '-')
                .replace(/\s+/g, ' ')
                .replace(/^[\s"'.,;:!?()[\]{}]+|[\s"'.,;:!?()[\]{}]+$/g, '')
                .trim();
        }

        normalizeToken(token) {
            return this.cleanAnswerText(token)
                .toLowerCase()
                .replace(/^[^a-z]+|[^a-z]+$/g, '')
                .replace(/[^a-z'-]/g, '');
        }

        extractAnswerTokens(text) {
            const cleaned = this.cleanAnswerText(text);
            if (!cleaned) {
                return [];
            }
            return cleaned
                .split(/[\s,]+/)
                .map((token) => this.cleanAnswerText(token))
                .filter((token) => this.isLearningWord(token));
        }

        isLearningWord(text) {
            if (!this.isWord(text)) {
                return false;
            }
            const trimmed = this.cleanAnswerText(text);
            const lettersOnly = trimmed.replace(/[^A-Za-z]/g, '');
            if (!lettersOnly) {
                return false;
            }
            if (/^[A-Z]{2,4}$/.test(lettersOnly)) {
                return false;
            }
            return true;
        }

        hasEmbeddedLexicon() {
            const embedded = window.__EMBEDDED_WORDLISTS__;
            return !!(embedded && Array.isArray(embedded.ielts_core) && embedded.ielts_core.length);
        }

        isKnownLexiconWord(text) {
            const token = this.normalizeToken(text);
            if (!token) {
                return false;
            }
            const embedded = window.__EMBEDDED_WORDLISTS__;
            const wordlist = embedded && Array.isArray(embedded.ielts_core) ? embedded.ielts_core : [];
            return wordlist.some((entry) => {
                if (!entry || typeof entry.word !== 'string') {
                    return false;
                }
                return this.normalizeToken(entry.word) === token;
            });
        }

        isAcronymToken(text) {
            const lettersOnly = this.cleanAnswerText(text).replace(/[^A-Za-z]/g, '');
            return /^[A-Z]{2,}$/.test(lettersOnly);
        }

        isLikelyProperNounAnswer(text) {
            const cleaned = this.cleanAnswerText(text);
            const token = this.normalizeToken(cleaned);
            if (!cleaned || !token) {
                return false;
            }
            if (PROPER_NOUN_STOPWORDS.has(token)) {
                return true;
            }
            if (!/^[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)*$/.test(cleaned)) {
                return false;
            }
            if (this.isKnownLexiconWord(cleaned)) {
                return false;
            }
            return this.hasEmbeddedLexicon();
        }

        matchSpellingTokens(userTokens, correctTokens) {
            if (!Array.isArray(userTokens) || !Array.isArray(correctTokens)) {
                return null;
            }

            const limit = Math.min(userTokens.length, correctTokens.length);
            for (let i = 0; i < limit; i++) {
                const userToken = userTokens[i];
                const correctToken = correctTokens[i];
                if (this.normalizeToken(userToken) === this.normalizeToken(correctToken)) {
                    continue;
                }
                const analysis = this.analyzeTokenSimilarity(userToken, correctToken);
                if (analysis && analysis.isSimilar) {
                    return {
                        userToken,
                        correctToken,
                        tokenIndex: i,
                        reasonCode: analysis.reasonCode,
                        confidence: analysis.confidence
                    };
                }
            }

            if (correctTokens.length === 1) {
                const correctToken = correctTokens[0];
                for (let i = 0; i < userTokens.length; i++) {
                    const userToken = userTokens[i];
                    if (this.normalizeToken(userToken) === this.normalizeToken(correctToken)) {
                        continue;
                    }
                    const analysis = this.analyzeTokenSimilarity(userToken, correctToken);
                    if (analysis && analysis.isSimilar) {
                        return {
                            userToken,
                            correctToken,
                            tokenIndex: i,
                            reasonCode: analysis.reasonCode,
                            confidence: analysis.confidence
                        };
                    }
                }
            }

            return null;
        }

        /**
         * 判断文本是否为单词
         * 排除数字、长短语、特殊符号等
         * @param {string} text - 要检查的文本
         * @returns {boolean} 如果是单词返回true
         */
        isWord(text) {
            // 空值检查
            if (!text || typeof text !== 'string') {
                return false;
            }

            const trimmed = text.trim();

            // 空字符串
            if (!trimmed) {
                return false;
            }

            // 排除纯数字
            if (/^\d+$/.test(trimmed)) {
                return false;
            }

            // 排除日期格式 (如 "2023-01-01", "01/01/2023")
            if (/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(trimmed)) {
                return false;
            }

            // 排除时间格式 (如 "10:30", "10:30:45")
            if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
                return false;
            }

            // 排除长短语（超过3个单词）
            const words = trimmed.split(/\s+/);
            if (words.length > 3) {
                return false;
            }

            // 排除包含特殊符号的文本（但允许连字符和撇号）
            if (/[^a-zA-Z\s'-]/.test(trimmed)) {
                return false;
            }

            // 排除过短的文本（少于2个字符）
            if (trimmed.length < 2) {
                return false;
            }

            // 排除过长的文本（超过50个字符，可能是句子）
            if (trimmed.length > 50) {
                return false;
            }

            // 必须包含至少一个字母
            if (!/[a-zA-Z]/.test(trimmed)) {
                return false;
            }

            // 通过所有检查，认为是单词
            return true;
        }

        /**
         * 检查拼写相似度
         * 使用编辑距离算法判断两个单词是否拼写相似
         * @param {string} input - 用户输入
         * @param {string} correct - 正确答案
         * @returns {boolean} 如果拼写相似返回true
         */
        isSimilarSpelling(input, correct) {
            const analysis = this.analyzeTokenSimilarity(input, correct);
            return !!(analysis && analysis.isSimilar);
        }

        analyzeTokenSimilarity(input, correct) {
            if (!input || !correct) {
                return null;
            }

            const inputNorm = this.normalizeToken(input);
            const correctNorm = this.normalizeToken(correct);
            if (!inputNorm || !correctNorm) {
                return null;
            }

            if (this.isAcronymToken(correct) || this.isLikelyProperNounAnswer(correct)) {
                return null;
            }

            if (inputNorm === correctNorm) {
                return {
                    isSimilar: true,
                    reasonCode: this.cleanAnswerText(input) === this.cleanAnswerText(correct) ? 'same' : 'case_or_punctuation',
                    confidence: 0.99
                };
            }

            if (this.isLikelyInflectionVariant(inputNorm, correctNorm)) {
                return null;
            }

            const distance = this.damerauLevenshteinDistance(inputNorm, correctNorm);
            const maxLen = Math.max(inputNorm.length, correctNorm.length);
            if (maxLen === 0) {
                return null;
            }

            const similarity = 1 - (distance / maxLen);
            const threshold = this.resolveSimilarityThreshold(maxLen);
            const isSimilar = similarity >= threshold;
            if (isSimilar) {
                console.log('[SpellingErrorCollector] Similar spelling detected:', {
                    input: summarizeSpellingTextForLog(input),
                    correct: summarizeSpellingTextForLog(correct),
                    similarityPercent: Number((similarity * 100).toFixed(1))
                });
                return {
                    isSimilar: true,
                    reasonCode: this.isAdjacentTransposition(inputNorm, correctNorm) ? 'transpose' : 'edit',
                    confidence: Number(similarity.toFixed(3))
                };
            }

            return null;
        }

        resolveSimilarityThreshold(length) {
            if (length <= 3) {
                return 1;
            }
            if (length <= 5) {
                return 0.78;
            }
            if (length <= 8) {
                return 0.75;
            }
            return 0.8;
        }

        isLikelyInflectionVariant(inputNorm, correctNorm) {
            const pair = [inputNorm, correctNorm].sort((a, b) => a.length - b.length);
            const shorter = pair[0];
            const longer = pair[1];
            if (!shorter || !longer || shorter === longer) {
                return false;
            }
            const suffixes = ['s', 'es', 'ed', 'ing'];
            if (suffixes.some((suffix) => longer === shorter + suffix)) {
                return true;
            }
            if (shorter.endsWith('y') && longer === shorter.slice(0, -1) + 'ies') {
                return true;
            }
            if (shorter.endsWith('e') && longer === shorter + 'd') {
                return true;
            }
            if (shorter.endsWith('e') && longer === shorter.slice(0, -1) + 'ing') {
                return true;
            }
            if (shorter.endsWith('is') && longer === shorter.slice(0, -2) + 'es') {
                return true;
            }
            return false;
        }

        isAdjacentTransposition(inputNorm, correctNorm) {
            if (!inputNorm || !correctNorm || inputNorm.length !== correctNorm.length) {
                return false;
            }
            const diff = [];
            for (let i = 0; i < inputNorm.length; i++) {
                if (inputNorm[i] !== correctNorm[i]) {
                    diff.push(i);
                    if (diff.length > 2) {
                        return false;
                    }
                }
            }
            if (diff.length !== 2 || diff[1] !== diff[0] + 1) {
                return false;
            }
            const first = diff[0];
            const second = diff[1];
            return inputNorm[first] === correctNorm[second]
                && inputNorm[second] === correctNorm[first];
        }

        /**
         * 计算两个字符串的Levenshtein编辑距离
         * 编辑距离表示将一个字符串转换为另一个字符串所需的最少单字符编辑操作次数
         * 操作包括：插入、删除、替换
         *
         * @param {string} a - 第一个字符串
         * @param {string} b - 第二个字符串
         * @returns {number} 编辑距离
         */
        levenshteinDistance(a, b) {
            // 边界情况
            if (!a) return b ? b.length : 0;
            if (!b) return a.length;

            const aLen = a.length;
            const bLen = b.length;

            // 创建距离矩阵
            // matrix[i][j] 表示 a[0..i-1] 转换为 b[0..j-1] 的编辑距离
            const matrix = [];

            // 初始化第一列（从空字符串到b的前缀）
            for (let i = 0; i <= bLen; i++) {
                matrix[i] = [i];
            }

            // 初始化第一行（从空字符串到a的前缀）
            for (let j = 0; j <= aLen; j++) {
                matrix[0][j] = j;
            }

            // 填充矩阵
            for (let i = 1; i <= bLen; i++) {
                for (let j = 1; j <= aLen; j++) {
                    // 如果字符相同，不需要操作
                    if (b.charAt(i - 1) === a.charAt(j - 1)) {
                        matrix[i][j] = matrix[i - 1][j - 1];
                    } else {
                        // 取三种操作的最小值
                        matrix[i][j] = Math.min(
                            matrix[i - 1][j - 1] + 1, // 替换
                            matrix[i][j - 1] + 1,     // 插入
                            matrix[i - 1][j] + 1      // 删除
                        );
                    }
                }
            }

            // 返回右下角的值，即完整字符串的编辑距离
            return matrix[bLen][aLen];
        }

        damerauLevenshteinDistance(a, b) {
            if (!a) return b ? b.length : 0;
            if (!b) return a.length;

            const aLen = a.length;
            const bLen = b.length;
            const matrix = Array.from({ length: aLen + 1 }, () => Array(bLen + 1).fill(0));

            for (let i = 0; i <= aLen; i++) {
                matrix[i][0] = i;
            }
            for (let j = 0; j <= bLen; j++) {
                matrix[0][j] = j;
            }

            for (let i = 1; i <= aLen; i++) {
                for (let j = 1; j <= bLen; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j - 1] + cost
                    );
                    if (
                        i > 1
                        && j > 1
                        && a[i - 1] === b[j - 2]
                        && a[i - 2] === b[j - 1]
                    ) {
                        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
                    }
                }
            }

            return matrix[aLen][bLen];
        }

        /**
         * 保存拼写错误到词表
         * @param {SpellingError[]} errors - 错误数组
         * @returns {Promise<boolean>} 保存是否成功
         */
        async saveErrors(errors) {
            console.log('[SpellingErrorCollector] 开始保存拼写错误');

            if (!errors || !Array.isArray(errors) || errors.length === 0) {
                console.log('[SpellingErrorCollector] 没有错误需要保存');
                return true;
            }

            try {
                await this.ensureInitialized();
                await this.ensureCoreLexicon();

                // 按来源分组错误
                const errorsBySource = this.groupErrorsBySource(errors);

                // 保存到各个来源的词表
                for (const [source, sourceErrors] of Object.entries(errorsBySource)) {
                    await this.saveErrorsToList(source, sourceErrors);
                }

                // 同步到综合词表
                await this.syncToMasterList(errors);

                console.log(`[SpellingErrorCollector] 保存完成，共保存 ${errors.length} 个错误`);
                return true;
            } catch (error) {
                console.error('[SpellingErrorCollector] 保存错误失败:', summarizeSpellingCollectorErrorForLog(error));
                return false;
            }
        }

        /**
         * 按来源分组错误
         * @param {SpellingError[]} errors - 错误数组
         * @returns {Object} 分组后的错误对象 { source: errors[] }
         */
        groupErrorsBySource(errors) {
            const grouped = {};

            for (const error of errors) {
                const source = error.source || 'other';
                if (!grouped[source]) {
                    grouped[source] = [];
                }
                grouped[source].push(error);
            }

            return grouped;
        }

        /**
         * 保存错误到指定来源的词表
         * @param {string} source - 来源标识 ('p1' | 'p4' | 'other')
         * @param {SpellingError[]} errors - 错误数组
         * @returns {Promise<boolean>} 保存是否成功
         */
        async saveErrorsToList(source, errors) {
            if (!errors || errors.length === 0) {
                return true;
            }

            const listId = source; // 'p1' 或 'p4'

            // 加载现有词表
            let vocabList = await this.loadVocabList(listId);

            // 如果词表不存在，创建新词表
            if (!vocabList) {
                vocabList = this.createEmptyList(listId, source);
                console.log('[SpellingErrorCollector] 创建新词表');
            }

            // 合并错误到词表
            this.mergeErrorsToList(vocabList, errors);

            // 保存词表
            return await this.saveVocabList(vocabList);
        }

        /**
         * 合并错误到词表
         * 处理重复单词，更新错误次数
         * @param {VocabularyList} vocabList - 词表对象
         * @param {SpellingError[]} errors - 错误数组
         */
        mergeErrorsToList(vocabList, errors) {
            for (const error of errors) {
                if (!error || typeof error.word !== 'string' || !error.word.trim()) {
                    continue;
                }
                // 标准化单词（小写）
                const normalizedWord = error.word.toLowerCase().trim();

                // 查找是否已存在该单词
                const existingIndex = vocabList.words.findIndex(w =>
                    w && typeof w.word === 'string' && w.word.toLowerCase().trim() === normalizedWord
                );

                if (existingIndex !== -1) {
                    // 单词已存在，更新错误次数和最新信息
                    const existing = vocabList.words[existingIndex];
                    vocabList.words[existingIndex] = this.buildVocabEntryFromError(error, existing, vocabList.source);

                    console.log(`[SpellingErrorCollector] 更新已存在单词，错误次数: ${vocabList.words[existingIndex].errorCount}`);
                } else {
                    // 新单词，添加到词表
                    const entry = this.buildVocabEntryFromError(error, null, vocabList.source);
                    if (!entry) {
                        continue;
                    }
                    vocabList.words.push(entry);

                    console.log('[SpellingErrorCollector] 添加新单词');
                }
            }
        }

        /**
         * 同步错误到综合词表
         * 综合词表包含所有来源的错误
         * @param {SpellingError[]} errors - 错误数组
         * @returns {Promise<boolean>} 同步是否成功
         */
        async syncToMasterList(errors) {
            if (!errors || errors.length === 0) {
                return true;
            }

            console.log('[SpellingErrorCollector] 同步到综合词表');

            const listId = 'master';

            // 加载综合词表
            let masterList = await this.loadVocabList(listId);

            // 如果不存在，创建新词表
            if (!masterList) {
                masterList = this.createEmptyList(listId, 'all');
                console.log('[SpellingErrorCollector] 创建综合词表');
            }

            // 合并所有错误
            this.mergeErrorsToList(masterList, errors);

            // 保存综合词表
            return await this.saveVocabList(masterList);
        }

        /**
         * 从词表中移除单词
         * @param {string} listId - 词表ID
         * @param {string} word - 要移除的单词
         * @returns {Promise<boolean>} 移除是否成功
         */
        async removeWord(listId, word) {
            try {
                const vocabList = await this.loadVocabList(listId);

                if (!vocabList) {
                    console.warn('[SpellingErrorCollector] 词表不存在');
                    return false;
                }

                const normalizedWord = word.toLowerCase().trim();
                const originalLength = vocabList.words.length;

                // 过滤掉要移除的单词
                vocabList.words = vocabList.words.filter(w =>
                    w.word.toLowerCase().trim() !== normalizedWord
                );

                if (vocabList.words.length < originalLength) {
                    await this.saveVocabList(vocabList);
                    console.log('[SpellingErrorCollector] 从词表移除单词');
                    return true;
                } else {
                    console.log('[SpellingErrorCollector] 词表中未找到单词');
                    return false;
                }
            } catch (error) {
                console.error('[SpellingErrorCollector] 移除单词失败:', summarizeSpellingCollectorErrorForLog(error));
                return false;
            }
        }

        /**
         * 清空词表
         * @param {string} listId - 词表ID
         * @returns {Promise<boolean>} 清空是否成功
         */
        async clearList(listId) {
            try {
                const vocabList = await this.loadVocabList(listId);

                if (!vocabList) {
                    console.warn('[SpellingErrorCollector] 词表不存在');
                    return false;
                }

                vocabList.words = [];
                vocabList.updatedAt = Date.now();

                await this.saveVocabList(vocabList);
                console.log('[SpellingErrorCollector] 清空词表');

                return true;
            } catch (error) {
                console.error('[SpellingErrorCollector] 清空词表失败:', summarizeSpellingCollectorErrorForLog(error));
                return false;
            }
        }
    }

    // 导出到全局
    window.SpellingErrorCollector = SpellingErrorCollector;

    // 创建全局实例
    if (!window.spellingErrorCollector) {
        window.spellingErrorCollector = new SpellingErrorCollector();
        console.log('[SpellingErrorCollector] 全局实例已创建');
    }

})();
