# 故障排除指南

本指南提供了考试总览系统常见问题的详细排除步骤和解决方案。

## 🚨 紧急故障处理

### 系统完全无法访问

**症状**: 打开系统显示空白页面或错误信息

**紧急处理步骤**:
1. **立即检查**:
   ```bash
   # 检查Web服务器状态
   curl -I http://localhost:8000
   # 或在浏览器中访问
   http://localhost:8000/index.html
   ```

2. **快速恢复**:
   ```bash
   # 重启Web服务器
   # Python
   python -m http.server 8000
   
   # Node.js
   npx http-server -p 8000
   ```

3. **验证文件完整性**:
   ```bash
   # 检查关键文件
   ls -la index.html js/app.js css/styles.css
   ```

### 数据丢失紧急恢复

**症状**: 所有练习记录和设置消失

**紧急恢复步骤**:
1. **检查自动备份**:
   ```javascript
   // 在浏览器控制台运行
   const backups = localStorage.getItem('exam_system_backups');
   if (backups) {
       console.log('Found backups:', JSON.parse(backups));
   } else {
       console.log('No automatic backups found');
   }
   ```

2. **恢复最近备份**:
   ```javascript
   // 恢复最新备份
   const backups = JSON.parse(localStorage.getItem('exam_system_backups') || '[]');
   if (backups.length > 0) {
       const latest = backups[backups.length - 1];
       Object.keys(latest.data).forEach(key => {
           localStorage.setItem(key, JSON.stringify(latest.data[key]));
       });
       location.reload();
   }
   ```

3. **手动数据恢复**:
   - 查找之前导出的备份文件
   - 使用"导入数据"功能恢复
   - 联系技术支持获取帮助

## 🔧 系统启动问题

### 问题1: 页面加载失败

**详细诊断步骤**:

1. **检查浏览器控制台**:
   ```javascript
   // 按F12打开开发者工具，查看Console标签页
   // 常见错误类型：
   // - SyntaxError: 文件语法错误
   // - ReferenceError: 变量未定义
   // - TypeError: 类型错误
   // - NetworkError: 网络请求失败
   ```

2. **验证文件路径**:
   ```bash
   # 检查文件结构
   find . -name "*.html" -o -name "*.js" -o -name "*.css" | head -20
   
   # 检查权限
   ls -la index.html
   ls -la js/
   ls -la css/
   ```

3. **测试基本功能**:
   ```javascript
   // 在控制台测试基本JavaScript功能
   console.log('JavaScript working:', typeof console);
   console.log('LocalStorage available:', typeof Storage !== "undefined");
   console.log('Fetch API available:', typeof fetch !== "undefined");
   ```

**解决方案**:
- **语法错误**: 检查最近修改的文件，恢复到工作版本
- **路径错误**: 确认所有文件路径正确，特别是相对路径
- **权限问题**: 确保Web服务器有读取文件的权限

### 问题2: 题库扫描失败

**诊断步骤**:

1. **检查题库结构**:
   ```bash
   # 验证目录结构
   ls -la "P1（12+8）/"
   ls -la "P2（14+2）/"
   ls -la "P3 （20+6）/"
   
   # 检查HTML文件
   find "P1（12+8）/" -name "*.html" | head -5
   ```

2. **测试文件访问**:
   ```javascript
   // 测试单个文件访问
   fetch('P1（12+8）/1.高频(网页由窦立盛老师制作)/1.A Brief History of Tea 茶叶简史/P1 - A Brief History of Tea【高】.html')
   .then(response => {
       console.log('File accessible:', response.ok);
       console.log('Status:', response.status);
   })
   .catch(error => {
       console.error('File access error:', error);
   });
   ```

3. **检查文件编码**:
   ```bash
   # 检查文件编码
   file -I "P1（12+8）/1.高频(网页由窦立盛老师制作)/1.A Brief History of Tea 茶叶简史/P1 - A Brief History of Tea【高】.html"
   
   # 应该显示: charset=utf-8
   ```

**解决方案**:
- **结构问题**: 重新组织文件结构，确保符合要求
- **编码问题**: 将文件转换为UTF-8编码
- **权限问题**: 设置正确的文件权限

## 💾 数据存储问题

### 问题3: 练习记录无法保存

**诊断步骤**:

1. **检查LocalStorage状态**:
   ```javascript
   // 测试LocalStorage功能
   try {
       localStorage.setItem('test_key', 'test_value');
       const value = localStorage.getItem('test_key');
       localStorage.removeItem('test_key');
       console.log('LocalStorage working:', value === 'test_value');
   } catch (error) {
       console.error('LocalStorage error:', error);
   }
   ```

2. **检查存储配额**:
   ```javascript
   // 检查存储使用情况
   if (navigator.storage && navigator.storage.estimate) {
       navigator.storage.estimate().then(estimate => {
           console.log('Storage quota:', estimate.quota);
           console.log('Storage usage:', estimate.usage);
           console.log('Available:', estimate.quota - estimate.usage);
       });
   }
   
   // 计算当前使用量
   let totalSize = 0;
   for (let key in localStorage) {
       if (localStorage.hasOwnProperty(key)) {
           totalSize += localStorage[key].length + key.length;
       }
   }
   console.log('LocalStorage size:', totalSize, 'characters');
   ```

3. **检查浏览器设置**:
   ```javascript
   // 检查是否在隐私模式
   function isPrivateMode() {
       try {
           localStorage.setItem('private_test', '1');
           localStorage.removeItem('private_test');
           return false;
       } catch (e) {
           return true;
       }
   }
   console.log('Private mode:', isPrivateMode());
   ```

**解决方案**:
- **配额不足**: 清理旧数据或使用数据压缩
- **隐私模式**: 切换到正常浏览模式
- **浏览器限制**: 检查浏览器存储设置

### 问题4: 数据损坏或不一致

**诊断步骤**:

1. **数据完整性检查**:
   ```javascript
   // 检查关键数据结构
   function checkDataIntegrity() {
       const checks = {
           examIndex: 'exam_system_exam_index',
           practiceRecords: 'exam_system_practice_records',
           userStats: 'exam_system_user_stats',
           settings: 'exam_system_settings'
       };
       
       const results = {};
       
       Object.entries(checks).forEach(([name, key]) => {
           try {
               const data = localStorage.getItem(key);
               if (data) {
                   const parsed = JSON.parse(data);
                   results[name] = {
                       exists: true,
                       valid: true,
                       size: data.length,
                       type: Array.isArray(parsed) ? 'array' : typeof parsed,
                       length: Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length
                   };
               } else {
                   results[name] = { exists: false };
               }
           } catch (error) {
               results[name] = { exists: true, valid: false, error: error.message };
           }
       });
       
       return results;
   }
   
   console.log('Data integrity check:', checkDataIntegrity());
   ```

2. **修复损坏数据**:
   ```javascript
   // 修复练习记录
   function repairPracticeRecords() {
       try {
           const records = JSON.parse(localStorage.getItem('exam_system_practice_records') || '[]');
           const validRecords = records.filter(record => {
               return record.id && record.examId && record.startTime && record.status;
           });
           
           console.log('Original records:', records.length);
           console.log('Valid records:', validRecords.length);
           console.log('Removed invalid:', records.length - validRecords.length);
           
           localStorage.setItem('exam_system_practice_records', JSON.stringify(validRecords));
           return validRecords.length;
       } catch (error) {
           console.error('Repair failed:', error);
           return -1;
       }
   }
   
   repairPracticeRecords();
   ```

## ⚡ 性能问题

### 问题5: 系统运行缓慢

**性能诊断**:

1. **内存使用检查**:
   ```javascript
   // 检查内存使用情况
   if (performance.memory) {
       console.log('Memory usage:', {
           used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) + ' MB',
           total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024) + ' MB',
           limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024) + ' MB'
       });
   }
   ```

2. **性能监控**:
   ```javascript
   // 启用性能监控
   function enablePerformanceMonitoring() {
       const observer = new PerformanceObserver((list) => {
           list.getEntries().forEach((entry) => {
               if (entry.duration > 100) { // 超过100ms的操作
                   console.warn('Slow operation:', entry.name, entry.duration + 'ms');
               }
           });
       });
       
       observer.observe({ entryTypes: ['measure', 'navigation'] });
   }
   
   enablePerformanceMonitoring();
   ```

3. **网络性能检查**:
   ```javascript
   // 检查网络请求性能
   function checkNetworkPerformance() {
       const entries = performance.getEntriesByType('navigation');
       if (entries.length > 0) {
           const nav = entries[0];
           console.log('Page load performance:', {
               DNS: nav.domainLookupEnd - nav.domainLookupStart,
               Connect: nav.connectEnd - nav.connectStart,
               Request: nav.responseStart - nav.requestStart,
               Response: nav.responseEnd - nav.responseStart,
               DOM: nav.domContentLoadedEventEnd - nav.domContentLoadedEventStart,
               Total: nav.loadEventEnd - nav.navigationStart
           });
       }
   }
   
   checkNetworkPerformance();
   ```

**性能优化方案**:

1. **启用性能模式**:
   ```javascript
   // 启用轻量级模式
   localStorage.setItem('exam_system_performance_mode', 'true');
   localStorage.setItem('exam_system_animations', 'false');
   localStorage.setItem('exam_system_cache_size', '25');
   ```

2. **清理缓存数据**:
   ```javascript
   // 清理过期缓存
   function cleanCache() {
       const cacheKeys = Object.keys(localStorage).filter(key => 
           key.startsWith('exam_system_cache_')
       );
       
       cacheKeys.forEach(key => {
           try {
               const data = JSON.parse(localStorage.getItem(key));
               if (data.timestamp && Date.now() - data.timestamp > 86400000) { // 24小时
                   localStorage.removeItem(key);
                   console.log('Removed expired cache:', key);
               }
           } catch (error) {
               localStorage.removeItem(key); // 删除损坏的缓存
           }
       });
   }
   
   cleanCache();
   ```

### 问题6: 内存泄漏

**内存泄漏检测**:

1. **监控内存增长**:
   ```javascript
   // 内存监控脚本
   function startMemoryMonitoring() {
       let initialMemory = performance.memory ? performance.memory.usedJSHeapSize : 0;
       
       setInterval(() => {
           if (performance.memory) {
               const currentMemory = performance.memory.usedJSHeapSize;
               const growth = currentMemory - initialMemory;
               
               if (growth > 10 * 1024 * 1024) { // 增长超过10MB
                   console.warn('Memory growth detected:', Math.round(growth / 1024 / 1024) + 'MB');
               }
           }
       }, 30000); // 每30秒检查一次
   }
   
   startMemoryMonitoring();
   ```

2. **清理内存**:
   ```javascript
   // 强制垃圾回收（仅在开发模式下可用）
   if (window.gc) {
       window.gc();
       console.log('Garbage collection triggered');
   }
   
   // 清理事件监听器
   function cleanupEventListeners() {
       // 移除所有自定义事件监听器
       document.querySelectorAll('[data-event-attached]').forEach(element => {
           element.removeAttribute('data-event-attached');
           // 这里需要根据实际情况移除具体的监听器
       });
   }
   ```

## 🌐 网络和连接问题

### 问题7: 文件加载失败

**网络诊断**:

1. **检查网络连接**:
   ```javascript
   // 测试网络连接
   function testNetworkConnection() {
       const testUrls = [
           './index.html',
           './js/app.js',
           './css/styles.css'
       ];
       
       Promise.all(testUrls.map(url => 
           fetch(url, { method: 'HEAD' })
           .then(response => ({ url, status: response.status, ok: response.ok }))
           .catch(error => ({ url, error: error.message }))
       )).then(results => {
           console.log('Network test results:', results);
       });
   }
   
   testNetworkConnection();
   ```

2. **检查CORS问题**:
   ```javascript
   // 检查跨域问题
   function checkCORS() {
       fetch('./test.json', {
           method: 'GET',
           mode: 'cors'
       })
       .then(response => console.log('CORS OK'))
       .catch(error => {
           if (error.message.includes('CORS')) {
               console.error('CORS issue detected:', error);
           }
       });
   }
   ```

**解决方案**:
- **本地文件访问**: 确保通过HTTP服务器访问，不要直接打开HTML文件
- **防火墙问题**: 检查防火墙设置，允许Web服务器端口
- **代理设置**: 检查浏览器代理设置

### 问题8: 题目窗口无法打开

**弹窗问题诊断**:

1. **检查弹窗阻止**:
   ```javascript
   // 测试弹窗功能
   function testPopup() {
       const popup = window.open('about:blank', 'test', 'width=100,height=100');
       if (popup) {
           popup.close();
           console.log('Popup allowed');
           return true;
       } else {
           console.error('Popup blocked');
           return false;
       }
   }
   
   testPopup();
   ```

2. **替代方案**:
   ```javascript
   // 使用iframe替代弹窗
   function openInIframe(url) {
       const iframe = document.createElement('iframe');
       iframe.src = url;
       iframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;border:none;';
       
       const closeBtn = document.createElement('button');
       closeBtn.textContent = '关闭';
       closeBtn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:10000;';
       closeBtn.onclick = () => {
           document.body.removeChild(iframe);
           document.body.removeChild(closeBtn);
       };
       
       document.body.appendChild(iframe);
       document.body.appendChild(closeBtn);
   }
   ```

## 🔒 安全和权限问题

### 问题9: 文件访问权限

**权限检查**:

1. **文件系统权限**:
   ```bash
   # Linux/Mac权限检查
   ls -la index.html
   ls -la js/
   ls -la css/
   
   # 修复权限
   chmod 644 index.html
   chmod -R 644 js/
   chmod -R 644 css/
   chmod 755 . # 目录权限
   ```

2. **Web服务器权限**:
   ```bash
   # 检查Web服务器用户权限
   whoami
   groups
   
   # 确保Web服务器可以访问文件
   sudo chown -R www-data:www-data /path/to/exam-system
   # 或
   sudo chown -R $USER:$USER /path/to/exam-system
   ```

### 问题10: 浏览器安全限制

**安全策略检查**:

1. **内容安全策略(CSP)**:
   ```javascript
   // 检查CSP限制
   function checkCSP() {
       try {
           eval('console.log("eval allowed")');
       } catch (error) {
           console.warn('CSP restricts eval:', error);
       }
       
       try {
           new Function('return true')();
       } catch (error) {
           console.warn('CSP restricts Function constructor:', error);
       }
   }
   
   checkCSP();
   ```

2. **同源策略检查**:
   ```javascript
   // 检查同源策略限制
   function checkSameOrigin() {
       console.log('Current origin:', window.location.origin);
       console.log('Protocol:', window.location.protocol);
       
       if (window.location.protocol === 'file:') {
           console.warn('File protocol detected - may cause CORS issues');
       }
   }
   
   checkSameOrigin();
   ```

## 🛠️ 自动化故障排除

### 系统自检脚本

```javascript
// 完整的系统自检脚本
function runSystemDiagnostics() {
    const diagnostics = {
        timestamp: new Date().toISOString(),
        browser: {
            userAgent: navigator.userAgent,
            language: navigator.language,
            cookieEnabled: navigator.cookieEnabled,
            onLine: navigator.onLine
        },
        storage: {
            localStorage: typeof Storage !== "undefined",
            sessionStorage: typeof sessionStorage !== "undefined",
            indexedDB: typeof indexedDB !== "undefined"
        },
        apis: {
            fetch: typeof fetch !== "undefined",
            Promise: typeof Promise !== "undefined",
            URL: typeof URL !== "undefined",
            FormData: typeof FormData !== "undefined"
        },
        performance: {},
        data: {},
        errors: []
    };
    
    // 性能检查
    if (performance.memory) {
        diagnostics.performance.memory = {
            used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
            total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
            limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
        };
    }
    
    // 数据检查
    try {
        const examIndex = localStorage.getItem('exam_system_exam_index');
        diagnostics.data.examIndex = examIndex ? JSON.parse(examIndex).length : 0;
    } catch (error) {
        diagnostics.errors.push('Exam index data corrupted: ' + error.message);
    }
    
    try {
        const records = localStorage.getItem('exam_system_practice_records');
        diagnostics.data.practiceRecords = records ? JSON.parse(records).length : 0;
    } catch (error) {
        diagnostics.errors.push('Practice records data corrupted: ' + error.message);
    }
    
    // 存储使用情况
    let storageUsed = 0;
    for (let key in localStorage) {
        if (key.startsWith('exam_system_')) {
            storageUsed += localStorage[key].length;
        }
    }
    diagnostics.storage.used = Math.round(storageUsed / 1024);
    
    return diagnostics;
}

// 运行诊断并显示结果
const diagnostics = runSystemDiagnostics();
console.log('System Diagnostics:', diagnostics);

// 生成诊断报告
function generateDiagnosticReport(diagnostics) {
    const report = [
        '=== 系统诊断报告 ===',
        `时间: ${diagnostics.timestamp}`,
        '',
        '浏览器信息:',
        `  用户代理: ${diagnostics.browser.userAgent}`,
        `  语言: ${diagnostics.browser.language}`,
        `  Cookie启用: ${diagnostics.browser.cookieEnabled}`,
        `  在线状态: ${diagnostics.browser.onLine}`,
        '',
        '存储支持:',
        `  LocalStorage: ${diagnostics.storage.localStorage}`,
        `  SessionStorage: ${diagnostics.storage.sessionStorage}`,
        `  IndexedDB: ${diagnostics.storage.indexedDB}`,
        `  存储使用: ${diagnostics.storage.used} KB`,
        '',
        'API支持:',
        `  Fetch: ${diagnostics.apis.fetch}`,
        `  Promise: ${diagnostics.apis.Promise}`,
        `  URL: ${diagnostics.apis.URL}`,
        `  FormData: ${diagnostics.apis.FormData}`,
        '',
        '数据状态:',
        `  题库索引: ${diagnostics.data.examIndex} 项`,
        `  练习记录: ${diagnostics.data.practiceRecords} 条`,
        ''
    ];
    
    if (diagnostics.performance.memory) {
        report.push('内存使用:');
        report.push(`  已使用: ${diagnostics.performance.memory.used} MB`);
        report.push(`  总计: ${diagnostics.performance.memory.total} MB`);
        report.push(`  限制: ${diagnostics.performance.memory.limit} MB`);
        report.push('');
    }
    
    if (diagnostics.errors.length > 0) {
        report.push('发现的问题:');
        diagnostics.errors.forEach(error => {
            report.push(`  - ${error}`);
        });
    } else {
        report.push('未发现问题');
    }
    
    return report.join('\n');
}

// 导出诊断报告
function exportDiagnosticReport() {
    const diagnostics = runSystemDiagnostics();
    const report = generateDiagnosticReport(diagnostics);
    
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `exam-system-diagnostics-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 在控制台中运行: exportDiagnosticReport()
```

## 📞 技术支持联系

如果以上故障排除步骤无法解决问题，请联系技术支持：

### 联系前准备

1. **收集系统信息**:
   - 运行系统诊断脚本
   - 导出诊断报告
   - 截取错误信息截图

2. **准备问题描述**:
   - 详细的问题现象
   - 复现步骤
   - 发生时间和频率
   - 已尝试的解决方案

3. **环境信息**:
   - 操作系统版本
   - 浏览器类型和版本
   - 网络环境
   - 其他相关软件

### 联系方式

- **邮箱**: support@example.com
- **GitHub Issues**: [项目地址]/issues
- **技术论坛**: [论坛地址]
- **在线客服**: [客服地址]

### 响应时间

- **紧急问题** (系统无法使用): 2小时内响应
- **一般问题** (功能异常): 24小时内响应
- **咨询问题** (使用疑问): 48小时内响应

---

**记住**: 大多数问题都可以通过系统的自检和修复功能解决。在联系技术支持前，请先尝试运行系统诊断和自动修复功能。