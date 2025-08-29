/**
 * 练习页面增强脚本
 * 用于修复跨窗口通信和数据传输问题
 * 这个脚本会被注入到所有练习页面中
 */
(function() {
    'use strict';
    
    console.log('[PracticeEnhancer] 练习页面增强脚本开始加载');
    
    // 防止重复注入
    if (window.practicePageEnhancer) {
        console.log('[PracticeEnhancer] 脚本已存在，跳过注入');
        return;
    }
    
    class PracticePageEnhancer {
        constructor() {
            this.sessionId = null;
            this.parentWindow = null;
            this.startTime = Date.now();
            this.answers = {};
            this.interactions = [];
            this.isInitialized = false;
            this.isSubmitted = false; // 防止重复提交
            this.originalGradeFunction = null;
            
            // 绑定方法上下文
            this.handleMessage = this.handleMessage.bind(this);
            this.handleAnswerChange = this.handleAnswerChange.bind(this);
            this.handleSubmit = this.handleSubmit.bind(this);
            
            console.log('[PracticeEnhancer] 增强器已创建');
        }
        
        /**
         * 初始化增强器
         */
        initialize() {
            try {
                console.log('[PracticeEnhancer] 开始初始化');
                
                // 建立与父窗口的通信
                this.setupCommunication();
                
                // 设置答题监听器
                this.setupAnswerListeners();
                
                // 拦截提交功能
                this.interceptSubmitFunction();
                
                // 自动发送准备就绪消息
                this.sendAutoReadyMessage();
                
                // 发送就绪信号
                this.sendReadySignal();
                
                this.isInitialized = true;
                console.log('[PracticeEnhancer] 初始化完成');
                
            } catch (error) {
                console.error('[PracticeEnhancer] 初始化失败:', error);
            }
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
                console.log('[PracticeEnhancer] 检测到父窗口 (opener)');
            } else if (window.parent !== window) {
                this.parentWindow = window.parent;
                console.log('[PracticeEnhancer] 检测到父框架 (parent)');
            } else {
                console.warn('[PracticeEnhancer] 未检测到父窗口');
            }
        }
        
        /**
         * 处理来自父窗口的消息
         */
        handleMessage(event) {
            try {
                const { type, data } = event.data || {};
                console.log('[PracticeEnhancer] 收到消息:', type, data);
                
                switch (type) {
                    case 'INIT_SESSION':
                        this.sessionId = data.sessionId;
                        console.log('[PracticeEnhancer] 会话已初始化:', this.sessionId);
                        this.sendMessage('SESSION_READY', {
                            pageType: this.detectPageType(),
                            url: window.location.href,
                            timestamp: Date.now()
                        });
                        break;
                        
                    case 'REQUEST_STATUS':
                        this.sendProgressUpdate();
                        break;

                    case 'HEARTBEAT':
                        // 响应心跳检测
                        this.sendMessage('HEARTBEAT_RESPONSE', {
                            timestamp: Date.now()
                        });
                        break;

                    case 'RECONNECT_REQUEST':
                        // 处理重连请求
                        console.log('[PracticeEnhancer] 处理重连请求');
                        this.handleReconnectRequest(data);
                        break;
                        
                    default:
                        console.log('[PracticeEnhancer] 未知消息类型:', type);
                }
            } catch (error) {
                console.error('[PracticeEnhancer] 消息处理错误:', error);
                this.handleCommunicationError(error, 'message_handling');
            }
        }

        /**
         * 处理重连请求
         */
        handleReconnectRequest(data) {
            try {
                // 重新建立连接状态
                this.isInitialized = true;
                
                // 发送重连响应
                this.sendMessage('RECONNECT_RESPONSE', {
                    windowId: data.windowId,
                    status: 'reconnected',
                    timestamp: Date.now()
                });

                // 发送当前状态
                this.sendProgressUpdate();
                
                console.log('[PracticeEnhancer] 重连成功');
            } catch (error) {
                console.error('[PracticeEnhancer] 重连处理失败:', error);
            }
        }

        /**
         * 处理通信错误
         */
        handleCommunicationError(error, type, data) {
            console.error(`[PracticeEnhancer] 通信错误:`, error);
            
            // 记录错误
            if (!this.communicationErrors) {
                this.communicationErrors = [];
            }
            
            this.communicationErrors.push({
                error: error.message,
                type: type,
                data: data,
                timestamp: Date.now()
            });

            // 限制错误记录数量
            if (this.communicationErrors.length > 50) {
                this.communicationErrors = this.communicationErrors.slice(-25);
            }

            // 实现自动重试逻辑（有限次数）
            if (!this.retryCount) {
                this.retryCount = 0;
            }

            if (this.retryCount < 3) {
                this.retryCount++;
                console.log(`[PracticeEnhancer] 尝试重试通信 (第${this.retryCount}次)`);
                
                setTimeout(() => {
                    if (this.attemptReconnection()) {
                        // 重连成功，重置重试计数
                        this.retryCount = 0;
                        
                        // 尝试重新发送失败的消息
                        if (type && data) {
                            console.log('[PracticeEnhancer] 重新发送失败的消息:', type);
                            this.sendMessage(type, data, { retry: false });
                        }
                    }
                }, 1000 * this.retryCount); // 递增延迟
            } else {
                console.warn('[PracticeEnhancer] 通信重试次数已达上限，切换到降级模式');
                this.enterDegradedMode();
            }
        }

        /**
         * 进入降级模式
         */
        enterDegradedMode() {
            console.log('[PracticeEnhancer] 进入降级模式');
            this.degradedMode = true;
            
            // 在降级模式下，所有通信都使用备用机制
            this.parentWindow = null;
            
            // 显示用户友好的提示（如果可能）
            this.showUserFriendlyError();
        }

        /**
         * 显示用户友好的错误提示
         */
        showUserFriendlyError() {
            try {
                // 尝试在页面上显示友好的提示信息
                const existingNotice = document.getElementById('communication-notice');
                if (existingNotice) {
                    return; // 已经显示过了
                }

                const notice = document.createElement('div');
                notice.id = 'communication-notice';
                notice.style.cssText = `
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    background: #fef3cd;
                    border: 1px solid #fecaca;
                    color: #92400e;
                    padding: 12px 16px;
                    border-radius: 6px;
                    font-size: 14px;
                    z-index: 10000;
                    max-width: 300px;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                `;
                notice.innerHTML = `
                    <div style="font-weight: 600; margin-bottom: 4px;">通信提示</div>
                    <div>与主窗口的连接不稳定，练习数据将自动保存到本地。</div>
                `;

                document.body.appendChild(notice);

                // 5秒后自动隐藏
                setTimeout(() => {
                    if (notice.parentNode) {
                        notice.parentNode.removeChild(notice);
                    }
                }, 5000);
            } catch (error) {
                console.warn('[PracticeEnhancer] 无法显示用户提示:', error);
            }
        }

        /**
         * 处理通信回退机制
         */
        handleCommunicationFallback(type, data) {
            console.log('[PracticeEnhancer] 使用备用通信机制:', type);
            
            try {
                // 使用localStorage作为备用通信方式
                const fallbackData = {
                    type,
                    data,
                    timestamp: Date.now(),
                    sessionId: this.sessionId,
                    source: 'practice_page_fallback'
                };
                
                const storageKey = `practice_communication_fallback_${this.sessionId || 'unknown'}`;
                localStorage.setItem(storageKey, JSON.stringify(fallbackData));
                
                // 触发存储事件通知主窗口
                try {
                    window.dispatchEvent(new StorageEvent('storage', {
                        key: storageKey,
                        newValue: JSON.stringify(fallbackData),
                        oldValue: null,
                        storageArea: localStorage
                    }));
                    
                    console.log('[PracticeEnhancer] 备用通信消息已发送');
                } catch (eventError) {
                    console.warn('[PracticeEnhancer] 无法触发存储事件:', eventError);
                }
                
                // 设置定时清理
                setTimeout(() => {
                    try {
                        localStorage.removeItem(storageKey);
                    } catch (e) {
                        console.warn('[PracticeEnhancer] 清理备用通信数据失败:', e);
                    }
                }, 30000); // 30秒后清理
                
            } catch (error) {
                console.error('[PracticeEnhancer] 备用通信机制失败:', error);
            }
        }

        /**
         * 尝试重新连接
         */
        attemptReconnection() {
            console.log('[PracticeEnhancer] 尝试重新连接...');
            
            try {
                // 重新检测父窗口
                if (window.opener && !window.opener.closed) {
                    this.parentWindow = window.opener;
                } else if (window.parent !== window) {
                    this.parentWindow = window.parent;
                } else {
                    console.warn('[PracticeEnhancer] 无法找到有效的父窗口');
                    return false;
                }

                // 发送重连信号
                this.sendMessage('RECONNECTION_ATTEMPT', {
                    pageType: this.detectPageType(),
                    url: window.location.href,
                    timestamp: Date.now()
                });

                return true;
            } catch (error) {
                console.error('[PracticeEnhancer] 重连尝试失败:', error);
                return false;
            }
        }
        
        /**
         * 检测页面类型
         */
        detectPageType() {
            const title = document.title || '';
            if (title.includes('P1')) return 'P1';
            if (title.includes('P2')) return 'P2';
            if (title.includes('P3')) return 'P3';
            return 'unknown';
        }
        
        /**
         * 设置答题监听器
         */
        setupAnswerListeners() {
            console.log('[PracticeEnhancer] 设置答题监听器');
            
            // 监听所有输入变化
            document.addEventListener('change', this.handleAnswerChange);
            document.addEventListener('input', this.handleAnswerChange);
            
            // 监听点击事件（用于单选按钮等）
            document.addEventListener('click', (event) => {
                if (event.target.type === 'radio' || event.target.type === 'checkbox') {
                    setTimeout(() => this.handleAnswerChange(event), 10);
                }
            });
            
            console.log('[PracticeEnhancer] 答题监听器已设置');
        }
        
        /**
         * 处理答题变化
         */
        handleAnswerChange(event) {
            const element = event.target;
            const questionId = element.name || element.id;
            
            if (!questionId || !questionId.startsWith('q')) return;
            
            let value = null;
            if (element.type === 'radio') {
                value = element.checked ? element.value : null;
            } else if (element.type === 'checkbox') {
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
            this.answers[questionId] = value;
            
            // 记录交互行为
            this.interactions.push({
                type: 'answer_change',
                questionId: questionId,
                value: value,
                timestamp: Date.now()
            });
            
            console.log('[PracticeEnhancer] 答题变化:', answerData);
            
            // 发送进度更新
            this.sendProgressUpdate();
        }
        
        /**
         * 拦截提交功能
         */
        interceptSubmitFunction() {
            console.log('[PracticeEnhancer] 拦截提交功能');
            
            // 保存原始的grade函数
            if (typeof window.grade === 'function') {
                this.originalGradeFunction = window.grade;
                
                // 替换grade函数
                window.grade = () => {
                    console.log('[PracticeEnhancer] 拦截到grade函数调用');
                    
                    // 先执行原始的评分逻辑
                    const result = this.originalGradeFunction();
                    
                    // 等待更长时间让评分结果完全显示出来
                    setTimeout(() => {
                        this.handleSubmit();
                    }, 800); // 增加等待时间
                    
                    return result;
                };
                
                console.log('[PracticeEnhancer] grade函数已被拦截');
            }
            
            // 监听提交按钮点击
            document.addEventListener('click', (event) => {
                const button = event.target;
                if (button.tagName === 'BUTTON' && 
                    (button.textContent.includes('Submit') || 
                     button.textContent.includes('提交') ||
                     button.onclick && button.onclick.toString().includes('grade'))) {
                    
                    console.log('[PracticeEnhancer] 检测到提交按钮点击');
                    setTimeout(() => {
                        this.handleSubmit();
                    }, 1000); // 增加等待时间确保grade函数执行完毕
                }
            });
        }
        
        /**
         * 处理提交
         */
        handleSubmit() {
            // 防止重复提交
            if (this.isSubmitted) {
                console.log('[PracticeEnhancer] 已经提交过，跳过重复提交');
                return;
            }
            
            console.log('[PracticeEnhancer] 处理提交');
            this.isSubmitted = true; // 标记为已提交
            
            // 等待更长时间确保grade函数完全执行完毕
            setTimeout(() => {
                try {
                    const results = this.extractFinalResults();
                    this.sendMessage('PRACTICE_COMPLETE', results);
                    console.log('[PracticeEnhancer] 练习完成数据已发送');
                } catch (error) {
                    console.error('[PracticeEnhancer] 提取结果失败:', error);
                    this.sendMessage('ERROR_OCCURRED', {
                        type: 'result_extraction_error',
                        message: error.message,
                        timestamp: Date.now()
                    });
                }
            }, 500); // 增加等待时间到500ms
        }
        
        /**
         * 提取最终练习结果
         */
        extractFinalResults() {
            const endTime = Date.now();
            const duration = Math.round((endTime - this.startTime) / 1000); // 秒
            
            // 提取当前所有答案
            const currentAnswers = { ...this.answers };
            
            // 尝试从页面提取分数信息
            let scoreInfo = this.extractScoreFromPage();
            
            // 如果页面没有分数信息，尝试使用答案数据计算
            if (!scoreInfo && window.answerKey) {
                scoreInfo = this.calculateScore(currentAnswers);
            }
            
            const results = {
                sessionId: this.sessionId,
                startTime: this.startTime,
                endTime: endTime,
                duration: duration,
                answers: currentAnswers,
                interactions: this.interactions,
                scoreInfo: scoreInfo,
                pageType: this.detectPageType(),
                url: window.location.href
            };
            
            console.log('[PracticeEnhancer] 最终结果:', results);
            return results;
        }
        
        /**
         * 从页面提取分数信息
         */
        extractScoreFromPage() {
            try {
                // 查找结果显示区域
                const resultsEl = document.getElementById('results');
                if (!resultsEl || !resultsEl.innerHTML.trim()) {
                    console.log('[PracticeEnhancer] 结果区域为空或不存在');
                    return null;
                }
                
                const resultsText = resultsEl.textContent || resultsEl.innerText;
                console.log('[PracticeEnhancer] 结果文本:', resultsText);
                
                // 尝试提取分数 (格式: "Score: 8/13")
                const scoreMatch = resultsText.match(/Score:\s*(\d+)\/(\d+)/i);
                if (scoreMatch) {
                    const correct = parseInt(scoreMatch[1]);
                    const total = parseInt(scoreMatch[2]);
                    const accuracy = total > 0 ? correct / total : 0;
                    
                    console.log('[PracticeEnhancer] 成功提取分数:', { correct, total, accuracy });
                    
                    return {
                        correct: correct,
                        total: total,
                        accuracy: accuracy,
                        percentage: Math.round(accuracy * 100),
                        source: 'page_extraction'
                    };
                }
                
                // 尝试提取准确率 (格式: "Accuracy 85%")
                const accuracyMatch = resultsText.match(/(\d+)%/);
                if (accuracyMatch) {
                    const percentage = parseInt(accuracyMatch[1]);
                    console.log('[PracticeEnhancer] 成功提取百分比:', percentage);
                    return {
                        percentage: percentage,
                        accuracy: percentage / 100,
                        source: 'page_extraction'
                    };
                }
                
                console.log('[PracticeEnhancer] 无法从页面提取分数信息');
                
            } catch (error) {
                console.error('[PracticeEnhancer] 页面分数提取失败:', error);
            }
            
            return null;
        }
        
        /**
         * 计算分数（如果页面有答案数据）
         */
        calculateScore(currentAnswers) {
            if (!window.answerKey && !window.answers) {
                return null;
            }
            
            try {
                const correctAnswers = window.answerKey || window.answers;
                let correct = 0;
                let total = 0;
                const details = {};
                
                Object.keys(correctAnswers).forEach(questionId => {
                    const correctAnswer = correctAnswers[questionId];
                    const userAnswer = currentAnswers[questionId];
                    
                    total++;
                    
                    // 简单的答案比较
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
                console.error('[PracticeEnhancer] 分数计算失败:', error);
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
                questionId => this.answers[questionId] !== null && this.answers[questionId] !== ''
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
            if (window.answerKey) {
                return Object.keys(window.answerKey).length;
            }
            if (window.answers) {
                return Object.keys(window.answers).length;
            }
            
            // 尝试从页面元素获取
            const inputs = document.querySelectorAll('input[name^="q"]');
            const uniqueNames = new Set();
            inputs.forEach(input => {
                if (input.name) {
                    uniqueNames.add(input.name);
                }
            });
            
            return uniqueNames.size || inputs.length;
        }
        
        /**
         * 发送就绪信号
         */
        sendReadySignal() {
            let attempts = 0;
            const maxAttempts = 5;
            
            const sendSignal = () => {
                if (attempts >= maxAttempts) {
                    console.warn('[PracticeEnhancer] 就绪信号发送失败，达到最大尝试次数');
                    return;
                }
                
                this.sendMessage('SESSION_READY', {
                    pageType: this.detectPageType(),
                    url: window.location.href,
                    timestamp: Date.now(),
                    attempt: attempts + 1
                });
                
                attempts++;
                
                // 如果还没有收到初始化消息，继续尝试
                if (!this.sessionId) {
                    setTimeout(sendSignal, 1000);
                }
            };
            
            // 立即发送一次，然后定期重试
            sendSignal();
        }
        
        /**
         * 发送消息到父窗口（增强版）
         */
        sendMessage(type, data, options = {}) {
            // 增强的父窗口检测
            if (!this.isParentWindowAvailable()) {
                console.warn('[PracticeEnhancer] 父窗口不可用，尝试备用通信方式');
                this.handleCommunicationFallback(type, data);
                return false;
            }
            
            const message = {
                type: type,
                data: data,
                timestamp: Date.now(),
                source: 'practice_page',
                messageId: this.generateMessageId()
            };
            
            try {
                this.parentWindow.postMessage(message, '*');
                console.log('[PracticeEnhancer] 消息已发送:', type, data);
                
                // 记录发送的消息（用于重试）
                if (options.trackForRetry !== false) {
                    this.recordSentMessage(message);
                }
                
                return true;
            } catch (error) {
                console.error('[PracticeEnhancer] 消息发送失败:', error);
                this.handleCommunicationError(error, type, data);
                
                // 如果允许重试，将消息加入重试队列
                if (options.retry !== false) {
                    this.queueMessageForRetry(message, options);
                }
                
                return false;
            }
        }

        /**
         * 检查父窗口是否可用
         */
        isParentWindowAvailable() {
            try {
                // 检查父窗口是否存在
                if (!this.parentWindow) {
                    return false;
                }
                
                // 检查父窗口是否已关闭
                if (this.parentWindow.closed) {
                    console.warn('[PracticeEnhancer] 父窗口已关闭');
                    return false;
                }
                
                // 尝试访问父窗口的location（可能会因为跨域而失败）
                try {
                    // 这个检查可能会抛出异常，但不影响通信
                    const test = this.parentWindow.location;
                } catch (e) {
                    // 跨域情况下这是正常的，不影响postMessage通信
                    console.debug('[PracticeEnhancer] 跨域环境，但postMessage仍可用');
                }
                
                return true;
            } catch (error) {
                console.warn('[PracticeEnhancer] 父窗口检测失败:', error);
                return false;
            }
        }

        /**
         * 生成消息ID
         */
        generateMessageId() {
            return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        /**
         * 记录已发送的消息
         */
        recordSentMessage(message) {
            if (!this.sentMessages) {
                this.sentMessages = new Map();
            }
            
            this.sentMessages.set(message.messageId, {
                message: message,
                timestamp: Date.now()
            });

            // 清理旧消息记录（保留最近100条）
            if (this.sentMessages.size > 100) {
                const oldestKey = this.sentMessages.keys().next().value;
                this.sentMessages.delete(oldestKey);
            }
        }

        /**
         * 将消息加入重试队列
         */
        queueMessageForRetry(message, options) {
            if (!this.retryQueue) {
                this.retryQueue = [];
            }
            
            this.retryQueue.push({
                message: message,
                options: options,
                attempts: 0,
                maxAttempts: options.maxRetries || 3,
                nextRetry: Date.now() + (options.retryDelay || 2000)
            });

            // 启动重试处理器
            this.startRetryProcessor();
        }

        /**
         * 启动重试处理器
         */
        startRetryProcessor() {
            if (this.retryProcessor) return;
            
            this.retryProcessor = setInterval(() => {
                this.processRetryQueue();
            }, 1000);
        }

        /**
         * 处理重试队列
         */
        processRetryQueue() {
            if (!this.retryQueue || this.retryQueue.length === 0) {
                if (this.retryProcessor) {
                    clearInterval(this.retryProcessor);
                    this.retryProcessor = null;
                }
                return;
            }

            const now = Date.now();
            const itemsToRetry = [];
            
            this.retryQueue = this.retryQueue.filter(item => {
                if (now >= item.nextRetry) {
                    if (item.attempts < item.maxAttempts) {
                        itemsToRetry.push(item);
                        return false; // 从队列中移除，准备重试
                    } else {
                        console.warn('[PracticeEnhancer] 消息重试次数超限:', item.message.type);
                        return false; // 从队列中移除，放弃重试
                    }
                }
                return true; // 保留在队列中
            });

            // 执行重试
            itemsToRetry.forEach(item => {
                item.attempts++;
                console.log(`[PracticeEnhancer] 重试消息 (第${item.attempts}次):`, item.message.type);
                
                const success = this.sendMessage(
                    item.message.type, 
                    item.message.data, 
                    { ...item.options, retry: false, trackForRetry: false }
                );

                if (!success && item.attempts < item.maxAttempts) {
                    // 重试失败，重新加入队列
                    item.nextRetry = now + (item.options.retryDelay || 2000) * item.attempts;
                    this.retryQueue.push(item);
                }
            });
        }
        
        /**
         * 自动发送准备消息
         */
        sendAutoReadyMessage() {
            // 等待一下确保页面完全加载
            setTimeout(() => {
                if (window.opener) {
                    this.parentWindow = window.opener;
                    this.sendMessage('SESSION_READY', {
                        pageType: this.detectPageType(),
                        url: window.location.href,
                        timestamp: Date.now(),
                        autoInitialized: true
                    });
                    console.log('[PracticeEnhancer] 自动发送准备消息');
                } else {
                    console.warn('[PracticeEnhancer] 无法找到父窗口');
                }
            }, 1000);
        }

        /**
         * 获取增强器状态
         */
        getStatus() {
            return {
                isInitialized: this.isInitialized,
                sessionId: this.sessionId,
                pageType: this.detectPageType(),
                startTime: this.startTime,
                answersCount: Object.keys(this.answers).length,
                interactionsCount: this.interactions.length
            };
        }
    }
    
    // 创建全局实例
    window.practicePageEnhancer = new PracticePageEnhancer();
    
    // 添加全局调试函数
    window.debugPracticeEnhancer = () => {
        if (window.practicePageEnhancer) {
            console.log('=== 练习页面增强器调试信息 ===');
            console.log('状态:', window.practicePageEnhancer.getStatus());
            console.log('答案数据:', window.practicePageEnhancer.answers);
            console.log('交互记录:', window.practicePageEnhancer.interactions);
            console.log('========================');
        } else {
            console.log('练习页面增强器未初始化');
        }
    };
    
    // 页面加载完成后自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('[PracticeEnhancer] DOM加载完成，开始初始化');
            window.practicePageEnhancer.initialize();
        });
    } else {
        // 页面已经加载完成
        console.log('[PracticeEnhancer] 页面已加载，延迟初始化');
        setTimeout(() => {
            window.practicePageEnhancer.initialize();
        }, 100);
    }
    
    console.log('[PracticeEnhancer] 练习页面增强脚本已加载');
    console.log('[PracticeEnhancer] 使用 debugPracticeEnhancer() 查看调试信息');
    
})();