(function (global) {
    'use strict';

    let selection = { learningState: 'all', favoritesOnly: false };
    let favorites = new Set();
    let readyPromise = null;
    let selectionRevision = 0;
    let bound = false;
    const labels = { all: '全部状态', unattempted: '未完成', completed: '已完成', wrong: '需复习' };
    const byId = (id) => document.getElementById(id);

    function readFavorites(preferences) {
        return new Set(Object.entries(preferences && preferences.readingFavorites || {})
            .filter(([, value]) => value === true).map(([key]) => key));
    }

    function ready() {
        if (!readyPromise) {
            readyPromise = global.AppData.preferences.getBrowse().then((preferences) => {
                favorites = readFavorites(preferences);
                if (selectionRevision === 0) {
                    selection = global.BrowseLearningState.normalizeSelection(preferences);
                }
            }).catch((error) => {
                readyPromise = null;
                console.warn('[Browse] Learning preferences could not be read; keeping current controls:', error);
            });
        }
        return readyPromise;
    }

    function sync() {
        const panel = byId('browse-learning-panel');
        const trigger = byId('browse-learning-trigger');
        if (!panel || !trigger) return;
        panel.querySelectorAll('[name="browse-learning-state"]').forEach((input) => {
            input.checked = input.value === selection.learningState;
        });
        byId('browse-favorites-only').checked = selection.favoritesOnly;
        const active = selection.learningState !== 'all' || selection.favoritesOnly;
        const text = [selection.learningState !== 'all' ? labels[selection.learningState] : '',
            selection.favoritesOnly ? '收藏' : ''].filter(Boolean).join(' · ');
        trigger.classList.toggle('active', active);
        byId('browse-learning-label').textContent = active ? text : '筛选';
        trigger.setAttribute('aria-label', active ? `阅读筛选：${text}` : '阅读筛选');
    }

    function close(restoreFocus = false) {
        const panel = byId('browse-learning-panel');
        const trigger = byId('browse-learning-trigger');
        if (!panel || !trigger) return;
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        if (restoreFocus) trigger.focus();
    }

    function refresh() {
        return global.__renderBrowseResultsForState(null, null, { foreground: true });
    }

    function report(error) {
        console.warn('[Browse] Learning preferences could not be saved:', error);
        if (global.showMessage) global.showMessage('筛选或收藏未能保存，请重试。', 'error');
    }

    function resetSelection() {
        selectionRevision += 1;
        selection = { learningState: 'all', favoritesOnly: false };
        sync();
    }

    function setup() {
        sync();
        const panel = byId('browse-learning-panel');
        const trigger = byId('browse-learning-trigger');
        if (bound || !panel || !trigger) return;
        bound = true;
        trigger.addEventListener('click', () => {
            if (!panel.hidden) return close();
            panel.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
            panel.querySelector('input:checked').focus();
        });
        panel.addEventListener('change', () => {
            selectionRevision += 1;
            selection = global.BrowseLearningState.normalizeSelection({
                learningState: panel.querySelector('[name="browse-learning-state"]:checked').value,
                favoritesOnly: byId('browse-favorites-only').checked
            });
            sync();
            global.AppData.preferences.patchBrowse(selection).catch(report);
            refresh().catch(report);
        });
        byId('browse-learning-reset').addEventListener('click', () => {
            close(true);
            global.resetBrowseViewToAll().catch(report);
        });
        const wrapper = byId('browse-learning-controls');
        wrapper.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !panel.hidden) {
                event.preventDefault();
                event.stopPropagation();
                close(true);
            }
        });
        document.addEventListener('click', (event) => {
            if (!wrapper.contains(event.target)) close();
        });
        wrapper.addEventListener('focusout', (event) => {
            if (event.relatedTarget && !wrapper.contains(event.relatedTarget)) close();
        });
    }

    function decorateCard(exam, title) {
        if (!exam || exam.type !== 'reading') return;
        const key = global.BrowseLearningState.identity(exam, true);
        if (!key) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'browse-favorite-button';
        button.dataset.browseFavorite = key;
        const selected = favorites.has(key);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        button.setAttribute('aria-label', `${selected ? '取消收藏' : '收藏'}《${exam.title || exam.id}》`);
        button.title = selected ? '取消收藏' : '收藏';
        button.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"'
            + ' stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"'
            + ' fill="' + (selected ? 'currentColor' : 'none') + '">'
            + '<path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3L12 17.3l-5.6 3 1.1-6.3L3 9.6l6.2-.9Z"/></svg>';
        button.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        });
        button.addEventListener('click', async (event) => {
            event.stopPropagation();
            if (button.disabled) return;
            button.disabled = true;
            const hadFocus = document.activeElement === button;
            try {
                await ready();
                const receipt = await global.AppData.preferences.setReadingFavorite(key, !favorites.has(key));
                if (!receipt || receipt.committed !== true) throw new Error('Favorite commit was not confirmed');
                favorites = readFavorites(await global.AppData.preferences.getBrowse());
                await refresh();
                if (hadFocus) {
                    const replacement = Array.from(document.querySelectorAll('[data-browse-favorite]'))
                        .find((item) => item.dataset.browseFavorite === key);
                    (replacement || byId('browse-learning-trigger')).focus();
                }
            } catch (error) {
                button.disabled = false;
                report(error);
            }
        });
        title.appendChild(button);
    }

    global.BrowseLearningControls = {
        ready, setup, resetSelection, decorateCard,
        filter(exams) {
            return global.BrowseLearningState.filter(exams, selection, favorites,
                (exam) => global.getBrowseLearningStatus(exam));
        }
    };
})(window);
