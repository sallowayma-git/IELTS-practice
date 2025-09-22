/**
 * 学术主题页面增强脚本
 * 包含学术主题页面的特定功能增强
 * 版本: 1.0.0
 */

// 全局变量定义（仅本页使用）
let selectedRecordIds = new Set();

// 页面增强功能
(function(){
    // 保障兼容：全局集合（若未定义则创建）
    if (!window.selectedRecordIds) window.selectedRecordIds = new Set();

    // 1) 查看详情：调用现有 PracticeRecordModal 显示弹窗
    window.viewRecordDetails = async function(recordId) {
        try {
            if (window.practiceRecordModal && typeof window.practiceRecordModal.showById === 'function') {
                window.practiceRecordModal.showById(recordId);
            } else if (window.practiceHistoryEnhancer && typeof window.practiceHistoryEnhancer.showRecordDetails === 'function') {
                window.practiceHistoryEnhancer.showRecordDetails(recordId);
            } else {
                var recs = await storage.get('practice_records', []);
                var r = recs.find(function(x){ return String(x.id||x.timestamp) === String(recordId); });
                alert(r ? ('题目：' + (r.title||'未知') + '\n分数：' + (r.score||0) + '%\n用时：' + (r.duration||0) + '秒') : '记录不存在');
            }
        } catch (e) {
            console.error('[viewRecordDetails] 失败:', e);
            if (window.showMessage) window.showMessage('无法显示记录详情: ' + e.message, 'error');
        }
    };

    // 2) 注入选择列（用于批量删除）
    window.decoratePracticeTableForSelection = function() {
        try {
            var tbody = document.getElementById('practice-records-tbody');
            if (!tbody) return;
            var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
            rows.forEach(function(row){
                var firstCell = row.children[0];
                var hasCheckbox = firstCell && firstCell.querySelector && firstCell.querySelector('input.record-select');
                if (hasCheckbox) return;
                // 从"查看"按钮中提取 recordId
                var actionBtn = row.querySelector('button[onclick^="viewRecordDetails("]');
                var recordId = '';
                if (actionBtn) {
                    var oc = actionBtn.getAttribute('onclick') || '';
                    var m = oc.match(/viewRecordDetails\(['\"](.+?)['\"]\)/);
                    if (m) recordId = m[1];
                }
                var cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'record-select';
                cb.setAttribute('data-id', recordId);
                cb.checked = window.selectedRecordIds.has(String(recordId));
                cb.onchange = function(){ window.onRecordCheckboxChange(cb); };
                var td = document.createElement('td');
                td.style.textAlign = 'center';
                td.appendChild(cb);
                row.insertBefore(td, row.firstChild);
            });
            window.syncSelectAllCheckboxState();
        } catch (e) { console.warn('[SelectionDecor] 渲染失败:', e); }
    };

    window.onRecordCheckboxChange = function(el){
        var id = String(el.getAttribute('data-id'));
        if (el.checked) window.selectedRecordIds.add(id); else window.selectedRecordIds.delete(id);
        window.syncSelectAllCheckboxState();
    };

    window.toggleSelectAll = function(master){
        var check = !!master.checked;
        var cbs = document.querySelectorAll('#practice-records-tbody .record-select');
        Array.prototype.forEach.call(cbs, function(cb){
            cb.checked = check;
            var id = String(cb.getAttribute('data-id'));
            if (check) window.selectedRecordIds.add(id); else window.selectedRecordIds.delete(id);
        });
        window.syncSelectAllCheckboxState();
    };

    window.syncSelectAllCheckboxState = function(){
        var cbs = Array.prototype.slice.call(document.querySelectorAll('#practice-records-tbody .record-select'));
        var master = document.getElementById('select-all-records');
        if (!master) return;
        if (cbs.length === 0) { master.checked = false; master.indeterminate = false; return; }
        var checkedCount = cbs.filter(function(cb){ return cb.checked; }).length;
        master.checked = checkedCount === cbs.length;
        master.indeterminate = checkedCount > 0 && checkedCount < cbs.length;
    };

    window.batchDeleteSelected = async function(){
        var ids = Array.from(window.selectedRecordIds || []);
        if (ids.length === 0) { try { showMessage('请先选择要删除的记录', 'warning'); } catch(_) {} return; }
        if (!confirm('确定要删除选中的 ' + ids.length + ' 条记录吗？此操作不可撤销。')) return;
        try {
            var list = await storage.get('practice_records', []);
            var idSet = new Set(ids.map(String));
            list = list.filter(function(r){ return !idSet.has(String(r.id||r.timestamp)); });
            await storage.set('practice_records', list);
            if (window.practiceRecords) window.practiceRecords = list;
        } catch (e) { console.warn('[BatchDelete] 存储更新失败:', e); }
        window.selectedRecordIds.clear();
        try { updatePracticeView(); } catch(_) {}
        try { updateOverview(); } catch(_) {}
        try { showMessage('已删除选中记录', 'success'); } catch(_) {}
    };

    // 3) 增强导入：兼容 exam_system_practice_records 结构
    (function(){
        var originalImport = window.importData;
        window.importData = function(){
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = function(e){
                var file = e.target.files[0]; if (!file) return;
                var reader = new FileReader();
                reader.onload = function(ev){
                    try {
                        var data = JSON.parse(ev.target.result);
                        var importedExamCount = 0, importedRecordCount = 0;

                        function mapRecord(r){
                            var pct = null;
                            if (r.percentage != null) pct = r.percentage;
                            else if (r.realData && r.realData.percentage != null) pct = r.realData.percentage;
                            else if (r.accuracy != null) pct = Math.round(Number(r.accuracy)*100);
                            else if (r.realData && r.realData.accuracy != null) pct = Math.round(Number(r.realData.accuracy)*100);
                            else if (r.score != null && r.totalQuestions) pct = Math.round((Number(r.score)/Number(r.totalQuestions))*100);
                            var dur = r.duration || (r.realData && r.realData.duration) || (r.endTime && r.startTime ? Math.max(0, Math.floor((new Date(r.endTime)-new Date(r.startTime))/1000)) : 0);
                            var dateStr = r.date || (r.timestamp ? new Date(r.timestamp).toISOString() : (r.endTime || r.startTime || new Date().toISOString()));
                            var rd = r.realData || null;
                            if (!rd) {
                                rd = {
                                    score: r.score != null ? r.score : null,
                                    totalQuestions: r.totalQuestions || (r.scoreInfo && r.scoreInfo.total) || null,
                                    accuracy: (r.accuracy != null ? r.accuracy : (pct != null ? pct/100 : null)),
                                    percentage: pct != null ? pct : null,
                                    duration: dur,
                                    answers: r.answers || (r.scoreInfo && r.scoreInfo.details ? Object.fromEntries(Object.entries(r.scoreInfo.details).map(function(ent){ return [ent[0], (ent[1]&&ent[1].userAnswer)]; })) : {}),
                                    correctAnswers: (r.realData && r.realData.correctAnswers) || (r.scoreInfo && r.scoreInfo.details ? Object.fromEntries(Object.entries(r.scoreInfo.details).map(function(ent){ return [ent[0], (ent[1]&&ent[1].correctAnswer)]; })) : {}),
                                    interactions: r.interactions || [],
                                    isRealData: true,
                                    source: r.dataSource || 'imported'
                                };
                            }
                            return {
                                id: r.id || r.timestamp || Date.now(),
                                examId: r.examId || '',
                                title: r.title || r.examName || '未命名练习',
                                type: r.type || (typeof getExamTypeFromCategory === 'function' ? getExamTypeFromCategory(r.category) : 'reading'),
                                category: r.category || (typeof getExamCategoryFromType === 'function' ? getExamCategoryFromType(r.type) : 'P1'),
                                frequency: r.frequency || 'medium',
                                score: pct || 0,
                                duration: dur,
                                date: dateStr,
                                timestamp: r.timestamp || r.id || Date.now(),
                                realData: rd,
                                dataSource: r.dataSource || 'imported'
                            };
                        }

                        // exam index sources
                        if (data && data.data && data.data.exam_system_exam_index && Array.isArray(data.data.exam_system_exam_index.data)) {
                            try { await storage.set('exam_index', data.data.exam_system_exam_index.data); importedExamCount = data.data.exam_system_exam_index.data.length; } catch(_) {}
                        } else if (data && data.exam_system_exam_index && Array.isArray(data.exam_system_exam_index.data)) {
                            try { await storage.set('exam_index', data.exam_system_exam_index.data); importedExamCount = data.exam_system_exam_index.data.length; } catch(_) {}
                        } else if (Array.isArray(data.exam_index)) {
                            try { await storage.set('exam_index', data.exam_index); importedExamCount = data.exam_index.length; } catch(_) {}
                        }

                        // practice records sources
                        var importedRecords = null;
                        if (Array.isArray(data.practice_records)) {
                            importedRecords = data.practice_records.map(mapRecord);
                        } else if (data && data.data && Array.isArray(data.data.practice_records)) {
                            importedRecords = data.data.practice_records.map(mapRecord);
                        } else if (data && data.exam_system_practice_records && Array.isArray(data.exam_system_practice_records.data)) {
                            importedRecords = data.exam_system_practice_records.data.map(mapRecord);
                        } else if (Array.isArray(data.practiceRecords)) {
                            importedRecords = data.practiceRecords.map(mapRecord);
                        }

                        if (importedRecords) {
                            await storage.set('practice_records', importedRecords);
                            if (window.practiceRecords) window.practiceRecords = importedRecords;
                            importedRecordCount = importedRecords.length;
                        }

                        try { updateOverview(); } catch(_) {}
                        try { updateBrowseView(); } catch(_) {}
                        try { updatePracticeView(); } catch(_) {}
                        try { showMessage('成功导入 ' + importedExamCount + ' 道题目和 ' + importedRecordCount + ' 条练习记录', 'success'); } catch(_) {}
                    } catch (err) {
                        console.error('[Import] 失败:', err);
                        if (window.showMessage) window.showMessage('导入失败: ' + err.message, 'error');
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        };
    })();

    // 4) 主题切换弹窗
    window.showThemeSwitcher = function(){
        const html = `
        <div id="theme-switcher" class="modal-overlay show">
          <div class="modal-container">
            <div class="modal-header">
              <h3 class="modal-title">
                <i class="fas fa-palette" style="margin-right: var(--space-3);"></i>
                主题切换
              </h3>
            </div>
            <div class="modal-body">
              <div class="theme-description">
                <p><i class="fas fa-info-circle" style="color: var(--color-primary); margin-right: var(--space-2);"></i>
                选择您喜欢的主题风格，不同的主题提供不同的视觉体验和学习氛围。</p>
              </div>
              <div class="theme-card active">
                <div class="theme-info">
                  <div class="theme-details">
                    <h4><i class="fas fa-graduation-cap" style="margin-right: var(--space-2);"></i>Academic</h4>
                    <p>专业 · 高效 · 可靠<br>
                    <span style="color: var(--color-gray-500); font-size: var(--font-size-xs);">深蓝配色，适合专注学习和专业训练</span></p>
                  </div>
                  <div class="theme-actions">
                    <span class="current-badge">当前主题</span>
                  </div>
                </div>
              </div>
              <div class="theme-card">
                <div class="theme-info">
                  <div class="theme-details">
                    <h4><i class="fas fa-leaf" style="margin-right: var(--space-2); color: #a16207;"></i>Bloom</h4>
                    <p>秋日 · 暖阳 · 温馨<br>
                    <span style="color: var(--color-gray-500); font-size: var(--font-size-xs);">温暖配色，适合放松阅读</span></p>
                  </div>
                  <div class="theme-actions">
                    <button class="btn btn-primary" onclick="window.location.href='../../index.html'">
                      <i class="fas fa-exchange-alt" style="margin-right: var(--space-2);"></i>
                      切换主题
                    </button>
                  </div>
                </div>
              </div>
              <div class="theme-card">
                <div class="theme-info">
                  <div class="theme-details">
                    <h4><i class="fas fa-heart" style="margin-right: var(--space-2); color: #ec4899;"></i>Melody</h4>
                    <p>美乐蒂 · 可爱 · 温馨<br>
                    <span style="color: var(--color-gray-500); font-size: var(--font-size-xs);">粉色主题，温馨学习体验</span></p>
                  </div>
                  <div class="theme-actions">
                    <button class="btn btn-primary" onclick="window.location.href='../../.superdesign/design_iterations/my_melody_ielts_1.html'">
                      <i class="fas fa-exchange-alt" style="margin-right: var(--space-2);"></i>
                      切换主题
                    </button>
                  </div>
                </div>
              </div>
              <div class="theme-card">
                <div class="theme-info">
                  <div class="theme-details">
                    <h4>🧙 HarryPotter</h4>
                    <p>哈利波特<br>
                    <span style="color: var(--color-gray-500); font-size: var(--font-size-xs);">深紫配色 · 冒险</span></p>
                  </div>
                  <div class="theme-actions">
                    <button class="btn btn-primary" aria-label="哈利波特主题（冒险）" onclick="(function(){try{document.documentElement.setAttribute('data-theme','harry');localStorage.setItem('theme','harry');}catch(e){} window.location.href='HarryPoter.html';})()">
                      <i class="fas fa-exchange-alt" style="margin-right: var(--space-2);"></i>
                      切换主题
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-secondary" onclick="document.getElementById('theme-switcher').remove()">
                关闭
              </button>
            </div>
          </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    };

    // —— 批量删除（行点击选择）实现 ——
    // 关闭旧的复选框装饰逻辑
    window.decoratePracticeTableForSelection = function(){};

    // 切换批量删除模式
    window.bulkDeleteAction = async function(){
        if (!window.bulkDeleteMode) {
            setBulkDeleteMode(true);
            try { showMessage('点击记录行可选择；完成后再次点击完成选择', 'info'); } catch(_) {}
        } else {
            // 完成选择 -> 执行删除
            const ids = Array.from(selectedRecordIds || []);
            if (ids.length === 0) { setBulkDeleteMode(false); return; }
            try {
                let list = await storage.get('practice_records', []);
                const setIds = new Set(ids.map(String));
                list = list.filter(r => !setIds.has(String(r.id||r.timestamp)));
                await storage.set('practice_records', list);
                if (window.practiceRecords) window.practiceRecords = list;
            } catch(e) { console.warn('[BulkDelete] 更新存储失败:', e); }
            selectedRecordIds.clear();
            try { updatePracticeView(); } catch(_) {}
            try { updateOverview(); } catch(_) {}
            setBulkDeleteMode(false);
            try { showMessage('已删除所选记录', 'success'); } catch(_) {}
        }
    };

    function setBulkDeleteMode(on) {
        window.bulkDeleteMode = !!on;
        const pv = document.getElementById('practice-view');
        if (pv) pv.classList.toggle('bulk-mode', window.bulkDeleteMode);
        updateBulkDeleteButton();
    }

    function updateBulkDeleteButton() {
        const btn = document.getElementById('bulk-delete-btn');
        if (!btn) return;
        if (window.bulkDeleteMode) {
            btn.innerHTML = '<i class="fas fa-check"></i> 完成选择';
        } else {
            btn.innerHTML = '<i class="fas fa-trash"></i> 批量删除';
        }
    }

    // 行点击选择（仅在批量模式下有效），避开"查看"按钮
    (function setupRecordRowClick(){
        const tbody = document.getElementById('practice-records-tbody');
        if (!tbody) return;
        tbody.addEventListener('click', function(e){
            if (!window.bulkDeleteMode) return;
            const btn = e.target.closest && e.target.closest('button');
            if (btn) return; // 不干扰"查看"
            const row = e.target.closest && e.target.closest('tr');
            if (!row) return;
            let id = '';
            try {
                const actionBtn = row.querySelector('button[onclick^="viewRecordDetails("]');
                const oc = actionBtn && actionBtn.getAttribute('onclick');
                const m = oc && oc.match(/viewRecordDetails\(['\"](.+?)['\"]\)/);
                if (m) id = m[1];
            } catch(_) {}
            if (!id) return;
            const key = String(id);
            if (selectedRecordIds.has(key)) { selectedRecordIds.delete(key); row.classList.remove('selected'); }
            else { selectedRecordIds.add(key); row.classList.add('selected'); }
        });

        // 监听渲染变化，补上行类名并同步选中状态
        const mo = new MutationObserver(() => {
            const rows = Array.from(tbody.querySelectorAll('tr'));
            rows.forEach(row => {
                row.classList.add('record-row');
                // 同步选中样式
                try {
                    const actionBtn = row.querySelector('button[onclick^="viewRecordDetails("]');
                    const oc = actionBtn && actionBtn.getAttribute('onclick');
                    const m = oc && oc.match(/viewRecordDetails\(['\"](.+?)['\"]\)/);
                    const id = m ? String(m[1]) : '';
                    if (id && selectedRecordIds.has(id)) row.classList.add('selected'); else row.classList.remove('selected');
                } catch(_) {}
            });
        });
        mo.observe(tbody, { childList: true });
        // 首次同步
        setTimeout(() => mo.takeRecords() && null, 0);
    })();

    // 题库打开回退：将 startExam 委托到 openExam
    (function ensureStartExamDelegates(){
        try {
            if (!window.startExam || !window.startExam.__designPatched) {
                const original = window.startExam;
                window.startExam = function(examId){
                    if (typeof window.openExam === 'function') return window.openExam(examId);
                    if (typeof original === 'function') return original(examId);
                    try { showMessage('无法打开题目：未找到 openExam', 'error'); } catch(_) {}
                };
                window.startExam.__designPatched = true;
            }
        } catch(_) {}
    })();

    // 5) 默认进首页"学习总览"
    try { showView('overview'); } catch(_) {}

    // 6) 监听表格变化，首次装饰
    try {
        var tbody = document.getElementById('practice-records-tbody');
        if (tbody) {
            var observer = new MutationObserver(function(){ decoratePracticeTableForSelection(); });
            observer.observe(tbody, { childList: true });
            setTimeout(decoratePracticeTableForSelection, 0);
        }
    } catch (e) { console.warn('[SelectionDecor] 初始化失败:', e); }
})();