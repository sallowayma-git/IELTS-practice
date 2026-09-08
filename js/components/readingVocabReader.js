(function initReadingVocabReader(global) {
    'use strict';

    const DEFAULT_SOURCE = { kind: 'builtin', id: 'default' };

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function recordBookshelfExamDirect(examId, examTitle = '', category = '', source = DEFAULT_SOURCE) {
        if (!examId) return;
        return ReadingVocabStore.mutate('recordVisit', {
            source, article: { examId: String(examId), title: examTitle },
            at: new Date().toISOString()
        });
    }

    // This cache is a view of acknowledged AppData state, never a storage authority.
    const ReadingVocabStore = {
        _state: null,
        _commitBound: false,
        _loadSequence: 0,

        async resolveSource(options = {}) {
            if (options.source) return { ...options.source };
            const id = Object.prototype.hasOwnProperty.call(options, 'libraryConfigurationId')
                ? options.libraryConfigurationId
                : await global.AppData.library.getActive();
            return id == null || id === '' ? { ...DEFAULT_SOURCE } : { kind: 'imported', id: String(id) };
        },

        getAll() { return this.project(); },

        project(articleId = null) {
            if (!this._state) return [];
            const snapshot = this._state.snapshot;
            const model = global.AppData.vocab.readingModel;
            return model.query(snapshot, articleId ? { articleId } : {}).terms.map(entry => {
                const associations = entry.associations;
                const article = snapshot.reading.articles.find(row => row.id === associations[0]?.articleId);
                return {
                    ...entry.word, id: entry.term.id, word: entry.word.word,
                    examId: article?.examId || '', examTitle: article?.title || '',
                    context: entry.word.example || entry.word.context || '',
                    associations, occurrences: entry.occurrences,
                    highlights: entry.occurrences.map(occurrence => {
                        const relation = associations.find(row => row.id === occurrence.associationId);
                        const owner = snapshot.reading.articles.find(row => row.id === relation?.articleId);
                        return { ...occurrence, examId: owner?.examId, scope: occurrence.scopeId, text: occurrence.quote };
                    })
                };
            });
        },

        getByExam(examId, source = DEFAULT_SOURCE) {
            if (!examId || !this._state) return [];
            return this.project(global.AppData.vocab.readingModel.articleId(source, String(examId)));
        },

        getOccurrenceOwner(occurrence) {
            const reading = this._state?.snapshot.reading;
            const association = reading?.associations.find(row => row.id === occurrence.associationId);
            const article = reading?.articles.find(row => row.id === association?.articleId);
            const source = reading?.sources.find(row => row.id === article?.sourceId);
            if (!article || !source) return null;
            return { articleId: article.id,
                source: { kind: source.kind, id: source.libraryId },
                article: { examId: article.examId, title: article.title } };
        },

        adopt(state) {
            if (this._state?.generation === state.generation && this._state.revision > state.revision) return;
            this._state = state;
            if (typeof global.dispatchEvent === 'function') {
                global.dispatchEvent(new CustomEvent('reading-vocab-store-updated'));
            }
        },

        async reload() {
            const sequence = ++this._loadSequence;
            await global.AppData.ready;
            const state = await global.AppData.vocab.getReadingSnapshot();
            if (sequence === this._loadSequence) this.adopt(state);
            return state;
        },

        async mutate(type, command, observedState = null) {
            if (!this._state) await this.init();
            const observed = observedState || this._state;
            let result;
            try {
                result = await global.AppData.vocab.mutateReading(type, command, {
                    observedRevision: observed.revision, observedGeneration: observed.generation
                });
            } catch (error) {
                // The next explicit retry must use the new deletion/replace fence.
                await this.reload().catch(() => {});
                throw error;
            }
            if (!result || result.saved !== true) throw new Error('Reading save was not acknowledged');
            ++this._loadSequence;
            this.adopt(result);
            return result;
        },

        // Compatibility flush methods only read authoritative state.
        async syncToAppData() { return this.reload(); },
        async flushToAppData() { return this.reload(); },

        async add(rawWord, examId, examTitle, context = '', highlight = null, source = DEFAULT_SOURCE) {
            const word = this.cleanWord(rawWord);
            if (!word || word.length > 50) return { added: false, reason: 'invalid_word' };
            if (!this._state) await this.init();
            const duplicate = this.getByExam(examId, source).some(item => item.word.toLowerCase() === word.toLowerCase());
            const occurrence = highlight ? {
                scopeId: highlight.scopeId || highlight.scope,
                contentVersion: highlight.contentVersion || 'legacy-reader-v1',
                startOffset: highlight.startOffset, endOffset: highlight.endOffset,
                quote: highlight.quote || highlight.text || word, before: highlight.before || '', after: highlight.after || ''
            } : undefined;
            const result = await this.mutate('collect', {
                source, article: { examId: String(examId), title: examTitle || '' },
                word: { word, meaning: '待补充释义', example: String(context || '').trim().slice(0, 150) },
                ...(occurrence ? { occurrence } : { manual: true }),
                at: new Date().toISOString()
            });
            return { ...result, added: result.added !== false, isDuplicate: duplicate,
                item: this.getByExam(examId, source).find(item => item.word.toLowerCase() === word.toLowerCase()) };
        },

        async remove(wordOrId, examId = null, source = DEFAULT_SOURCE) {
            if (!this._state) await this.init();
            const target = String(wordOrId).trim().toLowerCase();
            const item = this.getAll().find(row => row.id === wordOrId || row.word.toLowerCase() === target);
            if (!item) return false;
            await this.mutate(examId ? 'removeArticleTerm' : 'removeTermAssociations', {
                termId: item.id,
                ...(examId ? { articleId: global.AppData.vocab.readingModel.articleId(source, String(examId)) } : {})
            });
            return true;
        },

        async clear(examId = null, source = DEFAULT_SOURCE) {
            await this.mutate(examId ? 'clearArticle' : 'clearReading', examId
                ? { articleId: global.AppData.vocab.readingModel.articleId(source, String(examId)) } : {});
            return true;
        },


        cleanWord(str) {
            if (!str) return '';
            return str
                .replace(/^[\s"'“”‘’(（[<{《/\\#]+|[\s"'“”‘’）)\]>}》,.:;!?！？，。；：/\\#]+$/g, '')
                .trim();
        },

        exportTxt(examId = null, customFilename = null, fallbackTitle = '', source = DEFAULT_SOURCE) {
            const list = examId ? this.getByExam(examId, source) : this.getAll();
            if (!list || list.length === 0) {
                return false;
            }

            // 只需要单词，不需要例句和其他内容，且每个单词一行（自动去重）
            const words = [];
            const seen = new Set();
            list.forEach(item => {
                const raw = typeof item === 'string' ? item : item?.word;
                const w = (raw || '').trim();
                if (w && !seen.has(w.toLowerCase())) {
                    seen.add(w.toLowerCase());
                    words.push(w);
                }
            });

            if (words.length === 0) {
                return false;
            }

            let filename = customFilename;
            if (!filename) {
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${day}`;

                const rawTitle = fallbackTitle || list[0]?.examTitle || examId || '生词本';
                const safeTitle = String(rawTitle).replace(/[\\/:*?"<>|]/g, '_').trim();
                filename = `${dateStr}_${safeTitle}.txt`;
            }

            const content = words.join('\n');
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return true;
        },

        async init() {
            this.bindCommitListener();
            return this.reload();
        },

        bindCommitListener() {
            if (this._commitBound || !global.AppData?.backups?.onDataCommitted) return;
            this._commitBound = true;
            global.AppData.backups.onDataCommitted(event => {
                if (!event?.targets?.some(target => target.logicalKey?.startsWith('vocab.'))) return;
                this.reload().catch(error => {
                    console.warn('[ReadingVocabStore] Unable to refresh committed data:', error);
                    if (global.ReadingVocabReader?.currentExamId) {
                        global.ReadingVocabReader.showToast('数据刷新失败，请重新打开生词本重试');
                    }
                });
            });
        }
    };

    // ============================================================================
    // 语音朗读
    // ============================================================================
    function speakWord(word) {
        if (!('speechSynthesis' in window) || !word) {
            return;
        }
        try {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(word);
            utterance.lang = 'en-US';
            utterance.rate = 0.9;
            window.speechSynthesis.speak(utterance);
        } catch (e) {
            console.warn('[ReadingVocabReader] 朗读失败:', e);
        }
    }

    // ============================================================================
    // 异步加载试卷与解析数据
    // ============================================================================
    function getExamRegistry() {
        const root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : global);
        if (!root.__READING_EXAM_DATA__ || typeof root.__READING_EXAM_DATA__.register !== 'function') {
            const store = new Map();
            function deepClone(value) {
                if (value == null) return value;
                return JSON.parse(JSON.stringify(value));
            }
            root.__READING_EXAM_DATA__ = {
                register(id, payload) {
                    if (!id || !payload || typeof payload !== 'object') {
                        throw new Error('reading_exam_payload_invalid');
                    }
                    store.set(String(id), deepClone(payload));
                },
                get(id) {
                    if (!id) return null;
                    return store.has(String(id)) ? deepClone(store.get(String(id))) : null;
                },
                has(id) {
                    return !!id && store.has(String(id));
                },
                keys() {
                    return Array.from(store.keys());
                },
                clear() {
                    store.clear();
                }
            };
        }
        return root.__READING_EXAM_DATA__;
    }

    function getExplanationRegistry() {
        const root = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : global);
        if (!root.__READING_EXPLANATION_DATA__ || typeof root.__READING_EXPLANATION_DATA__.register !== 'function') {
            const store = new Map();
            function deepClone(value) {
                if (value == null) return value;
                return JSON.parse(JSON.stringify(value));
            }
            root.__READING_EXPLANATION_DATA__ = {
                register(id, payload) {
                    if (!id || !payload || typeof payload !== 'object') {
                        throw new Error('reading_explanation_payload_invalid');
                    }
                    store.set(String(id), deepClone(payload));
                },
                get(id) {
                    if (!id) return null;
                    return store.has(String(id)) ? deepClone(store.get(String(id))) : null;
                },
                has(id) {
                    return !!id && store.has(String(id));
                },
                keys() {
                    return Array.from(store.keys());
                },
                clear() {
                    store.clear();
                }
            };
        }
        return root.__READING_EXPLANATION_DATA__;
    }

    async function loadReadingExamPayload(examId) {
        if (!examId) return null;

        const examRegistry = getExamRegistry();
        const manifest = (typeof window !== 'undefined' && window.__READING_EXAM_MANIFEST__) || global.__READING_EXAM_MANIFEST__ || {};
        const entry = manifest[examId] || Object.values(manifest).find(e => e && (e.examId === examId || e.dataKey === examId || e.id === examId));

        // 1. 检查已注册数据
        if (examRegistry && typeof examRegistry.get === 'function') {
            const cached = examRegistry.get(examId) || (entry && (examRegistry.get(entry.dataKey) || examRegistry.get(entry.examId)));
            if (cached) return cached;
        }

        // 2. 检查 manifest
        if (!entry || !entry.script) {
            console.warn('[ReadingVocabReader] 未找到试卷元信息:', examId);
            return null;
        }

        const isExamPage = typeof window !== 'undefined' && window.location && window.location.pathname.includes('/reading-exams/');
        let scriptSrc;
        if (isExamPage) {
            scriptSrc = entry.script.startsWith('./') ? entry.script : `./${entry.script}`;
        } else {
            scriptSrc = `assets/generated/reading-exams/${entry.script.replace(/^\.\//, '')}`;
        }

        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = scriptSrc;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load reading exam: ' + scriptSrc));
            document.head.appendChild(script);
        });

        const registryAfterLoad = getExamRegistry();
        return registryAfterLoad.get(examId) || (entry && (registryAfterLoad.get(entry.dataKey) || registryAfterLoad.get(entry.examId))) || null;
    }

    async function loadReadingExplanationPayload(examId) {
        if (!examId) return null;

        const expRegistry = getExplanationRegistry();
        const isExamPage = typeof window !== 'undefined' && window.location && window.location.pathname.includes('/reading-exams/');

        // 确保 explanation manifest 存在
        if (!global.__READING_EXPLANATION_MANIFEST__ && !(typeof window !== 'undefined' && window.__READING_EXPLANATION_MANIFEST__)) {
            const manifestSrc = isExamPage ? '../reading-explanations/manifest.js' : 'assets/generated/reading-explanations/manifest.js';
            try {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = manifestSrc;
                    script.onload = () => resolve();
                    script.onerror = () => resolve();
                    document.head.appendChild(script);
                });
            } catch (_) {}
        }

        const expManifest = (typeof window !== 'undefined' && window.__READING_EXPLANATION_MANIFEST__) || global.__READING_EXPLANATION_MANIFEST__ || {};
        const entry = expManifest[examId] || Object.values(expManifest).find(e => e && (e.examId === examId || e.dataKey === examId || e.id === examId));

        if (expRegistry && typeof expRegistry.get === 'function') {
            const cached = expRegistry.get(examId) || (entry && (expRegistry.get(entry.dataKey) || expRegistry.get(entry.examId)));
            if (cached) return cached;
        }

        if (!entry || !entry.script) {
            return null;
        }

        try {
            const cleanScript = entry.script.replace(/^(\.\/|\.\.\/reading-explanations\/)/, '');
            const scriptSrc = isExamPage
                ? `../reading-explanations/${cleanScript}`
                : `assets/generated/reading-explanations/${cleanScript}`;
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = scriptSrc;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error('Failed to load explanation'));
                document.head.appendChild(script);
            });
            const expRegistryAfterLoad = getExplanationRegistry();
            return expRegistryAfterLoad.get(examId) || (entry && (expRegistryAfterLoad.get(entry.dataKey) || expRegistryAfterLoad.get(entry.examId))) || null;
        } catch (e) {
            return null;
        }
    }

    // ============================================================================
    // 阅读文本与段落清洗器
    // ============================================================================
    // Content and Range rules are shared with the real-browser regression suite.
    function getTextNodes(root) { return global.ReadingVocabAnchors.textNodes(root); }

    // ============================================================================
    // Parse in an inert template: even a pre-checked radio must never join a
    // live practice answer group while the reader content is being prepared.
    function createReadOnlyQuestionContent(html, namespace) {
        const template = document.createElement('template');
        template.innerHTML = html || '';
        const content = template.content;
        content.querySelectorAll('script, style, link, iframe, object, embed, template').forEach(node => node.remove());

        const identities = new Map();
        content.querySelectorAll('[id]').forEach((node, index) => {
            const originalId = node.id;
            node.id = `${namespace}-content-${index + 1}`;
            if (!identities.has(originalId)) identities.set(originalId, node.id);
        });

        content.querySelectorAll('*').forEach(node => {
            for (const attribute of [...node.attributes]) {
                const name = attribute.name.toLowerCase();
                if (name.startsWith('on') || name.startsWith('data-') || [
                    'name', 'form', 'for', 'list', 'href', 'xlink:href', 'action', 'formaction',
                    'contenteditable', 'draggable', 'tabindex', 'autofocus', 'accesskey', 'role',
                    'aria-controls', 'aria-activedescendant', 'aria-checked', 'aria-selected'
                ].includes(name)) {
                    node.removeAttribute(attribute.name);
                }
            }
            ['aria-labelledby', 'aria-describedby', 'headers'].forEach(name => {
                if (!node.hasAttribute(name)) return;
                const references = node.getAttribute(name).split(/\s+/).map(id => identities.get(id)).filter(Boolean);
                if (references.length) node.setAttribute(name, references.join(' '));
                else node.removeAttribute(name);
            });
            // Drop practice drag/drop hooks but retain the surrounding layout.
            ['dropzone', 'match-dropzone', 'paragraph-dropzone', 'drop-target-summary'].forEach(className => {
                if (!node.classList.contains(className)) return;
                node.classList.remove(className);
                if (!node.textContent.trim()) {
                    node.textContent = '________';
                    node.classList.add('vocab-answer-blank');
                }
            });
            ['drag-item', 'draggable-word', 'card'].forEach(className => {
                if (node.classList.contains(className)) {
                    node.classList.remove(className);
                    node.classList.add('vocab-question-option');
                }
            });
            ['pool-items', 'options-pool', 'option-pool', 'cardpool', 'headings-pool', 'pool'].forEach(className => {
                if (node.classList.contains(className)) {
                    node.classList.remove(className);
                    node.classList.add('vocab-question-pool');
                }
            });
        });

        content.querySelectorAll('input, textarea, select, button').forEach(control => {
            const type = (control.getAttribute('type') || '').toLowerCase();
            if (['hidden', 'submit', 'reset', 'image'].includes(type) ||
                (control.tagName === 'BUTTON' && (!type || type === 'submit'))) {
                control.remove();
                return;
            }
            const replacement = document.createElement('span');
            if (control.id) replacement.id = control.id;
            replacement.className = 'vocab-answer-blank';
            if (control.tagName === 'SELECT') {
                replacement.className = 'vocab-question-options';
                replacement.textContent = [...control.options].map(option => option.textContent.trim()).filter(Boolean).join(' / ');
            } else if (control.tagName === 'BUTTON') {
                replacement.textContent = control.textContent;
            } else if (type === 'radio' || type === 'checkbox') {
                replacement.textContent = type === 'radio' ? '○' : '□';
                replacement.setAttribute('aria-hidden', 'true');
            } else {
                replacement.textContent = '________';
                replacement.setAttribute('aria-label', 'Answer blank');
            }
            control.replaceWith(replacement);
        });
        content.querySelectorAll('label, form, fieldset, legend, a').forEach(node => {
            const replacement = document.createElement(['FORM', 'FIELDSET'].includes(node.tagName) ? 'div' : 'span');
            for (const attribute of [...node.attributes]) replacement.setAttribute(attribute.name, attribute.value);
            replacement.append(...node.childNodes);
            node.replaceWith(replacement);
        });
        return content;
    }

    // 阅读器主控制器 (ReadingVocabReader)
    // ============================================================================
    const ReadingVocabReader = {
        currentExamId: null,
        currentSource: DEFAULT_SOURCE,
        currentExam: null,
        currentPayload: null,
        currentExplanation: null,
        activeTab: 'all', // 'all', 'questions', or paragraph letter e.g. 'A'
        showTranslation: false,
        modalTab: 'current', // 'current' or 'all'
        modalOpen: false,
        toastTimer: null,
        _openRequestId: 0,
        _eventOverlay: null,
        _eventCleanups: [],
        _pendingTimers: new Set(),
        _returnFocus: null,
        _modalReturnFocus: null,
        // Durable writes survive closing/reopening; release only when they settle.
        _selectionPending: new Set(),
        _undoOccurrence: null,
        _occurrenceBusy: false,
        unresolvedOccurrences: [],

        clearPendingWork(overlay) {
            this._pendingTimers.forEach(timer => clearTimeout(timer));
            this._pendingTimers.clear();
            this.toastTimer = null;
            this._undoOccurrence = null;
            this.unresolvedOccurrences = [];
            this._occurrenceBusy = false;
            overlay?.querySelector('#vocab-occurrence-actions')?.replaceChildren();
            overlay?.querySelector('#vocab-occurrence-undo')?.replaceChildren();
            overlay?.querySelector('#vocab-anchor-status')?.replaceChildren();
            const toast = overlay?.querySelector('#vocab-toast');
            if (toast) {
                toast.classList.remove('show');
                toast.textContent = '';
            }
            overlay?.querySelectorAll('.vocab-highlight--pulse').forEach(mark => mark.classList.remove('vocab-highlight--pulse'));
            const selection = window.getSelection();
            if (selection && overlay?.contains(selection.anchorNode)) selection.removeAllRanges();
        },

        defer(callback, delay) {
            const requestId = this._openRequestId;
            const timer = setTimeout(() => {
                if (!this._pendingTimers.delete(timer) || requestId !== this._openRequestId) return;
                callback();
            }, delay);
            this._pendingTimers.add(timer);
            return timer;
        },

        unbindEvents() {
            this._eventCleanups.splice(0).forEach(cleanup => cleanup());
            this._eventOverlay = null;
        },

        ensureOverlay() {
            let overlay = document.getElementById('reading-vocab-reader-overlay');
            if (overlay) {
                return overlay;
            }

            overlay = document.createElement('div');
            overlay.id = 'reading-vocab-reader-overlay';
            overlay.className = 'vocab-reader-overlay is-hidden';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-label', '阅读生词本');
            overlay.setAttribute('aria-hidden', 'true');

            overlay.innerHTML = `
                <div class="vocab-reader-container">
                    <!-- 顶部吸顶导航栏 -->
                    <header class="vocab-reader-header">
                        <div class="vocab-reader-header__left">
                            <button type="button" class="vocab-reader-back-btn" id="vocab-reader-back-btn" title="返回题库浏览">
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
                                    <path d="M19 12H5M12 19l-7-7 7-7"/>
                                </svg>
                                <span>返回</span>
                            </button>
                            <div class="vocab-reader-title-wrap">
                                <h2 class="vocab-reader-title" id="vocab-reader-title">阅读文章与题目</h2>
                                <div class="vocab-reader-badges" id="vocab-reader-badges"></div>
                            </div>
                        </div>

                        <div class="vocab-reader-header__center">
                            <div class="vocab-reader-tabs" id="vocab-reader-tabs" role="tablist">
                                <!-- 动态插入段落与题目标签，完全平铺陈列展开 -->
                            </div>
                        </div>
                    </header>

                    <!-- 沉浸式提示栏 -->
                    <div class="vocab-reader-banner">
                        <span class="vocab-banner-icon">✨</span>
                        <span class="vocab-banner-text"><strong>划词即收录</strong>：在文章或题目中用鼠标、触屏或 Shift＋方向键选择生词或短语（最多 45 字符）。保存后以<strong>黄色高亮</strong>标注；点击高亮可移除这一处。</span>
                    </div>

                    <!-- 独立滚动主体区域（确保顶部 header 永远固定在视口顶部） -->
                    <div class="vocab-reader-scroll-area" id="vocab-reader-scroll-area">
                        <!-- 阅读核心主内容区 -->
                        <main class="vocab-reader-body" id="vocab-reader-body" data-vocab-source-root>
                            <!-- 文章区域 -->
                            <section class="vocab-passage-section" id="vocab-passage-section">
                                <div class="vocab-passage-header">
                                    <h3 class="vocab-passage-title" id="vocab-passage-title">Reading Passage</h3>
                                    <div class="vocab-passage-intro" id="vocab-passage-intro"></div>
                                </div>
                                <div class="vocab-passage-content" id="vocab-passage-content">
                                    <!-- 段落内容 -->
                                </div>
                            </section>

                            <!-- 题目区域 -->
                            <section class="vocab-questions-section" id="vocab-questions-section">
                                <div class="vocab-questions-header">
                                    <h3 class="vocab-questions-title">📝 题目与问题 (Questions)</h3>
                                    <p class="vocab-questions-subtitle">题目中的生词同样支持划词自动收录</p>
                                </div>
                                <div class="vocab-questions-content" id="vocab-questions-content">
                                    <!-- 题目内容 -->
                                </div>
                            </section>
                        </main>
                    </div>

                    <!-- 悬浮生词本 FAB 按钮 -->
                    <div class="vocab-fab" id="vocab-fab" role="button" tabindex="0" title="打开生词本">
                        <span class="vocab-fab-icon">📝</span>
                        <span class="vocab-fab-label">生词本</span>
                        <span class="vocab-fab-count" id="vocab-fab-count">0</span>
                    </div>

                    <!-- 划词收录 Toast 提示 -->
                    <div class="vocab-toast-msg" id="vocab-toast" role="status" aria-live="polite"></div>
                    <div class="vocab-occurrence-actions" id="vocab-occurrence-actions" aria-live="polite"></div>
                    <div class="vocab-occurrence-undo" id="vocab-occurrence-undo" role="status" aria-live="polite"></div>
                    <div class="vocab-anchor-status" id="vocab-anchor-status" role="status" aria-live="polite"></div>

                    <!-- 生词本弹窗 Modal -->
                    <div class="vocab-modal" id="vocab-modal" role="dialog" aria-modal="true" aria-hidden="true">
                        <div class="vocab-modal-content">
                            <div class="vocab-modal-header">
                                <div class="vocab-modal-title-wrap">
                                    <h3>📖 我的生词本</h3>
                                    <div class="vocab-modal-tabs">
                                        <button type="button" class="v-tab-btn active" id="v-tab-current">本篇 (<span id="v-count-current">0</span>)</button>
                                        <button type="button" class="v-tab-btn" id="v-tab-all">全部 (<span id="v-count-all">0</span>)</button>
                                    </div>
                                </div>
                                <div class="vocab-modal-header-actions">
                                    <button type="button" class="vocab-modal-bookshelf-btn" id="vocab-modal-bookshelf-btn" title="查看阅读书架">📚 书架</button>
                                    <button type="button" class="vocab-modal-close" id="vocab-modal-close" title="关闭">✖</button>
                                </div>
                            </div>

                            <!-- 手动添加生词栏 -->
                            <div class="vocab-modal-add-row">
                                <input type="text" id="vocab-manual-input" placeholder="手动添加生词..." maxlength="50" />
                                <button type="button" id="vocab-manual-add-btn">收录</button>
                            </div>

                            <!-- 生词列表 -->
                            <div class="vocab-list" id="vocab-list">
                                <!-- 动态插入 -->
                            </div>

                            <!-- 底部操作栏 -->
                            <div class="vocab-modal-footer">
                                <button type="button" class="v-action-btn v-export-btn" id="vocab-export-btn">
                                    <span>⬇️ 导出为 TXT</span>
                                </button>
                                <button type="button" class="v-action-btn v-clear-btn" id="vocab-clear-btn">
                                    <span>🗑️ 清空生词</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);
            this.bindEvents(overlay);
            return overlay;
        },

        bindEvents(overlay) {
            if (this._eventOverlay === overlay) return;
            this.unbindEvents();
            this._eventOverlay = overlay;
            const on = (element, type, callback, options) => {
                element.addEventListener(type, callback, options);
                this._eventCleanups.push(() => element.removeEventListener(type, callback, options));
            };
            // 返回按钮
            const backBtn = overlay.querySelector('#vocab-reader-back-btn');
            if (backBtn) {
                on(backBtn, 'click', () => this.close());
            }

            // 开启生词本弹窗
            const openModalBtn = overlay.querySelector('#vocab-open-modal-btn');
            const fab = overlay.querySelector('#vocab-fab');
            if (openModalBtn) {
                on(openModalBtn, 'click', () => this.openModal());
            }
            if (fab) {
                on(fab, 'click', () => this.openModal());
                on(fab, 'keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        this.openModal();
                    }
                });
            }

            // 关闭生词本弹窗
            const closeModalBtn = overlay.querySelector('#vocab-modal-close');
            const modal = overlay.querySelector('#vocab-modal');
            if (closeModalBtn) {
                on(closeModalBtn, 'click', () => this.closeModal());
            }
            if (modal) {
                on(modal, 'click', (e) => {
                    if (e.target === modal) {
                        this.closeModal();
                    }
                });
            }

            // 前往阅读书架
            const bookshelfBtn = overlay.querySelector('#vocab-modal-bookshelf-btn');
            if (bookshelfBtn) {
                on(bookshelfBtn, 'click', () => {
                    this.closeModal();
                    this.close();
                    if (global.opener && !global.opener.closed) {
                        try {
                            if (global.opener.BookshelfView && typeof global.opener.BookshelfView.mount === 'function') {
                                global.opener.BookshelfView.mount('#bookshelf-view');
                            }
                            if (global.opener.app && typeof global.opener.app.navigateToView === 'function') {
                                global.opener.app.navigateToView('bookshelf');
                                global.opener.focus();
                                return;
                            } else if (typeof global.opener.switchView === 'function') {
                                global.opener.switchView('bookshelf');
                                global.opener.focus();
                                return;
                            }
                        } catch (_) {}
                    }
                    if (global.BookshelfView && typeof global.BookshelfView.mount === 'function') {
                        global.BookshelfView.mount('#bookshelf-view');
                    }
                    if (global.app && typeof global.app.navigateToView === 'function') {
                        global.app.navigateToView('bookshelf');
                    } else if (typeof global.switchView === 'function') {
                        global.switchView('bookshelf');
                    }
                });
            }

            // 生词本切换标签 (本篇 / 全部)
            const tabCurrent = overlay.querySelector('#v-tab-current');
            const tabAll = overlay.querySelector('#v-tab-all');
            if (tabCurrent) {
                on(tabCurrent, 'click', () => {
                    this.modalTab = 'current';
                    tabCurrent.classList.add('active');
                    tabAll.classList.remove('active');
                    this.renderVocabList();
                });
            }
            if (tabAll) {
                on(tabAll, 'click', () => {
                    this.modalTab = 'all';
                    tabAll.classList.add('active');
                    tabCurrent.classList.remove('active');
                    this.renderVocabList();
                });
            }

            const readerTabs = overlay.querySelector('#vocab-reader-tabs');
            if (readerTabs) {
                on(readerTabs, 'click', event => {
                    const button = event.target.closest('.vocab-tab-btn');
                    if (button && readerTabs.contains(button)) this.switchViewTab(button.dataset.para);
                });
            }

            const vocabList = overlay.querySelector('#vocab-list');
            if (vocabList) {
                on(vocabList, 'click', async event => {
                    const speakButton = event.target.closest('.vocab-speak-btn');
                    const deleteButton = event.target.closest('.vocab-delete-btn');
                    if (speakButton && vocabList.contains(speakButton)) {
                        event.stopPropagation();
                        speakWord(speakButton.dataset.speakWord);
                    } else if (deleteButton && vocabList.contains(deleteButton)) {
                        event.stopPropagation();
                        if (deleteButton.disabled) return;
                        const requestId = this._openRequestId;
                        const id = deleteButton.dataset.delId;
                        const item = ReadingVocabStore.getAll().find(word => word.id === id);
                        const word = item?.word;
                        deleteButton.disabled = true;
                        this.showToast('正在保存…');
                        try {
                            await ReadingVocabStore.remove(id, this.modalTab === 'current' ? this.currentExamId : null, this.currentSource);
                            if (requestId !== this._openRequestId) return;
                            this.updateCounts();
                            this.renderVocabList();
                            if (word) this.removeVocabHighlightForWord(word);
                            this.showToast('已从生词本删除');
                        } catch (error) {
                            if (requestId === this._openRequestId) this.showSaveError(error, '删除失败，请再次点击删除重试');
                        } finally {
                            deleteButton.disabled = false;
                        }
                    }
                });
            }

            // 手动收录
            const manualInput = overlay.querySelector('#vocab-manual-input');
            const manualAddBtn = overlay.querySelector('#vocab-manual-add-btn');
            const handleManualAdd = async () => {
                if (!manualInput || manualAddBtn?.disabled || !this.currentPayload) return;
                const val = manualInput.value.trim();
                if (!val) return;
                const requestId = this._openRequestId;
                if (manualAddBtn) manualAddBtn.disabled = true;
                this.showToast('正在保存…');
                try {
                    const result = await ReadingVocabStore.add(
                        val,
                        this.currentExamId,
                        this.currentExam?.title || '',
                        '', null, this.currentSource
                    );
                    if (requestId !== this._openRequestId) return;
                    if (result.added) {
                        manualInput.value = '';
                        this.updateCounts();
                        this.renderVocabList();
                        this.showToast(result.isDuplicate ? `"${val}" 已在生词本中` : `✅ "${val}" 已收录`);
                    } else {
                        this.showToast('未保存，请检查输入后重试');
                    }
                } catch (error) {
                    if (requestId === this._openRequestId) this.showSaveError(error, '保存失败，请再次点击收录重试');
                } finally {
                    if (manualAddBtn) manualAddBtn.disabled = false;
                }
            };
            if (manualAddBtn) {
                on(manualAddBtn, 'click', handleManualAdd);
            }
            if (manualInput) {
                on(manualInput, 'keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        handleManualAdd();
                    }
                });
            }

            // 导出与清空
            const exportBtn = overlay.querySelector('#vocab-export-btn');
            if (exportBtn) {
                on(exportBtn, 'click', () => {
                    const isCurrent = this.modalTab === 'current';
                    const examId = isCurrent ? this.currentExamId : null;

                    const now = new Date();
                    const year = now.getFullYear();
                    const month = String(now.getMonth() + 1).padStart(2, '0');
                    const day = String(now.getDate()).padStart(2, '0');
                    const dateStr = `${year}-${month}-${day}`;

                    // 当前文章名字
                    const rawArticleName = (this.currentExam?.title || this.examData?.title || (isCurrent ? '当前文章' : '全部生词'));
                    const safeArticleName = String(rawArticleName).replace(/[\\/:*?"<>|]/g, '_').trim();
                    const filename = `${dateStr}_${safeArticleName}.txt`;

                    const success = ReadingVocabStore.exportTxt(examId, filename, safeArticleName, this.currentSource);
                    if (success) {
                        this.showToast(`✅ 已导出：${filename}`);
                    } else {
                        this.showToast('⚠️ 当前生词本为空，暂无可导出内容');
                    }
                });
            }

            const clearBtn = overlay.querySelector('#vocab-clear-btn');
            if (clearBtn) {
                on(clearBtn, 'click', async () => {
                    if (clearBtn.disabled) return;
                    const requestId = this._openRequestId;
                    const isCurrent = this.modalTab === 'current';
                    const examId = isCurrent ? this.currentExamId : null;
                    const count = isCurrent
                        ? ReadingVocabStore.getByExam(this.currentExamId, this.currentSource).length
                        : ReadingVocabStore.getAll().length;

                    if (count === 0) {
                        this.showToast('生词本已经是空的了');
                        return;
                    }

                    clearBtn.disabled = true;
                    this.showToast('正在保存…');
                    try {
                        await ReadingVocabStore.clear(examId, this.currentSource);
                        if (requestId !== this._openRequestId) return;
                        this.updateCounts();
                        this.renderVocabList();
                        const passageContent = overlay.querySelector('#vocab-passage-content');
                        const questionsContent = overlay.querySelector('#vocab-questions-content');
                        this.removeVocabHighlights(passageContent);
                        this.removeVocabHighlights(questionsContent);
                        this.showToast(isCurrent ? '✅ 本篇生词已清空' : '✅ 全部生词已清空');
                    } catch (error) {
                        if (requestId === this._openRequestId) this.showSaveError(error, '清空失败，请再次点击清空重试');
                    } finally {
                        clearBtn.disabled = false;
                    }
                });
            }

            const readerBody = overlay.querySelector('#vocab-reader-body');
            if (readerBody) {
                const capture = event => {
                    if (event?.target?.closest('button, input, textarea, select, .vocab-translation-card, .vocab-paragraph-tag')) return;
                    this.defer(() => this.captureSelection(), 20);
                };
                on(readerBody, 'mouseup', capture);
                on(readerBody, 'touchend', capture);
                on(overlay, 'keyup', event => {
                    if (event.key === 'Shift') capture(event);
                });
                on(readerBody, 'click', event => {
                    const mark = event.target.closest('mark.vocab-highlight');
                    if (mark && !window.getSelection()?.toString().trim()) this.showOccurrenceActions(mark);
                });
                on(readerBody, 'keydown', event => {
                    const mark = event.target.closest('mark.vocab-highlight');
                    if (mark && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        this.showOccurrenceActions(mark);
                    } else {
                        this.moveKeyboardSelection(event);
                    }
                });
            }
            on(overlay, 'click', event => {
                const button = event.target.closest('[data-action]');
                if (!button || button.disabled) return;
                if (button.dataset.action === 'remove-occurrence') {
                    event.stopPropagation();
                    this.removeOccurrence(button.dataset.occurrenceId);
                } else if (button.dataset.action === 'undo-occurrence') {
                    this.undoOccurrence();
                } else if (button.dataset.action === 'retry-anchors') {
                    this.open(this.currentExamId, { source: this.currentSource });
                }
            });

            // ESC 键监听
            on(window, 'keydown', (e) => {
                if (e.key === 'Escape' && !overlay.classList.contains('is-hidden')) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (this.modalOpen) {
                        this.closeModal();
                    } else if (overlay && !overlay.classList.contains('is-hidden')) {
                        this.close();
                    }
                }
            }, true);
        },

        async open(examId, options = {}) {
            if (!examId) return;

            const overlay = this.ensureOverlay();
            const requestId = ++this._openRequestId;
            const initiatingElement = options.returnFocus || document.activeElement;
            if (initiatingElement && !overlay.contains(initiatingElement)) this._returnFocus = initiatingElement;
            this.unbindEvents();
            this.bindEvents(overlay);
            this.clearPendingWork(overlay);
            this.currentExamId = examId;
            this.currentExam = null;
            this.currentPayload = null;
            this.currentExplanation = null;
            this.closeModal(false);
            this.modalTab = 'current';
            overlay.querySelector('#v-tab-current')?.classList.add('active');
            overlay.querySelector('#v-tab-all')?.classList.remove('active');
            const manualInput = overlay.querySelector('#vocab-manual-input');
            if (manualInput) manualInput.value = '';

            // 根据来源动态调整返回按钮提示
            const backBtn = overlay.querySelector('#vocab-reader-back-btn');
            const backBtnText = overlay.querySelector('#vocab-reader-back-btn span');
            if (options && options.fromPractice) {
                if (backBtnText) backBtnText.textContent = '返回练习';
                if (backBtn) backBtn.title = '返回练习试卷';
            } else {
                if (backBtnText) backBtnText.textContent = '返回题库';
                if (backBtn) backBtn.title = '返回题库浏览';
            }

            // 显示加载状态
            overlay.classList.remove('is-hidden');
            overlay.setAttribute('aria-hidden', 'false');
            document.body.classList.add('vocab-reader-open');
            backBtn?.focus({ preventScroll: true });

            const titleEl = overlay.querySelector('#vocab-reader-title');
            const badgesEl = overlay.querySelector('#vocab-reader-badges');
            const passageContent = overlay.querySelector('#vocab-passage-content');
            const questionsContent = overlay.querySelector('#vocab-questions-content');

            if (titleEl) titleEl.textContent = '正在加载试卷全文...';
            if (badgesEl) badgesEl.innerHTML = '';
            if (passageContent) passageContent.innerHTML = '<div class="vocab-loading-spinner">正在解析文章结构与题目...</div>';
            if (questionsContent) questionsContent.innerHTML = '';
            ['#vocab-passage-title', '#vocab-passage-intro', '#vocab-reader-tabs'].forEach(selector => {
                const element = overlay.querySelector(selector);
                if (element) element.textContent = '';
            });
            this.switchViewTab('all');

            try {
                // 加载试卷数据
                const source = await ReadingVocabStore.resolveSource(options);
                if (requestId !== this._openRequestId) return;
                this.currentSource = source;
                const payload = await loadReadingExamPayload(examId);
                if (requestId !== this._openRequestId) return;
                if (!payload) {
                    throw new Error('未找到该试卷的数据文件');
                }
                // The current payload registry contains only built-in generated
                // content. Never attach that content to a different library.
                if (source.kind !== 'builtin' || source.id !== 'default') {
                    throw new Error('此来源的全文暂不可用，可在书架中查看或导出生词');
                }
                this.currentPayload = payload;
                this.currentSource = source;

                // 异步加载解析（不阻塞主内容）
                loadReadingExplanationPayload(examId).then(exp => {
                    if (requestId !== this._openRequestId) return;
                    this.currentExplanation = exp;
                    this.enhanceWithExplanation(exp);
                }).catch(() => {});

                // 获取 Exam Meta
                const manifest = global.__READING_EXAM_MANIFEST__ || {};
                const manifestEntry = manifest[examId] || {};
                this.currentExam = Object.assign({}, manifestEntry, payload.meta || {});

                // 记录至阅读书架
                const examTitle = this.currentExam.title || this.currentExam.name || examId;
                const examCategory = this.currentExam.category || this.currentExam.type || '雅思阅读';
                let saveError = null;
                try {
                    await ReadingVocabStore.init();
                    if (requestId !== this._openRequestId) return;
                    await recordBookshelfExamDirect(examId, examTitle, examCategory, source);
                } catch (error) {
                    saveError = error;
                }
                if (requestId !== this._openRequestId) return;

                // 渲染界面
                this.renderContent();
                this.updateCounts();
                if (saveError) this.showSaveError(saveError, '书架记录保存失败，请重新打开文章重试');
            } catch (err) {
                if (requestId !== this._openRequestId) return;
                console.error('[ReadingVocabReader] 加载失败:', err);
                this.currentPayload = null;
                await ReadingVocabStore.init().catch(() => {});
                if (requestId !== this._openRequestId) return;
                this.applyVocabHighlights();
                this.updateCounts();
                if (passageContent) {
                    const errorState = document.createElement('div');
                    errorState.className = 'vocab-error-state';
                    const message = document.createElement('p');
                    message.textContent = `⚠️ 载入文章数据失败：${err.message || '请检查网络或试卷配置'}`;
                    const retry = document.createElement('button');
                    retry.type = 'button';
                    retry.className = 'btn btn-primary';
                    retry.textContent = '重试';
                    const handleRetry = () => {
                        if (requestId === this._openRequestId && retry.isConnected && !overlay.classList.contains('is-hidden')) {
                            this.open(examId, options);
                        }
                    };
                    retry.addEventListener('click', handleRetry);
                    this._eventCleanups.push(() => retry.removeEventListener('click', handleRetry));
                    errorState.append(message, retry);
                    passageContent.replaceChildren(errorState);
                }
            }
        },

        renderContent() {
            const overlay = this.ensureOverlay();
            const exam = this.currentExam;
            const payload = this.currentPayload;

            // 标题与标签（紧凑精致）
            const titleEl = overlay.querySelector('#vocab-reader-title');
            const badgesEl = overlay.querySelector('#vocab-reader-badges');
            if (titleEl) {
                const titleText = exam.title || '阅读文章与题目';
                titleEl.textContent = titleText;
                titleEl.title = titleText;
            }
            if (badgesEl) {
                badgesEl.innerHTML = `
                    <span class="vocab-badge vocab-badge--cat">${escapeHtml(exam.category || '阅读')}</span>
                    ${exam.frequency ? `<span class="vocab-badge vocab-badge--freq">${escapeHtml(exam.frequency)}</span>` : ''}
                `;
            }

            // 解析文章大标题、考试指导语与真实段落
            const passageData = global.ReadingVocabContent.normalizePassage(payload?.passage, exam.title || '');
            const blocks = passageData.blocks;
            const instructionHtml = passageData.instructionHtml;
            const passageTitle = passageData.passageTitle || exam.title || 'Reading Passage';

            // 设置文章标题
            const passageTitleEl = overlay.querySelector('#vocab-passage-title');
            if (passageTitleEl) {
                passageTitleEl.textContent = passageTitle;
            }

            // 渲染前置说明指导语（如 "You should spend about 20 minutes on questions 1 to 30..."）
            // 关键：作为文章头部的说明提示条展现，不赋予任何段落标签（没有段落A标签）
            const passageIntroEl = overlay.querySelector('#vocab-passage-intro');
            if (passageIntroEl) {
                passageIntroEl.replaceChildren();
                if (instructionHtml) {
                    const instruction = document.createElement('div');
                    instruction.className = 'vocab-passage-instruction';
                    instruction.setAttribute('role', 'note');
                    instruction.appendChild(createReadOnlyQuestionContent(instructionHtml, 'vocab-passage-instruction'));
                    passageIntroEl.appendChild(instruction);
                }
                if (passageData.subtitleHtml) {
                    const subtitle = document.createElement('div');
                    subtitle.className = 'vocab-passage-subtitle';
                    subtitle.appendChild(createReadOnlyQuestionContent(passageData.subtitleHtml, 'vocab-passage-subtitle'));
                    passageIntroEl.appendChild(subtitle);
                }
                passageIntroEl.style.display = passageIntroEl.childNodes.length ? 'block' : 'none';
            }

            // 渲染顶部段落切换 Tabs（完全平铺展开：全文、Para A、Para B、Para C...与题目）
            const tabsContainer = overlay.querySelector('#vocab-reader-tabs');
            if (tabsContainer) {
                let tabsHtml = `<button type="button" class="vocab-tab-btn active" data-para="all">全文</button>`;
                blocks.forEach(b => {
                    tabsHtml += `<button type="button" class="vocab-tab-btn" data-para="${b.id}">Para ${b.letter}</button>`;
                });
                tabsHtml += `<button type="button" class="vocab-tab-btn vocab-tab-btn--questions" data-para="questions">📝 Questions</button>`;
                tabsContainer.innerHTML = tabsHtml;
            }

            // 渲染文章段落
            const passageContent = overlay.querySelector('#vocab-passage-content');
            if (passageContent) {
                if (blocks.length > 0) {
                    let passageHtml = '';
                    blocks.forEach(b => {
                        passageHtml += `
                            <div class="vocab-paragraph-card" id="vocab-card-${b.id}" data-paragraph-id="${b.id}" data-letter="${b.letter}">
                                <div class="vocab-paragraph-tag">
                                    <span class="vocab-para-letter">Para ${b.letter}</span>
                                </div>
                                <div class="vocab-paragraph-text" data-content-id="${b.id}"></div>
                                <div class="vocab-translation-card" id="vocab-trans-${b.id}" style="display: ${this.showTranslation ? 'block' : 'none'};">
                                    <div class="vocab-trans-label">中文参考译文：</div>
                                    <div class="vocab-trans-text" id="vocab-trans-text-${b.id}">加载中...</div>
                                </div>
                            </div>
                        `;
                    });
                    passageContent.innerHTML = passageHtml;
                    blocks.forEach(block => {
                        const text = passageContent.querySelector('[data-content-id="' + block.id + '"]');
                        text.appendChild(createReadOnlyQuestionContent(block.html, 'vocab-' + block.id));
                        this.assignTextScopes(text, 'passage/' + block.id);
                    });
                } else {
                    // 原生清洗后渲染
                    passageContent.innerHTML = '<p class="vocab-empty-tip">本篇暂无可用正文</p>';
                }
            }

            // 渲染题目
            const questionsContent = overlay.querySelector('#vocab-questions-content');
            if (questionsContent) {
                const questionGroups = payload?.questionGroups || [];
                if (questionGroups.length > 0) {
                    const groups = document.createDocumentFragment();
                    questionGroups.forEach((g, idx) => {
                        const group = document.createElement('div');
                        group.className = 'vocab-question-group';
                        group.id = `vocab-qgroup-${idx + 1}`;
                        group.dataset.sectionId = 'q-' + (idx + 1);
                        const html = (g.leadHtml || '') + (g.bodyHtml || g.html || '');
                        group.appendChild(createReadOnlyQuestionContent(html, group.id));
                        this.assignTextScopes(group, 'questions/q-' + (idx + 1), true);
                        groups.appendChild(group);
                    });
                    questionsContent.replaceChildren(groups);
                } else {
                    questionsContent.innerHTML = '<p class="vocab-empty-tip">本篇无额外题目数据</p>';
                }
            }

            // 如果已有解析数据，填充中文译文
            if (this.currentExplanation) {
                this.enhanceWithExplanation(this.currentExplanation);
            }

            // 应用生词黄色高亮
            this.applyVocabHighlights();
        },

        assignTextScopes(root, prefix, alwaysNumber = false) {
            const boundaries = 'p, li, td, th, dt, dd, h1, h2, h3, h4, h5, h6, blockquote, div, section, table, ul, ol';
            const scopes = [];
            const visit = element => {
                if (!element.querySelector(boundaries)) {
                    if (global.ReadingVocabAnchors.text(element).trim()) scopes.push(element);
                    return;
                }
                let run = [];
                const flush = () => {
                    if (!run.length) return;
                    if (run.some(node => node.textContent.trim())) {
                        const span = document.createElement('span');
                        element.insertBefore(span, run[0]);
                        span.append(...run);
                        scopes.push(span);
                    }
                    run = [];
                };
                [...element.childNodes].forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE && (node.matches(boundaries) || node.querySelector(boundaries))) {
                        flush();
                        visit(node);
                    } else run.push(node);
                });
                flush();
            };
            visit(root);
            scopes.forEach((scope, index) => {
                scope.dataset.vocabScope = alwaysNumber || scopes.length > 1 ? prefix + '/p-' + (index + 1) : prefix;
                scope.dataset.vocabSourceVersion = global.ReadingVocabAnchors.hashText(JSON.stringify(this.currentPayload));
                scope.tabIndex = 0;
            });
        },

        calculateRangeLocation(scopeElement, range) {
            return global.ReadingVocabAnchors.calculateLocation(scopeElement, range);
        },

        moveKeyboardSelection(event) {
            if (this.modalOpen || !/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End)$/.test(event.key)) return;
            const scope = event.target.closest('[data-vocab-scope]');
            if (!scope || event.target.closest('button, input, textarea, select, [role="button"]')) return;
            const selection = window.getSelection();
            if (!selection || typeof selection.modify !== 'function') return;
            const nodes = getTextNodes(scope);
            if (!nodes.length) return;
            if (!scope.contains(selection.anchorNode) || !scope.contains(selection.focusNode)) {
                selection.collapse(nodes[0], 0);
            }
            const previous = { anchor: selection.anchorNode, start: selection.anchorOffset,
                focus: selection.focusNode, end: selection.focusOffset };
            const forward = /^(ArrowRight|ArrowDown|End)$/.test(event.key);
            let unit = /^(ArrowUp|ArrowDown)$/.test(event.key) ? 'line' : 'character';
            if (event.ctrlKey || event.metaKey) unit = 'word';
            if (event.key === 'Home' || event.key === 'End') unit = 'lineboundary';
            event.preventDefault();
            // Static selectable text has no native caret navigation in some
            // supported browsers unless their global caret-browsing mode is on.
            selection.modify(event.shiftKey ? 'extend' : 'move', forward ? 'forward' : 'backward', unit);
            if (!scope.contains(selection.anchorNode) || !scope.contains(selection.focusNode)) {
                selection.setBaseAndExtent(previous.anchor, previous.start, previous.focus, previous.end);
            }
        },

        async captureSelection() {
            const overlay = this.ensureOverlay();
            if (overlay.classList.contains('is-hidden') || this.modalOpen || !this.currentPayload) return;
            const selection = window.getSelection();
            if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return;
            const range = selection.getRangeAt(0);
            const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
            const scope = start?.closest('[data-vocab-scope]');
            if (!scope || !overlay.querySelector('#vocab-reader-body')?.contains(scope)) return;
            const captured = global.ReadingVocabAnchors.capture(scope, range);
            if (!captured) return;
            const requestId = this._openRequestId;
            // Pending saves have no paint yet, so reserve their text intervals
            // until acknowledgement to prevent invisible overlapping captures.
            const articleId = global.AppData.vocab.readingModel.articleId(this.currentSource, String(this.currentExamId));
            const pendingSelection = { articleId, scopeId: captured.scopeId,
                startOffset: captured.startOffset, endOffset: captured.endOffset };
            if ([...this._selectionPending].some(pending => pending.articleId === articleId &&
                pending.scopeId === captured.scopeId && captured.startOffset < pending.endOffset &&
                captured.endOffset > pending.startOffset)) return;
            this._selectionPending.add(pendingSelection);
            this.showToast('正在保存…');
            try {
                const result = await ReadingVocabStore.add(captured.word, this.currentExamId,
                    this.currentExam?.title || '', captured.context, captured, this.currentSource);
                if (requestId !== this._openRequestId) return;
                if (!result.added) throw new Error('Selection was not saved');
                selection.removeAllRanges();
                this.applyVocabHighlights();
                this.updateCounts();
                if (this.modalOpen) this.renderVocabList();
                this.showToast('✅ "' + captured.word + '" 已收录并黄色高亮');
            } catch (error) {
                if (requestId === this._openRequestId) this.showSaveError(error, '保存失败，请重新划选重试');
            } finally {
                this._selectionPending.delete(pendingSelection);
            }
        },

        wrapRangeWithHighlight(range, word, occurrenceId) {
            if (!range || range.collapsed) return false;
            // Wrap each text fragment separately so repeated restore never splits,
            // extracts, or rewrites the source's inline formatting or annotations.
            const fragments = getTextNodes(range.commonAncestorContainer.nodeType === Node.TEXT_NODE
                ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer)
                .filter(node => range.intersectsNode(node)).map(node => ({ node,
                    start: node === range.startContainer ? range.startOffset : 0,
                    end: node === range.endContainer ? range.endOffset : node.length
                })).filter(fragment => fragment.end > fragment.start);
            for (const fragment of fragments.reverse()) {
                const selected = document.createRange();
                selected.setStart(fragment.node, fragment.start);
                selected.setEnd(fragment.node, fragment.end);
                const mark = document.createElement('mark');
                mark.className = 'vocab-highlight';
                mark.dataset.word = word;
                mark.dataset.occurrenceId = occurrenceId;
                mark.tabIndex = 0;
                mark.setAttribute('role', 'button');
                mark.title = '生词本: ' + word + '（查看或移除这一处）';
                selected.surroundContents(mark);
            }
            return fragments.length > 0;
        },

        applyVocabHighlights() {
            const overlay = this.ensureOverlay();
            this.removeVocabHighlights(overlay.querySelector('#vocab-reader-body'));
            this.unresolvedOccurrences = [];
            if (this.currentExamId) {
                ReadingVocabStore.getByExam(this.currentExamId, this.currentSource).forEach(item => {
                    item.occurrences.forEach(occurrence => {
                        if (!this.restoreVocabHighlight(overlay, occurrence, item.word)) {
                            this.unresolvedOccurrences.push({ ...occurrence, word: item.word });
                        }
                    });
                });
            }
            this.renderAnchorStatus();
        },

        restoreVocabHighlight(overlay, occurrence, word) {
            if (!this.currentPayload) return false;
            const range = this.resolveRangeForHighlight(overlay.querySelector('#vocab-reader-body'), occurrence);
            return !!range && this.wrapRangeWithHighlight(range, word || occurrence.quote, occurrence.id);
        },

        resolveRangeForHighlight(root, occurrence) {
            return global.ReadingVocabAnchors.resolve(root, occurrence);
        },

        showOccurrenceActions(mark) {
            const actions = this.ensureOverlay().querySelector('#vocab-occurrence-actions');
            actions.innerHTML = '<span>' + escapeHtml(mark.dataset.word) + '</span> <button type="button" data-action="remove-occurrence" data-occurrence-id="'
                + escapeHtml(mark.dataset.occurrenceId) + '">移除这一处高亮</button>';
            actions.querySelector('button').focus({ preventScroll: true });
            speakWord(mark.dataset.word);
        },

        renderAnchorStatus() {
            const status = this.ensureOverlay().querySelector('#vocab-anchor-status');
            if (!status) return;
            status.replaceChildren();
            if (!this.unresolvedOccurrences.length) return;
            const message = document.createElement('span');
            message.textContent = this.unresolvedOccurrences.length + ' 处原文暂时无法定位，生词仍保留。可重试加载，或在生词本移除旧位置后重新划选。';
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.dataset.action = 'retry-anchors';
            retry.textContent = '重试定位';
            status.append(message, retry);
        },

        async removeOccurrence(occurrenceId) {
            if (this._occurrenceBusy) return;
            const item = ReadingVocabStore.getAll()
                .find(row => row.occurrences.some(occurrence => occurrence.id === occurrenceId));
            const occurrence = item?.occurrences.find(row => row.id === occurrenceId);
            if (!occurrence) return;
            const owner = ReadingVocabStore.getOccurrenceOwner(occurrence);
            if (!owner) return;
            const requestId = this._openRequestId;
            const undo = { source: owner.source, article: owner.article,
                word: { word: item.word, meaning: item.meaning || '待补充释义', example: item.context || '' },
                occurrence: { ...occurrence }, manual: false };
            const observed = { revision: ReadingVocabStore._state.revision, generation: ReadingVocabStore._state.generation };
            this._occurrenceBusy = true;
            this.showToast('正在保存…');
            try {
                const result = await ReadingVocabStore.mutate('removeOccurrence', { occurrenceId }, observed);
                if (requestId !== this._openRequestId) return;
                // Keep the acknowledged deletion fence: a later clear/replace must
                // reject this undo instead of resurrecting deleted relationships.
                const committedRevision = result.revisions?.['vocab.readingState'];
                this._undoOccurrence = result.changed !== false && Number.isInteger(committedRevision)
                    ? { command: undo, observed: { revision: committedRevision, generation: observed.generation } } : null;
                this.ensureOverlay().querySelector('#vocab-occurrence-actions').replaceChildren();
                this.ensureOverlay().querySelector('#vocab-occurrence-undo').innerHTML =
                    this._undoOccurrence ? '<span>已移除这一处高亮</span> <button type="button" data-action="undo-occurrence">撤销</button>' : '';
                this.applyVocabHighlights();
                this.updateCounts();
                if (this.modalOpen) this.renderVocabList();
                this.showToast('已移除这一处高亮');
            } catch (error) {
                if (requestId === this._openRequestId) this.showSaveError(error, '移除失败，请重试');
            } finally {
                if (requestId === this._openRequestId) this._occurrenceBusy = false;
            }
        },

        async undoOccurrence() {
            if (this._occurrenceBusy || !this._undoOccurrence) return;
            const requestId = this._openRequestId;
            const undo = this._undoOccurrence;
            this._occurrenceBusy = true;
            this.showToast('正在保存…');
            try {
                await ReadingVocabStore.mutate('collect', { ...undo.command, at: new Date().toISOString() }, undo.observed);
                if (requestId !== this._openRequestId) return;
                this._undoOccurrence = null;
                this.ensureOverlay().querySelector('#vocab-occurrence-undo').replaceChildren();
                this.applyVocabHighlights();
                this.updateCounts();
                if (this.modalOpen) this.renderVocabList();
                this.showToast('已撤销移除');
            } catch (error) {
                if (requestId === this._openRequestId) this.showSaveError(error, '撤销失败，数据可能已更改；可重试或重新划选');
            } finally {
                if (requestId === this._openRequestId) this._occurrenceBusy = false;
            }
        },

        removeVocabHighlights(container) {
            if (!container) return;
            const marks = container.querySelectorAll('mark.vocab-highlight');
            marks.forEach(mark => {
                const parent = mark.parentNode;
                if (parent) {
                    while (mark.firstChild) {
                        parent.insertBefore(mark.firstChild, mark);
                    }
                    parent.removeChild(mark);
                    parent.normalize();
                }
            });
        },

        removeVocabHighlightForWord(word) {
            const overlay = this.ensureOverlay();
            if (!overlay || !word) return;
            const lower = String(word).trim().toLowerCase();
            const marks = overlay.querySelectorAll('mark.vocab-highlight');
            marks.forEach(mark => {
                const markWord = (mark.dataset.word || mark.textContent || '').trim().toLowerCase();
                if (markWord === lower) {
                    const parent = mark.parentNode;
                    if (parent) {
                        while (mark.firstChild) {
                            parent.insertBefore(mark.firstChild, mark);
                        }
                        parent.removeChild(mark);
                        parent.normalize();
                    }
                }
            });
        },

        enhanceWithExplanation(explanation) {
            if (!explanation || !Array.isArray(explanation.passageNotes)) return;
            const overlay = this.ensureOverlay();
            explanation.passageNotes.forEach(note => {
                const match = note.label ? note.label.match(/Paragraph\s+([A-Z])/i) : null;
                if (match) {
                    const letter = match[1].toUpperCase();
                    const cards = [...overlay.querySelectorAll('.vocab-paragraph-card')].filter(card => card.dataset.letter === letter);
                    const transEl = cards.length === 1 ? cards[0].querySelector('.vocab-trans-text') : null;
                    if (transEl) {
                        transEl.textContent = note.text || '';
                    }
                }
            });
        },

        switchViewTab(target) {
            const overlay = this.ensureOverlay();
            this.activeTab = target;
            overlay.querySelectorAll('.vocab-tab-btn').forEach(button => {
                const active = button.dataset.para === target;
                button.classList.toggle('active', active);
                button.setAttribute('aria-selected', String(active));
            });
            const passageSection = overlay.querySelector('#vocab-passage-section');
            const questionsSection = overlay.querySelector('#vocab-questions-section');
            const cards = overlay.querySelectorAll('.vocab-paragraph-card');
            const scrollArea = overlay.querySelector('#vocab-reader-scroll-area');

            if (target === 'all') {
                if (passageSection) passageSection.style.display = 'block';
                if (questionsSection) questionsSection.style.display = 'block';
                cards.forEach(c => c.style.display = 'block');
                if (scrollArea && typeof scrollArea.scrollTo === 'function') {
                    scrollArea.scrollTo({ top: 0, behavior: 'smooth' });
                } else if (passageSection) {
                    passageSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            } else if (target === 'questions') {
                if (passageSection) passageSection.style.display = 'none';
                if (questionsSection) {
                    questionsSection.style.display = 'block';
                    questionsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            } else {
                // 单个段落展示
                if (passageSection) passageSection.style.display = 'block';
                if (questionsSection) questionsSection.style.display = 'none';
                cards.forEach(c => {
                    if (c.dataset.paragraphId === target) {
                        c.style.display = 'block';
                        c.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    } else {
                        c.style.display = 'none';
                    }
                });
            }
        },

        updateCounts() {
            const overlay = this.ensureOverlay();
            const examId = this.currentExamId;
            const currentList = ReadingVocabStore.getByExam(examId, this.currentSource);
            const allList = ReadingVocabStore.getAll();

            const headerCount = overlay.querySelector('#vocab-header-count');
            const fabCount = overlay.querySelector('#vocab-fab-count');
            const tabCurrentCount = overlay.querySelector('#v-count-current');
            const tabAllCount = overlay.querySelector('#v-count-all');

            const countToShow = currentList.length;
            if (headerCount) headerCount.textContent = countToShow;
            if (fabCount) fabCount.textContent = countToShow;
            if (tabCurrentCount) tabCurrentCount.textContent = currentList.length;
            if (tabAllCount) tabAllCount.textContent = allList.length;
        },

        renderVocabList() {
            const overlay = this.ensureOverlay();
            const listEl = overlay.querySelector('#vocab-list');
            if (!listEl) return;

            const isCurrent = this.modalTab === 'current';
            const list = isCurrent
                ? ReadingVocabStore.getByExam(this.currentExamId, this.currentSource)
                : ReadingVocabStore.getAll();

            if (!list || list.length === 0) {
                listEl.innerHTML = `
                    <div class="vocab-empty-box">
                        <div class="vocab-empty-icon">📝</div>
                        <p class="vocab-empty-title">生词本是空的哦~</p>
                        <p class="vocab-empty-desc">在文章或题目中划选任意英文单词，即可自动收入此生词本。</p>
                    </div>
                `;
                return;
            }

            let html = '';
            const unresolved = new Set(this.unresolvedOccurrences.map(row => row.id));
            const currentArticleId = this.currentExamId
                ? global.AppData.vocab.readingModel.articleId(this.currentSource, String(this.currentExamId)) : null;
            list.forEach(item => {
                const occurrenceRows = item.occurrences.map(occurrence => {
                    const owner = ReadingVocabStore.getOccurrenceOwner(occurrence);
                    const status = owner?.articleId === currentArticleId
                        ? (unresolved.has(occurrence.id) ? 'unresolved' : 'resolved') : 'unverified';
                    return '<div class="vocab-occurrence-row" data-occurrence-id="'
                        + escapeHtml(occurrence.id) + '" data-anchor-status="' + status + '">'
                        + (!isCurrent && owner ? '<span class="vocab-item__source">'
                            + escapeHtml(owner.article.title || owner.article.examId) + '</span>' : '')
                        + '<span>' + escapeHtml(occurrence.before + occurrence.quote + occurrence.after) + '</span>'
                        + (status === 'unresolved' ? '<strong>原文位置无法定位，生词已保留</strong>' : '')
                        + '<button type="button" data-action="remove-occurrence" data-occurrence-id="' + escapeHtml(occurrence.id)
                        + '">移除这一处</button></div>';
                }).join('');
                html += `
                    <div class="vocab-item" data-word-id="${escapeHtml(item.id)}">
                        <div class="vocab-item__main">
                            <div class="vocab-item__header">
                                <span class="vocab-item__word">${escapeHtml(item.word)}</span>
                                <button type="button" class="vocab-speak-btn" data-speak-word="${escapeHtml(item.word)}" title="发音">🔊</button>
                            </div>
                            ${item.context ? `<p class="vocab-item__context">"${escapeHtml(item.context)}"</p>` : ''}
                            ${occurrenceRows}
                            ${!isCurrent && item.examTitle ? `<span class="vocab-item__source">${escapeHtml(item.examTitle)}</span>` : ''}
                        </div>
                        <button type="button" class="vocab-delete-btn" data-del-id="${escapeHtml(item.id)}" title="移出生词本">删除</button>
                    </div>
                `;
            });

            listEl.innerHTML = html;

        },

        openModal() {
            const overlay = this.ensureOverlay();
            this.bindEvents(overlay);
            const modal = overlay.querySelector('#vocab-modal');
            if (modal) {
                if (!this.modalOpen) this._modalReturnFocus = document.activeElement;
                this.modalOpen = true;
                this.updateCounts();
                this.renderVocabList();
                modal.classList.add('active');
                modal.setAttribute('aria-hidden', 'false');
                modal.querySelector('#vocab-manual-input')?.focus({ preventScroll: true });
            }
        },

        closeModal(restoreFocus = true) {
            const overlay = document.getElementById('reading-vocab-reader-overlay');
            const modal = overlay?.querySelector('#vocab-modal');
            const wasOpen = this.modalOpen;
            this.modalOpen = false;
            if (modal) {
                modal.classList.remove('active');
                modal.setAttribute('aria-hidden', 'true');
            }
            if (wasOpen && restoreFocus && this._modalReturnFocus?.isConnected) {
                this._modalReturnFocus.focus({ preventScroll: true });
            }
            this._modalReturnFocus = null;
        },

        showSaveError(error, retryMessage) {
            this.showToast(error?.code === 'BACKEND_UNAVAILABLE'
                ? '存储暂不可用，请刷新页面后重试' : retryMessage);
        },

        showToast(msg) {
            const overlay = this.ensureOverlay();
            const toast = overlay.querySelector('#vocab-toast');
            if (!toast) return;

            toast.textContent = msg;
            toast.classList.add('show');

            clearTimeout(this.toastTimer);
            this._pendingTimers.delete(this.toastTimer);
            this.toastTimer = this.defer(() => {
                toast.classList.remove('show');
            }, 2000);
        },

        close() {
            ++this._openRequestId;
            const overlay = document.getElementById('reading-vocab-reader-overlay');
            this.clearPendingWork(overlay);
            this.closeModal(false);
            this.unbindEvents();
            if (overlay) {
                overlay.classList.add('is-hidden');
                overlay.setAttribute('aria-hidden', 'true');
            }
            document.body.classList.remove('vocab-reader-open');
            if (this._returnFocus?.isConnected) this._returnFocus.focus({ preventScroll: true });
            this._returnFocus = null;
        }
    };

    // 监听生词更新事件以即时刷新打开的视图
    if (typeof window !== 'undefined') {
        window.addEventListener('reading-vocab-store-updated', () => {
            if (ReadingVocabReader.currentExamId) {
                ReadingVocabReader.updateCounts();
                ReadingVocabReader.applyVocabHighlights();
                if (ReadingVocabReader.modalOpen) ReadingVocabReader.renderVocabList();
            }
        });
    }

    // 暴露全局命名空间
    global.ReadingVocabStore = ReadingVocabStore;
    global.ReadingVocabReader = ReadingVocabReader;
    global.openReadingVocabReader = function(examId, options = {}) {
        return ReadingVocabReader.open(examId, options);
    };

    // 启动数据同步初始化
    ReadingVocabStore.init().catch(error => console.warn('[ReadingVocabStore] Initialization failed:', error));

})(typeof window !== 'undefined' ? window : globalThis);
