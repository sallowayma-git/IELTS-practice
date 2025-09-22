/**
 * 组件检查器
 * 用于检查新增组件是否正确加载
 */
(function() {
    'use strict';
    
    // 等待页面加载完成
    async function checkComponents() {
        console.log('=== 组件加载检查 ===');
        
        const components = {
            'MarkdownExporter': window.MarkdownExporter,
            'practiceRecordModal': window.practiceRecordModal,
            'practiceHistoryEnhancer': window.practiceHistoryEnhancer
        };
        
        let allLoaded = true;
        
        Object.keys(components).forEach(name => {
            const component = components[name];
            const status = component ? '✅ 已加载' : '❌ 未加载';
            console.log(`${name}: ${status}`);
            
            if (!component) {
                allLoaded = false;
            }
        });
        
        // 检查全局函数
        const functions = {
            'exportPracticeData': window.exportPracticeData,
            'showRecordDetails': window.showRecordDetails,
            'showMessage': window.showMessage
        };
        
        console.log('\n=== 全局函数检查 ===');
        Object.keys(functions).forEach(name => {
            const func = functions[name];
            const status = (typeof func === 'function') ? '✅ 可用' : '❌ 不可用';
            console.log(`${name}: ${status}`);
        });
        
        // 检查数据
        console.log('\n=== 数据检查 ===');
        const practiceRecordsCount = window.practiceRecords ? window.practiceRecords.length : 0;
        console.log(`practiceRecords: ${practiceRecordsCount} 条记录`);
        
        if (window.storage) {
            try {
                const arr = await window.storage.get('practice_records', []);
                const count = Array.isArray(arr) ? arr.length : 0;
                console.log(`storage.practice_records: ${count} 条记录`);
            } catch (_) {
                console.log('storage.practice_records: 0 条记录');
            }
        }
        
        console.log('\n=== 检查完成 ===');
        
        if (allLoaded) {
            console.log('✅ 所有组件已正确加载');
            
            // 尝试初始化增强器
            if (window.practiceHistoryEnhancer && !window.practiceHistoryEnhancer.initialized) {
                console.log('🔄 手动初始化增强器...');
                window.practiceHistoryEnhancer.initialize();
            }
        } else {
            console.log('⚠️ 部分组件未加载，功能可能受限');
        }
    }
    
    // 延迟检查，确保所有脚本都已加载
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => { checkComponents(); }, 1000);
        });
    } else {
        setTimeout(() => { checkComponents(); }, 1000);
    }
    
    // 提供手动检查功能
    window.checkComponents = checkComponents;
    
})();
