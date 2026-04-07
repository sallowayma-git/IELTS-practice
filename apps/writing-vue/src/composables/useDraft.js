import { computed, onBeforeUnmount } from 'vue'

/**
 * Draft Auto-Save Composable
 * 草稿自动保存功能
 *
 * 当前写作模块只在 ComposePage 使用，因此这里收敛成一个简单契约：
 * - 调用方提供当前草稿快照 getter
 * - composable 负责 debounce 保存、读取、清理与 beforeunload 兜底
 */
export function useDraft(draftId, getSnapshot = null) {
    const keySuffix = draftId || 'compose'
    const draftKey = computed(() => `ielts_writing_draft_${keySuffix}`)
    const VALID_TASK_TYPES = new Set(['task1', 'task2'])
    const VALID_TOPIC_MODES = new Set(['free', 'bank'])

    let saveTimeout = null
    let lastSnapshot = null
    let lastPersistedSignature = ''
    let persistenceEnabled = true
    let storageAvailableCache = null
    let storageRetryAt = 0

    function resolveStorage() {
        if (typeof window === 'undefined') return null
        try {
            return window.localStorage || null
        } catch {
            return null
        }
    }

    function isStorageAvailable() {
        const now = Date.now()
        if (storageAvailableCache !== null) {
            if (storageAvailableCache === false && now >= storageRetryAt) {
                storageAvailableCache = null
            } else {
                return storageAvailableCache
            }
        }

        if (storageRetryAt > now) {
            return storageAvailableCache
        }

        const storage = resolveStorage()
        if (!storage) {
            storageAvailableCache = false
            storageRetryAt = now + 1000
            return false
        }

        try {
            const probeKey = '__ielts_writing_draft_probe__'
            storage.setItem(probeKey, '1')
            storage.removeItem(probeKey)
            storageAvailableCache = true
            storageRetryAt = 0
            return true
        } catch {
            storageAvailableCache = false
            storageRetryAt = now + 1000
            return false
        }
    }

    function normalizeDraft(raw = {}) {
        const topicId = raw.topic_id === null || raw.topic_id === undefined || raw.topic_id === ''
            ? null
            : Number(raw.topic_id)
        const taskType = typeof raw.task_type === 'string' ? raw.task_type : raw.taskType
        const topicMode = typeof raw.topic_mode === 'string' ? raw.topic_mode : raw.topicMode

        return {
            task_type: VALID_TASK_TYPES.has(taskType) ? taskType : 'task2',
            topic_mode: VALID_TOPIC_MODES.has(topicMode) ? topicMode : 'free',
            topic_id: Number.isFinite(topicId) ? topicId : null,
            topic_text: typeof raw.topic_text === 'string' ? raw.topic_text : '',
            category: typeof raw.category === 'string' ? raw.category : '',
            content: typeof raw.content === 'string' ? raw.content : '',
            word_count: Number.isFinite(Number(raw.word_count)) ? Number(raw.word_count) : 0,
            last_saved: raw.last_saved || null
        }
    }

    function createSignature(payload) {
        return JSON.stringify({
            task_type: payload.task_type,
            topic_mode: payload.topic_mode,
            topic_id: payload.topic_id,
            topic_text: payload.topic_text,
            category: payload.category,
            content: payload.content,
            word_count: payload.word_count
        })
    }

    function hasMeaningfulContent(payload) {
        if (!payload) return false

        return (
            payload.content.trim().length > 0 ||
            payload.topic_text.trim().length > 0 ||
            payload.topic_id !== null ||
            payload.category.trim().length > 0
        )
    }

    function buildSnapshot(override = null) {
        if (override) {
            return normalizeDraft(override)
        }

        if (typeof getSnapshot === 'function') {
            return normalizeDraft(getSnapshot())
        }

        return normalizeDraft(lastSnapshot || {})
    }

    function saveDraft(override = null) {
        try {
            if (!isStorageAvailable()) {
                return null
            }

            persistenceEnabled = true
            const snapshot = buildSnapshot(override)

            if (!hasMeaningfulContent(snapshot)) {
                clearDraft()
                return null
            }

            const payload = {
                ...snapshot,
                last_saved: new Date().toISOString()
            }

            const storage = resolveStorage()
            if (!storage) {
                return null
            }

            storage.setItem(draftKey.value, JSON.stringify(payload))
            lastSnapshot = payload
            lastPersistedSignature = createSignature(payload)
            return payload
        } catch (error) {
            console.error('[Draft] Failed to save:', error)
            if (error.name === 'QuotaExceededError') {
                console.warn('[Draft] localStorage quota exceeded')
            }
            return null
        }
    }

    function scheduleSave(override = null, delay = 500) {
        if (!isStorageAvailable()) {
            return
        }

        persistenceEnabled = true
        lastSnapshot = buildSnapshot(override)

        if (!hasMeaningfulContent(lastSnapshot)) {
            clearDraft()
            return
        }

        if (saveTimeout) {
            clearTimeout(saveTimeout)
        }

        saveTimeout = setTimeout(() => {
            saveDraft(lastSnapshot)
            saveTimeout = null
        }, delay)
    }

    function loadDraft() {
        try {
            if (!isStorageAvailable()) {
                return null
            }

            const storage = resolveStorage()
            if (!storage) {
                return null
            }

            const stored = storage.getItem(draftKey.value)
            if (!stored) return null

            const payload = normalizeDraft(JSON.parse(stored))
            if (!hasMeaningfulContent(payload)) {
                clearDraft()
                return null
            }
            lastSnapshot = payload
            lastPersistedSignature = createSignature(payload)
            persistenceEnabled = true
            return payload
        } catch (error) {
            console.error('[Draft] Failed to load:', error)
            clearDraft()
            return null
        }
    }

    function clearDraft() {
        try {
            if (saveTimeout) {
                clearTimeout(saveTimeout)
                saveTimeout = null
            }
            lastSnapshot = null
            lastPersistedSignature = ''
            persistenceEnabled = false
            const storage = resolveStorage()
            if (storage) {
                storage.removeItem(draftKey.value)
            }
        } catch (error) {
            console.error('[Draft] Failed to clear:', error)
        }
    }

    function hasDraft() {
        try {
            if (!isStorageAvailable()) {
                return false
            }

            const storage = resolveStorage()
            if (!storage) {
                return false
            }

            const raw = storage.getItem(draftKey.value)
            if (!raw) {
                return false
            }

            const payload = normalizeDraft(JSON.parse(raw))
            if (!hasMeaningfulContent(payload)) {
                storage.removeItem(draftKey.value)
                return false
            }
            return true
        } catch {
            const storage = resolveStorage()
            if (storage) {
                storage.removeItem(draftKey.value)
            }
            return false
        }
    }

    function hasPendingChanges() {
        if (!persistenceEnabled) {
            return false
        }

        if (!lastSnapshot) {
            lastSnapshot = buildSnapshot()
        }

        if (!hasMeaningfulContent(lastSnapshot)) {
            return false
        }

        return createSignature(lastSnapshot) !== lastPersistedSignature
    }

    function stopAutoSave() {
        if (saveTimeout) {
            clearTimeout(saveTimeout)
            saveTimeout = null
        }
    }

    const beforeUnloadHandler = () => {
        if (hasPendingChanges()) {
            saveDraft(lastSnapshot)
        }
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', beforeUnloadHandler)
    }

    onBeforeUnmount(() => {
        if (hasPendingChanges()) {
            saveDraft(lastSnapshot)
        }
        stopAutoSave()
        if (typeof window !== 'undefined') {
            window.removeEventListener('beforeunload', beforeUnloadHandler)
        }
    })

    return {
        saveDraft,
        scheduleSave,
        loadDraft,
        clearDraft,
        hasDraft,
        stopAutoSave
    }
}
