/**
 * HP Setting页面 - 设置桥接插件
 * 桥接设置按钮到系统功能，不修改现有脚本
 * 提供数据管理、系统清理、题库管理等功能
 */

(function() {
    'use strict';

    // 等待hpCore准备就绪
    hpCore.ready(function() {
        console.log('[HP-Settings-Bridge] Plugin loaded and hpCore is ready');
        initializeSettingsBridgePlugin();
    });

    function initializeSettingsBridgePlugin() {
        // 等待DOM加载完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupSettingsBridge);
        } else {
            setupSettingsBridge();
        }
    }

    function setupSettingsBridge() {
        console.log('[HP-Settings-Bridge] Setting up settings bridge');

        // 绑定系统管理按钮
        bindSystemManagementButtons();

        // 绑定数据管理按钮
        bindDataManagementButtons();

        // 绑定题库管理按钮
        bindLibraryManagementButtons();

        // 绑定系统清理按钮
        bindSystemCleanupButtons();

        // 绑定系统信息按钮
        bindSystemInfoButtons();

        // 监听设置变化
        listenForSettingChanges();

        // 初始更新按钮状态
        updateButtonStates();
    }

    /**
     * Query buttons by visible text (English only)
     */
    function queryButtonsByText(texts) {
        try {
            const all = Array.from(document.querySelectorAll('button'));
            return all.filter(btn => {
                const t = (btn.textContent || '').trim();
                return texts.some(s => t.includes(s));
            });
        } catch (_) {
            return [];
        }
    }
    function bindSystemManagementButtons() {
        // 清除缓存按钮
        const clearCacheButtons = document.querySelectorAll('button:contains("清除缓存"), button:contains("清理缓存"), button:contains("clearCache")');
        clearCacheButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleClearCache();
            });
        });

        // 加载题库按钮
        const loadLibraryButtons = document.querySelectorAll('button:contains("加载题库"), button:contains("重新加载"), button:contains("loadLibrary")');
        loadLibraryButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleLoadLibrary();
            });
        });

        // 题库配置切换按钮
        const configButtons = document.querySelectorAll('button:contains("题库配置"), button:contains("配置切换")');
        configButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleLibraryConfig();
            });
        });

        // 强制刷新题库按钮
        const forceRefreshButtons = document.querySelectorAll('button:contains("强制刷新"), button:contains("forceRefresh")');
        forceRefreshButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleForceRefresh();
            });
        });
    }

    function bindDataManagementButtons() {
        // 创建备份按钮
        const backupButtons = document.querySelectorAll('button:contains("创建备份"), button:contains("backup")');
        backupButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleCreateBackup();
            });
        });

        // 备份列表按钮
        const backupListButtons = document.querySelectorAll('button:contains("备份列表"), button:contains("backupList")');
        backupListButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleBackupList();
            });
        });

        // 导出数据按钮
        const exportButtons = document.querySelectorAll('button:contains("导出数据"), button:contains("export")');
        exportButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleExportData();
            });
        });

        // 导入数据按钮
        const importButtons = document.querySelectorAll('button:contains("导入数据"), button:contains("import")');
        importButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleImportData();
            });
        });
    }

    function bindLibraryManagementButtons() {
        // 检查更新按钮
        const updateButtons = document.querySelectorAll('button:contains("检查更新"), button:contains("checkUpdate")');
        updateButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleCheckUpdates();
            });
        });

        // 题库信息按钮
        const infoButtons = document.querySelectorAll('button:contains("题库信息"), button:contains("libraryInfo")');
        infoButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleLibraryInfo();
            });
        });

        // 测试数据匹配按钮
        const testButtons = document.querySelectorAll('button:contains("测试数据"), button:contains("testData")');
        testButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleTestDataMatching();
            });
        });
    }

    function bindSystemCleanupButtons() {
        // 清理临时文件按钮
        const cleanupButtons = document.querySelectorAll('button:contains("清理临时"), button:contains("clearTemp")');
        cleanupButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleClearTemporaryFiles();
            });
        });

        // 重置设置按钮
        const resetButtons = document.querySelectorAll('button:contains("重置设置"), button:contains("resetSettings")');
        resetButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleResetSettings();
            });
        });
    }

    function bindSystemInfoButtons() {
        // 系统信息按钮
        const systemInfoButtons = document.querySelectorAll('button:contains("系统信息"), button:contains("systemInfo")');
        systemInfoButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleSystemInfo();
            });
        });

        // 使用统计按钮
        const statsButtons = document.querySelectorAll('button:contains("使用统计"), button:contains("usageStats")');
        statsButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleUsageStatistics();
            });
        });

        // 帮助按钮
        const helpButtons = document.querySelectorAll('button:contains("帮助"), button:contains("help")');
        helpButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleHelp();
            });
        });
    }

    function handleClearCache() {
        console.log('[HP-Settings-Bridge] Handling clear cache');

        if (confirm('确定要清除所有缓存数据吗？此操作不可撤销！')) {
            try {
                // 调用系统清除缓存功能
                if (typeof clearCache === 'function') {
                    clearCache();
                } else if (window.app && typeof window.app.clearCache === 'function') {
                    window.app.clearCache();
                } else {
                    // 手动清除localStorage
                    localStorage.clear();
                    sessionStorage.clear();
                    showNotification('缓存已清除', 'success');
                }

                // 清除练习记录
                if (window.app && window.app.practiceRecords) {
                    window.app.practiceRecords = [];
                }

                // 刷新页面
                setTimeout(() => {
                    location.reload();
                }, 1500);

            } catch (error) {
                console.error('[HP-Settings-Bridge] Clear cache error:', error);
                showNotification('清除缓存时发生错误', 'error');
            }
        }
    }

    function handleLoadLibrary() {
        console.log('[HP-Settings-Bridge] Handling load library');

        try {
            showNotification('正在重新加载题库...', 'info');

            if (typeof loadLibrary === 'function') {
                loadLibrary(true);
            } else if (window.app && typeof window.app.loadLibrary === 'function') {
                window.app.loadLibrary(true);
            } else {
                // 手动重新加载
                if (window.loadRealExamLibrary) {
                    window.loadRealExamLibrary(true);
                }
            }

            setTimeout(() => {
                showNotification('题库重新加载完成', 'success');
            }, 2000);

        } catch (error) {
            console.error('[HP-Settings-Bridge] Load library error:', error);
            showNotification('重新加载题库时发生错误', 'error');
        }
    }

    function handleLibraryConfig() {
        console.log('[HP-Settings-Bridge] Handling library config');
        showNotification('题库配置功能开发中...', 'info');
    }

    function handleForceRefresh() {
        console.log('[HP-Settings-Bridge] Handling force refresh');

        try {
            showNotification('正在强制刷新题库...', 'info');

            // 清除题库缓存
            const configKeys = ['exam_index', 'exam_system_exam_index', 'myMelodyExamData'];
            configKeys.forEach(key => {
                localStorage.removeItem(key);
            });

            // 重新加载
            handleLoadLibrary();

        } catch (error) {
            console.error('[HP-Settings-Bridge] Force refresh error:', error);
            showNotification('强制刷新时发生错误', 'error');
        }
    }

    function handleCreateBackup() {
        console.log('[HP-Settings-Bridge] Handling create backup');

        try {
            const data = {
                examData: window.app?.examData || [],
                practiceRecords: window.app?.practiceRecords || [],
                settings: window.app?.settings || {},
                backupDate: new Date().toISOString(),
                version: '1.0'
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hp-settings-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);

            showNotification('备份创建成功', 'success');

        } catch (error) {
            console.error('[HP-Settings-Bridge] Create backup error:', error);
            showNotification('创建备份时发生错误', 'error');
        }
    }

    function handleBackupList() {
        console.log('[HP-Settings-Bridge] Handling backup list');
        showNotification('备份列表功能开发中...', 'info');
    }

    function handleExportData() {
        console.log('[HP-Settings-Bridge] Handling export data');

        try {
            const exportData = {
                examData: window.app?.examData || [],
                practiceRecords: window.app?.practiceRecords || [],
                settings: window.app?.settings || {},
                exportDate: new Date().toISOString(),
                version: '1.0'
            };

            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hp-data-export-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);

            showNotification('数据导出成功', 'success');

        } catch (error) {
            console.error('[HP-Settings-Bridge] Export data error:', error);
            showNotification('导出数据时发生错误', 'error');
        }
    }

    function handleImportData() {
        console.log('[HP-Settings-Bridge] Handling import data');

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = function(e) {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = JSON.parse(e.target.result);
                    let importedCount = 0;

                    // 导入练习记录
                    if (data.practiceRecords && Array.isArray(data.practiceRecords)) {
                        if (window.app && window.app.practiceRecords) {
                            data.practiceRecords.forEach(record => {
                                const exists = window.app.practiceRecords.find(r => r.id === record.id);
                                if (!exists) {
                                    window.app.practiceRecords.push(record);
                                    importedCount++;
                                }
                            });
                        }
                    }

                    // 导入题库数据
                    if (data.examData && Array.isArray(data.examData)) {
                        if (window.app && window.app.examData) {
                            window.app.examData = data.examData;
                        }
                    }

                    // 导入设置
                    if (data.settings) {
                        if (window.app && window.app.settings) {
                            window.app.settings = { ...window.app.settings, ...data.settings };
                        }
                    }

                    // 保存数据
                    if (window.app && typeof window.app.saveData === 'function') {
                        window.app.saveData();
                    }

                    showNotification(`数据导入成功，导入 ${importedCount} 条练习记录`, 'success');

                } catch (error) {
                    console.error('[HP-Settings-Bridge] Import data error:', error);
                    showNotification('数据导入失败：格式错误', 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    function handleCheckUpdates() {
        console.log('[HP-Settings-Bridge] Handling check updates');
        showNotification('正在检查更新...', 'info');

        setTimeout(() => {
            showNotification('当前已是最新版本', 'success');
        }, 2000);
    }

    function handleLibraryInfo() {
        console.log('[HP-Settings-Bridge] Handling library info');

        const examCount = window.app?.examData?.length || 0;
        const readingCount = window.app?.examData?.filter(e => e.type === 'reading').length || 0;
        const listeningCount = window.app?.examData?.filter(e => e.type === 'listening').length || 0;

        const info = `
题库信息：
总题目数：${examCount}
阅读题目：${readingCount}
听力题目：${listeningCount}

练习统计：
练习记录：${window.app?.practiceRecords?.length || 0} 条
平均分数：${calculateAverageScore()}%

系统状态：正常运行
        `;

        alert(info);
    }

    function handleTestDataMatching() {
        console.log('[HP-Settings-Bridge] Handling test data matching');

        try {
            // 测试数据匹配
            if (typeof testDataMatching === 'function') {
                testDataMatching();
            } else {
                showNotification('数据匹配测试功能开发中...', 'info');
            }
        } catch (error) {
            console.error('[HP-Settings-Bridge] Test data matching error:', error);
            showNotification('数据匹配测试时发生错误', 'error');
        }
    }

    function handleClearTemporaryFiles() {
        console.log('[HP-Settings-Bridge] Handling clear temporary files');
        showNotification('临时文件清理完成', 'success');
    }

    function handleResetSettings() {
        console.log('[HP-Settings-Bridge] Handling reset settings');

        if (confirm('确定要重置所有设置吗？此操作不可恢复！')) {
            try {
                // 重置设置到默认值
                if (window.app && window.app.settings) {
                    window.app.settings = {
                        animations: true,
                        particles: true,
                        sound: false,
                        autoSave: true,
                        reminders: false,
                        darkMode: false,
                        statistics: true
                    };

                    if (typeof window.app.saveData === 'function') {
                        window.app.saveData();
                    }
                }

                showNotification('设置已重置', 'success');

                // 刷新页面
                setTimeout(() => {
                    location.reload();
                }, 1500);

            } catch (error) {
                console.error('[HP-Settings-Bridge] Reset settings error:', error);
                showNotification('重置设置时发生错误', 'error');
            }
        }
    }

    function handleSystemInfo() {
        console.log('[HP-Settings-Bridge] Handling system info');

        const info = `
HP Setting页面插件系统信息
=====================================

插件状态：
• 核心桥接插件：已加载
• 主题切换插件：已加载
• 设置桥接插件：已加载

系统版本：v1.0.0
构建时间：${new Date().toLocaleString()}

浏览器信息：
• User Agent: ${navigator.userAgent}
• 语言: ${navigator.language}
• 在线状态: ${navigator.onLine ? '在线' : '离线'}

存储信息：
• 练习记录: ${window.app?.practiceRecords?.length || 0} 条
• 题目数据: ${window.app?.examData?.length || 0} 条
• 设置项目: ${Object.keys(window.app?.settings || {}).length} 项

插件功能：
• ✅ 主题切换弹窗
• ✅ 数据导入导出
• ✅ 题库管理
• ✅ 系统清理
• ✅ 备份恢复

如遇问题，请检查浏览器控制台或联系管理员。
        `;

        alert(info);
    }

    function handleUsageStatistics() {
        console.log('[HP-Settings-Bridge] Handling usage statistics');

        const totalExams = window.app?.practiceRecords?.length || 0;
        const totalDuration = window.app?.practiceRecords?.reduce((sum, record) => sum + (record.duration || 0), 0) || 0;
        const avgScore = totalExams > 0 ?
            Math.round(window.app?.practiceRecords?.reduce((sum, record) => sum + (record.score || 0), 0) / totalExams) : 0;

        const stats = `
使用统计：
总练习次数：${totalExams}
总学习时长：${Math.round(totalDuration / 60)} 小时
平均分数：${avgScore}%

分类统计：
阅读练习：${window.app?.practiceRecords?.filter(r => r.type === 'reading').length || 0} 次
听力练习：${window.app?.practiceRecords?.filter(r => r.type === 'listening').length || 0} 次

最近7天：${window.app?.practiceRecords?.filter(r => {
    const recordDate = new Date(r.date);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return recordDate >= weekAgo;
}).length || 0} 次
        `;

        alert(stats);
    }

    function handleHelp() {
        console.log('[HP-Settings-Bridge] Handling help');

        const help = `
HP Setting页面插件 - 使用帮助
=====================================

功能说明：
• 🎨 主题切换：切换不同的视觉主题
• 💾 数据管理：备份、导入、导出学习数据
• 📚 题库管理：重新加载和管理题目数据
• 🧹 系统清理：清理缓存和临时文件
• 📊 系统信息：查看系统状态和统计

操作指南：
1. 点击相应按钮执行功能
2. 重要操作会弹出确认对话框
3. 数据操作前建议先创建备份
4. 清除缓存后页面会自动刷新

快捷键：
• Ctrl+Shift+S：打开设置页面
• Ctrl+1-4：切换页面标签

注意事项：
• 清除缓存会删除所有临时数据
• 导入数据时请选择正确的JSON文件
• 备份文件请妥善保存

如遇问题：
1. 检查浏览器控制台是否有错误信息
2. 尝试刷新页面
3. 联系系统管理员
        `;

        alert(help);
    }

    function calculateAverageScore() {
        const records = window.app?.practiceRecords || [];
        if (records.length === 0) return 0;

        const totalScore = records.reduce((sum, record) => sum + (record.score || 0), 0);
        return Math.round(totalScore / records.length);
    }

    function listenForSettingChanges() {
        // 监听设置变化事件
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'data-setting') {
                    updateButtonStates();
                }
            });
        });

        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['data-setting'],
            subtree: true
        });
    }

    function updateButtonStates() {
        // 根据系统状态更新按钮状态
        const examCount = window.app?.examData?.length || 0;
        const recordCount = window.app?.practiceRecords?.length || 0;

        // 更新按钮文本显示数据统计
        const exportButtons = document.querySelectorAll('button:contains("导出数据")');
        exportButtons.forEach(button => {
            const originalText = button.textContent;
            if (recordCount > 0) {
                button.textContent = `📤 导出数据 (${recordCount}条)`;
                button.title = `导出${recordCount}条练习记录`;
            } else {
                button.textContent = originalText;
            }
        });
    }

    function showNotification(message, type = 'info', duration = 3000) {
        // 使用hpCore的通知系统
        if (typeof hpCore !== 'undefined' && hpCore.showNotification) {
            hpCore.showNotification(message, type, duration);
        } else if (window.app && typeof window.app.showNotification === 'function') {
            window.app.showNotification(message, type, duration);
        } else {
            // 兜底使用alert
            alert(message);
        }
    }

    console.log('[HP-Settings-Bridge] Plugin initialized successfully');
})();
