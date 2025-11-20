/**
 * AppleVocabAdapter.js
 * Adapts the core VocabStore data for the Apple Theme UI (Tailwind Version).
 */
(function (global) {
    'use strict';

    class AppleVocabAdapter {
        constructor() {
            this.container = document.getElementById('vocab-view');
            this.initialized = false;
        }

        async init() {
            if (this.initialized) return;

            if (global.VocabStore && typeof global.VocabStore.init === 'function') {
                await global.VocabStore.init();
            }

            this.render();
            this.initialized = true;

            window.addEventListener('viewChanged', (e) => {
                if (e.detail.viewId === 'vocab') {
                    this.render();
                }
            });
        }

        getWordOfTheDay() {
            const words = global.VocabStore ? global.VocabStore.getWords() : [];
            if (!words.length) return null;
            const today = new Date().getDate();
            const index = today % words.length;
            return words[index];
        }

        getRecentWords() {
            const words = global.VocabStore ? global.VocabStore.getWords() : [];
            return words.slice(-5).reverse();
        }

        render() {
            if (!this.container) return;

            const wordOfDay = this.getWordOfTheDay();
            const recentWords = this.getRecentWords();

            let html = `
                <div class="text-center py-12 animate-fade-in-up">
                    <h2 class="text-4xl font-bold text-gray-900 dark:text-white mb-2">每日词汇</h2>
                    <p class="text-xl text-gray-500 dark:text-gray-400">积累你的雅思核心词汇。</p>
                </div>
            `;

            if (wordOfDay) {
                html += `
                    <div class="bg-gradient-to-br from-blue-500 to-cyan-400 rounded-3xl p-10 text-white text-center shadow-xl mb-10 transform transition hover:scale-[1.02] duration-300">
                        <h3 class="text-sm font-bold uppercase tracking-widest opacity-80 mb-4">Word of the Day</h3>
                        <div class="text-6xl font-bold mb-2">${wordOfDay.word}</div>
                        <div class="text-xl font-mono opacity-80 mb-6">${wordOfDay.phonetic || ''}</div>
                        <div class="text-xl max-w-2xl mx-auto leading-relaxed">${wordOfDay.meaning}</div>
                    </div>
                `;
            } else {
                html += `
                    <div class="bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 rounded-3xl p-10 text-center shadow-lg mb-10">
                        <h3 class="text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest mb-4">Welcome</h3>
                        <div class="text-4xl font-bold text-gray-800 dark:text-white mb-2">Start Learning</div>
                        <div class="text-gray-500 dark:text-gray-400">Import a word list to get started.</div>
                    </div>
                `;
            }

            html += `<div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">`;

            if (recentWords.length > 0) {
                recentWords.forEach(word => {
                    html += `
                        <div class="p-5 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-700/50 transition cursor-pointer group">
                            <div class="text-lg font-medium text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">${word.word}</div>
                            <div class="text-gray-500 dark:text-gray-400">${word.meaning}</div>
                        </div>
                    `;
                });
            } else {
                html += `<div class="p-5 text-center text-gray-400">暂无词汇记录</div>`;
            }

            html += `</div>`;

            html += `
                <div class="mt-10 text-center">
                    <button id="apple-vocab-import-btn" class="px-8 py-3 bg-gray-100 dark:bg-gray-800 text-blue-600 dark:text-blue-400 font-medium rounded-full hover:bg-blue-50 dark:hover:bg-gray-700 transition duration-200">
                        导入词库
                    </button>
                </div>
            `;

            this.container.innerHTML = html;

            const importBtn = document.getElementById('apple-vocab-import-btn');
            if (importBtn) {
                importBtn.addEventListener('click', () => {
                    alert('Import functionality coming soon');
                });
            }
        }
    }

    global.AppleVocabAdapter = AppleVocabAdapter;

    document.addEventListener('DOMContentLoaded', () => {
        const adapter = new AppleVocabAdapter();
        adapter.init();
    });

})(typeof window !== "undefined" ? window : globalThis);
