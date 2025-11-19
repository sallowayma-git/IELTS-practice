/**
 * 练习页面通用UI脚本
 * 提供计时器、设置面板、笔记面板、文本高亮与面板拖拽等交互
 */
(function () {
    document.addEventListener('DOMContentLoaded', function () {
        let settingsOpen = false;
        let notesOpen = false;
        let timerRunning = true;
        let seconds = 0;
        let timer;
        let submissionLocked = false;
        let isResizing = false;
        const selbar = document.getElementById('selbar');
        let lastRange = null;
        let currentHlNode = null;
        let keepToolbar = false;
        injectPracticeUIStyles();

        const overlay = document.querySelector('.overlay');
        const settingsPanel = document.getElementById('settings-panel');
        const notesPanel = document.getElementById('notes-panel');
        const headerControls = document.querySelector('.header-controls');
        const timerEl = document.getElementById('timer');
        const submitBtn = document.getElementById('submit-btn');
        const resetBtn = document.getElementById('reset-btn');
        const pauseBtn = document.getElementById('pause-btn');

        function startTimer() {
            if (!timerEl) return;
            timer = setInterval(() => {
                if (!timerRunning) return;
                seconds += 1;
                const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
                const secs = String(seconds % 60).padStart(2, '0');
                timerEl.textContent = `${minutes}:${secs}`;
            }, 1000);
        }

        function closeAllPanels() {
            notesOpen = false;
            settingsOpen = false;
            if (notesPanel) notesPanel.style.display = 'none';
            if (settingsPanel) settingsPanel.style.display = 'none';
            if (overlay) overlay.style.display = 'none';
        }

        window.scrollToElement = function (target) {
            const element = typeof target === 'string'
                ? document.getElementById(target)
                : target instanceof HTMLElement
                ? target
                : null;
            if (!element) return false;
            const pane = element.closest('.pane');
            if (pane && typeof pane.scrollTo === 'function') {
                const offsetTop = element.offsetTop - 20;
                pane.scrollTo({ top: offsetTop < 0 ? 0 : offsetTop, behavior: 'smooth' });
            } else if (typeof element.scrollIntoView === 'function') {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            if (typeof element.focus === 'function') {
                try {
                    element.focus({ preventScroll: true });
                } catch (_) {
                    element.focus();
                }
            }
            return true;
        };

        function positionSelbarForRect(rect) {
            if (!selbar) return;
            selbar.style.display = 'flex';
            requestAnimationFrame(() => {
                const top = window.scrollY + rect.top - selbar.offsetHeight - 8;
                const left = window.scrollX + rect.left + rect.width / 2 - selbar.offsetWidth / 2;
                selbar.style.top = `${top > 0 ? top : (window.scrollY + rect.bottom + 8)}px`;
                selbar.style.left = `${Math.max(8, left)}px`;
            });
        }

        function updateSelbar() {
            if (!selbar) return;
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
                if (!keepToolbar && !currentHlNode) {
                    selbar.style.display = 'none';
                    currentHlNode = null;
                }
                return;
            }
            const range = sel.getRangeAt(0);
            let container = range.commonAncestorContainer;
            if (container.nodeType === Node.TEXT_NODE) {
                container = container.parentElement;
            }

            const leftPane = document.getElementById('left');
            const rightPane = document.getElementById('right');
            const isInAllowedPane =
                (leftPane && leftPane.contains(container)) ||
                (rightPane && rightPane.contains(container));
            const isHighlighted =
                container.classList?.contains('hl') || !!container.closest('.hl');

            if (!isInAllowedPane && !isHighlighted) {
                selbar.style.display = 'none';
                return;
            }

            lastRange = range.cloneRange();
            currentHlNode = isHighlighted ? container.closest('.hl') : null;
            positionSelbarForRect(range.getBoundingClientRect());
        }

        function doHighlight() {
            if (!selbar || currentHlNode || !lastRange || lastRange.collapsed) return;
            const sel = window.getSelection();
            try {
                const span = document.createElement('span');
                span.className = 'hl';
                lastRange.surroundContents(span);
            } catch (error) {
                console.error('[PracticePageUI] Highlighting failed:', error);
            }
            sel?.removeAllRanges();
            selbar.style.display = 'none';
        }

        function removeHighlight() {
            const sel = window.getSelection();
            let targetNode = currentHlNode;
            if (!targetNode && lastRange) {
                const ancestor = lastRange.commonAncestorContainer;
                targetNode =
                    ancestor.nodeType === Node.TEXT_NODE
                        ? ancestor.parentElement?.closest('.hl')
                        : ancestor.closest('.hl');
            }
            if (targetNode && targetNode.parentNode) {
                const parent = targetNode.parentNode;
                while (targetNode.firstChild) {
                    parent.insertBefore(targetNode.firstChild, targetNode);
                }
                parent.removeChild(targetNode);
                parent.normalize();
            }
            currentHlNode = null;
            sel?.removeAllRanges();
            if (selbar) selbar.style.display = 'none';
        }

        // --- Header buttons ---
        if (timerEl) startTimer();

        const sizeBtn = document.getElementById('size-btn');
        const colorBtn = document.getElementById('color-btn');
        const noteBtn = document.getElementById('note-btn');
        const closeNoteBtn = document.getElementById('close-note');

        if (sizeBtn && settingsPanel) {
            sizeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                settingsOpen = !settingsOpen;
                settingsPanel.style.display = settingsOpen ? 'block' : 'none';
            });
        }

        if (colorBtn && settingsPanel) {
            colorBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                settingsOpen = !settingsOpen;
                settingsPanel.style.display = settingsOpen ? 'block' : 'none';
            });
        }

        if (noteBtn && notesPanel && overlay) {
            noteBtn.addEventListener('click', () => {
                closeAllPanels();
                notesOpen = true;
                notesPanel.style.display = 'flex';
                overlay.style.display = 'block';
            });
        }

        document
            .querySelectorAll('.settings-option[data-size]')
            .forEach((btn) => {
                btn.addEventListener('click', function () {
                    document.documentElement.className = `font-${this.dataset.size}`;
                    document
                        .querySelectorAll('.settings-option[data-size]')
                        .forEach((b) => b.classList.remove('active'));
                    this.classList.add('active');
                });
            });

        document
            .querySelectorAll('.settings-option[data-mode]')
            .forEach((btn) => {
                btn.addEventListener('click', function () {
                    document.body.classList.toggle('dark-mode', this.dataset.mode === 'dark');
                    document
                        .querySelectorAll('.settings-option[data-mode]')
                        .forEach((b) => b.classList.remove('active'));
                    this.classList.add('active');
                });
            });

        if (closeNoteBtn) closeNoteBtn.addEventListener('click', closeAllPanels);
        if (overlay) overlay.addEventListener('click', closeAllPanels);

        document.addEventListener('click', (e) => {
            if (!settingsPanel || !headerControls) return;
            if (!settingsPanel.contains(e.target) && !headerControls.contains(e.target)) {
                settingsPanel.style.display = 'none';
                settingsOpen = false;
            }
        });

        // --- Pane resizing ---
        const divider = document.getElementById('divider');
        const leftPane = document.getElementById('left');
        if (divider && leftPane) {
            divider.addEventListener('mousedown', (e) => {
                isResizing = true;
                document.body.style.cursor = 'ew-resize';
                e.preventDefault();
            });
            document.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                const shell = document.querySelector('.shell');
                if (!shell) return;
                const rect = shell.getBoundingClientRect();
                const leftWidth = ((e.clientX - rect.left) / rect.width) * 100;
                leftPane.style.width = `${Math.max(20, Math.min(80, leftWidth))}%`;
            });
            document.addEventListener('mouseup', () => {
                if (isResizing) {
                    isResizing = false;
                    document.body.style.cursor = '';
                }
            });
        }

        // --- Selection toolbar events ---
        document.addEventListener('mouseup', () => setTimeout(updateSelbar, 10));
        document.addEventListener('selectionchange', () => setTimeout(updateSelbar, 10));
        document.addEventListener(
            'mousedown',
            (e) => {
                keepToolbar = !!e.target.closest('#selbar, .hl');
            },
            true
        );

        if (selbar) {
            document.addEventListener(
                'click',
                (e) => {
                    const target = e.target;
                    if (target instanceof HTMLElement && target.classList.contains('hl')) {
                        currentHlNode = target;
                        lastRange = null;
                        positionSelbarForRect(target.getBoundingClientRect());
                        window.getSelection()?.removeAllRanges();
                        setTimeout(() => {
                            keepToolbar = false;
                        }, 0);
                    } else if (!selbar.contains(e.target)) {
                        selbar.style.display = 'none';
                        currentHlNode = null;
                    }
                },
                true
            );
        }

        const btnHighlight = document.getElementById('btnHL');
        const btnUnhighlight = document.getElementById('btnUH');
        const btnNote = document.getElementById('btnNote');

        if (btnHighlight) btnHighlight.addEventListener('click', doHighlight);
        if (btnUnhighlight) btnUnhighlight.addEventListener('click', removeHighlight);
        if (btnNote && notesPanel && overlay) {
            btnNote.addEventListener('click', function () {
                const text = (
                    currentHlNode
                        ? currentHlNode.textContent
                        : lastRange
                        ? lastRange.cloneContents().textContent
                        : ''
                ).trim();
                if (text) {
                    const noteArea = notesPanel.querySelector('textarea');
                    if (noteArea) {
                        noteArea.value += (noteArea.value ? '\n\n' : '') + '> ' + text;
                        closeAllPanels();
                        notesOpen = true;
                        notesPanel.style.display = 'flex';
                        overlay.style.display = 'block';
                        noteArea.scrollTop = noteArea.scrollHeight;
                    }
                }
                if (selbar) selbar.style.display = 'none';
            });
        }

        function ensurePoolIds() {
            document.querySelectorAll('.pool-items').forEach((pool, index) => {
                if (!pool.id) {
                    pool.id = `practice-pool-${index}`;
                }
            });

            document.querySelectorAll('.pool-items .drag-item').forEach((item) => {
                if (!item.dataset.originPool) {
                    const pool = item.closest('.pool-items');
                    if (pool?.id) {
                        item.dataset.originPool = pool.id;
                    }
                }
            });
        }

        ensurePoolIds();

        function focusQuestionById(questionId) {
            const normalized = normalizeQuestionId(questionId) || questionId;
            if (!normalized) return false;
            const elements = findAnswerElements(normalized, true);
            if (elements.length) {
                const focusTarget =
                    elements.find((element) =>
                        element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT'
                    ) || elements[0];
                if (focusTarget) {
                    if (!window.scrollToElement(focusTarget)) {
                        focusTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                    if (typeof focusTarget.focus === 'function') {
                        try {
                            focusTarget.focus({ preventScroll: true });
                        } catch (_) {
                            focusTarget.focus();
                        }
                    }
                    return true;
                }
            }
            const anchor =
                document.getElementById(`${normalized}-anchor`) ||
                document.getElementById(normalized);
            if (anchor) {
                window.scrollToElement(anchor);
                return true;
            }
            return false;
        }

        const navContainer = document.querySelector('.practice-nav');
        if (navContainer) {
            navContainer.addEventListener('click', (event) => {
                const item = event.target.closest('.q-item');
                if (!item) {
                    return;
                }
                const explicitTarget = item.dataset.target || item.getAttribute('data-scroll-target');
                if (explicitTarget && window.scrollToElement(explicitTarget)) {
                    event.preventDefault();
                    return;
                }
                const match = item.id && item.id.match(/^q(\d+)-nav$/i);
                const fallback =
                    item.dataset.question ||
                    item.dataset.questionId ||
                    (match ? `q${match[1]}` : item.textContent?.trim());
                if (fallback && focusQuestionById(fallback)) {
                    event.preventDefault();
                    return;
                }
                if (fallback && window.scrollToElement(`${fallback}-anchor`)) {
                    event.preventDefault();
                }
            });
        }

        function disableAnswerInputs() {
            const root = document.getElementById('questions-container') || document;
            root.querySelectorAll('input, textarea, select').forEach((element) => {
                if (!element || ['button', 'submit', 'reset'].includes((element.type || '').toLowerCase())) {
                    return;
                }
                if (element.disabled) {
                    return;
                }
                element.disabled = true;
                element.dataset.practiceLocked = 'true';
            });
            document.querySelectorAll('.drag-item, .drag-item-clone').forEach((item) => {
                item.setAttribute('draggable', 'false');
                item.classList.add('drag-item-locked');
            });
        }

        function lockPracticeAfterSubmit() {
            if (submissionLocked) {
                return;
            }
            submissionLocked = true;
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            timerRunning = false;
            const audio = document.getElementById('listening-audio');
            if (audio) {
                try {
                    audio.pause();
                } catch (_) {}
                const playPauseBtn = document.getElementById('play-pause-btn');
                if (playPauseBtn) {
                    playPauseBtn.innerHTML = '&#9658;';
                    playPauseBtn.disabled = true;
                }
            }
            if (submitBtn) {
                submitBtn.disabled = true;
            }
            if (resetBtn) {
                resetBtn.disabled = true;
            }
            disableAnswerInputs();
        }

        function returnItemToPool(item) {
            if (!item) return;
            const originId = item.dataset.originPool;
            let pool = originId ? document.getElementById(originId) : null;
            if (!pool) {
                pool = document.querySelector('.pool-items');
            }
            if (!pool) return;
            item.classList.remove('dragging');
            pool.appendChild(item);
        }

        function clearDropzone(zone, exceptItem) {
            if (!zone) return;
            const existingItems = zone.querySelectorAll('.drag-item');
            existingItems.forEach((existing) => {
                if (exceptItem && existing === exceptItem) return;
                returnItemToPool(existing);
            });
        }

        const dragState = {
            item: null
        };

        function handleDragStart(event) {
            const target = event.target.closest('.drag-item');
            if (!target) return;
            dragState.item = target;
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', target.dataset.heading || target.dataset.option || target.textContent || '');
            requestAnimationFrame(() => target.classList.add('dragging'));
        }

        function handleDragEnd() {
            if (dragState.item) {
                dragState.item.classList.remove('dragging');
            }
            dragState.item = null;
        }

        function resolveDropContainer(target) {
            if (!target) return null;
            const paragraphZone = target.closest('.paragraph-dropzone');
            if (paragraphZone) {
                return paragraphZone.querySelector('.dropped-items') || paragraphZone;
            }
            const matchZone = target.closest('.match-dropzone');
            if (matchZone) {
                return matchZone;
            }
            const genericZone = target.closest('.dropzone');
            if (genericZone) {
                return genericZone;
            }
            const pool = target.closest('.pool-items');
            if (pool) {
                return pool;
            }
            return null;
        }

        function moveItemToContainer(item, container) {
            if (!item || !container) return;

            if (container.classList.contains('dropped-items')) {
                clearDropzone(container, item);
            }

            if (container.classList.contains('match-dropzone')) {
                clearDropzone(container, item);
            }

            if (container.classList.contains('pool-items')) {
                item.classList.remove('dragging');
                container.appendChild(item);
                return;
            }

            item.classList.remove('dragging');
            container.appendChild(item);
        }

        function handleDragOver(event) {
            const container = resolveDropContainer(event.target);
            if (!container) return;
            event.preventDefault();
            container.classList.add('drag-over');
        }

        function handleDragLeave(event) {
            const container = resolveDropContainer(event.target);
            if (container) {
                container.classList.remove('drag-over');
            }
        }

        function handleDrop(event) {
            const container = resolveDropContainer(event.target);
            if (!container || !dragState.item) return;
            event.preventDefault();
            const previousContainer = dragState.item.parentElement;
            container.classList.remove('drag-over');
            moveItemToContainer(dragState.item, container);
            dragState.item = null;
            if (previousContainer) {
                handleAnswerInteraction(previousContainer);
            }
            handleAnswerInteraction(container);
        }

        document.addEventListener('dragstart', handleDragStart);
        document.addEventListener('dragend', handleDragEnd);
        document.addEventListener('dragover', handleDragOver);
        document.addEventListener('dragleave', handleDragLeave);
        document.addEventListener('drop', handleDrop);

        function resetPracticePage() {
            if (submissionLocked) {
                return;
            }
            // 清空输入
            document.querySelectorAll('input').forEach((input) => {
                if (input.type === 'radio' || input.type === 'checkbox') {
                    input.checked = false;
                } else if (input.type !== 'button' && input.type !== 'submit' && input.type !== 'reset') {
                    input.value = '';
                }
            });
            document.querySelectorAll('textarea').forEach((textarea) => {
                textarea.value = '';
            });
            document.querySelectorAll('select').forEach((select) => {
                select.selectedIndex = 0;
            });

            // 移除高亮
            document.querySelectorAll('.hl').forEach((highlight) => {
                const parent = highlight.parentNode;
                if (!parent) return;
                while (highlight.firstChild) {
                    parent.insertBefore(highlight.firstChild, highlight);
                }
                parent.removeChild(highlight);
                parent.normalize();
            });

            // 清空拖拽题结果
            document.querySelectorAll('.paragraph-dropzone .dropped-items, .match-dropzone, .dropzone').forEach((zone) => {
                clearDropzone(zone);
            });

            // 将所有拖拽选项放回原池
            document.querySelectorAll('.drag-item').forEach((item) => {
                const container = item.parentElement;
                if (container && (container.classList.contains('dropped-items') || container.classList.contains('match-dropzone') || container.classList.contains('dropzone'))) {
                    returnItemToPool(item);
                }
                item.setAttribute('draggable', 'true');
                item.classList.remove('drag-item-locked');
            });

            document.querySelectorAll('.answer-correct, .answer-wrong').forEach((el) => {
                el.classList.remove('answer-correct', 'answer-wrong');
            });
            document.querySelectorAll('.practice-nav .q-item').forEach((item) => {
                item.classList.remove('answered', 'correct', 'incorrect');
            });
            const resultsContainer = document.getElementById('results');
            if (resultsContainer) {
                resultsContainer.innerHTML = '';
                resultsContainer.style.display = '';
            }

            // 重新开始计时器
            timerRunning = true;
            seconds = 0;
            if (timerEl) {
                timerEl.textContent = '00:00';
            }
            const pauseBtn = document.getElementById('pause-btn');
            if (pauseBtn) {
                pauseBtn.textContent = 'Pause';
            }
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', resetPracticePage);
        }

        if (submitBtn) {
            submitBtn.addEventListener('click', () => {
                lockPracticeAfterSubmit();
            });
        }

        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => {
                timerRunning = !timerRunning;
                pauseBtn.textContent = timerRunning ? 'Pause' : 'Resume';
            });
        }

        document.addEventListener('change', (event) => {
            if (!(event.target instanceof HTMLElement)) {
                return;
            }
            handleAnswerInteraction(event.target);
        }, true);

        document.addEventListener('input', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                handleAnswerInteraction(target);
            }
        }, true);

        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }
            if (target.matches('input[type="radio"], input[type="checkbox"]')) {
                handleAnswerInteraction(target);
            }
        }, true);

        document.addEventListener('practiceResultsReady', (event) => {
            const detail = event && event.detail ? event.detail : {};
            const status = detail.status || 'final';
            if (status !== 'final' && status !== 'update') {
                showResultsPending();
                return;
            }
            handleResultsReady(detail);
            revealTranscriptPane();
            lockPracticeAfterSubmit();
        });

        setupAudioPlayer();
        initializeTranscriptPane();
    });

let practiceUIStylesInjected = false;
let transcriptState = null;
const NO_ANSWER_PLACEHOLDER = '-';
let pendingResultsTimeout = null;

    function injectPracticeUIStyles() {
        if (practiceUIStylesInjected) return;
        practiceUIStylesInjected = true;
        const style = document.createElement('style');
        style.textContent = `
.practice-nav .q-item {
    transition: background-color 0.2s ease, color 0.2s ease;
}
.practice-nav .q-item.answered {
    background-color: #dbeafe;
    color: #1e3a8a;
}
.practice-nav .q-item.correct {
    background-color: #bbf7d0;
    color: #166534;
}
.practice-nav .q-item.incorrect {
    background-color: #fecaca;
    color: #7f1d1d;
}
.answer-correct {
    background-color: #ecfccb !important;
    border-color: #65a30d !important;
}
.answer-wrong {
    background-color: #fee2e2 !important;
    border-color: #dc2626 !important;
}
.practice-results-summary {
    border-top: 1px solid #e5e7eb;
    margin-top: 24px;
    padding-top: 16px;
}
.practice-results-summary table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
}
.practice-results-summary th,
.practice-results-summary td {
    border: 1px solid #e5e7eb;
    padding: 8px;
    text-align: left;
}
.practice-results-summary tr.correct {
    background-color: #f0fdf4;
}
.practice-results-summary tr.incorrect {
    background-color: #fef2f2;
}
.practice-results-pending {
    opacity: 0.85;
}
.practice-results-loading {
    margin: 12px 0;
    color: #6b7280;
    font-size: 0.95rem;
}
.drag-item-locked {
    opacity: 0.55;
    pointer-events: none;
}
`;
        document.head.appendChild(style);
    }

    function normalizeQuestionId(questionId) {
        if (questionId === undefined || questionId === null) return null;
        const raw = String(questionId).trim();
        if (!raw) return null;
        const cleaned = raw.replace(/[-_](anchor|nav)$/i, '');
        if (/^q[\w-]+/i.test(cleaned)) return cleaned.replace(/^Q/, 'q');
        const numeric = cleaned.match(/^\d+/);
        if (numeric) return 'q' + numeric[0];
        const questionMatch = cleaned.match(/^question[-_\s]*(\d+)/i);
        if (questionMatch) return 'q' + questionMatch[1];
        return cleaned;
    }

    function deriveQuestionId(element) {
        if (!element) return null;
        const dataset = element.dataset || {};
        const candidates = [
            element.name,
            dataset.question,
            dataset.questionId,
            dataset.for,
            element.id ? element.id.replace(/(_input|-input|_answer)$/i, '') : null
        ];
        for (let i = 0; i < candidates.length; i++) {
            const normalized = normalizeQuestionId(candidates[i]);
            if (normalized) return normalized;
        }
        let parent = element.parentElement;
        while (parent && parent !== document.body) {
            const parentId = normalizeQuestionId(parent.dataset?.question || parent.id);
            if (parentId) return parentId;
            parent = parent.parentElement;
        }
        return null;
    }

    function findNavItem(questionId) {
        const normalized = normalizeQuestionId(questionId);
        if (!normalized) return null;
        const key = normalized.toLowerCase();
        const candidates = [
            document.getElementById(`${key}-nav`),
            document.querySelector(`.practice-nav .q-item[data-question="${key}"]`),
            document.querySelector(`.practice-nav .q-item[data-question-id="${key}"]`)
        ];
        for (let i = 0; i < candidates.length; i++) {
            if (candidates[i]) return candidates[i];
        }
        return null;
    }

    function setNavStatus(questionId, status) {
        const item = findNavItem(questionId);
        if (!item) return;
        item.classList.remove('answered', 'correct', 'incorrect');
        if (!status) return;
        if (status === 'answered') {
            item.classList.add('answered');
        } else if (status === 'correct') {
            item.classList.add('answered', 'correct');
        } else if (status === 'incorrect') {
            item.classList.add('answered', 'incorrect');
        }
    }

    function handleAnswerInteraction(element) {
        const questionId = deriveQuestionId(element);
        if (!questionId) return;
        const hasValue = questionHasValue(questionId);
        setNavStatus(questionId, hasValue ? 'answered' : null);
    }

    function findAnswerElements(questionId, includeDropZones = false) {
        const normalized = normalizeQuestionId(questionId);
        if (!normalized) return [];
        const matches = [];
        document.querySelectorAll('input, textarea, select').forEach((element) => {
            const derived = deriveQuestionId(element);
            if (derived && derived.toLowerCase() === normalized.toLowerCase()) {
                matches.push(element);
            }
        });
        if (includeDropZones) {
            const candidateSelectors = [
                `.match-dropzone[data-question="${normalized}"]`,
                `.match-dropzone[data-question-id="${normalized}"]`,
                `.dropzone[data-question="${normalized}"]`,
                `.dropzone[data-target="${normalized}"]`,
                `.paragraph-dropzone[data-question="${normalized}"]`,
                `[data-question="${normalized}"] .dropped-items`,
                `#${normalized}-anchor .dropped-items`,
                `#${normalized} .dropped-items`
            ];
            candidateSelectors.forEach((selector) => {
                document.querySelectorAll(selector).forEach((el) => matches.push(el));
            });
        }
        return Array.from(new Set(matches));
    }

    function questionHasValue(questionId) {
        const elements = findAnswerElements(questionId, true);
        return elements.some((element) => {
            if (!element) return false;
            if (element.matches('input[type="radio"]')) {
                const name = element.name;
                if (name) {
                    return Array.from(document.querySelectorAll(`input[type="radio"][name="${name}"]`)).some(
                        (item) => item.checked
                    );
                }
                return element.checked;
            }
            if (element.matches('input[type="checkbox"]')) {
                const name = element.name;
                if (name) {
                    return Array.from(document.querySelectorAll(`input[type="checkbox"][name="${name}"]`)).some(
                        (item) => item.checked
                    );
                }
                return element.checked;
            }
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                return String(element.value || '').trim() !== '';
            }
            if (element.tagName === 'SELECT') {
                if (element.multiple) {
                    return Array.from(element.selectedOptions || []).length > 0;
                }
                return String(element.value || '').trim() !== '';
            }
            if (
                element.classList.contains('match-dropzone') ||
                element.classList.contains('dropzone') ||
                element.classList.contains('paragraph-dropzone') ||
                element.classList.contains('dropped-items')
            ) {
                return !!element.querySelector('.drag-item, .drag-item-clone');
            }
            return false;
        });
    }

    function highlightAnswerFields(questionId, state) {
        const elements = findAnswerElements(questionId, true);
        const className = state === null ? null : state ? 'answer-correct' : 'answer-wrong';
        elements.forEach((element) => {
            element.classList.remove('answer-correct', 'answer-wrong');
            if (className) {
                element.classList.add(className);
            }
        });
    }

    function compareAnswerValues(a, b) {
        if (a === undefined || a === null || b === undefined || b === null) {
            return false;
        }
        const normalize = (value) => String(value).trim().toLowerCase();
        return normalize(a) === normalize(b);
    }

    function formatAnswerValue(value) {
        if (value === undefined || value === null) {
            return NO_ANSWER_PLACEHOLDER;
        }
        if (Array.isArray(value)) {
            const formatted = value
                .map((item) => formatAnswerValue(item))
                .filter((text) => text && text !== NO_ANSWER_PLACEHOLDER);
            return formatted.length ? formatted.join(', ') : NO_ANSWER_PLACEHOLDER;
        }
        if (typeof value === 'object') {
            try {
                const serialized = JSON.stringify(value);
                return serialized === '{}' || serialized === '[]'
                    ? NO_ANSWER_PLACEHOLDER
                    : serialized;
            } catch (_) {
                return NO_ANSWER_PLACEHOLDER;
            }
        }
        const text = String(value).trim();
        if (!text || /^no answer$/i.test(text)) {
            return NO_ANSWER_PLACEHOLDER;
        }
        return text;
    }

    function pickValueFromStore(store, normalizedKey, fallbackKey) {
        if (!store) {
            return undefined;
        }
        if (Object.prototype.hasOwnProperty.call(store, normalizedKey)) {
            return store[normalizedKey];
        }
        if (fallbackKey && Object.prototype.hasOwnProperty.call(store, fallbackKey)) {
            return store[fallbackKey];
        }
        return undefined;
    }

    function resolveQuestionOrder(results) {
        const answers = results.answers || {};
        const correctAnswers = results.correctAnswers || {};
        const comparison = results.answerComparison || {};
        const fallbackSet = new Set();
        const collectKeys = (source) => {
            Object.keys(source || {}).forEach((key) => {
                const normalized = normalizeQuestionId(key) || key;
                if (normalized) {
                    fallbackSet.add(normalized);
                }
            });
        };
        collectKeys(answers);
        collectKeys(correctAnswers);
        collectKeys(comparison);
        const fallbackKeys = Array.from(fallbackSet)
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        if (Array.isArray(results.allQuestionIds) && results.allQuestionIds.length) {
            const ordered = [];
            const seen = new Set();
            results.allQuestionIds.forEach((rawKey) => {
                const normalized = normalizeQuestionId(rawKey) || rawKey;
                if (normalized && !seen.has(normalized)) {
                    seen.add(normalized);
                    ordered.push(normalized);
                }
            });
            fallbackKeys.forEach((key) => {
                if (!seen.has(key)) {
                    seen.add(key);
                    ordered.push(key);
                }
            });
            return ordered;
        }

        return fallbackKeys;
    }

    function formatQuestionLabel(questionId) {
        if (!questionId) {
            return '';
        }
        const normalized = normalizeQuestionId(questionId) || questionId;
        const trimmed = normalized.replace(/^q/i, '');
        const numericMatch = trimmed.match(/\d+/);
        return numericMatch ? numericMatch[0] : trimmed || normalized;
    }

    function showResultsPending() {
        const container = document.getElementById('results');
        if (!container) return;
        container.style.display = 'block';
        container.classList.add('practice-results-visible', 'practice-results-pending');
        container.innerHTML = '<p class="practice-results-loading">正在收集中，请稍候...</p>';
        if (pendingResultsTimeout) {
            clearTimeout(pendingResultsTimeout);
        }
        pendingResultsTimeout = setTimeout(() => {
            container.classList.remove('practice-results-pending');
            pendingResultsTimeout = null;
        }, 3000);
    }

    function renderResultsSummary(results) {
        const container = document.getElementById('results');
        if (!container) return;
        container.style.display = 'block';
        container.classList.add('practice-results-visible');
        container.classList.remove('practice-results-pending');
        if (pendingResultsTimeout) {
            clearTimeout(pendingResultsTimeout);
            pendingResultsTimeout = null;
        }
        const comparison = results.answerComparison || {};
        const answers = results.answers || {};
        const correctAnswers = results.correctAnswers || {};
        const orderedKeys = resolveQuestionOrder(results);

        container.innerHTML = '';
        if (!orderedKeys.length) {
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'practice-results-summary';

        const heading = document.createElement('h4');
        heading.textContent = 'Answer Summary';
        wrapper.appendChild(heading);

        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Question', 'Your Answer', 'Correct Answer', 'Result'].forEach((label) => {
            const th = document.createElement('th');
            th.textContent = label;
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        orderedKeys.forEach((key) => {
            const normalized = normalizeQuestionId(key) || key;
            const entry = comparison[normalized] || comparison[key] || {};
            const userAnswerRaw = entry.hasOwnProperty('userAnswer')
                ? entry.userAnswer
                : pickValueFromStore(answers, normalized, key);
            const correctAnswerRaw = entry.hasOwnProperty('correctAnswer')
                ? entry.correctAnswer
                : pickValueFromStore(correctAnswers, normalized, key);
            const userAnswer = formatAnswerValue(userAnswerRaw);
            const correctAnswer = formatAnswerValue(correctAnswerRaw);
            const hasUserAnswer = userAnswer !== NO_ANSWER_PLACEHOLDER;

            let isCorrect = null;
            if (entry.hasOwnProperty('isCorrect')) {
                isCorrect = entry.isCorrect;
            } else if (hasUserAnswer && correctAnswerRaw !== undefined && correctAnswerRaw !== null) {
                isCorrect = compareAnswerValues(userAnswerRaw, correctAnswerRaw);
            }

            const row = document.createElement('tr');
            if (isCorrect === true) {
                row.className = 'correct';
            } else if (isCorrect === false) {
                row.className = 'incorrect';
            }

            const resultText = isCorrect === null
                ? '–'
                : (isCorrect ? '✅' : '❌');

            const columns = [
                formatQuestionLabel(normalized),
                userAnswer,
                correctAnswer,
                resultText
            ];
            columns.forEach((text) => {
                const td = document.createElement('td');
                td.textContent = text;
                row.appendChild(td);
            });
            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        wrapper.appendChild(table);
        container.appendChild(wrapper);
    }

    function handleResultsReady(results) {
        renderResultsSummary(results);
        const comparison = results.answerComparison || {};
        const answers = results.answers || {};
        const correctAnswers = results.correctAnswers || {};
        const orderedKeys = resolveQuestionOrder(results);

        orderedKeys.forEach((key) => {
            const normalized = normalizeQuestionId(key);
            if (!normalized) return;
            const entry = comparison[normalized] || comparison[key] || {};
            const userAnswer = entry.hasOwnProperty('userAnswer')
                ? entry.userAnswer
                : pickValueFromStore(answers, normalized, key);
            const hasAnswer =
                userAnswer !== undefined &&
                userAnswer !== null &&
                String(userAnswer).trim() !== '' &&
                !/^no answer$/i.test(String(userAnswer).trim());
            const correctAnswer = entry.hasOwnProperty('correctAnswer')
                ? entry.correctAnswer
                : pickValueFromStore(correctAnswers, normalized, key);
            let isCorrect = null;
            if (entry.hasOwnProperty('isCorrect')) {
                isCorrect = entry.isCorrect;
            } else if (hasAnswer && correctAnswer !== undefined && correctAnswer !== null) {
                isCorrect = compareAnswerValues(userAnswer, correctAnswer);
            }

            if (isCorrect === null) {
                setNavStatus(normalized, hasAnswer ? 'answered' : null);
                highlightAnswerFields(normalized, null);
            } else if (isCorrect) {
                setNavStatus(normalized, 'correct');
                highlightAnswerFields(normalized, true);
            } else {
                setNavStatus(normalized, 'incorrect');
                highlightAnswerFields(normalized, false);
            }
        });
    }

    function setupAudioPlayer() {
        const audio = document.getElementById('listening-audio');
        const playPauseBtn = document.getElementById('play-pause-btn');
        const progressContainer = document.getElementById('progress-container');
        const progressBar = document.getElementById('progress-bar');
        const timeDisplay = document.getElementById('time-display');
        const volumeSlider = document.getElementById('volume-slider');
        const speedSelect = document.getElementById('playback-speed');

        if (!audio || !playPauseBtn || !progressContainer || !progressBar || !timeDisplay) {
            return;
        }

        let isScrubbing = false;

        function formatTime(time) {
            if (!Number.isFinite(time) || time < 0) {
                return '00:00';
            }
            const minutes = Math.floor(time / 60);
            const seconds = Math.floor(time % 60);
            return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }

        function updateProgress() {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
                timeDisplay.textContent = `${formatTime(audio.currentTime)} / 00:00`;
                return;
            }
            const percentage = (audio.currentTime / audio.duration) * 100;
            progressBar.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
            timeDisplay.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
        }

        function scrub(clientX) {
            const rect = progressContainer.getBoundingClientRect();
            if (!rect.width) return;
            const position = Math.min(Math.max(0, clientX - rect.left), rect.width);
            const percent = position / rect.width;
            if (Number.isFinite(audio.duration) && audio.duration > 0) {
                audio.currentTime = percent * audio.duration;
            }
            progressBar.style.width = `${percent * 100}%`;
        }

        playPauseBtn.addEventListener('click', () => {
            if (audio.paused) {
                audio.play().then(() => {
                    playPauseBtn.innerHTML = '&#10074;&#10074;';
                }).catch((error) => {
                    console.warn('[PracticePageUI] 无法播放音频:', error);
                });
            } else {
                audio.pause();
                playPauseBtn.innerHTML = '&#9658;';
            }
        });

        audio.addEventListener('timeupdate', updateProgress);
        audio.addEventListener('loadedmetadata', updateProgress);

        progressContainer.addEventListener('mousedown', (event) => {
            isScrubbing = true;
            scrub(event.clientX);
        });

        document.addEventListener('mousemove', (event) => {
            if (isScrubbing) {
                event.preventDefault();
                scrub(event.clientX);
            }
        });

        document.addEventListener('mouseup', () => {
            isScrubbing = false;
        });

        if (volumeSlider) {
            volumeSlider.addEventListener('input', (event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) {
                    audio.volume = Math.min(1, Math.max(0, value));
                }
            });
        }

        if (speedSelect) {
            speedSelect.addEventListener('change', (event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value > 0) {
                    audio.playbackRate = value;
                }
            });
        }
    }

    function getTranscriptElements() {
        return {
            shell: document.querySelector('.shell'),
            rightPane: document.getElementById('right'),
            transcript: document.getElementById('transcript-content')
        };
    }

    function initializeTranscriptPane() {
        const { shell, rightPane, transcript } = getTranscriptElements();
        if (!shell || !rightPane || !transcript) {
            transcriptState = 'missing';
            return;
        }

        if (!rightPane.dataset.originalDisplay) {
            rightPane.dataset.originalDisplay = window.getComputedStyle(rightPane).display || '';
        }

        const bodyMode =
            document.body && document.body.dataset ? document.body.dataset.transcriptMode : undefined;
        const transcriptMode =
            transcript.dataset.transcriptMode ||
            rightPane.dataset.transcriptMode ||
            bodyMode ||
            'auto';
        const hasAudio = !!document.getElementById('listening-audio');
        const originallyHidden = (rightPane.dataset.originalDisplay || '').includes('none');
        const shouldDelay = transcriptMode !== 'always' && hasAudio && originallyHidden;

        if (shouldDelay) {
            transcriptState = 'hidden';
            shell.classList.remove('split');
            rightPane.style.display = 'none';
            return;
        }

        shell.classList.add('split');
        rightPane.style.display =
            rightPane.dataset.originalDisplay && rightPane.dataset.originalDisplay !== 'none'
                ? rightPane.dataset.originalDisplay
                : 'block';
        transcriptState = 'visible';
    }

    function revealTranscriptPane() {
        if (transcriptState !== 'hidden') {
            return;
        }
        const { shell, rightPane, transcript } = getTranscriptElements();
        if (!shell || !rightPane || !transcript) {
            return;
        }
        shell.classList.add('split');
        rightPane.style.display =
            rightPane.dataset.originalDisplay && rightPane.dataset.originalDisplay !== 'none'
                ? rightPane.dataset.originalDisplay
                : 'block';
        transcriptState = 'visible';
    }
})();
