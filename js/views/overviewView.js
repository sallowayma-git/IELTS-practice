(function (global) {
    'use strict';

    class OverviewView {
        constructor({
            domBuilder = global.DOM?.builder,
            events = global.DOM?.events,
            containerSelector = '#category-overview'
        } = {}) {
            this.dom = domBuilder;
            this.events = events;
            this.containerSelector = containerSelector;
            this.actions = {
                onBrowseCategory: null,
                onRandomPractice: null,
                onStartSuite: null,
                onStartEndless: null
            };
            this.delegatesBound = false;
        }

        setActions(actions = {}) {
            this.actions = {
                ...this.actions,
                ...actions
            };
        }

        ensureDelegates() {
            if (this.delegatesBound || !this.events) {
                return;
            }

            const view = this;
            this.events.delegate('click', `${this.containerSelector} [data-action="browse-category"]`, function (event) {
                event.preventDefault();
                if (typeof view.actions.onBrowseCategory === 'function') {
                    // 传递 filterMode 和 path 参数（如果存在）
                    view.actions.onBrowseCategory(
                        this.dataset.category,
                        this.dataset.type,
                        this.dataset.filterMode,
                        this.dataset.path
                    );
                }
            });

            this.events.delegate('click', `${this.containerSelector} [data-action="start-random-practice"]`, function (event) {
                event.preventDefault();
                if (typeof view.actions.onRandomPractice === 'function') {
                    view.actions.onRandomPractice(
                        this.dataset.category,
                        this.dataset.type,
                        this.dataset.filterMode,
                        this.dataset.path
                    );
                }
            });

            this.events.delegate('click', `${this.containerSelector} [data-action="start-suite-mode"]`, function (event) {
                event.preventDefault();
                if (typeof view.actions.onStartSuite === 'function') {
                    view.actions.onStartSuite();
                }
            });

            this.events.delegate('click', `${this.containerSelector} [data-action="start-endless-mode"]`, function (event) {
                event.preventDefault();
                if (typeof view.actions.onStartEndless === 'function') {
                    view.actions.onStartEndless();
                }
            });

            this.delegatesBound = true;
        }

        render(stats, {
            container = document.querySelector(this.containerSelector),
            actions = null
        } = {}) {
            if (!container || !this.dom) {
                return;
            }

            if (actions) {
                this.setActions(actions);
            }

            this.ensureDelegates();

            const fragment = document.createDocumentFragment();
            const readingSection = this.createSection({
                title: '阅读',
                icon: '📖',
                entries: stats?.reading || [],
                style: { gridColumn: '1 / -1' },
                rightButtons: [this.createEndlessModeButton(), this.createSuiteModeButton()]
            });

            fragment.appendChild(readingSection);

            // [DISABLED] 听力入口已禁用
            // const listeningEntries = (stats?.listening || []).filter((entry) => entry.total > 0);
            // if (listeningEntries.length > 0) {
            //     fragment.appendChild(this.createSection({
            //         title: '听力',
            //         icon: '🎧',
            //         entries: listeningEntries,
            //         style: { gridColumn: '1 / -1', marginTop: '40px' }
            //     }));
            // }

            // [DISABLED] 听力练习 - 频率分类入口已禁用
            // const specialListeningEntries = (stats?.specialListening || []).filter((entry) => entry.total > 0);
            // if (specialListeningEntries.length > 0) {
            //     fragment.appendChild(this.createSection({
            //         title: '听力练习 - 频率分类',
            //         icon: '🎧',
            //         entries: specialListeningEntries,
            //         style: { gridColumn: '1 / -1', marginTop: '40px' },
            //         isSpecial: true
            //     }));
            // }

            this.dom.replaceContent(container, fragment);
        }

        createSection({ title, icon, entries, style, rightButton, rightButtons, isSpecial = false }) {
            const sectionFragment = document.createDocumentFragment();

            // 创建标题容器，支持右侧按钮
            const titleContainer = this.dom.create('div', {
                style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px',
                    ...style
                }
            });

            titleContainer.appendChild(this.dom.create('h3', {
                className: 'overview-section-title',
                style: { margin: 0 }
            }, title));


            // 支持单个 rightButton（向后兼容）或多个 rightButtons
            const buttons = rightButtons || (rightButton ? [rightButton] : []);
            if (buttons.length > 0) {
                const btnGroup = this.dom.create('div', {
                    style: { display: 'flex', gap: '8px', alignItems: 'center', border: 'none' }
                });
                buttons.forEach(btn => btnGroup.appendChild(btn));
                titleContainer.appendChild(btnGroup);
            }

            sectionFragment.appendChild(titleContainer);

            entries.forEach((entry) => {
                sectionFragment.appendChild(this.createCategoryCard({
                    icon,
                    entry,
                    isSpecial
                }));
            });

            return sectionFragment;
        }

        createCategoryCard({ icon, entry, isSpecial = false }) {
            const actions = this.createCardActions(entry, isSpecial);

            // 特殊卡片使用不同的标题格式
            const titleText = isSpecial
                ? entry.category
                : `${entry.category} ${entry.type === 'reading' ? '阅读' : '听力'}`;

            const content = [
                this.dom.create('div', { className: 'category-header' }, [
                    this.dom.create('div', { className: 'category-icon' }, icon),
                    this.dom.create('div', {}, [
                        this.dom.create('div', { className: 'category-title' }, titleText),
                        this.dom.create('div', { className: 'category-meta' }, `${entry.total} 篇`)
                    ])
                ]),
                actions
            ];

            return this.dom.create('div', { className: 'category-card' }, content);
        }

        createCardActions(entry, isSpecial = false) {
            // 特殊卡片需要传递 filterMode 参数
            const browseDataset = isSpecial ? {
                action: 'browse-category',
                category: entry.category,
                type: entry.type,
                filterMode: entry.filterMode,
                path: entry.path
            } : {
                action: 'browse-category',
                category: entry.category,
                type: entry.type
            };

            const browseButton = this.dom.create('button', {
                className: 'btn',
                type: 'button',
                dataset: browseDataset
            }, '📚 浏览题库');

            const randomDataset = isSpecial ? {
                action: 'start-random-practice',
                category: entry.category,
                type: entry.type,
                filterMode: entry.filterMode,
                path: entry.path
            } : {
                action: 'start-random-practice',
                category: entry.category,
                type: entry.type
            };

            const randomButton = this.dom.create('button', {
                className: 'btn btn-secondary',
                type: 'button',
                dataset: randomDataset
            }, '🎲 随机练习');

            return this.dom.create('div', {
                className: 'category-actions',
                style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'nowrap'
                }
            }, [browseButton, randomButton]);
        }

        createSvgIcon(svgContent) {
            const span = document.createElement('span');
            span.className = 'ui-emoji-icon';
            span.setAttribute('aria-hidden', 'true');
            span.style.display = 'inline-flex';
            span.innerHTML = `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${svgContent}</svg>`;
            return span;
        }

        createSuiteModeButton() {
            return this.dom.create('button', {
                className: 'btn btn-primary',
                type: 'button',
                dataset: {
                    action: 'start-suite-mode',
                    overviewAction: 'suite'
                },
                style: {
                    padding: '8px 16px',
                    fontSize: '14px',
                    fontWeight: '500',
                    borderRadius: '6px',
                    backgroundColor: '#646b20ff',
                    border: 'none',
                    color: 'white',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                }
            }, [
                this.createSvgIcon('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M14 3v6h6"></path><path d="M8 13h8M8 17h6"></path>'),
                this.dom.create('span', {}, '套题模式')
            ]);
        }

        createEndlessModeButton() {
            return this.dom.create('button', {
                className: 'btn',
                type: 'button',
                id: 'endless-mode-btn',
                dataset: {
                    action: 'start-endless-mode',
                    overviewAction: 'endless'
                },
                style: {
                    padding: '8px 16px',
                    fontSize: '14px',
                    fontWeight: '500',
                    borderRadius: '6px',
                    backgroundColor: '#7c3aed',
                    border: 'none',
                    color: 'white',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                }
            }, [
                this.createSvgIcon('<path d="M20 6v5h-5"></path><path d="M4 18v-5h5"></path><path d="M6.2 11a6 6 0 0 1 10.6-2.4L20 11"></path><path d="M17.8 13a6 6 0 0 1-10.6 2.4L4 13"></path>'),
                this.dom.create('span', {}, '无尽模式')
            ]);
        }
    }

    global.AppViews = global.AppViews || {};
    global.AppViews.OverviewView = OverviewView;
})(window);
