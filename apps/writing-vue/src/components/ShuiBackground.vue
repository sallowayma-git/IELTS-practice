<template>
  <!-- Static warm cream canvas — Anthropic design language uses a flat warm
       background, not animated orbs or glass overlays. -->
  <div id="shui-three-bg" class="atlas-liquid-background" aria-hidden="true"></div>
</template>

<style>
#shui-three-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background: var(--anth-canvas);
}

#shui-three-bg::before,
#shui-three-bg::after {
  display: none;
}
</style>
