<template>
  <div class="app-shell">
    <ShuiBackground />
    <NavBar v-if="showShellNav" />
    <main :class="['app-main', { 'app-main--frameless': !showShellNav }]">
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
  'PracticeLibrary',
  'PracticeLibraryAlias',
  'PracticeReading',
  'PracticeReadingSuite',
  'PracticeReadingReview'
])
const showShellNav = computed(() => !framelessRouteNames.has(route.name))
const showRouteTransition = computed(() => showShellNav.value)
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
  width: min(1520px, 100%);
  margin: 0 auto;
  padding: 24px 32px 48px;
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
    padding: 22px 16px 32px;
  }
}
</style>
