/**
 * 学习目标设置组件
 * 提供目标创建、编辑和删除的用户界面
 */
class GoalSettings {
    constructor(container) {
        this.container = container || document.getElementById('goals-view');
        this.goalManager = null;
        this.currentEditingGoal = null;

        // 全局引用，供事件委托使用
        window.goalSettings = this;

        this.init();
    }

    /**
     * 初始化组件
     */
    init() {
        this.goalManager = new GoalManager();
        this.render();
        this.setupEventListeners();
    }

    /**
     * 渲染组件
     */
    render() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="goals-container">
                <div class="goals-header">
                    <h2>学习目标管理</h2>
                    <button class="btn btn-primary" id="create-goal-btn">
                        <span class="icon">+</span>
                        创建新目标
                    </button>
                </div>

                <div class="current-goal-section">
                    <h3>当前目标</h3>
                    <div id="current-goal-display">
                        <!-- 当前目标显示区域 -->
                    </div>
                </div>

                <div class="goals-history-section">
                    <h3>历史目标</h3>
                    <div id="goals-history-list">
                        <!-- 历史目标列表 -->
                    </div>
                </div>

                <!-- 目标创建/编辑模态框 -->
                <div id="goal-modal" class="modal-overlay">
                    <div class="modal goal-modal">
                        <div class="modal-header">
                            <h3 id="modal-title">创建学习目标</h3>
                            <button class="modal-close" id="close-modal">&times;</button>
                        </div>
                        <div class="modal-body">
                            <form id="goal-form">
                                <div class="form-group">
                                    <label for="goal-type">目标周期</label>
                                    <select id="goal-type" required>
                                        <option value="">请选择目标周期</option>
                                    </select>
                                    <small class="form-help" id="goal-type-help"></small>
                                </div>

                                <div class="form-group">
                                    <label for="target-type">目标类型</label>
                                    <select id="target-type" required>
                                        <option value="">请选择目标类型</option>
                                    </select>
                                    <small class="form-help" id="target-type-help"></small>
                                </div>

                                <div class="form-group">
                                    <label for="target-value">目标数值</label>
                                    <div class="input-with-unit">
                                        <input type="number" id="target-value" min="1" required>
                                        <span class="input-unit" id="target-unit"></span>
                                    </div>
                                    <small class="form-help">设置您希望达到的目标数值</small>
                                </div>

                                <div class="form-group" id="date-range-group">
                                    <label for="start-date">开始日期</label>
                                    <input type="date" id="start-date" required>
                                    
                                    <label for="end-date">结束日期（可选）</label>
                                    <input type="date" id="end-date">
                                    <small class="form-help">不设置结束日期表示长期目标</small>
                                </div>

                                <div class="form-group">
                                    <label class="checkbox-label">
                                        <input type="checkbox" id="enable-notifications">
                                        <span class="checkmark"></span>
                                        启用提醒通知
                                    </label>
                                </div>

                                <div class="form-group notification-settings" id="notification-settings" style="display: none;">
                                    <label for="reminder-time">提醒时间</label>
                                    <input type="time" id="reminder-time" value="19:00">
                                    
                                    <label class="checkbox-label">
                                        <input type="checkbox" id="encouragement-messages" checked>
                                        <span class="checkmark"></span>
                                        启用鼓励消息
                                    </label>
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" id="cancel-goal">取消</button>
                            <button type="submit" form="goal-form" class="btn btn-primary" id="save-goal">保存目标</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.populateFormOptions();
        this.renderCurrentGoal();
        this.renderGoalsHistory();
    }

    /**
     * 填充表单选项
     */
    populateFormOptions() {
        // 填充目标周期选项
        const goalTypeSelect = document.getElementById('goal-type');
        const goalTypeOptions = GoalManager.getGoalTypeOptions();
        
        goalTypeOptions.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option.value;
            optionElement.textContent = option.label;
            optionElement.dataset.description = option.description;
            goalTypeSelect.appendChild(optionElement);
        });

        // 填充目标类型选项
        const targetTypeSelect = document.getElementById('target-type');
        const targetTypeOptions = GoalManager.getTargetTypeOptions();
        
        targetTypeOptions.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option.value;
            optionElement.textContent = option.label;
            optionElement.dataset.unit = option.unit;
            optionElement.dataset.description = option.description;
            targetTypeSelect.appendChild(optionElement);
        });

        // 设置默认开始日期为今天
        const startDateInput = document.getElementById('start-date');
        startDateInput.value = new Date().toISOString().split('T')[0];
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 使用事件委托替换独立监听器
        if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
            // 创建目标按钮
            window.DOM.delegate('click', '#create-goal-btn', function(e) {
                window.goalSettings.showGoalModal();
            });

            // 模态框关闭按钮
            window.DOM.delegate('click', '#close-modal', function(e) {
                window.goalSettings.hideGoalModal();
            });

            window.DOM.delegate('click', '#cancel-goal', function(e) {
                window.goalSettings.hideGoalModal();
            });

            // 点击模态框背景关闭
            window.DOM.delegate('click', '#goal-modal', function(e) {
                if (e.target.id === 'goal-modal') {
                    window.goalSettings.hideGoalModal();
                }
            });

            // 表单选项变化
            window.DOM.delegate('change', '#goal-type', function(e) {
                window.goalSettings.updateGoalTypeHelp(this.value);
            });

            window.DOM.delegate('change', '#target-type', function(e) {
                window.goalSettings.updateTargetTypeHelp(this.value);
                window.goalSettings.updateTargetUnit(this.value);
            });

            // 通知设置切换
            window.DOM.delegate('change', '#enable-notifications', function(e) {
                window.goalSettings.toggleNotificationSettings(this.checked);
            });

            // 表单提交
            window.DOM.delegate('submit', '#goal-form', function(e) {
                e.preventDefault();
                window.goalSettings.handleFormSubmit();
            });

            console.log('[GoalSettings] 使用事件委托设置监听器');
        } else {
            // 降级到传统监听器
            document.getElementById('create-goal-btn')?.addEventListener('click', () => {
                this.showGoalModal();
            });

            document.getElementById('close-modal')?.addEventListener('click', () => {
                this.hideGoalModal();
            });

            document.getElementById('cancel-goal')?.addEventListener('click', () => {
                this.hideGoalModal();
            });

            document.getElementById('goal-modal')?.addEventListener('click', (e) => {
                if (e.target.id === 'goal-modal') {
                    this.hideGoalModal();
                }
            });

            document.getElementById('goal-type')?.addEventListener('change', (e) => {
                this.updateGoalTypeHelp(e.target.value);
            });

            document.getElementById('target-type')?.addEventListener('change', (e) => {
                this.updateTargetTypeHelp(e.target.value);
                this.updateTargetUnit(e.target.value);
            });

            document.getElementById('enable-notifications')?.addEventListener('change', (e) => {
                this.toggleNotificationSettings(e.target.checked);
            });

            document.getElementById('goal-form')?.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleFormSubmit();
            });
        }

        // 自定义事件监听（这些事件不能用DOM.delegate处理）
        document.addEventListener('goalCreated', (e) => {
            window.goalSettings.onGoalCreated(e.detail);
        });

        document.addEventListener('goalUpdated', (e) => {
            window.goalSettings.onGoalUpdated(e.detail);
        });

        document.addEventListener('goalDeleted', (e) => {
            window.goalSettings.onGoalDeleted(e.detail);
        });
    }

    /**
     * 显示目标模态框
     */
    showGoalModal(goal = null) {
        this.currentEditingGoal = goal;
        const modal = document.getElementById('goal-modal');
        const modalTitle = document.getElementById('modal-title');
        
        if (goal) {
            modalTitle.textContent = '编辑学习目标';
            this.populateFormWithGoal(goal);
        } else {
            modalTitle.textContent = '创建学习目标';
            this.resetForm();
        }
        
        modal.classList.add('show');
    }

    /**
     * 隐藏目标模态框
     */
    hideGoalModal() {
        const modal = document.getElementById('goal-modal');
        modal.classList.remove('show');
        this.currentEditingGoal = null;
        this.resetForm();
    }

    /**
     * 重置表单
     */
    resetForm() {
        const form = document.getElementById('goal-form');
        form.reset();
        
        // 重置默认值
        document.getElementById('start-date').value = new Date().toISOString().split('T')[0];
        document.getElementById('reminder-time').value = '19:00';
        document.getElementById('encouragement-messages').checked = true;
        
        // 隐藏通知设置
        this.toggleNotificationSettings(false);
        
        // 清空帮助文本
        document.getElementById('goal-type-help').textContent = '';
        document.getElementById('target-type-help').textContent = '';
        document.getElementById('target-unit').textContent = '';
    }

    /**
     * 用目标数据填充表单
     */
    populateFormWithGoal(goal) {
        document.getElementById('goal-type').value = goal.type;
        document.getElementById('target-type').value = goal.targetType;
        document.getElementById('target-value').value = goal.target;
        document.getElementById('start-date').value = goal.startDate;
        document.getElementById('end-date').value = goal.endDate || '';
        document.getElementById('enable-notifications').checked = goal.notifications.enabled;
        document.getElementById('reminder-time').value = goal.notifications.reminderTime;
        document.getElementById('encouragement-messages').checked = goal.notifications.encouragementMessages;
        
        // 更新帮助文本和单位
        this.updateGoalTypeHelp(goal.type);
        this.updateTargetTypeHelp(goal.targetType);
        this.updateTargetUnit(goal.targetType);
        this.toggleNotificationSettings(goal.notifications.enabled);
    }

    /**
     * 更新目标周期帮助文本
     */
    updateGoalTypeHelp(goalType) {
        const helpElement = document.getElementById('goal-type-help');
        const option = document.querySelector(`#goal-type option[value="${goalType}"]`);
        
        if (option && option.dataset.description) {
            helpElement.textContent = option.dataset.description;
        } else {
            helpElement.textContent = '';
        }
    }

    /**
     * 更新目标类型帮助文本
     */
    updateTargetTypeHelp(targetType) {
        const helpElement = document.getElementById('target-type-help');
        const option = document.querySelector(`#target-type option[value="${targetType}"]`);
        
        if (option && option.dataset.description) {
            helpElement.textContent = option.dataset.description;
        } else {
            helpElement.textContent = '';
        }
    }

    /**
     * 更新目标单位
     */
    updateTargetUnit(targetType) {
        const unitElement = document.getElementById('target-unit');
        const option = document.querySelector(`#target-type option[value="${targetType}"]`);
        
        if (option && option.dataset.unit) {
            unitElement.textContent = option.dataset.unit;
        } else {
            unitElement.textContent = '';
        }
    }

    /**
     * 切换通知设置显示
     */
    toggleNotificationSettings(show) {
        const notificationSettings = document.getElementById('notification-settings');
        if (typeof window.DOMStyles !== 'undefined' && window.DOMStyles.setStyle) {
            window.DOMStyles.setStyle(notificationSettings, { display: show ? 'block' : 'none' });
        } else {
            notificationSettings.style.display = show ? 'block' : 'none';
        }
    }

    /**
     * 处理表单提交
     */
    handleFormSubmit() {
        const formData = this.getFormData();
        
        if (!this.validateFormData(formData)) {
            return;
        }

        try {
            if (this.currentEditingGoal) {
                // 更新现有目标
                this.goalManager.updateGoal(this.currentEditingGoal.id, formData);
                window.showMessage('目标更新成功！', 'success');
            } else {
                // 创建新目标
                this.goalManager.createGoal(formData);
                window.showMessage('目标创建成功！', 'success');
            }
            
            this.hideGoalModal();
        } catch (error) {
            console.error('Goal operation failed:', error);
            window.showMessage('操作失败：' + error.message, 'error');
        }
    }

    /**
     * 获取表单数据
     */
    getFormData() {
        return {
            type: document.getElementById('goal-type').value,
            targetType: document.getElementById('target-type').value,
            target: parseInt(document.getElementById('target-value').value),
            startDate: document.getElementById('start-date').value,
            endDate: document.getElementById('end-date').value || null,
            notifications: {
                enabled: document.getElementById('enable-notifications').checked,
                reminderTime: document.getElementById('reminder-time').value,
                encouragementMessages: document.getElementById('encouragement-messages').checked
            }
        };
    }

    /**
     * 验证表单数据
     */
    validateFormData(data) {
        if (!data.type) {
            window.showMessage('请选择目标周期', 'warning');
            return false;
        }

        if (!data.targetType) {
            window.showMessage('请选择目标类型', 'warning');
            return false;
        }

        if (!data.target || data.target <= 0) {
            window.showMessage('请输入有效的目标数值', 'warning');
            return false;
        }

        if (!data.startDate) {
            window.showMessage('请选择开始日期', 'warning');
            return false;
        }

        if (data.endDate && new Date(data.endDate) <= new Date(data.startDate)) {
            window.showMessage('结束日期必须晚于开始日期', 'warning');
            return false;
        }

        return true;
    }

    /**
     * 渲染当前目标
     */
    renderCurrentGoal() {
        const container = document.getElementById('current-goal-display');
        const currentGoal = this.goalManager.getCurrentGoal();
        
        if (!currentGoal) {
            container.innerHTML = `
                <div class="no-goal-message">
                    <div class="no-goal-icon">🎯</div>
                    <h4>暂无活动目标</h4>
                    <p>创建一个学习目标来开始您的学习计划</p>
                    <button class="btn btn-primary" onclick="document.getElementById('create-goal-btn').click()">
                        创建目标
                    </button>
                </div>
            `;
            return;
        }

        const progress = this.goalManager.getGoalProgress(currentGoal.id);
        const targetTypeOption = GoalManager.getTargetTypeOptions().find(opt => opt.value === currentGoal.targetType);
        
        container.innerHTML = `
            <div class="current-goal-card">
                <div class="goal-header">
                    <div class="goal-info">
                        <h4>${this.getGoalTypeLabel(currentGoal.type)}目标</h4>
                        <p class="goal-description">
                            ${targetTypeOption?.label}: ${currentGoal.target} ${targetTypeOption?.unit}
                        </p>
                    </div>
                    <div class="goal-actions">
                        <button class="btn btn-small btn-outline" onclick="goalSettings.editGoal('${currentGoal.id}')">
                            编辑
                        </button>
                        <button class="btn btn-small btn-danger" onclick="goalSettings.deleteGoal('${currentGoal.id}')">
                            删除
                        </button>
                    </div>
                </div>
                
                <div class="goal-progress">
                    <div class="progress-info">
                        <span class="progress-current">${progress.current}</span>
                        <span class="progress-separator">/</span>
                        <span class="progress-target">${progress.target}</span>
                        <span class="progress-unit">${targetTypeOption?.unit}</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progress.percentage}%"></div>
                    </div>
                    <div class="progress-percentage">${progress.percentage}%</div>
                </div>
                
                <div class="goal-stats">
                    <div class="goal-stat">
                        <span class="stat-label">连续天数</span>
                        <span class="stat-value">${progress.streak} 天</span>
                    </div>
                    ${progress.daysRemaining !== null ? `
                        <div class="goal-stat">
                            <span class="stat-label">剩余天数</span>
                            <span class="stat-value">${progress.daysRemaining} 天</span>
                        </div>
                    ` : ''}
                    <div class="goal-stat">
                        <span class="stat-label">状态</span>
                        <span class="stat-value ${progress.isCompleted ? 'completed' : 'active'}">
                            ${progress.isCompleted ? '已完成' : '进行中'}
                        </span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 渲染历史目标
     */
    renderGoalsHistory() {
        const container = document.getElementById('goals-history-list');
        const allGoals = this.goalManager.getAllGoals();
        const historyGoals = allGoals.filter(goal => !goal.isActive);
        
        if (historyGoals.length === 0) {
            container.innerHTML = `
                <div class="no-history-message">
                    <p>暂无历史目标</p>
                </div>
            `;
            return;
        }

        const goalsHtml = historyGoals.map(goal => {
            const progress = this.goalManager.getGoalProgress(goal.id);
            const targetTypeOption = GoalManager.getTargetTypeOptions().find(opt => opt.value === goal.targetType);
            
            return `
                <div class="history-goal-card">
                    <div class="goal-header">
                        <div class="goal-info">
                            <h5>${this.getGoalTypeLabel(goal.type)}目标</h5>
                            <p class="goal-description">
                                ${targetTypeOption?.label}: ${goal.target} ${targetTypeOption?.unit}
                            </p>
                            <p class="goal-dates">
                                ${goal.startDate} ${goal.endDate ? `- ${goal.endDate}` : ''}
                            </p>
                        </div>
                        <div class="goal-status ${progress.isCompleted ? 'completed' : 'incomplete'}">
                            ${progress.isCompleted ? '已完成' : '未完成'}
                        </div>
                    </div>
                    <div class="goal-progress-mini">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progress.percentage}%"></div>
                        </div>
                        <span class="progress-text">${progress.current}/${progress.target} (${progress.percentage}%)</span>
                    </div>
                    <div class="goal-actions">
                        <button class="btn btn-small btn-outline" onclick="goalSettings.editGoal('${goal.id}')">
                            编辑
                        </button>
                        <button class="btn btn-small btn-danger" onclick="goalSettings.deleteGoal('${goal.id}')">
                            删除
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = goalsHtml;
    }

    /**
     * 获取目标类型标签
     */
    getGoalTypeLabel(type) {
        const typeOptions = GoalManager.getGoalTypeOptions();
        const option = typeOptions.find(opt => opt.value === type);
        return option ? option.label.replace('目标', '') : type;
    }

    /**
     * 编辑目标
     */
    editGoal(goalId) {
        const goal = this.goalManager.getAllGoals().find(g => g.id === goalId);
        if (goal) {
            this.showGoalModal(goal);
        }
    }

    /**
     * 删除目标
     */
    deleteGoal(goalId) {
        if (confirm('确定要删除这个目标吗？此操作不可撤销。')) {
            try {
                this.goalManager.deleteGoal(goalId);
                window.showMessage('目标删除成功！', 'success');
            } catch (error) {
                console.error('Delete goal failed:', error);
                window.showMessage('删除失败：' + error.message, 'error');
            }
        }
    }

    /**
     * 目标创建事件处理
     */
    onGoalCreated(data) {
        this.renderCurrentGoal();
        this.renderGoalsHistory();
    }

    /**
     * 目标更新事件处理
     */
    onGoalUpdated(data) {
        this.renderCurrentGoal();
        this.renderGoalsHistory();
    }

    /**
     * 目标删除事件处理
     */
    onGoalDeleted(data) {
        this.renderCurrentGoal();
        this.renderGoalsHistory();
    }

    /**
     * 刷新显示
     */
    refresh() {
        this.renderCurrentGoal();
        this.renderGoalsHistory();
    }
}

// 全局实例
window.GoalSettings = GoalSettings;