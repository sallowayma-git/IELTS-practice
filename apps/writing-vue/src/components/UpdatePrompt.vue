<template>
  <div v-if="updates.state.promptVisible" class="update-prompt card" role="status" aria-live="polite">
    <div class="update-prompt__copy">
      <strong>{{ title }}</strong>
      <span>{{ detail }}</span>
    </div>
    <div class="update-prompt__actions">
      <button class="btn btn-secondary btn-sm" type="button" @click="updates.dismissPrompt()">稍后</button>
      <button class="btn btn-primary btn-sm" type="button" @click="openUpdates">查看</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAppUpdates, AUTO_CHECK_KEY } from '@/composables/useAppUpdates.js'
import { readPreferenceStrict } from '@/composables/useTauriPreferences.js'

const router = useRouter()
const updates = useAppUpdates()

const title = computed(() => {
  const app = updates.state.status?.app
  if (updates.appTier.value === 'reinstall') return `新版本 ${app?.latestVersion} 需要重新安装`
  if (updates.appTier.value === 'ota') return `发现新版本 ${app?.latestVersion}`
  return '题库有更新'
})

const detail = computed(() => {
  if (updates.appTier.value === 'reinstall') return '点击查看下载地址，覆盖安装后记录会保留。'
  if (updates.appTier.value === 'ota') return '后台下载，安装后重启即可生效。'
  return `${updates.availableContent.value.length} 个题库可以更新，无需重启。`
})

function openUpdates() {
  updates.dismissPrompt()
  router.push({ name: 'Settings', query: { updates: String(Date.now()) } }).catch(() => {})
}

// The setting is read when the delayed check fires (not at mount, so page
// read contracts stay unchanged). If it cannot be read, stay quiet.
onMounted(() => {
  updates.scheduleStartupCheck(
    async () => (await readPreferenceStrict(AUTO_CHECK_KEY, true)) !== false
  )
})
</script>

<style scoped>
.update-prompt {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: var(--anth-z-overlay, 1000);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 14px 16px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12);
}

.update-prompt__copy {
  display: grid;
  gap: 2px;
  flex: 1 1 200px;
}

.update-prompt__copy span {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.update-prompt__actions {
  display: flex;
  gap: 8px;
}
</style>
