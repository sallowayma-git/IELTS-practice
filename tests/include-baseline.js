/**
 * Baseline loader for test pages
 * 按正确顺序动态注入最小脚本集：数据→utils→stores→ui→app→compat-shims
 *
 * 使用方法：
 * 1. 测试页面仅需引入这一个脚本
 * 2. 提供 onBaselineReady 回调
 * 3. 使用 waitForStorageReady() 确保存储就绪
 *
 * 验收标准：
 * - window.storage/ExamStore/RecordStore/SettingsPanel 在测试页可用
 * - 加载无重复
 * - 所有核心组件正确初始化
 */

(function() {
    'use strict';

    // 全局状态管理
    window.TestBaseline = {
        loadedScripts: new Set(),
        isLoading: false,
        isReady: false,
        readyCallbacks: [],
        errorCallbacks: [],
        config: {
            baseUrl: '',
            timeout: 10000,
            debug: true
        }
    };

    /**
     * 记录调试信息
     */
    function log(message, type = 'info') {
        if (window.TestBaseline.config.debug) {
            console.log(`[BaselineLoader] ${type.toUpperCase()}: ${message}`);
        }
    }

    /**
     * 动态加载脚本
     */
    function loadScript(src, timeout = 5000) {
        return new Promise((resolve, reject) => {
            // 避免重复加载
            if (window.TestBaseline.loadedScripts.has(src)) {
                log(`Script already loaded: ${src}`, 'warn');
                resolve();
                return;
            }

            log(`Loading script: ${src}`);
            const script = document.createElement('script');
            script.src = src;
            script.async = false; // 保持顺序加载

            const timeoutId = setTimeout(() => {
                reject(new Error(`Script loading timeout: ${src}`));
            }, timeout);

            script.onload = () => {
                clearTimeout(timeoutId);
                window.TestBaseline.loadedScripts.add(src);
                log(`Script loaded: ${src}`, 'success');
                resolve();
            };

            script.onerror = () => {
                clearTimeout(timeoutId);
                reject(new Error(`Script loading failed: ${src}`));
            };

            document.head.appendChild(script);
        });
    }

    /**
     * 检查依赖是否就绪
     */
    function checkDependency(name) {
        switch (name) {
            case 'storage':
                return typeof window.storage !== 'undefined';
            case 'EventEmitter':
                return typeof window.EventEmitter !== 'undefined';
            case 'AppStore':
                return typeof window.AppStore !== 'undefined';
            case 'ExamStore':
                return typeof window.ExamStore !== 'undefined';
            case 'RecordStore':
                return typeof window.RecordStore !== 'undefined';
            case 'SettingsPanel':
                return typeof window.SettingsPanel !== 'undefined';
            case 'App':
                return typeof window.App !== 'undefined';
            default:
                return typeof window[name] !== 'undefined';
        }
    }

    /**
     * 等待存储系统就绪
     */
    window.waitForStorageReady = async function(timeout = 3000) {
        const startTime = Date.now();
        log('Waiting for storage system to be ready...');

        while (Date.now() - startTime < timeout) {
            if (window.storage && typeof window.storage.get === 'function') {
                try {
                    // 测试存储读写
                    await window.storage.set('__storage_test__', 'test');
                    const value = await window.storage.get('__storage_test__');
                    await window.storage.remove('__storage_test__');
                    if (value === 'test') {
                        log('Storage system ready', 'success');
                        return true;
                    }
                } catch (error) {
                    log(`Storage test failed: ${error.message}`, 'warn');
                }
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        throw new Error('Storage system not ready within timeout');
    };

    /**
     * 添加就绪回调
     */
    window.onBaselineReady = function(callback) {
        if (window.TestBaseline.isReady) {
            setTimeout(callback, 0);
        } else {
            window.TestBaseline.readyCallbacks.push(callback);
        }
    };

    /**
     * 添加错误回调
     */
    window.onBaselineError = function(callback) {
        window.TestBaseline.errorCallbacks.push(callback);
    };

    /**
     * 触发就绪回调
     */
    function triggerReadyCallbacks() {
        window.TestBaseline.isReady = true;
        log('Baseline ready, triggering callbacks');

        setTimeout(() => {
            window.TestBaseline.readyCallbacks.forEach(callback => {
                try {
                    callback();
                } catch (error) {
                    log(`Callback error: ${error.message}`, 'error');
                }
            });
            window.TestBaseline.readyCallbacks = [];
        }, 100);
    }

    /**
     * 触发错误回调
     */
    function triggerErrorCallbacks(error) {
        log(`Baseline loading failed: ${error.message}`, 'error');

        setTimeout(() => {
            window.TestBaseline.errorCallbacks.forEach(callback => {
                try {
                    callback(error);
                } catch (callbackError) {
                    log(`Error callback failed: ${callbackError.message}`, 'error');
                }
            });
            window.TestBaseline.errorCallbacks = [];
        }, 100);
    }

    /**
     * 主加载流程
     */
    async function loadBaseline() {
        if (window.TestBaseline.isLoading) {
            log('Already loading...', 'warn');
            return;
        }

        window.TestBaseline.isLoading = true;
        log('Starting baseline loading...');

        try {
            // 脚本加载顺序：数据→utils→stores→ui→app→compat-shims
            const scripts = [
                // 1. 基础数据
                '../assets/scripts/complete-exam-data.js',

                // 2. Utils 层
                '../js/utils/events.js',
                '../js/utils/helpers.js',
                '../js/utils/storage.js',
                '../js/utils/performanceOptimizer.js',
                '../js/utils/errorDisplay.js',

                // 3. Stores 层
                '../js/stores/AppStore.js',
                '../js/stores/ExamStore.js',
                '../js/stores/RecordStore.js',

                // 4. UI 层
                '../js/ui/ExamBrowser.js',
                '../js/ui/RecordViewer.js',
                '../js/ui/SettingsPanel.js',

                // 5. Core 组件
                '../js/core/scoreStorage.js',

                // 6. Legacy 函数
                '../js/script.js',

                // 7. App 初始化
                '../js/app.js',

                // 8. 兼容层
                'tests/compat-shims.js'
            ];

            // 按顺序加载所有脚本
            for (const src of scripts) {
                await loadScript(src, window.TestBaseline.config.timeout);
            }

            // 等待关键依赖就绪
            log('Waiting for critical dependencies...');
            const criticalDeps = ['storage', 'EventEmitter', 'AppStore', 'ExamStore', 'RecordStore', 'SettingsPanel'];

            for (const dep of criticalDeps) {
                let attempts = 0;
                while (!checkDependency(dep) && attempts < 50) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                }

                if (!checkDependency(dep)) {
                    throw new Error(`Critical dependency not ready: ${dep}`);
                }

                log(`Dependency ready: ${dep}`, 'success');
            }

            // 等待 App 初始化完成
            log('Waiting for App initialization...');
            if (window.App && typeof window.App.initialize === 'function') {
                let initAttempts = 0;
                while (!window.App.isInitialized() && initAttempts < 50) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    initAttempts++;
                }

                if (!window.App.isInitialized()) {
                    throw new Error('App initialization failed');
                }

                log('App initialization complete', 'success');
            }

            // 等待存储系统就绪
            await waitForStorageReady();

            log('Baseline loading completed successfully', 'success');
            triggerReadyCallbacks();

        } catch (error) {
            log(`Baseline loading failed: ${error.message}`, 'error');
            triggerErrorCallbacks(error);
        } finally {
            window.TestBaseline.isLoading = false;
        }
    }

    /**
     * 获取加载状态
     */
    window.getBaselineStatus = function() {
        return {
            isLoading: window.TestBaseline.isLoading,
            isReady: window.TestBaseline.isReady,
            loadedScripts: Array.from(window.TestBaseline.loadedScripts),
            dependencies: {
                storage: checkDependency('storage'),
                EventEmitter: checkDependency('EventEmitter'),
                AppStore: checkDependency('AppStore'),
                ExamStore: checkDependency('ExamStore'),
                RecordStore: checkDependency('RecordStore'),
                SettingsPanel: checkDependency('SettingsPanel'),
                App: checkDependency('App')
            }
        };
    };

    // DOM 加载完成后自动开始加载
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadBaseline);
    } else {
        // DOM 已经加载完成，立即开始
        setTimeout(loadBaseline, 0);
    }

})();