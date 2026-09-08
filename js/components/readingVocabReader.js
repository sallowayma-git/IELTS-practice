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

        async mutate(type, command) {
            if (!this._state) await this.init();
            const observed = this._state;
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
                quote: highlight.text || word, before: highlight.before || '', after: highlight.after || ''
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
    function cleanPassageHtml(rawHtml) {
        if (!rawHtml) return '';
        const temp = document.createElement('div');
        temp.innerHTML = rawHtml;

        // 移除练习交互用的 dropzone 提示与容器
        const dropzones = temp.querySelectorAll('.paragraph-dropzone, .match-dropzone, .dropzone');
        dropzones.forEach(dz => dz.remove());

        // 移除多余的空占位与 divider
        const empties = temp.querySelectorAll('.empty-space, #divider');
        empties.forEach(el => el.remove());

        return temp.innerHTML;
    }

    /**
     * 判断文本是否属于考试指导语/前置题目说明
     * 例如："You should spend about 20 minutes on Questions 1-13, which are based on Reading Passage 1 below."
     */
    function isPassageInstruction(text) {
        if (!text) return false;
        const s = text.trim();
        if (/spend about \d+ minutes/i.test(s)) return true;
        if (/which are based on reading passage/i.test(s)) return true;
        if (/based on reading passage \d*/i.test(s)) return true;
        if (/questions \d+\s*[-–至to]\s*\d+.*based on/i.test(s)) return true;
        if (/you should spend/i.test(s) && /minutes/i.test(s)) return true;
        if (/questions \d+\s*[-–至to]\s*\d+\s*(?:are\s+based|refer\s+to)/i.test(s)) return true;
        return false;
    }

    /**
     * 解析阅读文章核心数据：分离前置说明、文章大标题与真实段落
     */
    function extractPassageData(rawHtml, fallbackTitle = '') {
        if (!rawHtml) {
            return {
                passageTitle: fallbackTitle,
                subtitleHtml: '',
                instructionHtml: '',
                blocks: []
            };
        }

        const cleaned = cleanPassageHtml(rawHtml);
        const temp = document.createElement('div');
        temp.innerHTML = cleaned;

        // 1. 提取文章主标题 (h3 或独立非 "READING PASSAGE" 的 h2)
        let passageTitle = fallbackTitle;
        const h3 = temp.querySelector('h3');
        if (h3 && h3.textContent.trim()) {
            passageTitle = h3.textContent.trim();
            h3.remove();
        } else {
            const h2 = temp.querySelector('h2');
            if (h2 && !/^reading passage/i.test(h2.textContent.trim())) {
                passageTitle = h2.textContent.trim();
                h2.remove();
            }
        }

        // 移除诸如 <h2>READING PASSAGE 1</h2> 等结构头标签
        const readingPassageHeadings = temp.querySelectorAll('h2');
        readingPassageHeadings.forEach(h => {
            if (/^reading passage/i.test(h.textContent.trim())) {
                h.remove();
            }
        });

        // 2. 识别并提取前置题目指导语（如 "You should spend about 20 minutes..."），移出正文段落列表
        let instructionHtml = '';
        const allPs = Array.from(temp.querySelectorAll('p'));
        for (const p of allPs) {
            const text = p.textContent.trim();
            if (isPassageInstruction(text)) {
                if (!instructionHtml) {
                    instructionHtml = p.innerHTML.trim();
                }
                p.remove(); // 绝不作为正文段落，不分配任何段落标签
            }
        }

        // 3. 提取副标题 (如 h4)
        let subtitleHtml = '';
        const h4 = temp.querySelector('h4');
        if (h4 && h4.textContent.trim()) {
            subtitleHtml = h4.innerHTML.trim();
            h4.remove();
        }

        // 4. 解析段落 blocks
        const blocks = [];
        const wrappers = temp.querySelectorAll('.paragraph-wrapper');

        if (wrappers && wrappers.length > 0) {
            wrappers.forEach((wrap, index) => {
                // 查找段落标识 letter
                let letter = '';
                const strong = wrap.querySelector('strong');
                if (strong && /^[A-Z]$/.test(strong.textContent.trim())) {
                    letter = strong.textContent.trim();
                } else {
                    const match = wrap.textContent.match(/\b([A-Z])\s+[A-Z]/);
                    if (match) {
                        letter = match[1];
                    } else {
                        letter = String.fromCharCode(65 + index);
                    }
                }

                // 获取段落主体 HTML
                const p = wrap.querySelector('p');
                const html = p ? p.innerHTML : wrap.innerHTML;

                blocks.push({
                    id: `para-${letter}`,
                    letter: letter,
                    html: html,
                    text: wrap.textContent.trim()
                });
            });
        } else {
            // 没有 .paragraph-wrapper 的情况，按剩下的实际正文 <p> 分段
            const remainingPs = temp.querySelectorAll('p');
            let validIdx = 0;
            remainingPs.forEach((p) => {
                const text = p.textContent.trim();
                if (!text || text.length < 20) return;
                // 防御：若依然属于指导语，跳过
                if (isPassageInstruction(text)) return;

                const strong = p.querySelector('strong');
                let letter = '';
                if (strong && /^[A-Z]$/.test(strong.textContent.trim())) {
                    letter = strong.textContent.trim();
                } else {
                    const leadMatch = text.match(/^(?:Paragraph\s+)?([A-Z])(?:\.|\s+)/);
                    if (leadMatch) {
                        letter = leadMatch[1];
                    } else {
                        letter = String.fromCharCode(65 + validIdx);
                    }
                }

                blocks.push({
                    id: `para-${letter}`,
                    letter: letter,
                    html: p.innerHTML,
                    text: text
                });
                validIdx++;
            });
        }

        return {
            passageTitle,
            subtitleHtml,
            instructionHtml,
            blocks
        };
    }

    function extractParagraphBlocks(rawHtml) {
        return extractPassageData(rawHtml).blocks;
    }

    function getTextNodes(root) {
        if (!root) return [];
        const textNodes = [];
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    const tag = parent.tagName.toUpperCase();
                    if (['SCRIPT', 'STYLE', 'BUTTON', 'INPUT', 'TEXTAREA'].includes(tag)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    if (parent.closest('.vocab-translation-card') || parent.closest('.vocab-paragraph-tag')) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            },
            false
        );
        let n;
        while ((n = walker.nextNode())) {
            textNodes.push(n);
        }
        return textNodes;
    }

    function resolveRangeFromOffsets(root, start, end) {
        const nodes = getTextNodes(root);
        let offset = 0;
        let startNode = null;
        let endNode = null;
        let startOffset = 0;
        let endOffset = 0;
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const text = node.nodeValue || '';
            const nextOffset = offset + text.length;
            if (!startNode && start >= offset && (start < nextOffset || (i === nodes.length - 1 && start === nextOffset))) {
                startNode = node;
                startOffset = Math.max(0, start - offset);
            }
            if (!endNode && end > offset && end <= nextOffset) {
                endNode = node;
                endOffset = Math.max(0, end - offset);
            }
            if (startNode && endNode) break;
            offset = nextOffset;
        }
        if (!startNode || !endNode) return null;
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        return range;
    }

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

        clearPendingWork(overlay) {
            this._pendingTimers.forEach(timer => clearTimeout(timer));
            this._pendingTimers.clear();
            this.toastTimer = null;
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
                        <span class="vocab-banner-text"><strong>划词即收录</strong>：在文章或题目中鼠标/触屏选中任意生词，系统将自动收入生词本并以<strong>黄色高亮</strong>醒目标注。</span>
                    </div>

                    <!-- 独立滚动主体区域（确保顶部 header 永远固定在视口顶部） -->
                    <div class="vocab-reader-scroll-area" id="vocab-reader-scroll-area">
                        <!-- 阅读核心主内容区 -->
                        <main class="vocab-reader-body" id="vocab-reader-body">
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

            // 核心：划选文本自动收录并仅高亮当前选中的具体实例
            const readerBody = overlay.querySelector('#vocab-reader-body');
            if (readerBody) {
                const handleSelectionCapture = () => {
                    const requestId = this._openRequestId;
                    this.defer(async () => {
                        if (requestId !== this._openRequestId || overlay.classList.contains('is-hidden') || !this.currentPayload) return;
                        const selection = window.getSelection();
                        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
                        const rawText = selection.toString();
                        const text = rawText.trim();

                        // 限制在1到45个字符之间，避免大段全文误选
                        if (!text || text.length > 45 || text.includes('\n') || !/[a-zA-Z\u4e00-\u9fa5]/.test(text)) {
                            return;
                        }

                        let range;
                        try {
                            range = selection.getRangeAt(0);
                        } catch (_) {
                            return;
                        }
                        if (!range || range.collapsed) return;

                        // 确保选区位于文章正文或题目区域内
                        const passageContent = overlay.querySelector('#vocab-passage-content');
                        const questionsContent = overlay.querySelector('#vocab-questions-content');
                        const commonNode = range.commonAncestorContainer;
                        const commonEl = commonNode.nodeType === Node.ELEMENT_NODE ? commonNode : commonNode.parentElement;
                        if (!commonEl) return;
                        if (!passageContent?.contains(commonEl) && !questionsContent?.contains(commonEl)) {
                            return;
                        }
                        // 忽略译文卡片、段落标签、按钮等非正文区域
                        if (commonEl.closest('.vocab-translation-card') || commonEl.closest('.vocab-paragraph-tag') || commonEl.closest('button')) {
                            return;
                        }

                        // 如果用户选中的区域已经位于高亮生词内，则不重复收录
                        const existingMark = commonEl.closest('mark.vocab-highlight');
                        if (existingMark) {
                            return;
                        }

                        // 对 range 进行首尾空白去除，确保只高亮纯单词/短语
                        const trimmedRange = this.trimRangeWhitespace(range);
                        if (!trimmedRange || trimmedRange.collapsed) return;

                        // 计算高亮所在的 scope（段落 card 或题目 group 或通用容器）
                        const targetCard = commonEl.closest('.vocab-paragraph-card');
                        const targetQGroup = commonEl.closest('.vocab-question-group');
                        let scope = 'passage';
                        let scopeElement = passageContent;

                        if (targetCard) {
                            const letter = targetCard.dataset.letter || '';
                            scope = letter ? `para-${letter}` : 'passage';
                            scopeElement = targetCard.querySelector('.vocab-paragraph-text') || targetCard;
                        } else if (targetQGroup) {
                            scope = targetQGroup.id || 'questions';
                            scopeElement = targetQGroup;
                        } else if (questionsContent?.contains(commonEl)) {
                            scope = 'questions';
                            scopeElement = questionsContent;
                        }

                        // 在 scopeElement 内计算精确的 startOffset / endOffset / before / after / occurrence
                        const locInfo = this.calculateRangeLocation(scopeElement, trimmedRange, text);

                        // 获取上下文句子
                        let contextSentence = '';
                        try {
                            const parentBlock = commonEl;
                            if (parentBlock) {
                                contextSentence = parentBlock.textContent.slice(0, 140).trim();
                            }
                        } catch (_) {}

                        const cleanWord = ReadingVocabStore.cleanWord(text);
                        if (!cleanWord) return;

                        // 核心修复：直接在当前选区包裹高亮，只高亮当前选中的这一个单词实例，绝不全篇批量盲高亮！
                        const wrappedMark = this.wrapRangeWithHighlight(trimmedRange, cleanWord);
                        if (!wrappedMark) return;

                        const highlightRecord = {
                            id: 'hl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                            examId: this.currentExamId || '',
                            scope: scope,
                            startOffset: locInfo.startOffset,
                            endOffset: locInfo.endOffset,
                            before: locInfo.before,
                            after: locInfo.after,
                            occurrence: locInfo.occurrence,
                            text: cleanWord
                        };

                        this.showToast('正在保存…');
                        try {
                            const result = await ReadingVocabStore.add(
                                cleanWord,
                                this.currentExamId,
                                this.currentExam?.title || '',
                                contextSentence,
                                highlightRecord, this.currentSource
                            );

                            if (requestId !== this._openRequestId) return;
                            if (result.added) {
                                selection.removeAllRanges(); // 取消选中状态，避免残留蓝色选区
                                this.updateCounts();
                                if (this.modalOpen) {
                                    this.renderVocabList();
                                }
                                this.showToast(`✅ "${cleanWord}" 已收录并黄色高亮`);
                            } else {
                                throw new Error('Selection was not saved');
                            }
                        } catch (error) {
                            if (wrappedMark.parentNode) {
                                const parent = wrappedMark.parentNode;
                                while (wrappedMark.firstChild) parent.insertBefore(wrappedMark.firstChild, wrappedMark);
                                wrappedMark.remove();
                                parent.normalize();
                            }
                            if (requestId === this._openRequestId) this.showSaveError(error, '保存失败，请重新划选重试');
                        }
                    }, 20);
                };

                on(readerBody, 'mouseup', handleSelectionCapture);
                on(readerBody, 'touchend', handleSelectionCapture);

                // 点击黄色高亮生词：朗读发音并轻量提示
                on(readerBody, 'click', (e) => {
                    const mark = e.target.closest('mark.vocab-highlight');
                    if (mark) {
                        const selection = window.getSelection();
                        if (selection && selection.toString().trim().length > 0) {
                            return; // 划选操作中不触发点击发音
                        }
                        const word = mark.dataset.word || mark.textContent.trim();
                        if (word) {
                            speakWord(word);
                            this.showToast(`🔊 ${word} (已收录生词)`);
                        }
                    }
                });
            }

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
                const [payload, source] = await Promise.all([
                    loadReadingExamPayload(examId), ReadingVocabStore.resolveSource(options)
                ]);
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
            const rawPassageHtml = payload?.passage?.blocks?.[0]?.html || '';
            const passageData = extractPassageData(rawPassageHtml, exam.title || '');
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
                if (instructionHtml) {
                    passageIntroEl.innerHTML = `
                        <div class="vocab-passage-instruction" role="note">
                            <span class="vocab-instruction-icon">📋</span>
                            <div class="vocab-instruction-text">${instructionHtml}</div>
                        </div>
                    `;
                    passageIntroEl.style.display = 'block';
                } else if (passageData.subtitleHtml) {
                    passageIntroEl.innerHTML = `<div class="vocab-passage-subtitle">${passageData.subtitleHtml}</div>`;
                    passageIntroEl.style.display = 'block';
                } else {
                    passageIntroEl.innerHTML = '';
                    passageIntroEl.style.display = 'none';
                }
            }

            // 渲染顶部段落切换 Tabs（完全平铺展开：全文、Para A、Para B、Para C...与题目）
            const tabsContainer = overlay.querySelector('#vocab-reader-tabs');
            if (tabsContainer) {
                let tabsHtml = `<button type="button" class="vocab-tab-btn active" data-para="all">全文</button>`;
                blocks.forEach(b => {
                    tabsHtml += `<button type="button" class="vocab-tab-btn" data-para="${b.letter}">Para ${b.letter}</button>`;
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
                            <div class="vocab-paragraph-card" id="vocab-card-${b.letter}" data-letter="${b.letter}">
                                <div class="vocab-paragraph-tag">
                                    <span class="vocab-para-letter">Para ${b.letter}</span>
                                </div>
                                <div class="vocab-paragraph-text">${b.html}</div>
                                <div class="vocab-translation-card" id="vocab-trans-${b.letter}" style="display: ${this.showTranslation ? 'block' : 'none'};">
                                    <div class="vocab-trans-label">中文参考译文：</div>
                                    <div class="vocab-trans-text" id="vocab-trans-text-${b.letter}">加载中...</div>
                                </div>
                            </div>
                        `;
                    });
                    passageContent.innerHTML = passageHtml;
                } else {
                    // 原生清洗后渲染
                    passageContent.innerHTML = cleanPassageHtml(rawPassageHtml);
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
                        group.appendChild(createReadOnlyQuestionContent(g.bodyHtml, group.id));
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

        trimRangeWhitespace(range) {
            if (!range || range.collapsed) return range;
            const startNode = range.startContainer;
            let startOffset = range.startOffset;
            const endNode = range.endContainer;
            let endOffset = range.endOffset;

            if (startNode === endNode && startNode.nodeType === Node.TEXT_NODE) {
                const text = startNode.nodeValue || '';
                const segment = text.slice(startOffset, endOffset);
                const leadSpace = segment.search(/\S/);
                if (leadSpace > 0) {
                    startOffset += leadSpace;
                } else if (leadSpace === -1) {
                    return null;
                }
                const trailSpace = segment.length - segment.trimEnd().length;
                if (trailSpace > 0) {
                    endOffset -= trailSpace;
                }
                if (endOffset <= startOffset) return null;

                const trimmed = document.createRange();
                trimmed.setStart(startNode, startOffset);
                trimmed.setEnd(endNode, endOffset);
                return trimmed;
            }

            if (startNode.nodeType === Node.TEXT_NODE) {
                const text = (startNode.nodeValue || '').slice(startOffset);
                const m = text.match(/^\s+/);
                if (m) {
                    range.setStart(startNode, startOffset + m[0].length);
                }
            }
            if (endNode.nodeType === Node.TEXT_NODE) {
                const text = (endNode.nodeValue || '').slice(0, endOffset);
                const m = text.match(/\s+$/);
                if (m) {
                    range.setEnd(endNode, endOffset - m[0].length);
                }
            }
            return range;
        },

        calculateRangeLocation(scopeElement, range, text) {
            const textNodes = getTextNodes(scopeElement);
            let runningOffset = 0;
            let startOffset = -1;

            for (let i = 0; i < textNodes.length; i++) {
                const node = textNodes[i];
                if (node === range.startContainer) {
                    startOffset = runningOffset + range.startOffset;
                    break;
                }
                runningOffset += (node.nodeValue || '').length;
            }

            if (startOffset === -1) {
                startOffset = 0;
            }

            const endOffset = startOffset + text.length;
            const fullText = textNodes.map(n => n.nodeValue || '').join('');
            const before = fullText.slice(Math.max(0, startOffset - 30), startOffset);
            const after = fullText.slice(endOffset, endOffset + 30);

            let occurrence = 0;
            const lowerFull = fullText.toLowerCase();
            const lowerWord = text.toLowerCase();
            let idx = -1;
            while ((idx = lowerFull.indexOf(lowerWord, idx + 1)) !== -1 && idx < startOffset) {
                occurrence += 1;
            }

            return { startOffset, endOffset, before, after, occurrence };
        },

        wrapRangeWithHighlight(range, word) {
            if (!range || range.collapsed) return null;
            const mark = document.createElement('mark');
            mark.className = 'vocab-highlight vocab-highlight--pulse';
            mark.dataset.word = word;
            mark.title = `生词本: ${word} (点击发音)`;

            try {
                range.surroundContents(mark);
            } catch (e) {
                try {
                    const fragment = range.extractContents();
                    mark.appendChild(fragment);
                    range.insertNode(mark);
                } catch (err) {
                    console.warn('[ReadingVocabReader] wrapRangeWithHighlight error:', err);
                    return null;
                }
            }

            this.defer(() => {
                mark.classList.remove('vocab-highlight--pulse');
            }, 1500);

            return mark;
        },

        applyVocabHighlights() {
            const overlay = this.ensureOverlay();
            const passageContent = overlay.querySelector('#vocab-passage-content');
            const questionsContent = overlay.querySelector('#vocab-questions-content');

            // 1. 清除已有高亮 mark.vocab-highlight，安全还原为纯文本节点
            this.removeVocabHighlights(passageContent);
            this.removeVocabHighlights(questionsContent);

            if (!this.currentExamId) return;

            // 2. 仅获取针对当前篇目已收录的生词（绝不跨篇串显，也绝不全篇正则批量盲高亮）
            const examItems = ReadingVocabStore.getByExam(this.currentExamId, this.currentSource);
            if (!examItems || examItems.length === 0) return;

            examItems.forEach(item => {
                if (Array.isArray(item.highlights) && item.highlights.length > 0) {
                    item.highlights.forEach(hl => {
                        if (String(hl.examId) === String(this.currentExamId)) {
                            this.restoreVocabHighlight(overlay, hl, item.word);
                        }
                    });
                }
            });
        },

        restoreVocabHighlight(overlay, hl, word) {
            if (!overlay || !hl) return false;
            let scopeElement = null;

            if (hl.scope && hl.scope.startsWith('para-')) {
                const letter = hl.scope.replace('para-', '');
                const card = overlay.querySelector(`.vocab-paragraph-card[data-letter="${letter}"]`);
                if (card) {
                    scopeElement = card.querySelector('.vocab-paragraph-text') || card;
                }
            } else if (hl.scope && hl.scope.startsWith('vocab-qgroup-')) {
                scopeElement = overlay.querySelector(`#${hl.scope}`);
            } else if (hl.scope === 'questions') {
                scopeElement = overlay.querySelector('#vocab-questions-content');
            } else {
                scopeElement = overlay.querySelector('#vocab-passage-content');
            }

            if (!scopeElement) {
                scopeElement = overlay.querySelector('#vocab-passage-content') || overlay.querySelector('#vocab-questions-content');
            }
            if (!scopeElement) return false;

            const range = this.resolveRangeForHighlight(scopeElement, hl);
            if (!range || range.collapsed) return false;

            const mark = document.createElement('mark');
            mark.className = 'vocab-highlight';
            mark.dataset.word = word || hl.text;
            mark.title = `生词本: ${word || hl.text} (点击发音)`;

            try {
                range.surroundContents(mark);
                return true;
            } catch (_) {
                try {
                    const fragment = range.extractContents();
                    mark.appendChild(fragment);
                    range.insertNode(mark);
                    return true;
                } catch (e) {
                    return false;
                }
            }
        },

        resolveRangeForHighlight(root, hl) {
            if (!root || !hl) return null;
            const textNodes = getTextNodes(root);
            if (!textNodes.length) return null;

            const fullText = textNodes.map(n => n.nodeValue || '').join('');
            const targetText = String(hl.text || '').trim();
            if (!targetText) return null;

            const startOffset = Number(hl.startOffset);
            const endOffset = Number(hl.endOffset);

            // 1. 优先尝试 offset 精确匹配
            if (
                Number.isFinite(startOffset) &&
                Number.isFinite(endOffset) &&
                endOffset > startOffset &&
                startOffset >= 0 &&
                endOffset <= fullText.length
            ) {
                const segment = fullText.slice(startOffset, endOffset);
                if (segment.toLowerCase() === targetText.toLowerCase()) {
                    return resolveRangeFromOffsets(root, startOffset, endOffset);
                }
            }

            // 2. 次优：使用 before / after 上下文精确定位单处实例
            if (hl.before || hl.after) {
                let searchPos = 0;
                let matchIdx = -1;
                let bestIdx = -1;
                let bestScore = -1;
                const lowerFull = fullText.toLowerCase();
                const lowerTarget = targetText.toLowerCase();

                while ((matchIdx = lowerFull.indexOf(lowerTarget, searchPos)) !== -1) {
                    let score = 0;
                    if (hl.before) {
                        const actualBefore = fullText.slice(Math.max(0, matchIdx - hl.before.length), matchIdx);
                        if (actualBefore.toLowerCase() === hl.before.toLowerCase()) {
                            score += 3;
                        } else if (actualBefore.toLowerCase().endsWith(hl.before.slice(-10).toLowerCase())) {
                            score += 1;
                        }
                    }
                    if (hl.after) {
                        const actualAfter = fullText.slice(matchIdx + targetText.length, matchIdx + targetText.length + hl.after.length);
                        if (actualAfter.toLowerCase() === hl.after.toLowerCase()) {
                            score += 3;
                        } else if (actualAfter.toLowerCase().startsWith(hl.after.slice(0, 10).toLowerCase())) {
                            score += 1;
                        }
                    }
                    if (score > bestScore) {
                        bestScore = score;
                        bestIdx = matchIdx;
                    }
                    searchPos = matchIdx + 1;
                }

                if (bestIdx !== -1 && bestScore > 0) {
                    return resolveRangeFromOffsets(root, bestIdx, bestIdx + targetText.length);
                }
            }

            // 3. 兜底：使用 occurrence（第 N 次出现）
            const occurrence = Number.isFinite(Number(hl.occurrence)) ? Number(hl.occurrence) : 0;
            let currentOccurrence = 0;
            let pos = 0;
            let matchPos = -1;
            const lowerFull = fullText.toLowerCase();
            const lowerTarget = targetText.toLowerCase();

            while ((matchPos = lowerFull.indexOf(lowerTarget, pos)) !== -1) {
                if (currentOccurrence === occurrence) {
                    return resolveRangeFromOffsets(root, matchPos, matchPos + targetText.length);
                }
                currentOccurrence += 1;
                pos = matchPos + 1;
            }

            return null;
        },

        restoreLegacyHighlightByContext(overlay, word, context) {
            if (!overlay || !word) return false;
            const passageContent = overlay.querySelector('#vocab-passage-content');
            const questionsContent = overlay.querySelector('#vocab-questions-content');
            const roots = [passageContent, questionsContent].filter(Boolean);

            const targetWord = String(word).trim();
            const lowerWord = targetWord.toLowerCase();
            const lowerContext = String(context || '').trim().toLowerCase();

            for (const root of roots) {
                const textNodes = getTextNodes(root);
                const fullText = textNodes.map(n => n.nodeValue || '').join('');
                const lowerFull = fullText.toLowerCase();

                let targetIdx = -1;
                if (lowerContext && lowerFull.includes(lowerContext)) {
                    const ctxIdx = lowerFull.indexOf(lowerContext);
                    const wordInCtx = lowerContext.indexOf(lowerWord);
                    if (wordInCtx !== -1) {
                        targetIdx = ctxIdx + wordInCtx;
                    }
                }

                // 无论如何，只恢复单处实例，绝不全篇高亮
                if (targetIdx !== -1) {
                    const range = resolveRangeFromOffsets(root, targetIdx, targetIdx + targetWord.length);
                    if (range && !range.collapsed) {
                        const mark = document.createElement('mark');
                        mark.className = 'vocab-highlight';
                        mark.dataset.word = targetWord;
                        mark.title = `生词本: ${targetWord} (点击发音)`;
                        try {
                            range.surroundContents(mark);
                            return true;
                        } catch (_) {
                            try {
                                const frag = range.extractContents();
                                mark.appendChild(frag);
                                range.insertNode(mark);
                                return true;
                            } catch (e) {
                                return false;
                            }
                        }
                    }
                }
            }
            return false;
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
                    const transEl = overlay.querySelector(`#vocab-trans-text-${letter}`);
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
                    if (c.dataset.letter === target) {
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
            list.forEach(item => {
                html += `
                    <div class="vocab-item" data-word-id="${escapeHtml(item.id)}">
                        <div class="vocab-item__main">
                            <div class="vocab-item__header">
                                <span class="vocab-item__word">${escapeHtml(item.word)}</span>
                                <button type="button" class="vocab-speak-btn" data-speak-word="${escapeHtml(item.word)}" title="发音">🔊</button>
                            </div>
                            ${item.context ? `<p class="vocab-item__context">"${escapeHtml(item.context)}"</p>` : ''}
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
                if (ReadingVocabReader.modalOpen) ReadingVocabReader.renderVocabList();
                ReadingVocabReader.updateCounts();
                ReadingVocabReader.applyVocabHighlights();
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
