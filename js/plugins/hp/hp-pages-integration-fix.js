/**
 * HP Pages Integration Fix Plugin
 * 修复四个页面的功能问题，集成现有插件
 * 不修改现有脚本，只创建新的集成脚本
 */

(function() {
    'use strict';

    // 等待hpCore准备就绪
    if (typeof hpCore === 'undefined') {
        console.error('[HP-Pages-Integration-Fix] hpCore未定义');
        return;
    }

    const hpPagesIntegrationFix = {
        // 插件状态
        isInitialized: false,
        pagesStatus: {
            overview: { loaded: false, functional: false },
            practice: { loaded: false, functional: false },
            browse: { loaded: false, functional: false },
            settings: { loaded: false, functional: false }
        },

        /**
         * 初始化插件
         */
        init() {
            if (this.isInitialized) {
                console.log('[HP-Pages-Integration-Fix] 插件已初始化，跳过重复初始化');
                return;
            }

            console.log('[HP-Pages-Integration-Fix] 开始初始化页面集成修复插件');

            // 等待DOM加载完成
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this._initAfterDOM());
            } else {
                this._initAfterDOM();
            }
        },

        /**
         * DOM加载完成后初始化
         */
        _initAfterDOM() {
            try {
                this._setupPageIntegration();
                this._fixOverviewPage();
                this._fixPracticePage();
                this._fixBrowsePage();
                this._fixSettingsPage();
                this._setupGlobalEventHandlers();
                this._setupDataSynchronization();
                this.isInitialized = true;
                console.log('[HP-Pages-Integration-Fix] 插件初始化完成');
            } catch (error) {
                console.error('[HP-Pages-Integration-Fix] 初始化失败:', error);
            }
        },

        /**
         * 设置页面集成
         */
        _setupPageIntegration() {
            console.log('[HP-Pages-Integration-Fix] 设置页面集成');

            // 确保所有页面容器都存在
            this._ensurePageContainers();

            // 设置页面切换事件
            this._setupPageNavigation();

            // 初始化页面状态
            this._initializePageStates();
        },

        /**
         * 确保页面容器存在
         */
        _ensurePageContainers() {
            const pages = ['overview', 'practice', 'browse', 'settings'];

            pages.forEach(pageName => {
                let pageContainer = document.getElementById(`${pageName}-view`);
                if (!pageContainer) {
                    console.warn(`[HP-Pages-Integration-Fix] ${pageName}页面容器不存在，创建中...`);
                    pageContainer = this._createPageContainer(pageName);
                }

                // 确保页面容器有正确的类名
                if (!pageContainer.classList.contains('view')) {
                    pageContainer.classList.add('view');
                }

                // 确保页面容器有正确的ID
                if (pageContainer.id !== `${pageName}-view`) {
                    pageContainer.id = `${pageName}-view`;
                }
            });
        },

        /**
         * 创建页面容器
         */
        _createPageContainer(pageName) {
            const container = document.createElement('div');
            container.id = `${pageName}-view`;
            container.className = 'view';
            container.style.cssText = `
                display: none;
                padding: 20px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 10px;
                margin: 20px 0;
                min-height: 400px;
            `;

            // 根据页面类型添加特定内容
            switch (pageName) {
                case 'overview':
                    container.innerHTML = `
                        <h2>📊 学习总览</h2>
                        <div id="category-overview" class="category-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-top: 20px;">
                            <!-- 分类卡片将通过JavaScript动态生成 -->
                        </div>
                    `;
                    break;
                case 'practice':
                    container.innerHTML = `
                        <h2>📝 练习记录</h2>
                        <div id="practice-history-list" style="margin-top: 20px;">
                            <!-- 练习记录将通过JavaScript动态生成 -->
                        </div>
                    `;
                    break;
                case 'browse':
                    container.innerHTML = `
                        <h2>📚 题库浏览</h2>
                        <div id="examGrid" class="exam-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; margin-top: 20px;">
                            <!-- 题目网格将通过JavaScript动态生成 -->
                        </div>
                    `;
                    break;
                case 'settings':
                    container.innerHTML = `
                        <h2>⚙️ 系统设置</h2>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-top: 20px;">
                            <div class="settings-card">
                                <h3>🔧 系统管理</h3>
                                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                                    <button class="btn" onclick="handleClearCache()">🗑️ 清除缓存</button>
                                    <button class="btn" onclick="handleLoadLibrary()">📂 加载题库</button>
                                    <button class="btn" onclick="handleLibraryConfig()">⚙️ 题库配置切换</button>
                                    <button class="btn" onclick="handleForceRefresh()">🔄 强制刷新题库</button>
                                </div>
                            </div>
                            <div class="settings-card">
                                <h3>💾 数据管理</h3>
                                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                                    <button class="btn" onclick="handleCreateBackup()">💾 创建备份</button>
                                    <button class="btn" onclick="handleBackupList()">📋 备份列表</button>
                                    <button class="btn" onclick="handleExportData()">📤 导出数据</button>
                                    <button class="btn" onclick="handleImportData()">📥 导入数据</button>
                                </div>
                            </div>
                            <div class="settings-card">
                                <h3>📊 系统信息</h3>
                                <div id="system-info" style="margin-top: 15px; line-height: 1.8;">
                                    <div>题库状态: <span id="library-status">加载中...</span></div>
                                    <div>题目总数: <span id="total-exams">0</span></div>
                                    <div>HTML题目: <span id="html-exams">0</span></div>
                                    <div>PDF题目: <span id="pdf-exams">0</span></div>
                                    <div>最后更新: <span id="last-update">${new Date().toLocaleString()}</span></div>
                                </div>
                            </div>
                        </div>
                    `;
                    break;
            }

            // 将容器添加到主容器中
            const mainContainer = document.querySelector('.container') || document.body;
            mainContainer.appendChild(container);

            return container;
        },

        /**
         * 设置页面导航
         */
        _setupPageNavigation() {
            const navButtons = document.querySelectorAll('.nav-btn, .island, [data-page]');

            navButtons.forEach(button => {
                const pageName = button.dataset.page ||
                               button.textContent.trim().includes('总览') ? 'overview' :
                               button.textContent.trim().includes('题库') ? 'browse' :
                               button.textContent.trim().includes('记录') ? 'practice' :
                               button.textContent.trim().includes('设置') ? 'settings' : null;

                if (pageName) {
                    button.addEventListener('click', (e) => {
                        e.preventDefault();
                        this._switchToPage(pageName);
                    });
                }
            });
        },

        /**
         * 切换到指定页面
         */
        _switchToPage(pageName) {
            console.log(`[HP-Pages-Integration-Fix] 切换到页面: ${pageName}`);

            // 隐藏所有页面
            document.querySelectorAll('.view').forEach(view => {
                view.classList.remove('active');
                view.style.display = 'none';
            });

            // 显示目标页面
            const targetView = document.getElementById(`${pageName}-view`);
            if (targetView) {
                targetView.classList.add('active');
                targetView.style.display = 'block';
            }

            // 更新导航按钮状态
            this._updateNavigationButtons(pageName);

            // 触发页面切换事件
            hpCore.emit('pageChanged', pageName);

            // 根据页面类型执行特定操作
            this._onPageActivated(pageName);
        },

        /**
         * 更新导航按钮状态
         */
        _updateNavigationButtons(activePage) {
            const navButtons = document.querySelectorAll('.nav-btn, .island, [data-page]');

            navButtons.forEach(button => {
                const pageName = button.dataset.page ||
                               button.textContent.trim().includes('总览') ? 'overview' :
                               button.textContent.trim().includes('题库') ? 'browse' :
                               button.textContent.trim().includes('记录') ? 'practice' :
                               button.textContent.trim().includes('设置') ? 'settings' : null;

                if (pageName === activePage) {
                    button.classList.add('active');
                } else {
                    button.classList.remove('active');
                }
            });
        },

        /**
         * 页面激活时的处理
         */
        _onPageActivated(pageName) {
            console.log(`[HP-Pages-Integration-Fix] 页面已激活: ${pageName}`);

            switch (pageName) {
                case 'overview':
                    this._activateOverviewPage();
                    break;
                case 'practice':
                    this._activatePracticePage();
                    break;
                case 'browse':
                    this._activateBrowsePage();
                    break;
                case 'settings':
                    this._activateSettingsPage();
                    break;
            }
        },

        /**
         * 初始化页面状态
         */
        _initializePageStates() {
            // 默认显示总览页面
            const overviewView = document.getElementById('overview-view');
            if (overviewView) {
                overviewView.classList.add('active');
                overviewView.style.display = 'block';
                this._activateOverviewPage();
            }
        },

        /**
         * 修复总览页面
         */
        _fixOverviewPage() {
            console.log('[HP-Pages-Integration-Fix] 修复总览页面');

            const overviewContainer = document.getElementById('category-overview');
            if (!overviewContainer) {
                console.warn('[HP-Pages-Integration-Fix] 总览容器不存在');
                return;
            }

            // 确保总览页面功能正常
            this._ensureOverviewFunctionality();
        },

        /**
         * 确保总览页面功能正常
         */
        _ensureOverviewFunctionality() {
            const examIndex = hpCore.getExamIndex();
            if (!examIndex || examIndex.length === 0) {
                console.log('[HP-Pages-Integration-Fix] 题库数据为空，等待数据加载...');
                hpCore.on('dataUpdated', () => {
                    this._renderOverviewCards();
                });
                return;
            }

            this._renderOverviewCards();
        },

        /**
         * 渲染总览卡片
         */
        _renderOverviewCards() {
            const container = document.getElementById('category-overview');
            if (!container) return;

            const examIndex = hpCore.getExamIndex();
            const readingExams = examIndex.filter(e => e.type === 'reading');
            const listeningExams = examIndex.filter(e => e.type === 'listening');

            const cardStyle = `
                background: rgba(255, 255, 255, 0.1);
                border-radius: 15px;
                padding: 25px;
                text-align: center;
                transition: all 0.3s ease;
                cursor: pointer;
                border: 2px solid transparent;
            `;

            const cardHoverStyle = `
                transform: translateY(-5px);
                border-color: rgba(255, 255, 255, 0.3);
                box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
            `;

            container.innerHTML = `
                <div class="category-card" style="${cardStyle}" onmouseover="this.style.cssText += '${cardHoverStyle}'" onmouseout="this.style.cssText = this.style.cssText.replace('${cardHoverStyle}', '')" onclick="hpPagesIntegrationFix._handleReadingCardClick()">
                    <div class="category-icon" style="font-size: 3rem; margin-bottom: 15px;">📖</div>
                    <h3 style="margin: 0 0 10px 0; font-size: 1.5rem;">阅读练习</h3>
                    <p style="margin: 0 0 15px 0; opacity: 0.8;">${readingExams.length} 个题目</p>
                    <div style="display: flex; gap: 10px; justify-content: center;">
                        <button class="btn" onclick="event.stopPropagation(); hpPagesIntegrationFix._handleReadingBrowseClick()">📚 浏览题库</button>
                        <button class="btn btn-secondary" onclick="event.stopPropagation(); hpPagesIntegrationFix._handleReadingRandomClick()">🎲 随机练习</button>
                    </div>
                </div>
                <div class="category-card" style="${cardStyle}" onmouseover="this.style.cssText += '${cardHoverStyle}'" onmouseout="this.style.cssText = this.style.cssText.replace('${cardHoverStyle}', '')" onclick="hpPagesIntegrationFix._handleListeningCardClick()">
                    <div class="category-icon" style="font-size: 3rem; margin-bottom: 15px;">🎧</div>
                    <h3 style="margin: 0 0 10px 0; font-size: 1.5rem;">听力练习</h3>
                    <p style="margin: 0 0 15px 0; opacity: 0.8;">${listeningExams.length} 个题目</p>
                    <div style="display: flex; gap: 10px; justify-content: center;">
                        <button class="btn" onclick="event.stopPropagation(); hpPagesIntegrationFix._handleListeningBrowseClick()">📚 浏览题库</button>
                        <button class="btn btn-secondary" onclick="event.stopPropagation(); hpPagesIntegrationFix._handleListeningRandomClick()">🎲 随机练习</button>
                    </div>
                </div>
            `;

            this.pagesStatus.overview.functional = true;
            console.log('[HP-Pages-Integration-Fix] 总览页面修复完成');
        },

        /**
         * 处理阅读卡片点击
         */
        _handleReadingCardClick() {
            this._switchToPage('browse');
            if (window.filterByType) {
                window.filterByType('reading');
            }
        },

        /**
         * 处理阅读浏览点击
         */
        _handleReadingBrowseClick() {
            this._switchToPage('browse');
            if (window.filterByType) {
                window.filterByType('reading');
            }
        },

        /**
         * 处理阅读随机点击
         */
        _handleReadingRandomClick() {
            const examIndex = hpCore.getExamIndex();
            const readingExams = examIndex.filter(e => e.type === 'reading');
            if (readingExams.length > 0) {
                const randomExam = readingExams[Math.floor(Math.random() * readingExams.length)];
                if (window.openExam) {
                    window.openExam(randomExam.id);
                }
            }
        },

        /**
         * 处理听力卡片点击
         */
        _handleListeningCardClick() {
            this._switchToPage('browse');
            if (window.filterByType) {
                window.filterByType('listening');
            }
        },

        /**
         * 处理听力浏览点击
         */
        _handleListeningBrowseClick() {
            this._switchToPage('browse');
            if (window.filterByType) {
                window.filterByType('listening');
            }
        },

        /**
         * 处理听力随机点击
         */
        _handleListeningRandomClick() {
            const examIndex = hpCore.getExamIndex();
            const listeningExams = examIndex.filter(e => e.type === 'listening');
            if (listeningExams.length > 0) {
                const randomExam = listeningExams[Math.floor(Math.random() * listeningExams.length)];
                if (window.openExam) {
                    window.openExam(randomExam.id);
                }
            }
        },

        /**
         * 修复练习记录页面
         */
        _fixPracticePage() {
            console.log('[HP-Pages-Integration-Fix] 修复练习记录页面');

            const practiceContainer = document.getElementById('practice-history-list');
            if (!practiceContainer) {
                console.warn('[HP-Pages-Integration-Fix] 练习记录容器不存在');
                return;
            }

            // 确保练习记录页面功能正常
            this._ensurePracticeFunctionality();
        },

        /**
         * 确保练习记录页面功能正常
         */
        _ensurePracticeFunctionality() {
            const records = hpCore.getRecords();
            if (!records || records.length === 0) {
                console.log('[HP-Pages-Integration-Fix] 练习记录为空，显示空状态');
                this._renderPracticeEmptyState();
                return;
            }

            this._renderPracticeRecords(records);
        },

        /**
         * 渲染练习记录空状态
         */
        _renderPracticeEmptyState() {
            const container = document.getElementById('practice-history-list');
            if (!container) return;

            container.innerHTML = `
                <div style="text-align: center; padding: 60px 20px;">
                    <div style="font-size: 4rem; margin-bottom: 20px;">📝</div>
                    <h3 style="margin: 0 0 10px 0;">暂无练习记录</h3>
                    <p style="margin: 0 0 20px 0; opacity: 0.7;">开始你的第一次练习吧！</p>
                    <button class="btn" onclick="hpPagesIntegrationFix._switchToPage('browse')">开始练习</button>
                </div>
            `;
        },

        /**
         * 渲染练习记录
         */
        _renderPracticeRecords(records) {
            const container = document.getElementById('practice-history-list');
            if (!container) return;

            // 按时间排序
            const sortedRecords = records.sort((a, b) => new Date(b.date) - new Date(a.date));

            container.innerHTML = sortedRecords.map(record => {
                const score = record.score || (record.realData ? record.realData.percentage : 0);
                const duration = record.duration || (record.realData ? record.realData.duration : 0);
                const scoreClass = this._getScoreClass(score);

                return `
                    <div class="record-item" style="background: rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 20px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center;">
                        <div class="record-info">
                            <div class="record-title" style="font-weight: 600; margin-bottom: 5px;">${record.title || '未命名练习'}</div>
                            <div class="record-meta" style="opacity: 0.7; font-size: 0.9rem;">
                                ${new Date(record.date).toLocaleString()} •
                                ${record.type === 'reading' ? '阅读' : '听力'} •
                                用时: ${this._formatDuration(duration)}
                            </div>
                        </div>
                        <div class="record-score">
                            <span class="score-badge ${scoreClass}" style="padding: 4px 12px; border-radius: 20px; font-weight: bold;">${score}%</span>
                        </div>
                        <div class="record-actions">
                            <button class="btn btn-sm" onclick="hpPagesIntegrationFix._viewRecordDetails('${record.id}')">查看详情</button>
                        </div>
                    </div>
                `;
            }).join('');

            this.pagesStatus.practice.functional = true;
            console.log('[HP-Pages-Integration-Fix] 练习记录页面修复完成');
        },

        /**
         * 获取分数样式类
         */
        _getScoreClass(score) {
            if (score >= 90) return 'score-excellent';
            if (score >= 80) return 'score-good';
            if (score >= 60) return 'score-fair';
            return 'score-poor';
        },

        /**
         * 格式化时长
         */
        _formatDuration(seconds) {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;

            if (hours > 0) {
                return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        },

        /**
         * 查看记录详情
         */
        _viewRecordDetails(recordId) {
            if (window.practiceRecordModal && typeof window.practiceRecordModal.showById === 'function') {
                window.practiceRecordModal.showById(recordId);
            } else {
                alert('详情查看功能开发中...');
            }
        },

        /**
         * 修复题库浏览页面
         */
        _fixBrowsePage() {
            console.log('[HP-Pages-Integration-Fix] 修复题库浏览页面');

            const browseContainer = document.getElementById('examGrid');
            if (!browseContainer) {
                console.warn('[HP-Pages-Integration-Fix] 题库浏览容器不存在');
                return;
            }

            // 确保题库浏览页面功能正常
            this._ensureBrowseFunctionality();
        },

        /**
         * 确保题库浏览页面功能正常
         */
        _ensureBrowseFunctionality() {
            const examIndex = hpCore.getExamIndex();
            if (!examIndex || examIndex.length === 0) {
                console.log('[HP-Pages-Integration-Fix] 题库数据为空，等待数据加载...');
                hpCore.on('dataUpdated', () => {
                    this._renderBrowseGrid();
                });
                return;
            }

            this._renderBrowseGrid();
        },

        /**
         * 渲染题库网格
         */
        _renderBrowseGrid() {
            const container = document.getElementById('examGrid');
            if (!container) return;

            const examIndex = hpCore.getExamIndex();
            const records = hpCore.getRecords();

            container.innerHTML = examIndex.map(exam => {
                const isCompleted = records.some(record =>
                    record.examId === exam.id || record.title === exam.title
                );

                const bestScore = isCompleted ?
                    Math.max(...records
                        .filter(record => record.examId === exam.id || record.title === exam.title)
                        .map(record => (record.score ?? record.percentage ?? 0))) : 0;

                return `
                    <div class="exam-card" style="background: rgba(255, 255, 255, 0.1); border-radius: 10px; padding: 20px; cursor: pointer; transition: all 0.3s ease;" onclick="hpPagesIntegrationFix._openExam('${exam.id}')">
                        <div class="exam-title" style="font-weight: 600; margin-bottom: 10px;">${exam.title || '无标题'}</div>
                        <div class="exam-meta" style="opacity: 0.7; margin-bottom: 15px;">
                            <span>${exam.type === 'reading' ? '📖 阅读' : '🎧 听力'}</span>
                            <span>${exam.category || 'P1'}</span>
                            ${isCompleted ? `<span>最佳 ${bestScore}%</span>` : ''}
                        </div>
                        <div class="exam-actions" style="display: flex; gap: 10px;">
                            <button class="btn" onclick="event.stopPropagation(); hpPagesIntegrationFix._openExam('${exam.id}')">
                                ${isCompleted ? '重新练习' : '开始练习'}
                            </button>
                            <button class="btn btn-secondary" onclick="event.stopPropagation(); hpPagesIntegrationFix._viewExamPDF('${exam.id}')">
                                查看PDF
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            this.pagesStatus.browse.functional = true;
            console.log('[HP-Pages-Integration-Fix] 题库浏览页面修复完成');
        },

        /**
         * 打开题目
         */
        _openExam(examId) {
            if (window.openExam) {
                window.openExam(examId);
            } else {
                alert('题目打开功能开发中...');
            }
        },

        /**
         * 查看题目PDF
         */
        _viewExamPDF(examId) {
            const exam = hpCore.getExamById(examId);
            if (exam && exam.pdfFilename) {
                if (window.openPDFSafely) {
                    window.openPDFSafely(exam.pdfFilename, exam.title);
                } else {
                    window.open(exam.pdfFilename, '_blank');
                }
            } else {
                alert('PDF文件不存在');
            }
        },

        /**
         * 修复设置页面
         */
        _fixSettingsPage() {
            console.log('[HP-Pages-Integration-Fix] 修复设置页面');

            // 确保设置页面按钮功能正常
            this._ensureSettingsFunctionality();
        },

        /**
         * 确保设置页面功能正常
         */
        _ensureSettingsFunctionality() {
            // 更新系统信息
            this._updateSettingsSystemInfo();

            // 绑定设置按钮事件
            this._bindSettingsButtons();

            this.pagesStatus.settings.functional = true;
            console.log('[HP-Pages-Integration-Fix] 设置页面修复完成');
        },

        /**
         * 更新设置页面系统信息
         */
        _updateSettingsSystemInfo() {
            const examIndex = hpCore.getExamIndex();
            if (!examIndex) return;

            const readingExams = examIndex.filter(e => e.type === 'reading');
            const listeningExams = examIndex.filter(e => e.type === 'listening');
            const htmlExams = examIndex.filter(e => e.hasHtml);
            const pdfExams = examIndex.filter(e => e.pdfFilename);

            const totalExamsEl = document.getElementById('total-exams');
            const htmlExamsEl = document.getElementById('html-exams');
            const pdfExamsEl = document.getElementById('pdf-exams');
            const libraryStatusEl = document.getElementById('library-status');

            if (totalExamsEl) totalExamsEl.textContent = examIndex.length;
            if (htmlExamsEl) htmlExamsEl.textContent = htmlExams.length;
            if (pdfExamsEl) pdfExamsEl.textContent = pdfExams.length;
            if (libraryStatusEl) libraryStatusEl.textContent = '已加载完整索引';
        },

        /**
         * 绑定设置按钮事件
         */
        _bindSettingsButtons() {
            // 清除缓存按钮
            const clearCacheBtns = document.querySelectorAll('button:contains("清除缓存")');
            clearCacheBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleClearCache());
            });

            // 加载题库按钮
            const loadLibraryBtns = document.querySelectorAll('button:contains("加载题库")');
            loadLibraryBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleLoadLibrary());
            });

            // 题库配置切换按钮
            const configBtns = document.querySelectorAll('button:contains("题库配置")');
            configBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleLibraryConfig());
            });

            // 强制刷新题库按钮
            const refreshBtns = document.querySelectorAll('button:contains("强制刷新")');
            refreshBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleForceRefresh());
            });

            // 创建备份按钮
            const backupBtns = document.querySelectorAll('button:contains("创建备份")');
            backupBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleCreateBackup());
            });

            // 备份列表按钮
            const backupListBtns = document.querySelectorAll('button:contains("备份列表")');
            backupListBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleBackupList());
            });

            // 导出数据按钮
            const exportBtns = document.querySelectorAll('button:contains("导出数据")');
            exportBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleExportData());
            });

            // 导入数据按钮
            const importBtns = document.querySelectorAll('button:contains("导入数据")');
            importBtns.forEach(btn => {
                btn.addEventListener('click', () => this._handleImportData());
            });
        },

        /**
         * 处理清除缓存
         */
        _handleClearCache() {
            if (confirm('确定要清除所有缓存数据吗？此操作不可撤销！')) {
                localStorage.clear();
                sessionStorage.clear();
                hpCore.showNotification('缓存已清除', 'success');
                setTimeout(() => location.reload(), 1500);
            }
        },

        /**
         * 处理加载题库
         */
        _handleLoadLibrary() {
            hpCore.showNotification('正在重新加载题库...', 'info');
            if (typeof loadLibrary === 'function') {
                loadLibrary(true);
            }
            setTimeout(() => {
                hpCore.showNotification('题库重新加载完成', 'success');
            }, 2000);
        },

        /**
         * 处理题库配置
         */
        _handleLibraryConfig() {
            hpCore.showNotification('题库配置功能开发中...', 'info');
        },

        /**
         * 处理强制刷新
         */
        _handleForceRefresh() {
            hpCore.showNotification('正在强制刷新题库...', 'info');
            this._handleLoadLibrary();
        },

        /**
         * 处理创建备份
         */
        _handleCreateBackup() {
            const data = {
                examData: hpCore.getExamIndex() || [],
                practiceRecords: hpCore.getRecords() || [],
                backupDate: new Date().toISOString()
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hp-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);

            hpCore.showNotification('备份创建成功', 'success');
        },

        /**
         * 处理备份列表
         */
        _handleBackupList() {
            hpCore.showNotification('备份列表功能开发中...', 'info');
        },

        /**
         * 处理导出数据
         */
        _handleExportData() {
            const data = {
                examData: hpCore.getExamIndex() || [],
                practiceRecords: hpCore.getRecords() || [],
                exportDate: new Date().toISOString()
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hp-data-export-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);

            hpCore.showNotification('数据导出成功', 'success');
        },

        /**
         * 处理导入数据
         */
        _handleImportData() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const data = JSON.parse(e.target.result);
                        if (data.practiceRecords && Array.isArray(data.practiceRecords)) {
                            const records = hpCore.getRecords();
                            data.practiceRecords.forEach(record => {
                                if (!records.find(r => r.id === record.id)) {
                                    records.push(record);
                                }
                            });
                            hpCore.saveRecords(records);
                            hpCore.showNotification('数据导入成功', 'success');
                        }
                    } catch (error) {
                        hpCore.showNotification('数据导入失败：格式错误', 'error');
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        },

        /**
         * 激活总览页面
         */
        _activateOverviewPage() {
            console.log('[HP-Pages-Integration-Fix] 激活总览页面');
            this._renderOverviewCards();
        },

        /**
         * 激活练习记录页面
         */
        _activatePracticePage() {
            console.log('[HP-Pages-Integration-Fix] 激活练习记录页面');
            this._ensurePracticeFunctionality();
        },

        /**
         * 激活题库浏览页面
         */
        _activateBrowsePage() {
            console.log('[HP-Pages-Integration-Fix] 激活题库浏览页面');
            this._ensureBrowseFunctionality();
        },

        /**
         * 激活设置页面
         */
        _activateSettingsPage() {
            console.log('[HP-Pages-Integration-Fix] 激活设置页面');
            this._ensureSettingsFunctionality();
        },

        /**
         * 设置全局事件处理器
         */
        _setupGlobalEventHandlers() {
            // 监听数据更新事件
            hpCore.on('dataUpdated', (data) => {
                this._onDataUpdated(data);
            });

            // 监听练习完成事件
            hpCore.on('practiceCompleted', (data) => {
                this._onPracticeCompleted(data);
            });

            // 监听页面切换事件
            hpCore.on('pageChanged', (page) => {
                this._onPageChanged(page);
            });
        },

        /**
         * 设置数据同步
         */
        _setupDataSynchronization() {
            // 定期检查页面状态
            setInterval(() => {
                this._checkPageStatus();
            }, 5000);

            // 监听存储变化
            window.addEventListener('storage', (e) => {
                if (e.key === 'exam_system_practice_records' ||
                    e.key === 'exam_system_exam_index') {
                    this._onStorageChanged(e);
                }
            });
        },

        /**
         * 数据更新时的处理
         */
        _onDataUpdated(data) {
            console.log('[HP-Pages-Integration-Fix] 数据已更新');

            // 更新所有页面
            this._renderOverviewCards();
            this._ensurePracticeFunctionality();
            this._ensureBrowseFunctionality();
            this._updateSettingsSystemInfo();
        },

        /**
         * 练习完成时的处理
         */
        _onPracticeCompleted(data) {
            console.log('[HP-Pages-Integration-Fix] 练习完成');

            // 更新练习记录页面
            this._ensurePracticeFunctionality();

            // 更新总览页面统计
            this._renderOverviewCards();
        },

        /**
         * 页面切换时的处理
         */
        _onPageChanged(page) {
            console.log(`[HP-Pages-Integration-Fix] 页面已切换到: ${page}`);

            // 更新页面状态
            this._onPageActivated(page);
        },

        /**
         * 存储变化时的处理
         */
        _onStorageChanged(e) {
            console.log('[HP-Pages-Integration-Fix] 检测到存储变化');

            // 刷新页面数据
            this._onDataUpdated({});
        },

        /**
         * 检查页面状态
         */
        _checkPageStatus() {
            // 检查每个页面的功能状态
            Object.keys(this.pagesStatus).forEach(page => {
                const container = document.getElementById(`${page}-view`);
                if (container && container.style.display !== 'none') {
                    // 页面可见，检查功能是否正常
                    this._ensurePageFunctionality(page);
                }
            });
        },

        /**
         * 确保页面功能正常
         */
        _ensurePageFunctionality(page) {
            switch (page) {
                case 'overview':
                    this._renderOverviewCards();
                    break;
                case 'practice':
                    this._ensurePracticeFunctionality();
                    break;
                case 'browse':
                    this._ensureBrowseFunctionality();
                    break;
                case 'settings':
                    this._updateSettingsSystemInfo();
                    break;
            }
        },

        /**
         * 获取插件状态
         */
        getStatus() {
            return {
                isInitialized: this.isInitialized,
                pagesStatus: this.pagesStatus,
                activePage: this._getActivePage()
            };
        },

        /**
         * 获取当前活动页面
         */
        _getActivePage() {
            const activeView = document.querySelector('.view.active');
            if (activeView) {
                return activeView.id.replace('-view', '');
            }
            return 'unknown';
        }
    };

    // 导出到全局
    window.hpPagesIntegrationFix = hpPagesIntegrationFix;

    // 自动初始化
    hpCore.ready(() => {
        console.log('[HP-Pages-Integration-Fix] hpCore已就绪，开始初始化');
        hpPagesIntegrationFix.init();
    });

    console.log('[HP-Pages-Integration-Fix] 页面集成修复插件已加载');

})();
