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
let bulkDeleteMode = false;
let selectedRecords = new Set();


// --- Initialization ---
function initializeLegacyComponents() {
    try { showMessage('系统准备就绪', 'success'); } catch(_) {}

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
    console.log('[System] 正在从存储中同步练习记录...');
    // The ONLY source of truth is the 'practice_records' key in storage.
    const records = storage.get('practice_records', []);
    
    // Ensure the global variable is the single source of truth for the UI
    window.practiceRecords = records;
    practiceRecords = records; // also update the local-scoped variable

    console.log(`[System] ${records.length} 条练习记录已加载到内存。`);
    updatePracticeView();
}

function setupMessageListener() {
    window.addEventListener('message', (event) => {
        // 更兼容的安全检查：允许同源或file协议下的子窗口
        try {
            if (event.origin && event.origin !== 'null' && event.origin !== window.location.origin) {
                return;
            }
        } catch (_) {}

        const data = event.data || {};
        const type = data.type;
        if (type === 'PRACTICE_COMPLETE' || type === 'practice_completed') {
            console.log('[System] 收到练习完成消息，正在同步记录...');
            showMessage('练习已完成，正在更新记录...', 'success');
            setTimeout(syncPracticeRecords, 300);
        }
    });
}

function loadLibrary(forceReload = false) {
    const startTime = performance.now();
    const activeConfigKey = getActiveLibraryConfigurationKey();
    let cachedData = storage.get(activeConfigKey);

    if (!forceReload && cachedData) {
        console.log(`[System] 使用localStorage中的缓存，key为 '${activeConfigKey}'`);
        examIndex = cachedData;
        // 确保默认题库配置的记录存在
        try {
            const configs = storage.get('exam_index_configurations', []);
            const exists = configs.some(c => c.key === 'exam_index');
            if (!exists) {
                configs.push({ name: '默认题库', key: 'exam_index', examCount: examIndex.length || 0, timestamp: Date.now() });
                storage.set('exam_index_configurations', configs);
            }
            const activeKey = storage.get('active_exam_index_key');
            if (!activeKey) storage.set('active_exam_index_key', 'exam_index');
        } catch (e) { console.warn('[LibraryConfig] 确保默认配置存在失败:', e); }
        finishLibraryLoading(startTime);
        return;
    }

    console.log(`[System] ${forceReload ? '强制' : '正常'}加载题库索引...`);
    showMessage('正在加载题库索引...', 'info');

    try {
        let readingExams = [];
        if (window.completeExamIndex && Array.isArray(window.completeExamIndex)) {
            readingExams = window.completeExamIndex.map(exam => ({ ...exam, type: 'reading' }));
            console.log(`[Library] 加载阅读题库: ${readingExams.length} 项`);
        }

        let listeningExams = [];
        if (window.listeningExamIndex && Array.isArray(window.listeningExamIndex)) {
            listeningExams = window.listeningExamIndex; // type is already in the data
            console.log(`[Library] 加载听力题库: ${listeningExams.length} 项 (P3: ${listeningExams.filter(e => e.category === 'P3').length}, P4: ${listeningExams.filter(e => e.category === 'P4').length})`);
        }

        if (readingExams.length === 0 && listeningExams.length === 0) {
            console.warn('[Library] 未检测到内置题库数据，将使用空索引继续');
        }

        examIndex = [...readingExams, ...listeningExams];
        storage.set(activeConfigKey, examIndex); // 始终保存到缓存
        saveLibraryConfiguration('默认题库', activeConfigKey, examIndex.length);
        setActiveLibraryConfiguration(activeConfigKey);
        
        finishLibraryLoading(startTime);

    } catch (error) {
        console.error('[Library] 加载题库失败:', error);
        examIndex = [];
        finishLibraryLoading(startTime);
    }
}
function finishLibraryLoading(startTime) {
    const loadTime = performance.now() - startTime;
    showMessage(`题库加载完成！共 ${examIndex.length} 个题目 - ${Math.round(loadTime)}ms`, 'success');
    updateOverview();
    updateSystemInfo();
    window.dispatchEvent(new CustomEvent('examIndexLoaded'));
}

// --- UI Update Functions ---

function updateOverview() {
    const readingExams = examIndex.filter(e => e.type === 'reading');
    const listeningExams = examIndex.filter(e => e.type === 'listening');

    const readingStats = { P1: { total: 0 }, P2: { total: 0 }, P3: { total: 0 } };
    readingExams.forEach(exam => { if (readingStats[exam.category]) readingStats[exam.category].total++; });

    const listeningStats = { P3: { total: 0 }, P4: { total: 0 } };
    listeningExams.forEach(exam => {
        if (exam.category && listeningStats[exam.category]) {
            listeningStats[exam.category].total++;
        } else {
            console.warn('[Overview] 未知听力类别:', exam.category, exam);
        }
    });

    const categoryContainer = document.getElementById('category-overview');
    let html = '<h3 style="grid-column: 1 / -1;">阅读</h3>';
    ['P1','P2','P3'].forEach(cat => {
        html += ''
        + '<div class="category-card">'
        +   '<div class="category-header">'
        +     '<div class="category-icon">📖</div>'
        +     '<div>'
        +       '<div class="category-title">' + cat + ' 阅读</div>'
        +       '<div class="category-meta">' + (readingStats[cat] ? readingStats[cat].total : 0) + ' 篇</div>'
        +     '</div>'
        +   '</div>'
        +   '<div class="category-actions" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: nowrap;">'
        +     '<button class="btn" onclick="browseCategory(\'' + cat + '\', \'reading\')">📚 浏览题库</button>'
        +     '<button class="btn btn-secondary" onclick="startRandomPractice(\'' + cat + '\', \'reading\')">🎲 随机练习</button>'
        +   '</div>'
        + '</div>';
    });

    if (listeningExams.length > 0) {
        html += '<h3 style="margin-top: 40px; grid-column: 1 / -1;">听力</h3>';
        ['P3','P4'].forEach(cat => {
            const count = listeningStats[cat] ? listeningStats[cat].total : 0;
            if (count > 0) {
                html += ''
                + '<div class="category-card">'
                +   '<div class="category-header">'
                +     '<div class="category-icon">🎧</div>'
                +     '<div>'
                +       '<div class="category-title">' + cat + ' 听力</div>'
                +       '<div class="category-meta">' + count + ' 篇</div>'
                +     '</div>'
                +   '</div>'
                +   '<div class="category-actions" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: nowrap;">'
                +     '<button class="btn" onclick="browseCategory(\'' + cat + '\', \'listening\')">📚 浏览题库</button>'
                +     '<button class="btn btn-secondary" onclick="startRandomPractice(\'' + cat + '\', \'listening\')">🎲 随机练习</button>'
                +   '</div>'
                + '</div>';
            }
        });
    }

    categoryContainer.innerHTML = html;
}

function getScoreColor(percentage) {
    if (percentage >= 90) return '#10b981';
    if (percentage >= 75) return '#f59e0b';
    if (percentage >= 60) return '#f97316';
    return '#ef4444';
}

function formatDurationShort(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    if (s < 60) return `${s}秒`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}分钟`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}小时${mm}分钟`;
}

function getDurationColor(seconds) {
    const minutes = (seconds || 0) / 60;
    if (minutes < 20) return '#10b981'; // green-500
    if (minutes < 23) return '#f59e0b'; // yellow-500
    if (minutes < 26) return '#f97316'; // orange-500
    if (minutes < 30) return '#ef4444'; // red-500
    return '#dc2626'; // red-600
}

function renderPracticeRecordItem(record) {
    const item = document.createElement("div");
    item.className = "history-item";

    const durationInSeconds = Number(record.duration || 0);
    const durationStr = formatDurationShort(durationInSeconds);
    const durationColor = getDurationColor(durationInSeconds);

    const isSelected = selectedRecords.has(record.id);
    if (bulkDeleteMode && isSelected) item.classList.add("history-item-selected");
    item.dataset.recordId = record.id;
    item.onclick = () => { if (bulkDeleteMode) toggleRecordSelection(record.id); };

    const title = record.title || "无标题";
    const dateText = new Date(record.date).toLocaleString();
    const percentage = record.percentage || 0;

    item.innerHTML = ''
        + '<div class="record-info" style="cursor: ' + (bulkDeleteMode ? 'pointer' : 'default') + ';">'
        +   '<a href="#" class="practice-record-title" onclick="event.stopPropagation(); showRecordDetails(\'' + record.id + '\'); return false;"><strong>' + title + '</strong></a>'
        +   '<div class="record-meta-line">'
        +     '<small class="record-date">' + dateText + '</small>'
        +     '<small class="record-duration-value"><strong>用时</strong><strong class="duration-time" style="color: ' + durationColor + ';">' + durationStr + '</strong></small>'
        +   '</div>'
        + '</div>'
        + '<div class="record-percentage-container" style="flex-grow: 1; text-align: right; padding-right: 5px;">'
        +   '<div class="record-percentage" style="color: ' + getScoreColor(percentage) + ';">' + percentage + '%</div>'
        + '</div>'
        + '<div class="record-actions-container" style="flex-shrink: 0;">'
        +   (bulkDeleteMode ? '' : '<button class="delete-record-btn" onclick="event.stopPropagation(); deleteRecord(\'' + record.id + '\')" title="删除此记录">🗑️</button>')
        + '</div>';

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
        historyContainer.innerHTML = `<div style="text-align: center; padding: 40px; opacity: 0.7;"><div style="font-size: 3em; margin-bottom: 15px;">📂</div><p>暂无任何练习记录</p></div>`;
        return;
    }
    
    if (window.VirtualScroller) {
        practiceListScroller = new VirtualScroller(historyContainer, recordsToShow, renderPracticeRecordItem, { itemHeight: 100, containerHeight: 650 }); // 增加itemHeight以匹配新的gap和padding
    } else {
        // Fallback to simple rendering if VirtualScroller is not available
        historyContainer.innerHTML = recordsToShow.map(record => renderPracticeRecordItem(record).outerHTML).join('');
    }
}


// --- Event Handlers & Navigation ---


function browseCategory(category, type = 'reading') {
    currentCategory = category;
    currentExamType = type;
    const typeText = type === 'listening' ? '听力' : '阅读';
    document.getElementById('browse-title').textContent = `📚 ${category} ${typeText}题库浏览`;
    showView('browse', false);
    loadExamList(); // Ensure exam list is loaded when browsing category
}

function filterByType(type) {
    currentExamType = type;
    currentCategory = 'all';
    document.getElementById('browse-title').textContent = '📚 题库浏览';
    loadExamList();
}

// Initialize browse view when it's activated
function initializeBrowseView() {
    console.log('[System] Initializing browse view...');
    currentCategory = 'all';
    currentExamType = 'all';
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
                    <div class="exam-meta">${exam.category} | ${exam.type}</div>
                </div>
            </div>
            <div class="exam-actions">
                <button class="btn exam-item-action-btn" onclick="openExam('${exam.id}')">开始</button>
                <button class="btn btn-secondary exam-item-action-btn" onclick="viewPDF('${exam.id}')">PDF</button>
            </div>
        </div>
    `;
}

function resolveExamBasePath(exam) {
  let basePath = (exam && exam.path) ? String(exam.path) : "";
  const readingRoot = '睡着过项目组(9.4)[134篇]/3. 所有文章(9.4)[134篇]/';
  
  if (exam && exam.type === 'reading' && !basePath.includes('睡着过项目组(9.4)[134篇]')) {
      basePath = readingRoot + basePath;
  }

  // 听力路径在数据文件中似乎是完整的，不需要修改
  
  if (!basePath.endsWith('/')) {
    basePath += "/";
  }
  basePath = basePath.replace(/\\/g, "/").replace(/\/+/g, "/");
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
  // 优先使用App流程（带会话与通信）
  if (window.app && typeof window.app.openExam === 'function') {
    try {
      window.app.openExam(examId);
      return;
    } catch (e) {
      console.warn('[Main] app.openExam 调用失败，将使用简化打开逻辑:', e);
    }
  }
    const exam = examIndex.find(e => e.id === examId);
    if (!exam) return showMessage('未找到题目', 'error');
    if (!exam.hasHtml) return viewPDF(examId);

    const fullPath = buildResourcePath(exam, 'html');
    const examWindow = window.open(fullPath, `exam_${exam.id}`, 'width=1200,height=800,scrollbars=yes,resizable=yes');
    if (examWindow) {
        showMessage('正在打开: ' + exam.title, 'success');
        // Communication setup will be handled by the script in the child window
    } else {
        showMessage('无法打开窗口，请检查弹窗设置', 'error');
    }
}

function viewPDF(examId) {
    const exam = examIndex.find(e => e.id === examId);
    if (!exam || !exam.pdfFilename) return showMessage('未找到PDF文件', 'error');
    
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
            showMessage('无法打开PDF窗口，请检查弹窗设置', 'error');
            return null;
        }
        showMessage('正在打开PDF...', 'info');
        return pdfWindow;
    } catch (error) {
        console.error('[PDF] 打开失败:', error);
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

    document.getElementById('total-exams').textContent = examIndex.length;
    // These IDs might not exist anymore, but we'll add them for robustness
    const htmlExamsEl = document.getElementById('html-exams');
    const pdfExamsEl = document.getElementById('pdf-exams');
    const lastUpdateEl = document.getElementById('last-update');

    if (htmlExamsEl) htmlExamsEl.textContent = readingExams.length + listeningExams.length; // Simplified
    if (pdfExamsEl) pdfExamsEl.textContent = examIndex.filter(e => e.pdfFilename).length;
    if (lastUpdateEl) lastUpdateEl.textContent = new Date().toLocaleString();
}

function showMessage(message, type = 'info', duration = 4000) {
    const container = document.getElementById('message-container');
    if (!container) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerHTML = '<strong>' + (type === 'error' ? '错误' : '成功') + '</strong> ' + (message || '');
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
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.65)';
    overlay.style.backdropFilter = 'blur(1px)';
    overlay.style.zIndex = '1000';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '900px';
    modal.style.width = '90%';
    modal.style.background = 'linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.9))';
    modal.style.color = '#1e293b';
    modal.style.border = 'none';
    modal.style.borderRadius = '20px';
    modal.style.boxShadow = '0 25px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(255,255,255,0.2)';
    modal.style.backdropFilter = 'blur(20px)';
    modal.innerHTML = `
        <div class="modal-header" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 20px 20px 0 0;">
            <h2 style="margin: 0; font-size: 1.5em; font-weight: 600;">📚 加载题库</h2>
            <button class="modal-close" aria-label="关闭" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease;">×</button>
        </div>
        <div class="modal-body" style="padding: 30px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
                <div style="border: 2px solid rgba(102, 126, 234, 0.2); border-radius: 16px; padding: 24px; background: linear-gradient(135deg, rgba(102, 126, 234, 0.05), rgba(118, 75, 162, 0.05)); transition: all 0.3s ease;">
                    <h3 style="margin: 0 0 12px 0; color: #667eea; font-size: 1.2em;">📖 阅读题库加载</h3>
                    <p style="margin: 0 0 20px 0; color: #64748b; line-height: 1.6;">支持全量重载与增量更新。请上传包含题目HTML/PDF的根文件夹。</p>
                    <div style="display:flex; gap:12px; flex-wrap: wrap;">
                        <button class="btn" id="reading-full-btn" style="background: linear-gradient(135deg, #667eea, #764ba2); border: none; color: white; padding: 12px 20px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.3s ease;">全量重载</button>
                        <button class="btn btn-secondary" id="reading-inc-btn" style="background: rgba(102, 126, 234, 0.1); border: 2px solid rgba(102, 126, 234, 0.3); color: #667eea; padding: 12px 20px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.3s ease;">增量更新</button>
                    </div>
                    <input type="file" id="reading-full-input" webkitdirectory multiple style="display:none;" />
                    <input type="file" id="reading-inc-input" webkitdirectory multiple style="display:none;" />
                    <div style="margin-top:16px; font-size: 0.85em; color: #94a3b8;">
                        💡 建议路径：.../3. 所有文章(9.4)[134篇]/...
                    </div>
                </div>
                <div style="border: 2px solid rgba(118, 75, 162, 0.2); border-radius: 16px; padding: 24px; background: linear-gradient(135deg, rgba(118, 75, 162, 0.05), rgba(102, 126, 234, 0.05)); transition: all 0.3s ease;">
                    <h3 style="margin: 0 0 12px 0; color: #764ba2; font-size: 1.2em;">🎧 听力题库加载</h3>
                    <p style="margin: 0 0 20px 0; color: #64748b; line-height: 1.6;">支持全量重载与增量更新。请上传包含题目HTML/PDF/音频的根文件夹。</p>
                    <div style="display:flex; gap:12px; flex-wrap: wrap;">
                        <button class="btn" id="listening-full-btn" style="background: linear-gradient(135deg, #764ba2, #667eea); border: none; color: white; padding: 12px 20px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.3s ease;">全量重载</button>
                        <button class="btn btn-secondary" id="listening-inc-btn" style="background: rgba(118, 75, 162, 0.1); border: 2px solid rgba(118, 75, 162, 0.3); color: #764ba2; padding: 12px 20px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.3s ease;">增量更新</button>
                    </div>
                    <input type="file" id="listening-full-input" webkitdirectory multiple style="display:none;" />
                    <input type="file" id="listening-inc-input" webkitdirectory multiple style="display:none;" />
                    <div style="margin-top:16px; font-size: 0.85em; color: #94a3b8;">
                        💡 建议路径：ListeningPractice/P3 或 ListeningPractice/P4
                    </div>
                </div>
            </div>
            <div style="margin-top:24px; padding: 20px; background: linear-gradient(135deg, rgba(102, 126, 234, 0.05), rgba(118, 75, 162, 0.05)); border-radius: 12px; border: 1px solid rgba(102, 126, 234, 0.1);">
                <div style="font-weight:600; color: #1e293b; margin-bottom: 12px; font-size: 1.1em;">📋 操作说明</div>
                <ul style="margin:0; padding-left: 20px; line-height:1.7; color: #64748b;">
                    <li>全量重载会替换当前配置中对应类型（阅读/听力）的全部索引，并保留另一类型原有数据。</li>
                    <li>增量更新会将新文件生成的新索引追加到当前配置。若当前为默认配置，则会自动复制为新配置后再追加，确保默认配置不被影响。</li>
                </ul>
            </div>
        </div>
        <div class="modal-footer" style="padding: 20px 30px; background: rgba(248, 250, 252, 0.8); border-radius: 0 0 20px 20px; border-top: 1px solid rgba(226, 232, 240, 0.5);">
            <button class="btn btn-secondary" id="close-loader" style="background: rgba(100, 116, 139, 0.1); border: 2px solid rgba(100, 116, 139, 0.2); color: #64748b; padding: 12px 24px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.3s ease;">关闭</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Scoped styles for better visual integration
    try {
        const styleEl = document.createElement('style');
        styleEl.textContent = `
            .library-loader-modal .btn{appearance:none;border:1px solid rgba(255,255,255,0.15);background:linear-gradient(180deg, rgba(59,130,246,0.25), rgba(59,130,246,0.15));color:#e5e7eb;border-radius:8px;padding:8px 14px;transition:all .2s ease}
            .library-loader-modal .btn:hover{border-color:rgba(255,255,255,0.25);background:linear-gradient(180deg, rgba(59,130,246,0.35), rgba(59,130,246,0.22))}
            .library-loader-modal .btn.btn-secondary{background:rgba(255,255,255,0.08);border-color:rgba(255,255,255,0.15)}
            .library-loader-modal .btn.btn-secondary:hover{background:rgba(255,255,255,0.12)}
            .library-loader-modal h2,.library-loader-modal h3{margin:0 0 8px}
            .library-loader-modal .modal-header{display:flex;justify-content:space-between;align-items:center;padding-bottom:8px}
            .library-loader-modal .modal-footer{}
        `;
        // add scoping class
        modal.className += ' library-loader-modal';
        modal.prepend(styleEl);
    } catch(_) {}

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
            label = prompt('为此次增量更新输入一个文件夹标签', '增量-' + new Date().toISOString().slice(0,10)) || '';
            if (label) {
                showMessage('使用标签: ' + label, 'info');
            }
            if (!detectFolderPlacement(files, type)) {
                const proceed = confirm('检测到文件夹不在推荐的结构中。\n阅读: ...\n听力: ListeningPractice/P3 or P4\n是否继续?');
                if (!proceed) return;
            }
        }

        showMessage('正在解析文件并构建索引...', 'info');
        const additions = await buildIndexFromFiles(files, type, label);
        if (additions.length === 0) {
            showMessage('从所选文件中未检测到任何题目', 'warning');
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
            showMessage('新的题库配置已创建并激活；正在重新加载...', 'success');
            setTimeout(() => { location.reload(); }, 800);
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
            showMessage('新的题库配置已创建并激活；正在重新加载...', 'success');
            setTimeout(() => { location.reload(); }, 800);
            return;
        }

        // Save to the current active key（非默认配置下的增量更新）
        storage.set(targetKey, newIndex);
        saveLibraryConfiguration(`${type === 'reading' ? '阅读' : '听力'}增量-${new Date().toLocaleString()}`, targetKey, newIndex.length);
        showMessage('索引已更新；正在刷新界面...', 'success');
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

/* Replaced by robust exporter below */
function exportPracticeData() {
    try {
        const records = window.storage ? window.storage.get('practice_records', []) : (window.practiceRecords || []);
        const stats = window.app && window.app.userStats ? window.app.userStats : (window.practiceStats || {});

        if (!records || records.length === 0) {
            showMessage('没有练习数据可导出', 'info');
            return;
        }

        showMessage('正在准备导出...', 'info');
        setTimeout(() => {
            try {
                const data = {
                    exportDate: new Date().toISOString(),
                    stats: stats,
                    records: records
                };

                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `practice-records-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                showMessage('导出完成', 'success');
            } catch (error) {
                console.error('导出失败:', error);
                showMessage('导出失败: ' + error.message, 'error');
            }
        }, 100);
    } catch (e) {
        console.error('导出失败:', e);
        showMessage('导出失败: ' + e.message, 'error');
    }
}
function toggleBulkDelete() {
    bulkDeleteMode = !bulkDeleteMode;
    const btn = document.getElementById('bulk-delete-btn');

    if (bulkDeleteMode) {
        btn.textContent = '✓ 完成选择';
        btn.classList.remove('btn-info');
        btn.classList.add('btn-success');
        selectedRecords.clear();
        showMessage('批量管理模式已开启，点击记录进行选择', 'info');
    } else {
        btn.textContent = '📝 批量管理';
        btn.classList.remove('btn-success');
        btn.classList.add('btn-info');

        if (selectedRecords.size > 0) {
            const confirmMessage = `确定要删除选中的 ${selectedRecords.size} 条记录吗？此操作不可恢复。`;
            if (confirm(confirmMessage)) {
                bulkDeleteRecords();
            }
        }
        selectedRecords.clear();
    }

    updatePracticeView();
}

function bulkDeleteRecords() {
    const records = storage.get('practice_records', []);
    const recordsToKeep = records.filter(record => !selectedRecords.has(record.id));

    const deletedCount = records.length - recordsToKeep.length;

    storage.set('practice_records', recordsToKeep);
    practiceRecords = recordsToKeep;

    syncPracticeRecords(); // Re-sync and update UI

    showMessage(`已删除 ${deletedCount} 条记录`, 'success');
    console.log(`[System] 批量删除了 ${deletedCount} 条练习记录`);
}

function toggleRecordSelection(recordId) {
    if (!bulkDeleteMode) return;

    if (selectedRecords.has(recordId)) {
        selectedRecords.delete(recordId);
    } else {
        selectedRecords.add(recordId);
    }
    updatePracticeView(); // Re-render to show selection state
}


function deleteRecord(recordId) {
    if (!recordId) {
        showMessage('记录ID无效', 'error');
        return;
    }

    const records = storage.get('practice_records', []);
    const recordIndex = records.findIndex(record => String(record.id) === String(recordId));

    if (recordIndex === -1) {
        showMessage('未找到记录', 'error');
        return;
    }

    const record = records[recordIndex];
    const confirmMessage = `确定要删除这条练习记录吗？\n\n题目: ${record.title}\n时间: ${new Date(record.date).toLocaleString()}\n\n此操作不可恢复。`;

    if (confirm(confirmMessage)) {
        const historyItem = document.querySelector(`[data-record-id="${recordId}"]`);
        if (historyItem) {
            historyItem.classList.add('deleting');
            setTimeout(() => {
                historyItem.classList.add('deleted');
                setTimeout(() => {
                    records.splice(recordIndex, 1);
                    storage.set('practice_records', records);
                    syncPracticeRecords(); // Re-sync and update UI
                    showMessage('记录已删除', 'success');
                }, 300);
            }, 200);
        } else {
            // Fallback if element not found
            records.splice(recordIndex, 1);
            storage.set('practice_records', records);
            syncPracticeRecords();
            showMessage('记录已删除', 'success');
        }
    }
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
        setTimeout(() => { location.reload(); }, 1000);
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
        const activeIndicator = isActive ? ' (当前)' : '';

        configHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <div>
                            <strong>${config.name}</strong> ${activeIndicator}<br>
                            <small>${date} - ${config.examCount} 个题目</small>
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
    if (confirm('确定要切换到这个题库配置吗？页面将会刷新。')) {
        setActiveLibraryConfiguration(configKey);
        showMessage('正在切换题库配置，页面将刷新...', 'info');
        setTimeout(() => {
            location.reload();
        }, 1000);
    }
}

// 删除题库配置
function deleteLibraryConfig(configKey) {
    if (configKey === 'exam_index') {
        showMessage('默认题库不可删除', 'warning');
        return;
    }
    if (confirm("确定要删除这个题库配置吗？此操作不可恢复。")) {
        let configs = getLibraryConfigurations();
        configs = configs.filter(config => config.key !== configKey);
        storage.set('exam_index_configurations', configs);
        storage.remove(configKey); // 移除实际的题库数据

        
        showMessage('题库配置已删除', 'success');
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
                    window.dataIntegrityManager.exportData();
                    showMessage('存储空间不足：已将数据导出为文件', 'warning');
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
                            <small>${date} - ${sizeKB} KB - v${backup.version}</small>
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

// 改进版：题库配置列表（默认题库不可删除，可切换）
function showLibraryConfigListV2() {
    let configs = getLibraryConfigurations();
    if (configs.length === 0) {
        try {
            const count = Array.isArray(window.examIndex) ? window.examIndex.length : 0;
            configs = [{ name: '默认题库', key: 'exam_index', examCount: count, timestamp: Date.now() }];
            storage.set('exam_index_configurations', configs);
            if (!storage.get('active_exam_index_key')) storage.set('active_exam_index_key', 'exam_index');
        } catch (_) {}
    }

    let html = `
        <div style="background: #D9CBBA; padding: 20px; border-radius: 10px; margin: 20px 0; border:2px solid #737373; box-shadow: 0 10px 30px rgba(0,0,0,0.35); color:#000000;">
            <h3 style="margin:0 0 10px; color: #000000;">📚 题库配置列表</h3>
            <div style="max-height: 320px; overflow-y: auto; margin: 10px 0;">
    `;
    configs.forEach(cfg => {
        const date = new Date(cfg.timestamp).toLocaleString();
        const isActive = getActiveLibraryConfigurationKey() === cfg.key;
        const isDefault = cfg.key === 'exam_index';
        const label = isDefault ? '默认题库' : (cfg.name || cfg.key);
        const activeIndicator = isActive ? '（当前）' : '';

        html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid rgba(0,0,0,0.1); color: #000000; background: linear-gradient(135deg, #BF755A, #a0654a); border-radius: 8px; margin: 5px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="line-height:1.3;">
                    <strong style="color: #F2F2F2;">${label}</strong> ${activeIndicator}<br>
                    <small style="color: #F2F2F2;">${date} - ${cfg.examCount || 0} 个题目</small>
                </div>
                <div>
                    <button class="btn btn-secondary" onclick="switchLibraryConfig('${cfg.key}')" style="margin-left:10px;" ${isActive ? 'disabled' : ''}>切换</button>
                    ${isDefault ? '' : `<button class="btn btn-warning" onclick="deleteLibraryConfig('${cfg.key}')" style="margin-left:10px;" ${isActive ? 'disabled' : ''}>删除</button>`}
                </div>
            </div>
        `;
    });
    html += `
            </div>
            <button class="btn btn-secondary" onclick="this.parentElement.remove()">关闭</button>
        </div>
    `;

    const container = document.getElementById('settings-view');
    const existing = container.querySelector('.library-config-list');
    if (existing) existing.remove();
    const listDiv = document.createElement('div');
    listDiv.className = 'library-config-list';
    listDiv.innerHTML = html;
    container.appendChild(listDiv);
}


// （已移除）导出调试信息函数在当前版本不再暴露到设置页按钮




// Safe exporter (compat with old UI)
function exportPracticeData() {
    try {
        if (window.dataIntegrityManager && typeof window.dataIntegrityManager.exportData === 'function') {
            window.dataIntegrityManager.exportData();
            try { showMessage('导出完成', 'success'); } catch(_) {}
            return;
        }
    } catch(_) {}
    try {
        var records = (window.storage && storage.get) ? storage.get('practice_records', []) : (window.practiceRecords || []);
        var blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = 'practice-records.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        try { showMessage('导出完成', 'success'); } catch(_) {}
    } catch(e) {
        try { showMessage('导出失败: ' + (e && e.message || e), 'error'); } catch(_) {}
        console.error('[Export] failed', e);
    }
}
