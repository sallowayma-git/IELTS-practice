<template>
  <div
    id="shui-three-bg"
    class="shui-gradient-bg"
    aria-hidden="true"
  ></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  destroyLegacyShuiBackground,
  ensureLegacyShuiBackgroundScripts,
  installLegacyBackgroundThemeSwitcher,
  removeLegacyBackgroundThemeSwitcher,
  switchLegacyBackgroundTheme
} from '@/modules/legacy/legacyBridge'

const STORAGE_KEY = 'three_bg_theme'

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
  switchLegacyBackgroundTheme(nextThemeName, { skipIfMatches: switchTheme })
}

function handleThemeChange(event) {
  switchTheme(event?.detail?.theme || getStoredTheme())
}

function startLegacyBackground() {
  if (!legacyLoaderPromise) {
    legacyLoaderPromise = ensureLegacyShuiBackgroundScripts()
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
    switchLegacyBackgroundTheme(themeName)
  })
}

function destroy() {
  mounted = false
  window.removeEventListener('shui-bg-theme-change', handleThemeChange)
  removeLegacyBackgroundThemeSwitcher(switchTheme)
  destroyLegacyShuiBackground()
  document.body.classList.remove('hero-body', 'shui-gradient-active', 'three-bg-active', 'three-bg-fallback')
  delete document.documentElement.dataset.shuiBgTheme
  document.documentElement.style.removeProperty('--shui-gradient-start')
  document.documentElement.style.removeProperty('--shui-gradient-end')
}

onMounted(() => {
  mounted = true
  applyFallbackTheme(getStoredTheme())
  window.addEventListener('shui-bg-theme-change', handleThemeChange)
  installLegacyBackgroundThemeSwitcher(switchTheme)
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
