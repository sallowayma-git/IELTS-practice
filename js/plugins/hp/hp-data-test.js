/**
 * HP页面数据通信测试插件
 * 用于验证插件能正确获取examIndex和practiceRecords
 */

(function() {
    'use strict';

    console.log('[HP Data Test] 开始数据通信测试');

    // 测试结果收集
    const testResults = {
        hpCoreAvailable: false,
        dataLoaded: false,
        examIndexCount: 0,
        practiceRecordsCount: 0,
        dataUpdateTriggered: false,
        errors: []
    };

    // 等待hpCore准备就绪
    hpCore.ready(function() {
        console.log('[HP Data Test] hpCore已就绪');
        testResults.hpCoreAvailable = true;

        // 测试获取数据
        testDataAccess();

        // 监听数据更新
        testDataUpdates();

        // 输出测试结果
        outputTestResults();
    });

    function testDataAccess() {
        try {
            const examIndex = hpCore.getExamIndex();
            const practiceRecords = hpCore.getRecords();

            testResults.examIndexCount = examIndex.length;
            testResults.practiceRecordsCount = practiceRecords.length;

            console.log('[HP Data Test] 数据访问测试结果:');
            console.log('- 题库数据:', examIndex.length, '条');
            console.log('- 练习记录:', practiceRecords.length, '条');

            if (examIndex.length > 0) {
                console.log('- 题库示例:', examIndex.slice(0, 2));
            }

            if (practiceRecords.length > 0) {
                console.log('- 记录示例:', practiceRecords.slice(0, 2));
            }

            testResults.dataLoaded = examIndex.length > 0 || practiceRecords.length > 0;

        } catch (error) {
            console.error('[HP Data Test] 数据访问测试失败:', error);
            testResults.errors.push('数据访问测试失败: ' + error.message);
        }
    }

    function testDataUpdates() {
        try {
            hpCore.onDataUpdated(function(data) {
                console.log('[HP Data Test] 收到数据更新事件:', data);
                testResults.dataUpdateTriggered = true;

                // 更新测试结果
                testResults.examIndexCount = data.examIndex ? data.examIndex.length : 0;
                testResults.practiceRecordsCount = data.practiceRecords ? data.practiceRecords.length : 0;

                console.log('[HP Data Test] 更新后的数据统计:');
                console.log('- 题库数据:', testResults.examIndexCount, '条');
                console.log('- 练习记录:', testResults.practiceRecordsCount, '条');
            });

            console.log('[HP Data Test] 数据更新监听器已设置');

        } catch (error) {
            console.error('[HP Data Test] 数据更新测试失败:', error);
            testResults.errors.push('数据更新测试失败: ' + error.message);
        }
    }

    function outputTestResults() {
        console.log('[HP Data Test] === 测试结果汇总 ===');
        console.log('hpCore可用:', testResults.hpCoreAvailable ? '✅' : '❌');
        console.log('数据已加载:', testResults.dataLoaded ? '✅' : '❌');
        console.log('题库数据条数:', testResults.examIndexCount);
        console.log('练习记录条数:', testResults.practiceRecordsCount);
        console.log('数据更新触发:', testResults.dataUpdateTriggered ? '✅' : '❌');

        if (testResults.errors.length > 0) {
            console.log('错误信息:');
            testResults.errors.forEach(error => console.log('-', error));
        }

        // 判断测试是否通过
        const allTestsPassed = testResults.hpCoreAvailable &&
                              (testResults.dataLoaded || testResults.dataUpdateTriggered);

        console.log('[HP Data Test] 总体结果:', allTestsPassed ? '✅ 通过' : '❌ 失败');

        // 如果测试失败，提供调试建议
        if (!allTestsPassed) {
            console.log('[HP Data Test] 调试建议:');
            if (!testResults.hpCoreAvailable) {
                console.log('- 检查hp-core-bridge.js是否正确加载');
            }
            if (!testResults.dataLoaded) {
                console.log('- 检查题库数据和练习记录是否已加载到storage');
                console.log('- 尝试刷新页面或重新加载题库');
            }
            if (!testResults.dataUpdateTriggered) {
                console.log('- 检查数据更新事件是否正常触发');
                console.log('- 尝试进行一些数据操作来触发更新');
            }
        }

        // 触发自定义事件供其他插件使用
        window.dispatchEvent(new CustomEvent('hp:dataTestCompleted', {
            detail: testResults
        }));
    }

    // 如果hpCore不存在，输出错误信息
    if (!window.hpCore) {
        console.error('[HP Data Test] hpCore未找到，请确保hp-core-bridge.js已加载');
        testResults.errors.push('hpCore未找到');
        outputTestResults();
    }

})();