/**
 * 主题管理器
 * 提供主题切换和个性化设置功能
 */
class ThemeManager {
    constructor() {
        this.themes = {
            xiaodaidai: {
                name: '小呆呆主题',
                variables: {
                    '--primary-color': '#ffc83d',
                    '--primary-color-light': 'rgba(255, 200, 61, 0.18)',
                    '--primary-hover': '#f59e0b',
                    '--secondary-color': '#64748b',
                    '--success-color': '#34d399',
                    '--success-color-light': 'rgba(52, 211, 153, 0.14)',
                    '--warning-color': '#f59e0b',
                    '--error-color': '#ef4444',
                    '--accent-color': '#a1bfff',

                    '--bg-primary': '#f7f9fb',
                    '--bg-secondary': '#fff8e1',
                    '--bg-tertiary': '#ffe4b5',

                    '--text-primary': '#1f2937',
                    '--text-secondary': '#4b5563',
                    '--text-tertiary': '#64748b',
                    '--text-muted': '#94a3b8',

                    '--border-color': 'rgba(255, 200, 61, 0.35)',
                    '--shadow-sm': '0 6px 16px rgba(161, 191, 255, 0.25)',
                    '--shadow-md': '0 12px 28px rgba(255, 200, 61, 0.22)',
                    '--shadow-lg': '0 24px 60px rgba(161, 191, 255, 0.3)'
                }
            },
            light: {
                name: '浅色主题',
                variables: {
                    '--primary-color': '#3b82f6',
                    '--primary-color-light': 'rgba(59, 130, 246, 0.1)',
                    '--primary-hover': '#2563eb',
                    '--secondary-color': '#6b7280',
                    '--success-color': '#10b981',
                    '--success-color-light': 'rgba(16, 185, 129, 0.1)',
                    '--warning-color': '#f59e0b',
                    '--error-color': '#ef4444',
                    '--accent-color': '#8b5cf6',
                    
                    '--bg-primary': '#ffffff',
                    '--bg-secondary': '#f8fafc',
                    '--bg-tertiary': '#f1f5f9',
                    
                    '--text-primary': '#1f2937',
                    '--text-secondary': '#6b7280',
                    '--text-tertiary': '#9ca3af',
                    '--text-muted': '#9ca3af',
                    
                    '--border-color': '#e5e7eb',
                    '--shadow-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                    '--shadow-md': '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    '--shadow-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                }
            },
            dark: {
                name: '深色主题',
                variables: {
                    '--primary-color': '#60a5fa',
                    '--primary-color-light': 'rgba(96, 165, 250, 0.1)',
                    '--primary-hover': '#3b82f6',
                    '--secondary-color': '#9ca3af',
                    '--success-color': '#34d399',
                    '--success-color-light': 'rgba(52, 211, 153, 0.1)',
                    '--warning-color': '#fbbf24',
                    '--error-color': '#f87171',
                    '--accent-color': '#a78bfa',
                    
                    '--bg-primary': '#1f2937',
                    '--bg-secondary': '#111827',
                    '--bg-tertiary': '#0f172a',
                    
                    '--text-primary': '#f9fafb',
                    '--text-secondary': '#d1d5db',
                    '--text-tertiary': '#9ca3af',
                    '--text-muted': '#6b7280',
                    
                    '--border-color': '#374151',
                    '--shadow-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.3)',
                    '--shadow-md': '0 4px 6px -1px rgba(0, 0, 0, 0.4)',
                    '--shadow-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
                }
            },
            highContrast: {
                name: '高对比度主题',
                variables: {
                    '--primary-color': '#0066cc',
                    '--primary-color-light': 'rgba(0, 102, 204, 0.1)',
                    '--primary-hover': '#004499',
                    '--secondary-color': '#333333',
                    '--success-color': '#008800',
                    '--success-color-light': 'rgba(0, 136, 0, 0.1)',
                    '--warning-color': '#ff6600',
                    '--error-color': '#cc0000',
                    '--accent-color': '#6600cc',
                    
                    '--bg-primary': '#ffffff',
                    '--bg-secondary': '#f0f0f0',
                    '--bg-tertiary': '#e0e0e0',
                    
                    '--text-primary': '#000000',
                    '--text-secondary': '#333333',
                    '--text-tertiary': '#666666',
                    '--text-muted': '#666666',
                    
                    '--border-color': '#000000',
                    '--shadow-sm': '0 2px 4px 0 rgba(0, 0, 0, 0.3)',
                    '--shadow-md': '0 6px 8px -1px rgba(0, 0, 0, 0.4)',
                    '--shadow-lg': '0 12px 18px -3px rgba(0, 0, 0, 0.5)'
                }
            }
        };
        
        this.currentTheme = 'light';
        this.settings = {
            fontSize: 'normal', // 'small', 'normal', 'large', 'extra-large'
            reduceMotion: false,
            highContrast: false,
            autoTheme: true // 自动根据系统主题切换
        };
        
        this.init();
    }
    
    async init() {
        await this.loadSettings();
        this.setupSystemThemeDetection();
        this.applyCurrentTheme();
        this.setupEventListeners();
    }
    
    /**
     * 加载保存的设置
     */
    async loadSettings() {
        const savedSettings = await window.storage?.get('theme_settings', {});
        this.settings = { ...this.settings, ...savedSettings };
        
        const savedTheme = await window.storage?.get('current_theme', 'light');
        this.currentTheme = savedTheme;
    }
    
    /**
     * 保存设置
     */
    async saveSettings() {
        if (window.storage) {
            await window.storage.set('theme_settings', this.settings);
            await window.storage.set('current_theme', this.currentTheme);
        }
    }
    
    /**
     * 设置系统主题检测
     */
    setupSystemThemeDetection() {
        if (window.matchMedia) {
            const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
            const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

            // Note: MediaQueryEventListeners cannot be easily replaced with event delegation
            // These are system-level media queries that need the traditional addEventListener
            // 监听系统主题变化
            darkModeQuery.addEventListener('change', (e) => {
                if (this.settings.autoTheme) {
                    this.setTheme(e.matches ? 'dark' : 'light');
                }
            });

            // 监听减少动画偏好
            reduceMotionQuery.addEventListener('change', (e) => {
                this.settings.reduceMotion = e.matches;
                this.applyMotionSettings();
                this.saveSettings();
            });
            
            // 初始化设置
            if (this.settings.autoTheme) {
                this.currentTheme = darkModeQuery.matches ? 'dark' : 'light';
            }
            
            this.settings.reduceMotion = reduceMotionQuery.matches;
        }
    }
    
    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 监听键盘快捷键 - 全局事件必须使用原生 addEventListener
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'T') {
                e.preventDefault();
                this.toggleTheme();
            }
        });
    }
    
    /**
     * 应用当前主题
     */
    applyCurrentTheme() {
        const theme = this.themes[this.currentTheme];
        if (!theme) return;
        
        const root = document.documentElement;
        
        // 应用主题变量
        Object.entries(theme.variables).forEach(([property, value]) => {
            root.style.setProperty(property, value);
        });
        
        // 应用主题类
        document.body.className = document.body.className
            .replace(/theme-\w+/g, '')
            .trim();
        document.body.classList.add(`theme-${this.currentTheme}`);
        
        // 应用其他设置
        this.applyFontSize();
        this.applyMotionSettings();
        this.applyContrastSettings();
        
        // 触发主题变化事件
        document.dispatchEvent(new CustomEvent('themeChanged', {
            detail: { theme: this.currentTheme, settings: this.settings }
        }));
    }
    
    /**
     * 应用字体大小设置
     */
    applyFontSize() {
        const fontSizeClasses = ['font-small', 'font-normal', 'font-large', 'font-extra-large'];
        fontSizeClasses.forEach(cls => document.body.classList.remove(cls));
        
        if (this.settings.fontSize !== 'normal') {
            document.body.classList.add(`font-${this.settings.fontSize.replace('-', '-')}`);
        }
    }
    
    /**
     * 应用动画设置
     */
    applyMotionSettings() {
        document.body.classList.toggle('reduce-motion', this.settings.reduceMotion);
    }
    
    /**
     * 应用对比度设置
     */
    applyContrastSettings() {
        document.body.classList.toggle('high-contrast', this.settings.highContrast);
    }
    
    /**
     * 设置主题
     */
    setTheme(themeName) {
        if (!this.themes[themeName]) {
            console.warn(`Theme "${themeName}" not found`);
            return;
        }
        
        this.currentTheme = themeName;
        this.applyCurrentTheme();
        this.saveSettings();
        
        if (window.showMessage) {
            window.showMessage(`已切换到${this.themes[themeName].name}`, 'info');
        }
    }
    
    /**
     * 切换主题
     */
    toggleTheme() {
        const themeOrder = ['light', 'xiaodaidai', 'dark', 'highContrast'];
        const currentIndex = themeOrder.indexOf(this.currentTheme);
        const nextIndex = (currentIndex + 1) % themeOrder.length;

        this.setTheme(themeOrder[nextIndex]);
    }
    
    /**
     * 设置字体大小
     */
    setFontSize(size) {
        const validSizes = ['small', 'normal', 'large', 'extra-large'];
        if (!validSizes.includes(size)) {
            console.warn(`Invalid font size: ${size}`);
            return;
        }
        
        this.settings.fontSize = size;
        this.applyFontSize();
        this.saveSettings();
        
        if (window.showMessage) {
            const sizeNames = {
                'small': '小',
                'normal': '正常',
                'large': '大',
                'extra-large': '特大'
            };
            window.showMessage(`字体大小已设置为${sizeNames[size]}`, 'info');
        }
    }
    
    /**
     * 切换减少动画
     */
    toggleReduceMotion() {
        this.settings.reduceMotion = !this.settings.reduceMotion;
        this.applyMotionSettings();
        this.saveSettings();
        
        if (window.showMessage) {
            const message = this.settings.reduceMotion ? '已启用减少动画' : '已禁用减少动画';
            window.showMessage(message, 'info');
        }
    }
    
    /**
     * 切换高对比度
     */
    async toggleHighContrast() {
        this.settings.highContrast = !this.settings.highContrast;
        
        if (this.settings.highContrast) {
            await window.storage?.set('previous_theme', this.currentTheme); // Save current before switch
            this.setTheme('highContrast');
        } else {
            // 恢复到之前的主题或默认主题
            const previousTheme = await window.storage?.get('previous_theme', 'light');
            this.setTheme(previousTheme);
        }
        await this.saveSettings(); // Ensure saved
    }
    
    /**
     * 切换自动主题
     */
    toggleAutoTheme() {
        this.settings.autoTheme = !this.settings.autoTheme;
        this.saveSettings();
        
        if (this.settings.autoTheme && window.matchMedia) {
            const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
            this.setTheme(darkModeQuery.matches ? 'dark' : 'light');
        }
        
        if (window.showMessage) {
            const message = this.settings.autoTheme ? '已启用自动主题' : '已禁用自动主题';
            window.showMessage(message, 'info');
        }
    }
    
    /**
     * 获取当前主题信息
     */
    getCurrentTheme() {
        return {
            name: this.currentTheme,
            displayName: this.themes[this.currentTheme]?.name,
            settings: { ...this.settings }
        };
    }
    
    /**
     * 获取所有可用主题
     */
    getAvailableThemes() {
        return Object.entries(this.themes).map(([key, theme]) => ({
            key,
            name: theme.name,
            isCurrent: key === this.currentTheme
        }));
    }
    
    /**
     * 重置为默认设置
     */
    async resetToDefaults() {
        this.currentTheme = 'light';
        this.settings = {
            fontSize: 'normal',
            reduceMotion: false,
            highContrast: false,
            autoTheme: true
        };
        
        this.applyCurrentTheme();
        await this.saveSettings();
        
        if (window.showMessage) {
            window.showMessage('主题设置已重置为默认值', 'info');
        }
    }
}
