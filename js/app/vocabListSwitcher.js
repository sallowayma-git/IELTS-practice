/**
 * VocabListSwitcher - 词表切换器组件
 * 
 * 功能：
 * - 在单词背诵界面右上角显示词表切换菜单
 * - 支持切换不同来源的词表（P1、P4、综合、自定义）
 * - 显示每个词表的单词数量
 * - 保存用户的词表选择偏好
 */
(function(window) {
    'use strict';

    class VocabListSwitcher {
        constructor(vocabStore) {
            if (!vocabStore) {
                throw new Error('[VocabListSwitcher] vocabStore is required');
            }
            
            this.vocabStore = vocabStore;
            this.container = null;
            this.dropdownVisible = false;
            this.currentListId = null;
            this.previousListId = null; // 用于错误回退
            
            // 绑定事件处理器
            this.handleMenuButtonClick = this.handleMenuButtonClick.bind(this);
            this.handleListOptionClick = this.handleListOptionClick.bind(this);
            this.handleDocumentClick = this.handleDocumentClick.bind(this);
        }

        /**
         * 渲染词表切换器到指定容器
         * @param {HTMLElement} container - 容器元素
         */
        render(container) {
            if (!container || !(container instanceof HTMLElement)) {
                console.error('[VocabListSwitcher] Invalid container element');
                return;
            }

            this.container = container;
            
            // 获取当前激活的词表 ID
            this.currentListId = this.vocabStore.getActiveListId();
            this.previousListId = this.currentListId;

            // 创建切换器 HTML 结构
            const switcherHTML = `
                <div class="vocab-list-switcher">
                    <button class="switcher-btn" id="vocab-list-menu-btn" type="button" aria-label="切换词表">
                        <span class="current-list-icon"></span>
                        <span class="current-list-name"></span>
                        <span class="dropdown-icon">▼</span>
                    </button>
                    <div class="switcher-dropdown" id="vocab-list-dropdown" style="display: none;" role="menu">
                        <div class="dropdown-content">
                            ${this.renderListOptions()}
                        </div>
                    </div>
                </div>
            `;

            // 插入到容器
            container.innerHTML = switcherHTML;

            // 更新当前词表显示
            this.updateCurrentListDisplay();

            // 附加事件监听器
            this.attachEventListeners();

            // 初始化词表计数
            this.updateListCounts();
        }

        /**
         * 渲染词表选项列表
         * @returns {string} HTML 字符串
         */
        renderListOptions() {
            const lists = this.vocabStore.VOCAB_LISTS;
            const availableLists = this.vocabStore.getAvailableLists();
            
            if (!availableLists || availableLists.length === 0) {
                return '<div class="list-option-empty">暂无可用词表</div>';
            }

            return availableLists.map(list => {
                const isActive = list.id === this.currentListId;
                const activeClass = isActive ? 'active' : '';
                
                return `
                    <div class="list-option ${activeClass}" 
                         data-list-id="${list.id}" 
                         role="menuitem"
                         tabindex="0">
                        <span class="list-icon">${list.icon}</span>
                        <span class="list-name">${list.name}</span>
                        <span class="list-count" data-list-id="${list.id}">
                            <span class="count-loading">...</span>
                        </span>
                        ${isActive ? '<span class="active-indicator">✓</span>' : ''}
                    </div>
                `;
            }).join('');
        }

        /**
         * 更新当前词表的显示
         */
        updateCurrentListDisplay() {
            if (!this.container) return;

            const lists = this.vocabStore.VOCAB_LISTS;
            const currentList = lists[this.currentListId];
            
            if (!currentList) {
                console.warn('[VocabListSwitcher] Current list not found:', this.currentListId);
                return;
            }

            const iconEl = this.container.querySelector('.current-list-icon');
            const nameEl = this.container.querySelector('.current-list-name');

            if (iconEl) {
                iconEl.textContent = currentList.icon;
            }
            if (nameEl) {
                nameEl.textContent = currentList.name;
            }
        }

        /**
         * 附加事件监听器
         */
        attachEventListeners() {
            if (!this.container) return;

            const menuBtn = this.container.querySelector('#vocab-list-menu-btn');
            if (menuBtn) {
                menuBtn.addEventListener('click', this.handleMenuButtonClick);
            }

            // 为词表选项附加点击事件（委托）
            const dropdown = this.container.querySelector('#vocab-list-dropdown');
            if (dropdown) {
                dropdown.addEventListener('click', this.handleListOptionClick);
            }

            // 点击外部关闭下拉菜单
            document.addEventListener('click', this.handleDocumentClick);
        }

        /**
         * 移除事件监听器
         */
        detachEventListeners() {
            if (!this.container) return;

            const menuBtn = this.container.querySelector('#vocab-list-menu-btn');
            if (menuBtn) {
                menuBtn.removeEventListener('click', this.handleMenuButtonClick);
            }

            const dropdown = this.container.querySelector('#vocab-list-dropdown');
            if (dropdown) {
                dropdown.removeEventListener('click', this.handleListOptionClick);
            }

            document.removeEventListener('click', this.handleDocumentClick);
        }

        /**
         * 处理菜单按钮点击
         * @param {Event} event
         */
        handleMenuButtonClick(event) {
            event.stopPropagation();
            this.toggleDropdown();
        }

        /**
         * 处理词表选项点击
         * @param {Event} event
         */
        handleListOptionClick(event) {
            const listOption = event.target.closest('.list-option');
            if (!listOption) return;

            const listId = listOption.dataset.listId;
            if (!listId) return;

            // 如果点击的是当前激活的词表，只关闭下拉菜单
            if (listId === this.currentListId) {
                this.hideDropdown();
                return;
            }

            // 切换到新词表
            this.switchList(listId);
        }

        /**
         * 处理文档点击（关闭下拉菜单）
         * @param {Event} event
         */
        handleDocumentClick(event) {
            if (!this.container) return;
            
            // 如果点击的是切换器内部元素，不关闭
            if (this.container.contains(event.target)) {
                return;
            }

            // 关闭下拉菜单
            if (this.dropdownVisible) {
                this.hideDropdown();
            }
        }

        /**
         * 切换下拉菜单显示/隐藏
         */
        toggleDropdown() {
            if (this.dropdownVisible) {
                this.hideDropdown();
            } else {
                this.showDropdown();
            }
        }

        /**
         * 显示下拉菜单
         */
        showDropdown() {
            if (!this.container) return;

            const dropdown = this.container.querySelector('#vocab-list-dropdown');
            if (dropdown) {
                dropdown.style.display = 'block';
                this.dropdownVisible = true;

                // 更新词表计数
                this.updateListCounts();
            }
        }

        /**
         * 隐藏下拉菜单
         */
        hideDropdown() {
            if (!this.container) return;

            const dropdown = this.container.querySelector('#vocab-list-dropdown');
            if (dropdown) {
                dropdown.style.display = 'none';
                this.dropdownVisible = false;
            }
        }

        /**
         * 切换词表
         * @param {string} listId - 词表 ID
         */
        async switchList(listId) {
            if (!listId || typeof listId !== 'string') {
                console.error('[VocabListSwitcher] Invalid list ID:', listId);
                return;
            }

            const lists = this.vocabStore.VOCAB_LISTS;
            if (!lists[listId]) {
                console.error('[VocabListSwitcher] Unknown list ID:', listId);
                return;
            }

            // 保存当前词表 ID（用于错误回退）
            this.previousListId = this.currentListId;

            try {
                // 显示加载状态
                this.showLoadingState(listId);

                // 加载新词表
                const list = await this.vocabStore.loadList(listId);

                if (!list) {
                    // 词表为空或加载失败
                    this.showEmptyListMessage(listId);
                    return;
                }

                // 切换到新词表
                const success = await this.vocabStore.setActiveList(list);

                if (!success) {
                    throw new Error('Failed to set active list');
                }

                // 更新当前词表 ID
                this.currentListId = listId;

                // 更新 UI 显示
                this.updateCurrentListDisplay();
                this.refreshListOptions();

                // 关闭下拉菜单
                this.hideDropdown();

                // 触发词表切换事件（供外部监听）
                this.dispatchSwitchEvent(listId, list);

                console.log('[VocabListSwitcher] 切换词表成功:', listId);

            } catch (error) {
                console.error('[VocabListSwitcher] 切换词表失败:', error);
                
                // 回退到上一个词表
                await this.rollbackToPreviousList();
                
                // 显示错误提示
                this.showErrorMessage('词表加载失败，请重试');
            }
        }

        /**
         * 显示加载状态
         * @param {string} listId - 词表 ID
         */
        showLoadingState(listId) {
            if (!this.container) return;

            const listOption = this.container.querySelector(`.list-option[data-list-id="${listId}"]`);
            if (listOption) {
                listOption.classList.add('loading');
            }
        }

        /**
         * 刷新词表选项列表
         */
        refreshListOptions() {
            if (!this.container) return;

            const dropdownContent = this.container.querySelector('.dropdown-content');
            if (dropdownContent) {
                dropdownContent.innerHTML = this.renderListOptions();
            }

            // 更新词表计数
            this.updateListCounts();
        }

        /**
         * 回退到上一个词表
         */
        async rollbackToPreviousList() {
            if (!this.previousListId) return;

            try {
                const previousList = await this.vocabStore.loadList(this.previousListId);
                if (previousList) {
                    await this.vocabStore.setActiveList(previousList);
                    this.currentListId = this.previousListId;
                    this.updateCurrentListDisplay();
                    this.refreshListOptions();
                }
            } catch (error) {
                console.error('[VocabListSwitcher] 回退失败:', error);
            }
        }

        /**
         * 触发词表切换事件
         * @param {string} listId - 词表 ID
         * @param {Object} list - 词表数据
         */
        dispatchSwitchEvent(listId, list) {
            if (!this.container) return;

            const event = new CustomEvent('vocabListSwitch', {
                detail: {
                    listId: listId,
                    list: list,
                    timestamp: Date.now()
                },
                bubbles: true
            });

            this.container.dispatchEvent(event);
        }

        /**
         * 更新词表计数
         */
        async updateListCounts() {
            if (!this.container) return;

            const lists = this.vocabStore.VOCAB_LISTS;
            const listIds = Object.keys(lists);

            // 并发获取所有词表的单词数量
            const countPromises = listIds.map(async (listId) => {
                try {
                    const count = await this.vocabStore.getListWordCount(listId);
                    return { listId, count };
                } catch (error) {
                    console.error(`[VocabListSwitcher] 获取词表计数失败: ${listId}`, error);
                    return { listId, count: 0 };
                }
            });

            const results = await Promise.all(countPromises);

            // 更新 UI 显示
            results.forEach(({ listId, count }) => {
                const countEl = this.container.querySelector(`.list-count[data-list-id="${listId}"] .count-loading`);
                if (countEl) {
                    countEl.textContent = count;
                    countEl.classList.remove('count-loading');
                    countEl.classList.add('count-loaded');
                }
            });
        }

        /**
         * 显示空词表提示
         * @param {string} listId - 词表 ID
         */
        showEmptyListMessage(listId) {
            const lists = this.vocabStore.VOCAB_LISTS;
            const list = lists[listId];
            
            if (!list) return;

            const message = `词表「${list.name}」暂无单词`;
            
            // 显示提示消息
            this.showToast(message, 'info');

            // 回退到上一个词表
            this.rollbackToPreviousList();
        }

        /**
         * 显示错误提示
         * @param {string} message - 错误消息
         */
        showErrorMessage(message) {
            this.showToast(message, 'error');
        }

        /**
         * 显示提示消息（Toast）
         * @param {string} message - 消息内容
         * @param {string} type - 消息类型 ('info' | 'error' | 'success')
         */
        showToast(message, type = 'info') {
            // 检查是否存在全局 Toast 组件
            if (window.Toast && typeof window.Toast.show === 'function') {
                window.Toast.show(message, type);
                return;
            }

            // 降级方案：使用简单的 DOM 提示
            const toast = document.createElement('div');
            toast.className = `vocab-switcher-toast toast-${type}`;
            toast.textContent = message;
            toast.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 12px 20px;
                background: ${type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : '#2196f3'};
                color: white;
                border-radius: 4px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                z-index: 10000;
                font-size: 14px;
                max-width: 300px;
                word-wrap: break-word;
                animation: slideInRight 0.3s ease-out;
            `;

            document.body.appendChild(toast);

            // 3秒后自动移除
            setTimeout(() => {
                toast.style.animation = 'slideOutRight 0.3s ease-in';
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.parentNode.removeChild(toast);
                    }
                }, 300);
            }, 3000);
        }

        /**
         * 销毁组件
         */
        destroy() {
            this.detachEventListeners();
            if (this.container) {
                this.container.innerHTML = '';
                this.container = null;
            }
        }
    }

    // 导出到全局
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = VocabListSwitcher;
    } else {
        window.VocabListSwitcher = VocabListSwitcher;
    }

})(typeof window !== 'undefined' ? window : globalThis);
