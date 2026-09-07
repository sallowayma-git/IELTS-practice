/**
 * 阅读练习复盘流程控制器。
 *
 * 职责边界（刻意划得很窄）：
 *   - 发起一次复盘：为这一轮铸一个唯一 reviewAttemptId，并带着它打开回放窗口；
 *   - 等待宿主收齐全部 REPLAY_APPLIED 回执后，在主页面挂出"待评分条"；
 *   - 用户在主页面选完三档评分，才调用 AppData.practice.recordReviewOutcome。
 *
 * 明确不做的事：
 *   - 不在子窗口里评分（子窗口能被关掉、能加载失败，评分必须发生在可信的主页面）；
 *   - 不把"待评分"持久化。刷新页面即视为本轮未完成，重新进入复盘再来一次即可，
 *     这样"已复盘"永远等价于"用户真的看完并给了反馈"。
 */
(function initPracticeReviewFlow(global) {
    'use strict';

    if (global.PracticeReviewFlow && global.PracticeReviewFlow.__v1 === true) return;

    const BAR_ID = 'practice-review-pending-bar';
    const QUALITY_OPTIONS = Object.freeze([
        { quality: 'hard', label: '仍不熟', title: '明天再复盘一次' },
        { quality: 'good', label: '基本掌握', title: '按计划推进间隔' },
        { quality: 'easy', label: '已掌握', title: '拉长复盘间隔' }
    ]);

    const state = {
        pending: null,
        launching: false,
        submitting: false,
        listeners: []
    };

    function notify(message, type) {
        if (typeof global.showMessage === 'function') {
            global.showMessage(message, type || 'info');
        }
    }

    function emit() {
        const snapshot = getPending();
        state.listeners.slice().forEach((listener) => {
            try { listener(snapshot); } catch (error) { console.warn('[ReviewFlow] 监听器异常:', error); }
        });
    }

    function getPending() {
        return state.pending ? Object.assign({}, state.pending) : null;
    }

    function onChange(listener) {
        if (typeof listener !== 'function') return function noop() {};
        state.listeners.push(listener);
        return function unsubscribe() {
            const index = state.listeners.indexOf(listener);
            if (index >= 0) state.listeners.splice(index, 1);
        };
    }

    function generateAttemptId() {
        const app = global.app;
        if (app && typeof app._generateReviewAttemptId === 'function') {
            return app._generateReviewAttemptId();
        }
        return 'rev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    }

    async function loadFullRecord(recordId) {
        if (!global.AppData || !global.AppData.practice || typeof global.AppData.practice.get !== 'function') {
            throw new Error('数据层不可用');
        }
        // 回放必须 full：缺少 highlights/notes 的投影会让复盘退化成"只看答案"。
        const record = await global.AppData.practice.get(String(recordId), { projection: 'full' });
        if (!record) throw new Error('未找到该练习记录');
        return record;
    }

    async function start(recordId) {
        const id = String(recordId || '').trim();
        if (!id) {
            notify('缺少练习记录标识，无法开始复盘', 'error');
            return null;
        }
        if (state.launching) return null;
        const app = global.app;
        if (!app || typeof app.openPracticeRecordReplay !== 'function') {
            notify('当前版本不支持复盘回放', 'error');
            return null;
        }
        state.launching = true;
        try {
            const reviewState = typeof global.AppData?.practice?.getReviewState === 'function'
                ? await global.AppData.practice.getReviewState(id)
                : null;
            if (!reviewState) {
                notify('该记录未加入复盘计划', 'warning');
                return null;
            }
            const record = await loadFullRecord(id);
            const reviewAttemptId = generateAttemptId();
            // 换一轮 attempt 就作废上一轮尚未评分的待评分条：同一条记录不可能同时
            // 有两轮待评分，否则用户的评分会记到已经作废的那一轮上。
            if (state.pending && String(state.pending.recordId) === id) {
                state.pending = null;
                emit();
            }
            const session = await app.openPracticeRecordReplay(record, { reviewAttemptId });
            return { reviewAttemptId, reviewSessionId: session && session.sessionId ? String(session.sessionId) : '' };
        } catch (error) {
            console.error('[ReviewFlow] 启动复盘失败:', error);
            notify('无法开始复盘：' + ((error && error.message) || '未知错误'), 'error');
            return null;
        } finally {
            state.launching = false;
        }
    }

    function notifyAttemptApplied(info = {}) {
        const recordId = info && info.recordId != null ? String(info.recordId).trim() : '';
        const reviewAttemptId = info && info.reviewAttemptId != null ? String(info.reviewAttemptId).trim() : '';
        if (!recordId || !reviewAttemptId) return false;
        state.pending = {
            recordId,
            reviewAttemptId,
            reviewSessionId: info.reviewSessionId != null ? String(info.reviewSessionId) : '',
            title: info.title != null ? String(info.title) : '',
            entryCount: Number.isFinite(Number(info.entryCount)) ? Number(info.entryCount) : 1,
            appliedAt: new Date().toISOString()
        };
        render();
        emit();
        return true;
    }

    function discard(reason) {
        if (!state.pending) return false;
        state.pending = null;
        render();
        emit();
        if (reason) notify(reason, 'info');
        return true;
    }

    async function submit(quality) {
        const pending = state.pending;
        const normalized = String(quality || '').toLowerCase();
        if (!pending || state.submitting) return null;
        if (!QUALITY_OPTIONS.some((option) => option.quality === normalized)) {
            notify('未知的复盘评分', 'error');
            return null;
        }
        state.submitting = true;
        render();
        try {
            const receipt = await global.AppData.practice.recordReviewOutcome({
                recordId: pending.recordId,
                reviewAttemptId: pending.reviewAttemptId,
                quality: normalized,
                reviewedAt: new Date().toISOString()
            });
            state.pending = null;
            const nextReview = receipt && receipt.reviewState ? receipt.reviewState.nextReview : null;
            notify(nextReview
                ? '已记录复盘，下次复盘：' + new Date(nextReview).toLocaleDateString()
                : '已记录复盘', 'success');
            if (typeof global.refreshPracticeReviewQueue === 'function') {
                global.refreshPracticeReviewQueue('review-outcome', { forceRender: true });
            }
            return receipt;
        } catch (error) {
            console.error('[ReviewFlow] 记录复盘结果失败:', error);
            notify('复盘结果保存失败：' + ((error && error.message) || '未知错误'), 'error');
            return null;
        } finally {
            state.submitting = false;
            render();
            emit();
        }
    }

    function removeBar() {
        const existing = global.document ? global.document.getElementById(BAR_ID) : null;
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }

    function render() {
        if (!global.document || !global.document.body) return;
        if (!state.pending) {
            removeBar();
            return;
        }
        const doc = global.document;
        let bar = doc.getElementById(BAR_ID);
        if (!bar) {
            bar = doc.createElement('div');
            bar.id = BAR_ID;
            bar.className = 'app-global-banner app-global-banner--review';
            bar.setAttribute('role', 'region');
            bar.setAttribute('aria-live', 'polite');
            bar.setAttribute('aria-label', '复盘评分');
            doc.body.appendChild(bar);
            bar.addEventListener('click', (event) => {
                const target = event.target && event.target.closest ? event.target.closest('[data-review-quality]') : null;
                if (target) {
                    event.preventDefault();
                    submit(target.dataset.reviewQuality);
                    return;
                }
                const dismiss = event.target && event.target.closest ? event.target.closest('[data-review-dismiss]') : null;
                if (dismiss) {
                    event.preventDefault();
                    discard('本轮复盘未评分，稍后可重新进入复盘');
                }
            });
        }
        while (bar.firstChild) bar.removeChild(bar.firstChild);

        const info = doc.createElement('div');
        info.className = 'app-global-banner__body';
        const title = doc.createElement('strong');
        title.className = 'app-global-banner__title';
        title.textContent = '复盘完成，请评分';
        const detail = doc.createElement('span');
        detail.className = 'app-global-banner__detail';
        const suffix = state.pending.entryCount > 1 ? '（' + state.pending.entryCount + ' 篇）' : '';
        detail.textContent = (state.pending.title || '本次复盘') + suffix;
        info.appendChild(title);
        info.appendChild(detail);
        bar.appendChild(info);

        const actions = doc.createElement('div');
        actions.className = 'app-global-banner__actions';
        QUALITY_OPTIONS.forEach((option) => {
            const button = doc.createElement('button');
            button.type = 'button';
            button.className = 'btn app-global-banner__btn app-global-banner__btn--' + option.quality;
            button.dataset.reviewQuality = option.quality;
            button.title = option.title;
            button.textContent = option.label;
            button.disabled = state.submitting;
            actions.appendChild(button);
        });
        const dismiss = doc.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'app-global-banner__close';
        dismiss.dataset.reviewDismiss = 'true';
        dismiss.setAttribute('aria-label', '暂不评分');
        dismiss.title = '暂不评分（本轮不计入复盘）';
        dismiss.textContent = '×';
        dismiss.disabled = state.submitting;
        actions.appendChild(dismiss);
        bar.appendChild(actions);
    }

    global.PracticeReviewFlow = Object.freeze({
        __v1: true,
        QUALITY_OPTIONS,
        start,
        notifyAttemptApplied,
        submit,
        discard,
        getPending,
        onChange,
        render
    });
})(typeof window !== 'undefined' ? window : globalThis);
