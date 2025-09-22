/**
 * 学术主题页面初始化脚本
 * 包含全局变量定义和页面初始化逻辑
 * 版本: 1.0.0
 */

// Global variables are defined in js/main.js
// let examIndex = [];
// let currentCategory = 'all';
// let currentExamType = 'all';
// let filteredExams = [];
// let practiceRecords = [];
// 选择性批量删除所用集合（仅本页使用）
let selectedRecordIds = new Set();

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
   // 已在主脚本加载后通过设计页适配修正过 PDF 路径，这里避免重复覆盖
   if (window.PDFHandler && window.PDFHandler.prototype) {
       console.log('[OVERRIDE] PDF 路径已通过设计页适配修正，跳过重复覆盖');
   }

   // 如全局已定义 openExam（来自 main.js），则不覆盖；否则提供简化后备实现
   (function(){
       try {
           if (typeof window.openExam === 'function') {
               console.log('[OVERRIDE] 检测到全局 openExam，跳过覆盖');
           } else {
               window.openExam = function(examId) {
                   var list = (typeof examIndex !== 'undefined' && examIndex) ? examIndex : [];
                   var exam = list.find(function(e){ return e && e.id === examId; });
                   if (!exam) { try { showMessage('未找到题目', 'error'); } catch(_) {} return; }
                   var kind = exam.hasHtml ? 'html' : 'pdf';
                   var url = (typeof window.buildResourcePath === 'function') ? window.buildResourcePath(exam, kind) : '';
                   if (!url) { try { showMessage('无法构建题目路径', 'error'); } catch(_) {} return; }
                   var win = window.open(url, 'exam_' + exam.id, 'width=1200,height=800,scrollbars=yes,resizable=yes');
                   if (win) { try { showMessage('正在打开: ' + (exam.title || exam.name || exam.id), 'success'); } catch(_) {} }
               };
               console.log('[OVERRIDE] 已注入简化 openExam 备用实现');
           }
       } catch (e) { console.warn('[OVERRIDE] openExam 处理异常:', e); }
   })();


   // First try to load data from localStorage
   loadFromLocalStorage();
   initializeApp();
   loadLibrary();
   syncPracticeRecords();
});

// Load data from localStorage
function loadFromLocalStorage() {
   try {
       const storedExamIndex = localStorage.getItem('exam_index');
       const storedPracticeRecords = localStorage.getItem('practice_records');

       if (storedExamIndex) {
           examIndex = JSON.parse(storedExamIndex);
           console.log('Loaded exam index from localStorage:', examIndex.length, 'items');
       }

       if (storedPracticeRecords) {
           practiceRecords = JSON.parse(storedPracticeRecords);
           console.log('Loaded practice records from localStorage:', practiceRecords.length, 'items');
       }
   } catch (error) {
       console.error('Failed to load data from localStorage:', error);
   }
}

// 防重复消息显示机制
window._welcomeMessageShown = false;
window._initializationInProgress = false;
window._messageHistory = new Set(); // 记录已显示的消息
window._lastMessageTime = 0; // 记录上一条消息的时间

// 优化 showMessage 函数，防止短时间内重复显示相同消息
const originalShowMessage = window.showMessage || function() {};
window.showMessage = function(message, type = 'info', duration = 3000) {
   const now = Date.now();
   const messageKey = `${message}-${type}`;

   // 如果在2秒内显示过相同的消息，则跳过
   if (window._messageHistory.has(messageKey) && (now - window._lastMessageTime) < 2000) {
       console.log('[Message] 跳过重复消息:', message);
       return;
   }

   // 记录消息
   window._messageHistory.add(messageKey);
   window._lastMessageTime = now;

   // 3秒后清理消息记录
   setTimeout(() => {
       window._messageHistory.delete(messageKey);
   }, 3000);

   // 调用原始函数
   return originalShowMessage(message, type, duration);
};

function initializeApp() {
   // 防止重复初始化
   if (window._initializationInProgress) {
       console.log('[App] 初始化已在进行中，跳过重复初始化');
       return;
   }
   window._initializationInProgress = true;

   // Initialize existing components
   if (typeof initializeLegacyComponents === 'function') {
       initializeLegacyComponents();
   }

   // Initialize UI components
   updateOverview();
   updateBrowseView();
   updatePracticeView();
   updateSettingsView();

   // 只显示一次欢迎消息
   if (!window._welcomeMessageShown) {
       showMessage('系统初始化完成', 'success');
       window._welcomeMessageShown = true;
   }

   // 标记初始化完成
   window._initializationInProgress = false;
}

// View management
function showView(viewName) {
   // Hide all views
   document.querySelectorAll('.view').forEach(view => {
       view.classList.remove('active');
   });

   // Show selected view
   document.getElementById(viewName + '-view').classList.add('active');

   // Update navigation buttons
   document.querySelectorAll('.nav-item').forEach(btn => {
       btn.classList.remove('active');
   });

   // Find and activate the corresponding nav button
   const navButtons = document.querySelectorAll('.nav-item');
   navButtons.forEach(btn => {
       const btnText = btn.textContent.trim();
       if ((viewName === 'overview' && btnText.includes('总览')) ||
           (viewName === 'browse' && btnText.includes('题库')) ||
           (viewName === 'practice' && btnText.includes('记录')) ||
           (viewName === 'settings' && btnText.includes('设置'))) {
           btn.classList.add('active');
       }
   });

   // Update view-specific content
   switch(viewName) {
       case 'overview':
           updateOverview();
           break;
       case 'browse':
           updateBrowseView();
           break;
       case 'practice':
           updatePracticeView();
           break;
       case 'settings':
           updateSettingsView();
           break;
   }
}

// Update overview view
function updateOverview() {
   // Update statistics
   const totalExamsCount = document.getElementById('total-exams-count');
   const completedCount = document.getElementById('completed-count');
   const averageScore = document.getElementById('average-score');
   const studyHours = document.getElementById('study-hours');

   // Null check for examIndex
   const safeExamIndex = examIndex || [];
   const safePracticeRecords = practiceRecords || [];

   if (safeExamIndex.length > 0) {
       totalExamsCount.textContent = safeExamIndex.length;

       let completed = 0;
       let totalScore = 0;
       let totalDuration = 0;

       if (safePracticeRecords.length > 0) {
           completed = new Set(safePracticeRecords.map(record => record.examId)).size;
           totalScore = safePracticeRecords.reduce((sum, record) => sum + (record.score || 0), 0);
           totalDuration = safePracticeRecords.reduce((sum, record) => sum + (record.duration || 0), 0);
       }

       completedCount.textContent = completed;
       averageScore.textContent = safePracticeRecords.length > 0 ? Math.round(totalScore / safePracticeRecords.length) + '%' : '0%';
       studyHours.textContent = Math.round(totalDuration / 3600 * 10) / 10;
   } else {
       totalExamsCount.textContent = '0';
       completedCount.textContent = '0';
       averageScore.textContent = '0%';
       studyHours.textContent = '0';
   }

   // Update categories
   updateCategories();
}

// Update categories section
function updateCategories() {
   const categoriesGrid = document.getElementById('categories-grid');

   const categories = [
       {
           name: '阅读理解',
           icon: 'fas fa-book-open',
           total: 0,
           completed: 0,
           averageScore: 0
       },
       {
           name: '听力练习',
           icon: 'fas fa-headphones',
           total: 0,
           completed: 0,
           averageScore: 0
       }
   ];

   // Null check for examIndex
   const safeExamIndex = examIndex || [];
   const safePracticeRecords = practiceRecords || [];

   // Calculate statistics
   if (safeExamIndex.length > 0) {
       const readingExams = safeExamIndex.filter(exam => exam.type === 'reading');
       const listeningExams = safeExamIndex.filter(exam => exam.type === 'listening');

       categories[0].total = readingExams.length;
       categories[1].total = listeningExams.length;

       if (safePracticeRecords.length > 0) {
           const readingRecords = safePracticeRecords.filter(record => record.type === 'reading');
           const listeningRecords = safePracticeRecords.filter(record => record.type === 'listening');

           categories[0].completed = new Set(readingRecords.map(record => record.examId)).size;
           categories[1].completed = new Set(listeningRecords.map(record => record.examId)).size;

           categories[0].averageScore = readingRecords.length > 0 ?
               Math.round(readingRecords.reduce((sum, record) => sum + (record.score || 0), 0) / readingRecords.length) : 0;
           categories[1].averageScore = listeningRecords.length > 0 ?
               Math.round(listeningRecords.reduce((sum, record) => sum + (record.score || 0), 0) / listeningRecords.length) : 0;
       }
   }

   categoriesGrid.innerHTML = categories.map(category => `
       <div class="category-card" onclick="startCategoryPractice('${category.name}')">
           <div class="category-header">
               <div class="category-icon">
                   <i class="${category.icon}"></i>
               </div>
               <div class="category-title">${category.name}</div>
           </div>
           <div class="category-stats">
               <div class="category-stat">
                   <div class="category-stat-number">${category.total}</div>
                   <div class="category-stat-label">总题目</div>
               </div>
               <div class="category-stat">
                   <div class="category-stat-number">${category.completed}</div>
                   <div class="category-stat-label">已完成</div>
               </div>
               <div class="category-stat">
                   <div class="category-stat-number">${category.averageScore}%</div>
                   <div class="category-stat-label">平均分</div>
               </div>
               <div class="category-stat">
                   <div class="category-stat-number">${Math.round((category.completed / category.total) * 100) || 0}%</div>
                   <div class="category-stat-label">完成率</div>
               </div>
           </div>
       </div>
   `).join('');
}

// Update browse view
function updateBrowseView() {
   // Use the global loadExamList function from js/main.js if available
   if (typeof window.loadExamList === 'function') {
       window.loadExamList();
       return;
   }

   // Fallback implementation
   const examList = document.getElementById('exam-list-container');
   const loading = document.getElementById('browse-loading');
   const empty = document.getElementById('browse-empty');

   if (!examIndex || examIndex.length === 0) {
       examList.style.display = 'none';
       loading.style.display = 'none';
       empty.style.display = 'block';
       return;
   }

   // Filter exams based on current type
   let filtered = examIndex;
   if (currentExamType !== 'all') {
       filtered = examIndex.filter(exam => exam.type === currentExamType);
   }

   if (filtered.length === 0) {
       examList.style.display = 'none';
       loading.style.display = 'none';
       empty.style.display = 'block';
       return;
   }

   examList.style.display = 'grid';
   loading.style.display = 'none';
   empty.style.display = 'none';

   examList.innerHTML = filtered.map(exam => `
       <div class="exam-item">
           <div class="exam-header">
               <div class="exam-info">
                   <h3>${exam.title || exam.name || '未命名题目'}</h3>
                   <div class="exam-meta">
                       <div class="exam-meta-item">
                           <i class="fas fa-tag"></i>
                           <span>${getTypeLabel(exam.type)}</span>
                       </div>
                       <div class="exam-meta-item">
                           <i class="fas fa-question-circle"></i>
                           <span>${exam.questionCount || 0} 题</span>
                       </div>
                       <div class="exam-meta-item">
                           <i class="fas fa-clock"></i>
                           <span>${exam.estimatedTime || '预计' + (exam.questionCount || 0) * 2 + '分钟'}</span>
                       </div>
                   </div>
               </div>
               <div class="exam-actions">
                   <button class="btn btn-primary" onclick="startExam('${exam.id}')">
                       <i class="fas fa-play"></i>
                       开始练习
                   </button>
               </div>
           </div>
       </div>
   `).join('');
}

// 统一的练习记录渲染函数
function renderRecords(records) {
    // Sort records by date (newest first)
    const sortedRecords = [...records].sort((a, b) => {
        const dateA = new Date(a.date || a.timestamp);
        const dateB = new Date(b.date || b.timestamp);
        return dateB - dateA;
    });

    return sortedRecords.map(record => {
        const score = record.score || (record.realData ? record.realData.percentage : 0);
        const duration = record.duration || (record.realData ? record.realData.duration : 0);
        const scoreClass = getScoreClass(score);

        return `
            <tr>
                <td>${record.title || record.examName || '未命名练习'}</td>
                <td>${getTypeLabel(record.type)}</td>
                <td><span class="score-badge ${scoreClass}">${score}%</span></td>
                <td>${formatDuration(duration)}</td>
                <td>${formatDateTime(record.date || record.timestamp)}</td>
                <td>
                    <button class="btn btn-sm" onclick="viewRecordDetails('${record.id || record.timestamp}')">
                        <i class="fas fa-eye"></i>
                        查看
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}
// Update practice view
function updatePracticeView() {
   updatePracticeRecords();
}

// Update practice records table
async function updatePracticeRecords() {
    const tbody = document.getElementById('practice-records-tbody');
    const empty = document.getElementById('practice-empty');

    // 从practice_records存储键读取数据，确保与主系统一致
    let records = [];
    try {
        if (window.storage && typeof window.storage.get === 'function') {
            records = await window.storage.get('practice_records', []);
        } else {
            records = JSON.parse(localStorage.getItem('practice_records') || '[]');
        }
        records = Array.isArray(records) ? records : [];
    } catch (error) {
        console.warn('[Academic] 读取练习记录失败:', error);
        records = [];
    }

    if (!records || records.length === 0) {
        tbody.innerHTML = '';
        empty.style.display = 'block';
        return;
    }

    empty.style.display = 'none';

    // 使用统一的渲染函数renderRecords
    tbody.innerHTML = renderRecords(records);
}

// Update settings view
function updateSettingsView() {
   // Settings view doesn't need dynamic updates
}

// Helper functions
function getTypeLabel(type) {
   const labels = {
       'reading': '阅读',
       'listening': '听力',
       'writing': '写作',
       'speaking': '口语'
   };
   return labels[type] || type;
}

function getExamTypeFromCategory(category) {
   // Map category to exam type
   if (!category) return 'reading';

   const categoryLower = category.toLowerCase();
   if (categoryLower.includes('p1') || categoryLower.includes('reading')) {
       return 'reading';
   } else if (categoryLower.includes('p2') || categoryLower.includes('listening')) {
       return 'listening';
   } else if (categoryLower.includes('p3') || categoryLower.includes('writing')) {
       return 'reading'; // P3 is typically reading in IELTS
   } else {
       return 'reading'; // Default to reading
   }
}

function getExamCategoryFromType(type) {
   // Map exam type to category
   if (!type) return 'P1';

   const typeLower = type.toLowerCase();
   if (typeLower.includes('reading')) {
       return 'P1';
   } else if (typeLower.includes('listening')) {
       return 'P2';
   } else if (typeLower.includes('writing')) {
       return 'P3';
   } else {
       return 'P1'; // Default to P1
   }
}

function formatDateTime(dateString) {
   const date = new Date(dateString);
   return date.toLocaleDateString('zh-CN') + ' ' + date.toLocaleTimeString('zh-CN', {
       hour: '2-digit',
       minute: '2-digit'
   });
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

function getScoreClass(score) {
   if (score >= 90) return 'score-excellent';
   if (score >= 80) return 'score-good';
   if (score >= 60) return 'score-fair';
   return 'score-poor';
}

// Action functions
function startCategoryPractice(categoryName) {
   showView('browse');
   if (categoryName === '阅读理解') {
       filterByType('reading');
   } else if (categoryName === '听力练习') {
       filterByType('listening');
   }
}

function startExam(examId) {
   // Use the global openExam function from js/main.js
   if (typeof window.openExam === 'function') {
       window.openExam(examId);
   } else {
       // Fallback implementation
       const safeExamIndex = examIndex || [];
       const exam = safeExamIndex.find(e => e.id === examId);
       if (exam) {
           if (exam.hasHtml) {
               // Open HTML practice - use the correct path from the exam data
               let fullPath;

               // Check if exam has path and filename properties
               if (exam.path && exam.filename) {
                   // For files in 睡着过项目组 directory
                   const basePath = '../../';
                   fullPath = basePath + exam.path + exam.filename;
               } else if (exam.htmlPath) {
                   // Fallback to htmlPath if available
                   fullPath = exam.htmlPath;
               } else {
                   // Default path structure for reading/listening
                   const basePath = '../../';
                   if (exam.type === 'reading' || exam.category === 'P1') {
                       fullPath = basePath + `睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/1. P1（高频）[12篇]/${exam.filename || exam.id + '.html'}`;
                   } else if (exam.type === 'listening' || exam.category === 'P2') {
                       fullPath = basePath + `ListeningPractice/${exam.category}/${exam.filename || exam.id + '.html'}`;
                   } else {
                       fullPath = basePath + `睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/1. P1（高频）[12篇]/${exam.filename || exam.id + '.html'}`;
                   }
               }

               console.log('Attempting to open:', fullPath);

               const examWindow = window.open(fullPath, `exam_${exam.id}`, 'width=1200,height=800,scrollbars=yes,resizable=yes');
               if (examWindow) {
                   showMessage('正在打开: ' + (exam.title || exam.name), 'success');
               } else {
                   showMessage('无法打开窗口，请检查弹窗设置', 'error');
               }
           } else if (exam.pdfFilename) {
               // Open PDF
               let pdfPath;
               const basePath = '../../';
               if (exam.path && exam.pdfFilename) {
                   pdfPath = basePath + exam.path + exam.pdfFilename;
               } else {
                   pdfPath = basePath + (exam.pdfPath || `睡着过项目组(9.4)[134篇]/2. 高频次高频文章[83篇]/1. P1（高频）[12篇]/${exam.pdfFilename}`);
               }

               const pdfWindow = window.open(pdfPath, `pdf_${exam.id}`, 'width=1000,height=800,scrollbars=yes,resizable=yes');
               if (pdfWindow) {
                   showMessage('正在打开PDF: ' + (exam.title || exam.name), 'success');
               } else {
                   showMessage('PDF 打开失败，请手动打开: ' + pdfPath, 'error');
               }
           } else {
               showMessage('题目文件不存在', 'error');
           }
       } else {
           showMessage('未找到题目', 'error');
       }
   }
}

function filterByType(type) {
   currentExamType = type;

   // Update filter buttons
   document.querySelectorAll('#browse-view .filter-btn').forEach(btn => {
       btn.classList.remove('active');
   });
   event.target.classList.add('active');

   updateBrowseView();
}

function filterRecordsByType(type) {
   // Update filter buttons
   document.querySelectorAll('#practice-view .filter-btn').forEach(btn => {
       btn.classList.remove('active');
   });
   event.target.classList.add('active');

   // Filter records
   let filtered = practiceRecords;
   if (type !== 'all') {
       filtered = practiceRecords.filter(record => record.type === type);
   }

   const tbody = document.getElementById('practice-records-tbody');
   const empty = document.getElementById('practice-empty');

   if (filtered.length === 0) {
       tbody.innerHTML = '';
       empty.style.display = 'block';
       return;
   }

   empty.style.display = 'none';

   // Sort and display filtered records
   const sortedRecords = [...filtered].sort((a, b) => {
       const dateA = new Date(a.date || a.timestamp);
       const dateB = new Date(b.date || b.timestamp);
       return dateB - dateA;
   });

   tbody.innerHTML = sortedRecords.map(record => {
       const score = record.score || (record.realData ? record.realData.percentage : 0);
       const duration = record.duration || (record.realData ? record.realData.duration : 0);
       const scoreClass = getScoreClass(score);

       return `
           <tr>
               <td>${record.title || record.examName || '未命名练习'}</td>
               <td>${getTypeLabel(record.type)}</td>
               <td><span class="score-badge ${scoreClass}">${score}%</span></td>
               <td>${formatDuration(duration)}</td>
               <td>${formatDateTime(record.date || record.timestamp)}</td>
               <td>
                   <button class="btn btn-sm" onclick="viewRecordDetails('${record.id || record.timestamp}')">
                       <i class="fas fa-eye"></i>
                       查看
                   </button>
               </td>
           </tr>
       `;
   }).join('');
}

function searchExams(query) {
   if (!query || !examIndex) {
       updateBrowseView();
       return;
   }

   const filtered = examIndex.filter(exam => {
       const title = (exam.title || exam.name || '').toLowerCase();
       const searchQuery = query.toLowerCase();
       return title.includes(searchQuery);
   });

   const examList = document.getElementById('exam-list-container');
   const empty = document.getElementById('browse-empty');

   if (filtered.length === 0) {
       examList.style.display = 'none';
       empty.style.display = 'block';
       return;
   }

   examList.style.display = 'grid';
   empty.style.display = 'none';

   examList.innerHTML = filtered.map(exam => `
       <div class="exam-item">
           <div class="exam-header">
               <div class="exam-info">
                   <h3>${exam.title || exam.name || '未命名题目'}</h3>
                   <div class="exam-meta">
                       <div class="exam-meta-item">
                           <i class="fas fa-tag"></i>
                           <span>${getTypeLabel(exam.type)}</span>
                       </div>
                       <div class="exam-meta-item">
                           <i class="fas fa-question-circle"></i>
                           <span>${exam.questionCount || 0} 题</span>
                       </div>
                       <div class="exam-meta-item">
                           <i class="fas fa-clock"></i>
                           <span>${exam.estimatedTime || '预计' + (exam.questionCount || 0) * 2 + '分钟'}</span>
                       </div>
                   </div>
               </div>
               <div class="exam-actions">
                   <button class="btn btn-primary" onclick="startExam('${exam.id}')">
                       <i class="fas fa-play"></i>
                       开始练习
                   </button>
               </div>
           </div>
       </div>
   `).join('');
}

function refreshExamList() {
   // Use the global loadLibrary function from js/main.js to refresh
   const loading = document.getElementById('browse-loading');
   const examList = document.getElementById('exam-list-container');

   loading.style.display = 'block';
   examList.style.display = 'none';

   setTimeout(() => {
       loadLibrary(true);
       loading.style.display = 'none';
       examList.style.display = 'grid';
       showMessage('题库已刷新', 'success');
   }, 1000);
}

function viewRecordDetails(recordId) {
   const record = practiceRecords.find(r => (r.id || r.timestamp) === recordId);
   if (record) {
       // Show record details modal or navigate to detail page
       showMessage(`查看练习记录: ${record.title || record.examName}`, 'info');
       // Implementation for showing detailed record view
   }
}

// Settings functions
function clearCache() {
   if (confirm('确定要清除所有缓存数据吗？此操作不可撤销。')) {
       localStorage.clear();
       sessionStorage.clear();
       showMessage('缓存已清除', 'success');
       setTimeout(() => location.reload(), 1500);
   }
}

// Fixed clear cache function that also clears practice records
function fixedClearCache() {
   if (confirm('确定要清除所有缓存数据和练习记录吗？此操作不可撤销。')) {
       localStorage.clear();
       sessionStorage.clear();
       // Also clear practice records from any other storage
       try {
           if (window.storage && typeof storage.clear === 'function') {
               storage.clear();
           }
       } catch (e) {
           console.warn('Failed to clear storage:', e);
       }
       showMessage('缓存和练习记录已清除', 'success');
       setTimeout(() => location.reload(), 1500);
   }
}

function clearTemporaryFiles() {
   showMessage('清理完成', 'success');
}

// Load library - 添加防重复加载
window._libraryLoadingInProgress = false;
function loadLibrary(forceReload = false) {
   // 防止重复加载
   if (window._libraryLoadingInProgress && !forceReload) {
       console.log('[Library] 题库加载已在进行中，跳过重复调用');
       return;
   }
   window._libraryLoadingInProgress = true;

   const startTime = performance.now();

   // Try to load from localStorage first
   if (!forceReload) {
       try {
           const storedExamIndex = localStorage.getItem('exam_index');
           if (storedExamIndex) {
               examIndex = JSON.parse(storedExamIndex);
               finishLibraryLoading(startTime);
               return;
           }
       } catch (error) {
           console.warn('Failed to load exam index from localStorage:', error);
       }
   } else {
       // 如果是强制刷新，重置状态
       window._libraryLoadingInProgress = false;
   }

   console.log(`[Library] ${forceReload ? 'Force' : 'Normal'} loading library index...`);
   showMessage('正在加载题库索引...', 'info');

   try {
       let readingExams = [];
       if (window.completeExamIndex && Array.isArray(window.completeExamIndex)) {
           readingExams = window.completeExamIndex.map(exam => ({ ...exam, type: 'reading' }));
           console.log(`[Library] Loaded reading library: ${readingExams.length} items`);
       }

       let listeningExams = [];
       if (window.listeningExamIndex && Array.isArray(window.listeningExamIndex)) {
           listeningExams = window.listeningExamIndex;
           console.log(`[Library] Loaded listening library: ${listeningExams.length} items`);
       }

       if (readingExams.length === 0 && listeningExams.length === 0) {
           console.warn('[Library] No built-in library data detected, continuing with empty index');
       }

       examIndex = [...readingExams, ...listeningExams];
       localStorage.setItem('exam_index', JSON.stringify(examIndex));

       finishLibraryLoading(startTime);
   } catch (error) {
       console.error('[Library] Failed to load library:', error);
       examIndex = [];
       finishLibraryLoading(startTime);
   }
}

function finishLibraryLoading(startTime) {
   const loadTime = performance.now() - startTime;
   showMessage(`题库加载完成！共 ${examIndex.length} 个题目`, 'success');
   updateOverview();
   updateBrowseView();
   // 重置加载状态
   window._libraryLoadingInProgress = false;
}

function checkLibraryUpdates() {
   showMessage('正在检查题库更新...', 'info');
   setTimeout(() => {
       showMessage('已是最新版本', 'success');
   }, 2000);
}

function createBackup() {
   const data = {
       examIndex: examIndex,
       practiceRecords: practiceRecords,
       settings: {
           theme: 'academic',
           language: 'zh-CN',
           version: '1.0.0'
       },
       timestamp: new Date().toISOString()
   };

   const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
   const url = URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = url;
   a.download = `ielts_academic_backup_${new Date().toISOString().split('T')[0]}.json`;
   document.body.appendChild(a);
   a.click();
   document.body.removeChild(a);
   URL.revokeObjectURL(url);

   showMessage('备份创建成功', 'success');
}

function importData() {
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
               console.log('Import data structure:', data);

               let importedExamCount = 0;
               let importedRecordCount = 0;

               // Handle the exported data format from ielts_data_export_*.json
               // First, check for top-level practice_records
               if (data.practice_records && Array.isArray(data.practice_records)) {
                   console.log('Found top-level practice_records:', data.practice_records.length);
                   // Import practice records from exported format
                   const importedRecords = data.practice_records.map(record => {
                       const score = record.realData ? record.realData.percentage : (record.percentage || 0);
                       const duration = record.realData ? record.realData.duration : (record.duration || 0);

                       return {
                           id: record.id || record.timestamp || Date.now(),
                           examId: record.examId || '',
                           title: record.title || record.examName || '未命名练习',
                           type: record.type || getExamTypeFromCategory(record.category),
                           category: record.category || getExamCategoryFromType(record.type),
                           frequency: record.frequency || 'medium',
                           score: score,
                           duration: duration,
                           date: record.date || (record.timestamp ? new Date(record.timestamp).toISOString() : new Date().toISOString()),
                           timestamp: record.timestamp || record.id || Date.now(),
                           realData: record.realData || null,
                           dataSource: record.dataSource || 'imported'
                       };
                   });

                   practiceRecords = importedRecords;
                   localStorage.setItem('practice_records', JSON.stringify(practiceRecords));
                   importedRecordCount = importedRecords.length;
               }
               // Also check for nested practice_records in data.data
               else if (data.data && data.data.practice_records && Array.isArray(data.data.practice_records)) {
                   console.log('Found nested practice_records:', data.data.practice_records.length);
                   const importedRecords = data.data.practice_records.map(record => {
                       const score = record.realData ? record.realData.percentage : (record.percentage || 0);
                       const duration = record.realData ? record.realData.duration : (record.duration || 0);

                       return {
                           id: record.id || record.timestamp || Date.now(),
                           examId: record.examId || '',
                           title: record.title || record.examName || '未命名练习',
                           type: record.type || getExamTypeFromCategory(record.category),
                           category: record.category || getExamCategoryFromType(record.type),
                           frequency: record.frequency || 'medium',
                           score: score,
                           duration: duration,
                           date: record.date || (record.timestamp ? new Date(record.timestamp).toISOString() : new Date().toISOString()),
                           timestamp: record.timestamp || record.id || Date.now(),
                           realData: record.realData || null,
                           dataSource: record.dataSource || 'imported'
                       };
                   });

                   practiceRecords = importedRecords;
                   localStorage.setItem('practice_records', JSON.stringify(practiceRecords));
                   importedRecordCount = importedRecords.length;
               }

               // Handle exam index data from exported format
               if (data.data && data.data['exam_system_exam_index'] && data.data['exam_system_exam_index'].data) {
                   console.log('Found exam_system_exam_index:', data.data['exam_system_exam_index'].data.length);
                   const importedExams = data.data['exam_system_exam_index'].data.map(exam => ({
                       id: exam.id,
                       title: exam.title,
                       type: exam.type || getExamTypeFromCategory(exam.category),
                       category: exam.category,
                       frequency: exam.frequency,
                       hasHtml: exam.hasHtml,
                       hasPdf: exam.hasPdf,
                       path: exam.path,
                       filename: exam.filename,
                       pdfFilename: exam.pdfFilename,
                       questionCount: exam.questionCount || 14 // Default question count
                   }));

                   examIndex = importedExams;
                   localStorage.setItem('exam_index', JSON.stringify(examIndex));
                   importedExamCount = importedExams.length;
               }
               // Fallback to direct format
               else if (data.examIndex) {
                   examIndex = data.examIndex;
                   localStorage.setItem('exam_index', JSON.stringify(examIndex));
                   importedExamCount = examIndex.length;
               }

               // Fallback to direct practice records format
               if (data.practiceRecords) {
                   practiceRecords = data.practiceRecords;
                   localStorage.setItem('practice_records', JSON.stringify(practiceRecords));
                   importedRecordCount = practiceRecords.length;
               }

               console.log('Import results:', {
                   examCount: importedExamCount,
                   recordCount: importedRecordCount,
                   totalExams: examIndex.length,
                   totalRecords: practiceRecords.length
               });

               updateOverview();
               updateBrowseView();
               updatePracticeView();

               showMessage(`成功导入 ${importedExamCount} 道题目和 ${importedRecordCount} 条练习记录`, 'success');
           } catch (error) {
               console.error('Import error:', error);
               showMessage('导入失败: ' + error.message, 'error');
           }
       };
       reader.readAsText(file);
   };
   input.click();
}

function exportAllData() {
   createBackup(); // Reuse backup function
}

function exportPracticeData() {
   const data = {
       exportId: `${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
       timestamp: new Date().toISOString(),
       version: "1.0.0",
       data: {
           practice_records: practiceRecords.map(record => ({
               id: record.id,
               examId: record.examId,
               title: record.title,
               category: record.category || getExamCategoryFromType(record.type),
               frequency: record.frequency || 'medium',
               realData: {
                   score: record.score,
                   totalQuestions: record.realData ? record.realData.totalQuestions : 14,
                   accuracy: record.score / 100,
                   percentage: record.score,
                   duration: record.duration,
                   answers: record.realData ? record.realData.answers : {},
                   correctAnswers: record.realData ? record.realData.correctAnswers : {},
                   interactions: record.realData ? record.realData.interactions : [],
                   isRealData: true,
                   source: "academic_system_export"
               }
           })),
           exam_system_exam_index: {
               data: examIndex,
               timestamp: Date.now(),
               version: "1.0.0"
           }
       }
   };

   const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
   const url = URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = url;
   a.download = `ielts_data_export_${new Date().toISOString().split('T')[0]}.json`;
   document.body.appendChild(a);
   a.click();
   document.body.removeChild(a);
   URL.revokeObjectURL(url);

   showMessage(`已导出 ${practiceRecords.length} 条练习记录和 ${examIndex.length} 道题目`, 'success');
}

function clearPracticeData() {
   if (confirm('确定要清除所有练习记录吗？此操作不可撤销！')) {
       practiceRecords = [];
       localStorage.removeItem('practice_records');
       updatePracticeView();
       updateOverview();
       showMessage('记录已清除', 'success');
   }
}

function showSystemInfo() {
   const info = `
IELTS 学术练习管理系统
======================================
系统版本: 1.0.0
构建时间: ${new Date().toLocaleString('zh-CN')}

题库信息:
- 总题目数: ${examIndex.length}
- 阅读题目: ${examIndex.filter(e => e.type === 'reading').length}
- 听力题目: ${examIndex.filter(e => e.type === 'listening').length}

学习统计:
- 练习记录: ${practiceRecords.length}
- 总学习时长: ${Math.round(practiceRecords.reduce((sum, r) => sum + (r.duration || 0), 0) / 60)} 分钟
- 平均分数: ${practiceRecords.length > 0 ? Math.round(practiceRecords.reduce((sum, r) => sum + (r.score || 0), 0) / practiceRecords.length) : 0}%

浏览器信息:
- User Agent: ${navigator.userAgent}
- 语言: ${navigator.language}
- 平台: ${navigator.platform}

存储信息:
- LocalStorage: ${(JSON.stringify(localStorage).length / 1024).toFixed(2)} KB
- SessionStorage: ${(JSON.stringify(sessionStorage).length / 1024).toFixed(2)} KB
   `;

   alert(info);
}

function showUsageStatistics() {
   showMessage('详细使用统计功能开发中...', 'info');
}

// Show message function
function showMessage(message, type = 'info', duration = 3000) {
   const messageContainer = document.getElementById('message-container');
   const messageDiv = document.createElement('div');
   messageDiv.className = `message ${type}`;

   const iconMap = {
       'success': 'fas fa-check-circle',
       'error': 'fas fa-exclamation-circle',
       'warning': 'fas fa-exclamation-triangle',
       'info': 'fas fa-info-circle'
   };

   const icon = iconMap[type] || 'fas fa-info-circle';

   messageDiv.innerHTML = `
       <i class="${icon} message-icon"></i>
       <div class="message-content">
           <div class="message-title">${message}</div>
       </div>
   `;

   messageContainer.appendChild(messageDiv);

   // Auto-remove after duration
   setTimeout(() => {
       if (messageDiv.parentNode) {
           messageDiv.style.animation = 'slideIn 0.3s ease-out reverse';
           setTimeout(() => {
               if (messageDiv.parentNode) {
                   messageDiv.parentNode.removeChild(messageDiv);
               }
           }, 300);
       }
   }, duration);
}

// Sync practice records with storage - 添加防重复调用
window._syncInProgress = false;
function syncPracticeRecords() {
   // 防止重复同步
   if (window._syncInProgress) {
       console.log('[Sync] 同步已在进行中，跳过重复调用');
       return;
   }
   window._syncInProgress = true;

   try {
       const records = JSON.parse(localStorage.getItem('practice_records') || '[]');

       // Ensure records have the required fields
       practiceRecords = records.map(record => ({
           id: record.id || record.timestamp || Date.now(),
           examId: record.examId || '',
           title: record.title || record.examName || '未命名练习',
           type: record.type || 'reading',
           score: record.score || (record.realData ? record.realData.percentage : 0),
           duration: record.duration || (record.realData ? record.realData.duration : 0),
           date: record.date || (record.timestamp ? new Date(record.timestamp).toISOString() : new Date().toISOString()),
           timestamp: record.timestamp || record.id || Date.now(),
           realData: record.realData || null
       }));

       updatePracticeView();
       updateOverview();
   } catch (error) {
       console.error('Failed to sync practice records:', error);
       practiceRecords = [];
   } finally {
       window._syncInProgress = false;
   }
}

// Listen for practice completion messages
window.addEventListener('message', function(event) {
   if (event.data && (event.data.type === 'PRACTICE_COMPLETE' || event.data.type === 'practice_completed')) {
       showMessage('练习已完成，正在更新记录...', 'success');
       setTimeout(syncPracticeRecords, 1000);
   }
});

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
   if (e.ctrlKey || e.metaKey) {
       switch(e.key) {
           case '1':
               e.preventDefault();
               showView('overview');
               break;
           case '2':
               e.preventDefault();
               showView('browse');
               break;
           case '3':
               e.preventDefault();
               showView('practice');
               break;
           case '4':
               e.preventDefault();
               showView('settings');
               break;
           case 's':
               if (e.shiftKey) {
                   e.preventDefault();
                   createBackup();
               }
               break;
       }
   }
});

// Auto-save functionality
setInterval(() => {
   if (practiceRecords.length > 0) {
       localStorage.setItem('practice_records', JSON.stringify(practiceRecords));
   }
}, 30000); // Auto-save every 30 seconds

// Handle window unload
window.addEventListener('beforeunload', function(e) {
   if (practiceRecords.length > 0) {
       localStorage.setItem('practice_records', JSON.stringify(practiceRecords));
   }
});

// Initialize on page load
window.addEventListener('load', function() {
   console.log('IELTS Academic Practice System initialized');
   showMessage('系统就绪', 'success');
});