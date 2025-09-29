// performanceOptimizer.js - Optimize script loading and performance
// Provides tools to measure and optimize the new architecture performance

window.PerformanceOptimizer = class PerformanceOptimizer {
    constructor() {
        this.metrics = {
            scriptLoadTimes: new Map(),
            initializationTimes: new Map(),
            memoryUsage: [],
            domReadyTime: null,
            appReadyTime: null
        };
        
        this.startTime = performance.now();
        this.setupPerformanceMonitoring();
    }
    
    setupPerformanceMonitoring() {
        // Monitor DOM ready time
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.metrics.domReadyTime = performance.now() - this.startTime;
                console.log(`[Performance] DOM ready in ${this.metrics.domReadyTime.toFixed(2)}ms`);
            });
        } else {
            this.metrics.domReadyTime = 0; // Already ready
        }
        
        // Monitor app ready time
        if (window.app) {
            this.checkAppReady();
        } else {
            // Wait for app to be available
            const checkInterval = setInterval(() => {
                if (window.app) {
                    clearInterval(checkInterval);
                    this.checkAppReady();
                }
            }, 50);
        }
        
        // Monitor memory usage periodically
        this.startMemoryMonitoring();
    }
    
    checkAppReady() {
        const checkReady = () => {
            if (window.app && window.app.isInitialized && window.app.isInitialized()) {
                this.metrics.appReadyTime = performance.now() - this.startTime;
                console.log(`[Performance] App ready in ${this.metrics.appReadyTime.toFixed(2)}ms`);
                return true;
            }
            return false;
        };
        
        if (!checkReady()) {
            const readyInterval = setInterval(() => {
                if (checkReady()) {
                    clearInterval(readyInterval);
                }
            }, 100);
        }
    }
    
    startMemoryMonitoring() {
        const recordMemory = () => {
            if (performance.memory) {
                this.metrics.memoryUsage.push({
                    timestamp: performance.now(),
                    used: performance.memory.usedJSHeapSize,
                    total: performance.memory.totalJSHeapSize,
                    limit: performance.memory.jsHeapSizeLimit
                });
                
                // Keep only last 100 measurements
                if (this.metrics.memoryUsage.length > 100) {
                    this.metrics.memoryUsage = this.metrics.memoryUsage.slice(-100);
                }
            }
        };
        
        // Record initial memory
        recordMemory();
        
        // Record memory every 5 seconds
        setInterval(recordMemory, 5000);
    }
    
    measureScriptLoadTime(scriptName, startTime) {
        const loadTime = performance.now() - startTime;
        this.metrics.scriptLoadTimes.set(scriptName, loadTime);
        console.log(`[Performance] ${scriptName} loaded in ${loadTime.toFixed(2)}ms`);
        return loadTime;
    }
    
    measureInitializationTime(componentName, startTime) {
        const initTime = performance.now() - startTime;
        this.metrics.initializationTimes.set(componentName, initTime);
        console.log(`[Performance] ${componentName} initialized in ${initTime.toFixed(2)}ms`);
        return initTime;
    }
    
    analyzeScriptLoadingOrder() {
        console.log('\n📊 SCRIPT LOADING ANALYSIS:');
        
        // Get all script tags
        const scripts = Array.from(document.querySelectorAll('script[src]'));
        const newArchitectureScripts = scripts.filter(script => 
            script.src.includes('/stores/') || 
            script.src.includes('/ui/') || 
            script.src.includes('validation.js') ||
            script.src.includes('events.js') ||
            script.src.includes('errorDisplay.js')
        );
        
        console.log(`Total scripts: ${scripts.length}`);
        console.log(`New architecture scripts: ${newArchitectureScripts.length}`);
        
        // Analyze loading order
        const loadOrder = [];
        scripts.forEach((script, index) => {
            const src = script.src.split('/').pop();
            loadOrder.push({ index, src, isNewArch: newArchitectureScripts.includes(script) });
        });
        
        console.log('\nScript loading order:');
        loadOrder.forEach(item => {
            const marker = item.isNewArch ? '🆕' : '📜';
            console.log(`  ${item.index + 1}. ${marker} ${item.src}`);
        });
        
        return loadOrder;
    }
    
    optimizeScriptLoading() {
        console.log('\n⚡ SCRIPT LOADING OPTIMIZATION SUGGESTIONS:');
        
        const suggestions = [];
        
        // Check for duplicate scripts
        const scripts = Array.from(document.querySelectorAll('script[src]'));
        const srcCounts = new Map();
        
        scripts.forEach(script => {
            const src = script.src;
            srcCounts.set(src, (srcCounts.get(src) || 0) + 1);
        });
        
        const duplicates = Array.from(srcCounts.entries()).filter(([src, count]) => count > 1);
        if (duplicates.length > 0) {
            suggestions.push({
                type: 'Remove Duplicates',
                description: `Found ${duplicates.length} duplicate script(s)`,
                impact: 'High',
                scripts: duplicates.map(([src]) => src.split('/').pop())
            });
        }
        
        // Check for optimal loading order
        const criticalScripts = [
            'storage.js',
            'validation.js',
            'events.js',
            'ExamStore.js',
            'RecordStore.js',
            'AppStore.js'
        ];
        
        const currentOrder = scripts.map(s => s.src.split('/').pop());
        const orderIssues = [];
        
        criticalScripts.forEach((script, expectedIndex) => {
            const actualIndex = currentOrder.indexOf(script);
            if (actualIndex > -1 && actualIndex > expectedIndex + 5) { // Allow some flexibility
                orderIssues.push({ script, expected: expectedIndex, actual: actualIndex });
            }
        });
        
        if (orderIssues.length > 0) {
            suggestions.push({
                type: 'Optimize Loading Order',
                description: 'Some critical scripts are loaded too late',
                impact: 'Medium',
                issues: orderIssues
            });
        }
        
        // Check for unused scripts (basic heuristic)
        const potentiallyUnused = [
            'boot-fallbacks.js',
            'componentChecker.js',
            'runtime-fixes.js'
        ];
        
        const unusedScripts = potentiallyUnused.filter(script => 
            currentOrder.includes(script)
        );
        
        if (unusedScripts.length > 0) {
            suggestions.push({
                type: 'Remove Unused Scripts',
                description: 'Some scripts may no longer be needed',
                impact: 'Medium',
                scripts: unusedScripts
            });
        }
        
        // Display suggestions
        suggestions.forEach((suggestion, index) => {
            console.log(`\n${index + 1}. ${suggestion.type} (${suggestion.impact} Impact)`);
            console.log(`   ${suggestion.description}`);
            if (suggestion.scripts) {
                console.log(`   Scripts: ${suggestion.scripts.join(', ')}`);
            }
            if (suggestion.issues) {
                suggestion.issues.forEach(issue => {
                    console.log(`   ${issue.script}: expected position ${issue.expected}, actual ${issue.actual}`);
                });
            }
        });
        
        return suggestions;
    }
    
    measureMemoryUsage() {
        if (!performance.memory) {
            console.log('❌ Memory measurement not available in this browser');
            return null;
        }
        
        const current = performance.memory;
        const usage = {
            used: Math.round(current.usedJSHeapSize / 1024 / 1024 * 100) / 100,
            total: Math.round(current.totalJSHeapSize / 1024 / 1024 * 100) / 100,
            limit: Math.round(current.jsHeapSizeLimit / 1024 / 1024 * 100) / 100,
            percentage: Math.round((current.usedJSHeapSize / current.jsHeapSizeLimit) * 100 * 100) / 100
        };
        
        console.log(`\n💾 MEMORY USAGE:`);
        console.log(`   Used: ${usage.used} MB`);
        console.log(`   Total: ${usage.total} MB`);
        console.log(`   Limit: ${usage.limit} MB`);
        console.log(`   Usage: ${usage.percentage}%`);
        
        return usage;
    }
    
    analyzeInitializationPerformance() {
        console.log('\n⏱️  INITIALIZATION PERFORMANCE:');
        
        if (this.metrics.domReadyTime) {
            console.log(`   DOM Ready: ${this.metrics.domReadyTime.toFixed(2)}ms`);
        }
        
        if (this.metrics.appReadyTime) {
            console.log(`   App Ready: ${this.metrics.appReadyTime.toFixed(2)}ms`);
            
            const initTime = this.metrics.appReadyTime - (this.metrics.domReadyTime || 0);
            console.log(`   App Init Time: ${initTime.toFixed(2)}ms`);
        }
        
        // Analyze component initialization times
        if (this.metrics.initializationTimes.size > 0) {
            console.log('\n   Component Initialization:');
            Array.from(this.metrics.initializationTimes.entries())
                .sort((a, b) => b[1] - a[1]) // Sort by time (slowest first)
                .forEach(([component, time]) => {
                    console.log(`     ${component}: ${time.toFixed(2)}ms`);
                });
        }
        
        return {
            domReady: this.metrics.domReadyTime,
            appReady: this.metrics.appReadyTime,
            components: Object.fromEntries(this.metrics.initializationTimes)
        };
    }
    
    generatePerformanceReport() {
        console.log('\n' + '='.repeat(60));
        console.log('PERFORMANCE OPTIMIZATION REPORT');
        console.log('='.repeat(60));
        
        // Script loading analysis
        this.analyzeScriptLoadingOrder();
        
        // Optimization suggestions
        const suggestions = this.optimizeScriptLoading();
        
        // Memory usage
        const memoryUsage = this.measureMemoryUsage();
        
        // Initialization performance
        const initPerformance = this.analyzeInitializationPerformance();
        
        // Overall assessment
        console.log('\n🎯 PERFORMANCE ASSESSMENT:');
        
        let score = 100;
        const issues = [];
        
        if (initPerformance.appReady > 3000) {
            score -= 20;
            issues.push('App initialization is slow (>3s)');
        } else if (initPerformance.appReady > 1500) {
            score -= 10;
            issues.push('App initialization could be faster (>1.5s)');
        }
        
        if (memoryUsage && memoryUsage.percentage > 50) {
            score -= 15;
            issues.push('High memory usage (>50% of limit)');
        }
        
        if (suggestions.length > 2) {
            score -= 10;
            issues.push('Multiple optimization opportunities available');
        }
        
        console.log(`   Overall Score: ${score}/100`);
        
        if (issues.length > 0) {
            console.log('\n   Issues to Address:');
            issues.forEach(issue => {
                console.log(`     • ${issue}`);
            });
        } else {
            console.log('   ✅ Performance looks good!');
        }
        
        console.log('='.repeat(60));
        
        return {
            score,
            issues,
            suggestions,
            memoryUsage,
            initPerformance,
            timestamp: new Date().toISOString()
        };
    }
    
    // Cleanup method for memory management
    cleanup() {
        // Clear large data structures
        this.metrics.memoryUsage = [];
        this.metrics.scriptLoadTimes.clear();
        this.metrics.initializationTimes.clear();
        
        console.log('[Performance] Cleanup completed');
    }
};

// Create global instance
window.performanceOptimizer = new window.PerformanceOptimizer();

// Global functions
window.generatePerformanceReport = function() {
    return window.performanceOptimizer.generatePerformanceReport();
};

window.measureMemoryUsage = function() {
    return window.performanceOptimizer.measureMemoryUsage();
};

window.optimizeScriptLoading = function() {
    return window.performanceOptimizer.optimizeScriptLoading();
};

// Auto-generate report in debug mode
if (localStorage.getItem('show_performance_report') === 'true') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            window.generatePerformanceReport();
        }, 5000); // Wait 5 seconds for everything to initialize
    });
}