// SettingsPanel.js - UI panel for system settings display
// Coordinates with SettingsActions, renders system info
// Inherits from BaseComponent, handles store integration

class SettingsPanel extends BaseComponent {
    constructor(stores) {
        super(stores, {
            container: document.getElementById('settings-view'),
            totalExams: document.getElementById('total-exams'),
            htmlExams: document.getElementById('html-exams'),
            pdfExams: document.getElementById('pdf-exams'),
            lastUpdate: document.getElementById('last-update')
        });
        this.actions = null;
        this.checkRequiredElements();
        this.initActions();
    }

    checkRequiredElements() {
        const required = ['container'];
        const missing = required.filter(key => !this.elements[key]);
        if (missing.length > 0) {
            console.warn('[SettingsPanel] Missing elements:', missing);
            this.createFallbackElements(missing);
        }
    }

    createFallbackElements(missing) {
        if (missing.includes('container')) {
            this.elements.container = document.createElement('div');
            this.elements.container.id = 'settings-view';
            document.body.appendChild(this.elements.container);
        }
        // Create stat elements if missing
        ['totalExams', 'htmlExams', 'pdfExams', 'lastUpdate'].forEach(key => {
            if (!this.elements[key]) {
                this.elements[key] = document.createElement('span');
                this.elements[key].id = key;
                this.elements.container.appendChild(this.elements[key]);
            }
        });
    }

    initActions() {
        this.actions = new SettingsActions(this.stores);
    }

    attach(container) {
        super.attach(container);
        this.actions.attach(this.elements.container);
        this.createButtons();
        this.updateSystemInfo();
    }

    createButtons() {
        if (!this.elements.container) return;

        // Rebuild Indexes button
        const rebuildBtn = document.createElement('button');
        rebuildBtn.id = 'rebuild-indexes';
        rebuildBtn.textContent = 'Rebuild Indexes';
        rebuildBtn.style.margin = '10px';
        rebuildBtn.addEventListener('click', () => this.rebuildIndexes());
        this.elements.container.appendChild(rebuildBtn);

        // Restore Backup button
        const restoreBtn = document.createElement('button');
        restoreBtn.id = 'restore-backup';
        restoreBtn.textContent = 'Restore Backup';
        restoreBtn.style.margin = '10px';
        restoreBtn.addEventListener('click', () => this.restoreBackup());
        this.elements.container.appendChild(restoreBtn);

        // Auto Backup Toggle
        const autoBackupLabel = document.createElement('label');
        autoBackupLabel.textContent = '自动备份: ';
        autoBackupLabel.style.margin = '10px';
        const autoBackupCheckbox = document.createElement('input');
        autoBackupCheckbox.type = 'checkbox';
        autoBackupCheckbox.checked = window.dim ? window.dim.autoBackupEnabled : false;
        autoBackupCheckbox.addEventListener('change', (e) => {
            if (window.dim) {
                if (e.target.checked) {
                    window.dim.enableAutoBackup();
                } else {
                    window.dim.disableAutoBackup();
                }
            }
        });
        autoBackupLabel.appendChild(autoBackupCheckbox);
        this.elements.container.appendChild(autoBackupLabel);
    }

    subscribeToStores() {
        this.addSubscription(this.stores.exams.subscribe(this.handleExamStoreChange.bind(this)));
        this.addSubscription(this.stores.app.subscribe(this.handleAppStoreChange.bind(this)));
    }

    handleExamStoreChange(event) {
        switch (event.type) {
            case 'exams_loaded':
                this.updateSystemInfo();
                break;
        }
    }

    handleAppStoreChange(event) {
        switch (event.type) {
            case 'view_changed':
                if (event.view === 'settings') {
                    this.updateSystemInfo();
                }
                break;
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

    rebuildIndexes() {
        if (confirm('This will clear and rebuild indexes from data sources. Continue?')) {
            try {
                localStorage.removeItem('exams_index'); // Assume index key
                // Trigger reload from stores
                if (this.stores.exams.loadExams) {
                    this.stores.exams.loadExams();
                } else {
                    // Fallback: reload page to reinitialize
                    location.reload();
                }
                alert('Indexes rebuilt successfully.');
            } catch (error) {
                console.error('[SettingsPanel] Rebuild failed:', error);
                alert('Rebuild failed: ' + error.message);
            }
        }
    }

    restoreBackup() {
        if (confirm('This will restore from backup and overwrite current data. Continue?')) {
            try {
                const backup = localStorage.getItem('backup');
                if (backup) {
                    const data = JSON.parse(backup);
                    Object.keys(data).forEach(key => {
                        localStorage.setItem(key, data[key]);
                    });
                    alert('Backup restored successfully. Please refresh the page.');
                } else {
                    alert('No backup found.');
                }
            } catch (error) {
                console.error('[SettingsPanel] Restore failed:', error);
                alert('Restore failed: ' + error.message);
            }
        }
    }

    // Public API
    refresh() {
        this.updateSystemInfo();
    }

    // Global instance for compatibility
    static instance = null;
}

// Export and set global instance
const settingsPanelInstance = new SettingsPanel(window.stores || { exams: {}, app: {} });
window.SettingsPanel = SettingsPanel;
window.SettingsPanelInstance = settingsPanelInstance;
settingsPanelInstance.attach(document.getElementById('settings-view') || document.body);

console.log('[SettingsPanel] Panel initialized');