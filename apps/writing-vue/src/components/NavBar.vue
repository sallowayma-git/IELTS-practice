<template>
  <nav class="nav-shell glass-toolbar">
    <div class="nav-inner">
      <router-link to="/" class="brand-block">
        <strong class="brand-title">IELTS Writing Excellence</strong>
        <span class="brand-subtitle">Workspace</span>
      </router-link>

      <div class="nav-cluster">
        <div class="nav-links glass-pill">
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
  border-bottom: 1px solid var(--lg-border-subtle);
}

.nav-inner {
  width: min(1520px, 100%);
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.brand-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: inherit;
  text-decoration: none;
  min-width: 230px;
}

.brand-title {
  font-size: 1rem;
  font-family: var(--font-family-display);
  letter-spacing: 0.01em;
  font-weight: 600;
}

.brand-subtitle {
  font-size: 0.74rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.nav-cluster {
  display: flex;
  align-items: center;
  gap: 12px;
}

.nav-links {
  display: flex;
  align-items: center;
  padding: 4px;
  gap: 2px;
}

.glass-pill {
  border-radius: 999px;
  border: 1px solid var(--lg-border-color);
  background: var(--lg-bg-interactive);
  backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
}

.nav-item {
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.9rem;
  border-radius: 999px;
  padding: 8px 14px;
  transition: all var(--duration-fast) var(--ease-smooth);
}

.nav-item:hover,
.nav-item.router-link-active {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.58);
  box-shadow: 0 1px 4px rgba(37, 35, 44, 0.08);
}

.return-link {
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.52);
  border: 1px solid var(--lg-border-color);
  color: var(--secondary-color);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-smooth);
  backdrop-filter: blur(var(--lg-blur-sm));
  -webkit-backdrop-filter: blur(var(--lg-blur-sm));
}

.return-link:hover {
  background: rgba(255, 255, 255, 0.7);
}

.return-link:disabled,
.return-link.is-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (max-width: 900px) {
  .nav-inner {
    padding: 12px 16px;
    flex-direction: column;
    align-items: stretch;
  }

  .brand-block {
    min-width: 0;
  }

  .nav-cluster {
    width: 100%;
    justify-content: space-between;
  }

  .nav-links {
    flex: 1;
    overflow-x: auto;
  }
}
</style>
