(function bootScreenModule(global) {
    'use strict';

    var overlay = null;
    var progressBar = null;
    var progressText = null;
    var statusText = null;
    var hidden = false;
    var safetyTimer = null;

    function queryNodes() {
        if (overlay && progressBar && progressText) {
            return;
        }
        overlay = document.getElementById('boot-overlay');
        progressBar = document.getElementById('boot-progress-bar');
        progressText = document.getElementById('boot-progress-text');
        statusText = document.getElementById('boot-status-text');
        if (overlay && document.body && !document.body.classList.contains('boot-active')) {
            document.body.classList.add('boot-active');
        }
    }

    function clampProgress(value) {
        if (typeof value !== 'number' || isNaN(value)) {
            return null;
        }
        return Math.max(0, Math.min(100, value));
    }

    function setStage(label, progress) {
        queryNodes();
        if (!overlay || hidden) {
            return;
        }
        if (typeof label === 'string' && statusText) {
            statusText.textContent = label;
        }
        var normalized = clampProgress(progress);
        if (normalized !== null && progressBar) {
            progressBar.style.width = normalized + '%';
        }
        if (progressText && typeof label === 'string') {
            progressText.textContent = label;
        }
    }

    function hideOverlay() {
        if (!overlay || hidden) {
            return;
        }
        hidden = true;
        overlay.setAttribute('data-hidden', 'true');
        if (document.body) {
            document.body.classList.remove('boot-active');
        }
        if (safetyTimer) {
            clearTimeout(safetyTimer);
            safetyTimer = null;
        }
    }

    function complete() {
        setStage('系统就绪', 100);
        setTimeout(hideOverlay, 480);
    }

    function fail(errorMessage) {
        setStage(errorMessage || '启动异常，已启用降级模式', 100);
        setTimeout(hideOverlay, 800);
    }

    function ensureOverlayVisible() {
        queryNodes();
        if (!overlay) {
            return;
        }
        overlay.removeAttribute('data-hidden');
        if (document.body) {
            document.body.classList.add('boot-active');
        }
    }

    function scheduleSafetyHide() {
        if (safetyTimer || hidden) {
            return;
        }
        safetyTimer = setTimeout(function failSafe() {
            console.warn('[BootScreen] 超过 10 秒未完成，自动隐藏加载层');
            hideOverlay();
        }, 10000);
    }

    document.addEventListener('DOMContentLoaded', function onReady() {
        queryNodes();
        scheduleSafetyHide();
    });

    global.AppBootScreen = global.AppBootScreen || {};
    global.AppBootScreen.setStage = setStage;
    global.AppBootScreen.complete = complete;
    global.AppBootScreen.fail = fail;
    global.AppBootScreen.ensureVisible = ensureOverlayVisible;
})(typeof window !== 'undefined' ? window : this);
