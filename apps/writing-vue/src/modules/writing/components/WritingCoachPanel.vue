<template>
  <section class="result-section card writing-coach" aria-labelledby="writing-coach-heading">
    <div class="panel-header">
      <h2 id="writing-coach-heading">写作教练</h2>
      <button v-if="open" class="btn-text" type="button" @click="open = false">收起</button>
    </div>

    <template v-if="!open">
      <p class="writing-coach__intro">围绕这篇作文的评分和表达提问。</p>
      <button class="btn btn-secondary btn-sm" type="button" data-writing-coach-open @click="openPanel">
        开始对话
      </button>
    </template>

    <template v-else>
      <div v-if="loadError" class="writing-coach__error" role="alert">
        <span>教练暂时无法连接，请稍后重试</span>
        <button class="btn-text" type="button" @click="loadThread">重试</button>
      </div>

      <div
        v-else
        ref="transcriptRef"
        class="writing-coach__messages"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <p v-if="loading" class="writing-coach__status" role="status">教练连接中...</p>
        <p v-else-if="!messages.length" class="writing-coach__empty">问一个关于评分、结构或表达的问题。</p>
        <div
          v-for="(message, index) in messages"
          :key="message.id || index"
          class="writing-coach__row"
          :class="{ 'is-user': isUser(message) }"
        >
          <span class="writing-coach__role">{{ isUser(message) ? '你' : '教练' }}</span>
          <p class="writing-coach__text">{{ messageText(message) }}</p>
        </div>
      </div>

      <div v-if="remembered" class="writing-coach__remembered">
        <span>已记住：{{ remembered.text }}</span>
        <button class="btn-text" type="button" data-writing-coach-forget @click="forgetRemembered">撤销</button>
      </div>
      <p v-if="forgetError" class="writing-coach__error" role="alert">撤销失败，请稍后重试</p>

      <form class="writing-coach__composer" @submit.prevent="send">
        <textarea
          v-model="draft"
          class="textarea writing-coach__input"
          rows="2"
          placeholder="问教练：这段结论怎么提分？"
          aria-label="向写作教练提问"
          @keydown.enter.exact.prevent="onEnter"
        ></textarea>
        <button class="btn btn-primary btn-sm" type="submit" :disabled="sending || !canSend">
          {{ sending ? '发送中...' : '发送' }}
        </button>
      </form>
      <p v-if="sendError" class="writing-coach__error" role="alert">发送失败，请稍后重试</p>
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import { practiceCoach } from '@/api/practice-client.js'

const props = defineProps({
  attemptId: { type: String, required: true },
  assetId: { type: String, default: null }
})

const open = ref(false)
const loaded = ref(false)
const loading = ref(false)
const loadError = ref('')
const messages = ref([])
const threadId = ref('')
const transcriptRef = ref(null)

const draft = ref('')
const sending = ref(false)
const sendError = ref('')
const remembered = ref(null)
const forgetError = ref('')

const canSend = computed(() => Boolean(draft.value.trim()))

function isUser(message) {
  return message?.role === 'user'
}

function messageText(message) {
  const content = String(message?.content || '').trim()
  if (content) return content
  const snapshot = message?.structuredPayload || message?.structured_payload
  return String(snapshot?.answer || snapshot?.message || '').trim()
}

function openPanel() {
  open.value = true
  if (!loaded.value) loadThread()
}

async function loadThread() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await practiceCoach.listMessages('writing', props.attemptId, {
      assetId: props.assetId,
      kind: 'practice'
    })
    threadId.value = result.threadId
    messages.value = Array.isArray(result.messages) ? result.messages : []
    loaded.value = true
  } catch (error) {
    loadError.value = '教练暂时无法连接，请稍后重试'
  } finally {
    loading.value = false
  }
}

function onEnter(event) {
  if (event?.isComposing) return
  send()
}

async function send() {
  const content = draft.value.trim()
  if (!content || sending.value) return
  sending.value = true
  sendError.value = ''
  try {
    const result = await practiceCoach.query('writing', {
      content,
      assetId: props.assetId,
      action: 'chat',
      surface: 'chat_widget',
      promptKind: 'freeform'
    }, props.attemptId)
    threadId.value = result.threadId || threadId.value
    const rows = Array.isArray(result.messages) ? result.messages : []
    messages.value = rows.length
      ? rows
      : [...messages.value, { id: `local-${Date.now()}`, role: 'assistant', content: result.answer || '' }]
    draft.value = ''
    applyRemembered(result.remembered)
    await nextTick()
    scrollToBottom()
  } catch (error) {
    sendError.value = '发送失败，请稍后重试'
  } finally {
    sending.value = false
  }
}

function applyRemembered(value) {
  const key = String(value?.key || '').trim()
  const text = String(value?.text || '').trim()
  if (!key || !text) return
  remembered.value = { key, text }
  forgetError.value = ''
}

async function forgetRemembered() {
  if (!remembered.value || !threadId.value) return
  forgetError.value = ''
  try {
    await practiceCoach.forgetPreference(threadId.value, remembered.value.key)
    remembered.value = null
  } catch (error) {
    forgetError.value = '撤销失败，请稍后重试'
  }
}

function scrollToBottom() {
  const el = transcriptRef.value
  if (el) el.scrollTop = el.scrollHeight
}
</script>

<style scoped>
.writing-coach__intro {
  margin: 0 0 var(--anth-space-3);
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
  line-height: var(--anth-text-small-line);
}

.writing-coach__messages {
  display: grid;
  gap: var(--anth-space-3);
  max-height: 320px;
  overflow-y: auto;
  padding-right: var(--anth-space-1);
}

.writing-coach__row {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.writing-coach__role {
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
}

.writing-coach__text {
  margin: 0;
  color: var(--anth-ink-soft);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-body-size);
  line-height: var(--anth-text-body-line);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.writing-coach__row.is-user .writing-coach__text {
  color: var(--anth-ink);
}

.writing-coach__empty,
.writing-coach__status {
  margin: 0;
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-small-size);
  line-height: var(--anth-text-small-line);
}

.writing-coach__remembered {
  display: flex;
  align-items: center;
  gap: var(--anth-space-2);
  margin-top: var(--anth-space-3);
  padding: var(--anth-space-2) var(--anth-space-3);
  border: 1px solid var(--anth-rule);
  border-radius: var(--anth-radius-card);
  background: var(--anth-surface-sunken);
  color: var(--anth-ink-soft);
  font-size: var(--anth-text-small-size);
}

.writing-coach__remembered span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.writing-coach__error {
  display: flex;
  align-items: center;
  gap: var(--anth-space-3);
  margin: var(--anth-space-2) 0 0;
  color: var(--anth-danger);
  font-size: var(--anth-text-small-size);
}

.writing-coach__composer {
  display: flex;
  align-items: flex-end;
  gap: var(--anth-space-3);
  margin-top: var(--anth-space-4);
}

.writing-coach__composer .writing-coach__input {
  flex: 1 1 auto;
  min-height: 64px;
  font-family: var(--anth-font-sans);
  font-size: var(--anth-text-small-size);
}

@media (max-width: 480px) {
  .writing-coach__composer {
    flex-direction: column;
    align-items: stretch;
  }

  .writing-coach__composer .btn {
    width: 100%;
  }
}
</style>
