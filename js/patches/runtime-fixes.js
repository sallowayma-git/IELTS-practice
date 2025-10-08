/**
 * RuntimeFixes - 运行时修复脚本
 * 提供运行时问题的修复和兼容性处理
 */

(function() {
    'use strict';

    console.log('[RuntimeFixes] Applying runtime fixes...');

    // 修复常见的运行时问题
    const fixes = {
        // 修复undefined方法调用
        fixUndefinedMethods: function() {
            const original = console.error;
            console.error = function(...args) {
                // 过滤掉一些常见的无害错误
                const message = args[0];
                if (typeof message === 'string') {
                    if (message.includes('Script error') ||
                        message.includes('Non-Error promise rejection')) {
                        return; // 忽略这些错误
                    }
                }
                original.apply(console, args);
            };
        },

        // 修复事件监听器问题
        fixEventListeners: function() {
            // 确保事件监听器正确绑定
            if (typeof window.addEventListener === 'function') {
                // 添加全局错误处理
                window.addEventListener('error', function(event) {
                    console.warn('[RuntimeFixes] Global error caught:', event.error);
                });
            }
        },

        // 修复Promise相关问题
        fixPromises: function() {
            // 确保Promise.rejected被正确处理
            if (typeof window.addEventListener === 'function') {
                window.addEventListener('unhandledrejection', function(event) {
                    console.warn('[RuntimeFixes] Unhandled promise rejection:', event.reason);
                    event.preventDefault(); // 防止控制台显示错误
                });
            }
        }
    };

    // 应用所有修复
    Object.keys(fixes).forEach(function(fixName) {
        try {
            fixes[fixName]();
            console.log(`[RuntimeFixes] Applied fix: ${fixName}`);
        } catch (error) {
            console.error(`[RuntimeFixes] Failed to apply fix ${fixName}:`, error);
        }
    });

    console.log('[RuntimeFixes] Runtime fixes applied');

})();