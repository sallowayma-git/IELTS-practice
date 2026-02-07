(function (global) {
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
            // if (!window.Utils) {
            //     console.warn('[App] Optional dependency missing: Utils (continuing)');
            // }
        },

        /**
         * 初始化组件
         */
        async initializeComponents() {
            const optionalComponents = [
                // ExamBrowser已移除，使用内置的题目列表功能
            ]; // 只加载真正需要且存在的组件

            try {
                await this.initializeCoreComponents();

                if (optionalComponents.length > 0) {
                    try {
                        await this.waitForComponents(optionalComponents, 5000);
                        await this.initializeOptionalComponents();
                    } catch (error) {
                        await this.initializeAvailableOptionalComponents();
                    }
                } else {
                    await this.initializeOptionalComponents();
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
            if (this.instantiatePracticeRecorder()) {
                return;
            }

            console.warn('[App] PracticeRecorder类不可用，使用降级记录器');
            this.components.practiceRecorder = this.createFallbackRecorder();
            this.ensurePracticeRecorderEvents();
            this.schedulePracticeRecorderUpgrade();
        },

        instantiatePracticeRecorder() {
            if (typeof window.PracticeRecorder !== 'function') {
                return false;
            }

            try {
                this.components.practiceRecorder = new PracticeRecorder();
                this.ensurePracticeRecorderEvents();
                return true;
            } catch (error) {
                console.error('[App] PracticeRecorder初始化失败:', error);
                return false;
            }
        },

        ensurePracticeRecorderEvents() {
            if (this._practiceRecorderEventsBound) {
                return;
            }

            if (typeof this.setupPracticeRecorderEvents === 'function') {
                this.setupPracticeRecorderEvents();
            }
        },

        createFallbackRecorder() {
            function normalizeRecords(records) {
                return Array.isArray(records) ? records : [];
            }

            return {
                startPracticeSession: (examId) => ({
                    examId: examId || '',
                    startTime: Date.now(),
                    sessionId: 'fallback_' + Date.now(),
                    status: 'started'
                }),
                startSession: (examId) => ({
                    examId: examId || '',
                    startTime: Date.now(),
                    sessionId: 'fallback_' + Date.now(),
                    status: 'started'
                }),
                handleRealPracticeData: async () => null,
                savePracticeRecord: async (record) => {
                    if (!window.storage || typeof window.storage.get !== 'function' || typeof window.storage.set !== 'function') {
                        return record || null;
                    }
                    try {
                        const current = await window.storage.get('practice_records', []);
                        const list = normalizeRecords(current);
                        if (record && typeof record === 'object') {
                            list.unshift(record);
                        }
                        await window.storage.set('practice_records', list);
                    } catch (error) {
                        console.warn('[App] 降级记录器保存失败:', error);
                    }
                    return record || null;
                },
                getPracticeRecords: async () => {
                    if (!window.storage || typeof window.storage.get !== 'function') {
                        return [];
                    }
                    try {
                        const records = await window.storage.get('practice_records', []);
                        return normalizeRecords(records);
                    } catch (error) {
                        console.warn('[App] 降级记录器读取失败:', error);
                        return [];
                    }
                }
            };
        },

        schedulePracticeRecorderUpgrade(maxAttempts = 20, interval = 500) {
            if (this._practiceRecorderUpgradeTimer || typeof window === 'undefined') {
                return;
            }

            let attempts = 0;
            const tryUpgrade = () => {
                if (this.instantiatePracticeRecorder()) {
                    clearInterval(this._practiceRecorderUpgradeTimer);
                    this._practiceRecorderUpgradeTimer = null;
                    console.info('[App] PracticeRecorder 脚本加载完成，已升级为完整记录器');
                    return;
                }

                attempts += 1;
                if (attempts >= maxAttempts) {
                    clearInterval(this._practiceRecorderUpgradeTimer);
                    this._practiceRecorderUpgradeTimer = null;
                    console.warn('[App] PracticeRecorder 脚本仍未加载，继续使用降级模式');
                }
            };

            this._practiceRecorderUpgradeTimer = setInterval(tryUpgrade, interval);
            tryUpgrade();
        },

        /**
         * 初始化可选组件
         */
        async initializeOptionalComponents() {

            const componentInitializers = [];

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
            ].filter(name => window[name]);

            if (availableComponents.length > 0) {


                await this.initializeOptionalComponents();
            } else {
                console.warn('[App] 没有发现可用的可选组件');
            }

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
