(function(global) {
    const mixin = {
        /**
         * 检查必要的依赖
         */
        checkDependencies() {
            // 仅检查硬性依赖，保持向后兼容；Utils 可选
            const requiredGlobals = ['storage'];
            const missing = requiredGlobals.filter(name => !window[name]);

            if (missing.length > 0) {
                throw new Error(`Missing required dependencies: ${missing.join(', ')}`);
            }
            // 软依赖提示但不阻断
            if (!window.Utils) {
                console.warn('[App] Optional dependency missing: Utils (continuing)');
            }
        },

        /**
         * 初始化组件
         */
        async initializeComponents() {
            // 定义组件加载优先级 - 只加载实际存在的组件
            const coreComponents = ['PracticeRecorder']; // 只有PracticeRecorder是必需的
            const optionalComponents = [
                // ExamBrowser已移除，使用内置的题目列表功能
            ]; // 只加载真正需要且存在的组件

            try {
                // 首先加载核心组件
                await this.waitForComponents(coreComponents, 8000);
                await this.initializeCoreComponents();

                // 然后加载可选组件
                try {
                    await this.waitForComponents(optionalComponents, 5000);
                    await this.initializeOptionalComponents();
                } catch (error) {
                    // 静默处理可选组件加载失败，直接初始化已加载的组件
                    await this.initializeAvailableOptionalComponents();
                }


            } catch (error) {
                console.error('[App] 核心组件加载失败:', error);
                throw error;
            }
        },

        /**
         * 初始化核心组件
         */
        async initializeCoreComponents() {

            // ExamBrowser现在是可选组件，不在核心初始化中处理

            // 初始化PracticeRecorder（必需，但有降级方案）
            if (window.PracticeRecorder) {
                try {
                    this.components.practiceRecorder = new PracticeRecorder();
                    this.setupPracticeRecorderEvents();
                } catch (error) {
                    console.error('[App] PracticeRecorder初始化失败:', error);
                    this.components.practiceRecorder = this.createFallbackRecorder();
                }
            } else {
                console.warn('[App] PracticeRecorder类不可用，创建降级记录器');
                this.components.practiceRecorder = this.createFallbackRecorder();
            }
        },

        /**
         * 初始化可选组件
         */
        async initializeOptionalComponents() {

            const componentInitializers = [
                // ExamBrowser组件已移除，使用内置的题目列表功能
                // PracticeHistory组件已移除，使用简单的练习记录界面

                { name: 'RecommendationDisplay', init: () => new RecommendationDisplay() },
                {
                    name: 'GoalSettings', init: () => {
                        const instance = new GoalSettings();
                        window.goalSettings = instance;
                        return instance;
                    }
                },
                { name: 'ProgressTracker', init: () => new ProgressTracker() },
                { name: 'SpecializedPractice', init: () => new SpecializedPractice() },
                { name: 'QuestionTypePractice', init: () => new QuestionTypePractice() },
                {
                    name: 'DataManagementPanel', init: () => {
                        const container = document.createElement('div');
                        container.id = 'dataManagementPanel';
                        if (typeof window.DOM !== 'undefined' && window.DOM.hide) {
                            window.DOM.hide(container);
                        } else {
                            container.style.display = 'none';
                        }
                        document.body.appendChild(container);
                        const instance = new DataManagementPanel(container);
                        window.dataManagementPanel = instance;
                        return instance;
                    }
                },
                {
                    name: 'SystemMaintenancePanel', init: () => {
                        const container = document.createElement('div');
                        container.id = 'systemMaintenancePanel';
                        if (typeof window.DOM !== 'undefined' && window.DOM.hide) {
                            window.DOM.hide(container);
                        } else {
                            container.style.display = 'none';
                        }
                        document.body.appendChild(container);
                        const instance = new SystemMaintenancePanel(container);
                        window.systemMaintenancePanel = instance;
                        return instance;
                    }
                }
            ];

            for (const { name, init } of componentInitializers) {
                if (window[name]) {
                    try {
                        const componentKey = name.charAt(0).toLowerCase() + name.slice(1);
                        this.components[componentKey] = init();
                    } catch (error) {
                        console.error(`[App] ${name}初始化失败:`, error);
                    }
                } else {
                    // 静默跳过不可用的可选组件
                }
            }
        },

        /**
         * 初始化已加载的可选组件
         */
        async initializeAvailableOptionalComponents() {

            // 只初始化已经加载的组件
            const availableComponents = [
                // ExamBrowser已移除，使用内置的题目列表功能
                // PracticeHistory and ExamScanner were removed
            ].filter(name => window[name]);

            if (availableComponents.length > 0) {

                // 使用相同的初始化逻辑，但只处理可用的组件
                await this.initializeOptionalComponents();
            } else {
                console.warn('[App] 没有发现可用的可选组件');
            }

            // ExamBrowser组件已移除，使用内置的题目列表功能
        },

        /**
         * 等待组件类加载
         */
        async waitForComponents(requiredClasses = ['ExamBrowser'], timeout = 3000) {
            const startTime = Date.now();
            const checkInterval = 100;


            while (Date.now() - startTime < timeout) {
                const loadingStatus = requiredClasses.map(className => {
                    const isLoaded = window[className] && typeof window[className] === 'function';
                    if (!isLoaded) {
                        console.debug(`[App] 等待组件: ${className}`);
                    }
                    return { className, isLoaded };
                });

                const allLoaded = loadingStatus.every(status => status.isLoaded);

                if (allLoaded) {
                    const elapsed = Date.now() - startTime;
                    return true;
                }

                // 显示加载进度
                const loadedCount = loadingStatus.filter(s => s.isLoaded).length;
                const progress = Math.round((loadedCount / requiredClasses.length) * 100);

                if ((Date.now() - startTime) % 1000 < checkInterval) {
                }

                await new Promise(resolve => setTimeout(resolve, checkInterval));
            }

            // 生成详细的错误信息
            const missingClasses = requiredClasses.filter(className =>
                !window[className] || typeof window[className] !== 'function'
            );

            const loadedClasses = requiredClasses.filter(className =>
                window[className] && typeof window[className] === 'function'
            );

            const errorMessage = [
                `组件加载超时 (${timeout}ms)`,
                `已加载: ${loadedClasses.join(', ') || '无'}`,
                `缺失: ${missingClasses.join(', ')}`,
                `请检查组件文件是否正确加载`
            ].join('\n');

            console.error('[App] 组件加载失败:', errorMessage);
            throw new Error(errorMessage);
        },
    };

    global.ExamSystemAppMixins = global.ExamSystemAppMixins || {};
    global.ExamSystemAppMixins.bootstrap = mixin;
})(typeof window !== "undefined" ? window : globalThis);
