/**
 * 练习页面数据采集脚本
 * 用于注入到练习页面中，采集用户的真实答题数据
 */
(function() {
    'use strict';
    
    // 防止重复注入
    if (window.practiceDataCollector) {
        return;
    }
    
    class PracticeDataCollector {
        constructor() {
            this.sessionId = null;
            this.parentWindow = null;
            this.startTime = Date.now();
            this.answers = {};
            this.interactions = [];
            this.pageType = null;
            this.isInitialized = false;
            
            // 绑定方法上下文
            this.handleMessage = this.handleMessage.bind(this);
            this.handleAnswerChange = this.handleAnswerChange.bind(this);
            this.handleGradeClick = this.handleGradeClick.bind(this);
            
            console.log('[DataCollector] 数据采集器已创建');
        }
        
        /**
         * 初始化数据采集器
         */
        initialize() {
            try {
                // 检测页面类型
                this.detectPageStructure();
                
                // 建立与父窗口的通信
                this.setupCommunication();
                
                // 设置答题监听器
                this.setupAnswerListeners();
                
                // 监听评分按钮
                this.setupGradeListener();
                
                // 发送页面就绪信号
                this.sendMessage('SESSION_READY', {
                    pageType: this.pageType,
                    url: window.location.href,
                    timestamp: Date.now()
                });
                
                this.isInitialized = true;
                console.log('[DataCollector] 初始化完成，页面类型:', this.pageType);
                
            } catch (error) {
                console.error('[DataCollector] 初始化失败:', error);
                this.sendMessage('ERROR_OCCURRED', {
                    type: 'initialization_error',
                    message: error.message,
                    timestamp: Date.now()
                });
            }
        }
        
        /**
         * 检测页面结构和类型
         */
        detectPageStructure() {
            // 尝试使用适配器系统
            if (window.PracticeAdapterFactory) {
                try {
                    const factory = new window.PracticeAdapterFactory();
                    this.adapter = factory.createAdapter(document, window);
                    this.pageType = this.adapter.pageType;
                    
                    console.log('[DataCollector] 使用适配器:', this.pageType);
                    return;
                } catch (error) {
                    console.warn('[DataCollector] 适配器创建失败，使用降级检测:', error);
                }
            }
            
            // 降级到原有的检测逻辑
            const indicators = {
                hasTimer: !!document.getElementById('timer'),
                hasGradeButton: !!document.querySelector('button[onclick*="grade"]'),
                hasAnswerKey: !!window.answers,
                hasBlankInputs: document.querySelectorAll('input.blank').length > 0,
                hasRadioInputs: document.querySelectorAll('input[type="radio"]').length > 0,
                hasQuestionNav: !!document.querySelector('.practice-nav')
            };
            
            // 判断页面类型
            if (indicators.hasTimer && indicators.hasGradeButton && indicators.hasAnswerKey) {
                this.pageType = 'ielts-reading-standard';
            } else if (indicators.hasBlankInputs || indicators.hasRadioInputs) {
                this.pageType = 'ielts-reading-basic';
            } else {
                this.pageType = 'unknown';
            }
            
            console.log('[DataCollector] 页面结构检测:', indicators);
            console.log('[DataCollector] 页面类型:', this.pageType);
        }
        
        /**
         * 建立与父窗口的通信
         */
        setupCommunication() {
            // 监听来自父窗口的消息
            window.addEventListener('message', this.handleMessage);
            
            // 检查是否有父窗口
            if (window.opener) {
                this.parentWindow = window.opener;
                console.log('[DataCollector] 检测到父窗口');
            } else if (window.parent !== window) {
                this.parentWindow = window.parent;
                console.log('[DataCollector] 检测到父框架');
            } else {
                console.warn('[DataCollector] 未检测到父窗口');
            }
        }
        
        /**
         * 处理来自父窗口的消息
         */
        handleMessage(event) {
            try {
                const { type, data } = event.data || {};
                
                switch (type) {
                    case 'INIT_SESSION':
                        this.sessionId = data.sessionId;
                        console.log('[DataCollector] 会话已初始化:', this.sessionId);
                        break;
                        
                    case 'REQUEST_STATUS':
                        this.sendProgressUpdate();
                        break;
                        
                    default:
                        console.log('[DataCollector] 收到未知消息:', type);
                }
            } catch (error) {
                console.error('[DataCollector] 消息处理错误:', error);
            }
        }
        
        /**
         * 设置答题监听器
         */
        setupAnswerListeners() {
            // 优先使用适配器
            if (this.adapter && this.adapter.isSupported) {
                try {
                    this.adapter.setupListeners(this.handleAnswerChange);
                    console.log('[DataCollector] 使用适配器设置监听器');
                    return;
                } catch (error) {
                    console.warn('[DataCollector] 适配器监听器设置失败:', error);
                }
            }
            
            // 降级到原有逻辑
            // 监听文本输入框
            const textInputs = document.querySelectorAll('input.blank, input[type="text"]');
            textInputs.forEach(input => {
                input.addEventListener('input', this.handleAnswerChange);
                input.addEventListener('change', this.handleAnswerChange);
            });
            
            // 监听单选按钮
            const radioInputs = document.querySelectorAll('input[type="radio"]');
            radioInputs.forEach(input => {
                input.addEventListener('change', this.handleAnswerChange);
            });
            
            // 监听多选框
            const checkboxInputs = document.querySelectorAll('input[type="checkbox"]');
            checkboxInputs.forEach(input => {
                input.addEventListener('change', this.handleAnswerChange);
            });
            
            console.log('[DataCollector] 答题监听器已设置:', {
                textInputs: textInputs.length,
                radioInputs: radioInputs.length,
                checkboxInputs: checkboxInputs.length
            });
        }
        
        /**
         * 处理答题变化
         */
        handleAnswerChange(event) {
            const element = event.target;
            const questionId = element.name || element.id;
            
            if (!questionId) return;
            
            let value = null;
            if (element.type === 'radio' || element.type === 'checkbox') {
                value = element.checked ? element.value : null;
            } else {
                value = element.value;
            }
            
            // 记录答题数据
            const answerData = {
                questionId: questionId,
                value: value,
                type: element.type,
                timestamp: Date.now(),
                timeFromStart: Date.now() - this.startTime
            };
            
            // 更新答案记录
            if (!this.answers[questionId]) {
                this.answers[questionId] = [];
            }
            this.answers[questionId].push(answerData);
            
            // 记录交互行为
            this.interactions.push({
                type: 'answer_change',
                questionId: questionId,
                oldValue: this.getCurrentAnswer(questionId, -2), // 倒数第二个值
                newValue: value,
                timestamp: Date.now()
            });
            
            console.log('[DataCollector] 答题变化:', answerData);
            
            // 发送进度更新
            this.sendProgressUpdate();
        }
        
        /**
         * 获取当前答案
         */
        getCurrentAnswer(questionId, index = -1) {
            const history = this.answers[questionId];
            if (!history || history.length === 0) return null;
            
            const targetIndex = index < 0 ? history.length + index : index;
            return history[targetIndex]?.value || null;
        }
        
        /**
         * 设置评分按钮监听器
         */
        setupGradeListener() {
            // 查找评分按钮
            const gradeButtons = document.querySelectorAll('button[onclick*="grade"], button.primary');
            
            gradeButtons.forEach(button => {
                // 检查按钮文本是否包含提交相关词汇
                const buttonText = button.textContent.toLowerCase();
                if (buttonText.includes('submit') || buttonText.includes('grade') || 
                    buttonText.includes('提交') || buttonText.includes('评分')) {
                    
                    button.addEventListener('click', this.handleGradeClick);
                    console.log('[DataCollector] 评分按钮监听器已设置:', button.textContent);
                }
            });
            
            // 如果没找到按钮，尝试拦截原有的grade函数
            if (typeof window.grade === 'function') {
                const originalGrade = window.grade;
                window.grade = () => {
                    // 先执行原有的评分逻辑
                    const result = originalGrade();
                    
                    // 延迟一点时间让评分结果显示出来
                    setTimeout(() => {
                        this.handleGradeClick();
                    }, 100);
                    
                    return result;
                };
                console.log('[DataCollector] 已拦截grade函数');
            }
        }
        
        /**
         * 处理评分按钮点击
         */
        handleGradeClick() {
            console.log('[DataCollector] 检测到评分操作');
            
            // 延迟一点时间确保评分结果已生成
            setTimeout(() => {
                try {
                    const results = this.extractFinalResults();
                    this.sendMessage('PRACTICE_COMPLETE', results);
                } catch (error) {
                    console.error('[DataCollector] 提取结果失败:', error);
                    this.sendMessage('ERROR_OCCURRED', {
                        type: 'result_extraction_error',
                        message: error.message,
                        timestamp: Date.now()
                    });
                }
            }, 200);
        }
        
        /**
         * 提取最终练习结果
         */
        extractFinalResults() {
            const endTime = Date.now();
            const duration = Math.round((endTime - this.startTime) / 1000); // 秒
            
            // 提取当前所有答案
            const currentAnswers = {};
            Object.keys(this.answers).forEach(questionId => {
                currentAnswers[questionId] = this.getCurrentAnswer(questionId);
            });
            
            // 尝试从页面提取分数信息
            let scoreInfo = this.extractScoreFromPage();
            
            // 如果页面没有分数信息，尝试计算
            if (!scoreInfo && window.answers) {
                scoreInfo = this.calculateScore(currentAnswers);
            }
            
            const results = {
                sessionId: this.sessionId,
                startTime: this.startTime,
                endTime: endTime,
                duration: duration,
                answers: currentAnswers,
                answerHistory: this.answers,
                interactions: this.interactions,
                scoreInfo: scoreInfo,
                pageType: this.pageType,
                url: window.location.href
            };
            
            console.log('[DataCollector] 最终结果:', results);
            return results;
        }
        
        /**
         * 从页面提取分数信息
         */
        extractScoreFromPage() {
            // 优先使用适配器
            if (this.adapter && this.adapter.isSupported) {
                try {
                    const scoreInfo = this.adapter.getScoreInfo();
                    if (scoreInfo) {
                        console.log('[DataCollector] 适配器提取分数成功:', scoreInfo);
                        return scoreInfo;
                    }
                } catch (error) {
                    console.warn('[DataCollector] 适配器分数提取失败:', error);
                }
            }
            
            // 降级到原有逻辑
            try {
                // 查找结果显示区域
                const resultsEl = document.getElementById('results');
                if (!resultsEl || !resultsEl.innerHTML.trim()) {
                    return null;
                }
                
                const resultsText = resultsEl.textContent || resultsEl.innerText;
                
                // 尝试提取分数 (格式: "Score: 8/13")
                const scoreMatch = resultsText.match(/Score:\s*(\d+)\/(\d+)/i);
                if (scoreMatch) {
                    const correct = parseInt(scoreMatch[1]);
                    const total = parseInt(scoreMatch[2]);
                    const accuracy = total > 0 ? correct / total : 0;
                    
                    return {
                        correct: correct,
                        total: total,
                        accuracy: accuracy,
                        percentage: Math.round(accuracy * 100),
                        source: 'page_extraction'
                    };
                }
                
                // 尝试提取准确率 (格式: "Accuracy 85%")
                const accuracyMatch = resultsText.match(/Accuracy\s*(\d+)%/i);
                if (accuracyMatch) {
                    const percentage = parseInt(accuracyMatch[1]);
                    return {
                        percentage: percentage,
                        accuracy: percentage / 100,
                        source: 'page_extraction'
                    };
                }
                
            } catch (error) {
                console.error('[DataCollector] 页面分数提取失败:', error);
            }
            
            return null;
        }
        
        /**
         * 计算分数（如果页面有答案数据）
         */
        calculateScore(currentAnswers) {
            if (!window.answers) {
                return null;
            }
            
            try {
                let correct = 0;
                let total = 0;
                const details = {};
                
                Object.keys(window.answers).forEach(questionId => {
                    const correctAnswer = window.answers[questionId];
                    const userAnswer = currentAnswers[questionId];
                    
                    total++;
                    
                    // 简单的答案比较（可能需要根据实际情况调整）
                    const isCorrect = this.compareAnswers(userAnswer, correctAnswer);
                    if (isCorrect) {
                        correct++;
                    }
                    
                    details[questionId] = {
                        userAnswer: userAnswer,
                        correctAnswer: correctAnswer,
                        isCorrect: isCorrect
                    };
                });
                
                const accuracy = total > 0 ? correct / total : 0;
                
                return {
                    correct: correct,
                    total: total,
                    accuracy: accuracy,
                    percentage: Math.round(accuracy * 100),
                    details: details,
                    source: 'calculation'
                };
                
            } catch (error) {
                console.error('[DataCollector] 分数计算失败:', error);
                return null;
            }
        }
        
        /**
         * 比较用户答案和标准答案
         */
        compareAnswers(userAnswer, correctAnswer) {
            if (!userAnswer || !correctAnswer) {
                return false;
            }
            
            // 标准化答案进行比较
            const normalize = (str) => String(str).trim().toLowerCase();
            
            return normalize(userAnswer) === normalize(correctAnswer);
        }
        
        /**
         * 发送进度更新
         */
        sendProgressUpdate() {
            if (!this.isInitialized) return;
            
            const answeredCount = Object.keys(this.answers).filter(
                questionId => this.getCurrentAnswer(questionId) !== null
            ).length;
            
            const totalQuestions = this.getTotalQuestions();
            
            const progressData = {
                sessionId: this.sessionId,
                answeredQuestions: answeredCount,
                totalQuestions: totalQuestions,
                elapsedTime: Math.round((Date.now() - this.startTime) / 1000),
                timestamp: Date.now()
            };
            
            this.sendMessage('PROGRESS_UPDATE', progressData);
        }
        
        /**
         * 获取总题目数
         */
        getTotalQuestions() {
            // 尝试从答案数据获取
            if (window.answers) {
                return Object.keys(window.answers).length;
            }
            
            // 尝试从页面元素获取
            const inputs = document.querySelectorAll('input[name^="q"], input.blank');
            const uniqueNames = new Set();
            inputs.forEach(input => {
                if (input.name) {
                    uniqueNames.add(input.name);
                }
            });
            
            return uniqueNames.size || inputs.length;
        }
        
        /**
         * 发送消息到父窗口
         */
        sendMessage(type, data) {
            if (!this.parentWindow) {
                console.warn('[DataCollector] 无法发送消息，父窗口不存在');
                return;
            }
            
            const message = {
                type: type,
                data: data,
                timestamp: Date.now(),
                source: 'practice_page'
            };
            
            try {
                this.parentWindow.postMessage(message, '*');
                console.log('[DataCollector] 消息已发送:', type, data);
            } catch (error) {
                console.error('[DataCollector] 消息发送失败:', error);
            }
        }
        
        /**
         * 获取采集器状态
         */
        getStatus() {
            return {
                isInitialized: this.isInitialized,
                sessionId: this.sessionId,
                pageType: this.pageType,
                startTime: this.startTime,
                answersCount: Object.keys(this.answers).length,
                interactionsCount: this.interactions.length
            };
        }
    }
    
    // 创建全局实例
    window.practiceDataCollector = new PracticeDataCollector();
    
    // 页面加载完成后自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.practiceDataCollector.initialize();
        });
    } else {
        // 页面已经加载完成
        setTimeout(() => {
            window.practiceDataCollector.initialize();
        }, 100);
    }
    
    console.log('[DataCollector] 练习页面数据采集脚本已加载');
    
})();