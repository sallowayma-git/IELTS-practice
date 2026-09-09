(function initBookshelfView(global) {
    'use strict';

    function needsPageReload(error) {
        return error && error.code === 'BACKEND_UNAVAILABLE';
    }

    // AppData owns persistence. This snapshot is only a view cache and is never
    // written back as a whole collection.
    const ReadingBookshelfStore = {
        _snapshot: null,
        _revision: null,
        _generation: null,
        _commitBound: false,
        _loadSequence: 0,
        _loadError: null,
        _loading: false,
        _sourceMetadata: new Map(),

        getRawRecords() {
            return this.getBookshelfExams().map((exam) => ({
                articleId: exam.articleId, source: exam.source, examId: exam.examId,
                examTitle: exam.title, category: exam.category, lastOpenedAt: exam.lastActivityAt
            }));
        },

        async resolveSource(source) {
            if (source) return source;
            if (global.ReadingVocabStore && typeof global.ReadingVocabStore.resolveSource === 'function') {
                return global.ReadingVocabStore.resolveSource({});
            }
            const library = global.AppData && global.AppData.library;
            const id = library && typeof library.getActive === 'function' ? await library.getActive() : null;
            return id ? { kind: 'imported', id } : { kind: 'builtin', id: 'default' };
        },

        _adopt(result) {
            if (!result || !result.snapshot) throw new Error('Reading snapshot is unavailable');
            if (this._generation === result.generation && this._revision !== null && result.revision < this._revision) return false;
            this._snapshot = result.snapshot;
            this._revision = result.revision;
            this._generation = result.generation;
            this._loadError = null;
            return true;
        },

        _notify(detail = {}) {
            global.dispatchEvent(new CustomEvent('reading-bookshelf-store-updated', { detail }));
        },

        async init() {
            const sequence = ++this._loadSequence;
            this._loading = true;
            this._notify({ action: 'loading' });
            try {
                if (global.AppData && global.AppData.ready) await global.AppData.ready;
                this.bindCommitListener();
                const vocab = global.AppData && global.AppData.vocab;
                if (!vocab || typeof vocab.getReadingSnapshot !== 'function') {
                    throw new Error('Reading persistence is unavailable');
                }
                const result = await vocab.getReadingSnapshot();
                const metadata = await this._readSourceMetadata(result.snapshot);
                if (sequence === this._loadSequence) {
                    if (this._adopt(result)) this._sourceMetadata = metadata;
                    this._loading = false;
                    this._notify({ action: 'reload' });
                }
                return result;
            } catch (error) {
                if (sequence === this._loadSequence) {
                    this._loading = false;
                    this._loadError = error;
                    this._notify({ action: 'load-failed' });
                }
                throw error;
            }
        },

        // Compatibility flush callers wait for a fresh durable snapshot.
        async flushToAppData() { return this.init(); },

        async _readSourceMetadata(snapshot) {
            const library = global.AppData && global.AppData.library;
            const metadata = new Map();
            if (!library) return metadata;
            try {
                const configurations = typeof library.listConfigurations === 'function'
                    ? await library.listConfigurations() : [];
                await Promise.all(snapshot.reading.sources.filter((row) => row.kind === 'imported').map(async (source) => {
                    const config = configurations.find((row) => String(row.id || row.key || row.configId) === source.libraryId);
                    const index = typeof library.getIndex === 'function' ? await library.getIndex(source.libraryId) : null;
                    metadata.set(source.id, {
                        name: config && (config.name || config.title) || source.libraryId,
                        index: Array.isArray(index) ? index : null
                    });
                }));
            } catch (error) {
                // Stored vocabulary remains usable when source metadata cannot be read.
                console.warn('[ReadingBookshelfStore] Source metadata unavailable:', error);
            }
            return metadata;
        },

        bindCommitListener() {
            if (this._commitBound) return;
            const backups = global.AppData && global.AppData.backups;
            if (backups && typeof backups.onDataCommitted === 'function') {
                this._commitBound = true;
                backups.onDataCommitted((event) => {
                    const targets = event && event.targets;
                    if (Array.isArray(targets) && targets.some((target) => /^(vocab|library)\./.test(String(target.logicalKey || '')))) {
                        this.init().catch((error) => console.warn('[ReadingBookshelfStore] Reload failed:', error));
                    }
                });
            }
        },

        async _mutate(type, command) {
            if (!this._snapshot) await this.init();
            let result;
            try {
                result = await global.AppData.vocab.mutateReading(type, command, {
                    observedRevision: this._revision, observedGeneration: this._generation
                });
            } catch (error) {
                // A missed cross-window notification must not leave every retry
                // anchored to a removed association or an old import generation.
                await this.init().catch(() => {});
                throw error;
            }
            if (!result || result.saved !== true) throw new Error('Reading change was not durably acknowledged');
            // An in-flight reload may predate this acknowledgement.
            ++this._loadSequence;
            this._adopt(result);
            this._loading = false;
            this._notify({ action: type, articleId: command.articleId });
            return result;
        },

        async recordExamUsed(examId, examTitle = '', category = '', source) {
            if (!examId) return false;
            return this._mutate('recordVisit', {
                source: await this.resolveSource(source),
                article: { examId: String(examId), title: examTitle || '' }
            });
        },

        getBookshelfExams() {
            const snapshot = this._snapshot;
            if (!snapshot) return [];
            const reading = snapshot.reading;
            const sourceMap = new Map(reading.sources.map((source) => [source.id, source]));
            const termMap = new Map(reading.terms.map((term) => [term.id, term]));
            const visitMap = new Map(reading.visits.map((visit) => [visit.articleId, visit]));
            const associations = new Map();
            reading.associations.forEach((association) => {
                if (!associations.has(association.articleId)) associations.set(association.articleId, []);
                associations.get(association.articleId).push(association);
            });
            const manifest = global.__READING_EXAM_MANIFEST__ || {};
            return reading.articles.filter((article) => visitMap.has(article.id) || associations.has(article.id)).map((article) => {
                const sourceRow = sourceMap.get(article.sourceId);
                const source = { kind: sourceRow.kind, id: sourceRow.libraryId };
                const related = associations.get(article.id) || [];
                const visit = visitMap.get(article.id);
                const sourceMeta = this._sourceMetadata.get(article.sourceId);
                const meta = source.kind === 'builtin' ? manifest[article.examId] || {}
                    : sourceMeta?.index?.find((row) => String(row.id || row.examId) === article.examId) || {};
                const termIds = Array.from(new Set(related.map((association) => association.termId)));
                const words = termIds.map((id) => this._wordForTerm(termMap.get(id))).filter(Boolean);
                const lastActivityAt = Math.max(
                    visit ? Date.parse(visit.lastVisitedAt) : 0,
                    ...related.map((association) => Date.parse(association.updatedAt)),
                    0
                );
                return {
                    articleId: article.id, source, examId: article.examId,
                    sourceLabel: source.kind === 'builtin' ? '内置题库'
                        : `导入题库 · ${sourceMeta?.name && sourceMeta.name !== source.id ? `${sourceMeta.name} (${source.id})` : source.id}`,
                    sourceUnavailable: source.kind === 'imported' && Array.isArray(sourceMeta?.index)
                        && !sourceMeta.index.some((row) => String(row.id || row.examId) === article.examId),
                    title: article.title || meta.title || meta.name || article.examId,
                    category: meta.category || meta.type || '雅思阅读',
                    wordCount: termIds.length, allWords: words.map((word) => word.word),
                    sampleWords: words.slice(0, 6).map((word) => word.word),
                    lastActivityAt, hasPdf: Boolean(meta.pdfPath || meta.pdf)
                };
            }).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
        },

        _wordForTerm(term) {
            if (!term || !this._snapshot) return null;
            const ref = term.wordRef;
            const list = ref.listId === 'default' ? this._snapshot.words : this._snapshot.lists[ref.listId];
            const words = Array.isArray(list) ? list : list && list.words || [];
            return words.find((word) => word.id === ref.wordId) || null;
        },

        getDistinctWordCount() {
            if (!this._snapshot) return 0;
            return new Set(this._snapshot.reading.associations.map((row) => row.termId)).size;
        },

        async _articleId(examId, source, articleId) {
            if (articleId) return articleId;
            const resolvedSource = await this.resolveSource(source);
            return global.AppData.vocab.readingModel.articleId(resolvedSource, String(examId));
        },

        async removeExam(examId, alsoDeleteWords = true, source, articleId) {
            if (!String(examId || '').trim()) return false;
            const id = await this._articleId(examId, source, articleId);
            return this._mutate('removeArticle', { articleId: id, clearWords: alsoDeleteWords });
        },

        async exportExamTxt(examId, examTitle, source, articleId) {
            const id = await this._articleId(examId, source, articleId);
            return this._exportTxt(id, examTitle || examId || '阅读生词本');
        },

        async exportAllBookshelfTxt() {
            return this._exportTxt(null, '全部精读生词');
        },

        async _exportTxt(articleId, title) {
            // init may defer cache adoption to a later pending refresh; its
            // returned snapshot is still the durable read for this export.
            const { snapshot } = await this.init();
            const result = global.AppData.vocab.readingModel.toPlainText(snapshot, articleId ? { articleId } : {});
            if (result.count === 0) return false;

            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            const safeTitle = String(title).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
            const filename = `${dateStr}_${safeTitle}.txt`;

            const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            try {
                a.click();
            } finally {
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 0);
            }
            return { filename, count: result.count };
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
            toastTimer: null,
            readerLoading: false,
            readerError: null
        },
        _readerRequestId: 0,
        _readerLoadPromise: null,
        _lastReaderRequest: null,

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
            ReadingBookshelfStore.init().catch(() => {});
        },

        render() {
            const root = document.querySelector(this.containerSelector);
            if (!root) return;

            const allExams = ReadingBookshelfStore.getBookshelfExams();
            const totalWords = ReadingBookshelfStore.getDistinctWordCount();

            // 过滤与搜索
            let filtered = allExams.slice();
            if (this.state.searchQuery) {
                const q = this.state.searchQuery.toLowerCase().trim();
                filtered = filtered.filter(item => {
                    const matchTitle = (item.title || '').toLowerCase().includes(q);
                    const matchCategory = (item.category || '').toLowerCase().includes(q);
                    const matchSource = `${item.sourceLabel || ''} ${item.source.kind} ${item.source.id}`.toLowerCase().includes(q);
                    const matchWords = (item.allWords || []).some(w => w.toLowerCase().includes(q));
                    return matchTitle || matchCategory || matchSource || matchWords;
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
                    ${ReadingBookshelfStore._loadError ? (needsPageReload(ReadingBookshelfStore._loadError)
                        ? '<p role="alert">书架加载失败，请刷新页面后重试。<button type="button" class="btn btn-secondary" data-action="reload-page">刷新页面</button></p>'
                        : '<p role="alert">书架加载失败，已显示的数据保持不变。<button type="button" class="btn btn-secondary" data-action="retry-load">重试加载</button></p>') : ''}
                    ${this.state.readerLoading ? '<p role="status">正在打开生词本…</p>' : ''}
                    ${this.state.readerError ? (needsPageReload(this.state.readerError)
                        ? '<p role="alert">生词本打开失败，请刷新页面后重试。<button type="button" class="btn btn-secondary" data-action="reload-page">刷新页面</button></p>'
                        : '<p role="alert">生词本打开失败，请重试。<button type="button" class="btn btn-secondary" data-action="retry-reader">重试打开</button></p>') : ''}
                    ${ReadingBookshelfStore._snapshot && ReadingBookshelfStore._loading ? '<p role="status">正在更新书架…</p>' : ''}
                    <!-- 顶部标题栏与导航 -->
                    <div class="bookshelf-topbar">
                        <div class="bookshelf-topbar__left">
                            <button type="button" class="btn btn-secondary bookshelf-back-btn" data-action="return-more" title="${backBtnTitle}">
                                <span class="bookshelf-back-arrow">←</span>
                                <span>${backBtnText}</span>
                            </button>
                            <div class="bookshelf-heading-group">
                                <h2 class="bookshelf-title">📚 阅读书架</h2>
                                <p class="bookshelf-subtitle">收录打开过的精读篇目与生词，随时继续阅读与复习</p>
                            </div>
                        </div>
                        <div class="bookshelf-topbar__right">
                            <button type="button" class="btn btn-secondary bookshelf-export-all-btn" data-action="export-all-bookshelf" ${totalWords === 0 ? 'disabled' : ''} title="导出全部精读生词 TXT，包含所有文章，不受当前搜索和筛选影响">
                                📥 导出全部精读生词
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
                                <span class="bookshelf-stat-label">不重复生词</span>
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
                                placeholder="搜索篇目名称、分类、来源或单词..."
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
                        ${!ReadingBookshelfStore._snapshot ? (ReadingBookshelfStore._loadError ? '' : '<p role="status">正在加载书架…</p>') : filtered.length > 0 ? this.renderCardGrid(filtered) : this.renderEmptyState(allExams.length === 0)}
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
                <div class="bookshelf-card" data-exam-id="${this.escapeHtml(exam.examId)}" data-article-id="${this.escapeHtml(exam.articleId)}">
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
                            <span class="bookshelf-card__source">${this.escapeHtml(exam.sourceLabel)}</span>
                            ${exam.sourceUnavailable ? '<span class="bookshelf-card__source-state">原题库内容不可用 · 可查看与导出生词</span>' : ''}
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
                exportAllBtn.addEventListener('click', async () => {
                    try {
                        const res = await ReadingBookshelfStore.exportAllBookshelfTxt();
                        this.showToast(res ? `✅ 已导出 ${res.count} 个生词（${res.filename}）` : '⚠️ 暂无精读生词可导出');
                    } catch (error) {
                        this.showToast(needsPageReload(error) ? '⚠️ 生词读取失败，请刷新页面后重试导出' : '⚠️ 生词读取失败，请重试导出');
                    }
                });
            }

            // 打开全局生词本
            const globalNotebookBtn = root.querySelector('[data-action="open-global-notebook"]');
            if (globalNotebookBtn) {
                globalNotebookBtn.addEventListener('click', () => {
                    this.launchGlobalNotebook(globalNotebookBtn);
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
            // Re-rendering replaces this delegate instead of accumulating writes.
            root.onclick = async (e) => {
                if (e.target.closest('[data-action="reload-page"]')) {
                    global.location.reload();
                    return;
                }
                if (e.target.closest('[data-action="retry-load"]')) {
                    await ReadingBookshelfStore.init().catch(() => {});
                    return;
                }
                if (e.target.closest('[data-action="retry-reader"]')) {
                    const request = this._lastReaderRequest;
                    if (request?.examId) await this.launchExamVocabReader(request.examId, request.source, request.articleId);
                    else await this.launchGlobalNotebook();
                    return;
                }
                const card = e.target.closest('[data-article-id]');
                const articleId = card && card.dataset.articleId;
                const article = ReadingBookshelfStore.getBookshelfExams().find((exam) => exam.articleId === articleId);
                // 打开生词本精读
                const openVocabTrigger = e.target.closest('[data-action="open-reading-vocab"]');
                if (openVocabTrigger) {
                    const examId = openVocabTrigger.dataset.examId;
                    await this.launchExamVocabReader(examId, article && article.source, articleId, openVocabTrigger);
                    return;
                }

                // 打开题目练习
                const openPracticeTrigger = e.target.closest('[data-action="open-exam-practice"]');
                if (openPracticeTrigger) {
                    const examId = openPracticeTrigger.dataset.examId;
                    if (!await this.canOpenOriginalSource(article)) return;
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
                    if (!await this.canOpenOriginalSource(article)) return;
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
                    try {
                        const res = await ReadingBookshelfStore.exportExamTxt(examId, examTitle, article && article.source, articleId);
                        this.showToast(res ? `✅ 已导出：${res.filename}` : '⚠️ 该篇目暂无可导出的生词');
                    } catch (error) {
                        this.showToast(needsPageReload(error) ? '⚠️ 生词读取失败，请刷新页面后重试导出' : '⚠️ 生词读取失败，请重试导出');
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
                    this.openConfirmDialog(examId, examTitle, article && article.source, articleId);
                    return;
                }

                // 朗读单词
                const speakTrigger = e.target.closest('[data-action="speak-word"]');
                if (speakTrigger) {
                    const word = speakTrigger.dataset.word;
                    this.speakWord(word);
                    return;
                }
            };
        },

        bindGlobalEvents() {
            // 可在此处理全局监听
        },

        openConfirmDialog(examId, examTitle, source, articleId) {
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
            let pending = false;
            let reloadRequired = false;
            okBtn.disabled = false;
            cancelBtn.disabled = false;
            okBtn.textContent = '确认移除';

            const closeDialog = () => {
                if (!pending) overlay.classList.add('is-hidden');
            };

            okBtn.onclick = async () => {
                if (pending) return;
                if (reloadRequired) {
                    global.location.reload();
                    return;
                }
                pending = true;
                okBtn.disabled = true;
                cancelBtn.disabled = true;
                okBtn.textContent = '正在移除…';
                try {
                    const result = await ReadingBookshelfStore.removeExam(examId, true, source, articleId);
                    if (!result || result.saved !== true) throw new Error('Removal was not acknowledged');
                    pending = false;
                    closeDialog();
                    this.render();
                    this.showToast(`已从书架移除《${examTitle}》（做题练习记录已保留）`);
                } catch (error) {
                    reloadRequired = needsPageReload(error);
                    if (textEl) textEl.textContent = reloadRequired
                        ? `《${examTitle || examId}》移除失败，请刷新页面后重试。`
                        : `《${examTitle || examId}》移除失败，原有数据已保留，请重试。`;
                    okBtn.textContent = reloadRequired ? '刷新页面' : '重试移除';
                } finally {
                    pending = false;
                    okBtn.disabled = false;
                    cancelBtn.disabled = false;
                }
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

        async ensureReader() {
            if (this._readerLoadPromise) return this._readerLoadPromise;
            this._readerLoadPromise = (async () => {
                const loader = global.AppLazyLoader;
                if (loader && typeof loader.ensureGroup === 'function') {
                    await Promise.all(['exam-data', 'browse-runtime'].map((group) => loader.ensureGroup(group)));
                }
                if (!global.ReadingVocabReader || typeof global.ReadingVocabReader.open !== 'function') {
                    throw new Error('Reading reader is unavailable');
                }
                return global.ReadingVocabReader;
            })();
            try { return await this._readerLoadPromise; }
            finally { this._readerLoadPromise = null; }
        },

        async launchExamVocabReader(examId, source, articleId, returnFocus) {
            if (!examId) return;
            const article = ReadingBookshelfStore.getBookshelfExams().find((row) => row.articleId === articleId);
            return this.launchReader({ examId, source, articleId, title: article?.title }, returnFocus);
        },

        async launchGlobalNotebook(returnFocus) {
            return this.launchReader({}, returnFocus);
        },

        async launchReader(request, returnFocus) {
            const requestId = ++this._readerRequestId;
            const navigation = typeof global.__getAppNavigationIntentGeneration === 'function'
                ? global.__getAppNavigationIntentGeneration() : null;
            const isCurrent = () => requestId === this._readerRequestId && (navigation == null
                || navigation === global.__getAppNavigationIntentGeneration());
            this._lastReaderRequest = request;
            this.state.readerLoading = true;
            this.state.readerError = null;
            this.render();
            try {
                const reader = await this.ensureReader();
                if (!isCurrent()) return;
                const options = { ...request, fromView: 'bookshelf', returnFocus };
                if (request.examId) await reader.open(request.examId, options);
                else if (typeof reader.openNotebook === 'function') await reader.openNotebook(options);
                else throw new Error('Reading notebook is unavailable');
            } catch (error) {
                if (isCurrent()) {
                    this.state.readerError = error;
                    console.warn('[BookshelfView] Reader loading failed:', error);
                }
            } finally {
                if (requestId === this._readerRequestId) {
                    this.state.readerLoading = false;
                    this.render();
                }
            }
        },

        async canOpenOriginalSource(article) {
            if (!article) return false;
            try {
                const activeSource = await ReadingBookshelfStore.resolveSource();
                if (activeSource.kind !== article.source.kind || activeSource.id !== article.source.id) {
                    this.showToast(`请先切换至原题库「${article.sourceLabel}」，或打开本篇精读查看生词`);
                    return false;
                }
                if (article.source.kind === 'imported') {
                    const index = await global.AppData.library.getIndex(article.source.id);
                    if (!index.some((row) => String(row.id || row.examId) === article.examId)) {
                        this.showToast('⚠️ 原题库内容已不可用，已保存的生词仍可在精读中查看或导出');
                        return false;
                    }
                }
                await this.ensureReader();
                const currentSource = await ReadingBookshelfStore.resolveSource();
                const currentExam = Array.isArray(global.examIndex)
                    ? global.examIndex.find((row) => String(row.id || row.examId) === article.examId) : null;
                const indexSource = currentExam && Object.prototype.hasOwnProperty.call(currentExam, 'libraryConfigurationId')
                    ? (currentExam.libraryConfigurationId == null || currentExam.libraryConfigurationId === ''
                        ? { kind: 'builtin', id: 'default' }
                        : { kind: 'imported', id: String(currentExam.libraryConfigurationId) }) : null;
                if (currentSource.kind !== article.source.kind || currentSource.id !== article.source.id
                    || (indexSource && (indexSource.kind !== article.source.kind || indexSource.id !== article.source.id))) {
                    this.showToast('题库已切换或正在更新，请等待原题库加载完成后重试');
                    return false;
                }
                return true;
            } catch (error) {
                this.showToast('⚠️ 原题库加载失败，请重试');
                return false;
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

        async navigateToMoreView() {
            const returnTarget = this.state.fromView || 'more';
            ++this._readerRequestId;
            this.state.readerLoading = false;
            this.state.readerError = null;
            this.state.fromView = null;
            const bookshelfView = document.getElementById('bookshelf-view');
            const targetView = document.getElementById(`${returnTarget}-view`);

            if (bookshelfView) {
                bookshelfView.classList.remove('active');
                bookshelfView.setAttribute('hidden', '');
            }

            if (global.app && typeof global.app.navigateToView === 'function') {
                try {
                    await global.app.navigateToView(returnTarget);
                    return;
                } catch (err) {
                    console.warn('[BookshelfView] navigateToView 异常:', err);
                }
            }

            if (typeof global.switchView === 'function') {
                await global.switchView(returnTarget);
                return;
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
            const state = global.ReadingVocabStore && global.ReadingVocabStore._state;
            if (state && ReadingBookshelfStore._adopt(state)) {
                const sequence = ++ReadingBookshelfStore._loadSequence;
                ReadingBookshelfStore._loading = false;
                // Reader acknowledgements can supersede the commit-triggered
                // reload; still refresh source names and indexes after restores.
                ReadingBookshelfStore._readSourceMetadata(state.snapshot).then((metadata) => {
                    if (sequence !== ReadingBookshelfStore._loadSequence) return;
                    ReadingBookshelfStore._sourceMetadata = metadata;
                    ReadingBookshelfStore._notify({ action: 'sources-reloaded' });
                });
            }
            const root = document.querySelector(BookshelfView.containerSelector);
            if (root && root.offsetParent !== null) {
                BookshelfView.render();
            }
        });
    }

    global.BookshelfView = BookshelfView;
    ReadingBookshelfStore.init().catch((error) => console.warn('[ReadingBookshelfStore] Initialization failed:', error));
})(window);
