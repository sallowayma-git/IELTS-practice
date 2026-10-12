<template>
  <nav class="nav-shell" aria-label="主导航">
    <div class="nav-inner">
      <router-link to="/" class="brand-block">
        <span class="brand-title">IELTS Atlas</span>
      </router-link>

      <div class="nav-links">
        <router-link
          v-for="item in navItems"
          :key="item.key"
          :to="item.to"
          class="nav-item"
          :class="{ 'is-active': isNavActive(item) }"
          :aria-current="isNavActive(item) ? 'page' : undefined"
        >
          <span class="nav-label">{{ item.label }}</span>
        </router-link>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { useRoute } from 'vue-router'
import { featureFlags } from '../config/feature-flags.js'
import { historyReturnPath } from '../modules/history/return.js'

const route = useRoute()

// Each entry owns the path prefixes it represents; the first match wins.
const navItems = [
  { key: 'reading', to: '/', label: '阅读', match: ['/'] },
  { key: 'writing', to: '/writing', label: '写作', match: ['/writing', '/evaluating/', '/result/', '/topics'] },
  ...(featureFlags.learnerModelV1
    ? [{ key: 'learner', to: '/reading/learner', label: '技能', match: ['/reading/learner'] }]
    : []),
  { key: 'notebook', to: '/notebook', label: '札记', match: ['/notebook'] },
  { key: 'history', to: '/history', label: '历史', match: ['/history'] },
  { key: 'settings', to: '/settings', label: '设置', match: ['/settings'] }
]

function isNavActive(item) {
  // A record opened from 历史 keeps 历史 lit instead of its own section.
  if (historyReturnPath(route)) return item.key === 'history'
  return item.match.some((prefix) => prefix === '/' ? route.path === '/' : route.path.startsWith(prefix))
}
</script>

<style scoped>
.nav-shell {
  position: sticky;
  top: 0;
  z-index: var(--anth-z-nav);
  border-bottom: 1px solid var(--anth-rule);
  background: var(--anth-surface);
  box-shadow: var(--anth-shadow-1);
}

.nav-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--anth-space-5);
  width: min(var(--anth-shell-max-width), 100%);
  min-height: var(--anth-nav-height);
  margin: 0 auto;
  padding: 0 clamp(16px, 4vw, 40px);
}

.brand-block {
  display: inline-flex;
  align-items: baseline;
  color: var(--anth-ink-strong);
  text-decoration: none;
}

.brand-title {
  font-family: var(--anth-font-serif);
  font-size: 18px;
  font-weight: var(--anth-weight-semibold);
  letter-spacing: var(--anth-tracking-tight);
}

.nav-links {
  display: flex;
  align-items: stretch;
  gap: clamp(16px, 2.6vw, 32px);
  overflow: visible;
}

.nav-item {
  display: inline-flex;
  align-items: center;
  min-height: var(--anth-nav-height);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: var(--anth-ink-muted);
  font-size: var(--anth-text-body-size);
  font-weight: var(--anth-weight-medium);
  text-decoration: none;
  white-space: nowrap;
  transition: color var(--anth-duration-fast) var(--anth-ease), border-color var(--anth-duration-fast) var(--anth-ease);
}

.nav-item:hover {
  color: var(--anth-ink-strong);
}

.nav-item.is-active {
  border-bottom-color: var(--anth-accent);
  color: var(--anth-ink);
}

.nav-item:focus-visible {
  outline-offset: -2px;
}

@media (max-width: 640px) {
  .nav-inner {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    padding: 10px 16px 0;
  }

  .nav-links {
    justify-content: space-between;
    gap: 4px;
  }

  .nav-item {
    min-height: 44px;
    justify-content: center;
    flex: 1 1 0;
  }
}
</style>
