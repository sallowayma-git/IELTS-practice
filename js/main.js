// Main JavaScript logic for the application
// This file is the result of refactoring the inline script from improved-working-system.html

// --- Global State & Variables ---
let examIndex = [];
let currentCategory = 'all';
let currentExamType = 'all';
let filteredExams = [];
let practiceRecords = [];
let app = null;
let pdfHandler = null;
let browseStateManager = null;
let practiceListScroller = null;
const processedSessions = new Set();


// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // expose modal launcher globally for SettingsPanel button
    window.showLibraryLoaderModal = showLibraryLoaderModal;

    initializeApplication();
});

function initializeApplication() {
    showMessage('欢迎使用考试总览系统！', 'success');

    // Setup UI Listeners
    const folderPicker = document.getElementById('folder-picker');
    if (folderPicker) {
        folderPicker.addEventListener('change', handleFolderSelection);
    }
    
    // Initialize components
    if (window.PDFHandler) {
        pdfHandler = new PDFHandler();
        console.log('[System] PDF处理器已初始化');
    }
    if (window.BrowseStateManager) {
        browseStateManager = new BrowseStateManager();
        console.log('[System] 浏览状态管理器已初始化');
    }
    if (window.DataIntegrityManager) {
        window.dataIntegrityManager = new DataIntegrityManager();
        console.log('[System] 数据完整性管理器已初始化');
    } else {
        console.warn('[System] DataIntegrityManager类未加载');
    }

    // Load data and setup listeners
    loadLibrary();
    syncPracticeRecords(); // Load initial records and update UI
    setupMessageListener(); // Listen for updates from child windows
}


// --- Data Loading and Management ---

function syncPracticeRecords() {
    console.log('[System] Syncing practice records from storage...');
    // The ONLY source of truth is the 'practice_records' key in storage.
    const records = storage.get('practice_records', []);
    
    // Ensure the global variable is the single source of truth for the UI
    window.practiceRecords = records;
    practiceRecords = records; // also update the local-scoped variable

    console.log(`[System] ${records.length} practice records loaded into memory.`);
    updatePracticeView();
}

function setupMessageListener() {
    window.addEventListener('message', (event) => {
        // Basic security check
        if (event.origin !== window.location.origin) {
            return;
        }

        const data = event.data;
        if (data && data.type === 'practice_completed') {
            console.log('[System] Received practice completion message. Syncing records.');
            showMessage('练习已完成，正在更新记录...', 'success');
            // Use a timeout to ensure storage has been updated by the other window
            setTimeout(syncPracticeRecords, 500);
        }
    });
}

function loadLibrary() {
    const startTime = performance.now();
    const activeConfigKey = getActiveLibraryConfigurationKey();
    const cachedData = storage.get(activeConfigKey);

    if (cachedData) {
        console.log(`[System] 使用localStorage中key为'${activeConfigKey}'的题库数据`);
        examIndex = cachedData;
        finishLibraryLoading(startTime);
        return;
    }

    showMessage('正在加载题库索引...', 'info');

    try {
        let readingExams = [];
        if (window.completeExamIndex && Array.isArray(window.completeExamIndex)) {
            readingExams = window.completeExamIndex.map(exam => ({ ...exam, type: 'reading' }));
        }

        let listeningExams = [];
        if (window.listeningExamIndex && Array.isArray(window.listeningExamIndex)) {
            listeningExams = window.listeningExamIndex; // type is already in the data
        }

        if (readingExams.length === 0 && listeningExams.length === 0) {
            throw new Error('默认题库数据未正确加载');
        }

        examIndex = [...readingExams, ...listeningExams];
        storage.set('exam_index', examIndex);
        saveLibraryConfiguration('默认题库', 'exam_index', examIndex.length);
        setActiveLibraryConfiguration('exam_index');
        
        finishLibraryLoading(startTime);

    } catch (error) {
        handleError(error, '题库加载');
    }
}

function finishLibraryLoading(startTime) {
    const loadTime = performance.now() - startTime;
    showMessage(`题库加载完成！共 ${examIndex.length} 个题目 - ${Math.round(loadTime)}ms`, 'success');
    updateOverview();
    updateSystemInfo();
}

// --- UI Update Functions ---

function updateOverview() {
    const readingExams = examIndex.filter(e => e.type === 'reading');
    const listeningExams = examIndex.filter(e => e.type === 'listening');

    const readingStats = { 'P1': { total: 0 }, 'P2': { total: 0 }, 'P3': { total: 0 } };
    readingExams.forEach(exam => {
        if (readingStats[exam.category]) readingStats[exam.category].total++;
    });

    const listeningStats = { 'P3': { total: 0 }, 'P4': { total: 0 } };
    listeningExams.forEach(exam => {
        if (listeningStats[exam.category]) listeningStats[exam.category].total++;
    });

    const categoryContainer = document.getElementById('category-overview');
    let html = '<h3 style="grid-column: 1 / -1;">📖 阅读部分</h3>';
    html += Object.keys(readingStats).map(cat => `
        <div class="category-card">
            <div class="category-header">
                <div class="category-icon">📖</div>
                <div>
                    <div class="category-title">${cat} 阅读</div>
                    <div class="category-meta">${readingStats[cat].total} 篇文章</div>
                </div>
            </div>
            <div class="category-actions">
                <button class="btn" onclick="browseCategory('${cat}', 'reading')">📚 浏览题目</button>
                <button class="btn btn-secondary" onclick="startRandomPractice('${cat}', 'reading')">🎲 随机练习</button>
            </div>
        </div>
    `).join('');

    if (listeningExams.length > 0) {
        html += '<h3 style="margin-top: 40px; grid-column: 1 / -1;">🎧 听力部分</h3>';
        html += Object.keys(listeningStats).filter(cat => listeningStats[cat].total > 0).map(cat => `
            <div class="category-card">
                <div class="category-header">
                    <div class="category-icon">🎧</div>
                    <div>
                        <div class="category-title">${cat} 听力</div>
                        <div class="category-meta">${listeningStats[cat].total} 个练习</div>
                    </div>
                </div>
                <div class="category-actions">
                    <button class="btn" onclick="browseCategory('${cat}', 'listening')">📚 浏览题目</button>
                    <button class="btn btn-secondary" onclick="startRandomPractice('${cat}', 'listening')">🎲 随机练习</button>
                </div>
            </div>
        `).join('');
    }
    
    categoryContainer.innerHTML = html;
}

function getScoreColor(percentage) {
    if (percentage >= 90) return '#4ade80';
    if (percentage >= 75) return '#facc15';
    if (percentage >= 60) return '#fb923c';
    return '#f87171';
}

function formatDurationShort(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}分钟`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}小时${mm}分钟`;
}

function renderPracticeRecordItem(record) {
    const item = document.createElement('div');
    item.className = 'history-item';

    const durationStr = formatDurationShort(record.duration || 0);

    // 左侧：标题 + 次行（日期在左、用时在右，统一右对齐，确保垂直线对齐）
    // 右侧：仅保留分数百分比
    item.innerHTML = `
        <div style="flex:1; min-width:0;">
            <a href="#" class="practice-record-title" onclick="showRecordDetails('${record.id}'); return false;" style="display:inline-block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                <strong>${record.title}</strong>
            </a>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-top:4px; gap:10px;">
                <small style="opacity:0.8;">${new Date(record.date).toLocaleString()}</small>
                <small style="opacity:0.9; min-width:120px; text-align:right;">用时：${durationStr}</small>
            </div>
        </div>
        <div style="text-align: right; min-width:80px;">
            <div style="color: ${getScoreColor(record.percentage || 0)}; font-weight: bold; font-size: 1.2em;">
                ${record.percentage || 0}%
            </div>
        </div>
    `;
    return item;
}

function updatePracticeView() {
    const records = (window.practiceRecords || []).filter(r => r.dataSource === 'real' || r.dataSource === undefined);

    // --- 1. Calculate Statistics ---
    const totalPracticed = records.length;
    const totalScore = records.reduce((sum, r) => sum + (r.percentage || 0), 0);
    const avgScore = totalPracticed > 0 ? (totalScore / totalPracticed) : 0;
    const totalStudyTime = records.reduce((sum, r) => sum + (r.duration || 0), 0) / 60; // in minutes

    // Streak calculation
    const practiceDates = [...new Set(records.map(r => new Date(r.date).toDateString()))].sort((a, b) => new Date(b) - new Date(a));
    let streak = 0;
    if (practiceDates.length > 0) {
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        if (new Date(practiceDates[0]).toDateString() === today.toDateString() || new Date(practiceDates[0]).toDateString() === yesterday.toDateString()) {
            streak = 1;
            for (let i = 0; i < practiceDates.length - 1; i++) {
                const currentDay = new Date(practiceDates[i]);
                const nextDay = new Date(practiceDates[i+1]);
                const diffTime = currentDay - nextDay;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays === 1) {
                    streak++;
                } else {
                    break;
                }
            }
        }
    }

    // --- 2. Update Stat Cards ---
    document.getElementById('total-practiced').textContent = totalPracticed;
    document.getElementById('avg-score').textContent = `${avgScore.toFixed(1)}%`;
    document.getElementById('study-time').textContent = totalStudyTime.toFixed(0);
    document.getElementById('streak-days').textContent = streak;

    // --- 3. Filter and Render History List ---
    const historyContainer = document.getElementById('practice-history-list');
    let recordsToShow = records.sort((a,b) => new Date(b.date) - new Date(a.date));

    if (currentExamType !== 'all') {
        recordsToShow = recordsToShow.filter(record => {
            const exam = examIndex.find(e => e.id === record.examId || e.title === record.title);
            return exam && exam.type === currentExamType;
        });
    }

    // --- 4. Use Virtual Scroller ---
    if (practiceListScroller) {
        practiceListScroller.destroy();
        practiceListScroller = null;
    }

    if (recordsToShow.length === 0) {
        historyContainer.innerHTML = `<div style="text-align: center; padding: 40px; opacity: 0.7;"><div style="font-size: 3em; margin-bottom: 15px;">📋</div><p>暂无该类型练习记录</p></div>`;
        return;
    }
    
    if (window.VirtualScroller) {
        practiceListScroller = new VirtualScroller(historyContainer, recordsToShow, renderPracticeRecordItem, { itemHeight: 60, containerHeight: 650 });
    } else {
        // Fallback to simple rendering if VirtualScroller is not available
        historyContainer.innerHTML = recordsToShow.map(record => renderPracticeRecordItem(record).outerHTML).join('');
    }
}


// --- Event Handlers & Navigation ---

function showView(viewName, resetCategory = true) {
    document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
    document.getElementById(viewName + '-view').classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = Array.from(document.querySelectorAll('.nav-btn')).find(btn => btn.textContent.includes(getViewName(viewName)));
    if (activeBtn) activeBtn.classList.add('active');

    if (viewName === 'browse' && resetCategory) {
        currentCategory = 'all';
        currentExamType = 'all';
        document.getElementById('browse-title').textContent = '📚 题库浏览';
    }
    
    if (viewName === 'browse') loadExamList();
    if (viewName === 'practice') updatePracticeView();
}

function browseCategory(category, type = 'reading') {
    currentCategory = category;
    currentExamType = type;
    const typeText = type === 'listening' ? '听力' : '阅读';
    document.getElementById('browse-title').textContent = `📚 ${category} ${typeText}题库浏览`;
    showView('browse', false);
}

function filterByType(type) {
    currentExamType = type;
    currentCategory = 'all'; 
    document.getElementById('browse-title').textContent = '📚 题库浏览';
    loadExamList();
}

function filterRecordsByType(type) {
    currentExamType = type;
    updatePracticeView();
}

function loadExamList() {
    const container = document.getElementById('exam-list-container');
    let examsToShow = examIndex;

    if (currentExamType !== 'all') {
        examsToShow = examsToShow.filter(exam => exam.type === currentExamType);
    }
    if (currentCategory !== 'all') {
        examsToShow = examsToShow.filter(exam => exam.category === currentCategory);
    }
    
    displayExams(examsToShow);
}

function displayExams(exams) {
    const container = document.getElementById('exam-list-container');
    const loadingIndicator = document.querySelector('#browse-view .loading');

    if (exams.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 40px;"><p>未找到匹配的题目</p></div>`;
    } else {
        container.innerHTML = `<div class="exam-list">${exams.map(renderExamItem).join('')}</div>`;
    }

    if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
    }
}

function getExamCompletionStatus(exam) {
    // Determine if the exam has been completed and its last accuracy
    const records = (window.practiceRecords || []).filter(r => (r.examId === exam.id || r.title === exam.title));
    if (records.length === 0) return null;
    const latest = records.sort((a,b) => new Date(b.date) - new Date(a.date))[0];
    return {
        percentage: latest.percentage || 0,
        date: latest.date
    };
}

function renderExamItem(exam) {
    const status = getExamCompletionStatus(exam);
    const dot = status ? `<span class="completion-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${getScoreColor(status.percentage)};margin-right:8px;vertical-align:middle;"></span>` : '';
    return `
        <style>
            .completion-dot { box-shadow: 0 0 0 2px rgba(0,0,0,0.1); }
        </style>
        <div class="exam-item" data-exam-id="${exam.id}">
            <div class="exam-info">
                <div>
                    <h4>${dot}${exam.title}</h4>
                    <div class="exam-meta">${exam.category} • ${exam.type}</div>
                </div>
            </div>
            <div class="exam-actions">
                <button class="btn" onclick="openExam('${exam.id}')">开始练习</button>
                <button class="btn btn-secondary" onclick="viewPDF('${exam.id}')">查看PDF</button>
            </div>
        </div>
    `;
}

function resolveExamBasePath(exam) {
    let basePath = exam.path || '';
    // Normalize listening paths: legacy folder name to actual folder name
    if (exam.type === 'listening') {
        basePath = basePath.replace('睡着过听力项目-已完成小样', 'ListeningPractice');
        if (!/^ListeningPractice\//.test(basePath)) {
            // If a listening path somehow lacks base, try prefixing
            if (!basePath.startsWith('./')) basePath = 'ListeningPractice/' + basePath.replace(/^\/?/, '');
        }
    }
    // Normalize reading paths: ensure they are under the "所有文章" collection
    if (exam.type === 'reading') {
        const hasFullPrefix = /睡着过项目组\(9\.4\)\[134篇\]\//.test(basePath);
        if (!hasFullPrefix) {
            basePath = '睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/' + basePath.replace(/^\/?/, '');
        }
    }
    // Ensure trailing slash
    if (!basePath.endsWith('/')) basePath += '/';
    // Collapse duplicate slashes and backslashes
    basePath = basePath.replace(/\\+/g, '/').replace(/\/+/g, '/');
    return basePath;
}

function buildResourcePath(exam, kind = 'html') {
    const basePath = resolveExamBasePath(exam);
    const file = kind === 'pdf' ? exam.pdfFilename : exam.filename;
    const rawPath = basePath + file;
    // Use encodeURI but avoid double-encoding slashes
    const fullPath = './' + encodeURI(rawPath).replace(/%252F/g, '/');
    return fullPath;
}
// expose helpers globally for other modules (e.g., app.js)
window.resolveExamBasePath = resolveExamBasePath;
window.buildResourcePath = buildResourcePath;

function openExam(examId) {
    const exam = examIndex.find(e => e.id === examId);
    if (!exam) return showMessage('题目不存在', 'error');
    if (!exam.hasHtml) return viewPDF(examId);

    const fullPath = buildResourcePath(exam, 'html');
    const examWindow = window.open(fullPath, `exam_${exam.id}`, 'width=1200,height=800,scrollbars=yes,resizable=yes');
    if (examWindow) {
        showMessage(`正在打开: ${exam.title}`, 'success');
        // Communication setup will be handled by the script in the child window
    } else {
        showMessage('无法打开新窗口，请检查浏览器弹窗设置', 'error');
    }
}

function viewPDF(examId) {
    const exam = examIndex.find(e => e.id === examId);
    if (!exam || !exam.pdfFilename) return showMessage('PDF文件不存在', 'error');
    
    const fullPath = buildResourcePath(exam, 'pdf');
    openPDFSafely(fullPath, exam.title);
}

// Bridge for record details to existing enhancer/modal if present
function showRecordDetails(recordId) {
    if (window.practiceHistoryEnhancer && typeof window.practiceHistoryEnhancer.showRecordDetails === 'function') {
        window.practiceHistoryEnhancer.showRecordDetails(recordId);
    } else if (window.practiceRecordModal && typeof window.practiceRecordModal.showById === 'function') {
        window.practiceRecordModal.showById(recordId);
    } else {
        alert('无法显示记录详情：组件未加载');
    }
}

// Provide a local implementation to avoid dependency on legacy js/script.js
function openPDFSafely(pdfPath, examTitle = 'PDF') {
    try {
        if (pdfHandler && typeof pdfHandler.openPDF === 'function') {
            return pdfHandler.openPDF(pdfPath, examTitle, { width: 1000, height: 800 });
        }
        const pdfWindow = window.open(pdfPath, `pdf_${Date.now()}`, 'width=1000,height=800,scrollbars=yes,resizable=yes,status=yes,toolbar=yes');
        if (!pdfWindow) {
            showMessage('无法打开PDF窗口，请检查浏览器弹窗设置', 'error');
            return null;
        }
        showMessage(`正在打开PDF: ${examTitle}`, 'info');
        return pdfWindow;
    } catch (error) {
        console.error('[PDF] 打开PDF失败:', error);
        showMessage('打开PDF失败', 'error');
        return null;
    }
}

// --- Helper Functions ---
function getViewName(viewName) {
    switch (viewName) {
        case 'overview': return '总览';
        case 'browse': return '题库浏览';
        case 'practice': return '练习记录';
        case 'settings': return '设置';
        default: return '';
    }
}

function updateSystemInfo() {
    if (!examIndex) return;
    const readingExams = examIndex.filter(e => e.type === 'reading');
    const listeningExams = examIndex.filter(e => e.type === 'listening');
    
    document.getElementById('total-exams').textContent = `${examIndex.length} 个`;
    // These IDs might not exist anymore, but we'll add them for robustness
    const htmlExamsEl = document.getElementById('html-exams');
    const pdfExamsEl = document.getElementById('pdf-exams');
    const lastUpdateEl = document.getElementById('last-update');

    if (htmlExamsEl) htmlExamsEl.textContent = `${readingExams.length + listeningExams.length} 个`; // Simplified
    if (pdfExamsEl) pdfExamsEl.textContent = `${examIndex.filter(e => e.pdfFilename).length} 个`;
    if (lastUpdateEl) lastUpdateEl.textContent = new Date().toLocaleString();
}

function showMessage(message, type = 'info', duration = 4000) {
    const container = document.getElementById('message-container');
    if (!container) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerHTML = `<strong>${type === 'error' ? '❌' : '✅'}</strong> ${message}`;
    container.appendChild(messageDiv);
    setTimeout(() => {
        messageDiv.style.opacity = '0';
        setTimeout(() => messageDiv.remove(), 300);
    }, duration);
}

// Other functions from the original file (simplified or kept as is)
function getActiveLibraryConfigurationKey() { 
    return storage.get('active_exam_index_key', 'exam_index'); 
}
function getLibraryConfigurations() {
    return storage.get('exam_index_configurations', []);
}
function saveLibraryConfiguration(name, key, examCount) { 
    // Persist a record of available exam index configurations
    try {
        const configs = storage.get('exam_index_configurations', []);
        const newEntry = { name, key, examCount, timestamp: Date.now() };
        const idx = configs.findIndex(c => c.key === key);
        if (idx >= 0) {
            configs[idx] = newEntry;
        } else {
            configs.push(newEntry);
        }
        storage.set('exam_index_configurations', configs);
    } catch (e) {
        console.error('[LibraryConfig] 保存题库配置失败:', e);
    }
}
function setActiveLibraryConfiguration(key) { 
    try {
        storage.set('active_exam_index_key', key);
    } catch (e) {
        console.error('[LibraryConfig] 设置活动题库配置失败:', e);
    }
}
function triggerFolderPicker() { document.getElementById('folder-picker').click(); }
function handleFolderSelection(event) { /* legacy stub - replaced by modal-specific inputs */ }

// --- Library Loader Modal and Index Management ---
function showLibraryLoaderModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '900px';
    modal.innerHTML = `
        <div class="modal-header">
            <h2>加载题库</h2>
            <button class="modal-close" aria-label="关闭">×</button>
        </div>
        <div class="modal-body">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <div style="border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 16px;">
                    <h3>📖 阅读题库加载</h3>
                    <p style="opacity:0.8;">支持全量重载和增量更新。请上传包含题目HTML/PDF的根文件夹。</p>
                    <div style="display:flex; gap:10px; flex-wrap: wrap;">
                        <button class="btn" id="reading-full-btn">全量重载</button>
                        <button class="btn btn-secondary" id="reading-inc-btn">增量更新</button>
                    </div>
                    <input type="file" id="reading-full-input" webkitdirectory multiple style="display:none;" />
                    <input type="file" id="reading-inc-input" webkitdirectory multiple style="display:none;" />
                    <div style="margin-top:10px; font-size: 0.9em; opacity:0.8;">
                        建议路径：睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/...
                    </div>
                </div>
                <div style="border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 16px;">
                    <h3>🎧 听力题库加载</h3>
                    <p style="opacity:0.8;">支持全量重载和增量更新。请上传包含题目HTML/PDF/音频的根文件夹。</p>
                    <div style="display:flex; gap:10px; flex-wrap: wrap;">
                        <button class="btn" id="listening-full-btn">全量重载</button>
                        <button class="btn btn-secondary" id="listening-inc-btn">增量更新</button>
                    </div>
                    <input type="file" id="listening-full-input" webkitdirectory multiple style="display:none;" />
                    <input type="file" id="listening-inc-input" webkitdirectory multiple style="display:none;" />
                    <div style="margin-top:10px; font-size: 0.9em; opacity:0.8;">
                        建议路径：ListeningPractice/P3 或 ListeningPractice/P4
                    </div>
                </div>
            </div>
            <div style="margin-top:16px; padding: 12px; background: rgba(255,255,255,0.06); border-radius: 8px;">
                <div style="font-weight:600;">说明</div>
                <ul style="margin:8px 0 0 18px; line-height:1.6;">
                    <li>全量重载会替换当前配置中对应类型（阅读/听力）的全部索引，并保留另一类型原有数据。</li>
                    <li>增量更新会将新文件夹生成的索引追加到当前配置；若当前为默认配置，将自动复制为新配置后再追加，确保默认配置不受影响。</li>
                </ul>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" id="close-loader">关闭</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); };
    modal.querySelector('.modal-close').addEventListener('click', close);
    modal.querySelector('#close-loader').addEventListener('click', close);

    const wire = (btnId, inputId, type, mode) => {
        const btn = modal.querySelector(btnId);
        const input = modal.querySelector(inputId);
        btn.addEventListener('click', () => input.click());
        input.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length === 0) return;
            await handleLibraryUpload({ type, mode }, files);
            close();
        });
    };

    wire('#reading-full-btn', '#reading-full-input', 'reading', 'full');
    wire('#reading-inc-btn', '#reading-inc-input', 'reading', 'incremental');
    wire('#listening-full-btn', '#listening-full-input', 'listening', 'full');
    wire('#listening-inc-btn', '#listening-inc-input', 'listening', 'incremental');
}

async function handleLibraryUpload(options, files) {
    const { type, mode } = options;
    try {
        let label = '';
        if (mode === 'incremental') {
            label = prompt('为本次增量更新输入一个文件夹标识名称（便于识别）：', '增量集-' + new Date().toISOString().slice(0,10)) || '';
            if (label) {
                showMessage(`将以“${label}”标记此次增量更新`, 'info');
            }
            if (!detectFolderPlacement(files, type)) {
                const proceed = confirm(`检测到上传的文件夹未处于推荐目录结构下。\n阅读：睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/...\n听力：ListeningPractice/P3 或 P4\n仍要继续吗？`);
                if (!proceed) return;
            }
        }

        showMessage('正在解析文件并生成静态索引...', 'info');
        const additions = await buildIndexFromFiles(files, type, label);
        if (additions.length === 0) {
            showMessage('未从所选文件中识别到题目', 'warning');
            return;
        }

        const activeKey = getActiveLibraryConfigurationKey();
        const currentIndex = storage.get(activeKey, examIndex) || [];

        let newIndex;
        if (mode === 'full') {
            // Replace the part of this type and keep the other type
            const others = currentIndex.filter(e => e.type !== type);
            newIndex = [...others, ...additions];
        } else {
            // incremental: append unique by path/title
            const existingKeys = new Set(currentIndex.map(e => (e.path || '') + '|' + (e.filename || '') + '|' + e.title));
            const dedupAdd = additions.filter(e => !existingKeys.has((e.path || '') + '|' + (e.filename || '') + '|' + e.title));
            newIndex = [...currentIndex, ...dedupAdd];
        }

        // 对于全量重载，创建一个新的题库配置并自动切换
        if (mode === 'full') {
            const targetKey = `exam_index_${Date.now()}`;
            const configName = `${type === 'reading' ? '阅读' : '听力'}全量-${new Date().toLocaleString()}`;
            // 确保另一类型存在，如不存在则补齐默认嵌入数据
            const otherType = type === 'reading' ? 'listening' : 'reading';
            const hasOther = newIndex.some(e => e.type === otherType);
            if (!hasOther) {
                let fallback = [];
                if (otherType === 'reading' && window.completeExamIndex) fallback = window.completeExamIndex.map(e => ({...e, type:'reading'}));
                if (otherType === 'listening' && window.listeningExamIndex) fallback = window.listeningExamIndex;
                newIndex = [...newIndex, ...fallback];
            }
            storage.set(targetKey, newIndex);
            saveLibraryConfiguration(configName, targetKey, newIndex.length);
            setActiveLibraryConfiguration(targetKey);
            showMessage('新题库配置已生成并切换，页面将刷新...', 'success');
            setTimeout(() => location.reload(), 800);
            return;
        }

        const isDefault = activeKey === 'exam_index';
        let targetKey = activeKey;
        let configName = '';
        if (mode === 'incremental' && isDefault) {
            // Create a new configuration so as not to affect default
            targetKey = `exam_index_${Date.now()}`;
            configName = `${type === 'reading' ? '阅读' : '听力'}增量-${new Date().toLocaleString()}`;
            storage.set(targetKey, newIndex);
            saveLibraryConfiguration(configName, targetKey, newIndex.length);
            setActiveLibraryConfiguration(targetKey);
            showMessage('已创建新题库配置并切换，页面将刷新...', 'success');
            setTimeout(() => location.reload(), 800);
            return;
        }

        // Save to the current active key（非默认配置下的增量更新）
        storage.set(targetKey, newIndex);
        saveLibraryConfiguration(`${type === 'reading' ? '阅读' : '听力'}增量-${new Date().toLocaleString()}`, targetKey, newIndex.length);
        showMessage('索引更新成功，正在刷新界面...', 'success');
        examIndex = newIndex;
        updateOverview();
        if (document.getElementById('browse-view')?.classList.contains('active')) {
            loadExamList();
        }
    } catch (error) {
        console.error('[LibraryLoader] 处理题库上传失败:', error);
        showMessage('题库处理失败: ' + error.message, 'error');
    }
}

function detectFolderPlacement(files, type) {
    const paths = files.map(f => f.webkitRelativePath || f.name);
    if (type === 'reading') {
        return paths.some(p => /睡着过项目组\(9\.4\)\[134篇\]\/3\. 所有文章\(9\.4\)\[134篇\]\//.test(p));
    } else {
        return paths.some(p => /^ListeningPractice\/(P3|P4)\//.test(p));
    }
}

async function buildIndexFromFiles(files, type, label = '') {
    // Group by folder
    const byDir = new Map();
    for (const f of files) {
        const rel = f.webkitRelativePath || f.name;
        const parts = rel.split('/');
        if (parts.length < 2) continue; // skip root files
        const dir = parts.slice(0, parts.length - 1).join('/');
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir).push(f);
    }

    const entries = [];
    let idx = 0;
    for (const [dir, fs] of byDir.entries()) {
        // Identify HTML/PDF files
        const html = fs.find(x => x.name.toLowerCase().endsWith('.html'));
        const pdf = fs.find(x => x.name.toLowerCase().endsWith('.pdf'));
        if (!html && !pdf) continue;
        // Deduce title and category
        const dirName = dir.split('/').pop();
        const title = dirName.replace(/^\d+\.\s*/, '');
        let category = 'P1';
        const pathStr = dir;
        const m = pathStr.match(/\b(P1|P2|P3|P4)\b/);
        if (m) category = m[1];
        // Build base path and filenames to align with existing buildResourcePath
        let basePath = dir + '/';
        // Normalize listening base to ListeningPractice root in runtime
        if (type === 'listening') {
            basePath = basePath.replace(/^.*?(ListeningPractice\/)/, '$1');
        } else {
            // For reading, ensure it is under the mega folder prefix at runtime by resolveExamBasePath
        }
        const id = `custom_${type}_${Date.now()}_${idx++}`;
        entries.push({
            id,
            title: label ? `[${label}] ${title}` : title,
            category,
            type,
            path: basePath,
            filename: html ? html.name : undefined,
            pdfFilename: pdf ? pdf.name : undefined,
            hasHtml: !!html
        });
    }
    return entries;
}

// ... other utility and management functions can be moved here ...
// --- Functions Restored from Backup ---

function searchExams(query) {
    if (window.performanceOptimizer) {
        const debouncedSearch = window.performanceOptimizer.debounce(performSearch, 300, 'exam_search');
        debouncedSearch(query);
    } else {
        performSearch(query);
    }
}

function performSearch(query) {
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) {
        displayExams(filteredExams);
        return;
    }
    const searchResults = filteredExams.filter(exam => 
        (exam.searchText && exam.searchText.includes(normalizedQuery)) ||
        (!exam.searchText && (exam.title.toLowerCase().includes(normalizedQuery) || exam.category.toLowerCase().includes(normalizedQuery)))
    );
    displayExams(searchResults);
}

function exportPracticeData() {
    if (window.practiceHistoryEnhancer) {
        window.practiceHistoryEnhancer.showExportDialog();
    } else {
        showMessage('导出功能尚未初始化', 'warning');
    }
}

function toggleBulkDelete() {
    // This function's logic was in the original file but seems to be missing from components.
    // Placeholder implementation:
    showMessage('批量删除功能暂不可用', 'warning');
}

function clearPracticeData() {
    if (confirm('确定要清除所有练习记录吗？此操作不可恢复。')) {
        practiceRecords = [];
        storage.set('practice_records', []); // Use storage helper
        processedSessions.clear();
        updatePracticeView();
        showMessage('练习记录已清除', 'success');
    }
}

function clearCache() {
    if (confirm('确定要清除所有缓存数据吗？')) {
        localStorage.clear();
        sessionStorage.clear();
        if (window.performanceOptimizer) {
            // This assumes performanceOptimizer has a cleanup method
            // window.performanceOptimizer.cleanup(); 
        }
        showMessage('缓存已清除', 'success');
        setTimeout(() => location.reload(), 1000);
    }
}

function showLibraryConfigList() {
    const configs = getLibraryConfigurations();

    if (configs.length === 0) {
        showMessage('暂无题库配置记录', 'info');
        return;
    }

    let configHtml = `
                <div style="background: rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <h3>📚 题库配置列表</h3>
                    <div style="max-height: 300px; overflow-y: auto; margin: 15px 0;">
            `;

    configs.forEach(config => {
        const date = new Date(config.timestamp).toLocaleString();
        const isActive = getActiveLibraryConfigurationKey() === config.key;
        const activeIndicator = isActive ? '✅ (当前)' : '';

        configHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <div>
                            <strong>${config.name}</strong> ${activeIndicator}<br>
                            <small>${date} • ${config.examCount} 个题目</small>
                        </div>
                        <div>
                            <button class="btn btn-secondary" onclick="switchLibraryConfig('${config.key}')" style="margin-left: 10px;" ${isActive ? 'disabled' : ''}>切换</button>
                            <button class="btn btn-warning" onclick="deleteLibraryConfig('${config.key}')" style="margin-left: 10px;" ${isActive ? 'disabled' : ''}>删除</button>
                        </div>
                    </div>
                `;
    });

    configHtml += `
                    </div>
                    <button class="btn btn-secondary" onclick="this.parentElement.remove()">关闭</button>
                </div>
            `;

    // 显示配置列表
    const container = document.getElementById('settings-view');
    const existingList = container.querySelector('.library-config-list');
    if (existingList) {
        existingList.remove();
    }

    const listDiv = document.createElement('div');
    listDiv.className = 'library-config-list';
    listDiv.innerHTML = configHtml;
    container.appendChild(listDiv);
}

// 切换题库配置
function switchLibraryConfig(configKey) {
    if (confirm("确定要切换到此题库配置吗？")) {
        setActiveLibraryConfiguration(configKey);
        showMessage('正在切换题库配置，页面将刷新...', 'info');
        setTimeout(() => {
            location.reload();
        }, 1000);
    }
}

// 删除题库配置
function deleteLibraryConfig(configKey) {
    if (confirm("确定要删除此题库配置吗？此操作不可恢复。")) {
        let configs = getLibraryConfigurations();
        configs = configs.filter(config => config.key !== configKey);
        storage.set('exam_index_configurations', configs);
        storage.remove(configKey); // 移除实际的题库数据

        showMessage('题库配置已删除', 'success');
        showLibraryConfigList(); // 刷新列表
    }
}

function createManualBackup() {
    if (!window.dataIntegrityManager) {
        showMessage('数据管理模块未初始化', 'error');
        return;
    }
    (async () => {
        try {
            const backup = await window.dataIntegrityManager.createBackup(null, 'manual');
            if (backup && backup.external) {
                showMessage('本地存储空间不足，已将备份下载为文件', 'warning');
            } else {
                showMessage(`备份创建成功: ${backup.id}`, 'success');
            }
            // 刷新备份列表（如果用户打开了设置页）
            try { showBackupList(); } catch (_) {}
        } catch (error) {
            if (isQuotaExceeded(error)) {
                try {
                    // 直接导出所有数据作为最终保底
                    window.dataIntegrityManager.exportData();
                    showMessage('本地空间不足：已导出数据为文件', 'warning');
                } catch (e2) {
                    showMessage('备份失败且导出失败: ' + (e2 && e2.message ? e2.message : e2), 'error');
                }
            } else {
                showMessage('备份创建失败: ' + (error && error.message ? error.message : error), 'error');
            }
        }
    })();
}

function isQuotaExceeded(error) {
    return !!(error && (
        error.name === 'QuotaExceededError' ||
        (typeof error.message === 'string' && error.message.includes('exceeded the quota')) ||
        error.code === 22 || error.code === 1014
    ));
}

function showBackupList() {
    if (!window.dataIntegrityManager) {
        showMessage('数据完整性管理器未初始化', 'error');
        return;
    }

    const backups = window.dataIntegrityManager.getBackupList();

    if (backups.length === 0) {
        showMessage('暂无备份记录', 'info');
        return;
    }

    let backupHtml = `
                <div style="background: rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <h3>📋 备份列表</h3>
                    <div style="max-height: 300px; overflow-y: auto; margin: 15px 0;">
            `;

    backups.forEach(backup => {
        const date = new Date(backup.timestamp).toLocaleString();
        const sizeKB = Math.round(backup.size / 1024);
        const typeIcon = backup.type === 'auto' ? '🔄' : backup.type === 'manual' ? '👤' : '⚠️';

        backupHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <div>
                            <strong>${typeIcon} ${backup.id}</strong><br>
                            <small>${date} • ${sizeKB} KB • v${backup.version}</small>
                        </div>
                        <button class="btn btn-secondary" onclick="restoreBackup('${backup.id}')" style="margin-left: 10px;">恢复</button>
                    </div>
                `;
    });

    backupHtml += `
                    </div>
                    <button class="btn btn-secondary" onclick="this.parentElement.remove()">关闭</button>
                </div>
            `;

    // 显示备份列表
    const container = document.getElementById('settings-view');
    const existingList = container.querySelector('.backup-list');
    if (existingList) {
        existingList.remove();
    }

    const listDiv = document.createElement('div');
    listDiv.className = 'backup-list';
    listDiv.innerHTML = backupHtml;
    container.appendChild(listDiv);
}

// 恢复备份
async function restoreBackup(backupId) {
    if (!window.dataIntegrityManager) {
        showMessage('数据完整性管理器未初始化', 'error');
        return;
    }

    if (!confirm(`确定要恢复备份 ${backupId} 吗？当前数据将被覆盖。`)) {
        return;
    }

    try {
        showMessage('正在恢复备份...', 'info');
        await window.dataIntegrityManager.restoreBackup(backupId);
        showMessage('备份恢复成功', 'success');
        // The page will now sync automatically without a reload.
    } catch (error) {
        console.error('[DataManagement] 恢复备份失败:', error);
        showMessage('备份恢复失败: ' + error.message, 'error');
    }
}

function exportAllData() {
    if (window.dataIntegrityManager) {
        window.dataIntegrityManager.exportData();
        showMessage('数据导出成功', 'success');
    } else {
        showMessage('数据管理模块未初始化', 'error');
    }
}

function importData() {
    if (window.dataIntegrityManager) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (event) => {
            const file = event.target.files[0];
            if (!file) return;
            if (confirm('导入数据将覆盖当前数据，确定继续吗？')) {
                try {
                    const result = await window.dataIntegrityManager.importData(file);
                    showMessage(`数据导入成功: ${result.importedCount} 个项目`, 'success');
                    // The page will now sync automatically without a reload.
                } catch (error) {
                    showMessage('数据导入失败: ' + error.message, 'error');
                }
            }
        };
        input.click();
    } else {
        showMessage('数据管理模块未初始化', 'error');
    }
}

function showDeveloperTeam() {
    const modal = document.getElementById('developer-modal');
    if (modal) modal.classList.add('show');
}

function hideDeveloperTeam() {
    const modal = document.getElementById('developer-modal');
    if (modal) modal.classList.remove('show');
}

function startRandomPractice(category, type = 'reading') {
    const categoryExams = examIndex.filter(exam => exam.category === category && exam.type === type);
    if (categoryExams.length === 0) {
        showMessage(`${category} 分类暂无可用题目`, 'error');
        return;
    }
    const randomExam = categoryExams[Math.floor(Math.random() * categoryExams.length)];
    showMessage(`随机选择: ${randomExam.title}`, 'info');
    setTimeout(() => openExam(randomExam.id), 1000);
}