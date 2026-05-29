<template>
  <div
    id="shui-three-bg"
    class="shui-gradient-bg"
    aria-hidden="true"
  ></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

const STORAGE_KEY = 'three_bg_theme'
const THREE_VENDOR_SCRIPT = 'assets/vendor/three.min.js'
const THREE_BACKGROUND_SCRIPT = 'js/presentation/threeBackground.js'

const themes = {
  'misty-mountain': {
    label: 'misty-mountain',
    start: '#ffd89b',
    end: '#6accc7'
  },
  'teal-ocean': {
    label: 'teal-ocean',
    start: '#a7d8ff',
    end: '#42b9a8'
  },
  'floral-bloom': {
    label: 'floral-bloom',
    start: '#ffc4a3',
    end: '#87d8d0'
  }
}

const activeTheme = ref('misty-mountain')
let mounted = false
let legacyLoaderPromise = null

function normalizeThemeName(themeName) {
  return Object.prototype.hasOwnProperty.call(themes, themeName)
    ? themeName
    : 'misty-mountain'
}

function getStoredTheme() {
  try {
    return normalizeThemeName(localStorage.getItem(STORAGE_KEY) || 'misty-mountain')
  } catch (_) {
    return 'misty-mountain'
  }
}

function resolveLegacyAssetUrl(relativePath) {
  const normalized = String(relativePath || '').replace(/^\/+/, '')
  try {
    const currentUrl = new URL(window.location.href)
    if (currentUrl.pathname.includes('/dist/writing/')) {
      return new URL(`../../${normalized}`, currentUrl.href).href
    }
  } catch (_) {}
  return `/${normalized}`
}

function loadLegacyScript(relativePath) {
  const existing = document.querySelector(`script[data-shui-bg-script="${relativePath}"]`)
  if (existing) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = resolveLegacyAssetUrl(relativePath)
    script.async = false
    script.dataset.shuiBgScript = relativePath
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`加载背景脚本失败：${relativePath}`))
    document.head.appendChild(script)
  })
}

function applyFallbackTheme(themeName) {
  const nextThemeName = normalizeThemeName(themeName)
  const theme = themes[nextThemeName]
  activeTheme.value = nextThemeName
  document.documentElement.style.setProperty('--shui-gradient-start', theme.start)
  document.documentElement.style.setProperty('--shui-gradient-end', theme.end)
  document.documentElement.dataset.shuiBgTheme = theme.label
  try {
    localStorage.setItem(STORAGE_KEY, nextThemeName)
  } catch (_) {}
}

function switchTheme(themeName) {
  const nextThemeName = normalizeThemeName(themeName)
  applyFallbackTheme(nextThemeName)
  if (window.switchBgTheme && window.switchBgTheme !== switchTheme) {
    window.switchBgTheme(nextThemeName)
  }
}

function handleThemeChange(event) {
  switchTheme(event?.detail?.theme || getStoredTheme())
}

function startLegacyBackground() {
  if (!legacyLoaderPromise) {
    legacyLoaderPromise = Promise.resolve()
      .then(() => (window.THREE ? undefined : loadLegacyScript(THREE_VENDOR_SCRIPT)))
      .then(() => loadLegacyScript(THREE_BACKGROUND_SCRIPT))
      .catch((error) => {
        console.warn('[SHUI Three Background] fallback applied:', error)
        legacyLoaderPromise = null
        document.body.classList.add('three-bg-fallback')
      })
  }
  return legacyLoaderPromise.then(() => {
    if (!mounted) return
    const themeName = getStoredTheme()
    applyFallbackTheme(themeName)
    if (typeof window.switchBgTheme === 'function') {
      window.switchBgTheme(themeName)
    }
  })
}

function destroy() {
  mounted = false
  window.removeEventListener('shui-bg-theme-change', handleThemeChange)
  if (window.switchBgTheme === switchTheme) {
    delete window.switchBgTheme
  }
  if (window.SHUIThreeBackground && typeof window.SHUIThreeBackground.destroy === 'function') {
    window.SHUIThreeBackground.destroy()
    window.SHUIThreeBackground = null
  }
  document.body.classList.remove('hero-body', 'shui-gradient-active', 'three-bg-active', 'three-bg-fallback')
  delete document.documentElement.dataset.shuiBgTheme
  document.documentElement.style.removeProperty('--shui-gradient-start')
  document.documentElement.style.removeProperty('--shui-gradient-end')
}

onMounted(() => {
  mounted = true
  applyFallbackTheme(getStoredTheme())
  window.addEventListener('shui-bg-theme-change', handleThemeChange)
  if (typeof window.switchBgTheme !== 'function') {
    window.switchBgTheme = switchTheme
  }
  document.body.classList.add('hero-body', 'shui-gradient-active')
  startLegacyBackground()
})

onBeforeUnmount(destroy)
</script>

<style>
@property --body-gradient-angle {
  syntax: '<angle>';
  inherits: false;
  initial-value: 135deg;
}

#shui-three-bg {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
  background:
    linear-gradient(
      var(--body-gradient-angle),
      var(--shui-gradient-start, #ffd89b) 0%,
      var(--shui-gradient-end, #6accc7) 100%
    );
  animation: bodyGradientRotation 120s ease-in-out infinite;
  transform: translateZ(0);
  backface-visibility: hidden;
}

body.three-bg-active #shui-three-bg {
  background: transparent;
  animation: none;
}

@keyframes bodyGradientRotation {
  0% {
    --body-gradient-angle: 135deg;
  }

  50% {
    --body-gradient-angle: 225deg;
  }

  100% {
    --body-gradient-angle: 495deg;
  }
}

@media (prefers-reduced-motion: reduce) {
  #shui-three-bg {
    animation: none;
  }
}
</style>
