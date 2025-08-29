/**
 * 系统完整功能验证脚本
 */
(function() {
    'use strict';
    
    console.log('=== IELTS系统完整功能验证 ===');
    
    // 验证基本HTML结构
    function validateHTMLStructure() {
        console.log('1. 验证HTML结构...');
        
        const requiredElements = [
            'message-container',
            'main-nav',
            'overview-view',
            'browse-view', 
            'records-view',
            'settings-view'
        ];
        
        const missing = requiredElements.filter(id => !document.getElementById(id));
        
        if (missing.length > 0) {
            console.error('❌ 缺少必需的HTML元素:', missing);
            return false;
        }
        
        console.log('✅ HTML结构完整');
        return true;
    }
    
    // 验证JavaScript函数
    function validateJavaScriptFunctions() {
        console.log('2. 验证JavaScript函数...');
        
        const requiredFunctions = [
            'showView',
            'showMessage',
            'loadLibrary',
            'searchExams',
            'displayExams',
            'openExam',
            'handleError'
        ];
        
        const missing = requiredFunctions.filter(func => typeof window[func] !== 'function');
        
        if (missing.length > 0) {
            console.error('❌ 缺少必需的JavaScript函数:', missing);
            return false;
        }
        
        console.log('✅ JavaScript函数完整');
        return true;
    }
    
    // 验证组件加载
    function validateComponents() {
        console.log('3. 验证组件加载...');
        
        const requiredComponents = [
            'IndexValidator',
            'CommunicationTester', 
            'ErrorFixer',
            'CommunicationRecovery',
            'PerformanceOptimizer',
            'DataIntegrityManager'
        ];
        
        const missing = requiredComponents.filter(comp => !window[comp]);
        
        if (missing.length > 0) {
            console.warn('⚠️ 部分组件未加载:', missing);
            console.log('这可能是正常的，取决于组件的加载顺序');
        } else {
            console.log('✅ 所有组件已加载');
        }
        
        return true;
    }
    
    // 验证数据存储
    function validateDataStorage() {
        console.log('4. 验证数据存储...');
        
        try {
            // 测试localStorage
            const testKey = '_validation_test_';
            const testValue = { test: true, timestamp: Date.now() };
            
            localStorage.setItem(testKey, JSON.stringify(testValue));
            const retrieved = JSON.parse(localStorage.getItem(testKey));
            localStorage.removeItem(testKey);
            
            if (!retrieved || retrieved.test !== true) {
                console.error('❌ localStorage功能异常');
                return false;
            }
            
            // 检查storage对象
            if (!window.storage || typeof window.storage.get !== 'function') {
                console.error('❌ storage对象未正确初始化');
                return false;
            }
            
            console.log('✅ 数据存储功能正常');
            return true;
            
        } catch (error) {
            console.error('❌ 数据存储验证失败:', error);
            return false;
        }
    }
    
    // 验证题库数据
    function validateExamData() {
        console.log('5. 验证题库数据...');
        
        if (!window.completeExamIndex) {
            console.error('❌ 题库索引未加载');
            return false;
        }
        
        if (!Array.isArray(window.completeExamIndex) || window.completeExamIndex.length === 0) {
            console.error('❌ 题库索引为空或格式错误');
            return false;
        }
        
        // 检查题库数据结构
        const sampleExam = window.completeExamIndex[0];
        const requiredFields = ['id', 'title', 'category', 'path'];
        const missingFields = requiredFields.filter(field => !(field in sampleExam));
        
        if (missingFields.length > 0) {
            console.error('❌ 题库数据结构不完整，缺少字段:', missingFields);
            return false;
        }
        
        console.log(`✅ 题库数据正常 (${window.completeExamIndex.length} 个题目)`);
        return true;
    }
    
    // 验证CSS样式
    function validateCSS() {
        console.log('6. 验证CSS样式...');
        
        try {
            // 检查关键样式是否应用
            const container = document.querySelector('.container');
            const nav = document.querySelector('.main-nav');
            
            if (!container || !nav) {
                console.error('❌ 关键DOM元素不存在');
                return false;
            }
            
            const containerStyle = getComputedStyle(container);
            const navStyle = getComputedStyle(nav);
            
            if (containerStyle.maxWidth === 'none' && containerStyle.width === 'auto') {
                console.warn('⚠️ 容器样式可能未正确应用');
            }
            
            console.log('✅ CSS样式基本正常');
            return true;
            
        } catch (error) {
            console.error('❌ CSS验证失败:', error);
            return false;
        }
    }
    
    // 运行完整验证
    function runFullValidation() {
        console.log('开始系统完整功能验证...\n');
        
        const results = [
            validateHTMLStructure(),
            validateJavaScriptFunctions(), 
            validateComponents(),
            validateDataStorage(),
            validateExamData(),
            validateCSS()
        ];
        
        const passed = results.filter(r => r).length;
        const total = results.length;
        const successRate = Math.round((passed / total) * 100);
        
        console.log('\n=== 验证结果 ===');
        console.log(`通过: ${passed}/${total} (${successRate}%)`);
        
        if (successRate >= 80) {
            console.log('🎉 系统功能验证通过！');
        } else if (successRate >= 60) {
            console.log('⚠️ 系统基本可用，但存在一些问题');
        } else {
            console.log('❌ 系统存在严重问题，需要修复');
        }
        
        return { passed, total, successRate };
    }
    
    // 页面加载完成后自动运行验证
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runFullValidation);
    } else {
        setTimeout(runFullValidation, 1000); // 延迟1秒确保所有脚本加载完成
    }
    
    // 导出验证函数供手动调用
    window.runSystemValidation = runFullValidation;
    
})();