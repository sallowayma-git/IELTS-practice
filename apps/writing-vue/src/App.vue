<template>
  <div :class="['app-shell', 'atlas-source-ui', showShellNav ? 'atlas-paper' : 'atlas-exam']">
    <a class="a11y-skip-link" href="#app-main-content">跳到主要内容</a>
    <div id="a11y-status-live" class="a11y-status-live" role="status" aria-live="polite" aria-atomic="true"></div>
    <ShuiBackground />
    <CrayonDefs v-if="showShellNav" />
    <NavBar v-if="showShellNav" />
    <main
      id="app-main-content"
      :class="['app-main', { 'app-main--frameless': !showShellNav, 'app-main--bleed': showShellNav && route.name === 'Notebook' }]"
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
import CrayonDefs from './modules/notebook/components/CrayonDefs.vue'

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
  padding: clamp(28px, 5vw, 48px) clamp(16px, 3vw, 48px) 32px;
  position: relative;
  z-index: 1;
}

/* Notebook: the paper itself is the whole main area, so drop the gutter and
   let the route's page own its edge-to-edge background and inner centring. */
.app-main--bleed {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 0;
}

.app-main--frameless {
  width: 100%;
  padding: 0;
}

/* Exam freeze: below 900px the frameless exam main has always carried the
   legacy shell gutter. Pinned so the CD-IELTS screens stay pixel-identical. */
@media (max-width: 900px) {
  .app-main--frameless {
    padding: 22px 16px 36px;
  }
}

.page-enter-active,
.page-leave-active {
  transition: opacity var(--duration-normal) var(--ease-smooth);
}

.page-enter-from,
.page-leave-to {
  opacity: 0;
}
</style>
