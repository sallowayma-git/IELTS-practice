<template>
  <div class="app-shell atlas-source-ui">
    <a class="a11y-skip-link" href="#app-main-content">跳到主要内容</a>
    <div id="a11y-status-live" class="a11y-status-live" role="status" aria-live="polite" aria-atomic="true"></div>
    <ShuiBackground />
    <NavBar v-if="showShellNav" />
    <main
      id="app-main-content"
      :class="['app-main', { 'app-main--frameless': !showShellNav }]"
      tabindex="-1"
    >
      <router-view v-slot="{ Component }">
        <transition v-if="showRouteTransition" name="page" mode="out-in">
          <component :is="Component" :key="routeViewKey" />
        </transition>
        <component v-else :is="Component" :key="routeViewKey" />
      </router-view>
    </main>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import NavBar from './components/NavBar.vue'
import ShuiBackground from './components/ShuiBackground.vue'

const route = useRoute()
const framelessRouteNames = new Set([
  'PracticeReading',
  'PracticeReadingSuite',
  'PracticeReadingReview'
])
const showShellNav = computed(() => !framelessRouteNames.has(route.name))
const prefersReducedMotion = computed(() => {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
})
const showRouteTransition = computed(() => showShellNav.value && !prefersReducedMotion.value)
const routeViewKey = computed(() => route.path || String(route.name || route.fullPath))
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: transparent;
  color: var(--text-primary);
  position: relative;
  isolation: isolate;
}

.app-main {
  flex: 1;
  width: min(var(--shui-shell-max-width), 100%);
  margin: 0 auto;
  padding: 28px clamp(16px, 4vw, 40px) 56px;
  position: relative;
  z-index: 1;
}

.app-main--frameless {
  width: 100%;
  padding: 0;
}

.page-enter-active,
.page-leave-active {
  transition:
    opacity var(--duration-normal) var(--ease-smooth),
    transform var(--duration-normal) var(--ease-smooth);
}

.page-enter-from,
.page-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 900px) {
  .app-main {
    padding: 22px 16px 36px;
  }
}
</style>
