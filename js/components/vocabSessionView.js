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
        Digit1: 'wrong',
        Digit2: 'near',
        Digit3: 'correct',
        Numpad1: 'wrong',
        Numpad2: 'near',
        Numpad3: 'correct',
        KeyF: 'reveal',
        Escape: 'escape'
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
            sidePanelManual: null
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
            <footer class="vocab-bottom-bar" data-vocab-role="bottom-bar" hidden>
                <div class="vocab-bottom-bar__container">
                    <div class="vocab-bottom-bar__actions" data-vocab-role="bottom-actions">
                        <button class="btn btn-result btn-result--danger" type="button" data-result="wrong" disabled>错 ·1</button>
                        <button class="btn btn-result btn-result--neutral" type="button" data-result="near" disabled>近似 ·2</button>
                        <button class="btn btn-result btn-result--success" type="button" data-result="correct" disabled>对 ·3</button>
                    </div>
                </div>
            </footer>
            <div class="vocab-bottom-spacer" data-vocab-role="bottom-spacer" aria-hidden="true" hidden></div>
            <div class="visually-hidden" aria-live="polite" data-vocab-role="live-region"></div>
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
            dueBanner: layout.querySelector('[data-vocab-role=\"due-banner\"]'),
            dueText: layout.querySelector('[data-vocab-role=\"due-text\"]'),
            sessionCard: layout.querySelector('[data-vocab-role=\"session-card\"]'),
            sidePanel: layout.querySelector('[data-vocab-role=\"side-panel\"]'),
            sideSurface: layout.querySelector('[data-vocab-role=\"side-surface\"]'),
            noteInput: layout.querySelector('[data-field=\"note\"]'),
            noteStatus: layout.querySelector('[data-field=\"note-status\"]'),
            bottomBar: layout.querySelector('[data-vocab-role=\"bottom-bar\"]'),
            bottomActions: layout.querySelector('[data-vocab-role=\"bottom-actions\"]'),
            bottomSpacer: layout.querySelector('[data-vocab-role=\"bottom-spacer\"]'),
            liveRegion: layout.querySelector('[data-vocab-role=\"live-region\"]')
        };
        state.elements.sideBody = state.elements.sideSurface;
        setSidePanelExpanded(false);
    }
    function navigateToMoreView() {
        const moreView = document.getElementById('more-view');
        if (window.app && typeof window.app.navigateToView === 'function') {
            window.app.navigateToView('more');
            return;
        }
        if (moreView) {
            const vocabView = document.getElementById('vocab-view');
            if (vocabView) {
                vocabView.classList.remove('active');
                vocabView.setAttribute('hidden', 'hidden');
            }
            moreView.classList.add('active');
            moreView.removeAttribute('hidden');
        }
    }

    function closeMenu() {
        if (!state.menuOpen || !state.elements.menu) {
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
        if (state.elements.menu) {
            state.elements.menu.addEventListener('click', (event) => {
                const { action } = event.target.dataset || {};
                if (!action) {
                    return;
                }
                closeMenu();
                if (action === 'menu-import' || action === 'menu-export' || action === 'menu-settings') {
                    if (typeof window.showToast === 'function') {
                        window.showToast('功能开发中，敬请期待');
                    } else {
                        console.info('[VocabSessionView] menu action:', action);
                    }
                }
            });
        }
        if (state.elements.dueBanner && !state.elements.dueBanner.dataset.bound) {
            state.elements.dueBanner.addEventListener('click', (event) => {
                const { action } = event.target.dataset || {};
                if (action === 'start-review') {
                    hideDueBanner();
                    startReviewFlow();
                }
            });
            state.elements.dueBanner.dataset.bound = 'true';
        }
        if (state.elements.sidePanel && !state.elements.sidePanel.dataset.bound) {
            state.elements.sidePanel.addEventListener('click', (event) => {
                const { action } = event.target.dataset || {};
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
        if (state.elements.bottomActions && !state.elements.bottomActions.dataset.bound) {
            state.elements.bottomActions.addEventListener('click', (event) => {
                const { result } = event.target.dataset || {};
                if (!result) {
                    return;
                }
                event.preventDefault();
                applyResult(result);
            });
            state.elements.bottomActions.dataset.bound = 'true';
        }
        if (!state.keyboardHandler) {
            state.keyboardHandler = (event) => {
                const command = KEY_BINDINGS[event.code];
                if (!command) {
                    return;
                }
                if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && command !== 'submit' && command !== 'reveal') {
                    return;
                }
                if (command === 'submit' && state.session.stage === 'recall') {
                    event.preventDefault();
                    submitAnswer();
                } else if (command === 'reveal' && state.session.stage === 'recall') {
                    event.preventDefault();
                    revealMeaning();
                } else if (['wrong', 'near', 'correct'].includes(command) && state.session.stage === 'recall') {
                    event.preventDefault();
                    applyResult(command);
                } else if (command === 'escape') {
                    if (state.menuOpen) {
                        event.preventDefault();
                        closeMenu();
                    } else if (state.viewport.isMobile && state.elements.sidePanel?.dataset.expanded === 'true') {
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
    }

    function handleImportRequest() {
        closeMenu();
        if (typeof window.showToast === 'function') {
            window.showToast('导入功能即将开放，敬请期待');
        } else {
            console.info('[VocabSessionView] import action triggered');
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
        const isExpanded = expanded ? 'true' : 'false';
        state.elements.sidePanel.dataset.expanded = isExpanded;
        const toggleButton = state.elements.sidePanel.querySelector('[data-action="toggle-side-panel"]');
        if (toggleButton) {
            toggleButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }
        if (state.elements.sideSurface) {
            if (expanded) {
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
        const shouldShow = manualPreference !== null
            ? manualPreference
            : state.session.stage === 'feedback';
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
        const showBar = state.session.stage === 'recall';
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
        const { action } = event.target.dataset || {};
        if (!action) {
            return;
        }
        event.preventDefault();
        if (action === 'reveal-meaning') {
            revealMeaning();
            return;
        }
        if (action === 'recognize') {
            state.session.stage = 'recall';
            state.session.meaningVisible = false;
            state.session.recognitionFailed = false;
            state.session.recognitionMode = 'known';
            render();
            return;
        }
        if (action === 'recognize-fuzzy') {
            state.session.stage = 'recall';
            state.session.meaningVisible = true;
            state.session.recognitionFailed = false;
            state.session.recognitionMode = 'fuzzy';
            render();
            return;
        }
        if (action === 'not-recognize') {
            state.session.stage = 'recall';
            state.session.meaningVisible = true;
            state.session.recognitionFailed = true;
            state.session.recognitionMode = 'unknown';
            render();
            return;
        }
        if (action === 'submit-answer') {
            submitAnswer();
            return;
        }
        if (action === 'skip') {
            applyResult('wrong', { skipped: true });
            return;
        }
        if (action === 'next-word') {
            moveToNextWord();
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
            return { status: 'wrong', distance: 0 };
        }
        if (!normalizedAnswer) {
            return { status: 'wrong', distance: normalizedWord.length };
        }
        if (normalizedAnswer.toLowerCase() === normalizedWord.toLowerCase()) {
            return { status: 'correct', distance: 0 };
        }
        const distance = levenshteinDistance(normalizedAnswer, normalizedWord);
        if (distance <= 1) {
            return { status: 'near', distance };
        }
        return { status: 'wrong', distance };
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

    function submitAnswer() {
        const card = state.elements.sessionCard;
        if (!card) {
            return;
        }
        const input = card.querySelector('input[name="answer"]');
        if (!input) {
            return;
        }
        const answer = input.value;
        state.session.typedAnswer = answer;
        applyResult(null, { answer });
    }

    async function applyResult(explicitStatus, options = {}) {
        const session = state.session;
        const word = session.currentWord;
        if (!word || !state.store || !state.scheduler) {
            return;
        }
        if (session.stage !== 'recall' && explicitStatus !== null) {
            return;
        }
        const now = new Date();
        const evaluation = explicitStatus ? { status: explicitStatus, distance: null } : evaluateAnswer(options.answer ?? session.typedAnswer, word);
        let patch = {};
        let status = evaluation.status;
        if (status === 'correct') {
            patch = state.scheduler.scheduleAfterResult(word, true, now);
            session.progress.correct += 1;
        } else if (status === 'wrong') {
            patch = state.scheduler.scheduleAfterResult(word, false, now);
            session.progress.wrong += 1;
        } else if (status === 'near') {
            const nearPatch = scheduleNear(word, now);
            patch = {
                ...word,
                ...nearPatch
            };
            session.progress.near += 1;
        }
        session.progress.completed += 1;
        const updated = await state.store.updateWord(word.id, patch) || { ...word, ...patch };
        session.currentWord = updated;
        session.lastAnswer = {
            status,
            typed: options.answer ?? session.typedAnswer,
            distance: evaluation.distance
        };
        session.stage = 'feedback';
        session.meaningVisible = true;
        session.typedAnswer = '';
        if (status === 'wrong' || status === 'near') {
            requeueForRetry(updated, status);
        }
        render();
    }

    function requeueForRetry(word, status) {
        const clone = { ...word, __retry: true, __skipRecognition: true };
        clone.__retryDue = Date.now() + (RETRY_DELAYS[status] || RETRY_DELAYS.wrong);
        state.session.activeQueue.push(clone);
    }

    function moveToNextWord() {
        state.session.lastAnswer = null;
        if (!state.session.activeQueue.length) {
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
        state.session.currentWord = { ...next };
        state.session.meaningVisible = false;
        state.session.recognitionFailed = false;
        state.session.recognitionMode = 'idle';
        state.session.stage = !next.lastReviewed && !isRetry ? 'recognition' : 'recall';
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
                : '<button class="btn btn-soft" type="button" data-action="reveal-meaning">看释义 (F)</button>';
            card.innerHTML = `
                <div class="vocab-card vocab-card--recognition">
                    <div class="vocab-card__wordline">
                        <div class="vocab-card__word">${word.word}</div>
                        ${revealControl}
                    </div>
                    ${meaningBlock}
                    <p class="vocab-card__instruction">你认识这个单词吗？</p>
                    <div class="vocab-card__actions vocab-card__actions--inline">
                        <button class="btn btn-primary" type="button" data-action="recognize">认识</button>
                        <button class="btn btn-soft" type="button" data-action="recognize-fuzzy">模糊</button>
                        <button class="btn btn-outline" type="button" data-action="not-recognize">不认识</button>
                    </div>
                </div>
            `;
            return;
        }
        if (session.stage === 'recall') {
            const meaningBlock = session.meaningVisible
                ? `<div class="vocab-card__meaning" data-visible="true">${word.meaning || '暂无释义'}</div>`
                : '';
            const revealControl = session.meaningVisible
                ? ''
                : '<button class="btn btn-soft" type="button" data-action="reveal-meaning">显示释义 (F)</button>';
            const instructionText = session.recognitionFailed
                ? '先巩固释义，再尝试拼写'
                : (session.recognitionMode === 'fuzzy' ? '有点模糊？结合释义尝试拼写' : '请输入正确拼写');
            card.innerHTML = `
                <div class="vocab-card vocab-card--recall">
                    <div class="vocab-card__wordline">
                        <div class="vocab-card__word">${word.word}</div>
                        ${revealControl}
                    </div>
                    ${meaningBlock}
                    <p class="vocab-card__instruction">${instructionText}</p>
                    <div class="vocab-card__input-block">
                        <input type="text" name="answer" autocomplete="off" placeholder="在此输入拼写" value="${escapeHtml(session.typedAnswer)}">
                        <div class="vocab-card__input-actions">
                            <button class="btn btn-ghost" type="button" data-action="skip">跳过</button>
                            <button class="btn btn-primary" type="button" data-action="submit-answer">提交 (Enter)</button>
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
            const status = session.lastAnswer?.status || 'correct';
            const icon = status === 'correct' ? '✅' : (status === 'near' ? '🟡' : '❌');
            const summary = buildFeedbackSummary(status, word);
            const nextReview = word.nextReview ? new Date(word.nextReview).toLocaleString() : '待安排';
            const typedAnswer = session.lastAnswer?.typed ? escapeHtml(session.lastAnswer.typed) : '';
            card.innerHTML = `
                <div class="vocab-card vocab-card--feedback vocab-card--${status}">
                    <div class="vocab-feedback__head">
                        <span class="vocab-feedback__icon">${icon}</span>
                        <div>
                            <h3>${summary.title}</h3>
                            <p>${summary.message}</p>
                        </div>
                    </div>
                    <dl class="vocab-feedback__details">
                        <div><dt>正确拼写</dt><dd>${word.word}</dd></div>
                        <div><dt>释义</dt><dd>${word.meaning || '暂无释义'}</dd></div>
                        <div><dt>下次复习</dt><dd>${nextReview}</dd></div>
                    </dl>
                    ${typedAnswer ? `<p class="vocab-feedback__typed">你的回答：${typedAnswer}</p>` : ''}
                    <div class="vocab-card__actions vocab-card__actions--inline">
                        <button class="btn btn-primary" type="button" data-action="next-word">下一词</button>
                    </div>
                </div>
            `;
            announce(summary.message);
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
