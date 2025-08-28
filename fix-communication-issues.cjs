const fs = require('fs');
const path = require('path');

// 通信代码模板
const communicationCodeTemplate = `
<script>
// 练习页面增强器 - 跨窗口通信功能
(function() {
    'use strict';
    
    let sessionData = null;
    let parentWindow = null;
    let startTime = Date.now();
    let isSessionActive = false;
    
    // 初始化通信功能
    function initializeCommunication() {
        console.log('[PracticePageEnhancer] 初始化通信功能');
        
        // 监听来自父窗口的消息
        window.addEventListener('message', function(event) {
            console.log('[PracticePageEnhancer] 收到消息:', event.data);
            
            if (event.data && event.data.type === 'INIT_SESSION') {
                sessionData = event.data.data;
                parentWindow = event.source;
                isSessionActive = true;
                startTime = Date.now();
                
                console.log('[PracticePageEnhancer] 会话已初始化:', sessionData);
                
                // 发送会话初始化确认
                sendMessage('SESSION_INITIALIZED', {
                    sessionId: sessionData.sessionId,
                    examId: sessionData.examId,
                    timestamp: Date.now()
                });
                
                // 设置页面关闭时的数据发送
                setupPageUnloadHandler();
            }
        });
        
        // 检测答题完成
        setupAnswerDetection();
        
        console.log('[PracticePageEnhancer] 通信功能已初始化');
    }
    
    // 发送消息到父窗口
    function sendMessage(type, data) {
        if (parentWindow && isSessionActive) {
            const message = {
                type: type,
                data: data,
                source: 'practice_page',
                timestamp: Date.now()
            };
            
            console.log('[PracticePageEnhancer] 发送消息:', message);
            parentWindow.postMessage(message, '*');
        }
    }
    
    // 设置答题检测
    function setupAnswerDetection() {
        // 检测提交按钮点击
        document.addEventListener('click', function(event) {
            const target = event.target;
            
            // 检测是否是提交相关的按钮
            if (target.tagName === 'BUTTON' && 
                (target.textContent.includes('提交') || 
                 target.textContent.includes('Submit') ||
                 target.textContent.includes('完成') ||
                 target.textContent.includes('Check') ||
                 target.id === 'submit-btn' ||
                 target.className.includes('submit'))) {
                
                console.log('[PracticePageEnhancer] 检测到提交按钮点击');
                
                // 延迟收集数据，确保答案已处理
                setTimeout(function() {
                    collectAndSendPracticeData();
                }, 1000);
            }
        });
        
        // 检测表单提交
        document.addEventListener('submit', function(event) {
            console.log('[PracticePageEnhancer] 检测到表单提交');
            setTimeout(function() {
                collectAndSendPracticeData();
            }, 1000);
        });
    }
    
    // 设置页面卸载处理器
    function setupPageUnloadHandler() {
        window.addEventListener('beforeunload', function() {
            if (isSessionActive) {
                collectAndSendPracticeData();
            }
        });
        
        // 页面隐藏时也发送数据
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'hidden' && isSessionActive) {
                collectAndSendPracticeData();
            }
        });
    }
    
    // 收集并发送练习数据
    function collectAndSendPracticeData() {
        if (!isSessionActive || !sessionData) {
            console.log('[PracticePageEnhancer] 会话未激活，跳过数据收集');
            return;
        }
        
        console.log('[PracticePageEnhancer] 开始收集练习数据');
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        // 收集答案数据
        const answers = collectAnswers();
        const score = calculateScore(answers);
        
        const practiceData = {
            sessionId: sessionData.sessionId,
            examId: sessionData.examId,
            examTitle: sessionData.examTitle,
            examCategory: sessionData.examCategory,
            startTime: startTime,
            endTime: endTime,
            duration: duration,
            answers: answers,
            score: score.correct,
            totalQuestions: score.total,
            accuracy: score.total > 0 ? score.correct / score.total : 0,
            percentage: score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0,
            url: window.location.href,
            source: 'page_extraction',
            timestamp: endTime
        };
        
        console.log('[PracticePageEnhancer] 练习数据已收集:', practiceData);
        
        // 发送练习完成数据
        sendMessage('PRACTICE_COMPLETE', practiceData);
        
        // 标记会话为非活跃状态，避免重复发送
        isSessionActive = false;
    }
    
    // 收集页面中的答案
    function collectAnswers() {
        const answers = [];
        
        // 收集输入框答案
        const inputs = document.querySelectorAll('input[type="text"], input.blank, input.blank-input');
        inputs.forEach(function(input, index) {
            if (input.value.trim()) {
                answers.push({
                    type: 'text',
                    question: index + 1,
                    answer: input.value.trim(),
                    element: input.tagName + (input.className ? '.' + input.className : '')
                });
            }
        });
        
        // 收集选择题答案
        const selects = document.querySelectorAll('select');
        selects.forEach(function(select, index) {
            if (select.value) {
                answers.push({
                    type: 'select',
                    question: index + 1,
                    answer: select.value,
                    element: 'SELECT'
                });
            }
        });
        
        // 收集单选按钮答案
        const radios = document.querySelectorAll('input[type="radio"]:checked');
        radios.forEach(function(radio, index) {
            answers.push({
                type: 'radio',
                question: radio.name || index + 1,
                answer: radio.value,
                element: 'INPUT[type="radio"]'
            });
        });
        
        // 收集复选框答案
        const checkboxes = document.querySelectorAll('input[type="checkbox"]:checked');
        checkboxes.forEach(function(checkbox, index) {
            answers.push({
                type: 'checkbox',
                question: checkbox.name || index + 1,
                answer: checkbox.value,
                element: 'INPUT[type="checkbox"]'
            });
        });
        
        console.log('[PracticePageEnhancer] 收集到答案:', answers);
        return answers;
    }
    
    // 计算得分（简单实现）
    function calculateScore(answers) {
        // 这里只是简单计算有答案的题目数量
        // 实际得分需要根据具体题目的正确答案来计算
        const total = answers.length;
        const correct = answers.filter(function(answer) {
            return answer.answer && answer.answer.trim().length > 0;
        }).length;
        
        return {
            correct: correct,
            total: total
        };
    }
    
    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeCommunication);
    } else {
        initializeCommunication();
    }
    
})();
</script>`;

// 检查文件是否已包含通信代码
function hasCommuncationCode(content) {
    return content.includes('postMessage') || 
           content.includes('PRACTICE_COMPLETE') ||
           content.includes('PracticePageEnhancer');
}

// 为HTML文件添加通信代码
function enhanceHtmlFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // 检查是否已有通信代码
        if (hasCommuncationCode(content)) {
            console.log(`跳过 ${filePath} - 已包含通信代码`);
            return false;
        }
        
        let enhancedContent;
        
        // 尝试在</body>标签前插入
        const bodyCloseIndex = content.lastIndexOf('</body>');
        if (bodyCloseIndex !== -1) {
            enhancedContent = content.slice(0, bodyCloseIndex) + 
                             communicationCodeTemplate + 
                             content.slice(bodyCloseIndex);
        } else {
            // 如果没有</body>标签，尝试在</html>标签前插入
            const htmlCloseIndex = content.lastIndexOf('</html>');
            if (htmlCloseIndex !== -1) {
                enhancedContent = content.slice(0, htmlCloseIndex) + 
                                 communicationCodeTemplate + 
                                 content.slice(htmlCloseIndex);
            } else {
                // 如果都没有，直接在文件末尾添加
                enhancedContent = content + communicationCodeTemplate;
            }
        }
        
        // 写入增强后的内容
        fs.writeFileSync(filePath, enhancedContent, 'utf8');
        console.log(`已增强 ${filePath}`);
        return true;
        
    } catch (error) {
        console.error(`处理文件 ${filePath} 时出错:`, error.message);
        return false;
    }
}

// 修复特定的有问题的文件
function fixSpecificFiles() {
    const problematicFiles = [
        'P1（12+8）/1.高频(网页由窦立盛老师制作)/1.A Brief History of Tea 茶叶简史/P1 - A Brief History of Tea【高】.html',
        'P2（14+2）/1.高频(网页由窦立盛老师制作)/1.A new look for Talbot Park 塔尔博特公园的新面貌/P2 - A new look for Talbot Park【高】.html',
        'P3 （20+6）/1.高频(网页由🕊️制作)/1.A closer examination of a study on verbal and non - verbal messages 语言与非语言信息研究审视/P3 - A closer examination of a study on verbal and non-verbal messages【高】.html'
    ];
    
    let fixedCount = 0;
    
    for (const filePath of problematicFiles) {
        if (fs.existsSync(filePath)) {
            console.log(`修复文件: ${filePath}`);
            if (enhanceHtmlFile(filePath)) {
                fixedCount++;
            }
        } else {
            console.log(`文件不存在: ${filePath}`);
        }
    }
    
    return fixedCount;
}

// 主函数
function main() {
    console.log('开始修复通信问题...');
    
    const fixedCount = fixSpecificFiles();
    
    console.log(`\n修复完成！总共修复了 ${fixedCount} 个文件`);
}

// 运行主函数
if (require.main === module) {
    main();
}

module.exports = {
    enhanceHtmlFile,
    fixSpecificFiles,
    hasCommuncationCode
};