/**
 * Legacy资源管理器
 * 管理旧系统静态文件和资源
 */

const path = require('path')
const fs = require('fs')
const { app } = require('electron')

class LegacyResourceManager {
  constructor() {
    this.legacyPath = null
    this.resourcePath = null
    this.isInitialized = false
    this.loadedModules = new Map()
  }

  /**
   * 初始化Legacy资源管理器
   */
  async initialize() {
    try {
      // 设置资源路径
      this.legacyPath = path.join(__dirname, '../legacy')
      this.resourcePath = path.join(__dirname, '../resources/legacy')

      // 创建必要的目录
      await this.ensureDirectories()

      // 检查Legacy系统是否存在
      const hasLegacySystem = await this.checkLegacySystemExists()

      if (!hasLegacySystem) {
        console.log('⚠️ Legacy系统文件不存在，将使用模拟资源')
        await this.createMockResources()
      } else {
        console.log('✅ Legacy系统文件已找到')
        await this.organizeLegacyFiles()
      }

      this.isInitialized = true
      return true
    } catch (error) {
      console.error('❌ Legacy资源管理器初始化失败:', error)
      return false
    }
  }

  /**
   * 检查Legacy系统是否存在
   */
  async checkLegacySystemExists() {
    const possiblePaths = [
      path.join(__dirname, '../../../legacy-web'), // 开发目录中的legacy系统
      path.join(__dirname, '../legacy'),        // 当前项目中的legacy目录
      path.join(process.env.HOME, 'ielts-legacy') // 用户目录中的legacy系统
    ]

    for (const legacyPath of possiblePaths) {
      if (fs.existsSync(legacyPath)) {
        const indexPath = path.join(legacyPath, 'index.html')
        if (fs.existsSync(indexPath)) {
          this.legacyPath = legacyPath
          return true
        }
      }
    }

    return false
  }

  /**
   * 确保必要目录存在
   */
  async ensureDirectories() {
    const directories = [
      this.legacyPath,
      this.resourcePath,
      path.join(this.resourcePath, 'css'),
      path.join(this.resourcePath, 'js'),
      path.join(this.resourcePath, 'images'),
      path.join(this.resourcePath, 'audio'),
      path.join(this.resourcePath, 'scripts')
    ]

    for (const dir of directories) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }
  }

  /**
   * 创建模拟Legacy资源（开发测试用）
   */
  async createMockResources() {
    console.log('📝 创建模拟Legacy资源...')

    // 创建基础HTML文件
    const mockIndexHtml = this.generateMockIndexHtml()
    fs.writeFileSync(path.join(this.legacyPath, 'index.html'), mockIndexHtml)

    // 创建基础CSS文件
    const mockCss = this.generateMockCss()
    fs.writeFileSync(path.join(this.resourcePath, 'css', 'legacy.css'), mockCss)

    // 创建基础JS文件
    const mockJs = this.generateMockJs()
    fs.writeFileSync(path.join(this.resourcePath, 'js', 'legacy.js'), mockJs)

    // 创建模块配置
    const moduleConfig = this.generateModuleConfig()
    fs.writeFileSync(path.join(this.resourcePath, 'modules.json'), JSON.stringify(moduleConfig, null, 2))

    console.log('✅ 模拟Legacy资源创建完成')
  }

  /**
   * 生成模拟index.html
   */
  generateMockIndexHtml() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>雅思AI作文评判助手 - Legacy系统</title>
    <link rel="stylesheet" href="../resources/legacy/css/legacy.css">
    <script>
      window.LEGACY_CONFIG = {
        modules: {
          listening: { name: '听力练习', entry: 'listening.html' },
          reading: { name: '阅读练习', entry: 'reading.html' },
          vocabulary: { name: '词汇练习', entry: 'vocabulary.html' }
        }
      };
    </script>
</head>
<body>
  <div id="app-container">
    <div class="legacy-header">
      <h1>IELTS 听力与阅读练习</h1>
      <nav class="legacy-nav">
        <a href="#" data-module="listening" class="nav-link active">听力练习</a>
        <a href="#" data-module="reading" class="nav-link">阅读练习</a>
        <a href="#" data-module="vocabulary" class="nav-link">词汇练习</a>
      </nav>
    </div>
    <div id="legacy-content">
      <div id="module-placeholder">
        <p>正在加载Legacy模块...</p>
      </div>
    </div>
  </div>
  <script src="../resources/legacy/js/legacy.js"></script>
</body>
</html>`
  }

  /**
   * 生成模拟CSS
   */
  generateMockCss() {
    return `/* Legacy System Styles */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f7fa;
  color: #333;
  line-height: 1.6;
}

.legacy-header {
  background: white;
  padding: 1rem 2rem;
  border-bottom: 1px solid #e4e7ed;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.legacy-header h1 {
  color: #2c3e50;
  margin: 0;
  font-size: 1.8rem;
}

.legacy-nav {
  margin-top: 1rem;
  display: flex;
  gap: 2rem;
}

.nav-link {
  text-decoration: none;
  color: #606266;
  font-weight: 500;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  transition: all 0.3s ease;
}

.nav-link:hover,
.nav-link.active {
  color: #409eff;
  background: #ecf5ff;
}

#app-container {
  min-height: calc(100vh - 80px);
  padding: 2rem;
}

#legacy-content {
  background: white;
  border-radius: 8px;
  padding: 2rem;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  min-height: 400px;
}

#module-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 300px;
  color: #909399;
  font-size: 1.1rem;
}`
  }

  /* Module-specific styles */
  .listening-module { /* 听力模块样式 */ }
  .reading-module { /* 阅读模块样式 */ }
  .vocabulary-module { /* 词汇模块样式 */ }

  /**
   * 生成模拟JS
   */
  generateMockJs() {
    return `// Legacy System Core Functions
(function() {
  'use strict';

  // 模块管理器
  class LegacyModuleManager {
    constructor() {
      this.currentModule = null;
      this.modules = window.LEGACY_CONFIG.modules;
    }

    loadModule(moduleName) {
      const module = this.modules[moduleName];
      if (!module) {
        console.error(\`Unknown module: \${moduleName}\`);
        return Promise.reject(new Error(\`Module not found: \${moduleName}\`));
      }

      const moduleUrl = \`../modules/\${moduleName}/\${module.entry}\`;

      // 显示加载状态
      const placeholder = document.getElementById('module-placeholder');
      if (placeholder) {
        placeholder.innerHTML = \`
          <div class="loading-spinner"></div>
          <p>正在加载\${module.name}...</p>
        \`;
      }

      // 动态加载模块
      return this.loadScript(moduleUrl)
        .then(() => {
          this.currentModule = moduleName;
          console.log(\`Module loaded: \${moduleName}\`);

          // 通知主应用
          if (window.electronAPI) {
            window.electronAPI.send('legacy:module-loaded', {
              module: moduleName,
              timestamp: Date.now()
            });
          }
        })
        .catch((error) => {
          console.error(\`Failed to load module \${moduleName}:\`, error);
          if (placeholder) {
            placeholder.innerHTML = \`
              <div class="error-message">
                <h4>加载失败</h4>
                <p>\${error.message}</p>
                <button onclick="location.reload()">重试</button>
              </div>
            \`;
          }
          throw error;
        });
    }

    loadScript(url) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    unloadModule() {
      this.currentModule = null;
      const placeholder = document.getElementById('module-placeholder');
      if (placeholder) {
        placeholder.innerHTML = '<p>选择一个模块开始练习</p>';
      }
    }
  }

  // 事件管理器
  class LegacyEventManager {
    constructor() {
      this.listeners = new Map();
    }

    emit(eventName, data) {
      // 向主应用发送事件
      if (window.electronAPI) {
        window.electronAPI.send('legacy:event', {
          event: eventName,
          data: data,
          timestamp: Date.now()
        });
      }

      // 向DOM发送事件
      const event = new CustomEvent(eventName, { detail: data });
      document.dispatchEvent(event);
    }

    on(eventName, callback) {
      const listener = (event) => callback(event.detail);
      document.addEventListener(eventName, listener);

      this.listeners.set(eventName, listener);
    }

    off(eventName, callback) {
      const listener = this.listeners.get(eventName);
      if (listener) {
        document.removeEventListener(eventName, listener);
        this.listeners.delete(eventName);
      }
    }
  }

  // 模拟数据
  const mockData = {
    listening: {
      exercises: [
        {
          id: 1,
          title: "Conversation About Plans",
          audio: "audio/listening/conversation-plans.mp3",
          transcript: "Woman: So, what are your plans for the weekend?\\nMan: I'm thinking of going hiking on Saturday.\\nWoman: That sounds nice! Where do you usually go hiking?",
          questions: [
            { text: "What is the man planning to do on Saturday?", options: ["Go hiking", "Visit friends", "Study at home", "Watch movies"], answer: 0 },
            { text: "What does the woman think about the man's plan?", options: ["It sounds nice", "He should visit friends", "He should study", "He should watch movies"], answer: 0 }
          ]
        }
      ]
    },
    reading: {
      passages: [
        {
          id: 1,
          title: "The Impact of Social Media",
          content: "Social media has fundamentally changed how we communicate and share information. While it offers unprecedented opportunities for connection, it also presents challenges...",
          questions: [
            { text: "What is the main topic of this passage?", options: ["Social media impact", "Communication methods", "Information sharing", "Challenges of social media"], answer: 0 },
            { text: "What tone does the author take?", options: ["Neutral", "Positive", "Negative", "Mixed"], answer: 0 }
          ]
        }
      ]
    },
    vocabulary: {
      words: [
        { id: 1, word: "profound", definition: "very deep or intense", example: "The book had a profound impact on my thinking." },
        { id: 2, word: "significant", definition: "important or noticeable", example: "There was a significant improvement in his performance." }
      ]
    }
  };

  // 模拟练习数据获取
  class LegacyDataService {
    getListeningExercises() {
      return Promise.resolve(mockData.listening.exercises);
    }

    getReadingPassages() {
      return Promise.resolve(mockData.reading.passages);
    }

    getVocabularyWords() {
      return Promise.resolve(mockData.vocabulary.words);
    }

    saveProgress(module, data) {
      localStorage.setItem(\`legacy_\${module}_progress\`, JSON.stringify({
        data,
        timestamp: Date.now()
      }));
    }

    getProgress(module) {
      const saved = localStorage.getItem(\`legacy_\${module}_progress\`);
      return saved ? JSON.parse(saved) : null;
    }
  }

  // 主应用初始化
  function initializeLegacyApp() {
    const moduleManager = new LegacyModuleManager();
    const eventManager = new LegacyEventManager();
    const dataService = new LegacyDataService();

    // 暴露到全局作用域
    window.legacyApp = {
      moduleManager,
      eventManager,
      dataService,
      modules: window.LEGACY_CONFIG.modules
    };

    // 设置导航事件
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const moduleName = link.getAttribute('data-module');
        moduleManager.loadModule(moduleName);
      });
    });

    // 监听主应用事件
    if (window.electronAPI) {
      window.electronAPI.on('legacy:command', (event, command) => {
        handleLegacyCommand(command, moduleManager, dataService);
      });
    }

    console.log('Legacy应用初始化完成');
  }

  // 处理主应用命令
  function handleLegacyCommand(command, moduleManager, dataService) {
    switch (command.type) {
      case 'load-module':
        moduleManager.loadModule(command.module);
        break;
      case 'unload-module':
        moduleManager.unloadModule();
        break;
      case 'get-data':
        dataService.getProgress(command.module);
        break;
      case 'save-data':
        dataService.saveProgress(command.module, command.data);
        break;
      default:
        console.warn('Unknown legacy command:', command);
    }
  }

  // 等待DOM加载完成后初始化
  if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeLegacyApp);
    } else {
      initializeLegacyApp();
    }
})();
`
  }

  /**
   * 组织Legacy文件
   */
  async organizeLegacyFiles() {
    console.log('📁 组织Legacy系统文件...')

    // 创建模块目录
    const modules = ['listening', 'reading', 'vocabulary']
    for (const module of modules) {
      const moduleDir = path.join(this.resourcePath, 'modules', module);
      if (!fs.existsSync(moduleDir)) {
        fs.mkdirSync(moduleDir, { recursive: true });
      }

      // 创建模块入口文件
      const entryFile = path.join(moduleDir, \`\${module}.html\`);
      const entryContent = this.generateModuleEntry(module);
      fs.writeFileSync(entryFile, entryContent);
    }

    console.log('✅ Legacy文件组织完成');
  }

  /**
   * 生成模块入口文件
   */
  generateModuleEntry(moduleName) {
    const moduleInfo = {
      listening: {
        title: '听力练习',
        description: '通过音频和对话练习提高听力理解能力',
        features: ['真实考试模拟', '音频播放控制', '题目解析', '进度跟踪']
      },
      reading: {
        title: '阅读理解',
        description: '练习学术文章阅读和理解能力',
        features: ['长篇文章练习', '题型训练', '技巧指导', '答案解析']
      },
      vocabulary: {
        title: '词汇练习',
        description: '扩充词汇量，提高用词准确性',
        features: ['词汇测试', '词根词缀练习', '同义词替换', '例句学习']
      }
    };

    const info = moduleInfo[moduleName];

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>\${info.title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="../../resources/legacy/css/legacy.css">
  <style>
    .module-content {
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
    }
    .module-header {
      text-align: center;
      margin-bottom: 2rem;
    }
    .module-features {
      display: flex;
      justify-content: center;
      gap: 1rem;
      flex-wrap: wrap;
      margin-bottom: 2rem;
    }
    .feature-tag {
      background: #ecf5ff;
      color: #409eff;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.9rem;
    }
    .exercise-container {
      background: white;
      border-radius: 8px;
      padding: 2rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .practice-controls {
      display: flex;
      justify-content: center;
      gap: 1rem;
      margin: 2rem 0;
    }
    .control-btn {
      padding: 0.75rem 1.5rem;
      background: #409eff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1rem;
      transition: all 0.3s ease;
    }
    .control-btn:hover {
      background: #337ecc;
    }
    .control-btn:disabled {
      background: #c0c4cc;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <div class="module-content">
    <div class="module-header">
      <h1>\${info.title}</h1>
      <p>\${info.description}</p>
      <div class="module-features">
        \${info.features.map(feature =>
          \`<span class="feature-tag">\${feature}</span>\`
        ).join('')}
      </div>
    </div>

    <div class="exercise-container">
      <div id="exercise-content">
        <p>练习内容将在这里显示...</p>
        <div class="practice-controls">
          <button class="control-btn">开始练习</button>
          <button class="control-btn">查看答案</button>
          <button class="control-btn">下一题</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Module specific JavaScript will be loaded here
    console.log('\${moduleName} module loaded');
  </script>
</body>
</html>`
  }

  /**
   * 获取模块信息
   */
  getModuleInfo(moduleName) {
    if (!this.isInitialized) {
      throw new Error('Legacy ResourceManager not initialized');
    }

    const configPath = path.join(this.resourcePath, 'modules.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return config[moduleName] || null;
    }

    return null;
  }

  /**
   * 获取模块URL
   */
  getModuleUrl(moduleName) {
    if (!this.isInitialized) {
      throw new Error('Legacy ResourceManager not initialized');
    }

    const moduleInfo = this.getModuleInfo(moduleName);
    if (!moduleInfo) {
      throw new Error(\`Module \${moduleName} not found\`);
    }

    return \`file://\${this.legacyPath}/\${moduleInfo.entry}\`;
  }

  /**
   * 检查模块是否存在
   */
  hasModule(moduleName) {
    if (!this.isInitialized) {
      return false;
    }

    return this.getModuleInfo(moduleName) !== null;
  }

  /**
   * 获取所有可用模块
   */
  getAvailableModules() {
    if (!this.isInitialized) {
      return [];
    }

    const configPath = path.join(this.resourcePath, 'modules.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return Object.keys(config).map(name => ({
        name,
        title: config[name].name,
        description: config[name].description,
        features: config[name].features
      }));
    }

    return [];
  }

  /**
   * 获取资源路径
   */
  getResourcePath(relativePath) {
    if (!this.isInitialized) {
      throw new Error('Legacy ResourceManager not initialized');
    }

    return path.join(this.resourcePath, relativePath);
  }

  /**
   * 检查资源是否存在
   */
  hasResource(relativePath) {
    if (!this.isInitialized) {
      return false;
    }

    const fullPath = this.getResourcePath(relativePath);
    return fs.existsSync(fullPath);
  }
}

module.exports = LegacyResourceManager`