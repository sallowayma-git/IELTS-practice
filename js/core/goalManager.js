/**
 * 学习目标管理器
 * 负责学习目标的设置、跟踪和管理
 */
class GoalManager {
    constructor(options = {}) {
        this.goals = [];
        this.currentGoal = null;
        this.progressData = {};
        this.storage = options.storage || (typeof window !== 'undefined' ? window.storage : null);
        this.ready = Promise.resolve();

        this.loadGoals();
        this.initializeProgressTracking();
    }

    /**
     * 加载已保存的目标
     */
    loadGoals() {
        this.ready = this.loadGoalsAsync();
        this.ready.catch((error) => {
            console.error('[GoalManager] 加载目标失败:', error);
        });
    }

    async loadGoalsAsync() {
        const store = this.getStorage();
        if (!store || typeof store.get !== 'function') {
            console.warn('[GoalManager] storage 管理器不可用，使用默认目标数据');
            this.goals = [];
            this.progressData = {};
            this.currentGoal = null;
            return;
        }

        const [savedGoals, savedProgress] = await Promise.all([
            store.get('learning_goals', []),
            store.get('goal_progress', {})
        ]);

        this.goals = Array.isArray(savedGoals) ? savedGoals : [];
        this.progressData = (savedProgress && typeof savedProgress === 'object' && !Array.isArray(savedProgress))
            ? savedProgress
            : {};
        this.currentGoal = this.goals.find(goal => goal.isActive) || null;
    }

    /**
     * 保存目标到存储
     */
    async saveGoals() {
        const store = this.getStorage();
        if (!store || typeof store.set !== 'function') {
            console.warn('[GoalManager] 无法访问存储，跳过持久化');
            return;
        }
        await Promise.all([
            store.set('learning_goals', this.goals),
            store.set('goal_progress', this.progressData)
        ]);
    }

    getStorage() {
        if (this.storage) {
            return this.storage;
        }
        if (typeof window !== 'undefined' && window.storage) {
            this.storage = window.storage;
            return this.storage;
        }
        return null;
    }

    /**
     * 创建新的学习目标
     */
    async createGoal(goalData) {
        const goal = {
            id: this.generateGoalId(),
            type: goalData.type, // 'daily', 'weekly', 'monthly'
            targetType: goalData.targetType, // 'practices', 'time', 'accuracy'
            target: goalData.target,
            current: 0,
            startDate: goalData.startDate || new Date().toISOString().split('T')[0],
            endDate: goalData.endDate,
            isActive: true,
            notifications: {
                enabled: goalData.notifications?.enabled || false,
                reminderTime: goalData.notifications?.reminderTime || '19:00',
                encouragementMessages: goalData.notifications?.encouragementMessages || true
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // 停用其他活动目标
        this.goals.forEach(g => g.isActive = false);
        
        this.goals.push(goal);
        this.currentGoal = goal;
        
        // 初始化进度数据
        this.initializeGoalProgress(goal);
        
        await this.saveGoals();
        
        // 触发目标创建事件
        this.dispatchGoalEvent('goalCreated', { goal });
        
        return goal;
    }

    /**
     * 更新目标
     */
    async updateGoal(goalId, updates) {
        const goalIndex = this.goals.findIndex(g => g.id === goalId);
        if (goalIndex === -1) {
            throw new Error('Goal not found');
        }

        const goal = this.goals[goalIndex];
        Object.assign(goal, updates, {
            updatedAt: new Date().toISOString()
        });

        if (updates.isActive && goal.isActive) {
            // 停用其他目标
            this.goals.forEach((g, index) => {
                if (index !== goalIndex) g.isActive = false;
            });
            this.currentGoal = goal;
        }

        await this.saveGoals();

        // 触发目标更新事件
        this.dispatchGoalEvent('goalUpdated', { goal });

        return goal;
    }

    /**
     * 删除目标
     */
    async deleteGoal(goalId) {
        const goalIndex = this.goals.findIndex(g => g.id === goalId);
        if (goalIndex === -1) {
            throw new Error('Goal not found');
        }

        const goal = this.goals[goalIndex];
        this.goals.splice(goalIndex, 1);
        
        // 如果删除的是当前活动目标，清空当前目标
        if (this.currentGoal && this.currentGoal.id === goalId) {
            this.currentGoal = null;
        }
        
        // 删除相关进度数据
        delete this.progressData[goalId];
        
        await this.saveGoals();

        // 触发目标删除事件
        this.dispatchGoalEvent('goalDeleted', { goalId, goal });

        return true;
    }

    /**
     * 获取所有目标
     */
    getAllGoals() {
        return [...this.goals];
    }

    /**
     * 获取当前活动目标
     */
    getCurrentGoal() {
        return this.currentGoal;
    }

    /**
     * 获取目标进度
     */
    getGoalProgress(goalId) {
        const goal = this.goals.find(g => g.id === goalId);
        if (!goal) return null;

        const progressKey = this.getProgressKey(goal);
        const progress = this.progressData[goalId] || {};
        
        return {
            goal,
            current: progress[progressKey] || 0,
            target: goal.target,
            percentage: Math.min(100, Math.round(((progress[progressKey] || 0) / goal.target) * 100)),
            isCompleted: (progress[progressKey] || 0) >= goal.target,
            daysRemaining: this.calculateDaysRemaining(goal),
            streak: progress.streak || 0
        };
    }

    /**
     * 更新目标进度
     */
    async updateProgress(practiceData) {
        if (!this.currentGoal) return;

        const goal = this.currentGoal;
        const progressKey = this.getProgressKey(goal);
        const goalProgress = this.progressData[goal.id] || {};

        // 根据目标类型更新进度
        switch (goal.targetType) {
            case 'practices':
                goalProgress[progressKey] = (goalProgress[progressKey] || 0) + 1;
                break;
            case 'time':
                goalProgress[progressKey] = (goalProgress[progressKey] || 0) + (practiceData.duration || 0);
                break;
            case 'accuracy':
                // 对于正确率目标，计算平均值
                const sessions = goalProgress.sessions || [];
                sessions.push(practiceData.accuracy || 0);
                goalProgress.sessions = sessions;
                goalProgress[progressKey] = sessions.reduce((sum, acc) => sum + acc, 0) / sessions.length;
                break;
        }

        // 更新连续天数
        this.updateStreak(goal, goalProgress);

        this.progressData[goal.id] = goalProgress;
        await this.saveGoals();

        // 检查目标完成
        const progress = this.getGoalProgress(goal.id);
        if (progress.isCompleted && !goalProgress.completedNotified) {
            goalProgress.completedNotified = true;
            this.progressData[goal.id] = goalProgress;
            await this.saveGoals();

            // 触发目标完成事件
            this.dispatchGoalEvent('goalCompleted', { goal, progress });
        }

        // 触发进度更新事件
        this.dispatchGoalEvent('progressUpdated', { goal, progress });
    }

    /**
     * 初始化进度跟踪
     */
    initializeProgressTracking() {
        // 监听练习完成事件 - 自定义事件必须使用原生 addEventListener
        document.addEventListener('practiceSessionCompleted', (event) => {
            const detail = event.detail || {};
            const practiceRecord = detail.practiceRecord;
            this.updateProgress(practiceRecord)
                .catch(error => console.error('[GoalManager] 更新进度失败:', error));
        });
    }

    /**
     * 初始化目标进度数据
     */
    initializeGoalProgress(goal) {
        if (!this.progressData[goal.id]) {
            this.progressData[goal.id] = {
                streak: 0,
                lastPracticeDate: null,
                completedNotified: false
            };
        }
    }

    /**
     * 获取进度键名
     */
    getProgressKey(goal) {
        const today = new Date().toISOString().split('T')[0];
        
        switch (goal.type) {
            case 'daily':
                return today;
            case 'weekly':
                const weekStart = this.getWeekStart(new Date());
                return weekStart.toISOString().split('T')[0];
            case 'monthly':
                return today.substring(0, 7); // YYYY-MM
            default:
                return 'total';
        }
    }

    /**
     * 获取周开始日期
     */
    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 周一为一周开始
        return new Date(d.setDate(diff));
    }

    /**
     * 计算剩余天数
     */
    calculateDaysRemaining(goal) {
        if (!goal.endDate) return null;
        
        const today = new Date();
        const endDate = new Date(goal.endDate);
        const diffTime = endDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        return Math.max(0, diffDays);
    }

    /**
     * 更新连续天数
     */
    updateStreak(goal, progressData) {
        const today = new Date().toISOString().split('T')[0];
        const lastPracticeDate = progressData.lastPracticeDate;
        
        if (!lastPracticeDate) {
            // 第一次练习
            progressData.streak = 1;
        } else if (lastPracticeDate === today) {
            // 今天已经练习过，不更新连续天数
            return;
        } else {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            
            if (lastPracticeDate === yesterdayStr) {
                // 连续练习
                progressData.streak = (progressData.streak || 0) + 1;
            } else {
                // 中断了，重新开始
                progressData.streak = 1;
            }
        }
        
        progressData.lastPracticeDate = today;
    }

    /**
     * 生成目标ID
     */
    generateGoalId() {
        return `goal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 触发目标相关事件
     */
    dispatchGoalEvent(eventType, data) {
        document.dispatchEvent(new CustomEvent(eventType, {
            detail: data
        }));
    }

    /**
     * 获取目标类型选项
     */
    static getGoalTypeOptions() {
        return [
            { value: 'daily', label: '每日目标', description: '每天完成指定数量的练习' },
            { value: 'weekly', label: '每周目标', description: '每周完成指定数量的练习' },
            { value: 'monthly', label: '每月目标', description: '每月完成指定数量的练习' }
        ];
    }

    /**
     * 获取目标指标选项
     */
    static getTargetTypeOptions() {
        return [
            { value: 'practices', label: '练习次数', unit: '次', description: '完成指定数量的练习题目' },
            { value: 'time', label: '练习时间', unit: '分钟', description: '累计练习指定时间' },
            { value: 'accuracy', label: '平均正确率', unit: '%', description: '达到指定的平均正确率' }
        ];
    }
}

// 全局实例
window.GoalManager = GoalManager;