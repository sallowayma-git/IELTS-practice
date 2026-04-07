<template>
  <div class="app-shell">
    <ShuiBackground />
    <NavBar />
    <main class="app-main">
      <router-view v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<script setup>
import NavBar from './components/NavBar.vue'
import ShuiBackground from './components/ShuiBackground.vue'
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: rgba(245, 244, 237, 0.45); /* WebGL is visually beneath this glass layer */
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: var(--text-primary);
  position: relative;
}

.app-main {
  flex: 1;
  width: min(1520px, 100%);
  margin: 0 auto;
  padding: 32px 32px 48px;
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
