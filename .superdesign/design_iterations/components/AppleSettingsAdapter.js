/**
 * AppleSettingsAdapter.js
 * Adapts the core Settings/Theme data for the Apple Theme UI (Tailwind Version).
 */
(function (global) {
    'use strict';

    class AppleSettingsAdapter {
        constructor() {
            this.container = document.getElementById('settings-view');
            this.initialized = false;
        }

        async init() {
            if (this.initialized) return;
            this.render();
            this.initialized = true;

            window.addEventListener('viewChanged', (e) => {
                if (e.detail.viewId === 'settings') {
                    this.render();
                }
            });
        }

        render() {
            if (!this.container) return;

            const currentTheme = localStorage.getItem('current_theme') || 'light';
            const autoTheme = localStorage.getItem('theme_auto') === 'true';

            const html = `
                <div class="text-center py-12 animate-fade-in-up">
                    <h2 class="text-4xl font-bold text-gray-900 dark:text-white mb-2">设置</h2>
                    <p class="text-xl text-gray-500 dark:text-gray-400">管理你的偏好与数据。</p>
                </div>

                <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700 mb-6">
                    <div class="p-5 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/50 transition cursor-pointer" id="setting-theme">
                        <div class="text-lg font-medium text-gray-900 dark:text-white">外观模式</div>
                        <div class="text-gray-500 dark:text-gray-400 flex items-center gap-2">
                            ${currentTheme} 
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                        </div>
                    </div>
                    <div class="p-5 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/50 transition cursor-pointer" id="setting-auto-theme">
                        <div class="text-lg font-medium text-gray-900 dark:text-white">跟随系统</div>
                        <div class="text-gray-500 dark:text-gray-400 flex items-center gap-2">
                            ${autoTheme ? '开启' : '关闭'}
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                        </div>
                    </div>
                </div>

                <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
                    <div class="p-5 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/50 transition cursor-pointer" id="setting-backup">
                        <div class="text-lg font-medium text-gray-900 dark:text-white">数据备份</div>
                        <div class="text-gray-500 dark:text-gray-400">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                        </div>
                    </div>
                    <div class="p-5 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/50 transition cursor-pointer" id="setting-clear">
                        <div class="text-lg font-medium text-gray-900 dark:text-white">清除缓存</div>
                        <div class="text-gray-500 dark:text-gray-400">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                        </div>
                    </div>
                    <div class="p-5 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/50 transition cursor-pointer group" id="setting-reset">
                        <div class="text-lg font-medium text-red-500 group-hover:text-red-600 transition-colors">重置所有进度</div>
                        <div class="text-gray-500 dark:text-gray-400">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                        </div>
                    </div>
                </div>
            `;

            this.container.innerHTML = html;
            this.bindEvents();
        }

        bindEvents() {
            document.getElementById('setting-theme').addEventListener('click', () => {
                const current = localStorage.getItem('current_theme') || 'light';
                const next = current === 'light' ? 'dark' : 'light';

                if (global.ThemeManager) {
                    global.ThemeManager.setTheme(next);
                } else {
                    if (next === 'dark') {
                        document.documentElement.classList.add('dark');
                    } else {
                        document.documentElement.classList.remove('dark');
                    }
                    localStorage.setItem('current_theme', next);
                }
                this.render();
            });

            document.getElementById('setting-backup').addEventListener('click', () => {
                if (global.dataManagementPanel) {
                    global.dataManagementPanel.show();
                } else {
                    alert('Data Management Panel not loaded.');
                }
            });

            document.getElementById('setting-clear').addEventListener('click', () => {
                if (confirm('Are you sure you want to clear all local data?')) {
                    localStorage.clear();
                    location.reload();
                }
            });
        }
    }

    global.AppleSettingsAdapter = AppleSettingsAdapter;

    document.addEventListener('DOMContentLoaded', () => {
        const adapter = new AppleSettingsAdapter();
        adapter.init();
    });

})(typeof window !== "undefined" ? window : globalThis);
