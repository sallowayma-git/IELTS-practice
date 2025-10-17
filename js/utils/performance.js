/**
 * 性能优化工具库 - Linus式实用主义
 * 整合所有性能相关的重复代码
 */

/**
 * 统一缓存系统
 */
class CacheManager {
    constructor(options = {}) {
        this.cache = new Map();
        this.maxSize = options.maxSize || 100;
        this.defaultTTL = options.defaultTTL || 300000; // 5分钟
        this.timers = new Map();
        this.hitCount = 0;
        this.missCount = 0;
    }

    /**
     * 设置缓存
     * @param {string} key 键
     * @param {any} value 值
     * @param {number} ttl 过期时间(毫秒)
     */
    set(key, value, ttl = this.defaultTTL) {
        // 清理过期的定时器
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
        }

        // 检查容量
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            // LRU: 删除最旧的条目
            const firstKey = this.cache.keys().next().value;
            this.delete(firstKey);
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now(),
            ttl
        });

        // 设置过期定时器
        if (ttl > 0) {
            const timer = setTimeout(() => {
                this.delete(key);
            }, ttl);
            this.timers.set(key, timer);
        }
    }

    /**
     * 获取缓存
     */
    get(key) {
        const item = this.cache.get(key);
        if (!item) {
            this.missCount++;
            return null;
        }

        // 检查过期
        if (item.ttl > 0 && Date.now() - item.timestamp > item.ttl) {
            this.delete(key);
            this.missCount++;
            return null;
        }

        // LRU: 移到最后
        this.cache.delete(key);
        this.cache.set(key, item);
        this.hitCount++;

        return item.value;
    }

    /**
     * 删除缓存
     */
    delete(key) {
        this.cache.delete(key);
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
            this.timers.delete(key);
        }
    }

    /**
     * 清空缓存
     */
    clear() {
        this.cache.clear();
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }

    /**
     * 获取缓存统计
     */
    getStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hitRate: this.hitCount / (this.hitCount + this.missCount) || 0,
            memoryUsage: this.estimateMemoryUsage()
        };
    }

    /**
     * 估算内存使用
     */
    estimateMemoryUsage() {
        let total = 0;
        for (const [key, item] of this.cache) {
            total += key.length * 2; // 字符串大小估算
            total += JSON.stringify(item.value).length * 2;
        }
        return total;
    }
}

/**
 * 防抖和节流管理器
 */
class ThrottleManager {
    constructor() {
        this.debounces = new Map();
        this.throttles = new Map();
        this.rafCallbacks = new Set();
    }

    /**
     * 防抖函数
     */
    debounce(key, func, wait, immediate = false) {
        const existing = this.debounces.get(key);
        if (existing) {
            clearTimeout(existing.timer);
        }

        const timer = setTimeout(() => {
            if (!immediate) {
                func.apply(this, arguments);
            }
            this.debounces.delete(key);
        }, wait);

        this.debounces.set(key, { timer, func, immediate });

        if (immediate && !existing) {
            func.apply(this, arguments);
        }
    }

    /**
     * 节流函数
     */
    throttle(key, func, limit) {
        const existing = this.throttles.get(key);
        if (existing) {
            return existing; // 返回相同的包装函数
        }

        let inThrottle = false;
        const throttledFunc = (...args) => {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => {
                    inThrottle = false;
                }, limit);
            }
        };

        this.throttles.set(key, throttledFunc);
        return throttledFunc;
    }

    /**
     * RAF节流
     */
    raf(key, func) {
        if (this.rafCallbacks.has(func)) {
            return; // 已经在队列中
        }

        this.rafCallbacks.add(func);

        const runCallback = () => {
            func();
            this.rafCallbacks.delete(func);
        };

        requestAnimationFrame(runCallback);
    }

    /**
     * 清理所有定时器
     */
    cleanup() {
        for (const { timer } of this.debounces.values()) {
            clearTimeout(timer);
        }
        this.debounces.clear();
        this.throttles.clear();
        this.rafCallbacks.clear();
    }
}

/**
 * 渲染性能监控
 */
class RenderMonitor {
    constructor() {
        this.metrics = {
            renderCount: 0,
            totalRenderTime: 0,
            slowRenders: [],
            lastRenderTime: 0
        };
        this.slowThreshold = 16; // 16ms = 60fps
    }

    /**
     * 开始监控渲染
     */
    startRender(name = 'unknown') {
        return {
            startTime: performance.now(),
            name
        };
    }

    /**
     * 结束监控渲染
     */
    endRender(renderContext) {
        const duration = performance.now() - renderContext.startTime;

        this.metrics.renderCount++;
        this.metrics.totalRenderTime += duration;
        this.metrics.lastRenderTime = duration;

        if (duration > this.slowThreshold) {
            this.metrics.slowRenders.push({
                name: renderContext.name,
                duration,
                timestamp: Date.now()
            });

            // 只保留最近100个慢渲染
            if (this.metrics.slowRenders.length > 100) {
                this.metrics.slowRenders.shift();
            }

            console.warn(`[RenderMonitor] 慢渲染检测: ${renderContext.name} 耗时 ${duration.toFixed(2)}ms`);
        }

        return duration;
    }

    /**
     * 获取渲染统计
     */
    getStats() {
        const avgRenderTime = this.metrics.renderCount > 0
            ? this.metrics.totalRenderTime / this.metrics.renderCount
            : 0;

        return {
            ...this.metrics,
            averageRenderTime: avgRenderTime,
            slowRenderCount: this.metrics.slowRenders.length,
            performance: avgRenderTime < this.slowThreshold ? 'good' : 'poor'
        };
    }

    /**
     * 清理统计数据
     */
    clear() {
        this.metrics = {
            renderCount: 0,
            totalRenderTime: 0,
            slowRenders: [],
            lastRenderTime: 0
        };
    }
}

/**
 * 内存泄漏检测
 */
class MemoryLeakDetector {
    constructor() {
        this.references = new Map();
        this.timers = new Set();
        this.listeners = new Set();
    }

    /**
     * 跟踪对象引用
     */
    track(key, object, description = '') {
        this.references.set(key, {
            object,
            description,
            timestamp: Date.now()
        });
    }

    /**
     * 释放对象引用
     */
    release(key) {
        this.references.delete(key);
    }

    /**
     * 跟踪定时器
     */
    trackTimer(timerId, description = '') {
        this.timers.add({
            id: timerId,
            description,
            timestamp: Date.now()
        });
    }

    /**
     * 清理定时器
     */
    clearTimer(timerId) {
        for (const timer of this.timers) {
            if (timer.id === timerId) {
                clearTimeout(timerId);
                this.timers.delete(timer);
                return true;
            }
        }
        return false;
    }

    /**
     * 检查潜在泄漏
     */
    detectLeaks() {
        const now = Date.now();
        const leaks = [];

        // 检查长时间存活的对象引用
        for (const [key, ref] of this.references) {
            const age = now - ref.timestamp;
            if (age > 300000) { // 5分钟
                leaks.push({
                    type: 'object',
                    key,
                    description: ref.description,
                    age
                });
            }
        }

        // 检查长时间存活的定时器
        for (const timer of this.timers) {
            const age = now - timer.timestamp;
            if (age > 60000) { // 1分钟
                leaks.push({
                    type: 'timer',
                    id: timer.id,
                    description: timer.description,
                    age
                });
            }
        }

        return leaks;
    }

    /**
     * 清理所有跟踪的资源
     */
    cleanup() {
        // 清理所有定时器
        for (const timer of this.timers) {
            clearTimeout(timer.id);
        }
        this.timers.clear();

        // 清理所有引用
        this.references.clear();
    }
}

/**
 * 全局性能工具实例
 */
const Performance = {
    cache: new CacheManager({ maxSize: 200, defaultTTL: 300000 }),
    throttle: new ThrottleManager(),
    render: new RenderMonitor(),
    memory: new MemoryLeakDetector(),

    // 便捷方法
    debounce: (key, func, wait, immediate) => Performance.throttle.debounce(key, func, wait, immediate),
    throttle: (key, func, limit) => Performance.throttle.throttle(key, func, limit),
    raf: (key, func) => Performance.throttle.raf(key, func),
    cacheGet: (key) => Performance.cache.get(key),
    cacheSet: (key, value, ttl) => Performance.cache.set(key, value, ttl),
    startRender: (name) => Performance.render.startRender(name),
    endRender: (context) => Performance.render.endRender(context),
    track: (key, object, description) => Performance.memory.track(key, object, description),
    release: (key) => Performance.memory.release(key),
    trackTimer: (timerId, description) => Performance.memory.trackTimer(timerId, description),

    // 性能报告
    getReport() {
        return {
            cache: Performance.cache.getStats(),
            render: Performance.render.getStats(),
            memory: {
                trackedObjects: Performance.memory.references.size,
                activeTimers: Performance.memory.timers.size,
                leaks: Performance.memory.detectLeaks()
            },
            timestamp: Date.now()
        };
    },

    // 清理资源
    cleanup() {
        Performance.cache.clear();
        Performance.throttle.cleanup();
        Performance.render.clear();
        Performance.memory.cleanup();
    }
};

// 导出到全局 (避免覆盖浏览器原生Performance API)
window.AppPerformance = Performance;

// 向后兼容别名
window.CacheManager = CacheManager;
window.ThrottleManager = ThrottleManager;
window.RenderMonitor = RenderMonitor;
window.MemoryLeakDetector = MemoryLeakDetector;

console.log('[AppPerformance] 性能工具库已加载，统一缓存、防抖节流、渲染监控和内存管理');