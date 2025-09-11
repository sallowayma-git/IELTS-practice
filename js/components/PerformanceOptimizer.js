/**
 * 虚拟滚动器组件
 * 用于处理大量数据的高性能渲染
 */
class VirtualScroller {
    constructor(container, items, renderer, options = {}) {
        this.container = container;
        this.items = items;
        this.renderer = renderer;
        this.itemHeight = options.itemHeight || 120;
        this.bufferSize = options.bufferSize || 5;
        this.containerHeight = options.containerHeight || this.getContainerHeight();
        
        this.visibleStart = 0;
        this.visibleEnd = 0;
        this.renderedItems = new Map();
        this.scrollTop = 0;
        this.totalHeight = 0;
        
        this.initialize();
    }
    
    /**
     * 初始化虚拟滚动器
     */
    initialize() {
        console.log('[VirtualScroller] 初始化虚拟滚动器', {
            items: this.items.length,
            itemHeight: this.itemHeight,
            containerHeight: this.containerHeight
        });
        
        this.setupScrollContainer();
        this.calculateVisibleRange();
        this.renderVisible();
        this.setupScrollListener();
    }
    
    /**
     * 设置滚动容器
     */
    setupScrollContainer() {
        // 计算总高度
        this.totalHeight = this.items.length * this.itemHeight;
        
        // 设置容器样式
        this.container.style.position = 'relative';
        this.container.style.overflow = 'auto';
        this.container.style.height = `${this.containerHeight}px`;
        
        // 创建虚拟内容区域
        this.viewport = document.createElement('div');
        this.viewport.style.position = 'relative';
        this.viewport.style.height = `${this.totalHeight}px`;
        this.viewport.style.width = '100%';
        
        // 清空容器并添加视窗
        this.container.innerHTML = '';
        this.container.appendChild(this.viewport);
    }
    
    /**
     * 计算可见范围
     */
    calculateVisibleRange() {
        const scrollTop = this.container.scrollTop;
        const visibleItems = Math.ceil(this.containerHeight / this.itemHeight);
        
        this.visibleStart = Math.max(0, 
            Math.floor(scrollTop / this.itemHeight) - this.bufferSize
        );
        this.visibleEnd = Math.min(this.items.length - 1,
            this.visibleStart + visibleItems + (this.bufferSize * 2)
        );
        
        this.scrollTop = scrollTop;
    }
    
    /**
     * 渲染可见元素
     */
    renderVisible() {
        // 清理不可见的元素
        this.renderedItems.forEach((element, index) => {
            if (index < this.visibleStart || index > this.visibleEnd) {
                element.remove();
                this.renderedItems.delete(index);
            }
        });
        
        // 渲染可见的元素
        for (let i = this.visibleStart; i <= this.visibleEnd; i++) {
            if (!this.renderedItems.has(i)) {
                const element = this.renderer(this.items[i], i);
                element.style.position = 'absolute';
                element.style.top = `${i * this.itemHeight}px`;
                element.style.width = '100%';
                element.style.boxSizing = 'border-box';
                
                this.viewport.appendChild(element);
                this.renderedItems.set(i, element);
            }
        }
    }
    
    /**
     * 设置滚动监听器
     */
    setupScrollListener() {
        let scrollTimer = null;
        
        this.container.addEventListener('scroll', () => {
            // 使用防抖优化滚动性能
            if (scrollTimer) {
                clearTimeout(scrollTimer);
            }
            
            scrollTimer = setTimeout(() => {
                this.calculateVisibleRange();
                this.renderVisible();
            }, 10);
        }, { passive: true });
    }
    
    /**
     * 更新数据
     */
    updateItems(newItems) {
        this.items = newItems;
        this.totalHeight = this.items.length * this.itemHeight;
        this.viewport.style.height = `${this.totalHeight}px`;
        
        // 清除所有渲染的元素
        this.renderedItems.forEach(element => element.remove());
        this.renderedItems.clear();
        
        // 重新计算并渲染
        this.calculateVisibleRange();
        this.renderVisible();
    }
    
    /**
     * 滚动到指定索引
     */
    scrollToIndex(index) {
        const targetScrollTop = index * this.itemHeight;
        this.container.scrollTop = targetScrollTop;
    }
    
    /**
     * 获取容器高度
     */
    getContainerHeight() {
        const computedStyle = window.getComputedStyle(this.container);
        const height = parseFloat(computedStyle.height);
        return height > 0 ? height : 600; // 默认600px
    }
    
    /**
     * 销毁虚拟滚动器
     */
    destroy() {
        console.log('[VirtualScroller] 销毁虚拟滚动器');
        
        // 清除所有渲染的元素
        this.renderedItems.forEach(element => element.remove());
        this.renderedItems.clear();
        
        // 移除滚动监听器
        this.container.removeEventListener('scroll', this.handleScroll);
        
        // 清空容器
        this.container.innerHTML = '';
    }
}

/**
 * 性能优化器
 * 提供各种性能优化功能
 */
class PerformanceOptimizer {
    constructor() {
        this.cache = new Map();
        this.cacheTTL = new Map();
        this.observers = new Map();
        
        // 性能监控
        this.performanceMetrics = {
            renderTime: [],
            scrollPerformance: [],
            cacheHits: 0,
            cacheMisses: 0
        };
        
        this.initialize();
    }
    
    /**
     * 初始化性能优化器
     */
    initialize() {
        console.log('[PerformanceOptimizer] 初始化性能优化器');
        
        // 设置缓存清理定时器
        setInterval(() => {
            this.cleanExpiredCache();
        }, 60000); // 每分钟清理一次过期缓存
        
        // 监控性能指标
        this.setupPerformanceMonitoring();
    }
    
    /**
     * 设置缓存
     */
    setCache(key, value, options = {}) {
        const ttl = options.ttl || 300000; // 默认5分钟
        
        this.cache.set(key, value);
        this.cacheTTL.set(key, Date.now() + ttl);
        
        console.log(`[PerformanceOptimizer] 缓存已设置: ${key}`);
    }
    
    /**
     * 获取缓存
     */
    getCache(key) {
        const now = Date.now();
        const expiry = this.cacheTTL.get(key);
        
        if (expiry && now > expiry) {
            // 缓存已过期
            this.cache.delete(key);
            this.cacheTTL.delete(key);
            this.performanceMetrics.cacheMisses++;
            return null;
        }
        
        if (this.cache.has(key)) {
            this.performanceMetrics.cacheHits++;
            return this.cache.get(key);
        }
        
        this.performanceMetrics.cacheMisses++;
        return null;
    }
    
    /**
     * 清理过期缓存
     */
    cleanExpiredCache() {
        const now = Date.now();
        let cleanedCount = 0;
        
        this.cacheTTL.forEach((expiry, key) => {
            if (now > expiry) {
                this.cache.delete(key);
                this.cacheTTL.delete(key);
                cleanedCount++;
            }
        });
        
        if (cleanedCount > 0) {
            console.log(`[PerformanceOptimizer] 清理了 ${cleanedCount} 个过期缓存项`);
        }
    }
    
    /**
     * 批量处理大数据
     */
    batchProcess(items, processor, batchSize = 10, delay = 5) {
        return new Promise((resolve) => {
            let index = 0;
            const results = [];
            
            const processBatch = () => {
                const endIndex = Math.min(index + batchSize, items.length);
                
                for (let i = index; i < endIndex; i++) {
                    const result = processor(items[i], i);
                    results.push(result);
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
     * 防抖函数
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    /**
     * 节流函数
     */
    throttle(func, limit) {
        let inThrottle;
        return function executedFunction(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
    
    /**
     * 预加载图片
     */
    preloadImages(imageUrls) {
        const promises = imageUrls.map(url => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(url);
                img.onerror = () => reject(url);
                img.src = url;
            });
        });
        
        return Promise.allSettled(promises);
    }
    
    /**
     * 创建虚拟滚动器
     */
    createVirtualScroller(container, items, renderer, options) {
        return new VirtualScroller(container, items, renderer, options);
    }
    
    /**
     * 优化渲染性能
     */
    optimizeRender(renderFunc) {
        return (...args) => {
            const startTime = performance.now();
            
            // 使用requestAnimationFrame优化渲染
            requestAnimationFrame(() => {
                renderFunc(...args);
                
                const endTime = performance.now();
                const renderTime = endTime - startTime;
                
                this.performanceMetrics.renderTime.push(renderTime);
                
                // 只保留最近100次的性能数据
                if (this.performanceMetrics.renderTime.length > 100) {
                    this.performanceMetrics.renderTime.shift();
                }
            });
        };
    }
    
    /**
     * 设置性能监控
     */
    setupPerformanceMonitoring() {
        // 监控页面性能
        if (typeof PerformanceObserver !== 'undefined') {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.entryType === 'measure') {
                        console.log(`[Performance] ${entry.name}: ${entry.duration.toFixed(2)}ms`);
                    }
                }。
            });
            
            observer.observe({ entryTypes: ['measure'] });
            this.observers.set('performance', observer);
        }
    }
    
    /**
     * 获取性能统计
     */
    getPerformanceStats() {
        const renderTimes = this.performanceMetrics.renderTime;
        const avgRenderTime = renderTimes.length > 0 
            ? renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length 
            : 0;
            
        const cacheHitRate = this.performanceMetrics.cacheHits + this.performanceMetrics.cacheMisses > 0
            ? (this.performanceMetrics.cacheHits / (this.performanceMetrics.cacheHits + this.performanceMetrics.cacheMisses)) * 100
            : 0;
            
        return {
            averageRenderTime: avgRenderTime.toFixed(2),
            cacheHitRate: cacheHitRate.toFixed(2),
            cacheSize: this.cache.size,
            totalCacheHits: this.performanceMetrics.cacheHits,
            totalCacheMisses: this.performanceMetrics.cacheMisses
        };
    }
    
    /**
     * 销毁性能优化器
     */
    destroy() {
        console.log('[PerformanceOptimizer] 销毁性能优化器');
        
        // 清理缓存
        this.cache.clear();
        this.cacheTTL.clear();
        
        // 断开观察者
        this.observers.forEach(observer => {
            observer.disconnect();
        });
        this.observers.clear();
    }
}

// 导出到全局
window.VirtualScroller = VirtualScroller;
window.PerformanceOptimizer = PerformanceOptimizer;
