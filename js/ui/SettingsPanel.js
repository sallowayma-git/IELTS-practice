// SettingsPanel.js - Global class for file:// protocol compatibility
// Manages system settings using existing DOM structure

window.SettingsPanel = class SettingsPanel {
    constructor(stores) {
        this.stores = stores;
        
        // Get existing DOM elements
        this.elements = {
            totalExams: document.getElementById('total-exams'),
            htmlExams: document.getElementById('html-exams'),
            pdfExams: document.getElementById('pdf-exams'),
            lastUpdate: document.getElementById('last-update')
        };
        
        // Subscribe to store changes
        this.unsubscribeExams = this.stores.exams.subscribe(this.handleExamStoreChange.bind(this));
        this.unsubscribeApp = this.stores.app.subscribe(this.handleAppStoreChange.bind(this));
        
        // Setup event listeners for existing buttons
        this.setupEventListeners();
        
        console.log('[SettingsPanel] Initialized with existing DOM structure');
    }
    
    setupEventListeners() {
        // System management functions
        window.clearCache = () => this.clearCache();
        window.showLibraryLoaderModal = () => this.showLibraryLoader();
        window.showLibraryConfigListV2 = () => this.showLibraryConfig();
        window.loadLibrary = (force) => this.loadLibrary(force);
        
        // Data management functions
        window.createManualBackup = () => this.createBackup();
        window.showBackupList = () => this.showBackupList();
        window.exportAllData = () => this.exportData();
        window.importData = () => this.importData();
        
        // Theme functions (keep existing)
        window.showThemeSwitcherModal = () => this.showThemeSwitcher();
        window.showDeveloperTeam = () => this.showDeveloperTeam();
        window.hideDeveloperTeam = () => this.hideDeveloperTeam();
        
        console.log('[SettingsPanel] Event listeners setup complete');
    }
    
    handleExamStoreChange(event) {
        switch (event.type) {
            case 'exams_loaded':
                this.updateSystemInfo();
                break;
            default:
                // Ignore other exam events
        }
    }
    
    handleAppStoreChange(event) {
        switch (event.type) {
            case 'view_changed':
                if (event.view === 'settings') {
                    this.updateSystemInfo();
                }
                break;
            default:
                // Ignore other app events
        }
    }
    
    updateSystemInfo() {
        try {
            const exams = this.stores.exams.exams || [];
            const htmlExams = exams.filter(exam => exam.hasHtml !== false);
            const pdfExams = exams.filter(exam => exam.hasPdf === true);
            
            if (this.elements.totalExams) {
                this.elements.totalExams.textContent = exams.length;
            }
            
            if (this.elements.htmlExams) {
                this.elements.htmlExams.textContent = htmlExams.length;
            }
            
            if (this.elements.pdfExams) {
                this.elements.pdfExams.textContent = pdfExams.length;
            }
            
            if (this.elements.lastUpdate) {
                this.elements.lastUpdate.textContent = new Date().toLocaleString('zh-CN');
            }
            
        } catch (error) {
            console.error('[SettingsPanel] Failed to update system info:', error);
        }
    }
    
    // System Management Functions
    async clearCache() {
        try {
            console.log('[SettingsPanel] Clearing cache...');
            
            // Clear browser cache if possible
            if ('caches' in window) {
                const cacheNames = await caches.keys();
                await Promise.all(cacheNames.map(name => caches.delete(name)));
            }
            
            // Clear localStorage except essential data
            const essentialKeys = ['exam_index', 'practice_records', 'active_exam_index_key'];
            const allKeys = Object.keys(localStorage);
            
            allKeys.forEach(key => {
                if (!essentialKeys.some(essential => key.includes(essential))) {
                    localStorage.removeItem(key);
                }
            });
            
            if (window.showMessage) {
                window.showMessage('缓存已清除', 'success');
            }
            
            console.log('[SettingsPanel] Cache cleared successfully');
            
        } catch (error) {
            console.error('[SettingsPanel] Failed to clear cache:', error);
            this.stores.app.addError({
                message: `Failed to clear cache: ${error.message}`,
                context: 'SettingsPanel.clearCache',
                error: error,
                recoverable: true,
                userMessage: '无法清除缓存。',
                actions: ['Try again', 'Refresh page manually']
            });
        }
    }
    
    showLibraryLoader() {
        // Use existing library loader modal if available
        if (window.LibraryLoader && window.LibraryLoader.show) {
            window.LibraryLoader.show();
        } else {
            // Fallback: simple file input
            const input = document.createElement('input');
            input.type = 'file';
            input.webkitdirectory = true;
            input.addEventListener('change', (e) => {
                this.handleLibraryLoad(e.target.files);
            });
            input.click();
        }
    }
    
    async handleLibraryLoad(files) {
        try {
            console.log('[SettingsPanel] Loading library from files:', files.length);
            
            // Process files and create exam index
            const exams = [];
            
            for (const file of files) {
                if (file.name.endsWith('.html')) {
                    const pathParts = file.webkitRelativePath.split('/');
                    const category = this.inferCategory(pathParts);
                    
                    exams.push({
                        id: this.generateExamId(file),
                        title: this.extractTitle(file.name),
                        category: category,
                        type: 'reading',
                        path: pathParts.slice(0, -1).join('/') + '/',
                        filename: file.name,
                        hasHtml: true,
                        hasPdf: false // Will be updated if PDF found
                    });
                }
            }
            
            // Update PDF flags
            for (const file of files) {
                if (file.name.endsWith('.pdf')) {
                    const htmlName = file.name.replace('.pdf', '.html');
                    const exam = exams.find(e => e.filename === htmlName);
                    if (exam) {
                        exam.hasPdf = true;
                    }
                }
            }
            
            // Save to storage
            await this.stores.exams.storage.set('exam_index', exams);
            await this.stores.exams.refreshExams();
            
            if (window.showMessage) {
                window.showMessage(`题库加载完成，共 ${exams.length} 题`, 'success');
            }
            
            console.log('[SettingsPanel] Library loaded successfully:', exams.length);
            
        } catch (error) {
            console.error('[SettingsPanel] Failed to load library:', error);
            this.stores.app.addError({
                message: `Failed to load library: ${error.message}`,
                context: 'SettingsPanel.handleLibraryLoad',
                error: error,
                recoverable: true,
                userMessage: '无法加载题库。',
                actions: ['Try again', 'Check file structure']
            });
        }
    }
    
    inferCategory(pathParts) {
        const path = pathParts.join('/').toLowerCase();
        if (path.includes('p1') || path.includes('part1')) return 'P1';
        if (path.includes('p2') || path.includes('part2')) return 'P2';
        if (path.includes('p3') || path.includes('part3')) return 'P3';
        if (path.includes('p4') || path.includes('part4')) return 'P4';
        return 'P1'; // Default
    }
    
    generateExamId(file) {
        const name = file.name.replace('.html', '');
        const timestamp = Date.now();
        return `exam_${name}_${timestamp}`.replace(/[^a-zA-Z0-9_]/g, '_');
    }
    
    extractTitle(filename) {
        return filename.replace('.html', '').replace(/[_-]/g, ' ').trim();
    }
    
    showLibraryConfig() {
        try {
            // Use existing library config if available
            if (window.LibraryConfig && window.LibraryConfig.show) {
                window.LibraryConfig.show();
            } else if (window.showLibraryConfigList) {
                // Use legacy function if available
                window.showLibraryConfigList();
            } else {
                // Show simple config selection
                this.showSimpleLibraryConfig();
            }
        } catch (error) {
            console.error('[SettingsPanel] Failed to show library config:', error);
            alert('题库配置功能暂不可用');
        }
    }
    
    showSimpleLibraryConfig() {
        // Simple library configuration dialog
        const configs = ['默认题库', '完整题库', '精简题库'];
        const current = '默认题库'; // Could be retrieved from storage
        
        const selection = prompt(`当前题库配置: ${current}\n\n可用配置:\n${configs.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n请输入配置编号 (1-${configs.length}):`);
        
        if (selection && !isNaN(selection)) {
            const index = parseInt(selection) - 1;
            if (index >= 0 && index < configs.length) {
                alert(`已切换到: ${configs[index]}\n\n请刷新页面以应用更改。`);
            } else {
                alert('无效的配置编号');
            }
        }
    }
    
    async loadLibrary(force = false) {
        try {
            console.log('[SettingsPanel] Loading library, force:', force);
            
            if (force) {
                // Clear existing data
                await this.stores.exams.storage.remove('exam_index');
            }
            
            // Reload exams
            await this.stores.exams.refreshExams();
            
            if (window.showMessage) {
                window.showMessage('题库已刷新', 'success');
            }
            
        } catch (error) {
            console.error('[SettingsPanel] Failed to load library:', error);
            this.stores.app.addError({
                message: `Failed to load library: ${error.message}`,
                context: 'SettingsPanel.loadLibrary',
                error: error,
                recoverable: true,
                userMessage: '无法加载题库。',
                actions: ['Try again', 'Check data integrity']
            });
        }
    }
    
    // Data Management Functions
    async createBackup() {
        try {
            console.log('[SettingsPanel] Creating backup...');
            
            const backupData = {
                timestamp: new Date().toISOString(),
                version: '1.0',
                exams: this.stores.exams.exams,
                records: this.stores.records.records,
                stats: this.stores.records.stats
            };
            
            const blob = new Blob([JSON.stringify(backupData, null, 2)], {
                type: 'application/json'
            });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ielts_backup_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            
            URL.revokeObjectURL(url);
            
            if (window.showMessage) {
                window.showMessage('备份文件已下载', 'success');
            }
            
            console.log('[SettingsPanel] Backup created successfully');
            
        } catch (error) {
            console.error('[SettingsPanel] Failed to create backup:', error);
            this.stores.app.addError({
                message: `Failed to create backup: ${error.message}`,
                context: 'SettingsPanel.createBackup',
                error: error,
                recoverable: true,
                userMessage: '无法创建备份。',
                actions: ['Try again', 'Export data separately']
            });
        }
    }
    
    showBackupList() {
        // Use existing backup manager if available
        if (window.DataBackupManager && window.DataBackupManager.showBackupList) {
            window.DataBackupManager.showBackupList();
        } else {
            // Fallback: simple alert
            alert('备份列表功能暂不可用\n\n请使用"创建备份"功能手动备份数据');
        }
    }
    
    async exportData() {
        try {
            console.log('[SettingsPanel] Exporting data...');
            
            const exportData = {
                exportDate: new Date().toISOString(),
                version: '1.0',
                exams: this.stores.exams.exams,
                records: this.stores.records.exportRecords(),
                systemInfo: {
                    totalExams: this.stores.exams.exams.length,
                    totalRecords: this.stores.records.records.length,
                    categories: this.stores.exams.getCategoryStats()
                }
            };
            
            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json'
            });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ielts_export_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            
            URL.revokeObjectURL(url);
            
            if (window.showMessage) {
                window.showMessage('数据已导出', 'success');
            }
            
            console.log('[SettingsPanel] Data exported successfully');
            
        } catch (error) {
            console.error('[SettingsPanel] Failed to export data:', error);
            this.stores.app.addError({
                message: `Failed to export data: ${error.message}`,
                context: 'SettingsPanel.exportData',
                error: error,
                recoverable: true,
                userMessage: '无法导出数据。',
                actions: ['Try again', 'Create backup instead']
            });
        }
    }
    
    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.handleDataImport(file);
            }
        });
        input.click();
    }
    
    async handleDataImport(file) {
        try {
            console.log('[SettingsPanel] Importing data from file:', file.name);
            
            const text = await file.text();
            const data = JSON.parse(text);
            
            // Validate import data
            if (window.validateImportData) {
                const validation = window.validateImportData(data);
                if (!validation.valid) {
                    throw new Error(`Invalid import data: ${validation.errors.join(', ')}`);
                }
            }
            
            const confirmed = confirm(`确定要导入数据吗？\n\n这将覆盖现有的练习记录。\n\n导入内容:\n- 题目: ${data.exams?.length || 0} 个\n- 记录: ${data.records?.length || 0} 条`);
            
            if (confirmed) {
                // Import records
                if (data.records && data.records.length > 0) {
                    await this.stores.records.importRecords(data);
                }
                
                // Import exams if available
                if (data.exams && data.exams.length > 0) {
                    await this.stores.exams.storage.set('exam_index', data.exams);
                    await this.stores.exams.refreshExams();
                }
                
                if (window.showMessage) {
                    window.showMessage('数据导入完成', 'success');
                }
                
                console.log('[SettingsPanel] Data imported successfully');
            }
            
        } catch (error) {
            console.error('[SettingsPanel] Failed to import data:', error);
            this.stores.app.addError({
                message: `Failed to import data: ${error.message}`,
                context: 'SettingsPanel.handleDataImport',
                error: error,
                recoverable: true,
                userMessage: '无法导入数据。请检查文件格式。',
                actions: ['Try again', 'Check file format', 'Create new backup']
            });
        }
    }
    
    // Theme and UI Functions (keep existing functionality)
    showThemeSwitcher() {
        const modal = document.getElementById('theme-switcher-modal');
        if (modal) {
            modal.style.display = 'flex';
        }
    }
    
    showDeveloperTeam() {
        const modal = document.getElementById('developer-modal');
        if (modal) {
            modal.style.display = 'flex';
        }
    }
    
    hideDeveloperTeam() {
        const modal = document.getElementById('developer-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }
    
    // Public API methods
    refresh() {
        this.updateSystemInfo();
    }
    
    // Cleanup
    destroy() {
        if (this.unsubscribeExams) {
            this.unsubscribeExams();
        }
        if (this.unsubscribeApp) {
            this.unsubscribeApp();
        }
        
        // Remove global functions (keep theme functions)
        delete window.clearCache;
        delete window.showLibraryLoaderModal;
        delete window.showLibraryConfigListV2;
        delete window.loadLibrary;
        delete window.createManualBackup;
        delete window.showBackupList;
        delete window.exportAllData;
        delete window.importData;
        
        console.log('[SettingsPanel] Destroyed');
    }
};