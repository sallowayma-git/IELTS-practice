/**
 * 练习历史增强器
 * 为练习历史组件添加 Markdown 导出和详情弹窗功能
 */
class PracticeHistoryEnhancer {
    constructor() {
        this.initialized = false;
    }

    /**
     * 初始化增强功能
     */
    initialize() {
        if (this.initialized) {
            console.log('[PracticeHistoryEnhancer] 已初始化，跳过重复初始化');
            return;
        }

        // 立即标记为初始化中，防止重复调用
        this.initialized = true;

        try {
            console.log('[PracticeHistoryEnhancer] 开始初始化');

            // 等待练习历史组件加载
            this.waitForPracticeHistory().then(() => {
                this.enhancePracticeHistory();
                console.log('[PracticeHistoryEnhancer] 练习历史增强功能已初始化');
            }).catch(error => {
                console.error('[PracticeHistoryEnhancer] 初始化失败:', error);
                // 提供降级功能
                this.initializeFallback();
            });
        } catch (error) {
            console.error('[PracticeHistoryEnhancer] 初始化过程出错:', error);
            this.initializeFallback();
        }
    }

    /**
     * 降级初始化
     */
    initializeFallback() {
        console.log('[PracticeHistoryEnhancer] 使用降级初始化');
        
        // 确保基本的全局函数可用
        if (!window.showRecordDetails) {
            window.showRecordDetails = (recordId) => {
                this.showRecordDetails(recordId);
            };
        }
        
        // 确保导出功能可用
        if (!window.exportPracticeDataEnhanced) {
            window.exportPracticeDataEnhanced = () => {
                this.showExportDialog();
            };
        }
        
        this.initialized = true;
        console.log('[PracticeHistoryEnhancer] 降级初始化完成');
    }

    /**
     * 等待练习历史组件加载
     */
    async waitForPracticeHistory() {
        return new Promise((resolve, reject) => {
            let checkCount = 0;
            const maxChecks = 50; // 最多检查50次（5秒）
            
            const checkInterval = setInterval(() => {
                checkCount++;
                
                // 检查是否有练习历史相关的函数或数据
                const hasStandardComponent = window.app?.components?.practiceHistory;
                const hasGlobalData = typeof window.exportPracticeData === 'function' && window.practiceRecords;
                const hasBasicStructure = document.querySelector('.practice-history') || 
                                        document.querySelector('#practice-records') ||
                                        typeof window.practiceRecords !== 'undefined';
                
                if (hasStandardComponent || hasGlobalData || hasBasicStructure) {
                    clearInterval(checkInterval);
                    console.log('[PracticeHistoryEnhancer] 检测到练习历史组件');
                    resolve();
                    return;
                }
                
                // 超时处理
                if (checkCount >= maxChecks) {
                    clearInterval(checkInterval);
                    console.warn('[PracticeHistoryEnhancer] 等待超时，继续初始化');
                    resolve(); // 不reject，继续初始化
                }
            }, 100);
        });
    }

    /**
     * 增强练习历史组件
     */
    enhancePracticeHistory() {
        try {
            // 检查是否有标准的练习历史组件
            if (window.app?.components?.practiceHistory) {
                const practiceHistory = window.app.components.practiceHistory;
                
                // 保存原始方法
                const originalCreateRecordItem = practiceHistory.createRecordItem?.bind(practiceHistory);
                const originalExportHistory = practiceHistory.exportHistory?.bind(practiceHistory);
                
                // 增强 createRecordItem 方法，添加可点击标题
                if (originalCreateRecordItem) {
                    practiceHistory.createRecordItem = (record) => {
                        const html = originalCreateRecordItem(record);
                        // 替换标题，使其可点击
                        return html.replace(
                            /<h4 class="record-title clickable">([^<]+)<\/h4>/,
                            `<h4 class="record-title practice-record-title" onclick="window.practiceHistoryEnhancer.showRecordDetails('${record.id}')" title="点击查看详情">$1</h4>`
                        );
                    };
                }

                // 增强导出功能，添加 Markdown 导出选项
                if (originalExportHistory) {
                    practiceHistory.exportHistory = () => {
                        this.showExportDialog();
                    };
                }

                // 添加显示记录详情的方法
                practiceHistory.showRecordDetails = (recordId) => {
                    this.showRecordDetails(recordId);
                };

                console.log('[PracticeHistoryEnhancer] 标准练习历史组件已增强');
            } else {
                // 对于improved-working-system.html这样的系统，直接增强全局函数
                if (typeof window.exportPracticeData === 'function') {
                    console.log('[PracticeHistoryEnhancer] 检测到全局导出函数');
                }
                
                // 确保全局可以访问showRecordDetails方法
                if (!window.showRecordDetails) {
                    window.showRecordDetails = (recordId) => {
                        this.showRecordDetails(recordId);
                    };
                }
                
                console.log('[PracticeHistoryEnhancer] 全局函数已增强');
            }
        } catch (error) {
            console.error('[PracticeHistoryEnhancer] 增强过程出错:', error);
            // 确保基本功能可用
            if (!window.showRecordDetails) {
                window.showRecordDetails = (recordId) => {
                    this.showRecordDetails(recordId);
                };
            }
        }
    }

    /**
     * 显示导出选择对话框
     */
    showExportDialog() {
        const dialogHtml = `
            <div id="export-dialog" class="modal-overlay">
                <div class="modal-container" style="max-width: 500px;">
                    <div class="modal-header">
                        <h3 class="modal-title">导出练习记录</h3>
                        <button class="modal-close" onclick="document.getElementById('export-dialog').remove()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    
                    <div class="modal-body">
                        <div class="export-options">
                            <h4>选择导出格式：</h4>
                            <div class="format-options">
                                <label class="format-option">
                                    <input type="radio" name="export-format" value="json" checked>
                                    <div class="option-content">
                                        <strong>JSON 格式</strong>
                                        <p>完整的数据格式，可用于备份和导入</p>
                                    </div>
                                </label>
                                <label class="format-option">
                                    <input type="radio" name="export-format" value="markdown">
                                    <div class="option-content">
                                        <strong>Markdown 格式</strong>
                                        <p>易读的文档格式，包含详细的答题表格</p>
                                    </div>
                                </label>
                            </div>
                        </div>
                    </div>
                    
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="document.getElementById('export-dialog').remove()">
                            取消
                        </button>
                        <button class="btn btn-primary" onclick="window.practiceHistoryEnhancer.performExport()">
                            <i class="fas fa-download"></i> 导出
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', dialogHtml);
    }

    /**
     * 执行导出
     */
    performExport() {
        try {
            const selectedFormat = document.querySelector('input[name="export-format"]:checked')?.value;
            
            if (selectedFormat === 'markdown') {
                this.exportAsMarkdown();
            } else {
                this.exportAsJSON();
            }
            
            // 关闭对话框
            document.getElementById('export-dialog')?.remove();
            
        } catch (error) {
            console.error('导出失败:', error);
            window.showMessage('导出失败: ' + error.message, 'error');
        }
    }

    /**
     * 导出为 Markdown 格式
     */
    exportAsMarkdown() {
        if (!window.MarkdownExporter) {
            throw new Error('MarkdownExporter 未加载');
        }
        
        const exporter = new MarkdownExporter();
        exporter.exportToMarkdown();
        
        window.showMessage('Markdown 格式导出成功', 'success');
    }

    /**
     * 导出为 JSON 格式
     */
    exportAsJSON() {
        try {
            // 尝试使用标准的PracticeRecorder
            const practiceRecorder = window.app?.components?.practiceRecorder;
            if (practiceRecorder) {
                const exportData = practiceRecorder.exportData('json');
                
                const blob = new Blob([exportData], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `practice_history_${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                if (window.showMessage) {
                    window.showMessage('JSON 格式导出成功', 'success');
                }
                return;
            }
            
            // 降级到直接从全局变量导出
            let practiceRecords = [];
            let practiceStats = {};
            
            if (window.practiceRecords) {
                practiceRecords = window.practiceRecords;
            } else if (window.storage) {
                practiceRecords = window.storage.get('practice_records', []);
            }
            
            if (window.practiceStats) {
                practiceStats = window.practiceStats;
            }
            
            if (practiceRecords.length === 0) {
                throw new Error('没有练习记录可导出');
            }
            
            const data = {
                exportDate: new Date().toISOString(),
                stats: practiceStats,
                records: practiceRecords
            };
            
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `practice_history_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            if (window.showMessage) {
                window.showMessage('JSON 格式导出成功', 'success');
            }
            
        } catch (error) {
            console.error('JSON导出失败:', error);
            throw error;
        }
    }

    /**
      * 显示记录详情
      */
    async showRecordDetails(recordId) {
        try {
            // 尝试从不同的数据源获取记录
            let record = null;

            // 首先尝试从storage获取（兼容数值/字符串ID）
            const toIdStr = (v) => v == null ? '' : String(v);
            const targetIdStr = toIdStr(recordId);

            if (window.storage) {
                const practiceRecords = await window.storage.get('practice_records', []);
                record = practiceRecords.find(r => r.id === recordId || toIdStr(r.id) === targetIdStr);
            }

            // 如果storage中没有，尝试从全局变量获取
            if (!record && window.practiceRecords) {
                record = window.practiceRecords.find(r => r.id === recordId || toIdStr(r.id) === targetIdStr);
            }

            // 额外降级：尝试按会话ID匹配
            if (!record && window.storage) {
                const practiceRecords = await window.storage.get('practice_records', []);
                record = practiceRecords.find(r => toIdStr(r.sessionId) === targetIdStr);
            }
            
            if (!record) {
                throw new Error('记录不存在');
            }
            
            // 使用练习记录弹窗组件显示详情
            if (window.practiceRecordModal) {
                window.practiceRecordModal.show(record);
            } else {
                throw new Error('PracticeRecordModal 组件未加载');
            }
            
        } catch (error) {
            console.error('显示记录详情失败:', error);
            if (window.showMessage) {
                window.showMessage('无法显示记录详情: ' + error.message, 'error');
            } else {
                alert('无法显示记录详情: ' + error.message);
            }
        }
    }
}

// 创建全局实例
window.practiceHistoryEnhancer = new PracticeHistoryEnhancer();

// 统一初始化逻辑
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.practiceHistoryEnhancer.initialize();
    });
} else {
    // 页面已加载完成，延迟初始化
    setTimeout(() => {
        window.practiceHistoryEnhancer.initialize();
    }, 100);
}