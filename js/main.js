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
document.addEventListener('DOMContentLoaded', () => {
    // expose modal launcher globally for SettingsPanel button
    window.showLibraryLoaderModal = showLibraryLoaderModal;

    initializeApplication();
});

function initializeApplication() {
    try { showMessage('System ready', 'success'); } catch(_) {}

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
        console.log('[System] 娴忚鐘舵€佺鐞嗗櫒宸插垵濮嬪寲');
    }
    if (window.DataIntegrityManager) {
        window.dataIntegrityManager = new DataIntegrityManager();
        console.log('[System] 鏁版嵁瀹屾暣鎬х鐞嗗櫒宸插垵濮嬪寲');
    } else {
        console.warn('[System] DataIntegrityManager绫绘湭鍔犺浇');
    }

    // Load data and setup listeners
    loadLibrary();
    syncPracticeRecords(); // Load initial records and update UI
    setupMessageListener(); // Listen for updates from child windows
    setupCompletionMessageBridge(); // Bridge to persist PRACTICE_COMPLETE when needed
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
        // 鏇村吋瀹圭殑瀹夊叏妫€鏌ワ細鍏佽鍚屾簮鎴?file 鍗忚涓嬬殑瀛愮獥鍙?
        try {
            if (event.origin && event.origin !== 'null' && event.origin !== window.location.origin) {
                return;
            }
        } catch (_) {}

        const data = event.data || {};
        const type = data.type;
        if (type === 'PRACTICE_COMPLETE' || type === 'practice_completed') {
            console.log('[System] 鏀跺埌缁冧範瀹屾垚娑堟伅锛屾鍦ㄥ悓姝ヨ褰?..');
            showMessage('缁冧範宸插畬鎴愶紝姝ｅ湪鏇存柊璁板綍...', 'success');
            setTimeout(syncPracticeRecords, 300);
        }
    });
}

function loadLibrary() {
    const startTime = performance.now();
    const activeConfigKey = getActiveLibraryConfigurationKey();
    const cachedData = storage.get(activeConfigKey);

    if (cachedData) {
    console.log(`[System] 使用localStorage中key为 '${activeConfigKey}'的题库数据`);
    examIndex = cachedData;
    // 确保默认题库配置记录存在
    try {
        const configs = storage.get('exam_index_configurations', []);
        const exists = configs.some(c => c.key === 'exam_index');
        if (!exists) {
            configs.push({ name: '默认题库', key: 'exam_index', examCount: examIndex.length || 0, timestamp: Date.now() });
            storage.set('exam_index_configurations', configs);
        }
        const activeKey = storage.get('active_exam_index_key');
        if (!activeKey) storage.set('active_exam_index_key', 'exam_index');
    } catch (e) { console.warn('[LibraryConfig] ensure default failed:', e); }
    finishLibraryLoading(startTime);
    return;
}

    showMessage('姝ｅ湪鍔犺浇棰樺簱绱㈠紩...', 'info');

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
            throw new Error('榛樿棰樺簱鏁版嵁鏈纭姞杞?);
        }

        examIndex = [...readingExams, ...listeningExams];
        storage.set('exam_index', examIndex);
        saveLibraryConfiguration('榛樿棰樺簱', 'exam_index', examIndex.length);
        setActiveLibraryConfiguration('exam_index');
        
        finishLibraryLoading(startTime);

    } catch (error) {
        handleError(error, '棰樺簱鍔犺浇');
    }
}

function finishLibraryLoading(startTime) {
    const loadTime = performance.now() - startTime;
    showMessage(`棰樺簱鍔犺浇瀹屾垚锛佸叡 ${examIndex.length} 涓鐩?- ${Math.round(loadTime)}ms`, 'success');
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
    let html = '<h3 style="grid-column: 1 / -1;">馃摉 闃呰閮ㄥ垎</h3>';
    html += Object.keys(readingStats).map(cat => `
        <div class="category-card">
            <div class="category-header">
                <div class="category-icon">馃摉</div>
                <div>
                    <div class="category-title">${cat} 闃呰</div>
                    <div class="category-meta">${readingStats[cat].total} 绡囨枃绔?/div>
                </div>
            </div>
            <div class="category-actions">
                <button class="btn" onclick="browseCategory('${cat}', 'reading')">馃摎 娴忚棰樼洰</button>
                <button class="btn btn-secondary" onclick="startRandomPractice('${cat}', 'reading')">馃幉 闅忔満缁冧範</button>
            </div>
        </div>
    `).join('');

    if (listeningExams.length > 0) {
        html += '<h3 style="margin-top: 40px; grid-column: 1 / -1;">馃帶 鍚姏閮ㄥ垎</h3>';
        html += Object.keys(listeningStats).filter(cat => listeningStats[cat].total > 0).map(cat => `
            <div class="category-card">
                <div class="category-header">
                    <div class="category-icon">馃帶</div>
                    <div>
                        <div class="category-title">${cat} 鍚姏</div>
                        <div class="category-meta">${listeningStats[cat].total} 涓粌涔?/div>
                    </div>
                </div>
                <div class="category-actions">
                    <button class="btn" onclick="browseCategory('${cat}', 'listening')">馃摎 娴忚棰樼洰</button>
                    <button class="btn btn-secondary" onclick="startRandomPractice('${cat}', 'listening')">馃幉 闅忔満缁冧範</button>
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
    if (m < 60) return `${m}鍒嗛挓`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}灏忔椂${mm}鍒嗛挓`;
}

function getDurationColor(seconds) {
    const minutes = (seconds || 0) / 60;
    if (minutes < 20) return '#4ade80'; // green-400
    if (minutes < 23) return '#facc15'; // yellow-400
    if (minutes < 26) return '#fb923c'; // orange-400
    if (minutes < 30) return '#f87171'; // red-400
    return '#ef4444'; // red-500
}

function renderPracticeRecordItem(record) {
    const item = document.createElement('div');
    item.className = 'history-item';

    const durationInSeconds = record.duration || 0;
    const durationStr = formatDurationShort(durationInSeconds);
    const durationColor = getDurationColor(durationInSeconds);

    const isSelected = selectedRecords.has(record.id);
    if (bulkDeleteMode && isSelected) {
        item.classList.add('history-item-selected');
    }
    item.dataset.recordId = record.id;
    item.onclick = () => {
        if (bulkDeleteMode) {
            toggleRecordSelection(record.id);
        }
    };

    item.innerHTML = `
        <div class="record-info" style="cursor: ${bulkDeleteMode ? 'pointer' : 'default'};">
            <a href="#" class="practice-record-title" onclick="event.stopPropagation(); showRecordDetails('${record.id}'); return false;">
                <strong>${record.title}</strong>
            </a>
            <div class="record-meta-line">
                <small class="record-date">${new Date(record.date).toLocaleString()}</small>
                <small class="record-duration-value"><strong>鐢ㄦ椂锛?/strong><strong class="duration-time" style="color: ${durationColor};">${durationStr}</strong></small>
            </div>
        </div>
        <div class="record-percentage-container" style="flex-grow: 1; text-align: right; padding-right: 5px;">
            <div class="record-percentage" style="color: ${getScoreColor(record.percentage || 0)};">
                ${record.percentage || 0}%
            </div>
        </div>
        <div class="record-actions-container" style="flex-shrink: 0;">
            ${!bulkDeleteMode ? `
                <button class="delete-record-btn" onclick="event.stopPropagation(); deleteRecord('${record.id}')" title="鍒犻櫎姝よ褰?>馃棏锔?/button>
            ` : ''}
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
        historyContainer.innerHTML = `<div style="text-align: center; padding: 40px; opacity: 0.7;"><div style="font-size: 3em; margin-bottom: 15px;">馃搵</div><p>鏆傛棤璇ョ被鍨嬬粌涔犺褰?/p></div>`;
        return;
    }
    
    if (window.VirtualScroller) {
        practiceListScroller = new VirtualScroller(historyContainer, recordsToShow, renderPracticeRecordItem, { itemHeight: 65, containerHeight: 650 }); /* 澧炲姞itemHeight浠ュ尮閰嶆柊鐨刧ap鍜宲adding */
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
        document.getElementById('browse-title').textContent = '馃摎 棰樺簱娴忚';
    }
    
    if (viewName === 'browse') loadExamList();
    if (viewName === 'practice') updatePracticeView();
}

function browseCategory(category, type = 'reading') {
    currentCategory = category;
    currentExamType = type;
    const typeText = type === 'listening' ? '鍚姏' : '闃呰';
    document.getElementById('browse-title').textContent = `馃摎 ${category} ${typeText}棰樺簱娴忚`;
    showView('browse', false);
}

function filterByType(type) {
    currentExamType = type;
    currentCategory = 'all'; 
    document.getElementById('browse-title').textContent = '馃摎 棰樺簱娴忚';
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
        container.innerHTML = `<div style="text-align: center; padding: 40px;"><p>鏈壘鍒板尮閰嶇殑棰樼洰</p></div>`;
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
                    <div class="exam-meta">${exam.category} 鈥?${exam.type}</div>
                </div>
            </div>
            <div class="exam-actions">
                <button class="btn" onclick="openExam('${exam.id}')">寮€濮嬬粌涔?/button>
                <button class="btn btn-secondary" onclick="viewPDF('${exam.id}')">鏌ョ湅PDF</button>
            </div>
        </div>
    `;
}

function resolveExamBasePath(exam) {
    let basePath = exam.path || '';
    // Normalize listening paths: legacy folder name to actual folder name
    if (exam.type === 'listening') {
        basePath = basePath.replace('鐫＄潃杩囧惉鍔涢」鐩?宸插畬鎴愬皬鏍?, 'ListeningPractice');
        if (!/^ListeningPractice\//.test(basePath)) {
            // If a listening path somehow lacks base, try prefixing
            if (!basePath.startsWith('./')) basePath = 'ListeningPractice/' + basePath.replace(/^\/?/, '');
        }
    }
    // Normalize reading paths: ensure they are under the "鎵€鏈夋枃绔? collection
    if (exam.type === 'reading') {
        const hasFullPrefix = /鐫＄潃杩囬」鐩粍\(9\.4\)\[134绡嘰]\//.test(basePath);
        if (!hasFullPrefix) {
            basePath = '鐫＄潃杩囬」鐩粍(9.4)[134绡嘳/3. 鎵€鏈夋枃绔?9.4)[134绡嘳/' + basePath.replace(/^\/?/, '');
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
  // 浼樺厛璧?App 娴佺▼锛堝甫浼氳瘽涓庨€氫俊锛?
  if (window.app && typeof window.app.openExam === 'function') {
    try {
      window.app.openExam(examId);
      return;
    } catch (e) {
      console.warn('[Main] app.openExam 璋冪敤澶辫触锛屽皢浣跨敤绠€鍖栨墦寮€閫昏緫:', e);
    }
  }
    const exam = examIndex.find(e => e.id === examId);
    if (!exam) return showMessage('棰樼洰涓嶅瓨鍦?, 'error');
    if (!exam.hasHtml) return viewPDF(examId);

    const fullPath = buildResourcePath(exam, 'html');
    const examWindow = window.open(fullPath, `exam_${exam.id}`, 'width=1200,height=800,scrollbars=yes,resizable=yes');
    if (examWindow) {
        showMessage(`姝ｅ湪鎵撳紑: ${exam.title}`, 'success');
        // Communication setup will be handled by the script in the child window
    } else {
        showMessage('鏃犳硶鎵撳紑鏂扮獥鍙ｏ紝璇锋鏌ユ祻瑙堝櫒寮圭獥璁剧疆', 'error');
    }
}

function viewPDF(examId) {
    const exam = examIndex.find(e => e.id === examId);
    if (!exam || !exam.pdfFilename) return showMessage('PDF鏂囦欢涓嶅瓨鍦?, 'error');
    
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
        alert('鏃犳硶鏄剧ず璁板綍璇︽儏锛氱粍浠舵湭鍔犺浇');
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
            showMessage('鏃犳硶鎵撳紑PDF绐楀彛锛岃妫€鏌ユ祻瑙堝櫒寮圭獥璁剧疆', 'error');
            return null;
        }
        showMessage(`姝ｅ湪鎵撳紑PDF: ${examTitle}`, 'info');
        return pdfWindow;
    } catch (error) {
        console.error('[PDF] 鎵撳紑PDF澶辫触:', error);
        showMessage('鎵撳紑PDF澶辫触', 'error');
        return null;
    }
}

// --- Helper Functions ---
function getViewName(viewName) {
    switch (viewName) {
        case 'overview': return '鎬昏';
        case 'browse': return '棰樺簱娴忚';
        case 'practice': return '缁冧範璁板綍';
        case 'settings': return '璁剧疆';
        default: return '';
    }
}

function updateSystemInfo() {
    if (!examIndex) return;
    const readingExams = examIndex.filter(e => e.type === 'reading');
    const listeningExams = examIndex.filter(e => e.type === 'listening');
    
    document.getElementById('total-exams').textContent = `${examIndex.length} 涓猔;
    // These IDs might not exist anymore, but we'll add them for robustness
    const htmlExamsEl = document.getElementById('html-exams');
    const pdfExamsEl = document.getElementById('pdf-exams');
    const lastUpdateEl = document.getElementById('last-update');

    if (htmlExamsEl) htmlExamsEl.textContent = `${readingExams.length + listeningExams.length} 涓猔; // Simplified
    if (pdfExamsEl) pdfExamsEl.textContent = `${examIndex.filter(e => e.pdfFilename).length} 涓猔;
    if (lastUpdateEl) lastUpdateEl.textContent = new Date().toLocaleString();
}

function showMessage(message, type = 'info', duration = 4000) {
    const container = document.getElementById('message-container');
    if (!container) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerHTML = '<strong>' + (type === 'error' ? 'ERROR' : 'OK') + '</strong> ' + (message || '');
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
        console.error('[LibraryConfig] 淇濆瓨棰樺簱閰嶇疆澶辫触:', e);
    }
}
function setActiveLibraryConfiguration(key) { 
    try {
        storage.set('active_exam_index_key', key);
    } catch (e) {
        console.error('[LibraryConfig] 璁剧疆娲诲姩棰樺簱閰嶇疆澶辫触:', e);
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
    modal.style.background = 'rgba(17,24,39,0.98)';
    modal.style.color = '#e5e7eb';
    modal.style.border = '1px solid rgba(255,255,255,0.12)';
    modal.style.borderRadius = '12px';
    modal.style.boxShadow = '0 20px 50px rgba(0,0,0,0.5)';
    modal.innerHTML = `
        <div class="modal-header">
            <h2>鍔犺浇棰樺簱</h2>
            <button class="modal-close" aria-label="鍏抽棴">脳</button>
        </div>
        <div class="modal-body">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <div style="border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 16px; background: rgba(255,255,255,0.06);">
                    <h3>馃摉 闃呰棰樺簱鍔犺浇</h3>
                    <p style="opacity:0.9;">鏀寔鍏ㄩ噺閲嶈浇鍜屽閲忔洿鏂般€傝涓婁紶鍖呭惈棰樼洰HTML/PDF鐨勬牴鏂囦欢澶广€?/p>
                    <div style="display:flex; gap:10px; flex-wrap: wrap;">
                        <button class="btn" id="reading-full-btn">鍏ㄩ噺閲嶈浇</button>
                        <button class="btn btn-secondary" id="reading-inc-btn">澧為噺鏇存柊</button>
                    </div>
                    <input type="file" id="reading-full-input" webkitdirectory multiple style="display:none;" />
                    <input type="file" id="reading-inc-input" webkitdirectory multiple style="display:none;" />
                    <div style="margin-top:10px; font-size: 0.9em; opacity:0.9;">
                        寤鸿璺緞锛氱潯鐫€杩囬」鐩粍(9.4)[134绡嘳/3. 鎵€鏈夋枃绔?9.4)[134绡嘳/...
                    </div>
                </div>
                <div style="border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 16px; background: rgba(255,255,255,0.06);">
                    <h3>馃帶 鍚姏棰樺簱鍔犺浇</h3>
                    <p style="opacity:0.9;">鏀寔鍏ㄩ噺閲嶈浇鍜屽閲忔洿鏂般€傝涓婁紶鍖呭惈棰樼洰HTML/PDF/闊抽鐨勬牴鏂囦欢澶广€?/p>
                    <div style="display:flex; gap:10px; flex-wrap: wrap;">
                        <button class="btn" id="listening-full-btn">鍏ㄩ噺閲嶈浇</button>
                        <button class="btn btn-secondary" id="listening-inc-btn">澧為噺鏇存柊</button>
                    </div>
                    <input type="file" id="listening-full-input" webkitdirectory multiple style="display:none;" />
                    <input type="file" id="listening-inc-input" webkitdirectory multiple style="display:none;" />
                    <div style="margin-top:10px; font-size: 0.9em; opacity:0.9;">
                        寤鸿璺緞锛歀isteningPractice/P3 鎴?ListeningPractice/P4
                    </div>
                </div>
            </div>
            <div style="margin-top:16px; padding: 12px; background: rgba(255,255,255,0.08); border-radius: 8px;">
                <div style="font-weight:600;">璇存槑</div>
                <ul style="margin:8px 0 0 18px; line-height:1.6;">
                    <li>鍏ㄩ噺閲嶈浇浼氭浛鎹㈠綋鍓嶉厤缃腑瀵瑰簲绫诲瀷锛堥槄璇?鍚姏锛夌殑鍏ㄩ儴绱㈠紩锛屽苟淇濈暀鍙︿竴绫诲瀷鍘熸湁鏁版嵁銆?/li>
                    <li>澧為噺鏇存柊浼氬皢鏂版枃浠跺す鐢熸垚鐨勭储寮曡拷鍔犲埌褰撳墠閰嶇疆锛涜嫢褰撳墠涓洪粯璁ら厤缃紝灏嗚嚜鍔ㄥ鍒朵负鏂伴厤缃悗鍐嶈拷鍔狅紝纭繚榛樿閰嶇疆涓嶅彈褰卞搷銆?/li>
                </ul>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" id="close-loader">鍏抽棴</button>
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
            .library-loader-modal .modal-header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:8px}
            .library-loader-modal .modal-footer{border-top:1px solid rgba(255,255,255,0.1)}
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
            label = prompt('涓烘湰娆″閲忔洿鏂拌緭鍏ヤ竴涓枃浠跺す鏍囪瘑鍚嶇О锛堜究浜庤瘑鍒級锛?, '澧為噺闆?' + new Date().toISOString().slice(0,10)) || '';
            if (label) {
                showMessage(`灏嗕互鈥?{label}鈥濇爣璁版娆″閲忔洿鏂癭, 'info');
            }
            if (!detectFolderPlacement(files, type)) {
                const proceed = confirm(`妫€娴嬪埌涓婁紶鐨勬枃浠跺す鏈浜庢帹鑽愮洰褰曠粨鏋勪笅銆俓n闃呰锛氱潯鐫€杩囬」鐩粍(9.4)[134绡嘳/3. 鎵€鏈夋枃绔?9.4)[134绡嘳/...\n鍚姏锛歀isteningPractice/P3 鎴?P4\n浠嶈缁х画鍚楋紵`);
                if (!proceed) return;
            }
        }

        showMessage('姝ｅ湪瑙ｆ瀽鏂囦欢骞剁敓鎴愰潤鎬佺储寮?..', 'info');
        const additions = await buildIndexFromFiles(files, type, label);
        if (additions.length === 0) {
            showMessage('鏈粠鎵€閫夋枃浠朵腑璇嗗埆鍒伴鐩?, 'warning');
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

        // 瀵逛簬鍏ㄩ噺閲嶈浇锛屽垱寤轰竴涓柊鐨勯搴撻厤缃苟鑷姩鍒囨崲
        if (mode === 'full') {
            const targetKey = `exam_index_${Date.now()}`;
            const configName = `${type === 'reading' ? '闃呰' : '鍚姏'}鍏ㄩ噺-${new Date().toLocaleString()}`;
            // 纭繚鍙︿竴绫诲瀷瀛樺湪锛屽涓嶅瓨鍦ㄥ垯琛ラ綈榛樿宓屽叆鏁版嵁
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
            showMessage('鏂伴搴撻厤缃凡鐢熸垚骞跺垏鎹紝椤甸潰灏嗗埛鏂?..', 'success');
            setTimeout(() => location.reload(), 800);
            return;
        }

        const isDefault = activeKey === 'exam_index';
        let targetKey = activeKey;
        let configName = '';
        if (mode === 'incremental' && isDefault) {
            // Create a new configuration so as not to affect default
            targetKey = `exam_index_${Date.now()}`;
            configName = `${type === 'reading' ? '闃呰' : '鍚姏'}澧為噺-${new Date().toLocaleString()}`;
            storage.set(targetKey, newIndex);
            saveLibraryConfiguration(configName, targetKey, newIndex.length);
            setActiveLibraryConfiguration(targetKey);
            showMessage('宸插垱寤烘柊棰樺簱閰嶇疆骞跺垏鎹紝椤甸潰灏嗗埛鏂?..', 'success');
            setTimeout(() => location.reload(), 800);
            return;
        }

        // Save to the current active key锛堥潪榛樿閰嶇疆涓嬬殑澧為噺鏇存柊锛?
        storage.set(targetKey, newIndex);
        saveLibraryConfiguration(`${type === 'reading' ? '闃呰' : '鍚姏'}澧為噺-${new Date().toLocaleString()}`, targetKey, newIndex.length);
        showMessage('绱㈠紩鏇存柊鎴愬姛锛屾鍦ㄥ埛鏂扮晫闈?..', 'success');
        examIndex = newIndex;
        updateOverview();
        if (document.getElementById('browse-view')?.classList.contains('active')) {
            loadExamList();
        }
    } catch (error) {
        console.error('[LibraryLoader] 澶勭悊棰樺簱涓婁紶澶辫触:', error);
        showMessage('棰樺簱澶勭悊澶辫触: ' + error.message, 'error');
    }
}

function detectFolderPlacement(files, type) {
    const paths = files.map(f => f.webkitRelativePath || f.name);
    if (type === 'reading') {
        return paths.some(p => /鐫＄潃杩囬」鐩粍\(9\.4\)\[134绡嘰]\/3\. 鎵€鏈夋枃绔燶(9\.4\)\[134绡嘰]\//.test(p));
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
            showMessage('鏆傛棤缁冧範鏁版嵁鍙鍑?, 'info');
            return;
        }

        showMessage('姝ｅ湪鍑嗗瀵煎嚭...', 'info');
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

                showMessage('缁冧範鏁版嵁宸插鍑?, 'success');
            } catch (error) {
                console.error('瀵煎嚭澶辫触:', error);
                showMessage('瀵煎嚭澶辫触: ' + error.message, 'error');
            }
        }, 100);
    } catch (e) {
        console.error('瀵煎嚭澶辫触:', e);
        showMessage('瀵煎嚭澶辫触: ' + e.message, 'error');
    }
}
function toggleBulkDelete() {
    bulkDeleteMode = !bulkDeleteMode;
    const btn = document.getElementById('bulk-delete-btn');

    if (bulkDeleteMode) {
        btn.textContent = '鉁?瀹屾垚閫夋嫨';
        btn.classList.remove('btn-info');
        btn.classList.add('btn-success');
        selectedRecords.clear();
        showMessage('鎵归噺绠＄悊妯″紡宸插紑鍚紝鐐瑰嚮璁板綍杩涜閫夋嫨', 'info');
    } else {
        btn.textContent = '馃摑 鎵归噺绠＄悊';
        btn.classList.remove('btn-success');
        btn.classList.add('btn-info');

        if (selectedRecords.size > 0) {
            const confirmMessage = `纭畾瑕佸垹闄ら€変腑鐨?${selectedRecords.size} 鏉¤褰曞悧锛熸鎿嶄綔涓嶅彲鎭㈠銆俙;
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

    showMessage(`宸插垹闄?${deletedCount} 鏉¤褰昤, 'success');
    console.log(`[System] 鎵归噺鍒犻櫎浜?${deletedCount} 鏉＄粌涔犺褰昤);
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
        showMessage('璁板綍ID鏃犳晥', 'error');
        return;
    }

    const records = storage.get('practice_records', []);
    const recordIndex = records.findIndex(record => String(record.id) === String(recordId));

    if (recordIndex === -1) {
        showMessage('鏈壘鍒版寚瀹氳褰?, 'error');
        return;
    }

    const record = records[recordIndex];
    const confirmMessage = `纭畾瑕佸垹闄よ繖鏉＄粌涔犺褰曞悧锛焅n\n棰樼洰: ${record.title}\n鏃堕棿: ${new Date(record.date).toLocaleString()}\n\n姝ゆ搷浣滀笉鍙仮澶嶃€俙;

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
                    showMessage('璁板綍宸插垹闄?, 'success');
                }, 300);
            }, 200);
        } else {
            // Fallback if element not found
            records.splice(recordIndex, 1);
            storage.set('practice_records', records);
            syncPracticeRecords();
            showMessage('璁板綍宸插垹闄?, 'success');
        }
    }
}

function clearPracticeData() {
    if (confirm('纭畾瑕佹竻闄ゆ墍鏈夌粌涔犺褰曞悧锛熸鎿嶄綔涓嶅彲鎭㈠銆?)) {
        practiceRecords = [];
        storage.set('practice_records', []); // Use storage helper
        processedSessions.clear();
        updatePracticeView();
        showMessage('缁冧範璁板綍宸叉竻闄?, 'success');
    }
}

function clearCache() {
    if (confirm('纭畾瑕佹竻闄ゆ墍鏈夌紦瀛樻暟鎹悧锛?)) {
        localStorage.clear();
        sessionStorage.clear();
        if (window.performanceOptimizer) {
            // This assumes performanceOptimizer has a cleanup method
            // window.performanceOptimizer.cleanup(); 
        }
        showMessage('缂撳瓨宸叉竻闄?, 'success');
        setTimeout(() => location.reload(), 1000);
    }
}

function showLibraryConfigList() {
    const configs = getLibraryConfigurations();

    if (configs.length === 0) {
        showMessage('鏆傛棤棰樺簱閰嶇疆璁板綍', 'info');
        return;
    }

    let configHtml = `
                <div style="background: rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <h3>馃摎 棰樺簱閰嶇疆鍒楄〃</h3>
                    <div style="max-height: 300px; overflow-y: auto; margin: 15px 0;">
            `;

    configs.forEach(config => {
        const date = new Date(config.timestamp).toLocaleString();
        const isActive = getActiveLibraryConfigurationKey() === config.key;
        const activeIndicator = isActive ? '鉁?(褰撳墠)' : '';

        configHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <div>
                            <strong>${config.name}</strong> ${activeIndicator}<br>
                            <small>${date} 鈥?${config.examCount} 涓鐩?/small>
                        </div>
                        <div>
                            <button class="btn btn-secondary" onclick="switchLibraryConfig('${config.key}')" style="margin-left: 10px;" ${isActive ? 'disabled' : ''}>鍒囨崲</button>
                            <button class="btn btn-warning" onclick="deleteLibraryConfig('${config.key}')" style="margin-left: 10px;" ${isActive ? 'disabled' : ''}>鍒犻櫎</button>
                        </div>
                    </div>
                `;
    });

    configHtml += `
                    </div>
                    <button class="btn btn-secondary" onclick="this.parentElement.remove()">鍏抽棴</button>
                </div>
            `;

    // 鏄剧ず閰嶇疆鍒楄〃
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

// 鍒囨崲棰樺簱閰嶇疆
function switchLibraryConfig(configKey) {
    if (confirm("纭畾瑕佸垏鎹㈠埌姝ら搴撻厤缃悧锛?)) {
        setActiveLibraryConfiguration(configKey);
        showMessage('姝ｅ湪鍒囨崲棰樺簱閰嶇疆锛岄〉闈㈠皢鍒锋柊...', 'info');
        setTimeout(() => {
            location.reload();
        }, 1000);
    }
}

// 鍒犻櫎棰樺簱閰嶇疆
function deleteLibraryConfig(configKey) {
    if (configKey === 'exam_index') {
        showMessage('榛樿棰樺簱涓嶅彲鍒犻櫎', 'warning');
        return;
    }
    if (confirm("纭畾瑕佸垹闄ゆ棰樺簱閰嶇疆鍚楋紵姝ゆ搷浣滀笉鍙仮澶嶃€?)) {
        let configs = getLibraryConfigurations();
        configs = configs.filter(config => config.key !== configKey);
        storage.set('exam_index_configurations', configs);
        storage.remove(configKey); // 绉婚櫎瀹為檯鐨勯搴撴暟鎹?

        showMessage('棰樺簱閰嶇疆宸插垹闄?, 'success');
        showLibraryConfigList(); // 鍒锋柊鍒楄〃
    }
}

function createManualBackup() {
    if (!window.dataIntegrityManager) {
        showMessage('鏁版嵁绠＄悊妯″潡鏈垵濮嬪寲', 'error');
        return;
    }
    (async () => {
        try {
            const backup = await window.dataIntegrityManager.createBackup(null, 'manual');
            if (backup && backup.external) {
                showMessage('鏈湴瀛樺偍绌洪棿涓嶈冻锛屽凡灏嗗浠戒笅杞戒负鏂囦欢', 'warning');
            } else {
                showMessage(`澶囦唤鍒涘缓鎴愬姛: ${backup.id}`, 'success');
            }
            // 鍒锋柊澶囦唤鍒楄〃锛堝鏋滅敤鎴锋墦寮€浜嗚缃〉锛?
            try { showBackupList(); } catch (_) {}
        } catch (error) {
            if (isQuotaExceeded(error)) {
                try {
                    // 鐩存帴瀵煎嚭鎵€鏈夋暟鎹綔涓烘渶缁堜繚搴?
                    window.dataIntegrityManager.exportData();
                    showMessage('鏈湴绌洪棿涓嶈冻锛氬凡瀵煎嚭鏁版嵁涓烘枃浠?, 'warning');
                } catch (e2) {
                    showMessage('澶囦唤澶辫触涓斿鍑哄け璐? ' + (e2 && e2.message ? e2.message : e2), 'error');
                }
            } else {
                showMessage('澶囦唤鍒涘缓澶辫触: ' + (error && error.message ? error.message : error), 'error');
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
        showMessage('鏁版嵁瀹屾暣鎬х鐞嗗櫒鏈垵濮嬪寲', 'error');
        return;
    }

    const backups = window.dataIntegrityManager.getBackupList();

    if (backups.length === 0) {
        showMessage('鏆傛棤澶囦唤璁板綍', 'info');
        return;
    }

    let backupHtml = `
                <div style="background: rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <h3>馃搵 澶囦唤鍒楄〃</h3>
                    <div style="max-height: 300px; overflow-y: auto; margin: 15px 0;">
            `;

    backups.forEach(backup => {
        const date = new Date(backup.timestamp).toLocaleString();
        const sizeKB = Math.round(backup.size / 1024);
        const typeIcon = backup.type === 'auto' ? '馃攧' : backup.type === 'manual' ? '馃懁' : '鈿狅笍';

        backupHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <div>
                            <strong>${typeIcon} ${backup.id}</strong><br>
                            <small>${date} 鈥?${sizeKB} KB 鈥?v${backup.version}</small>
                        </div>
                        <button class="btn btn-secondary" onclick="restoreBackup('${backup.id}')" style="margin-left: 10px;">鎭㈠</button>
                    </div>
                `;
    });

    backupHtml += `
                    </div>
                    <button class="btn btn-secondary" onclick="this.parentElement.remove()">鍏抽棴</button>
                </div>
            `;

    // 鏄剧ず澶囦唤鍒楄〃
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

// 鎭㈠澶囦唤
async function restoreBackup(backupId) {
    if (!window.dataIntegrityManager) {
        showMessage('鏁版嵁瀹屾暣鎬х鐞嗗櫒鏈垵濮嬪寲', 'error');
        return;
    }

    if (!confirm(`纭畾瑕佹仮澶嶅浠?${backupId} 鍚楋紵褰撳墠鏁版嵁灏嗚瑕嗙洊銆俙)) {
        return;
    }

    try {
        showMessage('姝ｅ湪鎭㈠澶囦唤...', 'info');
        await window.dataIntegrityManager.restoreBackup(backupId);
        showMessage('澶囦唤鎭㈠鎴愬姛', 'success');
        // The page will now sync automatically without a reload.
    } catch (error) {
        console.error('[DataManagement] 鎭㈠澶囦唤澶辫触:', error);
        showMessage('澶囦唤鎭㈠澶辫触: ' + error.message, 'error');
    }
}

function exportAllData() {
    if (window.dataIntegrityManager) {
        window.dataIntegrityManager.exportData();
        showMessage('鏁版嵁瀵煎嚭鎴愬姛', 'success');
    } else {
        showMessage('鏁版嵁绠＄悊妯″潡鏈垵濮嬪寲', 'error');
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
            if (confirm('瀵煎叆鏁版嵁灏嗚鐩栧綋鍓嶆暟鎹紝纭畾缁х画鍚楋紵')) {
                try {
                    const result = await window.dataIntegrityManager.importData(file);
                    showMessage(`鏁版嵁瀵煎叆鎴愬姛: ${result.importedCount} 涓」鐩甡, 'success');
                    // The page will now sync automatically without a reload.
                } catch (error) {
                    showMessage('鏁版嵁瀵煎叆澶辫触: ' + error.message, 'error');
                }
            }
        };
        input.click();
    } else {
        showMessage('鏁版嵁绠＄悊妯″潡鏈垵濮嬪寲', 'error');
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
        showMessage(`${category} 鍒嗙被鏆傛棤鍙敤棰樼洰`, 'error');
        return;
    }
    const randomExam = categoryExams[Math.floor(Math.random() * categoryExams.length)];
    showMessage(`闅忔満閫夋嫨: ${randomExam.title}`, 'info');
    setTimeout(() => openExam(randomExam.id), 1000);
}

// 鏀硅繘鐗堬細棰樺簱閰嶇疆鍒楄〃锛堥粯璁ら搴撲笉鍙垹闄わ紝鍙垏鎹級
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
        <div style="background: rgba(17,24,39,0.94); padding: 20px; border-radius: 10px; margin: 20px 0; border:1px solid rgba(255,255,255,0.1); box-shadow: 0 10px 30px rgba(0,0,0,0.35); color:#e5e7eb;">
            <h3 style="margin:0 0 10px;">馃摎 棰樺簱閰嶇疆鍒楄〃</h3>
            <div style="max-height: 320px; overflow-y: auto; margin: 10px 0;">
    `;
    configs.forEach(cfg => {
        const date = new Date(cfg.timestamp).toLocaleString();
        const isActive = getActiveLibraryConfigurationKey() === cfg.key;
        const isDefault = cfg.key === 'exam_index';
        const label = isDefault ? '榛樿棰樺簱' : (cfg.name || cfg.key);
        const activeIndicator = isActive ? '锛堝綋鍓嶏級' : '';

        html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="line-height:1.3;">
                    <strong>${label}</strong> ${activeIndicator}<br>
                    <small>${date} 路 ${cfg.examCount || 0} 涓鐩?/small>
                </div>
                <div>
                    <button class="btn btn-secondary" onclick="switchLibraryConfig('${cfg.key}')" style="margin-left:10px;" ${isActive ? 'disabled' : ''}>鍒囨崲</button>
                    ${isDefault ? '' : `<button class="btn btn-warning" onclick="deleteLibraryConfig('${cfg.key}')" style="margin-left:10px;" ${isActive ? 'disabled' : ''}>鍒犻櫎</button>`}
                </div>
            </div>
        `;
    });
    html += `
            </div>
            <button class="btn btn-secondary" onclick="this.parentElement.remove()">鍏抽棴</button>
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

// 鍏煎妗ユ帴锛氬綋缁冧範椤靛彂閫?PRACTICE_COMPLETE 浣嗘湭琚?app.js 鎹曡幏鏃讹紝鐩存帴淇濆瓨璁板綍
function setupCompletionMessageBridge() {
    window.addEventListener('message', (event) => {
        try {
            if (event.origin && event.origin !== 'null' && event.origin !== window.location.origin) {
                return;
            }
        } catch (_) {}

        const msg = event.data || {};
        if (msg && msg.type === 'PRACTICE_COMPLETE') {
            try {
                const payload = msg.data || {};
                const examId = payload.examId || payload.originalExamId;
                if (examId && window.app && typeof window.app.saveRealPracticeData === 'function') {
                    console.log('[Bridge] 鎹曡幏 PRACTICE_COMPLETE锛屽啓鍏ヨ褰?', examId);
                    window.app.saveRealPracticeData(examId, payload);
                    // 鍐欏叆鍚庡埛鏂癠I
                    setTimeout(() => {
                        try { syncPracticeRecords(); } catch (_) {}
                    }, 300);
                }
            } catch (e) {
                console.warn('[Bridge] 淇濆瓨璁板綍澶辫触:', e);
            }
        }
    });
}

// 锛堝凡绉婚櫎锛夊鍑鸿皟璇曚俊鎭嚱鏁板湪褰撳墠鐗堟湰涓嶅啀鏆撮湶鍒拌缃〉鎸夐挳





