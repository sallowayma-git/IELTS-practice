# 常见问题解答 (FAQ)

本文档收集了用户在使用考试总览系统时最常遇到的问题和解决方案。

## 📋 目录

1. [安装和配置问题](#安装和配置问题)
2. [系统功能问题](#系统功能问题)
3. [数据和存储问题](#数据和存储问题)
4. [性能和兼容性问题](#性能和兼容性问题)
5. [学习和使用问题](#学习和使用问题)
6. [故障排除指南](#故障排除指南)

## 🔧 安装和配置问题

### Q1: 系统无法启动，显示空白页面
**A:** 这通常是由以下原因造成的：

**解决步骤：**
1. **检查浏览器控制台**
   - 按F12打开开发者工具
   - 查看Console标签页的错误信息
   - 常见错误：JavaScript被禁用、文件路径错误

2. **验证文件完整性**
   ```bash
   # 检查关键文件是否存在
   ls -la index.html
   ls -la js/app.js
   ls -la css/styles.css
   ```

3. **确认Web服务器运行**
   - 不能直接双击HTML文件打开
   - 必须通过HTTP服务器访问
   - 检查服务器是否正常运行

4. **清除浏览器缓存**
   - Ctrl+Shift+Delete清除缓存
   - 或使用隐私模式测试

### Q2: 题库扫描失败，显示"未找到题目"
**A:** 题库扫描失败的常见原因：

**检查清单：**
- [ ] 题库文件夹结构是否正确
- [ ] HTML文件命名是否符合规范
- [ ] 文件路径中是否包含特殊字符
- [ ] 浏览器是否允许访问本地文件

**解决方法：**
1. **验证文件结构**
   ```
   正确结构：
   P1（12+8）/
   ├── 1.高频(网页由窦立盛老师制作)/
   │   └── 1.A Brief History of Tea 茶叶简史/
   │       └── P1 - A Brief History of Tea【高】.html
   ```

2. **检查文件命名**
   - 文件名格式：`P[1-3] - 英文标题【高/次】.html`
   - 避免使用特殊字符：`< > : " | ? * \`

3. **手动测试文件访问**
   - 在浏览器中直接访问题目文件
   - 确认文件可以正常打开

### Q3: 无法启动Web服务器
**A:** 根据使用的服务器类型选择解决方案：

**Python HTTP服务器：**
```bash
# 检查Python版本
python --version
python3 --version

# 如果端口被占用，使用其他端口
python -m http.server 8001
```

**Node.js HTTP服务器：**
```bash
# 检查Node.js安装
node --version
npm --version

# 全局安装http-server
npm install -g http-server

# 启动服务器
http-server -p 8000 -c-1
```

**端口冲突解决：**
```bash
# 查看端口占用情况
netstat -an | grep :8000
# Windows
netstat -an | findstr :8000

# 终止占用端口的进程
# Linux/Mac
sudo lsof -ti:8000 | xargs kill -9
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

## 🎯 系统功能问题

### Q4: 练习记录没有保存
**A:** 练习记录保存失败的可能原因：

**诊断步骤：**
1. **检查LocalStorage状态**
   ```javascript
   // 在浏览器控制台运行
   console.log('LocalStorage available:', typeof(Storage) !== "undefined");
   console.log('Storage quota:', navigator.storage && navigator.storage.estimate());
   ```

2. **检查隐私模式**
   - 隐私/无痕模式下LocalStorage可能被禁用
   - 尝试在正常模式下使用

3. **检查存储空间**
   - LocalStorage通常限制为5-10MB
   - 清理旧数据释放空间

**解决方案：**
```javascript
// 清理过期数据
localStorage.removeItem('exam_system_old_data');

// 检查存储使用情况
let total = 0;
for(let key in localStorage) {
    if(localStorage.hasOwnProperty(key)) {
        total += localStorage[key].length;
    }
}
console.log('Storage used:', total, 'characters');
```

### Q5: 题目窗口无法打开
**A:** 题目窗口打开失败的解决方法：

**常见原因和解决方案：**

1. **浏览器阻止弹窗**
   - 点击地址栏的弹窗阻止图标
   - 选择"始终允许弹窗"
   - 或在浏览器设置中添加网站到白名单

2. **文件路径错误**
   ```javascript
   // 检查文件路径
   fetch('P1（12+8）/1.高频(网页由窦立盛老师制作)/1.A Brief History of Tea 茶叶简史/P1 - A Brief History of Tea【高】.html')
   .then(response => console.log('File exists:', response.ok))
   .catch(error => console.log('File not found:', error));
   ```

3. **文件编码问题**
   - 确保HTML文件使用UTF-8编码
   - 检查文件是否损坏

### Q6: 统计数据显示不正确
**A:** 统计数据错误的排查和修复：

**数据完整性检查：**
```javascript
// 在浏览器控制台运行数据检查
const records = JSON.parse(localStorage.getItem('exam_system_practice_records') || '[]');
console.log('Total records:', records.length);
console.log('Valid records:', records.filter(r => r.status === 'completed').length);
console.log('Invalid records:', records.filter(r => !r.examId || !r.startTime).length);
```

**修复步骤：**
1. 进入"系统维护"面板
2. 点击"数据完整性检查"
3. 选择"修复无效数据"
4. 重新计算统计信息

## 💾 数据和存储问题

### Q7: 如何备份和恢复数据？
**A:** 完整的数据备份和恢复流程：

**手动备份：**
1. 进入"数据管理"面板
2. 点击"导出数据"
3. 选择要备份的数据类型：
   - 练习记录
   - 用户统计
   - 系统设置
   - 学习目标

**自动备份设置：**
```javascript
// 启用自动备份
localStorage.setItem('exam_system_auto_backup', 'true');
localStorage.setItem('exam_system_backup_interval', '86400000'); // 24小时
```

**数据恢复：**
1. 点击"导入数据"
2. 选择备份文件（JSON格式）
3. 预览导入内容
4. 确认导入操作

### Q8: 数据丢失了怎么办？
**A:** 数据丢失的恢复方法：

**检查自动备份：**
```javascript
// 查看自动备份
const backups = JSON.parse(localStorage.getItem('exam_system_backups') || '[]');
console.log('Available backups:', backups.length);
backups.forEach((backup, index) => {
    console.log(`Backup ${index}:`, new Date(backup.timestamp));
});
```

**浏览器历史恢复：**
1. 检查浏览器是否有数据恢复功能
2. 查看浏览器同步数据
3. 检查其他设备上的数据

**预防措施：**
- 定期手动备份重要数据
- 启用浏览器同步功能
- 使用云存储保存备份文件

### Q9: 如何清理系统数据？
**A:** 安全清理数据的方法：

**选择性清理：**
1. 进入"系统维护"面板
2. 选择"数据清理"
3. 选择清理类型：
   - 过期练习记录（超过指定天数）
   - 重复数据
   - 缓存文件
   - 临时数据

**完全重置：**
```javascript
// 警告：这将删除所有数据！
if(confirm('确定要重置所有数据吗？此操作不可恢复！')) {
    Object.keys(localStorage).forEach(key => {
        if(key.startsWith('exam_system_')) {
            localStorage.removeItem(key);
        }
    });
    location.reload();
}
```

## ⚡ 性能和兼容性问题

### Q10: 系统运行缓慢怎么办？
**A:** 性能优化的方法：

**浏览器优化：**
1. **清理缓存和Cookie**
   - Ctrl+Shift+Delete
   - 选择"所有时间"
   - 清除缓存、Cookie和网站数据

2. **关闭不必要的标签页**
   - 每个标签页都占用内存
   - 使用书签保存重要页面

3. **禁用不必要的扩展**
   - 进入浏览器扩展管理
   - 禁用或删除不常用的扩展

**系统优化：**
```javascript
// 启用性能优化模式
localStorage.setItem('exam_system_performance_mode', 'true');
localStorage.setItem('exam_system_cache_size', '50'); // 减少缓存大小
localStorage.setItem('exam_system_animations', 'false'); // 禁用动画
```

**硬件检查：**
- 确保有足够的可用内存（建议4GB+）
- 检查硬盘空间（建议1GB+可用空间）
- 关闭其他占用资源的程序

### Q11: 浏览器兼容性问题
**A:** 不同浏览器的兼容性解决方案：

**支持的浏览器版本：**
- Chrome 70+
- Firefox 65+
- Safari 12+
- Edge 79+

**常见兼容性问题：**

1. **Internet Explorer不支持**
   - IE不支持现代JavaScript特性
   - 建议升级到Edge或其他现代浏览器

2. **Safari的LocalStorage限制**
   ```javascript
   // Safari隐私模式检测
   try {
       localStorage.setItem('test', 'test');
       localStorage.removeItem('test');
   } catch(e) {
       alert('请关闭Safari的隐私模式或使用其他浏览器');
   }
   ```

3. **移动浏览器适配**
   - 系统已优化移动端体验
   - 建议使用最新版本的移动浏览器

### Q12: 移动设备使用问题
**A:** 移动设备优化建议：

**触摸操作优化：**
- 所有按钮都已优化触摸体验
- 支持手势导航
- 自动调整界面布局

**性能优化：**
```javascript
// 移动设备性能模式
if(/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
    localStorage.setItem('exam_system_mobile_mode', 'true');
    localStorage.setItem('exam_system_reduced_animations', 'true');
}
```

**网络优化：**
- 启用数据压缩
- 减少网络请求
- 使用离线缓存

## 📚 学习和使用问题

### Q13: 如何制定有效的学习计划？
**A:** 科学的学习计划制定方法：

**评估当前水平：**
1. 完成几套不同分类的题目
2. 查看详细的成绩分析
3. 识别强项和弱项
4. 设定合理的目标

**制定计划步骤：**
1. **设定总体目标**
   - 目标考试时间
   - 期望成绩水平
   - 可用学习时间

2. **分解具体目标**
   - 每日练习量：建议2-3篇文章
   - 每周目标：完成不同分类的练习
   - 月度目标：整体能力提升

3. **使用系统功能**
   ```javascript
   // 设置学习提醒
   const goals = {
       daily: { practices: 3, timeMinutes: 60 },
       weekly: { practices: 20, accuracy: 0.8 },
       monthly: { improvement: 0.1 }
   };
   localStorage.setItem('exam_system_learning_goals', JSON.stringify(goals));
   ```

### Q14: 如何提高答题正确率？
**A:** 提高正确率的策略：

**分析错误模式：**
1. 查看"成绩分析"页面
2. 重点关注"薄弱环节分析"
3. 识别常见错误类型
4. 制定针对性改进计划

**题型专项练习：**
- 使用"题型专项练习"功能
- 重点练习正确率低的题型
- 逐个突破难点题型

**学习技巧：**
1. **时间管理**
   - 为每种题型分配合理时间
   - 练习快速阅读技巧
   - 避免在难题上花费过多时间

2. **答题策略**
   - 先易后难
   - 仔细阅读题目要求
   - 学会排除明显错误选项

### Q15: 系统推荐的练习内容准确吗？
**A:** 系统推荐机制说明：

**推荐算法基于：**
- 历史练习表现
- 错误模式分析
- 学习进度评估
- 题型掌握程度

**提高推荐准确性：**
1. **保持练习连续性**
   - 定期练习提供更多数据
   - 系统能更准确分析学习模式

2. **完整完成练习**
   - 不要中途放弃
   - 确保数据的完整性

3. **及时反馈**
   - 如果推荐不合适，可以手动选择
   - 系统会学习您的偏好

**自定义推荐：**
```javascript
// 调整推荐权重
const preferences = {
    focusWeakAreas: 0.7,    // 70%关注薄弱环节
    balancedPractice: 0.2,  // 20%均衡练习
    challengeMode: 0.1      // 10%挑战模式
};
localStorage.setItem('exam_system_recommendation_preferences', JSON.stringify(preferences));
```

## 🔍 故障排除指南

### 系统诊断工具

**运行系统诊断：**
1. 进入"系统维护"面板
2. 点击"系统诊断"
3. 等待诊断完成
4. 查看诊断报告

**手动诊断命令：**
```javascript
// 在浏览器控制台运行
// 检查系统状态
console.log('System Status Check:');
console.log('LocalStorage available:', typeof(Storage) !== "undefined");
console.log('Current URL:', window.location.href);
console.log('User Agent:', navigator.userAgent);

// 检查数据完整性
const examIndex = JSON.parse(localStorage.getItem('exam_system_exam_index') || '[]');
const practiceRecords = JSON.parse(localStorage.getItem('exam_system_practice_records') || '[]');
console.log('Exam index length:', examIndex.length);
console.log('Practice records length:', practiceRecords.length);

// 检查存储使用情况
let storageUsed = 0;
for(let key in localStorage) {
    if(key.startsWith('exam_system_')) {
        storageUsed += localStorage[key].length;
    }
}
console.log('Storage used:', Math.round(storageUsed / 1024), 'KB');
```

### 常见错误代码

**错误代码对照表：**

| 错误代码 | 描述 | 解决方案 |
|---------|------|----------|
| E001 | 题库扫描失败 | 检查文件结构和权限 |
| E002 | 数据保存失败 | 检查存储空间和权限 |
| E003 | 网络请求超时 | 检查网络连接 |
| E004 | 文件格式错误 | 验证HTML文件格式 |
| E005 | 浏览器不兼容 | 升级浏览器版本 |

### 日志收集

**启用详细日志：**
```javascript
// 启用调试模式
localStorage.setItem('exam_system_debug', 'true');
localStorage.setItem('exam_system_log_level', 'verbose');

// 查看日志
console.log('System logs:', JSON.parse(localStorage.getItem('exam_system_logs') || '[]'));
```

**导出日志文件：**
1. 进入"系统维护"面板
2. 点击"导出日志"
3. 保存日志文件
4. 发送给技术支持

## 📞 获取帮助

如果以上解决方案都无法解决您的问题，请通过以下方式获取帮助：

### 技术支持渠道

1. **在线文档**
   - [用户手册](user-manual.md)
   - [安装指南](installation-guide.md)
   - [API文档](api-documentation.md)

2. **社区支持**
   - GitHub Issues: [项目地址]
   - 用户论坛: [论坛地址]
   - QQ群: [群号]

3. **直接联系**
   - 邮箱: support@example.com
   - 微信: [微信号]
   - 电话: [联系电话]

### 提交问题时请包含

- 操作系统和版本
- 浏览器类型和版本
- 错误信息截图
- 详细的复现步骤
- 系统诊断报告

### 响应时间

- 一般问题：24小时内回复
- 紧急问题：4小时内回复
- 系统故障：1小时内回复

---

**感谢您使用考试总览系统！** 

我们会持续改进系统功能和用户体验。如果您有任何建议或意见，欢迎随时联系我们。