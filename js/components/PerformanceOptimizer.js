/**
 * 性能优化器
 * 负责系统的各种性能优化功能
 */
class PerformanceOptimizer {
    constructor() {
        this.cache = new Map();
        this.loadingStates = new Map();
        this.debouncedFunctions = new Map();
        this.throttledFunctions = new Map();
        this.observedElements = new Set();
        this.performanceMetrics = {
            loadTimes: [],
            renderTimes: [],
            cacheHits: 0,
            cacheMisses: 0
        };
        
        // 初始化性能监控
        this.initPerformanceMonitoring();
        
        console.log('[PerformanceOptimizer] 性能优化器已初始化');
    }

    /**
     * 初始化性能监控
     */
    initPerformanceMonitoring() {
        // 监控页面加载性能
        if (window.performance && window.performance.timing) {
            window.addEventListener('load', () => {
                const timing = window.performance.timing;
                const loadTime = timing.loadEventEnd - timing.navigationStart;
                this.recordLoadTime(loadTime);
                console.log(`[PerformanceOptimizer] 页面加载时间: ${loadTime}ms`);
            });
        }

        // 监控内存使用情况
        if (window.performance && window.performance.memory) {
            setInterval(() => {
                this.checkMemoryUsage();
            }, 30000); // 每30秒检查一次
        }
    }

    /**
     * 缓存管理
     */
    
    /**
     * 设置缓存
     */
    setCache(key, data, options = {}) {
        const cacheItem = {
            data: data,
            timestamp: Date.now(),
            ttl: options.ttl || 300000, // 默认5分钟
            size: this.calculateDataSize(data),
            accessCount: 0,
            lastAccess: Date.now()
        };

        this.cache.set(key, cacheItem);
        
        // 清理过期缓存
        this.cleanExpiredCache();
        
        console.log(`[PerformanceOptimizer] 缓存已设置: ${key} (${cacheItem.size} bytes)`);
    }

    /**
     * 获取缓存
     */
    getCache(key) {
        const cacheItem = this.cache.get(key);
        
        if (!cacheItem) {
            this.performanceMetrics.cacheMisses++;
            return null;
        }

        // 检查是否过期
        if (Date.now() - cacheItem.timestamp > cacheItem.ttl) {
            this.cache.delete(key);
            this.performanceMetrics.cacheMisses++;
            return null;
        }

        // 更新访问信息
        cacheItem.accessCount++;
        cacheItem.lastAccess = Date.now();
        this.performanceMetrics.cacheHits++;
        
        return cacheItem.data;
    }

    /**
     * 清理过期缓存
     */
    cleanExpiredCache() {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [key, item] of this.cache.entries()) {
            if (now - item.timestamp > item.ttl) {
                this.cache.delete(key);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`[PerformanceOptimizer] 已清理 ${cleanedCount} 个过期缓存项`);
        }
    }

    /**
     * 获取缓存统计信息
     */
    getCacheStats() {
        let totalSize = 0;
        let itemCount = 0;
        
        for (const item of this.cache.values()) {
            totalSize += item.size;
            itemCount++;
        }

        return {
            itemCount: itemCount,
            totalSize: totalSize,
            hitRate: this.performanceMetrics.cacheHits / 
                    (this.performanceMetrics.cacheHits + this.performanceMetrics.cacheMisses) * 100
        };
    }

    /**
     * 按需加载管理
     */
    
    /**
     * 懒加载脚本
     */
    async lazyLoadScript(src, options = {}) {
        // 检查是否已经加载
        if (this.loadingStates.has(src)) {
            return this.loadingStates.get(src);
        }

        // 检查缓存
        const cached = this.getCache(`script_${src}`);
        if (cached) {
            return Promise.resolve(cached);
        }

        const loadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            
            if (options.defer) {
                script.defer = true;
            }

            script.onload = () => {
                console.log(`[PerformanceOptimizer] 脚本加载成功: ${src}`);
                this.setCache(`script_${src}`, true, { ttl: 3600000 }); // 1小时缓存
                resolve(true);
            };

            script.onerror = (error) => {
                console.error(`[PerformanceOptimizer] 脚本加载失败: ${src}`, error);
                reject(error);
            };

            document.head.appendChild(script);
        });

        this.loadingStates.set(src, loadPromise);
        return loadPromise;
    }

    /**
     * 懒加载样式
     */
    async lazyLoadStyle(href, options = {}) {
        // 检查是否已经加载
        if (this.loadingStates.has(href)) {
            return this.loadingStates.get(href);
        }

        const loadPromise = new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            
            if (options.media) {
                link.media = options.media;
            }

            link.onload = () => {
                console.log(`[PerformanceOptimizer] 样式加载成功: ${href}`);
                resolve(true);
            };

            link.onerror = (error) => {
                console.error(`[PerformanceOptimizer] 样式加载失败: ${href}`, error);
                reject(error);
            };

            document.head.appendChild(link);
        });

        this.loadingStates.set(href, loadPromise);
        return loadPromise;
    }

    /**
     * 预加载资源
     */
    preloadResource(url, type = 'fetch') {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.href = url;
        link.as = type;
        document.head.appendChild(link);
        
        console.log(`[PerformanceOptimizer] 预加载资源: ${url}`);
    }

    /**
     * 防抖和节流
     */
    
    /**
     * 创建防抖函数
     */
    debounce(func, delay, key) {
        if (this.debouncedFunctions.has(key)) {
            return this.debouncedFunctions.get(key);
        }

        const debouncedFunc = (...args) => {
            clearTimeout(debouncedFunc.timeoutId);
            debouncedFunc.timeoutId = setTimeout(() => func.apply(this, args), delay);
        };

        this.debouncedFunctions.set(key, debouncedFunc);
        return debouncedFunc;
    }

    /**
     * 创建节流函数
     */
    throttle(func, delay, key) {
        if (this.throttledFunctions.has(key)) {
            return this.throttledFunctions.get(key);
        }

        let lastCall = 0;
        const throttledFunc = (...args) => {
            const now = Date.now();
            if (now - lastCall >= delay) {
                lastCall = now;
                return func.apply(this, args);
            }
        };

        this.throttledFunctions.set(key, throttledFunc);
        return throttledFunc;
    }

    /**
     * 虚拟滚动实现
     */
    createVirtualScroller(container, items, renderItem, options = {}) {
        const itemHeight = options.itemHeight || 50;
        const bufferSize = options.bufferSize || 5;
        const containerHeight = container.clientHeight;
        const visibleCount = Math.ceil(containerHeight / itemHeight) + bufferSize * 2;

        let scrollTop = 0;
        let startIndex = 0;
        let endIndex = Math.min(visibleCount, items.length);

        // 创建虚拟容器
        const virtualContainer = document.createElement('div');
        virtualContainer.style.height = `${items.length * itemHeight}px`;
        virtualContainer.style.position = 'relative';

        // 创建可见项容器
        const visibleContainer = document.createElement('div');
        visibleContainer.style.position = 'absolute';
        visibleContainer.style.top = '0';
        visibleContainer.style.width = '100%';

        virtualContainer.appendChild(visibleContainer);
        container.appendChild(virtualContainer);

        // 渲染可见项
        const renderVisibleItems = () => {
            const startTime = performance.now();
            
            visibleContainer.innerHTML = '';
            visibleContainer.style.transform = `translateY(${startIndex * itemHeight}px)`;

            for (let i = startIndex; i < endIndex; i++) {
                if (i < items.length) {
                    const itemElement = renderItem(items[i], i);
                    itemElement.style.height = `${itemHeight}px`;
                    visibleContainer.appendChild(itemElement);
                }
            }

            const renderTime = performance.now() - startTime;
            this.recordRenderTime(renderTime);
        };

        // 滚动事件处理
        const handleScroll = this.throttle(() => {
            scrollTop = container.scrollTop;
            const newStartIndex = Math.floor(scrollTop / itemHeight);
            const newEndIndex = Math.min(newStartIndex + visibleCount, items.length);

            if (newStartIndex !== startIndex || newEndIndex !== endIndex) {
                startIndex = Math.max(0, newStartIndex - bufferSize);
                endIndex = Math.min(items.length, newEndIndex + bufferSize);
                renderVisibleItems();
            }
        }, 16, `virtual_scroll_${container.id || 'default'}`); // 60fps

        container.addEventListener('scroll', handleScroll);

        // 初始渲染
        renderVisibleItems();

        return {
            update: (newItems) => {
                items = newItems;
                virtualContainer.style.height = `${items.length * itemHeight}px`;
                startIndex = 0;
                endIndex = Math.min(visibleCount, items.length);
                renderVisibleItems();
            },
            destroy: () => {
                container.removeEventListener('scroll', handleScroll);
                container.removeChild(virtualContainer);
            }
        };
    }

    /**
     * 图片懒加载
     */
    setupImageLazyLoading(selector = 'img[data-src]') {
        if (!window.IntersectionObserver) {
            // 降级方案：立即加载所有图片
            document.querySelectorAll(selector).forEach(img => {
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    delete img.dataset.src;
                }
            });
            return;
        }

        const imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        delete img.dataset.src;
                        img.classList.remove('lazy');
                        imageObserver.unobserve(img);
                    }
                }
            });
        }, {
            rootMargin: '50px 0px' // 提前50px开始加载
        });

        document.querySelectorAll(selector).forEach(img => {
            imageObserver.observe(img);
        });

        console.log(`[PerformanceOptimizer] 图片懒加载已设置: ${selector}`);
    }

    /**
     * 内容懒加载
     */
    setupContentLazyLoading(selector = '.lazy-content') {
        if (!window.IntersectionObserver) return;

        const contentObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const element = entry.target;
                    const loadFunction = element.dataset.loadFunction;
                    
                    if (loadFunction && window[loadFunction]) {
                        window[loadFunction](element);
                        contentObserver.unobserve(element);
                    }
                }
            });
        });

        document.querySelectorAll(selector).forEach(element => {
            contentObserver.observe(element);
        });
    }

    /**
     * 性能监控
     */
    
    /**
     * 记录加载时间
     */
    recordLoadTime(time) {
        this.performanceMetrics.loadTimes.push({
            time: time,
            timestamp: Date.now()
        });

        // 只保留最近100次记录
        if (this.performanceMetrics.loadTimes.length > 100) {
            this.performanceMetrics.loadTimes.shift();
        }
    }

    /**
     * 记录渲染时间
     */
    recordRenderTime(time) {
        this.performanceMetrics.renderTimes.push({
            time: time,
            timestamp: Date.now()
        });

        // 只保留最近100次记录
        if (this.performanceMetrics.renderTimes.length > 100) {
            this.performanceMetrics.renderTimes.shift();
        }
    }

    /**
     * 检查内存使用情况
     */
    checkMemoryUsage() {
        if (window.performance && window.performance.memory) {
            const memory = window.performance.memory;
            const usagePercent = (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100;
            
            if (usagePercent > 80) {
                console.warn(`[PerformanceOptimizer] 内存使用率过高: ${usagePercent.toFixed(2)}%`);
                this.performGarbageCollection();
            }
        }
    }

    /**
     * 执行垃圾回收优化
     */
    performGarbageCollection() {
        console.log('[PerformanceOptimizer] 执行内存优化...');
        
        // 清理过期缓存
        this.cleanExpiredCache();
        
        // 清理未使用的防抖/节流函数
        this.cleanupUnusedFunctions();
        
        // 建议浏览器进行垃圾回收（如果支持）
        if (window.gc) {
            window.gc();
        }
    }

    /**
     * 清理未使用的函数
     */
    cleanupUnusedFunctions() {
        // 这里可以实现更复杂的清理逻辑
        console.log('[PerformanceOptimizer] 清理未使用的函数');
    }

    /**
     * 获取性能报告
     */
    getPerformanceReport() {
        const loadTimes = this.performanceMetrics.loadTimes;
        const renderTimes = this.performanceMetrics.renderTimes;
        
        const avgLoadTime = loadTimes.length > 0 ? 
            loadTimes.reduce((sum, item) => sum + item.time, 0) / loadTimes.length : 0;
            
        const avgRenderTime = renderTimes.length > 0 ?
            renderTimes.reduce((sum, item) => sum + item.time, 0) / renderTimes.length : 0;

        return {
            cache: this.getCacheStats(),
            performance: {
                averageLoadTime: Math.round(avgLoadTime),
                averageRenderTime: Math.round(avgRenderTime * 100) / 100,
                totalLoadSamples: loadTimes.length,
                totalRenderSamples: renderTimes.length
            },
            memory: window.performance && window.performance.memory ? {
                used: Math.round(window.performance.memory.usedJSHeapSize / 1024 / 1024),
                total: Math.round(window.performance.memory.totalJSHeapSize / 1024 / 1024),
                limit: Math.round(window.performance.memory.jsHeapSizeLimit / 1024 / 1024)
            } : null
        };
    }

    /**
     * 计算数据大小（估算）
     */
    calculateDataSize(data) {
        try {
            return JSON.stringify(data).length * 2; // UTF-16编码估算
        } catch (error) {
            return 0;
        }
    }

    /**
     * 批量处理优化
     */
    batchProcess(items, processor, batchSize = 100, delay = 10) {
        return new Promise((resolve) => {
            let index = 0;
            const results = [];

            const processBatch = () => {
                const endIndex = Math.min(index + batchSize, items.length);
                
                for (let i = index; i < endIndex; i++) {
                    results.push(processor(items[i], i));
                }

                index = endIndex;

                if (index < items.length) {
                    setTimeout(processBatch, delay);
                } else {
                    resolve(results);
                }
            };

            processBatch();
        });
    }

    /**
     * 清理资源
     */
    cleanup() {
        console.log('[PerformanceOptimizer] 清理资源');
        this.cache.clear();
        this.loadingStates.clear();
        this.debouncedFunctions.clear();
        this.throttledFunctions.clear();
        this.observedElements.clear();
    }
}

// 导出类
window.PerformanceOptimizer = PerformanceOptimizer;