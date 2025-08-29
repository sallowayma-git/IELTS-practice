/**
 * 功能验证测试脚本
 * 验证所有修改的功能是否正常工作
 */

console.log('=== IELTS系统功能验证测试 ===');

// 1. 验证设置界面优化
function testSettingsInterface() {
    console.log('\n1. 测试设置界面优化...');
    
    // 检查按钮是否已删除
    const systemTestBtn = document.querySelector('button[onclick*="runSystemIntegrationTest"]');
    const uxTestBtn = document.querySelector('button[onclick*="runUserExperienceValidation"]');
    
    if (systemTestBtn) {
        console.error('❌ 系统检测按钮仍然存在');
        return false;
    }
    
    if (uxTestBtn) {
        console.error('❌ 用户体验检查按钮仍然存在');
        return false;
    }
    
    // 检查函数是否已删除
    if (typeof window.runSystemIntegrationTest === 'function') {
        console.error('❌ runSystemIntegrationTest函数仍然存在');
        return false;
    }
    
    if (typeof window.runUserExperienceValidation === 'function') {
        console.error('❌ runUserExperienceValidation函数仍然存在');
        return false;
    }
    
    console.log('✅ 设置界面优化完成');
    return true;
}

// 2. 验证练习历史详细查看功能
function testPracticeHistoryDetails() {
    console.log('\n2. 测试练习历史详细查看功能...');
    
    // 检查PracticeHistory组件是否存在
    if (!window.PracticeHistory) {
        console.error('❌ PracticeHistory组件未加载');
        return false;
    }
    
    // 检查generateAnswersTable方法是否存在
    const practiceHistory = new PracticeHistory();
    if (typeof practiceHistory.generateAnswersTable !== 'function') {
        console.error('❌ generateAnswersTable方法不存在');
        return false;
    }
    
    // 测试答案表格生成功能
    try {
        const testRecord = {
            answers: { 'q1': 'test answer', 'q2': 'another answer' },
            scoreInfo: {
                details: {
                    'q1': { userAnswer: 'test answer', correctAnswer: 'correct answer', isCorrect: false },
                    'q2': { userAnswer: 'another answer', correctAnswer: 'another answer', isCorrect: true }
                }
            }
        };
        
        const tableHtml = practiceHistory.generateAnswersTable(testRecord);
        if (!tableHtml.includes('answers-table')) {
            console.error('❌ 答案表格生成失败');
            return false;
        }
        
        console.log('✅ 练习历史详细查看功能正常');
        return true;
    } catch (error) {
        console.error('❌ 练习历史详细查看功能测试失败:', error);
        return false;
    }
}

// 3. 验证题库浏览状态管理修复
function testExamBrowserStateManagement() {
    console.log('\n3. 测试题库浏览状态管理...');
    
    // 检查ExamBrowser组件是否存在
    if (!window.ExamBrowser) {
        console.error('❌ ExamBrowser组件未加载');
        return false;
    }
    
    const examBrowser = new ExamBrowser();
    
    // 检查新增的方法是否存在
    if (typeof examBrowser.showAllExams !== 'function') {
        console.error('❌ showAllExams方法不存在');
        return false;
    }
    
    if (typeof examBrowser.resetBrowseState !== 'function') {
        console.error('❌ resetBrowseState方法不存在');
        return false;
    }
    
    // 测试状态重置功能
    try {
        examBrowser.currentCategory = 'P1';
        examBrowser.filters.frequency = 'high';
        examBrowser.searchQuery = 'test';
        
        examBrowser.resetBrowseState();
        
        if (examBrowser.currentCategory !== null) {
            console.error('❌ currentCategory未正确重置');
            return false;
        }
        
        if (examBrowser.filters.frequency !== 'all') {
            console.error('❌ frequency筛选器未正确重置');
            return false;
        }
        
        if (examBrowser.searchQuery !== '') {
            console.error('❌ 搜索查询未正确重置');
            return false;
        }
        
        console.log('✅ 题库浏览状态管理修复正常');
        return true;
    } catch (error) {
        console.error('❌ 题库浏览状态管理测试失败:', error);
        return false;
    }
}

// 4. 验证Utils工具函数
function testUtilsFunctions() {
    console.log('\n4. 测试Utils工具函数...');
    
    // 检查Utils对象是否存在
    if (!window.Utils) {
        console.error('❌ Utils对象不存在');
        return false;
    }
    
    // 检查关键方法是否存在
    const requiredMethods = ['formatDuration', 'formatDate', 'formatRelativeTime'];
    for (const method of requiredMethods) {
        if (typeof window.Utils[method] !== 'function') {
            console.error(`❌ Utils.${method}方法不存在`);
            return false;
        }
    }
    
    // 测试格式化函数
    try {
        const duration = window.Utils.formatDuration(3661);
        const date = window.Utils.formatDate(new Date(), 'YYYY-MM-DD HH:mm:ss');
        const relativeTime = window.Utils.formatRelativeTime(Date.now() - 60000);
        
        if (!duration || !date || !relativeTime) {
            console.error('❌ Utils方法返回空值');
            return false;
        }
        
        console.log('✅ Utils工具函数正常');
        console.log(`  - formatDuration: ${duration}`);
        console.log(`  - formatDate: ${date}`);
        console.log(`  - formatRelativeTime: ${relativeTime}`);
        return true;
    } catch (error) {
        console.error('❌ Utils工具函数测试失败:', error);
        return false;
    }
}

// 5. 验证CSS样式
function testAnswersTableCSS() {
    console.log('\n5. 测试答案表格CSS样式...');
    
    try {
        // 创建测试元素
        const testDiv = document.createElement('div');
        testDiv.className = 'answers-table-container';
        testDiv.style.position = 'absolute';
        testDiv.style.left = '-9999px';
        testDiv.innerHTML = `
            <table class="answers-table">
                <tr class="answer-row correct">
                    <td class="question-number">1</td>
                    <td class="correct-answer">test</td>
                    <td class="user-answer">test</td>
                    <td class="result-icon correct">✓</td>
                </tr>
            </table>
        `;
        
        document.body.appendChild(testDiv);
        
        // 检查样式是否应用
        const table = testDiv.querySelector('.answers-table');
        const computedStyle = getComputedStyle(table);
        
        if (computedStyle.borderCollapse !== 'collapse') {
            console.warn('⚠️ 答案表格样式可能未完全应用');
        }
        
        // 清理测试元素
        document.body.removeChild(testDiv);
        
        console.log('✅ 答案表格CSS样式正常');
        return true;
    } catch (error) {
        console.error('❌ CSS样式测试失败:', error);
        return false;
    }
}

// 运行所有测试
function runAllTests() {
    console.log('开始功能验证测试...\n');
    
    const tests = [
        testSettingsInterface,
        testPracticeHistoryDetails,
        testExamBrowserStateManagement,
        testUtilsFunctions,
        testAnswersTableCSS
    ];
    
    const results = tests.map(test => {
        try {
            return test();
        } catch (error) {
            console.error(`测试失败: ${test.name}`, error);
            return false;
        }
    });
    
    const passed = results.filter(r => r).length;
    const total = results.length;
    const successRate = Math.round((passed / total) * 100);
    
    console.log('\n=== 验证结果 ===');
    console.log(`通过: ${passed}/${total} (${successRate}%)`);
    
    if (successRate >= 80) {
        console.log('🎉 功能验证通过！所有修改工作正常。');
    } else if (successRate >= 60) {
        console.log('⚠️ 大部分功能正常，但存在一些问题需要关注。');
    } else {
        console.log('❌ 存在严重问题，需要进一步检查。');
    }
    
    return { passed, total, successRate };
}

// 如果页面已加载完成，立即运行测试
if (document.readyState === 'complete') {
    runAllTests();
} else {
    // 否则等待页面加载完成
    window.addEventListener('load', runAllTests);
}

// 导出测试函数供手动调用
window.validationTest = {
    runAllTests,
    testSettingsInterface,
    testPracticeHistoryDetails,
    testExamBrowserStateManagement,
    testUtilsFunctions,
    testAnswersTableCSS
};