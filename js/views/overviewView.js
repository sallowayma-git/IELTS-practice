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
                onStartSuite: null
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
                    view.actions.onBrowseCategory(this.dataset.category, this.dataset.type);
                }
            });

            this.events.delegate('click', `${this.containerSelector} [data-action="start-random-practice"]`, function (event) {
                event.preventDefault();
                if (typeof view.actions.onRandomPractice === 'function') {
                    view.actions.onRandomPractice(this.dataset.category, this.dataset.type);
                }
            });

            this.events.delegate('click', `${this.containerSelector} [data-action="start-suite-mode"]`, function (event) {
                event.preventDefault();
                if (typeof view.actions.onStartSuite === 'function') {
                    view.actions.onStartSuite();
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
                rightButton: this.createSuiteModeButton()
            });

            fragment.appendChild(readingSection);

            const listeningEntries = (stats?.listening || []).filter((entry) => entry.total > 0);
            if (listeningEntries.length > 0) {
                fragment.appendChild(this.createSection({
                    title: '听力',
                    icon: '🎧',
                    entries: listeningEntries,
                    style: { gridColumn: '1 / -1', marginTop: '40px' }
                }));
            }

            this.dom.replaceContent(container, fragment);
        }

        createSection({ title, icon, entries, style, rightButton }) {
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
            
            if (rightButton) {
                titleContainer.appendChild(rightButton);
            }
            
            sectionFragment.appendChild(titleContainer);

            entries.forEach((entry) => {
                sectionFragment.appendChild(this.createCategoryCard({
                    icon,
                    entry
                }));
            });

            return sectionFragment;
        }

        createCategoryCard({ icon, entry }) {
            const actions = this.createCardActions(entry);
            const content = [
                this.dom.create('div', { className: 'category-header' }, [
                    this.dom.create('div', { className: 'category-icon' }, icon),
                    this.dom.create('div', {}, [
                        this.dom.create('div', { className: 'category-title' }, `${entry.category} ${entry.type === 'reading' ? '阅读' : '听力'}`),
                        this.dom.create('div', { className: 'category-meta' }, `${entry.total} 篇`)
                    ])
                ]),
                actions
            ];

            return this.dom.create('div', { className: 'category-card' }, content);
        }

        createCardActions(entry) {
            const browseButton = this.dom.create('button', {
                className: 'btn',
                type: 'button',
                dataset: {
                    action: 'browse-category',
                    category: entry.category,
                    type: entry.type
                }
            }, '📚 浏览题库');

            const randomButton = this.dom.create('button', {
                className: 'btn btn-secondary',
                type: 'button',
                dataset: {
                    action: 'start-random-practice',
                    category: entry.category,
                    type: entry.type
                }
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
                    border: '1px solid #646b20ff',
                    color: 'white',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                }
            }, [
                this.dom.create('span', { ariaHidden: 'true' }, '🚀'),
                this.dom.create('span', {}, '套题模式')
            ]);
        }
    }

    global.AppViews = global.AppViews || {};
    global.AppViews.OverviewView = OverviewView;
})(window);
