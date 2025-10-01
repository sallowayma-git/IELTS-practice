/**
 * HP Setting椤甸潰 - 璁剧疆妗ユ帴鎻掍欢
 * 妗ユ帴璁剧疆鎸夐挳鍒扮郴缁熷姛鑳斤紝涓嶄慨鏀圭幇鏈夎剼鏈? * 鎻愪緵鏁版嵁绠＄悊銆佺郴缁熸竻鐞嗐€侀搴撶鐞嗙瓑鍔熻兘
 */

(function() {
    'use strict';

    // 绛夊緟hpCore鍑嗗灏辩华
    hpCore.ready(function() {
        console.log('[HP-Settings-Bridge] Plugin loaded and hpCore is ready');
        initializeSettingsBridgePlugin();
    });

    function initializeSettingsBridgePlugin() {
        // 绛夊緟DOM鍔犺浇瀹屾垚
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupSettingsBridge);
        } else {
            setupSettingsBridge();
        }
    }

    function setupSettingsBridge() {
        console.log('[HP-Settings-Bridge] Setting up settings bridge');

        // 缁戝畾绯荤粺绠＄悊鎸夐挳
        bindSystemManagementButtons();

        // 缁戝畾鏁版嵁绠＄悊鎸夐挳
        bindDataManagementButtons();

        // 缁戝畾棰樺簱绠＄悊鎸夐挳
        bindLibraryManagementButtons();

        // 缁戝畾绯荤粺娓呯悊鎸夐挳
        bindSystemCleanupButtons();

        // 缁戝畾绯荤粺淇℃伅鎸夐挳
        bindSystemInfoButtons();

        // 鐩戝惉璁剧疆鍙樺寲
        listenForSettingChanges();

        // 鍒濆鏇存柊鎸夐挳鐘舵€?        updateButtonStates();
    }

    function bindSystemManagementButtons() {
        // 娓呴櫎缂撳瓨鎸夐挳
        const clearCacheButtons = queryButtonsByText(["清除缓存","清理缓存","clearCache"]);
        clearCacheButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleClearCache();
            });
        });

        // 鍔犺浇棰樺簱鎸夐挳
        const loadLibraryButtons = queryButtonsByText(["加载题库","重新加载","loadLibrary"]);
        loadLibraryButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleLoadLibrary();
            });
        });

        // 棰樺簱閰嶇疆鍒囨崲鎸夐挳
        const configButtons = queryButtonsByText(["题库配置","配置切换"]);
        configButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleLibraryConfig();
            });
        });

        // 寮哄埗鍒锋柊棰樺簱鎸夐挳
        const forceRefreshButtons = queryButtonsByText(["强制刷新","forceRefresh"]);
        forceRefreshButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleForceRefresh();
            });
        });
    }

    function bindDataManagementButtons() {
        // 鍒涘缓澶囦唤鎸夐挳
        const backupButtons = queryButtonsByText(["创建备份","backup"]);
        backupButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleCreateBackup();
            });
        });

        // 澶囦唤鍒楄〃鎸夐挳
        const backupListButtons = queryButtonsByText(["备份列表","backupList"]);
        backupListButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleBackupList();
            });
        });

        // 瀵煎嚭鏁版嵁鎸夐挳
        const exportButtons = queryButtonsByText(["导出数据","export"]);
        exportButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleExportData();
            });
        });

        // 瀵煎叆鏁版嵁鎸夐挳
        const importButtons = queryButtonsByText(["导入数据","import"]);
        importButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleImportData();
            });
        });
    }

    function bindLibraryManagementButtons() {
        const updateButtons = queryButtonsByText(["检查更新","检查更","checkUpdate"]);
        updateButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleCheckUpdates();
            });
        });

        // 棰樺簱淇℃伅鎸夐挳
        const infoButtons = queryButtonsByText(["题库信息","libraryInfo"]);
        infoButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleLibraryInfo();
            });
        });

        // 娴嬭瘯鏁版嵁鍖归厤鎸夐挳
        const testButtons = queryButtonsByText(["测试数据","testData"]);
        testButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleTestDataMatching();
            });
        });
    }

    function bindSystemCleanupButtons() {
        // 娓呯悊涓存椂鏂囦欢鎸夐挳
        const cleanupButtons = queryButtonsByText(["清理临时","clearTemp"]);
        cleanupButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleClearTemporaryFiles();
            });
        });

        // 閲嶇疆璁剧疆鎸夐挳
        const resetButtons = queryButtonsByText(["重置设置","resetSettings"]);
        resetButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleResetSettings();
            });
        });
    }

    function bindSystemInfoButtons() {
        // 绯荤粺淇℃伅鎸夐挳
        const systemInfoButtons = queryButtonsByText(["系统信息","systemInfo"]);
        systemInfoButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleSystemInfo();
            });
        });

        // 浣跨敤缁熻鎸夐挳
        const statsButtons = queryButtonsByText(["使用统计","usageStats"]);
        statsButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleUsageStatistics();
            });
        });

        // 甯姪鎸夐挳
        const helpButtons = queryButtonsByText(["帮助","help"]);
        helpButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                handleHelp();
            });
        });
    }

    function handleClearCache() {
        console.log('[HP-Settings-Bridge] Handling clear cache');

        if (confirm('纭畾瑕佹竻闄ゆ墍鏈夌紦瀛樻暟鎹悧锛熸鎿嶄綔涓嶅彲鎾ら攢锛?)) {
            try {
                // 璋冪敤绯荤粺娓呴櫎缂撳瓨鍔熻兘
                if (typeof clearCache === 'function') {
                    clearCache();
                } else if (window.app && typeof window.app.clearCache === 'function') {
                    window.app.clearCache();
                } else {
                    // 鎵嬪姩娓呴櫎localStorage
                    localStorage.clear();
                    sessionStorage.clear();
                    showNotification('缂撳瓨宸叉竻闄?, 'success');
                }

                // 娓呴櫎缁冧範璁板綍
                if (window.app && window.app.practiceRecords) {
                    window.app.practiceRecords = [];
                }

                // 鍒锋柊椤甸潰
                setTimeout(() => {
                    location.reload();
                }, 1500);

            } catch (error) {
                console.error('[HP-Settings-Bridge] Clear cache error:', error);
                showNotification('娓呴櫎缂撳瓨鏃跺彂鐢熼敊璇?, 'error');
            }
        }
    }

    function handleLoadLibrary() {
        console.log('[HP-Settings-Bridge] Handling load library');

        try {
            showNotification('姝ｅ湪閲嶆柊鍔犺浇棰樺簱...', 'info');

            if (typeof loadLibrary === 'function') {
                loadLibrary(true);
            } else if (window.app && typeof window.app.loadLibrary === 'function') {
                window.app.loadLibrary(true);
            } else {
                // 鎵嬪姩閲嶆柊鍔犺浇
                if (window.loadRealExamLibrary) {
                    window.loadRealExamLibrary(true);
                }
            }

            setTimeout(() => {
                showNotification('棰樺簱閲嶆柊鍔犺浇瀹屾垚', 'success');
            }, 2000);

        } catch (error) {
            console.error('[HP-Settings-Bridge] Load library error:', error);
            showNotification('閲嶆柊鍔犺浇棰樺簱鏃跺彂鐢熼敊璇?, 'error');
        }
    }

    function handleLibraryConfig() {
        console.log('[HP-Settings-Bridge] Handling library config');
        showNotification('棰樺簱閰嶇疆鍔熻兘寮€鍙戜腑...', 'info');
    }

    function handleForceRefresh() {
        console.log('[HP-Settings-Bridge] Handling force refresh');

        try {
            showNotification('姝ｅ湪寮哄埗鍒锋柊棰樺簱...', 'info');

            // 娓呴櫎棰樺簱缂撳瓨
            const configKeys = ['exam_index', 'exam_system_exam_index', 'myMelodyExamData'];
            configKeys.forEach(key => {
                localStorage.removeItem(key);
            });

            // 閲嶆柊鍔犺浇
            handleLoadLibrary();

        } catch (error) {
            console.error('[HP-Settings-Bridge] Force refresh error:', error);
            showNotification('寮哄埗鍒锋柊鏃跺彂鐢熼敊璇?, 'error');
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

            showNotification('澶囦唤鍒涘缓鎴愬姛', 'success');

        } catch (error) {
            console.error('[HP-Settings-Bridge] Create backup error:', error);
            showNotification('鍒涘缓澶囦唤鏃跺彂鐢熼敊璇?, 'error');
        }
    }

    function handleBackupList() {
        console.log('[HP-Settings-Bridge] Handling backup list');
        showNotification('澶囦唤鍒楄〃鍔熻兘寮€鍙戜腑...', 'info');
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

            showNotification('鏁版嵁瀵煎嚭鎴愬姛', 'success');

        } catch (error) {
            console.error('[HP-Settings-Bridge] Export data error:', error);
            showNotification('瀵煎嚭鏁版嵁鏃跺彂鐢熼敊璇?, 'error');
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

                    // 瀵煎叆缁冧範璁板綍
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

                    // 瀵煎叆棰樺簱鏁版嵁
                    if (data.examData && Array.isArray(data.examData)) {
                        if (window.app && window.app.examData) {
                            window.app.examData = data.examData;
                        }
                    }

                    // 瀵煎叆璁剧疆
                    if (data.settings) {
                        if (window.app && window.app.settings) {
                            window.app.settings = { ...window.app.settings, ...data.settings };
                        }
                    }

                    // 淇濆瓨鏁版嵁
                    if (window.app && typeof window.app.saveData === 'function') {
                        window.app.saveData();
                    }

                    showNotification(`鏁版嵁瀵煎叆鎴愬姛锛屽鍏?${importedCount} 鏉＄粌涔犺褰昤, 'success');

                } catch (error) {
                    console.error('[HP-Settings-Bridge] Import data error:', error);
                    showNotification('鏁版嵁瀵煎叆澶辫触锛氭牸寮忛敊璇?, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    function handleCheckUpdates() {
        console.log('[HP-Settings-Bridge] Handling check updates');
        showNotification('姝ｅ湪妫€鏌ユ洿鏂?..', 'info');

        setTimeout(() => {
            showNotification('褰撳墠宸叉槸鏈€鏂扮増鏈?, 'success');
        }, 2000);
    }

    function handleLibraryInfo() {
        console.log('[HP-Settings-Bridge] Handling library info');

        const examCount = window.app?.examData?.length || 0;
        const readingCount = window.app?.examData?.filter(e => e.type === 'reading').length || 0;
        const listeningCount = window.app?.examData?.filter(e => e.type === 'listening').length || 0;

        const info = `
棰樺簱淇℃伅锛?鎬婚鐩暟锛?{examCount}
闃呰棰樼洰锛?{readingCount}
鍚姏棰樼洰锛?{listeningCount}

缁冧範缁熻锛?缁冧範璁板綍锛?{window.app?.practiceRecords?.length || 0} 鏉?骞冲潎鍒嗘暟锛?{calculateAverageScore()}%

绯荤粺鐘舵€侊細姝ｅ父杩愯
        `;

        alert(info);
    }

    function handleTestDataMatching() {
        console.log('[HP-Settings-Bridge] Handling test data matching');

        try {
            // 娴嬭瘯鏁版嵁鍖归厤
            if (typeof testDataMatching === 'function') {
                testDataMatching();
            } else {
                showNotification('鏁版嵁鍖归厤娴嬭瘯鍔熻兘寮€鍙戜腑...', 'info');
            }
        } catch (error) {
            console.error('[HP-Settings-Bridge] Test data matching error:', error);
            showNotification('鏁版嵁鍖归厤娴嬭瘯鏃跺彂鐢熼敊璇?, 'error');
        }
    }

    function handleClearTemporaryFiles() {
        console.log('[HP-Settings-Bridge] Handling clear temporary files');
        showNotification('涓存椂鏂囦欢娓呯悊瀹屾垚', 'success');
    }

    function handleResetSettings() {
        console.log('[HP-Settings-Bridge] Handling reset settings');

        if (confirm('纭畾瑕侀噸缃墍鏈夎缃悧锛熸鎿嶄綔涓嶅彲鎭㈠锛?)) {
            try {
                // 閲嶇疆璁剧疆鍒伴粯璁ゅ€?                if (window.app && window.app.settings) {
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

                showNotification('璁剧疆宸查噸缃?, 'success');

                // 鍒锋柊椤甸潰
                setTimeout(() => {
                    location.reload();
                }, 1500);

            } catch (error) {
                console.error('[HP-Settings-Bridge] Reset settings error:', error);
                showNotification('閲嶇疆璁剧疆鏃跺彂鐢熼敊璇?, 'error');
            }
        }
    }

    function handleSystemInfo() {
        console.log('[HP-Settings-Bridge] Handling system info');

        const info = `
HP Setting椤甸潰鎻掍欢绯荤粺淇℃伅
=====================================

鎻掍欢鐘舵€侊細
鈥?鏍稿績妗ユ帴鎻掍欢锛氬凡鍔犺浇
鈥?涓婚鍒囨崲鎻掍欢锛氬凡鍔犺浇
鈥?璁剧疆妗ユ帴鎻掍欢锛氬凡鍔犺浇

绯荤粺鐗堟湰锛歷1.0.0
鏋勫缓鏃堕棿锛?{new Date().toLocaleString()}

娴忚鍣ㄤ俊鎭細
鈥?User Agent: ${navigator.userAgent}
鈥?璇█: ${navigator.language}
鈥?鍦ㄧ嚎鐘舵€? ${navigator.onLine ? '鍦ㄧ嚎' : '绂荤嚎'}

瀛樺偍淇℃伅锛?鈥?缁冧範璁板綍: ${window.app?.practiceRecords?.length || 0} 鏉?鈥?棰樼洰鏁版嵁: ${window.app?.examData?.length || 0} 鏉?鈥?璁剧疆椤圭洰: ${Object.keys(window.app?.settings || {}).length} 椤?
鎻掍欢鍔熻兘锛?鈥?鉁?涓婚鍒囨崲寮圭獥
鈥?鉁?鏁版嵁瀵煎叆瀵煎嚭
鈥?鉁?棰樺簱绠＄悊
鈥?鉁?绯荤粺娓呯悊
鈥?鉁?澶囦唤鎭㈠

濡傞亣闂锛岃妫€鏌ユ祻瑙堝櫒鎺у埗鍙版垨鑱旂郴绠＄悊鍛樸€?        `;

        alert(info);
    }

    function handleUsageStatistics() {
        console.log('[HP-Settings-Bridge] Handling usage statistics');

        const totalExams = window.app?.practiceRecords?.length || 0;
        const totalDuration = window.app?.practiceRecords?.reduce((sum, record) => sum + (record.duration || 0), 0) || 0;
        const avgScore = totalExams > 0 ?
            Math.round(window.app?.practiceRecords?.reduce((sum, record) => sum + (record.score || 0), 0) / totalExams) : 0;

        const stats = `
浣跨敤缁熻锛?鎬荤粌涔犳鏁帮細${totalExams}
鎬诲涔犳椂闀匡細${Math.round(totalDuration / 60)} 灏忔椂
骞冲潎鍒嗘暟锛?{avgScore}%

鍒嗙被缁熻锛?闃呰缁冧範锛?{window.app?.practiceRecords?.filter(r => r.type === 'reading').length || 0} 娆?鍚姏缁冧範锛?{window.app?.practiceRecords?.filter(r => r.type === 'listening').length || 0} 娆?
鏈€杩?澶╋細${window.app?.practiceRecords?.filter(r => {
    const recordDate = new Date(r.date);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return recordDate >= weekAgo;
}).length || 0} 娆?        `;

        alert(stats);
    }

    function handleHelp() {
        console.log('[HP-Settings-Bridge] Handling help');

        const help = `
HP Setting椤甸潰鎻掍欢 - 浣跨敤甯姪
=====================================

鍔熻兘璇存槑锛?鈥?馃帹 涓婚鍒囨崲锛氬垏鎹笉鍚岀殑瑙嗚涓婚
鈥?馃捑 鏁版嵁绠＄悊锛氬浠姐€佸鍏ャ€佸鍑哄涔犳暟鎹?鈥?馃摎 棰樺簱绠＄悊锛氶噸鏂板姞杞藉拰绠＄悊棰樼洰鏁版嵁
鈥?馃Ч 绯荤粺娓呯悊锛氭竻鐞嗙紦瀛樺拰涓存椂鏂囦欢
鈥?馃搳 绯荤粺淇℃伅锛氭煡鐪嬬郴缁熺姸鎬佸拰缁熻

鎿嶄綔鎸囧崡锛?1. 鐐瑰嚮鐩稿簲鎸夐挳鎵ц鍔熻兘
2. 閲嶈鎿嶄綔浼氬脊鍑虹‘璁ゅ璇濇
3. 鏁版嵁鎿嶄綔鍓嶅缓璁厛鍒涘缓澶囦唤
4. 娓呴櫎缂撳瓨鍚庨〉闈細鑷姩鍒锋柊

蹇嵎閿細
鈥?Ctrl+Shift+S锛氭墦寮€璁剧疆椤甸潰
鈥?Ctrl+1-4锛氬垏鎹㈤〉闈㈡爣绛?
娉ㄦ剰浜嬮」锛?鈥?娓呴櫎缂撳瓨浼氬垹闄ゆ墍鏈変复鏃舵暟鎹?鈥?瀵煎叆鏁版嵁鏃惰閫夋嫨姝ｇ‘鐨凧SON鏂囦欢
鈥?澶囦唤鏂囦欢璇峰Ε鍠勪繚瀛?
濡傞亣闂锛?1. 妫€鏌ユ祻瑙堝櫒鎺у埗鍙版槸鍚︽湁閿欒淇℃伅
2. 灏濊瘯鍒锋柊椤甸潰
3. 鑱旂郴绯荤粺绠＄悊鍛?        `;

        alert(help);
    }

    function calculateAverageScore() {
        const records = window.app?.practiceRecords || [];
        if (records.length === 0) return 0;

        const totalScore = records.reduce((sum, record) => sum + (record.score || 0), 0);
        return Math.round(totalScore / records.length);
    }

    function listenForSettingChanges() {
        // 鐩戝惉璁剧疆鍙樺寲浜嬩欢
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
        // 鏍规嵁绯荤粺鐘舵€佹洿鏂版寜閽姸鎬?        const examCount = window.app?.examData?.length || 0;
        const recordCount = window.app?.practiceRecords?.length || 0;

        // 鏇存柊鎸夐挳鏂囨湰鏄剧ず鏁版嵁缁熻
        const exportButtons = queryButtonsByText(["导出数据","export"]);
        exportButtons.forEach(button => {
            const originalText = button.textContent;
            if (recordCount > 0) {
                button.textContent = `馃摛 瀵煎嚭鏁版嵁 (${recordCount}鏉?`;
                button.title = `瀵煎嚭${recordCount}鏉＄粌涔犺褰昤;
            } else {
                button.textContent = originalText;
            }
        });
    }

    function showNotification(message, type = 'info', duration = 3000) {
        // 浣跨敤hpCore鐨勯€氱煡绯荤粺
        if (typeof hpCore !== 'undefined' && hpCore.showNotification) {
            hpCore.showNotification(message, type, duration);
        } else if (window.app && typeof window.app.showNotification === 'function') {
            window.app.showNotification(message, type, duration);
        } else {
            // 鍏滃簳浣跨敤alert
            alert(message);
        }
    }

    console.log('[HP-Settings-Bridge] Plugin initialized successfully');
})();



