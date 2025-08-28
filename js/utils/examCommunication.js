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
        
        this.initialize();
    }

    /**
     * 初始化通信接口
     */
    initialize() {
        // 监听来自父窗口的消息
        window.addEventListener('message', (event) => {
            this.handleParentMessage(event);
        });
        
        // 页面加载完成后通知父窗口
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.notifyPageReady();
            });
        } else {
            this.notifyPageReady();
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
        const { type, data } = event.data || {};
        
        switch (type) {
            case 'init_exam_session':
                this.handleSessionInit(data, event.origin);
                break;
            case 'request_progress':
                this.sendProgress();
                break;
            case 'pause_session':
                this.handlePauseRequest();
                break;
            case 'resume_session':
                this.handleResumeRequest();
                break;
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
        
        // 发送会话开始通知
        this.sendMessage('session_started', {
            examId: this.examId,
            sessionId: this.sessionId,
            metadata: this.collectPageMetadata()
        });
        
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
    notifyPageReady() {
        // 向父窗口发送页面就绪信号
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: 'page_ready',
                data: {
                    url: window.location.href,
                    title: document.title,
                    timestamp: new Date().toISOString()
                }
            }, '*');
        }
    }

    /**
     * 发送消息到父窗口
     */
    sendMessage(type, data) {
        const message = {
            type,
            data: {
                ...data,
                sessionId: this.sessionId,
                examId: this.examId,
                timestamp: new Date().toISOString()
            }
        };
        
        if (!this.isInitialized) {
            // 如果未初始化，将消息加入队列
            this.messageQueue.push(message);
            return;
        }
        
        if (window.parent && window.parent !== window && this.parentOrigin) {
            window.parent.postMessage(message, this.parentOrigin);
        }
    }

    /**
     * 发送队列中的消息
     */
    flushMessageQueue() {
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            if (window.parent && window.parent !== window && this.parentOrigin) {
                window.parent.postMessage(message, this.parentOrigin);
            }
        }
    }

    /**
     * 通知练习开始
     */
    notifyPracticeStarted(examData = {}) {
        this.sendMessage('session_started', {
            examData,
            startTime: new Date().toISOString()
        });
    }

    /**
     * 发送进度更新
     */
    sendProgress(progressData = {}) {
        const defaultProgress = {
            currentQuestion: 0,
            totalQuestions: 0,
            answeredQuestions: 0,
            timeSpent: 0,
            ...progressData
        };
        
        this.sendMessage('session_progress', {
            progress: defaultProgress,
            answers: this.collectAnswers()
        });
    }

    /**
     * 通知练习完成
     */
    notifyPracticeCompleted(results = {}) {
        const completionData = {
            endTime: new Date().toISOString(),
            results: {
                score: 0,
                totalQuestions: 0,
                correctAnswers: 0,
                accuracy: 0,
                answers: [],
                questionTypePerformance: {},
                ...results
            }
        };
        
        this.sendMessage('session_completed', completionData);
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
    notifyError(error, context = '') {
        this.sendMessage('session_error', {
            error: {
                message: error.message || error,
                stack: error.stack,
                context,
                timestamp: new Date().toISOString()
            }
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
            this.sendProgress();
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
            score: 0,
            totalQuestions: 0,
            correctAnswers: 0,
            accuracy: 0,
            answers: this.collectAnswers()
        };
        
        // 查找分数显示元素
        const scoreElements = document.querySelectorAll('[class*="score"], [id*="score"], [class*="result"], [id*="result"]');
        
        scoreElements.forEach(element => {
            const text = element.textContent || element.innerText;
            
            // 尝试提取分数
            const scoreMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
            if (scoreMatch) {
                results.correctAnswers = parseInt(scoreMatch[1]);
                results.totalQuestions = parseInt(scoreMatch[2]);
                results.accuracy = results.totalQuestions > 0 ? results.correctAnswers / results.totalQuestions : 0;
            }
            
            // 尝试提取百分比
            const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
            if (percentMatch) {
                results.accuracy = parseFloat(percentMatch[1]) / 100;
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
                            if (results.totalQuestions > 0 || results.accuracy > 0) {
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