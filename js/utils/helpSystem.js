/**
 * 帮助系统管理器
 * 提供用户帮助文档和交互式教程功能
 */
class HelpSystem {
    constructor() {
        this.isVisible = false;
        this.currentSection = 'overview';
        this.helpContent = this.initializeHelpContent();
        
        this.init();
    }
    
    init() {
        this.createHelpButton();
        this.setupEventListeners();
    }
    
    /**
     * 初始化帮助内容
     */
    initializeHelpContent() {
        return {
            overview: {
                title: '系统概览',
                content: `
                    <h3>欢迎使用考试总览系统</h3>
                    <p>本系统是一个综合性的练题平台，帮助您更高效地进行考试准备。</p>
                    
                    <h4>主要功能</h4>
                    <ul>
                        <li><strong>题库浏览</strong> - 查看和管理所有可用的考试题目</li>
                        <li><strong>练习记录</strong> - 跟踪您的学习进度和成绩</li>
                        <li><strong>智能分析</strong> - 获得个性化的学习建议</li>
                        <li><strong>学习目标</strong> - 设置和管理您的学习计划</li>
                        <li><strong>专项练习</strong> - 针对性地练习特定类型的题目</li>
                    </ul>
                    
                    <h4>快速开始</h4>
                    <p>1. 在总览页面选择一个分类（P1、P2、P3）</p>
                    <p>2. 点击"开始练习"或"浏览题目"</p>
                    <p>3. 完成练习后查看您的成绩和分析</p>
                    <p>4. 根据建议调整学习计划</p>
                `
            },
            navigation: {
                title: '导航指南',
                content: `
                    <h3>系统导航</h3>
                    <p>系统采用标签式导航，您可以通过以下方式在不同页面间切换：</p>
                    
                    <h4>导航方式</h4>
                    <ul>
                        <li><strong>点击导航标签</strong> - 使用鼠标点击顶部导航栏</li>
                        <li><strong>键盘快捷键</strong> - 使用 Ctrl+数字键快速切换</li>
                        <li><strong>面包屑导航</strong> - 在详细页面中返回上级</li>
                    </ul>
                    
                    <h4>页面说明</h4>
                    <ul>
                        <li><strong>总览</strong> - 查看整体学习进度和统计信息</li>
                        <li><strong>专项练习</strong> - 按分类或频率进行针对性练习</li>
                        <li><strong>练习记录</strong> - 查看历史练习记录和详细信息</li>
                        <li><strong>成绩分析</strong> - 查看学习分析和改进建议</li>
                        <li><strong>学习目标</strong> - 设置和跟踪学习目标</li>
                    </ul>
                `
            },
            shortcuts: {
                title: '键盘快捷键',
                content: `
                    <h3>键盘快捷键</h3>
                    <p>使用键盘快捷键可以大大提高操作效率：</p>
                    
                    <h4>导航快捷键</h4>
                    <div class="help-shortcut">
                        <kbd>Ctrl + 1</kbd>
                        <span>切换到总览页面</span>
                    </div>
                    <div class="help-shortcut">
                        <kbd>Ctrl + 2</kbd>
                        <span>切换到专项练习</span>
                    </div>
                    <div class="help-shortcut">
                        <kbd>Ctrl + 3</kbd>
                        <span>切换到练习记录</span>
                    </div>
                    <div class="help-shortcut">
                        <kbd>Ctrl + 4</kbd>
                        <span>切换到成绩分析</span>
                    </div>
                    <div class="help-shortcut">
                        <kbd>Ctrl + 5</kbd>
                        <span>切换到学习目标</span>
                    </div>
                    
                    <h4>功能快捷键</h4>
                    <div class="help-shortcut">
                        <kbd>Ctrl + F</kbd>
                        <span>打开搜索功能</span>
                    </div>
                    <div class="help-shortcut">
                        <kbd>Ctrl + R</kbd>
                        <span>刷新当前页面数据</span>
                    </div>
                    <div class="help-shortcut">
                        <kbd>Ctrl + H</kbd>
                        <span>显示帮助信息</span>
                    </div>
                    <div class="help-shortcut">
                        <kbd>Ctrl + N</kbd>
                        <span>开始随机练习</span>
                    </div>
                    
                    <h4>辅助功能快捷键</h4>
                    <div class="help-shortcut">
                        <kbd>Alt + 1</kbd>
                        <span>跳转到主要内容</span>
                    </div>
                    <div class="help-shortcut">
                        <kbd>Alt + 2</kbd>
                        <span>跳转到导航栏</span>
                    </div>
                    <div class="help-shortcut">
                        <kbd>Escape</kbd>
                        <span>关闭模态框或退出输入</span>
                    </div>
                    <div class="help-shortcut">
                        <kbd>Tab</kbd>
                        <span>在可聚焦元素间导航</span>
                    </div>
                `
            },
            accessibility: {
                title: '无障碍功能',
                content: `
                    <h3>无障碍访问</h3>
                    <p>系统提供多种无障碍功能，确保所有用户都能顺畅使用：</p>
                    
                    <h4>视觉辅助</h4>
                    <ul>
                        <li><strong>高对比度模式</strong> - 提供更清晰的视觉对比</li>
                        <li><strong>字体大小调节</strong> - 支持小、正常、大、特大四种字体</li>
                        <li><strong>深色主题</strong> - 减少眼部疲劳</li>
                        <li><strong>减少动画</strong> - 适合对动画敏感的用户</li>
                    </ul>
                    
                    <h4>键盘导航</h4>
                    <ul>
                        <li><strong>Tab 导航</strong> - 使用 Tab 键在元素间移动</li>
                        <li><strong>方向键导航</strong> - 在网格和列表中使用方向键</li>
                        <li><strong>回车激活</strong> - 使用回车键激活按钮和链接</li>
                        <li><strong>焦点指示器</strong> - 清晰显示当前焦点位置</li>
                    </ul>
                    
                    <h4>屏幕阅读器支持</h4>
                    <ul>
                        <li><strong>语义化标记</strong> - 使用正确的 HTML 标签</li>
                        <li><strong>ARIA 标签</strong> - 提供额外的上下文信息</li>
                        <li><strong>跳转链接</strong> - 快速跳转到主要内容区域</li>
                        <li><strong>状态通知</strong> - 及时通知状态变化</li>
                    </ul>
                    
                    <h4>设置无障碍选项</h4>
                    <p>您可以通过以下方式调整无障碍设置：</p>
                    <ul>
                        <li>使用 Ctrl+Shift+S 打开设置面板</li>
                        <li>在设置中找到"无障碍设置"部分</li>
                        <li>根据需要启用相应功能</li>
                    </ul>
                `
            },
            features: {
                title: '功能详解',
                content: `
                    <h3>详细功能说明</h3>
                    
                    <h4>题库管理</h4>
                    <p>系统自动扫描 P1、P2、P3 文件夹中的所有题目，并按以下方式组织：</p>
                    <ul>
                        <li><strong>分类管理</strong> - 按 P1、P2、P3 分类</li>
                        <li><strong>频率标记</strong> - 区分高频和次高频题目</li>
                        <li><strong>题型识别</strong> - 自动识别题目类型</li>
                        <li><strong>状态跟踪</strong> - 记录练习状态和进度</li>
                    </ul>
                    
                    <h4>练习功能</h4>
                    <ul>
                        <li><strong>随机练习</strong> - 从所有题目中随机选择</li>
                        <li><strong>分类练习</strong> - 按分类进行针对性练习</li>
                        <li><strong>频率练习</strong> - 专门练习高频或次高频题目</li>
                        <li><strong>题型练习</strong> - 按题型进行专项训练</li>
                        <li><strong>薄弱环节练习</strong> - 根据分析结果推荐题目</li>
                    </ul>
                    
                    <h4>成绩分析</h4>
                    <ul>
                        <li><strong>正确率统计</strong> - 整体和分类正确率</li>
                        <li><strong>时间分析</strong> - 答题用时和效率分析</li>
                        <li><strong>题型表现</strong> - 各题型的表现情况</li>
                        <li><strong>学习趋势</strong> - 进步趋势和学习曲线</li>
                        <li><strong>薄弱环节识别</strong> - 自动识别需要改进的地方</li>
                    </ul>
                    
                    <h4>学习目标</h4>
                    <ul>
                        <li><strong>每日目标</strong> - 设置每日练习目标</li>
                        <li><strong>进度跟踪</strong> - 实时跟踪目标完成情况</li>
                        <li><strong>成就系统</strong> - 完成目标获得成就徽章</li>
                        <li><strong>提醒功能</strong> - 智能提醒练习时间</li>
                    </ul>
                `
            },
            troubleshooting: {
                title: '常见问题',
                content: `
                    <h3>常见问题解答</h3>
                    
                    <h4>题目无法打开</h4>
                    <p><strong>问题：</strong>点击题目后无法打开或显示错误</p>
                    <p><strong>解决方案：</strong></p>
                    <ul>
                        <li>检查浏览器是否允许弹窗</li>
                        <li>确认题目文件是否存在</li>
                        <li>尝试刷新页面后重新打开</li>
                        <li>检查文件路径是否正确</li>
                    </ul>
                    
                    <h4>数据丢失</h4>
                    <p><strong>问题：</strong>练习记录或设置丢失</p>
                    <p><strong>解决方案：</strong></p>
                    <ul>
                        <li>检查浏览器存储设置</li>
                        <li>确认没有清除浏览器数据</li>
                        <li>尝试导入之前的备份数据</li>
                        <li>联系技术支持获取帮助</li>
                    </ul>
                    
                    <h4>性能问题</h4>
                    <p><strong>问题：</strong>系统运行缓慢或卡顿</p>
                    <p><strong>解决方案：</strong></p>
                    <ul>
                        <li>关闭其他不必要的浏览器标签</li>
                        <li>清理浏览器缓存</li>
                        <li>检查网络连接状态</li>
                        <li>尝试使用其他浏览器</li>
                    </ul>
                    
                    <h4>快捷键不工作</h4>
                    <p><strong>问题：</strong>键盘快捷键无响应</p>
                    <p><strong>解决方案：</strong></p>
                    <ul>
                        <li>确认快捷键功能已启用</li>
                        <li>检查是否与浏览器快捷键冲突</li>
                        <li>尝试在设置中重新启用快捷键</li>
                        <li>确认当前焦点不在输入框中</li>
                    </ul>
                    
                    <h4>主题显示异常</h4>
                    <p><strong>问题：</strong>主题切换后显示不正常</p>
                    <p><strong>解决方案：</strong></p>
                    <ul>
                        <li>尝试刷新页面</li>
                        <li>重置主题设置为默认值</li>
                        <li>检查浏览器是否支持 CSS 变量</li>
                        <li>清除浏览器缓存后重试</li>
                    </ul>
                    
                    <h4>获取更多帮助</h4>
                    <p>如果以上解决方案都无法解决您的问题，请：</p>
                    <ul>
                        <li>记录详细的错误信息</li>
                        <li>截图保存问题现象</li>
                        <li>联系技术支持团队</li>
                        <li>提供浏览器和系统信息</li>
                    </ul>
                `
            }
        };
    }
    
    /**
     * 创建帮助按钮
     */
    createHelpButton() {
        const helpButton = document.createElement('button');
        helpButton.className = 'help-button';
        helpButton.innerHTML = '?';
        helpButton.title = '帮助 (Ctrl+H)';
        helpButton.setAttribute('aria-label', '打开帮助系统');
        
        helpButton.addEventListener('click', () => this.show()); // 动态创建的按钮，保持原生监听
        
        // 添加到页面
        document.body.appendChild(helpButton);
        
        // 添加样式
        const style = document.createElement('style');
        style.textContent = `
            .help-button {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                background: var(--primary-color);
                color: white;
                border: none;
                font-size: 20px;
                font-weight: bold;
                cursor: pointer;
                box-shadow: var(--shadow-lg);
                z-index: 1000;
                transition: all 0.3s ease;
            }
            
            .help-button:hover {
                background: var(--primary-hover);
                transform: scale(1.1);
            }
            
            .help-button:focus {
                outline: 2px solid var(--primary-color);
                outline-offset: 2px;
            }
            
            @media (max-width: 768px) {
                .help-button {
                    bottom: 15px;
                    right: 15px;
                    width: 45px;
                    height: 45px;
                    font-size: 18px;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 键盘快捷键
        // 键盘事件必须使用原生 addEventListener
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'h') {
                e.preventDefault();
                this.toggle();
            }
            
            if (e.key === 'Escape' && this.isVisible) {
                this.hide();
            }
        });
    }
    
    /**
     * 显示帮助系统
     */
    show() {
        if (this.isVisible) return;
        
        this.createHelpModal();
        this.isVisible = true;
        
        // 聚焦到帮助模态框
        setTimeout(() => {
            const modal = document.querySelector('.help-modal');
            if (modal) {
                modal.focus();
            }
        }, 100);
    }
    
    /**
     * 隐藏帮助系统
     */
    hide() {
        const overlay = document.querySelector('.help-overlay');
        if (overlay) {
            overlay.remove();
        }
        this.isVisible = false;
    }
    
    /**
     * 切换帮助系统显示状态
     */
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }
    
    /**
     * 创建帮助模态框
     */
    createHelpModal() {
        const overlay = document.createElement('div');
        overlay.className = 'help-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'help-modal';
        modal.setAttribute('tabindex', '-1');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-labelledby', 'help-title');
        
        modal.innerHTML = `
            <div class="help-header">
                <h2 id="help-title">系统帮助</h2>
                <button class="help-close" aria-label="关闭帮助">×</button>
            </div>
            <div class="help-nav" role="tablist">
                ${Object.entries(this.helpContent).map(([key, section]) => `
                    <button class="help-nav-item ${key === this.currentSection ? 'active' : ''}" 
                            data-section="${key}"
                            role="tab"
                            aria-selected="${key === this.currentSection}"
                            aria-controls="help-section-${key}">
                        ${section.title}
                    </button>
                `).join('')}
            </div>
            <div class="help-content">
                ${Object.entries(this.helpContent).map(([key, section]) => `
                    <div class="help-section ${key === this.currentSection ? 'active' : ''}" 
                         id="help-section-${key}"
                         role="tabpanel"
                         aria-labelledby="help-nav-${key}">
                        ${section.content}
                    </div>
                `).join('')}
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // 设置事件监听器
        this.setupModalEvents(overlay, modal);
    }
    
    /**
     * 设置模态框事件监听器
     */
    setupModalEvents(overlay, modal) {
        // 关闭按钮 - 动态创建，保持原生监听
        const closeBtn = modal.querySelector('.help-close');
        closeBtn.addEventListener('click', () => this.hide());

        // 点击背景关闭 - 动态创建，保持原生监听
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.hide();
            }
        });

        // 导航切换 - 可以使用事件委托优化
        if (typeof window.DOM !== 'undefined' && window.DOM.delegate) {
            window.DOM.delegate('click', '.help-nav-item', (e) => {
                const item = e.target.closest('.help-nav-item');
                if (!item) return;
                const section = item.dataset.section;
                this.switchSection(section);
            });
        } else {
            const navItems = modal.querySelectorAll('.help-nav-item');
            navItems.forEach(item => {
                item.addEventListener('click', () => {
                    const section = item.dataset.section;
                    this.switchSection(section);
                });
            });
        }

        // 键盘导航 - 模态框级别，保持原生监听
        modal.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                this.handleTabNavigation(e, modal);
            }
        });
    }
    
    /**
     * 切换帮助部分
     */
    switchSection(sectionKey) {
        if (!this.helpContent[sectionKey]) return;
        
        this.currentSection = sectionKey;
        
        // 更新导航状态
        const navItems = document.querySelectorAll('.help-nav-item');
        navItems.forEach(item => {
            const isActive = item.dataset.section === sectionKey;
            item.classList.toggle('active', isActive);
            item.setAttribute('aria-selected', isActive);
        });
        
        // 更新内容显示
        const sections = document.querySelectorAll('.help-section');
        sections.forEach(section => {
            const isActive = section.id === `help-section-${sectionKey}`;
            section.classList.toggle('active', isActive);
        });
    }
    
    /**
     * 处理Tab导航
     */
    handleTabNavigation(e, modal) {
        const focusableElements = modal.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        
        if (e.shiftKey) {
            if (document.activeElement === firstElement) {
                e.preventDefault();
                lastElement.focus();
            }
        } else {
            if (document.activeElement === lastElement) {
                e.preventDefault();
                firstElement.focus();
            }
        }
    }
    
    /**
     * 显示特定部分
     */
    showSection(sectionKey) {
        this.show();
        setTimeout(() => {
            this.switchSection(sectionKey);
        }, 100);
    }
    
    /**
     * 添加自定义帮助内容
     */
    addHelpContent(key, content) {
        this.helpContent[key] = content;
    }
    
    /**
     * 更新帮助内容
     */
    updateHelpContent(key, content) {
        if (this.helpContent[key]) {
            this.helpContent[key] = { ...this.helpContent[key], ...content };
        }
    }
}