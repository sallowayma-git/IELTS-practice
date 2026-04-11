(function initAppUpdateManager(global) {
    'use strict';

    const AUTO_CHECK_TTL_MS = 3 * 60 * 1000;

    function cloneState(state) {
        return JSON.parse(JSON.stringify(state));
    }

    function formatTimestamp(value) {
        if (!value) {
            return '未检查';
        }
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return '未检查';
        }
        return parsed.toLocaleString();
    }

    function resolveStatusLabel(status, isElectron) {
        if (!isElectron) {
            return '浏览器模式';
        }
        switch (status) {
            case 'checking':
                return '检查中';
            case 'available':
                return '发现更新';
            case 'downloading':
                return '下载中';
            case 'ready-to-reload':
                return '等待重载';
            case 'ready-to-restart':
                return '等待重启';
            case 'up-to-date':
                return '已是最新';
            case 'error':
                return '更新失败';
            default:
                return '未检查';
        }
    }

    function resolveEntryActionLabel(state, isElectron) {
        if (!isElectron) {
            return '查看更新状态';
        }
        if (state.status === 'checking' || state.status === 'downloading') {
            return '查看更新进度';
        }
        if (state.status === 'ready-to-reload') {
            return '立即重载切换';
        }
        if (state.status === 'ready-to-restart' || state.shell.downloaded) {
            return '立即重启更新';
        }
        if (state.resource.downloaded) {
            return '查看已准备更新';
        }
        if (state.shell.available || state.resource.available) {
            return '查看可用更新';
        }
        return '查看更新';
    }

    function shouldAutoCheck(state) {
        if (!state || !state.lastCheckAt) {
            return true;
        }
        const lastCheckTime = new Date(state.lastCheckAt).getTime();
        if (Number.isNaN(lastCheckTime)) {
            return true;
        }
        if (state.status === 'checking' || state.status === 'downloading') {
            return false;
        }
        if (state.status === 'ready-to-reload' || state.status === 'ready-to-restart') {
            return false;
        }
        if (state.shell && state.shell.downloaded) {
            return false;
        }
        if (state.resource && state.resource.downloaded) {
            return false;
        }
        return (Date.now() - lastCheckTime) >= AUTO_CHECK_TTL_MS;
    }

    class AppUpdateManager {
        constructor() {
            this.isElectron = !!(global.updateAPI && typeof global.updateAPI.getState === 'function');
            this.state = this.createFallbackState();
            this.lastRenderedSignature = '';
            this.unsubscribe = null;
            this.modalOverlay = null;
            this.checkPromise = null;
            this.downloadShellPromise = null;
            this.downloadResourcePromise = null;
            this.lastActiveTrigger = null;

            this.handleDocumentClick = this.handleDocumentClick.bind(this);
            this.handleKeyDown = this.handleKeyDown.bind(this);
        }

        createFallbackState() {
            return {
                isElectron: this.isElectron,
                status: 'idle',
                appVersion: this.isElectron ? '检测中...' : '浏览器模式',
                resourceVersion: this.isElectron ? '检测中...' : '静态资源',
                latestReleaseTag: '--',
                releaseNotes: '',
                releasePageUrl: '',
                publishedAt: null,
                lastCheckAt: null,
                usedCachedRelease: false,
                error: null,
                shell: {
                    supported: this.isElectron,
                    available: false,
                    version: null,
                    downloadAllowed: false,
                    downloaded: false,
                    assetName: null,
                    error: null
                },
                resource: {
                    available: false,
                    version: null,
                    strategy: null,
                    selectedAssetName: null,
                    downloadAllowed: false,
                    downloaded: false,
                    requiresShellUpdate: false,
                    compatible: true,
                    baseMismatch: false,
                    error: null
                }
            };
        }

        normalizeState(nextState) {
            const base = this.createFallbackState();
            return {
                ...base,
                ...(nextState || {}),
                shell: {
                    ...base.shell,
                    ...((nextState && nextState.shell) || {})
                },
                resource: {
                    ...base.resource,
                    ...((nextState && nextState.resource) || {})
                }
            };
        }

        async init() {
            document.addEventListener('click', this.handleDocumentClick);
            document.addEventListener('keydown', this.handleKeyDown);

            if (this.isElectron) {
                try {
                    const initialState = await global.updateAPI.getState();
                    this.setState(initialState, { dispatchEvent: false });
                    this.unsubscribe = global.updateAPI.onStateChange((state) => {
                        this.setState(state, { dispatchEvent: false });
                    });
                } catch (error) {
                    this.setState({
                        ...this.createFallbackState(),
                        status: 'error',
                        error: error && error.message ? error.message : String(error)
                    }, { dispatchEvent: false });
                }
            } else {
                this.refreshDom();
            }
        }

        buildRenderSignature(state) {
            const normalized = this.normalizeState(state);
            return JSON.stringify({
                status: normalized.status,
                appVersion: normalized.appVersion,
                resourceVersion: normalized.resourceVersion,
                latestReleaseTag: normalized.latestReleaseTag,
                releasePageUrl: normalized.releasePageUrl,
                publishedAt: normalized.publishedAt,
                lastCheckAt: normalized.lastCheckAt,
                error: normalized.error,
                releaseNotes: normalized.releaseNotes,
                shell: normalized.shell,
                resource: normalized.resource
            });
        }

        setState(nextState, options) {
            const config = options || {};
            const normalizedState = this.normalizeState(nextState);
            const nextSignature = this.buildRenderSignature(normalizedState);
            const stateChanged = nextSignature !== this.lastRenderedSignature;
            this.state = normalizedState;

            if (stateChanged) {
                this.lastRenderedSignature = nextSignature;
                this.refreshDom();

                if (this.modalOverlay && this.modalOverlay.classList.contains('show')) {
                    this.renderModal();
                }
            }

            if (config.dispatchEvent === false) {
                return;
            }
            if (!stateChanged && !config.forceDispatch) {
                return;
            }

            document.dispatchEvent(new CustomEvent('app-update-state-changed', {
                detail: cloneState(this.state)
            }));
        }

        getState() {
            return cloneState(this.state);
        }

        refreshDom() {
            const fields = {
                'app-version': this.state.appVersion || (this.isElectron ? '检测中...' : '浏览器模式'),
                'resource-version': this.state.resourceVersion || '--',
                'latest-release-tag': this.state.latestReleaseTag || '--',
                'last-check-time': formatTimestamp(this.state.lastCheckAt),
                'status-label': resolveStatusLabel(this.state.status, this.isElectron),
                'entry-action-label': resolveEntryActionLabel(this.state, this.isElectron),
                'runtime-mode': this.isElectron ? 'Electron 桌面端' : '浏览器/file:// 预览模式'
            };

            Object.keys(fields).forEach((field) => {
                document.querySelectorAll('[data-update-field="' + field + '"]').forEach((node) => {
                    node.textContent = fields[field];
                    if (field === 'status-label') {
                        node.setAttribute('data-status', this.isElectron ? (this.state.status || 'idle') : 'browser');
                    }
                });
            });
        }

        handleDocumentClick(event) {
            const trigger = event.target.closest('[data-update-action]');
            if (!trigger) {
                return;
            }

            const action = trigger.getAttribute('data-update-action');
            if (!action || action === 'noop') {
                return;
            }

            if (action === 'open-modal') {
                this.lastActiveTrigger = trigger;
            }

            event.preventDefault();
            this.handleAction(action).catch((error) => {
                const message = error && error.message ? error.message : String(error);
                this.setState({
                    ...this.state,
                    status: 'error',
                    error: message
                }, { dispatchEvent: false });
                if (typeof global.showMessage === 'function') {
                    global.showMessage(message, 'error');
                }
            });
        }

        async handleAction(action) {
            switch (action) {
                case 'open-modal':
                    this.showModal();
                    return this.ensureAutoCheck();
                case 'close-modal':
                    return this.hideModal();
                case 'recheck':
                    return this.checkForUpdates({ manual: true });
                case 'download-shell':
                    return this.downloadShellUpdate();
                case 'download-resource':
                    return this.downloadResourceAndReload();
                case 'apply-resource':
                    return this.applyPreparedResourceUpdate();
                case 'restart-install':
                    return this.restartToInstall();
                default:
                    return undefined;
            }
        }

        ensureModal() {
            if (this.modalOverlay && this.modalOverlay.isConnected) {
                return this.modalOverlay;
            }

            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay app-update-modal';
            overlay.setAttribute('aria-hidden', 'false');
            overlay.innerHTML = [
                '<div class="modal-container" role="dialog" aria-modal="true" aria-labelledby="app-update-modal-title">',
                '<div class="modal-header">',
                '<h3 class="modal-title" id="app-update-modal-title">应用更新</h3>',
                '<button class="app-update-modal__close" type="button" aria-label="关闭更新弹窗" data-update-action="close-modal">×</button>',
                '</div>',
                '<div class="modal-body"></div>',
                '<div class="modal-footer"></div>',
                '</div>'
            ].join('');

            overlay.addEventListener('click', (clickEvent) => {
                if (clickEvent.target === overlay) {
                    this.hideModal();
                }
            });

            document.body.appendChild(overlay);
            this.modalOverlay = overlay;
            return overlay;
        }

        showModal() {
            this.ensureModal();
            if (document.activeElement instanceof HTMLElement) {
                this.lastActiveTrigger = document.activeElement;
            }
            this.modalOverlay.classList.add('show');
            this.renderModal();
            const closeButton = this.modalOverlay.querySelector('.app-update-modal__close');
            if (closeButton instanceof HTMLElement) {
                closeButton.focus();
            }
        }

        hideModal() {
            const overlay = this.modalOverlay;
            if (!overlay) {
                return;
            }

            this.modalOverlay = null;
            overlay.classList.remove('show');
            overlay.setAttribute('aria-hidden', 'true');
            if (typeof overlay.remove === 'function') {
                overlay.remove();
            } else if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
            if (this.lastActiveTrigger instanceof HTMLElement && this.lastActiveTrigger.isConnected) {
                this.lastActiveTrigger.focus();
            }
        }

        isModalVisible() {
            return !!(this.modalOverlay && this.modalOverlay.isConnected && this.modalOverlay.classList.contains('show'));
        }

        handleKeyDown(event) {
            if (event.key !== 'Escape' || !this.isModalVisible()) {
                return;
            }

            event.preventDefault();
            this.hideModal();
        }

        getCalloutConfig() {
            if (!this.isElectron) {
                return {
                    tone: 'warning',
                    text: '当前为浏览器/file:// 预览模式，只展示状态；实际更新仅在 Electron 桌面端生效。'
                };
            }

            if (this.state.error) {
                return {
                    tone: 'error',
                    text: this.state.error
                };
            }

            if (this.state.status === 'ready-to-restart') {
                return {
                    tone: 'success',
                    text: '壳层更新已下载完成，点击“立即重启更新”切换到新版本。'
                };
            }

            if (this.state.status === 'ready-to-reload') {
                return {
                    tone: 'success',
                    text: '资源更新已应用完成，点击“立即重载切换”让当前窗口切到新资源版本。'
                };
            }

            if (this.state.resource.downloaded) {
                return {
                    tone: 'success',
                    text: '兼容资源更新已在后台准备完成；你可以现在重载切换，也可以等下次启动时自动激活。'
                };
            }

            if (this.state.resource.requiresShellUpdate) {
                return {
                    tone: 'warning',
                    text: '这次资源包明确要求壳层升级，不能只做前端热切换。'
                };
            }

            if (this.state.resource.baseMismatch) {
                return {
                    tone: 'warning',
                    text: this.state.resource.strategy === 'full'
                        ? '当前资源基线不匹配，已自动切换到完整资源包兜底。'
                        : '当前资源版本和这次增量包基线不一致，按策略阻止直接套补丁。'
                };
            }

            if (this.state.resource.available && this.state.resource.error) {
                return {
                    tone: 'warning',
                    text: this.state.resource.error
                };
            }

            if (this.state.shell.available && !this.state.shell.downloadAllowed) {
                return {
                    tone: 'warning',
                    text: '检测到壳层新版本，但缺少当前平台差分资产；按策略不回退到全量覆盖安装。'
                };
            }

            if (this.state.resource.available || this.state.shell.available) {
                return {
                    tone: 'warning',
                    text: '检测到新版本，可按条件执行资源增量或壳层更新。'
                };
            }

            if (this.state.status === 'checking') {
                return {
                    tone: 'warning',
                    text: this.state.usedCachedRelease
                        ? '正在刷新远端状态，当前先展示缓存的 Release 信息。'
                        : '正在检查 GitHub 最新 Release，请稍等。'
                };
            }

            return {
                tone: 'success',
                text: '当前没有可应用的更新。'
            };
        }

        getPrimaryAction() {
            if (!this.isElectron) {
                return {
                    label: '我知道了',
                    action: 'close-modal',
                    className: 'btn btn-secondary'
                };
            }

            if (this.state.status === 'checking' || this.state.status === 'downloading') {
                return {
                    label: this.state.status === 'checking' ? '检查中...' : '下载中...',
                    action: 'noop',
                    className: 'btn btn-primary',
                    disabled: true
                };
            }

            if (this.state.status === 'ready-to-restart' || this.state.shell.downloaded) {
                return {
                    label: '立即重启更新',
                    action: 'restart-install',
                    className: 'btn btn-primary'
                };
            }

            if (this.state.status === 'ready-to-reload') {
                return {
                    label: '立即重载切换',
                    action: 'apply-resource',
                    className: 'btn btn-primary'
                };
            }

            if (this.state.resource.downloaded) {
                return {
                    label: '立即重载切换',
                    action: 'apply-resource',
                    className: 'btn btn-primary'
                };
            }

            if (this.state.shell.available && this.state.shell.downloadAllowed) {
                return {
                    label: '下载并重启更新',
                    action: 'download-shell',
                    className: 'btn btn-primary'
                };
            }

            if (this.state.resource.available && this.state.resource.downloadAllowed) {
                return {
                    label: '更新资源并重载',
                    action: 'download-resource',
                    className: 'btn btn-primary'
                };
            }

            return {
                label: '重新检查',
                action: 'recheck',
                className: 'btn btn-secondary'
            };
        }

        renderModal() {
            if (!this.modalOverlay) {
                return;
            }

            const modalBody = this.modalOverlay.querySelector('.modal-body');
            const modalFooter = this.modalOverlay.querySelector('.modal-footer');
            const callout = this.getCalloutConfig();
            const notesHtml = this.state.releaseNotes
                ? this.escapeHtml(this.state.releaseNotes)
                : '<p class="app-update-modal__empty">这次 Release 没有附带更新说明。</p>';
            const primaryAction = this.getPrimaryAction();

            modalBody.innerHTML = [
                '<div class="app-update-modal__summary">',
                this.renderMetric('当前应用版本', this.state.appVersion || '--'),
                this.renderMetric('当前资源版本', this.state.resourceVersion || '--'),
                this.renderMetric('最新 Release', this.state.latestReleaseTag || '--'),
                this.renderMetric('最后检查时间', formatTimestamp(this.state.lastCheckAt)),
                '</div>',
                '<div class="app-update-modal__callout app-update-modal__callout--' + callout.tone + '">',
                this.escapeHtml(callout.text),
                '</div>',
                '<div class="app-update-modal__summary">',
                this.renderMetric('壳层更新', this.describeShellState()),
                this.renderMetric('资源更新', this.describeResourceState()),
                this.renderMetric('资源策略', this.describeResourceStrategy()),
                '</div>',
                this.state.releasePageUrl
                    ? '<p class="app-update-modal__release-link"><a href="' + this.escapeHtml(this.state.releasePageUrl) + '" target="_blank" rel="noopener noreferrer">查看 GitHub Release 详情</a></p>'
                    : '',
                '<div class="app-update-modal__notes-wrap">',
                '<h4>Release Notes</h4>',
                '<div class="app-update-modal__notes">' + notesHtml + '</div>',
                '</div>'
            ].join('');

            modalFooter.innerHTML = '';
            modalFooter.appendChild(this.createFooterButton({
                label: '关闭',
                action: 'close-modal',
                className: 'btn btn-outline'
            }));
            modalFooter.appendChild(this.createFooterButton(primaryAction));
            if (primaryAction.action !== 'recheck') {
                modalFooter.appendChild(this.createFooterButton({
                    label: '重新检查',
                    action: 'recheck',
                    className: 'btn btn-secondary',
                    disabled: this.state.status === 'checking' || this.state.status === 'downloading'
                }));
            }
        }

        renderMetric(label, value) {
            return [
                '<div class="app-update-modal__metric">',
                '<p class="app-update-modal__metric-label">', this.escapeHtml(label), '</p>',
                '<p class="app-update-modal__metric-value">', this.escapeHtml(value), '</p>',
                '</div>'
            ].join('');
        }

        createFooterButton(config) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = config.className || 'btn';
            button.textContent = config.label;
            if (config.action && config.action !== 'noop') {
                button.setAttribute('data-update-action', config.action);
            }
            if (config.disabled) {
                button.disabled = true;
            }
            return button;
        }

        describeShellState() {
            if (!this.isElectron) {
                return '浏览器模式不可用';
            }
            if (this.state.shell.downloaded) {
                return '已下载，等待重启';
            }
            if (this.state.shell.available && this.state.shell.downloadAllowed) {
                return ('可下载差分包 ' + (this.state.shell.version || '')).trim();
            }
            if (this.state.shell.available) {
                return '有新壳层版本，但已阻止全量回退';
            }
            return '无壳层更新';
        }

        describeResourceState() {
            if (!this.isElectron) {
                return '浏览器模式仅显示状态';
            }
            if (this.state.status === 'ready-to-reload') {
                return '已激活，等待重载切换';
            }
            if (this.state.resource.requiresShellUpdate) {
                return '资源包要求壳层升级';
            }
            if (this.state.resource.downloaded) {
                return '已后台准备，下次启动自动切换';
            }
            if (this.state.resource.baseMismatch) {
                return this.state.resource.strategy === 'full'
                    ? '基线不匹配，已切到完整资源包'
                    : '资源增量基线不匹配';
            }
            if (this.state.resource.available && this.state.resource.error) {
                return this.state.resource.error;
            }
            if (this.state.resource.available && this.state.resource.downloadAllowed) {
                return '可更新到 ' + (this.state.resource.version || '--');
            }
            if (this.state.resource.available) {
                return '发现资源更新，但当前不可直接应用';
            }
            return '无资源更新';
        }

        describeResourceStrategy() {
            if (!this.isElectron) {
                return '仅展示状态';
            }
            if (this.state.resource.strategy === 'delta') {
                return '增量包';
            }
            if (this.state.resource.strategy === 'full') {
                return '完整资源包兜底';
            }
            return '未选择';
        }

        escapeHtml(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        async checkForUpdates(options) {
            const config = options || {};
            if (!this.isElectron) {
                this.showModal();
                if (config.manual && typeof global.showMessage === 'function') {
                    global.showMessage('当前为浏览器/file:// 预览模式，无法执行桌面端更新。', 'info');
                }
                this.renderModal();
                return this.getState();
            }

            if (this.checkPromise) {
                return this.checkPromise;
            }

            this.checkPromise = global.updateAPI.check({
                manual: !!config.manual
            }).then((state) => {
                this.setState(state, { dispatchEvent: false });
                if (config.manual && state.status === 'up-to-date' && typeof global.showMessage === 'function') {
                    global.showMessage('已是最新版本', 'success');
                }
                return state;
            }).finally(() => {
                this.checkPromise = null;
            });

            return this.checkPromise;
        }

        async downloadShellUpdate() {
            if (this.downloadShellPromise) {
                return this.downloadShellPromise;
            }

            this.downloadShellPromise = global.updateAPI.downloadShellUpdate().then((state) => {
                this.setState(state, { dispatchEvent: false });
                if (typeof global.showMessage === 'function') {
                    global.showMessage('壳层更新下载完成，等待重启安装。', 'success');
                }
                return state;
            }).finally(() => {
                this.downloadShellPromise = null;
            });

            return this.downloadShellPromise;
        }

        async downloadResourceAndReload() {
            if (this.downloadResourcePromise) {
                return this.downloadResourcePromise;
            }

            this.downloadResourcePromise = (async () => {
                await global.updateAPI.downloadResourceUpdate();
                await global.updateAPI.applyResourceUpdate();
                if (typeof global.showMessage === 'function') {
                    global.showMessage('资源更新已应用，正在重载。', 'success', 1800);
                }
                setTimeout(() => {
                    global.location.reload();
                }, 180);
            })().finally(() => {
                this.downloadResourcePromise = null;
            });

            return this.downloadResourcePromise;
        }

        async applyPreparedResourceUpdate() {
            if (this.state.resource.downloaded) {
                await global.updateAPI.applyResourceUpdate();
            } else if (this.state.status !== 'ready-to-reload') {
                return;
            }
            if (typeof global.showMessage === 'function') {
                global.showMessage('资源更新已应用，正在重载。', 'success', 1800);
            }
            setTimeout(() => {
                global.location.reload();
            }, 180);
        }

        async restartToInstall() {
            await global.updateAPI.quitAndInstall();
        }

        async ensureAutoCheck() {
            if (!this.isElectron) {
                return this.checkForUpdates({ manual: false });
            }
            if (shouldAutoCheck(this.state)) {
                return this.checkForUpdates({ manual: false });
            }
            return this.getState();
        }
    }

    global.AppUpdateManager = AppUpdateManager;

    document.addEventListener('DOMContentLoaded', function bootstrapUpdateManager() {
        const instance = new AppUpdateManager();
        global.appUpdateManager = instance;
        instance.init().catch((error) => {
            console.error('[UpdateManager] 初始化失败:', error);
        });
    });
})(typeof window !== 'undefined' ? window : this);
