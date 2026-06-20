(function (window) {
    'use strict';

    var TYPE_LABELS = {
        practice_count: '练习次数',
        study_time: '学习时长 (分钟)',
        accuracy: '正确率 (%)'
    };

    var PERIOD_LABELS = {
        daily: '每日',
        weekly: '每周',
        monthly: '每月'
    };

    var TYPE_ICONS = {
        practice_count: '练',
        study_time: '时',
        accuracy: '准'
    };

    function escapeHtml(value) {
        if (value == null) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function clampPercent(value) {
        var numeric = Number(value);
        if (!Number.isFinite(numeric)) return 0;
        return Math.max(0, Math.min(100, numeric));
    }

    var MAX_RENDERED_GOALS = 100;

    function GoalSettingsPanel(options) {
        this.container = options.container || null;
        this.goalManager = options.goalManager || null;
        this.dom = options.domBuilder || (window.DOM && window.DOM.builder);
        this.events = options.events || (window.DOM && window.DOM.events);
        this._boundRender = this._onGoalUpdate.bind(this);
    }

    GoalSettingsPanel.prototype.init = function () {
        if (this.goalManager) {
            this.goalManager.on('goalUpdated', this._boundRender);
        }
    };

    GoalSettingsPanel.prototype.destroy = function () {
        if (this.goalManager) {
            this.goalManager.off('goalUpdated', this._boundRender);
        }
    };

    GoalSettingsPanel.prototype._onGoalUpdate = function () {
        this.render();
    };

    GoalSettingsPanel.prototype.render = function () {
        var container = this.container;
        if (!container) return;

        if (!this.goalManager || !this.goalManager.ready) {
            container.innerHTML = '<div class="goal-panel-loading">加载中...</div>';
            return;
        }

        var allProgress = this.goalManager.getAllProgress();
        if (Array.isArray(allProgress)) {
            allProgress = allProgress.slice(0, MAX_RENDERED_GOALS);
        } else {
            allProgress = [];
        }
        var streak = this.goalManager.getStreak();
        var html = '';

        html += '<div class="goal-streak-bar">';
        html += '<span class="goal-streak-icon">连续</span>';
        html += '<span class="goal-streak-text">连续学习 <strong>' + escapeHtml(streak.current) + '</strong> 天</span>';
        if (streak.best > 0) {
            html += '<span class="goal-streak-best">最佳 ' + escapeHtml(streak.best) + ' 天</span>';
        }
        html += '</div>';

        if (allProgress.length > 0) {
            html += '<div class="goal-list">';
            for (var i = 0; i < allProgress.length; i += 1) {
                html += this._renderGoalCard(allProgress[i]);
            }
            html += '</div>';
        } else {
            html += '<div class="goal-empty">暂无学习目标，点击下方按钮创建。</div>';
        }

        html += '<div class="goal-actions">';
        html += '<button class="goal-btn goal-btn-add" data-action="add-goal">+ 添加目标</button>';
        html += '</div>';

        container.innerHTML = html;
        this._bindActions(container);
    };

    GoalSettingsPanel.prototype._renderGoalCard = function (progress) {
        var goal = progress.goal;
        var icon = TYPE_ICONS[goal.type] || '目';
        var typeLabel = TYPE_LABELS[goal.type] || goal.type;
        var periodLabel = PERIOD_LABELS[goal.period] || goal.period;
        var percent = progress.percent;
        var completed = progress.completed;
        var display = goal.type === 'accuracy'
            ? Math.round(progress.current * 100) + '%'
            : String(progress.current);

        var cls = 'goal-card' + (completed ? ' goal-card-completed' : '');
        var safeGoalId = escapeHtml(goal.id);
        var safeTitle = escapeHtml(goal.title || periodLabel + typeLabel);
        var safeDisplay = escapeHtml(display);
        var safeTarget = escapeHtml(goal.target);
        var width = clampPercent(percent);
        var html = '<div class="' + cls + '" data-goal-id="' + safeGoalId + '">';
        html += '<div class="goal-card-header">';
        html += '<span class="goal-card-icon">' + icon + '</span>';
        html += '<span class="goal-card-title">' + safeTitle + '</span>';
        if (completed) {
            html += '<span class="goal-card-badge">完成</span>';
        }
        html += '<button class="goal-btn-delete" data-action="delete-goal" data-goal-id="' + safeGoalId + '" title="删除">×</button>';
        html += '</div>';
        html += '<div class="goal-card-progress">';
        html += '<div class="goal-progress-bar">';
        html += '<div class="goal-progress-fill" style="width:' + width + '%"></div>';
        html += '</div>';
        html += '<div class="goal-progress-text">' + safeDisplay + ' / ' + safeTarget + ' ' + this._unitLabel(goal.type) + '</div>';
        html += '</div>';
        html += '</div>';
        return html;
    };

    GoalSettingsPanel.prototype._unitLabel = function (type) {
        if (type === 'practice_count') return '次';
        if (type === 'study_time') return '分钟';
        if (type === 'accuracy') return '%';
        return '';
    };

    GoalSettingsPanel.prototype._bindActions = function (container) {
        var self = this;
        var addBtn = container.querySelector('[data-action="add-goal"]');
        if (addBtn) {
            addBtn.addEventListener('click', function () {
                self._showCreateDialog();
            });
        }

        var deleteBtns = container.querySelectorAll('[data-action="delete-goal"]');
        for (var i = 0; i < deleteBtns.length; i += 1) {
            deleteBtns[i].addEventListener('click', function () {
                var gid = this.getAttribute('data-goal-id');
                if (gid && self.goalManager) {
                    self.goalManager.deleteGoal(gid);
                }
            });
        }
    };

    GoalSettingsPanel.prototype._showCreateDialog = function () {
        var self = this;
        var overlay = document.createElement('div');
        overlay.className = 'goal-dialog-overlay';

        var dialog = document.createElement('div');
        dialog.className = 'goal-dialog';
        dialog.innerHTML = this._renderCreateForm();

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) {
                document.body.removeChild(overlay);
            }
        });

        var cancelBtn = dialog.querySelector('[data-action="cancel"]');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function () {
                document.body.removeChild(overlay);
            });
        }

        var saveBtn = dialog.querySelector('[data-action="save"]');
        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                var type = dialog.querySelector('#goal-type').value;
                var period = dialog.querySelector('#goal-period').value;
                var target = Number(dialog.querySelector('#goal-target').value);
                var title = dialog.querySelector('#goal-title').value.trim();

                if (!type || !period || !Number.isFinite(target) || target <= 0) {
                    if (window.showMessage) {
                        window.showMessage('请填写完整的目标信息', 'warning');
                    }
                    return;
                }

                self.goalManager.createGoal({
                    type: type,
                    period: period,
                    target: target,
                    title: title
                });

                document.body.removeChild(overlay);
            });
        }

        var typeSelect = dialog.querySelector('#goal-type');
        if (typeSelect) {
            typeSelect.addEventListener('change', function () {
                var placeholder = dialog.querySelector('#goal-target');
                if (this.value === 'practice_count') placeholder.placeholder = '例如：3';
                else if (this.value === 'study_time') placeholder.placeholder = '例如：30';
                else if (this.value === 'accuracy') placeholder.placeholder = '例如：80';
            });
        }
    };

    GoalSettingsPanel.prototype._renderCreateForm = function () {
        var html = '<div class="goal-dialog-content">';
        html += '<h3>创建学习目标</h3>';

        html += '<div class="goal-form-group">';
        html += '<label for="goal-type">目标类型</label>';
        html += '<select id="goal-type">';
        html += '<option value="practice_count">练习次数</option>';
        html += '<option value="study_time">学习时长 (分钟)</option>';
        html += '<option value="accuracy">正确率 (%)</option>';
        html += '</select>';
        html += '</div>';

        html += '<div class="goal-form-group">';
        html += '<label for="goal-period">目标周期</label>';
        html += '<select id="goal-period">';
        html += '<option value="daily">每日</option>';
        html += '<option value="weekly">每周</option>';
        html += '<option value="monthly">每月</option>';
        html += '</select>';
        html += '</div>';

        html += '<div class="goal-form-group">';
        html += '<label for="goal-target">目标值</label>';
        html += '<input type="number" id="goal-target" min="1" placeholder="例如：3" />';
        html += '</div>';

        html += '<div class="goal-form-group">';
        html += '<label for="goal-title">标题 (可选)</label>';
        html += '<input type="text" id="goal-title" placeholder="自定义标题" maxlength="30" />';
        html += '</div>';

        html += '<div class="goal-dialog-actions">';
        html += '<button class="goal-btn goal-btn-cancel" data-action="cancel">取消</button>';
        html += '<button class="goal-btn goal-btn-save" data-action="save">保存</button>';
        html += '</div>';

        html += '</div>';
        return html;
    };

    window.GoalSettingsPanel = GoalSettingsPanel;
})(typeof window !== 'undefined' ? window : this);
