(function initQuestionBankUpdateWatcher(global) {
    'use strict';

    const REVISION_URL = '/api/question-bank-revision';
    const CHECK_INTERVAL_MS = 120000;
    let knownVersion = null;
    let reloadPending = false;
    let announcedPendingReload = false;
    let pollingStarted = false;

    function isHttpPage() {
        const protocol = global.location && String(global.location.protocol || '').toLowerCase();
        return protocol === 'http:' || protocol === 'https:';
    }

    function isOptionalBackendAvailable() {
        const cloudSync = global.CloudSync;
        return Boolean(cloudSync && typeof cloudSync.getState === 'function' && cloudSync.getState().available === true);
    }

    function hasActivePractice() {
        const app = global.app;
        const recorder = app && app.components && app.components.practiceRecorder;
        if (recorder && recorder.activeSessions && Number(recorder.activeSessions.size) > 0) {
            return true;
        }
        if (!app || !app.examWindows || typeof app.examWindows.forEach !== 'function') {
            return false;
        }
        let active = false;
        app.examWindows.forEach((info) => {
            if (active || !info) return;
            const status = String(info.status || '').toLowerCase();
            const practiceWindow = info.window;
            if (status !== 'completed' && status !== 'closed' && (!practiceWindow || !practiceWindow.closed)) {
                active = true;
            }
        });
        return active;
    }

    function announce(message) {
        if (typeof global.showMessage === 'function') {
            global.showMessage(message, 'info');
        } else if (global.console && typeof global.console.info === 'function') {
            global.console.info(`[QuestionBankUpdateWatcher] ${message}`);
        }
    }

    function restartPracticeSystem() {
        if (global.__questionBankRestarting) return;
        global.__questionBankRestarting = true;
        announce('题库已更新，正在刷新练习系统。');
        if (global.location && typeof global.location.reload === 'function') {
            global.location.reload();
        }
    }

    function supportsRevisionChecks() {
        return isHttpPage() && isOptionalBackendAvailable();
    }

    async function readRevision() {
        if (typeof global.fetch !== 'function') return null;
        const response = await global.fetch(`${REVISION_URL}?t=${Date.now()}`, {
            cache: 'no-store',
            credentials: 'same-origin'
        });
        if (!response.ok) {
            throw new Error(`question-bank version request failed (${response.status})`);
        }
        const payload = await response.json();
        return payload && typeof payload.revision === 'string' ? payload.revision : null;
    }

    async function checkNow() {
        if (!isHttpPage()) return { checked: false, reason: 'unsupported-protocol' };
        if (!isOptionalBackendAvailable()) return { checked: false, reason: 'backend-unavailable' };
        let nextRevision;
        try {
            nextRevision = await readRevision();
        } catch (error) {
            if (global.console && typeof global.console.warn === 'function') {
                global.console.warn('[QuestionBankUpdateWatcher] version check failed:', error);
            }
            return { checked: false, reason: 'request-failed' };
        }
        if (!nextRevision) return { checked: false, reason: 'missing-revision' };
        if (!knownVersion) {
            knownVersion = nextRevision;
            return { checked: true, changed: false };
        }
        if (nextRevision !== knownVersion) {
            knownVersion = nextRevision;
            reloadPending = true;
        }
        if (!reloadPending) return { checked: true, changed: false };
        if (hasActivePractice()) {
            if (!announcedPendingReload) {
                announcedPendingReload = true;
                announce('检测到题库更新，当前练习完成后将自动刷新。');
            }
            return { checked: true, changed: true, deferred: true };
        }
        reloadPending = false;
        announcedPendingReload = false;
        restartPracticeSystem();
        return { checked: true, changed: true, restarted: true };
    }

    function startPolling() {
        if (pollingStarted || !supportsRevisionChecks()) return;
        pollingStarted = true;
        checkNow();
        global.setInterval(checkNow, CHECK_INTERVAL_MS);
        if (global.document && typeof global.document.addEventListener === 'function') {
            global.document.addEventListener('visibilitychange', () => {
                if (!global.document.hidden) checkNow();
            });
        }
    }

    function start() {
        if (!isHttpPage()) return;
        if (isOptionalBackendAvailable()) {
            startPolling();
            return;
        }
        if (typeof global.addEventListener === 'function') {
            global.addEventListener('ielts-cloud-sync-state', (event) => {
                if (event && event.detail && event.detail.available === true) {
                    startPolling();
                }
            });
        }
    }

    global.QuestionBankUpdateWatcher = {
        checkNow,
        hasActivePractice,
        supportsRevisionChecks,
        start
    };

    if (global.document) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', start, { once: true });
        } else {
            start();
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
