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
  background: transparent;
  color: var(--text-primary);
  position: relative;
  isolation: isolate;
}

.app-shell::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background:
    radial-gradient(circle at 12% -8%, rgba(255, 236, 192, 0.35), transparent 55%),
    radial-gradient(circle at 88% 8%, rgba(177, 232, 226, 0.28), transparent 48%),
    linear-gradient(180deg, rgba(250, 249, 245, 0.54), rgba(250, 249, 245, 0.3));
}

.app-main {
  flex: 1;
  width: min(1520px, 100%);
  margin: 0 auto;
  padding: 24px 32px 48px;
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
