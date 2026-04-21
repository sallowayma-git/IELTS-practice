(function(global) {
    function getFallbackDomAdapter() {
        return window.DOMAdapter && typeof window.DOMAdapter.create === 'function'
            ? window.DOMAdapter
            : null;
    }

    function createFallbackNode(adapter, tag, attrs, children) {
        if (adapter) {
            return adapter.create(tag, attrs, children);
        }

        const element = document.createElement(tag);
        if (attrs && typeof attrs === 'object') {
            Object.keys(attrs).forEach((key) => {
                const value = attrs[key];
                if (value == null) {
                    return;
                }
                if (key === 'className') {
                    element.className = value;
                    return;
                }
                if (key === 'dataset' && typeof value === 'object') {
                    Object.keys(value).forEach((dataKey) => {
                        element.dataset[dataKey] = String(value[dataKey]);
                    });
                    return;
                }
                element.setAttribute(key, value);
            });
        }

        const nodes = Array.isArray(children) ? children : [children];
        nodes.forEach((child) => {
            if (child == null) {
                return;
            }
            if (child instanceof Node) {
                element.appendChild(child);
            } else if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            }
        });
        return element;
    }

    function replaceContainerContent(container, content) {
        container.textContent = '';
        const nodes = Array.isArray(content) ? content : [content];
        nodes.forEach((node) => {
            if (!node) {
                return;
            }
            container.appendChild(node);
        });
    }

    function bindActions(container, attrName, handlers) {
        Object.keys(handlers).forEach((name) => {
            const node = container.querySelector(`[data-${attrName}="${name}"]`);
            if (!node) {
                return;
            }
            node.addEventListener('click', (event) => {
                event.preventDefault();
                handlers[name]();
            });
        });
    }

    const mixin = {
        /**
         * 显示/隐藏加载状态
         */
        showLoading(show) {
            const loading = document.getElementById('loading');
            if (loading) {
                if (typeof window.DOM !== 'undefined') {
                    if (show) {
                        window.DOM.show(loading, 'flex');
                    } else {
                        window.DOM.hide(loading);
                    }
                } else {
                    loading.style.display = show ? 'flex' : 'none';
                }
            }
        },

        /**
         * 显示降级UI
         */
        showFallbackUI(canRecover = false) {
            const appContainer = document.getElementById('app');
            if (!appContainer) {
                return;
            }

            const adapter = getFallbackDomAdapter();
            const createNode = (tag, attrs, children) => createFallbackNode(adapter, tag, attrs, children);

            const solutionList = createNode('ul', { className: 'solution-list' }, [
                createNode('li', null, '🔄 刷新页面重新加载系统'),
                createNode('li', null, '🧹 清除浏览器缓存和Cookie'),
                createNode('li', null, '🌐 检查网络连接是否正常'),
                createNode('li', null, '🔧 使用Chrome、Firefox或Edge等现代浏览器'),
                createNode('li', null, '💾 确保有足够的系统内存')
            ]);

            const recoverySection = canRecover
                ? createNode('div', { className: 'recovery-options' }, [
                    createNode('h3', null, '恢复选项'),
                    createNode('div', { className: 'recovery-buttons' }, [
                        createNode('button', {
                            type: 'button',
                            className: 'btn btn-secondary',
                            dataset: { fallbackAction: 'attempt-recovery' }
                        }, '尝试恢复'),
                        createNode('button', {
                            type: 'button',
                            className: 'btn btn-outline',
                            dataset: { fallbackAction: 'safe-mode' }
                        }, '安全模式')
                    ])
                ])
                : null;

            const fallbackRoot = createNode('div', { className: 'fallback-ui' }, [
                createNode('div', { className: 'container' }, [
                    createNode('div', { className: 'fallback-header' }, [
                        createNode('h1', null, '⚠️ 系统初始化失败'),
                        createNode('p', { className: 'fallback-description' },
                            '抱歉，IELTS考试系统无法正常启动。这可能是由于网络问题、浏览器兼容性或系统资源不足导致的。'
                        )
                    ]),
                    createNode('div', { className: 'fallback-solutions' }, [
                        createNode('h3', null, '建议解决方案'),
                        solutionList
                    ]),
                    recoverySection,
                    createNode('div', { className: 'fallback-actions' }, [
                        createNode('button', {
                            type: 'button',
                            className: 'btn btn-primary',
                            dataset: { fallbackAction: 'reload' }
                        }, '🔄 刷新页面'),
                        createNode('button', {
                            type: 'button',
                            className: 'btn btn-outline',
                            dataset: { fallbackAction: 'show-info' }
                        }, '📊 系统信息')
                    ]),
                    createNode('div', { className: 'fallback-footer' }, [
                        createNode('p', null, '如果问题持续存在，请联系技术支持并提供系统信息。')
                    ])
                ])
            ]);

            replaceContainerContent(appContainer, fallbackRoot);
            bindActions(appContainer, 'fallback-action', {
                reload: () => window.location.reload(),
                'show-info': () => alert('系统信息功能已移除'),
                'attempt-recovery': () => this.attemptRecovery(),
                'safe-mode': () => this.enterSafeMode()
            });
        },

        /**
         * 尝试系统恢复
         */
        attemptRecovery() {
            this.showUserMessage('正在尝试恢复系统...', 'info');
            this.components = {};
            this.isInitialized = false;
            if (this.globalErrors) {
                this.globalErrors = [];
            }
            setTimeout(() => {
                this.initialize();
            }, 1000);
        },

        /**
         * 进入安全模式
         */
        enterSafeMode() {
            this.showUserMessage('正在启动安全模式...', 'info');

            const appContainer = document.getElementById('app');
            if (!appContainer) {
                return;
            }

            const adapter = getFallbackDomAdapter();
            const createNode = (tag, attrs, children) => createFallbackNode(adapter, tag, attrs, children);

            const featuresList = createNode('ul', null, [
                createNode('li', null, '基本题库浏览'),
                createNode('li', null, '简单练习记录'),
                createNode('li', null, '系统诊断')
            ]);

            const safeModeRoot = createNode('div', { className: 'safe-mode-ui' }, [
                createNode('div', { className: 'container' }, [
                    createNode('h1', null, '🛡️ 安全模式'),
                    createNode('p', null, '系统正在安全模式下运行，部分功能可能不可用。'),
                    createNode('div', { className: 'safe-mode-features' }, [
                        createNode('h3', null, '可用功能'),
                        featuresList
                    ]),
                    createNode('div', { className: 'safe-mode-actions' }, [
                        createNode('button', {
                            type: 'button',
                            className: 'btn btn-primary',
                            dataset: { safeModeAction: 'initialize' }
                        }, '尝试完整启动'),
                        createNode('button', {
                            type: 'button',
                            className: 'btn btn-secondary',
                            dataset: { safeModeAction: 'reload' }
                        }, '重新加载')
                    ])
                ])
            ]);

            replaceContainerContent(appContainer, safeModeRoot);
            bindActions(appContainer, 'safe-mode-action', {
                initialize: () => this.initialize(),
                reload: () => window.location.reload()
            });
        },
    };

    global.ExamSystemAppMixins = global.ExamSystemAppMixins || {};
    global.ExamSystemAppMixins.fallback = mixin;
})(typeof window !== "undefined" ? window : globalThis);
