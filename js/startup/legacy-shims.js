(function(global) {
    const readyCallbacks = [];
    const componentWaiters = new Map();

    function logCompat(message, level = 'info') {
        const prefix = '[LegacyCompat]';
        if (level === 'error') {
            console.error(prefix, message);
        } else if (level === 'warn') {
            console.warn(prefix, message);
        } else {
            console.log(prefix, message);
        }
    }

    function flushReady(appInstance) {
        if (!appInstance) {
            return;
        }
        while (readyCallbacks.length) {
            const callback = readyCallbacks.shift();
            try {
                callback(appInstance);
            } catch (error) {
                console.error('[LegacyCompat] 回调执行失败:', error);
            }
        }
    }

    function whenAppReady(callback) {
        if (global.app && global.app.isInitialized) {
            callback(global.app);
            return;
        }
        readyCallbacks.push(callback);
    }

    function withComponent(componentName, handler, description) {
        whenAppReady((app) => {
            const resolveComponent = () => {
                const candidates = [
                    app.components?.[componentName],
                    app.ui?.[componentName],
                    app.ui?.browser,
                    global[`${componentName}Instance`],
                    global.ExamBrowserInstance
                ];
                return candidates.find(Boolean) || null;
            };

            const execute = (instance) => {
                try {
                    handler(app, instance);
                } catch (error) {
                    console.error('[LegacyCompat] 兼容操作失败:', description || componentName, error);
                }
            };

            const component = resolveComponent();
            if (component) {
                execute(component);
                return;
            }

            const queue = componentWaiters.get(componentName) || [];
            queue.push(execute);
            if (!componentWaiters.has(componentName)) {
                componentWaiters.set(componentName, queue);
                const intervalId = global.setInterval(() => {
                    const instance = resolveComponent();
                    if (!instance) {
                        return;
                    }
                    global.clearInterval(intervalId);
                    const callbacks = componentWaiters.get(componentName) || [];
                    componentWaiters.delete(componentName);
                    callbacks.forEach(cb => cb(instance));
                }, 100);
                global.setTimeout(() => {
                    global.clearInterval(intervalId);
                    if (componentWaiters.has(componentName)) {
                        logCompat(`${description || componentName} 超时未就绪`, 'warn');
                        componentWaiters.delete(componentName);
                    }
                }, 4000);
            }
        });
    }

    function expose(name, handler, options = {}) {
        const description = options.description || name;
        global[name] = function legacyFacade(...args) {
            whenAppReady((app) => {
                try {
                    handler(app, ...args);
                } catch (error) {
                    console.error(`[LegacyCompat] ${description} 执行失败:`, error);
                }
            });
        };
    }

    expose('showView', (app, viewName) => {
        if (typeof app.navigateToView === 'function') {
            app.navigateToView(viewName);
        } else {
            logCompat(`showView(${viewName}) 调用时缺少 navigateToView`, 'warn');
        }
    });

    expose('filterByType', (app, type = 'all') => {
        withComponent('examBrowser', (_app, browser) => {
            if (typeof browser.setType === 'function') {
                browser.setType(type);
            } else if (typeof browser.render === 'function') {
                browser.render({ type });
            }
            if (typeof app.navigateToView === 'function') {
                app.navigateToView('browse');
            }
        }, `filterByType(${type})`);
    }, { description: 'filterByType' });

    expose('applyBrowseFilter', (app, category = 'all', type = 'all') => {
        withComponent('examBrowser', (_app, browser) => {
            if (typeof browser.setCategory === 'function') {
                browser.setCategory(category || 'all');
            }
            if (typeof browser.setType === 'function') {
                browser.setType(type || 'all');
            }
            if (typeof browser.refresh === 'function') {
                browser.refresh();
            } else if (typeof browser.render === 'function') {
                browser.render();
            }
            if (typeof app.navigateToView === 'function') {
                app.navigateToView('browse');
            }
        }, `applyBrowseFilter(${category}, ${type})`);
    });

    expose('searchExams', (_app, query = '') => {
        withComponent('examBrowser', (_ignoredApp, browser) => {
            if (typeof browser.search === 'function') {
                browser.search(query);
            } else if (typeof browser.render === 'function') {
                browser.render({ search: query });
            }
        }, `searchExams(${query})`);
    });

    if (global.app && global.app.isInitialized) {
        flushReady(global.app);
    }

    global.addEventListener('app:ready', (event) => {
        if (!global.app && event.detail) {
            global.app = event.detail;
        }
        flushReady(global.app || event.detail);
    });
})(window);
