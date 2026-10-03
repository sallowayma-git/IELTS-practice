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
                timeout = null;
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
        return new window.VirtualScroller(container, items, renderer, options);
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
                }
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
     * 记录加载时间 - 向后兼容API修复
     */
    recordLoadTime(loadTime) {
        console.log(`[PerformanceOptimizer] 记录加载时间: ${loadTime}ms`);
        this.performanceMetrics.loadTime = this.performanceMetrics.loadTime || [];
        this.performanceMetrics.loadTime.push(loadTime);

        // 只保留最近100次记录
        if (this.performanceMetrics.loadTime.length > 100) {
            this.performanceMetrics.loadTime.shift();
        }
    }

    /**
     * 记录渲染时间 - 向后兼容API修复
     */
    recordRenderTime(renderTime) {
        console.log(`[PerformanceOptimizer] 记录渲染时间: ${renderTime}ms`);

        // 复用现有的renderTime数组
        this.performanceMetrics.renderTime.push(renderTime);

        // 只保留最近100次记录
        if (this.performanceMetrics.renderTime.length > 100) {
            this.performanceMetrics.renderTime.shift();
        }
    }

    /**
     * 清理资源 - 向后兼容API修复
     */
    cleanup() {
        console.log('[PerformanceOptimizer] 清理资源');

        // 清理过期缓存
        this.cleanExpiredCache();

        // 清理性能指标（保留基础结构）
        this.performanceMetrics = {
            renderTime: [],
            scrollPerformance: [],
            cacheHits: this.performanceMetrics.cacheHits,
            cacheMisses: this.performanceMetrics.cacheMisses,
            loadTime: this.performanceMetrics.loadTime || []
        };
    }

    /**
     * 获取性能报告 - 兼容性修复：恢复旧字段结构
     */
    getPerformanceReport() {
        const stats = this.getPerformanceStats();
        const loadTimes = this.performanceMetrics.loadTime || [];
        const renderTimes = this.performanceMetrics.renderTime;

        // 计算平均值
        const avgLoadTime = loadTimes.length > 0
            ? loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length
            : 0;
        const avgRenderTime = renderTimes.length > 0
            ? renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length
            : 0;

        // 估算缓存大小（简化计算）
        const estimatedCacheSize = this.cache.size * 1024; // 假设每项1KB

        return {
            // 新结构（保留）
            timestamp: new Date().toISOString(),
            summary: {
                averageRenderTime: parseFloat(stats.averageRenderTime),
                cacheHitRate: parseFloat(stats.cacheHitRate),
                cacheSize: stats.cacheSize,
                totalCacheHits: stats.totalCacheHits,
                totalCacheMisses: stats.totalCacheMisses
            },
            detailed: {
                recentRenderTimes: renderTimes.slice(-10),
                recentLoadTimes: loadTimes.slice(-10),
                cacheEntries: Array.from(this.cache.keys()).slice(0, 10)
            },
            recommendations: this.generateRecommendations(stats),

            // 旧结构（兼容性修复）
            cache: {
                itemCount: this.cache.size,
                totalSize: estimatedCacheSize,
                hitRate: parseFloat(stats.cacheHitRate)
            },
            performance: {
                averageLoadTime: Math.round(avgLoadTime),
                averageRenderTime: Math.round(avgRenderTime),
                totalLoadSamples: loadTimes.length,
                totalRenderSamples: renderTimes.length
            },
            memory: {
                used: Math.round(estimatedCacheSize / 1024 / 1024), // MB
                total: Math.round(estimatedCacheSize / 1024 / 1024), // MB
                limit: 100 // MB，假设限制
            }
        };
    }

    /**
     * 生成性能建议
     */
    generateRecommendations(stats) {
        const recommendations = [];

        if (parseFloat(stats.cacheHitRate) < 70) {
            recommendations.push({
                type: 'cache',
                message: '缓存命中率较低，建议增加缓存时间或预加载策略'
            });
        }

        if (parseFloat(stats.averageRenderTime) > 100) {
            recommendations.push({
                type: 'render',
                message: '平均渲染时间较长，建议使用虚拟滚动或减少DOM操作'
            });
        }

        if (stats.cacheSize > 1000) {
            recommendations.push({
                type: 'memory',
                message: '缓存项较多，建议定期清理或优化缓存策略'
            });
        }

        return recommendations.length > 0 ? recommendations : [{
            type: 'good',
            message: '系统性能良好，无明显问题'
        }];
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
window.PerformanceOptimizer = PerformanceOptimizer;
