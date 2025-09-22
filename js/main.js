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
// 闄嶇骇鎻℃墜鏄犲皠锛歴essionId -> { examId, timer }
const fallbackExamSessions = new Map();


// --- Initialization ---
function initializeLegacyComponents() {
    try { showMessage('绯荤粺鍑嗗灏辩华', 'success'); } catch(_) {}

    // Setup UI Listeners
    const folderPicker = document.getElementById('folder-picker');
    if (folderPicker) {
        folderPicker.addEventListener('change', handleFolderSelection);
    }

    // Initialize components
    if (window.PDFHandler) {
        pdfHandler = new PDFHandler();
        console.log('[System] PDF澶勭悊鍣ㄥ凡鍒濆鍖?);
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

    // Clean up old cache and configurations for v1.1.0 upgrade (one-time only)
    try {
      const done = localStorage.getItem('upgrade_v1_1_0_cleanup_done');
      if (!done) {
        cleanupOldCache().finally(() => {
          try { localStorage.setItem('upgrade_v1_1_0_cleanup_done','1'); } catch(_) {}
        });
      }
    } catch(_) {}

    // 闃叉绱㈠紩鍦ㄦ瘡娆″姞杞芥椂琚竻绌?- 鏂板淇3A
    try {
      const cleanupDone = localStorage.getItem('upgrade_v1_1_0_cleanup_done');
      if (!cleanupDone) {
        console.log('[System] 棣栨杩愯锛屾墽琛屽崌绾ф竻鐞?..');
        cleanupOldCache().finally(() => {
          try { localStorage.setItem('upgrade_v1_1_0_cleanup_done','1'); } catch(_) {}
        });
      } else {
        console.log('[System] 鍗囩骇娓呯悊宸插畬鎴愶紝璺宠繃閲嶅娓呯悊');
      }
    } catch(_) {}


    // Load data and setup listeners
    loadLibrary();
    syncPracticeRecords(); // Load initial records and update UI
    setupMessageListener(); // Listen for updates from child windows
}

// Clean up old cache and configurations
async function cleanupOldCache() {
    try {
        console.log('[System] 姝ｅ湪娓呯悊鏃х紦瀛樹笌閰嶇疆...');
        await storage.remove('exam_index');
        await storage.remove('active_exam_index_key');
        await storage.set('exam_index_configurations', []);
        console.log('[System] 鏃х紦瀛樻竻鐞嗗畬鎴?);
    } catch (error) {
        console.warn('[System] 娓呯悊鏃х紦瀛樻椂鍑洪敊:', error);
    }
}


// --- Data Loading and Management ---

async function syncPracticeRecords() {
    console.log('[System] 姝ｅ湪浠庡瓨鍌ㄤ腑鍚屾缁冧範璁板綍...');
    let records = [];
    try {
        // Prefer normalized records from ScoreStorage via PracticeRecorder
        const pr = window.app && window.app.components && window.app.components.practiceRecorder;
        if (pr && typeof pr.getPracticeRecords === 'function') {
            const maybePromise = pr.getPracticeRecords();
            const res = (typeof maybePromise?.then === 'function') ? await maybePromise : maybePromise;
            records = Array.isArray(res) ? res : [];
        } else {
            // Fallback: read raw storage and defensively normalize minimal fields
            const raw = await storage.get('practice_records', []) || [];
            const base = Array.isArray(raw) ? raw : [];
            records = base.map(r => {
                const rd = (r && r.realData) || {};
                const sInfo = r && (r.scoreInfo || rd.scoreInfo) || {};
                const correct = (typeof r.correctAnswers === 'number') ? r.correctAnswers : (typeof sInfo.correct === 'number' ? sInfo.correct : (typeof r.score === 'number' ? r.score : 0));
                const total = (typeof r.totalQuestions === 'number') ? r.totalQuestions : (typeof sInfo.total === 'number' ? sInfo.total : (rd.answers ? Object.keys(rd.answers).length : 0));
                const acc = (typeof r.accuracy === 'number') ? r.accuracy : (total > 0 ? (correct / total) : 0);
                const pct = (typeof r.percentage === 'number') ? r.percentage : Math.round(acc * 100);
                const dur = (typeof r.duration === 'number') ? r.duration : (typeof rd.duration === 'number' ? rd.duration : 0);
                return { ...r, accuracy: acc, percentage: pct, duration: dur, correctAnswers: (r.correctAnswers ?? correct), totalQuestions: (r.totalQuestions ?? total) };
            });
        }
    } catch (e) {
        console.warn('[System] 鍚屾璁板綍鏃跺彂鐢熼敊璇紝浣跨敤瀛樺偍鍘熷鏁版嵁:', e);
        const raw = await storage.get('practice_records', []);
        records = Array.isArray(raw) ? raw : [];
    }

    // 鏂板淇3D锛氱‘淇濆叏灞€鍙橀噺鏄疷I鐨勫崟涓€鏁版嵁婧?
    window.practiceRecords = records;
    practiceRecords = records; // also update the local-scoped variable

    console.log(`[System] ${records.length} 鏉＄粌涔犺褰曞凡鍔犺浇鍒板唴瀛樸€俙);
    updatePracticeView();
}

function setupMessageListener() {
    window.addEventListener('message', (event) => {
        // 鏇村吋瀹圭殑瀹夊叏妫€鏌ワ細鍏佽鍚屾簮鎴杅ile鍗忚涓嬬殑瀛愮獥鍙?        try {
            if (event.origin && event.origin !== 'null' && event.origin !== window.location.origin) {
                return;
            }
        } catch (_) {}

        const data = event.data || {};
        const type = data.type;
        if (type === 'SESSION_READY') {
            // 瀛愰〉鏈惡甯?sessionId锛岃繖閲屽熀浜?event.source 鍖归厤瀵瑰簲浼氳瘽骞跺仠姝㈡彙鎵嬮噸璇?            try {
                for (const [sid, rec] of fallbackExamSessions.entries()) {
                    if (rec && rec.win === event.source) {
                        if (rec.timer) clearInterval(rec.timer);
                        console.log('[Fallback] 浼氳瘽灏辩华(鍖归厤鍒扮獥鍙?:', sid);
                        break;
                    }
                }
            } catch (_) {}
        } else if (type === 'PRACTICE_COMPLETE' || type === 'practice_completed') {
            const sessionId = (data && data.sessionId) || null;
            const rec = sessionId ? fallbackExamSessions.get(sessionId) : null;
            if (rec) {
                console.log('[Fallback] 鏀跺埌缁冧範瀹屾垚锛堥檷绾ц矾寰勶級锛屼繚瀛樼湡瀹炴暟鎹?);
                savePracticeRecordFallback(rec.examId, data).finally(() => {
                    try { if (rec && rec.timer) clearInterval(rec.timer); } catch(_) {}
                    try { fallbackExamSessions.delete(sessionId); } catch(_) {}
                    showMessage('缁冧範宸插畬鎴愶紝姝ｅ湪鏇存柊璁板綍...', 'success');
                    setTimeout(syncPracticeRecords, 300);
                });
            } else {
                console.log('[System] 鏀跺埌缁冧範瀹屾垚娑堟伅锛屾鍦ㄥ悓姝ヨ褰?..');
                showMessage('缁冧範宸插畬鎴愶紝姝ｅ湪鏇存柊璁板綍...', 'success');
                setTimeout(syncPracticeRecords, 300);
            }
        }
    });
}

// 闄嶇骇淇濆瓨锛氬皢 PRACTICE_COMPLETE 鐨勭湡瀹炴暟鎹啓鍏?practice_records锛堜笌鏃ц鍥惧瓧娈靛吋瀹癸級
async function savePracticeRecordFallback(examId, realData) {
  try {
    const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
    const exam = list.find(e => e.id === examId) || {};

    const sInfo = realData && realData.scoreInfo ? realData.scoreInfo : {};
    const correct = typeof sInfo.correct === 'number' ? sInfo.correct : 0;
    const total = typeof sInfo.total === 'number' ? sInfo.total : (realData.answers ? Object.keys(realData.answers).length : 0);
    const acc = typeof sInfo.accuracy === 'number' ? sInfo.accuracy : (total > 0 ? correct / total : 0);
    const pct = typeof sInfo.percentage === 'number' ? sInfo.percentage : Math.round(acc * 100);

    const record = {
      id: Date.now(),
      examId: examId,
      title: exam.title || realData.title || '',
      category: exam.category,
      frequency: exam.frequency,
      realData: {
        score: correct,
        totalQuestions: total,
        accuracy: acc,
        percentage: pct,
        duration: realData.duration,
        answers: realData.answers || {},
        correctAnswers: realData.correctAnswers || {},
        interactions: realData.interactions || [],
        isRealData: true,
        source: sInfo.source || 'fallback'
      },
      dataSource: 'real',
      date: new Date().toISOString(),
      sessionId: realData.sessionId,
      timestamp: Date.now(),
      // 鍏煎鏃ц鍥惧瓧娈?      score: correct,
      correctAnswers: correct,
      totalQuestions: total,
      accuracy: acc,
      percentage: pct,
      answers: realData.answers || {},
      startTime: new Date((realData.startTime ?? (Date.now() - (realData.duration || 0) * 1000))).toISOString(),
      endTime: new Date((realData.endTime ?? Date.now())).toISOString()
    };

    const records = await storage.get('practice_records', []);
    const arr = Array.isArray(records) ? records : [];
    arr.push(record);
    await storage.set('practice_records', arr);
    console.log('[Fallback] 鐪熷疄鏁版嵁宸蹭繚瀛樺埌 practice_records');
  } catch (e) {
    console.error('[Fallback] 淇濆瓨缁冧範璁板綍澶辫触:', e);
  }
}

async function loadLibrary(forceReload = false) {
    const startTime = performance.now();
    const activeConfigKey = await getActiveLibraryConfigurationKey();
    let cachedData = await storage.get(activeConfigKey);

    // 浠呭綋缂撳瓨涓洪潪绌烘暟缁勬椂浣跨敤缂撳瓨
    if (!forceReload && Array.isArray(cachedData) && cachedData.length > 0) {
        examIndex = normalizeExamIndex(cachedData);
        try {
            const configs = await storage.get('exam_index_configurations', []);
            if (!configs.some(c => c.key === 'exam_index')) {
                configs.push({ name: '榛樿棰樺簱', key: 'exam_index', examCount: examIndex.length || 0, timestamp: Date.now() });
                await storage.set('exam_index_configurations', configs);
            }
            const activeKey = await storage.get('active_exam_index_key');
            if (!activeKey) await storage.set('active_exam_index_key', 'exam_index');
        } catch (_) {}
        finishLibraryLoading(startTime);
        return;
    }

    // 鏂板淇3B锛氫粠鑴氭湰閲嶅缓绱㈠紩锛堥槄璇?鍚姏锛夛紝鑻ヤ袱鑰呯殕鏃犲垯涓嶅啓鍏ョ┖绱㈠紩
    try {
        let readingExams = [];
        if (Array.isArray(window.completeExamIndex)) {
            readingExams = window.completeExamIndex.map(exam => ({ ...exam, type: 'reading' }));
        }

        let listeningExams = [];
        if (Array.isArray(window.listeningExamIndex)) {
            listeningExams = window.listeningExamIndex.map(exam => ({ ...exam, type: exam.type || 'listening' }));
        }

        if (readingExams.length === 0 && listeningExams.length === 0) {
            examIndex = [];
            finishLibraryLoading(startTime); // 涓嶅啓鍏ョ┖绱㈠紩锛岄伩鍏嶆薄鏌撶紦瀛?
            return;
        examIndex = normalizeExamIndex([...readingExams, ...listeningExams]);

        examIndex = [...readingExams, ...listeningExams];
        await storage.set(activeConfigKey, examIndex);
        await saveLibraryConfiguration('榛樿棰樺簱', activeConfigKey, examIndex.length);
        await setActiveLibraryConfiguration(activeConfigKey);

        finishLibraryLoading(startTime);
    } catch (error) {
        console.error('[Library] 鍔犺浇棰樺簱澶辫触:', error);
        examIndex = [];
        finishLibraryLoading(startTime);
    }
}
function finishLibraryLoading(startTime) {
    const loadTime = performance.now() - startTime;
    try { window.examIndex = examIndex; } catch (_) {}
    // 淇棰樺簱绱㈠紩鍔犺浇閾捐矾闂锛氶『搴忎负璁剧疆window.examIndex 鈫?updateOverview() 鈫?dispatchEvent('examIndexLoaded')
    updateOverview();
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
            console.warn('[Overview] 鏈煡鍚姏绫诲埆:', exam.category, exam);
        }
    });

    const categoryContainer = document.getElementById('category-overview');
    let html = '<h3 style="grid-column: 1 / -1;">闃呰</h3>';
    ['P1','P2','P3'].forEach(cat => {
        html += ''
        + '<div class="category-card">'
        +   '<div class="category-header">'
        +     '<div class="category-icon">馃摉</div>'
        +     '<div>'
        +       '<div class="category-title">' + cat + ' 闃呰</div>'
        +       '<div class="category-meta">' + (readingStats[cat] ? readingStats[cat].total : 0) + ' 绡?/div>'
        +     '</div>'
        +   '</div>'
        +   '<div class="category-actions" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: nowrap;">'
        +     '<button class="btn" onclick="browseCategory(\'' + cat + '\', \'reading\')">馃摎 娴忚棰樺簱</button>'
        +     '<button class="btn btn-secondary" onclick="startRandomPractice(\'' + cat + '\', \'reading\')">馃幉 闅忔満缁冧範</button>'
        +   '</div>'
        + '</div>';
    });

    if (listeningExams.length > 0) {
        html += '<h3 style="margin-top: 40px; grid-column: 1 / -1;">鍚姏</h3>';
        ['P3','P4'].forEach(cat => {
            const count = listeningStats[cat] ? listeningStats[cat].total : 0;
            if (count > 0) {
                html += ''
                + '<div class="category-card">'
                +   '<div class="category-header">'
                +     '<div class="category-icon">馃帶</div>'
                +     '<div>'
                +       '<div class="category-title">' + cat + ' 鍚姏</div>'
                +       '<div class="category-meta">' + count + ' 绡?/div>'
                +     '</div>'
                +   '</div>'
                +   '<div class="category-actions" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: nowrap;">'
                +     '<button class="btn" onclick="browseCategory(\'' + cat + '\', \'listening\')">馃摎 娴忚棰樺簱</button>'
                +     '<button class="btn btn-secondary" onclick="startRandomPractice(\'' + cat + '\', \'listening\')">馃幉 闅忔満缁冧範</button>'
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
    if (s < 60) return `${s}绉抈;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}鍒嗛挓`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}灏忔椂${mm}鍒嗛挓`;
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

    const title = record.title || "鏃犳爣棰?;
    const dateText = new Date(record.date).toLocaleString();
    const percentage = (typeof record.percentage === 'number') ? record.percentage : Math.round(((record.accuracy || 0) * 100));

    item.innerHTML = ''
        + '<div class="record-info" style="cursor: ' + (bulkDeleteMode ? 'pointer' : 'default') + ';">'
        +   '<a href="#" class="practice-record-title" onclick="event.stopPropagation(); showRecordDetails(\'' + record.id + '\'); return false;"><strong>' + title + '</strong></a>'
        +   '<div class="record-meta-line">'
        +     '<small class="record-date">' + dateText + '</small>'
        +     '<small class="record-duration-value"><strong>鐢ㄦ椂</strong><strong class="duration-time" style="color: ' + durationColor + ';">' + durationStr + '</strong></small>'
        +   '</div>'
        + '</div>'
        + '<div class="record-percentage-container" style="flex-grow: 1; text-align: right; padding-right: 5px;">'
        +   '<div class="record-percentage" style="color: ' + getScoreColor(percentage) + ';">' + percentage + '%</div>'
        + '</div>'
        + '<div class="record-actions-container" style="flex-shrink: 0;">'
        +   (bulkDeleteMode ? '' : '<button class="delete-record-btn" onclick="event.stopPropagation(); deleteRecord(\'' + record.id + '\')" title="鍒犻櫎姝よ褰?>馃棏锔?/button>')
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
            // 澧炲姞鏁扮粍鍖栭槻寰?
            const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
            const exam = list.find(e => e.id === record.examId || e.title === record.title);
            return exam && exam.type === currentExamType;
        });
    }

    // --- 4. Use Virtual Scroller ---
    if (practiceListScroller) {
        practiceListScroller.destroy();
        practiceListScroller = null;
    }

    if (recordsToShow.length === 0) {
        historyContainer.innerHTML = `<div style="text-align: center; padding: 40px; opacity: 0.7;"><div style="font-size: 3em; margin-bottom: 15px;">馃搨</div><p>鏆傛棤浠讳綍缁冧範璁板綍</p></div>`;
        return;
    }
    
    if (window.VirtualScroller) {
        practiceListScroller = new VirtualScroller(historyContainer, recordsToShow, renderPracticeRecordItem, { itemHeight: 100, containerHeight: 650 }); // 澧炲姞itemHeight浠ュ尮閰嶆柊鐨刧ap鍜宲adding
    } else {
        // Fallback to simple rendering if VirtualScroller is not available
        historyContainer.innerHTML = recordsToShow.map(record => renderPracticeRecordItem(record).outerHTML).join('');
    }
}


// --- Event Handlers & Navigation ---


function browseCategory(category, type = 'reading') {
    currentCategory = category;
    currentExamType = type;
    const typeText = type === 'listening' ? '鍚姏' : '闃呰';
    document.getElementById('browse-title').textContent = `馃摎 ${category} ${typeText}棰樺簱娴忚`;
    // Navigate to browse view safely without relying on legacy showView
    if (window.app && typeof window.app.navigateToView === 'function') {
      window.app.navigateToView('browse');
    } else if (typeof window.showView === 'function') {
      showView('browse', false);
    } else {
      try {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const target = document.getElementById('browse-view');
        if (target) target.classList.add('active');
      } catch(_) {}
    }
    loadExamList(); // Ensure exam list is loaded when browsing category
}

function filterByType(type) {
    currentExamType = type;
    currentCategory = 'all';
    document.getElementById('browse-title').textContent = '馃摎 棰樺簱娴忚';
    loadExamList();
}

// 搴旂敤鍒嗙被绛涢€夛紙渚?App/鎬昏璋冪敤锛?function applyBrowseFilter(category = 'all', type = null) {
    try {
        // 褰掍竴鍖栬緭鍏ワ細鍏煎 "P1 闃呰"/"P2 鍚姏" 杩欑被鏂囨
        const raw = String(category || 'all');
        let normalizedCategory = 'all';
        const m = raw.match(/\bP[1-4]\b/i);
        if (m) normalizedCategory = m[0].toUpperCase();

        // 鑻ユ湭鏄惧紡缁欏嚭绫诲瀷锛屼粠鏂囨鎴栭搴撴帹鏂?        if (!type || type === 'all') {
            if (/闃呰/.test(raw)) type = 'reading';
            else if (/鍚姏/.test(raw)) type = 'listening';
        }
        // 鑻ユ湭鏄惧紡缁欏嚭绫诲瀷锛屽垯鏍规嵁褰撳墠棰樺簱鎺ㄦ柇锛堝悓鏃跺瓨鍦ㄦ椂涓嶉檺瀹氱被鍨嬶級
        if (!type || type === 'all') {
            try {
                const hasReading = (examIndex || []).some(e => e.category === normalizedCategory && e.type === 'reading');
                const hasListening = (examIndex || []).some(e => e.category === normalizedCategory && e.type === 'listening');
                if (hasReading && !hasListening) type = 'reading';
                else if (!hasReading && hasListening) type = 'listening';
                else type = 'all';
            } catch (_) { type = 'all'; }
        }

        currentExamType = type;
        currentCategory = normalizedCategory;
        try {
            window.__browseFilter = { category: normalizedCategory, type };
        } catch (_) {}

        // 淇濇寔鏍囬绠€娲?        const titleEl = document.getElementById('browse-title');
        if (titleEl) titleEl.textContent = '馃摎 棰樺簱娴忚';

        // 鑻ユ湭鍦ㄦ祻瑙堣鍥撅紝鍒欏敖鍔涘垏鎹?        if (typeof window.showView === 'function' && !document.getElementById('browse-view')?.classList.contains('active')) {
            window.showView('browse', false);
        }

        loadExamList();
    } catch (e) {
        console.warn('[Browse] 搴旂敤绛涢€夊け璐ワ紝鍥為€€鍒伴粯璁ゅ垪琛?', e);
        currentExamType = 'all';
        currentCategory = 'all';
        loadExamList();
    }
}

// Initialize browse view when it's activated
function initializeBrowseView() {
    console.log('[System] Initializing browse view...');
    currentCategory = 'all';
    currentExamType = 'all';
    document.getElementById('browse-title').textContent = '馃摎 棰樺簱娴忚';
    loadExamList();
}

// 鍏ㄥ眬妗ユ帴锛欻TML 鎸夐挳 onclick="browseCategory('P1','reading')"
if (typeof window.browseCategory !== 'function') {
    window.browseCategory = function(category, type) {
        try {
            if (window.app && typeof window.app.browseCategory === 'function') {
                window.app.browseCategory(category, type);
                return;
            }
        } catch (_) {}
        // 鍥為€€锛氱洿鎺ュ簲鐢ㄧ瓫閫?        try { applyBrowseFilter(category, type); } catch (_) {}
    };
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
    
    filteredExams = examsToShow;
    displayExams(filteredExams);
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
                    <div class="exam-meta">${exam.category} | ${exam.type}</div>
                </div>
            </div>
            <div class="exam-actions">
                <button class="btn exam-item-action-btn" onclick="openExam('${exam.id}')">寮€濮?/button>
                <button class="btn btn-secondary exam-item-action-btn" onclick="viewPDF('${exam.id}')">PDF</button>
            </div>
        </div>
    `;
}

function resolveExamBasePath(exam) {
  let basePath = (exam && exam.path) ? String(exam.path) : "";
  try {
    const pathMap = getPathMap();
    const type = exam && exam.type;
    const root = type && pathMap[type] && pathMap[type].root ? String(pathMap[type].root) : "";
    if (root) {
      // 閬垮厤閲嶅鍓嶇紑锛堝 ListeningPractice/ 宸插湪 path 涓級
      const normalizedBase = basePath.replace(/\\/g, '/');
      const normalizedRoot = root.replace(/\\/g, '/');
      if (!normalizedBase.startsWith(normalizedRoot)) {
        basePath = normalizedRoot + basePath;
      }
    }
  } catch (_) {}
  if (!basePath.endsWith('/')) basePath += '/';
  basePath = basePath.replace(/\\/g, '/').replace(/\/+\//g, '/');
  return basePath;
}

function getPathMap() {
  try {
    // Try to load from JSON file first
    if (window.pathMap) {
      return window.pathMap;
    }

    // 鏂板淇3F锛氳矾寰勬槧灏勪慨澶?- 灏唕eading.root缃负''
    // Fallback to embedded path map
    return {
      reading: {
        // 灏嗛槄璇婚鐩牴璺緞鎸囧悜瀹為檯鏁版嵁鎵€鍦ㄧ洰褰?
        // 璇存槑锛氭暟鎹剼鏈腑鐨?exam.path 浠呬负瀛愮洰褰曞悕锛堝 "1. P1 - A Brief History.../"锛夛紝
        // 闇€瑕佸湪杩愯鏃舵嫾鎺ュ埌鐪熷疄鏍圭洰褰曚笅
        root: '鐫＄潃杩囬」鐩粍(9.4)[134绡嘳/3. 鎵€鏈夋枃绔?9.4)[134绡嘳/',
        exceptions: {}
      },
      listening: {
        // 濡傛湰鍦颁笉瀛樺湪 ListeningPractice 鐩綍锛屽垯 PDF/HTML 灏嗘棤娉曟墦寮€锛堣纭璧勬簮宸插氨浣嶏級
        root: 'ListeningPractice/',
        exceptions: {}
      }
    };
  } catch (error) {
    console.warn('[PathNormalization] Failed to load path map:', error);
    return {};
  }
}

function buildResourcePath(exam, kind = 'html') {
    const basePath = resolveExamBasePath(exam);
    const rawName = kind === 'pdf' ? exam.pdfFilename : exam.filename;
    const file = sanitizeFilename(rawName, kind);
    return './' + encodeURI(basePath + file);
}
function sanitizeFilename(name, kind) {
    if (!name) return '';
    const s = String(name);
    if (/\.html?$/i.test(s) || /\.pdf$/i.test(s)) return s;
    // html 鎯呭喌涓嬶紝濡傛灉璇粰浜?.pdf 缁撳熬锛屼紭鍏堝皾璇?pdf.html 鍖呰椤?    if (kind === 'html' && /\.pdf$/i.test(s)) return s.replace(/\.pdf$/i, '.pdf.html');
    if (/html$/i.test(s)) return s.replace(/html$/i, '.html');
    if (/pdf$/i.test(s)) return s.replace(/pdf$/i, '.pdf');
    // 鑻ユ湭鍖呭惈鎵╁睍鍚嶏紝鎸?kind 杩藉姞
    if (kind === 'pdf') return s + '.pdf';
    return s + '.html';
}
// expose helpers globally for other modules (e.g., app.js)
window.resolveExamBasePath = resolveExamBasePath;
window.buildResourcePath = buildResourcePath;

function openExam(examId) {
  // 浼樺厛浣跨敤App娴佺▼锛堝甫浼氳瘽涓庨€氫俊锛?  if (window.app && typeof window.app.openExam === 'function') {
    try {
      window.app.openExam(examId);
      return;
    } catch (e) {
      console.warn('[Main] app.openExam 璋冪敤澶辫触锛屽惎鐢ㄩ檷绾ф彙鎵嬭矾寰?', e);
    }
  }

  // 闄嶇骇锛氭湰鍦板畬鎴愭墦寮€ + 鎻℃墜閲嶈瘯锛岀‘淇?sessionId 涓嬪彂
  const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
  const exam = list.find(e => e.id === examId);
  if (!exam) return showMessage('鏈壘鍒伴鐩?, 'error');
  if (!exam.hasHtml) return viewPDF(examId);

  const fullPath = buildResourcePath(exam, 'html');
  const examWindow = window.open(fullPath, `exam_${exam.id}`, 'width=1200,height=800,scrollbars=yes,resizable=yes');
  if (!examWindow) {
    return showMessage('鏃犳硶鎵撳紑绐楀彛锛岃妫€鏌ュ脊绐楄缃?, 'error');
  }
  showMessage('姝ｅ湪鎵撳紑: ' + exam.title, 'success');

  startHandshakeFallback(examWindow, examId);
}

// 闄嶇骇鎻℃墜锛氬惊鐜彂閫?INIT_SESSION锛岀洿鑷虫敹鍒?SESSION_READY
function startHandshakeFallback(examWindow, examId) {
  try {
    const sessionId = `${examId}_${Date.now()}`;
    const initPayload = { examId, parentOrigin: window.location.origin, sessionId };
    fallbackExamSessions.set(sessionId, { examId, timer: null, win: examWindow });

    let attempts = 0;
    const maxAttempts = 30; // ~9s
    const tick = () => {
      if (examWindow && !examWindow.closed) {
        try {
          if (attempts === 0) {
            console.log('[Fallback] 鍙戦€佸垵濮嬪寲娑堟伅鍒扮粌涔犻〉闈?', { type: 'INIT_SESSION', data: initPayload });
          }
          examWindow.postMessage({ type: 'INIT_SESSION', data: initPayload }, '*');
          examWindow.postMessage({ type: 'init_exam_session', data: initPayload }, '*');
        } catch (_) {}
      }
      attempts++;
      if (attempts >= maxAttempts) {
        const rec = fallbackExamSessions.get(sessionId);
        if (rec && rec.timer) clearInterval(rec.timer);
        fallbackExamSessions.delete(sessionId);
        console.warn('[Fallback] 鎻℃墜瓒呮椂锛岀粌涔犻〉鍙兘鏈姞杞藉寮哄櫒');
      }
    };
    const timer = setInterval(tick, 300);
    const rec = fallbackExamSessions.get(sessionId);
    if (rec) rec.timer = timer;
    tick();
  } catch (e) {
    console.warn('[Fallback] 鍚姩鎻℃墜澶辫触:', e);
  }
}

function viewPDF(examId) {
    // 澧炲姞鏁扮粍鍖栭槻寰?
    const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
    const exam = list.find(e => e.id === examId);
    if (!exam || !exam.pdfFilename) return showMessage('鏈壘鍒癙DF鏂囦欢', 'error');
    
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
        let pdfWindow = null;
        try {
            pdfWindow = window.open(pdfPath, `pdf_${Date.now()}`, 'width=1000,height=800,scrollbars=yes,resizable=yes,status=yes,toolbar=yes');
        } catch (_) {}
        if (!pdfWindow) {
            try {
                // 闄嶇骇锛氬綋鍓嶇獥鍙ｆ墦寮€
                window.location.href = pdfPath;
                return window;
            } catch (e) {
                showMessage('鏃犳硶鎵撳紑PDF绐楀彛锛岃妫€鏌ュ脊绐楄缃?, 'error');
                return null;
            }
        }
        showMessage('姝ｅ湪鎵撳紑PDF...', 'info');
        return pdfWindow;
    } catch (error) {
        console.error('[PDF] 鎵撳紑澶辫触:', error);
        showMessage('鎵撳紑PDF澶辫触', 'error');
        return null;
    }
}

// Export current exam index to a timestamped script file under assets/scripts (download)
function exportExamIndexToScriptFile(fullIndex, noteLabel = '') {
    try {
        const reading = (fullIndex || []).filter(e => e.type === 'reading').map(e => {
            const { type, ...rest } = e || {};
            return rest;
        });
        const listening = (fullIndex || []).filter(e => e.type === 'listening');

        const pad = (n) => String(n).padStart(2, '0');
        const d = new Date();
        const ts = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        const header = `// 棰樺簱閰嶇疆瀵煎嚭 ${d.toLocaleString()}\n// 璇存槑: 淇濆瓨姝ゆ枃浠跺埌 assets/scripts/ 骞跺湪闇€瑕佹椂鎵嬪姩鍦?index.html 寮曞叆浠ヨ鐩栧唴缃暟鎹甛n`;
        const content = `${header}window.completeExamIndex = ${JSON.stringify(reading, null, 2)};\n\nwindow.listeningExamIndex = ${JSON.stringify(listening, null, 2)};\n`;

        const blob = new Blob([content], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `exam-index-${ts}.js`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        try { showMessage(`棰樺簱閰嶇疆宸插鍑? exam-index-${ts}.js锛堣绉诲姩鍒?assets/scripts/锛塦, 'success'); } catch(_) {}
    } catch (e) {
        console.error('[LibraryExport] 棰樺簱閰嶇疆瀵煎嚭澶辫触:', e);
        try { showMessage('棰樺簱閰嶇疆瀵煎嚭澶辫触: ' + (e && e.message || e), 'error'); } catch(_) {}
    }
}

// --- Helper Functions ---
function normalizeExamIndex(list) {
    const listeningIds = new Set(Array.isArray(window.listeningExamIndex) ? window.listeningExamIndex.map(exam => exam.id) : []);
    return (Array.isArray(list) ? list : []).map(exam => {
        const normalized = { ...exam };
        if (!normalized.type) {
            normalized.type = listeningIds.has(normalized.id) ? 'listening' : 'reading';
        }
        if (!normalized.searchText) {
            normalized.searchText = `${normalized.title || ''} ${normalized.category || ''}`.toLowerCase();
        }
        return normalized;
    });
}
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
    messageDiv.innerHTML = '<strong>' + (type === 'error' ? '閿欒' : '鎴愬姛') + '</strong> ' + (message || '');
    container.appendChild(messageDiv);
    setTimeout(() => {
        messageDiv.style.opacity = '0';
        setTimeout(() => messageDiv.remove(), 300);
    }, duration);
}

// Other functions from the original file (simplified or kept as is)
async function getActiveLibraryConfigurationKey() {
    return await storage.get('active_exam_index_key', 'exam_index');
}
async function getLibraryConfigurations() {
    return await storage.get('exam_index_configurations', []);
}
async function saveLibraryConfiguration(name, key, examCount) {
    // Persist a record of available exam index configurations
    try {
        const configs = await storage.get('exam_index_configurations', []);
        const newEntry = { name, key, examCount, timestamp: Date.now() };
        const idx = configs.findIndex(c => c.key === key);
        if (idx >= 0) {
            configs[idx] = newEntry;
        } else {
            configs.push(newEntry);
        }
        await storage.set('exam_index_configurations', configs);
    } catch (e) {
        console.error('[LibraryConfig] 淇濆瓨棰樺簱閰嶇疆澶辫触:', e);
    }
}
async function setActiveLibraryConfiguration(key) {
    try {
        await storage.set('active_exam_index_key', key);
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
    modal.style.background = 'linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.9))';
    modal.style.color = '#1e293b';
    modal.style.border = 'none';
    modal.style.borderRadius = '20px';
    modal.style.boxShadow = '0 25px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(255,255,255,0.2)';
    modal.style.backdropFilter = 'blur(20px)';
    modal.innerHTML = `
        <div class="modal-header" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 20px 20px 0 0;">
            <h2 style="margin: 0; font-size: 1.5em; font-weight: 600;">馃摎 鍔犺浇棰樺簱</h2>
            <button class="modal-close" aria-label="鍏抽棴" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.3s ease;">脳</button>
        </div>
        <div class="modal-body" style="padding: 30px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
                <div style="border: 2px solid rgba(102, 126, 234, 0.2); border-radius: 16px; padding: 24px; background: linear-gradient(135deg, rgba(102, 126, 234, 0.05), rgba(118, 75, 162, 0.05)); transition: all 0.3s ease;">
                    <h3 style="margin: 0 0 12px 0; color: #667eea; font-size: 1.2em;">馃摉 闃呰棰樺簱鍔犺浇</h3>
                    <p style="margin: 0 0 20px 0; color: #64748b; line-height: 1.6;">鏀寔鍏ㄩ噺閲嶈浇涓庡閲忔洿鏂般€傝涓婁紶鍖呭惈棰樼洰HTML/PDF鐨勬牴鏂囦欢澶广€?/p>
                    <div style="display:flex; gap:12px; flex-wrap: wrap;">
                        <button class="btn" id="reading-full-btn" style="background: linear-gradient(135deg, #667eea, #764ba2); border: none; color: white; padding: 12px 20px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.3s ease;">鍏ㄩ噺閲嶈浇</button>
                        <button class="btn btn-secondary" id="reading-inc-btn" style="background: rgba(102, 126, 234, 0.1); border: 2px solid rgba(102, 126, 234, 0.3); color: #667eea; padding: 12px 20px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.3s ease;">澧為噺鏇存柊</button>
                    </div>
                    <input type="file" id="reading-full-input" webkitdirectory multiple style="display:none;" />
                    <input type="file" id="reading-inc-input" webkitdirectory multiple style="display:none;" />
                    <div style="margin-top:16px; font-size: 0.85em; color: #94a3b8;">
                        馃挕 寤鸿璺緞锛?../3. 鎵€鏈夋枃绔?9.4)[134绡嘳/...
                    </div>
                </div>
                <div style="border: 2px solid rgba(118, 75, 162, 0.2); border-radius: 16px; padding: 24px; background: linear-gradient(135deg, rgba(118, 75, 162, 0.05), rgba(102, 126, 234, 0.05)); transition: all 0.3s ease;">
                    <h3 style="margin: 0 0 12px 0; color: #764ba2; font-size: 1.2em;">馃帶 鍚姏棰樺簱鍔犺浇</h3>
                    <p style="margin: 0 0 20px 0; color: #64748b; line-height: 1.6;">鏀寔鍏ㄩ噺閲嶈浇涓庡閲忔洿鏂般€傝涓婁紶鍖呭惈棰樼洰HTML/PDF/闊抽鐨勬牴鏂囦欢澶广€?/p>
                    <div style="display:flex; gap:12px; flex-wrap: wrap;">
                        <button class="btn" id="listening-full-btn" style="background: linear-gradient(135deg, #764ba2, #667eea); border: none; color: white; padding: 12px 20px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.3s ease;">鍏ㄩ噺閲嶈浇</button>
                        <button class="btn btn-secondary" id="listening-inc-btn" style="background: rgba(118, 75, 162, 0.1); border: 2px solid rgba(118, 75, 162, 0.3); color: #764ba2; padding: 12px 20px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.3s ease;">澧為噺鏇存柊</button>
                    </div>
                    <input type="file" id="listening-full-input" webkitdirectory multiple style="display:none;" />
                    <input type="file" id="listening-inc-input" webkitdirectory multiple style="display:none;" />
                    <div style="margin-top:16px; font-size: 0.85em; color: #94a3b8;">
                        馃挕 寤鸿璺緞锛歀isteningPractice/P3 鎴?ListeningPractice/P4
                    </div>
                </div>
            </div>
            <div style="margin-top:24px; padding: 20px; background: linear-gradient(135deg, rgba(102, 126, 234, 0.05), rgba(118, 75, 162, 0.05)); border-radius: 12px; border: 1px solid rgba(102, 126, 234, 0.1);">
                <div style="font-weight:600; color: #1e293b; margin-bottom: 12px; font-size: 1.1em;">馃搵 鎿嶄綔璇存槑</div>
                <ul style="margin:0; padding-left: 20px; line-height:1.7; color: #64748b;">
                    <li>鍏ㄩ噺閲嶈浇浼氭浛鎹㈠綋鍓嶉厤缃腑瀵瑰簲绫诲瀷锛堥槄璇?鍚姏锛夌殑鍏ㄩ儴绱㈠紩锛屽苟淇濈暀鍙︿竴绫诲瀷鍘熸湁鏁版嵁銆?/li>
                    <li>澧為噺鏇存柊浼氬皢鏂版枃浠剁敓鎴愮殑鏂扮储寮曡拷鍔犲埌褰撳墠閰嶇疆銆傝嫢褰撳墠涓洪粯璁ら厤缃紝鍒欎細鑷姩澶嶅埗涓烘柊閰嶇疆鍚庡啀杩藉姞锛岀‘淇濋粯璁ら厤缃笉琚奖鍝嶃€?/li>
                </ul>
            </div>
        </div>
        <div class="modal-footer" style="padding: 20px 30px; background: rgba(248, 250, 252, 0.8); border-radius: 0 0 20px 20px; border-top: 1px solid rgba(226, 232, 240, 0.5);">
            <button class="btn btn-secondary" id="close-loader" style="background: rgba(100, 116, 139, 0.1); border: 2px solid rgba(100, 116, 139, 0.2); color: #64748b; padding: 12px 24px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.3s ease;">鍏抽棴</button>
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

// expose modal launcher globally for SettingsPanel button
try { window.showLibraryLoaderModal = showLibraryLoaderModal; } catch(_) {}

async function handleLibraryUpload(options, files) {
    const { type, mode } = options;
    try {
        let label = '';
        if (mode === 'incremental') {
            label = prompt('涓烘娆″閲忔洿鏂拌緭鍏ヤ竴涓枃浠跺す鏍囩', '澧為噺-' + new Date().toISOString().slice(0,10)) || '';
            if (label) {
                showMessage('浣跨敤鏍囩: ' + label, 'info');
            }
            if (!detectFolderPlacement(files, type)) {
                const proceed = confirm('妫€娴嬪埌鏂囦欢澶逛笉鍦ㄦ帹鑽愮殑缁撴瀯涓€俓n闃呰: ...\n鍚姏: ListeningPractice/P3 or P4\n鏄惁缁х画?');
                if (!proceed) return;
            }
        }

        showMessage('姝ｅ湪瑙ｆ瀽鏂囦欢骞舵瀯寤虹储寮?..', 'info');
        const additions = await buildIndexFromFiles(files, type, label);
        if (additions.length === 0) {
            showMessage('浠庢墍閫夋枃浠朵腑鏈娴嬪埌浠讳綍棰樼洰', 'warning');
            return;
        }

        const activeKey = await getActiveLibraryConfigurationKey();
        const currentIndex = await storage.get(activeKey, examIndex) || [];

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
            await storage.set(targetKey, newIndex);
            await saveLibraryConfiguration(configName, targetKey, newIndex.length);
            await setActiveLibraryConfiguration(targetKey);
            // 瀵煎嚭涓烘椂闂村懡鍚嶈剼鏈紝渚夸簬缁熶竴绠＄悊
            try { exportExamIndexToScriptFile(newIndex, configName); } catch(_) {}
            showMessage('鏂扮殑棰樺簱閰嶇疆宸插垱寤哄苟婵€娲伙紱姝ｅ湪閲嶆柊鍔犺浇...', 'success');
            setTimeout(() => { location.reload(); }, 800);
            return;
        }

        const isDefault = activeKey === 'exam_index';
        let targetKey = activeKey;
        let configName = '';
        if (mode === 'incremental' && isDefault) {
            // Create a new configuration so as not to affect default
            targetKey = `exam_index_${Date.now()}`;
            configName = `${type === 'reading' ? '闃呰' : '鍚姏'}澧為噺-${new Date().toLocaleString()}`;
            await storage.set(targetKey, newIndex);
            await saveLibraryConfiguration(configName, targetKey, newIndex.length);
            await setActiveLibraryConfiguration(targetKey);
            showMessage('鏂扮殑棰樺簱閰嶇疆宸插垱寤哄苟婵€娲伙紱姝ｅ湪閲嶆柊鍔犺浇...', 'success');
            setTimeout(() => { location.reload(); }, 800);
            return;
        }

        // Save to the current active key锛堥潪榛樿閰嶇疆涓嬬殑澧為噺鏇存柊锛?
        await storage.set(targetKey, newIndex);
        const incName = `${type === 'reading' ? '闃呰' : '鍚姏'}澧為噺-${new Date().toLocaleString()}`;
        await saveLibraryConfiguration(incName, targetKey, newIndex.length);
        showMessage('绱㈠紩宸叉洿鏂帮紱姝ｅ湪鍒锋柊鐣岄潰...', 'success');
        examIndex = newIndex;
        // 涔熷鍑轰竴娆★紝渚夸簬褰掓。
        try { exportExamIndexToScriptFile(newIndex, incName); } catch(_) {}
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

// 鍏煎瀵煎叆锛氭敮鎸佸绉嶆棫鏍煎紡锛坮ecords/practice_records 椤跺眰/宓屽锛夛紝鑷姩褰掍竴鍖栧苟鍚堝苟
async function importData() {
    try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const text = await file.text();
            let json;
            try { json = JSON.parse(text); } catch (err) {
                showMessage('瀵煎叆澶辫触锛欽SON 瑙ｆ瀽閿欒', 'error');
                return;
            }

            // 鎻愬彇璁板綍鏁扮粍锛堝敖鍙兘鍏煎锛?            let imported = [];
            if (Array.isArray(json)) {
                imported = json;
            } else if (Array.isArray(json.records)) {
                imported = json.records;
            } else if (Array.isArray(json.practice_records)) {
                imported = json.practice_records;
            } else if (json.data && (Array.isArray(json.data.practice_records) || (json.data.practice_records && Array.isArray(json.data.practice_records.data)))) {
                imported = Array.isArray(json.data.practice_records) ? json.data.practice_records : (json.data.practice_records.data || []);
            } else if (json.data && Array.isArray(json.data.records)) {
                imported = json.data.records;
            }

            if (!Array.isArray(imported)) imported = [];

            // 褰掍竴鍖栨瘡鏉¤褰曪紝淇濈暀瀛楁浠ラ€傞厤褰撳墠 UI/缁熻
            const normalized = imported.map((r) => {
                try {
                    const base = { ...r };
                    // 缁熶竴 id 绫诲瀷
                    if (base.id == null) base.id = Date.now() + Math.random().toString(36).slice(2,9);
                    // 鏃堕棿涓庢椂闀?                    if (!base.startTime && base.date) base.startTime = base.date;
                    if (!base.endTime && base.startTime && typeof base.duration === 'number') {
                        base.endTime = new Date(new Date(base.startTime).getTime() + (base.duration*1000)).toISOString();
                    }
                    // 缁熻瀛楁
                    const rd = base.realData || {};
                    const sInfo = base.scoreInfo || rd.scoreInfo || {};
                    const correct = typeof base.correctAnswers === 'number' ? base.correctAnswers : (typeof base.score === 'number' ? base.score : (typeof sInfo.correct === 'number' ? sInfo.correct : 0));
                    const total = typeof base.totalQuestions === 'number' ? base.totalQuestions : (typeof sInfo.total === 'number' ? sInfo.total : (rd.answers ? Object.keys(rd.answers).length : 0));
                    const acc = typeof base.accuracy === 'number' ? base.accuracy : (total > 0 ? (correct/total) : 0);
                    const pct = typeof base.percentage === 'number' ? base.percentage : Math.round(acc*100);
                    base.score = correct;
                    base.correctAnswers = correct;
                    base.totalQuestions = total;
                    base.accuracy = acc;
                    base.percentage = pct;
                    // 纭繚 answers/answerComparison 缁撴瀯瀛樺湪
                    if (!base.answers && rd.answers) base.answers = rd.answers;
                    if (!base.answerComparison && rd.answerComparison) base.answerComparison = rd.answerComparison;
                    // 鏈€缁堜繚璇佸繀瑕佸瓧娈?                    if (!base.date && base.startTime) base.date = base.startTime;
                    return base;
                } catch (_) {
                    return r;
                }
            });

            // 鍚堝苟鍏ュ簱锛堝幓閲嶏細鎸?id/sessionId锛?            let existing = await storage.get('practice_records', []);
            existing = Array.isArray(existing) ? existing : [];
            const byId = new Map(existing.map(x => [String(x.id), true]));
            const bySession = new Map(existing.map(x => [String(x.sessionId||''), true]));
            const merged = existing.slice();
            for (const r of normalized) {
                const idKey = String(r.id);
                const sidKey = String(r.sessionId||'');
                if (byId.has(idKey) || (sidKey && bySession.has(sidKey))) continue;
                merged.push(r);
            }

            await storage.set('practice_records', merged);
            showMessage(`瀵煎叆瀹屾垚锛氭柊澧?${merged.length - existing.length} 鏉¤褰昤, 'success');
            syncPracticeRecords();
        };
        input.click();
    } catch (e) {
        console.error('瀵煎叆澶辫触:', e);
        showMessage('瀵煎叆澶辫触: ' + e.message, 'error');
    }
}

function searchExams(query) {
    if (window.performanceOptimizer && typeof window.performanceOptimizer.debounce === 'function') {
        const debouncedSearch = window.performanceOptimizer.debounce(performSearch, 300, 'exam_search');
        debouncedSearch(query);
    } else {
        // Fallback: direct call if optimizer not available
        performSearch(query);
    }
}

function performSearch(query) {
    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) {
        displayExams(filteredExams || examIndex);
        return;
    }
    
    // 璋冭瘯鏃ュ織
    console.log('[Search] 鎵ц鎼滅储锛屾煡璇㈣瘝:', normalizedQuery);
    console.log('[Search] 褰撳墠 filteredExams 鏁伴噺:', (filteredExams || []).length);
    
    const searchResults = (filteredExams || examIndex).filter(exam => {
        if (exam.searchText) {
            return exam.searchText.includes(normalizedQuery);
        }
        // Fallback 鍖归厤
        return (exam.title && exam.title.toLowerCase().includes(normalizedQuery)) ||
               (exam.category && exam.category.toLowerCase().includes(normalizedQuery));
    });
    
    console.log('[Search] 鎼滅储缁撴灉鏁伴噺:', searchResults.length);
    displayExams(searchResults);
}

/* Replaced by robust exporter below */
async function exportPracticeData() {
    try {
        const records = window.storage ? (await window.storage.get('practice_records', [])) : (window.practiceRecords || []);
        const stats = window.app && window.app.userStats ? window.app.userStats : (window.practiceStats || {});

        if (!records || records.length === 0) {
            showMessage('娌℃湁缁冧範鏁版嵁鍙鍑?, 'info');
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

                showMessage('瀵煎嚭瀹屾垚', 'success');
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

async function bulkDeleteRecords() {
    const records = await storage.get('practice_records', []);
    const recordsToKeep = records.filter(record => !selectedRecords.has(record.id));

    const deletedCount = records.length - recordsToKeep.length;

    await storage.set('practice_records', recordsToKeep);
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


async function deleteRecord(recordId) {
    if (!recordId) {
        showMessage('璁板綍ID鏃犳晥', 'error');
        return;
    }

    const records = await storage.get('practice_records', []);
    const recordIndex = records.findIndex(record => String(record.id) === String(recordId));

    if (recordIndex === -1) {
        showMessage('鏈壘鍒拌褰?, 'error');
        return;
    }

    const record = records[recordIndex];
    const confirmMessage = `纭畾瑕佸垹闄よ繖鏉＄粌涔犺褰曞悧锛焅n\n棰樼洰: ${record.title}\n鏃堕棿: ${new Date(record.date).toLocaleString()}\n\n姝ゆ搷浣滀笉鍙仮澶嶃€俙;

    if (confirm(confirmMessage)) {
        const historyItem = document.querySelector(`[data-record-id="${recordId}"]`);
        if (historyItem) {
            historyItem.classList.add('deleting');
            setTimeout(async () => {
                historyItem.classList.add('deleted');
                setTimeout(async () => {
                    records.splice(recordIndex, 1);
                    await storage.set('practice_records', records);
                    syncPracticeRecords(); // Re-sync and update UI
                    showMessage('璁板綍宸插垹闄?, 'success');
                }, 300);
            }, 200);
        } else {
            // Fallback if element not found
            records.splice(recordIndex, 1);
            await storage.set('practice_records', records);
            syncPracticeRecords();
            showMessage('璁板綍宸插垹闄?, 'success');
        }
    }
}

async function clearPracticeData() {
    if (confirm('纭畾瑕佹竻闄ゆ墍鏈夌粌涔犺褰曞悧锛熸鎿嶄綔涓嶅彲鎭㈠銆?)) {
        practiceRecords = [];
        await storage.set('practice_records', []); // Use storage helper
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
        setTimeout(() => { location.reload(); }, 1000);
    }
}

async function showLibraryConfigList() {
    const configs = await getLibraryConfigurations();

    if (configs.length === 0) {
        showMessage('鏆傛棤棰樺簱閰嶇疆璁板綍', 'info');
        return;
    }

    let configHtml = `
                <div style="background: rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 10px; margin: 20px 0;">
                    <h3>馃摎 棰樺簱閰嶇疆鍒楄〃</h3>
                    <div style="max-height: 300px; overflow-y: auto; margin: 15px 0;">
            `;

    const activeKey = await getActiveLibraryConfigurationKey();
    configs.forEach(config => {
        const date = new Date(config.timestamp).toLocaleString();
        const isActive = activeKey === config.key;
        const activeIndicator = isActive ? ' (褰撳墠)' : '';

        configHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <div>
                            <strong>${config.name}</strong> ${activeIndicator}<br>
                            <small>${date} - ${config.examCount} 涓鐩?/small>
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
async function switchLibraryConfig(configKey) {
    if (confirm('纭畾瑕佸垏鎹㈠埌杩欎釜棰樺簱閰嶇疆鍚楋紵椤甸潰灏嗕細鍒锋柊銆?)) {
        await setActiveLibraryConfiguration(configKey);
        showMessage('姝ｅ湪鍒囨崲棰樺簱閰嶇疆锛岄〉闈㈠皢鍒锋柊...', 'info');
        setTimeout(() => {
            location.reload();
        }, 1000);
    }
}

// 鍒犻櫎棰樺簱閰嶇疆
async function deleteLibraryConfig(configKey) {
    if (configKey === 'exam_index') {
        showMessage('榛樿棰樺簱涓嶅彲鍒犻櫎', 'warning');
        return;
    }
    if (confirm("纭畾瑕佸垹闄よ繖涓搴撻厤缃悧锛熸鎿嶄綔涓嶅彲鎭㈠銆?)) {
        let configs = await getLibraryConfigurations();
        configs = configs.filter(config => config.key !== configKey);
        await storage.set('exam_index_configurations', configs);
        await storage.remove(configKey); // 绉婚櫎瀹為檯鐨勯搴撴暟鎹?

        
        showMessage('棰樺簱閰嶇疆宸插垹闄?, 'success');
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
                    window.dataIntegrityManager.exportData();
                    showMessage('瀛樺偍绌洪棿涓嶈冻锛氬凡灏嗘暟鎹鍑轰负鏂囦欢', 'warning');
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
                            <small>${date} - ${sizeKB} KB - v${backup.version}</small>
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
    // 澧炲姞鏁扮粍鍖栭槻寰?
    const list = Array.isArray(examIndex) ? examIndex : (Array.isArray(window.examIndex) ? window.examIndex : []);
    const categoryExams = list.filter(exam => exam.category === category && exam.type === type);
    if (categoryExams.length === 0) {
        showMessage(`${category} ${type === 'reading' ? '闃呰' : '鍚姏'} 鍒嗙被鏆傛棤鍙敤棰樼洰`, 'error');
        return;
    }
    const randomExam = categoryExams[Math.floor(Math.random() * categoryExams.length)];
    showMessage(`闅忔満閫夋嫨: ${randomExam.title}`, 'info');

    // 纭繚寮瑰嚭鏂扮獥鍙ｅ姞杞介鐩紙HTML鎴朠DF锛?
    setTimeout(() => {
        if (randomExam.hasHtml) {
            // 鏈塇TML鏂囦欢锛屽脊鍑烘柊绐楀彛
            openExam(randomExam.id);
        } else {
            // 鍙湁PDF鏂囦欢锛屼篃瑕佸脊鍑烘柊绐楀彛
            const fullPath = buildResourcePath(randomExam, 'pdf');
            const pdfWindow = window.open(fullPath, `exam_${randomExam.id}`, 'width=1200,height=800,scrollbars=yes,resizable=yes');
            if (pdfWindow) {
                showMessage('姝ｅ湪鎵撳紑: ' + randomExam.title, 'success');
            } else {
                showMessage('鏃犳硶鎵撳紑绐楀彛锛岃妫€鏌ュ脊绐楄缃?, 'error');
            }
        }
    }, 1000);
}

// 鏀硅繘鐗堬細棰樺簱閰嶇疆鍒楄〃锛堥粯璁ら搴撲笉鍙垹闄わ紝鍙垏鎹級
async function showLibraryConfigListV2() {
    let configs = await getLibraryConfigurations();
    if (configs.length === 0) {
        try {
            const count = Array.isArray(window.examIndex) ? window.examIndex.length : 0;
            configs = [{ name: '榛樿棰樺簱', key: 'exam_index', examCount: count, timestamp: Date.now() }];
            await storage.set('exam_index_configurations', configs);
            const activeKey = await storage.get('active_exam_index_key');
            if (!activeKey) await storage.set('active_exam_index_key', 'exam_index');
        } catch (_) {}
    }

    let html = `
        <div style="background: #D9CBBA; padding: 20px; border-radius: 10px; margin: 20px 0; border:2px solid #737373; box-shadow: 0 10px 30px rgba(0,0,0,0.35); color:#000000;">
            <h3 style="margin:0 0 10px; color: #000000;">馃摎 棰樺簱閰嶇疆鍒楄〃</h3>
            <div style="max-height: 320px; overflow-y: auto; margin: 10px 0;">
    `;
    const activeKey = await getActiveLibraryConfigurationKey();
    configs.forEach(cfg => {
        const date = new Date(cfg.timestamp).toLocaleString();
        const isActive = activeKey === cfg.key;
        const isDefault = cfg.key === 'exam_index';
        const label = isDefault ? '榛樿棰樺簱' : (cfg.name || cfg.key);
        const activeIndicator = isActive ? '锛堝綋鍓嶏級' : '';

        html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid rgba(0,0,0,0.1); color: #000000; background: linear-gradient(135deg, #BF755A, #a0654a); border-radius: 8px; margin: 5px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="line-height:1.3;">
                    <strong style="color: #F2F2F2;">${label}</strong> ${activeIndicator}<br>
                    <small style="color: #F2F2F2;">${date} - ${cfg.examCount || 0} 涓鐩?/small>
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


// 锛堝凡绉婚櫎锛夊鍑鸿皟璇曚俊鎭嚱鏁板湪褰撳墠鐗堟湰涓嶅啀鏆撮湶鍒拌缃〉鎸夐挳




// Safe exporter (compat with old UI)
async function exportPracticeData() {
    try {
        if (window.dataIntegrityManager && typeof window.dataIntegrityManager.exportData === 'function') {
            window.dataIntegrityManager.exportData();
            try { showMessage('瀵煎嚭瀹屾垚', 'success'); } catch(_) {}
            return;
        }
    } catch(_) {}
    try {
        var records = (window.storage && storage.get) ? (await storage.get('practice_records', [])) : (window.practiceRecords || []);
        var blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = 'practice-records.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        try { showMessage('瀵煎嚭瀹屾垚', 'success'); } catch(_) {}
    } catch(e) {
        try { showMessage('瀵煎嚭澶辫触: ' + (e && e.message || e), 'error'); } catch(_) {}
        console.error('[Export] failed', e);
    }
}

// 鏂板淇3C锛氬湪js/main.js鏈熬娣诲姞鐩戝惉examIndexLoaded浜嬩欢锛岃皟鐢╨oadExamList()骞堕殣钘忔祻瑙堥〉spinner
window.addEventListener('examIndexLoaded', () => {
  try {
    if (typeof loadExamList === 'function') loadExamList();
    const loading = document.querySelector('#browse-view .loading');
    if (loading) loading.style.display = 'none';
  } catch (_) {}
});


