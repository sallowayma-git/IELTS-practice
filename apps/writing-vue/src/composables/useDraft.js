import { onBeforeUnmount } from 'vue'
import { getDraft, newIdempotencyKey, saveDraft as persistDraft } from '@/api/writing-repository.js'
import { writingTopicModeToAttemptMode } from '@/api/writing-mode.js'

const VALID_TASK_TYPES = new Set(['task1', 'task2'])
const VALID_TOPIC_MODES = new Set(['free', 'bank'])

export function useDraft(draftId, getSnapshot = null, options = {}) {
    const explicitAttemptId = String(options.attemptId || '').trim()
    const attemptId = explicitAttemptId || `compose-${draftId || 'writing'}`
    let saveTimeout = null
    let lastSnapshot = null
    let lastPersistedSignature = ''
    let saveGeneration = 0

    function normalizeDraft(raw = {}) {
        const rawTopicId = raw.topic_id ?? raw.topicId
        const topicId = rawTopicId === null || rawTopicId === undefined
            ? null
            : String(rawTopicId).trim() || null
        const taskType = raw.task_type || raw.taskType
        const topicMode = raw.topic_mode || raw.topicMode
        return {
            task_type: VALID_TASK_TYPES.has(taskType) ? taskType : 'task2',
            topic_mode: VALID_TOPIC_MODES.has(topicMode) ? topicMode : 'free',
            // Topic IDs are opaque strings (for example topic-UUID), not a
            // frontend numeric primary key. Number() turns valid IDs into NaN.
            topic_id: topicId,
            topic_text: typeof raw.topic_text === 'string' ? raw.topic_text : '',
            category: typeof raw.category === 'string' ? raw.category : '',
            content: typeof raw.content === 'string' ? raw.content : '',
            word_count: Number.isFinite(Number(raw.word_count)) ? Number(raw.word_count) : 0,
            last_saved: raw.last_saved || null
        }
    }

    function signature(payload) {
        return JSON.stringify({ ...payload, last_saved: undefined })
    }

    function hasMeaningfulContent(payload) {
        return !!payload && (
            payload.content.trim().length > 0 ||
            payload.topic_text.trim().length > 0 ||
            payload.topic_id !== null ||
            payload.category.trim().length > 0
        )
    }

    function snapshot(override = null) {
        if (override) return normalizeDraft(override)
        if (typeof getSnapshot === 'function') return normalizeDraft(getSnapshot())
        return normalizeDraft(lastSnapshot || {})
    }

    async function saveDraft(override = null) {
        const payload = snapshot(override)
        const metadata = {
            task_type: payload.task_type,
            topic_mode: payload.topic_mode,
            topic_id: payload.topic_id,
            topic_text: payload.topic_text,
            category: payload.category
        }
        const { draft } = await persistDraft({
            attemptId,
            mode: writingTopicModeToAttemptMode(payload.topic_mode),
            assetId: payload.topic_id === null ? null : String(payload.topic_id),
            contentText: payload.content,
            promptSnapshot: JSON.stringify(metadata),
            taskType: payload.task_type,
            idempotencyKey: newIdempotencyKey('compose-draft')
        })
        lastSnapshot = { ...payload, last_saved: draft?.updatedAt || draft?.updated_at || null }
        lastPersistedSignature = signature(lastSnapshot)
        return hasMeaningfulContent(lastSnapshot) ? lastSnapshot : null
    }

    function scheduleSave(override = null, delay = 500) {
        lastSnapshot = snapshot(override)
        if (saveTimeout) clearTimeout(saveTimeout)
        const generation = saveGeneration
        saveTimeout = setTimeout(() => {
            saveTimeout = null
            if (generation !== saveGeneration) return
            void saveDraft(lastSnapshot).catch((error) => console.error('[Draft] SQLite save failed:', error))
        }, delay)
    }

    async function loadDraft() {
        const { draft } = await getDraft(attemptId)
        if (!draft) return null
        let metadata = {}
        try {
            metadata = JSON.parse(draft.promptSnapshot || draft.prompt_snapshot || '{}')
        } catch {
            metadata = { topic_text: draft.promptSnapshot || draft.prompt_snapshot || '' }
        }
        const payload = normalizeDraft({
            ...metadata,
            content: draft.contentText || draft.content_text || '',
            word_count: draft.wordCount ?? draft.word_count,
            last_saved: draft.updatedAt || draft.updated_at || null
        })
        if (!hasMeaningfulContent(payload)) return null
        lastSnapshot = payload
        lastPersistedSignature = signature(payload)
        return payload
    }

    async function clearDraft() {
        saveGeneration += 1
        if (saveTimeout) clearTimeout(saveTimeout)
        saveTimeout = null
        lastSnapshot = null
        lastPersistedSignature = ''
        await saveDraft(normalizeDraft())
    }

    async function hasDraft() {
        return (await loadDraft()) !== null
    }

    function stopAutoSave() {
        saveGeneration += 1
        if (saveTimeout) clearTimeout(saveTimeout)
        saveTimeout = null
    }

    onBeforeUnmount(() => {
        if (lastSnapshot && signature(lastSnapshot) !== lastPersistedSignature) {
            void saveDraft(lastSnapshot).catch((error) => console.error('[Draft] final SQLite save failed:', error))
        }
        stopAutoSave()
    })

    return {
        saveDraft,
        scheduleSave,
        loadDraft,
        clearDraft,
        discardDraft: clearDraft,
        hasDraft,
        stopAutoSave
    }
}
