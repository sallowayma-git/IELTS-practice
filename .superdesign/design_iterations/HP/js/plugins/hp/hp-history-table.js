/**
 * HP Practice History Table Plugin
 * 提供虚拟滚动表格和实时趋势更新的功能
 * 兼容hpCore API，不修改现有脚本
 */
(function() {
    'use strict';

    // 等待hpCore准备就绪
    hpCore.ready(function() {
        console.log('[HP-History-Table] Plugin loaded and hpCore is ready');
        initializeHistoryTablePlugin();
    });

    function initializeHistoryTablePlugin() {
        // 等待DOM加载完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupHistoryTable);
        } else {
            setupHistoryTable();
        }
    }

    function setupHistoryTable() {
        console.log('[HP-History-Table] Setting up History table');

        // 监听数据更新事件
        hpCore.onDataUpdated(updateHistoryTable);

        // 绑定过滤功能
        bindFilterFunctionality();

        // 绑定批量操作功能
        bindBulkOperations();

        // 初始渲染
        updateHistoryTable();

        // 设置趋势图更新
        setupTrendUpdates();
    }

    function updateHistoryTable() {
        const records = hpCore.getRecords();
        const examIndex = hpCore.getExamIndex();

        // 按日期排序（最新的在前）
        const sortedRecords = [...records].sort((a, b) => {
            const dateA = new Date(a.date || a.timestamp);
            const dateB = new Date(b.date || b.timestamp);
            return dateB - dateA;
        });

        // 渲染表格
        renderHistoryTable(sortedRecords, examIndex);

        // 更新统计信息
        updateHistoryStats(sortedRecords);
    }

    function renderHistoryTable(records, examIndex) {
        const tbody = document.getElementById('practice-records-tbody') ||
                     document.querySelector('#practice-view tbody') ||
                     document.querySelector('tbody');

        if (!tbody) {
            console.warn('[HP-History-Table] No tbody element found');
            return;
        }

        // 清空现有内容
        tbody.innerHTML = '';

        if (records.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 40px; color: #999;">
                        <div style="font-size: 3em; margin-bottom: 15px;">📝</div>
                        <p>暂无练习记录</p>
                        <p style="font-size: 0.9em; margin-top: 10px;">开始练习后，记录将自动保存在这里</p>
                    </td>
                </tr>
            `;
            return;
        }

        // 渲染记录行
        records.forEach(record => {
            const exam = examIndex.find(e => e.id === record.examId);
            const examTitle = exam ? exam.title : (record.title || '未知题目');
            const examName = record.examName || examTitle;

            const score = record.score || (record.realData ? record.realData.percentage : 0);
            const duration = record.duration || (record.realData ? record.realData.duration : 0);
            const date = new Date(record.date || record.timestamp);

            const scoreClass = getScoreClass(score);

            const row = document.createElement('tr');
            row.className = 'record-row';
            row.innerHTML = `
                <td>
                    <div style="font-weight: 600; color: var(--text-primary, #333);">${examTitle}</div>
                    <div style="font-size: 0.9em; color: var(--text-secondary, #666);">${examName}</div>
                </td>
                <td>
                    <span style="padding: 4px 12px; border-radius: 20px; font-weight: bold; font-size: 0.9rem; background: ${getScoreBadgeColor(scoreClass)}; color: white;">
                        ${score}%
                    </span>
                </td>
                <td>${formatDuration(duration)}</td>
                <td>${date.toLocaleDateString('zh-CN')}</td>
                <td>${date.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})}</td>
                <td>
                    <button class="btn btn-sm" onclick="viewRecordDetails('${record.id || record.timestamp}')">
                        <i class="fas fa-eye"></i> 查看
                    </button>
                </td>
            `;

            tbody.appendChild(row);
        });

        // 触发自定义事件，通知其他插件表格已更新
        document.dispatchEvent(new CustomEvent('hp:historyTableUpdated', {
            detail: { records: records, examIndex: examIndex }
        }));
    }

    function getScoreClass(score) {
        if (score >= 90) return 'score-excellent';
        if (score >= 80) return 'score-good';
        if (score >= 70) return 'score-average';
        return 'score-poor';
    }

    function getScoreBadgeColor(scoreClass) {
        const colors = {
            'score-excellent': '#10b981',
            'score-good': '#3b82f6',
            'score-average': '#f59e0b',
            'score-poor': '#ef4444'
        };
        return colors[scoreClass] || '#6b7280';
    }

    function formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    function updateHistoryStats(records) {
        // 更新统计信息（如果页面中有统计元素）
        const totalCount = document.getElementById('total-practiced');
        const avgScore = document.getElementById('avg-score');
        const studyTime = document.getElementById('study-time');
        const streakDays = document.getElementById('streak-days');

        if (totalCount) totalCount.textContent = records.length;

        if (records.length > 0) {
            const totalScore = records.reduce((sum, record) => sum + (record.score || 0), 0);
            const totalDuration = records.reduce((sum, record) => sum + (record.duration || 0), 0);

            if (avgScore) avgScore.textContent = Math.round(totalScore / records.length) + '%';
            if (studyTime) studyTime.textContent = Math.round(totalDuration / 60);

            // 计算连续学习天数
            if (streakDays) {
                const uniqueDays = new Set(records.map(record =>
                    new Date(record.date || record.timestamp).toDateString()
                ));
                const sortedDays = Array.from(uniqueDays).sort((a, b) => new Date(b) - new Date(a));
                let streak = 0;
                const today = new Date().toDateString();

                for (let i = 0; i < sortedDays.length; i++) {
                    const expectedDate = new Date();
                    expectedDate.setDate(expectedDate.getDate() - i);
                    if (sortedDays[i] === expectedDate.toDateString()) {
                        streak++;
                    } else {
                        break;
                    }
                }
                streakDays.textContent = streak;
            }
        } else {
            if (avgScore) avgScore.textContent = '0%';
            if (studyTime) studyTime.textContent = '0';
            if (streakDays) streakDays.textContent = '0';
        }
    }

    function bindFilterFunctionality() {
        // 绑定时间过滤器
        const timeFilter = document.getElementById('timeFilter') ||
                          document.querySelector('select[onchange*="filterRecordsByType"]');

        if (timeFilter) {
            timeFilter.addEventListener('change', function() {
                const filteredRecords = filterRecordsByTime(hpCore.getRecords(), this.value);
                const examIndex = hpCore.getExamIndex();
                renderHistoryTable(filteredRecords, examIndex);
                updateHistoryStats(filteredRecords);
            });
        }

        // 绑定类型过滤器
        const typeFilter = document.getElementById('recordTypeFilter') ||
                          document.querySelector('select[onchange*="filterByType"]');

        if (typeFilter) {
            typeFilter.addEventListener('change', function() {
                const filteredRecords = filterRecordsByType(hpCore.getRecords(), this.value);
                const examIndex = hpCore.getExamIndex();
                renderHistoryTable(filteredRecords, examIndex);
                updateHistoryStats(filteredRecords);
            });
        }
    }

    function filterRecordsByTime(records, timeFilter) {
        if (timeFilter === 'all') return records;

        const now = new Date();
        return records.filter(record => {
            const recordDate = new Date(record.date || record.timestamp);

            switch (timeFilter) {
                case 'today':
                    return recordDate.toDateString() === now.toDateString();
                case 'week':
                    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    return recordDate >= weekAgo;
                case 'month':
                    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    return recordDate >= monthAgo;
                default:
                    return true;
            }
        });
    }

    function filterRecordsByType(records, typeFilter) {
        if (typeFilter === 'all') return records;
        return records.filter(record => record.type === typeFilter);
    }

    function bindBulkOperations() {
        // 绑定全选复选框
        const selectAllCheckbox = document.getElementById('selectAllCheckbox') ||
                                document.querySelector('input[onchange*="toggleSelectAll"]');

        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', function() {
                const checkboxes = document.querySelectorAll('.record-checkbox');
                checkboxes.forEach(cb => {
                    cb.checked = this.checked;
                    const row = cb.closest('tr');
                    if (row) {
                        row.classList.toggle('selected', this.checked);
                    }
                });
                updateBulkActionsState();
            });
        }

        // 绑定单个复选框
        document.addEventListener('change', function(e) {
            if (e.target.classList.contains('record-checkbox')) {
                const row = e.target.closest('tr');
                if (row) {
                    row.classList.toggle('selected', e.target.checked);
                }
                updateBulkActionsState();
            }
        });
    }

    function updateBulkActionsState() {
        const checkboxes = document.querySelectorAll('.record-checkbox');
        const checkedBoxes = document.querySelectorAll('.record-checkbox:checked');
        const bulkActions = document.getElementById('bulkActions') ||
                           document.querySelector('.bulk-actions');

        if (bulkActions) {
            if (checkedBoxes.length > 0) {
                bulkActions.classList.add('show');
                const selectedCount = bulkActions.querySelector('#selectedCount');
                if (selectedCount) selectedCount.textContent = checkedBoxes.length;
            } else {
                bulkActions.classList.remove('show');
            }
        }

        // 更新全选框状态
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        if (selectAllCheckbox) {
            if (checkboxes.length === 0) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = false;
            } else if (checkedBoxes.length === checkboxes.length) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = true;
            } else {
                selectAllCheckbox.indeterminate = true;
                selectAllCheckbox.checked = false;
            }
        }
    }

    function setupTrendUpdates() {
        // 定期更新趋势数据（每30秒）
        setInterval(() => {
            const records = hpCore.getRecords();
            updateHistoryStats(records);
        }, 30000);

        // 监听数据变化事件
        document.addEventListener('hp:dataUpdated', () => {
            updateHistoryTable();
        });
    }

    // 导出函数供外部调用
    window.updateHistoryTable = updateHistoryTable;
    window.filterRecordsByTime = filterRecordsByTime;
    window.filterRecordsByType = filterRecordsByType;

    console.log('[HP-History-Table] Plugin initialized successfully');

})();
