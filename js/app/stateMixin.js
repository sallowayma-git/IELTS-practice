(function(global) {
    const mixin = {
        // 状态管理方法
        getState(path) {
            return path.split('.').reduce((obj, key) => obj && obj[key], this.state);
        },

        setState(path, value) {
            const keys = path.split('.');
            const lastKey = keys.pop();
            const target = keys.reduce((obj, key) => obj && obj[key], this.state);
            if (target && target.hasOwnProperty(lastKey)) {
                target[lastKey] = value;
            }
        },

        updateState(path, updates) {
            const current = this.getState(path);
            this.setState(path, { ...current, ...updates });
        },

        // 持久化状态到存储 (使用序列化适配器)
        async persistState(path, storageKey = null) {
            const value = this.getState(path);
            const key = storageKey || path.replace('.', '_');

            try {
                // 使用StateSerializer确保Set/Map对象正确序列化
                const serializedValue = StateSerializer.serialize(value);
                await storage.set(key, serializedValue);
            } catch (error) {
                console.error(`[App] 持久化状态失败 ${path}:`, error);
            }
        },

        // 批量持久化状态
        async persistMultipleState(mapping) {
            const promises = Object.entries(mapping).map(([path, storageKey]) =>
                this.persistState(path, storageKey)
            );

            try {
                await Promise.all(promises);
            } catch (error) {
                console.error('[App] 批量持久化状态失败:', error);
            }
        },

        // 从存储加载状态 (使用反序列化适配器)
        async loadState(path, storageKey = null) {
            const key = storageKey || path.replace('.', '_');

            try {
                const value = await storage.get(key, null);
                if (value !== null) {
                    const deserializedValue = StateSerializer.deserialize(value);
                    this.setState(path, deserializedValue);
                    return deserializedValue;
                }
            } catch (error) {
                console.error(`[App] 加载状态失败 ${path}:`, error);
            }
            return null;
        },

        // 加载所有持久化状态
        async loadPersistedState() {
            const stateMappings = {
                'exam': 'app_exam_state',
                'practice': 'app_practice_state',
                'ui': 'app_ui_state',
                'system': 'app_system_state'
            };

            for (const [path, storageKey] of Object.entries(stateMappings)) {
                await this.loadState(path, storageKey);
            }

            console.log('[App] 持久化状态加载完成');
        },

        // 保存所有状态到持久化存储
        async saveAllState() {
            const stateMappings = {
                'exam': 'app_exam_state',
                'practice': 'app_practice_state',
                'ui': 'app_ui_state',
                'system': 'app_system_state'
            };

            await this.persistMultipleState(stateMappings);
            console.log('[App] 所有状态已保存');
        },

        // 组件检查功能
        async checkComponents() {
            console.log('=== 组件加载检查 ===');

            try {
                if (window.AppActions && typeof window.AppActions.ensurePracticeSuite === 'function') {
                    await window.AppActions.ensurePracticeSuite();
                } else if (window.AppLazyLoader && typeof window.AppLazyLoader.ensureGroup === 'function') {
                    await window.AppLazyLoader.ensureGroup('practice-suite');
                }
            } catch (error) {
                console.warn('[App] 练习组件预加载失败:', error);
            }

            const components = {
                'SystemDiagnostics': window.SystemDiagnostics,
                'MarkdownExporter': window.MarkdownExporter,
                'practiceRecordModal': window.practiceRecordModal,
                'practiceHistoryEnhancer': window.practiceHistoryEnhancer
            };

            let allLoaded = true;

            Object.keys(components).forEach(name => {
                const component = components[name];
                const status = component ? '✅ 已加载' : '❌ 未加载';
                console.log(`${name}: ${status}`);

                if (!component) {
                    allLoaded = false;
                }
            });

            // 检查全局函数
            const functions = {
                'exportPracticeData': window.exportPracticeData,
                'showRecordDetails': window.showRecordDetails,
                'showMessage': window.showMessage
            };

            console.log('\n=== 全局函数检查 ===');
            Object.keys(functions).forEach(name => {
                const func = functions[name];
                const status = (typeof func === 'function') ? '✅ 可用' : '❌ 不可用';
                console.log(`${name}: ${status}`);
            });

            // 检查数据
            console.log('\n=== 数据检查 ===');
            const practiceRecordsCount = this.getState('practice.records')?.length || 0;
            console.log(`practiceRecords: ${practiceRecordsCount} 条记录`);

            if (window.storage) {
                try {
                    const arr = await window.storage.get('practice_records', []);
                    const count = Array.isArray(arr) ? arr.length : 0;
                    console.log(`storage.practice_records: ${count} 条记录`);
                } catch (_) {
                    console.log('storage.practice_records: 0 条记录');
                }
            }

            console.log('\n=== 检查完成 ===');

            if (allLoaded) {
                console.log('✅ 所有组件已正确加载');

                // 尝试初始化增强器
                if (window.practiceHistoryEnhancer && !window.practiceHistoryEnhancer.initialized) {
                    console.log('🔄 手动初始化增强器...');
                    window.practiceHistoryEnhancer.initialize();
                }
            } else {
                console.log('⚠️ 部分组件未加载，功能可能受限');
            }

            return { allLoaded, components, functions };
        },

        // 初始化全局变量访问兼容层
        initializeGlobalCompatibility() {
            if (window.appStateService) {
                try {
                    window.appStateService.installGlobalBindings(window);
                    window.appStateService.connectApp(this);
                } catch (error) {
                    console.warn('[App] AppStateService connect failed:', error);
                }
            }

            // 组件实例
            Object.defineProperty(window, 'dataIntegrityManager', {
                get: () => this.state.components.dataIntegrityManager,
                set: (value) => this.setState('components.dataIntegrityManager', value),
                configurable: true
            });

            Object.defineProperty(window, 'pdfHandler', {
                get: () => this.state.components.pdfHandler,
                set: (value) => this.setState('components.pdfHandler', value),
                configurable: true
            });

            Object.defineProperty(window, 'app', {
                get: () => this,
                set: (value) => { /* 保持app引用为当前实例 */ },
                configurable: true
            });

            // 全局组件检查函数
            window.checkComponents = () => this.checkComponents();
        },
    };

    global.ExamSystemAppMixins = global.ExamSystemAppMixins || {};
    global.ExamSystemAppMixins.state = mixin;
})(typeof window !== "undefined" ? window : globalThis);
