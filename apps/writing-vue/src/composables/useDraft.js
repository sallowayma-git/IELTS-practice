import { ref, computed, onBeforeUnmount } from 'vue'

/**
 * Draft Auto-Save Composable
 * 草稿自动保存功能
 * 
 * 使用 localStorage 存储草稿
 * 兼容两种调用方式:
 * 1) useDraft('compose-essay', contentRef)
 * 2) useDraft('task1') / useDraft('task2')
 */
export function useDraft(draftId, contentRef = null) {
    const keySuffix = draftId || 'compose'

    // 草稿存储 key
    const draftKey = computed(() => `ielts_writing_draft_${keySuffix}`)

    // 草稿数据
    const content = ref('')
    const topicId = ref(null)
    const wordCount = ref(0)
    const lastSaved = ref(null)

    // 是否有待保存的更改
    const hasUnsavedChanges = ref(false)

    // 自动保存定时器
    let saveTimeout = null

    /**
     * 保存草稿到 localStorage
     */
    const saveDraft = (payload = null) => {
        try {
            const nextContent = payload && typeof payload.content === 'string'
                ? payload.content
                : (contentRef?.value ?? content.value);
            const nextTaskType = payload && payload.taskType
                ? payload.taskType
                : (payload?.task_type || keySuffix);

            if (contentRef) {
                contentRef.value = nextContent;
            } else {
                content.value = nextContent;
            }

            const draftData = {
                task_type: nextTaskType,
                topic_id: topicId.value,
                content: nextContent,
                word_count: wordCount.value,
                last_saved: new Date().toISOString()
            }

            localStorage.setItem(draftKey.value, JSON.stringify(draftData))
            lastSaved.value = new Date()
            hasUnsavedChanges.value = false

            console.log(`[Draft] Saved at ${lastSaved.value.toLocaleTimeString()}`)
        } catch (error) {
            console.error('[Draft] Failed to save:', error)
            // 如果是 QuotaExceededError，可能需要清理旧数据或转用其他存储
            if (error.name === 'QuotaExceededError') {
                console.warn('[Draft] localStorage quota exceeded, consider cleanup')
            }
        }
    }

    /**
     * 从 localStorage 加载草稿
     */
    const loadDraft = () => {
        try {
            const stored = localStorage.getItem(draftKey.value)
            if (!stored) return null

            const draftData = JSON.parse(stored)

            // 设置数据
            content.value = draftData.content || ''
            topicId.value = draftData.topic_id || null
            wordCount.value = draftData.word_count || 0
            lastSaved.value = draftData.last_saved ? new Date(draftData.last_saved) : null

            console.log('[Draft] Loaded from localStorage')
            return draftData
        } catch (error) {
            console.error('[Draft] Failed to load:', error)
            return null
        }
    }

    /**
     * 清除草稿
     */
    const clearDraft = () => {
        try {
            localStorage.removeItem(draftKey.value)
            content.value = ''
            topicId.value = null
            wordCount.value = 0
            lastSaved.value = null
            hasUnsavedChanges.value = false

            console.log('[Draft] Cleared')
        } catch (error) {
            console.error('[Draft] Failed to clear:', error)
        }
    }

    /**
     * 检查是否有草稿
     */
    const hasDraft = () => {
        try {
            return localStorage.getItem(draftKey.value) !== null
        } catch (error) {
            return false
        }
    }

    /**
     * 设置内容并触发自动保存（防抖）
     */
    const setContent = (newContent, newWordCount = 0, taskType = null) => {
        if (contentRef) {
            contentRef.value = newContent
        } else {
            content.value = newContent
        }
        wordCount.value = newWordCount
        hasUnsavedChanges.value = true

        // 清除之前的定时器
        if (saveTimeout) {
            clearTimeout(saveTimeout)
        }

        // 10秒后自动保存（防抖）
        saveTimeout = setTimeout(() => saveDraft(taskType ? { taskType } : null), 10000)
    }

    /**
     * 设置题目ID
     */
    const setTopicId = (id) => {
        topicId.value = id
        hasUnsavedChanges.value = true
    }

    /**
     * 手动立即保存（Ctrl+S 触发）
     */
    const saveNow = () => {
        if (saveTimeout) {
            clearTimeout(saveTimeout)
            saveTimeout = null
        }
        saveDraft()
    }

    /**
     * 停止自动保存定时器（用于提交后清理）
     */
    const stopAutoSave = () => {
        if (saveTimeout) {
            clearTimeout(saveTimeout)
            saveTimeout = null
        }
    }

    // 组件卸载前保存
    onBeforeUnmount(() => {
        if (hasUnsavedChanges.value) {
            saveDraft()
        }
        if (saveTimeout) {
            clearTimeout(saveTimeout)
        }
    })

    // 页面刷新/关闭前保存
    const beforeUnloadHandler = (e) => {
        if (hasUnsavedChanges.value) {
            saveDraft()
            // 某些浏览器会显示确认对话框
            e.preventDefault()
            e.returnValue = ''
        }
    }

    // 注册页面卸载监听
    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', beforeUnloadHandler)
    }

    // 清理事件监听
    onBeforeUnmount(() => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('beforeunload', beforeUnloadHandler)
        }
    })

    return {
        // 数据
        content,
        topicId,
        wordCount,
        lastSaved,
        hasUnsavedChanges,

        // 方法
        saveDraft,
        loadDraft,
        clearDraft,
        hasDraft,
        setContent,
        setTopicId,
        saveNow,
        stopAutoSave
    }
}
