<template>
  <nav class="nav-shell glass-toolbar" aria-label="主导航">
    <div class="nav-inner">
      <router-link to="/" class="brand-block">
        <span class="brand-mark" aria-hidden="true">A</span>
        <span class="brand-copy">
          <strong class="brand-title">IELTS Atlas</strong>
          <span class="brand-subtitle">Reading + Writing</span>
        </span>
      </router-link>

      <div class="nav-cluster">
        <div class="nav-links glass-pill">
          <router-link
            v-for="item in navItems"
            :key="item.key"
            :to="item.to"
            class="nav-item"
            :class="{ 'is-active': isNavActive(item) }"
            :aria-current="isNavActive(item) ? 'page' : undefined"
          >
            <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path v-if="item.key === 'overview'" d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
              <path v-else-if="item.key === 'reading'" d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v18H7.5A2.5 2.5 0 0 0 5 22V4.5ZM5 4.5V19" />
              <path v-else-if="item.key === 'writing'" d="m14.5 5.5 4-4 4 4-10 10-5 1 1-5 6-6ZM13 7l4 4" />
              <path v-else-if="item.key === 'history'" d="M4 19V5m0 14h16M8 16v-5m4 5V7m4 9v-8" />
              <path v-else-if="item.key === 'learner'" d="M4 19.5V5.8A2.8 2.8 0 0 1 6.8 3H20v15H6.8A2.8 2.8 0 0 0 4 20.8M8 7h8M8 10h8M8 13h5" />
              <path v-else-if="item.key === 'agent'" d="M8 7.5A3.5 3.5 0 0 1 11.5 4h1A3.5 3.5 0 0 1 16 7.5v1A3.5 3.5 0 0 1 12.5 12h-1A3.5 3.5 0 0 1 8 8.5v-1ZM6 15h12M9 18h6M12 12v3" />
              <path v-else d="M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.41 1.41m9.9 9.9 1.41 1.41m0-12.72-1.41 1.41m-9.9 9.9-1.41 1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
            </svg>
            <span class="nav-label">{{ item.label }}</span>
          </router-link>
        </div>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { useRoute } from 'vue-router'
import { featureFlags } from '../config/feature-flags.js'

const route = useRoute()

const navItems = [
  { key: 'overview', to: '/', label: '总览', path: '/', view: undefined },
  { key: 'reading', to: { path: '/', query: { view: 'browse' } }, label: '阅读', path: '/', view: 'browse' },
  { key: 'writing', to: '/writing', label: '写作', path: '/writing' },
  ...(featureFlags.learnerModelV1
    ? [{ key: 'learner', to: '/reading/learner', label: '技能', path: '/reading/learner' }]
    : []),
  ...(featureFlags.agentWorkspaceV1
    ? [{ key: 'agent', to: '/agent', label: '智能体', path: '/agent' }]
    : []),
  { key: 'history', to: '/history', label: '历史', path: '/history' },
  { key: 'settings', to: '/settings', label: '设置', path: '/settings' }
]

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function isNavActive(item) {
  if (route.path !== item.path) return false
  if (item.path !== '/') return true
  const view = firstQueryValue(route.query.view)
  return item.view === undefined ? !view : view === item.view
}
</script>

<style scoped>
.nav-shell {
  position: sticky;
  top: 0;
  z-index: 120;
  border-bottom: 1px solid var(--anth-border);
  background: var(--anth-canvas-soft);
}

.nav-inner {
  width: min(var(--shui-shell-max-width), 100%);
  margin: 0 auto;
  padding: 12px clamp(16px, 3vw, 28px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.brand-block {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  color: inherit;
  text-decoration: none;
  min-width: 244px;
  gap: 11px;
  text-align: left;
}

.brand-mark {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--anth-accent);
  border-radius: var(--anth-radius-sm);
  background: var(--anth-accent);
  color: var(--anth-accent-contrast);
  font-family: var(--anth-font-serif);
  font-size: var(--anth-text-md);
  font-weight: var(--anth-weight-semibold);
  line-height: 1;
}

.brand-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.brand-title {
  font-size: var(--anth-text-md);
  font-family: var(--anth-font-serif);
  letter-spacing: var(--anth-tracking-tight);
  font-weight: var(--anth-weight-semibold);
  color: var(--anth-ink-strong);
}

.brand-subtitle {
  font-size: var(--anth-text-xs);
  letter-spacing: var(--anth-tracking-caps);
  text-transform: uppercase;
  color: var(--anth-ink-faint);
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
  border-radius: var(--anth-radius-pill);
  border: 1px solid var(--anth-border-subtle);
  background: transparent;
}

.nav-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--anth-ink-soft);
  text-decoration: none;
  min-height: 34px;
  font-size: var(--anth-text-sm);
  font-weight: var(--anth-weight-medium);
  border-radius: var(--anth-radius-sm);
  padding: 6px 12px;
  transition: background var(--anth-duration-fast) var(--anth-ease), color var(--anth-duration-fast) var(--anth-ease);
}

.nav-item:hover,
.nav-item.is-active {
  color: var(--anth-ink-strong);
  background: var(--anth-accent-soft);
  box-shadow: none;
}

.nav-item.is-active {
  color: var(--anth-accent-strong);
}

.nav-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  line-height: 1;
}

@media (max-width: 900px) {
  .nav-inner {
    padding: 12px 16px;
    flex-direction: column;
    align-items: stretch;
  }

  .brand-block {
    min-width: 0;
    justify-content: flex-start;
  }

  .nav-cluster {
    width: 100%;
    justify-content: space-between;
  }

  .nav-links {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .nav-links::-webkit-scrollbar {
    display: none;
  }

  .nav-item {
    flex: 0 0 auto;
  }
}

@media (max-width: 640px) {
  .nav-links {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: 100%;
    overflow: visible;
    border-radius: var(--atlas-radius-md);
  }

  .nav-item {
    width: 100%;
    min-width: 0;
    min-height: 44px;
    justify-content: center;
    padding: 8px 6px;
    white-space: nowrap;
  }
}
</style>
