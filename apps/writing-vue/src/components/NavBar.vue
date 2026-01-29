<template>
  <nav class="navbar">
    <div class="navbar-left">
      <span class="logo">✍️</span>
      <h1 class="title">雅思写作 AI 评判</h1>
    </div>
    <div class="navbar-right">
      <button class="btn btn-secondary" @click="goBackToLegacy">
        ← 返回练习
      </button>
    </div>
  </nav>
</template>

<script setup>
function goBackToLegacy() {
  if (window.electronAPI && window.electronAPI.openLegacy) {
    window.electronAPI.openLegacy()
  } else {
    alert('此功能仅在 Electron 桌面应用中可用')
  }
}
</script>

<style scoped>
.navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.navbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo {
  font-size: 28px;
}

.title {
  font-size: 20px;
  font-weight: 600;
  color: white;
}

.navbar-right .btn {
  padding: 8px 16px;
  font-size: 14px;
}
</style>
