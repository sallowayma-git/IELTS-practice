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
                
                for (const script of scripts) {
                    const content = script.textContent || script.innerHTML;
                    
                    const correctAnswersMatch = content.match(/(?:const|let|var)\s+correctAnswers\s*=\s*(\{[^}]+\})/s);
                    if (correctAnswersMatch) {
                        try {
                            const answersStr = correctAnswersMatch[1];
                            const answers = this.parseAnswersObject(answersStr);
                            if (answers && Object.keys(answers).length > 0) {
                                console.log('[CorrectAnswerExtractor] 从脚本变量提取答案:', answers);
                                return answers;
                            }
                        } catch (error) {
                            console.warn('[CorrectAnswerExtractor] 解析脚本变量失败:', error);
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
        startTime: Date.now(),
        isInitialized: false,
        initRequestTimer: null,

        normalizeQuestionKey: function(rawKey) {
            if (rawKey == null) return null;
            const str = String(rawKey).trim();
            if (!str) return null;

            const rangeMatch = str.match(/^q?(\d+)\s*-\s*(\d+)$/i);
            if (rangeMatch) {
                return `q${rangeMatch[1]}-${rangeMatch[2]}`;
            }

            if (/^q\d+$/i.test(str)) return str.toLowerCase();
            if (/^\d+$/.test(str)) return `q${str}`;
            return str;
        },

        normalizeAnswerTokens: function(value) {
            if (value == null) return null;

            const tokens = [];
            const pushToken = (token) => {
                const normalized = String(token).trim().toLowerCase();
                if (normalized) tokens.push(normalized);
            };

            const handleItem = (item) => {
                if (item == null) return;
                if (Array.isArray(item)) {
                    item.forEach(handleItem);
                    return;
                }
                const str = String(item);
                str.split(/[,，|]/).forEach(part => {
                    part.split(/\s+/).forEach(sub => pushToken(sub));
                });
            };

            handleItem(value);
            return tokens.length > 0 ? Array.from(new Set(tokens)).sort() : null;
        },

        initialize: function () {
            if (this.isInitialized) {
                console.log('[PracticeEnhancer] 已经初始化，跳过');
                return;
            }
            console.log('[PracticeEnhancer] 开始初始化');

            // 设置共享命名空间
            if (window.storage && typeof window.storage.setNamespace === 'function') {
                window.storage.setNamespace('exam_system');
                console.log('[PracticeEnhancer] 已设置共享命名空间: exam_system');

                // 验证命名空间设置是否生效
                setTimeout(() => {
                    const testKey = 'namespace_test_enhancer';
                    const testValue = 'test_value_enhancer_' + Date.now();
                    window.storage.set(testKey, testValue).then(() => {
                        window.storage.get(testKey).then((retrievedValue) => {
                            if (retrievedValue === testValue) {
                                console.log('✅ 增强器命名空间设置验证成功: 存储和读取正常');
                            } else {
                                console.warn('❌ 增强器命名空间设置验证失败: 读取值不匹配');
                            }
                            // 清理测试数据
                            window.storage.remove(testKey);
                        }).catch((error) => {
                            console.error('❌ 增强器命名空间设置验证失败: 读取错误', error);
                        });
                    }).catch((error) => {
                        console.error('❌ 增强器命名空间设置验证失败: 存储错误', error);
                    });
                }, 1000);
            } else {
                console.warn('[PracticeEnhancer] 存储管理器未加载或setNamespace方法不可用');
            }

            this.setupCommunication();
            this.setupAnswerListeners();
            this.extractCorrectAnswers(); // 新增：提取正确答案
            this.interceptSubmit();
            this.setupInteractionTracking();
            this.isInitialized = true;
            console.log('[PracticeEnhancer] 初始化完成');
            
            // 页面加载完成后进行一次初始收集
            if (document.readyState === 'complete') {
                setTimeout(() => this.collectAllAnswers(), 1000);
            } else {
                window.addEventListener('load', () => {
                    setTimeout(() => this.collectAllAnswers(), 1000);
                });
            }
        },

        cleanup: function() {
            console.log('[PracticeEnhancer] 清理资源');
            if (this.answerCollectionInterval) {
                clearInterval(this.answerCollectionInterval);
                this.answerCollectionInterval = null;
            }
            this.stopInitRequestLoop();
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

        startInitRequestLoop: function() {
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

        stopInitRequestLoop: function() {
            if (this.initRequestTimer) {
                clearInterval(this.initRequestTimer);
                this.initRequestTimer = null;
            }
        },

        enableSuiteMode: function(initData = {}) {
            if (this.suiteModeActive) {
                return;
            }

            this.suiteModeActive = true;
            this.suiteSessionId = initData.suiteSessionId || null;
            this.installSuiteGuards();
        },

        installSuiteGuards: function() {
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

            try { window.close = guardClose; } catch (_) {}
            try { window.self.close = guardClose; } catch (_) {}
            try { window.top.close = guardClose; } catch (_) {}

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

        teardownSuiteGuards: function() {
            if (!this.suiteGuardsInstalled) {
                return;
            }

            this.suiteGuardsInstalled = false;

            if (this._nativeClose) {
                try {
                    window.close = this._nativeClose;
                    window.self.close = this._nativeClose;
                    window.top.close = this._nativeClose;
                } catch (_) {}
            }

            if (this._nativeOpen) {
                try {
                    window.open = this._nativeOpen;
                } catch (_) {}
            }

            this.suiteModeActive = false;
            this.suiteSessionId = null;
        },

        notifySuiteCloseAttempt: function(reason) {
            this.sendMessage('SUITE_CLOSE_ATTEMPT', {
                examId: this.examId || null,
                suiteSessionId: this.suiteSessionId || null,
                reason: reason || 'unknown',
                timestamp: Date.now()
            });
        },

        handleSuiteNavigation: function(data) {
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
            const title = document.title || '';
            const url = window.location.href || '';
            if (title.includes('P1') || url.includes('P1')) return 'P1';
            if (title.includes('P2') || url.includes('P2')) return 'P2';
            if (title.includes('P3') || url.includes('P3')) return 'P3';
            const pathParts = url.split('/');
            for (let part of pathParts) {
                if (part.match(/^P[123]$/i)) {
                    return part.toUpperCase();
                }
            }
            return 'unknown';
        },

        // 新增：从URL中提取真实的examId
        extractExamIdFromUrl: function() {
            const url = window.location.href || '';
            const title = document.title || '';
            
            // 尝试从URL路径中提取题目编号
            const pathParts = url.split('/');
            
            // 查找包含题目编号的路径部分，格式如 "97. P3 - The value of literary prizes 文学奖项的价值"
            for (let part of pathParts) {
                const decodedPart = decodeURIComponent(part);
                const match = decodedPart.match(/^(\d+)\.\s*P([123])\s*-\s*(.+)/);
                if (match) {
                    const [, number, level, titlePart] = match;
                    // 根据题目编号和级别生成examId
                    // 这里需要根据实际的ID格式调整
                    return `p${level.toLowerCase()}-${number}`;
                }
            }
            
            // 如果无法从URL提取，尝试从标题提取
            if (title) {
                const titleMatch = title.match(/P([123])\s*-\s*(.+)/);
                if (titleMatch) {
                    const [, level, titlePart] = titleMatch;
                    // 生成一个基于标题的ID
                    const cleanTitle = titlePart.replace(/[^\w\s]/g, '').replace(/\s+/g, '-').toLowerCase();
                    return `p${level.toLowerCase()}-${cleanTitle}`;
                }
            }
            
            // 最后的降级方案：返回页面类型
            return this.detectPageType();
        },

        generateFallbackSessionId: function(examId) {
            const safeExamId = examId
                ? String(examId).replace(/[^\w-]/g, '')
                : 'session';
            return `local_${safeExamId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        },

        extractCorrectAnswers: function () {
            console.log('[PracticeEnhancer] 开始提取正确答案');
            
            // 使用CorrectAnswerExtractor如果可用
            if (window.CorrectAnswerExtractor) {
                try {
                    const extractor = new CorrectAnswerExtractor();
                    const extractedAnswers = extractor.extractFromPage(document);
                    
                    if (extractedAnswers && Object.keys(extractedAnswers).length > 0) {
                        const normalized = {};
                        Object.keys(extractedAnswers).forEach((key) => {
                            const normalizedKey = this.normalizeQuestionKey(key) || key;
                            normalized[normalizedKey] = extractedAnswers[key];
                        });
                        this.correctAnswers = normalized;
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
            setTimeout(function() {
                this.extractFromResultsTable();
            }.bind(this), 2000);
            
            // 定期检查是否有新的正确答案数据
            this.startCorrectAnswerMonitoring();
        },

        extractCorrectAnswersBackup: function () {
            // 多种备用提取方法
            const sources = ['answers', 'correctAnswers', 'answerKey', 'solutions'];
            
            for (const source of sources) {
                if (window[source] && typeof window[source] === 'object') {
                    Object.keys(window[source]).forEach(key => {
                        const value = window[source][key];
                        if (value !== undefined && value !== null) {
                            const normalizedKey = this.normalizeQuestionKey(key) || key;
                            this.correctAnswers[normalizedKey] = String(value).trim();
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
                    const questionId = element.dataset.question || 
                                     element.dataset.for || 
                                     element.dataset.questionId;
                    const correctAnswer = element.dataset.correctAnswer || 
                                        element.dataset.answer || 
                                        element.textContent.trim();
                    
                    if (questionId && correctAnswer) {
                        const normalizedKey = self.normalizeQuestionKey(questionId) || questionId;
                        self.correctAnswers[normalizedKey] = correctAnswer;
                    }
                }
            }
        },

        extractFromResultsTable: function () {
            console.log('[PracticeEnhancer] 尝试从结果表格提取正确答案');
            
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
                        const questionMatch = questionText.match(/(\d+\s*-\s*\d+|\d+)/);
                        if (questionMatch && correctAnswer && correctAnswer !== 'N/A' && correctAnswer !== '') {
                            const questionKey = this.normalizeQuestionKey(questionMatch[1]) || questionMatch[1];
                            this.correctAnswers[questionKey] = correctAnswer;
                            
                            // 同时更新用户答案，确保数据一致性
                            if (userAnswer && userAnswer !== 'No Answer') {
                                this.answers[questionKey] = userAnswer;
                            }
                            
                            console.log('[PracticeEnhancer] 从表格提取:', questionKey, '用户答案:', userAnswer, '正确答案:', correctAnswer);
                        }
                    }
                }
            }
            
            console.log('[PracticeEnhancer] 表格提取完成，正确答案:', this.correctAnswers);
            console.log('[PracticeEnhancer] 表格提取完成，用户答案:', this.answers);
        },

        setupAnswerListeners: function () {
            const self = this;
            
            // 增强的change事件监听
            document.addEventListener('change', function(e) {
                if (!self.isExcludedControl(e.target)) {
                    self.recordAnswer(e.target);
                }
            });

            // 增强的input事件监听
            document.addEventListener('input', function(e) {
                if (!self.isExcludedControl(e.target)) {
                    self.recordAnswer(e.target);
                }
            });

            // 点击事件监听（用于单选框、复选框）
            document.addEventListener('click', function(e) {
                if (e.target.type === 'radio' || e.target.type === 'checkbox') {
                    if (!self.isExcludedControl(e.target)) {
                        setTimeout(() => self.recordAnswer(e.target), 10);
                    }
                }
            });

            // 拖拽事件监听
            document.addEventListener('drop', function(e) {
                setTimeout(function() {
                    self.collectDropzoneAnswers();
                    self.collectAllAnswers(); // 全面收集一次
                }, 100);
            });

            // 页面可见性变化时收集答案（替代定期收集）
            document.addEventListener('visibilitychange', function() {
                if (document.hidden) {
                    console.log('[PracticeEnhancer] 页面隐藏，收集答案');
                    self.collectAllAnswers();
                } else {
                    console.log('[PracticeEnhancer] 页面显示，准备收集答案');
                }
            });

            // 页面卸载前收集答案和清理
            window.addEventListener('beforeunload', function() {
                console.log('[PracticeEnhancer] 页面卸载，收集答案并清理');
                self.collectAllAnswers();
                self.cleanup();
            });

            // 页面失去焦点时收集答案
            window.addEventListener('blur', function() {
                console.log('[PracticeEnhancer] 页面失去焦点，收集答案');
                self.collectAllAnswers();
            });

            console.log('[PracticeEnhancer] 增强答案监听器设置完成');
        },

        // 判断是否为应当排除的非答题控件（如播放速度、音量滑条等）
        isExcludedControl: function(element) {
            try {
                if (!element) return false;
                // 明确排除的控件ID与区域
                if (element.matches && (element.matches('#volume-slider') || element.matches('#playback-speed'))) {
                    return true;
                }
                if (element.closest && (element.closest('#speed-control') || element.closest('#volume-container'))) {
                    return true;
                }
            } catch (_) { /* no-op */ }
            return false;
        },

        recordAnswer: function(element) {
            if (!element) return;
            if (this.isExcludedControl(element)) return;

            let questionId = null;
            let value = null;

            // 获取问题ID
            if (element.name) {
                questionId = element.name;
            } else if (element.id) {
                questionId = element.id.replace(/_input$|-input$|_answer$/, '');
            } else if (element.dataset.question) {
                questionId = element.dataset.question;
            }

            // 获取答案值
            if (element.type === 'radio' || element.type === 'checkbox') {
                if (element.checked) {
                    value = element.value;
                }
            } else {
                value = element.value;
            }

            // 记录答案
            if (questionId && value !== null && value !== '') {
                const normalizedKey = this.normalizeQuestionKey(questionId) || questionId;
                if (element.type === 'checkbox') {
                    const siblings = Array.from(document.querySelectorAll(`input[type="checkbox"][name="${element.name}"]`));
                    const selections = siblings
                        .filter(cb => cb.checked)
                        .map(cb => String(cb.value).trim().toUpperCase())
                        .filter(Boolean);
                    if (selections.length > 0) {
                        const uniq = Array.from(new Set(selections)).sort();
                        this.answers[normalizedKey] = uniq;
                        console.log('[PracticeEnhancer] 记录多选答案:', normalizedKey, '=', uniq.join(','));
                    }
                } else {
                    this.answers[normalizedKey] = value;
                    console.log('[PracticeEnhancer] 记录答案:', normalizedKey, '=', value);
                }
                
                // 记录交互
                this.interactions.push({
                    type: 'answer',
                    questionId: normalizedKey,
                    value: value,
                    timestamp: Date.now(),
                    elementType: element.type || element.tagName.toLowerCase()
                });
            }
        },

        collectDropzoneAnswers: function () {
            // 收集拖拽填空题答案
            const dropzones = document.querySelectorAll('.dropzone');
            for (let i = 0; i < dropzones.length; i++) {
                const zone = dropzones[i];
                const qName = zone.dataset.target;
                const card = zone.querySelector('.card');
                if (qName && card) {
                    this.answers[qName] = card.dataset.value || card.textContent.trim();
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
                    this.answers['q' + paragraph.toLowerCase()] = itemTexts.join(',');
                }
            }

            // 收集匹配题答案
            const matchZones = document.querySelectorAll('.match-dropzone');
            for (let i = 0; i < matchZones.length; i++) {
                const zone = matchZones[i];
                const qName = zone.dataset.question;
                const item = zone.querySelector('.drag-item-clone');
                if (qName && item) {
                    this.answers[qName] = item.dataset.country || item.textContent.trim();
                }
            }
        },

        interceptSubmit: function () {
            // 延迟拦截，确保页面完全加载
            setTimeout(function() {
                // 拦截gradeAnswers函数
                if (typeof window.gradeAnswers === 'function') {
                    const originalGradeAnswers = window.gradeAnswers;
                    const self = this;
                    window.gradeAnswers = function() {
                        console.log('[PracticeEnhancer] 拦截到gradeAnswers调用');
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
                    window.grade = function() {
                        console.log('[PracticeEnhancer] 拦截到grade调用');
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
                this.collectAllAnswers();
                this.handleSubmit();
            });

            // 监听提交按钮点击 - 增强版
            const self = this;
            document.addEventListener('click', function(e) {
                console.log('[PracticeEnhancer] 点击事件:', e.target.tagName, e.target.id, e.target.className);

                if (e.target.tagName === 'BUTTON' &&
                    (e.target.textContent.includes('Submit') ||
                        e.target.textContent.includes('提交') ||
                        e.target.textContent.includes('完成') ||
                        e.target.textContent.includes('Check') ||
                        e.target.classList.contains('primary') ||
                        e.target.id === 'submit-btn' ||
                        (e.target.onclick && e.target.onclick.toString().includes('grade')))) {
                    console.log('[PracticeEnhancer] 检测到提交按钮点击:', e.target);
                    self.collectAllAnswers();
                    self.handleSubmit();
                }
            });

            // 定期检查结果是否出现
            this.startResultsMonitoring();

            console.log('[PracticeEnhancer] 提交拦截设置完成');
        },

        startCorrectAnswerMonitoring: function() {
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

        startResultsMonitoring: function() {
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
            
            const beforeCount = Object.keys(this.answers).length;

            // 1. 收集所有输入元素（更广泛的选择器），同时过滤非答题控件
            const allInputs = Array.from(document.querySelectorAll('input, textarea, select'))
                .filter(el => !this.isExcludedControl(el));
            console.log('[PracticeEnhancer] 找到输入元素总数:', allInputs.length);
            
            const checkboxGroups = {};

            allInputs.forEach((input, index) => {
                if (input.type === 'checkbox' && input.name) {
                    const key = this.normalizeQuestionKey(input.name) || input.name;
                    if (!checkboxGroups[key]) {
                        checkboxGroups[key] = [];
                    }
                    if (input.checked) {
                        checkboxGroups[key].push(input.value);
                    }
                    return;
                }

                const questionId = this.getQuestionId(input);
                const value = this.getInputValue(input);

                if (input.type === 'text') {
                    console.log(`[DEBUG] Text Input Found: id='${input.id}', name='${input.name}', derived_questionId='${questionId}', value='${value}'`);
                }
                
                console.log(`[PracticeEnhancer] 输入元素 ${index}: type=${input.type}, name=${input.name}, id=${input.id}, value=${value}, questionId=${questionId}`);
                
                if (questionId && value !== null && value !== '') {
                    const normalizedKey = this.normalizeQuestionKey(questionId) || questionId;
                    this.answers[normalizedKey] = value;
                    console.log(`[PracticeEnhancer] 记录答案: ${normalizedKey} = ${value}`);
                }
            });

            Object.keys(checkboxGroups).forEach(key => {
                const normalizedSelections = this.normalizeAnswerTokens(checkboxGroups[key]);
                if (normalizedSelections && normalizedSelections.length > 0) {
                    this.answers[key] = normalizedSelections;
                    console.log(`[PracticeEnhancer] 汇总多选答案: ${key} = ${normalizedSelections.join(',')}`);
                }
            });

            // 2. 收集拖拽答案
            this.collectDropzoneAnswers();

            // 3. 收集特殊格式的答案（通过data属性）
            const answerElements = document.querySelectorAll('[data-answer], [data-user-answer], [data-value]');
            console.log('[PracticeEnhancer] 找到data答案元素:', answerElements.length);
            
            answerElements.forEach(element => {
                const questionId = element.dataset.question || element.dataset.for || element.id;
                const answer = element.dataset.answer || element.dataset.userAnswer || element.dataset.value;
                if (questionId && answer) {
                    const normalizedKey = this.normalizeQuestionKey(questionId) || questionId;
                    this.answers[normalizedKey] = answer;
                    console.log(`[PracticeEnhancer] 记录data答案: ${normalizedKey} = ${answer}`);
                }
            });

            // 4. 收集匹配题答案
            this.collectMatchingAnswers();

            // 5. 收集排序题答案
            this.collectOrderingAnswers();

            // 6. 尝试从页面特定结构收集答案
            this.collectFromPageStructure();

            const afterCount = Object.keys(this.answers).length;
            console.log(`[PracticeEnhancer] 全面收集完成，答案数量从 ${beforeCount} 增加到 ${afterCount}`);
            console.log('[PracticeEnhancer] 收集到的所有答案:', this.answers);
        },

        getQuestionId: function(input) {
            // 尝试多种方式获取问题ID
            // 先过滤排除控件
            if (this.isExcludedControl(input)) return null;
            if (input.name) return input.name;
            if (input.id) return input.id.replace(/_input$|-input$|_answer$/, '');
            if (input.dataset.question) return input.dataset.question;
            if (input.dataset.for) return input.dataset.for;
            
            // 尝试从父元素获取
            let parent = input.parentElement;
            while (parent && parent !== document.body) {
                if (parent.dataset.question) return parent.dataset.question;
                if (parent.id && parent.id.includes('q')) return parent.id;
                parent = parent.parentElement;
            }
            
            // 尝试从相邻元素获取
            const label = document.querySelector(`label[for="${input.id}"]`);
            if (label && label.textContent) {
                const match = label.textContent.match(/(\d+)/);
                if (match) return 'q' + match[1];
            }
            
            return null;
        },

        getInputValue: function(input) {
            if (input.type === 'radio' || input.type === 'checkbox') {
                return input.checked ? input.value : null;
            }
            return input.value;
        },

        collectFromPageStructure: function() {
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
                        const normalizedKey = this.normalizeQuestionKey(questionId) || questionId;
                        this.answers[normalizedKey] = value;
                        console.log(`[PracticeEnhancer] 从容器收集答案: ${normalizedKey} = ${value}`);
                    }
                });
            });
        },

        collectMatchingAnswers: function() {
            // 收集匹配题的答案
            const matchContainers = document.querySelectorAll('.matching-container, .match-exercise, [class*="match"]');
            matchContainers.forEach(container => {
                const pairs = container.querySelectorAll('.match-pair, .matched-item');
                pairs.forEach(pair => {
                    const questionId = pair.dataset.question || pair.dataset.left;
                    const answer = pair.dataset.answer || pair.dataset.right;
                    if (questionId && answer) {
                        this.answers[questionId] = answer;
                    }
                });
            });
        },

        collectOrderingAnswers: function() {
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
                    const questionId = this.normalizeQuestionKey(container.dataset.question) || container.dataset.question || 'ordering';
                    this.answers[questionId] = orderedAnswers.join(',');
                }
            });
        },

        setupInteractionTracking: function () {
            const self = this;
            document.addEventListener('click', function(e) {
                self.interactions.push({
                    type: 'click',
                    target: e.target.tagName + (e.target.className ? '.' + e.target.className : ''),
                    timestamp: Date.now()
                });
            });

            let scrollTimeout;
            document.addEventListener('scroll', function() {
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(function() {
                    self.interactions.push({
                        type: 'scroll',
                        scrollY: window.scrollY,
                        timestamp: Date.now()
                    });
                }, 500);
            });
        },

        handleSubmit: function () {
            const derivedExamId = this.extractExamIdFromUrl();
            if (!this.sessionId) {
                this.sessionId = this.generateFallbackSessionId(this.examId || derivedExamId);
                console.warn('[PracticeEnhancer] 无会话ID，使用本地生成的回退ID:', this.sessionId);
            }

            const resolvedExamId = this.examId || derivedExamId;
            const self = this;
            
            // 延迟发送数据，确保有足够时间提取正确答案
            setTimeout(function() {
                // 最后一次尝试提取正确答案
                self.extractFromResultsTable();
                
                // 再次延迟，等待异步提取完成
                setTimeout(function() {
                    // 如果仍然没有正确答案，尝试其他方法
                    if (Object.keys(self.correctAnswers).length === 0) {
                        self.extractCorrectAnswersBackup();
                    }

                    const endTime = Date.now();
                    const duration = Math.round((endTime - self.startTime) / 1000);

                    // 生成答案比较数据
                    const answerComparison = self.generateAnswerComparison();

                    const results = {
                        sessionId: self.sessionId,
                        examId: resolvedExamId,
                        derivedExamId,
                        originalExamId: self.examId,
                        startTime: self.startTime,
                        endTime: endTime,
                        duration: duration,
                        answers: self.answers,
                        correctAnswers: self.correctAnswers, // 新增：正确答案
                        answerComparison: answerComparison, // 新增：答案比较
                        interactions: self.interactions,
                        scoreInfo: self.extractScore(),
                        pageType: self.detectPageType(),
                        suiteSessionId: self.suiteSessionId || null,
                        url: window.location.href,
                        title: document.title
                    };

                    console.log('[PracticeEnhancer] 发送练习完成数据:', results);
                    self.sendMessage('PRACTICE_COMPLETE', results);
                }, 1000); // 再等1秒确保异步提取完成
            }, 500); // 先等0.5秒让结果表格完全显示
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
                const correctAnswer = this.correctAnswers[questionKey];
                
                comparison[questionKey] = {
                    userAnswer: userAnswer || null,
                    correctAnswer: correctAnswer || null,
                    isCorrect: this.compareAnswers(userAnswer, correctAnswer)
                };
            }
            
            console.log('[PracticeEnhancer] 生成答案比较:', comparison);
            return comparison;
        },

        compareAnswers: function (userAnswer, correctAnswer) {
            const userTokens = this.normalizeAnswerTokens(userAnswer);
            const correctTokens = this.normalizeAnswerTokens(correctAnswer);

            if (!userTokens || !correctTokens) {
                return false;
            }

            if (userTokens.length !== correctTokens.length) {
                return false;
            }

            const correctSet = new Set(correctTokens);
            for (const token of userTokens) {
                if (!correctSet.has(token)) {
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

            // 匹配 "Accuracy: 85%" 格式
            const accuracyPercentMatch = text.match(/Accuracy:\s*(\d+)%/i);
            if (accuracyPercentMatch) {
                const percentage = parseInt(accuracyPercentMatch[1]);
                return {
                    correct: 0,
                    total: 0,
                    accuracy: percentage / 100,
                    percentage: percentage,
                    source: 'accuracy_percentage_extraction'
                };
            }

            // 匹配单独的百分比 "85%" 格式
            const percentageMatch = text.match(/(\d+)%/);
            if (percentageMatch) {
                const percentage = parseInt(percentageMatch[1]);

                console.log('[PracticeEnhancer] 提取百分比成绩:', { percentage });

                return {
                    correct: 0,
                    total: 0,
                    accuracy: percentage / 100,
                    percentage: percentage,
                    source: 'percentage_extraction'
                };
            }

            // 匹配 "Accuracy 85%" 格式（无冒号）
            const accuracyMatch = text.match(/Accuracy\s+(\d+)%/i);
            if (accuracyMatch) {
                const percentage = parseInt(accuracyMatch[1]);
                return {
                    correct: 0,
                    total: 0,
                    accuracy: percentage / 100,
                    percentage: percentage,
                    source: 'accuracy_extraction'
                };
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
    window.collectAnswersNow = function() {
        console.log('[PracticeEnhancer] 手动触发答案收集');
        window.practicePageEnhancer.collectAllAnswers();
        return window.practicePageEnhancer.answers;
    };

    window.getCorrectAnswers = function() {
        console.log('[PracticeEnhancer] 获取正确答案');
        window.practicePageEnhancer.extractCorrectAnswers();
        return window.practicePageEnhancer.correctAnswers;
    };

    // 自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.practicePageEnhancer.initialize();
        });
    } else {
        window.practicePageEnhancer.initialize();
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
