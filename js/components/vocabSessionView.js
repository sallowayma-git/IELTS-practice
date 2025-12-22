(function(window) {
    const DEFAULT_BATCH_SIZE = 24;
    const RETRY_DELAYS = Object.freeze({
        wrong: 60 * 1000,
        near: 10 * 60 * 1000,
        correct: 24 * 60 * 60 * 1000
    });
    const KEY_BINDINGS = Object.freeze({
        Enter: 'submit',
        NumpadEnter: 'submit',
        KeyF: 'reveal',
        Escape: 'escape'
    });

    const CONFIG_LIMITS = Object.freeze({
        dailyNew: { min: 0, max: 200 },
        reviewLimit: { min: 1, max: 300 },
        masteryCount: { min: 1, max: 10 }
    });

    const state = {
        container: null,
        elements: {},
        initialized: false,
        store: null,
        scheduler: null,
        viewport: {
            isMobile: false,
            mediaQuery: null
        },
        menuOpen: false,
        ui: {
            sidePanelManual: null,
            lastFocus: null,
            importing: false,
            exporting: false,
            listSwitcher: null,
            listSwitcherListenerAttached: false
        },
        session: {
            stage: 'loading',
            backlog: [],
            activeQueue: [],
            completed: [],
            currentWord: null,
            progress: {
                total: 0,
                completed: 0,
                correct: 0,
                near: 0,
                wrong: 0
            },
            batchSize: DEFAULT_BATCH_SIZE,
            batchIndex: 0,
            dueTotal: 0,
            newTotal: 0,
            duePending: 0,
            meaningVisible: false,
            recognitionFailed: false,
            recognitionMode: 'idle',
            lastAnswer: null,
            typedAnswer: '',
            queueSeed: 0
        },
        keyboardHandler: null,
        outsideClickHandler: null
    };

    function resolveContainer(target) {
        if (!target) {
            return null;
        }
        if (typeof target === 'string') {
            return document.querySelector(target);
        }
        return target;
    }

    function showFeedbackMessage(message, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }
        if (typeof window.showMessage === 'function') {
            window.showMessage(message, type, 4000);
            return;
        }
        console.info('[VocabSessionView]', message);
    }

    function isSettingsModalOpen() {
        return state.elements.settingsModal?.dataset.open === 'true';
    }

    function clampNumber(value, min, max) {
        if (typeof value !== 'number' || Number.isNaN(value)) {
            return null;
        }
        return Math.min(max, Math.max(min, Math.floor(value)));
    }

    function formatTimestamp() {
        const date = new Date();
        const parts = [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ];
        const time = [
            String(date.getHours()).padStart(2, '0'),
            String(date.getMinutes()).padStart(2, '0')
        ];
        return `${parts.join('')}-${time.join('')}`;
    }

    function triggerDownload(blob, filename) {
        if (!(blob instanceof Blob)) {
            throw new Error('导出内容为空');
        }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function resetSessionState() {
        state.session.backlog = [];
        state.session.activeQueue = [];
        state.session.completed = [];
        state.session.currentWord = null;
        state.session.progress = {
            total: 0,
            completed: 0,
            correct: 0,
            near: 0,
            wrong: 0
        };
        state.session.batchIndex = 0;
        state.session.meaningVisible = false;
        state.session.recognitionQuality = null;
        state.session.spellingAttempts = 0;
        state.session.lastAnswer = null;
        state.session.typedAnswer = '';
        state.session.stage = 'loading';
    }

    function setupViewportWatcher() {
        if (typeof window.matchMedia !== 'function') {
            state.viewport.isMobile = false;
            return;
        }
        const mq = window.matchMedia('(max-width: 768px)');
        const update = (event) => {
            state.viewport.isMobile = !!event.matches;
            updateSidePanelMode();
        };
        state.viewport.mediaQuery = mq;
        state.viewport.isMobile = mq.matches;
        if (typeof mq.addEventListener === 'function') {
            mq.addEventListener('change', update);
        } else if (typeof mq.addListener === 'function') {
            mq.addListener(update);
        }
    }

    function createLayout(target) {
        const layout = document.createElement('div');
        layout.className = 'vocab-view-shell';
        layout.innerHTML = `
            <header class="vocab-topbar" data-vocab-role="topbar">
                <div class="vocab-topbar__container">
                    <div class="vocab-topbar__section vocab-topbar__section--left">
                        <button class="btn btn-icon" type="button" data-action="return-more" aria-label="返回更多工具">←</button>
                        <div class="vocab-topbar__titles">
                            <h2 class="vocab-topbar__heading">背单词</h2>
                            <p class="vocab-topbar__subtitle">Leitner + 艾宾浩斯调度</p>
                        </div>
                    </div>
                    <div class="vocab-topbar__section vocab-topbar__section--center" data-vocab-role="progress">
                        <div class="vocab-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                            <div class="vocab-progress__track">
                                <div class="vocab-progress__fill" data-vocab-role="progress-bar"></div>
                            </div>
                        </div>
                        <div class="vocab-progress__chips" data-vocab-role="progress-stats">
                            <span class="chip" data-chip="new">新词 0</span>
                            <span class="chip" data-chip="review">复习 0</span>
                            <span class="chip" data-chip="accuracy">正确率 0%</span>
                        </div>
                    </div>
                    <div class="vocab-topbar__section vocab-topbar__section--right">
                        <div class="vocab-topbar__list-switcher" data-vocab-role="list-switcher"></div>
                        <button class="btn btn-primary" type="button" data-action="primary-cta">开始复习</button>
                        <div class="vocab-topbar__menu">
                            <button class="btn btn-ghost btn-icon" type="button" data-action="toggle-menu" aria-haspopup="true" aria-expanded="false">⋮</button>
                            <div class="vocab-menu" data-vocab-role="menu" hidden>
                                <button type="button" data-action="menu-import">导入词表</button>
                                <button type="button" data-action="menu-export">导出进度</button>
                                <button type="button" data-action="menu-settings">学习设置</button>
                            </div>
                        </div>
                    </div>
                </div>
            </header>
            <div class="vocab-topbar-spacer" aria-hidden="true"></div>
            <section class="vocab-due-banner" data-vocab-role="due-banner" hidden>
                <div class="vocab-due-banner__container">
                    <div class="vocab-due-banner__content">
                        <span class="vocab-due-banner__icon" aria-hidden="true">⏰</span>
                        <p class="vocab-due-banner__text" data-vocab-role="due-text">你有 0 个到期复习，建议先复习。</p>
                    </div>
                    <button class="btn btn-sm btn-outline" type="button" data-action="start-review">开始复习</button>
                </div>
            </section>
            <main class="vocab-body" data-vocab-role="main">
                <div class="vocab-body__container">
                    <div class="vocab-body__grid">
                        <article class="vocab-session-card" data-vocab-role="session-card"></article>
                        <aside class="vocab-side-panel" data-vocab-role="side-panel" data-expanded="false">
                            <button class="vocab-side-panel__toggle" type="button" data-action="toggle-side-panel" aria-expanded="false">词汇详情</button>
                            <div class="vocab-side-panel__surface" data-vocab-role="side-surface">
                                <section class="vocab-side-panel__section">
                                    <h3>释义</h3>
                                    <p data-field="meaning" class="vocab-side-panel__meaning">—</p>
                                </section>
                                <section class="vocab-side-panel__section">
                                    <h3>例句</h3>
                                    <p data-field="example" class="vocab-side-panel__example">暂无例句</p>
                                </section>
                                <section class="vocab-side-panel__section vocab-side-panel__meta">
                                    <h3>来源与标签</h3>
                                    <p data-field="meta">内置 IELTS 核心词表</p>
                                </section>
                                <section class="vocab-side-panel__section">
                                    <h3>笔记</h3>
                                    <textarea data-field="note" rows="4" placeholder="记录你的记忆技巧…"></textarea>
                                    <div class="vocab-side-panel__note-actions">
                                        <button class="btn btn-sm btn-primary" type="button" data-action="save-note">保存笔记</button>
                                        <span class="vocab-side-panel__note-status" data-field="note-status"></span>
                                    </div>
                                </section>
                            </div>
                        </aside>
                    </div>
                </div>
            </main>
            <div class="visually-hidden" aria-live="polite" data-vocab-role="live-region"></div>
            <input type="file" accept=".json,.csv" data-vocab-role="import-input" hidden>
            <div class="vocab-settings-modal" data-vocab-role="settings-modal" hidden>
                <div class="vocab-settings-modal__backdrop" data-action="close-settings" tabindex="-1"></div>
                <div class="vocab-settings-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="vocab-settings-title" data-vocab-role="settings-dialog">
                    <header class="vocab-settings-modal__header">
                        <div>
                            <h3 id="vocab-settings-title">学习设置</h3>
                            <p class="vocab-settings-modal__subtitle">自定义每日任务与复习策略</p>
                        </div>
                        <button class="btn btn-icon" type="button" data-action="close-settings" aria-label="关闭设置">×</button>
                    </header>
                    <form class="vocab-settings-form" data-vocab-role="settings-form">
                        <div class="vocab-settings-form__group">
                            <label for="vocab-setting-daily-new">每日新词目标</label>
                            <input type="number" id="vocab-setting-daily-new" name="dailyNew" min="0" max="200" step="1" required>
                            <p class="vocab-settings-form__hint">设置为 0 时，仅安排复习任务。</p>
                        </div>
                        <div class="vocab-settings-form__group">
                            <label for="vocab-setting-review-limit">每日复习上限</label>
                            <input type="number" id="vocab-setting-review-limit" name="reviewLimit" min="1" max="300" step="1" required>
                            <p class="vocab-settings-form__hint">建议 20-150，系统会按批次自动拆分。</p>
                        </div>
                        <div class="vocab-settings-form__group">
                            <label for="vocab-setting-mastery">掌握判定（连续正确次数）</label>
                            <input type="number" id="vocab-setting-mastery" name="masteryCount" min="1" max="10" step="1" required>
                        </div>
                        <div class="vocab-settings-form__group vocab-settings-form__group--inline">
                            <label class="vocab-settings-form__checkbox">
                                <input type="checkbox" name="notify" value="1">
                                <span>进入时提醒待复习任务</span>
                            </label>
                        </div>
                        <div class="vocab-settings-form__error" data-vocab-role="settings-error" aria-live="assertive"></div>
                        <div class="vocab-settings-modal__actions">
                            <button class="btn btn-outline" type="button" data-action="cancel-settings">取消</button>
                            <button class="btn btn-primary" type="submit">保存设置</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        target.innerHTML = '';
        target.appendChild(layout);
        state.elements = {
            root: layout,
            topbar: layout.querySelector('[data-vocab-role=\"topbar\"]'),
            primaryButton: layout.querySelector('[data-action=\"primary-cta\"]'),
            progressBar: layout.querySelector('[data-vocab-role=\"progress-bar\"]'),
            progressStats: layout.querySelector('[data-vocab-role=\"progress-stats\"]'),
            menuButton: layout.querySelector('[data-action=\"toggle-menu\"]'),
            menu: layout.querySelector('[data-vocab-role=\"menu\"]'),
            listSwitcher: layout.querySelector('[data-vocab-role=\"list-switcher\"]'),
            dueBanner: layout.querySelector('[data-vocab-role=\"due-banner\"]'),
            dueText: layout.querySelector('[data-vocab-role=\"due-text\"]'),
            sessionCard: layout.querySelector('[data-vocab-role=\"session-card\"]'),
            sidePanel: layout.querySelector('[data-vocab-role=\"side-panel\"]'),
            sideSurface: layout.querySelector('[data-vocab-role=\"side-surface\"]'),
            noteInput: layout.querySelector('[data-field=\"note\"]'),
            noteStatus: layout.querySelector('[data-field=\"note-status\"]'),
            liveRegion: layout.querySelector('[data-vocab-role=\"live-region\"]'),
            importInput: layout.querySelector('[data-vocab-role=\"import-input\"]'),
            settingsModal: layout.querySelector('[data-vocab-role=\"settings-modal\"]'),
            settingsForm: layout.querySelector('[data-vocab-role=\"settings-form\"]'),
            settingsError: layout.querySelector('[data-vocab-role=\"settings-error\"]'),
            settingsDialog: layout.querySelector('[data-vocab-role=\"settings-dialog\"]'),
            settingsFields: {
                dailyNew: layout.querySelector('#vocab-setting-daily-new'),
                reviewLimit: layout.querySelector('#vocab-setting-review-limit'),
                masteryCount: layout.querySelector('#vocab-setting-mastery'),
                notify: layout.querySelector('input[name=\"notify\"]')
            }
        };
        state.elements.sideBody = state.elements.sideSurface;
        setSidePanelExpanded(false);
    }

    function handleListSwitch(event) {
        if (!event || !event.detail) {
            return;
        }
        resetSessionState();
        prepareSessionQueue();
        showDueBanner(state.session.duePending);
        if (state.session.stage === 'empty') {
            render();
            return;
        }
        startBatch(true);
    }

    function ensureListSwitcher() {
        const container = state.elements.listSwitcher;
        const Switcher = window.VocabListSwitcher;
        if (!container || !Switcher || !state.store) {
            return;
        }

        if (!state.ui.listSwitcher) {
            try {
                state.ui.listSwitcher = new Switcher(state.store);
                state.ui.listSwitcher.render(container);
            } catch (error) {
                console.warn('[VocabSessionView] 词表切换器初始化失败:', error);
                state.ui.listSwitcher = null;
            }
        }

        if (!state.ui.listSwitcherListenerAttached) {
            container.addEventListener('vocabListSwitch', handleListSwitch);
            state.ui.listSwitcherListenerAttached = true;
        }
    }

    function navigateToMoreView() {
        const moreView = document.getElementById('more-view');
        const vocabView = document.getElementById('vocab-view');
        if (window.app && typeof window.app.navigateToView === 'function') {
            try {
                window.app.navigateToView('more');
            } catch (error) {
                console.warn('[VocabSessionView] navigateToView("more") 失败:', error);
            }
        }
        if (vocabView) {
            vocabView.classList.remove('active');
            vocabView.setAttribute('hidden', 'hidden');
        }
        if (moreView) {
            moreView.classList.add('active');
            moreView.removeAttribute('hidden');
        }
    }

    function closeMenu() {
        if (!state.elements.menu) {
            return;
        }
        state.menuOpen = false;
        state.elements.menu.setAttribute('hidden', 'hidden');
        if (state.elements.menuButton) {
            state.elements.menuButton.setAttribute('aria-expanded', 'false');
        }
        if (state.outsideClickHandler) {
            document.removeEventListener('click', state.outsideClickHandler, true);
            state.outsideClickHandler = null;
        }
    }

    function toggleMenu(event) {
        if (!state.elements.menu) {
            return;
        }
        event.stopPropagation();
        state.menuOpen = !state.menuOpen;
        if (state.menuOpen) {
            state.elements.menu.removeAttribute('hidden');
            state.elements.menuButton.setAttribute('aria-expanded', 'true');
            state.outsideClickHandler = (evt) => {
                if (!state.elements.menu.contains(evt.target) && evt.target !== state.elements.menuButton) {
                    closeMenu();
                }
            };
            document.addEventListener('click', state.outsideClickHandler, true);
        } else {
            closeMenu();
        }
    }

    function updateSidePanelMode() {
        if (!state.elements.sidePanel) {
            return;
        }
        state.elements.sidePanel.dataset.mobile = state.viewport.isMobile ? 'true' : 'false';
    }

    function triggerCardAction(action) {
        if (!state.elements.sessionCard || !action) {
            return false;
        }
        const trigger = state.elements.sessionCard.querySelector(`[data-action="${action}"]`);
        if (!trigger || trigger.disabled) {
            return false;
        }
        trigger.click();
        return true;
    }

    function triggerPrimaryCardAction() {
        const stage = state.session.stage;
        if (stage === 'feedback') {
            return triggerCardAction('next-word');
        }
        if (stage === 'batch-finished') {
            return triggerCardAction('next-batch') || triggerCardAction('end-session');
        }
        if (stage === 'complete') {
            return triggerCardAction('end-session');
        }
        return false;
    }

    function bindEvents() {
        if (!state.container) {
            return;
        }
        const backButton = state.container.querySelector('[data-action="return-more"]');
        if (backButton && !backButton.dataset.bound) {
            backButton.addEventListener('click', (event) => {
                event.preventDefault();
                navigateToMoreView();
            });
            backButton.dataset.bound = 'true';
        }
        if (state.elements.primaryButton && !state.elements.primaryButton.dataset.bound) {
            state.elements.primaryButton.addEventListener('click', handlePrimaryButtonClick);
            state.elements.primaryButton.dataset.bound = 'true';
        }
        if (state.elements.menuButton && !state.elements.menuButton.dataset.bound) {
            state.elements.menuButton.addEventListener('click', toggleMenu);
            state.elements.menuButton.dataset.bound = 'true';
        }
        if (state.elements.menu && !state.elements.menu.dataset.bound) {
            state.elements.menu.addEventListener('click', (event) => {
                const trigger = event.target.closest('button[data-action]');
                const action = trigger?.dataset?.action;
                if (!action) {
                    return;
                }
                closeMenu();
                if (action === 'menu-import') {
                    handleImportRequest();
                    return;
                }
                if (action === 'menu-export') {
                    handleExportRequest();
                    return;
                }
                if (action === 'menu-settings') {
                    openSettingsModal();
                }
            });
            state.elements.menu.dataset.bound = 'true';
        }
        if (state.elements.dueBanner && !state.elements.dueBanner.dataset.bound) {
            state.elements.dueBanner.addEventListener('click', (event) => {
                const trigger = event.target.closest('[data-action]');
                const action = trigger?.dataset?.action;
                if (action === 'start-review') {
                    hideDueBanner();
                    startReviewFlow();
                }
            });
            state.elements.dueBanner.dataset.bound = 'true';
        }
        if (state.elements.sidePanel && !state.elements.sidePanel.dataset.bound) {
            state.elements.sidePanel.addEventListener('click', (event) => {
                const trigger = event.target.closest('[data-action]');
                const action = trigger?.dataset?.action;
                if (action === 'toggle-side-panel') {
                    toggleSidePanel(undefined, { manual: true });
                }
                if (action === 'save-note') {
                    event.preventDefault();
                    saveCurrentNote();
                }
            });
            state.elements.sidePanel.dataset.bound = 'true';
        }
        if (!state.keyboardHandler) {
            state.keyboardHandler = (event) => {
                const command = KEY_BINDINGS[event.code];
                if (!command) {
                    return;
                }
                if (isSettingsModalOpen()) {
                    if (command === 'escape') {
                        event.preventDefault();
                        closeSettingsModal();
                    }
                    return;
                }
                const activeTag = document.activeElement?.tagName;
                const isFieldActive = ['INPUT', 'TEXTAREA'].includes(activeTag);
                if (isFieldActive && !(command === 'submit' && state.session.stage === 'spelling')) {
                    if (!(command === 'reveal' && state.session.stage === 'recognition')) {
                        return;
                    }
                }
                if (command === 'submit') {
                    if (state.session.stage === 'spelling') {
                        event.preventDefault();
                        submitSpelling();
                        return;
                    }
                    if (triggerPrimaryCardAction()) {
                        event.preventDefault();
                        return;
                    }
                }
                if (command === 'reveal' && state.session.stage === 'recognition') {
                    event.preventDefault();
                    revealMeaning();
                    return;
                }
                if (command === 'escape') {
                    if (state.menuOpen) {
                        event.preventDefault();
                        closeMenu();
                        return;
                    }
                    if (state.viewport.isMobile && state.elements.sidePanel?.dataset.expanded === 'true') {
                        event.preventDefault();
                        toggleSidePanel(false);
                    }
                }
            };
            document.addEventListener('keydown', state.keyboardHandler);
        }
        if (state.elements.sessionCard && !state.elements.sessionCard.dataset.bound) {
            state.elements.sessionCard.addEventListener('click', handleCardAction);
            state.elements.sessionCard.dataset.bound = 'true';
        }
        if (state.elements.importInput && !state.elements.importInput.dataset.bound) {
            state.elements.importInput.addEventListener('change', handleImportInputChange);
            state.elements.importInput.dataset.bound = 'true';
        }
        if (state.elements.settingsForm && !state.elements.settingsForm.dataset.bound) {
            state.elements.settingsForm.addEventListener('submit', handleSettingsSubmit);
            state.elements.settingsForm.addEventListener('input', () => {
                if (state.elements.settingsError) {
                    state.elements.settingsError.textContent = '';
                }
            });
            state.elements.settingsForm.dataset.bound = 'true';
        }
        if (state.elements.settingsModal && !state.elements.settingsModal.dataset.bound) {
            state.elements.settingsModal.addEventListener('click', (event) => {
                const trigger = event.target.closest('[data-action]');
                const action = trigger?.dataset?.action;
                if (!action) {
                    return;
                }
                if (action === 'close-settings' || action === 'cancel-settings') {
                    event.preventDefault();
                    closeSettingsModal();
                }
            });
            state.elements.settingsModal.dataset.bound = 'true';
        }
    }

    function handleImportRequest() {
        if (!state.store || typeof state.store.init !== 'function') {
            showFeedbackMessage('词汇数据尚未准备就绪', 'warning');
            return;
        }
        if (state.ui.importing) {
            return;
        }
        if (state.elements.importInput) {
            state.elements.importInput.value = '';
            state.elements.importInput.click();
        }
    }

    function populateSettingsForm() {
        if (!state.store || !state.elements.settingsFields) {
            return;
        }
        const config = state.store.getConfig ? state.store.getConfig() : {};
        const { dailyNew, reviewLimit, masteryCount, notify } = state.elements.settingsFields;
        if (dailyNew) {
            dailyNew.value = Number(config.dailyNew ?? DEFAULT_BATCH_SIZE);
        }
        if (reviewLimit) {
            reviewLimit.value = Number(config.reviewLimit ?? DEFAULT_BATCH_SIZE);
        }
        if (masteryCount) {
            masteryCount.value = Number(config.masteryCount ?? 4);
        }
        if (notify) {
            notify.checked = Boolean(config.notify !== false);
        }
        if (state.elements.settingsError) {
            state.elements.settingsError.textContent = '';
        }
    }

    function openSettingsModal() {
        if (!state.elements.settingsModal) {
            showFeedbackMessage('设置面板未加载', 'warning');
            return;
        }
        populateSettingsForm();
        state.ui.lastFocus = document.activeElement;
        state.elements.settingsModal.removeAttribute('hidden');
        state.elements.settingsModal.dataset.open = 'true';
        const focusTarget = state.elements.settingsDialog?.querySelector('input, button, select, textarea');
        if (focusTarget && typeof focusTarget.focus === 'function') {
            focusTarget.focus();
        }
    }

    function closeSettingsModal() {
        if (!state.elements.settingsModal) {
            return;
        }
        state.elements.settingsModal.setAttribute('hidden', 'hidden');
        state.elements.settingsModal.dataset.open = 'false';
        if (state.elements.settingsError) {
            state.elements.settingsError.textContent = '';
        }
        const previousFocus = state.ui.lastFocus;
        if (previousFocus && typeof previousFocus.focus === 'function') {
            previousFocus.focus();
        }
        state.ui.lastFocus = null;
    }

    async function handleSettingsSubmit(event) {
        event.preventDefault();
        if (!state.store || typeof state.store.setConfig !== 'function') {
            showFeedbackMessage('词汇存储未准备就绪', 'error');
            return;
        }
        const form = event.currentTarget;
        const formData = new FormData(form);
        const daily = Number(formData.get('dailyNew'));
        const review = Number(formData.get('reviewLimit'));
        const mastery = Number(formData.get('masteryCount'));
        const notify = formData.get('notify') != null;

        const dailyNew = clampNumber(daily, CONFIG_LIMITS.dailyNew.min, CONFIG_LIMITS.dailyNew.max);
        const reviewLimit = clampNumber(review, CONFIG_LIMITS.reviewLimit.min, CONFIG_LIMITS.reviewLimit.max);
        const masteryCount = clampNumber(mastery, CONFIG_LIMITS.masteryCount.min, CONFIG_LIMITS.masteryCount.max);

        if (dailyNew === null || reviewLimit === null || masteryCount === null) {
            if (state.elements.settingsError) {
                state.elements.settingsError.textContent = '请输入有效的数字范围。';
            }
            showFeedbackMessage('请输入有效的数字范围', 'warning');
            return;
        }

        try {
            await state.store.setConfig({ dailyNew, reviewLimit, masteryCount, notify });
            state.session.batchSize = Math.max(1, Math.min(reviewLimit, DEFAULT_BATCH_SIZE));
            closeSettingsModal();
            refreshDashboard();
            render();
            showFeedbackMessage('学习设置已更新', 'success');
        } catch (error) {
            console.error('[VocabSessionView] 设置保存失败:', error);
            if (state.elements.settingsError) {
                state.elements.settingsError.textContent = error.message || '保存失败，请稍后再试。';
            }
            showFeedbackMessage(`保存失败：${error.message || error}`, 'error');
        }
    }

    async function performImport(file) {
        if (!file || state.ui.importing) {
            return;
        }
        const io = window.VocabDataIO;
        if (!io || typeof io.importWordList !== 'function') {
            showFeedbackMessage('未找到导入模块，请刷新后重试', 'error');
            return;
        }
        try {
            state.ui.importing = true;
            await state.store.init();
            const payload = await io.importWordList(file);
            const result = Array.isArray(payload)
                ? { type: 'wordlist', entries: payload, meta: { category: 'external' } }
                : (payload || {});
            const entries = Array.isArray(result.entries) ? result.entries : [];
            if (!entries.length) {
                showFeedbackMessage('未在文件中发现有效词汇', 'warning');
                return;
            }
            const meta = result.meta || {};
            const sourceLabel = typeof meta.name === 'string' && meta.name.trim()
                ? meta.name.trim()
                : (typeof meta.source === 'string' && meta.source.trim() ? meta.source.trim() : '');
            if (result.type === 'progress') {
                await state.store.setWords(entries);
                if (meta.config && typeof meta.config === 'object') {
                    await state.store.setConfig(meta.config);
                    const latestConfig = state.store.getConfig();
                    const limit = Number(latestConfig?.reviewLimit);
                    if (Number.isFinite(limit) && limit > 0) {
                        state.session.batchSize = Math.max(1, Math.min(limit, DEFAULT_BATCH_SIZE));
                    }
                }
                if (Array.isArray(meta.reviewQueue)) {
                    await state.store.setReviewQueue(meta.reviewQueue);
                }
                resetSessionState();
                prepareSessionQueue();
                refreshDashboard();
                if (state.session.stage !== 'empty') {
                    startBatch(true);
                } else {
                    render();
                }
                const categoryLabel = meta.category === 'user' ? '自设备份' : '学习备份';
                const suffix = sourceLabel ? `「${sourceLabel}」` : '';
                showFeedbackMessage(`${categoryLabel}${suffix}导入完成，已同步 ${entries.length} 条词汇`, 'success');
                return;
            }
            const existing = state.store.getWords();
            const merged = existing.slice();
            const indexByWord = new Map();
            existing.forEach((word, index) => {
                if (word && typeof word.word === 'string') {
                    indexByWord.set(word.word.trim().toLowerCase(), index);
                }
            });
            let updatedCount = 0;
            let insertedCount = 0;
            entries.forEach((entry) => {
                const key = String(entry.word || '').trim().toLowerCase();
                if (!key) {
                    return;
                }
                if (indexByWord.has(key)) {
                    const idx = indexByWord.get(key);
                    const base = merged[idx];
                    merged[idx] = {
                        ...base,
                        meaning: entry.meaning || base.meaning,
                        example: entry.example || base.example,
                        freq: typeof entry.freq === 'number' ? entry.freq : base.freq
                    };
                    updatedCount += 1;
                    return;
                }
                merged.push({
                    word: entry.word,
                    meaning: entry.meaning,
                    example: entry.example || '',
                    freq: typeof entry.freq === 'number' ? entry.freq : undefined
                });
                indexByWord.set(key, merged.length - 1);
                insertedCount += 1;
            });
            if (!insertedCount && !updatedCount) {
                showFeedbackMessage('所有词条均已存在，无需更新', 'info');
                return;
            }
            await state.store.setWords(merged);
            const categoryLabel = meta.category === 'user' ? '自设词表' : '外部词表';
            const suffix = sourceLabel ? `「${sourceLabel}」` : '';
            showFeedbackMessage(`${categoryLabel}${suffix}导入完成：新增 ${insertedCount} 条，更新 ${updatedCount} 条`, 'success');
            refreshDashboard();
            if (state.session.stage === 'empty' || state.session.stage === 'loading') {
                prepareSessionQueue();
                if (state.session.stage !== 'empty') {
                    startBatch(true);
                } else {
                    render();
                }
            } else {
                render();
            }
        } catch (error) {
            console.error('[VocabSessionView] 导入失败:', error);
            showFeedbackMessage(`导入失败：${error.message || error}`, 'error');
        } finally {
            state.ui.importing = false;
        }
    }

    function handleImportInputChange(event) {
        const input = event.currentTarget;
        const [file] = input.files || [];
        input.value = '';
        if (file) {
            performImport(file);
        }
    }

    async function handleExportRequest() {
        if (!state.store || typeof state.store.init !== 'function') {
            showFeedbackMessage('词汇数据尚未加载', 'warning');
            return;
        }
        if (state.ui.exporting) {
            return;
        }
        const io = window.VocabDataIO;
        if (!io || typeof io.exportProgress !== 'function') {
            showFeedbackMessage('导出模块未加载', 'error');
            return;
        }
        try {
            state.ui.exporting = true;
            await state.store.init();
            const blob = await io.exportProgress();
            const filename = `vocab-progress-${formatTimestamp()}.json`;
            triggerDownload(blob, filename);
            showFeedbackMessage('词汇进度已导出', 'success');
        } catch (error) {
            console.error('[VocabSessionView] 导出失败:', error);
            showFeedbackMessage(`导出失败：${error.message || error}`, 'error');
        } finally {
            state.ui.exporting = false;
        }
    }

    function handlePrimaryButtonClick(event) {
        event.preventDefault();
        const intent = event.currentTarget?.dataset?.intent || 'review';
        if (intent === 'import') {
            handleImportRequest();
            return;
        }
        if (intent === 'new') {
            startReviewFlow({ preferNew: true });
            return;
        }
        startReviewFlow();
    }

    function hideDueBanner() {
        if (!state.elements.dueBanner) {
            return;
        }
        state.elements.dueBanner.setAttribute('hidden', 'hidden');
    }

    function showDueBanner(count) {
        if (!state.elements.dueBanner || !state.elements.dueText) {
            return;
        }
        if (count <= 0) {
            hideDueBanner();
            return;
        }
        state.elements.dueText.textContent = `你有 ${count} 个待复习，建议先复习。`;
        state.elements.dueBanner.removeAttribute('hidden');
    }

    function setSidePanelExpanded(expanded) {
        if (!state.elements.sidePanel) {
            return;
        }
        const isExpanded = !!expanded;
        state.elements.sidePanel.dataset.expanded = isExpanded ? 'true' : 'false';
        if (state.elements.root) {
            state.elements.root.dataset.sidePanel = isExpanded ? 'visible' : 'hidden';
        }
        if (isExpanded) {
            state.elements.sidePanel.removeAttribute('hidden');
        } else {
            state.elements.sidePanel.setAttribute('hidden', 'hidden');
        }
        const toggleButton = state.elements.sidePanel.querySelector('[data-action="toggle-side-panel"]');
        if (toggleButton) {
            toggleButton.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        }
        if (state.elements.sideSurface) {
            if (isExpanded) {
                state.elements.sideSurface.removeAttribute('hidden');
            } else {
                state.elements.sideSurface.setAttribute('hidden', 'hidden');
            }
        }
    }

    function toggleSidePanel(forceState, options = {}) {
        if (!state.elements.sidePanel) {
            return;
        }
        const expanded = typeof forceState === 'boolean'
            ? forceState
            : state.elements.sidePanel.dataset.expanded !== 'true';
        if (options.manual) {
            state.ui.sidePanelManual = expanded;
        }
        setSidePanelExpanded(expanded);
    }

    function syncSidePanelVisibility() {
        if (!state.elements.sidePanel) {
            return;
        }
        const manualPreference = state.ui.sidePanelManual;
        let shouldShow;
        if (typeof manualPreference === 'boolean') {
            shouldShow = manualPreference;
        } else {
            const stage = state.session.stage;
            const hasWord = !!state.session.currentWord;
            shouldShow = (stage === 'feedback' && hasWord) || state.session.meaningVisible;
        }
        setSidePanelExpanded(shouldShow);
    }

    function announce(message) {
        if (!state.elements.liveRegion) {
            return;
        }
        state.elements.liveRegion.textContent = '';
        window.setTimeout(() => {
            state.elements.liveRegion.textContent = message;
        }, 32);
    }

    function computeStats() {
        if (!state.store) {
            return null;
        }
        const words = state.store.getWords();
        const config = state.store.getConfig();
        const due = state.store.getDueWords(new Date());
        const newCandidates = words.filter((word) => !word.lastReviewed || !word.nextReview);
        return {
            totalWords: words.length,
            dueCount: due.length,
            masteredCount: words.filter((word) => Number(word.correctCount) >= Number(config.masteryCount || 4)).length,
            dailyNew: Number(config.dailyNew) || 0,
            reviewLimit: Number(config.reviewLimit) || 0,
            newCandidateCount: newCandidates.length
        };
    }

    function updateProgressStats() {
        if (!state.elements.progressStats) {
            return;
        }
        const stats = state.session.progress;
        const total = stats.total || 0;
        const accuracy = total ? Math.round((stats.correct / total) * 100) : 0;
        const chips = state.elements.progressStats.querySelectorAll('[data-chip]');
        chips.forEach((chip) => {
            const key = chip.dataset.chip;
            if (key === 'new') {
                chip.textContent = `新词 ${state.session.newTotal}`;
            } else if (key === 'review') {
                chip.textContent = `复习 ${state.session.dueTotal}`;
            } else if (key === 'accuracy') {
                chip.textContent = `正确率 ${accuracy}%`;
            }
        });
        if (state.elements.progressBar) {
            const percent = total ? Math.round((stats.completed / total) * 100) : 0;
            state.elements.progressBar.style.width = `${percent}%`;
            const container = state.elements.progressBar.closest('.vocab-progress');
            if (container) {
                container.setAttribute('aria-valuenow', String(percent));
            }
        }
    }

    function updatePrimaryAction() {
        const button = state.elements.primaryButton;
        if (!button) {
            return;
        }
        const stats = computeStats();
        let intent = 'import';
        let label = '导入词表';
        if (stats) {
            if (stats.dueCount > 0) {
                intent = 'review';
                label = `开始复习（${stats.dueCount}）`;
            } else if (stats.newCandidateCount > 0) {
                const limit = stats.dailyNew > 0 ? stats.dailyNew : stats.newCandidateCount;
                const displayCount = Math.min(stats.newCandidateCount, limit);
                intent = 'new';
                label = `新词起步（${displayCount}）`;
            }
        }
        button.dataset.intent = intent;
        button.textContent = label;
        button.classList.remove('btn-primary', 'btn-outline');
        if (intent === 'import') {
            button.classList.add('btn-outline');
        } else {
            button.classList.add('btn-primary');
        }
    }

    function updateBottomBar() {
        const bar = state.elements.bottomBar;
        const spacer = state.elements.bottomSpacer;
        const actions = state.elements.bottomActions;
        if (!bar || !actions) {
            return;
        }
        const showBar = state.session.stage === 'spelling';
        if (showBar) {
            bar.removeAttribute('hidden');
            if (spacer) {
                spacer.removeAttribute('hidden');
            }
        } else {
            bar.setAttribute('hidden', 'hidden');
            if (spacer) {
                spacer.setAttribute('hidden', 'hidden');
            }
        }
        const buttons = actions.querySelectorAll('button[data-result]');
        buttons.forEach((button) => {
            if (showBar) {
                button.removeAttribute('disabled');
            } else {
                button.setAttribute('disabled', 'disabled');
            }
        });
    }

    function updateSidePanelContent(word) {
        if (!state.elements.sideBody) {
            return;
        }
        const meaning = state.elements.sideBody.querySelector('[data-field="meaning"]');
        const example = state.elements.sideBody.querySelector('[data-field="example"]');
        const meta = state.elements.sideBody.querySelector('[data-field="meta"]');
        const noteInput = state.elements.sideBody.querySelector('[data-field="note"]');
        const noteStatus = state.elements.sideBody.querySelector('[data-field="note-status"]');
        if (!word) {
            meaning.textContent = '—';
            example.textContent = '暂无词条';
            meta.textContent = '无可用信息';
            if (noteInput) {
                noteInput.value = '';
            }
            if (noteStatus) {
                noteStatus.textContent = '';
            }
            return;
        }
        meaning.textContent = word.meaning || '—';
        example.textContent = word.example || '暂无例句';
        meta.textContent = word.source || '内置 IELTS 核心词表';
        if (noteInput) {
            noteInput.value = word.note || '';
        }
        if (noteStatus) {
            noteStatus.textContent = '';
        }
    }

    function escapeHtml(value) {
        if (value == null) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function buildFeedbackSummary(status, word) {
        const nextReview = word.nextReview ? new Date(word.nextReview).toLocaleString() : '稍后安排';
        if (status === 'correct') {
            return {
                title: '太棒了！',
                message: `将于 ${nextReview} 再次复习。`
            };
        }
        if (status === 'near') {
            return {
                title: '接近正确',
                message: `拼写差一点：${word.word}`
            };
        }
        return {
            title: '别急',
            message: `正确是：${word.word}`
        };
    }

    function handleCardAction(event) {
        if (isSettingsModalOpen()) {
            return;
        }
        const trigger = event.target.closest('[data-action]');
        const action = trigger?.dataset?.action;
        if (!action) {
            return;
        }
        event.preventDefault();
        if (action === 'reveal-meaning') {
            revealMeaning();
            return;
        }
        if (action === 'recognize-easy') {
            state.session.recognitionQuality = 'easy';
            state.session.stage = 'spelling';
            state.session.meaningVisible = false;
            state.session.spellingAttempts = 0;
            state.session.typedAnswer = '';
            state.ui.sidePanelManual = null;
            render();
            return;
        }
        if (action === 'recognize-good') {
            state.session.recognitionQuality = 'good';
            state.session.stage = 'spelling';
            state.session.meaningVisible = false;
            state.session.spellingAttempts = 0;
            state.session.typedAnswer = '';
            state.ui.sidePanelManual = null;
            render();
            return;
        }
        if (action === 'recognize-hard') {
            state.session.recognitionQuality = 'hard';
            state.session.stage = 'spelling';
            state.session.meaningVisible = false;
            state.session.spellingAttempts = 0;
            state.session.typedAnswer = '';
            state.ui.sidePanelManual = null;
            render();
            return;
        }
        if (action === 'submit-spelling') {
            submitSpelling();
            return;
        }
        if (action === 'skip-spelling') {
            // 跳过拼写，应用跳过惩罚
            applyResult(null, { skipped: true });
            return;
        }
        if (action === 'next-word') {
            moveToNextWord();
            return;
        }
        if (action === 'rate-easy') {
            rateAndContinue('easy');
            return;
        }
        if (action === 'rate-good') {
            rateAndContinue('good');
            return;
        }
        if (action === 'rate-hard') {
            rateAndContinue('hard');
            return;
        }
        if (action === 'next-batch') {
            startBatch(true);
            return;
        }
        if (action === 'end-session') {
            endCurrentSession();
            return;
        }
        if (action === 'empty-import') {
            handleImportRequest();
            return;
        }
        if (action === 'empty-new') {
            startReviewFlow({ preferNew: true });
            return;
        }
    }

    function revealMeaning() {
        state.session.meaningVisible = !state.session.meaningVisible;
        state.ui.sidePanelManual = null;
        render();
    }

    function levenshteinDistance(a, b) {
        const s = (a || '').toLowerCase().trim();
        const t = (b || '').toLowerCase().trim();
        if (!s.length) {
            return t.length;
        }
        if (!t.length) {
            return s.length;
        }
        const costs = Array(t.length + 1).fill(0);
        for (let j = 0; j <= t.length; j += 1) {
            costs[j] = j;
        }
        for (let i = 1; i <= s.length; i += 1) {
            let lastValue = i - 1;
            costs[0] = i;
            for (let j = 1; j <= t.length; j += 1) {
                const newValue = Math.min(
                    costs[j] + 1,
                    costs[j - 1] + 1,
                    lastValue + (s[i - 1] === t[j - 1] ? 0 : 1)
                );
                lastValue = costs[j];
                costs[j] = newValue;
            }
        }
        return costs[t.length];
    }

    function evaluateAnswer(input, word) {
        const normalizedAnswer = (input || '').trim();
        const normalizedWord = (word.word || '').trim();
        if (!normalizedWord) {
            return { status: 'wrong', quality: 'wrong', distance: 0 };
        }
        if (!normalizedAnswer) {
            return { status: 'wrong', quality: 'wrong', distance: normalizedWord.length };
        }
        if (normalizedAnswer.toLowerCase() === normalizedWord.toLowerCase()) {
            return { status: 'correct', quality: 'good', distance: 0 };
        }
        const distance = levenshteinDistance(normalizedAnswer, normalizedWord);
        if (distance <= 1) {
            return { status: 'near', quality: 'hard', distance };
        }
        return { status: 'wrong', quality: 'wrong', distance };
    }

    function scheduleNear(word, now) {
        const scheduler = state.scheduler;
        const baseBox = Number(word.box) || (scheduler ? scheduler.MIN_BOX : 1);
        const nextReview = scheduler && typeof scheduler.calculateNextReview === 'function'
            ? scheduler.calculateNextReview(baseBox, now)
            : new Date(now.getTime() + 3 * 60 * 60 * 1000);
        const delta = Math.max(10 * 60 * 1000, Math.floor((nextReview.getTime() - now.getTime()) / 2));
        return {
            box: baseBox,
            correctCount: Number(word.correctCount) || 0,
            lastReviewed: now.toISOString(),
            nextReview: new Date(now.getTime() + delta).toISOString()
        };
    }

    function submitSpelling() {
        const card = state.elements.sessionCard;
        if (!card) {
            return;
        }
        const input = card.querySelector('input[name="answer"]');
        if (!input) {
            return;
        }
        const answer = input.value.trim();
        const word = state.session.currentWord;
        
        if (!answer) {
            return;
        }
        
        state.session.typedAnswer = answer;
        
        // 检查拼写是否正确
        const isCorrect = answer.toLowerCase() === word.word.toLowerCase();
        
        if (isCorrect) {
            // 拼写正确，使用认识质量
            const recognitionQuality = state.session.recognitionQuality || 'good';
            applyResult(recognitionQuality, { answer, spellingCorrect: true });
            return;
        }
        
        // 拼写错误，增加尝试次数
        state.session.spellingAttempts = (state.session.spellingAttempts || 0) + 1;
        const maxAttempts = 3;
        
        if (state.session.spellingAttempts >= maxAttempts) {
            // 达到最大尝试次数，标记为错误
            applyResult('wrong', { answer, spellingCorrect: false, attemptsExhausted: true });
            return;
        }
        
        // 还有机会，重新渲染
        state.session.typedAnswer = '';
        render();
        
        // 显示错误提示
        if (typeof window.showToast === 'function') {
            window.showToast(`拼写错误，还有 ${maxAttempts - state.session.spellingAttempts} 次机会`, 'warning');
        }
    }

    async function applyResult(qualityOrStatus, options = {}) {
        const session = state.session;
        const word = session.currentWord;
        if (!word || !state.store || !state.scheduler) {
            return;
        }
        if (session.stage !== 'spelling' && !options.skipped) {
            return;
        }
        const now = new Date();
        
        // 基础质量评分（来自认识判断）
        const recognitionQuality = session.recognitionQuality || 'good';
        const spellingAttempts = session.spellingAttempts || 0;
        const skipped = options.skipped || false;
        const isIntraReview = word.__intraReview === true;
        const cycleType = word.__cycleType || 'normal';
        
        // 确定最终质量（考虑拼写错误）
        let finalQuality = recognitionQuality;
        if (skipped) {
            finalQuality = 'hard'; // 跳过视为困难
        } else if (spellingAttempts >= 2) {
            finalQuality = 'hard'; // 多次拼写错误视为困难
        } else if (spellingAttempts === 1 && recognitionQuality === 'easy') {
            finalQuality = 'good'; // 简单但拼写错误降为一般
        }
        
        // 处理新词或轮内循环
        let patch;
        if (!word.easeFactor) {
            // 新词：设置起始难度因子
            patch = state.scheduler.setInitialEaseFactor(word, finalQuality);
        } else if (isIntraReview) {
            // 轮内循环：调整难度因子
            patch = state.scheduler.adjustIntraCycleEF(word, finalQuality);
        } else {
            // 正常复习：使用标准SM-2算法
            patch = state.scheduler.scheduleAfterResult(word, finalQuality, now);
        }
        
        // 判断是否需要继续轮内循环或安排验证
        const intraCycles = patch.intraCycles || 0;
        const maxCycles = state.scheduler.SM2_CONSTANTS.MAX_INTRA_CYCLES;
        
        let needsContinueIntra = false;
        let needsEasyVerification = false;
        
        if (cycleType === 'easy_verification') {
            // easy验证阶段
            if (finalQuality === 'easy') {
                // 验证通过，正式进入复习队列
                patch = state.scheduler.scheduleAfterResult(patch, 'easy', now);
            } else {
                // 验证失败，重新进入轮内循环
                patch.intraCycles = 1;
                needsContinueIntra = true;
            }
        } else if (!isIntraReview) {
            // 首次接触
            if (finalQuality === 'easy') {
                // easy直接进入复习队列，不需要验证
                patch = state.scheduler.scheduleAfterResult(patch, 'easy', now);
            } else if (finalQuality === 'good' || finalQuality === 'hard') {
                // good/hard进入轮内循环
                needsContinueIntra = true;
            }
        } else {
            // 轮内循环中
            if (finalQuality === 'easy') {
                // 任何一次easy都要验证
                needsEasyVerification = true;
                patch.intraCycles = 0; // 重置循环计数
            } else if (intraCycles < maxCycles) {
                // good/hard继续循环
                needsContinueIntra = true;
            } else {
                // 达到最大循环次数，强制毕业
                patch = state.scheduler.scheduleAfterResult(patch, finalQuality, now);
            }
        }
        
        // 安排后续复习
        if (needsEasyVerification) {
            scheduleIntraReview(patch, 'easy_verification');
        } else if (needsContinueIntra) {
            scheduleIntraReview(patch, 'normal');
        }
        
        // 保存到数据库（除非是临时的轮内状态）
        const shouldSave = !needsContinueIntra && !needsEasyVerification;
        let updated = patch;
        
        if (shouldSave) {
            updated = await state.store.updateWord(word.id, patch) || patch;
        }
        
        session.currentWord = updated;
        session.lastAnswer = {
            recognitionQuality,
            spellingAttempts,
            spellingCorrect: spellingAttempts === 0 && !skipped,
            typed: options.answer ?? session.typedAnswer,
            skipped,
            finalQuality,
            isIntraReview,
            cycleType,
            intraCycles,
            needsContinueIntra,
            needsEasyVerification,
            saved: shouldSave
        };
        session.stage = 'feedback';
        session.meaningVisible = true;
        state.ui.sidePanelManual = null;
        session.typedAnswer = '';
        
        // 更新统计（只有正式完成的才计入）
        if (shouldSave) {
            if (finalQuality === 'hard' && spellingAttempts >= 2) {
                session.progress.wrong += 1;
            } else if (finalQuality === 'hard' || spellingAttempts > 0) {
                session.progress.near += 1;
            } else {
                session.progress.correct += 1;
            }
            session.progress.completed += 1;
        }
        
        render();
    }

    function scheduleIntraReview(word, cycleType = 'normal') {
        let insertPosition;
        
        if (cycleType === 'easy_verification') {
            // easy验证：插入到第 20-30 个位置
            insertPosition = Math.min(
                state.session.activeQueue.length,
                Math.floor(Math.random() * 11) + 20  // 20-30 随机
            );
        } else {
            // 正常轮内循环：插入到第 3-8 个位置
            insertPosition = Math.min(
                state.session.activeQueue.length,
                Math.floor(Math.random() * 6) + 3  // 3-8 随机
            );
        }
        
        const clone = {
            ...word,
            __intraReview: true,
            __cycleType: cycleType,
            __insertedAt: Date.now()
        };
        
        state.session.activeQueue.splice(insertPosition, 0, clone);
    }

    function requeueForRetry(word, status) {
        // 错题重测：插入到队列末尾，当天内再次复习
        const clone = { ...word, __retry: true };
        clone.__retryDue = Date.now() + (RETRY_DELAYS[status] || RETRY_DELAYS.wrong);
        state.session.activeQueue.push(clone);
    }

    function rateAndContinue(quality) {
        const session = state.session;
        const word = session.currentWord;
        if (!word || session.stage !== 'feedback') {
            return;
        }
        
        // 如果用户重新评分，更新调度
        if (session.lastAnswer && session.lastAnswer.quality !== quality) {
            const now = new Date();
            const patch = state.scheduler.scheduleAfterResult(word, quality, now);
            state.store.updateWord(word.id, patch);
            session.currentWord = { ...word, ...patch };
            session.lastAnswer.quality = quality;
        }
        
        moveToNextWord();
    }

    function moveToNextWord() {
        state.session.lastAnswer = null;
        if (!state.session.activeQueue.length) {
            state.session.meaningVisible = false;
            state.ui.sidePanelManual = null;
            if (state.session.backlog.length) {
                state.session.stage = 'batch-finished';
            } else {
                state.session.stage = 'complete';
            }
            render();
            return;
        }
        const next = state.session.activeQueue.shift();
        const isRetry = next.__retry === true;
        state.ui.sidePanelManual = null;
        state.session.currentWord = { ...next };
        state.session.meaningVisible = false;
        state.session.recognitionQuality = null;
        state.session.spellingAttempts = 0;
        state.session.stage = 'recognition';
        state.session.typedAnswer = '';
        state.session.queueSeed += 1;
        render();
    }

    function saveCurrentNote() {
        const word = state.session.currentWord;
        if (!word || !state.store || !state.elements.noteInput) {
            return;
        }
        const note = state.elements.noteInput.value.trim();
        state.store.updateWord(word.id, { note });
        state.session.currentWord = {
            ...state.session.currentWord,
            note
        };
        if (state.elements.noteStatus) {
            state.elements.noteStatus.textContent = '已保存';
            setTimeout(() => {
                if (state.elements.noteStatus) {
                    state.elements.noteStatus.textContent = '';
                }
            }, 1500);
        }
    }

    function startBatch(force) {
        const session = state.session;
        if (!force && session.activeQueue.length) {
            return;
        }
        if (session.backlog.length === 0 && session.activeQueue.length === 0) {
            session.stage = 'complete';
            render();
            return;
        }
        state.ui.sidePanelManual = null;
        session.batchIndex += 1;
        session.progress = {
            total: Math.min(session.batchSize, session.backlog.length + session.activeQueue.length),
            completed: 0,
            correct: 0,
            near: 0,
            wrong: 0
        };
        session.activeQueue = session.backlog.splice(0, session.batchSize);
        hideDueBanner();
        session.stage = 'recall';
        moveToNextWord();
    }

    function endCurrentSession() {
        state.session.stage = 'complete';
        render();
        navigateToMoreView();
    }

    function renderCard() {
        const card = state.elements.sessionCard;
        if (!card) {
            return;
        }
        const session = state.session;
        const word = session.currentWord;

        if (session.stage === 'loading' || session.stage === 'preparing') {
            card.innerHTML = `
                <div class="vocab-card vocab-card--loading">
                    <div class="spinner"></div>
                    <p>正在加载词汇数据…</p>
                </div>
            `;
            return;
        }
        if (session.stage === 'empty') {
            card.innerHTML = `
                <div class="vocab-card vocab-card--empty">
                    <div class="vocab-card__illustration" aria-hidden="true">📭</div>
                    <h3 class="vocab-card__empty-title">暂无学习任务</h3>
                    <p class="vocab-card__empty-text">请导入词表或开启新词学习。</p>
                    <div class="vocab-card__actions vocab-card__actions--stack">
                        <button class="btn btn-primary" type="button" data-action="empty-import">导入词表</button>
                        <button class="btn btn-outline" type="button" data-action="empty-new">新词起步 (N)</button>
                    </div>
                </div>
            `;
            return;
        }
        if (session.stage === 'batch-finished') {
            const remaining = state.session.backlog.length;
            const nextMarkup = remaining > 0
                ? '<button class="btn btn-primary" type="button" data-action="next-batch">下一批</button>'
                : '';
            card.innerHTML = `
                <div class="vocab-card vocab-card--summary">
                    <div class="vocab-card__summary-head">
                        <h3>本批完成</h3>
                        <p>正确 ${session.progress.correct} · 近似 ${session.progress.near} · 错误 ${session.progress.wrong}</p>
                        <p class="vocab-card__summary-queue">剩余批次 ${remaining}</p>
                    </div>
                    <div class="vocab-card__actions vocab-card__actions--inline">
                        ${nextMarkup}
                        <button class="btn btn-outline" type="button" data-action="end-session">结束本轮</button>
                    </div>
                </div>
            `;
            return;
        }
        if (session.stage === 'complete') {
            card.innerHTML = `
                <div class="vocab-card vocab-card--complete">
                    <div class="vocab-card__summary-head">
                        <h3>今日任务完成</h3>
                        <p>恭喜坚持完成所有单词复习！</p>
                    </div>
                    <div class="vocab-card__actions vocab-card__actions--center">
                        <button class="btn btn-primary" type="button" data-action="end-session">返回更多</button>
                    </div>
                </div>
            `;
            return;
        }
        if (!word) {
            card.innerHTML = `
                <div class="vocab-card vocab-card--placeholder">
                    <p>准备下一条词汇…</p>
                </div>
            `;
            return;
        }
        if (session.stage === 'recognition') {
            const meaningBlock = session.meaningVisible
                ? `<div class="vocab-card__meaning" data-visible="true">${word.meaning || '暂无释义'}</div>`
                : '';
            const revealControl = session.meaningVisible
                ? ''
                : '<div class="vocab-card__reveal"><button class="btn btn-soft" type="button" data-action="reveal-meaning">看释义 (F)</button></div>';
            card.innerHTML = `
                <div class="vocab-card vocab-card--recognition">
                    <div class="vocab-card__wordline">
                        <div class="vocab-card__word">${word.word}</div>
                    </div>
                    ${meaningBlock}
                    ${revealControl}
                    <p class="vocab-card__instruction">评估你对这个单词的熟悉程度</p>
                    <div class="vocab-card__actions vocab-card__actions--inline">
                        <button class="btn btn-soft" type="button" data-action="recognize-easy">简单</button>
                        <button class="btn btn-primary" type="button" data-action="recognize-good">一般</button>
                        <button class="btn btn-outline" type="button" data-action="recognize-hard">困难</button>
                    </div>
                </div>
            `;
            return;
        }
        if (session.stage === 'spelling') {
            const attempts = session.spellingAttempts || 0;
            const maxAttempts = 3;
            const remainingAttempts = maxAttempts - attempts;
            
            const attemptsHint = attempts > 0 
                ? `<p class="vocab-card__attempts" style="color: #ed8936; font-size: 0.875rem;">已尝试 ${attempts} 次，剩余 ${remainingAttempts} 次机会</p>`
                : '';
            
            const instructionText = attempts === 0
                ? '根据释义，拼写出这个单词'
                : '再试一次，注意拼写细节';
            
            card.innerHTML = `
                <div class="vocab-card vocab-card--spelling">
                    <div class="vocab-card__meaning" data-visible="true" style="font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem;">
                        ${word.meaning || '暂无释义'}
                    </div>
                    <p class="vocab-card__instruction">${instructionText}</p>
                    ${attemptsHint}
                    <div class="vocab-card__input-block">
                        <input type="text" name="answer" autocomplete="off" placeholder="在此输入拼写" value="${escapeHtml(session.typedAnswer)}" autofocus>
                        <div class="vocab-card__input-actions">
                            <button class="btn btn-ghost" type="button" data-action="skip-spelling">跳过</button>
                            <button class="btn btn-primary" type="button" data-action="submit-spelling">提交 (Enter)</button>
                        </div>
                    </div>
                </div>
            `;
            const input = card.querySelector('input[name="answer"]');
            if (input) {
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
                input.addEventListener('input', (event) => {
                    state.session.typedAnswer = event.target.value;
                });
            }
            return;
        }
        if (session.stage === 'feedback') {
            const recognitionQuality = session.lastAnswer?.recognitionQuality || 'good';
            const spellingAttempts = session.lastAnswer?.spellingAttempts || 0;
            const spellingCorrect = session.lastAnswer?.spellingCorrect !== false;
            const skipped = session.lastAnswer?.skipped || false;
            const baseEF = session.lastAnswer?.baseEF || word.easeFactor;
            const finalEF = session.lastAnswer?.finalEF || word.easeFactor;
            const penalty = session.lastAnswer?.penalty || 0;
            
            const icon = spellingAttempts >= 3 ? '❌' : (spellingAttempts > 0 || skipped ? '🟡' : '✅');
            const title = spellingAttempts >= 3 ? '需要加强' : (spellingAttempts > 0 || skipped ? '接近了' : '太棒了！');
            
            const nextReview = word.nextReview ? new Date(word.nextReview).toLocaleString() : '待安排';
            const typedAnswer = session.lastAnswer?.typed ? escapeHtml(session.lastAnswer.typed) : '';
            
            // SM-2 信息展示
            const intervalDays = word.interval || 1;
            const easeFactor = finalEF.toFixed(2);
            const repetitions = word.repetitions || 0;
            
            // 拼写结果提示
            let spellingFeedback = '';
            if (!skipped) {
                if (spellingCorrect) {
                    spellingFeedback = '<p style="color: #48bb78; font-size: 0.875rem; margin: 0.25rem 0;">✓ 拼写正确</p>';
                } else if (spellingAttempts > 0) {
                    spellingFeedback = `<p style="color: #f56565; font-size: 0.875rem; margin: 0.25rem 0;">✗ 拼写错误 ${spellingAttempts} 次 (EF -${(penalty).toFixed(2)})</p>`;
                }
            } else {
                spellingFeedback = `<p style="color: #718096; font-size: 0.875rem; margin: 0.25rem 0;">已跳过拼写 (EF -${(penalty).toFixed(2)})</p>`;
            }
            
            // 认识质量标签
            const recognitionLabel = recognitionQuality === 'easy' ? '简单' : recognitionQuality === 'good' ? '一般' : '困难';
            const recognitionChange = baseEF > word.easeFactor ? `(EF +${(baseEF - (word.easeFactor || 2.5)).toFixed(2)})` : '';
            
            // 质量分解
            const isIntraReview = session.lastAnswer?.isIntraReview || false;
            const cycleType = session.lastAnswer?.cycleType || 'normal';
            const intraCycles = session.lastAnswer?.intraCycles || 0;
            const needsContinueIntra = session.lastAnswer?.needsContinueIntra || false;
            const needsEasyVerification = session.lastAnswer?.needsEasyVerification || false;
            const finalQuality = session.lastAnswer?.finalQuality || recognitionQuality;
            const saved = session.lastAnswer?.saved || false;
            
            let qualityBreakdown = '';
            
            if (needsEasyVerification) {
                // 安排easy验证
                qualityBreakdown = `
                    <div style="margin: 1rem 0; padding: 0.75rem; background: rgba(76, 175, 80, 0.1); border-left: 4px solid #4caf50; border-radius: 8px; font-size: 0.875rem;">
                        <p style="margin: 0 0 0.5rem; font-weight: 600; color: #2e7d32;">✨ 表现优秀！</p>
                        <p style="margin: 0.25rem 0; color: #2e7d32;">这个单词将在 20-30 个单词后再次出现进行验证。</p>
                        <p style="margin: 0.5rem 0 0; font-size: 0.8125rem; color: #2e7d32;">当前 EF：${easeFactor} | 轮内循环：${intraCycles} 次</p>
                    </div>
                `;
            } else if (needsContinueIntra) {
                // 继续轮内循环
                const maxCycles = 12;
                const remaining = maxCycles - intraCycles;
                qualityBreakdown = `
                    <div style="margin: 1rem 0; padding: 0.75rem; background: rgba(255, 193, 7, 0.1); border-left: 4px solid #ffc107; border-radius: 8px; font-size: 0.875rem;">
                        <p style="margin: 0 0 0.5rem; font-weight: 600; color: #856404;">🔄 继续轮内学习</p>
                        <p style="margin: 0.25rem 0; color: #856404;">这个单词将在 3-8 个单词后再次出现。</p>
                        <p style="margin: 0.5rem 0 0; font-size: 0.8125rem; color: #856404;">当前 EF：${easeFactor} | 已循环：${intraCycles}/${maxCycles} 次</p>
                    </div>
                `;
            } else if (cycleType === 'easy_verification') {
                // easy验证结果
                if (finalQuality === 'easy') {
                    qualityBreakdown = `
                        <div style="margin: 1rem 0; padding: 0.75rem; background: rgba(76, 175, 80, 0.1); border-left: 4px solid #4caf50; border-radius: 8px; font-size: 0.875rem;">
                            <p style="margin: 0 0 0.5rem; font-weight: 600; color: #2e7d32;">🎉 验证通过！</p>
                            <p style="margin: 0.25rem 0; color: #2e7d32;">单词已正式进入复习队列。</p>
                            <p style="margin: 0.5rem 0 0; font-size: 0.8125rem; color: #2e7d32;">最终 EF：${easeFactor}</p>
                        </div>
                    `;
                } else {
                    qualityBreakdown = `
                        <div style="margin: 1rem 0; padding: 0.75rem; background: rgba(255, 152, 0, 0.1); border-left: 4px solid #ff9800; border-radius: 8px; font-size: 0.875rem;">
                            <p style="margin: 0 0 0.5rem; font-weight: 600; color: #e65100;">⚠️ 验证未通过</p>
                            <p style="margin: 0.25rem 0; color: #e65100;">需要重新进入轮内学习。</p>
                            <p style="margin: 0.5rem 0 0; font-size: 0.8125rem; color: #e65100;">调整后 EF：${easeFactor}</p>
                        </div>
                    `;
                }
            } else if (isIntraReview) {
                // 轮内循环中的调整
                const adjustment = session.lastAnswer?.finalQuality === 'easy' ? '+0.15' : 
                                 session.lastAnswer?.finalQuality === 'good' ? '+0.05' : '-0.10';
                qualityBreakdown = `
                    <div style="margin: 1rem 0; padding: 0.75rem; background: rgba(0,0,0,0.02); border-radius: 8px; font-size: 0.875rem;">
                        <p style="margin: 0 0 0.5rem; font-weight: 600;">🔄 轮内循环调整：</p>
                        <p style="margin: 0.25rem 0;">认识判断：${recognitionLabel}</p>
                        ${spellingFeedback}
                        <p style="margin: 0.25rem 0;">EF 调整：${adjustment}</p>
                        <p style="margin: 0.5rem 0 0; font-weight: 600; color: #667eea;">当前 EF：${easeFactor} | 循环次数：${intraCycles}</p>
                    </div>
                `;
            } else {
                // 正常流程或新词
                const isNewWord = !word.lastReviewed;
                if (isNewWord) {
                    const initialEF = state.scheduler.INITIAL_EASE_FACTORS[finalQuality] || 2.5;
                    qualityBreakdown = `
                        <div style="margin: 1rem 0; padding: 0.75rem; background: rgba(33, 150, 243, 0.1); border-left: 4px solid #2196f3; border-radius: 8px; font-size: 0.875rem;">
                            <p style="margin: 0 0 0.5rem; font-weight: 600; color: #1565c0;">🆕 新词学习</p>
                            <p style="margin: 0.25rem 0; color: #1565c0;">认识判断：${recognitionLabel}</p>
                            ${spellingFeedback}
                            <p style="margin: 0.5rem 0 0; font-weight: 600; color: #1565c0;">起始难度因子：${initialEF}</p>
                        </div>
                    `;
                } else {
                    qualityBreakdown = `
                        <div style="margin: 1rem 0; padding: 0.75rem; background: rgba(0,0,0,0.02); border-radius: 8px; font-size: 0.875rem;">
                            <p style="margin: 0 0 0.5rem; font-weight: 600;">📈 复习完成：</p>
                            <p style="margin: 0.25rem 0;">认识判断：${recognitionLabel}</p>
                            ${spellingFeedback}
                            <p style="margin: 0.5rem 0 0; font-weight: 600; color: #667eea;">最终难度因子：${easeFactor}</p>
                        </div>
                    `;
                }
            }
            
            card.innerHTML = `
                <div class="vocab-card vocab-card--feedback vocab-card--${spellingAttempts >= 3 ? 'wrong' : spellingAttempts > 0 ? 'near' : 'correct'}">
                    <div class="vocab-feedback__head">
                        <span class="vocab-feedback__icon">${icon}</span>
                        <div>
                            <h3>${title}</h3>
                            <p>将于 ${nextReview} 再次复习</p>
                        </div>
                    </div>
                    <dl class="vocab-feedback__details">
                        <div><dt>正确拼写</dt><dd>${word.word}</dd></div>
                        <div><dt>释义</dt><dd>${word.meaning || '暂无释义'}</dd></div>
                        <div><dt>间隔天数</dt><dd>${intervalDays} 天</dd></div>
                        <div><dt>难度因子</dt><dd>${easeFactor}</dd></div>
                        <div><dt>连续正确</dt><dd>${repetitions} 次</dd></div>
                    </dl>
                    ${typedAnswer ? `<p class="vocab-feedback__typed">你的回答：${typedAnswer}</p>` : ''}
                    ${qualityBreakdown}
                    <div class="vocab-card__actions vocab-card__actions--inline" style="margin-top: 1rem;">
                        <button class="btn btn-primary" type="button" data-action="next-word">下一词 (Enter)</button>
                    </div>
                </div>
            `;
            announce(title);
            return;
        }
        card.innerHTML = `
            <div class="vocab-card vocab-card--placeholder">
                <p>准备下一条词汇…</p>
            </div>
        `;
    }

    function prepareSessionQueue(options = {}) {
        const store = state.store;
        if (!store) {
            return;
        }
        const config = store.getConfig();
        const { preferNew = false } = options;
        const reviewLimit = Number(config.reviewLimit) || DEFAULT_BATCH_SIZE;
        const now = new Date();
        const dueAll = store.getDueWords(now);
        const dueSelection = preferNew ? [] : dueAll.slice(0, reviewLimit);
        const preferredNewLimit = Number(config.dailyNew) > 0 ? Number(config.dailyNew) : DEFAULT_BATCH_SIZE;
        const newLimit = preferNew
            ? preferredNewLimit
            : Math.max(reviewLimit - dueSelection.length, 0) || preferredNewLimit;
        const newWords = newLimit > 0 ? store.getNewWords(newLimit) : [];
        state.session.backlog = dueSelection.concat(newWords).map((word) => ({ ...word }));
        state.session.dueTotal = dueSelection.length;
        state.session.newTotal = newWords.length;
        state.session.duePending = dueAll.length;
        if (!state.session.backlog.length) {
            state.session.stage = 'empty';
        } else {
            state.session.stage = 'preparing';
        }
    }

    function startReviewFlow(options = {}) {
        const { preferNew = false } = options;
        prepareSessionQueue({ preferNew });
        showDueBanner(state.session.duePending);
        state.ui.sidePanelManual = null;
        if (!state.session.backlog.length) {
            state.session.stage = 'empty';
            render();
            return;
        }
        startBatch(true);
    }

    function render() {
        renderCard();
        updateProgressStats();
        updateSidePanelContent(state.session.currentWord);
        updateBottomBar();
        updatePrimaryAction();
        syncSidePanelVisibility();
    }

    async function mount(container) {
        const target = resolveContainer(container || '#vocab-view');
        if (!target) {
            console.warn('[VocabSessionView] 容器不存在');
            return;
        }
        target.removeAttribute('hidden');
        state.container = target;
        if (!state.initialized) {
            createLayout(target);
            setupViewportWatcher();
            bindEvents();
            updateSidePanelMode();
            state.initialized = true;
        }
        state.store = window.VocabStore || state.store;
        state.scheduler = window.VocabScheduler || state.scheduler;
        if (!state.store || typeof state.store.init !== 'function') {
            if (state.elements.sessionCard) {
                state.elements.sessionCard.innerHTML = '<p class="vocab-card-error">词汇模块未加载，请稍后重试。</p>';
            }
            return;
        }
        state.session.stage = 'loading';
        render();
        try {
            await state.store.init();
        } catch (error) {
            console.error('[VocabSessionView] 初始化失败:', error);
            if (state.elements.sessionCard) {
                state.elements.sessionCard.innerHTML = `<div class="vocab-card-error">初始化失败：${error.message || error}</div>`;
            }
            return;
        }
        ensureListSwitcher();
        prepareSessionQueue();
        showDueBanner(state.session.duePending);
        if (state.session.stage === 'empty') {
            render();
            return;
        }
        startBatch(true);
    }

    function startSession() {
        if (state.session.stage === 'empty') {
            return;
        }
        startBatch(true);
    }

    function refreshDashboard() {
        const stats = computeStats();
        if (stats) {
            state.session.duePending = stats.dueCount;
            showDueBanner(stats.dueCount);
        }
        updateProgressStats();
        updatePrimaryAction();
    }

    const api = {
        mount,
        startSession,
        refreshDashboard,
        render,
        get state() {
            return { ...state.session };
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.VocabSessionView = api;
        window.vocabModule = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
