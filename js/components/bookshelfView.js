(function initBookshelfView(global) {
    'use strict';

    const BOOKSHELF_KEY = 'ielts_reading_bookshelf_exams_v1';
    const VOCAB_KEY = 'ielts_reading_vocab_words_v1';

    // ============================================================================
    // 书架数据管理 (ReadingBookshelfStore)
    // ============================================================================
    const ReadingBookshelfStore = {
        _commitBound: false,

        getRawRecords() {
            try {
                const raw = localStorage.getItem(BOOKSHELF_KEY);
                return raw ? JSON.parse(raw) : [];
            } catch (e) {
                console.warn('[ReadingBookshelfStore] 读取书架记录失败:', e);
                return [];
            }
        },

        saveRecords(records) {
            try {
                localStorage.setItem(BOOKSHELF_KEY, JSON.stringify(records || []));
            } catch (e) {
                console.warn('[ReadingBookshelfStore] 保存书架记录失败:', e);
            }
            this.syncToAppData(records);
        },

        async syncToAppData(records) {
            try {
                if (global.AppData && global.AppData.vocab && typeof global.AppData.vocab.saveReadingBookshelfExams === 'function') {
                    await global.AppData.vocab.saveReadingBookshelfExams(records || this.getRawRecords());
                }
            } catch (e) {
                console.warn('[ReadingBookshelfStore] syncToAppData failed:', e);
            }
        },

        async flushToAppData() {
            return this.syncToAppData(this.getRawRecords());
        },

        async init() {
            this.bindCommitListener();
            try {
                if (global.AppData && global.AppData.ready) {
                    await global.AppData.ready;
                }
                if (global.AppData && global.AppData.vocab && typeof global.AppData.vocab.listReadingBookshelfExams === 'function') {
                    const result = await global.AppData.vocab.listReadingBookshelfExams({ withMeta: true });
                    const appDataRecords = Array.isArray(result) ? result : result && result.envelope && result.data;
                    // AppData owns legacy migration. Its restored collection,
                    // including an empty array, replaces the local display mirror.
                    // An absent envelope can mean migration failed; retain its
                    // only legacy copy instead of treating the default [] as a clear.
                    if (Array.isArray(appDataRecords)) {
                        localStorage.setItem(BOOKSHELF_KEY, JSON.stringify(appDataRecords));
                    }
                }
            } catch (e) {
                console.warn('[ReadingBookshelfStore] init failed:', e);
            }
        },

        bindCommitListener() {
            if (this._commitBound) return;
            if (global.AppData && global.AppData.backups && typeof global.AppData.backups.onDataCommitted === 'function') {
                this._commitBound = true;
                global.AppData.backups.onDataCommitted(async (event) => {
                    const targets = event && event.targets;
                    if (!Array.isArray(targets)) return;
                    const hasBookshelf = targets.some(t => t.logicalKey === 'vocab.readingBookshelfExams');
                    if (hasBookshelf) {
                        try {
                            const updated = await global.AppData.vocab.listReadingBookshelfExams();
                            if (Array.isArray(updated)) {
                                localStorage.setItem(BOOKSHELF_KEY, JSON.stringify(updated));
                                window.dispatchEvent(new CustomEvent('reading-bookshelf-store-updated', { detail: { records: updated } }));
                            }
                        } catch (err) {
                            console.warn('[ReadingBookshelfStore] reload on committed failed:', err);
                        }
                    }
                });
            }
        },

        recordExamUsed(examId, examTitle = '', category = '') {
            if (!examId) return;
            try {
                const records = this.getRawRecords();
                const now = Date.now();
                const idx = records.findIndex(r => String(r.examId) === String(examId));
                if (idx !== -1) {
                    records[idx].lastOpenedAt = now;
                    if (examTitle && !records[idx].examTitle) {
                        records[idx].examTitle = examTitle;
                    }
                    if (category && !records[idx].category) {
                        records[idx].category = category;
                    }
                } else {
                    records.unshift({
                        examId: String(examId),
                        examTitle: examTitle || '',
                        category: category || '',
                        firstUsedAt: now,
                        lastOpenedAt: now
                    });
                }
                this.saveRecords(records);
            } catch (e) {
                console.warn('[ReadingBookshelfStore] 记录题目失败:', e);
            }
        },

        getBookshelfExams() {
            // 1. 读取全部生词
            let vocabWords = [];
            try {
                const raw = localStorage.getItem(VOCAB_KEY);
                if (raw) vocabWords = JSON.parse(raw);
            } catch (e) {}

            // 统计生词数据映射
            const vocabMap = new Map();
            vocabWords.forEach(item => {
                if (!item || !item.examId) return;
                const eid = String(item.examId);
                if (!vocabMap.has(eid)) {
                    vocabMap.set(eid, {
                        count: 0,
                        words: [],
                        latestTime: item.createdAt || 0,
                        examTitle: item.examTitle || ''
                    });
                }
                const group = vocabMap.get(eid);
                group.count++;
                if (group.words.length < 6 && item.word) {
                    group.words.push(item.word);
                }
                if (item.createdAt && item.createdAt > group.latestTime) {
                    group.latestTime = item.createdAt;
                }
                if (!group.examTitle && item.examTitle) {
                    group.examTitle = item.examTitle;
                }
            });

            // 2. 读取书架记录
            const records = this.getRawRecords();
            const recordMap = new Map();
            records.forEach(r => {
                if (r && r.examId) {
                    recordMap.set(String(r.examId), r);
                }
            });

            // 3. 读取全局 Manifest 题库元信息
            const manifest = (typeof window !== 'undefined' && window.__READING_EXAM_MANIFEST__) || {};

            // 4. 合并集合（记录过的题目 + 拥有生词的题目）
            const allExamIds = new Set([...recordMap.keys(), ...vocabMap.keys()]);
            const results = [];

            allExamIds.forEach(examId => {
                const rec = recordMap.get(examId) || {};
                const vocab = vocabMap.get(examId) || { count: 0, words: [], latestTime: 0, examTitle: '' };
                const meta = manifest[examId] || {};

                const title = rec.examTitle || vocab.examTitle || meta.title || meta.name || examId;
                const category = rec.category || meta.category || meta.type || '雅思阅读';
                const lastActivity = Math.max(rec.lastOpenedAt || 0, vocab.latestTime || 0, rec.firstUsedAt || 0);

                results.push({
                    examId: examId,
                    title: title,
                    category: category,
                    wordCount: vocab.count,
                    sampleWords: vocab.words,
                    lastActivityAt: lastActivity || Date.now(),
                    hasPdf: Boolean(meta.pdfPath || meta.pdf)
                });
            });

            // 默认按最后活动时间倒序排序
            results.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
            return results;
        },

        removeExam(examId, alsoDeleteWords = true) {
            try {
                const targetExamId = String(examId).trim();
                if (!targetExamId) return false;

                // 1. 从书架记录中移除篇目
                const records = this.getRawRecords().filter(r => String(r.examId || r.id).trim() !== targetExamId);
                this.saveRecords(records);

                // 2. 仅删除该篇目下的生词本记录（严格与做题练习记录隔离）
                if (alsoDeleteWords) {
                    // 若全局内存中存在 ReadingVocabStore，同步调用 clear
                    if (global.ReadingVocabStore && typeof global.ReadingVocabStore.clear === 'function') {
                        try {
                            global.ReadingVocabStore.clear(targetExamId);
                        } catch (err) {
                            console.warn('[ReadingBookshelfStore] ReadingVocabStore.clear 失败:', err);
                        }
                    }

                    // 持久化存储过滤生词
                    let vocabWords = [];
                    const raw = localStorage.getItem(VOCAB_KEY);
                    if (raw) {
                        try { vocabWords = JSON.parse(raw); } catch (_) {}
                    }
                    const filtered = vocabWords.filter(w => String(w.examId).trim() !== targetExamId);
                    try {
                        localStorage.setItem(VOCAB_KEY, JSON.stringify(filtered));
                    } catch (e) {
                        console.warn('[ReadingBookshelfStore] 保存过滤生词失败:', e);
                    }

                    // 同步到 AppData.vocab
                    if (global.AppData && global.AppData.vocab && typeof global.AppData.vocab.saveReadingWords === 'function') {
                        global.AppData.vocab.saveReadingWords(filtered).catch(err => {
                            console.warn('[ReadingBookshelfStore] 同步生词删除至 AppData 失败:', err);
                        });
                    }

                    // 广播生词变更事件，通知所有打开的阅读器及组件
                    try {
                        window.dispatchEvent(new CustomEvent('reading-vocab-store-updated', {
                            detail: { examId: targetExamId, action: 'clear-exam-vocab' }
                        }));
                    } catch (_) {}
                }

                // 3. 严格数据隔离：绝不触碰任何做题练习记录（做题历史、得分记录、错题记录等完整保留）

                // 4. 广播书架更新事件
                try {
                    window.dispatchEvent(new CustomEvent('reading-bookshelf-store-updated', {
                        detail: { examId: targetExamId, action: 'remove-exam' }
                    }));
                } catch (_) {}

                return true;
            } catch (e) {
                console.warn('[ReadingBookshelfStore] 移除题目失败:', e);
                return false;
            }
        },

        exportExamTxt(examId, examTitle) {
            let vocabWords = [];
            try {
                const raw = localStorage.getItem(VOCAB_KEY);
                if (raw) vocabWords = JSON.parse(raw);
            } catch (e) {}

            const examWords = vocabWords.filter(item => String(item.examId) === String(examId));
            if (examWords.length === 0) {
                return false;
            }

            const words = [];
            const seen = new Set();
            examWords.forEach(item => {
                const w = (typeof item === 'string' ? item : item?.word || '').trim();
                if (w && !seen.has(w.toLowerCase())) {
                    seen.add(w.toLowerCase());
                    words.push(w);
                }
            });

            if (words.length === 0) {
                return false;
            }

            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;

            const rawTitle = examTitle || examWords[0]?.examTitle || examId || '阅读生词本';
            const safeTitle = String(rawTitle).replace(/[\\/:*?"<>|]/g, '_').trim();
            const filename = `${dateStr}_${safeTitle}.txt`;

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
            return { filename, count: words.length };
        },

        exportAllBookshelfTxt() {
            let vocabWords = [];
            try {
                const raw = localStorage.getItem(VOCAB_KEY);
                if (raw) vocabWords = JSON.parse(raw);
            } catch (e) {}

            if (vocabWords.length === 0) {
                return false;
            }

            const words = [];
            const seen = new Set();
            vocabWords.forEach(item => {
                const w = (typeof item === 'string' ? item : item?.word || '').trim();
                if (w && !seen.has(w.toLowerCase())) {
                    seen.add(w.toLowerCase());
                    words.push(w);
                }
            });

            if (words.length === 0) {
                return false;
            }

            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            const filename = `${dateStr}_书架全部阅读生词.txt`;

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
            return { filename, count: words.length };
        }
    };

    global.ReadingBookshelfStore = ReadingBookshelfStore;

    // ============================================================================
    // 书架视图控制器 (BookshelfView)
    // ============================================================================
    const BookshelfView = {
        containerSelector: '#bookshelf-root',
        state: {
            searchQuery: '',
            sortBy: 'recent', // 'recent' | 'words' | 'title'
            filterMode: 'all', // 'all' | 'has-words'
            fromView: null,
            toastTimer: null
        },

        mount(targetSelector = '#bookshelf-view', options = {}) {
            if (options && options.fromView) {
                this.state.fromView = options.fromView;
            }
            const viewElement = document.querySelector(targetSelector);
            if (!viewElement) return;

            let root = viewElement.querySelector(this.containerSelector);
            if (!root) {
                root = document.createElement('div');
                root.id = 'bookshelf-root';
                root.className = 'bookshelf-view-shell';
                viewElement.appendChild(root);
            }

            this.render();
            this.bindGlobalEvents();
        },

        render() {
            const root = document.querySelector(this.containerSelector);
            if (!root) return;

            const allExams = ReadingBookshelfStore.getBookshelfExams();
            const totalWords = allExams.reduce((sum, item) => sum + item.wordCount, 0);

            // 过滤与搜索
            let filtered = allExams.slice();
            if (this.state.searchQuery) {
                const q = this.state.searchQuery.toLowerCase().trim();
                filtered = filtered.filter(item => {
                    const matchTitle = (item.title || '').toLowerCase().includes(q);
                    const matchCategory = (item.category || '').toLowerCase().includes(q);
                    const matchWords = (item.sampleWords || []).some(w => w.toLowerCase().includes(q));
                    return matchTitle || matchCategory || matchWords;
                });
            }

            if (this.state.filterMode === 'has-words') {
                filtered = filtered.filter(item => item.wordCount > 0);
            }

            // 排序
            if (this.state.sortBy === 'recent') {
                filtered.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
            } else if (this.state.sortBy === 'words') {
                filtered.sort((a, b) => b.wordCount - a.wordCount);
            } else if (this.state.sortBy === 'title') {
                filtered.sort((a, b) => a.title.localeCompare(b.title));
            }

            const isFromOverview = this.state.fromView === 'overview';
            const backBtnTitle = isFromOverview ? '返回学习总览' : '返回更多工具';
            const backBtnText = isFromOverview ? '返回总览' : '返回更多';

            root.innerHTML = `
                <div class="bookshelf-layout">
                    <!-- 顶部标题栏与导航 -->
                    <div class="bookshelf-topbar">
                        <div class="bookshelf-topbar__left">
                            <button type="button" class="btn btn-secondary bookshelf-back-btn" data-action="return-more" title="${backBtnTitle}">
                                <span class="bookshelf-back-arrow">←</span>
                                <span>${backBtnText}</span>
                            </button>
                            <div class="bookshelf-heading-group">
                                <h2 class="bookshelf-title">📚 阅读书架</h2>
                                <p class="bookshelf-subtitle">收录使用过生词本的精读篇目，温故知新，查缺补漏</p>
                            </div>
                        </div>
                        <div class="bookshelf-topbar__right">
                            <button type="button" class="btn btn-secondary bookshelf-export-all-btn" data-action="export-all-bookshelf" ${totalWords === 0 ? 'disabled' : ''} title="一键导出书架全部生词为 TXT">
                                📥 导出全部生词
                            </button>
                            <button type="button" class="btn btn-primary bookshelf-notebook-btn" data-action="open-global-notebook" title="打开生词本总览">
                                📖 打开生词本
                            </button>
                        </div>
                    </div>

                    <!-- 统计数据横幅 -->
                    <div class="bookshelf-stats-banner">
                        <div class="bookshelf-stat-card">
                            <span class="bookshelf-stat-icon">📖</span>
                            <div class="bookshelf-stat-content">
                                <span class="bookshelf-stat-value">${allExams.length}</span>
                                <span class="bookshelf-stat-label">收录篇目</span>
                            </div>
                        </div>
                        <div class="bookshelf-stat-card">
                            <span class="bookshelf-stat-icon">🔤</span>
                            <div class="bookshelf-stat-content">
                                <span class="bookshelf-stat-value">${totalWords}</span>
                                <span class="bookshelf-stat-label">积累生词</span>
                            </div>
                        </div>
                        <div class="bookshelf-stat-card">
                            <span class="bookshelf-stat-icon">🕒</span>
                            <div class="bookshelf-stat-content">
                                <span class="bookshelf-stat-value">${this.formatLatestTime(allExams[0]?.lastActivityAt)}</span>
                                <span class="bookshelf-stat-label">最近精读</span>
                            </div>
                        </div>
                    </div>

                    <!-- 检索与筛选工具条 -->
                    <div class="bookshelf-toolbar">
                        <div class="bookshelf-search-box">
                            <span class="bookshelf-search-icon">🔍</span>
                            <input
                                type="text"
                                class="bookshelf-search-input"
                                placeholder="搜索篇目名称、分类或单词..."
                                value="${this.escapeHtml(this.state.searchQuery)}"
                                data-action="search-input"
                            />
                            ${this.state.searchQuery ? '<button type="button" class="bookshelf-search-clear" data-action="clear-search" title="清空搜索">×</button>' : ''}
                        </div>

                        <div class="bookshelf-filter-group">
                            <div class="bookshelf-segmented">
                                <button type="button" class="bookshelf-segment-btn ${this.state.filterMode === 'all' ? 'active' : ''}" data-action="set-filter" data-mode="all">
                                    全部 (${allExams.length})
                                </button>
                                <button type="button" class="bookshelf-segment-btn ${this.state.filterMode === 'has-words' ? 'active' : ''}" data-action="set-filter" data-mode="has-words">
                                    有生词 (${allExams.filter(e => e.wordCount > 0).length})
                                </button>
                            </div>

                            <div class="bookshelf-sort-select-wrapper">
                                <select class="bookshelf-sort-select" data-action="change-sort">
                                    <option value="recent" ${this.state.sortBy === 'recent' ? 'selected' : ''}>🕒 最近学习</option>
                                    <option value="words" ${this.state.sortBy === 'words' ? 'selected' : ''}>🔥 生词最多</option>
                                    <option value="title" ${this.state.sortBy === 'title' ? 'selected' : ''}>🔤 篇目名称</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- 篇目卡片网格 -->
                    <div class="bookshelf-content-area">
                        ${filtered.length > 0 ? this.renderCardGrid(filtered) : this.renderEmptyState(allExams.length === 0)}
                    </div>
                </div>

                <!-- 操作轻量反馈浮层 (Toast) -->
                <div id="bookshelf-toast" class="bookshelf-toast is-hidden" role="status" aria-live="polite"></div>
            `;

            this.bindCardEvents(root);
        },

        renderCardGrid(exams) {
            return `
                <div class="bookshelf-grid">
                    ${exams.map(exam => this.renderExamCard(exam)).join('')}
                </div>
            `;
        },

        renderExamCard(exam) {
            const formattedTime = this.formatFriendlyDate(exam.lastActivityAt);
            const wordsList = exam.sampleWords || [];

            return `
                <div class="bookshelf-card" data-exam-id="${this.escapeHtml(exam.examId)}">
                    <div class="bookshelf-card__header">
                        <div class="bookshelf-card__tags">
                            <span class="bookshelf-card__badge bookshelf-card__badge--category">${this.escapeHtml(exam.category || '雅思阅读')}</span>
                            ${exam.wordCount > 0
                                ? `<span class="bookshelf-card__badge bookshelf-card__badge--vocab">🔥 ${exam.wordCount} 个生词</span>`
                                : `<span class="bookshelf-card__badge bookshelf-card__badge--read">📖 已入精读</span>`
                            }
                        </div>
                        <button type="button" class="bookshelf-card__remove-btn" data-action="remove-exam" data-exam-id="${this.escapeHtml(exam.examId)}" data-exam-title="${this.escapeHtml(exam.title)}" title="从书架移除（仅移出生词本，保留做题练习数据）">
                            🗑️
                        </button>
                    </div>

                    <div class="bookshelf-card__body">
                        <h3 class="bookshelf-card__title" data-action="open-reading-vocab" data-exam-id="${this.escapeHtml(exam.examId)}" title="点击进入全文精读与生词本">
                            ${this.escapeHtml(exam.title)}
                        </h3>
                        <div class="bookshelf-card__meta">
                            <span class="bookshelf-card__time">🕒 ${formattedTime}</span>
                        </div>

                        <!-- 生词预览药丸标签 -->
                        <div class="bookshelf-card__vocab-preview">
                            ${wordsList.length > 0 ? `
                                <div class="bookshelf-vocab-chips">
                                    ${wordsList.map(w => `
                                        <button type="button" class="bookshelf-vocab-chip" data-action="speak-word" data-word="${this.escapeHtml(w)}" title="点击朗读发音">
                                            <span>${this.escapeHtml(w)}</span>
                                            <span class="bookshelf-chip-audio">🔊</span>
                                        </button>
                                    `).join('')}
                                    ${exam.wordCount > wordsList.length ? `<span class="bookshelf-vocab-chip-more">+${exam.wordCount - wordsList.length}</span>` : ''}
                                </div>
                            ` : `
                                <p class="bookshelf-vocab-empty-hint">暂未划词收录，可在全文中自由选词加入生词本</p>
                            `}
                        </div>
                    </div>

                    <!-- 卡片操作底栏 -->
                    <div class="bookshelf-card__footer">
                        <button type="button" class="btn btn-primary bookshelf-action-btn bookshelf-action-btn--main" data-action="open-reading-vocab" data-exam-id="${this.escapeHtml(exam.examId)}" title="进入划词与生词本">
                            📖 划词
                        </button>
                        <button type="button" class="btn btn-secondary bookshelf-action-btn" data-action="open-exam-practice" data-exam-id="${this.escapeHtml(exam.examId)}">
                            📝 做题
                        </button>
                        ${exam.hasPdf ? `
                            <button type="button" class="btn btn-secondary bookshelf-action-btn" data-action="open-exam-pdf" data-exam-id="${this.escapeHtml(exam.examId)}">
                                📄 PDF
                            </button>
                        ` : ''}
                        <button type="button" class="btn btn-secondary bookshelf-action-btn" data-action="export-exam-txt" data-exam-id="${this.escapeHtml(exam.examId)}" data-exam-title="${this.escapeHtml(exam.title)}" ${exam.wordCount === 0 ? 'disabled' : ''} title="导出本篇生词 TXT">
                            📥 导出
                        </button>
                    </div>
                </div>
            `;
        },

        renderEmptyState(isCompletelyEmpty) {
            if (isCompletelyEmpty) {
                return `
                    <div class="bookshelf-empty-state">
                        <div class="bookshelf-empty-icon">📚</div>
                        <h3 class="bookshelf-empty-title">书架尚未收录篇目</h3>
                        <p class="bookshelf-empty-desc">
                            在「题库浏览」中点击任意阅读题目的「精读」，或在阅读过程中划词收录生词，篇目将自动收录至此，方便您随时集中精读与复习。
                        </p>
                        <div class="bookshelf-empty-actions">
                            <button type="button" class="btn btn-primary" data-action="go-to-browse">
                                📚 前往题库浏览
                            </button>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="bookshelf-empty-state">
                    <div class="bookshelf-empty-icon">🔍</div>
                    <h3 class="bookshelf-empty-title">未找到匹配的篇目</h3>
                    <p class="bookshelf-empty-desc">请尝试调整搜索关键词或重置筛选条件。</p>
                    <div class="bookshelf-empty-actions">
                        <button type="button" class="btn btn-secondary" data-action="reset-search">
                            重置搜索与筛选
                        </button>
                    </div>
                </div>
            `;
        },

        bindCardEvents(root) {
            // 搜索输入监听
            const searchInput = root.querySelector('[data-action="search-input"]');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    this.state.searchQuery = e.target.value;
                    this.render();
                    const nextInput = root.querySelector('[data-action="search-input"]');
                    if (nextInput) {
                        nextInput.focus();
                        nextInput.selectionStart = nextInput.selectionEnd = nextInput.value.length;
                    }
                });
            }

            // 清空搜索
            const clearBtn = root.querySelector('[data-action="clear-search"]');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    this.state.searchQuery = '';
                    this.render();
                });
            }

            // 排序切换
            const sortSelect = root.querySelector('[data-action="change-sort"]');
            if (sortSelect) {
                sortSelect.addEventListener('change', (e) => {
                    this.state.sortBy = e.target.value;
                    this.render();
                });
            }

            // 筛选切换
            root.querySelectorAll('[data-action="set-filter"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.state.filterMode = btn.dataset.mode || 'all';
                    this.render();
                });
            });

            // 重置搜索与筛选
            const resetBtn = root.querySelector('[data-action="reset-search"]');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    this.state.searchQuery = '';
                    this.state.filterMode = 'all';
                    this.render();
                });
            }

            // 返回更多工具
            const backBtn = root.querySelector('[data-action="return-more"]');
            if (backBtn) {
                backBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.navigateToMoreView();
                });
            }

            // 导出全部
            const exportAllBtn = root.querySelector('[data-action="export-all-bookshelf"]');
            if (exportAllBtn) {
                exportAllBtn.addEventListener('click', () => {
                    const res = ReadingBookshelfStore.exportAllBookshelfTxt();
                    if (res) {
                        this.showToast(`✅ 已导出 ${res.count} 个生词（${res.filename}）`);
                    } else {
                        this.showToast('⚠️ 书架暂无生词可导出');
                    }
                });
            }

            // 打开全局生词本
            const globalNotebookBtn = root.querySelector('[data-action="open-global-notebook"]');
            if (globalNotebookBtn) {
                globalNotebookBtn.addEventListener('click', () => {
                    if (global.ReadingVocabReader && typeof global.ReadingVocabReader.openModal === 'function') {
                        global.ReadingVocabReader.openModal();
                    } else {
                        this.showToast('⚠️ 生词本组件正在加载...');
                    }
                });
            }

            // 前往题库
            const goToBrowseBtn = root.querySelector('[data-action="go-to-browse"]');
            if (goToBrowseBtn) {
                goToBrowseBtn.addEventListener('click', () => {
                    if (global.app && typeof global.app.navigateToView === 'function') {
                        global.app.navigateToView('browse');
                    } else if (typeof global.switchView === 'function') {
                        global.switchView('browse');
                    }
                });
            }

            // 单个卡片事件代理
            root.addEventListener('click', (e) => {
                // 打开生词本精读
                const openVocabTrigger = e.target.closest('[data-action="open-reading-vocab"]');
                if (openVocabTrigger) {
                    const examId = openVocabTrigger.dataset.examId;
                    this.launchExamVocabReader(examId);
                    return;
                }

                // 打开题目练习
                const openPracticeTrigger = e.target.closest('[data-action="open-exam-practice"]');
                if (openPracticeTrigger) {
                    const examId = openPracticeTrigger.dataset.examId;
                    if (global.app && typeof global.app.openExam === 'function') {
                        global.app.openExam(examId);
                    } else if (typeof global.openExam === 'function') {
                        global.openExam(examId);
                    }
                    return;
                }

                // 查看 PDF
                const openPdfTrigger = e.target.closest('[data-action="open-exam-pdf"]');
                if (openPdfTrigger) {
                    const examId = openPdfTrigger.dataset.examId;
                    if (typeof global.viewPDF === 'function') {
                        global.viewPDF(examId);
                    }
                    return;
                }

                // 导出单篇文章生词 TXT
                const exportTxtTrigger = e.target.closest('[data-action="export-exam-txt"]');
                if (exportTxtTrigger) {
                    const examId = exportTxtTrigger.dataset.examId;
                    const examTitle = exportTxtTrigger.dataset.examTitle || '';
                    const res = ReadingBookshelfStore.exportExamTxt(examId, examTitle);
                    if (res) {
                        this.showToast(`✅ 已导出：${res.filename}`);
                    } else {
                        this.showToast('⚠️ 该篇目暂无可导出的生词');
                    }
                    return;
                }

                // 移除篇目（点击拦截冒泡并弹出安全确认对话框）
                const removeTrigger = e.target.closest('[data-action="remove-exam"]');
                if (removeTrigger) {
                    e.stopPropagation();
                    e.preventDefault();
                    const examId = removeTrigger.dataset.examId;
                    const examTitle = removeTrigger.dataset.examTitle || examId;
                    this.openConfirmDialog(examId, examTitle);
                    return;
                }

                // 朗读单词
                const speakTrigger = e.target.closest('[data-action="speak-word"]');
                if (speakTrigger) {
                    const word = speakTrigger.dataset.word;
                    this.speakWord(word);
                    return;
                }
            });
        },

        bindGlobalEvents() {
            // 可在此处理全局监听
        },

        openConfirmDialog(examId, examTitle) {
            let overlay = document.getElementById('bookshelf-confirm-dialog');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'bookshelf-confirm-dialog';
                overlay.className = 'bookshelf-confirm-overlay is-hidden';
                overlay.innerHTML = `
                    <div class="bookshelf-confirm-box" role="dialog" aria-modal="true">
                        <div class="bookshelf-confirm-header">
                            <span class="bookshelf-confirm-icon">🗑️</span>
                            <h4 class="bookshelf-confirm-title">从书架移除篇目</h4>
                        </div>
                        <p class="bookshelf-confirm-msg" id="bookshelf-confirm-text"></p>
                        <div class="bookshelf-confirm-notice">
                            <span class="bookshelf-notice-badge">数据安全隔离</span>
                            <p class="bookshelf-notice-text">
                                此操作仅从<strong>书架与生词本</strong>中移除该篇收录。<br/>
                                <strong>您的做题练习记录、答题历史与解析数据完整保留</strong>，不受任何影响。
                            </p>
                        </div>
                        <div class="bookshelf-confirm-actions">
                            <button type="button" class="btn btn-secondary bookshelf-confirm-btn" id="bookshelf-confirm-cancel">取消</button>
                            <button type="button" class="btn btn-danger bookshelf-confirm-btn" id="bookshelf-confirm-ok">确认移除</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(overlay);
            }

            const textEl = overlay.querySelector('#bookshelf-confirm-text');
            if (textEl) {
                textEl.textContent = `确定要从书架移除《${examTitle || examId}》吗？`;
            }

            const okBtn = overlay.querySelector('#bookshelf-confirm-ok');
            const cancelBtn = overlay.querySelector('#bookshelf-confirm-cancel');

            const closeDialog = () => {
                overlay.classList.add('is-hidden');
            };

            okBtn.onclick = () => {
                closeDialog();
                // 仅删除书架与生词本记录，严格保留练习做题数据
                ReadingBookshelfStore.removeExam(examId, true);
                this.showToast(`已从书架移除《${examTitle}》（做题练习记录已保留）`);
                this.render();
            };

            cancelBtn.onclick = () => {
                closeDialog();
            };

            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    closeDialog();
                }
            };

            overlay.classList.remove('is-hidden');
        },

        async launchExamVocabReader(examId) {
            if (!examId) return;

            // 确保 ReadingVocabReader 依赖加载
            if (!global.ReadingVocabReader && global.lazyLoader && typeof global.lazyLoader.ensureGroup === 'function') {
                try {
                    await global.lazyLoader.ensureGroup('browse-runtime');
                } catch (e) {
                    console.warn('[BookshelfView] 加载 browse-runtime 失败:', e);
                }
            }

            if (global.ReadingVocabReader && typeof global.ReadingVocabReader.open === 'function') {
                global.ReadingVocabReader.open(examId);
            } else if (typeof global.openReadingVocabReader === 'function') {
                global.openReadingVocabReader(examId);
            } else {
                this.showToast('⚠️ 生词本阅读组件尚未就绪，请稍后重试');
            }
        },

        speakWord(word) {
            if (!word) return;
            try {
                if (window.speechSynthesis) {
                    window.speechSynthesis.cancel();
                    const utterance = new SpeechSynthesisUtterance(word);
                    utterance.lang = 'en-US';
                    utterance.rate = 0.9;
                    window.speechSynthesis.speak(utterance);
                }
            } catch (e) {
                console.warn('[BookshelfView] 发音朗读异常:', e);
            }
        },

        navigateToMoreView() {
            const returnTarget = this.state.fromView || 'more';
            this.state.fromView = null;
            const bookshelfView = document.getElementById('bookshelf-view');
            const targetView = document.getElementById(`${returnTarget}-view`);

            if (bookshelfView) {
                bookshelfView.classList.remove('active');
                bookshelfView.setAttribute('hidden', '');
            }

            if (global.app && typeof global.app.navigateToView === 'function') {
                try {
                    global.app.navigateToView(returnTarget);
                    return;
                } catch (err) {
                    console.warn('[BookshelfView] navigateToView 异常:', err);
                }
            }

            if (targetView) {
                targetView.classList.add('active');
                targetView.removeAttribute('hidden');
            }

            const navBtn = document.querySelector(`.nav-btn[data-view="${returnTarget}"]`);
            if (navBtn) {
                document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
                navBtn.classList.add('active');
            }
        },

        showToast(msg, duration = 2500) {
            const toast = document.getElementById('bookshelf-toast');
            if (!toast) return;

            toast.textContent = msg;
            toast.classList.remove('is-hidden');
            toast.classList.add('is-visible');

            if (this.state.toastTimer) {
                clearTimeout(this.state.toastTimer);
            }

            this.state.toastTimer = setTimeout(() => {
                toast.classList.remove('is-visible');
                setTimeout(() => toast.classList.add('is-hidden'), 250);
            }, duration);
        },

        formatFriendlyDate(timestamp) {
            if (!timestamp) return '未记录';
            const date = new Date(timestamp);
            const now = new Date();
            const diffMs = now - date;
            const diffMin = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMin / 60);
            const diffDays = Math.floor(diffHours / 24);

            if (diffMin < 2) return '刚刚';
            if (diffMin < 60) return `${diffMin} 分钟前`;
            if (diffHours < 24) return `${diffHours} 小时前`;
            if (diffDays < 7) return `${diffDays} 天前`;

            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        },

        formatLatestTime(timestamp) {
            if (!timestamp) return '暂无';
            return this.formatFriendlyDate(timestamp);
        },

        escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }
    };

    if (typeof window !== 'undefined') {
        window.addEventListener('reading-bookshelf-store-updated', () => {
            const root = document.querySelector(BookshelfView.containerSelector);
            if (root && root.offsetParent !== null) {
                BookshelfView.render();
            }
        });
        window.addEventListener('reading-vocab-store-updated', () => {
            const root = document.querySelector(BookshelfView.containerSelector);
            if (root && root.offsetParent !== null) {
                BookshelfView.render();
            }
        });
    }

    global.BookshelfView = BookshelfView;
    ReadingBookshelfStore.init();
})(window);
