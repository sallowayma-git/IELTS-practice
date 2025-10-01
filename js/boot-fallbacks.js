/**
 * BootFallbacks - 启动回退脚本
 * 提供基本的回退机制以确保页面功能正常
 */

(function() {
    'use strict';

    console.log('[BootFallbacks] Loading fallback mechanisms...');

    // 基本的全局函数回退
    if (typeof window.showMessage !== 'function') {
        window.showMessage = function(message, type = 'info', duration = 3000) {
            console.log(`[${type.toUpperCase()}] ${message}`);
            // 可以在这里添加更复杂的通知显示逻辑
        };
    }

    if (typeof window.openExam !== 'function') {
        window.openExam = function(examId) {
            console.warn(`[BootFallbacks] openExam not available for exam: ${examId}`);
            return false;
        };
    }

    // 基本的对象回退
    if (!window.App) {
        window.App = {
            isInitialized: function() {
                return false;
            },
            initialize: function() {
                return Promise.resolve();
            }
        };
    }

    console.log('[BootFallbacks] Fallback mechanisms loaded');

})();