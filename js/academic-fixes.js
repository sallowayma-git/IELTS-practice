/**
 * 学术主题页面修复脚本
 * 包含修复函数和兼容性处理
 * 版本: 1.0.0
 */

// 修复函数 - 确保在页面加载早期就可用
function safeGetRecords() {
    try {
        if (window.storage && typeof storage.get === 'function') {
            return storage.get('practice_records', []) || [];
        }
    } catch (e) {
        console.warn('[Fix] storage.get failed:', e);
    }
    try {
        return JSON.parse(localStorage.getItem('practice_records') || '[]');
    } catch (e) {
        console.warn('[Fix] localStorage fallback failed:', e);
        return [];
    }
}

function safeSetRecords(list) {
    try {
        if (window.storage && typeof storage.set === 'function') {
            storage.set('practice_records', list || []);
            console.log('[Fix] Records saved via storage.set');
            return;
        }
    } catch (e) {
        console.warn('[Fix] storage.set failed:', e);
    }
    try {
        localStorage.setItem('practice_records', JSON.stringify(list || []));
        console.log('[Fix] Records saved via localStorage');
    } catch(e) {
        console.error('[Fix] All storage methods failed:', e);
    }
}

function normalizeRecord(r) {
    var exam = (Array.isArray(window.examIndex) ? window.examIndex.find(e => String(e.id) === String(r.examId)) : null) || {};
    var percent = (typeof r.accuracy === 'number') ? Math.round(r.accuracy * 100) : (r.score || (r.realData && r.realData.percentage) || 0);
    var dur = r.duration || (r.realData && r.realData.duration) || 0;
    var when = r.endTime || r.createdAt || r.date || r.timestamp || Date.now();
    var title = (r.metadata && r.metadata.examTitle) || r.title || r.examName || exam.title || '未命名练习';
    var type = exam.type || r.type || (typeof getExamTypeFromCategory === 'function' ? getExamTypeFromCategory((r.metadata && r.metadata.category) || r.category) : 'reading');
    return {
        id: r.id || r.timestamp || Date.now(),
        examId: r.examId || '',
        title: title,
        type: type,
        score: percent,
        duration: dur,
        date: new Date(when).toISOString(),
        timestamp: when,
        realData: r.realData || null
    };
}

// 修复清除缓存功能
window.fixedClearCache = function() {
    console.log('[Fix] fixedClearCache called');
    if (!confirm('确定要清除所有缓存数据吗？此操作不可撤销！')) return;

    try {
        // 清除所有存储
        if (window.storage && typeof storage.clear === 'function') {
            storage.clear();
            console.log('[Fix] Storage cleared via storage.clear');
        } else {
            localStorage.clear();
            console.log('[Fix] Storage cleared via localStorage.clear');
        }
    } catch (e) {
        console.error('[Fix] Error clearing storage:', e);
    }

    // 确保练习记录被清空
    safeSetRecords([]);
    console.log('[Fix] Practice records cleared');

    // 显示消息
    try {
        if (typeof showMessage === 'function') {
            showMessage('缓存已清除', 'success');
        }
    } catch (e) {
        console.warn('[Fix] showMessage failed:', e);
    }

    // 立即重建题库索引，避免"题目不存在"
    try {
        if (typeof loadLibrary === 'function') {
            loadLibrary(true);
            console.log('[Fix] Library reloaded');
        }
    } catch (e) {
        console.warn('[Fix] loadLibrary failed:', e);
    }

    // 刷新练习记录视图
    setTimeout(function() {
        try {
            if (typeof syncPracticeRecords === 'function') {
                syncPracticeRecords();
                console.log('[Fix] Practice records synced');
            }
        } catch (e) {
            console.warn('[Fix] syncPracticeRecords failed:', e);
        }
    }, 200);
};

// 修复强制刷新题库功能
window.forceReloadLibrary = function() {
    console.log('[Fix] forceReloadLibrary called');
    try {
        if (typeof loadLibrary === 'function') {
            loadLibrary(true);
            console.log('[Fix] Library force reloaded');
            if (typeof showMessage === 'function') {
                showMessage('题库已强制刷新', 'success');
            }
        }
    } catch (e) {
        console.error('[Fix] forceReloadLibrary failed:', e);
    }
};

// 修复练习记录同步功能
window.fixedSyncPracticeRecords = function() {
    console.log('[Fix] fixedSyncPracticeRecords called');
    try {
        var records = safeGetRecords();
        console.log('[Fix] Found', records.length, 'records');
        window.practiceRecords = (records || []).map(normalizeRecord);

        if (typeof updatePracticeView === 'function') {
            updatePracticeView();
            console.log('[Fix] Practice view updated');
        }

        try {
            if (typeof updateOverview === 'function') {
                updateOverview();
            }
        } catch (e) {
            console.warn('[Fix] updateOverview failed:', e);
        }
    } catch (e) {
        console.error('[Fix] fixedSyncPracticeRecords error:', e);
        window.practiceRecords = [];
    }
};

// 修复批量删除功能
window.fixedBulkDeleteAction = function() {
    console.log('[Fix] fixedBulkDeleteAction called');
    if (!window.bulkDeleteMode) {
        console.log('[Fix] Not in bulk delete mode');
        return;
    }

    var ids = Array.from((window.selectedRecordIds || new Set())).map(String);
    console.log('[Fix] Deleting records:', ids);

    if (ids.length === 0) {
        console.log('[Fix] No records selected for deletion');
        return;
    }

    var list = safeGetRecords();
    var setIds = new Set(ids);
    var newList = (list || []).filter(r => !setIds.has(String(r.id || r.timestamp)));

    console.log('[Fix] Records before:', list.length, 'after:', newList.length);

    safeSetRecords(newList);

    // 同步内存并刷新
    try {
        window.practiceRecords = (window.practiceRecords || []).filter(r => !setIds.has(String(r.id || r.timestamp)));
    } catch (e) {
        console.warn('[Fix] Error updating memory records:', e);
    }

    try {
        if (typeof updatePracticeView === 'function') {
            updatePracticeView();
        }
    } catch (e) {
        console.warn('[Fix] updatePracticeView failed:', e);
    }

    try {
        if (typeof updateOverview === 'function') {
            updateOverview();
        }
    } catch (e) {
        console.warn('[Fix] updateOverview failed:', e);
    }

    try {
        (window.selectedRecordIds || new Set()).clear();
    } catch (e) {
        console.warn('[Fix] Error clearing selected IDs:', e);
    }

    window.bulkDeleteMode = false;
    var btn = document.getElementById('bulk-delete-btn');
    if (btn) {
        btn.innerHTML = '<i class="fas fa-trash"></i> 批量删除';
    }

    try {
        showMessage('删除成功', 'success');
    } catch (e) {
        console.warn('[Fix] showMessage failed:', e);
    }
};

// 覆盖原有函数
console.log('[Fix] Applying function overrides...');

// 等待DOM加载完成后覆盖原有函数
document.addEventListener('DOMContentLoaded', function() {
    console.log('[Fix] DOM loaded, applying overrides...');

    // 覆盖练习记录同步
    if (typeof window.syncPracticeRecords === 'function') {
        window.syncPracticeRecords = window.fixedSyncPracticeRecords;
        console.log('[Fix] syncPracticeRecords overridden');
    }

    // 覆盖清除缓存
    if (typeof window.clearCache === 'function') {
        window.clearCache = window.fixedClearCache;
        console.log('[Fix] clearCache overridden');
    }

    // 覆盖批量删除
    if (typeof window.bulkDeleteAction === 'function') {
        window.bulkDeleteAction = window.fixedBulkDeleteAction;
        console.log('[Fix] bulkDeleteAction overridden');
    }

    // 立即同步一次练习记录
    setTimeout(function() {
        try {
            window.fixedSyncPracticeRecords();
        } catch (e) {
            console.warn('[Fix] Initial sync failed:', e);
        }
    }, 500);
});

// 如果DOMContentLoaded已经触发，立即执行
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arguments.callee);
} else {
    console.log('[Fix] DOM already loaded, applying overrides immediately...');

    // 覆盖练习记录同步
    if (typeof window.syncPracticeRecords === 'function') {
        window.syncPracticeRecords = window.fixedSyncPracticeRecords;
        console.log('[Fix] syncPracticeRecords overridden (immediate)');
    }

    // 覆盖清除缓存
    if (typeof window.clearCache === 'function') {
        window.clearCache = window.fixedClearCache;
        console.log('[Fix] clearCache overridden (immediate)');
    }

    // 覆盖批量删除
    if (typeof window.bulkDeleteAction === 'function') {
        window.bulkDeleteAction = window.fixedBulkDeleteAction;
        console.log('[Fix] bulkDeleteAction overridden (immediate)');
    }

    // 立即同步一次练习记录
    setTimeout(function() {
        try {
            window.fixedSyncPracticeRecords();
        } catch (e) {
            console.warn('[Fix] Initial sync failed:', e);
        }
    }, 500);
}