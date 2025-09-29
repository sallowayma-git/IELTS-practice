/**
 * Legacy Bridge - 兼容层
 *
 * 在新架构和旧功能之间建立桥梁，确保现有功能继续工作
 * 同时逐步迁移到新的清洁架构
 */

console.log('[LegacyBridge] 初始化兼容层...');

// 确保存储管理器设置正确的命名空间
if (window.storage && typeof window.storage.setNamespace === 'function') {
  window.storage.setNamespace('exam_system');
  console.log('✅ 存储命名空间已设置为: exam_system');
}

// 兼容：创建全局存储实例供现有代码使用
window.examStore = window.examStore || new window.ExamStore();
window.recordStore = window.recordStore || new window.RecordStore();
window.appStore = window.appStore || new window.AppStore();

// 兼容：保持现有的全局函数，但重定向到新架构
window.showView = function(viewName) {
  if (window.app) {
    window.app.navigateToView(viewName);
  }
};

window.filterByType = function(type) {
  if (window.app && window.app.components.examBrowser) {
    window.app.components.examBrowser.render({ type });
  }
};

window.filterRecordsByType = function(type) {
  if (window.app && window.app.components.recordViewer) {
    window.app.components.recordViewer.render(type);
  }
};

window.searchExams = function(searchTerm) {
  if (window.app && window.app.components.examBrowser) {
    window.app.components.examBrowser.render({ search: searchTerm });
  }
};

window.toggleBulkDelete = function() {
  if (window.app && window.app.components.recordViewer) {
    window.app.components.recordViewer.toggleBulkDelete();
  }
};

window.clearPracticeData = function() {
  if (window.app && window.app.components.recordViewer) {
    window.app.components.recordViewer.clearAllRecords();
  }
};

// 兼容：题库管理功能
window.showLibraryLoaderModal = function() {
  if (window.app && window.app.showMessage) {
    window.app.showMessage('题库加载器功能待实现', 'info');
  }
};

window.showLibraryConfigListV2 = function() {
  if (window.app && window.app.showMessage) {
    window.app.showMessage('题库配置功能待实现', 'info');
  }
};

// 兼容：数据管理功能
window.exportPracticeData = function() {
  if (window.app && window.app.components.recordViewer) {
    window.app.components.recordViewer.exportRecords();
  }
};

window.importData = function() {
  if (window.app && window.app.components.settingsPanel) {
    window.app.components.settingsPanel.importData();
  }
};

window.createManualBackup = function() {
  if (window.app && window.app.components.settingsPanel) {
    window.app.components.settingsPanel.createBackup();
  }
};

window.showBackupList = function() {
  if (window.app && window.app.components.settingsPanel) {
    window.app.components.settingsPanel.showBackups();
  }
};

window.clearCache = function() {
  if (window.app && window.app.components.settingsPanel) {
    window.app.components.settingsPanel.clearCache();
  }
};

// 兼容：开发者功能
window.showDeveloperTeam = function() {
  const modal = document.getElementById('developer-modal');
  if (modal) {
    modal.style.display = 'block';
  } else if (window.app && window.app.showMessage) {
    window.app.showMessage('开发团队信息待完善', 'info');
  }
};

window.hideDeveloperTeam = function() {
  const modal = document.getElementById('developer-modal');
  if (modal) {
    modal.style.display = 'none';
  }
};

// 兼容：主题切换功能
window.showThemeSwitcherModal = function() {
  const modal = document.getElementById('theme-switcher-modal');
  if (modal) {
    modal.style.display = 'block';
  }
};

window.hideThemeSwitcherModal = function() {
  const modal = document.getElementById('theme-switcher-modal');
  if (modal) {
    modal.style.display = 'none';
  }
};

window.applyTheme = function(theme) {
  if (theme && window.appStore) {
    window.appStore.updateSettings({ theme });
  }
};

window.toggleBloomDarkMode = function() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'bloom-dark';
  html.setAttribute('data-theme', isDark ? 'bloom' : 'bloom-dark');
  localStorage.setItem('theme', isDark ? 'bloom' : 'bloom-dark');
};

// 兼容：消息系统
window.showMessage = function(message, type = 'info', duration = 4000) {
  if (window.app && window.app.showMessage) {
    window.app.showMessage(message, type, duration);
  } else {
    console.log(`[Message] ${type}: ${message}`);
    // 简单的消息显示作为后备
    const container = document.getElementById('message-container');
    if (container) {
      const messageEl = document.createElement('div');
      messageEl.className = `message message-${type}`;
      messageEl.textContent = message;
      container.appendChild(messageEl);
      setTimeout(() => {
        if (messageEl.parentNode) {
          messageEl.parentNode.removeChild(messageEl);
        }
      }, duration);
    }
  }
};

// 兼容：导出功能
window.exportExamIndexToScriptFile = function(exams, reason) {
  if (window.app && window.app.showMessage) {
    window.app.showMessage(`导出索引功能待实现 (${reason})`, 'info');
  }
};

window.exportAllData = function() {
  if (window.app && window.app.components.settingsPanel) {
    window.app.components.settingsPanel.exportData();
  }
};

// 兼容：初始化函数
window.initializeLegacyComponents = function() {
  console.log('[LegacyBridge] 初始化现有组件...');
  // 这里可以添加需要初始化的现有组件
};

// 兼容：路由系统
window.browseCategory = function(category, type) {
  if (window.app) {
    window.app.navigateToView('browse');
    if (window.app.components.examBrowser) {
      window.app.components.examBrowser.render({ category, type });
    }
  }
};

// 兼容：统计信息更新
window.updateStatsDisplay = function() {
  if (window.app && window.app.components.recordViewer) {
    const stats = window.recordStore.getStats();
    window.app.updateStatsDisplay(stats);
  }
};

// 兼容：资源路径构建
window.buildResourcePath = function(exam, kind = 'html') {
  const basePath = exam.path || '';
  const filename = kind === 'pdf' ? exam.pdfFilename : exam.filename;
  return `./${basePath}${filename}`;
};

// 兼容：记录详情显示
window.showRecordDetails = function(recordId) {
  if (window.app) {
    window.app.showRecordDetails(recordId);
  }
};

// 等待DOM加载完成后初始化新架构
document.addEventListener('DOMContentLoaded', function() {
  console.log('[LegacyBridge] DOM加载完成，准备初始化新架构...');

  // 等待所有脚本加载完成
  setTimeout(() => {
    if (window.App && window.storage) {
      // 启动新架构应用
      const app = new window.App();
      app.start().then(success => {
        if (success) {
          console.log('✅ 新架构应用启动成功');

          // 初始化统计显示
          window.updateStatsDisplay();

        } else {
          console.error('❌ 新架构应用启动失败');
        }
      });
    } else {
      console.warn('[LegacyBridge] 新架构组件未完全加载，使用兼容模式');
    }
  }, 100);
});

console.log('[LegacyBridge] ✅ 兼容层初始化完成');