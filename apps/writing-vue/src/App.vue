<template>
  <div class="app-container">
    <ShuiBackground />
    <NavBar />
    <main class="main-content">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
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
.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  /* 背景透明，让下层 WebGL Canvas 透出 */
  background: transparent;
  color: var(--text-primary);
  position: relative;
}

.main-content {
  flex: 1;
  padding: 24px 40px; /* 增加页面两侧留白 */
  overflow-y: auto;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(10px); /* 增加微弱的上浮进入效果 */
}
</style>
