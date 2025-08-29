/**
 * 验证文件移动后的路径和功能
 */
function validateFilePaths() {
    console.log('=== 验证文件移动后的路径和功能 ===\n');
    
    const results = {
        pathsValid: true,
        scriptsLoaded: 0,
        totalScripts: 0,
        errors: []
    };
    
    // 1. 检查关键文件是否加载成功
    console.log('1. 检查关键文件加载状态...');
    
    const expectedGlobals = [
        { name: 'completeExamIndex', file: 'assets/scripts/complete-exam-data.js' },
        { name: 'app', file: 'js/app.js' },
        { name: 'PracticeHistory', file: 'js/core/practiceRecorder.js' },
        { name: 'PracticePageEnhancer', file: 'js/practice-page-enhancer.js' }
    ];
    
    expectedGlobals.forEach(item => {
        if (window[item.name]) {
            console.log(`✅ ${item.file} - ${item.name} 已加载`);
            results.scriptsLoaded++;
        } else {
            console.log(`❌ ${item.file} - ${item.name} 未加载`);
            results.errors.push(`${item.name} 未加载`);
        }
        results.totalScripts++;
    });
    
    // 2. 检查favicon是否正确显示
    console.log('\n2. 检查favicon...');
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon && favicon.href.includes('assets/images/favicon.svg')) {
        console.log('✅ Favicon路径正确');
    } else {
        console.log('❌ Favicon路径错误或未找到');
        results.pathsValid = false;
        results.errors.push('Favicon路径错误');
    }
    
    // 3. 检查题库数据
    console.log('\n3. 检查题库数据...');
    if (window.completeExamIndex && Array.isArray(window.completeExamIndex)) {
        console.log(`✅ 题库数据已加载 (${window.completeExamIndex.length} 个题目)`);
        
        // 检查数据结构
        if (window.completeExamIndex.length > 0) {
            const sample = window.completeExamIndex[0];
            const requiredFields = ['id', 'title', 'category', 'path'];
            const hasAllFields = requiredFields.every(field => field in sample);
            
            if (hasAllFields) {
                console.log('✅ 题库数据结构正确');
            } else {
                console.log('❌ 题库数据结构不完整');
                results.errors.push('题库数据结构不完整');
            }
        }
    } else {
        console.log('❌ 题库数据未加载或格式错误');
        results.pathsValid = false;
        results.errors.push('题库数据未加载');
    }
    
    // 4. 检查应用初始化
    console.log('\n4. 检查应用初始化...');
    if (window.app) {
        console.log('✅ 应用实例已创建');
        
        // 检查关键方法
        const methods = ['navigateToView', 'showMessage', 'loadLibrary'];
        methods.forEach(method => {
            if (typeof window.app[method] === 'function') {
                console.log(`✅ ${method} 方法可用`);
            } else if (typeof window[method] === 'function') {
                console.log(`✅ ${method} 全局函数可用`);
            } else {
                console.log(`❌ ${method} 方法不可用`);
                results.errors.push(`${method} 方法不可用`);
            }
        });
    } else {
        console.log('❌ 应用实例未创建');
        results.errors.push('应用实例未创建');
    }
    
    // 5. 检查DOM结构
    console.log('\n5. 检查DOM结构...');
    const requiredElements = [
        'message-container',
        'overview-view',
        'browse-view',
        'practice-view',
        'settings-view'
    ];
    
    requiredElements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            console.log(`✅ #${id} 元素存在`);
        } else {
            console.log(`❌ #${id} 元素不存在`);
            results.errors.push(`#${id} 元素不存在`);
        }
    });
    
    // 6. 测试基本功能
    console.log('\n6. 测试基本功能...');
    
    // 测试消息显示
    if (typeof showMessage === 'function') {
        try {
            showMessage('测试消息', 'info');
            console.log('✅ 消息显示功能正常');
            
            // 清除测试消息
            setTimeout(() => {
                const messages = document.querySelectorAll('.message');
                messages.forEach(msg => {
                    if (msg.textContent.includes('测试消息')) {
                        msg.remove();
                    }
                });
            }, 1000);
        } catch (error) {
            console.log('❌ 消息显示功能异常:', error.message);
            results.errors.push('消息显示功能异常');
        }
    }
    
    // 测试视图切换
    if (typeof showView === 'function') {
        try {
            showView('overview');
            console.log('✅ 视图切换功能正常');
        } catch (error) {
            console.log('❌ 视图切换功能异常:', error.message);
            results.errors.push('视图切换功能异常');
        }
    }
    
    // 7. 生成报告
    console.log('\n=== 验证结果 ===');
    const successRate = Math.round(((results.scriptsLoaded / results.totalScripts) * 100));
    
    console.log(`脚本加载: ${results.scriptsLoaded}/${results.totalScripts} (${successRate}%)`);
    console.log(`路径有效性: ${results.pathsValid ? '✅ 通过' : '❌ 失败'}`);
    console.log(`错误数量: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
        console.log('\n错误详情:');
        results.errors.forEach((error, index) => {
            console.log(`  ${index + 1}. ${error}`);
        });
    }
    
    const overallSuccess = results.pathsValid && results.errors.length === 0 && successRate >= 75;
    console.log(`\n总体状态: ${overallSuccess ? '✅ 验证通过' : '❌ 需要修复'}`);
    
    return {
        success: overallSuccess,
        scriptsLoaded: results.scriptsLoaded,
        totalScripts: results.totalScripts,
        pathsValid: results.pathsValid,
        errors: results.errors
    };
}

// 延迟执行验证，等待所有脚本加载完成
setTimeout(() => {
    console.log('🔍 开始验证文件移动后的功能...\n');
    validateFilePaths();
}, 3000);

// 导出函数供手动调用
window.validateFilePaths = validateFilePaths;

console.log('文件路径验证脚本已加载');
console.log('使用 validateFilePaths() 手动运行验证');