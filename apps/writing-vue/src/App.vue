<template>
  <div class="app-shell">
    <div class="app-shell__wash" aria-hidden="true"></div>
    <div class="app-shell__grain" aria-hidden="true"></div>
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
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: transparent;
  color: var(--text-primary);
  position: relative;
}

.app-shell__wash,
.app-shell__grain {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

.app-shell__wash {
  background:
    radial-gradient(circle at 18% 24%, rgba(181, 108, 72, 0.12), transparent 22%),
    radial-gradient(circle at 84% 14%, rgba(88, 107, 84, 0.08), transparent 20%),
    linear-gradient(180deg, rgba(255, 251, 245, 0.28), rgba(255, 251, 245, 0));
  z-index: -2;
}

.app-shell__grain {
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 18px 18px;
  opacity: 0.22;
  mix-blend-mode: soft-light;
  z-index: -1;
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
  transform: translateY(16px);
}

@media (max-width: 900px) {
  .app-main {
    padding: 22px 16px 32px;
  }
}
</style>
