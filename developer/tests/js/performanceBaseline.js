/**
 * 性能基线测量工具
 * 测量FPS、内存使用、交互延迟等性能指标
 */

class PerformanceBaseline {
    constructor() {
        this.metrics = {
            fps: [],
            memory: [],
            interactionDelay: [],
            renderTime: [],
            loadTime: null
        };
        this.isMonitoring = false;
        this.frameCount = 0;
        this.lastFrameTime = performance.now();
        this.monitoringInterval = null;
        this.baselineData = null;
    }

    // 开始性能监控
    startMonitoring(duration = 10000) {
        console.log('📊 开始性能基线测量...');
        this.isMonitoring = true;
        this.frameCount = 0;
        this.lastFrameTime = performance.now();

        // 清空之前的测量数据
        this.metrics = {
            fps: [],
            memory: [],
            interactionDelay: [],
            renderTime: [],
            loadTime: performance.now()
        };

        // 开始FPS监控
        this.startFPSMonitoring();

        // 开始内存监控
        this.startMemoryMonitoring();

        // 设置监控持续时间
        setTimeout(() => {
            this.stopMonitoring();
        }, duration);

        console.log(`⏱️ 性能监控已启动，将持续 ${duration}ms`);
    }

    // 停止性能监控
    stopMonitoring() {
        if (!this.isMonitoring) return;

        this.isMonitoring = false;

        if (this.monitoringInterval) {
            cancelAnimationFrame(this.monitoringInterval);
            this.monitoringInterval = null;
        }

        // 生成基线报告
        this.generateBaselineReport();

        console.log('📊 性能基线测量完成');
    }

    // 开始FPS监控
    startFPSMonitoring() {
        const measureFPS = () => {
            if (!this.isMonitoring) return;

            const currentTime = performance.now();
            const deltaTime = currentTime - this.lastFrameTime;
            const currentFPS = 1000 / deltaTime;

            this.metrics.fps.push(currentFPS);
            this.frameCount++;
            this.lastFrameTime = currentTime;

            this.monitoringInterval = requestAnimationFrame(measureFPS);
        };

        this.monitoringInterval = requestAnimationFrame(measureFPS);
    }

    // 开始内存监控
    startMemoryMonitoring() {
        const memoryInterval = setInterval(() => {
            if (!this.isMonitoring) {
                clearInterval(memoryInterval);
                return;
            }

            // 使用performance.memory API（Chrome支持）
            if (performance.memory) {
                const memoryInfo = {
                    used: performance.memory.usedJSHeapSize,
                    total: performance.memory.totalJSHeapSize,
                    limit: performance.memory.jsHeapSizeLimit,
                    timestamp: performance.now()
                };
                this.metrics.memory.push(memoryInfo);
            } else {
                // 降级方案：使用估算
                const estimatedMemory = this.estimateMemoryUsage();
                this.metrics.memory.push({
                    used: estimatedMemory,
                    total: estimatedMemory * 1.5,
                    limit: estimatedMemory * 4,
                    timestamp: performance.now(),
                    estimated: true
                });
            }
        }, 1000); // 每秒测量一次
    }

    // 估算内存使用（降级方案）
    estimateMemoryUsage() {
        // 简单的内存估算：基于localStorage使用量 + DOM元素数量
        let storageSize = 0;
        for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
                storageSize += localStorage[key].length + key.length;
            }
        }

        const domElements = document.getElementsByTagName('*').length;
        const estimatedDOMMemory = domElements * 200; // 每个DOM元素估算200字节

        return storageSize + estimatedDOMMemory + 1024 * 1024; // 基础1MB
    }

    // 测量交互延迟
    async measureInteractionDelay(element, action) {
        const startTime = performance.now();

        // 执行交互
        if (typeof action === 'function') {
            await action();
        } else if (element && typeof element[action] === 'function') {
            element[action]();
        }

        // 等待下一个渲染帧
        await new Promise(resolve => {
            requestAnimationFrame(resolve);
        });

        const endTime = performance.now();
        const delay = endTime - startTime;

        this.metrics.interactionDelay.push({
            action: action,
            delay,
            timestamp: performance.now()
        });

        return delay;
    }

    // 测量渲染时间
    measureRenderTime(element, content) {
        const startTime = performance.now();

        // 修改内容
        if (typeof content === 'string') {
            element.innerHTML = content;
        } else if (typeof content === 'function') {
            content(element);
        }

        // 等待渲染完成
        return new Promise(resolve => {
            requestAnimationFrame(() => {
                const endTime = performance.now();
                const renderTime = endTime - startTime;

                this.metrics.renderTime.push({
                    elementType: element.tagName,
                    renderTime,
                    timestamp: performance.now()
                });

                resolve(renderTime);
            });
        });
    }

    // 测量大量数据渲染性能
    async measureLargeDataRendering(dataArray, containerElement) {
        console.log(`📏 测量渲染 ${dataArray.length} 条数据的性能...`);

        const startTime = performance.now();

        // 清空容器
        containerElement.innerHTML = '';

        // 分批渲染以避免阻塞
        const batchSize = 100;
        for (let i = 0; i < dataArray.length; i += batchSize) {
            const batch = dataArray.slice(i, i + batchSize);
            const fragment = document.createDocumentFragment();

            batch.forEach(item => {
                const div = document.createElement('div');
                div.className = 'test-item';
                div.textContent = item.title || JSON.stringify(item);
                fragment.appendChild(div);
            });

            containerElement.appendChild(fragment);

            // 让出控制权
            if (i % (batchSize * 10) === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        const endTime = performance.now();
        const totalTime = endTime - startTime;
        const itemsPerSecond = dataArray.length / (totalTime / 1000);

        return {
            totalTime,
            itemsPerSecond,
            itemCount: dataArray.length
        };
    }

    // 生成基线报告
    generateBaselineReport() {
        if (this.metrics.fps.length === 0) {
            console.warn('⚠️ 没有足够的性能数据生成报告');
            return;
        }

        // 计算FPS统计
        const fpsStats = this.calculateStats(this.metrics.fps);

        // 计算内存统计
        const memoryStats = this.calculateMemoryStats();

        // 计算交互延迟统计
        const interactionStats = this.calculateInteractionStats();

        // 计算渲染时间统计
        const renderStats = this.calculateRenderStats();

        this.baselineData = {
            timestamp: new Date().toISOString(),
            measurementDuration: performance.now() - this.metrics.loadTime,
            fps: fpsStats,
            memory: memoryStats,
            interaction: interactionStats,
            render: renderStats,
            systemInfo: this.getSystemInfo()
        };

        console.log('📊 性能基线报告:', this.baselineData);
        this.displayBaselineReport();
    }

    // 计算统计数据
    calculateStats(values) {
        if (values.length === 0) return null;

        const sorted = [...values].sort((a, b) => a - b);
        const sum = values.reduce((acc, val) => acc + val, 0);

        return {
            min: sorted[0],
            max: sorted[sorted.length - 1],
            average: sum / values.length,
            median: sorted[Math.floor(sorted.length / 2)],
            p95: sorted[Math.floor(sorted.length * 0.95)],
            p99: sorted[Math.floor(sorted.length * 0.99)],
            sampleCount: values.length
        };
    }

    // 计算内存统计
    calculateMemoryStats() {
        if (this.metrics.memory.length === 0) return null;

        const usedMemory = this.metrics.memory.map(m => m.used);
        const totalMemory = this.metrics.memory.map(m => m.total);
        const limitMemory = this.metrics.memory.map(m => m.limit);

        return {
            used: this.calculateStats(usedMemory),
            total: this.calculateStats(totalMemory),
            limit: this.calculateStats(limitMemory),
            utilizationRate: {
                average: (usedMemory.reduce((a, b) => a + b, 0) / totalMemory.reduce((a, b) => a + b, 0)) * 100,
                peak: (Math.max(...usedMemory) / Math.max(...limitMemory)) * 100
            },
            estimated: this.metrics.memory.some(m => m.estimated)
        };
    }

    // 计算交互延迟统计
    calculateInteractionStats() {
        if (this.metrics.interactionDelay.length === 0) return null;

        const delays = this.metrics.interactionDelay.map(i => i.delay);
        const stats = this.calculateStats(delays);

        return {
            ...stats,
            samples: this.metrics.interactionDelay.map(i => ({
                action: i.action,
                delay: i.delay,
                timestamp: i.timestamp
            }))
        };
    }

    // 计算渲染时间统计
    calculateRenderStats() {
        if (this.metrics.renderTime.length === 0) return null;

        const renderTimes = this.metrics.renderTime.map(r => r.renderTime);
        const stats = this.calculateStats(renderTimes);

        return {
            ...stats,
            samples: this.metrics.renderTime.map(r => ({
                elementType: r.elementType,
                renderTime: r.renderTime,
                timestamp: r.timestamp
            }))
        };
    }

    // 获取系统信息
    getSystemInfo() {
        return {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            cookieEnabled: navigator.cookieEnabled,
            onLine: navigator.onLine,
            screen: {
                width: screen.width,
                height: screen.height,
                colorDepth: screen.colorDepth,
                pixelDepth: screen.pixelDepth
            },
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight
            },
            devicePixelRatio: window.devicePixelRatio || 1,
            hardwareConcurrency: navigator.hardwareConcurrency || 'unknown'
        };
    }

    // 显示基线报告
    displayBaselineReport() {
        const report = this.baselineData;
        if (!report) return;

        console.log('\n🎯 性能基线测量结果');
        console.log('='.repeat(50));

        // FPS报告
        if (report.fps) {
            console.log('\n📺 FPS (帧率):');
            console.log(`  平均: ${report.fps.average.toFixed(2)} FPS`);
            console.log(`  最低: ${report.fps.min.toFixed(2)} FPS`);
            console.log(`  最高: ${report.fps.max.toFixed(2)} FPS`);
            console.log(`  P95: ${report.fps.p95.toFixed(2)} FPS`);
            console.log(`  P99: ${report.fps.p99.toFixed(2)} FPS`);
        }

        // 内存报告
        if (report.memory) {
            console.log('\n💾 内存使用:');
            console.log(`  平均使用: ${(report.memory.used.average / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  峰值使用: ${(report.memory.used.max / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  利用率: ${report.memory.utilizationRate.average.toFixed(2)}% (峰值: ${report.memory.utilizationRate.peak.toFixed(2)}%)`);
            if (report.memory.estimated) {
                console.log('  ⚠️ 基于估算，不是精确测量');
            }
        }

        // 交互延迟报告
        if (report.interaction) {
            console.log('\n⚡ 交互延迟:');
            console.log(`  平均: ${report.interaction.average.toFixed(2)} ms`);
            console.log(`  最快: ${report.interaction.min.toFixed(2)} ms`);
            console.log(`  最慢: ${report.interaction.max.toFixed(2)} ms`);
            console.log(`  P95: ${report.interaction.p95.toFixed(2)} ms`);
        }

        // 渲染时间报告
        if (report.render) {
            console.log('\n🎨 渲染时间:');
            console.log(`  平均: ${report.render.average.toFixed(2)} ms`);
            console.log(`  最快: ${report.render.min.toFixed(2)} ms`);
            console.log(`  最慢: ${report.render.max.toFixed(2)} ms`);
            console.log(`  P95: ${report.render.p95.toFixed(2)} ms`);
        }

        console.log('\n⏱️ 测量时长: ' + (report.measurementDuration / 1000).toFixed(2) + ' 秒');
        console.log('🕐 测量时间: ' + report.timestamp);
        console.log('='.repeat(50));
    }

    // 运行完整的性能基准测试
    async runFullBenchmark() {
        console.log('🚀 开始完整性能基准测试...');

        // 1. 基础性能监控
        this.startMonitoring(5000); // 5秒基础监控

        // 2. 等待基础监控完成
        await new Promise(resolve => setTimeout(resolve, 6000));

        // 3. DOM操作性能测试
        await this.testDOMPerformance();

        // 4. 数据处理性能测试
        await this testDataProcessingPerformance();

        // 5. UI交互性能测试
        await this.testUIInteractionPerformance();

        console.log('✅ 完整性能基准测试完成');
        return this.baselineData;
    }

    // DOM操作性能测试
    async testDOMPerformance() {
        console.log('🏗️ 测试DOM操作性能...');

        const container = document.createElement('div');
        container.id = 'performance-test-container';
        container.style.cssText = 'position: absolute; left: -9999px; top: -9999px; visibility: hidden;';
        document.body.appendChild(container);

        // 测试大量元素创建
        const elementCount = 1000;
        const elements = Array.from({ length: elementCount }, (_, i) => ({
            title: `测试元素 ${i}`,
            content: `内容 ${i}`
        }));

        const domResult = await this.measureLargeDataRendering(elements, container);

        console.log(`  DOM渲染: ${elementCount} 个元素用时 ${domResult.totalTime.toFixed(2)}ms`);
        console.log(`  渲染速度: ${domResult.itemsPerSecond.toFixed(2)} 元素/秒`);

        // 清理测试元素
        document.body.removeChild(container);
    }

    // 数据处理性能测试
    async testDataProcessingPerformance() {
        console.log('📊 测试数据处理性能...');

        // 创建大量测试数据
        const largeDataSet = Array.from({ length: 10000 }, (_, i) => ({
            id: `item_${i}`,
            title: `测试数据项 ${i}`,
            category: ['reading', 'listening', 'writing', 'speaking'][i % 4],
            score: Math.floor(Math.random() * 100),
            date: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            metadata: {
                tags: Array.from({ length: 5 }, (_, j) => `tag_${i}_${j}`),
                priority: Math.floor(Math.random() * 10),
                status: ['active', 'completed', 'pending'][i % 3]
            }
        }));

        // 测试排序性能
        const sortStart = performance.now();
        const sortedData = [...largeDataSet].sort((a, b) => b.score - a.score);
        const sortTime = performance.now() - sortStart;

        // 测试过滤性能
        const filterStart = performance.now();
        const filteredData = largeDataSet.filter(item => item.category === 'reading' && item.score > 70);
        const filterTime = performance.now() - filterStart;

        // 测试搜索性能
        const searchStart = performance.now();
        const searchResults = largeDataSet.filter(item =>
            item.title.includes('测试数据项') && item.metadata.tags.some(tag => tag.includes('tag_'))
        );
        const searchTime = performance.now() - searchStart;

        console.log(`  数据排序: ${largeDataSet.length} 项用时 ${sortTime.toFixed(2)}ms`);
        console.log(`  数据过滤: 找到 ${filteredData.length} 项用时 ${filterTime.toFixed(2)}ms`);
        console.log(`  数据搜索: 找到 ${searchResults.length} 项用时 ${searchTime.toFixed(2)}ms`);
    }

    // UI交互性能测试
    async testUIInteractionPerformance() {
        console.log('🖱️ 测试UI交互性能...');

        // 创建测试按钮
        const testButton = document.createElement('button');
        testButton.id = 'performance-test-button';
        testButton.textContent = '性能测试按钮';
        testButton.style.cssText = 'position: absolute; left: -9999px; top: -9999px; visibility: hidden;';
        document.body.appendChild(testButton);

        // 测试点击延迟
        const clickDelays = [];
        for (let i = 0; i < 10; i++) {
            const delay = await this.measureInteractionDelay(testButton, 'click');
            clickDelays.push(delay);
        }

        // 测试输入延迟
        const testInput = document.createElement('input');
        testInput.id = 'performance-test-input';
        testInput.style.cssText = 'position: absolute; left: -9999px; top: -9999px; visibility: hidden;';
        document.body.appendChild(testInput);

        const inputDelays = [];
        for (let i = 0; i < 10; i++) {
            const delay = await this.measureInteractionDelay(testInput, () => {
                testInput.value = `测试输入 ${i}`;
            });
            inputDelays.push(delay);
        }

        const avgClickDelay = clickDelays.reduce((a, b) => a + b, 0) / clickDelays.length;
        const avgInputDelay = inputDelays.reduce((a, b) => a + b, 0) / inputDelays.length;

        console.log(`  点击延迟: 平均 ${avgClickDelay.toFixed(2)}ms`);
        console.log(`  输入延迟: 平均 ${avgInputDelay.toFixed(2)}ms`);

        // 清理测试元素
        document.body.removeChild(testButton);
        document.body.removeChild(testInput);
    }

    // 获取性能建议
    getPerformanceRecommendations() {
        if (!this.baselineData) return null;

        const recommendations = [];
        const report = this.baselineData;

        // FPS建议
        if (report.fps && report.fps.average < 30) {
            recommendations.push({
                category: 'FPS',
                severity: 'high',
                message: `平均FPS只有 ${report.fps.average.toFixed(1)}，建议优化动画和渲染`,
                suggestions: ['减少DOM操作频率', '使用CSS动画代替JavaScript动画', '优化重绘和回流']
            });
        } else if (report.fps && report.fps.p95 < 45) {
            recommendations.push({
                category: 'FPS',
                severity: 'medium',
                message: `P95 FPS只有 ${report.fps.p95.toFixed(1)}，存在性能波动`,
                suggestions: ['检查是否有阻塞主线程的操作', '优化复杂计算', '使用Web Workers处理重任务']
            });
        }

        // 内存建议
        if (report.memory && report.memory.utilizationRate.peak > 80) {
            recommendations.push({
                category: '内存',
                severity: 'high',
                message: `内存利用率峰值达到 ${report.memory.utilizationRate.peak.toFixed(1)}%`,
                suggestions: ['检查内存泄漏', '优化数据结构', '及时清理不需要的对象']
            });
        }

        // 交互延迟建议
        if (report.interaction && report.interaction.p95 > 100) {
            recommendations.push({
                category: '交互延迟',
                severity: 'medium',
                message: `P95交互延迟达到 ${report.interaction.p95.toFixed(1)}ms`,
                suggestions: ['减少事件处理器的复杂度', '使用防抖和节流', '优化DOM操作']
            });
        }

        return recommendations;
    }
}

// 创建全局实例
window.performanceBaseline = new PerformanceBaseline();

// 导出供使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PerformanceBaseline;
}