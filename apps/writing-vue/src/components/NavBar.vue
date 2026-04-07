<template>
  <nav class="nav-shell">
    <div class="nav-inner">
      <router-link to="/" class="brand-block">
        <strong class="brand-title">IELTS / Writing</strong>
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
  { to: '/', label: '写作' },
  { to: '/topics', label: '题库' },
  { to: '/history', label: '历史' },
  { to: '/settings', label: '设置' }
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
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-surface);
}

.nav-inner {
  width: min(1520px, 100%);
  margin: 0 auto;
  padding: 12px 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.brand-block {
  display: flex;
  align-items: center;
  color: inherit;
  text-decoration: none;
}

.brand-title {
  font-size: 1.18rem;
  font-family: var(--font-family-display);
  font-weight: 500;
}

.nav-cluster {
  display: flex;
  align-items: center;
  gap: 24px;
}

.nav-links {
  display: flex;
  gap: 16px;
}

.nav-item {
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.95rem;
  transition: color var(--duration-fast) var(--ease-smooth);
}

.nav-item:hover,
.nav-item.router-link-active {
  color: var(--text-primary);
}

.return-link {
  padding: 6px 14px;
  border-radius: var(--radius-md);
  background: var(--bg-muted);
  color: var(--secondary-color);
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-smooth);
}

.return-link:hover {
  background: var(--bg-muted-strong);
}

.return-link:disabled,
.return-link.is-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (max-width: 900px) {
  .nav-inner {
    padding: 12px 16px;
  }
}
</style>
