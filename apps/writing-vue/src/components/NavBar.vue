<template>
  <nav class="navbar">
    <div class="navbar-left">
      <span class="logo">✍️</span>
      <h1 class="title">雅思写作 AI 评判</h1>
    </div>
    <div class="navbar-right">
      <router-link to="/" class="nav-link">
        ✍️ 作文输入
      </router-link>
      <router-link to="/topics" class="nav-link">
        📚 题目管理
      </router-link>
      <router-link to="/history" class="nav-link">
        📋 历史记录
      </router-link>
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

.navbar-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.nav-link {
  padding: 8px 16px;
  color: white;
  text-decoration: none;
  border-radius: 8px;
  font-size: 14px;
  transition: background 0.2s;
  background: rgba(255, 255, 255, 0.1);
}

.nav-link:hover,
.nav-link.router-link-active {
  background: rgba(255, 255, 255, 0.2);
}

.navbar-right .btn {
  padding: 8px 16px;
  font-size: 14px;
}
</style>
