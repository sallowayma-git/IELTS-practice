/**
 * HP页面核心桥接插件
 * 提供系统就绪回调、数据通信、事件监听等核心功能
 *
 * 功能：
 * 1. 系统就绪检测和回调机制
 * 2. 数据更新事件监听
 * 3. 提供获取examIndex和practiceRecords的API
 * 4. 节流功能
 * 5. 跨窗口消息通信支持
 */

(function() {
    'use strict';

    // 防止重复初始化
    if (window.hpCore) {
        console.log('[HP Core] 核心桥接已存在，跳过重复初始化');
        return;
    }

    // HP核心桥接对象
    const hpCore = {
        // 版本信息
        version: '1.0.0',

        // 初始化状态
        isReady: false,
        readyCallbacks: [],
        dataUpdateCallbacks: [],

        // 数据缓存
        examIndex: null,
        practiceRecords: null,
        lastUpdateTime: 0,

        // 节流控制
        throttleMap: new Map(),

        /**
         * 系统就绪回调
         * @param {Function} callback - 就绪后的回调函数
         */
        ready: function(callback) {
            if (typeof callback !== 'function') {
                console.warn('[HP Core] ready() 需要传入回调函数');
                return;
            }

            if (this.isReady) {
                // 如果已经就绪，立即执行回调
                callback();
            } else {
                // 否则添加到等待队列
                this.readyCallbacks.push(callback);
            }
        },

        /**
         * 数据更新事件订阅
         * @param {Function} callback - 数据更新回调函数
         */
        onDataUpdated: function(callback) {
            if (typeof callback !== 'function') {
                console.warn('[HP Core] onDataUpdated() 需要传入回调函数');
                return;
            }

            this.dataUpdateCallbacks.push(callback);

            // 如果已有数据，立即触发一次
            if (this.examIndex || this.practiceRecords) {
                setTimeout(() => {
                    callback({
                        examIndex: this.examIndex,
                        practiceRecords: this.practiceRecords,
                        timestamp: Date.now()
                    });
                }, 0);
            }
        },

        /**
         * 获取题库索引
         * @returns {Array} 题库数据
         */
        getExamIndex: function() {
            return this.examIndex || [];
        },

        /**
         * 获取练习记录
         * @returns {Array} 练习记录数据
         */
        getRecords: function() {
            return this.practiceRecords || [];
        },

        /**
         * 节流函数
         * @param {Function} func - 要节流的函数
         * @param {number} delay - 节流延迟(ms)
         * @returns {Function} 节流后的函数
         */
        throttle: function(func, delay) {
            if (typeof func !== 'function') {
                console.warn('[HP Core] throttle() 第一个参数需要是函数');
                return function() {};
            }

            const key = `${func.name || 'anonymous'}_${delay}`;

            return (...args) => {
                const now = Date.now();
                const lastCall = this.throttleMap.get(key) || 0;

                if (now - lastCall >= delay) {
                    this.throttleMap.set(key, now);
                    return func.apply(this, args);
                }
            };
        },

        /**
         * 内部方法：标记系统就绪
         */
        _markReady: function() {
            if (this.isReady) return;

            this.isReady = true;
            console.log('[HP Core] 系统就绪，执行等待回调');

            // 执行所有等待的回调
            this.readyCallbacks.forEach(callback => {
                try {
                    callback();
                } catch (error) {
                    console.error('[HP Core] 执行就绪回调失败:', error);
                }
            });

            // 清空回调队列
            this.readyCallbacks = [];
        },

        /**
         * 内部方法：触发数据更新事件
         */
        _triggerDataUpdate: function(data) {
            const updateData = {
                examIndex: data.examIndex || this.examIndex,
                practiceRecords: data.practiceRecords || this.practiceRecords,
                timestamp: Date.now()
            };

            // 更新缓存
            if (data.examIndex) this.examIndex = data.examIndex;
            if (data.practiceRecords) this.practiceRecords = data.practiceRecords;
            this.lastUpdateTime = updateData.timestamp;

            console.log('[HP Core] 触发数据更新事件，回调数量:', this.dataUpdateCallbacks.length);

            // 执行所有数据更新回调
            this.dataUpdateCallbacks.forEach(callback => {
                try {
                    callback(updateData);
                } catch (error) {
                    console.error('[HP Core] 执行数据更新回调失败:', error);
                }
            });
        },

        /**
         * 内部方法：初始化数据监听
         */
        _initDataListeners: function() {
            // 监听storage变化
            window.addEventListener('storage', (event) => {
                if (event.key === 'exam_index' || event.key === 'practice_records') {
                    console.log('[HP Core] 检测到storage变化:', event.key);
                    this._loadDataFromStorage();
                }
            });

            // 监听自定义事件
            window.addEventListener('hp:dataUpdated', (event) => {
                console.log('[HP Core] 收到hp:dataUpdated事件');
                if (event.detail) {
                    this._triggerDataUpdate(event.detail);
                }
            });

            // 监听跨窗口消息
            window.addEventListener('message', (event) => {
                // 安全检查
                if (location.protocol !== 'file:' &&
                    event.origin &&
                    event.origin !== 'null' &&
                    event.origin !== window.location.origin) {
                    return;
                }

                const data = event.data;
                if (data && data.type === 'PRACTICE_COMPLETE') {
                    console.log('[HP Core] 收到练习完成消息');
                    // 延迟触发数据更新，给系统时间处理数据
                    setTimeout(() => {
                        this._loadDataFromStorage();
                    }, 1000);
                }
            });

            // 监听系统初始化事件
            window.addEventListener('examIndexLoaded', () => {
                console.log('[HP Core] 检测到examIndexLoaded事件');
                this._loadDataFromStorage();
            });
        },

        /**
         * 内部方法：从storage和全局变量加载数据
         */
        _loadDataFromStorage: function() {
            try {
                // 尝试从storage获取数据
                let examIndex = null;
                let practiceRecords = null;

                // 优先从storage获取
                if (window.storage && typeof window.storage.get === 'function') {
                    examIndex = window.storage.get('exam_index', null);
                    practiceRecords = window.storage.get('practice_records', null);
                }

                // 降级到localStorage
                if (!examIndex) {
                    const examIndexStr = localStorage.getItem('exam_index');
                    if (examIndexStr) {
                        examIndex = JSON.parse(examIndexStr);
                    }
                }

                if (!practiceRecords) {
                    const recordsStr = localStorage.getItem('practice_records');
                    if (recordsStr) {
                        practiceRecords = JSON.parse(recordsStr);
                    }
                }

                // 如果storage中没有数据，尝试从全局变量获取
                if (!examIndex && window.completeExamIndex && Array.isArray(window.completeExamIndex)) {
                    examIndex = window.completeExamIndex;
                    console.log('[HP Core] 从全局变量加载题库数据:', examIndex.length, '条');

                    // 立即保存到storage中，确保下次能从storage获取
                    if (window.storage && typeof window.storage.set === 'function') {
                        window.storage.set('exam_index', examIndex);
                        console.log('[HP Core] 题库数据已保存到storage');
                    }
                }

                if (!practiceRecords && window.practiceRecords && Array.isArray(window.practiceRecords)) {
                    practiceRecords = window.practiceRecords;
                    console.log('[HP Core] 从全局变量加载练习记录:', practiceRecords.length, '条');

                    // 立即保存到storage中，确保下次能从storage获取
                    if (window.storage && typeof window.storage.set === 'function') {
                        window.storage.set('practice_records', practiceRecords);
                        console.log('[HP Core] 练习记录已保存到storage');
                    }
                }

                // 触发数据更新
                if (examIndex || practiceRecords) {
                    this._triggerDataUpdate({
                        examIndex: examIndex,
                        practiceRecords: practiceRecords
                    });
                }

                // 如果有数据且系统未就绪，标记为就绪
                if ((examIndex && examIndex.length > 0) || (practiceRecords && practiceRecords.length > 0)) {
                    this._markReady();
                } else if (!this.isReady) {
                    // 如果没有数据但系统未就绪，也标记为就绪（数据稍后加载）
                    this._markReady();
                }

            } catch (error) {
                console.error('[HP Core] 从storage加载数据失败:', error);
            }
        },

        /**
         * 内部方法：定期检查数据状态
         */
        _startDataPolling: function() {
            // 每5秒检查一次数据状态
            setInterval(() => {
                if (!this.isReady) {
                    this._loadDataFromStorage();
                }
            }, 5000);
        },

        /**
         * 获取系统状态信息
         */
        getStatus: function() {
            return {
                version: this.version,
                isReady: this.isReady,
                examCount: this.examIndex ? this.examIndex.length : 0,
                recordCount: this.practiceRecords ? this.practiceRecords.length : 0,
                lastUpdateTime: this.lastUpdateTime,
                callbackCount: this.readyCallbacks.length + this.dataUpdateCallbacks.length
            };
        }
    };

    // 初始化
    hpCore._initDataListeners();
    hpCore._startDataPolling();

    // 立即尝试加载数据
    hpCore._loadDataFromStorage();

    // 导出到全局
    window.hpCore = hpCore;

    console.log('[HP Core] 核心桥接插件初始化完成', hpCore.getStatus());

    /**
     * 确保全局数据被正确初始化
     */
    hpCore._ensureGlobalDataInitialized = function() {
        // 延迟执行，确保全局脚本已加载
        setTimeout(() => {
            try {
                // 检查全局数据是否可用
                if (window.completeExamIndex && Array.isArray(window.completeExamIndex)) {
                    console.log('[HP Core] 检测到全局题库数据:', window.completeExamIndex.length, '条');

                    // 如果storage中没有数据，立即保存全局数据
                    if (window.storage && typeof window.storage.get === 'function') {
                        const storedExamIndex = window.storage.get('exam_index', null);
                        if (!storedExamIndex || storedExamIndex.length === 0) {
                            window.storage.set('exam_index', window.completeExamIndex);
                            console.log('[HP Core] 全局题库数据已保存到storage');
                        }
                    }
                }

                if (window.listeningExamIndex && Array.isArray(window.listeningExamIndex)) {
                    console.log('[HP Core] 检测到全局听力数据:', window.listeningExamIndex.length, '条');

                    // 合并听力数据到题库中
                    if (window.completeExamIndex && Array.isArray(window.completeExamIndex)) {
                        const mergedExamIndex = [...window.completeExamIndex, ...window.listeningExamIndex];

                        if (window.storage && typeof window.storage.set === 'function') {
                            window.storage.set('exam_index', mergedExamIndex);
                            console.log('[HP Core] 合并后的题库数据已保存到storage:', mergedExamIndex.length, '条');
                        }
                    }
                }

                // 触发数据更新事件
                if (window.completeExamIndex || window.listeningExamIndex) {
                    this._triggerDataUpdate({
                        examIndex: window.completeExamIndex || [],
                        practiceRecords: window.practiceRecords || []
                    });
                }

            } catch (error) {
                console.error('[HP Core] 全局数据初始化失败:', error);
            }
        }, 500); // 延迟500ms确保全局脚本加载完成
    };

    // 确保全局数据被正确初始化
    hpCore._ensureGlobalDataInitialized();

    // 开发助手函数
    if (typeof window !== 'undefined' && window.console) {
        window.debugHPCore = function() {
            console.log('[HP Core Debug]', hpCore.getStatus());
            console.log('Exam Index Sample:', hpCore.getExamIndex().slice(0, 3));
            console.log('Records Sample:', hpCore.getRecords().slice(0, 3));
        };
    }

})();
