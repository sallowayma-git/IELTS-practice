/**
 * DOM操作优化工具
 * 减少重排和重绘，提升渲染性能
 */
(function(window) {
    'use strict';

    /**
     * 批量DOM操作 - 使用DocumentFragment
     * @param {HTMLElement} container - 容器元素
     * @param {Array<HTMLElement>} elements - 要插入的元素数组
     */
    function batchInsert(container, elements) {
        if (!container || !Array.isArray(elements) || elements.length === 0) {
            return;
        }

        const fragment = document.createDocumentFragment();
        elements.forEach(el => {
            if (el instanceof HTMLElement) {
                fragment.appendChild(el);
            }
        });

        container.appendChild(fragment);
    }

    /**
     * 批量创建元素
     * @param {string} tag - 元素标签
     * @param {Array<Object>} configs - 元素配置数组
     * @returns {Array<HTMLElement>} 创建的元素数组
     */
    function batchCreateElements(tag, configs) {
        if (!tag || !Array.isArray(configs)) {
            return [];
        }

        return configs.map(config => {
            const el = document.createElement(tag);
            
            if (config.className) {
                el.className = config.className;
            }
            
            if (config.textContent) {
                el.textContent = config.textContent;
            }
            
            if (config.innerHTML) {
                el.innerHTML = config.innerHTML;
            }
            
            if (config.attributes) {
                Object.entries(config.attributes).forEach(([key, value]) => {
                    el.setAttribute(key, value);
                });
            }
            
            if (config.dataset) {
                Object.entries(config.dataset).forEach(([key, value]) => {
                    el.dataset[key] = value;
                });
            }
            
            if (config.style) {
                Object.assign(el.style, config.style);
            }
            
            return el;
        });
    }

    /**
     * 延迟DOM更新 - 使用requestAnimationFrame
     * @param {Function} callback - 更新回调
     * @returns {number} requestAnimationFrame ID
     */
    function deferredUpdate(callback) {
        return requestAnimationFrame(() => {
            if (typeof callback === 'function') {
                callback();
            }
        });
    }

    /**
     * 批量延迟更新
     * @param {Array<Function>} callbacks - 回调数组
     */
    function batchDeferredUpdates(callbacks) {
        if (!Array.isArray(callbacks) || callbacks.length === 0) {
            return;
        }

        requestAnimationFrame(() => {
            callbacks.forEach(callback => {
                if (typeof callback === 'function') {
                    try {
                        callback();
                    } catch (error) {
                        console.error('[DOMOptimizer] 批量更新失败:', error);
                    }
                });
            });
        });
    }

    /**
     * 虚拟滚动 - 只渲染可见区域的元素
     * @param {Object} options - 配置选项
     * @returns {Object} 虚拟滚动控制器
     */
    function createVirtualScroller(options) {
        const {
            container,
            items = [],
            itemHeight = 50,
            renderItem,
            bufferSize = 5
        } = options;

        if (!container || typeof renderItem !== 'function') {
            throw new Error('container 和 renderItem 是必需的');
        }

        let scrollTop = 0;
        let visibleStart = 0;
        let visibleEnd = 0;

        const state = {
            items: [...items],
            renderedElements: new Map()
        };

        function calculateVisibleRange() {
            const containerHeight = container.clientHeight;
            const scrollTop = container.scrollTop;

            visibleStart = Math.max(0, Math.floor(scrollTop / itemHeight) - bufferSize);
            visibleEnd = Math.min(
                state.items.length,
                Math.ceil((scrollTop + containerHeight) / itemHeight) + bufferSize
            );
        }

        function render() {
            calculateVisibleRange();

            // 创建容器
            const viewport = container.querySelector('.virtual-scroll-viewport') || 
                document.createElement('div');
            viewport.className = 'virtual-scroll-viewport';
            viewport.style.height = `${state.items.length * itemHeight}px`;
            viewport.style.position = 'relative';

            // 清空现有内容
            viewport.innerHTML = '';

            // 渲染可见项
            const fragment = document.createDocumentFragment();
            for (let i = visibleStart; i < visibleEnd; i++) {
                const item = state.items[i];
                if (!item) continue;

                const element = renderItem(item, i);
                element.style.position = 'absolute';
                element.style.top = `${i * itemHeight}px`;
                element.style.height = `${itemHeight}px`;
                element.style.width = '100%';

                fragment.appendChild(element);
                state.renderedElements.set(i, element);
            }

            viewport.appendChild(fragment);

            if (!container.contains(viewport)) {
                container.appendChild(viewport);
            }
        }

        function handleScroll() {
            requestAnimationFrame(render);
        }

        function updateItems(newItems) {
            state.items = [...newItems];
            render();
        }

        function destroy() {
            container.removeEventListener('scroll', handleScroll);
            state.renderedElements.clear();
        }

        // 初始化
        container.addEventListener('scroll', handleScroll, { passive: true });
        render();

        return {
            render,
            updateItems,
            destroy,
            get visibleRange() {
                return { start: visibleStart, end: visibleEnd };
            }
        };
    }

    /**
     * 事件委托优化
     * @param {HTMLElement} container - 容器元素
     * @param {string} selector - 选择器
     * @param {string} eventType - 事件类型
     * @param {Function} handler - 事件处理器
     * @returns {Function} 移除监听器的函数
     */
    function delegateEvent(container, selector, eventType, handler) {
        if (!container || !selector || !eventType || typeof handler !== 'function') {
            throw new Error('所有参数都是必需的');
        }

        const wrappedHandler = (event) => {
            const target = event.target.closest(selector);
            if (target && container.contains(target)) {
                handler.call(target, event);
            }
        };

        container.addEventListener(eventType, wrappedHandler);

        return () => {
            container.removeEventListener(eventType, wrappedHandler);
        };
    }

    /**
     * 批量移除事件监听器
     * @param {Array<Function>} removers - 移除函数数组
     */
    function batchRemoveListeners(removers) {
        if (!Array.isArray(removers)) {
            return;
        }

        removers.forEach(remover => {
            if (typeof remover === 'function') {
                try {
                    remover();
                } catch (error) {
                    console.error('[DOMOptimizer] 移除监听器失败:', error);
                }
            }
        });
    }

    /**
     * 防抖 - 延迟执行
     * @param {Function} func - 要防抖的函数
     * @param {number} wait - 等待时间（毫秒）
     * @returns {Function} 防抖后的函数
     */
    function debounce(func, wait = 300) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    /**
     * 节流 - 限制执行频率
     * @param {Function} func - 要节流的函数
     * @param {number} limit - 时间限制（毫秒）
     * @returns {Function} 节流后的函数
     */
    function throttle(func, limit = 300) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    /**
     * 测量DOM操作性能
     * @param {string} label - 标签
     * @param {Function} operation - DOM操作函数
     * @returns {Promise<any>} 操作结果
     */
    async function measurePerformance(label, operation) {
        const startMark = `${label}-start`;
        const endMark = `${label}-end`;
        const measureName = `${label}-measure`;

        performance.mark(startMark);

        try {
            const result = await operation();
            performance.mark(endMark);
            performance.measure(measureName, startMark, endMark);

            const measure = performance.getEntriesByName(measureName)[0];
            console.log(`[DOMOptimizer] ${label}: ${measure.duration.toFixed(2)}ms`);

            // 清理
            performance.clearMarks(startMark);
            performance.clearMarks(endMark);
            performance.clearMeasures(measureName);

            return result;
        } catch (error) {
            console.error(`[DOMOptimizer] ${label} 失败:`, error);
            throw error;
        }
    }

    /**
     * 批量样式更新 - 减少重排
     * @param {HTMLElement} element - 元素
     * @param {Object} styles - 样式对象
     */
    function batchStyleUpdate(element, styles) {
        if (!element || !styles || typeof styles !== 'object') {
            return;
        }

        // 使用cssText一次性更新所有样式
        const cssText = Object.entries(styles)
            .map(([key, value]) => {
                const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
                return `${cssKey}: ${value}`;
            })
            .join('; ');

        element.style.cssText += '; ' + cssText;
    }

    /**
     * 离屏渲染 - 在隐藏状态下构建DOM
     * @param {Function} buildFn - 构建函数
     * @returns {HTMLElement} 构建的元素
     */
    function offscreenRender(buildFn) {
        if (typeof buildFn !== 'function') {
            throw new Error('buildFn 必须是函数');
        }

        const container = document.createElement('div');
        container.style.display = 'none';
        document.body.appendChild(container);

        try {
            const result = buildFn(container);
            document.body.removeChild(container);
            return result;
        } catch (error) {
            document.body.removeChild(container);
            throw error;
        }
    }

    // 导出API
    const api = {
        batchInsert,
        batchCreateElements,
        deferredUpdate,
        batchDeferredUpdates,
        createVirtualScroller,
        delegateEvent,
        batchRemoveListeners,
        debounce,
        throttle,
        measurePerformance,
        batchStyleUpdate,
        offscreenRender
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        window.DOMOptimizer = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
