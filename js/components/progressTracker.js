/**
 * 进度跟踪和提醒系统
 * 负责实时显示学习进度、发送提醒和庆祝动画
 */
class ProgressTracker {
    constructor() {
        this.goalManager = null;
        this.notificationPermission = null;
        this.reminderInterval = null;
        this.celebrationQueue = [];

        // 全局引用，供事件委托使用
        window.progressTracker = this;

        this.init();
    }

    /**
     * 初始化进度跟踪器
     */
    init() {
        this.goalManager = new GoalManager();
        this.checkNotificationPermission();
        this.setupEventListeners();
        this.startReminderSystem();
        this.createProgressIndicator();
    }

    /**
     * 检查通知权限
     */
    async checkNotificationPermission() {
        if ('Notification' in window) {
            this.notificationPermission = Notification.permission;
            
            if (this.notificationPermission === 'default') {
                // 请求通知权限
                this.notificationPermission = await Notification.requestPermission();
            }
        }
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 使用事件委托替换独立监听器
        if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
            // 进度指示器点击事件
            window.DOM.delegate('click', '#progress-indicator', function(e) {
                window.progressTracker.showProgressDetails();
            });

            // 模态框背景点击关闭
            window.DOM.delegate('click', '.modal-overlay.show', function(e) {
                if (e.target === this) {
                    this.remove();
                }
            });

            // ESC键关闭模态框
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    const modal = document.querySelector('.modal-overlay.show');
                    if (modal) {
                        modal.remove();
                    }
                }
            });

            // 自定义事件监听（这些事件不能用DOM.delegate处理）
            document.addEventListener('goalCompleted', (event) => {
                window.progressTracker.handleGoalCompleted(event.detail);
            });

            document.addEventListener('progressUpdated', (event) => {
                window.progressTracker.handleProgressUpdated(event.detail);
            });

            document.addEventListener('practiceSessionCompleted', (event) => {
                window.progressTracker.handlePracticeCompleted(event.detail);
            });

            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) {
                    window.progressTracker.updateProgressDisplay();
                }
            });

            console.log('[ProgressTracker] 使用事件委托设置监听器');
        } else {
            // 降级到传统监听器
            document.addEventListener('goalCompleted', (event) => {
                this.handleGoalCompleted(event.detail);
            });

            document.addEventListener('progressUpdated', (event) => {
                this.handleProgressUpdated(event.detail);
            });

            document.addEventListener('practiceSessionCompleted', (event) => {
                this.handlePracticeCompleted(event.detail);
            });

            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) {
                    this.updateProgressDisplay();
                }
            });
        }
    }

    /**
     * 创建进度指示器
     */
    createProgressIndicator() {
        // 检查是否已存在
        if (document.getElementById('progress-indicator')) {
            return;
        }

        const indicator = document.createElement('div');
        indicator.id = 'progress-indicator';
        indicator.className = 'progress-indicator';
        indicator.innerHTML = `
            <div class="progress-indicator-content">
                <div class="progress-icon">🎯</div>
                <div class="progress-info">
                    <div class="progress-title">今日目标</div>
                    <div class="progress-status" id="progress-status">暂无目标</div>
                </div>
                <div class="progress-circle" id="progress-circle">
                    <svg width="40" height="40" viewBox="0 0 40 40">
                        <circle cx="20" cy="20" r="18" fill="none" stroke="var(--bg-tertiary)" stroke-width="2"/>
                        <circle cx="20" cy="20" r="18" fill="none" stroke="var(--primary-color)" stroke-width="2" 
                                stroke-dasharray="113" stroke-dashoffset="113" class="progress-stroke"/>
                    </svg>
                    <span class="progress-percentage" id="progress-percentage">0%</span>
                </div>
            </div>
        `;

        // 添加到页面
        document.body.appendChild(indicator);

        // 点击事件已通过事件委托处理

        // 初始更新
        this.updateProgressDisplay();
    }

    /**
     * 更新进度显示
     */
    updateProgressDisplay() {
        const currentGoal = this.goalManager.getCurrentGoal();
        const statusElement = document.getElementById('progress-status');
        const circleElement = document.getElementById('progress-circle');
        const percentageElement = document.getElementById('progress-percentage');
        
        if (!currentGoal) {
            statusElement.textContent = '暂无目标';
            percentageElement.textContent = '0%';
            this.updateProgressCircle(0);
            return;
        }

        const progress = this.goalManager.getGoalProgress(currentGoal.id);
        const targetTypeOption = GoalManager.getTargetTypeOptions().find(opt => opt.value === currentGoal.targetType);
        
        statusElement.textContent = `${progress.current}/${progress.target} ${targetTypeOption?.unit || ''}`;
        percentageElement.textContent = `${progress.percentage}%`;
        
        this.updateProgressCircle(progress.percentage);
        
        // 更新指示器状态
        const indicator = document.getElementById('progress-indicator');
        if (progress.isCompleted) {
            indicator.classList.add('completed');
        } else {
            indicator.classList.remove('completed');
        }
    }

    /**
     * 更新进度圆环
     */
    updateProgressCircle(percentage) {
        const circle = document.querySelector('.progress-stroke');
        if (!circle) return;

        const circumference = 113; // 2 * π * 18
        const offset = circumference - (percentage / 100) * circumference;

        // 使用DOMStyles工具
        if (typeof window.DOMStyles !== 'undefined' && window.DOMStyles.setStyle) {
            window.DOMStyles.setStyle(circle, {
                strokeDashoffset: offset,
                transition: 'stroke-dashoffset 0.5s ease'
            });
        } else {
            // 降级到直接操作
            circle.style.strokeDashoffset = offset;
            circle.style.transition = 'stroke-dashoffset 0.5s ease';
        }
    }

    /**
     * 显示进度详情
     */
    showProgressDetails() {
        const currentGoal = this.goalManager.getCurrentGoal();
        
        if (!currentGoal) {
            window.showMessage('暂无活动目标，点击创建一个目标开始学习计划', 'info');
            // 导航到目标页面
            if (window.app) {
                window.app.navigateToView('goals');
            }
            return;
        }

        const progress = this.goalManager.getGoalProgress(currentGoal.id);
        const targetTypeOption = GoalManager.getTargetTypeOptions().find(opt => opt.value === currentGoal.targetType);
        
        const detailsContent = `
            <div class="progress-details-modal">
                <div class="progress-details-header">
                    <h3>学习进度详情</h3>
                    <div class="progress-badge ${progress.isCompleted ? 'completed' : 'active'}">
                        ${progress.isCompleted ? '已完成' : '进行中'}
                    </div>
                </div>
                <div class="progress-details-body">
                    <div class="progress-summary">
                        <div class="progress-chart">
                            <div class="chart-circle">
                                <svg width="120" height="120" viewBox="0 0 120 120">
                                    <circle cx="60" cy="60" r="54" fill="none" stroke="var(--bg-tertiary)" stroke-width="6"/>
                                    <circle cx="60" cy="60" r="54" fill="none" stroke="var(--primary-color)" stroke-width="6" 
                                            stroke-dasharray="339" stroke-dashoffset="${339 - (progress.percentage / 100) * 339}" 
                                            class="progress-stroke-large"/>
                                </svg>
                                <div class="chart-center">
                                    <div class="chart-percentage">${progress.percentage}%</div>
                                    <div class="chart-label">完成度</div>
                                </div>
                            </div>
                        </div>
                        <div class="progress-stats">
                            <div class="stat-item">
                                <span class="stat-label">当前进度</span>
                                <span class="stat-value">${progress.current} ${targetTypeOption?.unit || ''}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">目标数值</span>
                                <span class="stat-value">${progress.target} ${targetTypeOption?.unit || ''}</span>
                            </div>
                            <div class="stat-item">
                                <span class="stat-label">连续天数</span>
                                <span class="stat-value">${progress.streak} 天</span>
                            </div>
                            ${progress.daysRemaining !== null ? `
                                <div class="stat-item">
                                    <span class="stat-label">剩余天数</span>
                                    <span class="stat-value">${progress.daysRemaining} 天</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <div class="progress-actions">
                        <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove(); window.app?.navigateToView('goals')">
                            管理目标
                        </button>
                        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove(); window.app?.navigateToView('overview')">
                            开始练习
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        this.showModal(detailsContent);
    }

    /**
     * 处理目标完成事件
     */
    handleGoalCompleted(data) {
        const { goal, progress } = data;
        
        // 显示庆祝动画
        this.showCelebrationAnimation(goal, progress);
        
        // 发送完成通知
        this.sendGoalCompletionNotification(goal, progress);
        
        // 更新进度显示
        this.updateProgressDisplay();
    }

    /**
     * 处理进度更新事件
     */
    handleProgressUpdated(data) {
        const { goal, progress } = data;
        
        // 更新进度显示
        this.updateProgressDisplay();
        
        // 检查里程碑
        this.checkMilestones(goal, progress);
    }

    /**
     * 处理练习完成事件
     */
    handlePracticeCompleted(data) {
        const { practiceRecord } = data;
        
        // 显示练习完成提示
        this.showPracticeCompletionFeedback(practiceRecord);
    }

    /**
     * 显示庆祝动画
     */
    showCelebrationAnimation(goal, progress) {
        // 创建庆祝动画容器
        const celebration = document.createElement('div');
        celebration.className = 'celebration-animation';
        celebration.innerHTML = `
            <div class="celebration-content">
                <div class="celebration-icon">🎉</div>
                <h3>目标完成！</h3>
                <p>恭喜您完成了${this.getGoalTypeLabel(goal.type)}目标</p>
                <div class="celebration-stats">
                    <div class="celebration-stat">
                        <span class="stat-number">${progress.target}</span>
                        <span class="stat-label">${this.getTargetTypeLabel(goal.targetType)}</span>
                    </div>
                    <div class="celebration-stat">
                        <span class="stat-number">${progress.streak}</span>
                        <span class="stat-label">连续天数</span>
                    </div>
                </div>
                <button class="btn btn-primary celebration-btn" onclick="this.parentElement.parentElement.remove()">
                    太棒了！
                </button>
            </div>
            <div class="confetti-container">
                ${this.generateConfetti()}
            </div>
        `;
        
        document.body.appendChild(celebration);
        
        // 自动移除
        setTimeout(() => {
            if (celebration.parentElement) {
                celebration.remove();
            }
        }, 8000);
        
        // 播放庆祝音效（如果支持）
        this.playCelebrationSound();
    }

    /**
     * 生成彩带动画
     */
    generateConfetti() {
        const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#ff9ff3'];
        let confetti = '';
        
        for (let i = 0; i < 50; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            const delay = Math.random() * 3;
            const duration = 3 + Math.random() * 2;
            const left = Math.random() * 100;
            
            confetti += `
                <div class="confetti-piece" style="
                    background: ${color};
                    left: ${left}%;
                    animation-delay: ${delay}s;
                    animation-duration: ${duration}s;
                "></div>
            `;
        }
        
        return confetti;
    }

    /**
     * 播放庆祝音效
     */
    playCelebrationSound() {
        try {
            // 使用Web Audio API创建简单的庆祝音效
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
            oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1); // E5
            oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2); // G5
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (error) {
            // 音效播放失败，忽略错误
            console.log('Celebration sound not available');
        }
    }

    /**
     * 发送目标完成通知
     */
    sendGoalCompletionNotification(goal, progress) {
        if (this.notificationPermission !== 'granted') return;
        
        const notification = new Notification('🎉 目标完成！', {
            body: `恭喜您完成了${this.getGoalTypeLabel(goal.type)}目标！连续学习 ${progress.streak} 天`,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: 'goal-completion',
            requireInteraction: true
        });
        
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
        
        // 自动关闭
        setTimeout(() => {
            notification.close();
        }, 10000);
    }

    /**
     * 检查里程碑
     */
    checkMilestones(goal, progress) {
        const milestones = [25, 50, 75, 90];
        
        milestones.forEach(milestone => {
            if (progress.percentage >= milestone && progress.percentage < milestone + 5) {
                this.showMilestoneNotification(milestone, goal);
            }
        });
    }

    /**
     * 显示里程碑通知
     */
    showMilestoneNotification(milestone, goal) {
        const message = `🎯 已完成 ${milestone}% 的${this.getGoalTypeLabel(goal.type)}目标！继续加油！`;
        window.showMessage(message, 'success');
        
        // 发送浏览器通知
        if (this.notificationPermission === 'granted') {
            new Notification('学习进度更新', {
                body: message,
                icon: '/favicon.ico',
                tag: 'milestone-' + milestone
            });
        }
    }

    /**
     * 显示练习完成反馈
     */
    showPracticeCompletionFeedback(practiceRecord) {
        const currentGoal = this.goalManager.getCurrentGoal();
        if (!currentGoal) return;
        
        const progress = this.goalManager.getGoalProgress(currentGoal.id);
        const accuracy = Math.round((practiceRecord.accuracy || 0) * 100);
        
        // 创建浮动反馈
        const feedback = document.createElement('div');
        feedback.className = 'practice-feedback';
        feedback.innerHTML = `
            <div class="feedback-content">
                <div class="feedback-icon">${accuracy >= 80 ? '🌟' : accuracy >= 60 ? '👍' : '💪'}</div>
                <div class="feedback-text">
                    <div class="feedback-title">练习完成！</div>
                    <div class="feedback-stats">
                        正确率 ${accuracy}% | 目标进度 ${progress.percentage}%
                    </div>
                </div>
            </div>
        `;
        
        // 添加到进度指示器附近
        const indicator = document.getElementById('progress-indicator');
        if (indicator) {
            indicator.appendChild(feedback);
            
            // 动画显示
            setTimeout(() => feedback.classList.add('show'), 100);
            
            // 自动移除
            setTimeout(() => {
                feedback.classList.remove('show');
                setTimeout(() => feedback.remove(), 300);
            }, 3000);
        }
    }

    /**
     * 启动提醒系统
     */
    startReminderSystem() {
        // 每小时检查一次是否需要发送提醒
        this.reminderInterval = setInterval(() => {
            this.checkReminders().catch(error => console.error('[ProgressTracker] 检查提醒失败', error));
        }, 60 * 60 * 1000); // 1小时

        // 立即检查一次
        this.checkReminders().catch(error => console.error('[ProgressTracker] 检查提醒失败', error));
    }

    /**
     * 检查提醒
     */
    async checkReminders() {
        const currentGoal = this.goalManager.getCurrentGoal();
        if (!currentGoal || !currentGoal.notifications.enabled) return;
        
        const now = new Date();
        const reminderTime = currentGoal.notifications.reminderTime;
        const [hours, minutes] = reminderTime.split(':').map(Number);
        
        // 检查是否到了提醒时间
        if (now.getHours() === hours && now.getMinutes() >= minutes && now.getMinutes() < minutes + 5) {
            this.sendDailyReminder(currentGoal);
        }
        
        // 检查是否长时间未练习
        await this.checkInactivityReminder(currentGoal);
    }

    /**
     * 发送每日提醒
     */
    sendDailyReminder(goal) {
        const progress = this.goalManager.getGoalProgress(goal.id);
        
        if (progress.isCompleted) {
            // 目标已完成，发送鼓励消息
            if (goal.notifications.encouragementMessages) {
                this.sendEncouragementNotification(goal, progress);
            }
        } else {
            // 目标未完成，发送提醒
            this.sendPracticeReminder(goal, progress);
        }
    }

    /**
     * 发送练习提醒
     */
    sendPracticeReminder(goal, progress) {
        if (this.notificationPermission !== 'granted') return;
        
        const remaining = goal.target - progress.current;
        const targetTypeOption = GoalManager.getTargetTypeOptions().find(opt => opt.value === goal.targetType);
        
        const notification = new Notification('📚 学习提醒', {
            body: `还需要 ${remaining} ${targetTypeOption?.unit || ''} 就能完成今天的目标了！`,
            icon: '/favicon.ico',
            tag: 'daily-reminder',
            requireInteraction: false
        });
        
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }

    /**
     * 发送鼓励通知
     */
    sendEncouragementNotification(goal, progress) {
        if (this.notificationPermission !== 'granted') return;
        
        const encouragements = [
            '🌟 今天的目标已完成！保持这个节奏！',
            '🎯 太棒了！您已经连续学习 ' + progress.streak + ' 天了！',
            '💪 坚持就是胜利！继续保持学习热情！',
            '🚀 您的学习进度很棒！明天继续加油！'
        ];
        
        const message = encouragements[Math.floor(Math.random() * encouragements.length)];
        
        const notification = new Notification('学习鼓励', {
            body: message,
            icon: '/favicon.ico',
            tag: 'encouragement'
        });
        
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }

    /**
     * 检查不活跃提醒
     */
    async checkInactivityReminder(goal) {
        const goalProgress = await storage.get('goal_progress', {});
        const lastPracticeDate = goalProgress?.[goal.id]?.lastPracticeDate;

        if (!lastPracticeDate) return;

        const today = new Date().toISOString().split('T')[0];
        const daysSinceLastPractice = this.calculateDaysDifference(lastPracticeDate, today);
        
        // 如果超过2天未练习，发送提醒
        if (daysSinceLastPractice >= 2) {
            this.sendInactivityReminder(daysSinceLastPractice);
        }
    }

    /**
     * 发送不活跃提醒
     */
    sendInactivityReminder(days) {
        if (this.notificationPermission !== 'granted') return;
        
        const notification = new Notification('🔔 学习提醒', {
            body: `您已经 ${days} 天没有练习了，回来继续您的学习计划吧！`,
            icon: '/favicon.ico',
            tag: 'inactivity-reminder'
        });
        
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }

    /**
     * 计算日期差异
     */
    calculateDaysDifference(date1, date2) {
        const d1 = new Date(date1);
        const d2 = new Date(date2);
        const diffTime = Math.abs(d2 - d1);
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    /**
     * 获取目标类型标签
     */
    getGoalTypeLabel(type) {
        const typeOptions = GoalManager.getGoalTypeOptions();
        const option = typeOptions.find(opt => opt.value === type);
        return option ? option.label : type;
    }

    /**
     * 获取目标指标标签
     */
    getTargetTypeLabel(targetType) {
        const typeOptions = GoalManager.getTargetTypeOptions();
        const option = typeOptions.find(opt => opt.value === targetType);
        return option ? option.label : targetType;
    }

    /**
     * 显示模态框
     */
    showModal(content) {
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay show';
        modalOverlay.innerHTML = `<div class="modal">${content}</div>`;

        document.body.appendChild(modalOverlay);

        // 模态框事件已通过事件委托处理
    }

    /**
     * 销毁进度跟踪器
     */
    destroy() {
        if (this.reminderInterval) {
            clearInterval(this.reminderInterval);
        }
        
        const indicator = document.getElementById('progress-indicator');
        if (indicator) {
            indicator.remove();
        }
    }
}

// 全局实例
window.ProgressTracker = ProgressTracker;