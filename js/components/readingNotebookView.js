(function initReadingNotebookView(global) {
    'use strict';

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDate(value) {
        if (!value) return '未记录来源';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '未记录来源';
        return new Intl.DateTimeFormat('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(date);
    }

    function speakWord(word) {
        if (!word || !global.speechSynthesis || typeof global.SpeechSynthesisUtterance !== 'function') return;
        try {
            global.speechSynthesis.cancel();
            const utterance = new global.SpeechSynthesisUtterance(word);
            utterance.lang = 'en-US';
            utterance.rate = 0.9;
            global.speechSynthesis.speak(utterance);
        } catch (error) {
            console.warn('[ReadingNotebookView] 发音朗读异常:', error);
        }
    }

    const ReadingNotebookView = {
        containerSelector: '#reading-notebook-root',
        state: {
            fromView: 'bookshelf',
            searchQuery: '',
            loading: false,
            loaded: false,
            error: null,
            toastTimer: null
        },
        _loadSequence: 0,
        _returnFocus: null,

        open(options = {}) {
            this.state.fromView = options.fromView || global.app?.currentView || 'bookshelf';
            this._returnFocus = options.returnFocus || global.document?.activeElement || null;
            if (global.app && typeof global.app.navigateToView === 'function') {
                global.app.navigateToView('reading-notebook');
            } else {
                this.activateFallbackView();
            }
            return this.mount('#reading-notebook-view', options);
        },

        activateFallbackView() {
            const target = global.document?.getElementById('reading-notebook-view');
            if (!target) return;
            global.document.querySelectorAll('.view').forEach(view => {
                view.classList.remove('active');
                view.setAttribute('hidden', '');
            });
            target.classList.add('active');
            target.removeAttribute('hidden');
            if (global.document.body) global.document.body.classList.add('reading-notebook-open');
        },

        async mount(targetSelector = '#reading-notebook-view', options = {}) {
            if (options.fromView) this.state.fromView = options.fromView;
            const view = global.document?.querySelector(targetSelector);
            if (!view) return;

            let root = view.querySelector(this.containerSelector);
            if (!root) {
                root = global.document.createElement('div');
                root.id = 'reading-notebook-root';
                root.className = 'reading-notebook-view-shell';
                view.appendChild(root);
            }

            this.render();
            if ((this.state.loaded || this.state.loading) && !options.forceReload) return;
            return this.load();
        },

        async load() {
            const sequence = ++this._loadSequence;
            this.state.loading = true;
            this.state.error = null;
            this.render();
            try {
                if (global.AppData?.ready) await global.AppData.ready;
                if (!global.ReadingVocabStore && global.AppLazyLoader?.ensureGroup) {
                    await global.AppLazyLoader.ensureGroup('browse-runtime');
                }
                if (!global.ReadingVocabStore || typeof global.ReadingVocabStore.init !== 'function') {
                    throw new Error('生词本模块尚未就绪');
                }
                await global.ReadingVocabStore.init();
                if (sequence !== this._loadSequence) return;
                this.state.loaded = true;
                this.state.loading = false;
                this.render();
            } catch (error) {
                if (sequence !== this._loadSequence) return;
                this.state.loading = false;
                this.state.error = error;
                this.render();
            }
        },

        getEntries() {
            const entries = global.ReadingVocabStore?.getAll?.() || [];
            const query = String(this.state.searchQuery || '').trim().toLowerCase();
            if (!query) return entries;
            const articles = Array.isArray(global.ReadingVocabStore?._state?.snapshot?.reading?.articles)
                ? global.ReadingVocabStore._state.snapshot.reading.articles : [];
            const articlesById = new Map(articles
                .filter(article => article && typeof article === 'object' && article.id)
                .map(article => [article.id, article]));
            return entries.filter(item => {
                // Associations are the authoritative many-to-many links. A word
                // can have a secondary/manual article association without an
                // occurrence, so occurrence-derived titles are not sufficient
                // for notebook search. The normalized projection keeps only the
                // article id on each association; resolve that id back to the
                // article metadata when indexing the search text.
                const associationText = (item.associations || []).flatMap(association => {
                    const article = articlesById.get(association.articleId)
                        || association.article || association.articleMetadata
                        || association.metadata?.article || null;
                    return [association.examId, association.examTitle, association.title,
                        association.metadata?.examId, association.metadata?.examTitle,
                        article?.id, article?.examId, article?.title, article?.sourceId,
                        article?.metadata?.examId, article?.metadata?.examTitle,
                        ...(article?.contentRefs || [])].filter(Boolean);
                });
                const sourceText = [item.examTitle, item.examId, item.context,
                    ...associationText,
                    ...(item.highlights || []).map(row => row.text || '')].join(' ').toLowerCase();
                return [item.word, sourceText].join(' ').toLowerCase().includes(query);
            });
        },

        getStats() {
            const all = global.ReadingVocabStore?.getAll?.() || [];
            const articleIds = new Set();
            let latest = null;
            all.forEach(item => {
                (item.associations || []).forEach(row => {
                    if (row.articleId) articleIds.add(row.articleId);
                    if (row.updatedAt && (!latest || row.updatedAt > latest)) latest = row.updatedAt;
                });
            });
            return { words: all.length, articles: articleIds.size, latest };
        },

        render() {
            const root = global.document?.querySelector(this.containerSelector);
            if (!root) return;
            const stats = this.getStats();
            const entries = this.getEntries();
            const hasData = this.state.loaded && !this.state.error;
            const disabled = !hasData || stats.words === 0 ? 'disabled' : '';

            root.innerHTML = `
                <div class="reading-notebook-layout">
                    <header class="reading-notebook-topbar">
                        <div class="reading-notebook-heading">
                            <button type="button" class="shui-glass-btn reading-notebook-back-btn" data-action="notebook-back" title="返回阅读书架">
                                <span aria-hidden="true">←</span><span>返回书架</span>
                            </button>
                            <div>
                                <h2 class="reading-notebook-title">📖 我的生词本</h2>
                                <p class="reading-notebook-subtitle">集中查看精读时收录的词语，随时复习、朗读或导出。</p>
                            </div>
                        </div>
                        <div class="reading-notebook-actions">
                            <button type="button" class="shui-glass-btn" data-action="notebook-export" ${disabled} title="导出全部精读生词 TXT">
                                ↓ 导出全部精读生词 TXT
                            </button>
                            <button type="button" class="shui-glass-btn reading-notebook-danger-btn" data-action="notebook-clear" ${disabled} title="清空全部生词">
                                清空生词
                            </button>
                        </div>
                    </header>

                    ${this.state.loading ? '<p class="reading-notebook-status" role="status">正在加载生词本…</p>' : ''}
                    ${this.state.error ? `
                        <div class="reading-notebook-status reading-notebook-status--error" role="alert">
                            <span>生词本加载失败，请重试。</span>
                            <button type="button" class="shui-glass-btn" data-action="notebook-retry">重试</button>
                        </div>
                    ` : ''}

                    <section class="reading-notebook-stats" aria-label="生词本统计">
                        <div class="reading-notebook-stat">
                            <span class="reading-notebook-stat__value">${stats.words}</span>
                            <span class="reading-notebook-stat__label">不重复生词</span>
                        </div>
                        <div class="reading-notebook-stat">
                            <span class="reading-notebook-stat__value">${stats.articles}</span>
                            <span class="reading-notebook-stat__label">关联篇目</span>
                        </div>
                        <div class="reading-notebook-stat">
                            <span class="reading-notebook-stat__value reading-notebook-stat__value--date">${escapeHtml(formatDate(stats.latest))}</span>
                            <span class="reading-notebook-stat__label">最近收录</span>
                        </div>
                    </section>

                    <section class="reading-notebook-surface">
                        <div class="reading-notebook-toolbar">
                            <label class="reading-notebook-search">
                                <span aria-hidden="true">⌕</span>
                                <input type="search" data-action="notebook-search" value="${escapeHtml(this.state.searchQuery)}" placeholder="搜索单词、篇目或例句…" aria-label="搜索生词本" />
                            </label>
                            <span class="reading-notebook-count">${entries.length}${this.state.searchQuery ? ` / ${stats.words}` : ''} 个词</span>
                        </div>
                        <div class="reading-notebook-list">
                            ${this.renderEntries(entries, hasData)}
                        </div>
                    </section>
                </div>
                <div id="reading-notebook-toast" class="reading-notebook-toast" role="status" aria-live="polite"></div>
            `;
            this.bindEvents(root);
        },

        renderEntries(entries, hasData) {
            if (!hasData) return '';
            if (!entries.length) {
                return `
                    <div class="reading-notebook-empty">
                        <div class="reading-notebook-empty__icon">📝</div>
                        <h3>${this.state.searchQuery ? '没有匹配的生词' : '生词本还是空的'}</h3>
                        <p>${this.state.searchQuery ? '换一个关键词试试。' : '在阅读文章或题目中划选单词，就会出现在这里。'}</p>
                    </div>
                `;
            }
            return entries.map(item => {
                const sources = new Set();
                if (item.examTitle) sources.add(item.examTitle);
                (item.highlights || []).forEach(row => {
                    if (row.examId) sources.add(row.examId);
                });
                const sourceList = [...sources].slice(0, 3);
                const extraSources = Math.max(0, sources.size - sourceList.length);
                return `
                    <article class="reading-notebook-entry" data-word-id="${escapeHtml(item.id)}">
                        <div class="reading-notebook-entry__main">
                            <div class="reading-notebook-entry__heading">
                                <h3>${escapeHtml(item.word)}</h3>
                                <button type="button" class="shui-glass-btn reading-notebook-speak-btn" data-action="notebook-speak" data-word="${escapeHtml(item.word)}" title="朗读 ${escapeHtml(item.word)}" aria-label="朗读 ${escapeHtml(item.word)}">🔊</button>
                            </div>
                            ${item.context ? `<p class="reading-notebook-entry__context">“${escapeHtml(item.context)}”</p>` : ''}
                            <div class="reading-notebook-entry__meta">
                                ${sourceList.map(source => `<span>${escapeHtml(source)}</span>`).join('')}
                                ${extraSources ? `<span>+${extraSources} 篇</span>` : ''}
                            </div>
                        </div>
                        <button type="button" class="shui-glass-btn reading-notebook-delete-btn" data-action="notebook-delete" data-word-id="${escapeHtml(item.id)}" title="从我的生词本移除">移除</button>
                    </article>
                `;
            }).join('');
        },

        bindEvents(root) {
            const search = root.querySelector('[data-action="notebook-search"]');
            if (search) {
                search.addEventListener('input', event => {
                    this.state.searchQuery = event.target.value;
                    this.render();
                    const next = global.document.querySelector('[data-action="notebook-search"]');
                    if (next) {
                        next.focus();
                        next.setSelectionRange(next.value.length, next.value.length);
                    }
                });
            }
            root.onclick = async event => {
                const action = event.target.closest?.('[data-action]')?.dataset.action;
                if (!action) return;
                if (action === 'notebook-back') {
                    this.goBack();
                    return;
                }
                if (action === 'notebook-retry') {
                    await this.load();
                    return;
                }
                if (action === 'notebook-speak') {
                    speakWord(event.target.closest('[data-action="notebook-speak"]').dataset.word);
                    return;
                }
                if (action === 'notebook-export') {
                    await this.exportAll(event.target.closest('[data-action="notebook-export"]'));
                    return;
                }
                if (action === 'notebook-clear') {
                    await this.clearAll(event.target.closest('[data-action="notebook-clear"]'));
                    return;
                }
                if (action === 'notebook-delete') {
                    await this.deleteWord(event.target.closest('[data-action="notebook-delete"]'));
                }
            };
        },

        async exportAll(button) {
            if (!button || button.disabled || !global.ReadingVocabStore) return;
            button.disabled = true;
            try {
                const result = await global.ReadingVocabStore.exportTxt(null, null, '全部精读生词');
                this.showToast(result ? `已导出 ${result.count} 个生词` : '暂无精读生词可导出');
            } catch (error) {
                this.showToast(error?.code === 'BACKEND_UNAVAILABLE' ? '生词读取失败，请刷新页面后重试' : '导出失败，请重试');
            } finally {
                button.disabled = false;
            }
        },

        async clearAll(button) {
            if (!button || button.disabled || !global.ReadingVocabStore) return;
            if (!(global.ReadingVocabStore.getAll?.() || []).length) {
                this.showToast('生词本已经是空的了');
                return;
            }
            button.disabled = true;
            try {
                await global.ReadingVocabStore.clear();
                this.showToast('全部生词已清空');
            } catch (error) {
                this.showToast(error?.code === 'BACKEND_UNAVAILABLE' ? '存储暂不可用，请刷新页面后重试' : '清空失败，请重试');
            } finally {
                button.disabled = false;
            }
        },

        async deleteWord(button) {
            if (!button || button.disabled || !global.ReadingVocabStore) return;
            const id = button.dataset.wordId;
            button.disabled = true;
            try {
                await global.ReadingVocabStore.remove(id);
                this.showToast('已从我的生词本移除');
            } catch (error) {
                this.showToast(error?.code === 'BACKEND_UNAVAILABLE' ? '存储暂不可用，请刷新页面后重试' : '移除失败，请重试');
                button.disabled = false;
            }
        },

        showToast(message) {
            const toast = global.document?.getElementById('reading-notebook-toast');
            if (!toast) return;
            toast.textContent = message;
            toast.classList.add('is-visible');
            clearTimeout(this.state.toastTimer);
            this.state.toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
        },

        goBack() {
            const target = this.state.fromView && this.state.fromView !== 'reading-notebook'
                ? this.state.fromView : 'bookshelf';
            if (global.app && typeof global.app.navigateToView === 'function') {
                global.app.navigateToView(target);
            } else {
                const targetView = global.document?.getElementById(`${target}-view`);
                const currentView = global.document?.getElementById('reading-notebook-view');
                currentView?.classList.remove('active');
                currentView?.setAttribute('hidden', '');
                targetView?.classList.add('active');
                targetView?.removeAttribute('hidden');
            }
            const focusTarget = target === 'bookshelf'
                ? global.document?.querySelector('#bookshelf-view [data-action="open-global-notebook"]')
                : this._returnFocus;
            if (focusTarget?.isConnected) setTimeout(() => focusTarget.focus({ preventScroll: true }), 0);
        }
    };

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('reading-vocab-store-updated', () => {
            const view = global.document?.getElementById('reading-notebook-view');
            if (view?.classList.contains('active')) {
                ReadingNotebookView.state.loaded = true;
                ReadingNotebookView.render();
            }
        });
        global.addEventListener('keydown', event => {
            const view = global.document?.getElementById('reading-notebook-view');
            if (event.key === 'Escape' && view?.classList.contains('active')) {
                event.preventDefault();
                ReadingNotebookView.goBack();
            }
        });
    }

    global.ReadingNotebookView = ReadingNotebookView;
})(typeof window !== 'undefined' ? window : globalThis);
