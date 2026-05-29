<template>
  <nav class="nav-shell glass-toolbar">
    <div class="nav-inner">
      <router-link to="/writing" class="brand-block">
        <strong class="brand-title">📚 考试总览系统</strong>
        <span class="brand-subtitle">Practice Shell</span>
      </router-link>

      <div class="nav-cluster">
        <div class="nav-links glass-pill">
          <router-link
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            class="nav-item"
          >
            <span class="nav-label">{{ item.label }}</span>
          </router-link>
        </div>
      </div>
    </div>
  </nav>
</template>

<script setup>
const navItems = [
  { to: '/writing', label: '写作' },
  { to: '/topics', label: '写作题库' },
  { to: '/history', label: '写作记录' },
  { to: '/settings', label: '设置' }
]
</script>

<style scoped>
.nav-shell {
  position: sticky;
  top: 0;
  z-index: 120;
  border-bottom: 1px solid var(--lg-border-subtle);
}

.nav-inner {
  width: min(1520px, 100%);
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.brand-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: inherit;
  text-decoration: none;
  min-width: 230px;
}

.brand-title {
  font-size: 1rem;
  font-family: var(--font-family-display);
  letter-spacing: 0.01em;
  font-weight: 600;
}

.brand-subtitle {
  font-size: 0.74rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.nav-cluster {
  display: flex;
  align-items: center;
  gap: 12px;
}

.nav-links {
  display: flex;
  align-items: center;
  padding: 4px;
  gap: 2px;
}

.glass-pill {
  border-radius: 999px;
  border: 1px solid var(--lg-border-color);
  background: var(--lg-bg-interactive);
  backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
  -webkit-backdrop-filter: blur(var(--lg-blur-md)) saturate(var(--lg-saturate));
}

.nav-item {
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 0.9rem;
  border-radius: 999px;
  padding: 8px 14px;
  transition: all var(--duration-fast) var(--ease-smooth);
}

.nav-item:hover,
.nav-item.router-link-active {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.58);
  box-shadow: 0 1px 4px rgba(37, 35, 44, 0.08);
}

@media (max-width: 900px) {
  .nav-inner {
    padding: 12px 16px;
    flex-direction: column;
    align-items: stretch;
  }

  .brand-block {
    min-width: 0;
  }

  .nav-cluster {
    width: 100%;
    justify-content: space-between;
  }

  .nav-links {
    flex: 1;
    overflow-x: auto;
  }
}
</style>
