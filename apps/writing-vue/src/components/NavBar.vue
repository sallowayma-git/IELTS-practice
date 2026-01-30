<template>
  <nav class="navbar-container">
    <div class="navbar-content">
      <div class="navbar-left">
        <div class="logo-wrapper">
          <span class="logo-icon">✍️</span>
        </div>
        <h1 class="brand-title">IELTS Writing <span class="badge">Pro</span></h1>
      </div>
      
      <div class="navbar-right">
        <div class="nav-links">
          <router-link to="/" class="nav-item">
            <span class="nav-icon">📝</span> 写作
          </router-link>
          <router-link to="/topics" class="nav-item">
            <span class="nav-icon">📚</span> 题库
          </router-link>
          <router-link to="/history" class="nav-item">
            <span class="nav-icon">📊</span> 历史
          </router-link>
          <router-link to="/settings" class="nav-item">
            <span class="nav-icon">⚙️</span> 设置
          </router-link>
        </div>
        
        <div class="divider"></div>
        
        <button class="btn-return" @click="goBackToLegacy" title="返回练习主页">
          <span class="icon">🔙</span> <span class="text">返回</span>
        </button>
      </div>
    </div>
  </nav>
</template>

<script setup>
function goBackToLegacy() {
  if (window.electronAPI && window.electronAPI.openLegacy) {
    window.electronAPI.openLegacy()
  } else {
    // 优雅降级提示
    console.warn('Navigation to legacy is only available in Electron')
  }
}
</script>

<style scoped>
.navbar-container {
  position: sticky;
  top: 0;
  z-index: 100;
  /* 移除背景色，让毛玻璃效果更纯粹 */
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
}

.navbar-content {
  max-width: 1400px;
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 72px;
}

.navbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.logo-wrapper {
  background: rgba(255, 255, 255, 0.2);
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
}

.logo-icon {
  font-size: 24px;
}

.brand-title {
  font-size: 20px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  gap: 8px;
  text-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.badge {
  font-size: 11px;
  background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%);
  color: #8B4500;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.navbar-right {
  display: flex;
  align-items: center;
  gap: 24px;
}

.nav-links {
  display: flex;
  background: rgba(0, 0, 0, 0.2);
  padding: 4px;
  border-radius: 12px;
  gap: 4px;
}

.nav-item {
  color: rgba(255, 255, 255, 0.8);
  text-decoration: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  gap: 6px;
}

.nav-item:hover {
  color: white;
  background: rgba(255, 255, 255, 0.1);
}

.nav-item.router-link-active {
  background: white;
  color: var(--primary-color);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  font-weight: 600;
}

.divider {
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.2);
}

.btn-return {
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: white;
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-return:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: translateY(-1px);
}

.btn-return .icon {
  font-size: 12px;
}
</style>
