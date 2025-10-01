/**
 * HP Setting页面 - 主题切换弹窗插件
 * 提供主题切换功能，支持多种主题选择
 * 不修改现有脚本，纯插件形式
 */

(function() {
    'use strict';

    // 等待hpCore准备就绪
    hpCore.ready(function() {
        console.log('[HP-Settings-Theme-Modal] Plugin loaded and hpCore is ready');
        initializeSettingsThemeModalPlugin();
    });

    function initializeSettingsThemeModalPlugin() {
        // 等待DOM加载完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupSettingsThemeModal);
        } else {
            setupSettingsThemeModal();
        }
    }

    function setupSettingsThemeModal() {
        console.log('[HP-Settings-Theme-Modal] Setting up theme modal');

        // 绑定主题切换按钮事件
        bindThemeSwitchButton();

        // 监听主题变化事件
        listenForThemeChanges();

        // 初始更新主题状态
        updateThemeStatus();
    }

    function bindThemeSwitchButton() {
        // 查找主题切换按钮
        const themeButtons = document.querySelectorAll('button[onclick*="showThemeSwitcher"], button[onclick*="HPTheme"], button:contains("主题切换"), button:contains("切换主题")');

        themeButtons.forEach(button => {
            button.addEventListener('click', function(e) {
                e.preventDefault();
                showThemeSwitcherModal();
            });
        });

        // 也监听全局的showThemeSwitcher函数调用
        const originalShowThemeSwitcher = window.showThemeSwitcher;
        if (originalShowThemeSwitcher) {
            window.showThemeSwitcher = function() {
                showThemeSwitcherModal();
            };
        }
    }

    function showThemeSwitcherModal() {
        // 检查是否已存在弹窗
        if (document.getElementById('hp-theme-switcher-modal')) {
            return;
        }

        // 创建主题切换弹窗
        const modalHTML = `
            <div id="hp-theme-switcher-modal" class="hp-theme-modal-overlay">
                <div class="hp-theme-modal-container">
                    <div class="hp-theme-modal-header">
                        <h3 class="hp-theme-modal-title">🎨 主题切换</h3>
                        <button class="hp-theme-modal-close" onclick="closeThemeSwitcherModal()">×</button>
                    </div>
                    <div class="hp-theme-modal-body">
                        <div class="hp-theme-description">
                            <p><i class="fas fa-info-circle"></i> 选择您喜欢的主题风格，不同的主题提供不同的视觉体验和学习氛围。</p>
                        </div>
                        <div class="hp-theme-grid">
                            <div class="hp-theme-card active" data-theme="default">
                                <div class="hp-theme-info">
                                    <div class="hp-theme-details">
                                        <h4><i class="fas fa-palette"></i> 默认主题</h4>
                                        <p>经典配色，简洁明了<br>
                                        <span>适合日常学习使用</span></p>
                                    </div>
                                    <div class="hp-theme-actions">
                                        <span class="hp-current-badge">当前主题</span>
                                    </div>
                                </div>
                            </div>
                            <div class="hp-theme-card" data-theme="academic">
                                <div class="hp-theme-info">
                                    <div class="hp-theme-details">
                                        <h4><i class="fas fa-graduation-cap"></i> 学术主题</h4>
                                        <p>专业 · 高效 · 可靠<br>
                                        <span>深蓝配色，专注学习</span></p>
                                    </div>
                                    <div class="hp-theme-actions">
                                        <button class="hp-theme-btn" onclick="switchToAcademicTheme()">切换</button>
                                    </div>
                                </div>
                            </div>
                            <div class="hp-theme-card" data-theme="melody">
                                <div class="hp-theme-info">
                                    <div class="hp-theme-details">
                                        <h4><i class="fas fa-heart"></i> 美乐蒂主题</h4>
                                        <p>可爱 · 温馨 · 愉悦<br>
                                        <span>粉色主题，快乐学习</span></p>
                                    </div>
                                    <div class="hp-theme-actions">
                                        <button class="hp-theme-btn" onclick="switchToMelodyTheme()">切换</button>
                                    </div>
                                </div>
                            </div>
                            <div class="hp-theme-card" data-theme="bloom">
                                <div class="hp-theme-info">
                                    <div class="hp-theme-details">
                                        <h4><i class="fas fa-leaf"></i> 秋日主题</h4>
                                        <p>温暖 · 舒适 · 自然<br>
                                        <span>金色调，放松心情</span></p>
                                    </div>
                                    <div class="hp-theme-actions">
                                        <button class="hp-theme-btn" onclick="switchToBloomTheme()">切换</button>
                                    </div>
                                </div>
                            </div>
                            <div class="hp-theme-card" data-theme="harrypotter">
                                <div class="hp-theme-info">
                                    <div class="hp-theme-details">
                                        <h4><i class="fas fa-hat-wizard"></i> 哈利波特主题</h4>
                                        <p>魔法 · 冒险 · 神秘<br>
                                        <span>深紫配色，奇幻体验</span></p>
                                    </div>
                                    <div class="hp-theme-actions">
                                        <button class="hp-theme-btn" onclick="switchToHarryPotterTheme()">切换</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="hp-theme-modal-footer">
                        <button class="hp-theme-btn-secondary" onclick="closeThemeSwitcherModal()">关闭</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // 添加样式
        addThemeModalStyles();

        // 绑定卡片点击事件
        bindThemeCardEvents();
    }

    function addThemeModalStyles() {
        if (document.getElementById('hp-theme-modal-styles')) {
            return;
        }

        const styles = `
            <style id="hp-theme-modal-styles">
                .hp-theme-modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(8px);
                    z-index: 1000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    animation: fadeIn 0.3s ease;
                }

                .hp-theme-modal-container {
                    background: var(--bg-primary, #ffffff);
                    border-radius: 20px;
                    max-width: 90%;
                    max-height: 90%;
                    width: 700px;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                    border: 3px solid var(--border-card, #e2e8f0);
                    overflow: hidden;
                    animation: slideUp 0.3s ease;
                }

                .hp-theme-modal-header {
                    background: linear-gradient(135deg, var(--primary-color, #667eea), var(--secondary-color, #764ba2));
                    color: white;
                    padding: 20px 30px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .hp-theme-modal-title {
                    font-size: 1.5rem;
                    font-weight: 600;
                    margin: 0;
                }

                .hp-theme-modal-close {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 1.5rem;
                    cursor: pointer;
                    padding: 5px 10px;
                    border-radius: 50%;
                    transition: background-color 0.3s ease;
                }

                .hp-theme-modal-close:hover {
                    background: rgba(255, 255, 255, 0.25);
                }

                .hp-theme-modal-body {
                    padding: 30px;
                    max-height: calc(90vh - 120px);
                    overflow-y: auto;
                    background: var(--bg-secondary, #f7fafc);
                }

                .hp-theme-description {
                    background: var(--bg-primary, #ffffff);
                    border-left: 4px solid var(--accent-color, #667eea);
                    padding: 15px;
                    border-radius: 8px;
                    margin-bottom: 20px;
                }

                .hp-theme-description p {
                    margin: 0;
                    color: var(--text-secondary, #4a5568);
                    font-size: 0.9rem;
                }

                .hp-theme-grid {
                    display: grid;
                    gap: 15px;
                }

                .hp-theme-card {
                    background: var(--bg-primary, #ffffff);
                    border: 2px solid var(--border-primary, #e2e8f0);
                    border-radius: 12px;
                    padding: 20px;
                    transition: all 0.3s ease;
                    cursor: pointer;
                }

                .hp-theme-card:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
                    border-color: var(--accent-color, #667eea);
                }

                .hp-theme-card.active {
                    border-color: var(--primary-color, #667eea);
                    background: linear-gradient(135deg, rgba(102, 126, 234, 0.1), rgba(118, 75, 162, 0.1));
                }

                .hp-theme-info {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .hp-theme-details h4 {
                    color: var(--text-primary, #2d3748);
                    font-size: 1.1rem;
                    font-weight: 600;
                    margin: 0 0 8px 0;
                }

                .hp-theme-details p {
                    color: var(--text-secondary, #4a5568);
                    font-size: 0.85rem;
                    margin: 0;
                    line-height: 1.4;
                }

                .hp-theme-details span {
                    color: var(--text-muted, #718096);
                    font-size: 0.8rem;
                }

                .hp-theme-actions {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .hp-current-badge {
                    background: linear-gradient(135deg, var(--success-color, #48bb78), var(--success-light, #68d391));
                    color: white;
                    padding: 4px 12px;
                    border-radius: 20px;
                    font-size: 0.75rem;
                    font-weight: 600;
                    text-transform: uppercase;
                }

                .hp-theme-btn {
                    background: var(--primary-color, #667eea);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    padding: 8px 16px;
                    cursor: pointer;
                    font-size: 0.85rem;
                    font-weight: 500;
                    transition: all 0.3s ease;
                }

                .hp-theme-btn:hover {
                    background: var(--primary-dark, #553c9a);
                    transform: translateY(-1px);
                }

                .hp-theme-modal-footer {
                    background: var(--bg-primary, #ffffff);
                    padding: 20px 30px;
                    border-top: 1px solid var(--border-primary, #e2e8f0);
                    display: flex;
                    justify-content: flex-end;
                }

                .hp-theme-btn-secondary {
                    background: var(--secondary-color, #718096);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    padding: 8px 16px;
                    cursor: pointer;
                    font-size: 0.85rem;
                    font-weight: 500;
                    transition: all 0.3s ease;
                }

                .hp-theme-btn-secondary:hover {
                    background: var(--secondary-dark, #4a5568);
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @keyframes slideUp {
                    from {
                        transform: translateY(30px);
                        opacity: 0;
                    }
                    to {
                        transform: translateY(0);
                        opacity: 1;
                    }
                }

                @media (max-width: 768px) {
                    .hp-theme-modal-container {
                        width: 95%;
                        margin: 10px;
                    }

                    .hp-theme-info {
                        flex-direction: column;
                        gap: 15px;
                        text-align: center;
                    }

                    .hp-theme-grid {
                        gap: 10px;
                    }
                }
            </style>
        `;

        document.head.insertAdjacentHTML('beforeend', styles);
    }

    function bindThemeCardEvents() {
        const themeCards = document.querySelectorAll('.hp-theme-card');
        themeCards.forEach(card => {
            card.addEventListener('click', function() {
                if (!this.classList.contains('active')) {
                    const theme = this.dataset.theme;
                    switchTheme(theme);
                }
            });
        });
    }

    function switchTheme(theme) {
        console.log('[HP-Settings-Theme-Modal] Switching to theme:', theme);

        // 更新卡片状态
        document.querySelectorAll('.hp-theme-card').forEach(card => {
            card.classList.remove('active');
            const badge = card.querySelector('.hp-current-badge');
            if (badge) badge.remove();
        });

        const activeCard = document.querySelector(`[data-theme="${theme}"]`);
        if (activeCard) {
            activeCard.classList.add('active');
            const badge = document.createElement('span');
            badge.className = 'hp-current-badge';
            badge.textContent = '当前主题';
            activeCard.querySelector('.hp-theme-actions').prepend(badge);
        }

        // 根据主题执行切换
        switch (theme) {
            case 'academic':
                switchToAcademicTheme();
                break;
            case 'melody':
                switchToMelodyTheme();
                break;
            case 'bloom':
                switchToBloomTheme();
                break;
            case 'harrypotter':
                switchToHarryPotterTheme();
                break;
            default:
                // 默认主题，刷新当前页面
                location.reload();
                break;
        }
    }

    function switchToAcademicTheme() {
        console.log('[HP-Settings-Theme-Modal] Switching to Academic theme');
        window.location.href = '.superdesign/design_iterations/ielts_academic_functional_2.html';
    }

    function switchToMelodyTheme() {
        console.log('[HP-Settings-Theme-Modal] Switching to Melody theme');
        window.location.href = '.superdesign/design_iterations/my_melody_ielts_1.html';
    }

    function switchToBloomTheme() {
        console.log('[HP-Settings-Theme-Modal] Switching to Bloom theme');
        window.location.href = '../../index.html';
    }

    function switchToHarryPotterTheme() {
        console.log('[HP-Settings-Theme-Modal] Switching to Harry Potter theme');
        const script = document.createElement('script');
        script.textContent = `
            try {
                document.documentElement.setAttribute('data-theme', 'harry');
                localStorage.setItem('theme', 'harry');
            } catch(e) {}
            window.location.href = '.superdesign/design_iterations/HarryPoter.html';
        `;
        document.head.appendChild(script);
    }

    function listenForThemeChanges() {
        // 监听系统主题变化事件
        const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
                    updateThemeStatus();
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });
    }

    function updateThemeStatus() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'default';
        const activeCard = document.querySelector(`[data-theme="${currentTheme}"]`);

        if (activeCard) {
            document.querySelectorAll('.hp-theme-card').forEach(card => {
                card.classList.remove('active');
                const badge = card.querySelector('.hp-current-badge');
                if (badge) badge.remove();
            });

            activeCard.classList.add('active');
            const badge = document.createElement('span');
            badge.className = 'hp-current-badge';
            badge.textContent = '当前主题';
            activeCard.querySelector('.hp-theme-actions').prepend(badge);
        }
    }

    // 全局函数
    window.closeThemeSwitcherModal = function() {
        const modal = document.getElementById('hp-theme-switcher-modal');
        if (modal) {
            modal.style.animation = 'fadeIn 0.3s ease reverse';
            setTimeout(() => {
                modal.remove();
            }, 300);
        }
    };

    console.log('[HP-Settings-Theme-Modal] Plugin initialized successfully');
})();