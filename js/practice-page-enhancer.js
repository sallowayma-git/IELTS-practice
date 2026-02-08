/**
 * 练习页面增强器 - 统一版本
 * 整合了原有的practicePageManager功能，解决数据收集和正确答案提取问题
 */

(function patchPracticeEnhancer() {
    const previousEnhancer = window.practicePageEnhancer;
    if (previousEnhancer && typeof previousEnhancer.cleanup === 'function') {
        try {
            previousEnhancer.cleanup();
        } catch (error) {
            console.warn('[PracticeEnhancer] 旧版本清理失败:', error);
        }
    }

    console.log('[PracticeEnhancer] 初始化增强器');

    const DEFAULT_ENHANCER_CONFIG = {
        autoInitialize: true,
        excludedSelectors: [
            '#volume-slider',
            '#playback-speed',
            '#notes-panel textarea',
            '#notes-panel input',
            '#settings-panel input',
            '#settings-panel select',
            '[data-answer-ignore="true"]'
        ],
        excludedAncestors: [
            '#speed-control',
            '#volume-container',
            '#notes-panel',
            '#settings-panel'
        ],
        excludedNames: ['timer', 'notes', 'note'],
        questionIdAttributes: [
            'name',
            'id',
            'data-question',
            'data-question-id',
            'data-qid',
            'data-for'
        ],
        datasetExcludeAttribute: 'enhancerExclude'
    };

    const mergeConfig = (baseConfig, overrideConfig) => {
        const result = { ...(baseConfig || {}) };
        if (!overrideConfig || typeof overrideConfig !== 'object') {
            return result;
        }

        Object.entries(overrideConfig).forEach(([key, value]) => {
            if (value === undefined || value === null) {
                return;
            }

            if (Array.isArray(value)) {
                const existing = Array.isArray(result[key]) ? result[key] : [];
                result[key] = Array.from(new Set([...existing, ...value]));
                return;
            }

            if (typeof value === 'object') {
                const existing = (result[key] && typeof result[key] === 'object' && !Array.isArray(result[key]))
                    ? result[key]
                    : {};
                result[key] = mergeConfig(existing, value);
                return;
            }

            result[key] = value;
        });

        return result;
    };

    const detectEnhancerScriptUrl = () => {
        try {
            if (document.currentScript && document.currentScript.src) {
                return document.currentScript.src;
            }
            const scripts = document.querySelectorAll('script[src]');
            for (let idx = scripts.length - 1; idx >= 0; idx -= 1) {
                const script = scripts[idx];
                if (script.src && script.src.includes('practice-page-enhancer.js')) {
                    return script.src;
                }
            }
        } catch (_) {
            // ignore
        }
        return null;
    };

    const resolveEnhancerBaseUrl = () => {
        const scriptUrl = detectEnhancerScriptUrl();
        if (scriptUrl) {
            try {
                return new URL('.', scriptUrl).href;
            } catch (_) {
                // ignore and fallback
            }
        }
        try {
            return new URL('./js/', window.location.href).href;
        } catch (_) {
            return './js/';
        }
    };

    const ENHANCER_BASE_URL = resolveEnhancerBaseUrl();
    const dependencyLoader = {
        cache: new Map(),
        loadScript(url) {
            if (!url) {
                return Promise.reject(new Error('script url missing'));
            }
            if (this.cache.has(url)) {
                return this.cache.get(url);
            }
            const promise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.type = 'text/javascript';
                script.defer = true;
                script.src = url;
                script.onload = () => resolve(true);
                script.onerror = (err) => reject(err);
                (document.head || document.body || document.documentElement).appendChild(script);
            });
            this.cache.set(url, promise);
            return promise;
        }
    };

    function sanitizeExamTitle(rawTitle) {
        if (!rawTitle) return '';
        const title = String(rawTitle).trim();
        if (!title) return '';
        const pattern = /ielts\s+listening\s+practice\s*[-–—]?\s*part\s*\d+\s*[:\-–—]?\s*(.+)$/i;
        const match = title.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
        if (/[-–—]/.test(title)) {
            const segments = title.split(/[-–—]/).map((s) => s.trim()).filter(Boolean);
            if (segments.length > 1) {
                return segments[segments.length - 1];
            }
        }
        return title;
    }

    const enhancerMixinRegistry = [];

    const registerPracticeEnhancerMixin = (definition) => {
        if (!definition || typeof definition.apply !== 'function') {
            return;
        }
        enhancerMixinRegistry.push(definition);
    };

    const applyMixinsToEnhancer = (instance) => {
        if (!instance || typeof instance.getPageContext !== 'function') {
            return [];
        }

        const context = instance.getPageContext();
        const sorted = enhancerMixinRegistry
            .slice()
            .sort((a, b) => ((b && b.priority) || 0) - ((a && a.priority) || 0));
        const applied = [];

        sorted.forEach((mixin) => {
            if (!mixin || typeof mixin.apply !== 'function') {
                return;
            }
            try {
                const shouldApply = typeof mixin.shouldActivate === 'function'
                    ? mixin.shouldActivate(context, instance)
                    : true;
                if (shouldApply) {
                    mixin.apply(instance, context);
                    applied.push(mixin.name || 'anonymous-mixin');
                }
            } catch (mixinError) {
                console.warn('[PracticeEnhancer] mixin apply failed:', mixin && mixin.name, mixinError);
            }
        });

        return applied;
    };

    function createStandardInlineMixin() {
        return {
            name: 'standard-inline-practice',
            priority: 5,
            shouldActivate() {
                return true;
            },
            apply(enhancer, context) {
                if (!enhancer || typeof enhancer.registerHook !== 'function') {
                    return;
                }
                enhancer.registerHook('afterBuildPayload', (payload) => {
                    if (!payload) {
                        return;
                    }
                    payload.metadata = payload.metadata || {};
                    if (!payload.metadata.practiceMode) {
                        payload.metadata.practiceMode = 'single';
                    }
                    if (!payload.metadata.variant) {
                        payload.metadata.variant = context && context.isListening
                            ? 'listening-inline'
                            : 'reading-inline';
                    }
                });
            }
        };
    }

    function createListeningSuiteMixin() {
        return {
            name: 'listening-suite-practice',
            priority: 30,
            shouldActivate() {
                if (document.querySelector('[data-submit-suite]') || document.querySelector('.suite-submit-btn')) {
                    return true;
                }

                if (document.querySelectorAll('[data-suite-id]').length > 1) {
                    return true;
                }

                if (!document.getElementById('test-pages-container') || !document.getElementById('part-pills')) {
                    return false;
                }

                return document.querySelectorAll('.test-page').length > 1;
            },
            apply(enhancer) {
                if (!enhancer || typeof enhancer.registerHook !== 'function') {
                    return;
                }
                const suiteButtons = document.querySelectorAll('[data-submit-suite], .suite-submit-btn');
                const suiteContainers = document.querySelectorAll('[data-suite-id], .test-page');
                const suiteCount = Math.max(suiteButtons.length, suiteContainers.length) || 0;

                const ensureSuiteMetadata = (target) => {
                    if (!target) {
                        return;
                    }
                    target.metadata = target.metadata || {};
                    target.metadata.practiceMode = target.metadata.practiceMode || 'suite';
                    target.metadata.variant = target.metadata.variant || 'listening-inline';
                    if (suiteCount && !target.metadata.totalSuites) {
                        target.metadata.totalSuites = suiteCount;
                    }
                    target.practiceMode = target.practiceMode || 'suite';
                };

                enhancer.registerHook('afterBuildPayload', ensureSuiteMetadata);
                enhancer.registerHook('afterSuiteMessageBuilt', ensureSuiteMetadata);
                enhancer.registerHook('beforeSendMessage', (type, data) => {
                    if (type === 'PRACTICE_COMPLETE') {
                        ensureSuiteMetadata(data);
                    }
                });
            }
        };
    }

    registerPracticeEnhancerMixin(createListeningSuiteMixin());
    registerPracticeEnhancerMixin(createStandardInlineMixin());

    const cssEscape = (value) => {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            try {
                return window.CSS.escape(value);
            } catch (_) {
                // ignore and fallback
            }
        }
        return String(value == null ? '' : value).replace(/["\\]/g, '\\$&');
    };

    const initialConfig = mergeConfig(
        DEFAULT_ENHANCER_CONFIG,
        window.practicePageEnhancerConfig || {}
    );

    let cachedPracticePageContext = null;

    const cleanTitleCandidate = (raw) => {
        if (!raw) return '';
        let text = String(raw).replace(/\s+/g, ' ').trim();
        if (!text) return '';
        text = text
            .replace(/^[\d]+[\.\-、\s]+/, '')
            .replace(/^PART\s*\d+/i, '')
            .replace(/^P\s*\d+/i, '')
            .replace(/IELTS\s+Listening\s+Practice\s*-?\s*/i, '')
            .replace(/^-+/, '')
            .replace(/^\s*[-:]\s*/, '')
            .replace(/\s+/g, ' ')
            .trim();
        return text;
    };

    const extractLeadingNumber = (text) => {
        if (!text) return null;
        const match = String(text).trim().match(/^(\d{1,4})[\s.\-、_]/);
        return match ? parseInt(match[1], 10) : null;
    };

    const extractPartFromText = (text) => {
        if (!text) return null;
        const match = String(text).match(/P(?:ART)?\s*([1-4])/i) || String(text).match(/PART\s*([1-4])/i);
        if (match) {
            return match[1];
        }
        const partWord = String(text).match(/Part\s*([1-4])/i);
        return partWord ? partWord[1] : null;
    };

    const detectFrequencyLabel = (text) => {
        if (!text) return '未知频率';
        if (/高频/.test(text)) return '高频';
        if (/次高频/.test(text)) return '次高频';
        if (/低频/.test(text)) return '低频';
        return '未知频率';
    };

    const computePracticePageContext = () => {
        const pathname = decodeURIComponent(window.location.pathname || '').replace(/\\/g, '/');
        const segments = pathname.split('/').filter(Boolean);
        const filenameWithExt = segments[segments.length - 1] || '';
        const filename = filenameWithExt.replace(/\.[^.]+$/, '');
        const folderName = segments[segments.length - 2] || '';
        const docTitle = document.title || '';
        const headerTitle = document.querySelector('.header h1, header .header-title')?.textContent || '';
        const pathSignature = [folderName, filename, docTitle, headerTitle].filter(Boolean).join(' || ');
        const part = extractPartFromText(pathSignature);
        const examNumber = extractLeadingNumber(folderName) || extractLeadingNumber(filename);
        const isListening = /listeningpractice/i.test(pathname) || /listening/i.test(docTitle);
        const categoryCode = part ? `P${part}` : 'unknown';
        const categoryLabel = part
            ? (isListening ? `Part ${part}` : `P${part}`)
            : 'unknown';
        const titleCandidates = [headerTitle, folderName, filename, docTitle];
        const cleanedTitles = [];
        titleCandidates.forEach(candidate => {
            const cleaned = cleanTitleCandidate(candidate);
            if (cleaned && !cleanedTitles.includes(cleaned)) {
                cleanedTitles.push(cleaned);
            }
        });
        const title = cleanedTitles[0] || (docTitle || '').trim();
        let examId = null;
        if (isListening && part && examNumber != null) {
            const paddedNumber = String(examNumber).padStart(2, '0');
            examId = `listening-p${part}-${paddedNumber}`;
        }
        const frequencyLabel = detectFrequencyLabel(`${pathname} ${docTitle}`);
        return {
            isListening,
            part,
            examNumber,
            examId,
            title,
            categoryCode,
            categoryLabel,
            frequencyLabel
        };
    };

    const getPracticePageContext = (forceRefresh = false) => {
        if (forceRefresh || !cachedPracticePageContext) {
            cachedPracticePageContext = computePracticePageContext();
        }
        return cachedPracticePageContext;
    };

    function extractObjectLiteral(content, startIndex) {
        if (!content || startIndex >= content.length) {
            return null;
        }
        let i = startIndex;
        while (i < content.length && /\s/.test(content[i])) {
            i++;
        }
        if (i >= content.length || content[i] !== '{') {
            return null;
        }
        let depth = 0;
        let literal = '';
        let inString = false;
        let stringQuote = null;
        for (; i < content.length; i++) {
            const char = content[i];
            literal += char;
            if (inString) {
                if (char === '\\') {
                    i++;
                    if (i < content.length) {
                        literal += content[i];
                    }
                    continue;
                }
                if (char === stringQuote) {
                    inString = false;
                    stringQuote = null;
                }
                continue;
            }
            if (char === '"' || char === "'" || char === '`') {
                inString = true;
                stringQuote = char;
                continue;
            }
            if (char === '{') {
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth === 0) {
                    return literal;
                }
            }
        }
        return null;
    }

    const normalizeQuestionKey = (value) => {
        if (value === undefined || value === null) return null;
        const raw = String(value).trim();
        if (!raw) return null;
        const cleaned = raw.replace(/[-_](anchor|nav)$/i, '');

        // 兼容多套题键：优先规范化 "套题ID::问题ID" 中的问题ID部分
        const suiteSeparatorIndex = cleaned.lastIndexOf('::');
        if (suiteSeparatorIndex !== -1 && suiteSeparatorIndex < cleaned.length - 2) {
            const suitePart = cleaned.slice(0, suiteSeparatorIndex);
            const questionPart = cleaned.slice(suiteSeparatorIndex + 2);
            const normalizedQuestionPart = normalizeQuestionKey(questionPart);
            if (normalizedQuestionPart) {
                return `${suitePart}::${normalizedQuestionPart}`;
            }
        }

        if (/^q[\w-]+/i.test(cleaned)) {
            return cleaned.replace(/^Q/, 'q');
        }

        // 兼容资源页命名（如 t2_q16 / set1_q1），提取最后一个 q+数字
        let qDigits = null;
        const qDigitPattern = /(?:^|[^a-z0-9])q(\d{1,4})/gi;
        let match = null;
        while ((match = qDigitPattern.exec(cleaned)) !== null) {
            qDigits = match[1];
        }
        if (qDigits) {
            return `q${qDigits}`;
        }

        const digitsMatch = cleaned.match(/^\d+/);
        if (digitsMatch) {
            return 'q' + digitsMatch[0];
        }
        const questionPrefix = cleaned.match(/^question[-_\s]*(\d+)/i);
        if (questionPrefix) {
            return 'q' + questionPrefix[1];
        }
        return cleaned;
    };

    // 内嵌CorrectAnswerExtractor功能，确保在练习页面中可用
    if (!window.CorrectAnswerExtractor) {
        window.CorrectAnswerExtractor = class {
            constructor() {
                this.extractionStrategies = [
                    this.extractFromAnswersObject.bind(this),
                    this.extractFromResultsTable.bind(this),
                    this.extractFromDOM.bind(this),
                    this.extractFromScripts.bind(this)
                ];
            }

            extractFromPage(document = window.document) {
                console.log('[CorrectAnswerExtractor] 开始提取正确答案');

                for (const strategy of this.extractionStrategies) {
                    try {
                        const answers = strategy(document);
                        if (answers && Object.keys(answers).length > 0) {
                            console.log('[CorrectAnswerExtractor] 提取成功:', strategy.name, answers);
                            return this.normalizeAnswers(answers);
                        }
                    } catch (error) {
                        console.warn(`[CorrectAnswerExtractor] 策略 ${strategy.name} 失败:`, error);
                    }
                }

                console.warn('[CorrectAnswerExtractor] 所有提取策略都失败了');
                return {};
            }

            extractFromAnswersObject(document = window.document) {
                const win = document.defaultView || window;

                const possibleAnswerObjects = [
                    'answers', 'correctAnswers', 'examAnswers', 'questionAnswers', 'solutionAnswers'
                ];

                for (const objName of possibleAnswerObjects) {
                    if (win[objName] && typeof win[objName] === 'object') {
                        console.log(`[CorrectAnswerExtractor] 找到全局对象: ${objName}`);
                        return win[objName];
                    }
                }

                return this.extractFromScriptVariables(document);
            }

            extractFromScriptVariables(document = window.document) {
                const scripts = document.querySelectorAll('script');
                const candidateNames = ['correctAnswers', 'answerKey', 'answers'];

                for (const script of scripts) {
                    const content = script.textContent || script.innerHTML || '';

                    for (let i = 0; i < candidateNames.length; i++) {
                        const name = candidateNames[i];
                        const pattern = new RegExp(`(?:const|let|var)\\s+${name}\\s*=`, 'g');
                        let match;
                        while ((match = pattern.exec(content)) !== null) {
                            const literal = extractObjectLiteral(content, match.index + match[0].length);
                            if (!literal) {
                                continue;
                            }
                            try {
                                const answers = this.parseAnswersObject(literal);
                                if (answers && Object.keys(answers).length > 0) {
                                    console.log('[CorrectAnswerExtractor] 从脚本变量提取答案:', answers);
                                    return answers;
                                }
                            } catch (error) {
                                console.warn('[CorrectAnswerExtractor] 解析脚本变量失败:', error);
                            }
                        }
                    }
                }

                return null;
            }

            parseAnswersObject(objectStr) {
                try {
                    let cleanStr = objectStr
                        .replace(/\/\/.*$/gm, '')
                        .replace(/\/\*[\s\S]*?\*\//g, '')
                        .trim();

                    if (cleanStr.startsWith('{') && cleanStr.endsWith('}')) {
                        cleanStr = cleanStr.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
                        return JSON.parse(cleanStr);
                    }
                } catch (error) {
                    console.warn('[CorrectAnswerExtractor] JSON解析失败，尝试其他方法:', error);
                }

                return this.manualParseAnswers(objectStr);
            }

            manualParseAnswers(objectStr) {
                const answers = {};
                const keyValuePattern = /([a-zA-Z0-9_]+)\s*:\s*['"`]([^'"`]+)['"`]/g;
                let match;

                while ((match = keyValuePattern.exec(objectStr)) !== null) {
                    const key = match[1];
                    const value = match[2];
                    answers[key] = value;
                }

                return Object.keys(answers).length > 0 ? answers : null;
            }

            extractFromResultsTable(document = window.document) {
                const selectors = [
                    '.results-table', '.answer-table', '.score-table',
                    'table[class*="result"]', 'table[class*="answer"]',
                    '.exam-results table', '#results table'
                ];

                for (const selector of selectors) {
                    const table = document.querySelector(selector);
                    if (table) {
                        return this.parseAnswersFromTable(table);
                    }
                }

                return null;
            }

            extractFromDOM(document = window.document) {
                const answers = {};
                const answerSelectors = [
                    '[data-correct-answer]', '.correct-answer', '.solution',
                    '[class*="correct"]', '[id*="correct"]'
                ];

                for (const selector of answerSelectors) {
                    const elements = document.querySelectorAll(selector);
                    elements.forEach((el, index) => {
                        const questionId = this.extractQuestionId(el) || `q${index + 1}`;
                        const answer = this.extractAnswerFromElement(el);
                        if (answer) {
                            answers[questionId] = answer;
                        }
                    });
                }

                return Object.keys(answers).length > 0 ? answers : null;
            }

            extractFromScripts(document = window.document) {
                const scripts = document.querySelectorAll('script');

                for (const script of scripts) {
                    const content = script.textContent || script.innerHTML;
                    if (content.includes('answer') || content.includes('correct')) {
                        try {
                            const jsonMatch = content.match(/(?:answers?|correct)\s*[:=]\s*(\{[^}]+\}|\[[^\]]+\])/i);
                            if (jsonMatch) {
                                const answers = JSON.parse(jsonMatch[1]);
                                if (answers && typeof answers === 'object') {
                                    return answers;
                                }
                            }
                        } catch (error) {
                            // 继续尝试其他方法
                        }
                    }
                }

                return null;
            }

            parseAnswersFromTable(table) {
                const answers = {};
                const rows = table.querySelectorAll('tr');

                for (const row of rows) {
                    const cells = row.querySelectorAll('td, th');
                    if (cells.length >= 2) {
                        const questionCell = cells[0];
                        const answerCell = this.findAnswerCell(cells);

                        if (answerCell) {
                            const questionId = this.extractQuestionId(questionCell);
                            const answer = this.extractAnswerFromElement(answerCell);

                            if (questionId && answer) {
                                answers[questionId] = answer;
                            }
                        }
                    }
                }

                return Object.keys(answers).length > 0 ? answers : null;
            }

            findAnswerCell(cells) {
                for (let i = 1; i < cells.length; i++) {
                    const cell = cells[i];
                    const text = cell.textContent.toLowerCase();
                    const className = cell.className.toLowerCase();

                    if (text.includes('correct') || text.includes('answer') ||
                        className.includes('correct') || className.includes('answer') ||
                        text.includes('正确') || text.includes('答案')) {
                        return cell;
                    }
                }

                return cells[1];
            }

            extractQuestionId(element) {
                if (element.dataset.questionId) {
                    return element.dataset.questionId;
                }

                if (element.id) {
                    const match = element.id.match(/q(\d+)|question[_-]?(\d+)/i);
                    if (match) {
                        return `q${match[1] || match[2]}`;
                    }
                }

                const text = element.textContent;
                const match = text.match(/(?:问题|题目|Question)\s*[#:]?\s*(\d+)|^(\d+)[.)]/);
                if (match) {
                    return `q${match[1] || match[2]}`;
                }

                return null;
            }

            extractAnswerFromElement(element) {
                if (element.dataset.correctAnswer) {
                    return element.dataset.correctAnswer;
                }

                if (element.dataset.answer) {
                    return element.dataset.answer;
                }

                let text = element.textContent.trim();
                text = text.replace(/^(?:正确答案[:：]?|答案[:：]?|Correct Answer[:：]?|Answer[:：]?)\s*/i, '');

                if (/^(true|false)$/i.test(text)) {
                    return text.toUpperCase();
                }

                if (/^[A-Z]$/i.test(text)) {
                    return text.toUpperCase();
                }

                return text;
            }

            normalizeAnswers(answers) {
                const normalized = {};

                for (const [key, value] of Object.entries(answers)) {
                    const normalizedKey = key.toString().toLowerCase().startsWith('q')
                        ? key
                        : `q${key}`;

                    let normalizedValue = value;
                    if (typeof value === 'string') {
                        normalizedValue = value.trim();

                        if (/^(true|t|yes|y|正确|是)$/i.test(normalizedValue)) {
                            normalizedValue = 'TRUE';
                        } else if (/^(false|f|no|n|错误|否)$/i.test(normalizedValue)) {
                            normalizedValue = 'FALSE';
                        }

                        if (/^[A-Z]$/i.test(normalizedValue)) {
                            normalizedValue = normalizedValue.toUpperCase();
                        }
                    }

                    normalized[normalizedKey] = normalizedValue;
                }

                return normalized;
            }
        };
    }

    window.practicePageEnhancer = {
        sessionId: null,
        examId: null, // 新增：存储唯一的examId
        parentWindow: null,
        answers: {},
        correctAnswers: {},
        interactions: [],
        allQuestionIds: [],
        startTime: Date.now(),
        isInitialized: false,
        initRequestTimer: null,
        initializationPromise: null,
        submitInProgress: false,
        hasDispatchedFinalResults: false,
        config: initialConfig,
        customCollectors: [],
        pageContext: null,
        isMultiSuite: false, // 新增：标识是否为多套题模式
        currentSuiteId: null, // 新增：当前激活的套题ID
        submittedSuites: new Set(), // 新增：已提交的套题ID集合
        isSubmitting: false, // 新增：提交状态标志，防止并发提交
        mixinsApplied: false,
        activeMixins: [],
        hookHandlers: {},

        registerHook: function (hookName, handler) {
            if (!hookName || typeof handler !== 'function') {
                return;
            }
            if (!this.hookHandlers[hookName]) {
                this.hookHandlers[hookName] = [];
            }
            this.hookHandlers[hookName].push(handler);
        },

        runHooks: function (hookName, ...args) {
            const handlers = this.hookHandlers && this.hookHandlers[hookName];
            if (!handlers || handlers.length === 0) {
                return;
            }
            handlers.forEach((handler) => {
                try {
                    handler.apply(this, args);
                } catch (hookError) {
                    console.warn(`[PracticeEnhancer] hook ${hookName} 执行失败:`, hookError);
                }
            });
        },

        activateMixins: function () {
            if (this.mixinsApplied) {
                return;
            }
            if (!this.hookHandlers) {
                this.hookHandlers = {};
            }
            this.activeMixins = applyMixinsToEnhancer(this) || [];
            if (this.activeMixins.length) {
                console.log('[PracticeEnhancer] 已启用 mixin:', this.activeMixins.join(', '));
            }
            this.mixinsApplied = true;
        },

        initialize: function () {
            if (this.isInitialized) {
                console.log('[PracticeEnhancer] 已经初始化，跳过');
                return Promise.resolve();
            }

            if (this.initializationPromise) {
                console.log('[PracticeEnhancer] 初始化进行中，直接复用');
                return this.initializationPromise;
            }

            this.initializationPromise = (async () => {
                console.log('[PracticeEnhancer] 开始初始化');
                this.hasDispatchedFinalResults = false;
                this.submitInProgress = false;
                this.pageContext = this.getPageContext(true);
                this.activateMixins();

                this.enhancerBaseUrl = this.getEnhancerBaseUrl();
                await this.ensureStorageAvailable();
                await this.ensureSpellingErrorCollector();
                await this.prepareStorageNamespace();

                // 检测多套题结构
                this.isMultiSuite = this.detectMultiSuiteStructure();
                console.log('[PracticeEnhancer] 多套题模式:', this.isMultiSuite);

                this.setupCommunication();
                this.setupAnswerListeners();
                this.captureQuestionSet();
                this.extractCorrectAnswers(); // 新增：提取正确答案
                this.interceptSubmit();
                this.setupInteractionTracking();
                this.isInitialized = true;
                console.log('[PracticeEnhancer] 初始化完成');

                // 注入返回主页按钮
                this.injectBackToHomeButton();

                // 页面加载完成后进行一次初始收集
                if (document.readyState === 'complete') {
                    setTimeout(() => this.collectAllAnswers(), 1000);
                } else {
                    window.addEventListener('load', () => {
                        setTimeout(() => this.collectAllAnswers(), 1000);
                    });
                }
            })().catch((error) => {
                this.initializationPromise = null;
                throw error;
            });

            return this.initializationPromise;
        },

        /**
         * 检测页面是否包含多套题结构
         * @returns {boolean} 如果页面包含多套题返回true，否则返回false
         */
        detectMultiSuiteStructure: function () {
            console.log('[PracticeEnhancer] 开始检测多套题结构');

            // 方法1: 检测是否有多个带data-suite-id属性的元素
            const suiteElements = document.querySelectorAll('[data-suite-id]');
            if (suiteElements.length > 1) {
                console.log('[PracticeEnhancer] 检测到多个data-suite-id元素:', suiteElements.length);
                return true;
            }

            // 方法2: 检测是否有多个.suite-container元素
            const suiteContainers = document.querySelectorAll('.suite-container');
            if (suiteContainers.length > 1) {
                console.log('[PracticeEnhancer] 检测到多个suite-container元素:', suiteContainers.length);
                return true;
            }

            // 方法3: 检测是否有多个.test-page元素（针对100 P1/P4的HTML结构）
            const testPages = document.querySelectorAll('.test-page');
            if (testPages.length > 1) {
                console.log('[PracticeEnhancer] 检测到多个test-page元素:', testPages.length);
                return true;
            }

            // 方法4: 检测是否有套题切换按钮（pills）
            const pills = document.querySelectorAll('.pill[data-target^="page-test"]');
            if (pills.length > 1) {
                console.log('[PracticeEnhancer] 检测到多个套题切换按钮:', pills.length);
                return true;
            }

            console.log('[PracticeEnhancer] 未检测到多套题结构，使用单套题模式');
            return false;
        },

        /**
         * 动态资源页（例如 100 P1/P4）会在 DOMContentLoaded 之后才渲染 .test-page。
         * 初始化阶段若误判为单套题，会导致全页收集把 tX_qY 归一成 qY，直接串页污染。
         * 这里做运行时兜底：只允许从单套题切到多套题，并清理遗留的未分套题缓存。
         */
        ensureMultiSuiteMode: function () {
            if (this.isMultiSuite) {
                return;
            }

            let detected = false;
            try {
                detected = this.detectMultiSuiteStructure();
            } catch (error) {
                console.warn('[PracticeEnhancer] 多套题检测失败，保持单套题模式:', error);
                detected = false;
            }

            if (!detected) {
                return;
            }

            this.isMultiSuite = true;
            this.purgeUnscopedAnswerCaches();
            console.log('[PracticeEnhancer] 运行时检测到多套题结构，已切换为多套题模式');
        },

        purgeUnscopedAnswerCaches: function () {
            const purgeMap = (map, label) => {
                if (!map || typeof map !== 'object') {
                    return 0;
                }
                let removed = 0;
                Object.keys(map).forEach((key) => {
                    if (!key || key.includes('::')) {
                        return;
                    }
                    delete map[key];
                    removed += 1;
                });
                if (removed > 0) {
                    console.warn(`[PracticeEnhancer] 已清理未分套题的${label}: ${removed}`);
                }
                return removed;
            };

            purgeMap(this.answers, '答案缓存');
            purgeMap(this.correctAnswers, '正确答案缓存');
        },

        /**
         * 从DOM元素中提取套题标识
         * @param {HTMLElement} element - 要提取套题ID的元素
         * @returns {string|null} 套题ID，如果无法提取则返回null
         */
        extractSuiteId: function (element) {
            if (!element) {
                return null;
            }

            // 方法1: 直接从data-suite-id属性读取
            if (element.dataset && element.dataset.suiteId) {
                return element.dataset.suiteId;
            }

            // 方法2: 从最近的带data-suite-id的祖先元素读取
            const suiteContainer = element.closest('[data-suite-id]');
            if (suiteContainer && suiteContainer.dataset.suiteId) {
                return suiteContainer.dataset.suiteId;
            }

            // 方法3: 从.test-page元素的ID提取（针对100 P1/P4结构）
            const testPage = element.closest('.test-page');
            if (testPage && testPage.id) {
                // 从 "page-test1" 提取 "set1"
                const match = testPage.id.match(/page-test(\d+)/);
                if (match) {
                    return 'set' + match[1];
                }
                // 或者直接使用ID
                return testPage.id;
            }

            // 方法4: 从当前激活的test-page提取
            const activePage = document.querySelector('.test-page.active');
            if (activePage && activePage.id) {
                const match = activePage.id.match(/page-test(\d+)/);
                if (match) {
                    return 'set' + match[1];
                }
                return activePage.id;
            }

            // 方法5: 从.suite-container元素提取
            const suiteContainerByClass = element.closest('.suite-container');
            if (suiteContainerByClass) {
                // 尝试从ID或其他属性提取
                if (suiteContainerByClass.id) {
                    return suiteContainerByClass.id;
                }
                if (suiteContainerByClass.dataset.suite) {
                    return suiteContainerByClass.dataset.suite;
                }
            }

            // 默认返回null（单套题模式）
            return null;
        },

        getEnhancerBaseUrl: function () {
            if (this.enhancerBaseUrl) {
                return this.enhancerBaseUrl;
            }
            this.enhancerBaseUrl = ENHANCER_BASE_URL;
            return this.enhancerBaseUrl;
        },

        buildFallbackUrls: function (paths) {
            return (paths || []).map((p) => {
                try {
                    return new URL(p, window.location.href).href;
                } catch (_) {
                    return null;
                }
            }).filter(Boolean);
        },

        ensureStorageAvailable: async function () {
            try {
                if (window.storage && typeof window.storage.setNamespace === 'function') {
                    if (window.storage.ready && typeof window.storage.ready.then === 'function') {
                        await window.storage.ready;
                    }
                    return true;
                }

                const tryLoad = async (urls) => {
                    for (const url of urls) {
                        if (!url) continue;
                        try {
                            console.log('[PracticeEnhancer] 尝试加载存储管理器:', url);
                            await dependencyLoader.loadScript(url);
                            if (window.storage && typeof window.storage.setNamespace === 'function') {
                                if (window.storage.ready && typeof window.storage.ready.then === 'function') {
                                    await window.storage.ready;
                                }
                                return true;
                            }
                        } catch (error) {
                            console.warn('[PracticeEnhancer] 存储管理器加载失败:', error);
                        }
                    }
                    return false;
                };

                const baseUrl = this.getEnhancerBaseUrl();
                const baseCandidate = new URL('utils/storage.js', baseUrl).href;
                const fallbackUrls = this.buildFallbackUrls([
                    '../../../../js/utils/storage.js',
                    '../../../js/utils/storage.js',
                    '../../js/utils/storage.js',
                    '../js/utils/storage.js',
                    './js/utils/storage.js'
                ]);

                const loaded = await tryLoad([baseCandidate, ...fallbackUrls]);
                if (loaded) return true;
            } catch (error) {
                console.warn('[PracticeEnhancer] 加载存储管理器失败:', error);
            }

            // 创建简易回退存储，确保流程不中断
            console.warn('[PracticeEnhancer] 使用简易回退存储');
            const fallbackPrefix = 'exam_system_';
            const safeStore = (() => {
                try {
                    return window.localStorage;
                } catch (_) {
                    return null;
                }
            })();

            const stubStorage = {
                namespace: '',
                ready: Promise.resolve(),
                setNamespace(ns) { this.namespace = ns ? `${ns}_` : ''; },
                async set(key, value) {
                    if (!safeStore) return false;
                    const k = fallbackPrefix + this.namespace + key;
                    safeStore.setItem(k, JSON.stringify({ value }));
                    return true;
                },
                async get(key) {
                    if (!safeStore) return null;
                    const k = fallbackPrefix + this.namespace + key;
                    const raw = safeStore.getItem(k);
                    if (!raw) return null;
                    try {
                        const parsed = JSON.parse(raw);
                        return parsed && parsed.value !== undefined ? parsed.value : parsed;
                    } catch (_) {
                        return null;
                    }
                },
                async remove(key) {
                    if (!safeStore) return false;
                    const k = fallbackPrefix + this.namespace + key;
                    safeStore.removeItem(k);
                    return true;
                }
            };

            window.storage = stubStorage;
            return true;
        },

        ensureSpellingErrorCollector: async function () {
            if (window.spellingErrorCollector) {
                return true;
            }

            if (window.SpellingErrorCollector) {
                window.spellingErrorCollector = new window.SpellingErrorCollector();
                return true;
            }

            const tryLoad = async (urls) => {
                for (const url of urls) {
                    if (!url) continue;
                    try {
                        console.log('[PracticeEnhancer] 尝试加载SpellingErrorCollector:', url);
                        await dependencyLoader.loadScript(url);
                        if (!window.spellingErrorCollector && window.SpellingErrorCollector) {
                            window.spellingErrorCollector = new window.SpellingErrorCollector();
                        }
                        if (window.spellingErrorCollector) return true;
                    } catch (error) {
                        console.warn('[PracticeEnhancer] 加载SpellingErrorCollector失败:', error);
                    }
                }
                return false;
            };

            const baseUrl = this.getEnhancerBaseUrl();
            const baseCandidate = new URL('app/spellingErrorCollector.js', baseUrl).href;
            const fallbackUrls = this.buildFallbackUrls([
                '../../../../js/app/spellingErrorCollector.js',
                '../../../js/app/spellingErrorCollector.js',
                '../../js/app/spellingErrorCollector.js',
                '../js/app/spellingErrorCollector.js',
                './js/app/spellingErrorCollector.js'
            ]);

            const loaded = await tryLoad([baseCandidate, ...fallbackUrls]);
            return loaded;
        },

        prepareStorageNamespace: async function () {
            // 设置共享命名空间
            try {
                if (window.storage?.ready) {
                    await window.storage.ready;
                }

                if (window.storage && typeof window.storage.setNamespace === 'function') {
                    window.storage.setNamespace('exam_system');
                    console.log('[PracticeEnhancer] 已设置共享命名空间: exam_system');

                    // 验证命名空间设置是否生效
                    setTimeout(async () => {
                        const testKey = 'namespace_test_enhancer';
                        const testValue = 'test_value_enhancer_' + Date.now();
                        try {
                            await window.storage.set(testKey, testValue);
                            const retrievedValue = await window.storage.get(testKey);
                            if (retrievedValue === testValue) {
                                console.log('✅ 增强器命名空间设置验证成功: 存储和读取正常');
                            } else {
                                console.warn('❌ 增强器命名空间设置验证失败: 读取值不匹配');
                            }
                            await window.storage.remove(testKey);
                        } catch (error) {
                            console.error('❌ 增强器命名空间设置验证失败', error);
                        }
                    }, 1000);
                } else {
                    console.warn('[PracticeEnhancer] 存储管理器未加载或setNamespace方法不可用');
                }
            } catch (error) {
                console.error('[PracticeEnhancer] 存储初始化失败，跳过命名空间设置', error);
            }
        },

        /**
         * 【Phase 05 重构】在题目页面注入返回主页按钮
         * 
         * 原有问题：hard-coded `.practice-nav .controls` 容器假设
         * 解决方案：多布局容器解析 + 浮层兜底 + 样式自适应
         */
        injectBackToHomeButton: function () {
            // 检查是否在 Electron 环境中
            const hasElectronAPI = typeof window.electronAPI !== 'undefined'
                && window.electronAPI
                && typeof window.electronAPI.openLegacy === 'function';

            if (!hasElectronAPI) {
                console.log('[PracticeEnhancer] 非 Electron 环境，跳过返回按钮注入');
                return;
            }

            // 检查是否已经存在返回按钮
            if (document.getElementById('back-to-home-btn')) {
                console.log('[PracticeEnhancer] 返回按钮已存在，跳过注入');
                return;
            }

            // 【核心】多布局容器解析策略
            const resolveBackButtonHost = () => {
                // 优先级依次尝试
                const strategies = [
                    { selector: '.practice-nav .controls', name: 'practice-nav (Writing/Speaking)' },
                    { selector: '.bottom-bar .bb-left', name: 'bottom-bar left (Listening/Reading)' },
                    { selector: '.bottom-bar .bb-center', name: 'bottom-bar center' },
                    { selector: '.bottom-bar', name: 'bottom-bar basic' }
                ];

                for (const strategy of strategies) {
                    const container = document.querySelector(strategy.selector);
                    if (container) {
                        console.log(`[PracticeEnhancer] 使用容器策略: ${strategy.name}`);
                        return { container, isFloating: false };
                    }
                }

                // 最后兜底：创建固定浮层
                console.log('[PracticeEnhancer] 所有容器策略失败，使用浮层兜底');
                const floatingContainer = document.createElement('div');
                floatingContainer.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 9999;
                `;
                document.body.appendChild(floatingContainer);
                return { container: floatingContainer, isFloating: true };
            };

            // 获取容器
            const { container, isFloating } = resolveBackButtonHost();
            if (!container) {
                console.error('[PracticeEnhancer] 无法解析返回按钮容器');
                return;
            }

            // 【样式自适应】检测容器已有按钮样式
            const getAdaptiveButtonStyle = () => {
                // 尝试从容器内已有按钮复制样式类
                const existingButton = container.querySelector('button, .btn, .button, .top-bar-button');
                if (existingButton) {
                    const classList = Array.from(existingButton.classList);
                    console.log('[PracticeEnhancer] 复用现有按钮样式:', classList);
                    return {
                        useClasses: true,
                        classes: classList.filter(cls => !cls.includes('active') && !cls.includes('disabled'))
                    };
                }

                // Fallback: 内联样式（适用于浮层或无样式容器）
                return {
                    useClasses: false,
                    inlineStyle: `
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        border: none;
                        border-radius: 6px;
                        padding: ${isFloating ? '10px 16px' : '6px 12px'};
                        font-size: 14px;
                        cursor: pointer;
                        transition: all 0.2s;
                        font-weight: 500;
                        box-shadow: ${isFloating ? '0 2px 8px rgba(0,0,0,0.15)' : 'none'};
                    `
                };
            };

            const styleConfig = getAdaptiveButtonStyle();

            // 创建返回按钮
            const backButton = document.createElement('button');
            backButton.id = 'back-to-home-btn';
            backButton.textContent = '🏠 返回主页';
            backButton.title = '返回考试总览系统';

            if (styleConfig.useClasses) {
                backButton.className = styleConfig.classes.join(' ');
                // 补充必要样式（避免继承破坏）
                backButton.style.marginRight = '8px';
            } else {
                backButton.style.cssText = styleConfig.inlineStyle;
            }

            // 悬停效果（仅浮层或内联样式）
            if (!styleConfig.useClasses || isFloating) {
                backButton.addEventListener('mouseenter', () => {
                    backButton.style.transform = 'translateY(-1px)';
                    backButton.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
                });
                backButton.addEventListener('mouseleave', () => {
                    backButton.style.transform = 'translateY(0)';
                    backButton.style.boxShadow = isFloating ? '0 2px 8px rgba(0,0,0,0.15)' : 'none';
                });
            }

            // 点击事件：返回主页
            backButton.addEventListener('click', (event) => {
                event.preventDefault();

                // 确认是否要离开（如果有未提交的答案）
                const hasUnsavedAnswers = Object.keys(this.answers || {}).length > 0;
                if (hasUnsavedAnswers) {
                    const confirmLeave = confirm('您还有未提交的答案，确定要返回主页吗？');
                    if (!confirmLeave) {
                        return;
                    }
                }

                // 调用 Electron API 返回主页（统一入口）
                try {
                    window.electronAPI.openLegacy();
                    console.log('[PracticeEnhancer] 正在返回主页...');
                } catch (error) {
                    console.error('[PracticeEnhancer] 返回主页失败:', error);
                }
            });

            // 将按钮插入到容器
            if (isFloating) {
                container.appendChild(backButton);
            } else {
                container.insertBefore(backButton, container.firstChild);
            }

            console.log(`[PracticeEnhancer] 返回主页按钮已注入（${isFloating ? '浮层' : '容器内'}）`);
        },

        cleanup: function () {
            console.log('[PracticeEnhancer] 清理资源');
            if (this.answerCollectionInterval) {
                clearInterval(this.answerCollectionInterval);
                this.answerCollectionInterval = null;
            }
            this.stopInitRequestLoop();
        },

        configure: function (options = {}) {
            if (!options || typeof options !== 'object') {
                console.warn('[PracticeEnhancer] configure: 传入的配置无效');
                return;
            }
            this.config = mergeConfig(this.config || DEFAULT_ENHANCER_CONFIG, options);
            console.log('[PracticeEnhancer] 配置已更新:', this.config);
            if (this.isInitialized) {
                this.collectAllAnswers();
            }
        },

        registerCollector: function (collector) {
            if (typeof collector !== 'function') {
                console.warn('[PracticeEnhancer] registerCollector: collector必须为函数');
                return;
            }
            this.customCollectors.push(collector);
            if (this.isInitialized) {
                try {
                    collector({
                        addAnswer: (questionId, value) => this.addAnswer(questionId, value),
                        enhancer: this
                    });
                } catch (error) {
                    console.error('[PracticeEnhancer] 自定义收集器执行失败:', error);
                }
            }
        },

        runCustomCollectors: function () {
            if (!this.customCollectors.length) return;
            this.customCollectors.forEach(collector => {
                try {
                    collector({
                        addAnswer: (questionId, value) => this.addAnswer(questionId, value),
                        enhancer: this
                    });
                } catch (error) {
                    console.error('[PracticeEnhancer] 自定义收集器执行失败:', error);
                }
            });
        },

        normalizeQuestionId: function (questionId) {
            return normalizeQuestionKey(questionId);
        },

        addAnswer: function (questionId, value) {
            if (value === undefined || value === null) return null;
            const normalizedId = this.normalizeQuestionId(questionId);
            if (!normalizedId) return null;

            const normalizeSingle = (val) => {
                if (val === undefined || val === null) return null;
                if (typeof val === 'string') {
                    const trimmed = val.trim();
                    return trimmed.length ? trimmed : null;
                }
                if (typeof val === 'number' || typeof val === 'boolean') {
                    return String(val).trim();
                }
                if (typeof val === 'object' && val !== null) {
                    if (typeof val.value === 'string') {
                        return val.value.trim() || null;
                    }
                    if (typeof val.text === 'string') {
                        return val.text.trim() || null;
                    }
                }
                const str = String(val).trim();
                return str.length ? str : null;
            };

            if (Array.isArray(value)) {
                const normalizedArray = value
                    .map((item) => normalizeSingle(item))
                    .filter(Boolean);
                if (!normalizedArray.length) {
                    return null;
                }
                const deduped = [];
                normalizedArray.forEach((item) => {
                    if (!deduped.includes(item)) {
                        deduped.push(item);
                    }
                });
                this.answers[normalizedId] = deduped;
                return normalizedId;
            }

            const normalizedValue = normalizeSingle(value);
            if (normalizedValue === null) {
                return null;
            }
            this.answers[normalizedId] = normalizedValue;
            return normalizedId;
        },

        addCorrectAnswer: function (questionId, value) {
            if (value === undefined || value === null) return null;
            const normalizedId = this.normalizeQuestionId(questionId);
            if (!normalizedId) return null;
            this.correctAnswers[normalizedId] = Array.isArray(value) ? value : String(value).trim();
            return normalizedId;
        },

        captureQuestionSet: function () {
            const idSet = new Set(Array.isArray(this.allQuestionIds) ? this.allQuestionIds : []);
            const addCandidate = (candidate) => {
                const normalized = this.normalizeQuestionId(candidate);
                if (normalized) {
                    idSet.add(normalized);
                }
            };

            const navItems = document.querySelectorAll('.practice-nav .q-item');
            navItems.forEach((item) => {
                addCandidate(item.dataset.question || item.textContent || item.getAttribute('data-index'));
            });

            const questionHolders = document.querySelectorAll('[data-question], [data-question-id], [data-qid]');
            questionHolders.forEach((element) => {
                addCandidate(
                    element.dataset.question ||
                    element.dataset.questionId ||
                    element.dataset.qid
                );
            });

            const inputs = document.querySelectorAll('input[name], textarea[name], select[name]');
            inputs.forEach((element) => {
                addCandidate(element.name || element.id);
            });

            const sorted = Array.from(idSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
            this.allQuestionIds = sorted;
            return sorted;
        },

        setupCommunication: function () {
            this.parentWindow = window.opener || window.parent;
            if (!this.parentWindow || this.parentWindow === window) {
                console.warn('[PracticeEnhancer] 未检测到父窗口');
                return;
            }
            this.startInitRequestLoop();
            window.addEventListener('message', (event) => {
                const payload = event && event.data ? event.data : null;
                if (!payload || typeof payload.type !== 'string') {
                    return;
                }

                if (payload.type === 'INIT_SESSION') {
                    const initData = payload.data || {};
                    this.sessionId = initData.sessionId;
                    this.examId = initData.examId; // 存储 examId
                    if (initData.suiteSessionId) {
                        this.enableSuiteMode(initData);
                    }
                    this.stopInitRequestLoop();
                    console.log('[PracticeEnhancer] 收到会话初始化:', this.sessionId, 'Exam ID:', this.examId);
                    this.sendMessage('SESSION_READY', {
                        pageType: this.detectPageType(),
                        sessionId: this.sessionId,
                        suiteSessionId: this.suiteSessionId || null,
                        url: window.location.href,
                        title: document.title
                    });
                    return;
                }

                if (!this.suiteModeActive) {
                    return;
                }

                if (payload.type === 'SUITE_NAVIGATE') {
                    this.handleSuiteNavigation(payload.data || {});
                } else if (payload.type === 'SUITE_FORCE_CLOSE') {
                    this.teardownSuiteGuards();
                    if (this._nativeClose) {
                        this._nativeClose();
                    }
                }
            });
            console.log('[PracticeEnhancer] 通信设置完成');
        },

        startInitRequestLoop: function () {
            if (!this.parentWindow || this.parentWindow === window) {
                return;
            }
            if (this.initRequestTimer) {
                return;
            }
            const sendRequest = () => {
                if (this.sessionId) {
                    this.stopInitRequestLoop();
                    return;
                }
                const derivedExamId = this.extractExamIdFromUrl();
                if (!this.examId && derivedExamId) {
                    this.examId = derivedExamId;
                }
                this.sendMessage('REQUEST_INIT', {
                    examId: this.examId || null,
                    derivedExamId,
                    url: window.location.href,
                    title: document.title,
                    timestamp: Date.now()
                });
            };
            sendRequest();
            this.initRequestTimer = setInterval(sendRequest, 2000);
        },

        stopInitRequestLoop: function () {
            if (this.initRequestTimer) {
                clearInterval(this.initRequestTimer);
                this.initRequestTimer = null;
            }
        },

        enableSuiteMode: function (initData = {}) {
            if (this.suiteModeActive) {
                return;
            }

            this.suiteModeActive = true;
            this.suiteSessionId = initData.suiteSessionId || null;
            this.installSuiteGuards();
        },

        installSuiteGuards: function () {
            if (this.suiteGuardsInstalled) {
                return;
            }

            this.suiteGuardsInstalled = true;
            this._nativeClose = typeof window.close === 'function' ? window.close.bind(window) : null;
            this._nativeOpen = typeof window.open === 'function' ? window.open.bind(window) : null;

            const windowName = typeof window.name === 'string'
                ? window.name.trim().toLowerCase()
                : '';

            const isSelfTarget = (rawTarget) => {
                if (rawTarget == null) {
                    return true;
                }

                const normalized = typeof rawTarget === 'string'
                    ? rawTarget.trim().toLowerCase()
                    : String(rawTarget).trim().toLowerCase();

                if (!normalized) {
                    return true;
                }

                if (windowName && normalized === windowName) {
                    return true;
                }

                if (['_self', 'self', '_parent', 'parent', '_top', 'top', 'window', 'this'].includes(normalized)) {
                    return true;
                }

                return false;
            };

            const guardClose = () => {
                this.notifySuiteCloseAttempt('script_request');
                return undefined;
            };

            try { window.close = guardClose; } catch (_) { }
            try { window.self.close = guardClose; } catch (_) { }
            try { window.top.close = guardClose; } catch (_) { }

            if (this._nativeOpen) {
                const originalOpen = this._nativeOpen;
                window.open = (url = '', target = '', features = '') => {
                    if (isSelfTarget(target)) {
                        this.notifySuiteCloseAttempt('self_target_open');
                        return window;
                    }
                    return originalOpen(url, target, features);
                };
            }
        },

        teardownSuiteGuards: function () {
            if (!this.suiteGuardsInstalled) {
                return;
            }

            this.suiteGuardsInstalled = false;

            if (this._nativeClose) {
                try {
                    window.close = this._nativeClose;
                    window.self.close = this._nativeClose;
                    window.top.close = this._nativeClose;
                } catch (_) { }
            }

            if (this._nativeOpen) {
                try {
                    window.open = this._nativeOpen;
                } catch (_) { }
            }

            this.suiteModeActive = false;
            this.suiteSessionId = null;
        },

        notifySuiteCloseAttempt: function (reason) {
            this.sendMessage('SUITE_CLOSE_ATTEMPT', {
                examId: this.examId || null,
                suiteSessionId: this.suiteSessionId || null,
                reason: reason || 'unknown',
                timestamp: Date.now()
            });
        },

        handleSuiteNavigation: function (data) {
            if (!data || !data.url) {
                return;
            }

            if (data.examId) {
                this.nextExamId = data.examId;
            }

            try {
                window.location.href = data.url;
            } catch (error) {
                console.warn('[PracticeEnhancer] 套题导航失败:', error);
            }
        },

        detectPageType: function () {
            const context = this.getPageContext();
            if (context && context.categoryCode && context.categoryCode !== 'unknown') {
                return context.categoryCode;
            }
            const title = document.title || '';
            const url = window.location.href || '';
            if (title.includes('P1') || url.includes('P1')) return 'P1';
            if (title.includes('P2') || url.includes('P2')) return 'P2';
            if (title.includes('P3') || url.includes('P3')) return 'P3';
            if (/Part\s*4/i.test(title) || /Part\s*4/i.test(url) || title.includes('P4') || url.includes('P4')) return 'P4';
            const pathParts = url.split('/');
            for (let part of pathParts) {
                if (part.match(/^P[123]$/i)) {
                    return part.toUpperCase();
                }
                if (part.match(/^P4$/i)) {
                    return 'P4';
                }
            }
            return 'unknown';
        },

        getPageContext: function (forceRefresh = false) {
            const context = getPracticePageContext(forceRefresh);
            this.pageContext = context;
            return context;
        },

        detectPracticeType: function () {
            // 注意：不要返回 categoryCode（它是 'P1'/'P2' 等，不是 'listening'/'reading'）
            const doc = document;
            const fromBody = doc.body && doc.body.dataset
                ? [
                    doc.body.dataset.practiceType,
                    doc.body.dataset.examType,
                    doc.body.dataset.type
                ]
                : [];
            const meta = doc.querySelector('meta[name="practice-type"], meta[name="exam-type"]');
            const hints = [
                ...fromBody,
                meta ? meta.content : null,
                doc.title || ''
            ];
            const url = (window.location.href || '').toLowerCase();
            const bodyClass = doc.body ? doc.body.className.toLowerCase() : '';
            const joined = hints
                .filter(Boolean)
                .map((hint) => hint.toLowerCase())
                .concat([url, bodyClass]);
            const isListening = joined.some((hint) => /listen|audio|hearing/.test(hint))
                || url.includes('listeningpractice')
                || url.includes('/listening/');
            return isListening ? 'listening' : 'reading';
        },

        // 新增：从URL中提取真实的examId
        extractExamIdFromUrl: function () {
            // 优先读取显式配置/参数
            const doc = document;
            const metaExamId = doc.querySelector('meta[name="exam-id"], meta[name="examId"]');
            if (metaExamId && metaExamId.content) {
                return metaExamId.content.trim();
            }
            if (doc.body && doc.body.dataset) {
                if (doc.body.dataset.examId) {
                    return doc.body.dataset.examId.trim();
                }
                if (doc.body.dataset.examid) {
                    return doc.body.dataset.examid.trim();
                }
            }
            const context = this.getPageContext();
            if (context && context.examId) {
                return context.examId;
            }
            try {
                const urlParams = new URLSearchParams(window.location.search || '');
                if (urlParams.has('examId')) {
                    const qp = urlParams.get('examId');
                    if (qp) {
                        return qp.trim();
                    }
                }
            } catch (_) { }

            const url = window.location.href || '';
            const title = document.title || '';
            const pathParts = (window.location.pathname || url).split('/').map((part) => decodeURIComponent(part || '').trim()).filter(Boolean);
            let foundNumber = null;
            let foundPart = null;
            let foundSlug = null;
            let isListening = pathParts.some((part) => /listening/i.test(part));

            const normalizeSlug = (text) => {
                return text
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/gi, '-')
                    .replace(/^-+|-+$/g, '');
            };

            // 尝试从路径中提取编号与 part
            for (let part of pathParts) {
                if (foundNumber === null) {
                    const numMatch = part.match(/^(\d+)[\.\-\s]?/);
                    if (numMatch) {
                        foundNumber = numMatch[1];
                    }
                }
                if (foundPart === null) {
                    const pMatch = part.match(/p(?:art)?\s*([1-4])/i);
                    if (pMatch) {
                        foundPart = pMatch[1];
                    }
                }
                if (!foundSlug && part.length > 6 && /[a-z]/i.test(part)) {
                    foundSlug = normalizeSlug(part);
                }
            }

            // 如果标题包含part/编号也纳入
            if (!foundPart || !foundNumber) {
                const titleMatch = title.match(/p(?:art)?\s*([1-4])[^0-9]*?(\d+)?/i);
                if (titleMatch) {
                    if (!foundPart && titleMatch[1]) {
                        foundPart = titleMatch[1];
                    }
                    if (!foundNumber && titleMatch[2]) {
                        foundNumber = titleMatch[2];
                    }
                }
            }

            // 生成ID优先使用编号
            if (foundNumber) {
                if (foundPart) {
                    const prefix = isListening ? 'listening' : 'p';
                    return `${prefix}${isListening ? '' : foundPart.toLowerCase()}-${foundNumber}`;
                }
                return `${isListening ? 'listening' : 'practice'}-${foundNumber}`;
            }

            if (foundPart && foundSlug) {
                const prefix = isListening ? 'listening' : 'p';
                return `${prefix}${isListening ? '' : foundPart.toLowerCase()}-${foundSlug}`;
            }

            if (foundSlug) {
                return foundSlug;
            }

            // 最后的降级方案：返回页面类型
            return this.detectPageType();
        },

        resolveExamId: function () {
            const derived = this.examId || this.extractExamIdFromUrl();
            const sessionPrefix = this.sessionId ? String(this.sessionId).split('_')[0] : null;
            const pageType = this.detectPageType();
            const fallbackBase = derived || sessionPrefix || (pageType ? `practice-${pageType.toLowerCase()}` : null) || `practice-${Date.now()}`;
            const safe = String(fallbackBase || 'practice-unknown').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/--+/g, '-');
            this.examId = safe;
            return safe;
        },

        normalizeAnswerMap: function (answersMap) {
            const normalized = {};
            if (!answersMap || typeof answersMap !== 'object') {
                return normalized;
            }
            Object.entries(answersMap).forEach(([key, value]) => {
                const normalizedKey = this.addCorrectAnswer(key, value);
                if (normalizedKey) {
                    normalized[normalizedKey] = this.correctAnswers[normalizedKey];
                }
            });
            this.correctAnswers = normalized;
            return normalized;
        },

        extractCorrectAnswers: function () {
            console.log('[PracticeEnhancer] 开始提取正确答案');

            // 如果是多套题模式，需要为每个套题提取答案
            if (this.isMultiSuite) {
                console.log('[PracticeEnhancer] 多套题模式：为每个套题提取正确答案');
                this.extractMultiSuiteCorrectAnswers();
                return;
            }

            // 单套题模式：使用原有逻辑
            // 使用CorrectAnswerExtractor如果可用
            if (window.CorrectAnswerExtractor) {
                try {
                    const extractor = new CorrectAnswerExtractor();
                    const extractedAnswers = extractor.extractFromPage(document);

                    if (extractedAnswers && Object.keys(extractedAnswers).length > 0) {
                        this.normalizeAnswerMap(extractedAnswers);
                        console.log('[PracticeEnhancer] 使用提取器成功获得正确答案:', this.correctAnswers);
                    } else {
                        console.warn('[PracticeEnhancer] 提取器未找到答案，使用备用方法');
                        this.extractCorrectAnswersBackup();
                    }
                } catch (error) {
                    console.warn('[PracticeEnhancer] 提取器失败，使用备用方法:', error);
                    this.extractCorrectAnswersBackup();
                }
            } else {
                console.warn('[PracticeEnhancer] CorrectAnswerExtractor未加载，使用备用方法');
                this.extractCorrectAnswersBackup();
            }

            // 延迟提取，在页面完全加载后再次尝试
            setTimeout(function () {
                this.extractFromResultsTable();
            }.bind(this), 2000);

            // 定期检查是否有新的正确答案数据
            this.startCorrectAnswerMonitoring();
        },

        /**
         * 多套题模式：提取所有套题的正确答案
         */
        extractMultiSuiteCorrectAnswers: function () {
            console.log('[PracticeEnhancer] 开始提取多套题正确答案');

            // 查找所有套题容器
            let suiteContainers = document.querySelectorAll('[data-suite-id]');

            if (suiteContainers.length === 0) {
                suiteContainers = document.querySelectorAll('.test-page');
            }

            if (suiteContainers.length === 0) {
                suiteContainers = document.querySelectorAll('.suite-container');
            }

            console.log('[PracticeEnhancer] 找到套题容器数量:', suiteContainers.length);

            // 为每个套题提取正确答案
            suiteContainers.forEach((container, index) => {
                const suiteId = this.extractSuiteId(container);
                console.log(`[PracticeEnhancer] 提取套题 ${index + 1}/${suiteContainers.length} 正确答案, ID: ${suiteId}`);

                if (suiteId) {
                    this.extractSuiteCorrectAnswers(suiteId, container);
                }
            });

            console.log('[PracticeEnhancer] 多套题正确答案提取完成:', this.correctAnswers);
        },

        /**
         * 提取单个套题的正确答案
         * @param {string} suiteId - 套题ID
         * @param {HTMLElement} suiteContainer - 套题容器元素（可选）
         */
        extractSuiteCorrectAnswers: function (suiteId, suiteContainer) {
            if (!suiteId) {
                console.warn('[PracticeEnhancer] extractSuiteCorrectAnswers: 套题ID为空');
                return;
            }

            // 如果没有提供容器，尝试获取
            if (!suiteContainer) {
                suiteContainer = this.getSuiteContainer(suiteId);
            }

            if (!suiteContainer) {
                console.warn(`[PracticeEnhancer] extractSuiteCorrectAnswers: 未找到套题容器 ${suiteId}`);
                return;
            }

            console.log(`[PracticeEnhancer] 提取套题 ${suiteId} 的正确答案`);

            // 方法1: 从套题容器内的全局变量提取（如果页面使用了独立的答案对象）
            // 注意：100 P1/P4的HTML可能在App对象中存储答案
            if (window.App && window.App.answerKey) {
                console.log('[PracticeEnhancer] 从App.answerKey提取答案');
                this.extractFromAppAnswerKey(suiteId);
            }

            // 方法2: 从套题容器内的data属性提取
            this.extractSuiteAnswersFromDOM(suiteId, suiteContainer);

            // 方法3: 从套题的结果表格提取（如果已经显示结果）
            this.extractSuiteAnswersFromResultsTable(suiteId, suiteContainer);

            // 方法4: 保留结果表/答案对象兜底，已移除听力原文抽取路径
        },

        /**
         * 从App.answerKey提取答案（针对100 P1/P4的HTML结构）
         * @param {string} suiteId - 套题ID
         */
        extractFromAppAnswerKey: function (suiteId) {
            if (!window.App || !window.App.answerKey) {
                return;
            }

            const answerKey = window.App.answerKey;

            // 从suiteId提取测试编号（如"set1" -> "1"）
            let testNum = null;
            if (suiteId.startsWith('set')) {
                testNum = suiteId.replace('set', '');
            } else if (suiteId.startsWith('page-test')) {
                testNum = suiteId.replace('page-test', '');
            }

            if (!testNum) {
                console.warn('[PracticeEnhancer] 无法从suiteId提取测试编号:', suiteId);
                return;
            }

            // 查找对应测试的答案（answerKey可能是对象或数组）
            let testAnswers = null;

            if (Array.isArray(answerKey)) {
                // 如果是数组，按索引查找
                const index = parseInt(testNum) - 1;
                if (index >= 0 && index < answerKey.length) {
                    testAnswers = answerKey[index];
                }
            } else if (typeof answerKey === 'object') {
                // 如果是对象，尝试多种键名
                testAnswers = answerKey[`test${testNum}`] ||
                    answerKey[`t${testNum}`] ||
                    answerKey[testNum];

                // 兼容 V2 资源页：answerKey 为扁平映射（如 { t1_q1: 'xxx', ... }）
                if (!testAnswers) {
                    const pattern = new RegExp(`^t${testNum}[_-]`, 'i');
                    const filtered = {};
                    Object.entries(answerKey).forEach(([key, value]) => {
                        if (!key) {
                            return;
                        }
                        const normalizedKey = String(key).trim();
                        if (pattern.test(normalizedKey)) {
                            filtered[normalizedKey] = value;
                        }
                    });
                    if (Object.keys(filtered).length > 0) {
                        testAnswers = filtered;
                    }
                }
            }

            if (!testAnswers) {
                console.warn(`[PracticeEnhancer] 未找到测试 ${testNum} 的答案`);
                return;
            }

            // 将答案添加到correctAnswers，带套题前缀
            for (const [key, value] of Object.entries(testAnswers)) {
                const prefixedKey = `${suiteId}::${key}`;
                this.addCorrectAnswer(prefixedKey, value);
                console.log(`[PracticeEnhancer] 添加正确答案: ${prefixedKey} = ${value}`);
            }
        },

        /**
         * 从套题容器的DOM中提取正确答案
         * @param {string} suiteId - 套题ID
         * @param {HTMLElement} suiteContainer - 套题容器
         */
        extractSuiteAnswersFromDOM: function (suiteId, suiteContainer) {
            const selectors = [
                '[data-correct-answer]',
                '.correct-answer',
                '.answer-key',
                '[data-answer]'
            ];

            for (const selector of selectors) {
                const elements = suiteContainer.querySelectorAll(selector);
                elements.forEach(element => {
                    const questionId = element.dataset.question ||
                        element.dataset.for ||
                        element.dataset.questionId ||
                        element.id;
                    const correctAnswer = element.dataset.correctAnswer ||
                        element.dataset.answer ||
                        element.textContent.trim();

                    if (questionId && correctAnswer) {
                        const prefixedKey = `${suiteId}::${questionId}`;
                        this.addCorrectAnswer(prefixedKey, correctAnswer);
                    }
                });
            }
        },

        /**
         * 从套题的结果表格中提取正确答案
         * @param {string} suiteId - 套题ID
         * @param {HTMLElement} suiteContainer - 套题容器
         */
        extractSuiteAnswersFromResultsTable: function (suiteId, suiteContainer) {
            // 查找结果表格
            const tables = suiteContainer.querySelectorAll('table.results-table, .results-in-page table');

            tables.forEach(table => {
                const rows = table.querySelectorAll('tr');

                for (let i = 1; i < rows.length; i++) { // 跳过表头
                    const row = rows[i];
                    const cells = row.querySelectorAll('td');

                    if (cells.length >= 3) {
                        const questionText = cells[0].textContent.trim();
                        const correctAnswer = cells[2].textContent.trim();

                        // 提取问题编号
                        const questionMatch = questionText.match(/(\d+)/);
                        if (questionMatch && correctAnswer && correctAnswer !== 'N/A' && correctAnswer !== '') {
                            const questionNum = questionMatch[1];
                            const questionKey = 'q' + questionNum;
                            const prefixedKey = `${suiteId}::${questionKey}`;
                            this.addCorrectAnswer(prefixedKey, correctAnswer);
                        }
                    }
                }
            });
        },

        extractCorrectAnswersBackup: function () {
            // 多种备用提取方法
            const sources = ['answers', 'correctAnswers', 'answerKey', 'solutions'];

            for (const source of sources) {
                if (window[source] && typeof window[source] === 'object') {
                    Object.keys(window[source]).forEach(key => {
                        const value = window[source][key];
                        if (value !== undefined && value !== null) {
                            let normalizedKey = key;
                            if (!normalizedKey.startsWith('q') && /^\d+$/.test(normalizedKey)) {
                                normalizedKey = 'q' + normalizedKey;
                            }
                            this.addCorrectAnswer(normalizedKey, value);
                        }
                    });
                }
            }

            // 尝试从DOM中提取
            this.extractFromDOM();

            console.log('[PracticeEnhancer] 备用方法提取正确答案:', this.correctAnswers);
        },

        extractFromDOM: function () {
            // 查找包含正确答案的元素
            const selectors = [
                '[data-correct-answer]',
                '.correct-answer',
                '.answer-key',
                '[data-answer]'
            ];

            const self = this;
            for (let i = 0; i < selectors.length; i++) {
                const selector = selectors[i];
                const elements = document.querySelectorAll(selector);
                for (let j = 0; j < elements.length; j++) {
                    const element = elements[j];
                    const questionId =
                        element.dataset.question ||
                        element.dataset.for ||
                        element.dataset.questionId ||
                        this.extractQuestionId(element) ||
                        element.id;
                    const correctAnswer = element.dataset.correctAnswer ||
                        element.dataset.answer ||
                        element.textContent.trim();

                    if (questionId && correctAnswer) {
                        self.addCorrectAnswer(questionId, correctAnswer);
                    }
                }
            }

        },

        extractFromResultsTable: function () {
            console.log('[PracticeEnhancer] 尝试从结果表格提取正确答案');
            const beforeCount = Object.keys(this.correctAnswers).length;

            // 查找结果显示区域
            const resultsEl = document.getElementById('results');
            if (!resultsEl) {
                console.log('[PracticeEnhancer] 未找到results元素');
                return;
            }

            // 查找表格
            const tables = resultsEl.querySelectorAll('table');
            console.log('[PracticeEnhancer] 找到表格数量:', tables.length);

            for (let i = 0; i < tables.length; i++) {
                const table = tables[i];
                const rows = table.querySelectorAll('tr');
                console.log('[PracticeEnhancer] 表格', i, '行数:', rows.length);

                for (let j = 1; j < rows.length; j++) { // 跳过表头
                    const row = rows[j];
                    const cells = row.querySelectorAll('td');

                    if (cells.length >= 3) {
                        const questionCell = cells[0];
                        const userAnswerCell = cells[1];
                        const correctAnswerCell = cells[2];

                        const questionText = questionCell.textContent.trim();
                        const userAnswer = userAnswerCell.textContent.trim();
                        const correctAnswer = correctAnswerCell.textContent.trim();

                        console.log('[PracticeEnhancer] 处理行:', questionText, userAnswer, correctAnswer);

                        // 提取问题编号
                        const questionMatch = questionText.match(/(\d+)/);
                        if (questionMatch && correctAnswer && correctAnswer !== 'N/A' && correctAnswer !== '') {
                            const questionNum = questionMatch[1];
                            const questionKey = 'q' + questionNum;
                            const normalizedKey = this.addCorrectAnswer(questionKey, correctAnswer) || questionKey;

                            // 同时更新用户答案，确保数据一致性
                            if (userAnswer && userAnswer !== 'No Answer') {
                                this.addAnswer(normalizedKey, userAnswer);
                            }

                            console.log('[PracticeEnhancer] 从表格提取:', normalizedKey, '用户答案:', userAnswer, '正确答案:', correctAnswer);
                        }
                    }
                }
            }

            console.log('[PracticeEnhancer] 表格提取完成，正确答案:', this.correctAnswers);
            console.log('[PracticeEnhancer] 表格提取完成，用户答案:', this.answers);
            const afterCount = Object.keys(this.correctAnswers).length;
            if (afterCount > beforeCount) {
                this.broadcastResultsUpdate();
            }
            return afterCount > beforeCount;
        },

        setupAnswerListeners: function () {
            const self = this;

            // 增强的change事件监听
            document.addEventListener('change', function (e) {
                if (!self.isExcludedControl(e.target)) {
                    self.recordAnswer(e.target);
                }
            });

            // 增强的input事件监听
            document.addEventListener('input', function (e) {
                if (!self.isExcludedControl(e.target)) {
                    self.recordAnswer(e.target);
                }
            });

            // 点击事件监听（用于单选框、复选框）
            document.addEventListener('click', function (e) {
                if (e.target.type === 'radio' || e.target.type === 'checkbox') {
                    if (!self.isExcludedControl(e.target)) {
                        setTimeout(() => self.recordAnswer(e.target), 10);
                    }
                }
            });

            // 拖拽事件监听
            document.addEventListener('drop', function (e) {
                setTimeout(function () {
                    self.collectAllAnswers(); // 全面收集一次（多套题/单套题内部会自行处理拖拽答案）
                }, 100);
            });

            // 页面可见性变化时收集答案（替代定期收集）
            document.addEventListener('visibilitychange', function () {
                if (document.hidden) {
                    console.log('[PracticeEnhancer] 页面隐藏，收集答案');
                    self.collectAllAnswers();
                } else {
                    console.log('[PracticeEnhancer] 页面显示，准备收集答案');
                }
            });

            // 页面卸载前收集答案和清理
            window.addEventListener('beforeunload', function () {
                console.log('[PracticeEnhancer] 页面卸载，收集答案并清理');
                self.collectAllAnswers();
                self.cleanup();
            });

            // 页面失去焦点时收集答案
            window.addEventListener('blur', function () {
                console.log('[PracticeEnhancer] 页面失去焦点，收集答案');
                self.collectAllAnswers();
            });

            console.log('[PracticeEnhancer] 增强答案监听器设置完成');
        },

        // 判断是否为应当排除的非答题控件（如播放速度、音量滑条等）
        isExcludedControl: function (element) {
            if (!element) return false;
            const config = this.config || {};

            try {
                const datasetFlag = config.datasetExcludeAttribute || 'enhancerExclude';
                if (element.dataset && (element.dataset[datasetFlag] === 'true' || element.dataset[datasetFlag] === '1')) {
                    return true;
                }

                if (element.dataset && element.dataset.practiceExclude === 'true') {
                    return true;
                }

                const excludedNames = config.excludedNames || [];
                if (excludedNames.length) {
                    if ((element.name && excludedNames.includes(element.name)) ||
                        (element.id && excludedNames.includes(element.id))) {
                        return true;
                    }
                }

                const selectors = config.excludedSelectors || [];
                for (let i = 0; i < selectors.length; i++) {
                    const selector = selectors[i];
                    if (element.matches && element.matches(selector)) {
                        return true;
                    }
                }

                const ancestorSelectors = config.excludedAncestors || [];
                for (let i = 0; i < ancestorSelectors.length; i++) {
                    const selector = ancestorSelectors[i];
                    if (element.closest && element.closest(selector)) {
                        return true;
                    }
                }
            } catch (error) {
                console.warn('[PracticeEnhancer] 判断是否排除控件失败:', error);
            }

            return false;
        },

        recordAnswer: function (element) {
            if (!element || this.isExcludedControl(element)) return;

            this.ensureMultiSuiteMode();

            const questionId = this.getQuestionId(element);
            if (!questionId) {
                return;
            }

            const value = this.getInputValue(element);
            const hasValue = Array.isArray(value) ? value.length > 0 : (value !== null && value !== undefined && value !== '');
            if (!hasValue) {
                return;
            }

            let scopedQuestionId = questionId;
            if (this.isMultiSuite) {
                const suiteId = this.extractSuiteId(element);
                if (!suiteId) {
                    return;
                }
                scopedQuestionId = `${suiteId}::${questionId}`;
            }

            const normalizedId = this.addAnswer(scopedQuestionId, value);
            if (!normalizedId) return;
            console.log('[PracticeEnhancer] 记录答案:', normalizedId, '=', value);

            this.interactions.push({
                type: 'answer',
                questionId: normalizedId,
                value: value,
                timestamp: Date.now(),
                elementType: element.type || element.tagName.toLowerCase()
            });
        },

        collectDropzoneAnswers: function () {
            // 收集拖拽填空题答案
            const dropzones = document.querySelectorAll('.dropzone');
            for (let i = 0; i < dropzones.length; i++) {
                const zone = dropzones[i];
                const qName = zone.dataset.target;
                const card = zone.querySelector('.card');
                if (qName && card) {
                    this.addAnswer(qName, card.dataset.value || card.textContent.trim());
                }
            }

            // 收集段落匹配题答案
            const paragraphZones = document.querySelectorAll('.paragraph-dropzone');
            for (let i = 0; i < paragraphZones.length; i++) {
                const zone = paragraphZones[i];
                const paragraph = zone.dataset.paragraph;
                const items = zone.querySelectorAll('.drag-item');
                if (paragraph && items.length > 0) {
                    const itemTexts = [];
                    for (let j = 0; j < items.length; j++) {
                        const item = items[j];
                        itemTexts.push(item.dataset.heading || item.textContent.trim());
                    }
                    this.addAnswer('q' + paragraph.toLowerCase(), itemTexts.join(','));
                }
            }

            // 收集匹配题答案
            const matchZones = document.querySelectorAll('.match-dropzone');
            for (let i = 0; i < matchZones.length; i++) {
                const zone = matchZones[i];
                const qName = zone.dataset.question;
                const item = zone.querySelector('.drag-item') || zone.querySelector('.drag-item-clone');
                if (qName && item) {
                    const answerValue = item.dataset.option || item.dataset.country || item.dataset.heading || item.textContent.trim();
                    this.addAnswer(qName, answerValue);
                }
            }
        },

        interceptSubmit: function () {
            // 延迟拦截，确保页面完全加载
            setTimeout(function () {
                // 拦截gradeAnswers函数
                if (typeof window.gradeAnswers === 'function') {
                    const originalGradeAnswers = window.gradeAnswers;
                    const self = this;
                    window.gradeAnswers = function () {
                        console.log('[PracticeEnhancer] 拦截到gradeAnswers调用');

                        // 多套题模式：提取当前套题ID
                        if (self.isMultiSuite) {
                            const activePage = document.querySelector('.test-page.active');
                            const suiteId = self.extractSuiteId(activePage);
                            if (suiteId) {
                                self.handleSuiteSubmit(suiteId);
                                return;
                            }
                        }

                        // 单套题模式：使用原有逻辑
                        self.collectAllAnswers();
                        const result = originalGradeAnswers();
                        self.handleSubmit();
                        return result;
                    };
                    console.log('[PracticeEnhancer] gradeAnswers函数拦截成功');
                } else {
                    console.warn('[PracticeEnhancer] 未找到gradeAnswers函数');
                }

                // 拦截grade函数
                if (typeof window.grade === 'function') {
                    const originalGrade = window.grade;
                    const self = this;
                    window.grade = function () {
                        console.log('[PracticeEnhancer] 拦截到grade调用');

                        // 多套题模式：提取当前套题ID
                        if (self.isMultiSuite) {
                            const activePage = document.querySelector('.test-page.active');
                            const suiteId = self.extractSuiteId(activePage);
                            if (suiteId) {
                                self.handleSuiteSubmit(suiteId);
                                return;
                            }
                        }

                        // 单套题模式：使用原有逻辑
                        self.collectAllAnswers();
                        const result = originalGrade();
                        self.handleSubmit();
                        return result;
                    };
                    console.log('[PracticeEnhancer] grade函数拦截成功');
                }
            }.bind(this), 1000);

            // 监听表单提交
            document.addEventListener('submit', (e) => {
                console.log('[PracticeEnhancer] 拦截到表单提交');

                // 多套题模式：提取当前套题ID
                if (this.isMultiSuite) {
                    const form = e.target;
                    const suiteId = this.extractSuiteId(form);
                    if (suiteId) {
                        e.preventDefault();
                        this.handleSuiteSubmit(suiteId);
                        return;
                    }
                }

                // 单套题模式
                this.collectAllAnswers();
                this.handleSubmit();
            });

            // 监听提交按钮点击 - 增强版
            const self = this;
            document.addEventListener('click', function (e) {
                const target = e.target;

                // 检查是否为提交按钮
                const isSubmitButton = target.tagName === 'BUTTON' &&
                    (target.textContent.includes('Submit') ||
                        target.textContent.includes('提交') ||
                        target.textContent.includes('完成') ||
                        target.textContent.includes('Check') ||
                        target.classList.contains('primary') ||
                        target.id === 'submit-btn' ||
                        target.dataset.submitSuite || // 新增：支持data-submit-suite属性
                        (target.onclick && target.onclick.toString().includes('grade')));

                if (!isSubmitButton) {
                    return;
                }

                console.log('[PracticeEnhancer] 检测到提交按钮点击:', target);

                // 多套题模式：提取套题ID
                if (self.isMultiSuite) {
                    // 优先从按钮的data-submit-suite属性读取
                    let suiteId = target.dataset.submitSuite;

                    // 如果没有，从按钮所在的套题容器提取
                    if (!suiteId) {
                        suiteId = self.extractSuiteId(target);
                    }

                    // 如果还是没有，从当前激活的页面提取
                    if (!suiteId) {
                        const activePage = document.querySelector('.test-page.active');
                        suiteId = self.extractSuiteId(activePage);
                    }

                    if (suiteId) {
                        console.log('[PracticeEnhancer] 提交套题:', suiteId);
                        self.handleSuiteSubmit(suiteId);
                        return;
                    }
                }

                // 单套题模式
                self.collectAllAnswers();
                self.handleSubmit();
            });

            // 兼容独立套题页：挂钩其内部提交函数（例如 App.finishSuite），避免漏报套题完成
            this.ensureExternalSuiteHooks();

            // 定期检查结果是否出现
            this.startResultsMonitoring();

            console.log('[PracticeEnhancer] 提交拦截设置完成');
        },

        /**
         * 为独立套题资源页安装提交钩子（例如 App.finishSuite）。
         * 目标：不改资源页逻辑也能逐套发送 PRACTICE_COMPLETE。
         */
        ensureExternalSuiteHooks: function () {
            const enhancer = this;
            const attemptHook = () => {
                if (!enhancer.isMultiSuite) {
                    enhancer.isMultiSuite = enhancer.detectMultiSuiteStructure();
                }
                if (!enhancer.isMultiSuite) {
                    return false;
                }

                const app = window.App;
                if (!app || typeof app.finishSuite !== 'function') {
                    return false;
                }
                if (app.finishSuite && app.finishSuite.__practiceEnhancerWrapped) {
                    return true;
                }

                const originalFinishSuite = app.finishSuite;
                const wrappedFinishSuite = function (suiteId) {
                    const result = originalFinishSuite.apply(this, arguments);
                    try {
                        enhancer.handleSuiteSubmit(suiteId);
                    } catch (error) {
                        console.warn('[PracticeEnhancer] App.finishSuite 钩子执行失败:', error);
                    }
                    return result;
                };

                wrappedFinishSuite.__practiceEnhancerWrapped = true;
                wrappedFinishSuite.__practiceEnhancerOriginal = originalFinishSuite;
                app.finishSuite = wrappedFinishSuite;

                console.log('[PracticeEnhancer] 已挂钩 App.finishSuite');
                return true;
            };

            if (attemptHook()) {
                return;
            }

            let tries = 0;
            const maxTries = 10;
            const retry = () => {
                tries += 1;
                if (attemptHook() || tries >= maxTries) {
                    return;
                }
                setTimeout(retry, 300);
            };
            setTimeout(retry, 300);
        },

        /**
         * 处理单个套题的提交
         * @param {string} suiteId - 套题ID
         */
        handleSuiteSubmit: function (suiteId) {
            if (!suiteId) {
                console.warn('[PracticeEnhancer] handleSuiteSubmit: 套题ID为空');
                return;
            }

            // 检查是否正在提交
            if (this.isSubmitting) {
                console.warn('[PracticeEnhancer] 正在提交中，阻止并发提交');
                return;
            }

            // 检查该套题是否已提交
            if (this.submittedSuites.has(suiteId)) {
                console.warn(`[PracticeEnhancer] 套题 ${suiteId} 已经提交过，阻止重复提交`);
                return;
            }

            console.log(`[PracticeEnhancer] 开始处理套题提交: ${suiteId}`);

            // 设置提交状态
            this.isSubmitting = true;
            this.currentSuiteId = suiteId;

            try {
                // 1. 收集该套题的答案
                const suiteContainer = this.getSuiteContainer(suiteId);
                if (!suiteContainer) {
                    console.error(`[PracticeEnhancer] 未找到套题容器: ${suiteId}`);
                    return;
                }

                this.collectSuiteAnswers(suiteContainer, suiteId);

                // 2. 提取该套题的正确答案
                this.extractSuiteCorrectAnswers(suiteId, suiteContainer);

                // 3. 生成答案比较
                const comparison = this.generateSuiteAnswerComparison(suiteId);

                // 4. 计算分数
                const scoreInfo = this.calculateSuiteScore(comparison);

                // 5. 检测拼写错误（如果需要）
                const spellingErrors = this.detectSuiteSpellingErrors(comparison, suiteId);

                // 6. 构建并发送消息
                this.sendSuiteCompleteMessage(suiteId, comparison, scoreInfo, spellingErrors);

                // 7. 标记该套题已提交
                this.submittedSuites.add(suiteId);

                console.log(`[PracticeEnhancer] 套题 ${suiteId} 提交完成`);

            } catch (error) {
                console.error(`[PracticeEnhancer] 套题 ${suiteId} 提交失败:`, error);
            } finally {
                // 重置提交状态
                this.isSubmitting = false;
                this.currentSuiteId = null;
            }
        },

        /**
         * 获取套题容器元素
         * @param {string} suiteId - 套题ID
         * @returns {HTMLElement|null} 套题容器元素
         */
        getSuiteContainer: function (suiteId) {
            // 方法1: 通过data-suite-id查找
            let container = document.querySelector(`[data-suite-id="${suiteId}"]`);
            if (container) return container;

            // 方法2: 通过ID查找（如果suiteId是"set1"，查找"page-test1"）
            if (suiteId.startsWith('set')) {
                const pageNum = suiteId.replace('set', '');
                container = document.getElementById(`page-test${pageNum}`);
                if (container) return container;
            }

            // 方法3: 直接通过ID查找
            container = document.getElementById(suiteId);
            if (container) return container;

            // 方法4: 查找当前激活的test-page
            container = document.querySelector('.test-page.active');
            if (container) {
                const extractedId = this.extractSuiteId(container);
                if (extractedId === suiteId) {
                    return container;
                }
            }

            return null;
        },

        /**
         * 生成套题的答案比较
         * @param {string} suiteId - 套题ID
         * @returns {Object} 答案比较对象
         */
        generateSuiteAnswerComparison: function (suiteId) {
            const comparison = {};
            const prefix = `${suiteId}::`;

            const questionIds = new Set();
            const collectSuiteKeys = (source) => {
                if (!source || typeof source !== 'object') {
                    return;
                }
                Object.keys(source).forEach((key) => {
                    if (!key || !key.startsWith(prefix)) {
                        return;
                    }
                    const questionId = key.substring(prefix.length);
                    if (questionId) {
                        questionIds.add(questionId);
                    }
                });
            };

            collectSuiteKeys(this.answers);
            collectSuiteKeys(this.correctAnswers);

            questionIds.forEach((questionId) => {
                const prefixedKey = `${suiteId}::${questionId}`;
                const userAnswer = this.answers[prefixedKey] ?? null;
                const correctAnswer = this.correctAnswers[prefixedKey] ?? null;

                comparison[questionId] = {
                    userAnswer,
                    correctAnswer,
                    isCorrect: this.compareAnswers(userAnswer, correctAnswer)
                };
            });

            return comparison;
        },

        /**
         * 计算套题分数
         * @param {Object} comparison - 答案比较对象
         * @returns {Object} 分数信息
         */
        calculateSuiteScore: function (comparison) {
            let correct = 0;
            let total = 0;

            for (const [questionId, comp] of Object.entries(comparison)) {
                total++;
                if (comp.isCorrect) {
                    correct++;
                }
            }

            const accuracy = total > 0 ? (correct / total) : 0;
            const percentage = Math.round(accuracy * 100);

            return {
                correct: correct,
                total: total,
                accuracy: accuracy,
                percentage: percentage
            };
        },

        /**
         * 检测套题中的拼写错误
         * 集成SpellingErrorCollector进行错误检测
         * @param {Object} comparison - 答案比较对象
         * @param {string} suiteId - 套题ID
         * @returns {Array} 拼写错误数组
         */
        detectSuiteSpellingErrors: function (comparison, suiteId) {
            console.log('[PracticeEnhancer] 开始检测套题拼写错误:', suiteId);

            // 检查SpellingErrorCollector是否可用
            if (!window.spellingErrorCollector) {
                console.warn('[PracticeEnhancer] SpellingErrorCollector未初始化，跳过拼写错误检测');
                return [];
            }

            // 检查输入参数
            if (!comparison || typeof comparison !== 'object') {
                console.warn('[PracticeEnhancer] 无效的答案比较对象');
                return [];
            }

            try {
                // 调用SpellingErrorCollector的detectErrors方法
                // 参数: (answerComparison, suiteId, examId)
                const examId = this.examId || 'unknown';
                const errors = window.spellingErrorCollector.detectErrors(
                    comparison,
                    suiteId,
                    examId
                );

                console.log(`[PracticeEnhancer] 检测到 ${errors.length} 个拼写错误`);

                // 返回错误数组
                return errors || [];

            } catch (error) {
                console.error('[PracticeEnhancer] 拼写错误检测失败:', error);
                // 发生错误时返回空数组，不影响主流程
                return [];
            }
        },

        /**
         * 发送套题完成消息
         * 消息格式符合Requirements 9.1-9.7的标准
         * @param {string} suiteId - 套题ID
         * @param {Object} comparison - 答案比较对象
         * @param {Object} scoreInfo - 分数信息
         * @param {Array} spellingErrors - 拼写错误数组
         */
        sendSuiteCompleteMessage: function (suiteId, comparison, scoreInfo, spellingErrors) {
            const prefix = `${suiteId}::`;

            // 提取该套题的答案（子页面内为套题作用域，消息内使用不带前缀的问题ID）
            const suiteAnswers = {};
            const suiteCorrectAnswers = {};

            for (const [key, value] of Object.entries(this.answers)) {
                if (key.startsWith(prefix)) {
                    const questionId = key.substring(prefix.length);
                    if (questionId) {
                        suiteAnswers[questionId] = value;
                    }
                }
            }

            for (const [key, value] of Object.entries(this.correctAnswers)) {
                if (key.startsWith(prefix)) {
                    const questionId = key.substring(prefix.length);
                    if (questionId) {
                        suiteCorrectAnswers[questionId] = value;
                    }
                }
            }

            // 构建标准化消息格式
            // 符合Requirements 9.1-9.7
            const message = {
                // Requirement 9.1: 必须包含的基本字段
                examId: `${this.examId}_${suiteId}`,  // Requirement 9.2: examId包含套题标识
                sessionId: this.sessionId,
                answers: suiteAnswers,                 // Requirement 9.3: 答案键使用"套题ID::问题ID"格式
                correctAnswers: suiteCorrectAnswers,

                // Requirement 9.4: scoreInfo包含必需字段
                scoreInfo: {
                    correct: scoreInfo.correct,
                    total: scoreInfo.total,
                    accuracy: scoreInfo.accuracy,
                    percentage: scoreInfo.percentage
                },

                // Requirement 9.5: answerComparison包含每个问题的详细信息
                answerComparison: comparison,

                // Requirement 9.6, 9.7: spellingErrors数组
                spellingErrors: spellingErrors || [],

                // 额外字段
                suiteId: suiteId,
                timestamp: Date.now(),
                startTime: this.startTime,
                endTime: Date.now(),
                duration: this.startTime ? Math.round((Date.now() - this.startTime) / 1000) : 0,
                pageType: this.detectPageType(),
                url: window.location.href,
                title: document.title
            };

            this.runHooks('afterSuiteMessageBuilt', message, suiteId);
            console.log('[PracticeEnhancer] 发送套题完成消息（标准格式）:', message);
            this.sendMessage('PRACTICE_COMPLETE', message);
        },

        startCorrectAnswerMonitoring: function () {
            let checkCount = 0;
            const maxChecks = 30;
            const self = this;

            function checkForCorrectAnswers() {
                checkCount++;

                // 尝试从结果表格提取
                const resultsEl = document.getElementById('results');
                if (resultsEl && resultsEl.style.display !== 'none') {
                    const tables = resultsEl.querySelectorAll('table');
                    if (tables.length > 0) {
                        const firstTable = tables[0];
                        const rows = firstTable.querySelectorAll('tr');
                        if (rows.length > 1) { // 有数据行
                            console.log('[PracticeEnhancer] 检测到结果表格，提取正确答案');
                            self.extractFromResultsTable();
                        }
                    }
                }

                // 继续检查直到达到最大次数
                if (checkCount < maxChecks && Object.keys(self.correctAnswers).length === 0) {
                    setTimeout(checkForCorrectAnswers, 1000);
                }
            }

            setTimeout(checkForCorrectAnswers, 3000);
        },

        startResultsMonitoring: function () {
            let checkCount = 0;
            const maxChecks = 60;
            const self = this;

            function checkResults() {
                checkCount++;
                const resultsEl = document.getElementById('results');

                if (resultsEl && resultsEl.style.display !== 'none' && resultsEl.textContent.includes('Final Score')) {
                    console.log('[PracticeEnhancer] 检测到结果显示，自动提取分数');
                    self.collectAllAnswers();
                    // 不需要额外延迟，handleSubmit内部已经有延迟处理
                    self.handleSubmit();
                    return;
                }

                if (checkCount < maxChecks) {
                    setTimeout(checkResults, 500);
                }
            }

            setTimeout(checkResults, 2000);
        },

        collectAllAnswers: function () {
            console.log('[PracticeEnhancer] 开始全面收集答案...');
            this.captureQuestionSet();

            // 如果是多套题模式，按套题分组收集
            this.ensureMultiSuiteMode();
            if (this.isMultiSuite) {
                console.log('[PracticeEnhancer] 多套题模式：按套题分组收集答案');
                this.collectMultiSuiteAnswers();
                return;
            }

            // 单套题模式：使用原有逻辑
            const beforeCount = Object.keys(this.answers).length;

            // 1. 收集所有输入元素（更广泛的选择器），同时过滤非答题控件
            const allInputs = Array.from(document.querySelectorAll('input, textarea, select'))
                .filter(el => !this.isExcludedControl(el));
            console.log('[PracticeEnhancer] 找到输入元素总数:', allInputs.length);

            const processedGroups = {
                checkbox: new Set(),
                radio: new Set()
            };

            allInputs.forEach((input, index) => {
                const questionId = this.getQuestionId(input);
                if (!questionId) {
                    return;
                }

                if (input.type === 'checkbox') {
                    const groupKey = `${questionId}::checkbox::${input.name || input.id || index}`;
                    if (processedGroups.checkbox.has(groupKey)) {
                        return;
                    }
                    processedGroups.checkbox.add(groupKey);
                } else if (input.type === 'radio') {
                    const groupKey = `${questionId}::radio::${input.name || input.id || index}`;
                    if (processedGroups.radio.has(groupKey)) {
                        return;
                    }
                    processedGroups.radio.add(groupKey);
                }

                const value = this.getInputValue(input);

                if (input.type === 'text') {
                    console.log(`[DEBUG] Text Input Found: id='${input.id}', name='${input.name}', derived_questionId='${questionId}', value='${value}'`);
                }

                console.log(`[PracticeEnhancer] 输入元素 ${index}: type=${input.type}, name=${input.name}, id=${input.id}, value=${value}, questionId=${questionId}`);

                const hasValue = Array.isArray(value) ? value.length > 0 : (value !== null && value !== undefined && value !== '');
                if (hasValue) {
                    const normalizedId = this.addAnswer(questionId, value);
                    if (normalizedId) {
                        console.log(`[PracticeEnhancer] 记录答案: ${normalizedId} = ${value}`);
                    }
                }
            });

            // 2. 收集拖拽答案
            this.collectDropzoneAnswers();

            // 3. 收集特殊格式的答案（通过data属性）
            const answerElements = document.querySelectorAll('[data-user-answer], [data-value]');
            console.log('[PracticeEnhancer] 找到data答案元素:', answerElements.length);

            answerElements.forEach(element => {
                const questionId = element.dataset.question || element.dataset.for || element.id;
                const answer = element.dataset.answer || element.dataset.userAnswer || element.dataset.value;
                if (questionId && answer) {
                    const normalizedId = this.addAnswer(questionId, answer);
                    if (normalizedId) {
                        console.log(`[PracticeEnhancer] 记录data答案: ${normalizedId} = ${answer}`);
                    }
                }
            });

            // 4. 收集匹配题答案
            this.collectMatchingAnswers();

            // 5. 收集排序题答案
            this.collectOrderingAnswers();

            // 6. 尝试从页面特定结构收集答案
            this.collectFromPageStructure();

            // 7. 运行自定义收集器
            this.runCustomCollectors();

            const afterCount = Object.keys(this.answers).length;
            console.log(`[PracticeEnhancer] 全面收集完成，答案数量从 ${beforeCount} 增加到 ${afterCount}`);
            console.log('[PracticeEnhancer] 收集到的所有答案:', this.answers);
        },

        /**
         * 多套题模式：收集所有套题的答案
         */
        collectMultiSuiteAnswers: function () {
            console.log('[PracticeEnhancer] 开始收集多套题答案');

            // 查找所有套题容器
            let suiteContainers = document.querySelectorAll('[data-suite-id]');

            // 如果没有data-suite-id，尝试查找.test-page元素
            if (suiteContainers.length === 0) {
                suiteContainers = document.querySelectorAll('.test-page');
            }

            // 如果还是没有，尝试查找.suite-container元素
            if (suiteContainers.length === 0) {
                suiteContainers = document.querySelectorAll('.suite-container');
            }

            console.log('[PracticeEnhancer] 找到套题容器数量:', suiteContainers.length);

            if (suiteContainers.length === 0) {
                console.warn('[PracticeEnhancer] 未找到套题容器，回退到单套题模式');
                this.isMultiSuite = false;
                return;
            }

            // 为每个套题收集答案
            suiteContainers.forEach((container, index) => {
                const suiteId = this.extractSuiteId(container);
                console.log(`[PracticeEnhancer] 收集套题 ${index + 1}/${suiteContainers.length}, ID: ${suiteId}`);

                if (suiteId) {
                    this.collectSuiteAnswers(container, suiteId);
                }
            });

            console.log('[PracticeEnhancer] 多套题答案收集完成:', this.answers);
        },

        /**
         * 收集单个套题的答案
         * @param {HTMLElement} suiteContainer - 套题容器元素
         * @param {string} suiteId - 套题ID（可选，如果不提供则自动提取）
         */
        collectSuiteAnswers: function (suiteContainer, suiteId) {
            if (!suiteContainer) {
                console.warn('[PracticeEnhancer] collectSuiteAnswers: 套题容器为空');
                return;
            }

            // 如果没有提供suiteId，尝试提取
            if (!suiteId) {
                suiteId = this.extractSuiteId(suiteContainer);
            }

            if (!suiteId) {
                console.warn('[PracticeEnhancer] collectSuiteAnswers: 无法提取套题ID');
                return;
            }

            console.log(`[PracticeEnhancer] 收集套题答案: ${suiteId}`);

            // 1. 收集该套题内的所有输入元素
            const inputs = Array.from(suiteContainer.querySelectorAll('input, textarea, select'))
                .filter(el => !this.isExcludedControl(el));

            console.log(`[PracticeEnhancer] 套题 ${suiteId} 找到输入元素:`, inputs.length);

            inputs.forEach((input) => {
                const questionId = this.getQuestionId(input);
                const value = this.getInputValue(input);

                if (questionId && value !== null && value !== '') {
                    // 为答案添加套题前缀
                    const prefixedId = `${suiteId}::${questionId}`;
                    const normalizedId = this.addAnswer(prefixedId, value);
                    if (normalizedId) {
                        console.log(`[PracticeEnhancer] 记录套题答案: ${normalizedId} = ${value}`);
                    }
                }
            });

            // 2. 收集该套题内的拖拽答案
            this.collectSuiteDropzoneAnswers(suiteContainer, suiteId);

            // 3. 收集该套题内的data属性答案
            const answerElements = suiteContainer.querySelectorAll('[data-user-answer], [data-value]');
            answerElements.forEach(element => {
                const questionId = element.dataset.question || element.dataset.for || element.id;
                const answer = element.dataset.answer || element.dataset.userAnswer || element.dataset.value;
                if (questionId && answer) {
                    const prefixedId = `${suiteId}::${questionId}`;
                    const normalizedId = this.addAnswer(prefixedId, answer);
                    if (normalizedId) {
                        console.log(`[PracticeEnhancer] 记录套题data答案: ${normalizedId} = ${answer}`);
                    }
                }
            });

            // 4. 收集该套题内的匹配题和排序题答案
            this.collectSuiteMatchingAnswers(suiteContainer, suiteId);
            this.collectSuiteOrderingAnswers(suiteContainer, suiteId);
        },

        /**
         * 收集套题内的拖拽答案
         */
        collectSuiteDropzoneAnswers: function (suiteContainer, suiteId) {
            // 收集拖拽填空题答案
            const dropzones = suiteContainer.querySelectorAll('.dropzone');
            for (let i = 0; i < dropzones.length; i++) {
                const zone = dropzones[i];
                const qName = zone.dataset.target;
                const card = zone.querySelector('.card');
                if (qName && card) {
                    const prefixedId = `${suiteId}::${qName}`;
                    this.addAnswer(prefixedId, card.dataset.value || card.textContent.trim());
                }
            }

            // 收集段落匹配题答案
            const paragraphZones = suiteContainer.querySelectorAll('.paragraph-dropzone');
            for (let i = 0; i < paragraphZones.length; i++) {
                const zone = paragraphZones[i];
                const paragraph = zone.dataset.paragraph;
                const items = zone.querySelectorAll('.drag-item');
                if (paragraph && items.length > 0) {
                    const itemTexts = [];
                    for (let j = 0; j < items.length; j++) {
                        const item = items[j];
                        itemTexts.push(item.dataset.heading || item.textContent.trim());
                    }
                    const prefixedId = `${suiteId}::q${paragraph.toLowerCase()}`;
                    this.addAnswer(prefixedId, itemTexts.join(','));
                }
            }

            // 收集匹配题答案
            const matchZones = suiteContainer.querySelectorAll('.match-dropzone');
            for (let i = 0; i < matchZones.length; i++) {
                const zone = matchZones[i];
                const qName = zone.dataset.question;
                const item = zone.querySelector('.drag-item') || zone.querySelector('.drag-item-clone');
                if (qName && item) {
                    const answerValue = item.dataset.option || item.dataset.country || item.dataset.heading || item.textContent.trim();
                    const prefixedId = `${suiteId}::${qName}`;
                    this.addAnswer(prefixedId, answerValue);
                }
            }
        },

        /**
         * 收集套题内的匹配题答案
         */
        collectSuiteMatchingAnswers: function (suiteContainer, suiteId) {
            // 实现与collectMatchingAnswers类似，但添加套题前缀
            // 这里简化处理，实际实现可以参考原有的collectMatchingAnswers方法
        },

        /**
         * 收集套题内的排序题答案
         */
        collectSuiteOrderingAnswers: function (suiteContainer, suiteId) {
            // 实现与collectOrderingAnswers类似，但添加套题前缀
            // 这里简化处理，实际实现可以参考原有的collectOrderingAnswers方法
        },

        getQuestionId: function (input) {
            if (this.isExcludedControl(input)) return null;
            const config = this.config || {};
            const attributes = config.questionIdAttributes || [];

            const tryReadAttribute = (key) => {
                if (key === 'name') {
                    return input.name || null;
                }
                if (key === 'id') {
                    return input.id ? input.id.replace(/_input$|-input$|_answer$/, '') : null;
                }
                if (key.startsWith('data-')) {
                    const dataKey = key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                    if (input.dataset && input.dataset[dataKey]) {
                        return input.dataset[dataKey];
                    }
                    return input.getAttribute(key);
                }
                if (input.dataset && input.dataset[key]) {
                    return input.dataset[key];
                }
                return input.getAttribute ? input.getAttribute(key) : null;
            };

            for (let i = 0; i < attributes.length; i++) {
                const value = tryReadAttribute(attributes[i]);
                if (value) return value;
            }

            if (input.dataset && input.dataset.question) return input.dataset.question;
            if (input.dataset && input.dataset.for) return input.dataset.for;

            let parent = input.parentElement;
            while (parent && parent !== document.body) {
                if (parent.dataset.question) return parent.dataset.question;
                if (parent.id && parent.id.includes('q')) return parent.id;
                parent = parent.parentElement;
            }

            const label = input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
            if (label && label.textContent) {
                const match = label.textContent.match(/(\d+)/);
                if (match) return 'q' + match[1];
            }

            return null;
        },

        getInputValue: function (input) {
            if (!input) return null;
            if (input.type === 'checkbox') {
                const values = this.getCheckboxGroupValues(input);
                return values.length ? values : null;
            }
            if (input.type === 'radio') {
                return this.getRadioGroupValue(input);
            }
            if (input.tagName === 'SELECT' && input.multiple) {
                const selected = Array.from(input.selectedOptions || [])
                    .map((opt) => (opt.value || opt.textContent || '').trim())
                    .filter(Boolean);
                return selected.length ? selected : null;
            }
            if (typeof input.value === 'string') {
                const trimmed = input.value.trim();
                return trimmed.length ? trimmed : null;
            }
            if (typeof input.value !== 'undefined') {
                return input.value;
            }
            const fallback = (input.textContent || '').trim();
            return fallback.length ? fallback : null;
        },

        getGroupElements: function (input, type) {
            if (!input) {
                return [];
            }
            if (!input.name) {
                return [input];
            }
            const scope = input.form || document;
            const selector = `input[type="${type}"][name="${cssEscape(input.name)}"]`;
            try {
                return Array.from(scope.querySelectorAll(selector));
            } catch (error) {
                console.warn('[PracticeEnhancer] 查询分组元素失败:', error);
                return [input];
            }
        },

        getCheckboxGroupValues: function (input) {
            const elements = this.getGroupElements(input, 'checkbox');
            const values = [];
            elements.forEach((element) => {
                if (!element || this.isExcludedControl(element) || !element.checked) {
                    return;
                }
                const resolved = (element.value || element.textContent || '').trim();
                if (resolved) {
                    values.push(resolved);
                }
            });
            return values;
        },

        getRadioGroupValue: function (input) {
            if (!input) return null;
            const elements = input.name ? this.getGroupElements(input, 'radio') : [input];
            const selected = elements.find((element) => element && element.checked);
            if (!selected) {
                return null;
            }
            const resolved = (selected.value || selected.textContent || '').trim();
            return resolved || null;
        },

        collectFromPageStructure: function () {
            console.log('[PracticeEnhancer] 尝试从页面结构收集答案...');

            // 查找所有可能包含问题的容器
            const questionContainers = document.querySelectorAll(
                '.question, .quiz-question, [class*="question"], [id*="question"], [data-question]'
            );

            console.log('[PracticeEnhancer] 找到问题容器:', questionContainers.length);

            questionContainers.forEach((container, index) => {
                console.log(`[PracticeEnhancer] 处理问题容器 ${index}:`, container.className, container.id);

                // 在容器内查找输入元素
                const inputs = Array.from(container.querySelectorAll('input, textarea, select'))
                    .filter(el => !this.isExcludedControl(el));
                inputs.forEach(input => {
                    const questionId = this.getQuestionId(input) || `q${index + 1}`;
                    const value = this.getInputValue(input);

                    if (value !== null && value !== '') {
                        const normalizedId = this.addAnswer(questionId, value);
                        if (normalizedId) {
                            console.log(`[PracticeEnhancer] 从容器收集答案: ${normalizedId} = ${value}`);
                        }
                    }
                });
            });
        },

        collectMatchingAnswers: function () {
            // 收集匹配题的答案
            const matchContainers = document.querySelectorAll('.matching-container, .match-exercise, [class*="match"]');
            matchContainers.forEach(container => {
                const pairs = container.querySelectorAll('.match-pair, .matched-item');
                pairs.forEach(pair => {
                    const questionId = pair.dataset.question || pair.dataset.left;
                    const answer = pair.dataset.answer || pair.dataset.right;
                    if (questionId && answer) {
                        this.addAnswer(questionId, answer);
                    }
                });
            });
        },

        collectOrderingAnswers: function () {
            // 收集排序题的答案
            const orderContainers = document.querySelectorAll('.ordering-container, .sort-exercise, [class*="order"]');
            orderContainers.forEach(container => {
                const items = container.querySelectorAll('.order-item, .sortable-item');
                const orderedAnswers = [];
                items.forEach((item, index) => {
                    const value = item.dataset.value || item.textContent.trim();
                    if (value) {
                        orderedAnswers.push(value);
                    }
                });

                if (orderedAnswers.length > 0) {
                    const questionId = container.dataset.question || 'ordering';
                    this.addAnswer(questionId, orderedAnswers.join(','));
                }
            });
        },

        setupInteractionTracking: function () {
            const self = this;
            document.addEventListener('click', function (e) {
                self.interactions.push({
                    type: 'click',
                    target: e.target.tagName + (e.target.className ? '.' + e.target.className : ''),
                    timestamp: Date.now()
                });
            });

            let scrollTimeout;
            document.addEventListener('scroll', function () {
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(function () {
                    self.interactions.push({
                        type: 'scroll',
                        scrollY: window.scrollY,
                        timestamp: Date.now()
                    });
                }, 500);
            });
        },

        handleSubmit: function () {
            if (this.hasDispatchedFinalResults) {
                console.log('[PracticeEnhancer] 最终结果已发送，忽略重复提交');
                return;
            }
            if (this.submitInProgress) {
                console.log('[PracticeEnhancer] 提交处理中，跳过重复触发');
                return;
            }
            this.submitInProgress = true;

            const derivedExamId = this.extractExamIdFromUrl();
            if (!this.sessionId) {
                this.examId = this.examId || derivedExamId;
                this.sessionId = this.generateFallbackSessionId(this.examId || derivedExamId);
                console.warn('[PracticeEnhancer] 无会话ID，使用本地生成的回退ID:', this.sessionId);
            }
            this.examId = this.examId || derivedExamId;

            this.collectAllAnswers();

            const preliminary = this.buildResultsPayload({
                includeComparison: true,
                includeScore: false
            });
            preliminary.status = 'preliminary';
            this.dispatchPracticeResultsEvent(preliminary);

            const self = this;
            const finalizeSubmission = function () {
                self.extractFromResultsTable();
                if (Object.keys(self.correctAnswers).length === 0) {
                    self.extractCorrectAnswersBackup();
                }

                const finalResults = self.buildResultsPayload({
                    includeComparison: true,
                    includeScore: true
                });
                finalResults.status = 'final';
                self.dispatchPracticeResultsEvent(finalResults);

                const pushResults = function () {
                    console.log('[PracticeEnhancer] 发送练习完成数据:', finalResults);
                    self.sendMessage('PRACTICE_COMPLETE', finalResults);
                    self.hasDispatchedFinalResults = true;
                    self.submitInProgress = false;
                };

                if (typeof window.requestIdleCallback === 'function') {
                    window.requestIdleCallback(pushResults, { timeout: 1200 });
                } else {
                    setTimeout(pushResults, 0);
                }
            };

            this.waitForResultsRender(5000)
                .then(finalizeSubmission)
                .catch(function (error) {
                    console.warn('[PracticeEnhancer] 等待结果渲染时出错，直接完成提交流程:', error);
                    finalizeSubmission();
                });
        },

        generateFallbackSessionId: function (examId) {
            const safeId = (examId ? String(examId) : 'session')
                .replace(/[^a-zA-Z0-9_-]/g, '')
                .slice(-32);
            return `${safeId || 'session'}_${Date.now()}`;
        },

        hasRenderableResults: function () {
            const resultsEl = document.getElementById('results');
            if (!resultsEl || resultsEl.style.display === 'none') {
                return false;
            }
            const table = resultsEl.querySelector('table');
            if (table && table.querySelectorAll('tr').length > 1) {
                return true;
            }
            return (resultsEl.textContent || '').trim().length > 0;
        },

        waitForResultsRender: function (timeoutMs) {
            const self = this;
            const limit = typeof timeoutMs === 'number' ? timeoutMs : 1500;
            return new Promise(function (resolve) {
                let resolved = false;
                let observer = null;
                const finish = function () {
                    if (resolved) return;
                    resolved = true;
                    if (observer) {
                        observer.disconnect();
                    }
                    resolve();
                };

                if (self.hasRenderableResults()) {
                    finish();
                    return;
                }

                observer = new MutationObserver(function () {
                    if (self.hasRenderableResults()) {
                        finish();
                    }
                });

                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true
                });

                setTimeout(finish, limit);
            });
        },

        dispatchPracticeResultsEvent: function (results) {
            try {
                document.dispatchEvent(new CustomEvent('practiceResultsReady', {
                    detail: results
                }));
            } catch (eventError) {
                console.warn('[PracticeEnhancer] 触发practiceResultsReady事件失败:', eventError);
            }
        },

        broadcastResultsUpdate: function () {
            const results = this.buildResultsPayload({
                includeComparison: true,
                includeScore: false
            });
            results.status = 'update';
            this.dispatchPracticeResultsEvent(results);
        },

        buildResultsPayload: function (options) {
            const endTime = Date.now();
            const resolvedExamId = this.resolveExamId();
            const includeComparison = options && options.includeComparison;
            const includeScore = options && options.includeScore;
            const context = this.getPageContext();
            const practiceType = this.detectPracticeType();
            const pageType = this.detectPageType();
            const baseMetadata = (window.practicePageMetadata && typeof window.practicePageMetadata === 'object')
                ? window.practicePageMetadata
                : {};
            const metadataPayload = Object.assign({}, baseMetadata);
            const derivedTitle = document.title || resolvedExamId;
            if (context && context.title) {
                metadataPayload.examTitle = metadataPayload.examTitle || context.title;
                metadataPayload.title = metadataPayload.title || context.title;
            }
            if (!metadataPayload.examTitle) {
                metadataPayload.examTitle = derivedTitle;
            }
            if (!metadataPayload.title) {
                metadataPayload.title = metadataPayload.examTitle;
            }
            if (!metadataPayload.type) {
                metadataPayload.type = practiceType;
            }
            if (!metadataPayload.examType) {
                metadataPayload.examType = practiceType;
            }
            if (context && context.frequencyLabel) {
                metadataPayload.frequency = metadataPayload.frequency || context.frequencyLabel;
            }
            if (!metadataPayload.frequency) {
                metadataPayload.frequency = '未知频率';
            }
            if (context && context.categoryLabel && context.categoryLabel !== 'unknown') {
                metadataPayload.category = metadataPayload.category || context.categoryLabel;
            }
            if (!metadataPayload.category && pageType) {
                metadataPayload.category = pageType;
            }
            const resolvedTitleRaw = metadataPayload.examTitle || metadataPayload.title || derivedTitle;
            const normalizedTitle = sanitizeExamTitle(resolvedTitleRaw);
            metadataPayload.examTitle = normalizedTitle || resolvedTitleRaw;
            metadataPayload.title = metadataPayload.title || metadataPayload.examTitle;
            const resolvedTitle = metadataPayload.examTitle || metadataPayload.title || derivedTitle;
            const answerComparison = includeComparison
                ? this.generateAnswerComparison()
                : {};

            const payload = {
                sessionId: this.sessionId,
                suiteSessionId: this.suiteSessionId || null,
                examId: resolvedExamId,
                derivedExamId: resolvedExamId,
                originalExamId: this.examId,
                startTime: this.startTime,
                endTime: endTime,
                duration: this.startTime ? Math.round((endTime - this.startTime) / 1000) : 0,
                answers: Object.assign({}, this.answers),
                correctAnswers: Object.assign({}, this.correctAnswers),
                answerComparison: answerComparison,
                interactions: Array.isArray(this.interactions) ? this.interactions.slice() : [],
                scoreInfo: includeScore ? this.extractScore() : null,
                practiceType: practiceType,
                type: practiceType,
                pageType: pageType,
                url: window.location.href,
                title: resolvedTitle,
                allQuestionIds: this.captureQuestionSet().slice(),
                metadata: metadataPayload
            };

            // 新增：添加suiteId字段（如果是多套题模式）
            if (this.isMultiSuite && this.currentSuiteId) {
                payload.suiteId = this.currentSuiteId;
            }

            // 新增：添加spellingErrors字段（初始为空数组，后续任务会实现）
            payload.spellingErrors = [];

            if (includeScore) {
                const comparisonScore = this.calculateScoreFromComparison(answerComparison);
                const scoreInfo = payload.scoreInfo;
                const needsFallback = !scoreInfo
                    || !Number.isFinite(scoreInfo.total)
                    || scoreInfo.total === 0
                    || (!Number.isFinite(scoreInfo.correct) && comparisonScore)
                    || (scoreInfo.correct === 0 && comparisonScore && comparisonScore.correct > 0);

                if (!scoreInfo && comparisonScore) {
                    payload.scoreInfo = comparisonScore;
                } else if (needsFallback && comparisonScore) {
                    payload.scoreInfo = Object.assign({}, comparisonScore, scoreInfo || {});
                    if (!payload.scoreInfo.source && comparisonScore.source) {
                        payload.scoreInfo.source = comparisonScore.source;
                    }
                }
            }

            this.runHooks('afterBuildPayload', payload);

            return payload;
        },

        generateAnswerComparison: function () {
            const comparison = {};

            // 获取所有问题的键
            const userKeys = Object.keys(this.answers);
            const correctKeys = Object.keys(this.correctAnswers);
            const allQuestions = {};

            // 合并所有问题键
            for (let i = 0; i < userKeys.length; i++) {
                allQuestions[userKeys[i]] = true;
            }
            for (let i = 0; i < correctKeys.length; i++) {
                allQuestions[correctKeys[i]] = true;
            }

            const questionKeys = Object.keys(allQuestions);
            for (let i = 0; i < questionKeys.length; i++) {
                const questionKey = questionKeys[i];
                const userAnswer = this.answers[questionKey];
                let correctAnswer = this.correctAnswers[questionKey];

                // 如果是多套题模式，且答案键包含"::"分隔符
                // 尝试匹配不带前缀的正确答案
                if (!correctAnswer && questionKey.includes('::')) {
                    const parts = questionKey.split('::');
                    if (parts.length === 2) {
                        const questionIdOnly = parts[1];
                        correctAnswer = this.correctAnswers[questionIdOnly];
                    }
                }

                comparison[questionKey] = {
                    userAnswer: userAnswer || null,
                    correctAnswer: correctAnswer || null,
                    isCorrect: this.compareAnswers(userAnswer, correctAnswer)
                };
            }

            console.log('[PracticeEnhancer] 生成答案比较:', comparison);
            return comparison;
        },

        calculateScoreFromComparison: function (comparison) {
            if (!comparison || typeof comparison !== 'object') {
                return null;
            }

            let correct = 0;
            let total = 0;

            Object.values(comparison).forEach((item) => {
                if (!item || typeof item !== 'object') {
                    return;
                }
                const hasContent = item.userAnswer != null || item.correctAnswer != null;
                if (!hasContent) {
                    return;
                }
                total += 1;
                if (item.isCorrect) {
                    correct += 1;
                }
            });

            if (total === 0) {
                return null;
            }

            const accuracy = correct / total;
            return {
                correct,
                total,
                accuracy,
                percentage: Math.round(accuracy * 100),
                source: 'comparison_fallback'
            };
        },

        compareAnswers: function (userAnswer, correctAnswer) {
            if (userAnswer == null || correctAnswer == null) {
                return false;
            }

            const normalizeItem = (value) => String(value).trim().toLowerCase();
            const toNormalizedSet = (value) => {
                if (Array.isArray(value)) {
                    return Array.from(new Set(value.map(normalizeItem).filter(Boolean))).sort();
                }

                const str = normalizeItem(value);
                if (!str) return [];

                // 以逗号/分号作为多选分隔符；若无分隔符则按单值处理
                const parts = str.split(/[;,]/).map(part => part.trim()).filter(Boolean);
                if (parts.length <= 1) {
                    return [str];
                }

                return Array.from(new Set(parts)).sort();
            };

            const userSet = toNormalizedSet(userAnswer);
            const correctSet = toNormalizedSet(correctAnswer);

            if (userSet.length === 0 || correctSet.length === 0) {
                return false;
            }

            if (userSet.length !== correctSet.length) {
                return false;
            }

            for (let i = 0; i < userSet.length; i++) {
                if (userSet[i] !== correctSet[i]) {
                    return false;
                }
            }

            return true;
        },

        extractScore: function () {
            const resultsEl = document.getElementById('results');
            if (!resultsEl) {
                console.warn('[PracticeEnhancer] 未找到结果元素');
                return null;
            }

            const text = resultsEl.textContent || '';
            console.log('[PracticeEnhancer] 结果文本:', text);

            // 匹配 "Final Score: 85% (11/13)" 格式 - 66号文件格式
            const finalScoreMatch = text.match(/Final\s+Score:\s*(\d+)%\s*\((\d+)\/(\d+)\)/i);
            if (finalScoreMatch) {
                const percentage = parseInt(finalScoreMatch[1]);
                const correct = parseInt(finalScoreMatch[2]);
                const total = parseInt(finalScoreMatch[3]);
                const accuracy = total > 0 ? correct / total : 0;

                console.log('[PracticeEnhancer] 提取Final Score成绩:', { correct, total, accuracy, percentage });

                return {
                    correct: correct,
                    total: total,
                    accuracy: accuracy,
                    percentage: percentage,
                    source: 'final_score_extraction'
                };
            }

            // 匹配 "Score: 11/13" 格式
            const scoreMatch = text.match(/Score:\s*(\d+)\/(\d+)/i);
            if (scoreMatch) {
                const correct = parseInt(scoreMatch[1]);
                const total = parseInt(scoreMatch[2]);
                const accuracy = total > 0 ? correct / total : 0;
                const percentage = Math.round(accuracy * 100);

                console.log('[PracticeEnhancer] 提取Score成绩:', { correct, total, accuracy, percentage });

                return {
                    correct: correct,
                    total: total,
                    accuracy: accuracy,
                    percentage: percentage,
                    source: 'score_extraction'
                };
            }

            // 匹配 "You answered X out of Y questions correctly" 格式 - 80号文件格式
            const answeredMatch = text.match(/You answered (\d+) out of (\d+) questions? correctly/i);
            if (answeredMatch) {
                const correct = parseInt(answeredMatch[1]);
                const total = parseInt(answeredMatch[2]);
                const accuracy = total > 0 ? correct / total : 0;
                const percentage = Math.round(accuracy * 100);

                console.log('[PracticeEnhancer] 提取answered格式成绩:', { correct, total, accuracy, percentage });

                return {
                    correct: correct,
                    total: total,
                    accuracy: accuracy,
                    percentage: percentage,
                    source: 'answered_format_extraction'
                };
            }

            // 匹配 "Accuracy: 85%" 格式
            const accuracyPercentMatch = text.match(/Accuracy:\s*(\d+)%/i);
            if (accuracyPercentMatch) {
                const percentage = parseInt(accuracyPercentMatch[1]);
                // 验证百分比范围
                if (percentage >= 0 && percentage <= 100) {
                    return {
                        correct: 0,
                        total: 0,
                        accuracy: percentage / 100,
                        percentage: percentage,
                        source: 'accuracy_percentage_extraction'
                    };
                }
            }

            // 匹配 "Accuracy 85%" 格式（无冒号）
            const accuracyMatch = text.match(/Accuracy\s+(\d+)%/i);
            if (accuracyMatch) {
                const percentage = parseInt(accuracyMatch[1]);
                // 验证百分比范围
                if (percentage >= 0 && percentage <= 100) {
                    return {
                        correct: 0,
                        total: 0,
                        accuracy: percentage / 100,
                        percentage: percentage,
                        source: 'accuracy_extraction'
                    };
                }
            }

            // 匹配单独的百分比 "85%" 格式 - 更严格的匹配，避免误匹配HTML内容中的数字
            // 要求百分号前有明确的分隔符（空格、冒号等）或在行首
            const percentageMatch = text.match(/(?:^|[\s:])(\d+)%(?:[\s,.]|$)/);
            if (percentageMatch) {
                const percentage = parseInt(percentageMatch[1]);
                // 验证百分比范围，避免误匹配如"31"这样的数字
                if (percentage >= 0 && percentage <= 100) {
                    console.log('[PracticeEnhancer] 提取百分比成绩:', { percentage });

                    return {
                        correct: 0,
                        total: 0,
                        accuracy: percentage / 100,
                        percentage: percentage,
                        source: 'percentage_extraction'
                    };
                }
            }

            // 尝试从表格中提取成绩信息
            const correctCells = resultsEl.querySelectorAll('.result-correct');
            const incorrectCells = resultsEl.querySelectorAll('.result-incorrect');
            if (correctCells.length > 0 || incorrectCells.length > 0) {
                const correct = correctCells.length;
                const total = correctCells.length + incorrectCells.length;
                const accuracy = total > 0 ? correct / total : 0;
                const percentage = Math.round(accuracy * 100);

                console.log('[PracticeEnhancer] 从表格提取成绩:', { correct, total, accuracy, percentage });

                return {
                    correct: correct,
                    total: total,
                    accuracy: accuracy,
                    percentage: percentage,
                    source: 'table_extraction'
                };
            }

            console.warn('[PracticeEnhancer] 无法提取成绩信息，结果文本:', text);
            return null;
        },

        sendMessage: function (type, data) {
            if (!this.parentWindow) {
                console.warn('[PracticeEnhancer] 无父窗口，无法发送消息');
                return;
            }

            this.runHooks('beforeSendMessage', type, data);
            const message = {
                type: type,
                data: data,
                source: 'practice_page',
                timestamp: Date.now()
            };

            try {
                this.parentWindow.postMessage(message, '*');
                console.log('[PracticeEnhancer] 消息已发送:', type);
            } catch (error) {
                console.error('[PracticeEnhancer] 发送消息失败:', error);
            }
        },

        getStatus: function () {
            return {
                isInitialized: this.isInitialized,
                sessionId: this.sessionId,
                hasParentWindow: !!this.parentWindow,
                answersCount: Object.keys(this.answers).length,
                correctAnswersCount: Object.keys(this.correctAnswers).length, // 新增
                interactionsCount: this.interactions.length,
                pageType: this.detectPageType()
            };
        }
    };

    // 添加全局方法供调试和手动触发使用
    window.collectAnswersNow = function () {
        console.log('[PracticeEnhancer] 手动触发答案收集');
        window.practicePageEnhancer.collectAllAnswers();
        return window.practicePageEnhancer.answers;
    };

    window.getCorrectAnswers = function () {
        console.log('[PracticeEnhancer] 获取正确答案');
        window.practicePageEnhancer.extractCorrectAnswers();
        return window.practicePageEnhancer.correctAnswers;
    };

    // 自动初始化
    const shouldAutoInitialize = window.practicePageEnhancer.config.autoInitialize !== false;
    const kickOffInitialization = () => {
        window.practicePageEnhancer.initialize().catch((error) => {
            console.error('[PracticeEnhancer] 初始化失败', error);
        });
    };

    if (shouldAutoInitialize) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', kickOffInitialization);
        } else {
            kickOffInitialization();
        }
    } else {
        console.log('[PracticeEnhancer] 自动初始化已关闭，等待手动调用initialize()');
    }

    // 调试函数
    window.debugPracticeEnhancer = () => {
        console.log('=== 练习页面增强器调试信息 ===');
        console.log('状态:', window.practicePageEnhancer.getStatus());
        console.log('用户答案:', window.practicePageEnhancer.answers);
        console.log('正确答案:', window.practicePageEnhancer.correctAnswers); // 新增
        console.log('答案比较:', window.practicePageEnhancer.generateAnswerComparison()); // 新增
        console.log('交互记录:', window.practicePageEnhancer.interactions);

        // 测试成绩提取
        const scoreInfo = window.practicePageEnhancer.extractScore();
        console.log('成绩提取测试:', scoreInfo);
    };
})();
