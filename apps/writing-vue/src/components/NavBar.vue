<template>
  <nav class="nav-shell">
    <div class="nav-inner">
      <router-link to="/" class="brand-block">
        <span class="brand-mark">IW</span>
        <div class="brand-copy">
          <span class="brand-eyebrow">IELTS writing workspace</span>
          <strong class="brand-title">写作评分工作台</strong>
        </div>
      </router-link>

      <div class="nav-cluster">
        <div class="nav-links">
          <router-link
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            class="nav-item"
          >
            <span class="nav-label">{{ item.label }}</span>
            <span class="nav-caption">{{ item.caption }}</span>
          </router-link>
        </div>

        <button
          :class="['return-link', { 'is-disabled': isReturnDisabled }]"
          :disabled="isReturnDisabled"
          :title="returnTitle"
          @click="goBackToLegacy"
        >
          <span>{{ returnLabel }}</span>
        </button>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const router = useRouter()
const route = useRoute()

const navItems = [
  { to: '/', label: '写作', caption: 'Compose' },
  { to: '/topics', label: '题库', caption: 'Topics' },
  { to: '/history', label: '历史', caption: 'History' },
  { to: '/settings', label: '设置', caption: 'Settings' }
]

const canOpenLegacy = computed(() => (
  typeof window !== 'undefined' &&
  !!window.electronAPI &&
  typeof window.electronAPI.openLegacy === 'function'
))

const isComposePage = computed(() => route.name === 'Compose')
const isReturnDisabled = computed(() => !canOpenLegacy.value && isComposePage.value)
const returnLabel = computed(() => (canOpenLegacy.value ? '返回练习主页' : '回写作首页'))
const returnTitle = computed(() => (
  canOpenLegacy.value
    ? '返回练习主页'
    : '当前环境不支持返回 Legacy，点击回写作首页'
))

function goBackToLegacy() {
  if (canOpenLegacy.value) {
    window.electronAPI.openLegacy()
    return
  }

  if (!isComposePage.value) {
    router.push({ name: 'Compose' })
  }
}
</script>

<style scoped>
.nav-shell {
  position: sticky;
  top: 0;
  z-index: 120;
  padding: 18px 0 0;
}

.nav-inner {
  width: min(1480px, calc(100vw - 48px));
  margin: 0 auto;
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  border: 1px solid rgba(88, 64, 46, 0.12);
  border-radius: 28px;
  background: rgba(255, 250, 242, 0.84);
  backdrop-filter: blur(10px);
  box-shadow: 0 14px 30px rgba(68, 46, 29, 0.06);
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 14px;
  color: inherit;
  text-decoration: none;
}

.brand-mark {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #9b6c49 0%, #7d5133 100%);
  color: #fff7ee;
  font-family: var(--font-family-display);
  font-size: 1rem;
  letter-spacing: 0.08em;
}

.brand-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.brand-eyebrow {
  color: var(--text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.brand-title {
  font-size: 1.18rem;
  font-family: var(--font-family-display);
}

.nav-cluster {
  display: flex;
  align-items: center;
  gap: 18px;
}

.nav-links {
  display: flex;
  gap: 8px;
}

.nav-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 88px;
  padding: 10px 12px;
  border-radius: 16px;
  color: var(--text-secondary);
  text-decoration: none;
  transition: all var(--duration-fast) var(--ease-smooth);
}

.nav-item:hover {
  background: rgba(143, 95, 63, 0.08);
  color: var(--text-primary);
}

.nav-item.router-link-active {
  background: rgba(143, 95, 63, 0.12);
  color: var(--text-primary);
  box-shadow: inset 0 0 0 1px rgba(143, 95, 63, 0.16);
}

.nav-label {
  font-size: 0.95rem;
  font-weight: 600;
}

.nav-caption {
  color: var(--text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.return-link {
  min-height: 44px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid rgba(88, 64, 46, 0.12);
  background: rgba(255, 251, 245, 0.92);
  color: var(--text-primary);
  font-weight: 600;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-smooth);
}

.return-link:hover {
  background: #fffdf9;
  border-color: var(--border-strong);
}

.return-link:disabled,
.return-link.is-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (max-width: 960px) {
  .nav-inner {
    width: min(100vw - 24px, 1480px);
    flex-direction: column;
    align-items: stretch;
    border-radius: 24px;
  }

  .nav-cluster {
    flex-direction: column;
    align-items: stretch;
  }

  .nav-links {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .return-link {
    min-height: 46px;
  }
}
</style>
