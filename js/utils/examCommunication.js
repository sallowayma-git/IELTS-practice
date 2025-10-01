/**
 * 考试页面通信接口
 * 提供考试页面与主系统之间的通信功能
 */
class ExamCommunication {
    constructor() {
        this.parentOrigin = null;
        this.sessionId = null;
        this.examId = null;
        this.isInitialized = false;
        this.messageQueue = [];
        this.retryAttempts = new Map(); // 按消息ID跟踪重试
        this.maxRetries = 3;
        
        this.initialize();
    }

    /**
     * 初始化通信接口
     */
    // 类型守卫
    isValidInitMsg(msg) {
        return msg.type === 'INIT_SESSION' && msg.data &&
               typeof msg.data.sessionId === 'string' &&
               typeof msg.data.examId === 'string' &&
               typeof msg.data.timestamp === 'number';
    }

    isValidSessionReadyData(data) {
        return typeof data.pageType === 'string' && typeof data.url === 'string' && typeof data.timestamp === 'number';
    }

    isValidProgressData(data) {
        return typeof data.answeredQuestions === 'number' &&
               typeof data.totalQuestions === 'number' &&
               typeof data.elapsedTime === 'number';
    }

    isValidPracticeCompleteData(data) {
        return typeof data.sessionId === 'string' &&
               data.answers && typeof data.answers === 'object' &&
               typeof data.duration === 'number' &&
               data.scoreInfo && typeof data.scoreInfo === 'object';
    }

    initialize() {
        // 只在练习窗口中添加消息监听器 (Task 35)
        if (typeof window.isPracticeWindow === 'function' && window.isPracticeWindow()) {
            window.addEventListener('message', (event) => {
                this.handleParentMessage(event);
            });
            console.log('[ExamCommunication] Message listener attached for practice window');
        } else {
            console.log('[ExamCommunication] Skipping message listener - not in practice window');
        }
        
        // 页面加载完成后通知父窗口
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.sendSessionReady();
            });
        } else {
            this.sendSessionReady();
        }
        
        // 页面卸载时通知父窗口
        window.addEventListener('beforeunload', () => {
            this.notifySessionEnded('page_unload');
        });
        
        console.log('ExamCommunication initialized');
    }

    /**
     * 处理来自父窗口的消息
     */
    handleParentMessage(event) {
        if (!event.data || typeof event.data !== 'object') return;

        const { type, data } = event.data;

        // 验证来源（file:// 下放宽）
        if (event.origin !== '*' && event.origin !== window.location.origin) {
            console.warn('Invalid message origin:', event.origin);
            return;
        }

        switch (type) {
            case 'INIT_SESSION':
                if (!this.isValidInitMsg(event.data)) {
                    console.warn('Invalid INIT_SESSION message');
                    return;
                }
                this.handleSessionInit(data, event.origin);
                break;
            case 'REQUEST_STATUS':
            case 'HEARTBEAT':
                if (!this.isValidRequestMsg(event.data)) {
                    console.warn('Invalid request message');
                    return;
                }
                if (type === 'REQUEST_STATUS') {
                    this.sendProgress();
                } else {
                    this.sendHeartbeatResponse(data.timestamp);
                }
                break;
            case 'pause_session':
                this.handlePauseRequest();
                break;
            case 'resume_session':
                this.handleResumeRequest();
                break;
            default:
                console.log('Unhandled message type:', type);
        }
    }

    /**
     * 处理会话初始化
     */
    handleSessionInit(data, origin) {
        this.parentOrigin = origin;
        this.sessionId = data.sessionId;
        this.examId = data.examId;
        this.isInitialized = true;
        
        console.log(`Exam session initialized: ${this.examId}`);
        
        // 发送队列中的消息
        this.flushMessageQueue();
        
        // 开始监控页面活动
        this.startActivityMonitoring();
    }

    /**
     * 收集页面元数据
     */
    collectPageMetadata() {
        return {
            title: document.title,
            url: window.location.href,
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            pageLoadTime: performance.now(),
            screenSize: {
                width: screen.width,
                height: screen.height
            },
            windowSize: {
                width: window.innerWidth,
                height: window.innerHeight
            }
        };
    }

    /**
     * 通知页面准备就绪
     */
    sendSessionReady() {
        if (window.parent && window.parent !== window) {
            const readyData = {
                pageType: 'practice',
                url: window.location.href,
                timestamp: Date.now()
            };

            if (!this.isValidSessionReadyData(readyData)) {
                console.error('Invalid SESSION_READY data');
                return;
            }

            this.sendMessageWithRetry('SESSION_READY', readyData);
        }
    }

    /**
     * 发送消息到父窗口
     */
    // 重试发送消息：指数退避
    async sendMessageWithRetry(type, data, attempt = 1) {
        const messageId = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        const baseData = {
            ...data,
            sessionId: this.sessionId,
            examId: this.examId,
            timestamp: Date.now(),
            messageId,
            source: 'practice_page'
        };

        // 类型特定验证
        let valid = true;
        switch (type) {
            case 'SESSION_READY':
                valid = this.isValidSessionReadyData(baseData);
                break;
            case 'PROGRESS_UPDATE':
                valid = this.isValidProgressData(baseData);
                break;
            case 'PRACTICE_COMPLETE':
                valid = this.isValidPracticeCompleteData(baseData);
                break;
        }
        if (!valid) {
            console.error(`Invalid ${type} data`);
            return;
        }

        const message = { type, data: baseData };

        const sendAttempt = () => {
            if (window.parent && window.parent !== window && this.parentOrigin) {
                window.parent.postMessage(message, this.parentOrigin);
                console.log(`[${type}] 发送尝试 ${attempt}/${this.maxRetries}`);
            }
        };

        sendAttempt();

        if (attempt < this.maxRetries) {
            const delay = 500 * Math.pow(2, attempt - 1); // 500ms, 1s, 2s
            setTimeout(() => {
                this.sendMessageWithRetry(type, data, attempt + 1);
            }, delay);
        } else if (attempt >= this.maxRetries) {
            console.error(`[${type}] 重试失败，报告错误`);
            // 子侧错误报告：发送 ERROR 或 console
            this.sendError(`Failed to send ${type} after ${this.maxRetries} attempts`);
        }
    }

    sendMessage(type, data) {
        if (!this.isInitialized) {
            this.messageQueue.push({ type, data });
            return;
        }

        this.sendMessageWithRetry(type, data);
    }

    /**
     * 发送队列中的消息
     */
    flushMessageQueue() {
        while (this.messageQueue.length > 0) {
            const { type, data } = this.messageQueue.shift();
            this.sendMessage(type, data);
        }
    }

    /**
     * 通知练习开始
     */
    // 发送进度更新
    sendProgressUpdate(progressData = {}) {
        const defaultProgress = {
            answeredQuestions: 0,
            totalQuestions: 0,
            elapsedTime: 0,
            ...progressData
        };

        if (!this.isValidProgressData(defaultProgress)) {
            console.error('Invalid progress data');
            return;
        }

        this.sendMessageWithRetry('PROGRESS_UPDATE', defaultProgress);
    }

    /**
     * 发送进度更新
     */
    // 发送心跳响应
    sendHeartbeatResponse(parentTimestamp) {
        this.sendMessageWithRetry('HEARTBEAT_RESPONSE', { timestamp: Date.now(), parentTimestamp });
    }

    /**
     * 通知练习完成
     */
    notifyPracticeCompleted(results = {}) {
        const scoreInfo = {
            correct: 0,
            total: 0,
            accuracy: 0,
            percentage: 0,
            ...results
        };

        const completionData = {
            sessionId: this.sessionId,
            answers: this.collectAnswers(),
            duration: Math.floor((Date.now() - this.startTime) / 1000),
            scoreInfo,
            timestamp: Date.now()
        };

        if (!this.isValidPracticeCompleteData(completionData)) {
            console.error('Invalid practice complete data');
            return;
        }

        this.sendMessageWithRetry('PRACTICE_COMPLETE', completionData);
    }

    /**
     * 通知会话暂停
     */
    notifySessionPaused(reason = 'user_action') {
        this.sendMessage('session_paused', {
            reason,
            pauseTime: new Date().toISOString()
        });
    }

    /**
     * 通知会话恢复
     */
    notifySessionResumed() {
        this.sendMessage('session_resumed', {
            resumeTime: new Date().toISOString()
        });
    }

    /**
     * 通知会话结束
     */
    notifySessionEnded(reason = 'completed') {
        this.sendMessage('session_ended', {
            reason,
            endTime: new Date().toISOString()
        });
    }

    /**
     * 通知错误
     */
    sendError(message, context = '') {
        const errorData = {
            message,
            context,
            timestamp: Date.now(),
            sessionId: this.sessionId
        };
        this.sendMessageWithRetry('ERROR_OCCURRED', errorData);
    }

    notifyError(error, context = '') {
        this.sendError(error.message || error, context);
    }

    // 心跳响应
    sendHeartbeatResponse(parentTimestamp) {
        this.sendMessageWithRetry('HEARTBEAT_RESPONSE', {
            timestamp: Date.now(),
            parentTimestamp
        });
    }

    /**
     * 收集答案数据
     */
    collectAnswers() {
        const answers = [];
        
        // 尝试从常见的表单元素收集答案
        const inputs = document.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked, select, input[type="text"], textarea');
        
        inputs.forEach((input, index) => {
            const questionId = input.name || input.id || `question_${index}`;
            const answer = input.value || input.textContent;
            
            if (answer && answer.trim()) {
                answers.push({
                    questionId,
                    answer: answer.trim(),
                    type: input.type || input.tagName.toLowerCase(),
                    timestamp: new Date().toISOString()
                });
            }
        });
        
        return answers;
    }

    /**
     * 开始活动监控
     */
    startActivityMonitoring() {
        this.startTime = Date.now(); // 记录开始时间
        let lastActivity = Date.now();
        
        // 监控用户活动
        const activityEvents = ['click', 'keydown', 'scroll', 'mousemove'];
        
        const updateActivity = () => {
            lastActivity = Date.now();
        };
        
        activityEvents.forEach(event => {
            document.addEventListener(event, updateActivity, { passive: true });
        });
        
        // 定期检查活动状态
        setInterval(() => {
            const inactiveTime = Date.now() - lastActivity;
            
            // 如果超过5分钟无活动，发送暂停通知
            if (inactiveTime > 5 * 60 * 1000) {
                this.notifySessionPaused('inactivity');
            }
        }, 60000); // 每分钟检查一次
        
        // 定期发送进度更新
        setInterval(() => {
            this.sendProgressUpdate({
                answeredQuestions: this.collectAnswers().length,
                totalQuestions: document.querySelectorAll('input[name]').length || 0,
                elapsedTime: Math.floor((Date.now() - this.startTime) / 1000)
            });
        }, 30000); // 每30秒发送一次进度
    }

    /**
     * 处理暂停请求
     */
    handlePauseRequest() {
        // 可以在这里实现暂停逻辑
        this.notifySessionPaused('parent_request');
    }

    /**
     * 处理恢复请求
     */
    handleResumeRequest() {
        // 可以在这里实现恢复逻辑
        this.notifySessionResumed();
    }

    /**
     * 自动检测并报告练习结果
     */
    autoDetectResults() {
        // 尝试自动检测页面中的结果信息
        const results = {
            correct: 0,
            total: 0,
            accuracy: 0,
            percentage: 0,
            answers: this.collectAnswers()
        };
        
        // 查找分数显示元素
        const scoreElements = document.querySelectorAll('[class*="score"], [id*="score"], [class*="result"], [id*="result"]');
        
        scoreElements.forEach(element => {
            const text = element.textContent || element.innerText;
            
            // 尝试提取分数
            const scoreMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
            if (scoreMatch) {
                results.correct = parseInt(scoreMatch[1]);
                results.total = parseInt(scoreMatch[2]);
                results.accuracy = results.total > 0 ? results.correct / results.total : 0;
                results.percentage = Math.round(results.accuracy * 100);
            }
            
            // 尝试提取百分比
            const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
            if (percentMatch) {
                results.accuracy = parseFloat(percentMatch[1]) / 100;
                results.percentage = parseFloat(percentMatch[1]);
            }
        });
        
        return results;
    }

    /**
     * 创建结果监听器
     */
    createResultsListener() {
        // 监听可能的结果页面变化
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    // 检查是否出现了结果相关的元素
                    const addedNodes = Array.from(mutation.addedNodes);
                    const hasResultElements = addedNodes.some(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            const text = node.textContent || node.innerText || '';
                            return /score|result|complete|finish/i.test(text) ||
                                   /\d+\s*\/\s*\d+/.test(text) ||
                                   /\d+\s*%/.test(text);
                        }
                        return false;
                    });
                    
                    if (hasResultElements) {
                        // 延迟检测结果，确保页面完全加载
                        setTimeout(() => {
                            const results = this.autoDetectResults();
                            if (results.total > 0 || results.accuracy > 0) {
                                this.notifyPracticeCompleted(results);
                            }
                        }, 1000);
                    }
                }
            });
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        return observer;
    }

    /**
     * 销毁通信接口
     */
    destroy() {
        this.notifySessionEnded('destroyed');
        console.log('ExamCommunication destroyed');
    }
}

// 自动初始化（如果在考试页面中）
if (window.parent && window.parent !== window) {
    window.examCommunication = new ExamCommunication();
    
    // 创建结果监听器
    window.examCommunication.createResultsListener();
}

// 确保全局可用
window.ExamCommunication = ExamCommunication;